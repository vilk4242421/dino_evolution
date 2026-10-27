# Модель хищника (тираннозавр): из STL → game/rex.js.  Запуск: python3 tools/rex_bake.py <Tyranosaurus.stl> <рабочая папка> [граней]
# Шаги: чтение бинарного STL → сварка вершин → оси игры (x вперёд, y вверх, z вправо) → упрощение (tools/decimate.js, зубы сохраняются) →
# признаки (зубы, когти, пасть, полости) → скелет и веса (тепловая диффузия, как в trike_rig.py) → нижняя челюсть на своей кости → game/rex.js.
import numpy as np, sys, os, json, base64, subprocess
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import splu
from scipy.spatial import cKDTree

stl, wd = sys.argv[1], sys.argv[2]; TARGET = int(sys.argv[3]) if len(sys.argv) > 3 else 40000
os.makedirs(wd, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))

# ------------------------------------------------------------------ 1. чтение и подготовка сетки
if not os.path.exists(os.path.join(wd, 'D.bin')):
    raw = open(stl, 'rb').read(); nt = int.from_bytes(raw[80:84], 'little')
    dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    T = np.frombuffer(raw, dtype=dt, count=nt, offset=84)['v'].reshape(-1, 3).astype(np.float64)
    key = np.round(T * 1e4).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    V0 = T[first]; F0 = inv.reshape(-1, 3)
    F0 = F0[(F0[:, 0] != F0[:, 1]) & (F0[:, 1] != F0[:, 2]) & (F0[:, 0] != F0[:, 2])]
    G = np.stack([-V0[:, 0], V0[:, 2], V0[:, 1]], 1)            # det +1: голова к +x, y вверх, z вправо
    G[:, 2] -= 0.0
    G.astype(np.float32).tofile(os.path.join(wd, 'G.bin')); F0.astype(np.int32).tofile(os.path.join(wd, 'F.bin'))
    subprocess.check_call(['node', os.path.join(here, 'decimate.js'), os.path.join(wd, 'G.bin'), os.path.join(wd, 'F.bin'), os.path.join(wd, 'D.bin'), os.path.join(wd, 'DF.bin'), str(TARGET)])
V = np.fromfile(os.path.join(wd, 'D.bin'), dtype=np.float32).reshape(-1, 3).astype(np.float64)
F = np.fromfile(os.path.join(wd, 'DF.bin'), dtype=np.int32).reshape(-1, 3).astype(np.int64)
# подошвы — на уровень земли
V[:, 1] -= V[:, 1].min(); V[:, 2] -= 0.0
n = len(V); print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
assert n < 65536

# ------------------------------------------------------------------ 2. соседи, нормали, кривизна, «толщина»
I = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]); J = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
A = coo_matrix((np.ones(len(I)), (I, J)), shape=(n, n)).tocsr(); A.data[:] = 1; deg = np.asarray(A.sum(1)).ravel()
fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); N = np.zeros((n, 3))
for k in range(3): np.add.at(N, F[:, k], fn)
N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
el = np.asarray(coo_matrix((np.linalg.norm(V[I] - V[J], axis=1), (I, J)), shape=(n, n)).tocsr().multiply(A).sum(1)).ravel() / deg
Hc = -(((A @ V) / deg[:, None] - V) * N).sum(1) / el            # > 0 выпуклость, < 0 впадина
tree = cKDTree(V); nb = tree.query_ball_point(V, 0.22); th = np.full(n, 9.0)
for i, l in enumerate(nb):
    d = V[l] - V[i]; r = np.linalg.norm(d, axis=1); s = (r > 1e-6) & ((d @ N[i]) / np.maximum(r, 1e-9) < -0.75)
    if s.any(): th[i] = r[s].min()
x, y, z = V.T

# ------------------------------------------------------------------ 3. пасть: линия раздела челюстей, зубы, нёбо, язык
ycut = np.clip(5.56 - (x - 4.8) * 0.31, 4.9, 5.6); d = y - ycut
up = (x > 5.7) & (d > -0.05) & (d < 0.5) & (th < 0.12)
lo = (x > 5.35) & (d < 0.08) & (d > -0.33) & (th < 0.12)
tw = np.zeros(n); tw[up] = 1 - 0.8 * sstep(0.0, 0.45, d[up]); tw[lo] = 0.2 + 0.8 * sstep(-0.33, -0.05, d[lo])
for _ in range(1): tw = np.maximum(tw, 0.0)
teeth = tw > 0
# внутренняя поверхность пасти: нормаль смотрит на ось рта
axis_d = np.stack([np.zeros(n), ycut - y, -z], 1); ad = np.linalg.norm(axis_d, axis=1)
facing = (N * axis_d).sum(1) / np.maximum(ad, 1e-9)
mouth = (x > 5.3) & (x < 6.85) & (ad < 0.75) & (facing > 0.35) & (~teeth) & (np.abs(d) < 0.7)
# когти: тонкие кончики пальцев ног и рук
claw = (th < 0.2) & (((y < 0.8) & (x > 0.95) & (np.abs(z) > 0.1)) | ((x > 3.75) & (y > 3.0) & (y < 3.8) & (np.abs(z) > 0.3)))
# полости (глазницы, складки): тёмные впадины
ao = np.clip(1 + 5 * np.minimum(Hc, 0), 0.45, 1)
for _ in range(2): ao = (A @ ao + ao) / (deg + 1)
ao[mouth] *= 0.6
# ------------------------------------------------------------------ 4. скелет (единицы модели; x вперёд, y вверх, z вправо)
B = [('root', None, (0.55, 3.8, 0)),
     ('tail0', 'root', (-0.7, 3.7, 0)), ('tail1', 'tail0', (-1.9, 3.55, 0)), ('tail2', 'tail1', (-3.1, 3.5, 0)), ('tail3', 'tail2', (-4.3, 3.65, 0)), ('tail4', 'tail3', (-5.4, 3.75, 0)), ('tail5', 'tail4', (-6.3, 3.6, 0)),
     ('chest', 'root', (2.3, 4.15, 0)), ('neck0', 'chest', (3.15, 4.45, 0)), ('neck1', 'neck0', (3.75, 4.8, 0)), ('head', 'neck1', (4.35, 5.15, 0)), ('jaw', 'head', (4.8, 5.3, 0))]
LEG = lambda s: [('thigh' + s, 'root', (0.55, 3.7, 1.0 * (1 if s == 'R' else -1))), ('shin' + s, 'thigh' + s, (1.55, 2.5, 1.05 * (1 if s == 'R' else -1))),
                 ('ankle' + s, 'shin' + s, (0.4, 1.15, 0.95 * (1 if s == 'R' else -1))), ('foot' + s, 'ankle' + s, (0.8, 0.2, 1.0 * (1 if s == 'R' else -1)))]
ARM = lambda s: [('upper' + s, 'chest', (3.5, 3.95, 0.62 * (1 if s == 'R' else -1))), ('fore' + s, 'upper' + s, (3.55, 3.45, 0.7 * (1 if s == 'R' else -1))),
                 ('hand' + s, 'fore' + s, (3.85, 3.4, 0.74 * (1 if s == 'R' else -1)))]
B += LEG('R') + LEG('L') + ARM('R') + ARM('L')
names = [b[0] for b in B]; par = [names.index(b[1]) if b[1] else -1 for b in B]; pos = np.array([b[2] for b in B], float); nb_ = len(B)
TIPS = {'tail5': (-6.95, 3.3, 0), 'head': (6.9, 5.45, 0), 'jaw': (6.75, 4.6, 0), 'footR': (1.95, 0.05, 1.05), 'footL': (1.95, 0.05, -1.05), 'handR': (4.35, 3.28, 0.76), 'handL': (4.35, 3.28, -0.76), 'chest': (2.9, 4.3, 0), 'root': (1.4, 3.9, 0)}
seg_a = pos.copy(); seg_b = np.zeros_like(pos)
for i, nm in enumerate(names):
    ch = [k for k in range(nb_) if par[k] == i]
    seg_b[i] = TIPS[nm] if nm in TIPS else pos[ch[0]]
seg_b[names.index('neck0')] = pos[names.index('neck1')]; seg_b[names.index('neck1')] = pos[names.index('head')]
seg_a[names.index('jaw')] = np.array([4.8, 5.0, 0])
rad = {'root': 1.0, 'chest': 1.0, 'neck0': 0.6, 'neck1': 0.6, 'head': 1.0, 'jaw': 0.5}


def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


Dm = np.stack([seg_dist(V, seg_a[i], seg_b[i]) for i in range(nb_)], 1)
LEGB = {s: [names.index(k + s) for k in ('thigh', 'shin', 'ankle', 'foot')] for s in 'RL'}
ARMB = {s: [names.index(k + s) for k in ('upper', 'fore', 'hand')] for s in 'RL'}
zone = {}
for s, sg in (('R', 1), ('L', -1)):
    side = z * sg > 0.25
    # нога: ступни целиком, выше — вокруг оси бедро-колено-лодыжка
    dl = np.minimum.reduce([seg_dist(V, pos[names.index('thigh' + s)], pos[names.index('shin' + s)]), seg_dist(V, pos[names.index('shin' + s)], pos[names.index('ankle' + s)]),
                            seg_dist(V, pos[names.index('ankle' + s)], pos[names.index('foot' + s)])])
    zone['leg' + s] = (side & (((y < 3.0) & (dl < 0.8) & (x > -0.9)) | ((y >= 3.0) & (dl < 0.75) & (x > -0.6) & (x < 1.8))) | ((y < 0.6) & (x > -0.2) & (x < 2.1) & (z * sg > 0.02)))
    da = np.minimum.reduce([seg_dist(V, pos[names.index('upper' + s)], pos[names.index('fore' + s)]), seg_dist(V, pos[names.index('fore' + s)], pos[names.index('hand' + s)]),
                            seg_dist(V, pos[names.index('hand' + s)], np.array(TIPS['hand' + s]))])
    zone['arm' + s] = side & (da < 0.42) & (x > 2.9) & (y < 4.35)
for s in 'RL':
    for i in LEGB[s]: Dm[~zone['leg' + s], i] = np.inf
    for i in ARMB[s]: Dm[~zone['arm' + s], i] = np.inf
body = [i for i in range(nb_) if not any(i in LEGB[s] + ARMB[s] for s in 'RL')]
low = (zone['legR'] | zone['legL'] | zone['armR'] | zone['armL']) & (y < 2.6)
Dm[np.ix_(low, body)] = np.inf
jawI = names.index('jaw'); Dm[:, jawI] = np.inf
near = np.argmin(Dm, 1); dmin = Dm[np.arange(n), near]
# верх таза/живот между ногами — к телу; всё, что не попало ни в одну зону, и так в теле
# котангенсный лапласиан + масса
def cot(a, b, c):
    u, v = a - c, b - c; cr = np.linalg.norm(np.cross(u, v), axis=1); return (u * v).sum(1) / np.maximum(cr, 1e-12)
Il, Jl, Wl = [], [], []
for (a, b, c) in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
    w = 0.5 * np.clip(cot(V[F[:, a]], V[F[:, b]], V[F[:, c]]), -5, 50); Il += [F[:, a], F[:, b]]; Jl += [F[:, b], F[:, a]]; Wl += [w, w]
Il = np.concatenate(Il); Jl = np.concatenate(Jl); Wl = np.nan_to_num(np.concatenate(Wl))
Wm = coo_matrix((Wl, (Il, Jl)), shape=(n, n)).tocsr(); Lp = diags(np.asarray(Wm.sum(1)).ravel()) - Wm
area = 0.5 * np.linalg.norm(fn, axis=1); M = np.zeros(n)
for k in range(3): np.add.at(M, F[:, k], area / 3)
Hd = 1.0 / np.maximum(dmin, 0.08) ** 2
print("nan", np.isnan(Wl).sum(), np.isinf(dmin).sum(), np.isnan(M).sum(), (M<=0).sum(), np.isnan(Hd).sum())
M = np.maximum(M, 1e-5); Hd = 1.0 / np.maximum(dmin, 0.08) ** 2
lu = splu((Lp + diags(M * Hd + 1e-7)).tocsc()); Wt = np.zeros((n, nb_))
for i in range(nb_):
    p = (near == i).astype(float)
    if p.sum() == 0: continue
    Wt[:, i] = lu.solve(M * Hd * p)
Wt = np.clip(Wt, 0, None)
for s in 'RL':
    for i in LEGB[s]: Wt[~zone['leg' + s], i] = 0
    for i in ARMB[s]: Wt[~zone['arm' + s], i] = 0
Wt[np.ix_(low, body)] = 0
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
# ступня: всё, что ниже щиколотки, — на кости ступни/пальцев (жёстко), пальцы — своя кость
for s, sg in (('R', 1), ('L', -1)):
    fz = zone['leg' + s] & (y < 1.0)
    ia, ib = names.index('ankle' + s), names.index('foot' + s)
    toe = fz & (x > 0.85) & (y < 0.55)
    Wt[fz, :] = 0; Wt[fz, ia] = 1
    Wt[toe, ia] = 1 - sstep(0.7, 1.05, x[toe]); Wt[toe, ib] = sstep(0.7, 1.05, x[toe])
# сглаживание по соседям (кожа тянется без разрывов); ступни не трогаем
fixed = (y < 0.9)
for _ in range(8):
    Ws = (A @ Wt + Wt) / (deg + 1)[:, None]; Wt[~fixed] = Ws[~fixed]
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
# нижняя челюсть: ниже линии рта и впереди шарнира; плавный переход к голове
jf = sstep(4.35, 5.35, x) * (1 - sstep(-0.06, 0.06, d)) * (x < 7)
# верхняя часть щеки у шарнира остаётся на голове (линия идёт от уголка рта вниз вперёд)
Wt *= (1 - jf)[:, None]; Wt[:, jawI] = jf
# голова и шея: всё впереди x=4.2 без рук/челюсти уже на голове по диффузии; зубы — на своей кости
idx = np.argsort(-Wt, 1)[:, :4]; w4 = np.take_along_axis(Wt, idx, 1); w4[w4 < 0.02] = 0; w4 /= w4.sum(1, keepdims=True)
print('кости', nb_, '| без весов', int((Wt.sum(1) < 0.5).sum()))
for nm in ('thighR', 'shinR', 'ankleR', 'footR', 'upperR', 'handR', 'head', 'jaw', 'tail5', 'chest', 'neck0'):
    i = names.index(nm); print('  %-7s > 0.5: %d' % (nm, int((Wt[:, i] > 0.5).sum())))

# ------------------------------------------------------------------ 5. опорные точки
lm = {'eye': [5.62, 5.98, 0.38], 'eyeDir': [0.18, 0.22, 0.96], 'hat': [4.95, 6.3, 0], 'neck': [3.4, 4.7, 0], 'hinge': [4.8, 5.3, 0], 'mouth': [6.5, 5.0, 0]}
# ------------------------------------------------------------------ 6. запись game/rex.js
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 1000
reg = np.zeros(n, np.uint8); reg[mouth] = 3; reg[teeth] = 1; reg[claw] = 2
clawg = np.zeros(n); clawg[claw] = 1
grad = np.where(teeth, tw, 0.0)
obj = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'f': b64(F.astype(np.uint16)), 'r': b64(reg), 'g': b64(np.round(grad * 255).astype(np.uint8)), 'ao': b64(np.round(ao * 255).astype(np.uint8)),
       'si': b64(idx.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
       'bones': [[nm, int(p_), [round(float(c), 3) for c in q]] for nm, p_, q in zip(names, par, pos)], 'tips': {k: list(map(float, v)) for k, v in TIPS.items()}, 'lm': lm}
src = '// Модель хищника (тираннозавр): подготовлена из STL скриптом tools/rex_bake.py. Не редактировать.\nexport const REX = ' + json.dumps(obj, separators=(',', ':')) + ';\n'
out = os.path.join(here, '..', 'game', 'rex.js'); open(out, 'w').write(src)
np.save(os.path.join(wd, 'rexV.npy'), V)
(np.stack([ao, ao, ao], 1) * 0 + np.where(teeth[:, None], [1, 0.95, 0.8], np.where(mouth[:, None], [0.6, 0.2, 0.25], np.where(claw[:, None], [0.2, 0.15, 0.1], [0.6, 0.62, 0.55])))).astype(np.float32).tofile(os.path.join(wd, 'cls.bin'))
print('game/rex.js: %d КБ' % (len(src) // 1024))

# Стегозавр: сетка (tools/steg_prep.py → D.bin/DF.bin) + скелет и веса (тепловая диффузия) + метки областей → game/steg.js.
# Запуск: python3 tools/steg_bake.py <рабочая папка> game/steg.js
# Скелет осевой (повороты в покое — тождественные): корпус, грудь, шея (2) + голова, хвост (5), у каждой из 4 ног: бедро, голень, стопа.
import numpy as np, sys, os, json, base64
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import splu
from scipy.spatial import cKDTree
wd, out = sys.argv[1], sys.argv[2]
V = np.fromfile(os.path.join(wd, 'D.bin'), dtype=np.float32).reshape(-1, 3).astype(np.float64)
F = np.fromfile(os.path.join(wd, 'DF.bin'), dtype=np.int32).reshape(-1, 3).astype(np.int64)
n = len(V); assert n < 65536
x, y, z = V.T
sstep = lambda a, b, t: (lambda u: u * u * (3 - 2 * u))(np.clip((t - a) / (b - a), 0, 1))

# ------------------------------------------------------------------ скелет
FOOT = {'HR': (-11.1, 17.3), 'HL': (-9.3, -17.4), 'FR': (28.4, 15.7), 'FL': (21.1, -15.8)}
B = [('root', None, (-6, 52, 0)), ('chest', 'root', (24, 54, 0)), ('neck0', 'chest', (40, 54, 0)), ('neck1', 'neck0', (50, 44, 0)), ('head', 'neck1', (58, 34, 0)),
     ('tail0', 'root', (-22, 45, 0)), ('tail1', 'tail0', (-38, 41, 0)), ('tail2', 'tail1', (-54, 40, 0)), ('tail3', 'tail2', (-70, 37, 0)), ('tail4', 'tail3', (-84, 37, 0))]
for k, (fx, fz) in FOOT.items():
    par = 'root' if k[0] == 'H' else 'chest'
    B += [('th' + k, par, (fx, 44, fz * 0.92)), ('sh' + k, 'th' + k, (fx + 0.5, 24, fz)), ('ft' + k, 'sh' + k, (fx, 9, fz))]
names = [b[0] for b in B]; par = [names.index(b[1]) if b[1] else -1 for b in B]; pos = np.array([b[2] for b in B], float); nb = len(B)
TIPS = {'head': (76, 23, 0), 'tail4': (-95, 38, 0), 'chest': (40, 54, 0), 'root': (24, 54, 0)}
for k, (fx, fz) in FOOT.items(): TIPS['ft' + k] = (fx + 6, 1, fz)
seg_a = pos.copy(); seg_b = np.zeros_like(pos)
for i, nm in enumerate(names):
    if nm in TIPS: seg_b[i] = TIPS[nm]
    else:
        ch = [j for j in range(nb) if par[j] == i and not names[j].startswith(('th', 'tail0'))]
        seg_b[i] = pos[ch[0]] if ch else pos[i] + (1, 0, 0)
seg_b[names.index('root')] = pos[names.index('chest')]; seg_a[names.index('chest')] = pos[names.index('chest')]
seg_b[names.index('chest')] = pos[names.index('neck0')]
def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1); return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
Dm = np.stack([seg_dist(V, seg_a[i], seg_b[i]) for i in range(nb)], 1)
LEG = {k: [names.index(p + k) for p in ('th', 'sh', 'ft')] for k in FOOT}
zone = {}
for k, (fx, fz) in FOOT.items():
    r = np.hypot(x - fx, z - fz); zone[k] = (r < 12.5) & (y < 40) & (np.abs(z - fz) < 10.5)
    for i in LEG[k]: Dm[~zone[k], i] = np.inf
legall = [i for k in FOOT for i in LEG[k]]; body = [i for i in range(nb) if i not in legall]
anyz = np.zeros(n, bool)
for k in FOOT: anyz |= zone[k]
low = anyz & (y < 21); Dm[np.ix_(low, body)] = np.inf
near = np.argmin(Dm, 1); dmin = Dm[np.arange(n), near]

def cot(a, b, c):
    u, v = a - c, b - c; cr = np.linalg.norm(np.cross(u, v), axis=1); return (u * v).sum(1) / np.maximum(cr, 1e-12)
I, J, W = [], [], []
for (a, b, c) in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
    w = 0.5 * np.clip(cot(V[F[:, a]], V[F[:, b]], V[F[:, c]]), -5, 50); I += [F[:, a], F[:, b]]; J += [F[:, b], F[:, a]]; W += [w, w]
I = np.concatenate(I); J = np.concatenate(J); W = np.concatenate(W)
Wm = coo_matrix((W, (I, J)), shape=(n, n)).tocsr(); Aadj = coo_matrix((np.ones(len(I)), (I, J)), shape=(n, n)).tocsr(); Aadj.data[:] = 1; deg = np.asarray(Aadj.sum(1)).ravel()
L = diags(np.asarray(Wm.sum(1)).ravel()) - Wm
area = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
M = np.zeros(n); [np.add.at(M, F[:, k], area / 3) for k in range(3)]
Hd = 1.0 / np.maximum(dmin, 1.0) ** 2
lu = splu((L + diags(M * Hd)).tocsc()); Wt = np.zeros((n, nb))
for i in range(nb):
    p = (near == i).astype(float)
    if p.sum() == 0: continue
    Wt[:, i] = lu.solve(M * Hd * p)
Wt = np.clip(Wt, 0, None)
for k in FOOT:
    for i in LEG[k]: Wt[~zone[k], i] = 0
Wt[np.ix_(low, body)] = 0
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
fixed = y < 6
for _ in range(8):
    Ws = (Aadj @ Wt + Wt) / (deg + 1)[:, None]; Wt[~fixed] = Ws[~fixed]
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
idx = np.argsort(-Wt, 1)[:, :4]; w4 = np.take_along_axis(Wt, idx, 1); w4[w4 < 0.02] = 0; w4 /= w4.sum(1, keepdims=True)
print('кости', nb, '| без весов:', int((Wt.sum(1) < 0.5).sum()))
for nm in ('thHR', 'shHR', 'ftHR', 'thFL', 'ftFL', 'head', 'neck1', 'tail4', 'tail2', 'chest', 'root'):
    print('  %-6s %d' % (nm, int((Wt[:, names.index(nm)] > 0.5).sum())))

# ------------------------------------------------------------------ нормали, «толщина», кривизна, области
fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); N = np.zeros((n, 3))
for k in range(3): np.add.at(N, F[:, k], fn)
N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
el = np.asarray(coo_matrix((np.linalg.norm(V[I] - V[J], axis=1), (I, J)), shape=(n, n)).tocsr().multiply(Aadj).sum(1)).ravel() / deg
Hc = -(((Aadj @ V) / deg[:, None] - V) * N).sum(1) / el
tree = cKDTree(V); nbh = tree.query_ball_point(V, 6.0); th = np.full(n, 9.0)
for i, l in enumerate(nbh):
    d = V[l] - V[i]; r = np.linalg.norm(d, axis=1); s = (r > 1e-6) & ((d @ N[i]) / np.maximum(r, 1e-9) < -0.75)
    if s.any(): th[i] = r[s].min()
reg = np.zeros(n, np.uint8)                       # 0 кожа, 1 пластина, 2 шип хвоста / рог, 3 коготь
plate = (th < 5.5) & (y > 56) & (np.abs(z) < 24) & (x > -48) & (x < 44) & (np.abs(N[:, 1]) < 0.85)
reg[plate] = 1
spike = (th < 3.2) & (x < -76) & (y > 36)
reg[spike] = 2
claw = (y < 5) & (th < 3.0); reg[claw] = 3
# AO: по кривизне (впадины темнее) и по «закрытости» снизу
ao = np.clip(0.9 + 3.2 * Hc, 0.45, 1.25); ao *= 0.78 + 0.22 * sstep(2, 40, y)
print('пластины', int(plate.sum()), 'шипы', int(spike.sum()), 'когти', int(claw.sum()))
S = 300.0; assert np.abs(V).max() * S < 32000
b64 = lambda a: base64.b64encode(a.tobytes()).decode()
js = {'s': S, 'v': b64(np.round(V * S).astype(np.int16)), 'f': b64(F.astype(np.uint16)), 'si': b64(idx.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
      'r': b64(reg), 'ao': b64(np.round(np.clip(ao, 0, 2) * 127).astype(np.uint8)), 'par': par, 'names': names, 'pos': np.round(pos, 2).tolist(), 'tips': {k: list(map(float, v)) for k, v in TIPS.items()}}
np.savez(os.path.join(wd, 'dbg.npz'), V=V, F=F, reg=reg, ao=ao, W=Wt, names=np.array(names))
open(out, 'w').write('// Стегозавр: сетка из STL (Thingiverse «Stegosaurus II», CC0), скелет и веса подготовлены tools/steg_prep.py → tools/steg_bake.py. Не редактировать.\nexport const STEG = ' + json.dumps(js) + ';\n')
print('записано', out, round(os.path.getsize(out) / 1024), 'КБ')

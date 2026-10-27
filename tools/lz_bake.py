# Четвероногие сканы-STL (Komodo, Dimetrodon, Gorgonopsid): сетка (tools/lz_prep.py → D.bin/DF.bin) + скелет + веса (тепловая диффузия) + метки областей → game/<ключ>.js.
# Кости как у стегозавра (root, chest, neck0, neck1, head, tail0–4, у ноги th/sh/ft ×HR,FR,HL,FL), поэтому рантайм общий. Запуск: python3 tools/lz_bake.py <ключ> <рабочая папка> <out.js> <ИМЯ>
import numpy as np, sys, os, json, base64
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import splu
from scipy.spatial import cKDTree
key, wd, out, EXPORT = sys.argv[1:5]
V = np.fromfile(os.path.join(wd, 'D.bin'), dtype=np.float32).reshape(-1, 3).astype(np.float64)
F = np.fromfile(os.path.join(wd, 'DF.bin'), dtype=np.int32).reshape(-1, 3).astype(np.int64)
n = len(V); assert n < 65536
x, y, z = V.T
sstep = lambda a, b, t: (lambda u: u * u * (3 - 2 * u))(np.clip((t - a) / (b - a), 0, 1))
CFG = {
 'dim': dict(
   spine={'root': (-100, 16, 0), 'chest': (-62, 22, 0), 'neck0': (-45, 28, 0), 'neck1': (-32, 33, 0), 'head': (-20, 36, 0),
          'tail0': (-125, 16, 0), 'tail1': (-142, 13, 0), 'tail2': (-158, 10, 0), 'tail3': (-172, 6, 0), 'tail4': (-183, 3, 0)},
   legs={'FR': [(-52, 19, -7), (-52, 10, -17), (-50, 3, -27), (-40, 1, -31)], 'FL': [(-50, 19, 7), (-50, 10, 17), (-46, 3, 28), (-36, 1, 32)],
         'HR': [(-100, 19, -12), (-100, 11, -22), (-98, 4, -26), (-96, 1, -29)], 'HL': [(-100, 19, 12), (-100, 11, 25), (-98, 4, 32), (-95, 1, 37)]},
   tips={'head': (0.5, 30, 0), 'tail4': (-189, 2, 0)}, zr=11, zlat=9, claw_y=3.2, claw_th=2.2, sail=dict(xr=(-123, -50), y0=26, zmax=7)),
 'kom': dict(
   spine={'root': (-100, 25, 0), 'chest': (-55, 28, 0), 'neck0': (-38, 30, 0), 'neck1': (-26, 34, 0), 'head': (-16, 35, 0),
          'tail0': (-125, 16, 0), 'tail1': (-158, 10, 0), 'tail2': (-182, 8, 0), 'tail3': (-208, 6.5, 0), 'tail4': (-230, 5, 0)},
   legs={'FR': [(-52, 19, -15), (-58, 9, -23), (-49, 2, -31), (-40, 1, -32)], 'FL': [(-50, 19, 14), (-46, 10, 21), (-35, 2, 23), (-25, 1, 24)],
         'HR': [(-107, 18, -15), (-109, 12, -27), (-108, 3, -40), (-108, 1, -48)], 'HL': [(-109, 18, 14), (-116, 9, 20), (-117, 2, 29), (-118, 1, 36)]},
   tips={'head': (3.5, 33, 0), 'tail4': (-247, 4, 0)}, zr=9.5, zlat=12, claw_y=3.2, claw_th=1.7),
}
C = CFG[key]; SP = C['spine']
B = [('root', None, SP['root']), ('chest', 'root', SP['chest']), ('neck0', 'chest', SP['neck0']), ('neck1', 'neck0', SP['neck1']), ('head', 'neck1', SP['head']),
     ('tail0', 'root', SP['tail0']), ('tail1', 'tail0', SP['tail1']), ('tail2', 'tail1', SP['tail2']), ('tail3', 'tail2', SP['tail3']), ('tail4', 'tail3', SP['tail4'])]
for k, L in C['legs'].items():
    par_ = 'root' if k[0] == 'H' else 'chest'
    B += [('th' + k, par_, L[0]), ('sh' + k, 'th' + k, L[1]), ('ft' + k, 'sh' + k, L[2])]
names = [b[0] for b in B]; par = [names.index(b[1]) if b[1] else -1 for b in B]; pos = np.array([b[2] for b in B], float); nb = len(B)
TIPS = dict(C['tips']); TIPS['chest'] = SP['neck0']; TIPS['root'] = SP['chest']
for k, L in C['legs'].items(): TIPS['ft' + k] = L[3]
seg_a = pos.copy(); seg_b = np.zeros_like(pos)
for i, nm in enumerate(names):
    if nm in TIPS: seg_b[i] = TIPS[nm]
    else:
        ch = [j for j in range(nb) if par[j] == i and not names[j].startswith(('th', 'tail0'))]
        seg_b[i] = pos[ch[0]] if ch else pos[i] + (1, 0, 0)
seg_b[names.index('root')] = pos[names.index('chest')]
def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1); return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
Dm = np.stack([seg_dist(V, seg_a[i], seg_b[i]) for i in range(nb)], 1)
LEG = {k: [names.index(p + k) for p in ('th', 'sh', 'ft')] for k in C['legs']}
zone = {}
for k, L in C['legs'].items():
    sg = 1 if L[2][2] > 0 else -1
    dl = np.minimum.reduce([seg_dist(V, np.array(L[i]), np.array(L[i + 1])) for i in range(3)])
    zone[k] = (dl < C['zr']) & (np.abs(z) >= C['zlat']) & (z * sg > 0)
    for i in LEG[k]: Dm[~zone[k], i] = np.inf
legall = [i for k in C['legs'] for i in LEG[k]]; body = [i for i in range(nb) if i not in legall]
anyz = np.zeros(n, bool)
for k in C['legs']: anyz |= zone[k]
low = anyz & (y < 12); Dm[np.ix_(low, body)] = np.inf       # нижняя часть лап (стопа) — только костями ноги
near = np.argmin(Dm, 1); dmin = Dm[np.arange(n), near]
def cot(a, b, c):
    u, v = a - c, b - c; cr = np.linalg.norm(np.cross(u, v), axis=1); return (u * v).sum(1) / np.maximum(cr, 1e-12)
I, J, W = [], [], []
for (a, b, c) in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
    w = 0.5 * np.clip(cot(V[F[:, a]], V[F[:, b]], V[F[:, c]]), -5, 50); I += [F[:, a], F[:, b]]; J += [F[:, b], F[:, a]]; W += [w, w]
I = np.concatenate(I); J = np.concatenate(J); W = np.concatenate(W)
Wm = coo_matrix((W, (I, J)), shape=(n, n)).tocsr(); Aadj = coo_matrix((np.ones(len(I)), (I, J)), shape=(n, n)).tocsr(); Aadj.data[:] = 1; deg = np.asarray(Aadj.sum(1)).ravel()
L_ = diags(np.asarray(Wm.sum(1)).ravel()) - Wm
area = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
M = np.zeros(n); [np.add.at(M, F[:, k], area / 3) for k in range(3)]
Hd = 1.0 / np.maximum(dmin, 1.0) ** 2
lu = splu((L_ + diags(M * Hd)).tocsc()); Wt = np.zeros((n, nb))
for i in range(nb):
    p = (near == i).astype(float)
    if p.sum() == 0: continue
    Wt[:, i] = lu.solve(M * Hd * p)
Wt = np.clip(Wt, 0, None)
for k in C['legs']:
    for i in LEG[k]: Wt[~zone[k], i] = 0
Wt[np.ix_(low, body)] = 0
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
fixed = y < 3.5
for _ in range(6):
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
tree = cKDTree(V); nbh = tree.query_ball_point(V, 4.0); th = np.full(n, 9.0)
for i, l in enumerate(nbh):
    d = V[l] - V[i]; r = np.linalg.norm(d, axis=1); s = (r > 1e-6) & ((d @ N[i]) / np.maximum(r, 1e-9) < -0.75)
    if s.any(): th[i] = r[s].min()
reg = np.zeros(n, np.uint8)                       # 0 кожа, 1 парус/пластина, 2 шип/рог, 3 коготь
reg[(y < C['claw_y']) & (th < C['claw_th']) & anyz] = 3
if 'sail' in C:
    s_ = C['sail']; reg[(y > s_['y0']) & (np.abs(z) < s_['zmax']) & (x > s_['xr'][0]) & (x < s_['xr'][1])] = 1
ao = np.clip(0.9 + 3.2 * Hc, 0.45, 1.25); ao *= 0.78 + 0.22 * sstep(2, 30, y)
print('когти', int((reg == 3).sum()))
S = float(min(300.0, np.floor(31000 / np.abs(V).max()))); assert np.abs(V).max() * S < 32000
b64 = lambda a: base64.b64encode(a.tobytes()).decode()
js = {'s': S, 'v': b64(np.round(V * S).astype(np.int16)), 'f': b64(F.astype(np.uint16)), 'si': b64(idx.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
      'r': b64(reg), 'ao': b64(np.round(np.clip(ao, 0, 2) * 127).astype(np.uint8)), 'par': par, 'names': names, 'pos': np.round(pos, 2).tolist(), 'tips': {k: list(map(float, v)) for k, v in TIPS.items()}}
np.savez(os.path.join(wd, 'dbg.npz'), V=V, F=F, reg=reg, ao=ao, W=Wt, names=np.array(names))
open(out, 'w').write('// Сетка из STL-скана, скелет и веса подготовлены tools/lz_prep.py → tools/lz_bake.py. Не редактировать.\nexport const %s = ' % EXPORT + json.dumps(js, separators=(',', ':')) + ';\n')
print('записано', out, round(os.path.getsize(out) / 1024), 'КБ')

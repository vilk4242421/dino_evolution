# Скелет трицератопса и веса вершин (тепловая диффузия, как в Pinocchio: (L + M·H)·w = M·H·p).
# Работает на половине сетки (правая сторона, z ≥ 0); левые ноги в игре — зеркальные кости.
# Вход: <dir>/H.npy, HF.npy, REGH.npy, UVH.npz.   Выход: <dir>/rig.npz (кости, веса для вершин UVH).
# Запуск: python3 tools/trike_rig.py <dir>
import numpy as np, sys, os, json
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import splu

d = sys.argv[1]
H = np.load(os.path.join(d, 'H.npy')); F = np.load(os.path.join(d, 'HF.npy')).astype(np.int64); reg = np.load(os.path.join(d, 'REGH.npy'))
U = np.load(os.path.join(d, 'UVH.npz')); orig = U['orig']
n = len(H)

# ------------------------------------------------------------------ кости (единицы модели; x вперёд, y вверх, z вправо)
# name, parent, позиция; хвост и шея идут цепочками от корня
B = [('root', None, (-20, 42, 0)),
     ('tail0', 'root', (-44, 41, 0)), ('tail1', 'tail0', (-64, 37, 0)), ('tail2', 'tail1', (-84, 32, 0)), ('tail3', 'tail2', (-104, 27, 0)), ('tail4', 'tail3', (-121, 23, 0)),
     ('chest', 'root', (2, 36, 0)),
     ('neck0', 'root', (10, 44, 0)), ('neck1', 'neck0', (22, 43, 0)), ('head', 'neck1', (31, 40, 0)),
     ('thighR', 'root', (-41, 40, 16)), ('shinR', 'thighR', (-43, 26, 18)), ('ankleR', 'shinR', (-45, 12, 19)), ('footR', 'ankleR', (-46, 3.5, 19.5)),
     ('upperR', 'root', (20, 40, 17)), ('foreR', 'upperR', (19.5, 26, 17.5)), ('wristR', 'foreR', (18.5, 12, 17.5)), ('handR', 'wristR', (18, 3.5, 17.5))]
TIPS = {'tail4': (-132, 20, 0), 'head': (64, 37, 0), 'footR': (-37, 1, 21), 'handR': (27, 1, 18), 'chest': (2, 20, 0)}
names = [b[0] for b in B]; par = [names.index(b[1]) if b[1] else -1 for b in B]; pos = np.array([b[2] for b in B], float)
nb = len(B)
seg_a = pos.copy(); seg_b = np.array([TIPS[nm] if nm in TIPS else pos[[k for k in range(nb) if par[k] == i][0]] for i, nm in enumerate(names)], float)
# у корня и шеи несколько детей — отрезок к «главному» ребёнку
for i, nm in enumerate(names):
    if nm == 'root': seg_b[i] = pos[names.index('tail0')] * 0.0 + np.array([10, 44, 0])
    if nm == 'neck0': seg_b[i] = pos[names.index('neck1')]


def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


Dm = np.stack([seg_dist(H, seg_a[i], seg_b[i]) for i in range(nb)], 1)
# ограничения: кости ног — только для вершин ног; кости тела — не для низа ног
LEGB = {'R': [names.index(k) for k in ('thighR', 'shinR', 'ankleR', 'footR')], 'F': [names.index(k) for k in ('upperR', 'foreR', 'wristR', 'handR')]}
leg_zone = {}
for key, hip, foot in (('R', (-41, 16), (-46, 19.5)), ('F', (20, 17), (18, 17.5))):
    t = np.clip(H[:, 1] / 40.0, 0, 1)
    ax = np.array(foot)[None] + (np.array(hip) - np.array(foot))[None] * t[:, None]
    r = np.hypot(H[:, 0] - ax[:, 0], H[:, 2] - ax[:, 1])
    near_x = (H[:, 0] > -12) if key == 'F' else (H[:, 0] <= -12)
    # горло/грудь между ногами (z < 9) — к телу, а не к ноге; низ ноги — целиком (широкая ступня с пальцами)
    leg_zone[key] = ((r < 15) & (H[:, 1] < 34) | (r < 9) & (H[:, 1] < 40)) & ((H[:, 2] > 9) | (H[:, 1] < 13)) | near_x & (H[:, 1] < 13) & (r < 24)
for key in ('R', 'F'):
    for i in LEGB[key]: Dm[~leg_zone[key], i] = np.inf
body = [i for i in range(nb) if i not in LEGB['R'] + LEGB['F']]
low = (leg_zone['R'] | leg_zone['F']) & (H[:, 1] < 26)
Dm[np.ix_(low, body)] = np.inf
headI = names.index('head')
frill = (reg == 1) | (reg == 2)
Dm[frill] = np.inf; Dm[frill, headI] = 1.0                    # воротник целиком на голове
near = np.argmin(Dm, 1); dmin = Dm[np.arange(n), near]

# ------------------------------------------------------------------ котангенсный лапласиан и масса
def cot(a, b, c):
    u, v = a - c, b - c; cr = np.linalg.norm(np.cross(u, v), axis=1); return (u * v).sum(1) / np.maximum(cr, 1e-12)


I, J, W = [], [], []
for (a, b, c) in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
    w = 0.5 * np.clip(cot(H[F[:, a]], H[F[:, b]], H[F[:, c]]), -5, 50)
    I += [F[:, a], F[:, b]]; J += [F[:, b], F[:, a]]; W += [w, w]
I = np.concatenate(I); J = np.concatenate(J); W = np.concatenate(W)
Wm = coo_matrix((W, (I, J)), shape=(n, n)).tocsr()
A_adj = coo_matrix((np.ones(len(I)), (I, J)), shape=(n, n)).tocsr(); A_adj.data[:] = 1; deg = np.asarray(A_adj.sum(1)).ravel()
L = diags(np.asarray(Wm.sum(1)).ravel()) - Wm
area = 0.5 * np.linalg.norm(np.cross(H[F[:, 1]] - H[F[:, 0]], H[F[:, 2]] - H[F[:, 0]]), axis=1)
M = np.zeros(n); [np.add.at(M, F[:, k], area / 3) for k in range(3)]
Hd = 1.0 / np.maximum(dmin, 0.5) ** 2
A = (L + diags(M * Hd)).tocsc(); lu = splu(A)
Wt = np.zeros((n, nb))
for i in range(nb):
    p = (near == i).astype(float)
    if p.sum() == 0: continue
    Wt[:, i] = lu.solve(M * Hd * p)
Wt = np.clip(Wt, 0, None)
# зоны ног жёстко: снаружи зоны — без костей ноги, внизу ног — без костей тела
for key in ('R', 'F'):
    for i in LEGB[key]: Wt[~leg_zone[key], i] = 0
Wt[np.ix_(low, body)] = 0
Wt[frill] = 0; Wt[frill, headI] = 1
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
# сглаживание весов по соседям: на границе «нога — тело» кожа тянется плавно, без разрывов; ступни и воротник не трогаем
fixed = frill | (H[:, 1] < 8)
for _ in range(10):
    Ws = (A_adj @ Wt + Wt) / (deg + 1)[:, None]
    Wt[~fixed] = Ws[~fixed]
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
# четыре самых сильных
idx = np.argsort(-Wt, 1)[:, :4]; w4 = np.take_along_axis(Wt, idx, 1); w4[w4 < 0.02] = 0; w4 /= w4.sum(1, keepdims=True)
print('кости:', nb, '| вершин без весов:', int((Wt.sum(1) < 0.5).sum()))
for nm in ('thighR', 'shinR', 'footR', 'upperR', 'handR', 'head', 'tail4', 'chest'):
    i = names.index(nm); print('  %-7s вершин с весом > 0.5: %d' % (nm, int((Wt[:, i] > 0.5).sum())))
np.savez(os.path.join(d, 'rig.npz'), names=np.array(names), par=np.array(par), pos=pos, si=idx[orig].astype(np.uint8), sw=np.round(w4[orig] * 255).astype(np.uint8))
# опорные точки (глаз, рога, шляпа, шея) пишет tools/bake_trike.py в lm.json

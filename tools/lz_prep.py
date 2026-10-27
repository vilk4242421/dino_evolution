# Подготовка сканов-STL (Komodo, Dimetrodon, Gorgonopsid) к риггингу: сварка → «разгибание» вдоль осевой линии (голова→хвост, задана точками в плане скана) →
# оси игры (x вперёд, y вверх, z вбок) → подошвы на y=0 → упрощение (tools/decimate.js) → превью с сеткой.
# Запуск: python3 tools/lz_prep.py <ключ kom|dim|gor> <STL> <рабочая папка> [граней]
import numpy as np, sys, os, subprocess
from PIL import Image, ImageDraw
key, stl, wd = sys.argv[1:4]; TARGET = int(sys.argv[4]) if len(sys.argv) > 4 else 22000
CL = {  # осевая линия в плане скана (x, y), от носа к концу хвоста; ZUP — верх в скане (ось z)
 'dim': [(58, 36), (45, 41), (30, 44), (15, 43), (0, 40), (-15, 32), (-28, 20), (-36, 8), (-40, -5), (-45, -18), (-52, -30), (-62, -38), (-75, -42)],
 'kom': [(-70, -8), (-60, 3), (-40, 22), (-20, 40), (0, 55), (15, 57), (35, 56), (55, 53), (72, 52), (82, 58), (88, 68), (87, 82), (80, 98), (68, 108), (60, 113)],
}
PELV = {'kom': (0, 55), 'dim': (-30, 18)}; RADI = {'kom': 11, 'dim': 9}; TAIL0 = {'kom': (35, 56), 'dim': (-40, -5)}; SIG = {'kom': 9.0, 'dim': 10.0}; TZ = {'kom': 16, 'dim': 40}; KS = {'kom': 21, 'dim': 81}; HSH = {'dim': (3.2, -46, -38), 'kom': (1.5, -55, -42)}
ss_ = lambda a, b, v: (lambda t: t * t * (3 - 2 * t))(np.clip((v - a) / (b - a), 0, 1))
os.makedirs(wd, exist_ok=True); here = os.path.dirname(os.path.abspath(__file__))
raw = open(stl, 'rb').read(); nt = int.from_bytes(raw[80:84], 'little')
dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
T = np.frombuffer(raw, dtype=dt, count=nt, offset=84)['v'].reshape(-1, 3).astype(np.float64)
kk = np.round(T * 1e3).astype(np.int64); _, first, inv = np.unique(kk, axis=0, return_index=True, return_inverse=True)
V = T[first]; F = inv.reshape(-1, 3); F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
print('сварено', len(V), 'вершин', len(F), 'граней')
# осевая линия: сплайн Катмулла–Ромма + продления на концах
P = np.array(CL[key], float); P = np.vstack([P[0] - (P[1] - P[0]) / np.linalg.norm(P[1] - P[0]) * 60, P, P[-1] + (P[-1] - P[-2]) / np.linalg.norm(P[-1] - P[-2]) * 60])
def cr(p0, p1, p2, p3, t): return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
pts = []
for i in range(1, len(P) - 2):
    for t in np.linspace(0, 1, 40, endpoint=False): pts.append(cr(P[i - 1], P[i], P[i + 1], P[i + 2], t))
pts.append(P[-2]); C = np.array(pts)
from scipy.spatial import cKDTree
PEL = PELV[key]; RAD = RADI[key]
ipel = int(np.argmin(np.linalg.norm(C - np.array(PEL), axis=1)))
itail = int(np.argmin(np.linalg.norm(C - np.array(TAIL0[key]), axis=1)))
for it in range(10):                                             # осевая хвоста подстраивается под сетку (центр сечения хвоста)
    tr = cKDTree(C); d, ci = tr.query(V[:, :2]); Cn = C.copy()
    for i in range(itail, len(C)):
        m = (np.abs(ci - i) <= 5) & (d < RAD) & (V[:, 2] < TZ[key])
        if m.sum() > 12: Cn[i] = V[m, :2].mean(0)
    kw = KS[key]; k = np.ones(kw) / kw; Cs = Cn.copy()
    for ax in range(2): Cs[:, ax] = np.convolve(np.pad(Cn[:, ax], kw // 2, mode='edge'), k, mode='valid')
    rw = np.clip((np.arange(len(C)) - itail) / 45.0, 0, 1)[:, None]; rw = rw * rw * (3 - 2 * rw); C[:] = C * (1 - rw) + Cs * rw
seg = np.linalg.norm(np.diff(C, axis=0), axis=1); sarc = np.concatenate([[0], np.cumsum(seg)])
Tn = np.gradient(C, axis=0); Tn /= np.linalg.norm(Tn, axis=1, keepdims=True)
tr = cKDTree(C); d, ci = tr.query(V[:, :2])
# разгибание «линейным смешением кадров» (как скиннинг): вклад каждого кадра осевой линии убывает с расстоянием, у дальних точек (ноги) смешение шире —
# без разрывов и «веера» с внешней стороны изгиба
idx = np.arange(0, len(C), 4); Cf = C[idx]; Tf = Tn[idx]; Nf = np.stack([-Tf[:, 1], Tf[:, 0]], 1); sf = sarc[idx]
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
# опорный кадр: ближайший кадр осевой линии для точек у оси; у конечностей — кадр точки прикрепления (геодезически ближайшая вершина у оси), поэтому нога смещается как целое
anc0 = np.zeros(len(V), int); dmn = np.zeros(len(V))
for a0 in range(0, len(V), 8000):
    dd = np.linalg.norm(V[a0:a0 + 8000, None, :2] - Cf[None], axis=2); anc0[a0:a0 + 8000] = dd.argmin(1); dmn[a0:a0 + 8000] = dd.min(1)
Ei = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); El = np.linalg.norm(V[Ei[:, 0]] - V[Ei[:, 1]], axis=1)
Gr = coo_matrix((El + 1e-6, (Ei[:, 0], Ei[:, 1])), shape=(len(V), len(V))).tocsr(); Gr = Gr.maximum(Gr.T)
src = np.where(dmn < RAD * 0.9)[0]
dist_, pred_, srcv = dijkstra(Gr, directed=False, indices=src, min_only=True, return_predecessors=True)
ancV = anc0[np.where(srcv >= 0, srcv, np.arange(len(V)))]
xg = np.zeros(len(V)); lat = np.zeros(len(V))
for a0 in range(0, len(V), 8000):
    Vc = V[a0:a0 + 8000, :2]; Dv = Vc[:, None, :] - Cf[None]; dd = np.linalg.norm(Dv, axis=2); dmin = dd.min(1)
    anc = ancV[a0:a0 + 8000]
    sg = np.maximum(SIG[key], 0.45 * dmin)[:, None]; Wt = np.exp(-((sf[None] - sf[anc][:, None]) ** 2) / (2 * sg ** 2)); Wt /= Wt.sum(1, keepdims=True)
    aa = (Dv * Tf[None]).sum(2); ll = (Dv * Nf[None]).sum(2)
    xg[a0:a0 + 8000] = (Wt * -(sf[None] + aa)).sum(1); lat[a0:a0 + 8000] = (Wt * ll).sum(1)
G = np.stack([xg, V[:, 2], lat], 1); G[:, 1] -= G[:, 1].min()
if key in HSH: G[:, 2] -= HSH[key][0] * ss_(HSH[key][1], HSH[key][2], G[:, 0])
print('габариты G', G.min(0).round(1), G.max(0).round(1))
G.astype(np.float32).tofile(os.path.join(wd, 'G.bin')); F.astype(np.int32).tofile(os.path.join(wd, 'F.bin'))
subprocess.check_call(['node', os.path.join(here, 'decimate.js'), os.path.join(wd, 'G.bin'), os.path.join(wd, 'F.bin'), os.path.join(wd, 'D.bin'), os.path.join(wd, 'DF.bin'), str(TARGET)])
D = np.fromfile(os.path.join(wd, 'D.bin'), dtype=np.float32).reshape(-1, 3); print('после упрощения', len(D), 'вершин; габариты', D.min(0).round(1), D.max(0).round(1))
# превью: вид сбоку (x,y) и сверху (x,z), с сеткой по 10
def view(a, b, name, flip=False):
    Pp = D[:, [a, b]]; mn = Pp.min(0); mx = Pp.max(0); s = min(1500 / (mx[0] - mn[0]), 450 / (mx[1] - mn[1]))
    W = int((mx[0] - mn[0]) * s) + 40; H = int((mx[1] - mn[1]) * s) + 40; im = np.full((H, W, 3), 255, np.uint8)
    x = ((Pp[:, 0] - mn[0]) * s + 20).astype(int); y = (H - 20 - (Pp[:, 1] - mn[1]) * s).astype(int); im[y, x] = (30, 30, 30)
    img = Image.fromarray(im); dr = ImageDraw.Draw(img)
    for gx in np.arange(np.ceil(mn[0] / 10) * 10, mx[0], 10):
        X = (gx - mn[0]) * s + 20; dr.line([(X, 0), (X, H)], fill=(215, 215, 255)); dr.text((X + 2, 2), str(int(gx)), fill=(0, 0, 160))
    for gy in np.arange(np.ceil(mn[1] / 10) * 10, mx[1], 10):
        Y = H - 20 - (gy - mn[1]) * s; dr.line([(0, Y), (W, Y)], fill=(215, 215, 255)); dr.text((2, Y + 2), str(int(gy)), fill=(0, 0, 160))
    img.save(name)
view(0, 1, os.path.join(wd, 'side.png')); view(0, 2, os.path.join(wd, 'top.png'))

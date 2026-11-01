# Краб-питомец: статичная модель ZBrush (OBJ, ~420 тыс. граней, без скелета/UV) → game/crb.js.
# Запуск: python3 -I tools/crab_bake.py <Crab.obj> <game/crb.js> [граней=14000]
# Делает: убирает две задние «вёсла» (компоненты связности с центром z < -0.4), упрощает (tools/decimate.js), делит на жёсткие части (корпус, 2 клешни, 6 ног — их двигает игра по точкам крепления).
import sys, os, json, base64, subprocess, tempfile, numpy as np, scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
obj, out = sys.argv[1:3]; TGT = int(sys.argv[3]) if len(sys.argv) > 3 else 14000
V = []; F = []
for l in open(obj, 'r', errors='ignore'):
    if l.startswith('v '): V.append(l.split()[1:4])
    elif l.startswith('f '):
        ix = [int(t.split('/')[0]) - 1 for t in l.split()[1:]]
        for k in range(1, len(ix) - 1): F.append((ix[0], ix[k], ix[k + 1]))
V = np.array(V, np.float64); F = np.array(F, np.int64)
def comps(V, F):
    n = len(V); A = sp.coo_matrix((np.ones(len(F) * 3), (np.r_[F[:, 0], F[:, 1], F[:, 2]], np.r_[F[:, 1], F[:, 2], F[:, 0]])), shape=(n, n)); return connected_components(A, directed=False)[1]
lab = comps(V, F); ids = np.unique(lab); drop = [c for c in ids if V[lab == c].mean(0)[2] < -0.4]
print('убрано компонент', len(drop))
keep = ~np.isin(lab, drop)[F[:, 0]]; F = F[keep]; used = np.unique(F); mp = -np.ones(len(V), np.int64); mp[used] = np.arange(len(used)); V = V[used]; F = mp[F]
td = tempfile.mkdtemp(); V.astype(np.float32).tofile(td + '/V.bin'); F.astype(np.int32).tofile(td + '/F.bin')
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), td + '/V.bin', td + '/F.bin', td + '/oV.bin', td + '/oF.bin', str(TGT)], check=True)
V = np.fromfile(td + '/oV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(td + '/oF.bin', np.int32).reshape(-1, 3)
lab = comps(V, F); cnt = np.bincount(lab); big = [c for c in np.argsort(-cnt) if (lab[F[:, 0]] == c).sum() > 300]
body = big[0]; claws = [c for c in big if V[lab == c].mean(0)[2] > 0.3]; legs = [c for c in big if c != body and c not in claws]
assert len(claws) == 2 and len(legs) == 6, (len(claws), len(legs))
core = [body] + claws + legs; kd = {c: cKDTree(V[lab == c]) for c in core}
for c in ids if False else np.unique(lab):
    if c in core: continue
    cen = V[lab == c]; d = {k: kd[k].query(cen)[0].min() for k in core}; lab[lab == c] = min(d, key=d.get)
parts = []
def piece(c, name, pivot):
    m = np.where(lab == c)[0]; vm = np.full(len(V), -1); vm[m] = np.arange(len(m)); fm = F[(lab[F[:, 0]] == c)]; P = (V[m] - pivot).astype(np.float32)
    parts.append(dict(n=name, pv=[float(x) for x in pivot], P=base64.b64encode(P.tobytes()).decode(), F=base64.b64encode(vm[fm].astype(np.uint16).reshape(-1).tobytes()).decode()))
piece(body, 'body', np.zeros(3))
for c in claws:
    P = V[lab == c]; side = 1 if P[:, 0].mean() > 0 else -1; piece(c, 'claw' + ('R' if side > 0 else 'L'), P[np.argmin(np.hypot(P[:, 0] * 2, P[:, 2] - 0.1) + np.abs(P[:, 1] + 0.05))])
for side in (-1, 1):
    ls = sorted([c for c in legs if V[lab == c].mean(0)[0] * side > 0], key=lambda c: -V[lab == c].mean(0)[2])
    for k, c in enumerate(ls):
        P = V[lab == c]; piece(c, 'leg' + ('R' if side > 0 else 'L') + str(k), P[np.argmin(np.abs(P[:, 0]) + np.abs(P[:, 1] + 0.1))])
bb = [V.min(0).tolist(), V.max(0).tolist()]
open(out, 'w').write('// Краб-питомец (присланная статичная модель ZBrush, перекрашена в красный, без двух задних «вёсел»; автор и лицензия не указаны); подготовлено tools/crab_bake.py. Не редактировать.\nexport const CRB = ' + json.dumps(dict(parts=parts, bb=bb), separators=(',', ':')) + ';\n')
print('граней', len(F), 'частей', len(parts), 'байт', len(open(out).read()), 'bb', np.round(bb, 2).tolist())

# Осьминог-питомец: статичная модель (FBX, 11 частей: голова/мантия, 2 пары глаз, 4 «двойных» щупальца с присосками; скелета и анимаций в файле нет) → game/octo.js.
# Запуск: python3 -I tools/octo_bake.py <octopus.fbx> <game/octo.js> [граней_голова=9000] [граней_щупальце=1500] [граней_присоски=2600]
# Делает: переводит части в мировые координаты (перёд = +x игры), сваривает вершины, упрощает (tools/decimate.js), делит щупальца на 8 (по связности),
# строит каждому цепочку из NB суставов по осевой линии (геодезическое расстояние от основания) и веса скиннинга по длине; анимацию делает игра (dinos.js, octopusModel).
import sys, os, json, base64, subprocess, tempfile, numpy as np, scipy.sparse as sp
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fbx_read as fr
src, out = sys.argv[1:3]
TH = int(sys.argv[3]) if len(sys.argv) > 3 else 9000; TA = int(sys.argv[4]) if len(sys.argv) > 4 else 1500; TS = int(sys.argv[5]) if len(sys.argv) > 5 else 2600
NB = 6
root = fr.parse(src); FF = fr.load(src)
obj = [t for t in root.children if t.name == 'Objects'][0]; con = [t for t in root.children if t.name == 'Connections'][0]
geoms = {g.props[0]: g for g in obj.children if g.name == 'Geometry'}
g2m = {c.props[1]: c.props[2] for c in con.children if c.props[0] == 'OO' and c.props[1] in geoms}
def xf(m):
    T = np.array(m['T']); R = np.radians(m['R']); S = np.array(m['S']); cx, cy, cz = np.cos(R); sx, sy, sz = np.sin(R)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]]); Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]); Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]); return T, (Rz @ Ry @ Rx) * S
mesh = {}
for gi, g in geoms.items():
    m = FF['models'][g2m[gi]]; T, M = xf(m); V = np.array(g.get('Vertices').props[0], float).reshape(-1, 3) @ M.T + T
    I = np.array(g.get('PolygonVertexIndex').props[0], np.int64); F = []; poly = []
    for i in I:
        poly.append(int(i) if i >= 0 else ~int(i))
        if i < 0:
            for k in range(1, len(poly) - 1): F.append((poly[0], poly[k], poly[k + 1]))
            poly = []
    mesh[m['name']] = (V, np.array(F, np.int64))
# перёд модели смотрит в -x: поворот на 180° вокруг y даёт перёд = +x (как у остальных питомцев)
FLIP = np.array([-1, 1, -1.0])
def weld(V, F):
    q = np.round(V / 0.5).astype(np.int64); _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True); Vn = V[first]; Fn = inv[F]
    Fn = Fn[(Fn[:, 0] != Fn[:, 1]) & (Fn[:, 1] != Fn[:, 2]) & (Fn[:, 0] != Fn[:, 2])]; used = np.unique(Fn); mp = -np.ones(len(Vn), np.int64); mp[used] = np.arange(len(used)); return Vn[used], mp[Fn]
def decim(V, F, tgt):
    if len(F) <= tgt: return V, F
    td = tempfile.mkdtemp(); V.astype(np.float32).tofile(td + '/V.bin'); F.astype(np.int32).tofile(td + '/F.bin')
    subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), td + '/V.bin', td + '/F.bin', td + '/oV.bin', td + '/oF.bin', str(tgt)], check=True)
    return np.fromfile(td + '/oV.bin', np.float32).reshape(-1, 3).astype(np.float64), np.fromfile(td + '/oF.bin', np.int32).reshape(-1, 3).astype(np.int64)
def comps(V, F):
    n = len(V); A = sp.coo_matrix((np.ones(len(F) * 3), (np.r_[F[:, 0], F[:, 1], F[:, 2]], np.r_[F[:, 1], F[:, 2], F[:, 0]])), shape=(n, n)); return connected_components(A, directed=False)[1]
P = {}
for k, (V, F) in mesh.items():
    V, F = weld(V * FLIP, F); P[k] = (V, F); print(k, len(V), len(F))
# --- голова
hV, hF = decim(*P['Sphere'], TH); lab = comps(hV, hF); cnt = np.bincount(lab); print('голова: компонент', len(cnt), 'крупнейшая', cnt.max(), 'граней', len(hF))
big = np.argmax(cnt); keepc = np.where(cnt > 40)[0]; kf = np.isin(lab[hF[:, 0]], keepc); hF = hF[kf]; u = np.unique(hF); mp = -np.ones(len(hV), np.int64); mp[u] = np.arange(len(u)); hV = hV[u]; hF = mp[hF]; print(' после чистки: граней', len(hF), 'вершин', len(hV))
eyeC = (P['Sphere.001'][0].mean(0) + P['Sphere.002'][0].mean(0)) / 2
# --- щупальца: Body.N (тело) -> по связности 2 штуки; присоски привязываем к ближайшему
arms = []; bodyV = []; bodyF = []; off = 0; armId = []; armU = []; joints = []
for n in (1, 2, 3, 4):
    V, F = decim(*P['Body.%03d' % n], TA); lb = comps(V, F); ids = [c for c in np.unique(lb) if (lb == c).sum() > 30]; assert len(ids) == 2, (n, ids)
    for c in sorted(ids, key=lambda c: V[lb == c].mean(0)[2]):
        m = np.where(lb == c)[0]; vm = -np.ones(len(V), np.int64); vm[m] = np.arange(len(m)); fm = vm[F[lb[F[:, 0]] == c]]; Vc = V[m]
        d0 = np.linalg.norm(Vc - eyeC, axis=1); base = int(np.argmin(d0))
        A = sp.coo_matrix((np.linalg.norm(Vc[fm[:, [0, 1, 2]].reshape(-1)] - Vc[fm[:, [1, 2, 0]].reshape(-1)], axis=1), (fm.reshape(-1), fm[:, [1, 2, 0]].reshape(-1))), shape=(len(Vc), len(Vc))); A = A + A.T
        dg = dijkstra(A, indices=base); dg[~np.isfinite(dg)] = np.nanmax(dg[np.isfinite(dg)]); uu = dg / dg.max()
        # сустав j стоит на u_j = j/(NB-1)*0.9 (последний — почти кончик); положение — среднее вершин узкой полосы
        uj = np.linspace(0.0, 0.92, NB); J = []
        for x in uj:
            w = np.abs(uu - x) < 0.5 / NB * 0.55 + 0.02; J.append(Vc[w].mean(0) if w.any() else Vc[np.argmin(np.abs(uu - x))])
        arms.append(dict(V=Vc, F=fm, u=uu)); joints.append(np.array(J)); print(' щупальце', len(arms) - 1, 'вершин', len(Vc), 'длина', round(dg.max()), 'z', round(Vc.mean(0)[2]))
allV = np.vstack([a['V'] for a in arms]); allArm = np.concatenate([np.full(len(a['V']), i) for i, a in enumerate(arms)]); allU = np.concatenate([a['u'] for a in arms])
offs = np.cumsum([0] + [len(a['V']) for a in arms]); allF = np.vstack([a['F'] + offs[i] for i, a in enumerate(arms)])
kd = cKDTree(allV)
# --- присоски
sVs = []; sFs = []; o = 0
for n in (1, 2, 3, 4):
    V, F = decim(*P['Suckers.%03d' % n], TS); sVs.append(V); sFs.append(F + o); o += len(V)
sV = np.vstack(sVs); sF = np.vstack(sFs)
# --- веса: ближайшая точка тела щупальца -> (щупальце, u)
def skin(Vv):
    d, ix = kd.query(Vv); a = allArm[ix]; uu = allU[ix]; si = np.zeros((len(Vv), 3), np.uint8)
    for i in range(len(Vv)):
        j = joints[a[i]]; uj = np.linspace(0.0, 0.92, NB); x = min(max(uu[i], 0), uj[-1]); k = min(int(np.searchsorted(uj, x, 'right')) - 1, NB - 2); w = (x - uj[k]) / (uj[k + 1] - uj[k])
        b0 = 1 + a[i] * NB + k; b1 = b0 + 1; si[i] = (b0, b1, int(round((1 - w) * 255)))
    return si
aS = skin(allV); sS = skin(sV)
# --- глаза: две пары (белок и зрачок), каждая — оба глаза в одном меше
eV, eF = P['Sphere.001']; pV, pF = P['Sphere.002']
allPts = np.vstack([hV, allV, sV, eV, pV]); lo = allPts.min(0); hi = allPts.max(0); cen = np.array([eyeC[0], 0, 0]); SC = 1 / 1000.0
def enc(V): return base64.b64encode(((V - cen) * SC).astype(np.float32).tobytes()).decode()
def encF(F): return base64.b64encode(F.astype(np.uint16).reshape(-1).tobytes()).decode()
def encS(S): return base64.b64encode(S.tobytes()).decode()
data = dict(head=dict(P=enc(hV), F=encF(hF)), arm=dict(P=enc(allV), F=encF(allF), S=encS(aS)), suck=dict(P=enc(sV), F=encF(sF), S=encS(sS)), eye=dict(P=enc(eV), F=encF(eF)), pup=dict(P=enc(pV), F=encF(pF)),
            J=[[[round(float(x), 5) for x in (p - cen) * SC] for p in J] for J in joints], NB=NB, root=[round(float(x), 5) for x in (eyeC - cen) * SC], bb=[((lo - cen) * SC).round(4).tolist(), ((hi - cen) * SC).round(4).tolist()])
open(out, 'w').write('// Осьминог-питомец (присланная статичная модель, 11 частей без скелета; автор и лицензия не указаны); подготовлено tools/octo_bake.py. Не редактировать.\nexport const OCT = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('голова', len(hF), 'щупальца', len(allF), 'присоски', len(sF), 'байт', os.path.getsize(out), 'bb', data['bb'])

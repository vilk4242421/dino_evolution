# Птенец-питомец (FBX «animated chick»: сетка 1150 вершин, скелет из 27 костей, один дубль 11.4 с без имён клипов) → game/chk.js.
# Запуск: python3 -I tools/chk_bake.py <test.FBX> <текстура.png> <game/chk.js>
# Скелет и анимация переводятся в локальные TRS-кости (кватернионы, сэмплирование 30 к/с), сетка — в треугольники с развёрнутыми по-угловыми нормалями/UV, веса — до 4 костей.
import sys, os, json, base64, io, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from scipy.spatial.transform import Rotation as Rot
from PIL import Image
fbx, tex, out = sys.argv[1:4]
F = load(fbx); objs = F['objs']; M = F['models']; TICK = 46186158000.0
b64 = lambda x: base64.b64encode(np.ascontiguousarray(x).tobytes()).decode()
bid = [i for i, m in M.items() if m['type'] == 'LimbNode']; idx = {b: k for k, b in enumerate(bid)}
eq = lambda e: Rot.from_euler('xyz', e, degrees=True)
bones = []
for b in bid:
    m = M[b]; q = (eq(m['pre']) * eq(m['R'])).as_quat()
    bones.append(dict(n=m['name'], p=idx.get(m['parent'], -1), t=[float(v) for v in m['T']], q=[float(v) for v in q], s=[float(v) for v in m['S']]))
# --- сетка
g = [o for o in objs.values() if o.name == 'Geometry'][0]
V = g.get('Vertices').props[0].reshape(-1, 3); PI = g.get('PolygonVertexIndex').props[0]
Ln = g.get('LayerElementNormal').get('Normals').props[0].reshape(-1, 3); Lu = g.get('LayerElementUV'); UVd = Lu.get('UV').props[0].reshape(-1, 2); UVi = Lu.get('UVIndex').props[0]
cl = [i for i, o in objs.items() if o.name == 'Deformer' and o.props[2] == 'Cluster']; jb = []; infl = [dict() for _ in range(len(V))]
for c in cl:
    bb = [k for k in F['kids'].get(c, []) if k in idx]
    if not bb: continue
    j = len(jb); jb.append(idx[bb[0]]); o = objs[c]
    if o.get('Indexes') is None: continue
    for ci, w in zip(o.get('Indexes').props[0], o.get('Weights').props[0]): infl[int(ci)][j] = infl[int(ci)].get(j, 0) + float(w)
    if j == 0: pass
mm = [m for m in M.values() if m['type'] == 'Mesh'][0]; MESH = np.eye(4); MESH[:3, :3] = eq(mm['pre']).as_matrix() @ eq(mm['R']).as_matrix()
IBM = []
for c in cl:
    if not [k for k in F['kids'].get(c, []) if k in idx]: continue
    o = objs[c]; L = np.array(o.get('TransformLink').props[0]).reshape(4, 4).T
    IBM.append((np.linalg.inv(L) @ MESH).T.reshape(-1))      # вершины лежат в локали меши (PreRotation −90° по X → вверх = y); в матрицах FBX столбцы идут подряд — как и ждёт three
IBM = np.array(IBM, np.float32)
keyd = {}; P = []; N = []; UV = []; SI = []; SW = []; Fi = []; poly = []; pv = 0
def vert(cp, pvi):
    k = (cp, int(UVi[pvi]), tuple(np.round(Ln[pvi], 3)))
    if k not in keyd:
        keyd[k] = len(P); P.append(V[cp]); N.append(Ln[pvi]); UV.append([UVd[UVi[pvi]][0], 1 - UVd[UVi[pvi]][1]])
        w = sorted(infl[cp].items(), key=lambda a: -a[1])[:4]; s = sum(a[1] for a in w) or 1
        SI.append([a[0] for a in w] + [0] * (4 - len(w))); SW.append([a[1] / s for a in w] + [0] * (4 - len(w)))
    return keyd[k]
cur = []
for i, v in enumerate(PI):
    cp = int(v) if v >= 0 else ~int(v); cur.append(vert(cp, i))
    if v < 0:
        for k in range(1, len(cur) - 1): Fi += [cur[0], cur[k], cur[k + 1]]
        cur = []
P = np.array(P, np.float32); N = np.array(N, np.float32); UV = np.array(UV, np.float32); SI = np.array(SI, np.uint8); SW = np.array(SW, np.float32); Fi = np.array(Fi, np.uint16)
# --- анимация (один дубль) → кватернионы/позиции по костям, 30 к/с
cn = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurveNode' and b in idx: cn[a] = (idx[b], p)
CUR = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurve' and b in cn: c = objs[a]; CUR[(cn[b][0], cn[b][1], p)] = (c.get('KeyTime').props[0] / TICK, c.get('KeyValueFloat').props[0].astype(float))
FPS = 30; DUR = max(v[0][-1] for v in CUR.values()); NF = int(round(DUR * FPS)) + 1; ts = np.arange(NF) / FPS
def samp(k, dflt): return np.interp(ts, *CUR[k]) if k in CUR else np.full(NF, float(dflt))
tr = []
for bi, b in enumerate(bid):
    m = M[b]
    if any((bi, 'Lcl Rotation', 'd|' + a) in CUR for a in 'XYZ'):
        R = np.stack([samp((bi, 'Lcl Rotation', 'd|' + a), m['R'][k]) for k, a in enumerate('XYZ')], 1); q = (eq(m['pre']) * Rot.from_euler('xyz', R, degrees=True)).as_quat().astype(np.float32)
        for k in range(1, NF):
            if np.dot(q[k], q[k - 1]) < 0: q[k] = -q[k]
        if np.abs(q - q[0]).max() > 1e-4: tr.append(dict(b=bi, p='q', t=b64(ts.astype(np.float32)), v=b64(q)))
    if any((bi, 'Lcl Translation', 'd|' + a) in CUR for a in 'XYZ'):
        T = np.stack([samp((bi, 'Lcl Translation', 'd|' + a), m['T'][k]) for k, a in enumerate('XYZ')], 1).astype(np.float32)
        if np.abs(T - T[0]).max() > 1e-4: tr.append(dict(b=bi, p='p', t=b64(ts.astype(np.float32)), v=b64(T)))
im = Image.open(tex).convert('RGBA'); bf = io.BytesIO(); im.save(bf, 'PNG', optimize=True)
D = dict(n=len(P), P=b64(P), N=b64(N), UV=b64(UV), SI=b64(SI), SW=b64(SW), F=b64(Fi), f32=False, IBM=b64(IBM), bones=bones, joints=jb, tr=tr, tex=base64.b64encode(bf.getvalue()).decode(), mime='image/png', dur=float(DUR), bb=[P.min(0).tolist(), P.max(0).tolist()])
open(out, 'w').write('// Птенец-питомец (присланная модель animated-chick, FBX; автор и лицензия не указаны); подготовлено tools/chk_bake.py. Не редактировать.\nexport const CHK = ' + json.dumps(D, separators=(',', ':')) + ';\n')
print('verts', len(P), 'tris', len(Fi) // 3, 'bones', len(bones), 'joints', len(jb), 'tracks', len(tr), 'dur', DUR, 'bb', np.round(P.min(0), 2), np.round(P.max(0), 2))

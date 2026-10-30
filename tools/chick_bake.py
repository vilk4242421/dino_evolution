# Птенец-питомец (FBX со скелетом из 27 костей и одним клипом «Take 001», 342 кадра при 30 к/с; текстура 256×256) → game/chick.js.
# Запуск: python3 -I tools/chick_bake.py <test.FBX> <FourthGreen.png> <game/chick.js> [отладка.npz]
# Читает FBX через fbx_read.py: сетка (с нормалями и UV по углам полигонов), скиннинг (кластеры), поза привязки и кривые Lcl Rotation/Translation каждой кости.
# Клип в файле один и непрерывный (меток/разбиения нет): фрагменты «покой», «осмотр», «клевок» нарезаются в игре по кадрам, границы — в CLIPS ниже (пишутся в chick.js).
import numpy as np, sys, os, json, base64, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image

fbx, texf, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
TICK = 46186158000.0; FPS = 30
F = load(fbx); O = F['objs']; M = F['models']

# ------------------------------------------------------------------ матрицы
def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def euler(d): a = np.radians(d); return rz(a[2]) @ ry(a[1]) @ rx(a[0])            # порядок XYZ (FBX): R = Rz·Ry·Rx
def mat(R, T): m = np.eye(4); m[:3, :3] = R; m[:3, 3] = T; return m
def q_of(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q

# ------------------------------------------------------------------ скелет (родитель раньше ребёнка)
bone_ids = [i for i, m in M.items() if m['type'] == 'LimbNode']
order = []
def add(i):
    if i in order: return
    p = M[i]['parent']
    if p in bone_ids: add(p)
    order.append(i)
for i in bone_ids: add(i)
idx = {b: k for k, b in enumerate(order)}; NB = len(order); par = [idx.get(M[b]['parent'], -1) for b in order]; names = [M[b]['name'] for b in order]
PRE = [euler(M[b]['pre']) for b in order]; T0 = [np.array(M[b]['T'], float) for b in order]; R0 = [np.array(M[b]['R'], float) for b in order]
def local(i, Tl, Rl): return mat(PRE[i] @ euler(Rl), Tl)
def fk(Tl, Rl):                                                                   # мировые матрицы костей по локальным T и углам R
    W = [None] * NB
    for i in range(NB):
        L = local(i, Tl[i], Rl[i]); W[i] = L if par[i] < 0 else W[par[i]] @ L
    return W
W0 = fk(T0, R0)
# Меш: узел CR_1044a_rig с PreRotation −90° по X (модель в Z-up → Y-up); кости привязываются в мировых координатах
mesh_id = [i for i, m in M.items() if m['type'] == 'Mesh'][0]; MW = mat(euler(M[mesh_id]['pre']) @ euler(M[mesh_id]['R']), M[mesh_id]['T'])

# ------------------------------------------------------------------ сетка
g = [o for o in O.values() if o.name == 'Geometry'][0]
V = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64); PVI = g.get('PolygonVertexIndex').props[0].astype(np.int64)
le = lambda name: g.get(name)
ln, lu = le('LayerElementNormal'), le('LayerElementUV')
Nrm = ln.get('Normals').props[0].reshape(-1, 3); assert ln.get('MappingInformationType').props[0] == 'ByPolygonVertex'
UVv = lu.get('UV').props[0].reshape(-1, 2); UVi = lu.get('UVIndex').props[0].astype(np.int64); assert lu.get('MappingInformationType').props[0] == 'ByPolygonVertex'
ni = ln.get('NormalsIndex'); Ni = ni.props[0].astype(np.int64) if ni else np.arange(len(PVI))
vi = np.where(PVI < 0, ~PVI, PVI)                                                  # индекс вершины для каждого угла полигона
tris = []; s = 0                                                                   # треугольники (в файле все полигоны — треугольники) → индексы углов
for k, e in enumerate(np.where(PVI < 0)[0]):
    n = e - s + 1
    for j in range(1, n - 1): tris += [s, s + j, s + j + 1]
    s = e + 1
tris = np.array(tris)
keyc = np.concatenate([vi[:, None], np.round(Nrm[Ni] * 1e4).astype(np.int64), np.round(UVv[UVi] * 1e5).astype(np.int64)], 1)      # уникальные по значению (вершина, нормаль, uv) → вершины результата
_, first, inv = np.unique(keyc, axis=0, return_index=True, return_inverse=True); inv = inv.reshape(-1)
corner_vert = inv[tris]; used = np.unique(corner_vert); remap = -np.ones(len(first), np.int64); remap[used] = np.arange(len(used))
Fi = remap[corner_vert]; src = first[used]                                           # src — угол полигона, из которого взяты вершина, нормаль и uv результата
uk = np.stack([vi[src], Ni[src], UVi[src]], 1); Rm = MW[:3, :3]
P = (V[uk[:, 0]] @ Rm.T + MW[:3, 3]).astype(np.float32); N = (Nrm[uk[:, 1]] @ Rm.T); N = (N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)).astype(np.float32)
UV = UVv[uk[:, 2]].astype(np.float32).copy(); UV[:, 1] = 1 - UV[:, 1]              # V в FBX снизу вверх; в игре flipY = false
print('вершин %d (из %d), треугольников %d, bbox' % (len(P), len(V), len(Fi) // 3), P.min(0).round(2), P.max(0).round(2))

# ------------------------------------------------------------------ скиннинг: кластеры → кости, не более 4 влияний на вершину
cl = [i for i, o in O.items() if o.name == 'Deformer' and o.props[2] == 'Cluster']
joints = []; IBM = []; infl = [[] for _ in range(len(V))]; bind_err = 0
for c in cl:
    b = [k for k in F['kids'].get(c, []) if k in idx]
    if not b: b = [k for k in F['parent'].get(c, []) if k in idx]
    j = len(joints); bi = idx[b[0]]; joints.append(bi)
    TL = O[c].get('TransformLink').props[0].reshape(4, 4).T                         # мировая матрица кости при привязке
    bind_err = max(bind_err, np.abs(TL - W0[bi]).max())
    IBM.append(np.linalg.inv(TL))
    if O[c].get('Indexes') is None: continue                                       # кластер без вершин (кость-«хвостик»)
    ii, ww = O[c].get('Indexes').props[0], O[c].get('Weights').props[0]
    for a, w in zip(ii, ww): infl[a].append((j, float(w)))
print('расхождение позы привязки (кластеры) и позы Lcl в узле: %.4f' % bind_err)
assert bind_err < 1e-2, 'поза Lcl не совпадает с позой привязки: нужен пересчёт локальных матриц из кластеров'
SIv = np.zeros((len(V), 4), np.uint8); SWv = np.zeros((len(V), 4), np.float32)
for a, l in enumerate(infl):
    l = sorted(l, key=lambda x: -x[1])[:4]; tot = sum(w for _, w in l)
    if tot <= 0: l = [(0, 1.0)]; tot = 1.0
    for k, (j, w) in enumerate(l): SIv[a, k] = j; SWv[a, k] = w / tot
SI = SIv[uk[:, 0]]; SW = SWv[uk[:, 0]]
print('влияний на вершину: пусто', int((SWv.sum(1) == 0).sum()))

# ------------------------------------------------------------------ клип: кривые Lcl Rotation / Lcl Translation по кадрам
cn = {}
for a, b, p in F['prop_link']:
    if a in O and O[a].name == 'AnimationCurveNode' and b in idx: cn[a] = (idx[b], p)
curves = {}
for a, b, p in F['prop_link']:
    if a in O and O[a].name == 'AnimationCurve' and b in cn:
        c = O[a]; curves[(cn[b][0], cn[b][1], p)] = (c.get('KeyTime').props[0] / TICK * FPS, c.get('KeyValueFloat').props[0].astype(np.float64))
NF = int(round(max(v[0][-1] for v in curves.values()))) + 1; fr = np.arange(NF)
print('кадров', NF, 'длительность %.3f с' % ((NF - 1) / FPS))
def samp(key, default): return np.interp(fr, *curves[key]) if key in curves else np.full(NF, default)
tracks = []; DBG = {}
for i in range(NB):
    ra = [samp((i, 'Lcl Rotation', 'd|' + ax), R0[i][k]) for k, ax in enumerate('XYZ')]; ta = [samp((i, 'Lcl Translation', 'd|' + ax), T0[i][k]) for k, ax in enumerate('XYZ')]
    rmove = max(np.ptp(x) for x in ra) > 1e-3; tmove = max(np.ptp(x) for x in ta) > 1e-4
    if rmove:
        Q = np.array([q_of(PRE[i] @ euler(np.array([ra[0][f], ra[1][f], ra[2][f]]))) for f in range(NF)])
        for f in range(1, NF):                                                       # непрерывность знака кватерниона, иначе slerp идёт «длинным путём»
            if np.dot(Q[f], Q[f - 1]) < 0: Q[f] = -Q[f]
        tracks.append(dict(b=i, p='q', t=(fr / FPS).astype(np.float32), v=Q.astype(np.float32).reshape(-1))); DBG['q_' + names[i]] = Q
    if tmove:
        Tt = np.stack(ta, 1); tracks.append(dict(b=i, p='p', t=(fr / FPS).astype(np.float32), v=Tt.astype(np.float32).reshape(-1))); DBG['p_' + names[i]] = Tt
print('треки:', [(names[t['b']], t['p']) for t in tracks])

# ------------------------------------------------------------------ кости (локальная поза покоя = поза Lcl в узле = поза привязки)
b64 = lambda x: base64.b64encode(np.ascontiguousarray(x).tobytes()).decode()
bones = []
for i in range(NB):
    L = local(i, T0[i], R0[i]); bones.append(dict(n=names[i], p=par[i], t=[round(float(x), 6) for x in L[:3, 3]], q=[round(float(x), 6) for x in q_of(L[:3, :3])], s=[1, 1, 1]))
tr = [dict(b=t['b'], p=t['p'], t=b64(t['t']), v=b64(t['v'])) for t in tracks]
im = Image.open(texf).convert('RGB'); bf = io.BytesIO(); im.save(bf, 'JPEG', quality=90)
# Границы фрагментов единственного клипа (кадры при 30 к/с), найдены по анализу движения и просмотру кадров:
#   rest 0–2    — поза покоя (в файле она держится первые ~1 с);
#   look 30–150 — плавный осмотр: голова поворачивается и наклоняется вбок, в конце снова поза покоя (годится как вставка в «покой»);
#   peck 196–270 — клевок: голова опускается, корпус наклоняется вперёд, потом подъём (реакция на лечение).
# Кадры 159–341 — набор удерживаемых поз с резкими переходами, цикла ходьбы, атаки и получения урона в файле нет.
CLIPS = dict(rest=[0, 2], look=[30, 150], peck=[196, 270])
D = dict(n=len(P), P=b64(P), N=b64(N), UV=b64(UV), SI=b64(SI), SW=b64(SW), F=b64(Fi.astype(np.uint16 if len(P) < 65536 else np.uint32)), f32=len(P) >= 65536, IBM=b64(np.array(IBM, np.float32).transpose(0, 2, 1).reshape(-1)),
         bones=bones, joints=joints, tr=tr, tex=base64.b64encode(bf.getvalue()).decode(), dur=float((NF - 1) / FPS), fps=FPS, clips=CLIPS, bb=[P.min(0).tolist(), P.max(0).tolist()])
open(out, 'w').write('// Птенец-питомец (присланная пользователем модель, FBX со скелетом и одним клипом); подготовлено tools/chick_bake.py. Не редактировать.\nexport const CHICK = ' + json.dumps(D, separators=(',', ':')) + ';\n')
print('bones', NB, 'joints', len(joints), 'tracks', len(tr), 'dur', D['dur'], 'bytes', os.path.getsize(out))
if dbg: np.savez(dbg, P=P, N=N, UV=UV, SI=SI, SW=SW, F=Fi, IBM=np.array(IBM), joints=joints, names=names, par=par, **DBG)

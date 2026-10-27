# Кетцалькоатль (Pterosaur Quetzalcoatlus, FBX со скелетом, текстура 512×512; Sketchfab, лицензия в архиве не указана) → game/qtz.js. Летающий враг: клип полёта из файла играется всегда.
# Запуск: python3 -I tools/qtz_bake.py <bird.fbx> <b48.png> <выход qtz.js> [отладка.npz]
# Основа — spn_bake.py (чтение FBX, FK с узлом Armature, пересчёт в вращения осевого скелета). Из двух клипов файла берётся длинный (Armature|bird.001, 6,2 с).
import numpy as np, sys, os, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image
from scipy.ndimage import gaussian_filter

fbx, texf, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
TICK = 46186158000.0
LAYER = 'Armature|bird.001'
F = load(fbx); objs = F['objs']; M = F['models']
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))

# ------------------------------------------------------------------ скелет
bone_ids = [i for i, m in M.items() if m['type'] == 'LimbNode']
# порядок: родитель раньше ребёнка
order = []
def add(i):
    if i in order: return
    p = M[i]['parent']
    if p in bone_ids: add(p)
    order.append(i)
for i in bone_ids: add(i)
idx = {b: k for k, b in enumerate(order)}; NB = len(order); par = [idx[M[b]['parent']] if M[b]['parent'] in idx else -1 for b in order]
names = [M[b]['name'] for b in order]
par_out = [0 if (par[i] < 0 and i != 0) else par[i] for i in range(NB)]      # ноги — отдельные корни под Armature: в игре подвешиваем к корню (тот же узел, позиция совпадает)
def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def euler(d): a = np.radians(d); return rz(a[2]) @ ry(a[1]) @ rx(a[0])            # порядок XYZ (FBX): R = Rz·Ry·Rx
PRE = [euler(M[b]['pre']) for b in order]; T0 = [np.array(M[b]['T'], float) for b in order]; R0 = [np.array(M[b]['R'], float) for b in order]
ARM = [i for i, m in M.items() if m['name'] == 'Armature'][0]
ARM_T = np.array(M[ARM]['T'], float); ARM_R = euler(M[ARM]['pre']) @ euler(M[ARM]['R']); ARM_S = float(M[ARM]['S'][0])      # узел Armature: сдвиг, наклон и масштаб 100 (кривые костей — в метрах)
def fk(Tl, Rl):                                                                   # мировые позиции и повороты костей по локальным T и углам R (с учётом узла Armature)
    Pw = [None] * NB; Rw = [None] * NB
    for i in range(NB):
        Rloc = PRE[i] @ euler(Rl[i])
        if par[i] < 0: Pw[i] = ARM_T + ARM_R @ (ARM_S * Tl[i]); Rw[i] = ARM_R @ Rloc
        else: Pw[i] = Pw[par[i]] + Rw[par[i]] @ (ARM_S * Tl[i]); Rw[i] = Rw[par[i]] @ Rloc
    return np.array(Pw), Rw
# поза покоя — из матриц привязки кластеров (Lcl-значения в файле — поза в начале клипа, а не покоя)
cl = [i for i, o in objs.items() if o.name == 'Deformer' and o.props[2] == 'Cluster']
cluster_of = {}; P0 = np.zeros((NB, 3)); Rw0 = [None] * NB
for c in cl:
    b = [k for k in F['kids'].get(c, []) if k in idx]
    if not b: continue
    Mx = objs[c].get('TransformLink').props[0].reshape(4, 4).T; Rm = Mx[:3, :3] / np.maximum(np.linalg.norm(Mx[:3, :3], axis=0, keepdims=True), 1e-9)
    P0[idx[b[0]]] = Mx[:3, 3]; Rw0[idx[b[0]]] = Rm; cluster_of[c] = idx[b[0]]
Pc, Rc = fk(T0, R0)
miss=[i for i in range(NB) if Rw0[i] is None]; print('без кластера', [names[i] for i in miss])
for i in range(NB):
    if Rw0[i] is None:
        p=par[i]; Rw0[i]=Rw0[p]@(Rc[p].T@Rc[i]); P0[i]=P0[p]+Rw0[p]@(Rc[p].T@(Pc[i]-Pc[p]))
print('длины костей: FK по Lcl и привязка расходятся на', round(max(abs(np.linalg.norm(Pc[i] - Pc[par[i]]) - np.linalg.norm(P0[i] - P0[par[i]])) for i in range(NB) if par[i] >= 0 and np.isfinite(P0[i]).all()), 3))
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)                  # (x,y,z)_fbx → (z, y, -x) игры (в файле вперёд — ось z)
restP = P0 @ G.T
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q

# ------------------------------------------------------------------ клип (кривые Lcl Translation/Rotation)
cn = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurveNode' and b in idx: cn[a] = (idx[b], p)
lay = [i for i, o in objs.items() if o.name == 'AnimationLayer' and o.props[1].split('\x00')[0] == LAYER][0]
cn = {k: v for k, v in cn.items() if lay in F['parent'].get(k, [])}
curves = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurve' and b in cn:
        c = objs[a]; curves[(cn[b][0], cn[b][1], p)] = (c.get('KeyTime').props[0] / TICK, c.get('KeyValueFloat').props[0].astype(np.float64))
t0 = min(v[0][0] for v in curves.values()); t1 = max(v[0][-1] for v in curves.values()); FPS = 20
NF = int(round((t1 - t0) * FPS)) + 1
print('клип: %.2f с, кадров %d' % (t1 - t0, NF))
def samp(key, t, default):
    if key not in curves: return default
    ts, vs = curves[key]; return float(np.interp(t, ts, vs))
QF = np.zeros((NF, NB, 4)); TB = {}; PAS = []
for f in range(NF):
    t = t0 + f / FPS; Tl = []; Rl = []
    for i in range(NB):
        Tl.append(np.array([samp((i, 'Lcl Translation', 'd|' + ax), t, T0[i][k]) for k, ax in enumerate('XYZ')]))
        Rl.append(np.array([samp((i, 'Lcl Rotation', 'd|' + ax), t, R0[i][k]) for k, ax in enumerate('XYZ')]))
    Pa, Rwa = fk(Tl, Rl); PAS.append(Pa.copy()); TB.setdefault(0, []).append(G @ Pa[0])      # корень: абсолютное положение (с учётом Armature)
    Delta = [G @ (Rwa[i] @ Rw0[i].T) @ G.T for i in range(NB)]                       # поворот кости относительно покоя, в игровых осях (мировой)
    for i in range(NB):
        q = qmat_to_q(Delta[i] if par_out[i] < 0 else Delta[par_out[i]].T @ Delta[i])
        if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
        elif f == 0 and q[3] < 0: q = -q
        QF[f, i] = q
# клип зациклен (последний кадр = первому) — убираем дубль; средняя поза каждой кости нужна, чтобы в игре гасить «жевание» челюстей клипа
NF -= 1; QF = QF[:NF]; TB = {i: v[:NF] for i, v in TB.items()}
AVG = []
for i in range(NB):
    q = QF[:, i].copy(); q *= np.sign(q @ q[0])[:, None]; a_ = q.mean(0); AVG.append((a_ / np.linalg.norm(a_)).tolist())
TB = {i: v for i, v in TB.items() if np.array(v).std(0).max() > 2e-3}       # оставляем только кости, у которых положение реально меняется
tb = {str(i): [[round(float(c), 4) for c in r] for r in np.array(v)] for i, v in TB.items()}
print('кости с позицией:', list(tb.keys()))



# проверка: позиции костей из кватернионов клипа (как считает игра) против прямого FK по Lcl-кривым файла
def fkq(f):
    W = [None] * NB; Rq = [None] * NB
    for i in range(NB):
        qm = (lambda q: np.array([[1 - 2 * (q[1] ** 2 + q[2] ** 2), 2 * (q[0] * q[1] - q[2] * q[3]), 2 * (q[0] * q[2] + q[1] * q[3])], [2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[0] ** 2 + q[2] ** 2), 2 * (q[1] * q[2] - q[0] * q[3])], [2 * (q[0] * q[2] - q[1] * q[3]), 2 * (q[1] * q[2] + q[0] * q[3]), 1 - 2 * (q[0] ** 2 + q[1] ** 2)]]))(QF[f, i])
        if par_out[i] < 0: W[i] = np.array(TB[0][f]) if 0 in TB else restP[0]; Rq[i] = qm
        else: W[i] = W[par_out[i]] + Rq[par_out[i]] @ (restP[i] - restP[par_out[i]]); Rq[i] = Rq[par_out[i]] @ qm
    return np.array(W)
for f in (0, 30, 60, 90):
    e = np.abs(fkq(f) - (PAS[f] @ G.T)).max(1); print('кадр', f, 'макс. расхождение позиций костей', round(float(e.max()), 3), 'кость', names[int(e.argmax())])
# клип зациклен: дубль последнего кадра убираем
NF -= 1; QF = QF[:NF]; TB = {i: v[:NF] for i, v in TB.items()}
height = float(restP[:, 1].max() - restP[:, 1].min())
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
NI = {n_: i for i, n_ in enumerate(names)}
if os.environ.get('QDUMP'):
    for i in range(NB): print(i, names[i], 'par', par[i], restP[i].round(2))
    print('высота', restP[:,1].min(), restP[:,1].max()); sys.exit()
HEAD = NI['Bone.005']; JAW = NI['Bone.006']; NECK = [NI['Bone.002'], NI['Bone.003'], NI['Bone.004']]
TIPS = [NI['Bone_L.004_end'], NI['Bone_R.004_end']]
# ------------------------------------------------------------------ сетка: скульпт из 200 тыс. треугольников, у каждого свой островок UV (текстура — «конфетти» 512×512).
# Сваривать по UV нельзя: сетка превращается в мешок отдельных треугольников. Поэтому: вершины — контрольные точки, цвет вершины — среднее по соседним граням
# цвета текстуры в центре UV-треугольника (внутри островка, не на краю с серым фоном); дальше обычное упрощение с блокировкой границ листа.
g = [c for c in objs.values() if c.name == 'Geometry' and c.get('Vertices')][0]
CP = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64); PVI = g.get('PolygonVertexIndex').props[0].astype(np.int64)
lu = [c for c in g.children if c.name == 'LayerElementUV'][0]; UVd = lu.get('UV').props[0].reshape(-1, 2); UVi = lu.get('UVIndex').props[0].astype(np.int64)
polys = []; cur = []
for k, v in enumerate(PVI):
    if v < 0: cur.append((~v, k)); polys.append(cur); cur = []
    else: cur.append((v, k))
Tri_c = []; Tri_uv = []
for pl in polys:
    for j in range(1, len(pl) - 1):
        a_, b_, c_ = pl[0], pl[j], pl[j + 1]; Tri_c.append([a_[0], b_[0], c_[0]]); Tri_uv.append([UVd[UVi[a_[1]]], UVd[UVi[b_[1]]], UVd[UVi[c_[1]]]])
Tri_c = np.array(Tri_c); Tri_uv = np.array(Tri_uv)
tex8 = np.array(Image.open(texf).convert('RGB')).astype(np.float64) / 255; TH, TW = tex8.shape[:2]
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
cen = Tri_uv.mean(1); px = np.clip((cen[:, 0] * TW).astype(int), 0, TW - 1); py = np.clip(((1 - cen[:, 1]) * TH).astype(int), 0, TH - 1)
fc = tex8[py, px]                                                                         # цвет грани (sRGB 0..1)
acc = np.zeros((len(CP), 3)); cnt = np.zeros(len(CP))
for k in range(3): np.add.at(acc, Tri_c[:, k], fc); np.add.at(cnt, Tri_c[:, k], 1)
CC = acc / np.maximum(cnt, 1)[:, None]
# нормали по граням (в осях файла) → вершинные
Pw0 = CP; fn = np.cross(Pw0[Tri_c[:, 1]] - Pw0[Tri_c[:, 0]], Pw0[Tri_c[:, 2]] - Pw0[Tri_c[:, 0]]); Nn = np.zeros((len(CP), 3))
for k in range(3): np.add.at(Nn, Tri_c[:, k], fn)
Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
used = np.unique(Tri_c); remap = -np.ones(len(CP), np.int64); remap[used] = np.arange(len(used))
Vc = used; Tri = remap[Tri_c]; CC = CC[Vc]; Nn = Nn[Vc]; n = len(Vc); Uv = np.zeros((n, 2))
mid = [i for i, m in M.items() if m['type'] == 'Mesh'][0]; Mm = euler(M[mid]['pre']) @ euler(M[mid]['R'])
CPw = CP[Vc] @ Mm.T + np.array(M[mid]['T']); Nw = Nn @ Mm.T
Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-9)
GM = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)
V = (CPw @ GM.T) * 100.0; N = Nw @ GM.T
print('вершин', n, 'треугольников', len(Tri), 'габариты', V.min(0).round(2), V.max(0).round(2))
W = np.zeros((len(CP), NB))
for c, b in cluster_of.items():
    ii = objs[c].get('Indexes'); ww = objs[c].get('Weights')
    if ii is not None: W[ii.props[0].astype(np.int64), b] += ww.props[0]
W = W[Vc]; top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); s_ = w4.sum(1); bad = s_ < 1e-6
top[bad, 0] = 0; w4[bad] = [1, 0, 0, 0]; w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
dom = top[np.arange(n), np.argmax(w4, axis=1)]; print('вершин без весов', int(bad.sum()))
if os.environ.get('QTZ_FULL'): np.savez(os.environ['QTZ_FULL'], V=V, CC=CC)
TARGET_F = int(os.environ.get('QTZ_TRIS', '16000'))
if len(Tri) > TARGET_F:
    import subprocess, tempfile
    wd = tempfile.mkdtemp(); here = os.path.dirname(os.path.abspath(__file__))
    ec = {}
    for t in Tri:
        for a_, b_ in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): k_ = (min(a_, b_), max(a_, b_)); ec[k_] = ec.get(k_, 0) + 1
    lock = np.zeros(n, np.uint8)
    for (a_, b_), c_ in ec.items():
        if c_ == 1: lock[a_] = 1; lock[b_] = 1
    print('заблокировано вершин', int(lock.sum()), 'из', n)
    V.astype(np.float32).tofile(wd + '/V.bin'); Tri.astype(np.int32).tofile(wd + '/F.bin'); lock.tofile(wd + '/L.bin')
    env = dict(os.environ, DEC_LOCK=wd + '/L.bin', DEC_IDX=wd + '/I.bin')
    subprocess.check_call(['node', os.path.join(here, 'decimate.js'), wd + '/V.bin', wd + '/F.bin', wd + '/OV.bin', wd + '/OF.bin', str(TARGET_F)], env=env)
    oi = np.fromfile(wd + '/I.bin', np.int32); V = np.fromfile(wd + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); Tri = np.fromfile(wd + '/OF.bin', np.int32).reshape(-1, 3)
    N = N[oi]; Uv = Uv[oi]; top = top[oi]; w4 = w4[oi]; dom = dom[oi]; CC = CC[oi]; n = len(V)
    print('после упрощения: вершин', n, 'треугольников', len(Tri))
EXP = float(os.environ.get('QTZ_EXP', '1.7'))
VCOL = np.round(np.clip(lin(CC) * EXP, 0, 1) * 255).astype(np.uint8)         # вершинный цвет: линейный ×EXP (материал игры без sRGB-декодирования)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
def clipdict(QF_, TB_, nf, dur, loop, v):
    return {'dur': round(dur, 4), 'nf': nf, 'loop': loop, 'v': round(v, 4), 'q': base64.b64encode(np.round(QF_ * 32767).astype(np.int16).tobytes()).decode(), 'tb': {str(i): [[round(float(c), 4) for c in r] for r in np.array(v_)] for i, v_ in TB_.items() if np.array(v_).std(0).max() > 1e-6}}
# клип файла: поза покоя → взлёт → несколько взмахов → возврат в позу покоя. Для петли берём только взмахи: ищем пару кадров (a, b) с наименьшим расхождением всех костей
def fk_all(f):
    W = fkq(f); return W
best = None
for a_ in range(36, 64):
    for b_ in range(80, NF - 6):
        if b_ - a_ < 40: continue
        d_ = np.abs(fkq(a_) - fkq(b_)).max()
        dq_ = np.abs(np.abs((QF[a_] * QF[b_]).sum(1)) - 1).max()
        sc_ = d_ / 600.0 + dq_ * 20 - (b_ - a_) * 0.0004
        if best is None or sc_ < best[0]: best = (sc_, a_, b_, d_, dq_)
print('петля кадров %d..%d (%.2f с), расхождение позиций %.1f, поворотов %.4f' % (best[1], best[2], (best[2] - best[1]) / FPS, best[3], best[4]))
QL = QF[best[1]:best[2]]; NL = len(QL)
JB = float(os.environ.get('QTZ_JB', '0.45'))                        # в клипе клюв приоткрыт: закрываем нижнюю челюсть поворотом вокруг её оси (укус в игре открывает от закрытого)
def qmul(p, q):
    x1, y1, z1, w1 = p[..., 0], p[..., 1], p[..., 2], p[..., 3]; x2, y2, z2, w2 = q
    return np.stack([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], -1)
QL = QL.copy(); QL[:, JAW] = qmul(QL[:, JAW], (0, 0, np.sin(JB / 2), np.cos(JB / 2)))
clips = {'idle': clipdict(QL, {}, NL, NL / FPS, True, 0.0)}
# глаза и цвет век (цвет — среднее вершинных цветов вокруг глаза, без самых тёмных)
_e = [float(x) for x in os.environ.get('QTZ_EYE', '312,635,58,13').split(',')]; EYES = [[_e[0], _e[1], _e[2]], [_e[0], _e[1], -_e[2]]]; EYER = [_e[3], _e[3]]
LIDC = []
for sd_ in (1, -1):
    near = np.linalg.norm(V - np.array([_e[0], _e[1], sd_ * _e[2]]), axis=1) < 55
    if near.sum() < 3: near = np.linalg.norm(V - np.array([_e[0], _e[1], sd_ * _e[2]]), axis=1) < 60
    col_ = VCOL[near] / 255.0; lum_ = col_ @ np.array([0.3, 0.55, 0.15]); keep_ = lum_ > np.percentile(lum_, 10)
    LIDC.append([round(float(c), 4) for c in col_[keep_].mean(0)])
print('цвет век', LIDC)
SC = float(int(32000.0 / np.abs(V).max()))
zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N, -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([Uv[:, 0], 1 - Uv[:, 1]], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(Tri.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par_out, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'clips': clips, 'tips': TIPS, 'neck': NECK, 'head': HEAD, 'jaw': JAW, 'jsign': 1.0,
     'eyes': EYES, 'eyeR': EYER, 'lid': LIDC, 'height': round(height, 4), 'vc': b64(VCOL), 'tex': ''}
open(out, 'w').write('// Кетцалькоатль (Pterosaur Quetzalcoatlus, Sketchfab) — подготовлено tools/qtz_bake.py. Не редактировать.\nexport const QTZ = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ', 'вершин', n)
if dbg: np.savez(dbg, VC=VCOL, V=V, F=Tri, top=top, w4=w4, restP=restP, par=np.array(par), QF=QF, names=np.array(names), UV=Uv)

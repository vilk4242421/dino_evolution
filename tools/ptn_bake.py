# Летающий класс: Pteranodon (Jurassic Park: The Game, GLB со скелетом) → game/ptn.js.
# Запуск: python3 tools/ptn_bake.py <sk97_pteranodon_JP102.glb> <atlas0.png> <atlas1.png> <выход ptn.js> [отладка.npz]
# Что делает: читает сетку (30 примитивов), выкидывает родные глаза (глаза и веки собираются в игре), переводит оси в игровые
# (x вперёд, y вверх, z вбок), перестраивает скелет в «осевой» (у всех костей единичный поворот покоя — проще писать позы),
# пересчитывает клип полёта (sk97_move_pteranodonfly, 3 с) в вращения этого скелета, строит маски (перепонка, красное, пасть)
# и «карту деталей» — серая высокочастотная копия обоих атласов, которую игра умножает на цвета по палитре игрока.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

glbf, t0f, t1f, out = sys.argv[1:5]
dbg = sys.argv[5] if len(sys.argv) > 5 else None
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
d = open(glbf, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl]); off = 20 + jl
blen = struct.unpack('<I', d[off:off + 4])[0]; BIN = d[off + 8:off + 8 + blen]
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); item = n * np.dtype(dt).itemsize; stride = bv.get('byteStride') or item
    if stride == item: arr = np.frombuffer(BIN, dtype=dt, count=a['count'] * n, offset=o).reshape(a['count'], n)
    else: arr = np.stack([np.frombuffer(BIN, dtype=dt, count=n, offset=o + k * stride) for k in range(a['count'])])
    return arr
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))

# ------------------------------------------------------------------ оси: модель (x вбок, y вверх, z вперёд) → игра (x вперёд, y вверх, z вбок)
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)       # (xm,ym,zm) → (zm, ym, -xm), det +1
def qmat(q):
    x, y, z, w = q; return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def mq(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q

# ------------------------------------------------------------------ скелет
nodes = J['nodes']; sk = J['skins'][0]; joints = sk['joints']; NB = len(joints); jidx = {n: i for i, n in enumerate(joints)}
parent_node = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []): parent_node[c] = i
par = [jidx.get(parent_node.get(n)) if parent_node.get(n) in jidx else -1 for n in joints]
def local(n, rot=None, tr=None):
    nd = nodes[n]; R = qmat(rot if rot is not None else nd.get('rotation', [0, 0, 0, 1])); t = np.array(tr if tr is not None else nd.get('translation', [0, 0, 0]), dtype=np.float64)
    s = np.array(nd.get('scale', [1, 1, 1]), dtype=np.float64); return R * s, t
order = list(range(NB))      # родители идут раньше детей? проверим
assert all(p < i for i, p in enumerate(par) if p >= 0), 'порядок костей'
Rw = [None] * NB; Pw = [None] * NB
for i, n in enumerate(joints):
    Rl, t = local(n)
    if par[i] < 0: Rw[i] = Rl; Pw[i] = t
    else: Rw[i] = Rw[par[i]] @ Rl; Pw[i] = Pw[par[i]] + Rw[par[i]] @ t
# проверка: обратные матрицы привязки должны совпасть с покоем узлов
ibm = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).astype(np.float64)
err = max(np.abs(np.linalg.inv(ibm[i].T)[:3, 3] - Pw[i]).max() for i in range(NB)); print('расхождение покоя/IBM', round(err, 5))
restP = np.array([G @ p for p in Pw])          # позиции костей в игровых осях
print('костей', NB, 'корень', restP[0].round(3))

# ------------------------------------------------------------------ клип полёта → вращения «осевого» скелета
an = [a for a in J['animations'] if a['name'] == 'sk97_move_pteranodonfly'][0]; DUR = float(acc(an['samplers'][0]['input']).max())
FPS = 30; NF = int(round(DUR * FPS)); print('клип', DUR, 'с,', NF, 'кадров')
chan = {}
for c in an['channels']:
    s = an['samplers'][c['sampler']]; chan[(c['target']['node'], c['target']['path'])] = (acc(s['input']).ravel().astype(np.float64), acc(s['output']).astype(np.float64), s.get('interpolation', 'LINEAR'))
def slerp(a, b, t):
    dp = np.dot(a, b)
    if dp < 0: b = -b; dp = -dp
    if dp > 0.9995: r = a + (b - a) * t
    else:
        th = np.arccos(dp); r = (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)
    return r / np.linalg.norm(r)
def sample(key, t, default):
    if key not in chan: return default
    ts, vs, _ = chan[key]; t = t % DUR if DUR > 0 else 0
    k = np.searchsorted(ts, t, side='right') - 1
    if k < 0: return vs[0]
    if k >= len(ts) - 1: return vs[-1]
    u = (t - ts[k]) / (ts[k + 1] - ts[k]) if ts[k + 1] > ts[k] else 0
    return slerp(vs[k], vs[k + 1], u) if key[1] == 'rotation' else vs[k] + (vs[k + 1] - vs[k]) * u
animT = sorted({k[0] for k in chan if k[1] == 'translation'}); print('узлы с анимацией позиции', animT)
QF = np.zeros((NF, NB, 4)); TF = {}
for f in range(NF):
    t = f / FPS; Rwa = [None] * NB; Delta = [None] * NB
    for i, n in enumerate(joints):
        nd = nodes[n]; rot = sample((n, 'rotation'), t, np.array(nd.get('rotation', [0, 0, 0, 1])))
        Rl = qmat(rot); Rwa[i] = Rl if par[i] < 0 else Rwa[par[i]] @ Rl
        Dl = G @ (Rwa[i] @ Rw[i].T) @ G.T; Delta[i] = Dl
    for i, n in enumerate(joints):
        q = mq(Delta[i] if par[i] < 0 else Delta[par[i]].T @ Delta[i])
        if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
        elif f == 0 and q[3] < 0: q = -q
        QF[f, i] = q
        if n in animT:
            tl = sample((n, 'translation'), t, np.array(nodes[n].get('translation', [0, 0, 0])))
            tw = tl if par[i] < 0 else Rw[par[i]] @ tl          # смещение в осях модели покоя родителя
            TF.setdefault(i, []).append(G @ tw)
for i in list(TF):
    TF[i] = np.array(TF[i])
    if np.ptp(TF[i], axis=0).max() < 1e-4: del TF[i]
# покой этих костей: смещение от родителя
for i in TF: print('поз.анимация кости', i, 'амплитуда', np.ptp(TF[i], axis=0).round(3))

# ------------------------------------------------------------------ сетка
prims = J['meshes'][0]['primitives']; DROP = {20, 21, 22, 27, 28, 29}
EYE = {}
V = []; N = []; UV = []; SI = []; SW = []; F = []; PID = []; TEXI = []
base = 0
for k, p in enumerate(prims):
    a = p['attributes']; pos = acc(a['POSITION']).astype(np.float64)
    if k in (20, 27): EYE[k] = (pos.mean(0), (pos.max(0) - pos.min(0)).max() / 2)
    if k in DROP: continue
    nor = acc(a['NORMAL']).astype(np.float64); n = len(pos)
    uv = acc(a['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in a else np.zeros((n, 2))
    ji = acc(a['JOINTS_0']).astype(np.int64); jw = acc(a['WEIGHTS_0']).astype(np.float64)
    if jw.dtype != np.float64 or jw.max() > 1.5: jw = jw / 255.0
    ix = acc(p['indices']).astype(np.int64).ravel().reshape(-1, 3)
    m = J['materials'][p['material']]; ti = m['pbrMetallicRoughness'].get('baseColorTexture', {}).get('index', -1)
    V.append(pos @ G.T); N.append(nor @ G.T); UV.append(uv); SI.append(ji); SW.append(jw); F.append(ix + base); PID += [k] * n; TEXI += [ti] * n; base += n
V = np.concatenate(V); N = np.concatenate(N); UV = np.concatenate(UV); SI = np.concatenate(SI); SW = np.concatenate(SW); F = np.concatenate(F)
PID = np.array(PID); TEXI = np.array(TEXI); n = len(V)
SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
assert n < 65536
eyeC = [G @ EYE[k][0] for k in (20, 27)]; eyeR = (EYE[20][1] + EYE[27][1]) / 2; print('глаза', np.round(eyeC, 3), 'радиус', round(eyeR, 4))

# ------------------------------------------------------------------ текстуры → карта деталей (оба атласа в один лист 2048×1024)
A0 = np.array(Image.open(t0f).convert('RGB')).astype(np.float64) / 255; A1 = np.array(Image.open(t1f).convert('RGB')).astype(np.float64) / 255
def detail(A):
    L = A @ np.array([0.3, 0.55, 0.15]); lo = gaussian_filter(L, 22); mean = L[L > 0.02].mean()
    hp = L / np.maximum(lo, 0.04); lf = lo / mean
    D = np.clip(hp, 0.35, 1.9) * np.clip(lf, 0.5, 1.8) ** 0.3
    return D
D0, D1 = detail(A0), detail(A1)
SHEET = np.ones((1024, 2048)); SHEET[:, :1024] = D0 / 2.0; SHEET[:, 1024:] = D1 / 2.0
SHEET[1008:1024, 2032:2048] = 0.5              # нейтральный квадрат (значение 1.0) для частей без атласа
Image.fromarray(np.clip(SHEET * 255, 0, 255).astype(np.uint8)).convert('L').save('/tmp/ptn_sheet.jpg', quality=82)
sheet_b64 = base64.b64encode(open('/tmp/ptn_sheet.jpg', 'rb').read()).decode(); print('лист деталей', len(sheet_b64) // 1024, 'КБ (base64)')
uvx = np.where(TEXI == 0, UV[:, 0] * 0.5, np.where(TEXI == 1, 0.5 + UV[:, 0] * 0.5, 2040 / 2048)); uvy = np.where((TEXI == 0) | (TEXI == 1), UV[:, 1], 1016 / 1024)
# вершины других материалов (рот, глаза) — на нейтральный квадрат
def bil(A, u, v):
    h, w = A.shape[:2]; x = (u % 1) * (w - 1); y = (v % 1) * (h - 1); x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (A[y0, x0] * (1 - fx) + A[y0, x1] * fx) * (1 - fy) + (A[y1, x0] * (1 - fx) + A[y1, x1] * fx) * fy
col = np.zeros((n, 3)); m0 = TEXI == 0; m1 = TEXI == 1
col[m0] = bil(A0, UV[m0, 0], UV[m0, 1]); col[m1] = bil(A1, UV[m1, 0], UV[m1, 1])
col[~(m0 | m1)] = 0.3
red = np.clip(((col[:, 0] - col[:, 1]) / (col.sum(1) + 1e-3)) * 5 - 0.55, 0, 1); red = sstep(0.0, 0.6, red)        # красно-коричневое: гребень, гребневые полосы на клюве
mouth = np.isin(PID, [23, 24]).astype(np.float64)

# ------------------------------------------------------------------ перепонка: локально плоские листы (PCA по соседям)
tree = cKDTree(V); mem = np.zeros(n)
idxs = tree.query_ball_point(V, 0.12)
for i in range(n):
    nb = idxs[i]
    if len(nb) < 6: continue
    X = V[nb] - V[nb].mean(0); ev = np.linalg.eigvalsh(X.T @ X / len(nb))
    if ev[2] > 1e-9 and ev[1] / ev[2] > 0.12 and ev[0] / ev[2] < 0.03: mem[i] = 1
mem = np.clip(gaussian_filter(mem, 0) , 0, 1)
# сглаживание по соседям
mem2 = np.array([mem[nb].mean() if len(nb) else 0 for nb in idxs]); mem = sstep(0.35, 0.75, mem2)
mem[m1] *= 0.0 if False else 1.0
print('перепонка', int((mem > 0.5).sum()), 'красное', int((red > 0.5).sum()), 'пасть', int(mouth.sum()))

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 5000
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([uvx, uvy], 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'm': b64(np.round(mem * 255).astype(np.uint8)), 'r': b64(np.round(red * 255).astype(np.uint8)), 'q': b64(np.round(mouth * 255).astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 5) for c in p] for p in restP],
     'clip': {'dur': DUR, 'nf': NF, 'q': b64(np.round(QF * 32767).astype(np.int16)), 'tb': {str(i): [[round(float(c), 5) for c in r_] for r_ in TF[i]] for i in TF}},
     'eyes': [[round(float(c), 5) for c in e] for e in eyeC], 'eyeR': round(float(eyeR), 5), 'tex': sheet_b64}
open(out, 'w').write('// Летающий класс: Pteranodon (Jurassic Park: The Game) — подготовлено tools/ptn_bake.py из GLB. Не редактировать.\nexport const PTN = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg: np.savez(dbg, V=V, F=F, mem=mem, red=red, mouth=mouth, PID=PID, SI=SI, SW=SW, par=np.array(par), restP=restP, QF=QF)

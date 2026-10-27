# Игрок «Травоядный»: Parasaurolophus (Jurassic Park: The Game, GLB со скелетом) → game/para.js.
# Запуск: python3 -I tools/para_bake.py <sk94_parasaurolophus.glb> <выход para.js> [отладка.npz]
# Как tools/vel_bake.py: оси в игровые (x вперёд, y вверх, z вбок), скелет «осевой», клипы (стойка, шаг, бег) пересчитаны во вращения этого скелета.
# Свои глаза модели (радужка + зрачок) сохраняются: их текстура кладётся в лист деталей; прозрачная роговица выкидывается; веки собираются в игре.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
from scipy.ndimage import gaussian_filter

glbf, out = sys.argv[1:3]
dbg = sys.argv[3] if len(sys.argv) > 3 else None
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
def image(i):
    bv = J['bufferViews'][J['images'][i]['bufferView']]; o = bv.get('byteOffset', 0); return Image.open(io.BytesIO(BIN[o:o + bv['byteLength']])).convert('RGB')

G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)       # (xm,ym,zm) → (zm, ym, -xm)
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
par = [jidx.get(parent_node.get(n), -1) for n in joints]
assert all(p < i for i, p in enumerate(par) if p >= 0), 'порядок костей'
def local(n):
    nd = nodes[n]; R = qmat(nd.get('rotation', [0, 0, 0, 1])); t = np.array(nd.get('translation', [0, 0, 0]), dtype=np.float64)
    s = np.array(nd.get('scale', [1, 1, 1]), dtype=np.float64); return R * s, t
Rw = [None] * NB; Pw = [None] * NB
for i, n in enumerate(joints):
    Rl, t = local(n)
    if par[i] < 0: Rw[i] = Rl; Pw[i] = t
    else: Rw[i] = Rw[par[i]] @ Rl; Pw[i] = Pw[par[i]] + Rw[par[i]] @ t
ibm = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).astype(np.float64)
err = max(np.abs(np.linalg.inv(ibm[i].T)[:3, 3] - Pw[i]).max() for i in range(NB)); print('расхождение покоя/IBM', round(err, 5))
restP = np.array([G @ p for p in Pw])

# ------------------------------------------------------------------ клипы
byname = {a['name']: a for a in J['animations']}
CLIPS = [('idle', 'sk94_idle_parasaurolophus', 15, True), ('walk', 'sk94_move_parasaurolophuswalk', 30, True), ('run', 'sk94_move_parasaurolophusrun', 30, True), ('eat', 'sk94_idle_parasaurolophuseating', 15, True)]
def slerp(a, b, t):
    dp = np.dot(a, b)
    if dp < 0: b = -b; dp = -dp
    if dp > 0.9995: r = a + (b - a) * t
    else:
        th = np.arccos(dp); r = (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)
    return r / np.linalg.norm(r)
def bake_clip(an, fps, loop):
    chan = {}
    for c in an['channels']:
        s = an['samplers'][c['sampler']]; chan[(c['target']['node'], c['target']['path'])] = (acc(s['input']).ravel().astype(np.float64), acc(s['output']).astype(np.float64))
    DUR = max(float(v[0].max()) for v in chan.values())
    def sample(key, t, default):
        if key not in chan: return default
        ts, vs = chan[key]; t = min(t, ts[-1]); k = np.searchsorted(ts, t, side='right') - 1
        if k < 0: return vs[0]
        if k >= len(ts) - 1: return vs[-1]
        u = (t - ts[k]) / (ts[k + 1] - ts[k]) if ts[k + 1] > ts[k] else 0
        return slerp(vs[k], vs[k + 1], u) if key[1] == 'rotation' else vs[k] + (vs[k + 1] - vs[k]) * u
    NF = int(round(DUR * fps)) + (0 if loop else 1)
    QF = np.zeros((NF, NB, 4)); TF = {}
    for f in range(NF):
        t = f / fps; Delta = [None] * NB; Rwa = [None] * NB
        for i, n in enumerate(joints):
            rot = sample((n, 'rotation'), t, np.array(nodes[n].get('rotation', [0, 0, 0, 1]))); Rl = qmat(rot)
            Rwa[i] = Rl if par[i] < 0 else Rwa[par[i]] @ Rl
            Delta[i] = G @ (Rwa[i] @ Rw[i].T) @ G.T
        for i, n in enumerate(joints):
            q = mq(Delta[i] if par[i] < 0 else Delta[par[i]].T @ Delta[i])
            if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            QF[f, i] = q
            if (n, 'translation') in chan:
                tl = sample((n, 'translation'), t, np.array(nodes[n].get('translation', [0, 0, 0])))
                tw = tl if par[i] < 0 else Rw[par[i]] @ tl
                TF.setdefault(i, []).append(G @ tw)
    tb = {}
    for i in TF:
        a = np.array(TF[i]); rest_t = restP[i] - (restP[par[i]] if par[i] >= 0 else 0)
        if par[i] < 0: rest_t = restP[i]
        if np.ptp(a, axis=0).max() > (0.004 if par[i] < 0 else 0.03): tb[str(i)] = [[round(float(c), 4) for c in r] for r in a]
    return DUR, NF, QF, tb
clips = {}
for name, an, fps, loop in CLIPS:
    DUR, NF, QF, tb = bake_clip(byname[an], fps, loop)
    print('клип', name, 'длит', round(DUR, 2), 'кадров', NF, 'костей с позицией', list(tb.keys()))
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}

# ------------------------------------------------------------------ сетка
prims = J['meshes'][0]['primitives']; DROP = {2, 3}          # прозрачная роговица (transmission) не нужна
V = []; N = []; UV = []; SI = []; SW = []; F = []; PID = []; TEXI = []; base = 0; EYEP = {}
for k, p in enumerate(prims):
    a = p['attributes']; pos = acc(a['POSITION']).astype(np.float64)
    if k in (1, 4): EYEP[k] = pos
    if k in DROP: continue
    nor = acc(a['NORMAL']).astype(np.float64); n = len(pos); uv = acc(a['TEXCOORD_0']).astype(np.float64)
    ji = acc(a['JOINTS_0']).astype(np.int64); jw = acc(a['WEIGHTS_0']).astype(np.float64)
    if jw.max() > 1.5: jw = jw / jw.max()
    ix = acc(p['indices']).astype(np.int64).ravel().reshape(-1, 3)
    m = J['materials'][p['material']]; ti = m['pbrMetallicRoughness'].get('baseColorTexture', {}).get('index', -1)
    V.append(pos @ G.T); N.append(nor @ G.T); UV.append(uv); SI.append(ji); SW.append(jw); F.append(ix + base); PID += [k] * n; TEXI += [ti] * n; base += n
V = np.concatenate(V); N = np.concatenate(N); UV = np.concatenate(UV); SI = np.concatenate(SI); SW = np.concatenate(SW); F = np.concatenate(F)
PID = np.array(PID); TEXI = np.array(TEXI); n = len(V); SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
eyes = []
for k in (1, 4):
    Eg = EYEP[k] @ G.T; c = (Eg.max(0) + Eg.min(0)) / 2; r = (Eg.max(0) - Eg.min(0)).max() / 2; eyes.append([c, r]); print('глаз', k, c.round(3), round(r, 3))

# ------------------------------------------------------------------ лист деталей: атласы a (текстура 3) и b (текстура 4) → карта детализации; радужка (текстура 1) — как есть
tA = np.array(image(3)).astype(np.float64) / 255; tB = np.array(image(4)).astype(np.float64) / 255; tI = np.array(image(1)).astype(np.float64) / 255
def detail(A):
    L = A @ np.array([0.3, 0.55, 0.15]); lo = gaussian_filter(L, 18); mean = L[L > 0.12].mean()
    hp = L / np.maximum(lo, 0.05)
    return (np.clip(hp, 0.5, 1.6) * np.clip(gaussian_filter(L, 3) / mean, 0.25, 1.9) ** 0.45) ** 0.6      # контраст сжат: кремовые чешуйки бёдер не выглядят заплатами
DA, DB = detail(tA), detail(tB)
SHEET = np.ones((1280, 2048, 3)) * 0.5
SHEET[:1024, :1024] = (DA / 2.0)[..., None]; SHEET[:1024, 1024:] = (DB / 2.0)[..., None]
SHEET[1024:1280, :256] = tI * 0.78                                   # радужка чуть темнее оригинала
SHEET[1272:1280, 2040:2048] = 0.0                                    # чёрный пиксель — зрачок-диск
Image.fromarray(np.clip(SHEET * 255, 0, 255).astype(np.uint8)).save('/tmp/para_sheet.jpg', quality=72, subsampling=2)
sheet_b64 = base64.b64encode(open('/tmp/para_sheet.jpg', 'rb').read()).decode(); print('лист деталей', len(sheet_b64) // 1024, 'КБ')
W_, H_ = 2048.0, 1280.0
uvx = np.where(TEXI == 3, UV[:, 0] * 1024 / W_, np.where(TEXI == 4, (1024 + UV[:, 0] * 1024) / W_, np.where(TEXI == 1, (2 + UV[:, 0] * 252) / W_, 2044 / W_)))
uvy = np.where((TEXI == 3) | (TEXI == 4), UV[:, 1] * 1024 / H_, np.where(TEXI == 1, (1026 + UV[:, 1] * 252) / H_, 1276 / H_))
def bil(A, u, v):
    h, w = A.shape[:2]; x = (u % 1) * (w - 1); y = (v % 1) * (h - 1); x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (A[y0, x0] * (1 - fx) + A[y0, x1] * fx) * (1 - fy) + (A[y1, x0] * (1 - fx) + A[y1, x1] * fx) * fy
col = np.zeros((n, 3)); mA = TEXI == 3; mB = TEXI == 4
col[mA] = bil(tA, UV[mA, 0], UV[mA, 1]); col[mB] = bil(tB, UV[mB, 0], UV[mB, 1])
# рот: тёмно-красное внутри (примитивы 7, 9, 10 — нижняя челюсть, язык, нёбо)
red = np.clip((col[:, 0] - col[:, 1]) * 5 - 0.1, 0, 1) * (col[:, 0] > col[:, 2])
mouthP = (np.isin(PID, [9, 10]) & (V[:, 1] < 2.66)).astype(np.float64)
lum = col @ np.array([0.3, 0.55, 0.15])
mouth = np.clip(red * mouthP * 1.2, 0, 1) * (lum < 0.5)
eyemask = (TEXI <= 1) & (TEXI >= 0)
print('рот', int((mouth > 0.4).sum()), 'глаз-вершин', int(eyemask.sum()))

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 5000
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([uvx, uvy], 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'm': b64(np.round(mouth * 255).astype(np.uint8)), 'e': b64(eyemask.astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'clips': clips,
     'eyes': [[round(float(c), 5) for c in e[0]] for e in eyes], 'eyeR': round(float((eyes[0][1] + eyes[1][1]) / 2), 5), 'tex': sheet_b64}
open(out, 'w').write('// Игрок «Травоядный»: Parasaurolophus (Jurassic Park: The Game) — подготовлено tools/para_bake.py из GLB. Не редактировать.\nexport const PARA = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg: np.savez(dbg, V=V, F=F, mouth=mouth, PID=PID, SI=SI, SW=SW, par=np.array(par), restP=restP)

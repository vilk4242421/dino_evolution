# Враги «Раптор» / «Магмовый раптор»: Velociraptor (Jurassic Park: The Game, GLB со скелетом, облегчённая сетка) → game/vel.js.
# Запуск: python3 tools/vel_bake.py <sk90_velociraptorlow.glb> <выход vel.js> [отладка.npz]
# Делает: читает сетку (21 примитив), выкидывает родные глаза (глаза и веки собираются в игре), переводит оси в игровые
# (x вперёд, y вверх, z вбок), делает скелет «осевым» (у всех костей единичный поворот покоя), пересчитывает клипы
# (покой, шаг, бег, укус, шипение) в вращения этого скелета; строит маски (рот, зубы, когти) и карту деталей (серая копия атласов,
# сохраняющая полосы шкуры) — игра умножает её на цвет по палитре врага.
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
CLIPS = [('idle', 'sk90_idle_velociraptor', 15, True), ('walk', 'sk90_move_velociraptorwalk', 30, True), ('run', 'sk90_move_velociraptorrun', 30, True),
         ('bite', 'sk90_velociraptor_biteforward', 30, False)]
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
prims = J['meshes'][0]['primitives']; DROP = {0, 1}
EYE = None
V = []; N = []; UV = []; SI = []; SW = []; F = []; PID = []; TEXI = []; base = 0
for k, p in enumerate(prims):
    a = p['attributes']; pos = acc(a['POSITION']).astype(np.float64)
    if k == 0: EYE = pos
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
# глаза: два шара — по знаку z (бок) в игровых осях
Eg = EYE @ G.T; eyes = []
for sgn in (1, -1):
    m = (Eg[:, 2] * sgn) > 0; c = Eg[m].mean(0); r = (Eg[m].max(0) - Eg[m].min(0)).max() / 2; eyes.append([c, r]); print('глаз', sgn, c.round(3), round(r, 3))

# ------------------------------------------------------------------ текстуры → карта деталей (атласы a (текстура 2) и b (текстура 3)): сохраняем полосы шкуры
tA = np.array(image(2)).astype(np.float64) / 255; tB = np.array(image(3)).astype(np.float64) / 255
def detail(A):
    L = A @ np.array([0.3, 0.55, 0.15]); lo = gaussian_filter(L, 18); mean = L[L > 0.12].mean()
    hp = L / np.maximum(lo, 0.05); lf = L / mean
    return np.clip(hp, 0.5, 1.6) * np.clip(gaussian_filter(L, 3) / mean, 0.25, 1.9) ** 0.85
DA, DB = detail(tA), detail(tB)
SHEET = np.ones((1024, 2048)); SHEET[:, :1024] = DA / 2.0; SHEET[:, 1024:] = DB / 2.0
SHEET[1008:1024, 2032:2048] = 0.5
Image.fromarray(np.clip(SHEET * 255, 0, 255).astype(np.uint8)).convert('L').save('/tmp/vel_sheet.jpg', quality=80)
sheet_b64 = base64.b64encode(open('/tmp/vel_sheet.jpg', 'rb').read()).decode(); print('лист деталей', len(sheet_b64) // 1024, 'КБ')
uvx = np.where(TEXI == 2, UV[:, 0] * 0.5, np.where(TEXI == 3, 0.5 + UV[:, 0] * 0.5, 2040 / 2048)); uvy = np.where((TEXI == 2) | (TEXI == 3), UV[:, 1], 1016 / 1024)
def bil(A, u, v):
    h, w = A.shape[:2]; x = (u % 1) * (w - 1); y = (v % 1) * (h - 1); x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (A[y0, x0] * (1 - fx) + A[y0, x1] * fx) * (1 - fy) + (A[y1, x0] * (1 - fx) + A[y1, x1] * fx) * fy
col = np.zeros((n, 3)); mA = TEXI == 2; mB = TEXI == 3
col[mA] = bil(tA, UV[mA, 0], UV[mA, 1]); col[mB] = bil(tB, UV[mB, 0], UV[mB, 1])
# рот: фиолетовое (b > g, r > g); зубы/когти: светлые бежевые детали на атласе a (примитивы рта) — по примитивам 3, 4 (рот целиком), светлота
purple = np.clip((col[:, 2] - col[:, 1]) * 6 + (col[:, 0] - col[:, 1]) * 2, 0, 1) * mA
mouthP = np.isin(PID, [3, 4]).astype(np.float64)
lum = col @ np.array([0.3, 0.55, 0.15])
teeth = np.clip((lum - 0.58) * 6, 0, 1) * mouthP * (1 - np.clip(purple * 2, 0, 1))
mouth = np.clip(np.maximum(purple, mouthP * 0.9) - teeth, 0, 1)
# когти: кончики пальцев по костям (рука: 69, 72, 75 / 86, 89, 92; нога: 114, 118, 120, 122 / 130, 134, 136, 138) — делаются в игре по кости
print('рот', int((mouth > 0.5).sum()), 'зубы', int((teeth > 0.5).sum()))

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 5000
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([uvx, uvy], 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'm': b64(np.round(mouth * 255).astype(np.uint8)), 't': b64(np.round(teeth * 255).astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'clips': clips,
     'eyes': [[round(float(c), 5) for c in e[0]] for e in eyes], 'eyeR': round(float((eyes[0][1] + eyes[1][1]) / 2), 5), 'tex': sheet_b64}
open(out, 'w').write('// Враги-рапторы: Velociraptor (Jurassic Park: The Game) — подготовлено tools/vel_bake.py из GLB. Не редактировать.\nexport const VEL = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg: np.savez(dbg, V=V, F=F, mouth=mouth, teeth=teeth, PID=PID, SI=SI, SW=SW, par=np.array(par), restP=restP)

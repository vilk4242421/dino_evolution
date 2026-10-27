# Модели Jurassic Park: The Game (GLB со скелетом) → game/<key>.js.  Обобщение tools/para_bake.py для компсогната, троодона, геррерозавра.
# Запуск: python3 -I tools/jp_bake.py <comp|troo|herr> <model.glb> <выход.js> [отладка.npz]
# Оси игры: x вперёд, y вверх, z вбок. Скелет «осевой» (повороты покоя тождественные), клипы — вращения этого скелета (int16-кватернионы) + позиции корня.
# Клипы: idle + лестница походок l0 (медленная) … lN (быстрая) — рантайм смешивает соседние по скорости. Автоопределение: голова (кость с наибольшим числом детей), шея (цепочка до плеч), стопы (листья скелета у земли), челюсть (кость головы с наибольшим размахом
# в клипе укуса/шипения). Раскраска — карта деталей (высокие частоты атласов) × палитра в игре; радужка и зрачок модели сохранены; роговица (transmission) выкинута.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
from scipy.ndimage import gaussian_filter

key, glbf, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
CFG = {
    'comp': dict(atlas=[0, 4], iris=2, pupil=1, dark=[], skin=[], jawclip='sk91_compsognathus_biteforward', zero_lat=True, name='Compsognathus', tag='COMP',
                 clips=[('idle', 'sk91_idle_compsognathus', 15, True), ('l0', 'sk91_compsognathusrun_swerve', 30, True)]),
    'herr': dict(atlas=[0, 4], iris=2, pupil=3, dark=[], skin=[], jawclip='sk90_action_102herrerasaurusbitespipe', zero_lat=False, name='Herrerasaurus', tag='HERR',
                 clips=[('idle', 'sk90_herrerasaurus_lookup', 15, True), ('l0', 'sk90_move_herrerasauruswalk', 30, True)]),
    'troo': dict(atlas=[0, 1], iris=4, pupil=None, dark=[2], skin=[23], dropdark=True, jawclip='sk91_troodon_hiss', zero_lat=False, name='Troodon', tag='TROO',
                 clips=[('idle', 'sk91_idle_troodon', 15, True), ('l0', 'sk91_move_troodoncreep', 30, True), ('l1', 'sk91_move_troodonjog', 30, True), ('l2', 'sk91_move_troodonrunfast', 30, True)]),
}[key]
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
def image(i):
    bv = J['bufferViews'][J['images'][J['textures'][i]['source']]['bufferView']]; o = bv.get('byteOffset', 0); return Image.open(io.BytesIO(BIN[o:o + bv['byteLength']])).convert('RGBA')

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
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
def subtree(i): s = [i]; [s.extend(subtree(c)) for c in kids[i]]; return s
head = max(range(NB), key=lambda i: len(kids[i]) if restP[i][1] > restP[:, 1].mean() else -1)
neck = []; b = par[head]
while b >= 0 and len(kids[b]) == 1: neck.append(b); b = par[b]
neck = neck[::-1]
height = restP[:, 1].max() - restP[:, 1].min()
tips = [i for i in range(NB) if not kids[i] and restP[i][1] < restP[:, 1].min() + 0.1 * height and restP[i][1] <= restP[par[i]][1] + 1e-6 or (not kids[i] and restP[i][1] < restP[:, 1].min() + 0.05 * height)]
print('голова', head, 'шея', neck, 'стопы', tips, 'высота', round(height, 3))

# ------------------------------------------------------------------ клипы
byname = {a['name']: a for a in J['animations']}
def slerp(a, b, t):
    dp = np.dot(a, b)
    if dp < 0: b = -b; dp = -dp
    if dp > 0.9995: r = a + (b - a) * t
    else:
        th = np.arccos(dp); r = (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)
    return r / np.linalg.norm(r)
def bake_clip(an, fps, loop, zero_lat=False, want_fk=False):
    chan = {}
    for c in an['channels']:
        s = an['samplers'][c['sampler']]; chan[(c['target']['node'], c['target']['path'])] = (acc(s['input']).ravel().astype(np.float64), acc(s['output']).astype(np.float64))
    DUR = max(float(v[0].max()) for v in chan.values())
    def sample(k_, t, default):
        if k_ not in chan: return default
        ts, vs = chan[k_]; t = min(t, ts[-1]); k = np.searchsorted(ts, t, side='right') - 1
        if k < 0: return vs[0]
        if k >= len(ts) - 1: return vs[-1]
        u = (t - ts[k]) / (ts[k + 1] - ts[k]) if ts[k + 1] > ts[k] else 0
        return slerp(vs[k], vs[k + 1], u) if k_[1] == 'rotation' else vs[k] + (vs[k + 1] - vs[k]) * u
    NF = int(round(DUR * fps)) + (0 if loop else 1)
    QF = np.zeros((NF, NB, 4)); TF = {}; FK = np.zeros((NF, NB, 3))
    rt = chan.get((joints[0], 'translation'))
    lat_mean = float(rt[1][:, 0].mean()) if (zero_lat and rt is not None) else None
    for f in range(NF):
        t = f / fps; Delta = [None] * NB; Rwa = [None] * NB; Pa = [None] * NB
        for i, n in enumerate(joints):
            rot = sample((n, 'rotation'), t, np.array(nodes[n].get('rotation', [0, 0, 0, 1]))); Rl = qmat(rot)
            tl = sample((n, 'translation'), t, np.array(nodes[n].get('translation', [0, 0, 0])))
            if i == 0 and lat_mean is not None: tl = np.array([lat_mean, tl[1], tl[2]])
            Rwa[i] = Rl if par[i] < 0 else Rwa[par[i]] @ Rl
            Pa[i] = tl if par[i] < 0 else Pa[par[i]] + Rwa[par[i]] @ tl * 1.0
            FK[f, i] = G @ Pa[i]
            Delta[i] = G @ (Rwa[i] @ Rw[i].T) @ G.T
        for i, n in enumerate(joints):
            q = mq(Delta[i] if par[i] < 0 else Delta[par[i]].T @ Delta[i])
            if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            QF[f, i] = q
            if (n, 'translation') in chan or (i == 0 and lat_mean is not None):
                tl = sample((n, 'translation'), t, np.array(nodes[n].get('translation', [0, 0, 0])))
                if i == 0 and lat_mean is not None: tl = np.array([lat_mean, tl[1], tl[2]])
                tw = tl if par[i] < 0 else Rw[par[i]] @ tl
                TF.setdefault(i, []).append(G @ tw)
    tb = {}
    for i in TF:
        a = np.array(TF[i])
        if np.ptp(a, axis=0).max() > (0.004 * height / 1.0 if par[i] < 0 else 0.03 * height): tb[str(i)] = [[round(float(c), 5) for c in r] for r in a]
    return DUR, NF, QF, tb, FK
def stance_speed(FK, fps):
    # средняя скорость опорной стопы назад (ед. модели/с): кадры, когда стопа в нижней четверти своего размаха по высоте
    vs = []
    for tp in tips:
        y = FK[:, tp, 1]; z = FK[:, tp, 0]; rng = y.max() - y.min()
        if rng < 0.02 * height: continue
        low = y < y.min() + 0.25 * rng; v = (np.roll(z, -1) - z) * fps
        sel = low & (v < 0)
        if sel.sum() > 1: vs.append(-v[sel].mean())
    return float(np.mean(vs)) if vs else 0.0
clips = {}; jawamp = None
for name, an, fps, loop in CFG['clips']:
    DUR, NF, QF, tb, FK = bake_clip(byname[an], fps, loop, CFG['zero_lat'])
    sv = stance_speed(FK, fps) if name != 'idle' else 0.0
    low = FK[:, tips, 1].min(1)
    print('клип', name, 'длит', round(DUR, 2), 'кадров', NF, 'костей с позицией', list(tb.keys()), 'скорость', round(sv, 3), 'низ стоп', round(float(low.min()), 4), round(float(low.max()), 4))
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'v': round(sv, 4), 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}
# челюсть: кость поддерева головы с наибольшим размахом в клипе укуса/шипения
_, _, QJ, _, _ = bake_clip(byname[CFG['jawclip']], 15, False)
hs = [b for b in subtree(head) if b != head and abs(restP[b][2]) < 0.03 * height]       # челюсть на средней линии (веки и брови — парные кости сбоку)
amp = {b: float(np.degrees(2 * np.arccos(np.clip(np.abs(QJ[:, b, 3]), 0, 1))).max()) for b in hs}
top = sorted(amp.items(), key=lambda kv: -kv[1])[:5]; print('кандидаты на челюсть', [(b, round(a, 1)) for b, a in top])
jaw = top[0][0]
# ось раскрытия: поворот в клипе вокруг бокового вектора (z в осях игры); знак — по максимальному кадру
f_ = int(np.argmax(np.abs(QJ[:, jaw, :3]).max(1))); qj = QJ[f_, jaw]; jsign = float(np.sign(qj[2]) if abs(qj[2]) > 1e-6 else 1.0)
print('челюсть', jaw, 'размах', round(amp[jaw], 1), '° знак оси z', jsign, 'кватернион', np.round(qj, 3))

# ------------------------------------------------------------------ сетка
prims = J['meshes'][0]['primitives']
def is_trans(p): return 'KHR_materials_transmission' in J['materials'][p['material']].get('extensions', {})
DROP = {k for k, p in enumerate(prims) if is_trans(p)}
V = []; N = []; UV = []; SI = []; SW = []; F = []; PID = []; TEXI = []; base = 0; CORN = []
for k, p in enumerate(prims):
    a = p['attributes']; pos = acc(a['POSITION']).astype(np.float64)
    m = J['materials'][p['material']]; ti = m['pbrMetallicRoughness'].get('baseColorTexture', {}).get('index', -1)
    if k in DROP: CORN.append(pos @ G.T); continue
    if CFG.get('dropdark') and ti in CFG['dark'] and k not in CFG['skin']: continue      # перья-карточки (форма — в альфе текстуры, у нас без альфы дают квадратные «зубцы»)
    nor = acc(a['NORMAL']).astype(np.float64); n = len(pos); uv = acc(a['TEXCOORD_0']).astype(np.float64)
    ji = acc(a['JOINTS_0']).astype(np.int64); jw = acc(a['WEIGHTS_0']).astype(np.float64)
    if jw.max() > 1.5: jw = jw / jw.max()
    ix = acc(p['indices']).astype(np.int64).ravel().reshape(-1, 3)
    V.append(pos @ G.T); N.append(nor @ G.T); UV.append(uv); SI.append(ji); SW.append(jw); F.append(ix + base); PID += [k] * n; TEXI += [ti] * n; base += n
V = np.concatenate(V); N = np.concatenate(N); UV = np.concatenate(UV); SI = np.concatenate(SI); SW = np.concatenate(SW); F = np.concatenate(F)
PID = np.array(PID); TEXI = np.array(TEXI); n = len(V); SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(3), V.max(0).round(3), 'роговиц-примитивов', len(CORN))
# глаза: центр и радиус по роговице; левый/правый по знаку z (бок в осях игры)
allc = np.concatenate(CORN) if CORN else np.zeros((0, 3)); eyes = []
for sd in (1, -1):
    pts = allc[(allc[:, 2] * sd) > 0]
    c = (pts.max(0) + pts.min(0)) / 2; r = (pts.max(0) - pts.min(0)).max() / 2; eyes.append([c, r]); print('глаз', sd, c.round(4), round(r, 4))

# ------------------------------------------------------------------ лист деталей: два атласа 1024 + радужка 256 + чёрный пиксель (зрачок) + нейтральный
A0, A1 = [np.array(image(i)).astype(np.float64) / 255 for i in CFG['atlas']]
def rgb(A):
    al = A[..., 3:4]; return A[..., :3] * al + 0.5 * (1 - al)
tA, tB = rgb(A0), rgb(A1)
def detail(A):
    L = A @ np.array([0.3, 0.55, 0.15]); lo = gaussian_filter(L, 18); mean = L[L > 0.12].mean()
    hp = L / np.maximum(lo, 0.05)
    return (np.clip(hp, 0.5, 1.6) * np.clip(gaussian_filter(L, 3) / mean, 0.25, 1.9) ** 0.45) ** 0.6
DA, DB = detail(tA), detail(tB)
SHEET = np.ones((1280, 2048, 3)) * 0.5
SHEET[:1024, :1024] = (DA / 2.0)[..., None]; SHEET[:1024, 1024:] = (DB / 2.0)[..., None]
tI = np.array(image(CFG['iris']).resize((256, 256))).astype(np.float64) / 255; tI = tI[..., :3] * tI[..., 3:4] + 0.0 * (1 - tI[..., 3:4])
SHEET[1024:1280, :256] = tI * 0.78
SHEET[1272:1280, 2040:2048] = 0.0
Image.fromarray(np.clip(SHEET * 255, 0, 255).astype(np.uint8)).save('/tmp/jp_sheet.jpg', quality=72, subsampling=2)
sheet_b64 = base64.b64encode(open('/tmp/jp_sheet.jpg', 'rb').read()).decode(); print('лист деталей', len(sheet_b64) // 1024, 'КБ')
W_, H_ = 2048.0, 1280.0
tA_i, tB_i, tI_i, tP_i = CFG['atlas'][0], CFG['atlas'][1], CFG['iris'], CFG['pupil']
isA = TEXI == tA_i; isB = TEXI == tB_i; isI = TEXI == tI_i; isP = (TEXI == tP_i) if tP_i is not None else np.zeros(n, bool)
isDark = np.isin(TEXI, CFG['dark']) & ~np.isin(PID, CFG['skin']); isSkin = np.isin(PID, CFG['skin'])
uvx = np.full(n, 1500 / W_); uvy = np.full(n, 1150 / H_)
uvx = np.where(isA, UV[:, 0] * 1024 / W_, uvx); uvx = np.where(isB, (1024 + UV[:, 0] * 1024) / W_, uvx); uvx = np.where(isI, (2 + UV[:, 0] * 252) / W_, uvx); uvx = np.where(isP, 2044 / W_, uvx)
uvy = np.where(isA | isB, UV[:, 1] * 1024 / H_, uvy); uvy = np.where(isI, (1026 + UV[:, 1] * 252) / H_, uvy); uvy = np.where(isP, 1276 / H_, uvy)
def bil(A, u, v):
    h, w = A.shape[:2]; x = (u % 1) * (w - 1); y = (v % 1) * (h - 1); x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (A[y0, x0] * (1 - fx) + A[y0, x1] * fx) * (1 - fy) + (A[y1, x0] * (1 - fx) + A[y1, x1] * fx) * fy
col = np.zeros((n, 3)); col[isA] = bil(tA, UV[isA, 0], UV[isA, 1]); col[isB] = bil(tB, UV[isB, 0], UV[isB, 1])
# рот: тёмно-красное внутри — красные участки атласа у вершин поддерева головы (там, где кость — голова/челюсть/зубы)
domb = SI[np.arange(n), np.argmax(SW, 1)]; headset = np.zeros(NB, bool); headset[subtree(head)] = True
red = np.clip((col[:, 0] - col[:, 1]) * 5 - 0.1, 0, 1) * (col[:, 0] > col[:, 2]); lum = col @ np.array([0.3, 0.55, 0.15])
mouth = np.clip(red * headset[domb] * 1.2, 0, 1) * (lum < 0.5)
eyemask = (isI | isP)
print('рот', int((mouth > 0.4).sum()), 'глаз-вершин', int(eyemask.sum()), 'тёмных', int(isDark.sum()))

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 3000.0 / max(np.abs(V).max(), 1e-9) * 1.0; SC = float(min(SC * 10, 32000.0 / np.abs(V).max()))
SC = float(int(32000.0 / np.abs(V).max()))
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([uvx, uvy], 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'm': b64(np.round(mouth * 255).astype(np.uint8)), 'e': b64(eyemask.astype(np.uint8)), 'k': b64(isDark.astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 6) for c in p] for p in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': jsign,
     'eyes': [[round(float(c), 6) for c in e[0]] for e in eyes], 'eyeR': [round(float(e[1]), 6) for e in eyes], 'height': round(float(height), 5), 'tex': sheet_b64}
open(out, 'w').write('// ' + CFG['name'] + ' (Jurassic Park: The Game) — подготовлено tools/jp_bake.py из GLB. Не редактировать.\nexport const ' + CFG['tag'] + ' = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ', 'масштаб квантования', SC)
if dbg: np.savez(dbg, V=V, F=F, mouth=mouth, PID=PID, SI=SI, SW=SW, par=np.array(par), restP=restP, TEXI=TEXI, UV=UV, col=col)

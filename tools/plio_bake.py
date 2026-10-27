# Игрок «Плиозавр»: Pliosaurus (Sketchfab, GLB со скелетом из 44 костей и клипами Idle / Swim_Slow / Swim_Fast / Attack_Bite, текстуры 4096²) → game/plio.js.
# Запуск: python3 -I tools/plio_bake.py <Pliosaurus.glb> <выход plio.js> [отладка.npz]
# Делает (по образцу tools/jp_bake.py): читает сетки (тело, зубы верхние/нижние, язык; родные глаза выбрасываются — игра ставит свои и свои веки), скелет и клипы из GLB,
# переводит оси в игровые (x вперёд, y вверх, z вбок), делает скелет «осевым» (повороты покоя тождественные, клипы — вращения в этих осях), начало координат — центр тела.
# Поступательное движение кости COG (она единственная двигается в клипах) переносится в позицию корня — рантайм двигает только корень.
# Клипы: idle (Idle), l0 (Swim_Slow), l1 (Swim_Fast) — рантайм смешивает их по скорости, стоя на месте играет только idle. Укус — процедурный (челюсть/шея), клип Attack_Bite нужен только чтобы найти ось челюсти.
# Раскраска: карта деталей из текстуры тела (2 лист: 0,5 = нейтрально, остальное — рельеф/пятна шкуры) × палитра игрока; рот — по розовым участкам текстуры; зубы и язык — фиксированные цвета (R.vc + R.vm).
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt
Image.MAX_IMAGE_PIXELS = None
glbf, out = sys.argv[1:3]
dbg = sys.argv[3] if len(sys.argv) > 3 else None
LEN_UNITS = None
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
    bv = J['bufferViews'][J['images'][J['textures'][i]['source']]['bufferView']]; o = bv.get('byteOffset', 0); return Image.open(io.BytesIO(BIN[o:o + bv['byteLength']]))
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)       # (xm,ym,zm) → (zm, ym, -xm): нос модели +z → +x игры
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
names = [nodes[n]['name'] for n in joints]; BID = {nm: i for i, nm in enumerate(names)}
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
assert err < 1e-3
# масштабы в узлах скелета должны быть единичными (клипы масштаб не меняют)
print('масштабы покоя', sorted({tuple(np.round(nodes[n].get('scale', [1, 1, 1]), 3)) for n in joints}))
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
def subtree(i): s = [i]; [s.extend(subtree(c)) for c in kids[i]]; return s
head = BID['head']; jaw = BID['jaw']; neck = [BID['neck_02'], BID['neck_03']]
# ------------------------------------------------------------------ сетки
MES = {m['name']: m for m in J['meshes']}
def prim(name):
    p = MES[name]['primitives'][0]; a = p['attributes']
    return dict(pos=acc(a['POSITION']).astype(np.float64), nor=acc(a['NORMAL']).astype(np.float64), uv=acc(a['TEXCOORD_0']).astype(np.float64),
                ji=acc(a['JOINTS_0']).astype(np.int64), jw=acc(a['WEIGHTS_0']).astype(np.float64), ix=acc(p['indices']).astype(np.int64).ravel().reshape(-1, 3))
body, teethL, teethU, tongue = prim('Pliosaurus_Body'), prim('Pliosaurus_Teeth_Lower'), prim('Pliosaurus_Teeth_Upper'), prim('Pliosaurus_Tongue')
def cluster(p, cell):      # упрощение сетки слиянием вершин по сетке (глаза — гладкие шары, по 6 тыс. вершин не нужны: лимит 65535 индексов)
    key = np.floor(p['pos'] / cell).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.ravel(); m = len(first); out = {}
    cnt = np.bincount(inv, minlength=m).astype(np.float64)
    for k in ('pos', 'nor', 'uv'):
        a = np.zeros((m, p[k].shape[1])); np.add.at(a, inv, p[k]); out[k] = a / cnt[:, None]
    out['nor'] /= np.maximum(np.linalg.norm(out['nor'], axis=1, keepdims=True), 1e-9); out['ji'] = p['ji'][first]; out['jw'] = p['jw'][first]
    f = inv[p['ix']]; ok = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2]); out['ix'] = f[ok]; return out
eyeM = [cluster(prim('Pliosaurus_Eye.L'), 0.012), cluster(prim('Pliosaurus_Eye.R'), 0.012)]
print('глаза после упрощения', [len(e['pos']) for e in eyeM])
eyeP = [e['pos'] @ G.T for e in eyeM]
# центр тела (по телу, без зубов): ось x — середина по длине, y — середина по высоте, z = 0
bp = body['pos'] @ G.T; cen = np.array([(bp[:, 0].max() + bp[:, 0].min()) / 2, (bp[:, 1].max() + bp[:, 1].min()) / 2, 0.0])
length = float(bp[:, 0].max() - bp[:, 0].min()); print('длина тела (ед. модели)', round(length, 3), 'размах по z', round(float(bp[:, 2].max() - bp[:, 2].min()), 3), 'высота', round(float(bp[:, 1].max() - bp[:, 1].min()), 3), 'центр', cen.round(3))
restP = np.array([G @ p for p in Pw]) - cen
# ------------------------------------------------------------------ клипы
byname = {a['name']: a for a in J['animations']}
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
    def sample(k_, t, default):
        if k_ not in chan: return default
        ts, vs = chan[k_]; t = min(t, ts[-1]); k = np.searchsorted(ts, t, side='right') - 1
        if k < 0: return vs[0]
        if k >= len(ts) - 1: return vs[-1]
        u = (t - ts[k]) / (ts[k + 1] - ts[k]) if ts[k + 1] > ts[k] else 0
        return slerp(vs[k], vs[k + 1], u) if k_[1] == 'rotation' else vs[k] + (vs[k + 1] - vs[k]) * u
    NF = int(round(DUR * fps)) + (0 if loop else 1)
    QF = np.zeros((NF, NB, 4)); ROOT = np.zeros((NF, 3)); cog = BID['COG']
    for f in range(NF):
        t = f / fps; Delta = [None] * NB; Rwa = [None] * NB; Pa = [None] * NB
        for i, n in enumerate(joints):
            rot = sample((n, 'rotation'), t, np.array(nodes[n].get('rotation', [0, 0, 0, 1]))); Rl = qmat(rot)
            tl = sample((n, 'translation'), t, np.array(nodes[n].get('translation', [0, 0, 0])))
            Rwa[i] = Rl if par[i] < 0 else Rwa[par[i]] @ Rl
            Pa[i] = tl if par[i] < 0 else Pa[par[i]] + Rwa[par[i]] @ tl
            Delta[i] = G @ (Rwa[i] @ Rw[i].T) @ G.T
        for i, n in enumerate(joints):
            q = mq(Delta[i] if par[i] < 0 else Delta[par[i]].T @ Delta[i])
            if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            QF[f, i] = q
        # движется только COG: его смещение (в осях мира) переносим на корень — рантайм двигает лишь корень
        for i, n in enumerate(joints):
            if i != cog and np.abs(sample((n, 'translation'), t, np.array(nodes[n].get('translation', [0, 0, 0]))) - np.array(nodes[n].get('translation', [0, 0, 0]))).max() > 1e-4:
                raise SystemExit('кость %s двигается — клип не годится' % names[i])
        tc = sample((joints[cog], 'translation'), t, np.array(nodes[joints[cog]].get('translation', [0, 0, 0]))) - np.array(nodes[joints[cog]].get('translation', [0, 0, 0]))
        ROOT[f] = restP[0] + G @ (Rw[par[cog]] @ tc)
    return DUR, NF, QF, ROOT
CLIPS = [('idle', 'Idle', 15, True), ('l0', 'Swim_Slow', 15, True), ('l1', 'Swim_Fast', 25, True)]
# скорости, при которых клип играется «как нарисован» (ед. модели/с): медленное плавание ~ 2 м/с, быстрое ~ 6 м/с при длине 5,6 м (1 ед. ≈ 0,56 м)
CLIPV = {'idle': 0.0, 'l0': float(os.environ.get('PLIO_V0', '3.6')), 'l1': float(os.environ.get('PLIO_V1', '10.5'))}
clips = {}; clipQ = {}
for name, an, fps, loop in CLIPS:
    DUR, NF, QF, ROOT = bake_clip(byname[an], fps, loop); clipQ[name] = QF
    mv = float(np.ptp(ROOT, axis=0).max())
    print('клип', name, an, 'длит', round(DUR, 2), 'кадров', NF, 'ход корня', round(mv, 3), 'скорость', CLIPV[name])
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'v': CLIPV[name], 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(),
                   'tb': {'0': [[round(float(c), 5) for c in r] for r in ROOT]}}
# ось и знак раскрытия челюсти — по клипу Attack_Bite
_, _, QJ, _ = bake_clip(byname['Attack_Bite'], 15, False)
amp = float(np.degrees(2 * np.arccos(np.clip(np.abs(QJ[:, jaw, 3]), 0, 1))).max()); f_ = int(np.argmax(np.degrees(2 * np.arccos(np.clip(np.abs(QJ[:, jaw, 3]), 0, 1)))))
qj = QJ[f_, jaw]; qj = qj if qj[3] >= 0 else -qj; print('челюсть', jaw, 'размах', round(amp, 1), '° кватернион в раскрытии (игровые оси)', np.round(qj, 3))
jsign = float(np.sign(qj[2]))
# ------------------------------------------------------------------ собираем вершины: тело, зубы, язык (родные глаза остаются)
parts = [('body', body), ('tL', teethL), ('tU', teethU), ('tg', tongue), ('eL', eyeM[0]), ('eR', eyeM[1])]      # родные глаза остаются: веки — кости модели (моргают по клипам)
V = []; N = []; UVs = []; SI = []; SW = []; F = []; KIND = []; base = 0
for k, (nm, p) in enumerate(parts):
    n = len(p['pos']); V.append(p['pos'] @ G.T - cen); N.append(p['nor'] @ G.T); UVs.append(p['uv']); SI.append(p['ji']); SW.append(p['jw']); F.append(p['ix'] + base); KIND += [k] * n; base += n
V = np.concatenate(V); N = np.concatenate(N); UVa = np.concatenate(UVs); SI = np.concatenate(SI); SW = np.concatenate(SW); F = np.concatenate(F); KIND = np.array(KIND); n = len(V)
if SW.max() > 1.5: SW = SW / SW.max()
SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(3), V.max(0).round(3), 'тело/зубы верх/низ/язык', [int((KIND == k).sum()) for k in range(4)])
assert n < 65535
eyes = []
for sd in (1, -1):
    pts = [e for e in eyeP if ((e - cen)[:, 2].mean() * sd) > 0][0] - cen
    c = (pts.max(0) + pts.min(0)) / 2; r = (pts.max(0) - pts.min(0)).max() / 2; eyes.append([c, r]); print('глаз', sd, c.round(4), round(r, 4))
# ------------------------------------------------------------------ текстура тела: 4096² → 1024² без чёрных швов (острова текстуры расширяются на фон)
TW = 1024
img = np.array(image(1).convert('RGB')).astype(np.float64) / 255
mask4 = (img.max(2) > 0.035).astype(np.float64)
sm = img.reshape(TW, 4096 // TW, TW, 4096 // TW, 3).mean((1, 3)); mm = mask4.reshape(TW, 4096 // TW, TW, 4096 // TW).mean((1, 3))
# среднее только по закрашенным пикселям
pre = (img * mask4[..., None]).reshape(TW, 4096 // TW, TW, 4096 // TW, 3).mean((1, 3)); texb = pre / np.maximum(mm[..., None], 1e-6)
has = mm > 0.02
_, (iy, ix_) = distance_transform_edt(~has, return_indices=True); texb = texb[iy, ix_]
print('покрыто текстурой', round(float(has.mean()), 3))
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
# цвет вершины тела — по своей точке текстуры
def bil(A, u, v):
    h, w = A.shape[:2]; x = np.clip(u, 0, 1) * (w - 1); y = np.clip(v, 0, 1) * (h - 1); x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (A[y0, x0] * (1 - fx) + A[y0, x1] * fx) * (1 - fy) + (A[y1, x0] * (1 - fx) + A[y1, x1] * fx) * fy
isB = KIND == 0
col = np.zeros((n, 3)); col[isB] = bil(texb, UVa[isB, 0], UVa[isB, 1])
# зубы и язык: цвет из их текстур (средний по островам), фиксированный
teeth_img = np.array(image(6).convert('RGB')).astype(np.float64) / 255; tong_img = np.array(image(9).convert('RGB')).astype(np.float64) / 255
for k, im in ((1, teeth_img), (2, teeth_img), (3, tong_img)):
    sel = KIND == k; col[sel] = bil(im, UVa[sel, 0], UVa[sel, 1])
eye_img = np.array(image(4).convert('RGB').resize((128, 128), Image.LANCZOS)).astype(np.float64) / 255
EXP = float(os.environ.get('PLIO_EXP', '1.5'))
fixed = (KIND != 0) & (KIND < 4)           # глаза идут через лист (текстура глаза), не через цвет вершин
VC = np.zeros((n, 3)); VC[fixed] = np.clip(lin(col[fixed]) * EXP, 0, 1); isE = KIND >= 4; VC[isE] = 1.0
print('глаз: вершин', int(isE.sum()), 'uv', UVa[isE].min(0), UVa[isE].max(0))
# зубы чуть светлее: слоновая кость
VC[(KIND == 1) | (KIND == 2)] = np.clip(VC[(KIND == 1) | (KIND == 2)] * 1.25 + 0.06, 0, 1)
print('зубы ср. цвет', VC[KIND == 1].mean(0).round(3), 'язык', VC[KIND == 3].mean(0).round(3))
# ------------------------------------------------------------------ лист деталей (карта цвета тела): 0,5 — нейтрально
def detail(A):
    L = A @ np.array([0.3, 0.55, 0.15]); lo = gaussian_filter(L, 18); mean = L[L > 0.06].mean()
    hp = L / np.maximum(lo, 0.03)
    return (np.clip(hp, 0.5, 1.6) * np.clip(gaussian_filter(L, 3) / mean, 0.25, 1.9) ** 0.45) ** 0.6
DB = detail(texb)
SH = TW + 128
SHEET = np.ones((SH, TW, 3)) * 0.5
SHEET[:TW] = (DB / 2.0)[..., None]
SHEET[TW + 6:TW + 14, 4:12] = 1.0
SHEET[TW:TW + 128, 128:256] = lin(eye_img)         # текстура глаза (линейная: лист читается без sRGB)                      # белый пиксель: фиксированные цвета (зубы, язык) умножаются на 1
Image.fromarray(np.clip(SHEET * 255, 0, 255).astype(np.uint8)).save('/tmp/plio_sheet.jpg', quality=int(os.environ.get('PLIO_Q', '72')), subsampling=2)
sheet_b64 = base64.b64encode(open('/tmp/plio_sheet.jpg', 'rb').read()).decode(); print('лист деталей', len(sheet_b64) // 1024, 'КБ')
uvx = np.where(isB, UVa[:, 0], np.where(isE, (128 + np.clip(UVa[:, 0], 0, 1) * 127.5 + 0.25) / TW, 8 / TW)); uvy = np.where(isB, UVa[:, 1] * TW / SH, np.where(isE, (TW + np.clip(UVa[:, 1], 0, 1) * 127.5 + 0.25) / SH, (TW + 10) / SH))
# ------------------------------------------------------------------ рот: розовые участки текстуры на вершинах головы
domb = SI[np.arange(n), np.argmax(SW, 1)]; headset = np.zeros(NB, bool); headset[subtree(head)] = True
r_, g_, b_ = col[:, 0], col[:, 1], col[:, 2]
pink = np.clip(((r_ - g_) * 4.0 - 0.45) * (b_ > g_ * 0.9), 0, 1) * isB
mouth = np.clip(pink * 1.3, 0, 1) * headset[domb]
print('рот: вершин', int((mouth > 0.4).sum()), 'розовых всего (любая кость)', int((pink > 0.4).sum()))
# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max()))
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([uvx, uvy], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'm': b64(np.round(mouth * 255).astype(np.uint8)), 'e': b64(np.zeros(n, np.uint8)), 'k': b64(np.zeros(n, np.uint8)),
     'vc': b64(np.round(VC * 255).astype(np.uint8)), 'vm': b64((fixed | isE).astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 6) for c in p] for p in restP], 'clips': clips, 'tips': [], 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': jsign,
     'eyes': [[round(float(c), 6) for c in e[0]] for e in eyes], 'eyeR': [round(float(e[1]), 6) for e in eyes], 'height': round(length, 4), 'tex': sheet_b64, 'nativeEyes': True, 'still': [i for i, nm in enumerate(names) if nm.startswith('lid_')]}
open(out, 'w').write('// Плиозавр (Pliosaurus, Sketchfab; лицензия в архиве не указана) — подготовлено tools/plio_bake.py из GLB. Не редактировать.\nexport const PLIO = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ', 'масштаб квантования', SC)
if dbg: np.savez(dbg, V=V, F=F, KIND=KIND, mouth=mouth, SI=SI, SW=SW, par=np.array(par), restP=restP, UV=UVa, col=col, names=np.array(names))

# Враг «Анкилозавр» → модель Ankylosaurus (присланный GLB: скелет из 34 костей, ОДИН клип 7,75 с — петля покоя: дыхание, повороты шеи, покачивание хвоста; текстура 2К) → game/ank.js.
# Запуск: python3 -I tools/ank_bake.py <akysaurus.glb> <выход ank.js>
# Основа — tools/mam_bake.py (GLB → «осевой» скелет, клипы → кватернионы, поза привязки из IBM). Клипов шага, атаки и удара в файле нет — они синтезируются здесь же
# на настоящем скелете модели поверх позы покоя: l0 — шаг (боковая последовательность ног ЗЛ→ПЛ→ЗП→ПП), l1 — рысь (диагональные пары), atk — удар хвостовой булавой,
# hurt — вздрагивание (голова вверх-назад, корпус в сторону). Скорость шага считается по длине ноги и размаху, чтобы ноги не скользили.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
glbf, out = sys.argv[1:3]
CFG = dict(zero_lat=False, clips=[('idle', 'Animation', 15, True)])
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

G = None
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
BM = [np.linalg.inv(ibm[i].T) for i in range(NB)]; Pw = [BM[i][:3, 3].copy() for i in range(NB)]; Rw = [BM[i][:3, :3] / np.linalg.norm(BM[i][:3, :3], axis=0, keepdims=True) for i in range(NB)]   # поза привязки (меш снят в ней), а не поза узлов по умолчанию
# ось вперёд: от хвоста к хоботу (в горизонтали); вверх — y
NI_ = {nodes[n].get('name', ''): i for i, n in enumerate(joints)}
def jn(prefix): return [i for k_, i in NI_.items() if k_.startswith(prefix)][0]
fwd = np.array(Pw[jn('Head')]) - np.array(Pw[jn('Tail5')]); fwd[1] = 0; fwd /= np.linalg.norm(fwd); upv = np.array([0, 1.0, 0])
G = np.array([fwd, upv, np.cross(fwd, upv)]); print('вперёд в осях модели', fwd.round(3))
restP = np.array([G @ p for p in Pw])
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
height = restP[:, 1].max() - restP[:, 1].min()
head = jn('Head'); neck = [jn('Neck')]; jaw = jn('Head'); tips = [jn('BackLowLeg.R'), jn('BackLowLeg.L'), jn('FrontLowLeg.R'), jn('FrontLowLeg.L')]
print('голова', head, 'шея', neck, 'челюсть', jaw, 'стопы', tips, 'высота', round(height, 3), 'низ', restP[:, 1].min().round(2))

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
clips = {}
for name, an, fps, loop in CFG['clips']:
    DUR, NF, QF, tb, FK = bake_clip(byname[an], fps, loop, CFG['zero_lat'])
    if name == 'hurt':                                                        # из «жеста» берём первые 1,2 с (рывок головой) — короткая реакция на удар
        k = int(1.2 * fps); QF = QF[:k]; NF = k; DUR = k / fps; tb = {i: v[:k] for i, v in tb.items()}
    sv = stance_speed(FK, fps) if name in ('l0', 'l1') else 0.0
    if loop:
        close = float(np.abs(np.abs((QF[0] * QF[-1]).sum(1)) - 1).max()); print('  петля', name, 'расхождение краёв', round(close, 5))
    if name in ('atk', 'hurt', 'idle'): tb = {k_: v for k_, v in tb.items() if k_ != '0'}       # корень на месте (двигает игра)
    print('клип', name, an, 'длит', round(DUR, 2), 'кадров', NF, 'кости с позицией', list(tb.keys()), 'скорость', round(sv, 3))
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'v': round(sv, 4), 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}

# ------------------------------------------------------------------ синтез клипов (оси игры: x вперёд, y вверх, z вбок; у осевого скелета повороты покоя единичные)
def aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def qm(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
QI = np.frombuffer(base64.b64decode(clips['idle']['q']), np.int16).reshape(clips['idle']['nf'], NB, 4) / 32767.0
Q0 = QI.mean(0); Q0 = Q0 * np.sign((Q0 * QI[0]).sum(1, keepdims=True)); Q0 /= np.linalg.norm(Q0, axis=1, keepdims=True)    # средняя поза покоя — основа синтеза
LEGS = {'BL': ('BackUpLeg.L', 'BackLowLeg.L'), 'FL': ('FrontUpLeg.L', 'FrontLowLeg.L'), 'BR': ('BackUpLeg.R', 'BackLowLeg.R'), 'FR': ('FrontUpLeg.R', 'FrontLowLeg.R')}
TAIL = [jn('Tail%d' % k) for k in range(1, 6)]; NECKS = [jn('Neck')] + [jn(n_) for n_ in ('Neck.001', 'Neck.002', 'Neck.003', 'Neck.004', 'Neck.005') if n_ in NI_]
legL = float(np.mean([restP[jn(LEGS[k][0])][1] for k in LEGS]))          # высота тазобедренного/плечевого сустава над землёй = длина «маятника» ноги
print('длина ноги', round(legL, 3), 'высота таза', round(float(restP[jn('Body')][1]), 3))
def synth(name, dur, fps, loop, fn):
    nf = int(round(dur * fps)) + (0 if loop else 1); QF = np.repeat(Q0[None], nf, 0).copy()
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1)
        for b, q in fn(u).items(): QF[f, b] = qm(QF[f, b], q)
    for f in range(1, nf):
        flip = (QF[f] * QF[f - 1]).sum(1) < 0; QF[f, flip] *= -1
    return QF, nf
def gait(ph, A, K, bob, tailA, headA):
    def fn(u):
        r = {}
        for k, (up_, lo_) in LEGS.items():
            a = 2 * np.pi * (u + ph[k]); sw = A * np.cos(a); lift = max(0.0, -np.sin(a))       # ход назад — опора; вперёд — перенос с подъёмом
            r[jn(up_)] = aa([0, 0, 1], sw); r[jn(lo_)] = aa([0, 0, 1], -K * lift)
        b2 = np.sin(4 * np.pi * u)
        r[jn('Body')] = aa([1, 0, 0], bob * np.sin(2 * np.pi * u)); r[jn('Hips')] = aa([0, 0, 1], bob * 0.3 * b2)
        for i, t in enumerate(TAIL): r[t] = aa([0, 1, 0], tailA * np.sin(2 * np.pi * u - 0.6 * (i + 1)))
        r[jn('Neck')] = aa([0, 0, 1], headA * b2)
        return r
    return fn
FPS_S = 20
A0, A1 = 0.30, 0.40
QW, nW = synth('l0', 1.9, FPS_S, True, gait({'BL': 0.0, 'FL': 0.25, 'BR': 0.5, 'FR': 0.75}, A0, 0.55, 0.035, 0.10, 0.03))
QR, nR = synth('l1', 1.05, FPS_S, True, gait({'BL': 0.0, 'FR': 0.0, 'BR': 0.5, 'FL': 0.5}, A1, 0.75, 0.05, 0.16, 0.05))
vW = 2 * legL * np.sin(A0) / (1.9 * 0.5); vR = 2 * legL * np.sin(A1) / (1.05 * 0.5)
def club(u):        # замах хвостом в сторону, резкий удар через другую сторону, возврат
    ss = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
    ang = -0.32 * ss(0.0, 0.3, u) + 0.85 * ss(0.3, 0.48, u) - 0.53 * ss(0.55, 1.0, u)
    r = {t: aa([0, 1, 0], ang * (0.6 + 0.12 * i)) for i, t in enumerate(TAIL)}
    r[jn('Body')] = aa([0, 1, 0], -ang * 0.12); r[jn('Back')] = aa([0, 0, 1], 0.08 * ss(0.25, 0.45, u) * (1 - ss(0.6, 1, u)))
    r[jn('Neck')] = aa([0, 1, 0], -ang * 0.15)
    return r
def flinch(u):
    e = np.sin(np.pi * min(1.0, u * 1.25)) * (1 - u) ** 0.5
    r = {jn('Neck'): aa([0, 0, 1], 0.22 * e), jn('Head'): aa([0, 0, 1], 0.12 * e), jn('Body'): aa([1, 0, 0], 0.07 * e)}
    for i, t in enumerate(TAIL): r[t] = aa([0, 1, 0], -0.12 * e * np.sin(i + 1))
    for k, (up_, lo_) in LEGS.items(): r[jn(lo_)] = aa([0, 0, 1], -0.15 * e)
    return r
QA, nA = synth('atk', 1.3, FPS_S, False, club); QH, nH = synth('hurt', 0.8, FPS_S, False, flinch)
for nm_, QF_, nf_, lp, v_ in (('l0', QW, nW, True, vW), ('l1', QR, nR, True, vR), ('atk', QA, nA, False, 0.0), ('hurt', QH, nH, False, 0.0)):
    clips[nm_] = {'dur': round(nf_ / FPS_S if lp else (nf_ - 1) / FPS_S, 4), 'nf': nf_, 'loop': lp, 'v': round(float(v_), 4), 'q': base64.b64encode(np.round(QF_ * 32767).astype(np.int16).tobytes()).decode(), 'tb': {}}
    print('синтез', nm_, 'кадров', nf_, 'скорость', round(float(v_), 3))
# ------------------------------------------------------------------ сетка (один примитив) и текстура
p = J['meshes'][0]['primitives'][0]; a = p['attributes']
V = acc(a['POSITION']).astype(np.float64) @ G.T; N = acc(a['NORMAL']).astype(np.float64) @ G.T; UV = acc(a['TEXCOORD_0']).astype(np.float64)
SI = acc(a['JOINTS_0']).astype(np.int64); SW = acc(a['WEIGHTS_0']).astype(np.float64)
if SW.max() > 1.5: SW = SW / SW.max()
SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9); F = acc(p['indices']).astype(np.int64).ravel().reshape(-1, 3); n = len(V)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
tex = np.array(image(J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB')).astype(np.float64) / 255
TW = int(os.environ.get('ANK_TEX', '1024')); tex = np.array(Image.fromarray((tex * 255).astype(np.uint8)).resize((TW, TW), Image.LANCZOS)).astype(np.float64) / 255
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
EXP = float(os.environ.get('ANK_EXP', '1.0')); bf = io.BytesIO()
Image.fromarray(np.round(np.clip(lin(tex) * EXP, 0, 1) * 255).astype(np.uint8)).save(bf, 'JPEG', quality=84); sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([UV[:, 0], UV[:, 1]], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(height), 4), 'tex': sheet, 'nativeEyes': 1}
open(out, 'w').write('// Анкилозавр (Ankylosaurus, GLB со скелетом и петлёй покоя; прислан пользователем, лицензия не указана) — шаг, рысь, удар хвостом и вздрагивание синтезированы tools/ank_bake.py. Не редактировать.\nexport const ANK = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

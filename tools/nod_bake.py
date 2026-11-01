# Враг «Лавовый панцирник» (вулкан) → модель Nodosaurus (присланный GLB: скелет из 46 костей, 7 клипов, текстуры; Sketchfab, лицензия не указана) → game/nod.js.
# Запуск: python3 -I tools/nod_bake.py <nodosaur.glb> <выход nod.js>
# Основа — tools/mam_bake.py (GLB → осевой скелет, поза привязки из IBM, скорость шага по опорной стопе). Клипы: idle (Idle), l0 (walk), l1 (run), atk (Attack).
# Клипа получения урона нет — hurt синтезируется из позы покоя. Два примитива сетки (тело и мелкая деталь) с общими вершинами — склеиваются.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
glbf, out = sys.argv[1:3]
CFG = dict(zero_lat=False, clips=[('idle', 'Idle', 20, True), ('l0', 'walk', 20, True), ('l1', 'run', 20, True), ('atk', 'Attack', 20, False)])
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
def node_world(k):
    W_ = np.eye(4)
    while k is not None:
        nd = nodes[k]
        if 'matrix' in nd: L_ = np.array(nd['matrix'], float).reshape(4, 4).T
        else: L_ = np.eye(4); L_[:3, :3] = qmat(nd.get('rotation', [0, 0, 0, 1])) * np.array(nd.get('scale', [1, 1, 1]), float); L_[:3, 3] = nd.get('translation', [0, 0, 0])
        W_ = L_ @ W_; k = parent_node.get(k)
    return W_
MESHNODE = {nd['mesh']: k for k, nd in enumerate(nodes) if 'mesh' in nd}
WM = node_world(MESHNODE[0]); SM = float(np.linalg.norm(WM[:3, 0])); RM = WM[:3, :3] / SM
print('узел сетки: масштаб', round(SM, 5))
Pw = [WM[:3, :3] @ p_ + WM[:3, 3] for p_ in Pw]; Rw = [RM @ r_ for r_ in Rw]           # поза привязки: из пространства сетки в пространство сцены (как и анимация)
# ось вперёд: от хвоста к хоботу (в горизонтали); вверх — y
NI_ = {nodes[n].get('name', ''): i for i, n in enumerate(joints)}
def jn(prefix): return [i for k_, i in NI_.items() if k_.startswith(prefix)][0]
fwd = np.array(Pw[jn('Head_04')]) - np.array(Pw[jn('Tail.006_021')]); fwd[1] = 0; fwd /= np.linalg.norm(fwd); upv = np.array([0, 1.0, 0])
G = np.array([fwd, upv, np.cross(fwd, upv)]); print('вперёд в осях модели', fwd.round(3))
restP = np.array([G @ p for p in Pw])
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
height = restP[:, 1].max() - restP[:, 1].min()
head = jn('Head_04'); neck = [jn('Neck_03')]; jaw = jn('Down_face_06'); tips = [jn('FFoot.L_010'), jn('FFoot.R_014'), jn('BFoot.L_025'), jn('BFoot.R_029')]
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

def node_mat(k):
    nd = nodes[k]
    if 'matrix' in nd: return np.array(nd['matrix'], float).reshape(4, 4).T
    Mx = np.eye(4); Mx[:3, :3] = qmat(nd.get('rotation', [0, 0, 0, 1])) * np.array(nd.get('scale', [1, 1, 1]), float); Mx[:3, 3] = nd.get('translation', [0, 0, 0]); return Mx
WA = np.eye(4); k_ = parent_node.get(joints[0])
while k_ is not None: WA = node_mat(k_) @ WA; k_ = parent_node.get(k_)
S_ANC = float(np.linalg.norm(WA[:3, 0])); R_ANC = WA[:3, :3] / S_ANC; T_ANC = WA[:3, 3]; print('предки скелета: масштаб', round(S_ANC, 5))
# масштаб длин костей: привязка (IBM, пространство сцены) против локальных сдвигов узлов — у этой модели они различаются (единицы экспорта), берём медиану отношений
_rat = [np.linalg.norm(Pw[i] - Pw[par[i]]) / np.linalg.norm(nodes[joints[i]].get('translation', [0, 0, 0])) for i in range(NB) if par[i] >= 0 and np.linalg.norm(nodes[joints[i]].get('translation', [0, 0, 0])) > 1e-4]
S_ANC = float(np.median(_rat)); print('масштаб длин костей по привязке', round(S_ANC, 5), 'разброс', round(float(np.percentile(_rat, 10)), 4), round(float(np.percentile(_rat, 90)), 4))
T_ANC = Pw[0] - S_ANC * (R_ANC @ np.array(nodes[joints[0]].get('translation', [0, 0, 0]), float))
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
            Rwa[i] = R_ANC @ Rl if par[i] < 0 else Rwa[par[i]] @ Rl
            Pa[i] = T_ANC + S_ANC * (R_ANC @ tl) if par[i] < 0 else Pa[par[i]] + Rwa[par[i]] @ tl * S_ANC
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
    sv = stance_speed(FK, fps) if name in ('l0', 'l1') else 0.0
    if loop:
        close = float(np.abs(np.abs((QF[0] * QF[-1]).sum(1)) - 1).max()); print('  петля', name, 'расхождение краёв', round(close, 5))
    if name in ('atk', 'hurt', 'idle'): tb = {k_: v for k_, v in tb.items() if k_ != '0'}       # корень на месте (двигает игра)
    print('клип', name, an, 'длит', round(DUR, 2), 'кадров', NF, 'кости с позицией', list(tb.keys()), 'скорость', round(sv, 3))
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'v': round(sv, 4), 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}

# ---- hurt: синтез поверх первого кадра покоя (оси игры: поворот вокруг z — голова вверх/вниз)
def _aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def _qm(a_, b_):
    x1, y1, z1, w1 = a_; x2, y2, z2, w2 = b_
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
QI = np.frombuffer(base64.b64decode(clips['idle']['q']), np.int16).reshape(clips['idle']['nf'], NB, 4) / 32767.0
nH = 17; QH = np.repeat(QI[:1], nH, 0).copy()
for f in range(nH):
    u = f / (nH - 1); e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5
    for nm_, ax_, a_ in (('Neck_03', [0, 0, 1], 0.2), ('Head_04', [0, 0, 1], 0.12), ('FSpin_02', [1, 0, 0], 0.06), ('BSpin_00', [1, 0, 0], -0.05), ('Tail_015', [0, 1, 0], 0.25)):
        b_ = jn(nm_); QH[f, b_] = _qm(QH[f, b_], _aa(ax_, a_ * e))
clips['hurt'] = {'dur': round((nH - 1) / 20, 4), 'nf': nH, 'loop': False, 'v': 0.0, 'q': base64.b64encode(np.round(QH * 32767).astype(np.int16).tobytes()).decode(), 'tb': {}}
print('hurt синтез', nH, 'кадров')
# ------------------------------------------------------------------ сетка (один примитив) и текстура
Vl = []; Nl = []; UVl = []; SIl = []; SWl = []; Fl = []; o_ = 0
for m_ in J['meshes']:
    for pp in m_['primitives']:
        a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
        Wn = node_world(MESHNODE[J['meshes'].index(m_)]); Rn = Wn[:3, :3] / np.linalg.norm(Wn[:3, 0])
        Vl.append((acc(a['POSITION']).astype(np.float64)[u_] @ Wn[:3, :3].T + Wn[:3, 3]) @ G.T); Nl.append(acc(a['NORMAL']).astype(np.float64)[u_] @ Rn.T @ G.T); UVl.append(acc(a['TEXCOORD_0']).astype(np.float64)[u_])
        SIl.append(acc(a['JOINTS_0']).astype(np.int64)[u_]); sw_ = acc(a['WEIGHTS_0']).astype(np.float64)[u_]; SWl.append(sw_ / sw_.max() if sw_.max() > 1.5 else sw_); Fl.append(rm[ix].reshape(-1, 3) + o_); o_ += len(u_)
V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); SI = np.vstack(SIl); SW = np.vstack(SWl); F = np.vstack(Fl); n = len(V)
SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
tex = np.array(image(J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB')).astype(np.float64) / 255
TW = int(os.environ.get('NOD_TEX', '1024')); tex = np.array(Image.fromarray((tex * 255).astype(np.uint8)).resize((TW, TW), Image.LANCZOS)).astype(np.float64) / 255
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
EXP = float(os.environ.get('NOD_EXP', '1.0')); bf = io.BytesIO()
Image.fromarray(np.round(np.clip(lin(tex) * EXP, 0, 1) * 255).astype(np.uint8)).save(bf, 'JPEG', quality=84); sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([UV[:, 0], UV[:, 1]], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(height), 4), 'tex': sheet, 'nativeEyes': 1}
open(out, 'w').write('// Нодозавр (Nodosaurus, GLB со скелетом и клипами, Sketchfab; прислан пользователем, лицензия не указана) — враг «Лавовый панцирник»; подготовлено tools/nod_bake.py. Не редактировать.\nexport const NOD = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

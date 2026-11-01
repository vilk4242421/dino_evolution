# Мелкие животные из присланных GLB со скелетом → данные «JP» (game/<ключ>.js). Общий конвейер для нескольких моделей, настройки — в KEYS.
# Запуск: python3 -I tools/rig_bake.py <модель.glb> <выход .js> <ключ>
#   gecko  — «Песчаная ящерка» ← House Gecko (скелет 61 кость, клип Cycle — шаг);      lzc — «Угольная ящерка» ← Lizard (клипы WALK / idle / ATAC);
#   marmot — «Сурок» ← Marmot rig (скелет 26 костей, клипов нет — всё синтезировано).
# Основа — tools/lz_bake.py (поза привязки из IBM, доворот к кадру клипа, клипы → кватернионы в осях игры). Текстуры материалов — в одном листе,
# переводятся в линейные цвета; сетка упрощается схлопыванием только внутри группы «главная кость». Недостающие клипы синтезируются (см. SYN_*).
KEYS = {
  'gecko': dict(var='GECKO', title='Геккон (House Gecko, скелет 61 кость, клип Cycle — покой)', drop=[], tri=5000, tex=512, clips=[('l0', 'Cycle', 30, True)], ref='spine.004', fwd=('head.001', 'tail.003'), show=('spine.004', 'head.001', 'tail.009', 'foot.front.L_', 'foot.hind.L_'), head='head.001', neck=['spine.001'],
                tips=['foot.front.L_', 'foot.front.R_', 'foot.hind.L_', 'foot.hind.R_']),
  'lzc': dict(var='LZC', title='Ящерица (Lizard, клипы WALK / idle / ATAC)', tri=6000, tex=512, clips=[('l0', 'Armature|WALK.002', 30, True), ('idle', 'Armature|idle', 30, True), ('atk', 'Armature|ATAC', 30, False)], ref='Bone_01', fwd=('Bone.004', 'Bone_01'), show=('Bone_01', 'Bone.004'), head='Bone.004', neck=['Bone.016'], tips=['Bone.002_L.003', 'Bone.002_R.003', 'Bone_L.003', 'Bone_R.003']),
  'marmot': dict(var='MARMOT', title='Сурок (Marmot rig, скелет 26 костей, без клипов)', tri=6000, tex=512, clips=[], ref='Bone_12', fwd=('Bone.004', 'Bone_12'), show=('Bone_12', 'Bone.004'), head='Bone.004', neck=[], tips=[], noD0=1),
}
import sys as _s0
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)   # sRGB → линейные (материал читает текстуру без преобразования)
glbf, out, KEY = sys.argv[1:4]
K = KEYS[KEY]; CFG = dict(zero_lat=False, clips=K['clips'])
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
WM = node_world(joints[0]) @ ibm[0].T; SM = float(np.linalg.norm(WM[:3, 0])); RM = WM[:3, :3] / SM
print('узел сетки: масштаб', round(SM, 5))
Pw = [WM[:3, :3] @ p_ + WM[:3, 3] for p_ in Pw]; Rw = [RM @ r_ for r_ in Rw]           # поза привязки: из пространства сетки в пространство сцены (как и анимация)
_idn = [i for i in range(NB) if np.allclose(ibm[i], np.eye(4), atol=1e-6)]          # пустая привязка (кость без весов): восстановить от родителя по позе по умолчанию
for i in range(NB):
    if i in _idn and par[i] >= 0:
        Dp = node_world(joints[par[i]]); Di = node_world(joints[i]); sp_ = np.linalg.norm(Dp[:3, 0]); Rp_ = Dp[:3, :3] / sp_; Ri_ = Di[:3, :3] / np.linalg.norm(Di[:3, 0])
        Rw[i] = Rw[par[i]] @ (Rp_.T @ Ri_); Pw[i] = np.array(Pw[par[i]]) + Rw[par[i]] @ (Rp_.T @ (Di[:3, 3] - Dp[:3, 3])) * (SM / sp_ if sp_ > 0 else 1)
print('костей с пустой привязкой', len(_idn), [nodes[joints[i]].get('name') for i in _idn[:6]])
# ось вперёд: от хвоста к хоботу (в горизонтали); вверх — y
NI_ = {nodes[n].get('name', ''): i for i, n in enumerate(joints)}
def jn(prefix): return [i for k_, i in NI_.items() if k_.startswith(prefix)][0]
# поза привязки повёрнута относительно анимаций (корневая кость в клипах компенсирует поворот узла Bone_GSRT): доворачиваем привязку и сетку
# к ориентации первого кадра покоя — по мировому повороту кости Bone_Root в этом кадре
def _wa_mat():
    W_ = np.eye(4); k_ = parent_node.get(joints[0])
    while k_ is not None: W_ = node_world_local(k_) @ W_; k_ = parent_node.get(k_)
    return W_
def node_world_local(k):
    nd = nodes[k]
    if 'matrix' in nd: return np.array(nd['matrix'], float).reshape(4, 4).T
    L_ = np.eye(4); L_[:3, :3] = qmat(nd.get('rotation', [0, 0, 0, 1])) * np.array(nd.get('scale', [1, 1, 1]), float); L_[:3, 3] = nd.get('translation', [0, 0, 0]); return L_
_an = ([a_ for a_ in J.get('animations', []) if CFG['clips'] and a_['name'] == CFG['clips'][0][1]] or [{'channels': [], 'samplers': []}])[0]; _ch = {}
for c_ in _an['channels']:
    sm_ = _an['samplers'][c_['sampler']]; _ch[(c_['target']['node'], c_['target']['path'])] = acc(sm_['output'])[0].astype(np.float64)
_br = jn(K['ref']); _chain = []; k_ = joints[_br]
while k_ is not None and k_ in jidx: _chain.append(k_); k_ = parent_node.get(k_)
_Wc = _wa_mat()
for k_ in reversed(_chain):
    nd = nodes[k_]; Lk = np.eye(4); Lk[:3, :3] = qmat(_ch.get((k_, 'rotation'), nd.get('rotation', [0, 0, 0, 1]))) * np.array(_ch.get((k_, 'scale'), nd.get('scale', [1, 1, 1])), float); Lk[:3, 3] = _ch.get((k_, 'translation'), nd.get('translation', [0, 0, 0])); _Wc = _Wc @ Lk
_Ra = _Wc[:3, :3] / np.linalg.norm(_Wc[:3, 0]); D0 = _Ra @ Rw[_br].T; _piv = np.array(Pw[_br]).copy()
_ang = np.degrees(np.arccos(np.clip((np.trace(D0) - 1) / 2, -1, 1))); print('доворот привязки к кадру покоя', round(float(_ang), 1), '°')
_u, _s, _vt = np.linalg.svd(np.round(D0)); D0 = _u @ _vt if abs(np.linalg.det(np.round(D0))) > 0.5 else np.eye(3)      # только повороты на 90°
if os.environ.get('NO_D0') or K.get('noD0'): D0 = np.eye(3)
Pw = [_piv + D0 @ (np.array(p_) - _piv) for p_ in Pw]; Rw = [D0 @ r_ for r_ in Rw]
_WD = np.eye(4); _WD[:3, :3] = D0; _WD[:3, 3] = _piv - D0 @ _piv; WM = _WD @ WM
print('кости', {k_: np.round(Pw[jn(k_)], 3).tolist() for k_ in K['show']}); fwd = np.array(Pw[jn(K['fwd'][0])]) - np.array(Pw[jn(K['fwd'][1])]); fwd[1] = 0; fwd /= np.linalg.norm(fwd); upv = np.array([0, 1.0, 0])
G = np.array([fwd, upv, np.cross(fwd, upv)]); print('вперёд в осях модели', fwd.round(3))
restP = np.array([G @ p for p in Pw])
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
height = restP[:, 1].max() - restP[:, 1].min()
head = jn(K['head']); neck = [jn(x_) for x_ in K['neck']]; jaw = jn(K.get('jaw', K['head'])); tips = [jn(x_) for x_ in K['tips']]
print('голова', head, 'шея', neck, 'челюсть', jaw, 'стопы', tips, 'высота', round(height, 3), 'низ', restP[:, 1].min().round(2))

# ------------------------------------------------------------------ клипы
byname = {a['name']: a for a in J.get('animations', [])}
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
# если в клипе тело наклонено — выравниваем: средняя ось «вершина мантии → основание рук» за цикл плавания горизонтальна
_pt = 0.0
if CFG['clips'] and K.get('level'):
    _FK0 = bake_clip(byname[CFG['clips'][0][1]], 30, True)[4]; _v = (_FK0[:, jn(K['fwd'][0])] - _FK0[:, jn(K['fwd'][1])]).mean(0); _pt = float(np.arctan2(_v[1], _v[0])) * K['level']
_c, _s = np.cos(-_pt), np.sin(-_pt); G = np.array([[_c, -_s, 0], [_s, _c, 0], [0, 0, 1]]) @ G; restP = np.array([G @ p for p in Pw]); print('выравнивание наклона', round(np.degrees(_pt), 1), '°')
clips = {}
for name, an, fps, loop in CFG['clips']:
    DUR, NF, QF, tb, FK = bake_clip(byname[an], fps, loop, CFG['zero_lat'])
    sv = 0.0
    if loop:
        close = float(np.abs(np.abs((QF[0] * QF[-1]).sum(1)) - 1).max()); print('  петля', name, 'расхождение краёв', round(close, 5))
    if name in ('atk', 'hurt', 'idle'): tb = {k_: v for k_, v in tb.items() if k_ != '0'}       # корень на месте (двигает игра)
    print('клип', name, an, 'длит', round(DUR, 2), 'кадров', NF, 'кости с позицией', list(tb.keys()), 'скорость', round(sv, 3))
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'v': round(sv, 4), 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}

# ------------------------------------------------------------------ сетка: тело + глаза (один материал), непрозрачная
if os.environ.get('PROBE'):
    for i in range(NB): print(i, nodes[joints[i]].get('name'), par[i], np.round(restP[i], 3))
    sys.exit()
# ------------------------------------------------------------------ сетка: все примитивы (кроме K['drop']), материалы — в одном листе
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
mats = sorted({pp['material'] for mi_, m_ in enumerate(J['meshes']) if mi_ not in K.get('drop', []) for pp in m_['primitives']}); NM = len(mats); CW = 1 if NM == 1 else 2
cell = {m_: ((k_ % CW) / CW, (k_ // CW) / CW) for k_, m_ in enumerate(mats)}
Vl = []; Nl = []; UVl = []; SIl = []; SWl = []; Fl = []; o_ = 0
for mi_, m_ in enumerate(J['meshes']):
    if mi_ in K.get('drop', []): continue
    for pp in m_['primitives']:
        a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
        Rn = WM[:3, :3] / np.linalg.norm(WM[:3, 0])
        Vl.append((acc(a['POSITION']).astype(np.float64)[u_] @ WM[:3, :3].T + WM[:3, 3]) @ G.T); Nl.append(acc(a['NORMAL']).astype(np.float64)[u_] @ Rn.T @ G.T)
        uv_ = acc(a['TEXCOORD_0']).astype(np.float64)[u_] % 1; ox_, oy_ = cell[pp['material']]; UVl.append(np.stack([uv_[:, 0] / CW + ox_, uv_[:, 1] / CW + oy_], 1))
        SIl.append(acc(a['JOINTS_0']).astype(np.int64)[u_]); sw_ = acc(a['WEIGHTS_0']).astype(np.float64)[u_]; SWl.append(sw_ / sw_.max() if sw_.max() > 1.5 else sw_)
        Fl.append(rm[ix].reshape(-1, 3) + o_); o_ += len(u_)
V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); SI = np.vstack(SIl); SW = np.vstack(SWl); F = np.vstack(Fl); n = len(V); SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
UNI = 100.0 / np.abs(V).max(); V *= UNI; gy_ = V[:, 1].min(); V[:, 1] -= gy_; restP = restP * UNI; restP[:, 1] -= gy_     # единый масштаб (~100 ед.), земля — по низу сетки
for c_ in clips.values(): c_['v'] = round(c_['v'] * UNI, 4)
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(1), V.max(0).round(1), 'материалов', NM)
# ------------------------------------------------------------------ синтез (оси игры: x — вперёд, y — вверх, z — поперёк; повороты — от позы привязки)
def _aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def _qm(a_, b_):
    x1, y1, z1, w1 = a_; x2, y2, z2, w2 = b_
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def _enc(Q_, dur_, loop_, v_=0.0, **kw): d_ = {'dur': round(dur_, 4), 'nf': len(Q_), 'loop': loop_, 'v': round(float(v_), 4), 'q': b64(np.round(Q_ * 32767).astype(np.int16)), 'tb': {}}; d_.update(kw); return d_
def _dec(c_): return np.frombuffer(base64.b64decode(c_['q']), np.int16).reshape(c_['nf'], NB, 4) / 32767.0
def _mean(Q_): M_ = Q_.mean(0); M_ = M_ * np.sign((M_ * Q_[0]).sum(1, keepdims=True)); return M_ / np.linalg.norm(M_, axis=1, keepdims=True)
ss_ = lambda a_, b_, x_: (lambda t_: t_ * t_ * (3 - 2 * t_))(min(1, max(0, (x_ - a_) / (b_ - a_))))
def synth(Q0, dur, fps, loop, fn):
    nf = int(round(dur * fps)) + (0 if loop else 1); QF = np.repeat(Q0[None], nf, 0).copy()
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1)
        for b, q in fn(u).items(): QF[f, b] = _qm(QF[f, b], q)
    for f in range(1, nf):
        fl_ = (QF[f] * QF[f - 1]).sum(1) < 0; QF[f, fl_] *= -1
    return QF
def lizard_gait(Q0, LEGS, SPN, TAIL, A, K_, und, dur, fps=30):
    # шаг ящерицы: лапы враскоряку — плечо/бедро ходит вокруг вертикали (вперёд-назад) и приподнимается в переносе; диагональные пары;
    # позвоночник и хвост изгибаются волной в стороны (S-изгиб) в такт шагам
    def fn(u):
        r = {}; w = 2 * np.pi * u
        for (up_, lo_, ft_), ph in LEGS:
            a = w + 2 * np.pi * ph; sg = 1.0 if restP[lo_][2] > restP[up_][2] else -1.0; lift = max(0.0, -np.sin(a))
            r[up_] = _qm(_aa([0, 1, 0], sg * A * np.cos(a)), _aa([1, 0, 0], -sg * K_ * lift)); r[lo_] = _aa([1, 0, 0], sg * 0.6 * K_ * lift); r[ft_] = _aa([1, 0, 0], sg * 0.3 * K_ * lift)
        for k_, b_ in enumerate(SPN): r[b_] = _aa([0, 1, 0], und * np.sin(w + 0.5 * k_))
        for k_, b_ in enumerate(TAIL): r[b_] = _aa([0, 1, 0], und * (0.8 + 0.25 * k_) * np.sin(w - 0.6 * (k_ + 1)))
        return r
    return synth(Q0, dur, fps, True, fn)
def flinch_clip(Q0, SPN, TAIL, HD, dur=0.6):
    def fn(u):
        e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5; r = {HD: _aa([0, 0, 1], 0.25 * e)}
        for k_, b_ in enumerate(SPN): r[b_] = _aa([0, 1, 0], 0.12 * e)
        for k_, b_ in enumerate(TAIL): r[b_] = _aa([0, 1, 0], -0.18 * e * np.sin(u * 14 - 0.6 * k_))
        return r
    return _enc(synth(Q0, dur, 30, False, fn), dur, False, rate=1.2, span=[0.0, 1.0])
def bite_clip(Q0, NK, HD, JW, dur=0.6, jawA=0.5):
    def fn(u):
        wind = ss_(0, 0.3, u) * (1 - ss_(0.3, 0.45, u)); hit = ss_(0.3, 0.45, u) * (1 - ss_(0.6, 1.0, u)); gape = ss_(0.1, 0.35, u) * (1 - ss_(0.45, 0.6, u))
        r = {NK: _aa([0, 0, 1], 0.18 * wind - 0.22 * hit), HD: _aa([0, 0, 1], -0.08 * wind + 0.1 * hit)}
        if JW != HD: r[JW] = _aa([0, 0, 1], -jawA * gape)
        return r
    return _enc(synth(Q0, dur, 30, False, fn), dur, False, rate=1.0)
nm_ = lambda j: nodes[joints[j]].get('name', '')
def J_(p_): return jn(p_)
if KEY == 'gecko':                                                                  # клип Cycle (5 с) — покой: голова, горло, кончик хвоста; шаг, бег, укус, вздрагивание — синтез
    QI = _dec(clips.pop('l0')); clips['idle'] = _enc(QI, 5.04, True); Q0 = _mean(QI)
    LEGS = [((J_('leg.humerus.L'), J_('leg.radius.L'), J_('foot.front.L')), 0.0), ((J_('leg.humerus.R'), J_('leg.radius.R'), J_('foot.front.R')), 0.5),
            ((J_('leg.femur.L'), J_('leg.tibia.L'), J_('foot.hind.L_')), 0.5), ((J_('leg.femur.R'), J_('leg.tibia.R'), J_('foot.hind.R_')), 0.0)]
    SPN = [J_('spine.003'), J_('spine.002'), J_('spine.001')]; TAIL = [J_('tail.%03d' % k_) for k_ in range(1, 10)]; HD = J_('head.001'); JW = J_('head.002')
    Lh = float(np.linalg.norm(restP[J_('foot.hind.L_')] - restP[J_('leg.femur.L')])[..., None][0]) if False else float(abs(restP[J_('foot.hind.L_')][2] - restP[J_('leg.femur.L')][2]) + 0.5 * abs(restP[J_('foot.hind.L_')][0] - restP[J_('leg.femur.L')][0]))
    for nm2, A, K2, und, dur, duty in (('l0', 0.45, 0.5, 0.10, 0.9, 0.65), ('l1', 0.6, 0.65, 0.16, 0.42, 0.5)):
        clips[nm2] = _enc(lizard_gait(Q0, LEGS, SPN, TAIL, A, K2, und, dur), dur, True, 2 * Lh * np.sin(A) / (dur * duty))
    clips['atk'] = bite_clip(Q0, SPN[-1], HD, JW); clips['hurt'] = flinch_clip(Q0, SPN, TAIL, HD)
elif KEY == 'lzc':                                                                  # родные: шаг, покой, атака; вздрагивание — синтез
    Q0 = _mean(_dec(clips['idle'])); FKw = bake_clip(byname['Armature|WALK.002'], 60, True)[4]; clips['l0']['v'] = round(stance_speed(FKw, 60) * UNI, 4)
    SPN = [J_('Bone.001'), J_('Bone.002'), J_('Bone.003')]; TAIL = [J_(x_) for x_ in ('Bone.007', 'Bone.011', 'Bone.012', 'Bone.013', 'Bone.014', 'Bone.015_')]
    clips['hurt'] = flinch_clip(Q0, SPN, TAIL, head); clips['atk']['rate'] = 1.0
elif KEY == 'marmot':                                                               # клипов нет: поза привязки — сурок стоит столбиком (покой); на четыре лапы — синтез
    def _rot(q):
        x, y, z, w = q; return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    def fk(Q):
        Dw = [None] * NB; P_ = np.zeros((NB, 3))
        for b in range(NB):
            p_ = par[b]
            if p_ < 0: Dw[b] = _rot(Q[b]); P_[b] = restP[b]
            else: Dw[b] = Dw[p_] @ _rot(Q[b]); P_[b] = P_[p_] + Dw[p_] @ (restP[b] - restP[p_])
        return P_
    SPR = J_('Bone_12'); SP2 = J_('Bone.002'); NK = J_('Bone.003'); HD = J_('Bone.004'); TAIL = [J_('Bone.005'), J_('Bone.006'), J_('Bone.007'), J_('Bone.008')]
    ARM = {s_: [J_(a_) for a_ in names] for s_, names in (('R', ('Bone.018', 'Bone.019', 'Bone.020')), ('L', ('Bone.023', 'Bone.024', 'Bone.025')))}
    LEG = {s_: [J_(a_) for a_ in names] for s_, names in (('R', ('Bone.010', 'Bone.011', 'Bone.012')), ('L', ('Bone.014', 'Bone.015', 'Bone.016')))}
    tips[:] = [ARM['R'][2], ARM['L'][2], LEG['R'][2], LEG['L'][2]]
    QB = np.tile([0, 0, 0, 1.0], (NB, 1)); QIdle = QB.copy()
    def quad_pose(th, hk, hd):                                                       # th — наклон корпуса вперёд, hk — сгиб задних лап, hd — подъём головы
        Q = np.tile([0, 0, 0, 1.0], (NB, 1)); Q[SPR] = _aa([0, 0, 1], -th); Q[NK] = _aa([0, 0, 1], 0.55 * hd); Q[HD] = _aa([0, 0, 1], 0.45 * hd)
        for s_ in 'RL': Q[LEG[s_][0]] = _aa([0, 0, 1], 0.5 * hk); Q[LEG[s_][1]] = _aa([0, 0, 1], -0.9 * hk); Q[LEG[s_][2]] = _aa([0, 0, 1], 0.4 * hk)
        for k_, t_ in enumerate(TAIL): Q[t_] = _aa([0, 0, 1], -0.25 if k_ == 0 else -0.05)
        return Q
    best = None
    for th in np.radians(np.arange(55, 111, 2.5)):
        for hk in np.arange(0, 1.01, 0.05):
            P_ = fk(quad_pose(th, hk, 0)); fy = P_[[ARM['R'][2], ARM['L'][2]], 1].mean(); hy = P_[[LEG['R'][2], LEG['L'][2]], 1].mean()
            sh = P_[SP2]; hp = P_[SPR]; slope = abs(sh[1] - hp[1]) / max(abs(sh[0] - hp[0]), 1e-6)
            cost = (fy - hy) ** 2 + 4 * slope ** 2 * 100 + 0.1 * hk
            if best is None or cost < best[0]: best = (cost, th, hk)
    _, TH, HK = best; P_ = fk(quad_pose(TH, HK, 0)); HDK = float(np.clip(TH + np.radians(8), 0, 1.9))
    print('поза на четырёх лапах: наклон', round(np.degrees(TH), 1), '° сгиб задних', round(HK, 2), 'подъём головы', round(np.degrees(HDK), 1))
    Q4 = quad_pose(TH, HK, HDK); legH = float(P_[SPR][1] - P_[LEG['R'][2]][1])
    def bound(A, K2, flex, ph):
        def fn(u):
            r = {}; w = 2 * np.pi * u
            for s_ in 'RL':
                for kind, ch in (('F', ARM[s_]), ('H', LEG[s_])):
                    a = w + 2 * np.pi * ph[kind + s_]; sw = A * np.cos(a); lift = max(0.0, -np.sin(a))
                    if kind == 'H': r[ch[0]] = _aa([0, 0, 1], sw); r[ch[1]] = _aa([0, 0, 1], -K2 * lift); r[ch[2]] = _aa([0, 0, 1], 0.6 * K2 * lift)
                    else: r[ch[0]] = _aa([0, 0, 1], sw); r[ch[1]] = _aa([0, 0, 1], -0.8 * K2 * lift); r[ch[2]] = _aa([0, 0, 1], -0.5 * K2 * lift)
            fl = flex * np.cos(w + 0.4); r[SPR] = _aa([0, 0, 1], fl); r[SP2] = _aa([0, 0, 1], -0.6 * fl); r[NK] = _aa([0, 0, 1], -0.5 * fl)
            for k_, t_ in enumerate(TAIL): r[t_] = _aa([0, 0, 1], 0.12 * np.sin(w - 0.6 * (k_ + 1)))
            return r
        return fn
    for nm2, A, K2, flex, dur, duty, ph in (('l0', 0.32, 0.6, 0.04, 0.8, 0.6, {'HL': 0.0, 'FL': 0.25, 'HR': 0.5, 'FR': 0.75}),
                                            ('l1', 0.55, 0.9, 0.16, 0.38, 0.35, {'HL': 0.0, 'HR': 0.06, 'FL': 0.5, 'FR': 0.56})):
        clips[nm2] = _enc(synth(Q4, dur, 30, True, bound(A, K2, flex, ph)), dur, True, 2 * legH * np.sin(A) / (dur * duty))
    def idle(u):                                                                     # столбиком: дышит, вертит головой, перебирает передними лапками, хвост подёргивается
        w = 2 * np.pi * u; look = 0.5 * np.sin(w) * (0.6 + 0.4 * np.cos(2 * w)); r = {SPR: _aa([0, 0, 1], 0.025 * np.sin(4 * w)), NK: _aa([0, 1, 0], 0.5 * look), HD: _qm(_aa([0, 1, 0], 0.4 * look), _aa([1, 0, 0], 0.1 * np.sin(2 * w + 1)))}
        for s_, sg in (('R', 1), ('L', -1)): r[ARM[s_][1]] = _aa([0, 0, 1], 0.12 * np.sin(6 * w + (0 if sg > 0 else 1.5)) ** 3)
        for k_, t_ in enumerate(TAIL): r[t_] = _aa([0, 1, 0], 0.15 * np.sin(8 * w - 0.7 * k_) * max(0.0, np.sin(w * 2)) ** 4)
        return r
    clips['idle'] = _enc(synth(QB, 6.0, 30, True, idle), 6.0, True)
    def swipe(u):                                                                    # выпад: привстаёт и бросается вперёд-вниз с раскрытыми лапами
        wind = ss_(0, 0.3, u) * (1 - ss_(0.3, 0.45, u)); hit = ss_(0.3, 0.45, u) * (1 - ss_(0.6, 1.0, u))
        r = {SPR: _aa([0, 0, 1], 0.3 * wind - 0.15 * hit), NK: _aa([0, 0, 1], -0.2 * hit)}
        for s_ in 'RL': r[ARM[s_][0]] = _aa([0, 0, 1], 0.6 * wind - 0.3 * hit)
        return r
    clips['atk'] = _enc(synth(Q4, 0.6, 30, False, swipe), 0.6, False, rate=1.0)
    def fl_(u):
        e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5; r = {SPR: _aa([0, 0, 1], 0.18 * e), NK: _aa([0, 0, 1], 0.3 * e), SP2: _aa([0, 1, 0], 0.15 * e * np.sin(u * 14))}
        for k_, t_ in enumerate(TAIL): r[t_] = _aa([0, 0, 1], 0.2 * e)
        return r
    clips['hurt'] = _enc(synth(Q4, 0.6, 30, False, fl_), 0.6, False, rate=1.2, span=[0.0, 1.0])
print('клипы', {k_: (c_['nf'], c_['dur'], c_['v']) for k_, c_ in clips.items()})
# ------------------------------------------------------------------ упрощение
if len(F) > K.get('tri', 6000) * 1.15:
    import subprocess, tempfile
    wd_ = tempfile.mkdtemp(); ec_ = {}
    for t_ in F:
        for a_, b_ in ((t_[0], t_[1]), (t_[1], t_[2]), (t_[2], t_[0])): k_ = (min(a_, b_), max(a_, b_)); ec_[k_] = ec_.get(k_, 0) + 1
    lock_ = np.zeros(n, np.uint8)
    for (a_, b_), c_ in ec_.items():
        if c_ == 1: lock_[a_] = 1; lock_[b_] = 1
    V.astype(np.float32).tofile(wd_ + '/V.bin'); F.astype(np.int32).tofile(wd_ + '/F.bin'); lock_.tofile(wd_ + '/L.bin'); np.take_along_axis(SI, np.argmax(SW, 1)[:, None], 1).ravel().astype(np.int32).tofile(wd_ + '/G.bin')
    subprocess.check_call(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), wd_ + '/V.bin', wd_ + '/F.bin', wd_ + '/OV.bin', wd_ + '/OF.bin', str(K.get('tri', 6000))], env=dict(os.environ, DEC_LOCK=wd_ + '/L.bin', DEC_IDX=wd_ + '/I.bin', DEC_GRP=wd_ + '/G.bin'), stdout=subprocess.DEVNULL)
    oi_ = np.fromfile(wd_ + '/I.bin', np.int32); V = np.fromfile(wd_ + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd_ + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64)
    N = N[oi_]; UV = UV[oi_]; SI = SI[oi_]; SW = SW[oi_]; n = len(V); print('упрощено до', len(F), 'треугольников')
# ------------------------------------------------------------------ текстура (лист материалов) и запись
TW = K.get('tex', 512) * CW; sheet_ = Image.new('RGB', (TW, TW))
for m_ in mats:
    ti_ = J['materials'][m_].get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index'); cs_ = TW // CW
    im_ = image(ti_).convert('RGB').resize((cs_, cs_), Image.LANCZOS) if ti_ is not None else Image.new('RGB', (cs_, cs_), tuple(int(255 * c) for c in J['materials'][m_].get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1])[:3]))
    sheet_.paste(im_, (int(cell[m_][0] * TW), int(cell[m_][1] * TW)))
if K.get('recolor'): sheet_ = K['recolor'](sheet_)
bf = io.BytesIO(); _LIN(sheet_).save(bf, 'JPEG', quality=86); sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
height = float(V[:, 1].max() - V[:, 1].min())
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': [int(p_) for p_ in par], 'pos': [[round(float(c), 4) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(height, 4), 'tex': sheet, 'nativeEyes': 1, 'vc': b64(np.full((n, 3), 255, np.uint8))}
open(out, 'w').write('// ' + K['title'] + ' (GLB, Sketchfab; прислан пользователем, лицензия не указана); подготовлено tools/rig_bake.py ' + KEY + '. Не редактировать.\nexport const ' + K['var'] + ' = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

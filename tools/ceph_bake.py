# Головоногие: «Наутилус» → модель Nautilus Chamber (GLB: 32 кости, клип Animation 16,6 с, 5 сеток ~66 тыс. треугольников), аммониты/кальмары/каракатица → модель
# Ammonite (GLB: 5 костей, клип Take 001 25 с через служебный узел с неравномерным масштабом). Обе — Sketchfab, присланы пользователем, лицензия не указана.
# Запуск: python3 -I tools/ceph_bake.py <naut|amm> <модель.glb> <выход.js> [треугольников=9000]
# Основа — tools/tur_bake.py (GLB → осевой скелет, привязка из IBM, доворот к первому кадру). Добавлено: упрощение сетки с сохранением весов и UV (tools/decimate.js,
# границы UV-островов закреплены), родитель кости ищется через служебные узлы. Наутилус: плавание — родной клип (движение всей модели по сцене не берётся — двигает игра),
# покой — он же медленнее и мягче. Аммонит: родной клип не используется (неравномерный масштаб), покой/плавание синтезируются на его костях (волна по щупальцам).
# atk (выпад щупальцами) и hurt (раковина вздрагивает, щупальца поджимаются) — синтез у обоих.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
KEY, glbf, out = sys.argv[1:4]; TRIS = int(sys.argv[4]) if len(sys.argv) > 4 else 9000
CK = {'naut': dict(clip='Animation', root='base', fwdA='Bone.003', fwdB='shell', head='head', tent=['Bone.008', 'Bone.014', 'Bone.021', 'Bone.026']),
      'amm': dict(clip='Take 001', root='body3', fwdA='tentacles3', fwdB='body3', head='body3', tent=['tentacles1'])}[KEY]
CFG = dict(zero_lat=False, clips=[('l0', CK['clip'], 15, True)])
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
def _jpar(n):
    k = parent_node.get(n)
    while k is not None and k not in jidx: k = parent_node.get(k)
    return jidx.get(k, -1) if k is not None else -1
par = [_jpar(n) for n in joints]
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
_an = [a_ for a_ in J['animations'] if a_['name'] == CFG['clips'][0][1]][0]; _ch = {}
for c_ in _an['channels']:
    sm_ = _an['samplers'][c_['sampler']]; _ch[(c_['target']['node'], c_['target']['path'])] = acc(sm_['output'])[0].astype(np.float64)
_br = jn(CK['root']); _chain = []; k_ = joints[_br]
while k_ is not None and k_ in jidx: _chain.append(k_); k_ = parent_node.get(k_)
_Wc = _wa_mat()
for k_ in reversed(_chain):
    nd = nodes[k_]; Lk = np.eye(4); Lk[:3, :3] = qmat(_ch.get((k_, 'rotation'), nd.get('rotation', [0, 0, 0, 1]))) * np.array(_ch.get((k_, 'scale'), nd.get('scale', [1, 1, 1])), float); Lk[:3, 3] = _ch.get((k_, 'translation'), nd.get('translation', [0, 0, 0])); _Wc = _Wc @ Lk
_Ra = _Wc[:3, :3] / np.linalg.norm(_Wc[:3, 0]); D0 = _Ra @ Rw[_br].T; _piv = np.array(Pw[_br]).copy()
_ang = np.degrees(np.arccos(np.clip((np.trace(D0) - 1) / 2, -1, 1))); print('доворот привязки к кадру покоя', round(float(_ang), 1), '°')
Pw = [_piv + D0 @ (np.array(p_) - _piv) for p_ in Pw]; Rw = [D0 @ r_ for r_ in Rw]
_WD = np.eye(4); _WD[:3, :3] = D0; _WD[:3, 3] = _piv - D0 @ _piv; WM = _WD @ WM
fwd = np.array(Pw[jn(CK['fwdA'])]) - np.array(Pw[jn(CK['fwdB'])]); fwd[1] = 0; fwd /= np.linalg.norm(fwd); upv = np.array([0, 1.0, 0])
G = np.array([fwd, upv, np.cross(fwd, upv)]); print('вперёд в осях модели', fwd.round(3))
restP = np.array([G @ p for p in Pw])
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
height = restP[:, 1].max() - restP[:, 1].min()
head = jn(CK['head']); neck = []; jaw = head; tips = []
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
    sv = 0.0
    if loop:
        close = float(np.abs(np.abs((QF[0] * QF[-1]).sum(1)) - 1).max()); print('  петля', name, 'расхождение краёв', round(close, 5))
    if name in ('atk', 'hurt', 'idle'): tb = {k_: v for k_, v in tb.items() if k_ != '0'}       # корень на месте (двигает игра)
    print('клип', name, an, 'длит', round(DUR, 2), 'кадров', NF, 'кости с позицией', list(tb.keys()), 'скорость', round(sv, 3))
    clips[name] = {'dur': round(DUR, 4), 'nf': NF, 'loop': loop, 'v': round(sv, 4), 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}

# ---- синтез клипов головоногих
def _aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def _qm(a_, b_):
    x1, y1, z1, w1 = a_; x2, y2, z2, w2 = b_
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def _nl(a_, b_, t_):
    b_ = b_ * np.sign((a_ * b_).sum(-1, keepdims=True)); r_ = a_ * (1 - t_) + b_ * t_; return r_ / np.linalg.norm(r_, axis=-1, keepdims=True)
def _enc(Q_, dur_, loop_, v_=0.0, **kw): d_ = {'dur': round(dur_, 4), 'nf': len(Q_), 'loop': loop_, 'v': v_, 'q': base64.b64encode(np.round(Q_ * 32767).astype(np.int16).tobytes()).decode(), 'tb': {}}; d_.update(kw); return d_
kids_ = {i: [j for j in range(NB) if par[j] == i] for i in range(NB)}
def _chain(b_):
    c_ = [b_]
    while kids_[c_[-1]]: c_.append(kids_[c_[-1]][0])
    return c_
CH = [_chain(jn(t_)) for t_ in CK['tent']]; RT = jn(CK['root']); print('щупальца-цепочки', [len(c_) for c_ in CH])
ss_ = lambda a_, b_, x_: (lambda t_: t_ * t_ * (3 - 2 * t_))(min(1, max(0, (x_ - a_) / (b_ - a_))))
if KEY == 'naut':
    QS = np.frombuffer(base64.b64decode(clips['l0']['q']), np.int16).reshape(clips['l0']['nf'], NB, 4) / 32767.0
    QM = QS.mean(0); QM = QM * np.sign((QM * QS[0]).sum(1, keepdims=True)); QM /= np.linalg.norm(QM, axis=1, keepdims=True)
    clips['idle'] = _enc(_nl(QM[None], QS, 0.6), clips['l0']['dur'] * 1.6, True); clips['l0']['v'] = 1.0
else:                                                                              # аммонит: волна по щупальцам на его костях
    QM = np.zeros((NB, 4)); QM[:, 3] = 1
    def _wave(nf_, amp_, freq_, bob_):
        Q_ = np.repeat(QM[None], nf_, 0).copy()
        for f in range(nf_):
            u = 2 * np.pi * f / nf_
            for ci, c_ in enumerate(CH):
                for k_, b_ in enumerate(c_): Q_[f, b_] = _qm(_aa([0, 0, 1], amp_ * (0.5 + 0.35 * k_) * np.sin(freq_ * u - 0.9 * k_)), _aa([0, 1, 0], 0.5 * amp_ * np.sin(freq_ * u * 0.5 - 0.7 * k_ + ci)))
            Q_[f, RT] = _qm(_aa([0, 0, 1], bob_ * np.sin(freq_ * u + 0.6)), _aa([1, 0, 0], bob_ * 0.6 * np.sin(u)))
        return Q_
    clips['idle'] = _enc(_wave(60, 0.12, 1, 0.04), 4.0, True); clips['l0'] = _enc(_wave(40, 0.28, 2, 0.06), 1.6, True, 1.0)
nA = 21; QA = np.repeat(QM[None], nA, 0).copy()
for f in range(nA):
    u = f / (nA - 1); wind = ss_(0, 0.35, u) * (1 - ss_(0.35, 0.5, u)); hit = ss_(0.35, 0.5, u) * (1 - ss_(0.6, 1.0, u))
    QA[f, RT] = _qm(QA[f, RT], _aa([0, 0, 1], 0.12 * wind - 0.1 * hit))
    for ci, c_ in enumerate(CH):
        for k_, b_ in enumerate(c_): QA[f, b_] = _qm(QA[f, b_], _aa([0, 1, 0], (1 if ci % 2 == 0 else -1) * (0.25 * wind - 0.15 * hit) * (1 - 0.15 * k_)))
clips['atk'] = _enc(QA, 0.9, False, rate=1.0)
nH = 15; QH = np.repeat(QM[None], nH, 0).copy()
for f in range(nH):
    u = f / (nH - 1); e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5
    QH[f, RT] = _qm(QH[f, RT], _qm(_aa([1, 0, 0], 0.25 * e * np.sin(u * 18)), _aa([0, 0, 1], 0.12 * e)))
    for c_ in CH:
        for k_, b_ in enumerate(c_): QH[f, b_] = _qm(QH[f, b_], _aa([0, 0, 1], 0.2 * e))
clips['hurt'] = _enc(QH, 0.7, False, rate=1.2, span=[0.0, 1.0]); print('синтез: idle, atk, hurt' + (', l0' if KEY == 'amm' else ''))
# ------------------------------------------------------------------ сетка (один примитив) и текстура
Vl = []; Nl = []; UVl = []; SIl = []; SWl = []; Fl = []; o_ = 0
for m_ in J['meshes']:
    for pp in m_['primitives']:
        if J['materials'][pp['material']].get('alphaMode') == 'BLEND': continue
        a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
        Wn = WM; Rn = Wn[:3, :3] / np.linalg.norm(Wn[:3, 0])
        Vl.append((acc(a['POSITION']).astype(np.float64)[u_] @ Wn[:3, :3].T + Wn[:3, 3]) @ G.T); Nl.append(acc(a['NORMAL']).astype(np.float64)[u_] @ Rn.T @ G.T); UVl.append(acc(a['TEXCOORD_0']).astype(np.float64)[u_])
        SIl.append(acc(a['JOINTS_0']).astype(np.int64)[u_]); sw_ = acc(a['WEIGHTS_0']).astype(np.float64)[u_]; SWl.append(sw_ / sw_.max() if sw_.max() > 1.5 else sw_); Fl.append(rm[ix].reshape(-1, 3) + o_); o_ += len(u_)
V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); SI = np.vstack(SIl); SW = np.vstack(SWl); F = np.vstack(Fl); n = len(V)
SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
if len(F) > TRIS:                                                                 # упрощение: границы UV-островов не трогаем, атрибуты уцелевших вершин сохраняются
    import subprocess, tempfile
    wd_ = tempfile.mkdtemp(); ec_ = {}
    for t_ in F:
        for a_, b_ in ((t_[0], t_[1]), (t_[1], t_[2]), (t_[2], t_[0])): k_ = (min(a_, b_), max(a_, b_)); ec_[k_] = ec_.get(k_, 0) + 1
    lock_ = np.zeros(n, np.uint8)
    for (a_, b_), c_ in ec_.items():
        if c_ == 1: lock_[a_] = 1; lock_[b_] = 1
    V.astype(np.float32).tofile(wd_ + '/V.bin'); F.astype(np.int32).tofile(wd_ + '/F.bin'); lock_.tofile(wd_ + '/L.bin')
    subprocess.check_call(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), wd_ + '/V.bin', wd_ + '/F.bin', wd_ + '/OV.bin', wd_ + '/OF.bin', str(TRIS)], env=dict(os.environ, DEC_LOCK=wd_ + '/L.bin', DEC_IDX=wd_ + '/I.bin'))
    oi_ = np.fromfile(wd_ + '/I.bin', np.int32); V = np.fromfile(wd_ + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd_ + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64)
    N = N[oi_]; UV = UV[oi_]; SI = SI[oi_]; SW = SW[oi_]; n = len(V); print('упрощено до', len(F), 'треугольников, заблокировано вершин', int(lock_.sum()))
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
_mt = J['materials'][0]; _ti = _mt.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index', _mt.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness', {}).get('diffuseTexture', {}).get('index'))
tex = np.array(image(_ti).convert('RGB')).astype(np.float64) / 255
TW = int(os.environ.get('CEPH_TEX', '512')); tex = np.array(Image.fromarray((tex * 255).astype(np.uint8)).resize((TW, TW), Image.LANCZOS)).astype(np.float64) / 255
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
EXP = float(os.environ.get('CEPH_EXP', '1.0')); bf = io.BytesIO()
Image.fromarray(np.round(np.clip(lin(tex) * EXP, 0, 1) * 255).astype(np.uint8)).save(bf, 'JPEG', quality=84); sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([UV[:, 0], UV[:, 1]], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(height), 4), 'tex': sheet, 'nativeEyes': 1, 'vc': b64(np.full((n, 3), 255, np.uint8))}
open(out, 'w').write('// ' + {'naut': 'Наутилус (Nautilus Chamber', 'amm': 'Аммонит (Ammonite'}[KEY] + ', GLB со скелетом, Sketchfab; прислан пользователем, лицензия не указана); подготовлено tools/ceph_bake.py. Не редактировать.\nexport const ' + KEY.upper() + ' = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

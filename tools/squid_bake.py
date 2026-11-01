# Кальмары и каракатица (океан) → модель Bobtail squid (присланный GLB: скелет 213 костей — мантия и 8 рук по 24 кости, клип swim 1.2 с; плавники машут морф-мишенями;
# два материала — тело (полупрозрачное, со свечением хроматофоров) и стеклянная оболочка глаз; Sketchfab, лицензия не указана) → game/squid.js.
# Запуск: python3 -I tools/squid_bake.py <bobtail_squid.glb> <выход squid.js>
# Основа — tools/moth_bake.py. Оболочка глаз убрана, тело непрозрачное, сетка упрощена до ~8000 треугольников; морфы плавников переведены в две кости.
# Клипы: l0 — swim (родной), idle — он же мягче и медленнее, atk — руки раскрываются вперёд, hurt — вздрагивание (синтез).
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)   # sRGB → линейные (материал читает текстуру без преобразования)
glbf, out = sys.argv[1:3]
CFG = dict(zero_lat=False, clips=[('l0', 'swim', 30, True)])
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
_an = [a_ for a_ in J['animations'] if a_['name'] == CFG['clips'][0][1]][0]; _ch = {}
for c_ in _an['channels']:
    sm_ = _an['samplers'][c_['sampler']]; _ch[(c_['target']['node'], c_['target']['path'])] = acc(sm_['output'])[0].astype(np.float64)
_br = jn('Bone_Armature'); _chain = []; k_ = joints[_br]
while k_ is not None and k_ in jidx: _chain.append(k_); k_ = parent_node.get(k_)
_Wc = _wa_mat()
for k_ in reversed(_chain):
    nd = nodes[k_]; Lk = np.eye(4); Lk[:3, :3] = qmat(_ch.get((k_, 'rotation'), nd.get('rotation', [0, 0, 0, 1]))) * np.array(_ch.get((k_, 'scale'), nd.get('scale', [1, 1, 1])), float); Lk[:3, 3] = _ch.get((k_, 'translation'), nd.get('translation', [0, 0, 0])); _Wc = _Wc @ Lk
_Ra = _Wc[:3, :3] / np.linalg.norm(_Wc[:3, 0]); D0 = _Ra @ Rw[_br].T; _piv = np.array(Pw[_br]).copy()
_ang = np.degrees(np.arccos(np.clip((np.trace(D0) - 1) / 2, -1, 1))); print('доворот привязки к кадру покоя', round(float(_ang), 1), '°')
_u, _s, _vt = np.linalg.svd(np.round(D0)); D0 = _u @ _vt if abs(np.linalg.det(np.round(D0))) > 0.5 else np.eye(3)      # только повороты на 90°
if os.environ.get('NO_D0'): D0 = np.eye(3)
Pw = [_piv + D0 @ (np.array(p_) - _piv) for p_ in Pw]; Rw = [D0 @ r_ for r_ in Rw]
_WD = np.eye(4); _WD[:3, :3] = D0; _WD[:3, 3] = _piv - D0 @ _piv; WM = _WD @ WM
print('кости', {k_: np.round(Pw[jn(k_)], 2).tolist() for k_ in ('Bone_Armature', 'Bone.001', 'Bone.002', 'first_l_00', 'first_l_23', '00_Armature', '23_Armature')}); fwd = np.array(Pw[jn('first_l_00')]) + np.array(Pw[jn('first_r_00')]) - 2 * np.array(Pw[jn('Bone.002')]); fwd[1] = 0; fwd /= np.linalg.norm(fwd); upv = np.array([0, 1.0, 0])
G = np.array([fwd, upv, np.cross(fwd, upv)]); print('вперёд в осях модели', fwd.round(3))
restP = np.array([G @ p for p in Pw])
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
height = restP[:, 1].max() - restP[:, 1].min()
head = jn('Bone_Armature'); neck = []; jaw = head; tips = []
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
# в клипе тело наклонено (мантия выше рук) — выравниваем: средняя ось «вершина мантии → основание рук» за цикл плавания горизонтальна
_FK0 = bake_clip(byname['swim'], 30, True)[4]; _v = (_FK0[:, jn('Bone_Armature')] - _FK0[:, jn('Bone.002')]).mean(0); _pt = float(np.arctan2(_v[1], _v[0])) * float(os.environ.get('SQ_LEVEL', '1'))
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

# ------------------------------------------------------------------ сетка: только тело (стеклянная оболочка глаз — лишнее, убрана), непрозрачная
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
pp = J['meshes'][0]['primitives'][0]; a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix)
rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_)); Wn = WM; Rn = Wn[:3, :3] / np.linalg.norm(Wn[:3, 0])
V = (acc(a['POSITION']).astype(np.float64)[u_] @ Wn[:3, :3].T + Wn[:3, 3]) @ G.T; N = acc(a['NORMAL']).astype(np.float64)[u_] @ Rn.T @ G.T; UV = acc(a['TEXCOORD_0']).astype(np.float64)[u_] % 1
SI = acc(a['JOINTS_0']).astype(np.int64)[u_]; SW = acc(a['WEIGHTS_0']).astype(np.float64)[u_]; SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9); F = rm[ix].reshape(-1, 3); n = len(V)
# ---- плавники: в оригинале машут морф-мишенями (5 форм по кругу), а у нас только кости → две новые кости-плавника на мантии,
# поворот каждой на кадр и вес каждой вершины подобраны по смещениям морфов (поочерёдный метод наименьших квадратов)
TG = [(acc(t_['POSITION']).astype(np.float64)[u_] @ Wn[:3, :3].T) @ G.T for t_ in pp['targets']]
_an = byname['swim']; _wc = [c_ for c_ in _an['channels'] if c_['target']['path'] == 'weights'][0]; _s = _an['samplers'][_wc['sampler']]
_ti = acc(_s['input']).ravel().astype(np.float64); _wo = acc(_s['output']).astype(np.float64).reshape(len(_ti), -1)
NF0 = clips['l0']['nf']; MW = np.array([[np.interp(f / 30.0, _ti, _wo[:, k_]) for k_ in range(len(TG))] for f in range(NF0)])
DF = np.einsum('fk,kvc->fvc', MW, np.array(TG))                                   # смещения вершин по кадрам
fin = np.abs(np.array(TG)).max((0, 2)) > 1e-3 * np.abs(V).max()
def _rod(w_):
    th = np.linalg.norm(w_)
    if th < 1e-9: return np.eye(3)
    k_ = w_ / th; K = np.array([[0, -k_[2], k_[1]], [k_[2], 0, -k_[0]], [-k_[1], k_[0], 0]]); return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K
B002 = jn('Bone.002'); KF = 3; FINB = []; FINQ = []; FINS = []; WF = np.zeros((n, 2 * KF))       # на плавник 3 кости вдоль хорды (перед, середина, зад) — волна идёт по плавнику
for si_, side in enumerate((1, -1)):
    sel = np.where(fin & (V[:, 2] * side > 0))[0]; P_ = V[sel]; D_ = DF[:, sel]
    az = np.abs(P_[:, 2]); zr = np.percentile(az, 3); zm = az.max(); x0, x1 = P_[:, 0].min(), P_[:, 0].max()
    h = np.clip((az - zr) / (zm - zr) / 0.35, 0, 1); h = h * h * (3 - 2 * h)       # у корня плавника вес плавно сходит на нет — шов с мантией не рвётся
    xc = np.linspace(x0, x1, KF + 2)[1:-1]; g = np.exp(-((P_[:, 0, None] - xc[None]) / ((x1 - x0) / KF)) ** 2); g /= g.sum(1, keepdims=True); W_ = g * h[:, None]
    C_ = [np.array([xc[b_], P_[:, 1].mean(), side * zr]) for b_ in range(KF)]; Qs = []; er = []
    for f in range(NF0):
        A_ = np.zeros((len(sel) * 3, 3 * KF))
        for b_ in range(KF):
            r_ = P_ - C_[b_]
            for i_ in range(3): e_ = np.zeros(3); e_[i_] = 1; A_[:, 3 * b_ + i_] = (W_[:, b_, None] * np.cross(e_, r_)).ravel()
        AtA = A_.T @ A_; om = np.linalg.solve(AtA + 0.05 * np.eye(3 * KF) * np.trace(AtA) / (3 * KF), A_.T @ D_[f].ravel())      # гребневая регуляризация: без выкрутасов на 100°+
        er.append(np.linalg.norm(A_ @ om - D_[f].ravel()) / max(np.linalg.norm(D_[f]), 1e-9)); Qs.append([mq(_rod(om[3 * b_:3 * b_ + 3])) for b_ in range(KF)])
    print('плавник', 'левый' if side > 0 else 'правый', 'вершин', len(sel), 'ошибка', round(float(np.mean(er)), 3))
    FINB += C_; FINQ.append(np.array(Qs)); FINS += [side] * KF; WF[sel, si_ * KF:(si_ + 1) * KF] = W_
NB0 = NB; NB = NB0 + 2 * KF; par = list(par) + [B002] * (2 * KF); restP = np.vstack([restP, FINB])
WF *= 0 if os.environ.get('SQ_NOFIN') else 1; _fw = WF.sum(1); SW = SW * (1 - _fw)[:, None]
SI = np.hstack([SI, np.tile(np.arange(NB0, NB), (n, 1))]); SW = np.hstack([SW, WF])
FINQ = np.concatenate(FINQ, 1)
for k_ in clips:
    c_ = clips[k_]; Q_ = np.frombuffer(base64.b64decode(c_['q']), np.int16).reshape(c_['nf'], NB0, 4) / 32767.0
    Qf = FINQ.copy() if c_['nf'] == NF0 else np.tile([0, 0, 0, 1.0], (c_['nf'], 2 * KF, 1))
    Qf = Qf * np.where(Qf[..., 3:] < 0, -1, 1); c_['q'] = b64(np.round(np.concatenate([Q_, Qf], 1) * 32767).astype(np.int16))
# ---- синтез: покой, выброс щупалец (атака), вздрагивание (оси игры: x — вперёд, y — вверх, z — поперёк)
def _aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def _qm(a_, b_):
    x1, y1, z1, w1 = a_; x2, y2, z2, w2 = b_
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def _enc(Q_, dur_, loop_, v_=0.0, **kw): d_ = {'dur': round(dur_, 4), 'nf': len(Q_), 'loop': loop_, 'v': v_, 'q': b64(np.round(Q_ * 32767).astype(np.int16)), 'tb': {}}; d_.update(kw); return d_
def _nl(a_, b_, t_): r_ = a_ + (b_ * np.sign((a_ * b_).sum(-1, keepdims=True)) - a_) * t_; return r_ / np.linalg.norm(r_, axis=-1, keepdims=True)
QS = np.frombuffer(base64.b64decode(clips['l0']['q']), np.int16).reshape(NF0, NB, 4) / 32767.0
QM = QS.mean(0); QM = QM * np.sign((QM * QS[0]).sum(1, keepdims=True)); QM /= np.linalg.norm(QM, axis=1, keepdims=True)
clips['l0']['v'] = 1.0
clips['idle'] = _enc(_nl(QM[None], QS, 0.55), clips['l0']['dur'] * 1.8, True)     # покой: тот же цикл, мягче и медленнее (плавники и руки едва колышутся)
kids_ = {i: [j for j in range(NB) if par[j] == i] for i in range(NB)}
ARM0 = [j for j in kids_[jn('Bone_Armature')] if nodes[joints[j]].get('name', '').endswith('00_Armature')]
def _chain(b_):
    c_ = [b_]
    while kids_[c_[-1]]: c_.append(kids_[c_[-1]][0])
    return c_
CH = [_chain(b_) for b_ in ARM0]; RT = jn('Bone_Armature'); print('руки-цепочки', len(CH), [len(c_) for c_ in CH])
ss_ = lambda a_, b_, x_: (lambda t_: t_ * t_ * (3 - 2 * t_))(min(1, max(0, (x_ - a_) / (b_ - a_))))
nA = 25; QA = np.repeat(QM[None], nA, 0).copy()                                    # атака: подбирает руки (замах), затем раскрывает их «корзинкой» вперёд и тянется
for f in range(nA):
    u = f / (nA - 1); wind = ss_(0, 0.35, u) * (1 - ss_(0.35, 0.5, u)); hit = ss_(0.35, 0.5, u) * (1 - ss_(0.62, 1.0, u))
    QA[f, RT] = _qm(_aa([0, 0, 1], 0.14 * wind - 0.12 * hit), QA[f, RT])
    for ci, c_ in enumerate(CH):
        p0 = restP[c_[0]] - restP[RT]; sy = 1 if p0[1] >= 0 else -1; sz = 1 if p0[2] >= 0 else -1
        for k_, b_ in enumerate(c_):
            fall = (1 - k_ / len(c_)) ** 0.7
            QA[f, b_] = _qm(_qm(_aa([0, 1, 0], -sz * (0.05 * wind - 0.07 * hit) * fall), _aa([0, 0, 1], sy * (-0.04 * wind + 0.05 * hit) * fall)), QA[f, b_])
clips['atk'] = _enc(QA, 0.9, False, rate=1.0)
nH = 18; QH = np.repeat(QM[None], nH, 0).copy()                                    # вздрагивание: мантия дёргается, руки поджимаются, плавники прижаты
for f in range(nH):
    u = f / (nH - 1); e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5
    QH[f, RT] = _qm(_qm(_aa([1, 0, 0], 0.22 * e * np.sin(u * 18)), _aa([0, 0, 1], 0.12 * e)), QH[f, RT])
    for c_ in CH:
        for k_, b_ in enumerate(c_): QH[f, b_] = _qm(_aa([0, 0, 1], -0.035 * e * (1 - k_ / len(c_))), QH[f, b_])
    for fb_, sd_ in zip(range(NB0, NB), FINS): QH[f, fb_] = _qm(_aa([1, 0, 0], -sd_ * 0.35 * e), QH[f, fb_])
clips['hurt'] = _enc(QH, 0.7, False, rate=1.2, span=[0.0, 1.0]); print('клипы: плавание (родное + плавники из морфов), покой, атака, вздрагивание (синтез)')
# ---- упрощение сетки
if len(F) > 8500:
    import subprocess, tempfile
    wd_ = tempfile.mkdtemp(); ec_ = {}
    for t_ in F:
        for a_, b_ in ((t_[0], t_[1]), (t_[1], t_[2]), (t_[2], t_[0])): k_ = (min(a_, b_), max(a_, b_)); ec_[k_] = ec_.get(k_, 0) + 1
    lock_ = np.zeros(n, np.uint8)
    for (a_, b_), c_ in ec_.items():
        if c_ == 1: lock_[a_] = 1; lock_[b_] = 1
    _dom = np.take_along_axis(SI, np.argmax(SW, 1)[:, None], 1).ravel(); lock_[np.isin(_dom, [jn('Bone_Armature'), jn('Bone.001'), jn('Bone.002')] + list(range(NB0, NB)))] = 1   # мантию и плавники не упрощаем (у мантии двойная стенка — схлопывается в лоскуты); только руки
    V.astype(np.float32).tofile(wd_ + '/V.bin'); F.astype(np.int32).tofile(wd_ + '/F.bin'); lock_.tofile(wd_ + '/L.bin'); _gb = np.arange(NB); _nb_ = [nodes[joints[j]].get('name', '') if j < NB0 else '' for j in range(NB)]
    for j in range(NB0):                                                       # группа = кость, но в руке — пара соседних костей (вес меняется плавно)
        if _nb_[j].endswith('_Armature') and _nb_[j][-11:-9].isdigit(): _gb[j] = j - int(_nb_[j][-11:-9]) % 2
    _gb[np.take_along_axis(SI, np.argmax(SW, 1)[:, None], 1).ravel()].astype(np.int32).tofile(wd_ + '/G.bin')
    subprocess.check_call(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), wd_ + '/V.bin', wd_ + '/F.bin', wd_ + '/OV.bin', wd_ + '/OF.bin', os.environ.get('SQ_TRI', '8000')], env=dict(os.environ, DEC_LOCK=wd_ + '/L.bin', DEC_IDX=wd_ + '/I.bin', DEC_GRP=wd_ + '/G.bin'), stdout=subprocess.DEVNULL)
    oi_ = np.fromfile(wd_ + '/I.bin', np.int32); V = np.fromfile(wd_ + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd_ + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64)
    N = N[oi_]; UV = UV[oi_]; SI = SI[oi_]; SW = SW[oi_]; n = len(V); print('упрощено до', len(F), 'треугольников')
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
TW = 512
base = image(J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB').resize((TW, TW), Image.LANCZOS)
bf = io.BytesIO(); _LIN(base).save(bf, 'JPEG', quality=86); sheet = base64.b64encode(bf.getvalue()).decode()
em = np.array(image(J['materials'][0]['emissiveTexture']['index']).convert('RGB').resize((256, 256), Image.LANCZOS)).astype(np.float64) * 0.55   # хроматофоры переливаются (слабее оригинала ×4.4)
eb = io.BytesIO(); _LIN(Image.fromarray(np.clip(em, 0, 255).astype(np.uint8))).save(eb, 'JPEG', quality=85); emi_b64 = base64.b64encode(eb.getvalue()).decode()
print('текстура', len(sheet) // 1024, 'КБ, свечение', len(emi_b64) // 1024, 'КБ')
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
height = float(restP[:, 1].max() - restP[:, 1].min()); height = float(V[:, 1].max() - V[:, 1].min())
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': [int(p_) for p_ in par], 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(height, 4), 'tex': sheet, 'nativeEyes': 1, 'emi': emi_b64, 'vc': b64(np.full((n, 3), 255, np.uint8))}
open(out, 'w').write('// Кальмар-сепиола (Bobtail squid, GLB со скелетом и клипом плавания, Sketchfab; прислан пользователем, лицензия не указана) — каракатица и кальмары; подготовлено tools/squid_bake.py. Не редактировать.\nexport const SQUID = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

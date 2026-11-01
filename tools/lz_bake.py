# Питомец «Ящерка» → модель Lizard Run (присланный GLB: скелет из 31 кости — таз, 3 позвонка, 2 шейных, голова, хвост из 6 звеньев, лапы по 3–4 звена;
# клип бега 0,5 с; ~32 тыс. треугольников; Sketchfab, лицензия не указана) → game/lizr.js.
# Запуск: python3 -I tools/lz_bake.py <lizard_run.glb> <выход lizr.js>
#   MESH_GLB=<Lizard.glb> — сетка и текстура первой присланной ящерки (тот же скелет), анимации — из lizard_run (v304)
# Основа — tools/eel_bake.py. Сетка упрощена до ~6000 треугольников (схлопывание только внутри группы «главная кость»).
# Клипы: l0 — родной бег (частота по опорным лапам), idle — средняя поза бега: дышит, осматривается, хвост подрагивает; atk — выпад головой; hurt — вздрагивание (синтез).
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)   # sRGB → линейные (материал читает текстуру без преобразования)
glbf, out = sys.argv[1:3]
CFG = dict(zero_lat=False, clips=[('l0', 'GltfAnimation 0', 60, True)])
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
_br = jn('pelvis'); _chain = []; k_ = joints[_br]
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
print('кости', {k_: np.round(Pw[jn(k_)], 2).tolist() for k_ in ('pelvis', 'head', 'tail_06', 'foot_l', 'hand_l')}); fwd = np.array(Pw[jn('head')]) - np.array(Pw[jn('pelvis')]); fwd[1] = 0; fwd /= np.linalg.norm(fwd); upv = np.array([0, 1.0, 0])
G = np.array([fwd, upv, np.cross(fwd, upv)]); print('вперёд в осях модели', fwd.round(3))
restP = np.array([G @ p for p in Pw])
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
height = restP[:, 1].max() - restP[:, 1].min()
head = jn('head'); neck = [jn('neck_01'), jn('neck_02')]; jaw = head; tips = [jn('ball_l'), jn('ball_r'), jn('hand_l'), jn('hand_r')]
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
# если в клипе тело наклонено — выравниваем: средняя ось «вершина мантии → основание рук» за цикл плавания горизонтальна
_FK0 = bake_clip(byname['GltfAnimation 0'], 30, True)[4]; _v = (_FK0[:, jn('head')] - _FK0[:, jn('pelvis')]).mean(0); _pt = float(np.arctan2(_v[1], _v[0])) * float(os.environ.get('LZ_LEVEL', '0'))
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
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
Vl = []; Nl = []; UVl = []; SIl = []; SWl = []; Fl = []; o_ = 0
for m_ in J['meshes']:
    for pp in m_['primitives']:
        a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
        Rn = WM[:3, :3] / np.linalg.norm(WM[:3, 0])
        Vl.append((acc(a['POSITION']).astype(np.float64)[u_] @ WM[:3, :3].T + WM[:3, 3]) @ G.T); Nl.append(acc(a['NORMAL']).astype(np.float64)[u_] @ Rn.T @ G.T); UVl.append(acc(a['TEXCOORD_0']).astype(np.float64)[u_] % 1)
        SIl.append(acc(a['JOINTS_0']).astype(np.int64)[u_]); sw_ = acc(a['WEIGHTS_0']).astype(np.float64)[u_]; SWl.append(sw_ / sw_.max() if sw_.max() > 1.5 else sw_)
        Fl.append(rm[ix].reshape(-1, 3) + o_); o_ += len(u_)
V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); SI = np.vstack(SIl); SW = np.vstack(SWl); F = np.vstack(Fl); n = len(V); SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
MESH2 = os.environ.get('MESH_GLB'); TEX2 = None
if MESH2:
    # другая сетка на тот же скелет (первая присланная ящерка Lizard.glb, та же схема костей): вершины переносятся скиннингом
    # из её позы привязки в позу привязки этого скелета (кость за костью по имени), веса — по именам костей, текстура — её
    d2 = open(MESH2, 'rb').read(); jl2 = struct.unpack('<I', d2[12:16])[0]; J2 = json.loads(d2[20:20 + jl2]); o2 = 20 + jl2; B2 = d2[o2 + 8:o2 + 8 + struct.unpack('<I', d2[o2:o2 + 4])[0]]
    def acc2(i):
        a = J2['accessors'][i]; bv = J2['bufferViews'][a['bufferView']]; n_ = NC[a['type']]; dt = CT[a['componentType']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); item = n_ * np.dtype(dt).itemsize; st = bv.get('byteStride') or item
        if st == item: return np.frombuffer(B2, dtype=dt, count=a['count'] * n_, offset=o).reshape(a['count'], n_)
        return np.stack([np.frombuffer(B2, dtype=dt, count=n_, offset=o + k * st) for k in range(a['count'])])
    sk2 = J2['skins'][0]; ibm2 = acc2(sk2['inverseBindMatrices']).reshape(-1, 4, 4).astype(np.float64)
    strip = lambda nm: {'wiggle': 'run'}.get(nm, nm.rsplit('_', 1)[0] if nm.rsplit('_', 1)[-1].isdigit() and ('_' in nm) and nm.count('_') >= 1 and not nm.startswith('GLTF') else nm)
    names1 = {strip(nodes[jn_].get('name', '')): i for i, jn_ in enumerate(joints)}
    MAP = np.array([names1.get(J2['nodes'][k].get('name', ''), names1.get({'wiggle': 'run'}.get(J2['nodes'][k].get('name', ''), ''), 0)) for k in sk2['joints']])
    print('кости второй сетки → скелет:', [(J2['nodes'][k].get('name'), int(MAP[i])) for i, k in enumerate(sk2['joints'])][:6], '…')
    BMr = [np.linalg.inv(ibm[i].T) for i in range(NB)]                                  # привязка этого скелета (пространство его сетки)
    Rn = WM[:3, :3] / np.linalg.norm(WM[:3, 0]); Vl = []; Nl = []; UVl = []; SIl = []; SWl = []; Fl = []; o_ = 0
    for m_ in J2['meshes']:
        for pp in m_['primitives']:
            a = pp['attributes']; ix = acc2(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J2['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
            P1 = acc2(a['POSITION']).astype(np.float64)[u_]; N1 = acc2(a['NORMAL']).astype(np.float64)[u_]; si = MAP[acc2(a['JOINTS_0']).astype(np.int64)[u_]]; sw = acc2(a['WEIGHTS_0']).astype(np.float64)[u_]; sw = sw / sw.max() if sw.max() > 1.5 else sw
            sw = sw / np.maximum(sw.sum(1, keepdims=True), 1e-9); j2 = acc2(a['JOINTS_0']).astype(np.int64)[u_]
            Pm = np.zeros_like(P1); Nm = np.zeros_like(N1)
            for c in range(4):
                Mk = np.stack([BMr[MAP[j]] @ ibm2[j].T for j in j2[:, c]])                    # из привязки второй сетки в привязку скелета
                Pm += sw[:, c:c + 1] * (np.einsum('nij,nj->ni', Mk[:, :3, :3], P1) + Mk[:, :3, 3]); Nm += sw[:, c:c + 1] * np.einsum('nij,nj->ni', Mk[:, :3, :3], N1)
            Vl.append((Pm @ WM[:3, :3].T + WM[:3, 3]) @ G.T); Nl.append(Nm @ Rn.T @ G.T); UVl.append(acc2(a['TEXCOORD_0']).astype(np.float64)[u_] % 1)
            SIl.append(si); SWl.append(sw); Fl.append(rm[ix].reshape(-1, 3) + o_); o_ += len(u_)
    V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); SI = np.vstack(SIl); SW = np.vstack(SWl); F = np.vstack(Fl); n = len(V)
    pb2 = J2['materials'][0].get('pbrMetallicRoughness', {}); ti2 = pb2.get('baseColorTexture', {}).get('index', 0); im2 = J2['images'][J2['textures'][ti2]['source']]; bv2 = J2['bufferViews'][im2['bufferView']]
    TEX2 = Image.open(io.BytesIO(B2[bv2.get('byteOffset', 0):bv2.get('byteOffset', 0) + bv2['byteLength']])).convert('RGB')
    print('вторая сетка: вершин', n, 'граней', len(F), 'габариты', V.min(0).round(3), V.max(0).round(3))
# ---- синтез: покой, бросок (атака), вздрагивание (оси игры: x — вперёд, y — вверх, z — поперёк)
def _aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def _qm(a_, b_):
    x1, y1, z1, w1 = a_; x2, y2, z2, w2 = b_
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def _enc(Q_, dur_, loop_, v_=0.0, **kw): d_ = {'dur': round(dur_, 4), 'nf': len(Q_), 'loop': loop_, 'v': v_, 'q': b64(np.round(Q_ * 32767).astype(np.int16)), 'tb': {}}; d_.update(kw); return d_
def _nl(a_, b_, t_): r_ = a_ + (b_ * np.sign((a_ * b_).sum(-1, keepdims=True)) - a_) * t_; return r_ / np.linalg.norm(r_, axis=-1, keepdims=True)
NF0 = clips['l0']['nf']; QS = np.frombuffer(base64.b64decode(clips['l0']['q']), np.int16).reshape(NF0, NB, 4) / 32767.0
QM = QS.mean(0); QM = QM * np.sign((QM * QS[0]).sum(1, keepdims=True)); QM /= np.linalg.norm(QM, axis=1, keepdims=True)
TL = [jn('tail_0%d' % k_) for k_ in range(1, 7)]; SP = [jn('spine_01'), jn('spine_02'), jn('spine_03')]; PEL = jn('pelvis')
ARM = {s_: [jn('upperarm_' + s_), jn('lowerarm_' + s_), jn('hand_' + s_)] for s_ in 'lr'}; LEG = {s_: [jn('thigh_' + s_), jn('calf_' + s_), jn('foot_' + s_)] for s_ in 'lr'}
FKr = bake_clip(byname['GltfAnimation 0'], 60, True)[4]; vR = stance_speed(FKr, 60); clips['l0']['v'] = round(vR, 4); print('скорость бега (по опорным лапам)', round(vR, 2), 'ед/с, высота таза', round(float(restP[PEL][1]), 2))
ss_ = lambda a_, b_, x_: (lambda t_: t_ * t_ * (3 - 2 * t_))(min(1, max(0, (x_ - a_) / (b_ - a_))))
# покой (5 с): средняя поза бега прижата к земле — лапы расставлены; дыхание боками, голова поворачивается и приподнимается («осматривается»), кончик хвоста подрагивает
QI = np.repeat(QM[None], 150, 0).copy()
for f in range(150):
    u = f / 150; w = 2 * np.pi * u; look = 0.35 * np.sin(w) * (0.55 + 0.45 * np.cos(2 * w)); up = 0.12 * max(0.0, np.sin(2 * w + 1.0)) ** 2
    QI[f, SP[1]] = _qm(_aa([0, 0, 1], 0.015 * np.sin(6 * w)), QI[f, SP[1]])
    QI[f, neck[0]] = _qm(_qm(_aa([0, 1, 0], 0.55 * look), _aa([0, 0, 1], up)), QI[f, neck[0]]); QI[f, head] = _qm(_aa([0, 1, 0], 0.4 * look), QI[f, head])
    for k_, b_ in enumerate(TL): QI[f, b_] = _qm(_aa([0, 1, 0], (0.03 + 0.03 * k_) * np.sin(2 * w - 0.7 * k_) + 0.05 * np.sin(5 * w - 0.9 * k_) * (k_ >= 3)), QI[f, b_])
clips['idle'] = _enc(QI, 5.0, True)
nA = 21; QA = np.repeat(QM[None], nA, 0).copy()                                    # выпад-«хап»: прижимается, бросок головой вперёд, возврат
for f in range(nA):
    u = f / (nA - 1); wind = ss_(0, 0.3, u) * (1 - ss_(0.3, 0.45, u)); hit = ss_(0.3, 0.45, u) * (1 - ss_(0.6, 1.0, u))
    QA[f, SP[2]] = _qm(_aa([0, 0, 1], 0.1 * wind - 0.08 * hit), QA[f, SP[2]]); QA[f, neck[0]] = _qm(_aa([0, 0, 1], 0.2 * wind - 0.25 * hit), QA[f, neck[0]]); QA[f, head] = _qm(_aa([0, 0, 1], -0.1 * wind + 0.12 * hit), QA[f, head])
    for k_, b_ in enumerate(TL): QA[f, b_] = _qm(_aa([0, 1, 0], 0.1 * wind * np.sin(k_ + 1)), QA[f, b_])
clips['atk'] = _enc(QA, 0.6, False, rate=1.0)
nH = 18; QH = np.repeat(QM[None], nH, 0).copy()                                    # вздрагивание: тело изгибается дугой, хвост хлещет
for f in range(nH):
    u = f / (nH - 1); e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5
    QH[f, SP[1]] = _qm(_aa([0, 1, 0], 0.2 * e), QH[f, SP[1]]); QH[f, neck[0]] = _qm(_aa([0, 0, 1], 0.25 * e), QH[f, neck[0]])
    for k_, b_ in enumerate(TL): QH[f, b_] = _qm(_aa([0, 1, 0], -0.15 * e * np.sin(u * 14 - 0.6 * k_)), QH[f, b_])
clips['hurt'] = _enc(QH, 0.6, False, rate=1.2, span=[0.0, 1.0]); print('клипы: бег (родной), покой, выпад, вздрагивание (синтез)')
# ---- упрощение сетки (схлопываем только внутри группы «главная кость», чтобы веса не перескакивали)
if len(F) > 6500:
    import subprocess, tempfile
    wd_ = tempfile.mkdtemp(); ec_ = {}
    for t_ in F:
        for a_, b_ in ((t_[0], t_[1]), (t_[1], t_[2]), (t_[2], t_[0])): k_ = (min(a_, b_), max(a_, b_)); ec_[k_] = ec_.get(k_, 0) + 1
    lock_ = np.zeros(n, np.uint8)
    for (a_, b_), c_ in ec_.items():
        if c_ == 1: lock_[a_] = 1; lock_[b_] = 1
    V.astype(np.float32).tofile(wd_ + '/V.bin'); F.astype(np.int32).tofile(wd_ + '/F.bin'); lock_.tofile(wd_ + '/L.bin'); np.take_along_axis(SI, np.argmax(SW, 1)[:, None], 1).ravel().astype(np.int32).tofile(wd_ + '/G.bin')
    subprocess.check_call(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), wd_ + '/V.bin', wd_ + '/F.bin', wd_ + '/OV.bin', wd_ + '/OF.bin', os.environ.get('LZ_TRI', '6000')], env=dict(os.environ, DEC_LOCK=wd_ + '/L.bin', DEC_IDX=wd_ + '/I.bin', DEC_GRP=wd_ + '/G.bin'), stdout=subprocess.DEVNULL)
    oi_ = np.fromfile(wd_ + '/I.bin', np.int32); V = np.fromfile(wd_ + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd_ + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64)
    N = N[oi_]; UV = UV[oi_]; SI = SI[oi_]; SW = SW[oi_]; n = len(V); print('упрощено до', len(F), 'треугольников')
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(3), V.max(0).round(3))
base = (TEX2 if TEX2 is not None else image(J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB')).resize((512, 512), Image.LANCZOS)
bf = io.BytesIO(); _LIN(base).save(bf, 'JPEG', quality=86); sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
height = float(V[:, 1].max() - V[:, 1].min()); print('высота', round(height, 2))
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': [int(p_) for p_ in par], 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(height, 4), 'tex': sheet, 'nativeEyes': 1, 'vc': b64(np.full((n, 3), 255, np.uint8))}
open(out, 'w').write('// Ящерица (Lizard Run, GLB со скелетом и клипом бега, Sketchfab; прислан пользователем, лицензия не указана) — питомец «Ящерка»; подготовлено tools/lz_bake.py. Не редактировать.\nexport const LIZR = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

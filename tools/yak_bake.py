# Враг «Горный як» → модель Midnight Yak (присланный GLB: фотоскан 1,5 млн треугольников с текстурой 2048², БЕЗ скелета и анимаций) → game/yak.js.
# Запуск: python3 -I tools/yak_bake.py <model.glb> <выход yak.js> [граней=20000]
# Делает: сварка и упрощение (tools/decimate.js), цвет вершин из текстуры (усреднение по соседним исходным вершинам), подошвы на y=0,
# оси игры (x вперёд, y вверх, z вбок); скелет строится здесь: таз, спина, грудь, шея, голова, 2 кости хвоста, у каждой ноги бедро/голень/бабка
# (положение ног — по копытам скана). Веса — по расстоянию до костей (ноги влияют только на нижнюю часть возле своей оси), топ-4.
# Клипов в файле нет — синтезируются на этом скелете: idle (дыхание, взгляд, хвост), l0 шаг, l1 рысь, atk (удар рогами: голову вниз и рывок вверх), hurt (вздрагивание).
import sys, os, json, base64, struct, subprocess, tempfile, numpy as np
from scipy.spatial import cKDTree
from PIL import Image
glbf, out = sys.argv[1:3]; TGT = int(sys.argv[3]) if len(sys.argv) > 3 else 20000
d = open(glbf, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl]); off = 20 + jl; BIN = d[off + 8:off + 8 + struct.unpack('<I', d[off:off + 4])[0]]
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = NC[a['type']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(BIN, dtype=CT[a['componentType']], count=a['count'] * n, offset=o).reshape(a['count'], n)
p = J['meshes'][0]['primitives'][0]; P = acc(p['attributes']['POSITION']).astype(np.float64); UV = acc(p['attributes']['TEXCOORD_0']).astype(np.float64); F = acc(p['indices']).reshape(-1, 3).astype(np.int64)
im = J['images'][J['textures'][J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]; bv = J['bufferViews'][im['bufferView']]
import io; TEX = np.array(Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')).astype(np.float64) / 255
# оси: скан — y вверх, морда к +z  →  игра: x = z, y = y, z = −x
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float); P = P @ G.T; P[:, 1] -= P[:, 1].min()
print('исходно вершин', len(P), 'граней', len(F), 'габариты', P.min(0).round(3), P.max(0).round(3))
# цвет исходных вершин из текстуры
th, tw = TEX.shape[:2]; px = np.clip((UV[:, 0] % 1) * (tw - 1), 0, tw - 1).astype(int); py = np.clip((UV[:, 1] % 1) * (th - 1), 0, th - 1).astype(int); C0 = TEX[py, px]
# сварка и упрощение
q = np.round(P / 1e-4).astype(np.int64); _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True); inv = inv.ravel()
Pw = P[first]; Fw = inv[F]; Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
V, Fd = Pw, Fw
for _pass in range(5):                                                        # у decimate.js предел итераций за проход — для скана в 1,5 млн граней нужно несколько проходов
    if len(Fd) <= TGT * 1.05: break
    td = tempfile.mkdtemp(); V.astype(np.float32).tofile(td + '/V.bin'); Fd.astype(np.int32).tofile(td + '/F.bin')
    subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), td + '/V.bin', td + '/F.bin', td + '/oV.bin', td + '/oF.bin', str(TGT)], check=True)
    V = np.fromfile(td + '/oV.bin', np.float32).reshape(-1, 3).astype(np.float64); Fd = np.fromfile(td + '/oF.bin', np.int32).reshape(-1, 3).astype(np.int64)
n = len(V)
# цвет вершины — среднее 12 ближайших исходных вершин (сглаживает «шум» шерсти)
_, ix = cKDTree(P).query(V, k=12); CC = C0[ix].mean(1)
# нормали
fn = np.cross(V[Fd[:, 1]] - V[Fd[:, 0]], V[Fd[:, 2]] - V[Fd[:, 0]]); N = np.zeros_like(V)
for k in range(3): np.add.at(N, Fd[:, k], fn)
N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
print('после упрощения: вершин', n, 'граней', len(Fd))
# ------------------------------------------------------------------ скелет
H = V[:, 1].max(); Lx = V[:, 0].max() - V[:, 0].min(); x0 = V[:, 0].min()
low = V[V[:, 1] < 0.06 * H]                                                    # копыта
legs = {}
for nm, fx, sz in (('HL', -1, 1), ('HR', -1, -1), ('FL', 1, 1), ('FR', 1, -1)):
    sel = low[(np.sign(low[:, 0] - (x0 + 0.5 * Lx)) == fx) & (np.sign(low[:, 2]) == sz)]; legs[nm] = sel.mean(0); legs[nm][1] = 0.02 * H
print('копыта', {k: v.round(3).tolist() for k, v in legs.items()})
def mid_y(xc, band=0.05):                                                      # середина корпуса по высоте в сечении x
    s_ = V[np.abs(V[:, 0] - xc) < band * Lx]; return 0.5 * (s_[:, 1].max() + max(s_[:, 1].min(), 0.35 * H))
xh = 0.5 * (legs['HL'][0] + legs['HR'][0]); xf = 0.5 * (legs['FL'][0] + legs['FR'][0])
J_ = {}; PAR = {}
def jt(name, pos, parent): J_[name] = np.array(pos, float); PAR[name] = parent
jt('root', [xh, mid_y(xh), 0], None); jt('spine', [0.5 * (xh + xf), mid_y(0.5 * (xh + xf)), 0], 'root'); jt('chest', [xf, mid_y(xf), 0], 'spine')
xn = xf + 0.55 * (V[:, 0].max() - xf); jt('neck', [xn, mid_y(xn, 0.04) + 0.05 * H, 0], 'chest')
xhd = xf + 0.82 * (V[:, 0].max() - xf); jt('head', [xhd, mid_y(xhd, 0.03), 0], 'neck')
xt = x0 + 0.04 * Lx; jt('tail0', [x0 + 0.1 * Lx, mid_y(x0 + 0.1 * Lx) + 0.12 * H, 0], 'root'); jt('tail1', [xt, mid_y(xh) - 0.05 * H, 0], 'tail0')
for nm in ('HL', 'HR', 'FL', 'FR'):
    f = legs[nm]; hipy = 0.62 * J_['root'][1] if nm[0] == 'H' else 0.62 * J_['chest'][1]; zz = f[2] * 0.85
    jt(nm + 'th', [f[0], hipy, zz], 'root' if nm[0] == 'H' else 'chest'); jt(nm + 'sh', [f[0] + (-0.02 if nm[0] == 'H' else 0.01) * Lx, 0.42 * hipy, f[2]], nm + 'th'); jt(nm + 'ft', [f[0], 0.02 * H, f[2]], nm + 'sh')
names = list(J_.keys()); NI = {k: i for i, k in enumerate(names)}; NB = len(names); par = [NI[PAR[k]] if PAR[k] else -1 for k in names]; restP = np.array([J_[k] for k in names])
for k in names: print(' кость', k, restP[NI[k]].round(3), '←', PAR[k])
# ------------------------------------------------------------------ веса: расстояние до отрезков костей
kids = {i: [j for j in range(NB) if par[j] == i] for i in range(NB)}
def seg(i):
    a = restP[i]; c = kids[i]
    if names[i] == 'root': return a, restP[NI['spine']]
    if names[i] == 'head': return a, a + np.array([0.12 * Lx, -0.05 * H, 0])
    if names[i].endswith('ft'): return a + np.array([0, 0.04 * H, 0]), a
    if names[i] == 'tail1': return a, a + np.array([-0.04 * Lx, -0.1 * H, 0])
    b = restP[[j for j in c if not names[j][:2] in ('HL', 'HR', 'FL', 'FR') or names[i][:2] == names[j][:2]][0]] if c else a
    return a, b
D2 = np.zeros((n, NB))
for i in range(NB):
    a, b = seg(i); ab = b - a; t = np.clip(((V - a) @ ab) / max(ab @ ab, 1e-9), 0, 1); D2[:, i] = np.linalg.norm(V - (a + t[:, None] * ab), axis=1)
W = np.exp(-(D2 / (0.07 * Lx)) ** 2)
for nm in ('HL', 'HR', 'FL', 'FR'):                                              # нога влияет только на нижнюю часть возле своей оси
    f = legs[nm]; hip = restP[NI[nm + 'th']][1]; rr = np.hypot(V[:, 0] - f[0], V[:, 2] - f[2])
    m = np.clip((hip * 0.9 - V[:, 1]) / (0.25 * hip), 0, 1) * np.clip((0.11 * Lx - rr) / (0.04 * Lx), 0, 1)
    for part in ('th', 'sh', 'ft'): W[:, NI[nm + part]] *= m * 3.0
body = [NI[k] for k in ('root', 'spine', 'chest', 'neck', 'head', 'tail0', 'tail1')]
W[:, body] += 1e-6
top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); w4 /= w4.sum(1, keepdims=True)
# ------------------------------------------------------------------ клипы (синтез)
def aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def qm(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
FPS = 20; ss = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
def synth(dur, loop, fn, tbfn=None):
    nf = int(round(dur * FPS)) + (0 if loop else 1); QF = np.zeros((nf, NB, 4)); QF[..., 3] = 1; TB = []
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1)
        for b, q_ in fn(u).items(): QF[f, NI[b]] = qm(QF[f, NI[b]], q_)
        if tbfn: TB.append(restP[0] + tbfn(u))
    tb = {'0': [[round(float(c), 4) for c in r] for r in TB]} if tbfn else {}
    return {'dur': round(dur, 4), 'nf': nf, 'loop': loop, 'v': 0.0, 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}
Z = [0, 0, 1]; Y = [0, 1, 0]; X = [1, 0, 0]
def idle(u):
    a = 2 * np.pi * u
    return {'chest': aa(Z, 0.015 * np.sin(2 * a)), 'neck': aa(Y, 0.12 * np.sin(a)), 'head': qm(aa(Z, -0.05 * np.sin(2 * a + 1)), aa(Y, 0.08 * np.sin(a + 0.6))),
            'tail0': aa(Y, 0.25 * np.sin(3 * a)), 'tail1': aa(Y, 0.3 * np.sin(3 * a - 0.8))}
def gait(ph, A, K, bob, tl):
    def fn(u):
        r = {}
        for k in ('HL', 'HR', 'FL', 'FR'):
            a = 2 * np.pi * (u + ph[k]); sw = A * np.cos(a); lift = max(0.0, -np.sin(a))
            r[k + 'th'] = aa(Z, sw); r[k + 'sh'] = aa(Z, (K if k[0] == 'H' else -K) * lift); r[k + 'ft'] = aa(Z, -sw * 0.5 + (-0.5 * K if k[0] == 'H' else 0.4 * K) * lift)
        b2 = np.sin(4 * np.pi * u); r['root'] = aa(X, bob * np.sin(2 * np.pi * u)); r['chest'] = aa(X, -bob * np.sin(2 * np.pi * u))
        r['neck'] = aa(Z, 0.04 * b2); r['tail0'] = aa(Y, tl * np.sin(2 * np.pi * u)); r['tail1'] = aa(Y, tl * np.sin(2 * np.pi * u - 0.9))
        return r
    return fn
A0, A1, D0, D1 = 0.30, 0.42, 1.5, 0.85
hipH = float(np.mean([restP[NI[k + 'th']][1] for k in ('HL', 'HR', 'FL', 'FR')]))
clips = {'idle': synth(4.0, True, idle),
         'l0': synth(D0, True, gait({'HL': 0.0, 'FL': 0.25, 'HR': 0.5, 'FR': 0.75}, A0, 0.5, 0.03, 0.15), lambda u: np.array([0, 0.008 * H * np.cos(4 * np.pi * u), 0])),
         'l1': synth(D1, True, gait({'HL': 0.0, 'FR': 0.0, 'HR': 0.5, 'FL': 0.5}, A1, 0.7, 0.045, 0.3), lambda u: np.array([0, 0.018 * H * np.cos(4 * np.pi * u), 0]))}
clips['l0']['v'] = round(2 * hipH * np.sin(A0) / (D0 * 0.5), 4); clips['l1']['v'] = round(2 * hipH * np.sin(A1) / (D1 * 0.5), 4)
def butt(u):        # удар рогами: опускает голову (замах), резкий подъём с рывком, возврат
    dn = ss(0.0, 0.35, u) * (1 - ss(0.42, 0.55, u)); upk = ss(0.42, 0.55, u) * (1 - ss(0.6, 1.0, u))
    r = {'neck': aa(Z, -0.45 * dn + 0.35 * upk), 'head': aa(Z, -0.35 * dn + 0.25 * upk), 'chest': aa(Z, -0.08 * dn + 0.06 * upk)}
    for k in ('FL', 'FR'): r[k + 'th'] = aa(Z, -0.12 * dn + 0.1 * upk); r[k + 'sh'] = aa(Z, -0.25 * dn)
    for k in ('HL', 'HR'): r[k + 'th'] = aa(Z, 0.1 * dn - 0.08 * upk); r[k + 'sh'] = aa(Z, 0.18 * dn)
    r['tail0'] = aa(Z, 0.5 * upk)
    return r
def flinch(u):
    e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5
    return {'neck': aa(Z, 0.25 * e), 'head': aa(Z, 0.12 * e), 'root': aa(X, 0.06 * e), 'chest': aa(X, -0.05 * e), 'tail0': aa(Z, 0.4 * e),
            'HLsh': aa(Z, 0.2 * e), 'HRsh': aa(Z, 0.2 * e), 'FLsh': aa(Z, -0.15 * e), 'FRsh': aa(Z, -0.15 * e)}
clips['atk'] = synth(1.1, False, butt, lambda u: np.array([0.06 * Lx * ss(0.42, 0.55, u) * (1 - ss(0.6, 1, u)), -0.04 * H * ss(0, 0.35, u) * (1 - ss(0.42, 0.55, u)), 0]))
clips['hurt'] = synth(0.8, False, flinch)
print('скорости шага', clips['l0']['v'], 'рыси', clips['l1']['v'], 'высота суставов', round(hipH, 3))
# ------------------------------------------------------------------ вывод (формат jp: raw, цвет вершин)
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
EXP = float(os.environ.get('YAK_EXP', '1.15')); VCOL = np.round(np.clip(lin(CC) * EXP, 0, 1) * 255).astype(np.uint8)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N, -1, 1) * 127).astype(np.int8)), 'uv': b64(np.zeros((n, 2), np.uint16)), 'f': b64(Fd.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros), 'vc': b64(VCOL),
     'par': par, 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': [NI[k + 'ft'] for k in ('HL', 'HR', 'FL', 'FR')], 'neck': [NI['neck']], 'head': NI['head'], 'jaw': NI['head'], 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(H), 4), 'tex': '', 'nativeEyes': 1}
open(out, 'w').write('// Горный як (Midnight Yak, фотоскан GLB без скелета; прислан пользователем, лицензия не указана) — скелет, веса и клипы построены tools/yak_bake.py. Не редактировать.\nexport const YAK = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

# Добыча «Песец» (снега) → модель Fox (присланный GLB: скелет из 40 костей — таз, 2 позвонка, 3 шейных, голова, хвост из 6 звеньев, задние лапы по 4 звена,
# передние по 5; клип «Waking Up» 20 с — лиса спит, просыпается и садится; рыжая текстура; Sketchfab, лицензия не указана) → game/fox.js.
# Запуск: python3 -I tools/fox_bake.py <fox.glb> <выход fox.js>
# Узлы сцены у этой модели расходятся с привязкой (IBM) — берём скелет прямо из привязки в пространстве сетки (y — вверх, z — вперёд), лиса в ней стоит.
# Клип пробуждения для бега/покоя не годится — все клипы синтезированы на настоящем скелете: l0 — шаг (боковая последовательность), l1 — рысь (диагональные пары),
# l2 — галоп (с изгибом спины), idle — дышит, оглядывается, помахивает хвостом, atk — выпад-«щелчок» головой, hurt — вздрагивание.
# Текстура перекрашена в зимний мех песца: рыжий и бурый → белый с холодными тенями; нос, глаза и пасть остаются своими.
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)   # sRGB → линейные (материал читает текстуру без преобразования)
glbf, out = sys.argv[1:3]
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
d = open(glbf, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl]); off = 20 + jl
blen = struct.unpack('<I', d[off:off + 4])[0]; BIN = d[off + 8:off + 8 + blen]
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); item = n * np.dtype(dt).itemsize; stride = bv.get('byteStride') or item
    if stride == item: return np.frombuffer(BIN, dtype=dt, count=a['count'] * n, offset=o).reshape(a['count'], n)
    return np.stack([np.frombuffer(BIN, dtype=dt, count=n, offset=o + k * stride) for k in range(a['count'])])
def image(i):
    bv = J['bufferViews'][J['images'][J['textures'][i]['source']]['bufferView']]; o = bv.get('byteOffset', 0); return Image.open(io.BytesIO(BIN[o:o + bv['byteLength']])).convert('RGB')
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
# ------------------------------------------------------------------ скелет из привязки
nodes = J['nodes']; sk = J['skins'][0]; joints = sk['joints']; NB = len(joints); jidx = {n: i for i, n in enumerate(joints)}
parent_node = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []): parent_node[c] = i
par = [jidx.get(parent_node.get(n), -1) for n in joints]
assert all(p < i for i, p in enumerate(par) if p >= 0), 'порядок костей'
ibm = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).astype(np.float64)
Pm = [np.linalg.inv(ibm[i].T)[:3, 3] for i in range(NB)]
_idn = [i for i in range(NB) if np.allclose(ibm[i], np.eye(4), atol=1e-6)]
for i in _idn:                                                                     # пустая привязка (концевые кости, корни): на месте родителя
    if par[i] >= 0: Pm[i] = Pm[par[i]].copy()
NI_ = {nodes[n].get('name', ''): i for i, n in enumerate(joints)}
def jn(prefix): return [i for k_, i in NI_.items() if k_.startswith(prefix)][0]
G = np.array([[0, 0, 1.0], [0, 1.0, 0], [-1.0, 0, 0]])                            # сетка: z — вперёд, y — вверх → игра: x — вперёд
restP = np.array([G @ p for p in Pm])
head = jn('Fox_ Head'); neck = [jn('Fox_ Neck_'), jn('Fox_ Neck1'), jn('Fox_ Neck2')]; jaw = head
HL = {'L': [jn('Fox_ L Thigh'), jn('Fox_ L Calf'), jn('Fox_ L HorseLink'), jn('Fox_ L Foot_0')], 'R': [jn('Fox_ R Thigh'), jn('Fox_ R Calf'), jn('Fox_ R HorseLink'), jn('Fox_ R Foot_0')]}
FL = {'L': [jn('Fox_ L UpperArm'), jn('Fox_ L Forearm'), jn('Fox_ L Hand'), jn('Fox_ L Finger0_0')], 'R': [jn('Fox_ R UpperArm'), jn('Fox_ R Forearm'), jn('Fox_ R Hand'), jn('Fox_ R Finger0_0')]}
tips = [HL['L'][3], HL['R'][3], FL['L'][3], FL['R'][3]]
TAIL = [jn('Fox_ Tail_')] + [jn('Fox_ Tail%d' % k) for k in range(1, 6)]; PEL = jn('Fox_ Pelvis'); SP = [jn('Fox_ Spine_'), jn('Fox_ Spine1')]
# ------------------------------------------------------------------ сетка
Vl = []; Nl = []; UVl = []; SIl = []; SWl = []; Fl = []; o_ = 0
for m_ in J['meshes']:
    for pp in m_['primitives']:
        a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
        Vl.append(acc(a['POSITION']).astype(np.float64)[u_] @ G.T); Nl.append(acc(a['NORMAL']).astype(np.float64)[u_] @ G.T); UVl.append(acc(a['TEXCOORD_0']).astype(np.float64)[u_] % 1)
        SIl.append(acc(a['JOINTS_0']).astype(np.int64)[u_]); sw_ = acc(a['WEIGHTS_0']).astype(np.float64)[u_]; SWl.append(sw_ / sw_.max() if sw_.max() > 1.5 else sw_)
        Fl.append(rm[ix].reshape(-1, 3) + o_); o_ += len(u_)
V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); SI = np.vstack(SIl); SW = np.vstack(SWl); F = np.vstack(Fl); n = len(V); SW /= np.maximum(SW.sum(1, keepdims=True), 1e-9)
gy = V[:, 1].min(); V[:, 1] -= gy; restP[:, 1] -= gy                              # земля — по низу лап
height = float(V[:, 1].max()); legH = float(restP[HL['L'][0]][1]); legF = float(restP[FL['L'][0]][1])
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(1), V.max(0).round(1), 'бедро', round(legH, 1), 'плечо', round(legF, 1))
# ------------------------------------------------------------------ синтез клипов (кватернионы — повороты от позы привязки в осях игры; вокруг z — вперёд/назад)
def aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def qm(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
ss = lambda a_, b_, x_: (lambda t_: t_ * t_ * (3 - 2 * t_))(min(1, max(0, (x_ - a_) / (b_ - a_))))
Q0 = np.tile([0, 0, 0, 1.0], (NB, 1))
for i, t in enumerate(TAIL): Q0[t] = aa([0, 0, 1], (0.42 if i == 0 else 0.06))        # хвост в привязке торчит прямо назад — опускаем «трубой», чуть изогнутым (кость смотрит назад: +z — вниз)
def synth(dur, fps, loop, fn):
    nf = int(round(dur * fps)) + (0 if loop else 1); QF = np.repeat(Q0[None], nf, 0).copy()
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1)
        for b, q in fn(u).items(): QF[f, b] = qm(QF[f, b], q)
    for f in range(1, nf):
        flip = (QF[f] * QF[f - 1]).sum(1) < 0; QF[f, flip] *= -1
    return QF
def legs(r, ph, A, K, u, fwdK=1.0):
    for side in ('L', 'R'):
        for kind, ch in (('H', HL[side]), ('F', FL[side])):
            a = 2 * np.pi * (u + ph[kind + side]); sw = A * np.cos(a) * (1 if kind == 'H' else fwdK); lift = max(0.0, -np.sin(a)) ** 1.2      # ход назад — опора; вперёд — перенос с подъёмом
            ext = max(0.0, np.sin(a))                                              # опора: лапа выпрямлена
            if kind == 'H':                                                        # задняя: колено вперёд, скакательный сустав назад
                r[ch[0]] = aa([0, 0, 1], sw); r[ch[1]] = aa([0, 0, 1], -K * lift + 0.05 * ext); r[ch[2]] = aa([0, 0, 1], 1.35 * K * lift); r[ch[3]] = aa([0, 0, 1], -0.5 * K * lift)
            else:                                                                  # передняя: локоть назад, запястье подгибает лапу назад-вверх
                r[ch[0]] = aa([0, 0, 1], sw); r[ch[1]] = aa([0, 0, 1], 0.35 * K * lift); r[ch[2]] = aa([0, 0, 1], -1.5 * K * lift); r[ch[3]] = aa([0, 0, 1], -0.35 * K * lift)
def gait(ph, A, K, bob, tailA, headA, flex=0.0, fwdK=1.0):
    def fn(u):
        r = {}; legs(r, ph, A, K, u, fwdK); w = 2 * np.pi * u
        r[PEL] = aa([1, 0, 0], bob * np.sin(w)); b2 = np.sin(2 * w)
        if flex:                                                                   # галоп: спина сгибается, когда задние лапы выносятся вперёд, и распрямляется в толчке
            fl = flex * np.cos(w + 0.4); r[PEL] = qm(r[PEL], aa([0, 0, 1], -0.5 * fl)); r[SP[0]] = aa([0, 0, 1], 0.6 * fl); r[SP[1]] = aa([0, 0, 1], 0.5 * fl); r[neck[0]] = aa([0, 0, 1], -0.7 * fl)
        else: r[SP[1]] = aa([1, 0, 0], -bob * 0.6 * np.sin(w))
        for i, t in enumerate(TAIL): r[t] = aa([0, 1, 0], tailA * np.sin(w - 0.55 * (i + 1))) if not flex else aa([0, 0, 1], 0.12 * np.sin(w - 0.5 * (i + 1)))
        r[neck[1]] = qm(r.get(neck[1], [0, 0, 0, 1.0]), aa([0, 0, 1], headA * b2)); r[head] = aa([0, 0, 1], -headA * 0.7 * b2)
        return r
    return fn
FPS = 30; clips = {}
def put(name, QF, dur, loop, v=0.0, **kw):
    clips[name] = {'dur': round(dur, 4), 'nf': len(QF), 'loop': loop, 'v': round(float(v), 4), 'q': b64(np.round(QF * 32767).astype(np.int16)), 'tb': {}}; clips[name].update(kw)
    print('клип', name, 'кадров', len(QF), 'длит', round(dur, 2), 'скорость', round(float(v), 2))
GW = (1.0, 0.30, 0.55, 0.035, 0.12, 0.04); GT = (0.56, 0.40, 0.85, 0.05, 0.10, 0.05); GG = (0.40, 0.55, 1.0, 0.0, 0.0, 0.03)
put('l0', synth(GW[0], FPS, True, gait({'HL': 0.0, 'FL': 0.25, 'HR': 0.5, 'FR': 0.75}, *GW[1:])), GW[0], True, 2 * legH * np.sin(GW[1]) / (GW[0] * 0.62))
put('l1', synth(GT[0], FPS, True, gait({'HL': 0.0, 'FR': 0.0, 'HR': 0.5, 'FL': 0.5}, *GT[1:])), GT[0], True, 2 * legH * np.sin(GT[1]) / (GT[0] * 0.5))
put('l2', synth(GG[0], FPS, True, gait({'HL': 0.0, 'HR': 0.08, 'FL': 0.42, 'FR': 0.52}, *GG[1:], flex=0.16, fwdK=1.15)), GG[0], True, 2 * legH * np.sin(GG[1]) / (GG[0] * 0.32))
def idle(u):                                                                       # 6 с: дыхание, взгляд влево-вправо, наклон головы, хвост покачивается, переступает весом
    w = 2 * np.pi * u; look = 0.42 * np.sin(w) * (0.6 + 0.4 * np.cos(2 * w)); tilt = 0.12 * np.sin(2 * w + 0.7)
    r = {SP[1]: aa([0, 0, 1], 0.012 * np.sin(5 * w)), neck[0]: aa([0, 1, 0], 0.4 * look), neck[2]: aa([0, 1, 0], 0.35 * look), head: qm(aa([0, 1, 0], 0.3 * look), aa([1, 0, 0], tilt)),
         neck[1]: aa([0, 0, 1], 0.06 * np.sin(3 * w)), PEL: aa([1, 0, 0], 0.02 * np.sin(w + 1.0))}
    for i, t in enumerate(TAIL): r[t] = aa([0, 1, 0], 0.09 * np.sin(2 * w - 0.6 * i) + 0.04 * np.sin(3 * w))
    return r
put('idle', synth(6.0, FPS, True, idle), 6.0, True)
def snap(u):                                                                       # выпад: присел на передние, голова вниз-вперёд, «щёлк», возврат
    crouch = ss(0.0, 0.3, u) * (1 - ss(0.35, 0.5, u)); hit = ss(0.3, 0.45, u) * (1 - ss(0.6, 1.0, u))
    r = {neck[0]: aa([0, 0, 1], 0.15 * crouch - 0.35 * hit), neck[2]: aa([0, 0, 1], -0.1 * hit), head: aa([0, 0, 1], -0.15 * crouch + 0.2 * hit), PEL: aa([0, 0, 1], -0.06 * crouch + 0.05 * hit)}
    for s_ in 'LR': r[FL[s_][1]] = aa([0, 0, 1], 0.3 * crouch); r[FL[s_][2]] = aa([0, 0, 1], -0.35 * crouch); r[HL[s_][1]] = aa([0, 0, 1], -0.25 * crouch); r[HL[s_][2]] = aa([0, 0, 1], 0.3 * crouch)
    for i, t in enumerate(TAIL): r[t] = aa([0, 0, 1], -0.12 * crouch)            # хвост приподнят
    return r
put('atk', synth(0.75, FPS, False, snap), 0.75, False, rate=1.0)
def flinch(u):                                                                     # вздрагивание: голова вверх-назад, корпус в сторону, приседает, хвост поджат
    e = np.sin(np.pi * min(1.0, u * 1.25)) * (1 - u) ** 0.5
    r = {neck[0]: aa([0, 0, 1], 0.3 * e), head: aa([0, 0, 1], 0.15 * e), PEL: aa([1, 0, 0], 0.08 * e), SP[1]: aa([0, 1, 0], 0.12 * e * np.sin(u * 14))}
    for s_ in 'LR': r[HL[s_][1]] = aa([0, 0, 1], -0.3 * e); r[HL[s_][2]] = aa([0, 0, 1], 0.35 * e); r[FL[s_][2]] = aa([0, 0, 1], -0.2 * e)
    for i, t in enumerate(TAIL): r[t] = aa([0, 0, 1], 0.16 * e)                 # хвост поджат
    return r
put('hurt', synth(0.65, FPS, False, flinch), 0.65, False, rate=1.2, span=[0.0, 1.0])
# ------------------------------------------------------------------ текстура: рыжий мех → белый песцовый
tex = np.array(image(J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']).resize((1024, 1024), Image.LANCZOS)).astype(np.float64) / 255
r_, g_, b_ = tex[..., 0], tex[..., 1], tex[..., 2]; L = 0.3 * r_ + 0.59 * g_ + 0.11 * b_
pink = np.clip((r_ - g_ - 0.12) * 6, 0, 1) * np.clip((b_ - g_ + 0.06) * 10, 0, 1)      # пасть и язык (розовые) — свои
warm = np.clip((r_ - b_ + 0.02) * 8, 0, 1) * (1 - pink) * np.clip((L - 0.03) * 25, 0, 1)      # мех: рыжий, кремовый и бурые «чулки» → белый
yy, xx = np.mgrid[0:1024, 0:1024] / 1024.0; warm[(xx - 0.947) ** 2 + (yy - 0.04) ** 2 < 0.045 ** 2] = 0     # глаз (угол листа) — свой
warm[(xx < 0.13) & (yy > 0.9) & (L < 0.3)] = 0                                     # мочка носа — тёмная
sh = np.clip(L / 0.7, 0, 1) ** 0.3
white = np.stack([0.60 + 0.37 * sh, 0.62 + 0.36 * sh, 0.68 + 0.32 * sh], -1)
tex = tex * (1 - warm[..., None]) + white * warm[..., None]
img = Image.fromarray(np.round(np.clip(tex, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS); bf = io.BytesIO(); _LIN(img).save(bf, 'JPEG', quality=86)
sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
if os.environ.get('FOX_TEX'): img.save(os.environ['FOX_TEX'])
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
w4c = np.argsort(-SW, axis=1)[:, :4]; w4 = np.take_along_axis(SW, w4c, 1); w4i = np.take_along_axis(SI, w4c, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 4) for c in p_] for p_ in restP], 'clips': clips, 'tips': tips, 'neck': neck, 'head': head, 'jaw': jaw, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(height, 4), 'tex': sheet, 'nativeEyes': 1}
open(out, 'w').write('// Песец (модель Fox, GLB со скелетом; прислан пользователем, лицензия не указана) — мех перекрашен в белый, шаг/рысь/галоп/покой/выпад/вздрагивание синтезированы tools/fox_bake.py. Не редактировать.\nexport const FOX = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

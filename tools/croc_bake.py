# Крокодил: Sarcosuchus imperator (GLB со скелетом без анимации; Nobilis 2, Sketchfab, CC-BY 4.0) → game/croc.js.
# Запуск: python3 -I tools/croc_bake.py <sarcosuchus_imperator.glb> <выход croc.js> [отладка.npz]
# Делает: поза покоя — из матриц привязки (IBM), сетка и веса из GLB (вторая сетка — родные глаза — отбрасывается: глаза и веки свои, ставятся в игре),
# оригинальная текстура (цвет модели сохраняется, флаг raw), синтез клипов (стойка, шаг, бег — tools/croc_anim.py: в файле анимации нет).
import numpy as np, sys, os, json, base64, struct, io
from PIL import Image
glbf, out = sys.argv[1:3]
dbg = sys.argv[3] if len(sys.argv) > 3 else None
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


G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)       # (xm,ym,zm) → (zm, ym, -xm): вперёд +x, вверх +y, вбок z
def qmat(q):
    x, y, z, w = q; return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q
# ------------------------------------------------------------------ скелет: иерархия узлов, но позиции покоя — из IBM (так лежит сетка)
nodes = J['nodes']; sk = J['skins'][0]; joints = sk['joints']; NB = len(joints); jidx = {n: i for i, n in enumerate(joints)}
parent_node = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []): parent_node[c] = i
par = [jidx.get(parent_node.get(n), -1) for n in joints]
assert all(p < i for i, p in enumerate(par) if p >= 0), 'порядок костей'
names = [nodes[n].get('name') for n in joints]
ibm = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).astype(np.float64)
Pib = np.array([np.linalg.inv(ibm[i].T)[:3, 3] for i in range(NB)])
prim0 = J['meshes'][0]['primitives'][0]; pos0 = acc(prim0['attributes']['POSITION']).astype(np.float64)
CX = float((pos0[:, 0].max() + pos0[:, 0].min()) / 2)                    # сетка и скелет смещены по боку: центрируем на симметрию
shift = np.array([CX, 0.0, 0.0])
restP = (Pib - shift) @ G.T
print('сдвиг по боку', round(CX, 4), 'кости: корень', restP[3].round(3), 'голова', restP[11].round(3), 'хвост', restP[76].round(3))
NI = {n_.split('_')[0] + '_' + '_'.join(n_.split('_')[1:]): i for i, n_ in enumerate(names)}
def find(prefix): return [i for i, n_ in enumerate(names) if n_.startswith(prefix)][0]
height = float(restP[:, 1].max() - restP[:, 1].min())
HEAD = find('bip_head'); JAW = find('bip_jaw'); NECK = [find('bip_neck_131'), find('bip_neck_1_')]
kids = [[j for j in range(NB) if par[j] == i] for i in range(NB)]
TIPS = [i for i in range(NB) if not kids[i] and any(k in names[i] for k in ('index_2', 'middle_2', 'ring_2', 'thumb_1', 'pinky_1', 'Index2', 'Mid2', 'Ring2', 'Thumb2'))]
print('голова', HEAD, 'челюсть', JAW, 'шея', NECK, 'стоп-концов', len(TIPS), [names[i][:22] for i in TIPS])

# ------------------------------------------------------------------ сетка (основная; родные глаза — вторая сетка — не берём)
a_ = prim0['attributes']; nor = acc(a_['NORMAL']).astype(np.float64); uv = acc(a_['TEXCOORD_0']).astype(np.float64)
ji = acc(a_['JOINTS_0']).astype(np.int64); jw = acc(a_['WEIGHTS_0']).astype(np.float64); ix = acc(prim0['indices']).astype(np.int64).ravel().reshape(-1, 3)
V = (pos0 - shift) @ G.T; N = nor @ G.T; N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
jw /= np.maximum(jw.sum(1, keepdims=True), 1e-9); n = len(V)
print('вершин', n, 'граней', len(ix), 'габариты', V.min(0).round(3), V.max(0).round(3))
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
def clipdict(QF_, TB_, nf, dur, loop, v):
    return {'dur': round(dur, 4), 'nf': nf, 'loop': loop, 'v': round(v, 4), 'q': base64.b64encode(np.round(QF_ * 32767).astype(np.int16).tobytes()).decode(), 'tb': {str(i): [[round(float(c), 5) for c in r] for r in np.array(v_)] for i, v_ in TB_.items()}}
clips = {}
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'croc_anim.py')).read())
# ------------------------------------------------------------------ текстура: оригинальная (цвет модели сохраняется), линеаризуем: материал игры без sRGB-декодирования
EXP = float(os.environ.get('CROC_EXP', '1.7'))
tex = np.array(image(0).convert('RGB')).astype(np.float64) / 255
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
Image.fromarray(np.round(np.clip(lin(tex) * EXP, 0, 1) * 255).astype(np.uint8)).save('/tmp/croc_sheet.jpg', quality=86)
sheet_b64 = base64.b64encode(open('/tmp/croc_sheet.jpg', 'rb').read()).decode(); print('текстура', len(sheet_b64) // 1024, 'КБ')
# глаза: кости bip_eye_*; положение подбирается по рендерам (CROC_EYE="dx,dy,dz,r" — смещение от кости и радиус)
ek = [float(x) for x in os.environ.get('CROC_EYE', '0,0,0,0.045').split(',')]
EYR = restP[find('bip_eye_r')] + np.array(ek[:3]); EYL = restP[find('bip_eye_l')] + np.array([ek[0], ek[1], -ek[2]])
EYES = [[round(float(c), 5) for c in EYR], [round(float(c), 5) for c in EYL]]; EYER = [ek[3], ek[3]]
LIDC = []
for e_ in (EYR, EYL):
    near = np.linalg.norm(V - e_, axis=1) < 0.14
    px = np.clip((uv[near, 0] * 1023).astype(int), 0, 1023); py = np.clip((uv[near, 1] * 1023).astype(int), 0, 1023)
    col_ = np.clip(lin(tex[py, px]) * EXP, 0, 1); lum_ = col_ @ np.array([0.3, 0.55, 0.15]); keep_ = lum_ > np.percentile(lum_, 5)
    LIDC.append([round(float(c), 4) for c in col_[keep_].mean(0)])
print('цвет век', LIDC)
top = np.argsort(-jw, axis=1)[:, :4]; w4 = np.take_along_axis(jw, top, 1); w4i = np.take_along_axis(ji, top, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(N * 127).astype(np.int8)), 'uv': b64(np.round(np.clip(uv, 0, 1) * 65535).astype(np.uint16)), 'f': b64(ix.astype(np.uint16)),
     'si': b64(w4i.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 6) for c in p] for p in restP], 'clips': clips, 'tips': TIPS, 'neck': NECK, 'head': HEAD, 'jaw': JAW, 'jsign': 1.0,
     'eyes': EYES, 'eyeR': EYER, 'lid': LIDC, 'height': round(height, 5), 'tex': sheet_b64}
open(out, 'w').write('// Крокодил (Sarcosuchus imperator — Nobilis 2, Sketchfab, CC BY 4.0) — подготовлено tools/croc_bake.py. Не редактировать.\nexport const CROC = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg: np.savez(dbg, V=V, F=ix, top=top, w4=w4i, restP=restP, par=np.array(par), names=np.array(names), UV=uv)

# Враг «Брахиозавр»: Brachiosaurus (Creazilla, Creazilla Open-Source License; низкополигональная версия Brachiosaurus-bl.obj + текстура) → game/bra.js.
# Запуск: python3 tools/bra_bake.py "<папка модели>" <выход bra.js> [отладка.npz]
# В модели нет скелета, поэтому он строится здесь: корпус (таз, поясница, грудь), шея 6 костей, голова, хвост 6 костей, четыре ноги (бедро/колено/стопа).
# Оси переводятся в игровые (x вперёд, y вверх, z вбок), земля — y = 0. Веса кожи — по расстоянию до костей-капсул (плавные суставы).
# Задние ноги в модели стоят на 0,17 выше передних — здесь ноги слегка вытягиваются, чтобы все четыре стояли на земле.
# Карта цвета: копия текстуры с нормированной яркостью (0,5 = нейтрально) — игра умножает её на цвет по палитре врага, морщины и полосы шкуры остаются.
import numpy as np, sys, os, json, base64, io
from PIL import Image
from scipy.ndimage import gaussian_filter

src, out = sys.argv[1:3]
dbg = sys.argv[3] if len(sys.argv) > 3 else None
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))

# ------------------------------------------------------------------ сетка (позиция+uv → одна вершина)
P = []; T = []; keymap = {}; Vi = []; F = []
for l in open(os.path.join(src, 'Brachiosaurus-bl.obj')):
    if l.startswith('v '): P.append([float(c) for c in l.split()[1:4]])
    elif l.startswith('vt '): T.append([float(c) for c in l.split()[1:3]])
P = np.array(P); T = np.array(T)
for l in open(os.path.join(src, 'Brachiosaurus-bl.obj')):
    if not l.startswith('f '): continue
    ids = []
    for tok in l.split()[1:]:
        a = tok.split('/'); k = (int(a[0]) - 1, int(a[1]) - 1)
        if k not in keymap: keymap[k] = len(Vi); Vi.append(k)
        ids.append(keymap[k])
    for j in range(1, len(ids) - 1): F.append([ids[0], ids[j], ids[j + 1]])
F = np.array(F); Vi = np.array(Vi); n = len(Vi)
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)
V = P[Vi[:, 0]] @ G.T; UV = T[Vi[:, 1]].copy(); UV[:, 1] = 1 - UV[:, 1]
GROUND = V[:, 1].min(); V[:, 1] -= GROUND
print('вершин', n, 'граней', len(F), 'габариты', V.min(0).round(2), V.max(0).round(2))
# задние ноги чуть длиннее (стоят на одном уровне с передними)
hind_lift = (V[(V[:, 0] < 0.15) & (V[:, 1] < 0.4), 1].min())
print('подъём задних стоп', round(hind_lift, 3))
wx = sstep(0.7, -0.2, V[:, 0]); ty = np.clip((0.9 + 0.2 - V[:, 1]) / (0.9 + 0.2 - hind_lift), 0, 1)
V[:, 1] -= hind_lift * wx * sstep(0, 1, ty)
V[:, 1] = np.maximum(V[:, 1], 0)
print('после выравнивания', V.min(0).round(2), V.max(0).round(2))

# ------------------------------------------------------------------ скелет
g = GROUND
bones = []   # (имя, родитель, позиция, радиус капсулы, сигма)
def B(name, par, pos, rad, sig): bones.append((name, par, np.array(pos, float), rad, sig)); return len(bones) - 1
SH = lambda x, y, z=0.0: [x, y + 0.983, z]          # те же сдвиги, что у сетки (земля = 0)
root = B('root', -1, SH(-0.35, 0.85), 0.5, 0.35)
spine = B('spine', root, SH(0.35, 0.88), 0.5, 0.35)
chest = B('chest', spine, SH(1.05, 0.98), 0.45, 0.3)
neckp = [(1.5, 1.72), (1.9, 2.08), (2.2, 2.5), (2.4, 2.95), (2.58, 3.42), (2.72, 3.9)]
nk = []; prev = chest
for i, (x, y) in enumerate(neckp):
    prev = B('n%d' % i, prev, SH(x, y), 0.12 if i else 0.3, 0.3); nk.append(prev)
head = B('head', prev, SH(2.92, 4.32), 0.1, 0.22)
tailp = [(-1.05, 0.85), (-1.55, 0.7), (-2.0, 0.58), (-2.45, 0.5), (-2.9, 0.43), (-3.25, 0.34)]
tl = []; prev = root
for i, (x, y) in enumerate(tailp):
    prev = B('t%d' % i, prev, SH(x, y), 0.15 if i else 0.3, 0.3); tl.append(prev)
LEGS = {}
for nm, par, x, hy, ky, ay, fy in (('hl', root, -0.65, 0.7, -0.05, -0.62, -0.96), ('hr', root, -0.65, 0.7, -0.05, -0.62, -0.96),
                                    ('fl', chest, 1.07, 0.75, 0.0, -0.78, -0.96), ('fr', chest, 1.07, 0.75, 0.0, -0.78, -0.96)):
    z = 0.42 if nm[1] == 'l' else -0.42
    a = B(nm + '_hip', par, SH(x, hy, z), 0.26, 0.22); b = B(nm + '_knee', a, SH(x, ky, z), 0.24, 0.22); c = B(nm + '_foot', b, SH(x, ay, z), 0.26, 0.22)
    LEGS[nm] = (a, b, c)
NB = len(bones); par = [b[1] for b in bones]; pos = np.array([b[2] for b in bones])
assert all(p < i for i, p in enumerate(par))
print('костей', NB, 'ноги', LEGS, 'голова', head, 'шея', nk, 'хвост', tl)

# ------------------------------------------------------------------ веса: капсулы от кости до первого потомка (ноги — до следующей кости цепи)
ends = {}
for i, b in enumerate(bones):
    ch = [j for j in range(NB) if par[j] == i]
    ends[i] = None
tip = {head: pos[head] + np.array([0.7, 0.2, 0]), tl[-1]: pos[tl[-1]] + np.array([-0.2, -0.05, 0])}
for nm, (a, b, c) in LEGS.items(): tip[c] = pos[c] + np.array([0.1, -0.2, 0])
seg = []
for i in range(NB):
    if i in tip: e = tip[i]
    else:
        ch = [j for j in range(NB) if par[j] == i and not any(i == v[0] for v in LEGS.values())]
        if i == root: ch = [spine]
        if i == chest: ch = [nk[0]]
        if i == spine: ch = [chest]
        if i in [v[0] for v in LEGS.values()]: ch = [i + 1]
        if i in [v[1] for v in LEGS.values()]: ch = [i + 1]
        if i in nk: ch = [nk[nk.index(i) + 1]] if nk.index(i) < 5 else [head]
        if i in tl: ch = [tl[tl.index(i) + 1]] if tl.index(i) < 5 else []
        e = pos[ch[0]] if ch else pos[i] + np.array([0.1, 0, 0])
    seg.append((pos[i], e))
def dist_seg(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1); return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
W = np.zeros((n, NB))
for i in range(NB):
    d = dist_seg(V, seg[i][0], seg[i][1]); rad = bones[i][3]; sg = bones[i][4]
    W[:, i] = np.exp(-(np.maximum(0, d - rad) / sg) ** 2)
# ногам нельзя тянуть тело выше таза: вершины выше бёдер (y > 1.45 над землёй) почти не получают весов ног
legbones = [b for v in LEGS.values() for b in v]
for b in legbones: W[:, b] *= 1 - sstep(1.55, 1.95, V[:, 1])
# ноги: левая/правая сторона не смешиваются (вершины на другой стороне)
for nm, (a, b, c) in LEGS.items():
    side = 1 if nm[1] == 'l' else -1
    for k in (a, b, c): W[:, k] *= sstep(-0.05, 0.12, V[:, 2] * side)
# хвост и шея не воздействуют на тело, туловище не тянет хвост/шею вдали от основания
for k in tl: W[:, k] *= 1 - sstep(-0.7, -0.3, V[:, 0]) * 0 
# нормировка, топ-4
top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
zero = (W.sum(1) < 1e-6); print('вершин без весов', int(zero.sum())); top[zero, 0] = root; w4[zero] = [1, 0, 0, 0]
dom = top[np.arange(n), np.argmax(w4, axis=1)]
print('доминантные кости (число вершин):', {bones[k][0]: int((dom == k).sum()) for k in range(NB)})

# ------------------------------------------------------------------ нормали
N = np.zeros((n, 3)); tri = V[F]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
# нормали усредняются по позиции (швы uv не рвут освещение)
pid = Vi[:, 0]; acc = np.zeros((len(P), 3))
for k in range(3): np.add.at(acc, pid[F[:, k]], fn)
N = acc[pid]; N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)

# ------------------------------------------------------------------ карта цвета из текстуры (атлас с тёмным фоном): яркость нормируется по телу (0,5 = нейтрально), цвет остаётся — игра умножает на цвет врага
tex = np.array(Image.open(os.path.join(src, 'Brachiosaurus_texture.png')).convert('RGB')).astype(np.float64) / 255
bg = tex[0, 0]; mask = np.abs(tex - bg).sum(2) > 0.06; print('фон', bg.round(3), 'доля тела', round(float(mask.mean()), 2))
Lm = tex @ np.array([0.3, 0.55, 0.15]); meanL = Lm[mask].mean()
sheet = np.clip(tex * (0.5 / meanL), 0, 1); sheet[~mask] = 0.5
Image.fromarray(np.round(sheet * 255).astype(np.uint8)).save('/tmp/bra_sheet.jpg', quality=72)
sheet_b64 = base64.b64encode(open('/tmp/bra_sheet.jpg', 'rb').read()).decode(); print('лист цвета', len(sheet_b64) // 1024, 'КБ')

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 5000
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(N * 127).astype(np.int8)),
     'uv': b64(np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'dom': b64(dom.astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 4) for c in p] for p in pos], 'names': [b[0] for b in bones],
     'idx': {'root': root, 'spine': spine, 'chest': chest, 'neck': nk, 'head': head, 'tail': tl, 'legs': {k: list(v) for k, v in LEGS.items()}},
     'eyes': [[3.31, 4.6 - GROUND, 0.12], [3.31, 4.6 - GROUND, -0.12]], 'eyeR': 0.035, 'tex': sheet_b64}
open(out, 'w').write('// Враг «Брахиозавр»: Brachiosaurus (Creazilla Open-Source License, creazilla.com) — подготовлено tools/bra_bake.py. Не редактировать.\nexport const BRA = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg: np.savez(dbg, V=V, F=F, N=N, UV=UV, top=top, w4=w4, dom=dom, pos=pos, par=np.array(par))

# Модель летающего класса (птеродактиль, Creazilla): OBJ + текстура → game/ptero.js.
# Запуск: python3 tools/ptero_bake.py <Pterodactyl-bl.obj> <UV.png> <выходной ptero.js> [отладочная папка]
# Шаги: чтение OBJ → отбрасываем глаза-сферы (глаза собираются в игре) → адаптивное разбиение длинных рёбер (перепонка гнётся плавно)
# → цвет вершин из текстуры (класс + деталь яркости, палитру игрока накладывает код игры) → поворот головы клювом вперёд → кости и веса.
import numpy as np, sys, os, json, base64
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

obj, texf, out = sys.argv[1], sys.argv[2], sys.argv[3]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
tex = np.array(Image.open(texf).convert('RGB')).astype(np.float64) / 255; TH, TW = tex.shape[:2]
def samp(u, v):
    return tex[int((1 - v % 1) * (TH - 1)), int(u % 1 * (TW - 1))]

# ------------------------------------------------------------------ 1. чтение
P0, UV0, faces = [], [], []
for l in open(obj):
    p = l.split()
    if not p: continue
    if p[0] == 'v': P0.append([float(x) for x in p[1:4]])
    elif p[0] == 'vt': UV0.append([float(x) for x in p[1:3]])
    elif p[0] == 'f':
        c = [(int(t.split('/')[0]) - 1, int(t.split('/')[1]) - 1) for t in p[1:]]
        for k in range(1, len(c) - 1): faces.append([c[0], c[k], c[k + 1]])
P0 = np.array(P0); UV0 = [np.array(u) for u in UV0]; n0 = len(P0)
# компоненты связности: глаза (две сферы) убираем
r_ = []; c_ = []
for f in faces:
    for i in range(3): r_.append(f[i][0]); c_.append(f[(i + 1) % 3][0])
nc, lab = connected_components(coo_matrix((np.ones(len(r_)), (r_, c_)), shape=(n0, n0)), directed=False)
eyeComp = [i for i in range(nc) if (lab == i).sum() == 65]
print('компонент', nc, 'глаза', eyeComp)
eyes0 = [P0[lab == i].mean(0) for i in eyeComp]
print('глаза', np.round(eyes0, 3))
faces = [f for f in faces if lab[f[0][0]] not in eyeComp]
# вычищаем вырожденные грани (когти — треугольники нулевой площади оставляем только непустые)
def area(f): return np.linalg.norm(np.cross(P0[f[1][0]] - P0[f[0][0]], P0[f[2][0]] - P0[f[0][0]])) / 2
faces = [f for f in faces if area(f) > 1e-7]

# ------------------------------------------------------------------ 2. разбиение: конформное, по длине ребра
V = [tuple(p) for p in P0]; COL = [None] * n0; comp = list(lab)
vcols = [[] for _ in range(n0)]
for f in faces:
    for (vi, ti) in f: vcols[vi].append(samp(*UV0[ti]))
for i in range(n0): COL[i] = np.mean(vcols[i], 0) if vcols[i] else np.array([0.5, 0.5, 0.5])
LMAX = 0.55
for it in range(7):
    mid = {}; nf = []; changed = 0
    def midv(a, b, f):
        key = (a[0], b[0]) if a[0] < b[0] else (b[0], a[0])
        if key not in mid:
            pa, pb = np.array(V[a[0]]), np.array(V[b[0]]); V.append(tuple((pa + pb) / 2))
            uv = (UV0[a[1]] + UV0[b[1]]) / 2; COL.append(samp(*uv)); comp.append(comp[a[0]]); mid[key] = len(V) - 1
        return mid[key]
    # какие рёбра длиннее порога — по позициям (одинаково для обеих смежных граней)
    for f in faces:
        e = [(0, 1), (1, 2), (2, 0)]
        sp = [np.linalg.norm(np.array(V[f[a][0]]) - np.array(V[f[b][0]])) > LMAX for a, b in e]
        if not any(sp): nf.append(f); continue
        changed += 1
        m = [None] * 3
        for k, (a, b) in enumerate(e):
            if sp[k]:
                vi = midv(f[a], f[b], f); m[k] = (vi, None)
        # uv середины берём как среднее; для граней храним uv индексом в расширенный список
        for k, (a, b) in enumerate(e):
            if sp[k]:
                UV0.append((UV0[f[a][1]] + UV0[f[b][1]]) / 2); m[k] = (m[k][0], len(UV0) - 1)
        A, B, C = f
        ns = sum(sp)
        if ns == 3:
            nf += [[A, m[0], m[2]], [m[0], B, m[1]], [m[2], m[1], C], [m[0], m[1], m[2]]]
        elif ns == 2:
            if not sp[0]:   # разбиты BC (1) и CA (2)
                nf += [[A, B, m[1]], [A, m[1], m[2]], [m[2], m[1], C]]
            elif not sp[1]:  # разбиты AB (0) и CA (2)
                nf += [[A, m[0], m[2]], [m[0], B, C], [m[0], C, m[2]]]
            else:            # разбиты AB (0) и BC (1)
                nf += [[A, m[0], C], [m[0], B, m[1]], [m[0], m[1], C]]
        else:
            if sp[0]: nf += [[A, m[0], C], [m[0], B, C]]
            elif sp[1]: nf += [[A, B, m[1]], [A, m[1], C]]
            else: nf += [[A, B, m[2]], [m[2], B, C]]
    faces = nf
    print('проход', it, 'разбито', changed, 'вершин', len(V), 'граней', len(faces))
    if not changed: break
V = np.array(V); COL = np.array(COL); comp = np.array(comp)
F = np.array([[f[0][0], f[1][0], f[2][0]] for f in faces], dtype=np.int64)
# выбросить неиспользованные вершины
used = np.unique(F); remap = -np.ones(len(V), dtype=np.int64); remap[used] = np.arange(len(used))
V, COL, comp = V[used], COL[used], comp[used]; F = remap[F]; n = len(V)
print('итого вершин', n, 'граней', len(F))
assert n < 65536

# ------------------------------------------------------------------ 3. классы
x, y, z = V[:, 0], V[:, 1], V[:, 2]; az = np.abs(z)
membrane = comp == 0
claw = (comp != 0) & (comp != 1) & (comp >= 2)
wing = membrane | claw | ((comp == 1) & (az > 0.62) & (x > -2.4))
leg = (comp == 1) & ~wing & (az > 0.3) & (x < -2.55)
# голова: x > 1.75 + гребень; нижняя челюсть: ниже линии под клювом
crest = (comp == 1) & ~wing & (y > 2.15) & (x > -0.45) & (az < 0.5)
headRegion = (comp == 1) & ~wing & ~leg & (x > 1.7)
jline = np.where(x > 2.1, 1.28 - 0.5 * (x - 2.1), np.where(x > 1.55, 1.62 - 0.55 * (x - 1.55) * 0 - (x - 1.55) * 0.60 + 0.0, -9))
# граница между верхним клювом и нижней челюстью: линия через (1.55,1.62)… (2.1,1.28) … дальше с наклоном -0.5
jaw = headRegion & ~crest & (y < jline) & (x > 1.55)
beak = headRegion & ~crest & ~jaw & (x > 2.0)
cls = np.zeros(n, dtype=np.uint8)   # 0 кожа/тело, 1 перепонка, 2 гребень, 3 клюв (верх и низ), 4 когти/пальцы ног
cls[membrane] = 1; cls[crest] = 2; cls[beak | jaw] = 3
cls[claw] = 4
toes = leg & (x < -4.05); cls[toes] = 4
print('классы', {k: int((cls == k).sum()) for k in range(5)}, 'челюсть', int(jaw.sum()), 'ноги', int(leg.sum()), 'крыло', int(wing.sum()), 'голова', int(headRegion.sum()))

# ------------------------------------------------------------------ 4. деталь яркости из текстуры (палитру накладывает игра)
lum = COL @ np.array([0.3, 0.55, 0.15])
detail = np.ones(n)
for k in range(5):
    m = cls == k
    if m.sum() > 3: detail[m] = np.clip(lum[m] / max(1e-3, np.median(lum[m])), 0.45, 1.5)
detail = np.clip(detail, 0.45, 1.5)

# ------------------------------------------------------------------ 5. поворот головы (клюв вперёд), кости и веса
ANG = np.radians(18); PIV = np.array([1.55, 1.75, 0.0])
hw = sstep(1.0, 1.95, x) * (~wing) * (~leg)
hw[crest | jaw | beak | headRegion] = 1.0
hw[(comp == 1) & ~wing & ~leg & (x <= 1.0)] = 0
def rotz(P, a, piv):
    d = P - piv; c, s_ = np.cos(a), np.sin(a)
    return piv + np.stack([d[:, 0] * c - d[:, 1] * s_, d[:, 0] * s_ + d[:, 1] * c, d[:, 2]], 1)
Vr = V + hw[:, None] * (rotz(V, ANG, PIV) - V)
eyesR = rotz(np.array(eyes0), ANG, PIV)
V = Vr
print('глаза после поворота', np.round(eyesR, 3))
# нормализация: центр тела по y = 0 не трогаем (кости считают от модели); масштаб в игре
# кости: имя, родитель, позиция
BONES = [
    ('root', -1, (-1.4, 1.5, 0)), ('neck0', 0, (-0.1, 1.68, 0)), ('neck1', 1, (0.95, 1.78, 0)), ('head', 2, (1.6, 1.82, 0)), ('jaw', 3, (1.68, 1.55, 0)),
]
JZ = [0.7, 2.9, 5.0, 9.0]
for sd, nm in ((1, 'R'), (-1, 'L')):
    prev = 0
    for i, jz in enumerate(JZ):
        BONES.append(('w%d%s' % (i, nm), 0 if i == 0 else len(BONES) - 1, (-0.7 if i < 3 else -0.8, 1.565, sd * jz)))
for sd, nm in ((1, 'R'), (-1, 'L')):
    base = len(BONES)
    BONES += [('thigh' + nm, 0, (-2.65, 1.56, sd * 0.45)), ('shin' + nm, base, (-3.15, 1.56, sd * 0.93)), ('foot' + nm, base + 1, (-4.25, 1.56, sd * 0.93))]
bi = {b[0]: i for i, b in enumerate(BONES)}; nb = len(BONES); print('костей', nb)
W = np.zeros((n, nb))
def put(m, name, w=1.0): W[m, bi[name]] += w if np.isscalar(w) else w[m]
# тело / шея / голова
body = ~wing & ~leg
tn0 = sstep(-0.4, 0.4, x); tn1 = sstep(0.5, 1.3, x); th_ = sstep(1.3, 1.9, x)
wr = body.astype(float)
W[:, bi['root']] += wr * (1 - tn0)
W[:, bi['neck0']] += wr * tn0 * (1 - tn1)
W[:, bi['neck1']] += wr * tn0 * tn1 * (1 - th_)
W[:, bi['head']] += wr * tn0 * tn1 * th_
# челюсть: полностью своя кость, у корня плавно
jw = np.where(jaw, sstep(1.55, 2.2, x), 0.0)
W[:, bi['head']] *= (1 - jw)[:, None].ravel() if False else (1 - jw)
for k in ('root', 'neck0', 'neck1'): W[:, bi[k]] *= (1 - jw)
W[:, bi['jaw']] += jw
# крылья (цепочка по |z|), у тела — смешивание с корнем
for sd, nm in ((1, 'R'), (-1, 'L')):
    m = wing & (np.sign(z) * (1 if sd > 0 else -1) >= 0)
    a = az
    for i in range(4):
        lo = JZ[i - 1] if i else -1; hi = JZ[i + 1] if i < 3 else 1e9
        if i == 0: wgt = np.where(a < JZ[1], 1 - sstep(JZ[0], JZ[1], a), 0.0)
        elif i < 3: wgt = np.where(a < JZ[i], sstep(JZ[i - 1], JZ[i], a), np.where(a < JZ[i + 1], 1 - sstep(JZ[i], JZ[i + 1], a), 0.0))
        else: wgt = sstep(JZ[2], JZ[3], a)
        # линейный вес (а не sstep), чтобы изгиб был равномерным
        W[:, bi['w%d%s' % (i, nm)]] += m * wgt
    # соединение с телом: внутри |z| < 1.0 вес смешивается с корнем
    rt = np.where(membrane | claw, 1 - sstep(0.35, 1.05, a), 1 - sstep(0.62, 0.95, a))
    cols = [bi['w%d%s' % (i, nm)] for i in range(4)]
    W[np.ix_(np.where(m)[0], cols)] *= (1 - rt[m])[:, None]
    W[m, bi['root']] += rt[m]
# ноги (по x вдоль ноги)
for sd, nm in ((1, 'R'), (-1, 'L')):
    m = leg & (z * sd >= 0)
    t = x
    W[m, bi['thigh' + nm]] += (1 - sstep(-3.35, -2.9, t))[m] * 0 + (1 - sstep(-3.4, -2.8, t))[m]
    W[m, bi['shin' + nm]] += (sstep(-3.4, -2.8, t) * (1 - sstep(-4.5, -3.9, t)))[m]
    W[m, bi['foot' + nm]] += sstep(-4.5, -3.9, t)[m]
    # у корня бедра — смешивание с телом
    rt2 = (1 - sstep(-3.0, -2.6, x))
    # (x > -2.55 — уже тело; ноги начинаются при x < -2.55)
W[~(wing | leg), :]  # ничего
tot = W.sum(1, keepdims=True); tot[tot == 0] = 1; W /= tot
# 4 сильнейших влияния
idx = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, idx, 1); w4 /= w4.sum(1, keepdims=True)
print('макс влияний >4:', int((W > 1e-4).sum(1).max()))

# AO-подобное затемнение подбрюшья и подкрыльев — в игре по нормали; здесь только глубина «вниз»
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 2000
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'f': b64(F.astype(np.uint16)), 'c': b64(cls), 'd': b64(np.round(detail * 100).astype(np.uint8)),
     'si': b64(idx.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'bones': [[b[0], b[1], [round(float(c), 4) for c in b[2]]] for b in BONES],
     'eyes': [[round(float(c), 4) for c in e] for e in eyesR], 'beak': [round(float(c), 4) for c in V[np.argmax(x)]],
     'crest': [round(float(c), 4) for c in V[np.argmax(np.where(crest, 1, 0) * (3.4 - V[:, 0] * 0 - 0) * V[:, 1])]],
     'jawv': int(jaw.sum())}
open(out, 'w').write('// Модель летающего класса (птеродактиль, Creazilla.com — свободное использование): подготовлена tools/ptero_bake.py. Не редактировать.\nexport const PTERO = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg:
    os.makedirs(dbg, exist_ok=True)
    np.savez(os.path.join(dbg, 'dbg.npz'), V=V, F=F, cls=cls, detail=detail, W=W, jaw=jaw, wing=wing, leg=leg, comp=comp)

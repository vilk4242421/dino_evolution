# Игрок «Мегалодон» (вместо ихтиозавра): акула PA Shark (FBX со скелетом из 17 костей и анимацией плавания) → game/shk.js.
# Запуск: python3 tools/shk_bake.py <PA_SharkHigh.fbx> <PA_SharkDiffuse.png> <выход shk.js> [отладка.npz]
# Делает: читает сетку/UV/скиннинг/клипы из FBX (tools/fbx_read.py), переводит оси в игровые (x вперёд, y вверх, z вбок), делает скелет «осевым»
# (у всех костей единичный поворот покоя), пересчитывает клип плавания в вращения этого скелета, строит маски рта и зубов
# и карту цвета (текстура с нормированной яркостью — игра умножает её на цвет по палитре). Глаза и веки собираются в игре.
import numpy as np, sys, os, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image
from scipy.ndimage import gaussian_filter

fbx, texf, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
TICK = 46186158000.0
F = load(fbx); objs = F['objs']; M = F['models']
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))

# ------------------------------------------------------------------ скелет
bone_ids = [i for i, m in M.items() if m['type'] == 'LimbNode']
# порядок: родитель раньше ребёнка
order = []
def add(i):
    if i in order: return
    p = M[i]['parent']
    if p in bone_ids: add(p)
    order.append(i)
for i in bone_ids: add(i)
idx = {b: k for k, b in enumerate(order)}; NB = len(order); par = [idx[M[b]['parent']] if M[b]['parent'] in idx else -1 for b in order]
names = [M[b]['name'] for b in order]
def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def euler(d): a = np.radians(d); return rz(a[2]) @ ry(a[1]) @ rx(a[0])            # порядок XYZ (FBX): R = Rz·Ry·Rx
PRE = [euler(M[b]['pre']) for b in order]; T0 = [np.array(M[b]['T'], float) for b in order]; R0 = [np.array(M[b]['R'], float) for b in order]
def fk(Tl, Rl):                                                                   # мировые позиции и повороты костей по локальным T и углам R
    Pw = [None] * NB; Rw = [None] * NB
    for i in range(NB):
        Rloc = PRE[i] @ euler(Rl[i])
        if par[i] < 0: Pw[i] = Tl[i].copy(); Rw[i] = Rloc
        else: Pw[i] = Pw[par[i]] + Rw[par[i]] @ Tl[i]; Rw[i] = Rw[par[i]] @ Rloc
    return np.array(Pw), Rw
# поза покоя — из матриц привязки кластеров (Lcl-значения в файле — поза в начале клипа, а не покоя)
cl = [i for i, o in objs.items() if o.name == 'Deformer' and o.props[2] == 'Cluster']
cluster_of = {}; P0 = np.zeros((NB, 3)); Rw0 = [None] * NB
for c in cl:
    b = [k for k in F['kids'].get(c, []) if k in idx]
    if not b: continue
    Mx = objs[c].get('TransformLink').props[0].reshape(4, 4).T; Rm = Mx[:3, :3] / np.maximum(np.linalg.norm(Mx[:3, :3], axis=0, keepdims=True), 1e-9)
    P0[idx[b[0]]] = Mx[:3, 3]; Rw0[idx[b[0]]] = Rm; cluster_of[c] = idx[b[0]]
assert all(r is not None for r in Rw0), 'у кости нет кластера'
Pc, Rc = fk(T0, R0)
print('FK по Lcl и привязка: позиции расходятся на', round(float(np.abs(Pc - P0).max()), 3), '(ожидаемо: Lcl — поза клипа)')
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)                  # (x,y,z)_fbx → (z, y, -x) игры
restP = P0 @ G.T
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q

# ------------------------------------------------------------------ клип (кривые Lcl Translation/Rotation)
cn = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurveNode' and b in idx: cn[a] = (idx[b], p)
curves = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurve' and b in cn:
        c = objs[a]; curves[(cn[b][0], cn[b][1], p)] = (c.get('KeyTime').props[0] / TICK, c.get('KeyValueFloat').props[0].astype(np.float64))
t0 = min(v[0][0] for v in curves.values()); t1 = max(v[0][-1] for v in curves.values()); FPS = 24
NF = int(round((t1 - t0) * FPS)) + 1
print('клип: %.2f с, кадров %d' % (t1 - t0, NF))
def samp(key, t, default):
    if key not in curves: return default
    ts, vs = curves[key]; return float(np.interp(t, ts, vs))
QF = np.zeros((NF, NB, 4)); TB = {}
for f in range(NF):
    t = t0 + f / FPS; Tl = []; Rl = []
    for i in range(NB):
        Tl.append(np.array([samp((i, 'Lcl Translation', 'd|' + ax), t, T0[i][k]) for k, ax in enumerate('XYZ')]))
        Rl.append(np.array([samp((i, 'Lcl Rotation', 'd|' + ax), t, R0[i][k]) for k, ax in enumerate('XYZ')]))
    Pa, Rwa = fk(Tl, Rl)
    Delta = [G @ (Rwa[i] @ Rw0[i].T) @ G.T for i in range(NB)]                       # поворот кости относительно покоя, в игровых осях (мировой)
    for i in range(NB):
        q = qmat_to_q(Delta[i] if par[i] < 0 else Delta[par[i]].T @ Delta[i])
        if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
        elif f == 0 and q[3] < 0: q = -q
        QF[f, i] = q
        if (i, 'Lcl Translation', 'd|X') in curves:                                  # движется положение кости (тело): локальный сдвиг в мировых осях родителя
            tw = Tl[i] if par[i] < 0 else Rw0[par[i]] @ Tl[i]
            TB.setdefault(i, []).append(G @ tw)
# клип зациклен (последний кадр = первому) — убираем дубль; средняя поза каждой кости нужна, чтобы в игре гасить «жевание» челюстей клипа
NF -= 1; QF = QF[:NF]; TB = {i: v[:NF] for i, v in TB.items()}
AVG = []
for i in range(NB):
    q = QF[:, i].copy(); q *= np.sign(q @ q[0])[:, None]; a_ = q.mean(0); AVG.append((a_ / np.linalg.norm(a_)).tolist())
tb = {str(i): [[round(float(c), 4) for c in r] for r in np.array(v)] for i, v in TB.items()}
print('кости с позицией:', list(tb.keys()))

# ------------------------------------------------------------------ сетка
g = [c for c in objs.values() if c.name == 'Geometry' and c.get('Vertices')][0]
CP = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64); PVI = g.get('PolygonVertexIndex').props[0].astype(np.int64)
lu = [c for c in g.children if c.name == 'LayerElementUV'][0]; UVd = lu.get('UV').props[0].reshape(-1, 2); UVi = lu.get('UVIndex').props[0].astype(np.int64)
ln = [c for c in g.children if c.name == 'LayerElementNormal'][0]; NRM = ln.get('Normals').props[0].reshape(-1, 3)
polys = []; cur = []
for k, v in enumerate(PVI):
    if v < 0: cur.append((~v, k)); polys.append(cur); cur = []
    else: cur.append((v, k))
keymap = {}; Vc = []; Uv = []; Nn = []; Tri = []
def vid(cp, pv):
    key = (cp, int(UVi[pv]))
    if key not in keymap: keymap[key] = len(Vc); Vc.append(cp); Uv.append(UVd[UVi[pv]]); Nn.append(np.zeros(3))
    k = keymap[key]; Nn[k] = Nn[k] + NRM[pv]; return k
for pl in polys:
    ids = [vid(cp, pv) for cp, pv in pl]
    for j in range(1, len(ids) - 1): Tri.append([ids[0], ids[j], ids[j + 1]])
Vc = np.array(Vc); Uv = np.array(Uv); Nn = np.array(Nn); Tri = np.array(Tri); n = len(Vc)
Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
V = CP[Vc] @ G.T; N = Nn @ G.T
print('вершин', n, 'треугольников', len(Tri), 'габариты', V.min(0).round(2), V.max(0).round(2))
# веса кожи: топ-4 на вершину
W = np.zeros((len(CP), NB))
for c, b in cluster_of.items():
    ii = objs[c].get('Indexes'); ww = objs[c].get('Weights')
    if ii is not None: W[ii.props[0].astype(np.int64), b] += ww.props[0]
W = W[Vc]; top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); s = w4.sum(1); bad = s < 1e-6
top[bad, 0] = 0; w4[bad] = [1, 0, 0, 0]; w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
dom = top[np.arange(n), np.argmax(w4, axis=1)]; print('вершин без весов', int(bad.sum()))

# ------------------------------------------------------------------ текстура: карта цвета, рот, зубы, глаза
tex = np.array(Image.open(texf).convert('RGB').resize((1024, 1024), Image.LANCZOS)).astype(np.float64) / 255
red = np.clip((tex[:, :, 0] - tex[:, :, 1]) * 8, 0, 1)
L = tex @ np.array([0.3, 0.55, 0.15]); mean = L[red < 0.2].mean()
sheet = np.clip(tex * (0.5 / mean), 0, 1); gray = np.clip(L[:, :, None] * (0.5 / mean) * np.ones(3), 0, 1)
sheet = sheet * (1 - red[:, :, None]) + gray * red[:, :, None]
Image.fromarray(np.round(sheet * 255).astype(np.uint8)).save('/tmp/shk_sheet.jpg', quality=72)
sheet_b64 = base64.b64encode(open('/tmp/shk_sheet.jpg', 'rb').read()).decode(); print('лист цвета', len(sheet_b64) // 1024, 'КБ, среднее', round(float(mean), 3))
def bil(A, u, v):
    h, w = A.shape[:2]; x = np.clip(u, 0, 1) * (w - 1); y = np.clip(1 - v, 0, 1) * (h - 1); x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1); fx = (x - x0)[:, None] if A.ndim == 3 else (x - x0); fy = (y - y0)[:, None] if A.ndim == 3 else (y - y0)
    return (A[y0, x0] * (1 - fx) + A[y0, x1] * fx) * (1 - fy) + (A[y1, x0] * (1 - fx) + A[y1, x1] * fx) * fy
mouth = bil(red, Uv[:, 0], Uv[:, 1])
teethzone = ((Uv[:, 0] < 0.17) & (Uv[:, 1] < 0.14)).astype(np.float64)
lum = bil(L, Uv[:, 0], Uv[:, 1]); teeth = teethzone * np.clip((lum - 0.55) * 6, 0, 1) * (1 - np.clip(mouth * 2, 0, 1))
print('рот', int((mouth > 0.5).sum()), 'зубы', int((teeth > 0.5).sum()))
# глаза: тёмные точки на текстуре ≈ (0.547, 0.129) и (0.721, 0.129) по uv
eyes = []
for u0 in (0.547, 0.721):
    m = (np.hypot(Uv[:, 0] - u0, Uv[:, 1] - 0.129) < 0.012)
    if m.sum() == 0: m = (np.hypot(Uv[:, 0] - u0, Uv[:, 1] - 0.129) < 0.03)
    c = V[m].mean(0); eyes.append(c); print('глаз', u0, int(m.sum()), c.round(3), 'разброс', (V[m].max(0) - V[m].min(0)).round(3))

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = 1500
clip = {'dur': round(NF / FPS, 4), 'nf': NF, 'avg': [[round(c, 5) for c in q] for q in AVG], 'loop': True, 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N, -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([Uv[:, 0], 1 - Uv[:, 1]], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(Tri.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(np.round(np.clip(mouth, 0, 1) * 255).astype(np.uint8)), 't': b64(np.round(teeth * 255).astype(np.uint8)),
     'par': par, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'names': names, 'clip': clip,
     'eyes': [[round(float(c), 4) for c in e] for e in eyes], 'tex': sheet_b64}
open(out, 'w').write('// Игрок «Мегалодон»: акула PA Shark (прислана пользователем, лицензия неизвестна) — подготовлено tools/shk_bake.py. Не редактировать.\nexport const SHK = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
if dbg: np.savez(dbg, V=V, F=Tri, N=N, UV=Uv, top=top, w4=w4, dom=dom, restP=restP, par=np.array(par), QF=QF, mouth=mouth, teeth=teeth)

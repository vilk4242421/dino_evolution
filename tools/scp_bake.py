# Питомец «Скорпион-страж»: Scorpion (Sketchfab, FBX со скелетом из 91 кости и клипами idle / walk / Defend / areaAttack / death; низкополигональный, 3,6 тыс. вершин) → game/scp.js.
# Запуск: python3 -I tools/scp_bake.py <scorpion.fbx> <папка textures> <выход scp.js> [отладка.npz]
# Делает (по образцу tools/gws_bake.py): сетка/UV/скиннинг/клипы из FBX (tools/fbx_read.py), поза привязки — из матриц кластеров (с учётом поворота узла Armature −90° по X),
# оси переводятся в игровые (x вперёд, y вверх, z вбок), скелет «осевой» (повороты покоя тождественные, клипы — вращения в этих осях), начало координат — центр тела.
# Клипы: idle (стойка), l0 (walk — игра смешивает по скорости), atk (areaAttack: удар хвостом, играет питомец при ударе по врагу). Кости IK и «_end» не нужны — в клипах уже запечена поза всех костей.
# Раскраска: оригинальная коричневая текстура перекрашена в ЧЁРНЫЙ (рельеф и светлые швы сегментов остаются), кончик жала (карта Emission) — янтарный.
import numpy as np, sys, os, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image
from scipy.ndimage import gaussian_filter

fbx, texd, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
TICK = 46186158000.0
F = load(fbx); objs = F['objs']; M = F['models']
BLACK = float(os.environ.get('SCP_DARK', '1.0'))

# ------------------------------------------------------------------ скелет: кости, у которых есть кластер скиннинга (IK-помощники и «_end» без вершин — выбрасываем)
cl = [i for i, o in objs.items() if o.name == 'Deformer' and o.props[2] == 'Cluster']
cl_bone = {}
for c in cl:
    b = [k for k in F['kids'].get(c, []) if k in M]
    if b: cl_bone[c] = b[0]
all_cl = sorted(set(cl_bone.values()))
root_id = [i for i in all_cl if M[i]['name'] == 'control'][0]
def desc(i): return [i] + [d for k in F['kids'].get(i, []) if k in M for d in desc(k)]
bone_ids = [i for i in desc(root_id) if i in all_cl]          # IK- и Pole-помощники лежат вне иерархии корпуса и вершин не двигают — выбрасываем
print('кластеров', len(all_cl), 'в иерархии корпуса', len(bone_ids))
order = []
def add(i):
    if i in order: return
    p = M[i]['parent']
    if p in bone_ids: add(p)
    order.append(i)
add(root_id)
for i in bone_ids: add(i)
assert order[0] == root_id and len(order) == len(bone_ids)
idx = {b: k for k, b in enumerate(order)}; NB = len(order); par = [idx[M[b]['parent']] if M[b]['parent'] in idx else -1 for b in order]
names = [M[b]['name'] for b in order]
assert par.count(-1) == 1, 'корней больше одного'
print('костей', NB, 'корень', names[0])
def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def euler(d): a = np.radians(d); return rz(a[2]) @ ry(a[1]) @ rx(a[0])                  # порядок XYZ (FBX): R = Rz·Ry·Rx
arm = [m for m in M.values() if m['name'] == 'Armature'][0]
A_R = euler(arm['R']) * np.array(arm['S']); A_T = np.array(arm['T'], float)
print('Armature: R', np.round(arm['R'], 3), 'S', arm['S'])
PRE = [euler(M[b]['pre']) for b in order]; T0 = [np.array(M[b]['T'], float) for b in order]; R0 = [np.array(M[b]['R'], float) for b in order]
S0 = [np.array(M[b]['S'], float) for b in order]
def fk(Tl, Rl):
    Pw = [None] * NB; Rw = [None] * NB
    for i in range(NB):
        Rloc = PRE[i] @ euler(Rl[i])
        if par[i] < 0: Pw[i] = A_R @ Tl[i] + A_T; Rw[i] = A_R @ Rloc
        else: Pw[i] = Pw[par[i]] + Rw[par[i]] @ Tl[i]; Rw[i] = Rw[par[i]] @ Rloc
    return np.array(Pw), Rw
# поза покоя — из матриц привязки кластеров
P0 = np.zeros((NB, 3)); Rw0 = [None] * NB
for c, b in [(c, b) for c, b in cl_bone.items() if b in idx]:
    Mx = objs[c].get('TransformLink').props[0].reshape(4, 4).T; Rm = Mx[:3, :3] / np.maximum(np.linalg.norm(Mx[:3, :3], axis=0, keepdims=True), 1e-9)
    P0[idx[b]] = Mx[:3, 3]; Rw0[idx[b]] = Rm
assert all(r is not None for r in Rw0)
Pc, Rc = fk(T0, R0)
print('FK по Lcl узлов и привязка: позиции расходятся на', round(float(np.abs(Pc - P0).max()), 4), ', повороты на', round(float(max(np.abs(Rc[i] - Rw0[i]).max() for i in range(NB))), 4))
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)                    # (x,y,z)_мир → (z, y, −x) игры: нос +z → +x
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q

# ------------------------------------------------------------------ сетка в позе привязки
g = [c for c in objs.values() if c.name == 'Geometry' and c.get('Vertices')][0]
CP = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64); PVI = g.get('PolygonVertexIndex').props[0].astype(np.int64)
lus = [c for c in g.children if c.name == 'LayerElementUV']
print('слоёв UV', len(lus), [len(c.get('UV').props[0]) // 2 for c in lus])
lu = lus[0]; UVd = lu.get('UV').props[0].reshape(-1, 2); UVi = lu.get('UVIndex').props[0].astype(np.int64)
ln = [c for c in g.children if c.name == 'LayerElementNormal'][0]; NRM = ln.get('Normals').props[0].reshape(-1, 3)
print('нормали: привязка', ln.get('MappingInformationType').props[0], 'UV:', lu.get('MappingInformationType').props[0], lu.get('ReferenceInformationType').props[0])
cl_bone = {c: b for c, b in cl_bone.items() if b in idx}
c0 = list(cl_bone.keys())[0]
Mm = objs[c0].get('TransformLink').props[0].reshape(4, 4).T @ objs[c0].get('Transform').props[0].reshape(4, 4).T
for c in cl_bone: assert np.abs(objs[c].get('TransformLink').props[0].reshape(4, 4).T @ objs[c].get('Transform').props[0].reshape(4, 4).T - Mm).max() < 2e-3, 'матрицы сетки у кластеров различаются'
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
Wd = lambda P: (Mm[:3, :3] @ P.T).T + Mm[:3, 3]
Vw = Wd(CP[Vc]); Nw = (Mm[:3, :3] @ Nn.T).T
V0 = Vw @ G.T; N = Nw @ G.T
cen = np.array([(V0[:, 0].max() + V0[:, 0].min()) / 2, (V0[:, 1].max() + V0[:, 1].min()) / 2, 0.0])
V = V0 - cen; restP = P0 @ G.T - cen
length = float(V0[:, 0].max() - V0[:, 0].min())
print('вершин', n, 'треугольников', len(Tri), 'габариты', V.min(0).round(3), V.max(0).round(3), 'длина', round(length, 3), 'центр', cen.round(3))
assert n < 65535
# веса
W = np.zeros((len(CP), NB))
for c, b in cl_bone.items():
    if b not in idx:
        ww_ = objs[c].get('Weights'); assert ww_ is None or len(ww_.props[0]) == 0 or np.abs(ww_.props[0]).max() < 1e-6 or True; continue
    ii = objs[c].get('Indexes'); ww = objs[c].get('Weights')
    if ii is not None: W[ii.props[0].astype(np.int64), idx[b]] += ww.props[0]
W = W[Vc]; top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); s_ = w4.sum(1); bad = s_ < 1e-6
top[bad, 0] = 0; w4[bad] = [1, 0, 0, 0]; w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
print('вершин без весов', int(bad.sum()))

# ------------------------------------------------------------------ клипы
stack_name = {}
for st, o in objs.items():
    if o.name == 'AnimationStack':
        for l in F['kids'].get(st, []):
            if objs[l].name == 'AnimationLayer': stack_name[l] = o.props[1].split('\x00')[0].split('|')[-1]
cn_layer = {}
for cn, o in objs.items():
    if o.name == 'AnimationCurveNode':
        for l in F['parent'].get(cn, []):
            if l in stack_name: cn_layer[cn] = stack_name[l]
cn_t = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurveNode' and b in idx: cn_t[a] = (idx[b], p)
CUR = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurve' and b in cn_t:
        c = objs[a]; CUR.setdefault(cn_layer[b], {})[(cn_t[b][0], cn_t[b][1], p)] = (c.get('KeyTime').props[0] / TICK, c.get('KeyValueFloat').props[0].astype(np.float64))
print('клипы в файле:', {k: round(max(v[0][-1] for v in d.values()), 3) for k, d in CUR.items()})
FPS = 30
def bake(layer, loop):
    cur = CUR[layer]; t1 = max(v[0][-1] for v in cur.values()); t0 = 0.0
    NF = int(round(t1 * FPS)) + 1
    def samp(key, t, default):
        if key not in cur: return default
        ts, vs = cur[key]; return float(np.interp(t, ts, vs))
    QF = np.zeros((NF, NB, 4)); ROOT = np.zeros((NF, 3)); devT = 0.0
    for f in range(NF):
        t = f / FPS; Tl = []; Rl = []
        for i in range(NB):
            Tl.append(np.array([samp((i, 'Lcl Translation', 'd|' + ax), t, T0[i][k]) for k, ax in enumerate('XYZ')]))
            Rl.append(np.array([samp((i, 'Lcl Rotation', 'd|' + ax), t, R0[i][k]) for k, ax in enumerate('XYZ')]))
            if i > 0: devT = max(devT, float(np.abs(Tl[i] - T0[i]).max()))
        Pa, Rwa = fk(Tl, Rl)
        Delta = [G @ (Rwa[i] @ Rw0[i].T) @ G.T for i in range(NB)]
        for i in range(NB):
            q = qmat_to_q(Delta[i] if par[i] < 0 else Delta[par[i]].T @ Delta[i])
            if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            QF[f, i] = q
        ROOT[f] = G @ Pa[0] - cen
    if loop:       # замкнут ли цикл: последний кадр ≈ первому
        gap = float(np.abs(QF[-1] - QF[0]).max()); gp = float(np.abs(ROOT[-1] - ROOT[0]).max()); print('  ', layer, 'замыкание: поворот', round(gap, 4), 'позиция', round(gp, 4))
        if gap < 0.02: NF -= 1; QF = QF[:NF]; ROOT = ROOT[:NF]
    print('  ', layer, 'длит %.2f c, кадров %d, сдвиг не-корневых костей до %.4f' % (NF / FPS, NF, devT))
    return NF, QF, ROOT
clips = {}; info = {}
for key, layer, loop in (('idle', 'idle', True), ('l0', 'walk', True), ('atk', 'areaAttack', False)):
    NF, QF, ROOT = bake(layer, loop); info[key] = (NF, QF, ROOT)
    clips[key] = {'dur': round(NF / FPS, 4) if loop else round((NF - 1) / FPS, 4), 'nf': NF, 'loop': loop, 'v': 0.0, 'q': base64.b64encode(np.round(QF * 32767).astype(np.int16).tobytes()).decode(),
                  'tb': {'0': [[round(float(c), 5) for c in r] for r in ROOT]}}
# скорость шага walk: скорость, с которой стопы уходят назад относительно корпуса в фазе опоры (самая низкая треть положения стопы)
_, QW, RW = info['l0']; NFw = len(QW)
tipn = [k for k, nm in enumerate(names) if nm in ('L_A5', 'L_B6', 'L_C6', 'L_D6', 'R_A5', 'R_B6', 'R_C6', 'R_D6')]
for key in ('idle', 'l0', 'atk'):
    QF_ = info[key][1]; ang = np.degrees(2 * np.arccos(np.clip(np.abs(QF_[:, :, 3]), 0, 1)))
    print('  углы %s: кадр 0 макс %.1f°, по клипу макс %.1f°, кость %s' % (key, ang[0].max(), ang.max(), names[int(np.argmax(ang.max(0)))]))
print('кончики ног', [names[k] for k in tipn])
# FK игры: позиции костей в позе кадра (в игровых осях, до перевода)
def fk_game(Q, root):
    Pw = [None] * NB; Rq = [None] * NB
    for i in range(NB):
        q = Q[i]; R = np.array([[1 - 2 * (q[1] ** 2 + q[2] ** 2), 2 * (q[0] * q[1] - q[2] * q[3]), 2 * (q[0] * q[2] + q[1] * q[3])], [2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[0] ** 2 + q[2] ** 2), 2 * (q[1] * q[2] - q[0] * q[3])], [2 * (q[0] * q[2] - q[1] * q[3]), 2 * (q[1] * q[2] + q[0] * q[3]), 1 - 2 * (q[0] ** 2 + q[1] ** 2)]])
        if par[i] < 0: Pw[i] = root; Rq[i] = R
        else: Pw[i] = Pw[par[i]] + Rq[par[i]] @ (restP[i] - restP[par[i]]); Rq[i] = Rq[par[i]] @ R
    return np.array(Pw)
FP = np.array([fk_game(QW[f], RW[f]) for f in range(NFw)])          # (кадры, кости, 3)
speeds = []
print('ход стоп по x за цикл:', np.round([np.ptp(FP[:, k, 0]) for k in tipn], 3).tolist(), 'по y:', np.round([np.ptp(FP[:, k, 1]) for k in tipn], 3).tolist())
for k in tipn:
    y = FP[:, k, 1]; stance = y < (y.min() + 0.35 * (y.max() - y.min()) + 1e-9)
    dx = np.diff(FP[:, k, 0]) * FPS                                   # скорость стопы по x (вперёд +) в мировых осях корпуса-модели
    dx = np.append(dx, dx[0]); sp = -dx[stance]; sp = sp[sp > 0]
    if len(sp): speeds.append(float(np.median(sp)))
print('скорость опоры по ногам (ед. модели/с):', np.round(speeds, 2).tolist())
WV = float(np.median(speeds)) if speeds else 3.0
clips['l0']['v'] = round(WV, 3); print('walk v =', clips['l0']['v'])
print('низ стоп (ед. модели) в покое:', np.round(FP[0, tipn, 1].min(), 3), 'самый низ меша', round(float(V[:, 1].min()), 3))

# ------------------------------------------------------------------ текстура: чёрная перекраска; кончик жала — янтарный (по карте Emission)
TW = 1024
alb = np.array(Image.open(os.path.join(texd, 'scorpion_low_scorpion_AlbedoTransparency.png')).convert('RGB').resize((TW, TW), Image.LANCZOS)).astype(np.float64) / 255
emi = np.array(Image.open(os.path.join(texd, 'scorpion_low_scorpion_Emission.png')).convert('RGB').resize((TW, TW), Image.LANCZOS)).astype(np.float64) / 255
em = np.clip(emi.max(2) * 3.0, 0, 1); em = gaussian_filter(em, 1.2)
Lm = alb @ np.array([0.3, 0.55, 0.15]); meanL = float(Lm.mean())
rel = Lm / meanL                                             # 1 = средняя яркость панциря, швы сегментов — заметно светлее
base = 0.040 + 0.085 * np.clip(rel, 0, 3.2) ** 1.15 * BLACK     # sRGB: почти чёрный, рельеф сохранён
tint = np.array([1.0, 0.96, 0.93])
blk = np.clip(base[:, :, None] * tint, 0, 1)
amb = np.clip((0.55 + 0.45 * Lm / max(Lm[em > 0.5].mean(), 1e-6))[:, :, None] * np.array([1.0, 0.56, 0.06]), 0, 1) if (em > 0.5).any() else blk
col_srgb = blk * (1 - em[:, :, None]) + amb * em[:, :, None]
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
sheet = lin(col_srgb)
Image.fromarray(np.round(np.clip(sheet, 0, 1) * 255).astype(np.uint8)).save('/tmp/scp_sheet.jpg', quality=int(os.environ.get('SCP_Q', '80')), subsampling=0)
sheet_b64 = base64.b64encode(open('/tmp/scp_sheet.jpg', 'rb').read()).decode(); print('лист', len(sheet_b64) // 1024, 'КБ, янтарь', int((em > 0.5).sum()), 'пикс.')
UVout = np.stack([np.clip(Uv[:, 0], 0, 1), np.clip(1 - Uv[:, 1], 0, 1)], 1)             # v вниз, как у остальных моделей игры

# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max()))
bn = {nm: k for k, nm in enumerate(names)}
# «глаза» — только опорные точки для якоря головы (корона у питомца не нужна): у переднего края корпуса
fr = V[:, 0].max(); eyes = [[float(fr * 0.9), float(V[V[:, 0] > fr * 0.8][:, 1].max() * 0.7), 0.12], [float(fr * 0.9), float(V[V[:, 0] > fr * 0.8][:, 1].max() * 0.7), -0.12]]
R = {'s': SC, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UVout * 65535).astype(np.uint16)), 'f': b64(Tri.astype(np.uint16)), 'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)),
     'm': b64(np.zeros(n, np.uint8)), 'e': b64(np.zeros(n, np.uint8)), 'k': b64(np.zeros(n, np.uint8)),
     'par': par, 'pos': [[round(float(c), 6) for c in p] for p in restP], 'clips': clips, 'tips': tipn, 'neck': [], 'head': bn['body'], 'jaw': bn['pincer_L'], 'raw': 1, 'nativeEyes': True, 'noLids': True,
     'eyes': [[round(c, 5) for c in e] for e in eyes], 'eyeR': [0.05, 0.05], 'height': round(length, 4), 'tex': sheet_b64, 'still': [], 'tail': [bn[x] for x in ('tailBase', 'tailSeg1', 'tailSeg2', 'tailSeg3', 'tailSeg4', 'tailSeg5', 'Stringer')]}
open(out, 'w').write('// Скорпион (Sketchfab, прислан пользователем, лицензия не указана) — подготовлено tools/scp_bake.py из FBX; перекрашен в чёрный. Не редактировать.\nexport const SCP = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ, масштаб квантования', SC)
if dbg: np.savez(dbg, V=V, F=Tri, N=N, UV=Uv, top=top, w4=w4, restP=restP, par=np.array(par), names=np.array(names), FP=FP)

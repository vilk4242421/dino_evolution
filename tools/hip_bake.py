# Враг «Болотный бегемот» → модель Hippopotamus (присланный FBX: скелет из 31 кости, 9 клипов, текстура 512²; лицензия не указана) → game/hip.js.
# Запуск: python3 -I tools/hip_bake.py <Hippopotamus.fbx> <Hippopotamus.png> <выход hip.js>
# Основа — tools/rhi_bake.py. Отличия: модель в файле стоит в сцене со сдвигом и поворотом (узел Player) — после перевода в оси игры всё центрируется по корню,
# подошвы на y=0. Клипы: idle (Idle), l0 (Walk), l1 (Run), l2 (Run Fast), atk (Attack Jaw — укус пастью). Клипа получения урона нет — hurt синтезируется
# из позы покоя (голова вверх-назад, корпус вздрагивает).
import numpy as np, sys, os, json, base64, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image

fbx, texf, out = sys.argv[1:4]
TICK = 46186158000.0; FPS = 30
F = load(fbx); objs = F['objs']; M = F['models']
CLIPS = [('idle', 'Idle', True), ('l0', 'Walk', True), ('l1', 'Run', True), ('l2', 'Run Fast', True), ('atk', 'Attack Jaw', False)]
bone_ids = [i for i, m in M.items() if m['type'] == 'LimbNode']
order = []
def add(i):
    if i in order: return
    p = M[i]['parent']
    if p in bone_ids: add(p)
    order.append(i)
for i in sorted(bone_ids, key=lambda b: (M[b]['name'] != 'Hippopotamus')): add(i)
idx = {b: k for k, b in enumerate(order)}; NB = len(order); par = [idx[M[b]['parent']] if M[b]['parent'] in idx else -1 for b in order]
names = [M[b]['name'] for b in order]; NI = {n_: i for i, n_ in enumerate(names)}
par_out = [0 if (par[i] < 0 and i != 0) else par[i] for i in range(NB)]           # голова — второй корень под узлом скелета (в той же точке, что Body1): в игре подвешиваем к корню
def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def euler(d): a = np.radians(d); return rz(a[2]) @ ry(a[1]) @ rx(a[0])
PRE = [euler(M[b]['pre']) for b in order]; T0 = [np.array(M[b]['T'], float) for b in order]; R0 = [np.array(M[b]['R'], float) for b in order]
def world(k):                                                                    # мировая матрица узла (цепочка родителей; T, PreRotation, R, S)
    W = np.eye(4)
    while k:
        m = M[k]; L = np.eye(4); L[:3, :3] = euler(m['pre']) @ euler(m['R']) * np.array(m['S']); L[:3, 3] = m['T']; W = L @ W; k = m['parent']
    return W
ARMW = world(M[order[0]]['parent']); ARM_T = ARMW[:3, 3]; ARM_S = float(np.linalg.norm(ARMW[:3, 0])); ARM_R = ARMW[:3, :3] / ARM_S
def fk(Tl, Rl):
    Pw = [None] * NB; Rw = [None] * NB
    for i in range(NB):
        Rloc = PRE[i] @ euler(Rl[i])
        if par[i] < 0: Pw[i] = ARM_T + ARM_R @ (ARM_S * Tl[i]); Rw[i] = ARM_R @ Rloc
        else: Pw[i] = Pw[par[i]] + Rw[par[i]] @ (ARM_S * Tl[i]); Rw[i] = Rw[par[i]] @ Rloc
    return np.array(Pw), Rw
# поза покоя — из матриц привязки кластеров (кластеры двух скинов: тело и зубы)
cl = [i for i, o in objs.items() if o.name == 'Deformer' and o.props[2] == 'Cluster']
P0 = np.zeros((NB, 3)); Rw0 = [None] * NB; cl_bone = {}
for c in cl:
    b = [k for k in F['kids'].get(c, []) if k in idx]
    if not b: continue
    Mx = objs[c].get('TransformLink').props[0].reshape(4, 4).T; Rm = Mx[:3, :3] / np.maximum(np.linalg.norm(Mx[:3, :3], axis=0, keepdims=True), 1e-9)
    P0[idx[b[0]]] = Mx[:3, 3]; Rw0[idx[b[0]]] = Rm; cl_bone[c] = idx[b[0]]
Pc, Rc = fk(T0, R0)
for i in range(NB):
    if Rw0[i] is None:
        p = par[i]; Rw0[i] = Rw0[p] @ (Rc[p].T @ Rc[i]); P0[i] = P0[p] + Rw0[p] @ (Rc[p].T @ (Pc[i] - Pc[p]))
# оси: вперёд — от хвоста к челюсти (в горизонтали), вверх — y файла (после поворота узла −90° по X)
fw = P0[NI['Hipo_Head_TopSHJnt']] - P0[NI['Hipo_Tail_01_01SHJnt']]; fw[1] = 0; fw /= np.linalg.norm(fw); up = np.array([0, 1.0, 0]); G = np.array([fw, up, np.cross(fw, up)])
print('вперёд в осях файла', fw.round(3))
restP = P0 @ G.T; height_ = float(restP[:, 1].max() - restP[:, 1].min()); FKS = []
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q
# ------------------------------------------------------------------ клипы по слоям
cn_all = {}
for a, b, p in F['prop_link']:
    if a in objs and objs[a].name == 'AnimationCurveNode' and b in idx: cn_all[a] = (idx[b], p)
layers = {o.props[1].split('\x00')[0]: i for i, o in objs.items() if o.name == 'AnimationLayer'}
def bake_clip(lname, loop):
    st_ = [i for i, o in objs.items() if o.name == 'AnimationStack' and o.props[1].split('\x00')[0] == lname][0]
    lay = [i for i, o in objs.items() if o.name == 'AnimationLayer' and st_ in F['parent'].get(i, [])][0]
    cn = {k: v for k, v in cn_all.items() if lay in F['parent'].get(k, [])}
    curves = {}
    for a, b, p in F['prop_link']:
        if a in objs and objs[a].name == 'AnimationCurve' and b in cn:
            c = objs[a]; curves[(cn[b][0], cn[b][1], p)] = (c.get('KeyTime').props[0] / TICK, c.get('KeyValueFloat').props[0].astype(np.float64))
    t0 = min(v[0][0] for v in curves.values()); t1 = max(v[0][-1] for v in curves.values()); NF = int(round((t1 - t0) * FPS)) + 1
    def samp(key, t, d):
        if key not in curves: return d
        ts, vs = curves[key]; return float(np.interp(t, ts, vs))
    QF = np.zeros((NF, NB, 4)); TB = []; LOC = []; FKP = []
    for f in range(NF):
        t = t0 + f / FPS; Tl = []; Rl = []
        for i in range(NB):
            Tl.append(np.array([samp((i, 'Lcl Translation', 'd|' + ax), t, T0[i][k]) for k, ax in enumerate('XYZ')]))
            Rl.append(np.array([samp((i, 'Lcl Rotation', 'd|' + ax), t, R0[i][k]) for k, ax in enumerate('XYZ')]))
        Pa, Rwa = fk(Tl, Rl); TB.append(G @ Pa[0]); DR = G @ (Rwa[0] @ Rw0[0].T) @ G.T
        LOC.append([DR.T @ (G @ (Pa[i] - Pa[par_out[i]])) if par_out[i] == 0 else None for i in range(NB)]); FKP.append(Pa @ G.T)
        Delta = [G @ (Rwa[i] @ Rw0[i].T) @ G.T for i in range(NB)]
        for i in range(NB):
            q = qmat_to_q(Delta[i] if par_out[i] < 0 else Delta[par_out[i]].T @ Delta[i])
            if f > 0 and np.dot(q, QF[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            QF[f, i] = q
    if loop:                                                                    # последний кадр = первому? тогда дубль убираем; иначе петля уже без дубля
        close = float(np.abs(np.abs((QF[0] * QF[-1]).sum(1)) - 1).max()); step = float(np.median([np.abs(np.abs((QF[f] * QF[f + 1]).sum(1)) - 1).max() for f in range(NF - 1)]))
        print(' ', lname, 'петля: край', round(close, 5), 'шаг кадра', round(step, 5))
        if close < 0.3 * step + 1e-5: LOC = LOC[:-1]; FKP = FKP[:-1]; NF -= 1; QF = QF[:NF]; TB = TB[:NF]
        elif close > 1.5 * step:                                                 # в файле петля не замкнута: расхождение на стыке равномерно распределяем по циклу
            from scipy.spatial.transform import Rotation as _R
            for b in range(NB):
                Rl = _R.from_quat(QF[-1, b]); Rp = _R.from_quat(QF[-2, b]); exp_ = Rl * (Rp.inv() * Rl); gap = (_R.from_quat(QF[0, b]) * exp_.inv()).as_rotvec()
                for f in range(NF): QF[f, b] = (_R.from_rotvec(gap * (f + 1) / NF) * _R.from_quat(QF[f, b])).as_quat()
                for f in range(1, NF):
                    if np.dot(QF[f, b], QF[f - 1, b]) < 0: QF[f, b] *= -1
            TBa = np.array(TB); gp = TBa[0] - (2 * TBa[-1] - TBa[-2]); TB = [TBa[f] + gp * (f + 1) / NF for f in range(NF)]
            print('   шов петли сглажен')
    TB = np.array(TB); tbd = {'0': [[round(float(c), 4) for c in r] for r in TB]} if TB.std(0).max() > 2e-3 else {}
    for i in range(1, NB):                                                      # сдвиги костей плоского скелета (в осях корня), если отличаются от покоя
        if par_out[i] != 0: continue
        L_ = np.array([l[i] for l in LOC]); rest_ = restP[i] - restP[0]
        if np.abs(L_ - rest_).max() > 0.004 * height_: tbd[str(i)] = [[round(float(c), 4) for c in r] for r in L_]
    FKS.append(np.array(FKP))
    print(' ', lname, '%.2f с, кадров %d, корень движется: %s' % (NF / FPS, NF, bool(tbd)))
    return QF, tbd, NF
# ------------------------------------------------------------------ сетка: тело + зубы (у каждого свой скин)
meshes = [i for i, m in M.items() if m['type'] == 'Mesh']
geo_of = {}
for a, b, p in F['prop_link'] if False else []: pass
gids = [i for i, o in objs.items() if o.name == 'Geometry']
def geom_for(mid): return [g for g in gids if mid in F['parent'].get(g, [])][0]
skin_of = {}
for i, o in objs.items():
    if o.name == 'Deformer' and o.props[2] == 'Skin':
        for g in F['parent'].get(i, []):
            if g in gids: skin_of[g] = i
Vall = []; Nall = []; UVall = []; Tall = []; Wall = []; TEETH = []; off = 0
for mid in meshes:
    gi = geom_for(mid); g = objs[gi]; teeth = 'Teeth' in M[mid]['name']
    CP = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64); PVI = g.get('PolygonVertexIndex').props[0].astype(np.int64)
    lu = [c for c in g.children if c.name == 'LayerElementUV'][0]; UVd = lu.get('UV').props[0].reshape(-1, 2); UVmap = lu.get('MappingInformationType').props[0]
    UVi = lu.get('UVIndex').props[0].astype(np.int64) if lu.get('UVIndex') else (np.arange(len(PVI)) if 'Polygon' in UVmap else np.where(PVI < 0, ~PVI, PVI))      # Direct: по углу полигона или по вершине
    ln = [c for c in g.children if c.name == 'LayerElementNormal'][0]; NRM = ln.get('Normals').props[0].reshape(-1, 3)
    if 'Polygon' not in ln.get('MappingInformationType').props[0]: NRM = NRM[np.where(PVI < 0, ~PVI, PVI)]
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
    Vc = np.array(Vc); Uv = np.array(Uv); Nn = np.array(Nn); Tri = np.array(Tri); Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
    MW = world(mid); Ms = MW[:3, :3]; Mr = Ms / np.linalg.norm(Ms[:, 0])
    Vw = CP[Vc] @ Ms.T + MW[:3, 3]; Nw = Nn @ Mr.T
    W = np.zeros((len(CP), NB)); sk = skin_of[gi]
    for c in cl:
        if sk in F['parent'].get(c, []) and c in cl_bone:
            ii = objs[c].get('Indexes'); ww = objs[c].get('Weights')
            if ii is not None: W[ii.props[0].astype(np.int64), cl_bone[c]] += ww.props[0]
    Vall.append(Vw @ G.T); Nall.append(Nw @ G.T); UVall.append(Uv); Tall.append(Tri + off); Wall.append(W[Vc]); TEETH.append(np.full(len(Vc), teeth)); off += len(Vc)
    print(M[mid]['name'], 'вершин', len(Vc), 'треугольников', len(Tri), 'без весов', int((W[Vc].sum(1) < 1e-6).sum()))
V = np.vstack(Vall); N = np.vstack(Nall); Uv = np.vstack(UVall); Tri = np.vstack(Tall); W = np.vstack(Wall); TE = np.concatenate(TEETH); n = len(V)
OFF = np.array([restP[0][0], V[:, 1].min(), restP[0][2]]); V = V - OFF; restP = restP - OFF; print('центрирование: сдвиг', OFF.round(3))     # модель стоит в сцене со сдвигом
top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); bad = w4.sum(1) < 1e-6; top[bad, 0] = NI['Hipo_Head_TopSHJnt']; w4[bad] = [1, 0, 0, 0]; w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
print('итого вершин', n, 'треугольников', len(Tri), 'габариты', V.min(0).round(2), V.max(0).round(2), 'кости', restP.min(0).round(2), restP.max(0).round(2))
# ------------------------------------------------------------------ клипы
clips = {}; L = float(V[:, 0].max() - V[:, 0].min()); TIPS = [NI[k] for k in ('Hipo_l_FrontLeg_BallSHJnt', 'Hipo_r_FrontLeg_BallSHJnt', 'Hipo_l_HindLeg_AnkleSHJnt', 'Hipo_r_HindLeg_AnkleSHJnt')]
def qd(QF_, tb, nf, loop, v): return {'dur': round(nf / FPS, 4), 'nf': nf, 'loop': loop, 'v': round(v, 4), 'q': base64.b64encode(np.round(QF_ * 32767).astype(np.int16).tobytes()).decode(), 'tb': tb}
for key, lname, loop in CLIPS:
    QF, tb, nf = bake_clip(lname, loop)
    v = 0.0
    if key in ('l0', 'l1', 'l2'):                                                       # скорость = средняя скорость опорной стопы назад (ноги не скользят)
        FKc = FKS[-1]; vs = []
        for tp in TIPS:
            y = FKc[:, tp, 1]; x = FKc[:, tp, 0]; rng = y.max() - y.min(); dx = (np.roll(x, -1) - x) * FPS
            sel = (y < y.min() + 0.3 * rng) & (dx < 0)
            if sel.sum() > 1: vs.append(-dx[sel].mean())
        v = float(np.mean(vs)) if vs else 0.0
    if '0' in tb and key in ('l0', 'l1', 'l2', 'idle', 'atk', 'hurt'):                  # корень на месте по горизонтали (двигает игра), вертикаль оставляем
        r0 = np.array(tb['0']); r0[:, 0] = r0[:, 0].mean(); r0[:, 2] = r0[:, 2].mean(); tb['0'] = r0.round(4).tolist()
    print('   ', key, 'скорость', round(v, 3), 'костей со сдвигом', len(tb))
    if '0' in tb: tb['0'] = (np.array(tb['0']) - OFF).round(4).tolist()
    clips[key] = qd(QF, tb, nf, loop, v)

# ---- hurt: синтез поверх первого кадра покоя (оси игры: z — поперёк, поворот вокруг z кивает голову вверх/вниз)
def _aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def _qm(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
QI = np.frombuffer(base64.b64decode(clips['idle']['q']), np.int16).reshape(clips['idle']['nf'], NB, 4) / 32767.0
nH = 17; QH = np.repeat(QI[:1], nH, 0).copy()
for f in range(nH):
    u = f / (nH - 1); e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5
    for nm_, ax_, a_ in (('Hipo_Neck_01SHJnt', [0, 0, 1], 0.18), ('Hipo_Head_TopSHJnt', [0, 0, 1], 0.12), ('Hipo_Spine_04SHJnt', [1, 0, 0], 0.06), ('Hipo_Spine_01SHJnt', [1, 0, 0], -0.05)):
        b_ = NI[nm_]; QH[f, b_] = _qm(QH[f, b_], _aa(ax_, a_ * e))
clips['hurt'] = qd(QH, {}, nH, False, 0.0); print('   hurt синтез', nH, 'кадров')
# ------------------------------------------------------------------ текстура (как у спинозавра: линейная ×EXP, материал игры без sRGB-декодирования)
tex = np.array(Image.open(texf).convert('RGB').resize((512, 512), Image.LANCZOS)).astype(np.float64) / 255
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
EXP = float(os.environ.get('HIP_EXP', '1.0')); bf = io.BytesIO()
Image.fromarray(np.round(np.clip(lin(tex) * EXP, 0, 1) * 255).astype(np.uint8)).save(bf, 'JPEG', quality=84); sheet = base64.b64encode(bf.getvalue()).decode(); print('текстура', len(sheet) // 1024, 'КБ')
# зубы: отдельный материал без своей текстуры — красим вершинным цветом (слоновая кость)

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
height = float(V[:, 1].max() - V[:, 1].min())
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N, -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(np.stack([Uv[:, 0], 1 - Uv[:, 1]], 1).clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(Tri.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros), 
     'par': par_out, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'clips': clips, 'tips': TIPS, 'neck': [NI['Hipo_Neck_01SHJnt'], NI['Hipo_Neck_02SHJnt']], 'head': NI['Hipo_Head_TopSHJnt'], 'jaw': NI['Hipo_Head_JawSHJnt'], 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(height, 4), 'tex': sheet, 'nativeEyes': 1}
open(out, 'w').write('// Бегемот (Hippopotamus, FBX со скелетом и клипами; прислан пользователем, лицензия не указана) — враг «Болотный бегемот»; подготовлено tools/hip_bake.py. Не редактировать.\nexport const HIP = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ', 'вершин', n, 'кости', NB)

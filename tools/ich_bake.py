# Ихтиозавр: Ichthyosaurus (Sketchfab, FBX без скелета и анимации: тело+голова, глаза и зубы отдельными сетками; текстуры 8192²) → game/ich.js.
# Запуск: python3 -I tools/ich_bake.py <base.fbx> <папка textures> <выход ich.js> [отладка.npz]
# Что делает: читает сетки (тело/голова — «RenMeshLowWrap1», зубы — «polySurface1», родные глаза выбрасываются: ставятся свои), строит скелет сам (позвоночник
# вдоль оси z, хвост с вертикальным плавником, 4 ласта, голова и нижняя челюсть), раздаёт веса по положению вершины, делит рот по линии смыкания губ,
# синтезирует клипы (стойка — плавное покачивание, плавание — бегущая волна по телу), собирает атлас из текстур тела и головы (уменьшенных до 1024²) и пятна цвета зубов.
import numpy as np, sys, os, json, base64, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
Image.MAX_IMAGE_PIXELS = None
fbxf, texd, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((np.asarray(x, float) - a) / (b - a), 0, 1))
F = load(fbxf); objs = F['objs']
def geom(name):
    i = [k for k, m in F['models'].items() if m['name'] == name][0]
    return objs[[k for k in F['kids'][i] if objs[k].name == 'Geometry'][0]]
def corners(g, layer_by_mat=None):
    V = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64); PV = g.get('PolygonVertexIndex').props[0].astype(np.int64)
    polys = []; cur = []
    for k, v in enumerate(PV):
        if v < 0: cur.append((~v, k)); polys.append(cur); cur = []
        else: cur.append((v, k))
    lus = [c for c in g.children if c.name == 'LayerElementUV']
    UVL = [(c.get('UV').props[0].reshape(-1, 2).astype(np.float64), c.get('UVIndex').props[0].astype(np.int64)) for c in lus]
    mt = [c for c in g.children if c.name == 'LayerElementMaterial']
    mats = mt[0].get('Materials').props[0].astype(np.int64) if mt and mt[0].get('Materials') is not None and len(mt[0].get('Materials').props[0]) == len(polys) else np.zeros(len(polys), np.int64)
    tri = []; tuv = []; tmat = []
    for pi, pl in enumerate(polys):
        UVd, UVi = UVL[(layer_by_mat or {}).get(int(mats[pi]), 0)]            # какая раскладка UV у какого материала: тело — map1, голова — HeadSet (проверено по зеркальной симметрии цвета)
        for j in range(1, len(pl) - 1):
            c3 = (pl[0], pl[j], pl[j + 1]); tri.append([c[0] for c in c3]); tuv.append([UVd[UVi[c[1]]] for c in c3]); tmat.append(mats[pi])
    return V, np.array(tri), np.array(tuv), None, np.array(tmat)
Vb, Tb, Ub, UVb, Mb = corners(geom('RenMeshLowWrap1'), {0: 0, 1: 1})      # тело+голова (материал 0 — тело, 1 — голова)
Vt, Tt, Ut, UVt, Mt = corners(geom('polySurface1'))         # зубы
Ve, Te, Ue, UVe, Me = corners(geom('eye'))                  # родные глаза: только для положения и размера
print('тело/голова: вершин', len(Vb), 'треугольников', len(Tb), '| зубы', len(Vt), len(Tt), '| глаза', len(Ve))
# ------------------------------------------------------------------ глаза: центры и радиус
ec = [Ve[Ve[:, 0] * s > 0].mean(0) for s in (1, -1)]; ER_ = float(np.mean([np.linalg.norm(Ve[Ve[:, 0] * s > 0] - c, axis=1).mean() for s, c in zip((1, -1), ec)]))
print('глаза (файл)', np.round(ec, 2).tolist(), 'радиус', round(ER_, 2))
# ------------------------------------------------------------------ оси: файл (x вбок, y вверх, z вперёд) → игра (x вперёд, y вверх, z вбок)
G = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)
# ------------------------------------------------------------------ линия смыкания губ: середина самого большого просвета по высоте в каждом поперечном срезе рта
def mouth_line():
    zs = []; ys = []
    for z in np.arange(60, 98.1, 2.0):
        m = np.abs(Vb[:, 2] - z) < 0.7; y = np.sort(Vb[m, 1]); g_ = np.diff(y); ok = (y[:-1] > 10.5) & (y[:-1] < 15.5)
        if ok.sum() == 0: continue
        k = np.argmax(np.where(ok, g_, 0)); zs.append(z); ys.append((y[k] + y[k + 1]) / 2)
    zs = np.array(zs); ys = np.array(ys); ys = np.convolve(np.pad(ys, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    return zs, ys
MZ, MY = mouth_line(); print('рот: z', MZ.round(0).tolist(), 'y', MY.round(2).tolist()); ok_ = MZ >= 74; MZ, MY = MZ[ok_], MY[ok_]; MZ = np.r_[40.0, MZ]; MY = np.r_[MY[0], MY]      # у шарнира срез неоднозначен (щель смыкается): назад от z=74 линия идёт постоянной высотой
print('линия рта: z', MZ[[0, len(MZ) // 2, -1]], 'y', MY[[0, len(MY) // 2, -1]].round(2))
mline = lambda z: np.interp(z, MZ, MY)
HZ = 55.0                                                    # шарнир челюсти (z), чуть позади угла рта
# ------------------------------------------------------------------ скелет (файловые координаты: x=вбок, y, z=вперёд)
B = []   # (name, parent, (xf, yf, zf))
def bone(n, p, x, y, z): B.append((n, p, (x, y, z))); return len(B) - 1
b_root = bone('root', -1, 0, 17.3, 0)
b_sp = bone('spine', b_root, 0, 17.1, 24)
b_nk = bone('neck', b_sp, 0, 17.2, 42)
b_hd = bone('head', b_nk, 0, 17.0, 55)
b_jw = bone('jaw', b_hd, 0, 14.0, HZ)
TAILZ = [(-25, 16.9), (-50, 17.8), (-75, 18.2), (-100, 18.4), (-118, 18.5), (-133, 11.0), (-146, 0.0)]
b_t = []; pb = b_root
for k, (z, y) in enumerate(TAILZ): pb = bone('tail%d' % k, pb, 0, y, z); b_t.append(pb)
b_te = bone('tailend', b_t[-1], 0, -5.0, -150)
FL = {}                                                       # ласты: сторона +1 — игровой z>0, то есть файловый x<0
for sd in (1, -1):
    xs = -sd
    FL['F%d' % sd] = (bone('flF%d' % sd, b_sp, xs * 15.5, 8.0, 34.0), bone('flF%dt' % sd, len(B), xs * 45.0, -17.0, 21.0))
    FL['H%d' % sd] = (bone('flH%d' % sd, b_t[0], xs * 11.0, 8.0, -35.0), bone('flH%dt' % sd, len(B), xs * 23.5, -11.0, -50.0))
# родитель кончика ласта = его основание (индекс корректируем)
for sd in (1, -1):
    for k in ('F', 'H'):
        a, b = FL[k + str(sd)]; B[b] = (B[b][0], a, B[b][2])
NB = len(B); par = [b[1] for b in B]; names = [b[0] for b in B]
restF = np.array([b[2] for b in B]); restP = restF @ G.T          # игровые оси
height = 33.0                                                    # масштаб игры считается по «высоте» костей: берём высоту головы, чтобы пороги (корона, глаза) были разумными
print('костей', NB)
# ------------------------------------------------------------------ веса по положению вершины (файловые координаты)
spine = [(-146, b_t[6]), (-133, b_t[5]), (-118, b_t[4]), (-100, b_t[3]), (-75, b_t[2]), (-50, b_t[1]), (-25, b_t[0]), (0, b_root), (24, b_sp), (42, b_nk), (55, b_hd)]
sz = np.array([s[0] for s in spine], float); sb = [s[1] for s in spine]
def spine_w(P):                                              # веса «шляпами» по z: два соседних сустава; впереди головы — голова, позади хвоста — конец хвоста
    n = len(P); W = np.zeros((n, NB)); z = np.clip(P[:, 2], sz[0], sz[-1])
    k = np.clip(np.searchsorted(sz, z) - 1, 0, len(sz) - 2); t = sstep(0, 1, (z - sz[k]) / (sz[k + 1] - sz[k]))
    for i in range(n): W[i, sb[k[i]]] += 1 - t[i]; W[i, sb[k[i] + 1]] += t[i]
    return W
def flipper_mq(P, root, tip, xs, zr):                       # m — принадлежность ласту (0 у основания → 1), q — доля кончика; только вершины снаружи тела в области ласта
    ax = tip - root; L = np.linalg.norm(ax); ax = ax / L
    proj = ((P - root) @ ax) / L; side = (P[:, 0] * xs) > (abs(root[0]) - 0.6)
    perp = np.linalg.norm((P - root) - np.outer((P - root) @ ax, ax), axis=1)
    inreg = (side & (perp < zr) & (proj > -0.02) & (proj < 1.25)).astype(float)
    return sstep(0.0, 0.35, proj) * inreg, sstep(0.4, 0.9, proj) * inreg
def weights(P, jawmask=None):
    W = spine_w(P)
    for sd in (1, -1):
        xs = -sd
        for k, zr in (('F', 21.0), ('H', 12.0)):
            a, bt = FL[k + str(sd)]; m, q = flipper_mq(P, restF[a], restF[bt], xs, zr)
            W *= (1 - m)[:, None]; W[:, a] += m * (1 - q); W[:, bt] += m * q
    if jawmask is not None:                                  # нижняя челюсть: ниже линии рта и впереди шарнира; плавный переход у шарнира
        jw = jawmask * sstep(HZ - 3.0, HZ + 3.0, P[:, 2])
        W *= (1 - jw)[:, None]; W[:, b_jw] += jw
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9); return W
# ------------------------------------------------------------------ сетки: вершины = (контрольная точка, индекс UV, материал); сварка по UV не нужна (атлас по материалам)
def build(V, T, U, M, extra=None):
    key = {}; vc = []; vu = []; vm = []; tri = []
    for t in range(len(T)):
        row = []
        for k in range(3):
            kk = (int(T[t, k]), round(float(U[t, k, 0]), 6), round(float(U[t, k, 1]), 6), int(M[t]))
            if kk not in key: key[kk] = len(vc); vc.append(kk[0]); vu.append((kk[1], kk[2])); vm.append(kk[3])
            row.append(key[kk])
        tri.append(row)
    return np.array(vc), np.array(vu), np.array(vm), np.array(tri)
def cp_normals(V, T):
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]); N = np.zeros_like(V)
    for k in range(3): np.add.at(N, T[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
Nb_cp = cp_normals(Vb, Tb); Nt_cp = cp_normals(Vt, Tt)
cb, ub, mb, trib = build(Vb, Tb, Ub, Mb); ct, ut, mt_, trit = build(Vt, Tt, Ut, Mt)
print('после разделения швов: тело', len(cb), 'зубы', len(ct))
# нижняя челюсть: по контрольным точкам тела (ниже линии рта и впереди шарнира) и по компонентам зубов (центроид)
jaw_cp = ((Vb[:, 1] < mline(Vb[:, 2]) - 0.05) & (Vb[:, 2] > HZ - 3.0)).astype(float)
A = coo_matrix((np.ones(len(Tt) * 3), (np.repeat(np.arange(len(Tt)), 3), Tt.ravel())), shape=(len(Tt), len(Vt)))
nc, lab = connected_components((A @ A.T) > 0, directed=False)
cent = np.array([Vt[Tt[lab == c].ravel()].mean(0) for c in range(nc)]); jaw_tooth = (cent[:, 1] < mline(cent[:, 2])).astype(float)
print('зубов-компонент', nc, 'нижних', int(jaw_tooth.sum()))
jaw_t_cp = np.zeros(len(Vt))
for c in range(nc): jaw_t_cp[np.unique(Tt[lab == c])] = jaw_tooth[c]
# ------------------------------------------------------------------ упрощение (границы швов блокируются: UV-острова не рвутся)
def decimate(V, T, target, lock=None):
    wd = tempfile.mkdtemp(); here = os.path.dirname(os.path.abspath(__file__))
    n = len(V)
    if lock is None:
        ec = {}
        for t in T:
            for a_, b_ in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): k_ = (min(a_, b_), max(a_, b_)); ec[k_] = ec.get(k_, 0) + 1
        lock = np.zeros(n, np.uint8)
        for (a_, b_), c_ in ec.items():
            if c_ == 1: lock[a_] = 1; lock[b_] = 1
    V.astype(np.float32).tofile(wd + '/V.bin'); T.astype(np.int32).tofile(wd + '/F.bin'); lock.astype(np.uint8).tofile(wd + '/L.bin')
    env = dict(os.environ, DEC_LOCK=wd + '/L.bin', DEC_IDX=wd + '/I.bin')
    subprocess.check_call(['node', os.path.join(here, 'decimate.js'), wd + '/V.bin', wd + '/F.bin', wd + '/OV.bin', wd + '/OF.bin', str(target)], env=env, stdout=subprocess.DEVNULL)
    oi = np.fromfile(wd + '/I.bin', np.int32); return oi, np.fromfile(wd + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64), np.fromfile(wd + '/OF.bin', np.int32).reshape(-1, 3), int(lock.sum())
TB_ = int(os.environ.get('ICH_TRIS', '22000')); TT_ = int(os.environ.get('ICH_TEETH', '3600'))
pb_ = Vb[cb]; ob, pbd, trib2, lk = decimate(pb_, trib, TB_); print('тело: заблокировано', lk, 'из', len(pb_), '→ вершин', len(pbd), 'треугольников', len(trib2))
pt_ = Vt[ct]; ot, ptd, trit2, lk2 = decimate(pt_, trit, TT_, lock=np.zeros(len(pt_), np.uint8)); print('зубы → вершин', len(ptd), 'треугольников', len(trit2))
# ------------------------------------------------------------------ атлас: тело | голова (по 1024²) + полоска цвета зубов
def load_tex(p, size=1024):
    return np.array(Image.open(p).convert('RGB').resize((size, size), Image.BOX)).astype(np.float64) / 255
tb = load_tex(os.path.join(texd, 'BodyCol.jpg')); th = load_tex(os.path.join(texd, 'HeadCol.jpg'))
import cv2                                                    # розовый «шрам»-кольцо на спине текстуры тела → закрашиваем соседними пикселями
_u = np.round(tb * 255).astype(np.uint8); _r, _g, _b = [_u[..., i].astype(int) for i in range(3)]
_m = ((_r > 120) & (_r > _g * 1.25) & (_r > _b * 1.1)).astype(np.uint8)
_m = cv2.dilate(_m, np.ones((5, 5), np.uint8)); print('закрашено розовых пикселей', int(_m.sum()))
tb = cv2.inpaint(_u, _m, 4, cv2.INPAINT_TELEA).astype(np.float64) / 255
AW, AH = 2048, 1088
EXP = float(os.environ.get('ICH_EXP', '1.7'))
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
atl = np.zeros((AH, AW, 3)); atl[:1024, :1024] = tb; atl[:1024, 1024:] = th; atl[1024:, :] = np.array([0.93, 0.90, 0.80])    # зубы: слоновая кость
atl_lin = np.clip(lin(atl) * EXP, 0, 1)
Image.fromarray(np.round(atl_lin * 255).astype(np.uint8)).save('/tmp/ich_sheet.jpg', quality=int(os.environ.get('ICH_Q', '82')))
sheet_b64 = base64.b64encode(open('/tmp/ich_sheet.jpg', 'rb').read()).decode(); print('атлас', len(sheet_b64) // 1024, 'КБ')
def atlas_uv(uv, mat):                                        # uv файла (v вверх) → uv атласа (v вниз, как у остальных моделей игры)
    u = uv[:, 0] % 1.0 if False else np.clip(uv[:, 0], 0, 1); v = np.clip(uv[:, 1], 0, 1)
    ox = np.where(mat == 1, 1024, 0)
    return np.stack([(ox + u * 1023.0 + 0.5) / AW, (1 - v) * 1023.0 / AH + 0.5 / AH], 1)
# ------------------------------------------------------------------ итоговые массивы тела и зубов
Pb = Vb[cb[ob]]; Nb = Nb_cp[cb[ob]]; UVa_b = atlas_uv(ub[ob], mb[ob]); Wb = weights(Pb, jaw_cp[cb[ob]])
# декимированные позиции: берём позиции после упрощения (вершины могли сместиться)
Pb = pbd
Wb = weights(Pb, jaw_cp[cb[ob]])
Pt = ptd; Nt = Nt_cp[ct[ot]]; UVa_t = np.tile(np.array([[0.5, (1024 + 32) / AH]]), (len(Pt), 1)); Wt = weights(Pt, jaw_t_cp[ct[ot]])
# нормали после упрощения: берём нормали уцелевших вершин (швы сохраняются)
P = np.vstack([Pb, Pt]); N = np.vstack([Nb, Nt]); UVa = np.vstack([UVa_b, UVa_t]); W = np.vstack([Wb, Wt]); Tri = np.vstack([trib2, trit2 + len(Pb)])
n = len(P); print('итого вершин', n, 'треугольников', len(Tri))
top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
# в игровые оси
Vg = P @ G.T; Ng = N @ G.T
# ------------------------------------------------------------------ глаза (игровые оси): [0] — сторона z>0
E0 = ec[1] if ec[1][0] < 0 else ec[0]; E1 = ec[0] if ec[1][0] < 0 else ec[1]       # [0] — файловый x<0 → игровой z>0
EYES = [(np.array(E0) @ G.T).tolist(), (np.array(E1) @ G.T).tolist()]
EYER = [ER_, ER_]
# цвет век: среднее цвета кожи вокруг глаза
LIDC = []
for e_ in (E0, E1):
    pf = Pb; near = np.linalg.norm(pf - np.array(e_), axis=1) < 8.0
    uvn = UVa_b[near]; px = np.clip((uvn[:, 0] * AW).astype(int), 0, AW - 1); py = np.clip((uvn[:, 1] * AH).astype(int), 0, AH - 1)
    col = atl_lin[py, px]; lum = col @ np.array([0.3, 0.55, 0.15]); keep = lum > np.percentile(lum, 15)
    LIDC.append([round(float(c), 4) for c in col[keep].mean(0)])
print('цвет век', LIDC)
# ------------------------------------------------------------------ клипы: абсолютные повороты вокруг вертикали (волна по позвоночнику), крен ластов
def Ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def Rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def Rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q
LEN = 247.0                                                   # от носа (z=98) до конца хвоста (z=-149)
spos = {b: (98.0 - restF[b][2]) / LEN for b in range(NB)}    # 0 у носа, 1 у хвоста
def pose(u, o):
    two = 2 * np.pi; R = [None] * NB
    for i in range(NB):
        p = par[i]; Rp = np.eye(3) if p < 0 else R[p]
        if names[i] in ('root', 'spine', 'neck') or (names[i].startswith('tail') and names[i] != 'tailend'):
            s = spos[i]; amp = o['A'] * (o['a0'] + (1 - o['a0']) * s ** o['pw'])
            psi = amp * np.sin(two * (o['n'] * u - o['lam'] * s) + o['ph'])          # абсолютный курс участка
            if names[i] in ('root', 'spine', 'neck'): psi = psi * o['front']
            R[i] = Ry(psi)
        elif names[i] == 'head':
            look = o['look'] * np.sin(two * o['lf'] * u + 0.7)
            R[i] = Ry(-0.35 * o['A'] * np.sin(two * (o['n'] * u - o['lam'] * spos[b_nk]) + o['ph']) * o['front'] + look) @ Rz(o['nod'] * np.sin(two * o['lf'] * u + 1.3))
        elif names[i] == 'jaw':
            R[i] = R[par[i]] @ Rz(-o['jaw'] * (0.5 - 0.5 * np.cos(two * o['jf'] * u)) ** 2)
        elif names[i].startswith('fl'):
            if names[i].endswith('t'): R[i] = Rp @ Rz(0.0)
            else:
                sd = 1 if names[i][3] == '1' else -1; ph = o['fph'] * (0 if names[i][2] == 'F' else 1)
                R[i] = Rp @ Rx(-sd * o['fl'] * np.sin(two * (o['n'] * u) + ph)) @ Rz(o['fp'] * np.sin(two * (o['n'] * u) + ph + 1.0))
        elif names[i] == 'tailend': R[i] = R[par[i]]
        else: R[i] = Rp
        if names[i] in ('head',): R[i] = R[i] if False else R[i]
    return R
def make_clip(nf, T, o, v):
    Q = np.zeros((nf, NB, 4))
    for f in range(nf):
        R = pose(f / nf, o)
        for i in range(NB):
            q = qmat_to_q(R[i] if par[i] < 0 else R[par[i]].T @ R[i])
            if f > 0 and np.dot(q, Q[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            Q[f, i] = q
    return {'dur': round(T, 4), 'nf': nf, 'loop': True, 'v': round(v, 4), 'q': base64.b64encode(np.round(Q * 32767).astype(np.int16).tobytes()).decode(), 'tb': {}}, Q
IDLE = dict(A=0.16, a0=0.15, pw=1.6, n=1, lam=0.8, ph=0.0, front=0.0, look=0.12, lf=1, nod=0.03, jaw=0.0, jf=1, fl=0.10, fp=0.05, fph=0.8)
SWIM = dict(A=0.58, a0=0.10, pw=2.0, n=1, lam=1.05, ph=0.0, front=0.0, look=0.0, lf=1, nod=0.0, jaw=0.0, jf=1, fl=0.20, fp=0.06, fph=1.4)
if os.environ.get('ICH_FRONT'): SWIM['front'] = float(os.environ['ICH_FRONT'])
clips = {}
clips['idle'], Qi = make_clip(72, 3.6, IDLE, 0.0)
clips['l0'], Qs = make_clip(32, 1.3, SWIM, float(os.environ.get('ICH_V', '330')))
# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(Vg).max())); zeros = np.zeros(n, np.uint8)
uvout = np.stack([UVa[:, 0], UVa[:, 1]], 1).clip(0, 1)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(Vg * SC).astype(np.int16)), 'n': b64(np.round(np.clip(Ng, -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(uvout * 65535).astype(np.uint16)), 'f': b64(Tri.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'clips': clips, 'tips': [], 'neck': [b_nk], 'head': b_hd, 'jaw': b_jw, 'jsign': 1.0,
     'eyes': [[round(float(c), 4) for c in e] for e in EYES], 'eyeR': EYER, 'lid': LIDC, 'height': height, 'tex': sheet_b64}
open(out, 'w').write('// Ихтиозавр (Ichthyosaurus, Sketchfab; лицензия в архиве не указана) — подготовлено tools/ich_bake.py. Не редактировать.\nexport const ICH = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ', 'вершин', n, 'кадров', 72, 32)
if dbg: np.savez(dbg, Vg=Vg, Tri=Tri, top=top, w4=w4, restP=restP, par=np.array(par), names=np.array(names), Qi=Qi, Qs=Qs, nb=len(Pb))

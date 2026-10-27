# Удильщик: Anglerfish (Sketchfab, FBX без скелета и анимации: тело, два ряда зубов и мелкая деталь, текстуры 4096²) → game/ang.js.
# Запуск: python3 -I tools/ang_bake.py <f11.fbx> <папка textures> <выход ang.js> [отладка.npz]
# Что делает: читает 4 сетки (у каждой в файле геометрия смещена на GeometricTranslation, который гасит Lcl Translation, поэтому мировая позиция = PreRotation(-90° по X)·вершина),
# переводит в игровые оси (нос +x, вверх +y, бока z), строит скелет сам (корпус, хвост из 4 костей, шея/голова, нижняя челюсть, удочка из 3 костей, 2 грудных плавника),
# раздаёт веса по положению вершины, синтезирует клипы (стойка: лёгкое покачивание, лампа и плавники; плавание: бегущая волна по хвосту),
# собирает текстуру тела (1024²) и пятно цвета зубов. Глаза (круглые валики на голове) и моргание собирает игра, лампа получает светящийся шар (R.lure).
import numpy as np, sys, os, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_read import load
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
fbxf, texd, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((np.asarray(x, float) - a) / (b - a), 0, 1))
F = load(fbxf); objs = F['objs']; MD = F['models']
RX = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)                     # PreRotation (-90° по X): (x,y,z) → (x, z, -y)
X0, Y0, Z0 = 9.0, 18.0, 75.0
def to_game(P):                                                              # файл (нос в −x, вверх y, бок z) → игра (нос +x): поворот на 180° вокруг вертикали, начало — центр тела, низ ≈ 0
    return np.stack([X0 - P[:, 0], P[:, 1] - Y0, -(P[:, 2] - Z0)], 1)
def corners(name):
    mid = [k for k, m in MD.items() if m['name'] == name][0]
    g = objs[[k for k in F['kids'][mid] if objs[k].name == 'Geometry'][0]]
    V = g.get('Vertices').props[0].reshape(-1, 3).astype(np.float64) @ RX.T
    PV = g.get('PolygonVertexIndex').props[0].astype(np.int64); lu = [c for c in g.children if c.name == 'LayerElementUV'][0]
    UVd = lu.get('UV').props[0].reshape(-1, 2).astype(np.float64); UVi = lu.get('UVIndex').props[0].astype(np.int64)
    ln = [c for c in g.children if c.name == 'LayerElementNormal'][0]; NRM = ln.get('Normals').props[0].reshape(-1, 3).astype(np.float64) @ RX.T
    polys = []; cur = []
    for k, v in enumerate(PV):
        if v < 0: cur.append((~v, k)); polys.append(cur); cur = []
        else: cur.append((v, k))
    tri = []; tuv = []; tn = []
    for pl in polys:
        for j in range(1, len(pl) - 1):
            c3 = (pl[0], pl[j], pl[j + 1]); tri.append([c[0] for c in c3]); tuv.append([UVd[UVi[c[1]]] for c in c3]); tn.append([NRM[c[1]] for c in c3])
    return V, np.array(tri), np.array(tuv), np.array(tn)
Vb, Tb, Ub, Nb_c = corners('Group1'); Vf, Tf, Uf, Nf_c = corners('Group27724')      # тело (+ мелкая деталь у угла рта)
Vu, Tu, Uu, Nu_c = corners('Group15887'); Vl, Tl, Ul, Nl_c = corners('Group15886')   # зубы: верхний и нижний ряд
print('тело', len(Vb), len(Tb), '| деталь', len(Vf), '| зубы верх', len(Vu), len(Tu), 'низ', len(Vl), len(Tl))
# склеиваем тело и мелкую деталь в одну сетку
Vb = np.vstack([Vb, Vf]); Tb = np.vstack([Tb, Tf + len(Vb) - len(Vf)]); Ub = np.concatenate([Ub, Uf]); Nb_c = np.concatenate([Nb_c, Nf_c])
# ------------------------------------------------------------------ скелет (игровые оси)
B = []
def bone(n, p, x, y, z=0.0): B.append((n, p, (x, y, z))); return len(B) - 1
HINGE = (7.0, 20.0)                                                           # шарнир челюсти — угол рта
b_root = bone('root', -1, 0, 45)
b_nk = bone('neck', b_root, 14, 48)
b_hd = bone('head', b_nk, 28, 50)
b_jw = bone('jaw', b_hd, HINGE[0], HINGE[1])
b_l0 = bone('lure0', b_hd, 39, 79); b_l1 = bone('lure1', b_l0, 57, 106); b_l2 = bone('lure2', b_l1, 73, 86)
b_sp = bone('spine', b_root, -18, 48)
b_t0 = bone('tail0', b_sp, -34, 52); b_t1 = bone('tail1', b_t0, -48, 52); b_t2 = bone('tail2', b_t1, -62, 52); b_te = bone('tailend', b_t2, -76, 52)
FIN = {}                                                                       # грудные плавники: сторона +1 — игровой z>0
for sd in (1, -1):
    a = bone('fin%d' % sd, b_root, -4, 74, sd * 30); FIN[sd] = (a, bone('fin%dt' % sd, a, -22, 80, sd * 62))
NB = len(B); par = [b[1] for b in B]; names = [b[0] for b in B]; restP = np.array([b[2] for b in B], float)
height = 92.0
# ------------------------------------------------------------------ веса (игровые оси)
spine = [(-76, b_te), (-62, b_t2), (-48, b_t1), (-34, b_t0), (-18, b_sp), (0, b_root), (14, b_nk), (28, b_hd)]
sx = np.array([s[0] for s in spine], float); sbn = [s[1] for s in spine]
def spine_w(P):
    n = len(P); W = np.zeros((n, NB)); x = np.clip(P[:, 0], sx[0], sx[-1])
    k = np.clip(np.searchsorted(sx, x) - 1, 0, len(sx) - 2); t = sstep(0, 1, (x - sx[k]) / (sx[k + 1] - sx[k]))
    for i in range(n): W[i, sbn[k[i]]] += 1 - t[i]; W[i, sbn[k[i] + 1]] += t[i]
    return W
ROD = to_game(np.array([[-30, 97, 75], [-38, 114, 75], [-48, 124, 75], [-58, 118, 75], [-64, 104, 75], [-65, 98, 75]], float))      # осевая линия удочки
def seg_dist(P, A, Bp):                                                        # расстояние до отрезка и доля вдоль него
    ab = Bp - A; t = np.clip(((P - A) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(P - (A + np.outer(t, ab)), axis=1), t
def rod_param(P):                                                              # (расстояние до удочки, длина вдоль неё от основания)
    L = [np.linalg.norm(ROD[i + 1] - ROD[i]) for i in range(len(ROD) - 1)]; cum = np.r_[0, np.cumsum(L)]
    best = np.full(len(P), 1e9); par_ = np.zeros(len(P))
    for i in range(len(ROD) - 1):
        d, t = seg_dist(P, ROD[i], ROD[i + 1]); m = d < best; best[m] = d[m]; par_[m] = cum[i] + t[m] * L[i]
    return best, par_ / cum[-1]
def weights(P, jaw_m, fin_m=None):
    W = spine_w(P)
    # удочка: три кости по длине (шляпы), только вершины рядом с осью; у основания — плавный переход с головой
    d, t = rod_param(P); rm = (1 - sstep(3.4, 5.6, d)) * sstep(0.0, 0.12, t)
    wl = np.zeros((len(P), NB)); wl[:, b_l0] = 1 - sstep(0.0, 0.5, t); wl[:, b_l2] = sstep(0.5, 1.0, t); wl[:, b_l1] = 1 - wl[:, b_l0] - wl[:, b_l2]
    W = W * (1 - rm)[:, None] + wl * rm[:, None]
    for sd in (1, -1):                                                         # плавники: по расстоянию от основания вдоль направления к кончику
        a, bt = FIN[sd]; m, q = fin_m[sd] if fin_m is not None else (np.zeros(len(P)), np.zeros(len(P)))
        W *= (1 - m)[:, None]; W[:, a] += m * (1 - q); W[:, bt] += m * q
    W[:, b_jw] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    jw = np.clip(jaw_m, 0, 1)                                                  # челюсть: целиком на кость челюсти
    W *= (1 - jw)[:, None]; W[:, b_jw] += jw
    return W / np.maximum(W.sum(1, keepdims=True), 1e-9)
def fin_mq(P, sd):
    a, bt = FIN[sd]; root = restP[a]; tip = restP[bt]; ax = tip - root; L = np.linalg.norm(ax); ax = ax / L
    proj = ((P - root) @ ax) / L; perp = np.linalg.norm((P - root) - np.outer((P - root) @ ax, ax), axis=1)
    side = (P[:, 2] * sd) > 20.0                                                # только снаружи тела (плавник отходит от боков)
    inreg = (side & (perp < 38.0) & (proj > -0.1) & (proj < 1.4) & (P[:, 1] > 58) & (P[:, 0] < 14)).astype(float)
    return sstep(0.1, 0.55, proj) * inreg, sstep(0.45, 1.0, proj) * inreg
# нижняя челюсть: вершины тела ниже линии рта и впереди шарнира (игровые оси: нос +x), плавный переход у шарнира; нижние зубы целиком
def jaw_mask(P, teeth_low=False):
    if teeth_low: return np.ones(len(P))
    return sstep(HINGE[0] - 4, HINGE[0] + 6, P[:, 0]) * (1 - sstep(JAWY - 6, JAWY + 4, P[:, 1]))
JAWY = float(os.environ.get('ANG_JAWY', '32'))
# ------------------------------------------------------------------ вершины: (контрольная точка, uv) — швы разделяются; зубы сварены по точкам
def build(V, T, U, N, weld):
    key = {}; vc = []; vu = []; vn = []; tri = []
    for t in range(len(T)):
        row = []
        for k in range(3):
            kk = (int(T[t, k]),) if weld else (int(T[t, k]), round(float(U[t, k, 0]), 6), round(float(U[t, k, 1]), 6))
            if kk not in key: key[kk] = len(vc); vc.append(kk[0]); vu.append((U[t, k, 0], U[t, k, 1])); vn.append(np.zeros(3))
            vn[key[kk]] = vn[key[kk]] + N[t, k]; row.append(key[kk])
        tri.append(row)
    vn = np.array(vn); vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    return np.array(vc), np.array(vu), vn, np.array(tri)
cb, ub, nb_, trib = build(Vb, Tb, Ub, Nb_c, False); cu, uu, nu_, triu = build(Vu, Tu, Uu, Nu_c, True); cl, ul, nl_, tril = build(Vl, Tl, Ul, Nl_c, True)
Pb = to_game(Vb[cb]); Pu = to_game(Vu[cu]); Pl = to_game(Vl[cl])
Nb = nb_ @ np.diag([-1, 1, -1]); Nu = nu_ @ np.diag([-1, 1, -1]); Nl = nl_ @ np.diag([-1, 1, -1])            # нормали — тем же поворотом на 180°
print('после разделения швов: тело', len(Pb), 'зубы', len(Pu), len(Pl))
# ------------------------------------------------------------------ текстура: тело 1024² + пятно цвета зубов
TW = 1024; PATCH = 32
texb = np.array(Image.open(os.path.join(texd, 'low_defaultMat_BaseColor.png')).convert('RGB').resize((TW, TW), Image.BOX)).astype(np.float64) / 255
lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
EXP = float(os.environ.get('ANG_EXP', '1.5'))
atl = np.zeros((TW + PATCH, TW, 3)); atl[:TW] = texb; atl[TW:] = np.array([0.88, 0.86, 0.76])
atl_lin = np.clip(lin(atl) * EXP, 0, 1)
Image.fromarray(np.round(atl_lin * 255).astype(np.uint8)).save('/tmp/ang_sheet.jpg', quality=int(os.environ.get('ANG_Q', '70')))
sheet_b64 = base64.b64encode(open('/tmp/ang_sheet.jpg', 'rb').read()).decode(); print('текстура', len(sheet_b64) // 1024, 'КБ')
AH = TW + PATCH
def atlas_uv(uv):                                                              # uv файла (v вверх) → uv листа (v вниз)
    u = np.clip(uv[:, 0], 0, 1); v = np.clip(uv[:, 1], 0, 1)
    return np.stack([(u * (TW - 1) + 0.5) / TW, ((1 - v) * (TW - 1) + 0.5) / AH], 1)
UVb = atlas_uv(ub); UVt = np.tile(np.array([[0.5, (TW + PATCH / 2) / AH]]), (len(Pu) + len(Pl), 1))
# ------------------------------------------------------------------ веса, глаза
Wb = weights(Pb, jaw_mask(Pb), {sd: fin_mq(Pb, sd) for sd in (1, -1)})
Wu = weights(Pu, np.zeros(len(Pu)), {sd: (np.zeros(len(Pu)), np.zeros(len(Pu))) for sd in (1, -1)})
Wl = weights(Pl, np.ones(len(Pl)), {sd: (np.zeros(len(Pl)), np.zeros(len(Pl))) for sd in (1, -1)})
P = np.vstack([Pb, Pu, Pl]); N = np.vstack([Nb, Nu, Nl]); UV = np.vstack([UVb, UVt]); W = np.vstack([Wb, Wu, Wl])
Tri = np.vstack([trib, triu + len(Pb), tril + len(Pb) + len(Pu)]); n = len(P)
top = np.argsort(-W, axis=1)[:, :4]; w4 = np.take_along_axis(W, top, 1); w4 /= np.maximum(w4.sum(1, keepdims=True), 1e-9)
print('итого вершин', n, 'треугольников', len(Tri))
for k in range(NB): print('  кость', k, names[k], 'главная у', int((top[:, 0] == k).sum()))
# глаза: поверхность зрачка нарисованного глаза на валике (найдена по самым тёмным вершинам текстуры): игровые координаты, [0] — z>0
EYES = [[21.4, 88.9, 20.1], [21.5, 89.0, -20.5]]; EYER = [4.6, 4.6]
LIDC = []
for e_ in EYES:
    near = np.linalg.norm(Pb - np.array(e_), axis=1) < 7.0
    uvn = UVb[near]; px = np.clip((uvn[:, 0] * TW).astype(int), 0, TW - 1); py = np.clip((uvn[:, 1] * AH).astype(int), 0, AH - 1)
    col = atl_lin[py, px]; LIDC.append([round(float(c), 4) for c in col.mean(0)])
print('глаза', np.round(EYES, 1).tolist(), 'цвет век', LIDC)
BULB = to_game(np.array([[-64.0, 100.0, 75.0]]))[0]
Vb_ = Pb[np.linalg.norm(Pb - BULB, axis=1) < 9]; BULB = ((Vb_.min(0) + Vb_.max(0)) / 2) if len(Vb_) else BULB; BULBR = float((Vb_.max(0) - Vb_.min(0)).max() / 2) if len(Vb_) else 5.0
print('лампа', BULB.round(1), 'радиус', round(BULBR, 1))
# ------------------------------------------------------------------ клипы: абсолютные повороты (волна по телу), качание удочки и плавников
def Ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def Rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def Rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def qmat_to_q(R):
    t = np.trace(R)
    if t > 0: s = np.sqrt(t + 1) * 2; return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = np.argmax(np.diag(R)); j, k = (i + 1) % 3, (i + 2) % 3; s = np.sqrt(R[i, i] - R[j, j] - R[k, k] + 1) * 2; q = np.zeros(4)
    q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s; return q
LEN = 150.0
spos = {b: float(np.clip((28.0 - restP[b][0]) / 104.0, 0, 1)) for b in range(NB)}      # 0 у головы, 1 у конца хвоста
def pose(u, o):
    two = 2 * np.pi; R = [None] * NB
    for i in range(NB):
        p = par[i]; Rp = np.eye(3) if p < 0 else R[p]; nm = names[i]
        if nm in ('root', 'spine', 'tail0', 'tail1', 'tail2'):
            s = spos[i]; amp = o['A'] * (o['a0'] + (1 - o['a0']) * s ** o['pw'])
            R[i] = Ry(amp * np.sin(two * (o['n'] * u - o['lam'] * s) + o['ph']))              # абсолютный курс участка
        elif nm == 'neck': R[i] = Rp
        elif nm == 'head': R[i] = Ry(o['look'] * np.sin(two * u + 0.7)) @ Rz(o['nod'] * np.sin(two * u + 1.3))
        elif nm == 'jaw': R[i] = Rp @ Rz(o['jaw'] - o['jb'] * (0.5 - 0.5 * np.cos(two * o['jn'] * u)))             # + = закрыть (в файле пасть открыта): в покое почти закрыта, дыхание чуть приоткрывает
        elif nm.startswith('lure'):
            k = int(nm[4]); ph = 0.9 * k
            R[i] = Rp @ Rz(o['la'] * (0.6 + 0.4 * k) * np.sin(two * u + ph)) @ Ry(o['ly'] * (0.6 + 0.4 * k) * np.sin(two * u + ph + 1.7))
        elif nm == 'tailend': R[i] = R[par[i]]
        elif nm.startswith('fin'):
            sd = 1 if nm[3] == '1' else -1
            if nm.endswith('t'): R[i] = Rp @ Rz(o['fp'] * np.sin(two * o['n'] * u + 1.0 + (0 if sd > 0 else 0.4)))
            else: R[i] = Rp @ Rx(-sd * o['fl'] * np.sin(two * o['n'] * u + (0 if sd > 0 else 0.3))) @ Ry(sd * o['fy'] * np.sin(two * o['n'] * u + 0.8))
        else: R[i] = Rp
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
IDLE = dict(A=0.07, a0=0.0, pw=2.2, n=1, lam=0.8, ph=0.0, look=0.04, nod=0.015, jaw=0.45, jb=0.08, jn=1, la=0.10, ly=0.14, fl=0.16, fp=0.10, fy=0.05)
SWIM = dict(A=float(os.environ.get('ANG_A', '0.42')), a0=0.0, pw=2.2, n=1, lam=1.1, ph=0.0, look=0.0, nod=0.0, jaw=0.42, jb=0.05, jn=1, la=0.12, ly=0.18, fl=0.34, fp=0.12, fy=0.06)
clips = {}
clips['idle'], Qi = make_clip(72, 4.0, IDLE, 0.0)
clips['l0'], Qs = make_clip(36, 1.8, SWIM, float(os.environ.get('ANG_V', '140')))
# ------------------------------------------------------------------ вывод
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(P).max())); zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(P * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N, -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(Tri.astype(np.uint16)),
     'si': b64(top.astype(np.uint8)), 'sw': b64(np.round(w4 * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': par, 'pos': [[round(float(c), 5) for c in p] for p in restP], 'clips': clips, 'tips': [], 'neck': [b_nk], 'head': b_hd, 'jaw': b_jw, 'jsign': 1.0,
     'eyes': [[round(float(c), 4) for c in e] for e in EYES], 'eyeR': EYER, 'lid': LIDC, 'height': height, 'tex': sheet_b64,
     'lure': {'bone': b_l2, 'pos': [round(float(c), 3) for c in BULB], 'r': round(BULBR, 3)}}
open(out, 'w').write('// Удильщик (Anglerfish, Sketchfab; лицензия в архиве не указана) — подготовлено tools/ang_bake.py. Не редактировать.\nexport const ANG = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ', 'вершин', n)
if dbg: np.savez(dbg, P=P, Tri=Tri, top=top, w4=w4, restP=restP, par=np.array(par), names=np.array(names), Qi=Qi, Qs=Qs, nb=len(Pb), W=W)

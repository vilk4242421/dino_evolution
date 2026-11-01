# Статичные модели (без скелета) → данные «JP» со своим скелетом и синтезированными клипами (game/<ключ>.js).
# Запуск: python3 -I tools/static_rig.py <модель.glb> <выход .js> <ключ>
#   jerboa — «Тушканчик» ← Jerboa (присланный GLB: тело + усы, текстура; без скелета): усы убраны (тонкие пластины — лишнее), скелет из 23 костей
#            (таз, 2 позвонка, голова, 2 уха, 7 звеньев хвоста, задние лапы по 3 звена, передние лапки); клипы: прыжки на задних лапах (шаг и бег),
#            покой (сидит: принюхивается, водит ушами, хвост подрагивает), выпад, вздрагивание.
#   newt   — «Болотный тритон» ← скан тритона (CC0, ~330 тыс. треугольников, без скелета): упрощён до ~7 тыс., скелет из позвоночника, хвоста и лап;
#            клипы: шаг/бег ящерицы (лапы враскоряку, S-изгиб тела), покой, выпад, вздрагивание.
# Веса костей: ближайшие отрезки костей в своей области тела (голова/уши/лапы/хвост/туловище), затем сглаживание по рёбрам сетки.
import numpy as np, sys, os, json, base64, struct, io, subprocess, tempfile
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)
glbf, out, KEY = sys.argv[1:4]
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
    bv = J['bufferViews'][J['images'][J['textures'][i]['source']]['bufferView']]; o = bv.get('byteOffset', 0); return Image.open(io.BytesIO(BIN[o:o + bv['byteLength']]))
def qmat(q):
    x, y, z, w = q; return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
pn = {}
for i, n_ in enumerate(J['nodes']):
    for c in n_.get('children', []): pn[c] = i
def nloc(n_):
    if 'matrix' in n_: return np.array(n_['matrix'], float).reshape(4, 4).T
    M = np.eye(4); M[:3, :3] = qmat(n_.get('rotation', [0, 0, 0, 1])) * np.array(n_.get('scale', [1, 1, 1]), float); M[:3, 3] = n_.get('translation', [0, 0, 0]); return M
def nworld(k):
    M = np.eye(4)
    while k is not None: M = nloc(J['nodes'][k]) @ M; k = pn.get(k)
    return M
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
def aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def qm(a_, b_):
    x1, y1, z1, w1 = a_; x2, y2, z2, w2 = b_
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
ss_ = lambda a_, b_, x_: (lambda t_: t_ * t_ * (3 - 2 * t_))(min(1, max(0, (x_ - a_) / (b_ - a_))))

# ------------------------------------------------------------------ сетка в мировых координатах, затем в осях игры (x — вперёд, y — вверх, z — поперёк)
CFG = {
  'jerboa': dict(var='JERBOA', title='Тушканчик (Jerboa, статичная модель; скелет и клипы — свои)', drop=[0], fwd=(0, 0, -1.0), tri=6000, tex=512),
  'shark': dict(var='SHARK', title='Акула (Low poly Cretoxyrhina, статичная модель; скелет и клипы — свои)', drop=[], fwd=(0, 0, 1.0), tri=9000, tex=512, atlas=1, free=[0]),
  'newt': dict(var='NEWT', title='Болотный тритон (скан тритона CC0; скелет и клипы — свои)', drop=[0], fwd=(-1.0, 0, 0), tri=9000, tex=512, weld=1),
}[KEY]
Vl, Nl, UVl, Fl, MT = [], [], [], [], []; o_ = 0
for k, n_ in enumerate(J['nodes']):
    if 'mesh' not in n_ or n_['mesh'] in CFG['drop']: continue
    M = nworld(k); Rn = M[:3, :3] / np.linalg.norm(M[:3, :3], axis=0, keepdims=True)
    for pp in J['meshes'][n_['mesh']]['primitives']:
        a = pp['attributes']; ix = acc(pp['indices']).astype(np.int64).ravel(); u_ = np.unique(ix); rm = -np.ones(J['accessors'][a['POSITION']]['count'], np.int64); rm[u_] = np.arange(len(u_))
        Vl.append(acc(a['POSITION']).astype(np.float64)[u_] @ M[:3, :3].T + M[:3, 3]); Nl.append(acc(a['NORMAL']).astype(np.float64)[u_] @ Rn.T); UVl.append(acc(a['TEXCOORD_0']).astype(np.float64)[u_] % 1)
        Fl.append(rm[ix].reshape(-1, 3) + o_); MT.append(pp['material']); o_ += len(u_)
V = np.vstack(Vl); N = np.vstack(Nl); UV = np.vstack(UVl); F = np.vstack(Fl); n = len(V)
ATL = sorted(set(MT)) if CFG.get('atlas') else None                                 # несколько материалов → лист 2×2, UV каждого — в свою клетку
if ATL:
    CW_ = 2; off_ = 0
    for k_, (uvp, mt) in enumerate(zip(UVl, MT)):
        c_ = ATL.index(mt); cx_, cy_ = (c_ % CW_) / CW_, (c_ // CW_) / CW_; m_ = len(uvp)
        UV[off_:off_ + m_] = np.stack([uvp[:, 0] / CW_ + cx_, uvp[:, 1] / CW_ + cy_], 1); off_ += m_
PRIM = np.concatenate([np.full(len(v_), k_) for k_, v_ in enumerate(Vl)])           # номер примитива у каждой вершины (зубы, тело, глаза)
print('исходно: вершин', n, 'граней', len(F), 'габариты', V.min(0).round(3), V.max(0).round(3))
if os.environ.get('DUMP'): np.save(os.environ['DUMP'], V); sys.exit()
fwd = np.array(CFG['fwd']) if CFG['fwd'] is not None else np.array(json.loads(os.environ.get('FWD', '[1,0,0]')), float)
upv = np.array([0, 1.0, 0]); G = np.array([fwd, upv, np.cross(fwd, upv)])
V = V @ G.T; N = N @ G.T
UNI = 100.0 / np.abs(V - V.mean(0)).max(); V = (V - [V[:, 0].mean(), V[:, 1].min(), V[:, 2].mean()]) * UNI      # ~100 ед., земля по низу, центр по x/z
VC = None
if CFG.get('weld'):                                                                 # скан: треугольники почти не делят вершины (швы UV) — сшиваем по положению, цвет текстуры переносим в цвет вершин
    from scipy.spatial import cKDTree
    TX = np.array(image(J['materials'][MT[0]]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB')).astype(np.float64) / 255; th_, tw_ = TX.shape[:2]
    C0 = TX[np.clip((UV[:, 1] * th_).astype(int), 0, th_ - 1), np.clip((UV[:, 0] * tw_).astype(int), 0, tw_ - 1)]; V0 = V.copy()
    key = np.round(V / 1e-4).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    nw = inv.max() + 1; Vw = np.zeros((nw, 3)); cnt = np.bincount(inv, minlength=nw).astype(float); Nw = np.zeros((nw, 3))
    for c in range(3): Vw[:, c] = np.bincount(inv, V[:, c], nw) / cnt; Nw[:, c] = np.bincount(inv, N[:, c], nw)
    F = inv[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]; V = Vw; N = Nw; UV = np.zeros((nw, 2)); n = nw
    print('сшито: вершин', n, 'граней', len(F))
# ------------------------------------------------------------------ упрощение (до весов: веса считаются на итоговой сетке)
if len(F) > CFG['tri'] * 1.15:
    wd_ = tempfile.mkdtemp(); ec_ = {}
    for t_ in F:
        for a_, b_ in ((t_[0], t_[1]), (t_[1], t_[2]), (t_[2], t_[0])): k_ = (min(a_, b_), max(a_, b_)); ec_[k_] = ec_.get(k_, 0) + 1
    lock_ = np.zeros(n, np.uint8)
    for (a_, b_), c_ in ec_.items():
        if c_ == 1 and not CFG.get('weld'): lock_[a_] = 1; lock_[b_] = 1
    if CFG.get('free') is not None: lock_[np.isin(PRIM, CFG['free'])] = 0              # мелкие детали (зубы) упрощаем без замков: швы UV на них не видны
    V.astype(np.float32).tofile(wd_ + '/V.bin'); F.astype(np.int32).tofile(wd_ + '/F.bin'); lock_.tofile(wd_ + '/L.bin')
    for tgt in ([CFG['tri']] if len(F) < 400000 else [len(F) // 8, len(F) // 24, CFG['tri']]):    # очень большие сетки — в несколько проходов
        subprocess.check_call(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), wd_ + '/V.bin', wd_ + '/F.bin', wd_ + '/OV.bin', wd_ + '/OF.bin', str(tgt)], env=dict(os.environ, DEC_LOCK=wd_ + '/L.bin', DEC_IDX=wd_ + '/I.bin'), stdout=subprocess.DEVNULL)
        oi_ = np.fromfile(wd_ + '/I.bin', np.int32); V = np.fromfile(wd_ + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd_ + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64)
        N = N[oi_]; UV = UV[oi_]; lock_ = lock_[oi_]; PRIM = PRIM[oi_]; n = len(V); print('  упрощено до', len(F))
        V.astype(np.float32).tofile(wd_ + '/V.bin'); F.astype(np.int32).tofile(wd_ + '/F.bin'); lock_.tofile(wd_ + '/L.bin')
print('сетка: вершин', n, 'граней', len(F), 'габариты', V.min(0).round(1), V.max(0).round(1))
if CFG.get('weld'):
    _, nb_ = cKDTree(V0).query(V, k=12); VC = C0[nb_].mean(1)                     # цвет вершины — среднее по ближайшим точкам исходного скана
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
if os.environ.get('VIEW'):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(18, 7)); q = V[::1]
    ax[0].scatter(q[:, 0], q[:, 1], s=0.4, c=q[:, 2], cmap='coolwarm'); ax[1].scatter(q[:, 0], q[:, 2], s=0.4, c=q[:, 1], cmap='viridis')
    for a in ax: a.set_aspect('equal'); a.grid(True); a.minorticks_on(); a.grid(which='minor', alpha=0.3)
    ax[0].set_xlabel('x вперёд'); ax[0].set_ylabel('y'); ax[1].set_xlabel('x'); ax[1].set_ylabel('z'); plt.tight_layout(); plt.savefig(os.environ['VIEW'], dpi=70); sys.exit()
# ------------------------------------------------------------------ скелет (точки в осях игры, ед. ~100) и области тела
BN = []; PAR = []; POS = []
def bone(name, parent, p): BN.append(name); PAR.append(BN.index(parent) if parent else -1); POS.append(np.array(p, float)); return len(BN) - 1
if KEY == 'jerboa':
    bone('pelvis', None, [-18, 40, 0]); bone('spine', 'pelvis', [-8, 50, 0]); bone('chest', 'spine', [0, 52, 0]); bone('head', 'chest', [4, 55, 0])
    bone('ear.L', 'head', [8, 64, 6]); bone('ear.L1', 'ear.L', [12, 73, 10]); bone('ear.R', 'head', [8, 64, -6]); bone('ear.R1', 'ear.R', [12, 73, -10])
    prev = 'pelvis'
    for k_, p_ in enumerate([[-28, 36, 0], [-38, 25, 0], [-50, 16, 0], [-62, 13, 0], [-74, 15, 0], [-86, 20, 0], [-97, 27, 0]]): bone('tail%d' % k_, prev, p_); prev = 'tail%d' % k_
    for sd, z in (('L', 1), ('R', -1)):
        bone('thigh.' + sd, 'pelvis', [-18, 36, 8 * z]); bone('shin.' + sd, 'thigh.' + sd, [-14, 24, 8 * z]); bone('ankle.' + sd, 'shin.' + sd, [-7, 8, 7 * z]); bone('toe.' + sd, 'ankle.' + sd, [1, 1, 7 * z])
        bone('arm.' + sd, 'chest', [5, 48, 4 * z]); bone('paw.' + sd, 'arm.' + sd, [9, 45, 3 * z])
    def region(v):
        x, y, z = v; sd = 'L' if z > 0 else 'R'
        if x < -28 and y < 40: return [b for b in BN if b.startswith('tail')] + (['pelvis'] if x > -34 else [])
        if y > 61 and x > 2: return ['ear.' + sd, 'ear.' + sd + '1', 'head']
        if np.hypot(x - 8, y - 46) < 7 and 1.2 < abs(z) < 8 and y < 50: return ['arm.' + sd, 'paw.' + sd, 'chest']
        if x > 2: return ['head', 'chest']
        if y < 34 and x > -27 and abs(z) > 1.5: return ['thigh.' + sd, 'shin.' + sd, 'ankle.' + sd, 'toe.' + sd] + (['pelvis'] if y > 28 else [])
        return ['pelvis', 'spine', 'chest', 'thigh.' + sd] if y < 40 else ['pelvis', 'spine', 'chest']
    TIPS = ['toe.L', 'toe.R']; HEAD = 'head'; NECK = ['chest']
if KEY == 'newt':
    bone('pelvis', None, [-22, 13, 0]); bone('spine1', 'pelvis', [-5, 14, 0]); bone('spine2', 'spine1', [12, 14, 0]); bone('chest', 'spine2', [25, 14, 0]); bone('head', 'chest', [38, 15, 0]); bone('snout', 'head', [54, 14, 0])
    prev = 'pelvis'
    for k_, x_ in enumerate([-32, -45, -58, -70, -82, -94]): bone('tail%d' % k_, prev, [x_, 13 + 0.15 * k_, 0]); prev = 'tail%d' % k_
    for sd, z in (('L', 1), ('R', -1)):
        bone('arm.' + sd, 'chest', [24, 11, 6 * z]); bone('fore.' + sd, 'arm.' + sd, [27, 7, 13 * z]); bone('hand.' + sd, 'fore.' + sd, [32, 3, 18 * z]); bone('fing.' + sd, 'hand.' + sd, [35, 1, 22 * z])
        bone('thigh.' + sd, 'pelvis', [-20, 11, 6 * z]); bone('shin.' + sd, 'thigh.' + sd, [-20, 7, 13 * z]); bone('foot.' + sd, 'shin.' + sd, [-19, 3, 18 * z]); bone('toe.' + sd, 'foot.' + sd, [-18, 1, 22 * z])
    def region(v):
        x, y, z = v; sd = 'L' if z > 0 else 'R'
        if x < -30: return [b for b in BN if b.startswith('tail')] + (['pelvis'] if x > -36 else [])
        if abs(z) > 7.5 or (abs(z) > 4 and y < 7):
            return (['arm.' + sd, 'fore.' + sd, 'hand.' + sd, 'fing.' + sd] + (['chest'] if abs(z) < 9 else [])) if x > 0 else (['thigh.' + sd, 'shin.' + sd, 'foot.' + sd, 'toe.' + sd] + (['pelvis'] if abs(z) < 9 else []))
        if x > 36: return ['head', 'snout', 'chest']
        return ['pelvis', 'spine1', 'spine2', 'chest']
    TIPS = ['fing.L', 'fing.R', 'toe.L', 'toe.R']; HEAD = 'head'; NECK = ['chest']
if KEY == 'shark':
    bone('body', None, [-30, 18, 0]); bone('chest', 'body', [-12, 18, 0]); bone('head', 'chest', [2, 18, 0]); bone('snout', 'head', [19, 17, 0]); bone('jaw', 'head', [0, 12.5, 0]); bone('jawtip', 'jaw', [16, 11.5, 0])
    prev = 'body'
    for k_, x_ in enumerate([-45, -58, -70, -82, -92, -100]): bone('tail%d' % k_, prev, [x_, 18 + 0.3 * k_, 0]); prev = 'tail%d' % k_
    for sd, z in (('L', 1), ('R', -1)): bone('fin.' + sd, 'chest', [-21, 10, 8 * z]); bone('fin1.' + sd, 'fin.' + sd, [-27, 2, 27 * z])
    def jawY(x): return 12.4 + 0.02 * x
    def region(v, pr=None):
        x, y, z = v; sd = 'L' if z > 0 else 'R'
        if x < -40: return [b for b in BN if b.startswith('tail')] + (['body'] if x > -48 else [])
        if abs(z) > 8.5 and y < 13 and -34 < x < -14: return ['fin.' + sd, 'fin1.' + sd] + (['chest'] if abs(z) < 11 else [])
        if x > -3 and y < jawY(x) and abs(z) < 9: return ['jaw', 'jawtip'] + (['head'] if x < 1 else [])
        if x > -3: return ['head', 'snout', 'chest']
        return ['body', 'chest', 'tail0']
    TIPS = []; HEAD = 'head'; NECK = ['chest']
NB = len(BN); POS = np.array(POS); bi = {b: i for i, b in enumerate(BN)}
kids = [[j for j in range(NB) if PAR[j] == i] for i in range(NB)]
def segd(v, b):                                                                      # расстояние от вершины до отрезка кости (кость → её первый ребёнок)
    a = POS[b]; c = POS[kids[b][0]] if kids[b] else (a + (a - POS[PAR[b]]) * 0.5 if PAR[b] >= 0 else a)
    ab = c - a; t = np.clip(np.dot(v - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1); return np.linalg.norm(v - (a + ab * t))
Wt = np.zeros((n, NB))
for i in range(n):
    al = [bi[b] for b in (region(V[i], PRIM[i]) if KEY == 'shark' else region(V[i]))]; ds = np.array([segd(V[i], b) for b in al]); w = 1 / (ds + 1.5) ** 4; Wt[i, al] = w / w.sum()
adj = [set() for _ in range(n)]
for t_ in F:
    for a_, b_ in ((t_[0], t_[1]), (t_[1], t_[2]), (t_[2], t_[0])): adj[a_].add(b_); adj[b_].add(a_)
adjl = [np.array(sorted(a_)) for a_ in adj]
for it in range(int(os.environ.get('SMOOTH', '3'))):                               # сглаживание по рёбрам — без ступенек на границах областей
    Wn = Wt.copy()
    for i in range(n):
        if len(adjl[i]): Wn[i] = 0.5 * Wt[i] + 0.5 * Wt[adjl[i]].mean(0)
    Wt = Wn
top = np.argsort(-Wt, 1)[:, :4]; SW = np.take_along_axis(Wt, top, 1); SW /= SW.sum(1, keepdims=True); SI = top
print('костей', NB, 'вершин по главной кости', {BN[b]: int((top[:, 0] == b).sum()) for b in range(NB)})
# ------------------------------------------------------------------ клипы (повороты — от позы привязки, оси игры)
def Rq(q):
    x, y, z, w = q; return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def fk(Q, root=None):
    Dw = [None] * NB; P_ = np.zeros((NB, 3))
    for b in range(NB):
        p_ = PAR[b]
        if p_ < 0: Dw[b] = Rq(Q[b]); P_[b] = POS[b] if root is None else root
        else: Dw[b] = Dw[p_] @ Rq(Q[b]); P_[b] = P_[p_] + Dw[p_] @ (POS[b] - POS[p_])
    return P_
Q0 = np.tile([0, 0, 0, 1.0], (NB, 1))
def synth(dur, fps, loop, fn, base=None):
    nf = int(round(dur * fps)) + (0 if loop else 1); QF = np.repeat((Q0 if base is None else base)[None], nf, 0).copy(); RT = []
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1); r = fn(u); RT.append(r.pop('_root', None))
        for b, q in r.items(): QF[f, bi[b]] = qm(QF[f, bi[b]], q)
    for f in range(1, nf):
        fl_ = (QF[f] * QF[f - 1]).sum(1) < 0; QF[f, fl_] *= -1
    return QF, RT
def enc(QF, dur, loop, v=0.0, tb=None, **kw):
    d_ = {'dur': round(dur, 4), 'nf': len(QF), 'loop': loop, 'v': round(float(v), 4), 'q': b64(np.round(QF * 32767).astype(np.int16)), 'tb': tb or {}}; d_.update(kw); return d_
def ground_tb(QF, air):                                                              # корень: опускаем/поднимаем так, чтобы нижняя стопа стояла на земле, плюс высота прыжка
    T_ = []; tp = [bi[t] for t in TIPS]
    for f in range(len(QF)):
        P_ = fk(QF[f]); low = min(P_[t][1] for t in tp) - min(POS[t][1] for t in tp); T_.append([round(float(POS[0][0]), 3), round(float(POS[0][1] - low + air[f]), 3), round(float(POS[0][2]), 3)])
    return {'0': T_}
clips = {}
if KEY == 'jerboa':
    def hop(L_, H_):
        def fn(u):                                                                   # 0–0.35 толчок (лапы разгибаются назад), 0.35–0.9 полёт (лапы поджаты вперёд), 0.9–1 приземление
            ext = ss_(0.0, 0.32, u) * (1 - ss_(0.36, 0.55, u)); tuck = ss_(0.4, 0.6, u) * (1 - ss_(0.85, 1.0, u)); land = ss_(0.88, 0.97, u) * (1 - ss_(0.97, 1.0, u))
            r = {'pelvis': aa([0, 0, 1], -0.22 * ext + 0.08 * tuck), 'chest': aa([0, 0, 1], 0.1 * ext), 'head': aa([0, 0, 1], 0.12 * ext - 0.06 * tuck)}
            for sd in 'LR':
                r['thigh.' + sd] = aa([0, 0, 1], -0.75 * L_ * ext + 0.55 * L_ * tuck); r['shin.' + sd] = aa([0, 0, 1], 0.35 * L_ * ext - 0.25 * tuck); r['ankle.' + sd] = aa([0, 0, 1], -0.5 * L_ * ext + 0.5 * tuck - 0.3 * land); r['toe.' + sd] = aa([0, 0, 1], -0.5 * ext)
                r['arm.' + sd] = aa([0, 0, 1], -0.3 * tuck + 0.15 * ext)
                r['ear.' + sd] = aa([0, 0, 1], -0.35 * ext * H_)
            for k_ in range(7): r['tail%d' % k_] = aa([0, 0, 1], (0.12 * ext - 0.1 * tuck) * (1 + 0.15 * k_))
            return r
        return fn
    for nm, L_, H_, dur, dist in (('l0', 0.7, 6.0, 0.55, 38.0), ('l1', 1.0, 14.0, 0.38, 75.0)):
        QF, _ = synth(dur, 30, True, hop(L_, H_)); nf = len(QF); air = [H_ * np.sin(np.pi * min(1, max(0, (f / nf - 0.36) / 0.56))) for f in range(nf)]
        clips[nm] = enc(QF, dur, True, dist / dur, ground_tb(QF, air)); print('клип', nm, 'кадров', nf, 'скорость', round(dist / dur, 1))
    def idle(u):                                                                     # сидит: принюхивается (нос подёргивается), водит ушами, оглядывается, хвост подрагивает кончиком
        w = 2 * np.pi * u; look = 0.45 * np.sin(w) * (0.5 + 0.5 * np.cos(2 * w)); sn = 0.04 * np.sin(22 * w) * max(0.0, np.sin(3 * w)) ** 2
        r = {'head': qm(aa([0, 1, 0], look), aa([0, 0, 1], sn + 0.06 * np.sin(2 * w + 1))), 'spine': aa([0, 0, 1], 0.015 * np.sin(5 * w))}
        for sd, sg in (('L', 1), ('R', -1)):
            r['ear.' + sd] = qm(aa([1, 0, 0], sg * 0.18 * np.sin(3 * w + (0 if sg > 0 else 2))), aa([0, 0, 1], 0.1 * np.sin(4 * w + sg)))
            r['paw.' + sd] = aa([0, 0, 1], 0.12 * np.sin(6 * w + sg) ** 3)
        for k_ in range(7): r['tail%d' % k_] = aa([0, 1, 0], 0.03 * k_ * np.sin(2 * w - 0.5 * k_))
        return r
    QF, _ = synth(6.0, 30, True, idle); clips['idle'] = enc(QF, 6.0, True)
    def lunge(u):
        wind = ss_(0, 0.3, u) * (1 - ss_(0.3, 0.45, u)); hit = ss_(0.3, 0.45, u) * (1 - ss_(0.6, 1.0, u))
        r = {'pelvis': aa([0, 0, 1], 0.1 * wind - 0.2 * hit), 'head': aa([0, 0, 1], -0.15 * hit)}
        for sd in 'LR': r['arm.' + sd] = aa([0, 0, 1], 0.6 * hit); r['ear.' + sd] = aa([0, 0, 1], 0.4 * wind)
        return r
    QF, _ = synth(0.6, 30, False, lunge); clips['atk'] = enc(QF, 0.6, False, rate=1.0)
    def flinch(u):
        e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5; r = {'pelvis': aa([1, 0, 0], 0.12 * e), 'head': aa([0, 0, 1], 0.3 * e), 'spine': aa([0, 1, 0], 0.15 * e * np.sin(u * 14))}
        for sd, sg in (('L', 1), ('R', -1)): r['ear.' + sd] = aa([0, 0, 1], 0.5 * e)
        for k_ in range(7): r['tail%d' % k_] = aa([0, 0, 1], -0.12 * e)
        return r
    QF, _ = synth(0.6, 30, False, flinch); clips['hurt'] = enc(QF, 0.6, False, rate=1.2, span=[0.0, 1.0])
if KEY == 'newt':
    def gait(A, K_, und, dur):                                                       # шаг тритона: лапы враскоряку (плечо/бедро — вокруг вертикали), диагональные пары, S-изгиб тела и хвоста
        PH = {'arm.L': 0.0, 'thigh.R': 0.0, 'arm.R': 0.5, 'thigh.L': 0.5}
        def fn(u):
            r = {}; w = 2 * np.pi * u
            for up_, ph in PH.items():
                sd = up_[-1]; sg = 1.0 if sd == 'L' else -1.0; a = w + 2 * np.pi * ph; lift = max(0.0, -np.sin(a)); ch = (['fore.', 'hand.'] if up_.startswith('arm') else ['shin.', 'foot.'])
                r[up_] = qm(aa([0, 1, 0], sg * A * np.cos(a)), aa([1, 0, 0], -sg * K_ * lift)); r[ch[0] + sd] = aa([1, 0, 0], sg * 0.5 * K_ * lift); r[ch[1] + sd] = aa([1, 0, 0], sg * 0.3 * K_ * lift)
            for k_, b_ in enumerate(['pelvis', 'spine1', 'spine2', 'chest']): r[b_] = aa([0, 1, 0], und * np.sin(w + 0.6 * k_) * (0.5 if b_ == 'pelvis' else 1))
            r['head'] = aa([0, 1, 0], -und * 0.8 * np.sin(w + 2.4))
            for k_ in range(6): r['tail%d' % k_] = aa([0, 1, 0], und * (0.9 + 0.3 * k_) * np.sin(w - 0.7 * (k_ + 1)))
            return r
        return fn
    Lh = 16.0
    for nm, A, K_, und, dur, duty in (('l0', 0.42, 0.45, 0.12, 1.1, 0.65), ('l1', 0.55, 0.6, 0.2, 0.5, 0.5)):
        QF, _ = synth(dur, 30, True, gait(A, K_, und, dur)); clips[nm] = enc(QF, dur, True, 2 * Lh * np.sin(A) / (dur * duty)); print('клип', nm, 'скорость', round(clips[nm]['v'], 1))
    def idle(u):                                                                     # покой: дышит, медленно поворачивает голову, кончик хвоста изгибается
        w = 2 * np.pi * u; r = {'head': qm(aa([0, 1, 0], 0.25 * np.sin(w)), aa([0, 0, 1], 0.05 * np.sin(2 * w + 1))), 'spine2': aa([0, 1, 0], 0.03 * np.sin(w + 0.5)), 'chest': aa([0, 0, 1], 0.01 * np.sin(5 * w))}
        for k_ in range(6): r['tail%d' % k_] = aa([0, 1, 0], 0.05 * (k_ + 1) * np.sin(2 * w - 0.6 * k_) * 0.4)
        return r
    QF, _ = synth(6.0, 30, True, idle); clips['idle'] = enc(QF, 6.0, True)
    def bite(u):
        wind = ss_(0, 0.3, u) * (1 - ss_(0.3, 0.45, u)); hit = ss_(0.3, 0.45, u) * (1 - ss_(0.6, 1.0, u))
        return {'chest': aa([0, 0, 1], 0.12 * wind - 0.05 * hit), 'head': aa([0, 0, 1], 0.1 * wind - 0.18 * hit), 'spine2': aa([0, 1, 0], 0.08 * wind)}
    QF, _ = synth(0.6, 30, False, bite); clips['atk'] = enc(QF, 0.6, False, rate=1.0)
    def flinch(u):
        e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5; r = {'head': aa([0, 0, 1], 0.2 * e), 'spine1': aa([0, 1, 0], 0.18 * e), 'spine2': aa([0, 1, 0], 0.15 * e)}
        for k_ in range(6): r['tail%d' % k_] = aa([0, 1, 0], -0.2 * e * np.sin(u * 14 - 0.6 * k_))
        return r
    QF, _ = synth(0.6, 30, False, flinch); clips['hurt'] = enc(QF, 0.6, False, rate=1.2, span=[0.0, 1.0])
if KEY == 'shark':
    TB = ['tail%d' % k_ for k_ in range(6)]
    def swim(A, dur, fin):                                                           # плавание: волна по телу, растёт к хвосту (как у настоящей акулы — работает задняя половина), голова чуть «водит» навстречу
        def fn(u):
            w = 2 * np.pi * u; r = {'body': aa([0, 1, 0], A * 0.18 * np.sin(w + 1.6)), 'chest': aa([0, 1, 0], -A * 0.12 * np.sin(w + 2.1)), 'head': aa([0, 1, 0], -A * 0.1 * np.sin(w + 2.4))}
            for k_, b_ in enumerate(TB): r[b_] = aa([0, 1, 0], A * (0.25 + 0.17 * k_) * np.sin(w - 0.75 * (k_ + 1)))
            for sd, sg in (('L', 1), ('R', -1)): r['fin.' + sd] = aa([1, 0, 0], sg * fin * np.sin(w * 0.5 + 0.7))
            r['jaw'] = aa([0, 0, 1], -0.03 - 0.02 * np.sin(w))
            return r
        return fn
    for nm, A, dur, fin in (('l0', 0.32, 1.7, 0.05), ('l1', 0.42, 0.85, 0.08)):
        QF, _ = synth(dur, 30, True, swim(A, dur, fin)); clips[nm] = enc(QF, dur, True, 0.55 * 120 / dur); print('клип', nm, 'скорость', round(clips[nm]['v'], 1))
    QF, _ = synth(3.2, 30, True, swim(0.16, 3.2, 0.04)); clips['idle'] = enc(QF, 3.2, True)                       # покой: медленно «стоит» в воде, хвост едва работает
    def bite(u):                                                                     # укус: голова вверх, пасть широко раскрывается, бросок — захлоп
        op = ss_(0.0, 0.35, u) * (1 - ss_(0.45, 0.55, u)); hit = ss_(0.4, 0.55, u) * (1 - ss_(0.7, 1.0, u))
        return {'head': aa([0, 0, 1], 0.22 * op - 0.08 * hit), 'jaw': aa([0, 0, 1], -0.75 * op), 'chest': aa([0, 0, 1], 0.06 * op - 0.05 * hit), 'tail0': aa([0, 1, 0], 0.15 * hit), 'tail2': aa([0, 1, 0], -0.25 * hit)}
    QF, _ = synth(0.75, 30, False, bite); clips['atk'] = enc(QF, 0.75, False, rate=1.0)
    def flinch(u):
        e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.5; r = {'chest': aa([0, 1, 0], 0.18 * e * np.sin(u * 16)), 'head': aa([0, 0, 1], 0.15 * e), 'jaw': aa([0, 0, 1], -0.25 * e)}
        for k_, b_ in enumerate(TB): r[b_] = aa([0, 1, 0], -0.25 * e * np.sin(u * 16 - 0.6 * k_))
        return r
    QF, _ = synth(0.6, 30, False, flinch); clips['hurt'] = enc(QF, 0.6, False, rate=1.2, span=[0.0, 1.0])
# ------------------------------------------------------------------ текстура и запись
if VC is None:
    mats = sorted(set(MT))
    if ATL:
        TW_ = CFG['tex'] * 2; tex = Image.new('RGB', (TW_, TW_))
        for c_, mt in enumerate(ATL): tex.paste(image(J['materials'][mt]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB').resize((TW_ // 2, TW_ // 2), Image.LANCZOS), ((c_ % 2) * TW_ // 2, (c_ // 2) * TW_ // 2))
    else:
        ti_ = J['materials'][mats[0]]['pbrMetallicRoughness']['baseColorTexture']['index']; tex = image(ti_).convert('RGB').resize((CFG['tex'], CFG['tex']), Image.LANCZOS)
    bf = io.BytesIO(); _LIN(tex).save(bf, 'JPEG', quality=86); sheet = base64.b64encode(bf.getvalue()).decode()
    VCOL = np.full((n, 3), 255, np.uint8)
else: sheet = ''; VCOL = np.round(np.clip(np.where(VC <= 0.04045, VC / 12.92, ((VC + 0.055) / 1.055) ** 2.4) * float(os.environ.get('VC_K', '1.0')), 0, 1) * 255).astype(np.uint8)
print('текстура', len(sheet) // 1024, 'КБ')
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)),
     'si': b64(SI.astype(np.uint8)), 'sw': b64(np.round(SW * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'par': PAR, 'pos': [[round(float(c), 3) for c in p_] for p_ in POS], 'clips': clips, 'tips': [bi[t] for t in TIPS], 'neck': [bi[b] for b in NECK], 'head': bi[HEAD], 'jaw': bi[HEAD], 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(V[:, 1].max()), 3), 'tex': sheet, 'nativeEyes': 1, 'vc': b64(VCOL)}
open(out, 'w').write('// ' + CFG['title'] + ' — подготовлено tools/static_rig.py ' + KEY + '. Не редактировать.\nexport const ' + CFG['var'] + ' = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

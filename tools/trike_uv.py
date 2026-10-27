# UV-развёртка половины модели трицератопса и запекание деталей с исходной (детальной) сетки:
#  - карта нормалей (касательное пространство, совместима с three.js без атрибута tangent),
#  - карта рельефа/полостей (серый множитель цвета: щели между чешуями темнее, бугорки светлее).
# Вход (папка <dir>): H.npy/HF.npy — половина игровой сетки (z ≥ 0), hiR.npy/hiL.npy/hiF.npy — детальная сетка после тех же деформаций.
# Выход: UVH.npz (вершины с учётом швов UV, грани, uv, индекс исходной вершины), nrm.png, det.png.
# Запуск: python3 tools/trike_uv.py <dir> [размер текстуры]
import numpy as np, sys, os, time
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from scipy import ndimage
from PIL import Image

d = sys.argv[1]; TS = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
XS = -12.0                                                     # шов между правой (спереди) и левой (сзади) половинами исходника
t0 = time.time()
H = np.load(os.path.join(d, 'H.npy')); F = np.load(os.path.join(d, 'HF.npy')).astype(np.int64)
nV, nF = len(H), len(F)


def fnormals(P, F):
    n = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); a = np.linalg.norm(n, axis=1)
    return n / np.maximum(a, 1e-12)[:, None], a * 0.5


def vnormals(P, F):
    n = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); vn = np.zeros_like(P)
    for k in range(3): np.add.at(vn, F[:, k], n)
    return vn / np.maximum(np.linalg.norm(vn, axis=1), 1e-12)[:, None]


FN, FA = fnormals(H, F)
VN = vnormals(H, F)
# сглаженные нормали — чтобы карты получались крупными, а не дробились на каждой чешуйке
rows = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]); cols = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
A = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nV, nV)).tocsr(); A.data[:] = 1
deg = np.asarray(A.sum(1)).ravel()
SN = VN.copy()
for _ in range(25): SN = (A @ SN + SN) / (deg + 1)[:, None]; SN /= np.linalg.norm(SN, axis=1)[:, None]
FS = SN[F].sum(1); FS /= np.linalg.norm(FS, axis=1)[:, None]

# направления проекций: 6 осей + 8 диагоналей
D = [np.array(v, float) for v in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
for sx in (1, -1):
    for sy in (1, -1):
        for sz in (1, -1): D.append(np.array([sx, sy, sz], float) / np.sqrt(3))
D = np.array(D)
lab = np.argmax(FS @ D.T, 1)
bad = (FN * D[lab]).sum(1) < 0.15                              # грань «смотрит» вбок от своей проекции — по её собственной нормали
lab[bad] = np.argmax(FN[bad] @ D.T, 1)

# смежность граней через общие рёбра
E = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); fid = np.tile(np.arange(nF), 3)
key = np.sort(E, 1); kk = key[:, 0] * nV + key[:, 1]; o = np.argsort(kk); ks = kk[o]
same = np.nonzero(ks[1:] == ks[:-1])[0]
FA_, FB_ = fid[o][same], fid[o][same + 1]


def charts_of(lab):
    m = lab[FA_] == lab[FB_]
    g = coo_matrix((np.ones(m.sum()), (FA_[m], FB_[m])), shape=(nF, nF))
    return connected_components(g, directed=False)[1]


ch = charts_of(lab)
# мелкие карты присоединяем к соседним, если проекция соседа им подходит
for it in range(6):
    sizes = np.bincount(ch); small = sizes < 40
    changed = 0
    for c in np.nonzero(small)[0]:
        fs = np.nonzero(ch == c)[0]
        nb = np.concatenate([FB_[np.isin(FA_, fs)], FA_[np.isin(FB_, fs)]]); nb = nb[ch[nb] != c]
        if not len(nb): continue
        best, bl = -1, None
        for cc in np.unique(ch[nb]):
            l2 = lab[nb[ch[nb] == cc][0]]; q = (FN[fs] @ D[l2]).min()
            if q > 0.2 and sizes[cc] > best: best, bl = sizes[cc], (cc, l2)
        if bl: ch[fs] = bl[0]; lab[fs] = bl[1]; changed += 1
    ch = charts_of(lab)
    if not changed: break


def basis(dv):
    a = np.array([0, 1, 0.]) if abs(dv[1]) < 0.9 else np.array([1, 0, 0.])
    e1 = np.cross(a, dv); e1 /= np.linalg.norm(e1); e2 = np.cross(dv, e1); return e1, e2


def overlap(uv, tris):
    """Доля перекрытия треугольников карты в проекции (растр с шагом ~0.35 ед.)."""
    mn = uv.min(0); sz = np.ceil((uv.max(0) - mn) / 0.35).astype(int) + 2
    if sz[0] * sz[1] > 4e6: return 1.0
    cov = np.zeros((sz[1], sz[0]), np.int16); tot = 0
    for t in tris:
        p = (uv[t] - mn) / 0.35; x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = p; den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12: continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den; l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
        ins = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
        cov[Y[ins].astype(int), X[ins].astype(int)] += 1; tot += ins.sum()
    return ((cov > 1).sum()) / max(1, (cov > 0).sum())


# проекция каждой карты на плоскость её направления; перекрывающиеся карты делим пополам, пока не станет чисто
charts = []
queue = [np.nonzero(ch == c)[0] for c in np.unique(ch)]
while queue:
    fs = queue.pop()
    dv = D[lab[fs[0]]]; e1, e2 = basis(dv)
    vs = np.unique(F[fs]); P2 = np.c_[H[vs] @ e1, H[vs] @ e2]
    loc = -np.ones(nV, np.int64); loc[vs] = np.arange(len(vs)); tl = loc[F[fs]]
    if len(fs) > 4 and overlap(P2, tl) > 0.002:
        c = H[vs].mean(0); ax = np.linalg.svd(H[vs] - c)[2][0]
        side = ((H[F[fs]].mean(1) - c) @ ax) > 0
        for part in (fs[side], fs[~side]):
            if not len(part): continue
            # часть может распасться на несвязные куски
            sub = np.isin(FA_, part) & np.isin(FB_, part)
            g = coo_matrix((np.ones(sub.sum()), (np.searchsorted(part, FA_[sub]), np.searchsorted(part, FB_[sub]))), shape=(len(part), len(part)))
            cc = connected_components(g, directed=False)[1]
            for k in np.unique(cc): queue.append(part[cc == k])
        continue
    # поворот к минимальной охватывающей рамке (по главным осям)
    c2 = P2.mean(0); w_, v_ = np.linalg.eigh(np.cov((P2 - c2).T)); R2 = v_[:, ::-1]
    P2 = (P2 - c2) @ R2
    if np.linalg.det(R2) < 0: P2[:, 1] *= -1                    # без зеркала — ориентация треугольников сохраняется
    charts.append((fs, vs, P2 - P2.min(0)))
print('карт:', len(charts), '| %.1f с' % (time.time() - t0))

# упаковка: растровая (по маскам карт), повороты 0/90°, от крупных к мелким, «вниз-влево»
from scipy.signal import fftconvolve
PAD = 6; GR = 4                                                # поле между картами (текселей), шаг растра упаковки
GN = TS // GR


def chart_mask(P2, k, rot):
    Q = P2 * k / GR
    if rot: Q = np.c_[Q[:, 1], Q[:, 0]]
    w, h = int(np.ceil(Q[:, 0].max())) + 1, int(np.ceil(Q[:, 1].max())) + 1
    m = np.zeros((h + 2, w + 2), np.float32)
    return Q, m


def raster(fs, vs, Q, m):
    loc = {v: i for i, v in enumerate(vs)}
    for f in fs:
        p = np.array([Q[loc[v]] for v in F[f]]) + 1
        x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        m[y0:y1 + 1, x0:x1 + 1] = 1                               # грубо: прямоугольник треугольника (с запасом)
    return m


def pack(k, final=False):
    occ = np.zeros((GN, GN), np.float32); pos = {}
    pd = int(np.ceil(PAD / GR))
    order = sorted(range(len(charts)), key=lambda i: -(charts[i][2].max(0).prod()))
    for i in order:
        fs, vs, P2 = charts[i]; best = None
        for rot in (0, 1):
            Q, m = chart_mask(P2, k, rot); m = raster(fs, vs, Q, m)
            m = ndimage.binary_dilation(m > 0, iterations=pd).astype(np.float32)
            h, w = m.shape
            if h > GN or w > GN: continue
            c = fftconvolve(occ, m[::-1, ::-1], mode='valid')       # перекрытие при сдвиге (y, x)
            free = np.argwhere(c < 0.5)
            if not len(free): continue
            j = np.lexsort((free[:, 1], free[:, 0]))[0]; y, x = free[j]
            sc_ = y * GN + x
            if best is None or sc_ < best[0]: best = (sc_, y, x, rot, m)
        if best is None: return False, None
        _, y, x, rot, m = best
        occ[y:y + m.shape[0], x:x + m.shape[1]] = np.maximum(occ[y:y + m.shape[0], x:x + m.shape[1]], m)
        pos[i] = ((x + 1) * GR, (y + 1) * GR, rot)
    return True, pos


lo, hi = 4.0, 40.0
for _ in range(11):
    mid = (lo + hi) / 2
    if pack(mid)[0]: lo = mid
    else: hi = mid
K = lo; _, POS = pack(K)
print('плотность: %.2f текселя на ед. | %.1f с' % (K, time.time() - t0))

# вершины с учётом швов UV
newP, newUV, orig, NF = [], [], [], np.zeros_like(F)
cid = np.zeros(nF, np.int64)
for i, (fs, vs, P2) in enumerate(charts):
    base = len(orig); orig.extend(vs.tolist())
    x_, y_, rot = POS[i]; Q2 = P2 * K
    if rot: Q2 = np.c_[Q2[:, 1], Q2[:, 0]]
    uvp = (Q2 + np.array([x_, y_])) / TS
    newUV.append(uvp)
    loc = -np.ones(nV, np.int64); loc[vs] = np.arange(len(vs)) + base
    NF[fs] = loc[F[fs]]; cid[fs] = i
orig = np.array(orig); UV = np.vstack(newUV); PU = H[orig]
print('вершин с швами:', len(PU), '(было %d)' % nV)

# ------------------------------------------------------------------ запекание
VNu = VN[orig]                                                 # гладкие нормали игровой сетки (одинаковы по обе стороны шва UV)
tex_tri = -np.ones((TS, TS), np.int32); tex_b = np.zeros((TS, TS, 2), np.float32)
UVp = UV * TS
for f in range(nF):
    p = UVp[NF[f]]; x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
    X, Y = np.meshgrid(np.arange(max(0, x0), min(TS, x1 + 1)) + 0.5, np.arange(max(0, y0), min(TS, y1 + 1)) + 0.5)
    a, b, c = p; den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-12: continue
    l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den; l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
    ins = (l1 >= -1e-4) & (l2 >= -1e-4) & (l1 + l2 <= 1 + 1e-4)
    xi = X[ins].astype(int); yi = Y[ins].astype(int)
    tex_tri[yi, xi] = f; tex_b[yi, xi, 0] = l1[ins]; tex_b[yi, xi, 1] = l2[ins]
yy, xx = np.nonzero(tex_tri >= 0); ft = tex_tri[yy, xx]; l1 = tex_b[yy, xx, 0]; l2 = tex_b[yy, xx, 1]; l3 = 1 - l1 - l2
tri = NF[ft]
pos = PU[tri[:, 0]] * l1[:, None] + PU[tri[:, 1]] * l2[:, None] + PU[tri[:, 2]] * l3[:, None]
nrm = VNu[tri[:, 0]] * l1[:, None] + VNu[tri[:, 1]] * l2[:, None] + VNu[tri[:, 2]] * l3[:, None]; nrm /= np.linalg.norm(nrm, axis=1)[:, None]
print('текселей:', len(ft), '| растр %.1f с' % (time.time() - t0))
# касательные (dp/du, dp/dv) по треугольникам
P0, P1, P2_ = PU[NF[:, 0]], PU[NF[:, 1]], PU[NF[:, 2]]; U0, U1, U2 = UV[NF[:, 0]], UV[NF[:, 1]], UV[NF[:, 2]]
e1, e2 = P1 - P0, P2_ - P0; d1, d2 = U1 - U0, U2 - U0
r = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]; r = np.where(np.abs(r) < 1e-14, 1e-14, r)
Tf = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / r[:, None]; Bf = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / r[:, None]

# детальная сетка: ближайшая точка поверхности (спереди шва — правая половина исходника, сзади — левая)
hiF = np.load(os.path.join(d, 'hiF.npy')).astype(np.int64)
NH = np.zeros((len(pos), 3)); HH = np.zeros(len(pos)); DIST = np.full(len(pos), 1e9)
for nm, flip, msk in (('hiR', False, pos[:, 0] >= XS), ('hiL', True, pos[:, 0] < XS)):
    Q = np.load(os.path.join(d, nm + '.npy')).astype(np.float64); Fq = hiF[:, ::-1] if flip else hiF
    Fq = Fq[(Q[Fq][:, :, 2].min(1) > -0.4)]
    xr = (pos[msk, 0].min() - 3, pos[msk, 0].max() + 3); Fq = Fq[(Q[Fq][:, :, 0].max(1) > xr[0]) & (Q[Fq][:, :, 0].min(1) < xr[1])]
    Qn = vnormals(Q, Fq)
    A_, B_, C_ = Q[Fq[:, 0]], Q[Fq[:, 1]], Q[Fq[:, 2]]; fnq = np.cross(B_ - A_, C_ - A_); fnq /= np.maximum(np.linalg.norm(fnq, axis=1), 1e-12)[:, None]
    tree = cKDTree((A_ + B_ + C_) / 3)
    idx = np.nonzero(msk)[0]
    for s0 in range(0, len(idx), 200000):
        ii = idx[s0:s0 + 200000]; p = pos[ii]; nl = nrm[ii]
        _, cand = tree.query(p, k=10)
        best = np.full(len(ii), 1e9); bq = np.zeros((len(ii), 3)); bb = np.zeros((len(ii), 3)); bf = np.zeros(len(ii), np.int64)
        for k in range(cand.shape[1]):
            c = cand[:, k]; a, b, cc = A_[c], B_[c], C_[c]
            # ближайшая точка на треугольнике (Эриксон), векторно
            ab, ac, ap = b - a, cc - a, p - a
            d1_ = (ab * ap).sum(1); d2_ = (ac * ap).sum(1)
            bp = p - b; d3 = (ab * bp).sum(1); d4 = (ac * bp).sum(1)
            cp = p - cc; d5 = (ab * cp).sum(1); d6 = (ac * cp).sum(1)
            va = d3 * d6 - d5 * d4; vb = d5 * d2_ - d1_ * d6; vc = d1_ * d4 - d3 * d2_
            den = np.maximum(va + vb + vc, 1e-18); v = vb / den; w = vc / den; u = 1 - v - w
            # края и вершины: прижимаем барицентрические к треугольнику
            u, v, w = np.clip(u, 0, 1), np.clip(v, 0, 1), np.clip(w, 0, 1); s_ = u + v + w; u, v, w = u / s_, v / s_, w / s_
            q = a * u[:, None] + b * v[:, None] + cc * w[:, None]
            dist = np.linalg.norm(q - p, axis=1) + 2.0 * (((fnq[c] * nl).sum(1)) < 0)    # обратная сторона — штраф
            better = dist < best
            best[better] = dist[better]; bq[better] = q[better]; bb[better] = np.c_[u, v, w][better]; bf[better] = c[better]
        n_hi = Qn[Fq[bf, 0]] * bb[:, 0:1] + Qn[Fq[bf, 1]] * bb[:, 1:2] + Qn[Fq[bf, 2]] * bb[:, 2:3]
        n_hi /= np.maximum(np.linalg.norm(n_hi, axis=1), 1e-12)[:, None]
        NH[ii] = n_hi; HH[ii] = ((bq - p) * nl).sum(1); DIST[ii] = best
print('ближайшие точки: %.1f с, среднее расстояние %.2f, 95%% %.2f' % (time.time() - t0, DIST.mean(), np.percentile(DIST, 95)))
# вдали от детальной поверхности (например, швы) — без деталей
far = DIST > 2.5; NH[far] = nrm[far]; HH[far] = 0
# в касательное пространство (кадр как в шейдере three.js: T, B перпендикулярны нормали, общий масштаб)
T = Tf[ft]; B = Bf[ft]
T = T - nrm * (T * nrm).sum(1)[:, None]; B = B - nrm * (B * nrm).sum(1)[:, None]
sc = 1 / np.sqrt(np.maximum((T * T).sum(1), (B * B).sum(1)))[:, None]; T *= sc; B *= sc
M3 = np.stack([T, B, nrm], 2)                                  # столбцы: T, B, N
xyz = np.linalg.solve(M3, NH[:, :, None])[:, :, 0]
xyz /= np.linalg.norm(xyz, axis=1)[:, None]; xyz[:, 2] = np.maximum(xyz[:, 2], 0.05); xyz /= np.linalg.norm(xyz, axis=1)[:, None]
img = np.zeros((TS, TS, 3), np.float32); img[..., 2] = 1; mask = np.zeros((TS, TS), bool)
img[yy, xx] = xyz * 0.5 + 0.5; img[yy, xx, 0:2] = xyz[:, 0:2] * 0.5 + 0.5; img[yy, xx, 2] = xyz[:, 2] * 0.5 + 0.5; mask[yy, xx] = True
# рельеф → серый множитель: щели темнее, бугорки светлее (локальный, без крупных перепадов)
hmap = np.zeros((TS, TS), np.float32); hmap[yy, xx] = HH
cnt = ndimage.uniform_filter(mask.astype(np.float32), 9); loc = ndimage.uniform_filter(hmap, 9) / np.maximum(cnt, 1e-3)
hp = (hmap - loc) * mask
sd = hp[mask].std() + 1e-6
det = np.clip(0.82 + 0.16 * np.tanh(hp / (1.6 * sd)), 0, 1) * mask + 0.82 * (~mask)
# заливаем поля вокруг карт (чтобы на швах не было тёмных щелей при фильтрации и mip-уровнях)
_, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
img = img[iy, ix]; det = det[iy, ix]
# строки картинки: v = 0 — внизу (как у three.js при flipY)
Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]).save(os.path.join(d, 'nrm.png'))
Image.fromarray((det * 255 + 0.5).astype(np.uint8)[::-1]).save(os.path.join(d, 'det.png'))
np.savez(os.path.join(d, 'UVH.npz'), P=PU, F=NF, UV=UV, orig=orig)
print('готово: %.1f с' % (time.time() - t0))

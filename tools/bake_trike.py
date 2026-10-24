# Готовит модель травоядного (трицератопс) из упрощённой STL-сетки и запекает её в game/trike.js.
# Вход (в папке <dir>): G.npy — вершины в осях игры (x вперёд, y вверх, z вправо; ступни на y=0), Fg.npy — грани.
# Шаги: выпрямление головы → симметричные ноги → зеркальная симметрия с честным разрезом по оси → круглый воротник →
# голова поднята (смотрит прямо) → маленький носовой рог → длинный хвост → регионы (кожа/воротник/клюв/рог/когти) →
# нормали → UV-развёртка (карты-проекции + упаковка) → выгрузка.  Запуск: python3 tools/bake_trike.py <dir>
import numpy as np, base64, sys, os, json
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

d = sys.argv[1]
G = np.load(os.path.join(d, 'G.npy')).astype(np.float64); F = np.load(os.path.join(d, 'Fg.npy')).astype(np.int64)


def sst(t):
    t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- 0–1) выпрямление головы и симметричная постановка ступней (точечные — годятся и для детальной сетки)
LEGS = {'rl': ((-42, -18), (-41, -16), (-47, -19)), 'rr': ((-55, 22), (-44, 14), (-47, 19)),
        'fl': ((9, -19), (20, -19), (18, -18)), 'fr': ((22, 18), (28, 13), (18, 18))}


def pre(G):
    G = G.copy()
    wh = sst((G[:, 0] - 14) / 14); wy = sst((G[:, 1] - 30) / 25)
    a = (np.radians(10.0) + np.radians(18.0) * wy) * wh          # голова в исходной позе повёрнута вбок: морда меньше, воротник сильнее
    dx = G[:, 0] - 30.0
    G[:, 0], G[:, 2] = 30.0 + dx * np.cos(a) - G[:, 2] * np.sin(a), dx * np.sin(a) + G[:, 2] * np.cos(a)
    P = G.copy()
    for F0, H0, T0 in LEGS.values():                             # шаг в исходной позе несимметричный — ступни на симметричные места
        t = np.clip(P[:, 1] / 40.0, 0, 1)[:, None]
        ax = np.array(F0) + (np.array(H0) - np.array(F0)) * t
        w = np.exp(-((G[:, [0, 2]] - ax) ** 2).sum(1) / (2 * 11.0 ** 2)) * (1 - np.clip((G[:, 1] - 22) / 20, 0, 1)); w[w < 0.1] = 0
        P[:, [0, 2]] += (np.array(T0) - np.array(F0)) * (1 - t) * w[:, None]
    return snout(P)


# морда в исходной позе ещё и скошена (нижняя челюсть, клюв и рог сдвинуты вбок по-разному) — снимаем средние линии по сетке (x, y)
# и сдвигаем морду так, чтобы её середина везде легла на ось воротника (z = 4.3): тогда зеркальная половина совпадает с исходной формой
SN_X = np.arange(38, 71, 3.0); SN_Y = np.arange(0, 44, 4.0); SN_M = None


def snout(P):
    global SN_M
    if SN_M is None:
        M = np.full((len(SN_X), len(SN_Y)), np.nan)
        for i, x0 in enumerate(SN_X):
            for j, y0 in enumerate(SN_Y):
                m = (np.abs(P[:, 0] - x0) < 2.5) & (np.abs(P[:, 1] - y0) < 3) & (np.abs(P[:, 2] - 3) < 22)
                if m.sum() > 6: z = P[m, 2]; M[i, j] = (z.min() + z.max()) / 2
        # пропуски — от соседей; лёгкое сглаживание
        for _ in range(30):
            nn = np.isnan(M)
            if not nn.any(): break
            Mp = np.pad(M, 1, constant_values=np.nan); st = np.stack([Mp[:-2, 1:-1], Mp[2:, 1:-1], Mp[1:-1, :-2], Mp[1:-1, 2:]])
            M[nn] = np.nanmean(st, 0)[nn]
        M = np.where(np.isnan(M), 4.3, M)
        from scipy.ndimage import uniform_filter
        SN_M = uniform_filter(M, 3, mode='nearest')
    from scipy.interpolate import RegularGridInterpolator
    f = RegularGridInterpolator((SN_X, SN_Y), SN_M, bounds_error=False, fill_value=None)
    q = np.c_[np.clip(P[:, 0], SN_X[0], SN_X[-1]), np.clip(P[:, 1], SN_Y[0], SN_Y[-1])]
    w = sst((P[:, 0] - 38) / 7) * (1 - sst((P[:, 1] - 36) / 6))
    P = P.copy(); P[:, 2] -= (f(q) - 4.3) * w
    return P


P = pre(G)

# ---------------------------------------------------------------- 2) зеркальная симметрия: режем по оси c(x) (треугольники через ось делим), правую половину отражаем
xs = np.arange(-90, 70, 10.0); cs = []
for x0 in xs:
    m = (P[:, 0] >= x0) & (P[:, 0] < x0 + 10) & (P[:, 1] > 25)
    cs.append((P[m, 2].min() + P[m, 2].max()) / 2 if m.sum() > 20 else np.nan)
cs = np.array(cs); ok = ~np.isnan(cs); cs = np.interp(xs, xs[ok], cs[ok])
KX, KC = xs + 5, np.convolve(np.pad(cs, 2, mode='edge'), np.ones(5) / 5, mode='valid')


def cline(x):   # осевая линия: тело — середина туловища, воротник/глаза — 4.3, кончик морды — −2.5 (так морда смотрит прямо)
    b = np.interp(x, KX, KC); t1 = sst((x - 8) / 18); t2 = sst((x - 48) / 14)
    return b * (1 - t1) + 4.3 * t1




def clip(P, F, val):
    """Обрезает сетку по полупространству val ≥ 0 (треугольники через границу делятся, точки на ребре общие)."""
    val = val.copy(); val[np.abs(val) < 0.02] = 0.0
    pts = list(P); vv = list(val); cache = {}

    def cut(i, j):
        key = (min(i, j), max(i, j))
        if key not in cache:
            t = vv[i] / (vv[i] - vv[j]); pts.append(pts[i] + (pts[j] - pts[i]) * t); vv.append(0.0); cache[key] = len(pts) - 1
        return cache[key]
    out = []
    for f in F:
        zs = [vv[k] for k in f]
        if min(zs) >= 0: out.append(list(f)); continue
        if max(zs) <= 0: continue
        poly = []
        for k in range(3):
            i, j = f[k], f[(k + 1) % 3]
            if vv[i] >= 0: poly.append(i)
            if (vv[i] > 0 and vv[j] < 0) or (vv[i] < 0 and vv[j] > 0): poly.append(cut(i, j))
        for k in range(1, len(poly) - 1): out.append([poly[0], poly[k], poly[k + 1]])
    P2 = np.array(pts); V2 = np.array(vv); F2 = np.array(out, dtype=np.int64)
    A = np.linalg.norm(np.cross(P2[F2[:, 1]] - P2[F2[:, 0]], P2[F2[:, 2]] - P2[F2[:, 0]]), axis=1); F2 = F2[A > 1e-9]
    used = np.unique(F2); rm = -np.ones(len(P2), dtype=np.int64); rm[used] = np.arange(len(used))
    return P2[used], rm[F2], V2[used]


def half(P, F, side):
    """Половина модели со стороны side (+1 правая, −1 левая), переведённая на правую сторону (z ≥ 0 относительно оси, ось → z = 0)."""
    Z = (P[:, 2] - cline(P[:, 0])) * side
    H, Fh, ZH = clip(P, F, Z)
    H = H.copy(); H[:, 2] = ZH
    if side < 0: Fh = Fh[:, ::-1]                              # отражённая половина: обход граней меняется
    return H, np.ascontiguousarray(Fh)


# центральный шип воротника лежит на самой оси симметрии и после отражения рвётся — убираем его (остальные шипы парные)
SPIKE = lambda Q: (Q[:, 1] > 73) & (Q[:, 0] > 18) & (Q[:, 0] < 38) & (np.abs(Q[:, 2] - 4.1) < 3.4)
F = F[~SPIKE(P)[F].any(1)]
R, FR = half(P, F, 1)        # правая половина: хорошая голова и передние ноги
L, FL = half(P, F, -1)       # левая половина: задняя нога стоит на земле
XS, BAND, YC = -12.0, 10.0, 38.0                               # шов по туловищу (между передними и задними ногами)


def ray_r(Hs, Fs, xq, th):
    """Радиус поверхности половины Hs вдоль луча из оси (xq, YC, 0) в направлении th (в плоскости y–z)."""
    out = np.full(len(xq), np.nan)
    tri = Hs[Fs]; cx = tri[:, :, 0]
    for k in range(len(xq)):
        m = (cx.min(1) <= xq[k] + 1e-6) & (cx.max(1) >= xq[k] - 1e-6)
        T = tri[m]; o = np.array([xq[k], YC, 0.0]); dvec = np.array([0.0, np.cos(th[k]), np.sin(th[k])])
        e1 = T[:, 1] - T[:, 0]; e2 = T[:, 2] - T[:, 0]; pv = np.cross(dvec, e2); det = (e1 * pv).sum(1)
        ok = np.abs(det) > 1e-12; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        tv = o - T[:, 0]; u = (tv * pv).sum(1) * inv; qv = np.cross(tv, e1); v = (dvec * qv).sum(1) * inv; t = (e2 * qv).sum(1) * inv
        hit = ok & (u >= -1e-6) & (v >= -1e-6) & (u + v <= 1 + 1e-6) & (t > 0)
        if hit.any(): out[k] = t[hit].max()
    return out


def blend(Hs, Hother, Fother, sign):
    """Вершины половины Hs у шва плавно переводим на среднюю между двумя половинами поверхность."""
    Hs = Hs.copy(); dxs = (Hs[:, 0] - XS) * sign
    idx = np.nonzero((dxs >= 0) & (dxs < BAND))[0]
    dy = Hs[idx, 1] - YC; dz = Hs[idx, 2]; th = np.arctan2(dz, dy); r = np.hypot(dy, dz)
    ro = ray_r(Hother, Fother, Hs[idx, 0], th)
    ok = ~np.isnan(ro); w = 1 - sst(dxs[idx] / BAND)
    rn = np.where(ok, r + ((r + ro) / 2 - r) * w, r)
    Hs[idx, 1] = YC + rn * np.cos(th); Hs[idx, 2] = rn * np.sin(th)
    return Hs


R2 = blend(R, L, FL, 1); L2 = blend(L, R, FR, -1)
RA, FRA, _ = clip(R2, FR, R2[:, 0] - (XS + 0.4))              # спереди шва — правая половина
LA, FLA, _ = clip(L2, FL, (XS - 0.4) - L2[:, 0])              # сзади — левая


def loop(Hs, Fs, xval):
    """Кольцо шва (самая длинная граничная цепочка у x = xval); мелкие отдельные дырочки сразу закрываем веером."""
    E = np.vstack([Fs[:, [0, 1]], Fs[:, [1, 2]], Fs[:, [2, 0]]])
    key = np.sort(E, 1); u, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    bd = E[cnt[inv] == 1]                                    # граничные рёбра с направлением обхода грани
    bd = bd[(np.abs(Hs[bd[:, 0], 0] - xval) < 0.05) & (np.abs(Hs[bd[:, 1], 0] - xval) < 0.05)]
    nxt = {a: b for a, b in bd}; seen = set(); comps = []
    starts = [a for a in nxt if a not in set(nxt.values())] + list(nxt)
    for st in starts:
        if st in seen: continue
        ch = [st]; seen.add(st); c = st
        while c in nxt and nxt[c] not in seen: c = nxt[c]; ch.append(c); seen.add(c)
        comps.append(ch)
    comps.sort(key=len, reverse=True); main = np.array(comps[0]); fill = []
    for ch in comps[1:]:
        if len(ch) >= 3 and ch[-1] in nxt and nxt[ch[-1]] == ch[0]:
            for k in range(1, len(ch) - 1): fill.append([ch[0], ch[k + 1], ch[k]])
    th = np.arctan2(Hs[main, 2], Hs[main, 1] - YC); o = np.argsort(th)
    return main[o], th[o], np.array(fill, dtype=np.int64).reshape(-1, 3)


la, ta, fa = loop(RA, FRA, XS + 0.4); lb, tb, fb = loop(LA, FLA, XS - 0.4)
nA = len(RA); PP = np.vstack([RA, LA]); lb = lb + nA
strip = []; i = j = 0
while i < len(la) - 1 or j < len(lb) - 1:                   # «молния»: полоса треугольников между двумя кольцами шва
    if j >= len(lb) - 1 or (i < len(la) - 1 and ta[i + 1] <= tb[j + 1]): strip.append([la[i], la[i + 1], lb[j]]); i += 1
    else: strip.append([la[i], lb[j + 1], lb[j]]); j += 1
FF = np.vstack([FRA, fa, FLA + nA, fb + nA, np.array(strip)])
# ориентация полосы: нормаль должна смотреть от оси наружу
tri = PP[FF[-len(strip):]]; nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); ctr = tri.mean(1)
if ((nrm[:, 1] * (ctr[:, 1] - YC) + nrm[:, 2] * ctr[:, 2]).sum()) < 0: FF[-len(strip):] = FF[-len(strip):, ::-1]
# ---------------------------------------------------------------- 3–6) точечные деформации (одинаково для игровой и детальной сетки)
FY, FR_Y, FR_Z, K = 48.0, 24.0, 25.0, 1.3
PIV = np.array([22.0, 40.0]); ANG = np.radians(float(os.environ.get('HEAD_UP', '29')))
FPIV = np.array([33.0, 44.0]); FANG = np.radians(22.0)       # воротник отклоняем назад
X0, KT = -60.0, 2.3


def post(P):
    """Деформирует точки P (N×3, правая половина в осях игры). Возвращает новые точки и регионы."""
    P = P.copy()
    # 3) воротник: длинные шипы-«пальцы» втягиваем в круглый край, сам воротник крупнее и отклонён назад
    frill = (P[:, 0] > 26) & (P[:, 0] < 47) & (P[:, 1] > 42)
    rr = np.sqrt(((P[:, 1] - FY) / FR_Y) ** 2 + (P[:, 2] / FR_Z) ** 2); mv = frill & (rr > 1.0)
    P[mv, 1] = FY + (P[mv, 1] - FY) / rr[mv]; P[mv, 2] = P[mv, 2] / rr[mv]
    kk = 1 + (K - 1) * sst((P[:, 1] - 42) / 16) * frill
    P[:, 1] = FY + (P[:, 1] - FY) * kk; P[:, 2] = P[:, 2] * kk
    rim = frill & (np.sqrt(((P[:, 1] - FY) / (FR_Y * K)) ** 2 + (P[:, 2] / (FR_Z * K)) ** 2) > 0.86)
    wf = sst((P[:, 1] - 43) / 11) * sst((P[:, 0] - 20) / 6)     # вес отклона воротника (по позе до поворота головы)
    # нос, клюв, носовой рог
    horn = (P[:, 0] > 56.5) & (P[:, 1] > 12.5)
    beak = (P[:, 0] > 57.5) & (P[:, 1] < 17) & ~horn
    # 4) носовой рог маленький (как у трицератопса): сжимаем к основанию
    hb = np.array([57.0, 15.0, 0.0]); wn = sst((P[:, 0] - 55.5) / 3.0) * sst((P[:, 1] - 11.5) / 3.0)
    P = P + (hb + (P - hb) * float(os.environ.get('NOSE_K', '1.0')) - P) * wn[:, None]   # 1.0 — носовой рог как в исходной модели
    # 5) голова поднята — смотрит прямо вперёд (поворот вокруг основания шеи), передние ноги не трогаем
    wr = sst((P[:, 0] - 16) / 18)
    for hx, hz in ((20, 17), (20, -17)):
        lw = np.exp(-((P[:, 0] - hx) ** 2 + (P[:, 2] - hz) ** 2) / (2 * 12.0 ** 2)) * (1 - sst((P[:, 1] - 28) / 14)) * (1 - sst((P[:, 0] - 32) / 6))
        wr = wr * (1 - lw)
    aa = ANG * wr; rx, ry = P[:, 0] - PIV[0], P[:, 1] - PIV[1]
    P[:, 0], P[:, 1] = PIV[0] + rx * np.cos(aa) - ry * np.sin(aa), PIV[1] + rx * np.sin(aa) + ry * np.cos(aa)
    # воротник отклоняем назад (после подъёма головы, вокруг основания воротника)
    fp = rot_head(np.array([FPIV[0], FPIV[1], 0.0])); af = FANG * wf; rx, ry = P[:, 0] - fp[0], P[:, 1] - fp[1]
    P[:, 0], P[:, 1] = fp[0] + rx * np.cos(af) - ry * np.sin(af), fp[1] + rx * np.sin(af) + ry * np.cos(af)
    # шире череп в области глаз (расстояние между глазами): плавно растягиваем по z
    wz = sst((P[:, 0] - 38) / 8) * (1 - sst((P[:, 0] - 64) / 6)) * sst((P[:, 1] - 29) / 9)
    P[:, 2] *= 1 + float(os.environ.get('HEAD_W', '0.8')) * wz
    # боковые рожки щёк (чешуйчатые отростки по бокам головы) — маленькие, как в исходной модели: сжимаем выступ наружу
    wc = sst((P[:, 0] - 43) / 3) * (1 - sst((P[:, 0] - 56) / 4)) * sst((P[:, 1] - 26) / 5)
    zc = np.abs(P[:, 2]); ex = np.maximum(zc - 12.5, 0)
    P[:, 2] = np.sign(P[:, 2]) * (zc - ex * float(os.environ.get('CHEEK_K', '0.7')) * wc)
    # 6) длинный хвост: растягиваем назад, кончик опускаем и делаем тоньше; задние ноги не трогаем
    legm = sst((np.abs(P[:, 2]) - 7) / 3) * (1 - sst((P[:, 1] - 24) / 6)); wt = 1 - legm
    ext = np.minimum(P[:, 0] - X0, 0); P[:, 0] += ext * (KT - 1) * wt
    tl = np.clip(-(P[:, 0] - X0) / (34 * KT), 0, 1)
    P[:, 1] -= 6.0 * tl ** 1.5 * wt; P[:, 2] *= 1 - 0.25 * tl * wt
    # передние лапы прямые: в исходной позе локоть сильно вывернут наружу — прижимаем внешнюю сторону к оси ноги
    fl = (P[:, 0] > 2) & (P[:, 0] < 27) & (P[:, 2] > 17)
    bump = sst((P[:, 1] - 2) / 6) * (1 - sst((P[:, 1] - 24) / 9)) * (1 - sst((P[:, 0] - 22) / 5))
    k = 1 - float(os.environ.get('ARM_K', '0.12')) * bump
    P[fl, 2] = 17 + (P[fl, 2] - 17) * k[fl]
    # регионы: 0 кожа, 1 воротник, 2 край воротника, 3 клюв, 4 носовой рог, 5 когти
    reg = np.zeros(len(P), dtype=np.uint8); reg[frill] = 1; reg[rim] = 2; reg[beak] = 3; reg[horn] = 4
    for T0 in ((-47, 19), (18, 18), (-47, -19), (18, -18)):    # когти: кончики пальцев (передний край ступни у земли)
        near = (np.hypot(P[:, 0] - T0[0], P[:, 2] - T0[1]) < 15) & (P[:, 1] < 6)
        if not near.any(): continue
        xm = P[near, 0].max(); reg[near & (P[:, 0] > xm - 4.0) & (P[:, 1] < 4.5)] = 5
    return P, reg


def rot_head(p):
    p = np.array(p, dtype=float); w = sst((p[0] - 16) / 18) * ANG; x, y = p[0] - PIV[0], p[1] - PIV[1]
    return np.array([PIV[0] + x * np.cos(w) - y * np.sin(w), PIV[1] + x * np.sin(w) + y * np.cos(w), p[2]])


H = PP; Fh = FF
H, regH = post(H)                                            # деформируем половину (все шаги симметричны)
# зеркалим половину: точки на оси (z = 0) общие
seam = np.abs(H[:, 2]) < 1e-6; H[seam, 2] = 0; n = len(H)
mir = np.arange(n) + n; mir[seam] = np.nonzero(seam)[0]
Hm = H.copy(); Hm[:, 2] = -H[:, 2]
P = np.vstack([H, Hm]); F = np.vstack([Fh, mir[Fh][:, ::-1]]); reg = np.concatenate([regH, regH])
u2 = np.unique(F); r2 = -np.ones(len(P), dtype=np.int64); r2[u2] = np.arange(len(u2)); P = P[u2]; F = r2[F]; reg = reg[u2]
np.save(os.path.join(d, 'H.npy'), H); np.save(os.path.join(d, 'HF.npy'), Fh); np.save(os.path.join(d, 'REGH.npy'), regH)   # половина — для UV-развёртки

# ---------------------------------------------------------------- детальная сетка (для запекания чешуи): те же деформации
if os.path.exists(os.path.join(d, 'V.npy')) and os.environ.get('HI', '1') == '1':
    from scipy.spatial import cKDTree
    Vh = np.load(os.path.join(d, 'V.npy')).astype(np.float64); Fh_ = np.load(os.path.join(d, 'F.npy')).astype(np.int64); M = np.load(os.path.join(d, 'M.npy'))
    Q = pre(np.c_[Vh, np.ones(len(Vh))] @ M)
    Fh_ = Fh_[~SPIKE(Q)[Fh_].any(1)]
    Zq = Q[:, 2] - cline(Q[:, 0])
    out = {}
    for side, LOW, LOW2 in ((1, R, R2), (-1, L, L2)):
        Qs = Q.copy(); Qs[:, 2] = Zq * side
        band = (np.abs(Qs[:, 0] - XS) < BAND + 1)
        _, nn = cKDTree(LOW).query(Qs[band]); Qs[band] += (LOW2 - LOW)[nn]
        Qs, _ = post(Qs)
        out[side] = Qs
    np.save(os.path.join(d, 'hiR.npy'), out[1].astype(np.float32)); np.save(os.path.join(d, 'hiL.npy'), out[-1].astype(np.float32))
    np.save(os.path.join(d, 'hiF.npy'), Fh_.astype(np.int32))
    print('детальная сетка:', len(Q), 'вершин', len(Fh_), 'граней')
# опорные точки в позе до подъёма головы (центр глаза, основание надглазничного рога, макушка для шляп) → после подъёма
eye, brow, hat = rot_head(np.array([43.85, 26.04, 12.1])), rot_head(np.array([43.11, 30.82, 7.6])), rot_head(np.array([45.66, 34.2, 0.0]))
# глаз: центр «купола» глазного яблока исходной модели (самая выпуклая точка рядом), сам глаз ставим глубже в глазницу
EYE_XY = np.array([54.4, 41.4])            # центр собственной глазницы модели (концентрическое кольцо на боку головы), в осях игры
_m = (np.hypot(H[:, 0] - EYE_XY[0], H[:, 1] - EYE_XY[1]) < 1.2) & (H[:, 2] > 1)
if _m.any():
    _pk = H[_m][np.argmax(H[_m][:, 2])]
    # глазница: по коже вокруг глаза строим плоскость (голова в этом месте сужается вперёд и вверх), выпуклый купол глаза модели
    # вдавливаем в неглубокую ямку ниже этой плоскости; глаз (приплюснутый, смотрит по нормали плоскости) сидит в ней заподлицо
    r0 = np.hypot(H[:, 0] - _pk[0], H[:, 1] - _pk[1]); ring = (r0 > 2.6) & (r0 < 4.2) & (H[:, 2] > 1)
    cR = H[ring].mean(0); _, _, vt = np.linalg.svd(H[ring] - cR); nE = vt[2] * np.sign(vt[2][2])
    RS = float(os.environ.get('SOCKET_R', '2.2')); DEP = float(os.environ.get('EYE_IN', '1.3'))
    for Q in ((H, P) if os.environ.get('SOCKET', '1') == '1' else ()):
        side = np.where(Q[:, 2] >= 0, 1.0, -1.0); Qa = Q.copy(); Qa[:, 2] = np.abs(Qa[:, 2])
        rel = Qa - cR; h = rel @ nE; rad = np.linalg.norm(rel - np.outer(h, nE), axis=1)
        near = (rad < RS + 1.0) & (h > -DEP - 3) & (h < 6)
        lim = -DEP + np.maximum(h + DEP, 0) * sst((rad - RS) / 1.0)
        nh_ = np.minimum(h, lim); Qa[near] += np.outer(nh_ - h, nE)[near]
        Q[near] = Qa[near] * np.c_[np.ones(near.sum()), np.ones(near.sum()), side[near]]
    eyeDir = 0.5 * nE + 0.5 * np.array([0.15, 0.1, 1.0]) / np.linalg.norm([0.15, 0.1, 1.0]); eyeDir /= np.linalg.norm(eyeDir)   # взгляд — вбок и чуть вверх
    eye = cR + nE * (-DEP + 0.45) - eyeDir * 2.6 * 0.45
    print('глазница: нормаль', nE.round(2), 'глубина', DEP)
    np.save(os.path.join(d, 'H.npy'), H)

# ---------------------------------------------------------------- проверка сетки
e = np.sort(np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1)
_, cnt = np.unique(e, axis=0, return_counts=True)
print('вершин', len(P), 'граней', len(F), '| открытых рёбер', int((cnt == 1).sum()), 'неманифолдных', int((cnt > 2).sum()))
print('глаз', eye.round(2), '| x %.0f..%.0f  y %.0f..%.0f  z %.0f..%.0f' % (P[:, 0].min(), P[:, 0].max(), P[:, 1].min(), P[:, 1].max(), P[:, 2].min(), P[:, 2].max()))
np.save(os.path.join(d, 'P.npy'), P); np.save(os.path.join(d, 'PF.npy'), F); np.save(os.path.join(d, 'REG.npy'), reg)
json.dump({'eyeDir': (eyeDir if 'eyeDir' in dir() else np.array([0.12, 0.05, 1.0])).tolist(), 'eye': eye.tolist(), 'brow': brow.tolist(), 'hat': hat.tolist(), 'neck': [14, 46, 0]}, open(os.path.join(d, 'lm.json'), 'w'))

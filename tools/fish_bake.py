# Рыбы (13 видов с моделью 'fish': рифовая, барракуда, щука, ледяная, огненная и др.) → модель «Red Finned Fish» (присланный GLB: статичная, 1,3 тыс. треугольников,
# плавники — плоские пластины с вырезом по альфе; скелета и анимаций нет) → game/fish.js.
# Запуск: python3 -I tools/fish_bake.py <red_finned_fish.glb> <выход fish.js> [fin|bar]
# pk — Щука (присланный GLB «Northern Pike cartoon style», генерация Tripo: 12 кусков, 1,2 млн треугольников, без скелета): куски склеиваются, сетка
# упрощается до ~6 тыс. треугольников (несколько проходов decimate.js), цвет — в вершины из текстуры (развёртка генератора — мелкая мозаика).
# pir — Огненный пиранья (присланный GLB «Mutant Piranha»: глаз, 2 челюсти с зубами, тело — ~200 тыс. треугольников, 3 материала, карта свечения перепонок плавников):
# всё склеивается и упрощается до ~8 тыс. треугольников, цвет и свечение — в вершины (свечение перекрашено в огненно-оранжевое, «тлеет» в игре).
# puf — Рыба-шар (присланный GLB «A Spotted Pufferfish», генерация: 6 кусков, ~400 тыс. треугольников): как pk + кости грудных плавников; фугу гребут
# в основном грудными плавниками (быстрый трепет), тело почти не гнётся, хвост подруливает.
# bar — Барракуда (присланный статичный GLB, 3,9 тыс. треугольников; голова в +z файла): у глаз-шариков в файле развёртка растянута на всю текстуру
# (на глазу получалась каша из чешуи) — глаза перекрашиваются цветом вершин: чёрный зрачок, серебристо-золотая радужка, блик; тело длиннее — волна мягче у головы.
# Скелет строится здесь: корпус (корень), голова и 5 звеньев к хвосту вдоль тела; веса — по положению вдоль тела (линейно между соседними суставами).
# Анимации синтезированы как у настоящих рыб (каранговидное плавание): бегущая от головы к хвосту волна изгиба, размах растёт к хвосту, голова слегка
# «рыскает» в противофазе; idle — медленное подгребание, l0 — крейсерское плавание, l1 — быстрый рывок (частота и размах больше),
# atk — бросок (изгиб дугой и резкий удар хвостом, голова вперёд), hurt — вздрагивание (S-изгиб с затуханием). Текстура — PNG с альфой (вырез плавников в игре).
import sys, os, json, base64, struct, io, numpy as np
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)   # sRGB → линейные (материал читает текстуру без преобразования)
glbf, out = sys.argv[1:3]; KEY = sys.argv[3] if len(sys.argv) > 3 else 'fin'
d = open(glbf, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl]); off = 20 + jl; BIN = d[off + 8:off + 8 + struct.unpack('<I', d[off:off + 4])[0]]
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(BIN, dtype={5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a['componentType']], count=a['count'] * n, offset=o).reshape(a['count'], n)
nodes = J['nodes']; par_ = {}
for i, nd in enumerate(nodes):
    for c in nd.get('children', []): par_[c] = i
def world(k):
    W = np.eye(4)
    while k is not None:
        nd = nodes[k]; L = np.array(nd['matrix'], float).reshape(4, 4).T if 'matrix' in nd else np.eye(4); W = L @ W; k = par_.get(k)
    return W
mk = [k for k, nd in enumerate(nodes) if 'mesh' in nd][0]; Wm = world(mk); Rm = Wm[:3, :3] / np.linalg.norm(Wm[:3, 0])
PKCOL = None
PKEMI = None
if KEY in ('pk', 'pir', 'puf'):                                                     # склейка кусков, упрощение, цвет (и свечение) вершин из текстур
    import subprocess, tempfile
    from scipy.spatial import cKDTree
    def _img(ti):
        _im = J['images'][J['textures'][ti]['source']]; _bv = J['bufferViews'][_im['bufferView']]; return np.asarray(Image.open(io.BytesIO(BIN[_bv.get('byteOffset', 0):_bv.get('byteOffset', 0) + _bv['byteLength']])).convert('RGB'), np.float64) / 255
    def _samp(T_, uv_): return T_[np.clip((uv_[:, 1] % 1) * (T_.shape[0] - 1), 0, T_.shape[0] - 1).astype(int), np.clip((uv_[:, 0] % 1) * (T_.shape[1] - 1), 0, T_.shape[1] - 1).astype(int)]
    Ps_, Fs_, Cs_, Es_ = [], [], [], []; o_ = 0
    for k_, nd_ in enumerate(nodes):
        if 'mesh' not in nd_: continue
        pr_ = J['meshes'][nd_['mesh']]['primitives'][0]; W_ = world(k_); pp_ = acc(pr_['attributes']['POSITION']).astype(np.float64) @ W_[:3, :3].T + W_[:3, 3]; uv_ = acc(pr_['attributes']['TEXCOORD_0']).astype(np.float64)
        mt_ = J['materials'][pr_.get('material', 0)]; pb_ = mt_.get('pbrMetallicRoughness', {}); cf_ = np.array(pb_.get('baseColorFactor', [1, 1, 1, 1])[:3])
        Cs_.append(_samp(_img(pb_['baseColorTexture']['index']), uv_) * cf_ if 'baseColorTexture' in pb_ else np.tile(cf_, (len(uv_), 1)))
        Es_.append(_samp(_img(mt_['emissiveTexture']['index']), uv_) if 'emissiveTexture' in mt_ else np.zeros((len(uv_), 3)))
        Ps_.append(pp_); Fs_.append(acc(pr_['indices']).astype(np.int64).reshape(-1, 3) + o_); o_ += len(pp_)
    P0_ = np.vstack(Ps_); F0_ = np.vstack(Fs_); C0_ = np.vstack(Cs_); E0_ = np.vstack(Es_)
    q_ = np.round(P0_ / 1e-5).astype(np.int64); _, fi_, iv_ = np.unique(q_, axis=0, return_index=True, return_inverse=True); iv_ = iv_.ravel()
    Vd = P0_[fi_]; Fd = iv_[F0_]; Fd = Fd[(Fd[:, 0] != Fd[:, 1]) & (Fd[:, 1] != Fd[:, 2]) & (Fd[:, 0] != Fd[:, 2])]
    for _p in range(6):
        if len(Fd) <= (6300 if KEY == 'pk' else 7350 if KEY == 'puf' else 8400): break
        td_ = tempfile.mkdtemp(); Vd.astype(np.float32).tofile(td_ + '/V.bin'); Fd.astype(np.int32).tofile(td_ + '/F.bin')
        subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), td_ + '/V.bin', td_ + '/F.bin', td_ + '/oV.bin', td_ + '/oF.bin', '6000' if KEY == 'pk' else '7000' if KEY == 'puf' else '8000'], check=True, stdout=subprocess.DEVNULL)
        Vd = np.fromfile(td_ + '/oV.bin', np.float32).reshape(-1, 3).astype(np.float64); Fd = np.fromfile(td_ + '/oF.bin', np.int32).reshape(-1, 3).astype(np.int64)
    _, ix_ = cKDTree(P0_).query(Vd, k=10); PKCOL = C0_[ix_].mean(1); PKEMI = E0_[ix_].mean(1) if KEY == 'pir' else None
    fn_ = np.cross(Vd[Fd[:, 1]] - Vd[Fd[:, 0]], Vd[Fd[:, 2]] - Vd[Fd[:, 0]]); Nd = np.zeros_like(Vd)
    for k_ in range(3): np.add.at(Nd, Fd[:, k_], fn_)
    P = Vd; Nn = Nd / np.maximum(np.linalg.norm(Nd, axis=1, keepdims=True), 1e-9); F = Fd; UV = np.zeros((len(P), 2)); print(KEY, ': исходно', len(P0_), 'вершин →', len(P), 'вершин,', len(F), 'треугольников')
else:
    p = J['meshes'][0]['primitives'][0]; P = acc(p['attributes']['POSITION']).astype(np.float64) @ Wm[:3, :3].T + Wm[:3, 3]
    Nn = acc(p['attributes']['NORMAL']).astype(np.float64) @ Rm.T; UV = acc(p['attributes']['TEXCOORD_0']).astype(np.float64); F = acc(p['indices']).astype(np.int64).reshape(-1, 3)
# голова — в −x файла (там глаз и плотная сетка), хвостовой плавник — в +x: поворот на 180° вокруг y → голова в +x игры
G = np.array([[-1, 0, 0], [0, 1, 0], [0, 0, -1]], float) if KEY == 'fin' else np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float); V = P @ G.T; N = Nn @ G.T
V[:, 1] -= 0.5 * (V[:, 1].max() + V[:, 1].min()); V[:, 2] -= V[:, 2].mean()
xh, xt = V[:, 0].max(), V[:, 0].min(); Lb = xh - xt; H = V[:, 1].max() - V[:, 1].min(); n = len(V)
EYEV = np.zeros(n, bool); VCOL = np.full((n, 3), 255, np.uint8)
if PKCOL is not None: lin_ = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4); VCOL = np.round(np.clip(lin_(PKCOL) * 1.15, 0, 1) * 255).astype(np.uint8)
VEMI = None
if PKEMI is not None:                                                              # перепонки светятся: яркость из карты свечения, цвет — огненный
    _e = np.clip(PKEMI.max(1) * 3.0, 0, 1) ** 0.8; VEMI = np.round(_e[:, None] * np.array([255, 110, 25])).astype(np.uint8); print('светящихся вершин', int((_e > 0.15).sum()))
if KEY == 'bar':
    import scipy.sparse as sp_
    from scipy.sparse.csgraph import connected_components as cc_
    q_ = np.round(V / 1e-5).astype(np.int64); _, fi_, iv_ = np.unique(q_, axis=0, return_index=True, return_inverse=True); iv_ = iv_.ravel(); Fw_ = iv_[F]; m_ = len(fi_)
    _, lab_ = cc_(sp_.coo_matrix((np.ones(len(Fw_) * 3), (np.r_[Fw_[:, 0], Fw_[:, 1], Fw_[:, 2]], np.r_[Fw_[:, 1], Fw_[:, 2], Fw_[:, 0]])), shape=(m_, m_)), directed=False); lv_ = lab_[iv_]
    for c_ in np.unique(lv_):
        mm = lv_ == c_; ext = V[mm].max(0) - V[mm].min(0)
        if mm.sum() > 300 and ext.max() < 0.12 * Lb and np.ptp(ext) < 0.25 * ext.max():        # шар глаза
            EYEV |= mm; cen = 0.5 * (V[mm].max(0) + V[mm].min(0)); r_ = ext.max() / 2; sd = np.sign(cen[2])
            out_ = np.array([0.25, 0.1, sd]); out_ /= np.linalg.norm(out_)          # взгляд — вбок и чуть вперёд
            for i in np.where(mm)[0]:
                dv = (V[i] - cen) / r_; cth = dv @ out_
                if cth > 0.86: col = (8, 8, 10)                                              # зрачок
                elif cth > 0.6: tq = (cth - 0.6) / 0.26; col = tuple(int(a * (1 - tq) + b * tq) for a, b in zip((214, 196, 140), (150, 128, 70)))   # радужка: золото → темнее к зрачку
                elif cth > 0.45: col = (60, 58, 52)                                           # ободок
                else: col = (190, 192, 186)                                                   # склера/серебро
                VCOL[i] = col
            print('глаз: вершин', int(mm.sum()), 'центр', cen.round(3), 'радиус', round(r_, 3))

print('вершин', n, 'треугольников', len(F), 'длина', round(Lb, 3), 'высота', round(H, 3))
# скелет: 0 корпус, 1 голова, 2..6 звенья к хвосту
FR = [0.32, 0.08, 0.48, 0.62, 0.74, 0.85, 0.93] if KEY == 'fin' else [0.36, 0.1, 0.52, 0.64, 0.74, 0.82, 0.9] if KEY == 'puf' else [0.3, 0.07, 0.45, 0.58, 0.7, 0.81, 0.9]; NAMES = ['body', 'head', 's1', 's2', 's3', 's4', 's5']; PAR = [-1, 0, 0, 2, 3, 4, 5]
JX = np.array([xh - f * Lb for f in FR]); restP = np.stack([JX, np.zeros(7), np.zeros(7)], 1); NB = 7
# веса: вдоль тела — по цепочке голова → корпус → s1..s5 (линейно между соседними)
order = [1, 0, 2, 3, 4, 5, 6]; ox = JX[order]
SI = np.zeros((n, 4), np.uint8); SW = np.zeros((n, 4))
for i in range(n):
    x = V[i, 0]
    if x >= ox[0]: SI[i, 0] = order[0]; SW[i, 0] = 1; continue
    if x <= ox[-1]: SI[i, 0] = order[-1]; SW[i, 0] = 1; continue
    k = int(np.searchsorted(-ox, -x)) - 1; t = (ox[k] - x) / (ox[k] - ox[k + 1]); t = t * t * (3 - 2 * t)
    SI[i, 0] = order[k]; SW[i, 0] = 1 - t; SI[i, 1] = order[k + 1]; SW[i, 1] = t
FIN = []
if KEY == 'puf':                                                                   # грудные плавники: вершины далеко в стороны в передней половине тела
    half = np.percentile(np.abs(V[:, 2]), 97) * 0.72
    for sd in (1, -1):
        m_ = (V[:, 2] * sd > half * 0.8) & (V[:, 0] > xt + 0.4 * Lb)
        if m_.sum() < 10: continue
        root_ = np.array([V[m_, 0].mean(), V[m_, 1].mean(), sd * half * 0.8]); bi = len(PAR); PAR.append(0); restP = np.vstack([restP, root_]); NB += 1; FIN.append((bi, sd))
        w_ = np.clip((V[:, 2] * sd - half * 0.8) / (half * 0.25), 0, 1) * (V[:, 0] > xt + 0.4 * Lb)
        for i in np.where(w_ > 0)[0]: SI[i, 1] = SI[i, 0]; SW[i, 1] = SW[i, 0] * (1 - w_[i]); SI[i, 2:] = 0; SW[i, 2:] = 0; SI[i, 0] = bi; SW[i, 0] = w_[i]
        print('плавник', sd, 'вершин', int((w_ > 0).sum()), 'основание', root_.round(3))
# клипы: поворот вокруг y (вертикаль) — боковой изгиб
def aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def qm(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
Y = [0, 1, 0]; Z = [0, 0, 1]; AMP = [0.0, 0.0, 0.05, 0.09, 0.14, 0.2, 0.26] if KEY == 'fin' else [0.0, 0.0, 0.015, 0.03, 0.06, 0.12, 0.22] if KEY == 'puf' else [0.0, 0.0, 0.03, 0.06, 0.11, 0.18, 0.27]      # размах звеньев (рад): растёт к хвосту
def enc(fn, dur, loop, v=0.0, fps=30, **kw):
    nf = int(round(dur * fps)) + (0 if loop else 1); Q = np.zeros((nf, NB, 4)); Q[..., 3] = 1
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1)
        for b, q in fn(u).items(): Q[f, b] = qm(Q[f, b], q)
    r = {'dur': round(dur, 4), 'nf': nf, 'loop': loop, 'v': round(v, 4), 'q': base64.b64encode(np.round(Q * 32767).astype(np.int16).tobytes()).decode(), 'tb': {}}; r.update(kw); return r
def swim(ampK, pitch):
    def fn(u):
        a = 2 * np.pi * u; r = {j: aa(Y, ampK * AMP[j] * np.sin(a - 1.05 * (j - 1))) for j in range(2, 7)}
        r[1] = aa(Y, -ampK * 0.045 * np.sin(a + 0.6)); r[0] = qm(aa(Y, ampK * 0.02 * np.sin(a)), aa(Z, pitch * np.sin(a * 2)))
        for bi, sd in FIN: r[bi] = qm(aa(Y, sd * 0.45 * min(1.4, ampK) * np.sin(3 * a)), aa([1, 0, 0], sd * 0.3 * np.sin(3 * a + 1.2)))      # трепет грудных плавников (втрое чаще волны)
        return r
    return fn
clips = {'idle': enc(swim(0.35, 0.012), 2.2, True), 'l0': enc(swim(1.0, 0.008), 0.75, True, 1.3 * Lb), 'l1': enc(swim(1.3, 0.0), 0.42, True, 3.2 * Lb)}
ss = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
def dart(u):        # бросок: дуга (хвост в сторону), резкий удар хвостом через другую сторону, голова вперёд-вбок к цели
    c = ss(0, 0.35, u) * (1 - ss(0.35, 0.5, u)); hit = ss(0.35, 0.5, u) * (1 - ss(0.6, 1, u))
    r = {j: aa(Y, (0.12 + 0.05 * j) * c - (0.15 + 0.07 * j) * hit) for j in range(2, 7)}; r[1] = aa(Y, -0.18 * c + 0.1 * hit); return r
def jolt(u):
    e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.6
    r = {j: aa(Y, 0.25 * e * np.sin(u * 22 - j) * (j / 6)) for j in range(2, 7)}; r[1] = aa(Y, 0.12 * e * np.sin(u * 22 + 1)); r[0] = aa([1, 0, 0], 0.2 * e * np.sin(u * 15)); return r
clips['atk'] = enc(dart, 0.55, False, rate=1.0); clips['hurt'] = enc(jolt, 0.6, False, rate=1.0, span=[0.0, 1.0])
# текстура — PNG с альфой (уменьшена до 512)
if KEY in ('pk', 'pir', 'puf'): T = Image.new('RGBA', (4, 4), (255, 255, 255, 255))
else:
    im = J['images'][J['textures'][J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
    bv = J['bufferViews'][im['bufferView']]
    T = Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGBA').resize((512, 512), Image.LANCZOS)
tb_ = io.BytesIO(); (_LIN(T).save(tb_, 'PNG', optimize=True) if KEY == 'fin' else _LIN(T.convert('RGB')).save(tb_, 'JPEG', quality=86)); tex = base64.b64encode(tb_.getvalue()).decode()
if EYEV.any():                                                                     # развёртку глаз — в самую светлую точку текстуры (цвет даёт вершина)
    _ta = np.asarray(T.convert('RGB'), np.float64).mean(2); _yy, _xx = np.unravel_index(np.argmax(_ta), _ta.shape); UV[EYEV] = [(_xx + 0.5) / _ta.shape[1], (_yy + 0.5) / _ta.shape[0]]
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)), 'si': b64(SI), 'sw': b64(np.round(SW * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'vc': b64(VCOL), 'par': PAR, 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': [], 'neck': [], 'head': 1, 'jaw': 1, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(H), 4), 'tex': '' if KEY in ('pk', 'pir', 'puf') else tex, **({'vemi': b64(VEMI)} if VEMI is not None else {}), 'mime': 'image/png' if KEY == 'fin' else 'image/jpeg', **({'atest': 0.5} if KEY == 'fin' else {}), 'nativeEyes': 1}
open(out, 'w').write('// ' + {'fin': 'Рыба (Red Finned Fish', 'bar': 'Барракуда (Barracuda', 'pk': 'Щука (Northern Pike cartoon style', 'pir': 'Огненный пиранья (Mutant Piranha', 'puf': 'Рыба-шар (A Spotted Pufferfish'}[KEY] + ', статичный GLB; прислан пользователем, лицензия не указана) — скелет и анимации плавания построены tools/fish_bake.py. Не редактировать.\nexport const ' + {'fin': 'FISH', 'bar': 'BARR', 'pk': 'PIKE', 'pir': 'PIRA', 'puf': 'PUFF'}[KEY] + ' = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

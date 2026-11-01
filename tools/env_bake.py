# Растения окружения из присланных GLB → game/envm.js (ENVM: сетки + текстуры для world.js).
# Запуск: python3 -I tools/env_bake.py <папка с birch.glb oak.glb bush.glb fern.glb grass.glb snowbush.glb>
#   birch    — 4 берёзы (Birch trees): кора упрощена, листва — карточки с альфой; 3 уровня детализации (карточки прорежены и увеличены).
#   oak      — дуб (Oak tree): кора ~5.7 → 2.6 тыс. треугольников, ветви-карточки; 3 уровня.
#   bush     — куст (Bush, 129 тыс.): ветви упрощены, из 26 тыс. листьев оставлено ~1/22 (каждый увеличен) + оттенки и затенение внутри кроны.
#   fern     — папоротник (3D Fern 01, 51 тыс.): 29 вай упрощены до ~24 треугольников каждая (текстура вайи с альфой).
#   grass    — из Grass: только текстуры травинок (атлас 4 вида) — пучки травы строит игра.
#   snowbush — Snow bush (скан, 800 тыс.): снежный диск убран, ветви упрощены до ~3.5 тыс., цвет скана перенесён в цвета вершин.
# Ветер: атрибут wnd = (дрожание листа 0..1, фаза 0..1); изгиб по высоте считает шейдер.
import numpy as np, sys, os, json, base64, struct, io, subprocess, tempfile
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
SRC = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'game', 'envm.js')
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
RNG = np.random.default_rng(7)
def lin(a): return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)

class G:
    def __init__(s, f):
        d = open(f, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; s.J = json.loads(d[20:20 + jl]); off = 20 + jl
        s.B = d[off + 8:off + 8 + struct.unpack('<I', d[off:off + 4])[0]]
        s.par = {}
        for i, n in enumerate(s.J['nodes']):
            for c in n.get('children', []): s.par[c] = i
    def acc(s, i):
        a = s.J['accessors'][i]; bv = s.J['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); item = n * np.dtype(dt).itemsize; st = bv.get('byteStride') or item
        if st == item: r = np.frombuffer(s.B, dtype=dt, count=a['count'] * n, offset=o).reshape(a['count'], n)
        else: r = np.stack([np.frombuffer(s.B, dtype=dt, count=n, offset=o + k * st) for k in range(a['count'])])
        return r.astype(np.float64) if dt == np.float32 else r
    def image(s, ti):
        im = s.J['images'][s.J['textures'][ti]['source']]; bv = s.J['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
        return Image.open(io.BytesIO(s.B[o:o + bv['byteLength']]))
    def nloc(s, n):
        if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
        M = np.eye(4); x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M[:3, :3] = R * np.array(n.get('scale', [1, 1, 1]), float); M[:3, 3] = n.get('translation', [0, 0, 0]); return M
    def world(s, k):
        M = np.eye(4)
        while k is not None: M = s.nloc(s.J['nodes'][k]) @ M; k = s.par.get(k)
        return M
    def prim(s, node):                         # все примитивы узла в мировых координатах
        n = s.J['nodes'][node]; M = s.world(node); out = []
        for p in s.J['meshes'][n['mesh']]['primitives']:
            V = s.acc(p['attributes']['POSITION']); V = V @ M[:3, :3].T + M[:3, 3]
            Nn = s.acc(p['attributes']['NORMAL']) @ np.linalg.inv(M[:3, :3]).T if 'NORMAL' in p['attributes'] else np.zeros_like(V)
            Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
            UV = s.acc(p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else np.zeros((len(V), 2))
            F = s.acc(p['indices']).reshape(-1, 3).astype(np.int64)
            out.append(dict(V=V, N=Nn, UV=UV, F=F, mat=s.J['materials'][p['material']]))
        return out

def components(V, F):
    key = np.round(V / (np.abs(V).max() * 1e-6 + 1e-12)).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel(); Fw = inv[F]; n = inv.max() + 1
    nc, lab = connected_components(coo_matrix((np.ones(len(Fw) * 2), (np.r_[Fw[:, 0], Fw[:, 1]], np.r_[Fw[:, 1], Fw[:, 2]])), shape=(n, n)), directed=False)
    return lab[inv]                            # компонента каждой исходной вершины

def decimate(V, F, N, UV, tgt, lock_seams=True, extra=None):
    if len(F) <= tgt * 1.1: return V, F, N, UV, extra
    wd = tempfile.mkdtemp(); n = len(V)
    lock = np.zeros(n, np.uint8)
    if lock_seams:
        e = np.sort(np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=1); u, c = np.unique(e, axis=0, return_counts=True); b = u[c == 1]; lock[b.ravel()] = 1
    V.astype(np.float32).tofile(wd + '/V.bin'); F.astype(np.int32).tofile(wd + '/F.bin'); lock.tofile(wd + '/L.bin')
    steps = [tgt] if len(F) < 300000 else [len(F) // 6, len(F) // 20, tgt]
    for t in steps:
        subprocess.check_call(['node', os.path.join(HERE, 'decimate.js'), wd + '/V.bin', wd + '/F.bin', wd + '/OV.bin', wd + '/OF.bin', str(t)], env=dict(os.environ, DEC_LOCK=wd + '/L.bin', DEC_IDX=wd + '/I.bin'), stdout=subprocess.DEVNULL)
        oi = np.fromfile(wd + '/I.bin', np.int32); V = np.fromfile(wd + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64)
        N = N[oi]; UV = UV[oi]; lock = lock[oi]
        if extra is not None: extra = extra[oi]
        V.astype(np.float32).tofile(wd + '/V.bin'); F.astype(np.int32).tofile(wd + '/F.bin'); lock.tofile(wd + '/L.bin')
    return V, F, N, UV, extra

def smooth_normals(V, F):
    N = np.zeros_like(V); fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for k in range(3): np.add.at(N, F[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)

def thin_cards(P, keep, grow, seed=1):
    """Листва-карточки: оставить долю keep компонент, каждую увеличить вокруг её центра (площадь кроны сохраняется)."""
    V, F, N, UV, W = P['V'], P['F'], P['N'], P['UV'], P['W']
    lab = components(V, F); ids = np.unique(lab); r = np.random.default_rng(seed); sel = set(ids[r.random(len(ids)) < keep].tolist())
    fk = np.array([lab[f[0]] in sel for f in F]); F2 = F[fk]; used = np.unique(F2.ravel()); mp = -np.ones(len(V), np.int64); mp[used] = np.arange(len(used))
    V2 = V[used].copy(); l2 = lab[used]
    for c in np.unique(l2):
        m = l2 == c; ctr = V2[m].mean(0); V2[m] = ctr + (V2[m] - ctr) * grow
    return dict(V=V2, F=mp[F2], N=N[used], UV=UV[used], W=W[used], C=P['C'][used] if P.get('C') is not None else None)

def card_wind(V, F, flutter):
    lab = components(V, F); ph = np.random.default_rng(3).random(lab.max() + 1)
    return np.stack([np.full(len(V), flutter), ph[lab]], 1)

def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
def pack(P, tex, kind):
    V = P['V'].astype(np.float32); F = P['F']; N = P['N']; UV = P['UV'].astype(np.float32)
    o = dict(p=b64(V), n=b64(np.clip(np.round(N * 127), -127, 127).astype(np.int8)), uv=b64(UV), i=b64(F.astype(np.uint16 if len(V) < 65536 else np.uint32).ravel()), big=int(len(V) >= 65536),
             w=b64(np.clip(np.round(P['W'] * 255), 0, 255).astype(np.uint8)), tex=tex, k=kind, tri=int(len(F)))
    if P.get('C') is not None: o['c'] = b64(np.clip(np.round(P['C'] * 255), 0, 255).astype(np.uint8))
    return o

TEX = {}
def tex_save(name, img, size, alpha, gain=None):
    img = img.convert('RGBA' if alpha else 'RGB'); img = img.resize(size, Image.LANCZOS)
    a = np.asarray(img).astype(np.float64) / 255; a[..., :3] = lin(a[..., :3])
    if gain is not None: a[..., :3] = np.clip(a[..., :3] * np.array(gain), 0, 1)        # тёмные исходники (дуб, папоротник) — светлее и зеленее, под освещение игры
    if alpha:                                                       # цвет под прозрачными пикселями — от соседей (без тёмной каймы при фильтрации)
        from scipy.ndimage import distance_transform_edt
        m = a[..., 3] < 0.3; _, (iy, ix) = distance_transform_edt(m, return_indices=True); a[..., :3] = a[iy, ix, :3]
    im = Image.fromarray(np.round(a * 255).astype(np.uint8)); bio = io.BytesIO()
    if alpha: im.save(bio, 'WEBP', quality=88, method=6); mime = 'image/webp'
    else: im.save(bio, 'JPEG', quality=84, optimize=True); mime = 'image/jpeg'
    TEX[name] = 'data:' + mime + ';base64,' + base64.b64encode(bio.getvalue()).decode(); print('  текстура', name, size, len(bio.getvalue()) // 1024, 'КБ')

def diffuse_ti(mat):
    pb = mat.get('pbrMetallicRoughness', {}); sg = mat.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness', {})
    if 'baseColorTexture' in pb: return pb['baseColorTexture']['index']
    if 'diffuseTexture' in sg: return sg['diffuseTexture']['index']
    return None

def merge(parts):
    V, F, N, UV, W, C = [], [], [], [], [], []; o = 0
    for P in parts:
        V.append(P['V']); F.append(P['F'] + o); N.append(P['N']); UV.append(P['UV']); W.append(P['W']); C.append(P['C'] if P.get('C') is not None else np.ones((len(P['V']), 3))); o += len(P['V'])
    return dict(V=np.concatenate(V), F=np.concatenate(F), N=np.concatenate(N), UV=np.concatenate(UV), W=np.concatenate(W), C=np.concatenate(C))

def foliage_normals(P, ctr, k=0.65):
    rn = P['V'] - ctr; rn /= np.maximum(np.linalg.norm(rn, axis=1, keepdims=True), 1e-9)
    n = P['N'] * (1 - k) + rn * k; P['N'] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)

M = {}
# ------------------------------------------------------------------ берёзы
g = G(os.path.join(SRC, 'birch.glb')); print('birch')
tex_save('birch_bark', g.image(0), (128, 256), False); tex_save('birch_leaf', g.image(2), (256, 256), True)
birches = []
for grp in (3, 6, 9, 12):
    bark = g.prim(g.J['nodes'][grp]['children'][0])[0]; leaf = g.prim(g.J['nodes'][grp]['children'][1])[0]
    lowy = bark['V'][:, 1].min(); base = bark['V'][bark['V'][:, 1] < lowy + (bark['V'][:, 1].max() - lowy) * 0.03].mean(0); base[1] = lowy
    sc = 0.008                                                     # сантиметры → метры, ×0.8 (берёзы 4–12 м)
    for P in (bark, leaf): P['V'] = (P['V'] - base) * sc
    H = max(bark['V'][:, 1].max(), leaf['V'][:, 1].max())
    ctr = leaf['V'].mean(0); foliage_normals(leaf, ctr)
    leaf['W'] = card_wind(leaf['V'], leaf['F'], 1.0); leaf['C'] = None
    lods = []
    for lv, (bt, keep, grow) in enumerate([(0.55, 1.0, 1.0), (0.3, 0.7, 1.2), (0.12, 0.45, 1.5)]):
        V, F, N, UV, _ = decimate(bark['V'], bark['F'], bark['N'], bark['UV'], max(120, int(len(bark['F']) * bt)))
        b = dict(V=V, F=F, N=smooth_normals(V, F), UV=UV, W=np.zeros((len(V), 2)))
        l = thin_cards(leaf, keep, grow, 11 + lv) if keep < 1 else dict(leaf)
        lods.append([pack(b, 'birch_bark', 'bark'), pack(l, 'birch_leaf', 'leaf')])
        print('  берёза', grp, 'ур.', lv, 'кора', len(F), 'листва', len(l['F']), 'высота', round(H, 1))
    birches.append(dict(h=round(float(H), 2), lod=lods))
M['birch'] = birches
# ------------------------------------------------------------------ дуб
g = G(os.path.join(SRC, 'oak.glb')); print('oak')
# кора дуба: в исходнике размытое бурое пятно — рисуем свою бесшовную кору (глубокие продольные борозды, пластины, мох/лишайник);
# в игре она ложится трипланарно по форме ствола (envkit, kind «tri»), развёртка исходника не нужна
def oak_bark_tex(S=512):
    r = np.random.default_rng(4); y, x = np.mgrid[0:S, 0:S] / S
    def pn(fx, fy, oct_, seed):                                   # бесшовный шум из синусов с периодом 1
        rr = np.random.default_rng(seed); v = np.zeros((S, S))
        for o in range(oct_):
            for _ in range(6):
                kx, ky = rr.integers(1, 3 + o * 2) * fx * 2 ** o, rr.integers(1, 3 + o * 2) * fy * 2 ** o; ph = rr.random(2) * 6.283
                v += np.sin(2 * np.pi * (kx * x) + ph[0]) * np.sin(2 * np.pi * (ky * y) + ph[1]) / (2 ** o)
        return v / (np.abs(v).max() + 1e-9)
    warp = pn(2, 1, 3, 1) * 0.06
    fur = np.abs(np.sin(np.pi * (x * 7 + warp * 7 + pn(1, 2, 2, 2) * 0.35)))     # продольные борозды
    ridge = np.clip((fur - 0.12) / 0.88, 0, 1) ** 0.4
    plates = np.clip(0.5 + 0.5 * np.sin(2 * np.pi * (y * 7 + pn(3, 1, 2, 3) * 0.6 + np.floor(x * 7 + warp * 7) * 0.37)), 0, 1)
    h = ridge * (0.72 + 0.28 * plates) + pn(4, 8, 2, 5) * 0.06
    base = np.array([0.42, 0.32, 0.23]); dark = np.array([0.10, 0.07, 0.05]); moss = np.array([0.26, 0.32, 0.12])
    c = dark + (base - dark) * np.clip(h, 0, 1)[..., None]
    mz = np.clip(pn(3, 3, 3, 9) * 1.4 - 0.45, 0, 1)[..., None] * (1 - ridge[..., None]) * 0.45
    c = c * (1 - mz) + moss * mz + (pn(6, 6, 2, 11)[..., None] * 0.03)
    img = Image.fromarray(np.clip(np.round(np.clip(c, 0, 1) ** (1 / 2.2) * 255), 0, 255).astype(np.uint8))
    return img
tex_save('oak_bark', oak_bark_tex(), (512, 512), False)
li = g.image(2); em = np.asarray(g.image(4).convert('RGB').resize(li.size)).astype(np.float64); la = np.asarray(li.convert('RGBA')).astype(np.float64)
la[..., :3] = np.clip(la[..., :3] * 1.0 + em * 0.55, 0, 255)                # листья в исходнике тёмные: свечение-подсветка добавлено в цвет
tex_save('oak_leaf', Image.fromarray(la.astype(np.uint8)), (512, 512), True, [2.2, 3.0, 1.9])
leaf = g.prim(3)[0]; bark = g.prim(4)[0]
lowy = bark['V'][:, 1].min(); bb = bark['V'][bark['V'][:, 1] < lowy + (bark['V'][:, 1].max() - lowy) * 0.05].mean(0); bb[1] = lowy
H0 = max(bark['V'][:, 1].max(), leaf['V'][:, 1].max()) - lowy; sc = 9.0 / H0
for P in (bark, leaf): P['V'] = (P['V'] - bb) * sc
ctr = leaf['V'].mean(0); foliage_normals(leaf, ctr, 0.55); leaf['W'] = card_wind(leaf['V'], leaf['F'], 1.0); leaf['C'] = None
lods = []
for lv, (bt, keep, grow) in enumerate([(2600, 1.0, 1.0), (1300, 0.75, 1.15), (520, 0.5, 1.4)]):
    V, F, N, UV, _ = decimate(bark['V'], bark['F'], bark['N'], bark['UV'], bt)
    b = dict(V=V, F=F, N=smooth_normals(V, F), UV=UV, W=np.zeros((len(V), 2)))
    l = thin_cards(leaf, keep, grow, 21 + lv) if keep < 1 else dict(leaf)
    lods.append([pack(b, 'oak_bark', 'tri'), pack(l, 'oak_leaf', 'leaf')]); print('  дуб ур.', lv, 'кора', len(F), 'листва', len(l['F']))
M['oak'] = [dict(h=9.0, lod=lods)]
# ------------------------------------------------------------------ куст
g = G(os.path.join(SRC, 'bush.glb')); print('bush')
br = g.prim(4)[0]; lv_ = [g.prim(k)[0] for k in (5, 6, 7)]
allV = np.concatenate([br['V']] + [p['V'] for p in lv_]); lowy = allV[:, 1].min(); cx = allV[:, [0, 2]].mean(0); H0 = allV[:, 1].max() - lowy; sc = 1.7 / H0
for P in [br] + lv_: P['V'] = (P['V'] - [cx[0], lowy, cx[1]]) * sc
V, F, N, UV, _ = decimate(br['V'], br['F'], br['N'], br['UV'], 700, lock_seams=False)
bcol = np.array(br['mat']['pbrMetallicRoughness']['baseColorFactor'][:3]) * 0.9
branch = dict(V=V, F=F, N=smooth_normals(V, F), UV=np.zeros((len(V), 2)), W=np.zeros((len(V), 2)), C=np.tile(bcol, (len(V), 1)))
leafA = merge([dict(V=p['V'], F=p['F'], N=p['N'], UV=np.zeros((len(p['V']), 2)), W=np.zeros((len(p['V']), 2)), C=None) for p in lv_])
leafA['W'] = card_wind(leafA['V'], leafA['F'], 1.0)
crown = leafA['V'].mean(0); crown[1] = 1.7 * 0.5
lcol = np.array(lv_[0]['mat']['pbrMetallicRoughness']['baseColorFactor'][:3])
bl = []
for lv, (keep, grow) in enumerate([(0.07, 2.0), (0.045, 2.4)]):
    l = thin_cards(leafA, keep, grow, 31 + lv)
    lab = components(l['V'], l['F']); r = np.random.default_rng(5); shade = 0.75 + 0.5 * r.random(lab.max() + 1); hue = r.random(lab.max() + 1)
    d = np.linalg.norm((l['V'] - crown) / [0.95, 0.85, 0.95], axis=1); ao = np.clip(0.45 + 0.55 * d, 0.45, 1.0) * (0.75 + 0.25 * np.clip(l['V'][:, 1] / 1.7, 0, 1))
    tint = lcol * (1 - hue[lab][:, None] * 0.35) + np.array([0.06, 0.16, 0.02]) * hue[lab][:, None] * 0.35
    l['C'] = np.clip(tint * shade[lab][:, None] * ao[:, None] * 3.4 + np.array([0.02, 0.05, 0.0]), 0, 1); foliage_normals(l, crown, 0.7); l['UV'] = np.zeros((len(l['V']), 2))
    bl.append([pack(branch, None, 'bark'), pack(l, None, 'leaf')]); print('  куст ур.', lv, 'ветви', len(branch['F']), 'листья', len(l['F']))
M['bush'] = [dict(h=1.7, lod=bl)]
# ------------------------------------------------------------------ папоротник
g = G(os.path.join(SRC, 'fern.glb')); print('fern')
tex_save('fern_leaf', g.image(0), (256, 512), True, [1.9, 2.3, 1.6])
P = g.prim(4)[0]; lowy = P['V'][:, 1].min(); cx = P['V'][:, [0, 2]].mean(0); sc = 1.1 / (P['V'][:, 1].max() - lowy); P['V'] = (P['V'] - [cx[0], lowy, cx[1]]) * sc
lab = components(P['V'], P['F']); parts = []
for c in np.unique(lab):
    fk = lab[P['F'][:, 0]] == c; Fc = P['F'][fk]; used = np.unique(Fc.ravel()); mp = -np.ones(len(P['V']), np.int64); mp[used] = np.arange(len(used))
    V, F, N, UV, _ = decimate(P['V'][used], mp[Fc], P['N'][used], P['UV'][used], 26, lock_seams=False)
    parts.append(dict(V=V, F=F, N=N, UV=UV, W=np.stack([np.full(len(V), 0.6), np.full(len(V), RNG.random())], 1), C=None))
fern = merge(parts); fern['N'] = fern['N'] * 0.5 + np.array([0, 0.5, 0]); fern['N'] /= np.linalg.norm(fern['N'], axis=1, keepdims=True); fern['C'] = None
M['fern'] = [dict(h=1.1, lod=[[pack(fern, 'fern_leaf', 'leaf')]])]; print('  папоротник', len(fern['F']), 'треуг.')
# ------------------------------------------------------------------ травинки (атлас 4 вида: широкие зелёные, узкая, широкая, жёлтая)
g = G(os.path.join(SRC, 'grass.glb')); print('grass')
cols = [g.image(i).convert('RGBA').resize((32, 256), Image.LANCZOS) for i in (0, 8, 12, 4)]
at = Image.new('RGBA', (128, 256)); [at.paste(c, (k * 32, 0)) for k, c in enumerate(cols)]
tex_save('grass_blade', at, (128, 256), True)
# ------------------------------------------------------------------ снежный куст (скан)
g = G(os.path.join(SRC, 'snowbush.glb')); print('snowbush')
Vl, Fl, Cl = [], [], []; o = 0
for k in range(4, 18):
    for P in g.prim(k):
        tx = np.asarray(g.image(diffuse_ti(P['mat'])).convert('RGB').resize((512, 512))).astype(np.float64) / 255; th, tw = tx.shape[:2]
        uv = P['UV']; C = tx[np.clip((uv[:, 1] % 1 * th).astype(int), 0, th - 1), np.clip((uv[:, 0] % 1 * tw).astype(int), 0, tw - 1)]
        Vl.append(P['V']); Fl.append(P['F'] + o); Cl.append(C); o += len(P['V'])
V = np.concatenate(Vl); F = np.concatenate(Fl); C = np.concatenate(Cl)
key = np.round(V / 1e-4).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel(); nw = inv.max() + 1; cnt = np.bincount(inv, minlength=nw).astype(float)
Vw = np.stack([np.bincount(inv, V[:, c], nw) / cnt for c in range(3)], 1); Cw = np.stack([np.bincount(inv, C[:, c], nw) / cnt for c in range(3)], 1)
F = inv[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]; V = Vw; C = Cw
y0 = np.percentile(V[:, 1], 2); hgt = V[:, 1].max() - y0
# снежный диск: светлые и низкие треугольники (до 9 % высоты) — убрать; тёмные стволы у земли остаются
fc = V[F].mean(1); fcol = C[F].mean(1).mean(1); disc = (fc[:, 1] < y0 + hgt * 0.09) & (fcol > 0.42)
F = F[~disc]; used = np.unique(F.ravel()); mp = -np.ones(len(V), np.int64); mp[used] = np.arange(len(used)); V = V[used]; C = C[used]; F = mp[F]
lab = components(V, F); big = np.bincount(lab[F[:, 0]]); keepc = np.where(big > 40)[0]; fk = np.isin(lab[F[:, 0]], keepc); F = F[fk]   # мелкие ошмётки снега
used = np.unique(F.ravel()); mp = -np.ones(len(V), np.int64); mp[used] = np.arange(len(used)); V = V[used]; C = C[used]; F = mp[F]
stem = V[V[:, 1] < y0 + hgt * 0.12]; base = stem.mean(0) if len(stem) else V.mean(0); base[1] = V[:, 1].min()
sc = 1.5 / hgt; V = (V - base) * sc
print('  без диска:', len(F), 'треуг.')
V, F, N, UV, C = decimate(V, F, np.zeros_like(V), np.zeros((len(V), 2)), 3600, lock_seams=False, extra=C)
C = lin(np.clip(C * 1.05, 0, 1))
sb = dict(V=V, F=F, N=smooth_normals(V, F), UV=np.zeros((len(V), 2)), W=np.stack([np.zeros(len(V)), np.zeros(len(V))], 1), C=C)
M['snowbush'] = [dict(h=1.5, lod=[[pack(sb, None, 'bark')]])]; print('  снежный куст', len(F), 'треуг.')
# цвета вершин куста тоже в линейном пространстве
for lvl in M['bush'][0]['lod']:
    for part in lvl:
        if 'c' in part:
            c = np.frombuffer(base64.b64decode(part['c']), np.uint8).astype(np.float64) / 255; part['c'] = b64(np.round(lin(c) * 255).astype(np.uint8))

js = '/* Растения окружения из присланных GLB (берёзы, дуб, куст, папоротник, травинки, снежный куст). Сгенерировано tools/env_bake.py — не править вручную. */\n'
js += 'export const ENVM = ' + json.dumps(dict(tex=TEX, m=M), separators=(',', ':')) + ';\n'
open(OUT, 'w').write(js); print('записано', OUT, len(js) // 1024, 'КБ')

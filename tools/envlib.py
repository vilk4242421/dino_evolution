# Общие функции запекания моделей окружения (чтение GLB, упрощение сеток, упаковка в base64) — для env_bake2.py
import numpy as np, sys, os, json, base64, struct, io, subprocess, tempfile
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
HERE = os.path.dirname(os.path.abspath(__file__))
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
            out.append(dict(V=V, N=Nn, UV=UV, F=F, mat=s.J['materials'][p['material']], mi=p['material']))
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
    ln = np.linalg.norm(N, axis=1, keepdims=True); N = N / np.maximum(ln, 1e-12)
    N[ln[:, 0] < 1e-9 * (np.abs(fn).max() + 1e-12)] = [0, 1, 0]       # двусторонний лист после сварки: нормали сторон гасят друг друга — вверх
    return N

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
    q = float(np.abs(V).max()) / 32000 + 1e-9; qu = float(np.abs(UV).max()) / 32000 + 1e-9        # координаты и развёртка — int16 со шкалой (вдвое меньше файл)
    o = dict(p=b64(np.round(V / q).astype(np.int16)), q=q, qu=qu, n=b64(np.clip(np.round(N * 127), -127, 127).astype(np.int8)), uv=b64(np.round(UV / qu).astype(np.int16)), i=b64(F.astype(np.uint16 if len(V) < 65536 else np.uint32).ravel()), big=int(len(V) >= 65536),
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

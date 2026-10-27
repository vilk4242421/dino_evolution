# Экспорт трицератопса игры в GLB: сетка (UV), скелет и веса, PBR-текстуры (цвет, нормали, ORM), клипы анимаций.
# Нужны результаты tools/bake_trike.py / trike_uv.py (папка <dir>) и Playwright + Chromium.  Запуск: python3 tools/trike_glb.py <dir> <out.glb>
import numpy as np, sys, os, json, base64, struct, io, subprocess, time, threading, http.server, functools
from PIL import Image
from playwright.sync_api import sync_playwright

d, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
COLOR = int(os.environ.get('TRIKE_COLOR', '7d7448'), 16)       # «природный» цвет кожи для экспорта
TS = 2048
# ---------------------------------------------------------------- снимаем данные в браузере
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/tools/trike_export.html' % srv.server_address[1]
CLIPS = [('Idle', dict(speed=0, dur=8, warm=1)), ('Walk', dict(speed=0.25, cycle=1)), ('Run', dict(speed=0.75, run=1, cycle=1)),
         ('TurnLeft', dict(speed=0, w=1.2, dur=2.0)), ('TurnRight', dict(speed=0, w=-1.2, dur=2.0)),
         ('Graze', dict(speed=0, dur=5.0, warm=0, graze=1)), ('Roar', dict(speed=0, roar=1, dur=2.3, warm=1)), ('Bash', dict(speed=0, bite=1.2, dur=1.2, warm=1))]
with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader']); pg = br.new_page()
    pg.on('pageerror', lambda e: print('ERR', e))
    pg.goto(url); pg.wait_for_function("document.title=='ready'", timeout=60000)
    M = json.loads(pg.evaluate('c => exportModel(c)', COLOR))
    A = {nm: json.loads(pg.evaluate('([c, o]) => sampleClip(c, o)', [COLOR, o])) for nm, o in CLIPS}
    br.close()
srv.shutdown()
f32 = lambda s: np.frombuffer(base64.b64decode(s), np.float32)
u16 = lambda s: np.frombuffer(base64.b64decode(s), np.uint16)
u32 = lambda s: np.frombuffer(base64.b64decode(s), np.uint32)
B = M['body']; n = B['n']
pos = f32(B['pos']).reshape(-1, 3); nrm = f32(B['nrm']).reshape(-1, 3); uv = f32(B['uv']).reshape(-1, 2); col = f32(B['col']).reshape(-1, 3)
si = u16(B['si']).reshape(-1, 4); sw = f32(B['sw']).reshape(-1, 4); idx = u32(B['idx']).reshape(-1, 3)
J = M['joints']; nj = len(J)
print('сетка: %d вершин, %d треугольников, суставов %d' % (n, len(idx), nj))

# ---------------------------------------------------------------- текстуры: цвет (вершинные цвета × рельеф), нормали, ORM
det = np.asarray(Image.open(os.path.join(d, 'det.png'))).astype(np.float32)[::-1] / 255.0
nh = n // 2; F = idx[:len(idx) // 2]                           # правая половина (левая — та же развёртка, зеркально)
alb = np.zeros((TS, TS, 3), np.float32); msk = np.zeros((TS, TS), bool)
UVp = uv[:nh] * TS
for f in F:
    p_ = UVp[f]; x0, y0 = np.floor(p_.min(0)).astype(int); x1, y1 = np.ceil(p_.max(0)).astype(int)
    X, Y = np.meshgrid(np.arange(max(0, x0), min(TS, x1 + 1)) + 0.5, np.arange(max(0, y0), min(TS, y1 + 1)) + 0.5)
    a, b, c = p_; den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-12: continue
    l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den; l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den; l3 = 1 - l1 - l2
    ins = (l1 >= -1e-3) & (l2 >= -1e-3) & (l3 >= -1e-3)
    xi = X[ins].astype(int); yi = Y[ins].astype(int)
    alb[yi, xi] = col[f[0]] * l1[ins, None] + col[f[1]] * l2[ins, None] + col[f[2]] * l3[ins, None]; msk[yi, xi] = True
from scipy import ndimage
_, (iy, ix) = ndimage.distance_transform_edt(~msk, return_indices=True); alb = alb[iy, ix]
lin = np.clip(alb * (det[..., None] / 0.82), 0, 1)
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
dn = det / 0.82
orm = np.stack([np.clip(0.55 + 0.45 * dn, 0, 1), np.clip(0.86 - 0.22 * (dn - 1) * 3, 0.55, 1), np.zeros_like(dn)], 2)   # R: затенение щелей, G: шероховатость, B: металл
def png(a, srgb_=False):
    bio = io.BytesIO(); Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]).save(bio, 'PNG', optimize=True); return bio.getvalue()
def jpg(a):
    bio = io.BytesIO(); Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]).save(bio, 'JPEG', quality=92); return bio.getvalue()
tex_col = jpg(srgb); tex_orm = jpg(orm)
tex_nrm = open(os.path.join(d, 'nrm.png'), 'rb').read()
Image.open(io.BytesIO(tex_col)).resize((512, 512)).save(os.path.join(os.path.dirname(OUT) or '.', 'triceratops_albedo_preview.png'))

# ---------------------------------------------------------------- glTF
bin_ = bytearray(); views = []; accs = []
def view(data, target=None):
    while len(bin_) % 4: bin_.append(0)
    off = len(bin_); bin_.extend(data); v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def acc(arr, ctype, typ, target=None, minmax=False, norm=False):
    arr = np.ascontiguousarray(arr); vi = view(arr.tobytes(), target)
    a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
    if norm: a['normalized'] = True
    if minmax: a['min'] = arr.min(0).astype(float).tolist(); a['max'] = arr.max(0).astype(float).tolist()
    accs.append(a); return len(accs) - 1
FL, U16, U32, U8 = 5126, 5123, 5125, 5121
ARR, ELE = 34962, 34963
prims = []
prims.append({'attributes': {'POSITION': acc(pos.astype(np.float32), FL, 'VEC3', ARR, True), 'NORMAL': acc(nrm.astype(np.float32), FL, 'VEC3', ARR), 'TEXCOORD_0': acc(uv.astype(np.float32) * np.array([1, -1], np.float32) + np.array([0, 1], np.float32), FL, 'VEC2', ARR),
                              'JOINTS_0': acc(si.astype(np.uint16), U16, 'VEC4', ARR), 'WEIGHTS_0': acc((sw / np.maximum(sw.sum(1, keepdims=True), 1e-9)).astype(np.float32), FL, 'VEC4', ARR)},
              'indices': acc(idx.astype(np.uint32).reshape(-1), U32, 'SCALAR', ELE), 'material': 0})
mats = [{'name': 'Skin', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 2}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0},
         'normalTexture': {'index': 1, 'scale': 1.1}, 'occlusionTexture': {'index': 2, 'strength': 0.8}}]
ext_used = set()
for key, pr in M['parts'].items():
    pp = f32(pr['pos']).reshape(-1, 3); pn = f32(pr['nrm']).reshape(-1, 3); pc = f32(pr['col']).reshape(-1, 3); pj = u16(pr['j']); pi = u32(pr['idx'])
    jj = np.zeros((len(pj), 4), np.uint16); jj[:, 0] = pj; ww = np.zeros((len(pj), 4), np.float32); ww[:, 0] = 1
    m = {'name': {'eye': 'Eye', 'glow': 'EyeHighlight', 'acc': 'HornBone', 'lid': 'Eyelid'}[key], 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': float(min(pr.get('metal') or 0, 0.2)), 'roughnessFactor': float(pr.get('rough') if pr.get('rough') is not None else 1)}}
    if key == 'glow': m['extensions'] = {'KHR_materials_unlit': {}}; ext_used.add('KHR_materials_unlit')
    if key == 'lid': m['normalTexture'] = {'index': 1, 'scale': 0.6}
    mats.append(m)
    attrs = {'POSITION': acc(pp, FL, 'VEC3', ARR, True), 'NORMAL': acc(pn, FL, 'VEC3', ARR), 'COLOR_0': acc(pc, FL, 'VEC3', ARR), 'JOINTS_0': acc(jj, U16, 'VEC4', ARR), 'WEIGHTS_0': acc(ww, FL, 'VEC4', ARR)}
    if key == 'lid': attrs['TEXCOORD_0'] = acc(np.zeros((len(pp), 2), np.float32) + 0.5, FL, 'VEC2', ARR)
    prims.append({'attributes': attrs, 'indices': acc(pi, U32, 'SCALAR', ELE), 'material': len(mats) - 1})
# узлы: 0 Triceratops (корень, точка опоры между ступнями на земле) → 1 Body (покачивание корпуса) → 2 Frame (поворот к +Z) → 3 меш + суставы
nodes = [{'name': 'Triceratops', 'children': [1]}, {'name': 'Body', 'children': [2]},
         {'name': 'Frame', 'rotation': M['frame']['r'], 'children': [3]}, {'name': 'TriceratopsMesh', 'mesh': 0, 'skin': 0}]
J0 = len(nodes)
for j in J: nodes.append({'name': j['name'], 'translation': j['t'], 'rotation': j['r'], **({'scale': j['s']} if np.abs(np.array(j['s']) - 1).max() > 1e-6 else {})})
for k, j in enumerate(J):
    if j['parent'] >= 0: nodes[J0 + j['parent']].setdefault('children', []).append(J0 + k)
roots = [J0 + k for k, j in enumerate(J) if j['parent'] < 0]
nodes[2]['children'] += roots
ibm = acc(np.array([j['ibm'] for j in J], np.float32), FL, 'MAT4')
skins = [{'inverseBindMatrices': ibm, 'joints': [J0 + k for k in range(nj)], 'skeleton': roots[0], 'name': 'TriceratopsRig'}]
# анимации
anims = []
names_bone = [j['name'] for j in J]
for nm, a in A.items():
    N = a['n']; tt = np.arange(N, dtype=np.float32) / 30.0; tin = acc(tt, FL, 'SCALAR', None, True)
    ch, sm = [], []
    def add(node, path, vals, typ):
        sm.append({'input': tin, 'output': acc(np.asarray(vals, np.float32).reshape(N, -1), FL, typ), 'interpolation': 'LINEAR'}); ch.append({'sampler': len(sm) - 1, 'target': {'node': node, 'path': path}})
    nb = len(a['j'])
    for k in range(nb):
        r = np.asarray(a['j'][k]['r'], np.float32).reshape(N, 4)
        for i in range(1, N):      # без перескоков знака кватерниона
            if (r[i] * r[i - 1]).sum() < 0: r[i] = -r[i]
        if np.abs(r - r[0]).max() > 1e-5: add(J0 + k, 'rotation', r, 'VEC4')
        t_ = np.asarray(a['j'][k]['t'], np.float32).reshape(N, 3)
        if np.abs(t_ - t_[0]).max() > 1e-6: add(J0 + k, 'translation', t_, 'VEC3')
    for k in range(len(a['lid'])):
        r = np.asarray(a['lid'][k]['r'], np.float32).reshape(N, 4)
        if np.abs(r - r[0]).max() > 1e-5: add(J0 + nb + k, 'rotation', r, 'VEC4')
        sc_ = np.asarray(a['lid'][k]['s'], np.float32).reshape(N, 3)
        if np.abs(sc_ - sc_[0]).max() > 1e-6: add(J0 + nb + k, 'scale', sc_, 'VEC3')
    add(1, 'translation', a['body']['t'], 'VEC3'); add(1, 'rotation', a['body']['r'], 'VEC4')
    if nm.startswith('Turn'): add(0, 'rotation', a['root']['r'], 'VEC4')
    ci = names_bone.index('chest'); add(J0 + ci, 'scale', a['chest'], 'VEC3')
    anims.append({'name': nm, 'channels': ch, 'samplers': sm})
    print('клип %-9s %.2f с, %d кадров, каналов %d' % (nm, a['dur'], N, len(ch)))
imgs = []
for data, mime in ((tex_col, 'image/jpeg'), (tex_nrm, 'image/png'), (tex_orm, 'image/jpeg')):
    imgs.append({'bufferView': view(data), 'mimeType': mime})
gltf = {'asset': {'version': '2.0', 'generator': 'Dino Evolution tools/trike_glb.py'}, 'scene': 0, 'scenes': [{'name': 'Scene', 'nodes': [0]}], 'nodes': nodes,
        'meshes': [{'name': 'Triceratops', 'primitives': prims}], 'skins': skins, 'materials': mats, 'animations': anims,
        'textures': [{'source': 0, 'sampler': 0}, {'source': 1, 'sampler': 0}, {'source': 2, 'sampler': 0}], 'images': imgs,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': 0}]}
if ext_used: gltf['extensionsUsed'] = sorted(ext_used)
while len(bin_) % 4: bin_.append(0)
gltf['buffers'][0]['byteLength'] = len(bin_)
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
open(OUT, 'wb').write(glb)
print('%s: %.1f МБ' % (OUT, len(glb) / 1048576))

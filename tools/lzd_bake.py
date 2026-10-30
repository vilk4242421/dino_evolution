# Ящерка-питомец (GLB со скелетом и одним клипом) → game/lzd.js. Запуск: python3 -I tools/lzd_bake.py <Lizard.glb> <base_color.jpg> <game/lzd.js>
import json, struct, base64, sys, io, numpy as np
from PIL import Image
glb, tex, out = sys.argv[1:4]
b = open(glb, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); off = 20 + jl
bl = struct.unpack('<I', b[off:off + 4])[0]; BIN = b[off + 8:off + 8 + bl]
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride')
    if st and st != n * np.dtype(dt).itemsize:
        raw = np.frombuffer(BIN, np.uint8, count=a['count'] * st, offset=o).reshape(a['count'], st)[:, :n * np.dtype(dt).itemsize].copy()
        return raw.view(dt).reshape(a['count'], n)
    return np.frombuffer(BIN, dt, count=a['count'] * n, offset=o).reshape(a['count'], n)
b64 = lambda x: base64.b64encode(np.ascontiguousarray(x).tobytes()).decode()
p = J['meshes'][0]['primitives'][0]; at = p['attributes']
P = acc(at['POSITION']).astype(np.float32); N = acc(at['NORMAL']).astype(np.float32); UV = acc(at['TEXCOORD_0']).astype(np.float32)
SI = acc(at['JOINTS_0']).astype(np.uint8); SW = acc(at['WEIGHTS_0'])
if SW.dtype != np.float32: SW = SW.astype(np.float32) / np.iinfo(SW.dtype).max
F = acc(p['indices']).astype(np.uint16 if len(P) < 65536 else np.uint32).reshape(-1)
sk = J['skins'][0]; IBM = acc(sk['inverseBindMatrices']).astype(np.float32).reshape(-1)
nodes = [n for n in J['nodes']]; par = [-1] * len(nodes)
for i, n in enumerate(nodes):
    for c in n.get('children', []): par[c] = i
bones = [dict(n=n.get('name', 'n%d' % i), p=par[i], t=n.get('translation', [0, 0, 0]), q=n.get('rotation', [0, 0, 0, 1]), s=n.get('scale', [1, 1, 1])) for i, n in enumerate(nodes) if 'mesh' not in n and n.get('name') != 'Lizard']
ids = [i for i, n in enumerate(nodes) if 'mesh' not in n and n.get('name') != 'Lizard']; rm = {o: k for k, o in enumerate(ids)}
for k, bn in enumerate(bones): bn['p'] = rm.get(bn['p'], -1)
joints = [rm[j] for j in sk['joints']]
a = J['animations'][0]; tr = []
for c in a['channels']:
    s = a['samplers'][c['sampler']]; tr.append(dict(b=rm[c['target']['node']], p={'rotation': 'q', 'translation': 'p', 'scale': 's'}[c['target']['path']], t=b64(acc(s['input']).astype(np.float32).reshape(-1)), v=b64(acc(s['output']).astype(np.float32).reshape(-1))))
im = Image.open(tex).convert('RGB'); im.thumbnail((1024, 1024)); bf = io.BytesIO(); im.save(bf, 'JPEG', quality=84)
D = dict(n=len(P), P=b64(P), N=b64(N), UV=b64(UV), SI=b64(SI), SW=b64(SW.astype(np.float32)), F=b64(F), f32=F.dtype == np.uint32, IBM=b64(IBM), bones=bones, joints=joints, tr=tr, tex=base64.b64encode(bf.getvalue()).decode(),
         dur=float(max(np.max(acc(s['input'])) for s in a['samplers'])), bb=[P.min(0).tolist(), P.max(0).tolist()])
open(out, 'w').write('// Ящерка-питомец (присланная пользователем модель, GLB со скелетом и клипом); подготовлено tools/lzd_bake.py. Не редактировать.\nexport const LZD = ' + json.dumps(D, separators=(',', ':')) + ';\n')
print('verts', len(P), 'bones', len(bones), 'joints', len(joints), 'tracks', len(tr), 'dur', D['dur'], 'bytes', len(open(out).read()))

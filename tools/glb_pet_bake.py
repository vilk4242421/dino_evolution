# Универсальная подготовка питомца из GLB со скелетом → game/<key>.js (формат как у lzd.js/chk.js).
# Запуск: python3 -I tools/glb_pet_bake.py <model.glb> <текстура.png|jpg> <выход.js> <ИМЯ_КОНСТАНТЫ> <корневой узел-арматура> [макс.размер текстуры=1024]
# Берутся: сетка (позиции/нормали/UV/веса), поддерево скелета от корневого узла (с его собственной анимацией), IBM, каналы клипа (rotation/translation/scale), текстура → JPEG.
import json, struct, base64, sys, io, numpy as np
from PIL import Image
glb, tex, out, NAME, ROOT = sys.argv[1:6]; TS = int(sys.argv[6]) if len(sys.argv) > 6 else 1024
b = open(glb, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); off = 20 + jl
bl = struct.unpack('<I', b[off:off + 4])[0]; BIN = b[off + 8:off + 8 + bl]
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5120: np.int8, 5122: np.int16}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]; isz = np.dtype(dt).itemsize
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride')
    if st and st != n * isz:
        raw = np.frombuffer(BIN, np.uint8, count=a['count'] * st, offset=o).reshape(a['count'], st)[:, :n * isz].copy(); r = raw.view(dt).reshape(a['count'], n)
    else: r = np.frombuffer(BIN, dt, count=a['count'] * n, offset=o).reshape(a['count'], n)
    if a.get('normalized') and dt != np.float32: r = r.astype(np.float32) / np.iinfo(dt).max
    return r
b64 = lambda x: base64.b64encode(np.ascontiguousarray(x).tobytes()).decode()
N_ = J['nodes']; par = [-1] * len(N_)
for i, n in enumerate(N_):
    for c in n.get('children', []): par[c] = i
rid = [i for i, n in enumerate(N_) if n.get('name') == ROOT][0]
def sub(i): return [i] + [d for c in N_[i].get('children', []) if 'mesh' not in N_[c] for d in sub(c)]
ids = sub(rid); rm = {o: k for k, o in enumerate(ids)}
bones = [dict(n=N_[i].get('name', 'n%d' % i), p=rm.get(par[i], -1), t=N_[i].get('translation', [0, 0, 0]), q=N_[i].get('rotation', [0, 0, 0, 1]), s=N_[i].get('scale', [1, 1, 1])) for i in ids]
mn = [i for i, n in enumerate(N_) if 'mesh' in n][0]; p = J['meshes'][N_[mn]['mesh']]['primitives'][0]; at = p['attributes']
P = acc(at['POSITION']).astype(np.float32); Nn = acc(at['NORMAL']).astype(np.float32); UV = acc(at['TEXCOORD_0']).astype(np.float32)
SI = acc(at['JOINTS_0']).astype(np.uint8); SW = acc(at['WEIGHTS_0']).astype(np.float32); Fi = acc(p['indices']).reshape(-1); f32 = len(P) >= 65536; Fi = Fi.astype(np.uint32 if f32 else np.uint16)
sk = J['skins'][N_[mn]['skin']]; IBM = acc(sk['inverseBindMatrices']).astype(np.float32).reshape(-1); joints = [rm[j] for j in sk['joints']]
a = J['animations'][0]; tr = []; dur = 0
for c in a['channels']:
    if c['target']['node'] not in rm or c['target']['path'] not in ('rotation', 'translation', 'scale'): continue
    s = a['samplers'][c['sampler']]; t = acc(s['input']).astype(np.float32).reshape(-1); v = acc(s['output']).astype(np.float32).reshape(-1); dur = max(dur, float(t[-1]))
    tr.append(dict(b=rm[c['target']['node']], p={'rotation': 'q', 'translation': 'p', 'scale': 's'}[c['target']['path']], t=b64(t), v=b64(v)))
im = Image.open(tex).convert('RGB'); im.thumbnail((TS, TS)); bf = io.BytesIO(); im.save(bf, 'JPEG', quality=86)
D = dict(n=len(P), P=b64(P), N=b64(Nn), UV=b64(UV), SI=b64(SI), SW=b64(SW), F=b64(Fi), f32=bool(f32), IBM=b64(IBM), bones=bones, joints=joints, tr=tr, tex=base64.b64encode(bf.getvalue()).decode(), mime='image/jpeg', dur=dur, bb=[P.min(0).tolist(), P.max(0).tolist()])
open(out, 'w').write('// Питомец (присланная модель GLB со скелетом; автор и лицензия не указаны); подготовлено tools/glb_pet_bake.py. Не редактировать.\nexport const ' + NAME + ' = ' + json.dumps(D, separators=(',', ':')) + ';\n')
print('verts', len(P), 'tris', len(Fi) // 3, 'bones', len(bones), 'joints', len(joints), 'tracks', len(tr), 'dur', round(dur, 3), 'bytes', len(open(out).read()))

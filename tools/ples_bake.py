# Плезиозавр (Dino Crisis 2, FBX без скелета, 397 вершин) → game/ples.js. Скелет и веса — здесь: тело+шея+голова жёсткие (голова не качается),
# хвост 2 кости (волна), 4 ласта. Оси игры: x вперёд (голова), y вверх, z вбок; из FBX: (y, z, x).
# Использование: python3 -I tools/ples_bake.py <Plesiosaurus.fbx> <Textures dir> <out.js>
import sys, base64, io, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import numpy as np
from PIL import Image
from fbx_read import parse
fbx, texd, out = sys.argv[1:4]
r = parse(fbx); r = r[0] if isinstance(r, tuple) else r
O = [c for c in r.children if c.name == 'Objects'][0]; G = [o for o in O.children if o.name == 'Geometry'][0]
V0 = np.array(G.get('Vertices').props[0]).reshape(-1, 3); I = np.array(G.get('PolygonVertexIndex').props[0])
UV = np.array(G.get('LayerElementUV').get('UV').props[0]).reshape(-1, 2); UI = np.array(G.get('LayerElementUV').get('UVIndex').props[0])
MT = np.array(G.get('LayerElementMaterial').get('Materials').props[0])
V = np.stack([V0[:, 1], V0[:, 2], V0[:, 0]], 1)          # игра: x вперёд, y вверх, z вбок
vi = np.where(I < 0, ~I, I); assert len(vi) % 3 == 0
T = vi.reshape(-1, 3); pu = UV[UI]
# расщеплённые вершины: (позиция, uv, материал) — как в FBX (по углам полигонов)
nT = len(T); P = V[vi]; U = pu; MV = np.repeat(MT, 3)
# сглаженные нормали (по сварным позициям)
fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
N = np.zeros_like(V)
for k in range(3): np.add.at(N, T[:, k], fn)           # взвешено площадью
N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
# ориентация нормалей наружу: по знаку относительно центра сечения шея/тело — проверим по среднему
Nn = N[vi]
cen = np.array([100.0, 80.0, 0.0]); outw = (np.einsum('ij,ij->i', P - cen, Nn) > 0).mean(); print('нормали наружу, доля', round(outw, 3))
if outw < 0.5: T = T[:, ::-1]; Nn = -Nn; fn = -fn
# кости (игра, ед. FBX): root=0 тело/шея/голова, tail0=1, tail1=2, FR=3, FL=4, HR=5, HL=6
bone_pos = [(-40, 75, 0), (-120, 62, 0), (-190, 55, 0), (70, 32, 48), (70, 32, -48), (-100, 35, 52), (-100, 35, -52)]
par = [-1, 0, 1, 0, 0, 0, 0]
x = P[:, 0]; lat = np.abs(P[:, 2]); side = np.sign(P[:, 2] + 1e-9)
ss = lambda a, b, v: np.clip((v - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((v - a) / (b - a), 0, 1))
a = ss(-70, -150, x); b = ss(-130, -200, x)
wF = ss(52, 78, lat) * ((x > 10) & (x < 140)); wH = ss(54, 80, lat) * ((x < -50) & (x > -220))
wfl = np.maximum(wF, wH)
W = np.zeros((len(P), 7))
W[:, 0] = (1 - a); W[:, 1] = a * (1 - b); W[:, 2] = a * b
W *= (1 - wfl)[:, None]
for sgn, fi, hi in ((1, 3, 5), (-1, 4, 6)):
    m = side == sgn; W[m, fi] = wF[m]; W[m, hi] = wH[m]
W /= W.sum(1, keepdims=True)
SI = np.zeros((len(P), 4), np.uint8); SW = np.zeros((len(P), 4))
for i in range(len(P)):
    o = np.argsort(-W[i])[:4]; SI[i] = o; SW[i] = W[i][o]
SW /= SW.sum(1, keepdims=True)
# текстуры: 2 PNG 256 → лист 256×512 (материал 0 сверху, 1 снизу)
t0 = Image.open(texd + '/Plesiosaurus0.png').convert('RGB'); t1 = Image.open(texd + '/Plesiosaurus1.png').convert('RGB')
sheet = Image.new('RGB', (256, 512)); sheet.paste(t0, (0, 0)); sheet.paste(t1, (0, 256))
buf = io.BytesIO(); sheet.save(buf, 'JPEG', quality=90, subsampling=0); tex = base64.b64encode(buf.getvalue()).decode()
uvx = U[:, 0]; uvy = ((1 - U[:, 1]) * 256 + 256 * MV) / 512
# глаза (нарисованы в текстуре): вершина с UV глаза на текстуре 1 — (536,224,±16)
ev = V[[348, 164]]; print('глаза', ev.tolist())
S = 50
def b64(a): return base64.b64encode(a.tobytes()).decode()
q = np.round(P * S).astype(np.int16)
js = {'s': S, 'v': b64(q), 'n': b64(np.round(Nn * 127).astype(np.int8)), 'uv': b64(np.round(np.stack([uvx, uvy], 1) * 65535).astype(np.uint16)),
      'f': b64(np.arange(len(P), dtype=np.uint16)), 'si': b64(SI), 'sw': b64(np.round(SW * 255).astype(np.uint8)),
      'par': par, 'pos': [list(map(float, p)) for p in bone_pos], 'eyes': [[float(c) for c in e] for e in ev], 'h': float(P[:, 1].max()), 'len': float(P[:, 0].max() - P[:, 0].min()), 'x0': float(P[:, 0].min()), 'tex': tex}
open(out, 'w').write('export const PLES = ' + json.dumps(js, separators=(',', ':')) + ';\n'); print('ok', len(P), 'вершин', len(tex) // 1024, 'КБ текстура', 'габариты', P.min(0), P.max(0))

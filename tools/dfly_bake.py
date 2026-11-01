# Враг «Стрекозы» → модель Dragonfly (присланный статичный GLB: тело, глаза, ноги, щетинки, 4 крыла-пластины с прозрачной текстурой; скелета и анимаций нет) → game/dfly.js.
# Запуск: python3 -I tools/dfly_bake.py <dragonfly.glb> <выход dfly.js>
# Делает: части в оси игры (голова в +x), детальные ноги упрощаются (tools/decimate.js, атрибуты уцелевших вершин сохраняются), две текстуры — в один лист PNG
# (тело слева, крылья справа, с альфой — вырез крыльев). Скелет: грудь (корень), голова, брюшко из 3 звеньев, 4 крыла (шарнир — у средней линии спины).
# Анимации (синтез): полёт — частый трепет крыльев (передняя и задняя пара в противофазе), брюшко покачивается, тело подрагивает; idle — зависание
# (трепет чуть реже, тело плавно «дышит» вверх-вниз); hurt — вздрагивание (крылья схлопываются, брюшко дёргается). Атаки у стрекоз нет (безвредны).
import sys, os, json, base64, struct, io, subprocess, tempfile, numpy as np, scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from PIL import Image
_LIN = lambda im: (lambda a: Image.fromarray(np.concatenate([np.round(np.clip(np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4), 0, 1) * 255), np.round(a[..., 3:] * 255)], -1).astype(np.uint8), im.mode))(np.array(im).astype(np.float64) / 255)   # sRGB → линейные (материал читает текстуру без преобразования)
glbf, out = sys.argv[1:3]
d = open(glbf, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl]); off = 20 + jl; BIN = d[off + 8:off + 8 + struct.unpack('<I', d[off:off + 4])[0]]
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(BIN, dtype={5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a['componentType']], count=a['count'] * n, offset=o).reshape(a['count'], n)
def image(ti):
    im = J['images'][J['textures'][ti]['source']]; bv = J['bufferViews'][im['bufferView']]; return Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))
G = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], float)                        # голова в −z файла → +x игры
parts = []
for mi, m in enumerate(J['meshes']):
    p = m['primitives'][0]; P = acc(p['attributes']['POSITION']).astype(np.float64) @ G.T; N = acc(p['attributes']['NORMAL']).astype(np.float64) @ G.T
    UV = acc(p['attributes']['TEXCOORD_0']).astype(np.float64); F = acc(p['indices']).astype(np.int64).reshape(-1, 3); wing = J['materials'][p['material']].get('alphaMode') == 'BLEND'
    if len(F) > 3000:                                                             # ноги: сварка и сильное упрощение, цвет — ровный (средний цвет ног из текстуры)
        T0 = np.asarray(image(J['materials'][p['material']]['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB'), np.float64)
        cols = T0[np.clip((UV[:, 1] % 1) * (T0.shape[0] - 1), 0, T0.shape[0] - 1).astype(int), np.clip((UV[:, 0] % 1) * (T0.shape[1] - 1), 0, T0.shape[1] - 1).astype(int)]; mc = np.median(cols, 0)
        dd = np.linalg.norm(T0 - mc, axis=2); yy, xx = np.unravel_index(np.argmin(dd), dd.shape); uv0 = [(xx + 0.5) / T0.shape[1], (yy + 0.5) / T0.shape[0]]
        qq = np.round(P / 1e-4).astype(np.int64); _, fi, iv = np.unique(qq, axis=0, return_index=True, return_inverse=True); iv = iv.ravel(); P = P[fi]; N = N[fi]; F = iv[F]
        F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
        wd = tempfile.mkdtemp(); P.astype(np.float32).tofile(wd + '/V.bin'); F.astype(np.int32).tofile(wd + '/F.bin')
        subprocess.check_call(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), wd + '/V.bin', wd + '/F.bin', wd + '/OV.bin', wd + '/OF.bin', '1600'], env=dict(os.environ, DEC_IDX=wd + '/I.bin'), stdout=subprocess.DEVNULL)
        oi = np.fromfile(wd + '/I.bin', np.int32); P = np.fromfile(wd + '/OV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(wd + '/OF.bin', np.int32).reshape(-1, 3).astype(np.int64); N = N[oi]
        UV = np.tile(uv0, (len(P), 1))
    UV = np.stack([UV[:, 0] % 1 * 0.5 + (0.5 if wing else 0.0), UV[:, 1] % 1], 1)
    parts.append(dict(P=P, N=N, UV=UV, F=F, wing=wing and len(P) < 200 and (P[:, 2].max() - P[:, 2].min()) > 1.5, mi=mi))
    print('часть', mi, 'вершин', len(P), 'треугольников', len(F), 'крылья' if parts[-1]['wing'] else '')
V = np.vstack([q['P'] for q in parts]); N = np.vstack([q['N'] for q in parts]); UV = np.vstack([q['UV'] for q in parts])
offs = np.cumsum([0] + [len(q['P']) for q in parts]); F = np.vstack([q['F'] + offs[i] for i, q in enumerate(parts)]); n = len(V)
V[:, 1] -= 0.5 * (V[:, 1].max() + V[:, 1].min())
xh, xt = V[:, 0].max(), V[:, 0].min(); Lb = xh - xt; H = V[:, 1].max() - V[:, 1].min()
body = parts[0]; bP = body['P'] - [0, 0.5 * (np.vstack([q['P'] for q in parts])[:, 1].max() + np.vstack([q['P'] for q in parts])[:, 1].min()), 0]
def body_y(x): s_ = bP[np.abs(bP[:, 0] - x) < 0.04 * Lb]; return float(s_[:, 1].mean()) if len(s_) else 0.0
# скелет: 0 грудь, 1 голова, 2-4 брюшко, 5.. крылья
JX = [xh - 0.28 * Lb, xh - 0.06 * Lb, xh - 0.45 * Lb, xh - 0.65 * Lb, xh - 0.85 * Lb]
restP = [np.array([x, body_y(x), 0.0]) for x in JX]; PAR = [-1, 0, 0, 2, 3]
SI = np.zeros((n, 4), np.uint8); SW = np.zeros((n, 4))
order = [1, 0, 2, 3, 4]; ox = np.array([JX[k] for k in order])
for i in range(n):
    x = V[i, 0]
    if x >= ox[0]: SI[i, 0] = order[0]; SW[i, 0] = 1; continue
    if x <= ox[-1]: SI[i, 0] = order[-1]; SW[i, 0] = 1; continue
    k = int(np.searchsorted(-ox, -x)) - 1; t = (ox[k] - x) / (ox[k] - ox[k + 1]); t = t * t * (3 - 2 * t)
    SI[i, 0] = order[k]; SW[i, 0] = 1 - t; SI[i, 1] = order[k + 1]; SW[i, 1] = t
WINGS = []
for pi_, q in enumerate(parts):
    if not q['wing']: continue
    P = q['P'] - [0, 0, 0]; o0 = offs[pi_]; Fq = q['F']; nq = len(P)
    qq = np.round(P / 1e-4).astype(np.int64); _, fi, iv = np.unique(qq, axis=0, return_index=True, return_inverse=True); iv = iv.ravel(); Fw = iv[Fq]; m_ = len(fi)
    _, lab = connected_components(sp.coo_matrix((np.ones(len(Fw) * 3), (np.r_[Fw[:, 0], Fw[:, 1], Fw[:, 2]], np.r_[Fw[:, 1], Fw[:, 2], Fw[:, 0]])), shape=(m_, m_)), directed=False); lv = lab[iv]
    for c in np.unique(lv):
        mm = np.where(lv == c)[0]; W_ = V[o0 + mm]; sd = np.sign(W_[:, 2].mean()); hinge_i = mm[np.argmin(np.abs(W_[:, 2]))]
        hp = np.array([W_[:, 0].mean(), V[o0 + hinge_i, 1], 0.0]); front = W_[:, 0].mean() > np.mean(V[o0:o0 + nq, 0])
        bi = len(restP); restP.append(hp); PAR.append(0); WINGS.append((bi, sd, front))
        for v in mm: SI[o0 + v] = [bi, 0, 0, 0]; SW[o0 + v] = [1, 0, 0, 0]
        print('крыло', bi, 'сторона', int(sd), 'переднее' if front else 'заднее', 'шарнир', hp.round(2))
restP = np.array(restP); NB = len(restP)
def aa(axis, ang): axis = np.array(axis, float); axis /= np.linalg.norm(axis); return np.r_[axis * np.sin(ang / 2), np.cos(ang / 2)]
def qm(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
X = [1, 0, 0]; Y = [0, 1, 0]; Z = [0, 0, 1]
def enc(fn, dur, loop, v=0.0, fps=60, **kw):
    nf = int(round(dur * fps)) + (0 if loop else 1); Q = np.zeros((nf, NB, 4)); Q[..., 3] = 1
    for f in range(nf):
        u = f / nf if loop else f / (nf - 1)
        for b, q in fn(u).items(): Q[f, b] = qm(Q[f, b], q)
    r = {'dur': round(dur, 4), 'nf': nf, 'loop': loop, 'v': round(v, 4), 'q': base64.b64encode(np.round(Q * 32767).astype(np.int16).tobytes()).decode(), 'tb': {}}; r.update(kw); return r
def fly(beats, amp, sway):     # за цикл — beats взмахов; крыло поворачивается вокруг продольной оси у шарнира (вниз из «V» и обратно)
    def fn(u):
        a = 2 * np.pi * u; r = {}
        for bi, sd, front in WINGS: r[bi] = aa(X, sd * amp * (0.5 - 0.5 * np.cos(beats * a + (0 if front else np.pi * 0.6))) * -1.0)
        r[2] = aa(Z, sway * np.sin(a)); r[3] = aa(Z, sway * 1.4 * np.sin(a - 0.7)); r[4] = qm(aa(Z, sway * 1.8 * np.sin(a - 1.4)), aa(Y, sway * 0.8 * np.sin(a * 2)))
        r[0] = aa(X, 0.04 * np.sin(a * 2)); r[1] = aa(Y, 0.08 * np.sin(a + 1))
        return r
    return fn
clips = {'idle': enc(fly(12, 1.05, 0.05), 1.2, True), 'l0': enc(fly(14, 1.15, 0.08), 1.0, True, 1.5 * Lb), 'l1': enc(fly(14, 1.3, 0.04), 0.7, True, 4.0 * Lb)}
def jolt(u):
    e = np.sin(np.pi * min(1.0, u * 1.3)) * (1 - u) ** 0.6; r = {bi: aa(X, sd * 0.9 * e) for bi, sd, _ in WINGS}
    r[2] = aa(Z, 0.3 * e * np.sin(u * 20)); r[3] = aa(Z, 0.3 * e * np.sin(u * 20 - 1)); r[0] = aa(X, 0.3 * e * np.sin(u * 14)); return r
clips['hurt'] = enc(jolt, 0.5, False, fps=30, rate=1.0, span=[0.0, 1.0])
# лист текстур: тело слева (непрозрачно), крылья справа (с альфой)
mt0 = J['materials'][0]['pbrMetallicRoughness']; mtw = [m for m in J['materials'] if m.get('alphaMode') == 'BLEND'][0]['pbrMetallicRoughness']
tb = image(mt0['baseColorTexture']['index']).convert('RGBA').resize((256, 256), Image.LANCZOS); tw = image(mtw['baseColorTexture']['index']).convert('RGBA').resize((256, 256), Image.LANCZOS)
cf = np.array(mtw.get('baseColorFactor', [1, 1, 1, 1])); aw = np.asarray(tw).astype(np.float64); aw[..., :3] = np.clip(aw[..., :3] * cf[:3] * 1.5, 0, 255); aw[..., 3] = np.clip(aw[..., 3] * cf[3], 0, 255)
sh = Image.new('RGBA', (512, 256)); sh.paste(tb, (0, 0)); sh.paste(Image.fromarray(aw.astype(np.uint8)), (256, 0)); bf = io.BytesIO(); _LIN(sh).save(bf, 'PNG', optimize=True)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
SC = float(int(32000.0 / np.abs(V).max())); zeros = np.zeros(n, np.uint8)
R = {'s': SC, 'raw': 1, 'v': b64(np.round(V * SC).astype(np.int16)), 'n': b64(np.round(np.clip(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9), -1, 1) * 127).astype(np.int8)),
     'uv': b64(np.round(UV.clip(0, 1) * 65535).astype(np.uint16)), 'f': b64(F.astype(np.uint16)), 'si': b64(SI), 'sw': b64(np.round(SW * 255).astype(np.uint8)), 'm': b64(zeros), 'e': b64(zeros), 'k': b64(zeros),
     'vc': b64(np.full((n, 3), 255, np.uint8)), 'par': PAR, 'pos': [[round(float(c), 5) for c in p_] for p_ in restP], 'clips': clips, 'tips': [], 'neck': [], 'head': 1, 'jaw': 1, 'jsign': 1.0,
     'eyes': [[0, 0, 1], [0, 0, -1]], 'eyeR': [1, 1], 'height': round(float(H), 4), 'tex': base64.b64encode(bf.getvalue()).decode(), 'mime': 'image/png', 'atest': 0.25, 'nativeEyes': 1}
open(out, 'w').write('// Стрекоза (Dragonfly, статичный GLB; прислан пользователем, лицензия не указана) — скелет и полёт построены tools/dfly_bake.py. Не редактировать.\nexport const DFLY = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('вершин', n, 'треугольников', len(F), 'записано', out, os.path.getsize(out) // 1024, 'КБ')

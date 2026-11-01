# Медуза-питомец: статичная модель (OBJ из присланного архива: колокол с ротовыми лопастями + тонкие щупальца, текстура 2048² с альфой; скелета и анимаций нет) → game/jel.js.
# Запуск: python3 -I tools/jelly_bake.py <Jellyfish2.obj> <Jellyfish2.png> <game/jel.js> [граней_колокол=7000] [граней_щупальца=3200]
# Делает: сваривает вершины, упрощает каждую часть (tools/decimate.js), UV берёт у ближайшей исходной вершины (узор — пятна, швы незаметны), текстуру уменьшает до 512².
# Анимацию (пульсация колокола, волна по щупальцам, свечение) делает игра в шейдере (dinos.js, jellyModel).
import sys, os, json, base64, io, subprocess, tempfile, numpy as np
from scipy.spatial import cKDTree
from PIL import Image
obj, png, out = sys.argv[1:4]; TB = int(sys.argv[4]) if len(sys.argv) > 4 else 7000; TT = int(sys.argv[5]) if len(sys.argv) > 5 else 3200
V = []; VT = []; parts = {}; cur = None
for l in open(obj, 'r', errors='ignore'):
    if l.startswith('o '): cur = l.split()[1]; parts[cur] = []
    elif l.startswith('v '): V.append(l.split()[1:4])
    elif l.startswith('vt '): VT.append(l.split()[1:3])
    elif l.startswith('f '):
        c = [t.split('/') for t in l.split()[1:]]; ix = [(int(a[0]) - 1, int(a[1]) - 1 if len(a) > 1 and a[1] else -1) for a in c]
        for k in range(1, len(ix) - 1): parts[cur].append((ix[0], ix[k], ix[k + 1]))
V = np.array(V, np.float64); VT = np.array(VT, np.float64)
def bake(tris, tgt):
    vi = np.array([[a[0] for a in t] for t in tris]); ti = np.array([[a[1] for a in t] for t in tris])
    q = np.round(V / 1e-4).astype(np.int64); _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True); inv = inv.reshape(-1)
    F = inv[vi]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]; used = np.unique(F); mp = -np.ones(len(first), np.int64); mp[used] = np.arange(len(used)); P = V[first][used]; F = mp[F]
    # UV исходных углов — для поиска ближайшего
    srcP = V[vi.reshape(-1)]; srcUV = VT[ti.reshape(-1)]
    if len(F) > tgt:
        td = tempfile.mkdtemp(); P.astype(np.float32).tofile(td + '/V.bin'); F.astype(np.int32).tofile(td + '/F.bin')
        subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'decimate.js'), td + '/V.bin', td + '/F.bin', td + '/oV.bin', td + '/oF.bin', str(tgt)], check=True)
        P = np.fromfile(td + '/oV.bin', np.float32).reshape(-1, 3).astype(np.float64); F = np.fromfile(td + '/oF.bin', np.int32).reshape(-1, 3)
    _, ix = cKDTree(srcP).query(P); UV = srcUV[ix]; UV[:, 1] = 1 - UV[:, 1]
    return P, UV, F
names = list(parts); print({k: len(v) for k, v in parts.items()})
bell = [k for k in names if k.startswith('Cylinder')][0]; ten = [k for k in names if k != bell][0]
bP, bUV, bF = bake(parts[bell], TB); tP, tUV, tF = bake(parts[ten], TT)
allP = np.vstack([bP, tP]); lo = allP.min(0); hi = allP.max(0)
b64 = lambda a, t: base64.b64encode(a.astype(t).tobytes()).decode()
im = Image.open(png).convert('RGBA').resize((512, 512), Image.LANCZOS); bf = io.BytesIO(); im.save(bf, 'PNG', optimize=True)
D = dict(bell=dict(P=b64(bP, np.float32), UV=b64(bUV, np.float32), F=b64(bF.reshape(-1), np.uint16)), ten=dict(P=b64(tP, np.float32), UV=b64(tUV, np.float32), F=b64(tF.reshape(-1), np.uint16)),
         tex=base64.b64encode(bf.getvalue()).decode(), bb=[lo.round(4).tolist(), hi.round(4).tolist()])
open(out, 'w').write('// Медуза-питомец (присланная статичная модель blue-jellyfish: колокол + щупальца, текстура с альфой; автор и лицензия не указаны); подготовлено tools/jelly_bake.py. Не редактировать.\nexport const JEL = ' + json.dumps(D, separators=(',', ':')) + ';\n')
print('колокол', len(bF), 'щупальца', len(tF), 'текстура', len(bf.getvalue()), 'байт', os.path.getsize(out), 'bb', D['bb'])

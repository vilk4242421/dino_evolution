# Собирает game/trike.js из результатов tools/bake_trike.py и tools/trike_uv.py (папка <dir>).
# В файле — половина сетки (вторая получается зеркалом в игре), UV, регионы, исходные индексы вершин (для гладких нормалей
# через швы UV), карта нормалей и карта рельефа (JPEG), опорные точки (глаз, основание рога).  Запуск: python3 tools/trike_js.py <dir> [размер текстуры]
import numpy as np, base64, sys, os, json, io
from PIL import Image
d = sys.argv[1]; TS = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
U = np.load(os.path.join(d, 'UVH.npz')); P, F, UV, orig = U['P'], U['F'], U['UV'], U['orig']
reg = np.load(os.path.join(d, 'REGH.npy'))[orig]; lm = json.load(open(os.path.join(d, 'lm.json'))); RG = np.load(os.path.join(d, 'rig.npz'))
assert len(P) < 65536
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def jpg(path, q, normal=False):
    im = Image.open(path)
    if im.size[0] != TS:
        im = im.resize((TS, TS), Image.LANCZOS)
        if normal:   # после уменьшения нормали заново приводим к единичной длине
            a = np.asarray(im).astype(np.float32) / 127.5 - 1; a /= np.maximum(np.linalg.norm(a, axis=2, keepdims=True), 1e-6)
            im = Image.fromarray(np.clip((a + 1) * 127.5 + 0.5, 0, 255).astype(np.uint8))
    bio = io.BytesIO(); im.save(bio, 'JPEG', quality=q, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(bio.getvalue()).decode()


SC = 32
obj = {'s': SC, 'v': b64(np.round(P * SC).astype(np.int16)), 'uv': b64(np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)),
       'f': b64(F.astype(np.uint16)), 'o': b64(orig.astype(np.uint16)), 'r': b64(reg.astype(np.uint8)),
       'si': b64(RG['si']), 'sw': b64(RG['sw']),
       'bones': [[str(nm), int(p_), [round(float(x), 2) for x in q]] for nm, p_, q in zip(RG['names'], RG['par'], RG['pos'])],
       'lm': {k: [round(x, 2) for x in v] for k, v in lm.items()},
       'nrm': jpg(os.path.join(d, 'nrm.png'), 90, True), 'det': jpg(os.path.join(d, 'det.png'), 88)}
src = '// Модель травоядного (трицератопс): подготовлена из STL скриптами tools/bake_trike.py → tools/trike_uv.py → tools/trike_js.py. Не редактировать.\nexport const TRIKE = ' + json.dumps(obj, separators=(',', ':')) + ';\n'
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game', 'trike.js')
open(out, 'w').write(src)
print('game/trike.js: %d КБ, вершин %d, граней %d' % (len(src) // 1024, len(P), len(F)))

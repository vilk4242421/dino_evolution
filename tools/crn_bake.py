# Корона (ZBrush-скульпт, 690 тыс. вершин) → game/crn.js: вершинная кластеризация (сетка cell) в ~12 тыс. вершин, нормали берутся с оригинала,
# группы ZBrush → тип вершины: 0 пояс, 1 зубцы, 2 шары на остриях (камни). Низ короны на y = 0, ось — y.
# Запуск: python3 -I tools/crn_bake.py /путь/crown.obj game/crn.js [cell=0.02]
import numpy as np, sys, json, base64, os
src, out = sys.argv[1:3]; cell = float(sys.argv[3]) if len(sys.argv) > 3 else 0.02
V = []; F = []; G = []; cur = 0; names = {}
for l in open(src):
    if l[0] == 'v' and l[1] == ' ': V.append(l.split()[1:4])
    elif l[0] == 'g': cur = names.setdefault(l.split()[1] if len(l.split()) > 1 else '', len(names))
    elif l[0] == 'f':
        t = [int(x.split('/')[0]) - 1 for x in l.split()[1:]]
        for j in range(1, len(t) - 1): F.append([t[0], t[j], t[j + 1]]); G.append(cur)
V = np.array(V, float); F = np.array(F); G = np.array(G)
print('вершин', len(V), 'граней', len(F), names)
# тип вершины по группе: Group25 — шары на остриях, Group15/20 — зубцы, остальное — пояс
kind_of = np.zeros(len(names), int)
for k, v in names.items():
    kind_of[v] = 2 if k == 'Group25' else 1 if k in ('Group15', 'Group20') else 0
vk = np.zeros(len(V), int); vk[F.ravel()] = np.repeat(kind_of[G], 3)
# зубцы — тонкие листы: в верхней части (y > 0.2) сетка вдвое мельче, иначе листы схлопываются в «ничто» и остаются одни камни
hi = V[:, 1] > 0.2; cs = np.where(hi, cell / 2, cell)
key = np.floor(V / cs[:, None]).astype(np.int64); key -= key.min(0); dim = key.max(0) + 1
k1 = (((key[:, 0] * dim[1] + key[:, 1]) * dim[2] + key[:, 2]) * 2 + hi) * 4 + vk
u, inv = np.unique(k1, return_inverse=True); n = len(u); c = np.bincount(inv, minlength=n)
P = np.stack([np.bincount(inv, V[:, a], minlength=n) / c for a in range(3)], 1)
fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); N = np.zeros((n, 3))
for k in range(3):
    for a in range(3): N[:, a] += np.bincount(inv[F[:, k]], fn[:, a], minlength=n)
N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
ck = np.zeros(n, int); ck[inv] = vk
f2 = inv[F]; ok = (f2[:, 0] != f2[:, 1]) & (f2[:, 1] != f2[:, 2]) & (f2[:, 0] != f2[:, 2]); f2 = f2[ok]
_, ix = np.unique(np.sort(f2, axis=1), axis=0, return_index=True); f2 = f2[ix]
P[:, 1] -= P[:, 1].min()
# ось короны — в нуле (центр по x/z)
P[:, 0] -= (P[:, 0].min() + P[:, 0].max()) / 2; P[:, 2] -= (P[:, 2].min() + P[:, 2].max()) / 2
print('после кластеризации: вершин', n, 'граней', len(f2), 'габариты', P.min(0).round(3), P.max(0).round(3))
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode(); SC = 30000
R = {'s': SC, 'v': b64(np.round(P * SC).astype(np.int16)), 'n': b64(np.round(N * 127).astype(np.int8)), 'f': b64(f2.astype(np.uint16)), 'k': b64(ck.astype(np.uint8)),
     'h': round(float(P[:, 1].max()), 4), 'r': round(float(max(P[:, 0].max(), P[:, 2].max())), 4)}
open(out, 'w').write('// Корона (ZBrush-скульпт, прислан автором игры) — подготовлено tools/crn_bake.py. Не редактировать.\nexport const CRN = ' + json.dumps(R, separators=(',', ':')) + ';\n')
print('записано', out, os.path.getsize(out) // 1024, 'КБ')

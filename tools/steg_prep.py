# Стегозавр (Thingiverse «Stegosaurus II», CC0, скан игрушки): STL → ровная сетка в осях игры → упрощение.
# Запуск: python3 tools/steg_prep.py <Stegosaurus_II.stl> <рабочая папка> [граней]
# Оси игры: x вперёд (голова), y вверх, z вправо. Шаги: сварка вершин; разворот по ногам (скан стоит под углом); выпрямление хвоста
# (в скане он загнут вбок); подошвы на y=0; упрощение (tools/decimate.js).
import numpy as np, sys, os, subprocess
stl, wd = sys.argv[1], sys.argv[2]; TARGET = int(sys.argv[3]) if len(sys.argv) > 3 else 30000
os.makedirs(wd, exist_ok=True); here = os.path.dirname(os.path.abspath(__file__))
raw = open(stl, 'rb').read(); nt = int.from_bytes(raw[80:84], 'little')
dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
T = np.frombuffer(raw, dtype=dt, count=nt, offset=84)['v'].reshape(-1, 3).astype(np.float64)
key = np.round(T * 1e4).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
V = T[first]; F = inv.reshape(-1, 3)
F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
# 1) разворот вокруг вертикали (в скане вверх — z): голова к +x, ось «таз — плечи» вдоль x
ang = np.radians(162.93); c, s = np.cos(ang), np.sin(ang)
V[:, :2] -= V[:, :2].mean(0); V[:, :2] = V[:, :2] @ np.array([[c, -s], [s, c]]).T
# 2) центр туловища по y в 0 (по ногам); хвост в скане загнут вбок — разгибаем по осевой линии (поворот каждого сечения, шипы остаются шипами)
feet = V[V[:, 2] < 12]; yc = 0.5 * (feet[:, 1].max() + feet[:, 1].min()); V[:, 1] -= yc
x, y, z = V[:, 0], V[:, 1], V[:, 2]
xs = np.arange(-76, -16, 3.0); cl = []
for a in xs:
    m = (x >= a) & (x < a + 3) & (z > 28) & (z < 46)
    cl.append(np.median(y[m]) if m.sum() > 20 else np.nan)
cl = np.array(cl); ok = ~np.isnan(cl); xc = xs[ok] + 1.5
coef = np.polyfit(xc, cl[ok], 4); print('осевая хвоста (подгонка):', [(float(a), round(float(np.polyval(coef, a)), 1)) for a in (-72, -60, -48, -36, -24)])
X0 = -14.0
cle = lambda xx: np.polyval(coef, np.clip(xx, -76, X0)) * sstep(X0, -34.0, xx)
grid = np.arange(-90, X0 + 0.001, 0.25); dcl = np.gradient(cle(grid), grid); seg = np.sqrt(1 + dcl ** 2) * 0.25
arc = -(np.cumsum(seg[::-1])[::-1] - seg)          # s(x) = −длина дуги от x до X0
tail = x < X0
xt = x[tail]; c_ = cle(xt); al = np.arctan(np.interp(xt, grid, dcl)); s_ = np.interp(xt, grid, arc)
dx, dy = xt - xt, y[tail] - c_                       # смещение от осевой точки по y (по x — 0: точка на той же x)
t_s = dy * np.sin(al); t_n = dy * np.cos(al)         # (P−C)·T и (P−C)·N при P−C = (0, dy)
x[tail] = X0 + s_ + t_s; y[tail] = t_n
V[:, 0] = x; V[:, 1] = y
# 3) оси игры: x вперёд, y вверх (бывший z), z вправо (бывший -y)
G = np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1); G[:, 1] -= G[:, 1].min()
# 4) голова в скане повёрнута вбок: выпрямить (сдвиг по z = отклонение осевой линии головы)
xs = np.arange(40, 76, 4.0); cz = []
for a in xs:
    m = (G[:, 0] >= a) & (G[:, 0] < a + 4) & (G[:, 1] > 14) & (G[:, 1] < 42)
    cz.append(np.median(G[m, 2]) if m.sum() > 20 else np.nan)
cz = np.array(cz); ok = ~np.isnan(cz); print('осевая головы:', list(zip((xs[ok] + 2).round(0), cz[ok].round(1))))
G[:, 2] -= np.interp(G[:, 0], xs[ok] + 2, cz[ok], left=0.0, right=cz[ok][-1]) * sstep(40, 56, G[:, 0])
G.astype(np.float32).tofile(os.path.join(wd, 'G.bin')); F.astype(np.int32).tofile(os.path.join(wd, 'F.bin'))
subprocess.check_call(['node', os.path.join(here, 'decimate.js'), os.path.join(wd, 'G.bin'), os.path.join(wd, 'F.bin'), os.path.join(wd, 'D.bin'), os.path.join(wd, 'DF.bin'), str(TARGET)])
D = np.fromfile(os.path.join(wd, 'D.bin'), dtype=np.float32).reshape(-1, 3); DF = np.fromfile(os.path.join(wd, 'DF.bin'), dtype=np.int32).reshape(-1, 3)
print('вершин', len(D), 'граней', len(DF), 'габариты', D.min(0).round(1), D.max(0).round(1))

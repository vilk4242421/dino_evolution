# Синтез анимации крокодила (в GLB анимации нет): стойка (дыхание, покачивание хвоста, поворот головы, редкое приоткрытие пасти), шаг l0 и бег l1.
# Выполняется внутри croc_bake.py (restP, par, NB, names, find, qmat_to_q, clips, clipdict, HEAD, JAW, NECK).
def Rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def Ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def Rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def rmin(a, b):                                        # минимальный поворот, переводящий направление a в b
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); v = np.cross(a, b); c = float(np.dot(a, b))
    if c < -0.99999:
        ax = np.cross(a, [0, 1, 0]); ax = ax / np.linalg.norm(ax) if np.linalg.norm(ax) > 1e-6 else np.array([1.0, 0, 0])
        K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]]); return np.eye(3) + 2 * K @ K
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]); return np.eye(3) + K + K @ K / (1 + c)
import os
JB = float(os.environ.get('CROC_JB', '0.45'))                 # закрытая пасть: в покое модель с открытым ртом
PEL = find('bip_pelvis'); ROOT = find('def_c_root_joint'); SP = [find('bip_spine_0'), find('bip_spine_1'), find('bip_spine_2'), find('bip_spine_3')]
TAIL = [find('bip_tail_1') if False else i for i in range(NB) if names[i].startswith('bip_tail')]
TAIL = sorted(TAIL, key=lambda i: restP[i][0], reverse=True)
LIMBS = {}
for sd in ('l', 'r'):
    LIMBS['F' + sd] = dict(S=find('bip_upperarm_' + sd), E=find('bip_lowerarm_' + sd), W=find('bip_hand_' + sd), base=SP[3], duty=None)
    LIMBS['R' + sd] = dict(S=find('bip_hip_' + sd), E=find('bip_knee_' + sd), W=find('bip_foot_' + sd), base=PEL, duty=None)
def fk_pos(Dl, root_off):
    P = np.zeros((NB, 3))
    for i in range(NB):
        P[i] = (restP[i] + root_off) if par[i] < 0 else P[par[i]] + Dl[par[i]] @ (restP[i] - restP[par[i]])
    return P
def pose(u, o):
    """o: параметры. Возвращает абсолютные повороты костей (мировые оси, относительно покоя) и смещение корня."""
    two = 2 * np.pi
    D = [None] * NB; ov = {}
    bob = o['bob'] * np.sin(two * 2 * u + 0.5); rt = np.array([0.0, bob, o['sway'] * np.sin(two * u)])
    R0 = Rx(o['roll'] * np.sin(two * u + 1.0)) @ Rz(o['pitch'] * np.sin(two * 2 * u + 0.3))
    ov[PEL] = R0 @ Ry(o['yaw'] * np.sin(two * u)); acc = o['yaw'] * np.sin(two * u); loc = []
    prev = ov[PEL]
    for j, b in enumerate(SP):
        a = o['sp'] * np.sin(two * u - 0.8 * (j + 1)); loc.append(a); prev = prev @ Ry(a); ov[b] = prev
    tot = o['yaw'] * np.sin(two * u) + sum(loc)
    pv = prev
    for j, b in enumerate(NECK): pv = pv @ Ry(-0.38 * tot + o['look'] * np.sin(two * o['lf'] * u + 0.4 * j)) @ Rz(o['nod'] * np.sin(two * o['lf'] * u + 1.0)); ov[b] = pv
    ov[HEAD] = pv @ Ry(-0.25 * tot + o['look'] * np.sin(two * o['lf'] * u + 0.8)) @ Rz(o['nod'] * np.sin(two * o['lf'] * u + 1.4))
    ov[JAW] = ov[HEAD] @ Rz(JB - o['jaw'] * (0.5 - 0.5 * np.cos(two * o['jf'] * u)) ** 2)
    pv = ov[PEL]
    for j, b in enumerate(TAIL):
        pv = pv @ Ry(o['tail'] * (0.5 + j / len(TAIL)) * np.sin(two * u - 0.62 * j - 1.2) - (0.25 * o['yaw'] * np.sin(two * u) if j == 0 else 0)) @ Rz(o['tpitch'] * np.sin(two * 2 * u - 0.4 * j)); ov[b] = pv
    for i in range(NB):
        D[i] = ov[i] if i in ov else (np.eye(3) if par[i] < 0 else D[par[i]])
        if i in (0, 1, 2, ROOT) and i not in ov: D[i] = R0
    if o.get('walk'):
        P = fk_pos(D, rt)
        for name, L in LIMBS.items():
            S, E, W = L['S'], L['E'], L['W']; base = D[L['base']]; ph = o['phase'][name]; uu = (u + ph) % 1.0; duty = o['duty']; side = 1 if name[1] == 'r' else -1
            W0 = restP[W].copy()
            if uu < duty: x = W0[0] + o['S'] * (0.5 - uu / duty); y = W0[1]; z = W0[2]
            else:
                w = (uu - duty) / (1 - duty); e = 0.5 - 0.5 * np.cos(np.pi * w); x = W0[0] - o['S'] / 2 + o['S'] * e; y = W0[1] + o['lift'] * np.sin(np.pi * w) ** 1.1; z = W0[2] - side * o['inw'] * np.sin(np.pi * w)
            T = np.array([x, y, z]) + rt * np.array([0, 0, 0])
            a = np.linalg.norm(restP[E] - restP[S]); b = np.linalg.norm(restP[W] - restP[E])
            d = T - P[S]; dist = np.linalg.norm(d); dist = min(max(dist, abs(a - b) + 1e-3), a + b - 1e-3); uvec = d / np.linalg.norm(d)
            u0 = (restP[W] - restP[S]); u0 = u0 / np.linalg.norm(u0); p0 = (restP[E] - restP[S]); p0 = p0 - u0 * np.dot(p0, u0)
            p0 = base @ p0; n = p0 - uvec * np.dot(p0, uvec); n = n / np.linalg.norm(n)
            ca = (a * a + dist * dist - b * b) / (2 * a * dist); sa = np.sqrt(max(0.0, 1 - ca * ca))
            Ep = P[S] + uvec * (a * ca) + n * (a * sa); Wp = P[S] + uvec * dist
            Dpar = D[par[S]]; Dup = rmin(Dpar @ (restP[E] - restP[S]), Ep - P[S]) @ Dpar
            Dfo = rmin(Dup @ (restP[W] - restP[E]), Wp - Ep) @ Dup
            D[S] = Dup; D[E] = Dfo
            D[W] = base                                                   # кисть/стопа остаётся плоско, пальцы лежат на земле
        for i in range(NB):                                               # потомки конечностей наследуют (порядок индексов: родитель раньше)
            if i in ov: continue
            isl = any(i in (L['S'], L['E'], L['W']) for L in LIMBS.values())
            if isl: continue
            D[i] = D[par[i]] if par[i] >= 0 else D[i]
    return D, rt
def make_clip(nf, T, o, loop=True):
    Q = np.zeros((nf, NB, 4)); W0 = []
    for f in range(nf):
        D, rt = pose(f / nf, o)
        for i in range(NB):
            q = qmat_to_q(D[i] if par[i] < 0 else D[par[i]].T @ D[i])
            if f > 0 and np.dot(q, Q[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            Q[f, i] = q
        W0.append(restP[0] + rt)
    return Q, {0: W0}
IDLE = dict(bob=0.0015, sway=0.0, roll=0.006, pitch=0.006, yaw=0.03, sp=0.03, look=0.14, lf=1, nod=0.04, jaw=0.18, jf=1, tail=0.08, tpitch=0.01)
Qi, TBi = make_clip(90, 6.0, IDLE)
clips['idle'] = clipdict(Qi, TBi, 90, 6.0, True, 0.0)
GAIT = dict(bob=0.008, sway=0.01, roll=0.02, pitch=0.01, look=0.0, lf=1, nod=0.0, jaw=0.0, jf=1, tpitch=0.015, walk=True)
for nm, Sx, duty, v, ex in (('l0', 0.34, 0.64, 1.1, dict(yaw=0.09, sp=0.075, tail=0.2, lift=0.05, inw=0.02, bob=0.006)), ('l1', 0.44, 0.5, 3.2, dict(yaw=0.13, sp=0.1, tail=0.26, lift=0.075, inw=0.03, bob=0.012))):
    T = Sx / (duty * v); nf = 24 if nm == 'l0' else 20
    o = dict(GAIT); o.update(ex); o.update(S=Sx, duty=duty, phase={'Fl': 0.0, 'Rr': 0.0, 'Fr': 0.5, 'Rl': 0.5})
    Qw, TBw = make_clip(nf, T, o); clips[nm] = clipdict(Qw, TBw, nf, T, True, v); print('походка', nm, 'период', round(T, 3), 'кадров', nf, 'скорость опоры', v)

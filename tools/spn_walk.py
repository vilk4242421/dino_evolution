# Синтез походки спинозавра (в файле только один клип — рёв/стойка): две лестничные походки l0 (шаг) и l1 (бег) для tools/spn_bake.py.
# Ноги — аналитический двухзвенный IK (бедро–голень → лодыжка, плюсна задаётся углом), стопа едет назад по земле с постоянной скоростью (v = ход/(доля опоры·период)),
# в переносе — дуга. Корпус покачивается, хвост ведёт волну, шея и голова гасят качку, руки качаются в противофазе.
# Выполняется внутри spn_bake.py (использует restP, par, NB, NI, clips, clipdict, mq-функцию qmat_to_q).
def _rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def _ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def _rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def _ang(v): return float(np.arctan2(v[1], v[0]))
LEG = {'L': dict(h=NI['Bone_L.001'], k=NI['Bone_L.002'], a=NI['Bone_L.003'], b=[NI['Bone_L.004'], NI['Bone_L.006'], NI['Bone_L.008']]),
       'R': dict(h=NI['Bone_R.001'], k=NI['Bone_R.002'], a=NI['Bone_R.003'], b=[NI['Bone_R.004'], NI['Bone_R.006'], NI['Bone_R.008']])}
ARMB = {'L': (NI['Bone.001_L.001'], NI['Bone.001_L.002']), 'R': (NI['Bone.001_R.001'], NI['Bone.001_R.002'])}
TAILB = [NI['Bone_L.0%d' % i] for i in range(11, 22)]
NECKB = [NI['Bone.002'], NI['Bone.003'], NI['Bone.004'], NI['Bone.005']]
def walk_clip(T, S, duty, lift, bob, tailA, fps=30):
    nf = int(round(T * fps)); Q = np.zeros((nf, NB, 4)); W0 = []
    lg = LEG['L']; H = restP[lg['h']][:2]; L1 = np.linalg.norm(restP[lg['k']][:2] - H); L2 = np.linalg.norm(restP[lg['a']][:2] - restP[lg['k']][:2]); L3 = np.linalg.norm(restP[lg['b'][0]][:2] - restP[lg['a']][:2])
    th1r = _ang(restP[lg['k']][:2] - H); th2r = _ang(restP[lg['a']][:2] - restP[lg['k']][:2]); th3r = _ang(restP[lg['b'][0]][:2] - restP[lg['a']][:2])
    ball0 = restP[lg['b'][0]][:2].copy()
    def leg_angles(u, hy):                                   # hy — смещение таза по высоте (вверх +)
        if u < duty: x = ball0[0] + S * (0.5 - u / duty); y = ball0[1]; al = 0.0
        else:
            w = (u - duty) / (1 - duty); e = 0.5 - 0.5 * np.cos(np.pi * w)
            x = ball0[0] - S / 2 + S * e; y = ball0[1] + lift * np.sin(np.pi * w) ** 1.2; al = np.radians(-18) * np.sin(np.pi * w)
        a3 = th3r + al; ank = np.array([x, y - hy]) - L3 * np.array([np.cos(a3), np.sin(a3)])
        d = ank - H; dist = np.linalg.norm(d); dist = min(max(dist, abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3)
        phi = np.arccos(np.clip((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1)); a1 = _ang(d) + phi
        kn = H + L1 * np.array([np.cos(a1), np.sin(a1)]); a2 = _ang(ank - kn)
        return a1 - th1r, a2 - th2r, a3 - th3r
    for f in range(nf):
        u = f / nf; D = [None] * NB
        sway = np.sin(2 * np.pi * u); dbl = np.sin(4 * np.pi * u)
        hy = bob * (0.5 + 0.5 * np.cos(4 * np.pi * u + 0.4)) - bob * 0.5                         # низшая точка — в середине опоры
        Rroot = _rx(np.radians(2.5) * sway) @ _ry(np.radians(2.0) * np.cos(2 * np.pi * u))        # крен и лёгкий поворот таза
        D[0] = Rroot
        for i in range(1, NB): D[i] = D[par[i]]                                                   # по умолчанию жёстко с родителем
        for side, off in (('L', 0.0), ('R', 0.5)):
            lg = LEG[side]; a1, a2, a3 = leg_angles((u + off) % 1.0, hy)
            D[lg['h']] = Rroot @ _rz(a1); D[lg['k']] = Rroot @ _rz(a2); D[lg['a']] = Rroot @ _rz(a3)
            for b in lg['b']: D[b] = D[lg['a']]
            for c in range(NB):                                                                      # пальцы и «концы» — вслед за плюсной
                if par[c] in lg['b']: D[c] = D[par[c]]
        # торс/плечи: крутят против таза; шея гасит качку
        D[NI['Bone.001']] = Rroot @ _ry(np.radians(-3.0) * np.cos(2 * np.pi * u)) @ _rz(np.radians(1.2) * dbl)
        for side, off in (('L', 0.0), ('R', 0.5)):
            s_ = np.sin(2 * np.pi * (u + off + 0.5)); up, fo = ARMB[side]
            D[up] = D[NI['Bone.001']] @ _rz(np.radians(9) * s_); D[fo] = D[up] @ _rz(np.radians(7) * (0.5 + 0.5 * s_))
            for c in range(NB):
                if par[c] in (up,): pass
        for i, nb_ in enumerate(NECKB):
            D[nb_] = D[NI['Bone.001']] @ _rz(np.radians(-2.0 * (i + 1) / 4) * dbl) @ _ry(np.radians(4.0 * (i + 1) / 4) * np.cos(2 * np.pi * u))
        jaw = NI['Bone.007']; D[jaw] = D[NECKB[-1]] @ _rz(np.radians(21.0))      # в позе покоя пасть приоткрыта (~25°) — на ходу закрываем
        acc = 0.0
        for j, tb in enumerate(TAILB):
            acc = tailA * (0.6 + j / len(TAILB)) * np.sin(2 * np.pi * u - 0.55 * j)
            D[tb] = (Rroot if j == 0 else D[TAILB[j - 1]]) @ _ry(np.radians(acc)) @ _rz(np.radians(0.6) * np.sin(4 * np.pi * u - 0.4 * j))
        # дети костей, у которых мы задали вращение, наследуют его (кроме уже заданных)
        for i in range(1, NB):
            if par[i] >= 0 and i not in [lg_[k_] for lg_ in LEG.values() for k_ in ('h', 'k', 'a')] and i not in [b for lg_ in LEG.values() for b in lg_['b']] and i not in TAILB and i not in NECKB and i not in (NI['Bone.001'], jaw) and i not in [x for v_ in ARMB.values() for x in v_]:
                D[i] = D[par[i]]
        for i in range(NB):
            q = qmat_to_q(D[i] if par[i] < 0 else D[par[i]].T @ D[i])
            if f > 0 and np.dot(q, Q[f - 1, i]) < 0: q = -q
            elif f == 0 and q[3] < 0: q = -q
            Q[f, i] = q
        W0.append(np.array([restP[0][0], restP[0][1] + hy, restP[0][2] + 5.0 * sway]))
    return Q, {0: W0}, nf, T, S / (duty * T)
for nm, args in (('l0', (1.5, 230.0, 0.62, 55.0, 6.0, 7.0)), ('l1', (0.78, 330.0, 0.46, 90.0, 11.0, 10.0))):
    Qw, TBw, nfw, Tw, vw = walk_clip(*args)
    clips[nm] = clipdict(Qw, TBw, nfw, Tw, True, vw); print('походка', nm, 'кадров', nfw, 'период', Tw, 'скорость опоры', round(vw, 1))

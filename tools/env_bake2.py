# Вторая партия моделей окружения (присланные GLB) → game/envm2.js (ENVM2, подмешивается к ENVM в envkit.js).
# Запуск: python3 -I tools/env_bake2.py <папка с crystal1.glb crystal2.glb stone.glb cattail.glb willow.glb mangrove.glb tumbleweed.glb
#         barrel.glb saguaro.glb agave.glb rhodo.glb gentian.glb mpine.glb snowdrop.glb juniper.glb snowtree.glb bluebell.glb daisy.glb>
# Каждый материал модели обрабатывается по правилу:
#   col  — текстура/цвет переносится в цвета вершин (сетка сваривается и упрощается) — мелкие и однотонные части;
#   tex  — текстура сохраняется (сетка упрощается с сохранением швов развёртки);
#   leaf — листва-карточки с прозрачностью (прореживаются на дальних уровнях, дрожат на ветру);
#   glow — текстура + свечение (кристаллы);  drop — выбросить (мелкие колючки, пух — в игре не видны, а треугольников много).
import sys, os, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from envlib import *
import envlib
SRC = sys.argv[1]; OUT = os.path.join(HERE, '..', 'game', 'envm2.js')

def tex_of(g, mat):
    ti = diffuse_ti(mat)
    return None if ti is None else ti

def mat_color(mat):
    pb = mat.get('pbrMetallicRoughness', {}); sg = mat.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness', {})
    c = pb.get('baseColorFactor') or sg.get('diffuseFactor') or [1, 1, 1, 1]
    return np.array(c[:3], float)                                   # уже линейный

IMC = {}
def tex_arr(g, ti, size=512):
    k = (id(g), ti)
    if k not in IMC: IMC[k] = lin(np.asarray(g.image(ti).convert('RGB').resize((size, size), Image.LANCZOS)).astype(np.float64) / 255)
    return IMC[k]

def sample(g, ti, UV):
    tx = tex_arr(g, ti); th, tw = tx.shape[:2]
    return tx[np.clip((UV[:, 1] % 1 * th).astype(int), 0, th - 1), np.clip((UV[:, 0] % 1 * tw).astype(int), 0, tw - 1)]

def weld(V, F, C):
    key = np.round(V / (np.abs(V).max() * 2e-5 + 1e-12)).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel(); nw = inv.max() + 1; cnt = np.bincount(inv, minlength=nw).astype(float)
    Vw = np.stack([np.bincount(inv, V[:, c], nw) / cnt for c in range(3)], 1); Cw = np.stack([np.bincount(inv, C[:, c], nw) / cnt for c in range(3)], 1)
    F = inv[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return Vw, F, Cw

def compact(V, F, *extra):
    used = np.unique(F.ravel()); mp = -np.ones(len(V), np.int64); mp[used] = np.arange(len(used))
    return (V[used], mp[F]) + tuple(e[used] if e is not None else None for e in extra)

def cat(ps):
    o = 0; V, F, N, UV, C = [], [], [], [], []
    for P in ps:
        V.append(P['V']); F.append(P['F'] + o); N.append(P['N']); UV.append(P['UV']); C.append(P['C'] if P.get('C') is not None else np.ones((len(P['V']), 3))); o += len(P['V'])
    return dict(V=np.concatenate(V), F=np.concatenate(F), N=np.concatenate(N), UV=np.concatenate(UV), C=np.concatenate(C))

def dec(P, tgt, seams):
    V, F, N, UV, C = decimate(P['V'], P['F'], P['N'], P['UV'], tgt, lock_seams=seams, extra=P.get('C'))
    if seams and len(F) > tgt * 1.6:                               # развёртка мелко порезана — швы не держим, иначе упрощение встаёт
        V, F, N, UV, C = decimate(P['V'], P['F'], P['N'], P['UV'], tgt, lock_seams=False, extra=P.get('C'))
    if not seams and C is not None and len(F) > tgt * 1.5:          # упрощение встало (тонкие корни, много отдельных кусков) — кластеризация вершин по сетке
        ext = np.ptp(V, 0).max(); cell = ext / 400
        for _ in range(30):
            k = np.floor(V / cell).astype(np.int64); _, inv = np.unique(k, axis=0, return_inverse=True); inv = inv.ravel(); n = inv.max() + 1; cnt = np.bincount(inv, minlength=n).astype(float)
            V2 = np.stack([np.bincount(inv, V[:, c], n) / cnt for c in range(3)], 1); C2 = np.stack([np.bincount(inv, C[:, c], n) / cnt for c in range(3)], 1)
            F2 = inv[F]; F2 = F2[(F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])]
            F2 = F2[np.sort(np.unique(np.sort(F2, 1), axis=0, return_index=True)[1])]
            if len(F2) <= tgt * 1.15: break
            cell *= 1.25
        V, F, C = V2, F2, C2; V, F, C = compact(V, F, C); UV = np.zeros((len(V), 2)); print('     кластеризация:', len(F))
    return dict(V=V, F=F, N=smooth_normals(V, F), UV=UV, C=C)

M = {}; TEXN = {}
def bake(name, file, H, rules, lods, texsz=512, rot=None, gain=None, keep=None, fl=1.0, base='bbox', unit=False, meshes=None, split=False, color=None, width=None, thin=None, cut=0, bodies=None, _sel=None, kc=0):
    if bodies is not None and _sel is None:
        g = G(os.path.join(SRC, file + '.glb')); sk = [P for ni, n in enumerate(g.J['nodes']) if 'mesh' in n for P in g.prim(ni) if P['mi'] == bodies][0]
        lab = components(sk['V'], sk['F']); big = [c for c in np.unique(lab) if (lab == c).sum() > len(lab) * 0.05]
        ctr = np.array([sk['V'][lab == c].mean(0) for c in big]); print('  тел:', len(ctr))
        for i in range(1, min(4, len(ctr))): bake(name, file, H, rules, lods, texsz, rot, gain, keep, fl, base, unit, meshes, False, color, width, thin, cut, bodies, (ctr, i))
        return
    if split:                                                      # каждая сетка — свой вариант (разные кораллы/камни из одного файла)
        g = G(os.path.join(SRC, file + '.glb')); ids = [n['mesh'] for n in g.J['nodes'] if 'mesh' in n]
        for i in (meshes or ids): bake(name, file, H, rules, lods, texsz, rot, gain, keep, fl, base, unit, [i], False, color, width, thin, cut, kc=kc)
        return
    """rules: {индекс материала: 'col'|'tex'|'leaf'|'glow'|'drop'} (по умолчанию rules['*']); lods: бюджеты треугольников сплошных частей по уровням;
       keep: [(доля, рост)] прореживания карточек листвы по уровням."""
    g = G(os.path.join(SRC, file + '.glb')); print(name, '←', file)
    prims = []
    for ni, n in enumerate(g.J['nodes']):
        if 'mesh' in n and (meshes is None or n['mesh'] in meshes):
            for P in g.prim(ni):
                r = rules.get(P['mi'], rules.get('*', 'col'))
                if r == 'drop': continue
                if _sel is not None:                               # оставить детали, ближайшие к телу № _sel[1]
                    lab = components(P['V'], P['F']); nl = lab.max() + 1; cnt = np.bincount(lab, minlength=nl).astype(float)
                    cc = np.stack([np.bincount(lab, P['V'][:, k], nl) / np.maximum(cnt, 1) for k in range(3)], 1)
                    near = np.argmin(((cc[:, None, :] - _sel[0][None]) ** 2).sum(-1), 1) == _sel[1]
                    P['F'] = P['F'][near[lab[P['F'][:, 0]]]]
                    if not len(P['F']): continue
                    P['V'], P['F'], P['N'], P['UV'] = compact(P['V'], P['F'], P['N'], P['UV'])
                if thin and P['mi'] in thin:                       # много мелких одинаковых деталей (иглы ежа) — оставить долю
                    lab = components(P['V'], P['F']); ids_ = np.unique(lab); sel = np.random.default_rng(5).random(ids_.max() + 1) < thin[P['mi']]
                    P['F'] = P['F'][sel[lab[P['F'][:, 0]]]]; P['V'], P['F'], P['N'], P['UV'] = compact(P['V'], P['F'], P['N'], P['UV'])
                P['rule'] = r; prims.append(P)
    if rot is not None:
        for P in prims: P['V'] = P['V'] @ np.array(rot).T; P['N'] = P['N'] @ np.array(rot).T
    if kc:                                                         # в сетке несколько отдельных кустиков — взять самый крупный (k-средних по центрам граней)
        Va = np.concatenate([P['V'] for P in prims]); r_ = np.random.default_rng(2); C0 = Va[r_.choice(len(Va), kc, replace=False)][:, [0, 2]]
        for _ in range(20):
            fc = [P['V'][P['F']].mean(1)[:, [0, 2]] for P in prims]; allc = np.concatenate(fc)
            lb = np.argmin(((allc[:, None] - C0[None]) ** 2).sum(-1), 1); C0 = np.array([allc[lb == k].mean(0) if (lb == k).any() else C0[k] for k in range(kc)])
        best = np.bincount(lb, minlength=kc).argmax()
        for P, f in zip(prims, fc):
            P['F'] = P['F'][np.argmin(((f[:, None] - C0[None]) ** 2).sum(-1), 1) == best]; P['V'], P['F'], P['N'], P['UV'] = compact(P['V'], P['F'], P['N'], P['UV'])
        prims = [P for P in prims if len(P['F'])]
    allV = np.concatenate([P['V'] for P in prims]); lo = allV.min(0); hi = allV.max(0)
    if cut:                                                        # подставка скана (кусок земли под агавой) — срезать всё ниже доли cut высоты
        yc = lo[1] + (hi[1] - lo[1]) * cut
        for P in prims:
            P['F'] = P['F'][P['V'][P['F']].mean(1)[:, 1] > yc]; P['V'], P['F'], P['N'], P['UV'] = compact(P['V'], P['F'], P['N'], P['UV'])
        prims = [P for P in prims if len(P['F'])]; allV = np.concatenate([P['V'] for P in prims]); lo = allV.min(0); hi = allV.max(0)
    if unit:                                                       # камень: центр в нуле, «радиус» 1 (как процедурные камни)
        c = (lo + hi) / 2; sc = 2.0 / max(hi[0] - lo[0], hi[2] - lo[2]); off = np.array([c[0], lo[1] + (hi[1] - lo[1]) * 0.32, c[2]])
    else:
        ylo = lo[1]; hgt = hi[1] - ylo
        if base == 'trunk':
            st = allV[allV[:, 1] < ylo + hgt * 0.04]; cx, cz = st[:, 0].mean(), st[:, 2].mean()
        else: cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
        sc = H / hgt if not width else width / max(hi[0] - lo[0], hi[2] - lo[2]); off = np.array([cx, ylo, cz])
    for P in prims: P['V'] = (P['V'] - off) * sc
    Hn = float(max(P['V'][:, 1].max() for P in prims))
    # группы: все col — одна часть без текстуры; остальные — по текстуре
    groups = {}
    for P in prims:
        r = P['rule']; ti = tex_of(g, P['mat'])
        if color and P['mi'] in color: P['mat'] = dict(P['mat'], pbrMetallicRoughness=dict(baseColorFactor=color[P['mi']] + [1])); ti = None
        if r == 'leafc':                                           # листва без текстуры (ива) — цвет материала в вершинах
            P['C'] = np.tile(mat_color(P['mat']), (len(P['V']), 1)); groups.setdefault(('leaf', None), []).append(P); continue
        if r == 'col':
            C = sample(g, ti, P['UV']) * mat_color(P['mat']) if ti is not None else np.tile(mat_color(P['mat']), (len(P['V']), 1))
            if gain: C = C * np.array(gain)
            P['C'] = C; groups.setdefault(('col', None), []).append(P)
        else:
            groups.setdefault((r, ti), []).append(P)
    alpha_ti = {ti for (r, ti) in groups if r == 'leaf'}
    parts_by_tex = {}
    for (r, ti), ps in groups.items():
        tn = None
        if ti is not None and r != 'col':
            tn = file + '_' + str(ti)
            if tn not in TEXN:
                im = g.image(ti); gn = None
                fac = mat_color(ps[0]['mat'])
                if (fac < 0.99).any(): gn = list(fac)
                if gain: gn = list(np.array(gn or [1, 1, 1]) * np.array(gain))
                tex_save(tn, im, (texsz, texsz), ti in alpha_ti, gn); TEXN[tn] = 1
        P = cat(ps)
        if r == 'tex' and ti is None: P['C'] = np.ones((len(P['V']), 3))
        if r == 'col' or (r == 'tex' and ti is None): P['V'], P['F'], P['C'] = weld(P['V'], P['F'], P['C']); P['V'], P['F'], P['C'] = compact(P['V'], P['F'], P['C']); P['N'] = smooth_normals(P['V'], P['F']); P['UV'] = np.zeros((len(P['V']), 2))
        parts_by_tex[(r, ti)] = (P, tn)
    out = []
    for lv in range(len(lods)):
        lvl = {}
        for (r, ti), (P, tn) in parts_by_tex.items():
            if r == 'leaf':
                P2 = dict(P); P2['W'] = card_wind(P['V'], P['F'], fl)
                kp, gr = (keep or [(1, 1)] * len(lods))[lv]
                L = thin_cards(P2, kp, gr, 41 + lv) if kp < 1 else P2
                L = dict(L); ctr = L['V'].mean(0); foliage_normals(L, ctr, 0.5)
                if r == 'leaf' and P.get('C') is not None and (P['C'] == 1).all(): L['C'] = None
                kind = 'leaf'
            else:
                L = dec(P, lods[lv], r != 'col' and ti is not None); L['W'] = np.zeros((len(L['V']), 2))
                if r != 'col': L['C'] = None
                else: L['C'] = np.clip(L['C'], 0, 1)
                kind = 'glow' if r == 'glow' else 'bark'
            L['C'] = L.get('C')
            lvl[(r, ti)] = (L, tn, kind)
        # сплошная часть и листва с одной текстурой — одной сеткой (меньше вызовов отрисовки)
        merged = {}
        for (r, ti), (L, tn, kind) in lvl.items():
            k = tn or ('col' + r)
            if k in merged:
                A, _, kd = merged[k]; L2 = dict(L)
                if L2.get('C') is None and A.get('C') is None: C = None
                else: C = np.concatenate([A['C'] if A.get('C') is not None else np.ones((len(A['V']), 3)), L2['C'] if L2.get('C') is not None else np.ones((len(L2['V']), 3))])
                M2 = dict(V=np.concatenate([A['V'], L2['V']]), F=np.concatenate([A['F'], L2['F'] + len(A['V'])]), N=np.concatenate([A['N'], L2['N']]), UV=np.concatenate([A['UV'], L2['UV']]), W=np.concatenate([A['W'], L2['W']]), C=C)
                merged[k] = (M2, tn, 'leaf' if 'leaf' in (kd, kind) else kd)
            else: merged[k] = (L, tn, kind)
        pk = []
        for k, (L, tn, kind) in merged.items():
            prev = [(pl, pi) for pl in range(len(out)) for pi, q in enumerate(out[pl]) if 'p' in q and q['tri'] == len(L['F']) and q.get('tex') == tn and q['k'] == kind]
            if prev: pk.append(dict(ref=list(prev[0]))); print('   ур.', lv, k, '= как', prev[0]); continue
            if L.get('C') is not None: L['C'] = L['C']                       # цвета вершин уже линейные
            pk.append(pack(L, tn, kind)); print('   ур.', lv, k, kind, len(L['F']), 'треуг.')
        out.append(pk)
    M.setdefault(name, []).append(dict(h=round(Hn, 2), lod=out))

RX = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]; RXN = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]; RZ = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]                            # поворот −90° вокруг X (модель лежит «на боку»)
only = set(sys.argv[2:])
def want(n): return not only or n in only

if want('crystal'):
    bake('crystal', 'crystal1', 1.6, {'*': 'glow'}, [2400, 900])
    bake('crystal', 'crystal2', 1.9, {'*': 'glow'}, [800, 500])
if want('mossrock'): bake('mossrock', 'stone', 1, {'*': 'col'}, [1800], unit=True)
if want('cattail'): bake('cattail', 'cattail', 1.7, {'*': 'col'}, [1300, 600])
if want('willow'): bake('willow', 'willow', 8.0, {0: 'leafc', '*': 'col'}, [3000, 1500, 600], keep=[(0.06, 1.9), (0.04, 2.3), (0.025, 2.8)], base='trunk', thin={2: 0.35, 3: 0.35})
if want('mangrove'): bake('mangrove', 'mangrove', 6.5, {3: 'leaf', 4: 'drop', '*': 'col'}, [2400, 1200, 500], keep=[(0.025, 2.5), (0.016, 3.0), (0.009, 3.8)], base='trunk')
if want('tumbleweed'): bake('tumbleweed', 'tumbleweed', 0.9, {'*': 'leaf'}, [1], keep=[(1, 1)], fl=0.3)
if want('barrel'): bake('barrel', 'barrel', 0.6, {4: 'drop', 8: 'drop', 9: 'drop', 10: 'drop', 11: 'drop', '*': 'col'}, [1800, 800])
if want('saguaro'): bake('saguaro', 'saguaro', 3.6, {0: 'drop', '*': 'col'}, [2600, 1300, 600], base='trunk', thin={3: 0.5, 4: 0.5, 5: 0.5, 6: 0.5, 9: 0.3})
if want('agave'): bake('agave', 'agave', 1.1, {'*': 'col'}, [2600, 1100], cut=0.205)
if want('rhodo'): bake('rhodo', 'rhodo', 1.3, {'*': 'tex'}, [2600, 1100])
if want('gentian'): bake('gentian', 'gentian', 0.35, {0: 'drop', '*': 'col'}, [1800, 800])
if want('mpine'): bake('mpine', 'mpine', 7.5, {0: 'leaf', 1: 'tex'}, [2500, 1200, 500], keep=[(1, 1), (0.75, 1.15), (0.5, 1.4)], base='trunk')
if want('snowdrop'): bake('snowdrop', 'snowdrop', 0.25, {'*': 'col'}, [1600, 700], color={1: [0.92, 0.94, 0.9]})
if want('juniper'): bake('juniper', 'juniper', 4.5, {0: 'tex', 1: 'leaf'}, [2104, 1200, 600], keep=[(1, 1), (0.75, 1.15), (0.5, 1.4)], base='trunk')
if want('snowtree'): bake('snowtree', 'snowtree', 7.5, {'*': 'col'}, [4000, 1800, 800], base='trunk', gain=[1.7, 1.75, 1.8])
if want('bluebell'): bake('bluebell', 'bluebell', 0.4, {'*': 'tex'}, [1500, 700])
if want('daisy'): bake('daisy', 'daisy', 0.35, {0: 'leaf', 1: 'leaf', '*': 'tex'}, [400, 400])

# ---- вторая присылка: море, лава, портал, яйцо, камни
if want('starfish'): bake('starfish', 'starfish', 0, {'*': 'col'}, [1600], width=0.38, rot=RZ)
if want('urchin'): bake('urchin', 'urchin', 0, {'*': 'col'}, [2400], width=0.3, rot=RXN, bodies=0)
if want('anemone'): bake('anemone', 'anemone', 0.45, {'*': 'col'}, [2000], cut=0.3)
if want('fan'): bake('fan', 'fan', 1.1, {'*': 'col'}, [1400, 600], split=True, rot=RXN, meshes=[0, 1, 3], kc=3)
if want('brain'): bake('brain', 'brain', 0, {'*': 'col'}, [2000], meshes=[2, 3, 4, 5], width=0.9)
if want('tube'): bake('tube', 'tube', 0.8, {'*': 'col'}, [2000, 900])
if want('staghorn'): bake('staghorn', 'staghorn', 0, {'*': 'col'}, [2600, 1100], width=1.4)
if want('seagrass'): bake('seagrass', 'seagrass', 0.5, {'*': 'tex'}, [1600])
if want('kelpm'): bake('kelpm', 'kelp', 1.1, {'*': 'col'}, [2400, 1000], color={0: [0.16, 0.24, 0.05]})
if want('vent'): bake('vent', 'vents', 3.5, {'*': 'col'}, [3000, 1300], base='trunk')
if want('lavarock'): bake('lavarock', 'lava', 0, {'*': 'glow'}, [1200], width=2.2, split=True)
if want('rock2'): bake('rock2', 'rocks', 0, {'*': 'tex'}, [1600], unit=True, split=True)
if want('portal'): bake('portal', 'portal', 8.7, {2: 'tex', '*': 'col'}, [2600])
if want('egg'): bake('egg', 'egg', 1, {'*': 'tex'}, [960], texsz=256)

js = '/* Вторая партия растений, камней и кристаллов из присланных GLB. Сгенерировано tools/env_bake2.py — не править вручную. */\n'
js += 'export const ENVM2 = ' + json.dumps(dict(tex=envlib.TEX, m=M), separators=(',', ':')) + ';\n'
open(OUT if not only else OUT + '.part', 'w').write(js); print('записано', len(js) // 1024, 'КБ')

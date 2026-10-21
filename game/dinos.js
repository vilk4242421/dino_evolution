/* Модели: 4 класса игрока, враги по биомам, 6 боссов.
   Каждое существо — одна непрерывная гладкая «кожа», вытянутая вдоль позвоночника (лофт), с текстурой чешуи,
   градиентом окраса (спина → бока → брюхо), узорами, отдельными глазами с радужкой, зубами, когтями и пальцами.
   Анимация — скелетная (кости внутри кожи), поэтому кожа гнётся плавно и это дёшево для видеокарты.
   Внутри модель строится в системе «x — вперёд, y — вверх, z — вбок», снаружи смотрит в +Z, как и раньше. */
import * as THREE from 'three';
const CONFIG = window.CONFIG, Sim = window.Sim;
const V3 = THREE.Vector3;
const PI = Math.PI;

// ======================================================================== ТЕКСТУРЫ И МАТЕРИАЛЫ
function scaleTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, S, S);
  const s = 16;
  for (let y = 0; y < S / s; y++) for (let x = 0; x < S / s; x++) {
    const cx = x * s + (y % 2 ? s / 2 : 0), cy = y * s;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gr = g.createRadialGradient(cx + ox - 2, cy + oy - 3, 1, cx + ox, cy + oy, s * 0.62);
      gr.addColorStop(0, '#c8c8c8'); gr.addColorStop(0.7, '#8a8a8a'); gr.addColorStop(1, '#555');
      g.fillStyle = gr; g.beginPath(); g.arc(cx + ox, cy + oy, s * 0.62, 0, PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const BUMP = scaleTexture();
export const SCALE_BUMP = BUMP;
const MAT = {
  skin: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, bumpMap: BUMP, bumpScale: 0.025 }),
  skin2: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, bumpMap: BUMP, bumpScale: 0.012, side: THREE.DoubleSide }),
  acc: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.4, metalness: 0.04 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.14, metalness: 0.2 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false }),
  ice: new THREE.MeshStandardMaterial({ color: 0xd6f1ff, roughness: 0.12, metalness: 0.15, emissive: 0x2a74a8, emissiveIntensity: 0.6, flatShading: true }),
  bugwing: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
};
const skinVar = new Map();
function skinMat(emis, ds) {
  if (!emis) return ds ? MAT.skin2 : MAT.skin;
  const key = emis + ':' + (ds ? 1 : 0);
  let m = skinVar.get(key);
  if (!m) { m = (ds ? MAT.skin2 : MAT.skin).clone(); m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; skinVar.set(key, m); }
  return m;
}

// ======================================================================== ЛОФТ: гладкая кожа вдоль позвоночника
const FIELDS = ['x', 'y', 'top', 'bot', 'w', 'sq', 'brow', 'cheek', 'ridge'];
const DEF = { sq: 2, brow: 0, cheek: 0, ridge: 0 };
function prepKeys(keys) {
  keys = keys.map(k => { const o = Object.assign({}, k); for (const f in DEF) if (o[f] === undefined || o[f] === null || isNaN(o[f])) o[f] = DEF[f]; return o; });
  keys[0].u = 0;
  for (let i = 1; i < keys.length; i++) keys[i].u = keys[i - 1].u + Math.hypot(keys[i].x - keys[i - 1].x, keys[i].y - keys[i - 1].y);
  return keys;
}
function interp(keys, u) {
  let i = 0; while (i < keys.length - 2 && u > keys[i + 1].u) i++;
  const k0 = keys[i], k1 = keys[i + 1], h = k1.u - k0.u;
  const t = Math.min(1, Math.max(0, (u - k0.u) / h)), t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const slope = (j, f) => { const a = keys[Math.max(0, j - 1)], b = keys[Math.min(keys.length - 1, j + 1)]; return (b[f] - a[f]) / ((b.u - a.u) || 1); };
  const o = {};
  for (const f of FIELDS) o[f] = h00 * k0[f] + h10 * h * slope(i, f) + h01 * k1[f] + h11 * h * slope(i + 1, f);
  o.top = Math.max(o.top, 0.003); o.bot = Math.max(o.bot, 0.003); o.w = Math.max(o.w, 0.003);
  return o;
}
const gauss = (d, w) => Math.exp(-(d * d) / (w * w));
function shape(P, th) {
  const c = Math.cos(th), s = Math.sin(th), pe = 2 / P.sq;
  const cc = Math.sign(c) * Math.pow(Math.abs(c), pe), ss = Math.sign(s) * Math.pow(Math.abs(s), pe);
  const a = cc * (c > 0 ? P.top : P.bot), b = ss * P.w;
  const ang = Math.acos(Math.max(-1, Math.min(1, c)));
  const add = P.brow * gauss(ang - 0.78, 0.26) + P.cheek * gauss(ang - 1.95, 0.4) + P.ridge * gauss(ang, 0.2);
  return [a + c * add, b + s * add];
}
function frameAt(keys, u, U) {
  const p = interp(keys, u);
  const pa = interp(keys, Math.max(0, u - 0.01)), pb = interp(keys, Math.min(U, u + 0.01));
  const t = new V3(pb.x - pa.x, pb.y - pa.y, 0).normalize();
  return { p, C: new V3(p.x, p.y, 0), N: new V3(-t.y, t.x, 0) };
}
function loft(keysIn, o) {
  o = o || {};
  const keys = prepKeys(keysIn), rings = o.rings || 60, seg = o.seg || 20, uScale = o.uScale || 1.3, vTiles = o.vTiles || 4;
  const U = keys[keys.length - 1].u, cols = seg + 1, nV = rings * cols + 2;
  const pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), up = new Float32Array(nV), vu = new Float32Array(nV);
  const ringU = [], crest = [];
  for (let i = 0; i < rings; i++) {
    const u = U * i / (rings - 1), f = frameAt(keys, u, U);
    ringU.push(u); crest.push(f.C);
    for (let j = 0; j < cols; j++) {
      const th = PI + 2 * PI * j / seg, [a, b] = shape(f.p, th), idx = i * cols + j;
      pos[idx * 3] = f.C.x + f.N.x * a; pos[idx * 3 + 1] = f.C.y + f.N.y * a; pos[idx * 3 + 2] = b;
      uv[idx * 2] = u * uScale; uv[idx * 2 + 1] = j / seg * vTiles;
      up[idx] = f.N.y * Math.cos(th); vu[idx] = u;
    }
  }
  const s0 = rings * cols, e0 = s0 + 1;
  pos.set([crest[0].x, crest[0].y, 0], s0 * 3); pos.set([crest[rings - 1].x, crest[rings - 1].y, 0], e0 * 3);
  vu[s0] = 0; vu[e0] = U; up[s0] = 0; up[e0] = 0;
  const idx = [];
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
  for (let j = 0; j < seg; j++) { idx.push(s0, j + 1, j); const a = (rings - 1) * cols + j; idx.push(e0, a, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const n = geo.attributes.normal.array;
  for (let i = 0; i < rings; i++) { const a = i * cols * 3, b = (i * cols + seg) * 3; for (let k = 0; k < 3; k++) { const m = (n[a + k] + n[b + k]) / 2; n[a + k] = n[b + k] = m; } }
  const L = {
    geo, keys, U, ringU, crest, up, vu, rings, cols, seg,
    crestAtU(u) { const p = interp(keys, u); return new V3(p.x, p.y, 0); },
    uAtX(x) {
      if (x <= crest[0].x) return 0;
      for (let i = 1; i < rings; i++) if (crest[i].x >= x) { const a = crest[i - 1].x, b = crest[i].x; return ringU[i - 1] + (ringU[i] - ringU[i - 1]) * ((x - a) / ((b - a) || 1)); }
      return U;
    },
    // точка на поверхности: th = 0 — верх, π — низ, знак th — сторона (±z)
    pointAtU(u, th, inset) {
      const f = frameAt(keys, Math.max(0, Math.min(U, u)), U), [a, b] = shape(f.p, th);
      const dir = new V3(f.N.x * Math.cos(th), f.N.y * Math.cos(th), Math.sin(th)).normalize();
      return { pos: new V3(f.C.x + f.N.x * a, f.C.y + f.N.y * a, b).addScaledVector(dir, -(inset || 0)), dir, N: f.N.clone(), r: f.p };
    },
    pointAtX(x, th, inset) { return this.pointAtU(this.uAtX(x), th, inset); }
  };
  return L;
}

// ---------- шум и раскраска ----------
function hash3(x, y, z) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hx = (h) => new THREE.Color(h);
const mixHex = (a, b, t) => hx(a).lerp(hx(b), t).getHex();
const mulHex = (a, f) => hx(a).multiplyScalar(f).getHex();
let PATC = null;      // цвет узора из магазина (действует на время сборки модели)
// палитра из одного цвета: спина темнее, бока — сам цвет, брюхо светлое, полосы — тёмные
export function palette(color, o) {
  o = o || {};
  const c = hx(color), hsl = {}; c.getHSL(hsl);
  const back = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.max(0.05, hsl.l * 0.52));
  const belly = hx(color).lerp(hx(o.bellyTo || 0xe6dcc2), o.bellyK === undefined ? 0.62 : o.bellyK);
  const stripe = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.8), Math.max(0.03, hsl.l * 0.32));
  return { back: o.back || back.getHex(), side: color, belly: o.belly || belly.getHex(), stripe: PATC != null ? PATC : (o.stripe || stripe.getHex()), ns: o.ns || 6 };
}
// pat: {type:'stripes'|'spots'|'bands'|'none', amt, freq, from, to}
let MORPH = null;     // морф из магазина (на время сборки модели): {c1?, c2 спина, c3? брюхо, pc узор, pat}
function paint(L, pal, pat) {
  let backH = pal.back, sideH = pal.side, bellyH = pal.belly, strH = pal.stripe;
  if (MORPH) {
    if (MORPH.c1 != null) sideH = MORPH.c1;
    backH = MORPH.c2; bellyH = MORPH.c3 != null ? MORPH.c3 : mixHex(sideH, 0xffffff, 0.5);
    if (PATC == null) strH = MORPH.pc != null ? MORPH.pc : mulHex(MORPH.c2, 0.6);
    if (MORPH.pat) pat = Object.assign({ from: 0, to: 1 }, MORPH.pat);
  }
  const back = hx(backH), side = hx(sideH), belly = hx(bellyH), str = hx(strH), c = new THREE.Color(), alt = hx(MORPH && MORPH.c3 != null ? MORPH.c3 : bellyH);
  const pos = L.geo.attributes.position.array, n = pos.length / 3, col = new Float32Array(n * 3);
  const ns = pal.ns || 6; pat = pat || {};
  const amt = pat.amt === undefined ? 0.75 : pat.amt, from = pat.from === undefined ? 0 : pat.from, to = pat.to === undefined ? 0.8 : pat.to, fr = pat.freq || 9;
  for (let i = 0; i < n; i++) {
    const u = L.up[i] || 0, un = L.vu[i] / L.U, x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (MORPH) c.copy(belly).lerp(side, sstep(-0.55, -0.05, u)).lerp(back, sstep(0.05, 0.55, u) * 0.95);
    else c.copy(belly).lerp(side, sstep(-0.6, 0.15, u)).lerp(back, sstep(0.25, 0.95, u) * 0.85);
    const m = vnoise(x * ns, y * ns, z * ns);
    // реализм: крупная неоднородность, мелкая «чешуйчатая» пестрота и светлое брюхо; края узоров рваные (domain warp)
    const sc = vnoise(x * 34 + 2.1, y * 34 + 7.7, z * 34 + 4.4), sc2 = vnoise(x * 70 + 9.3, y * 70 + 1.2, z * 70 + 5.8);
    c.multiplyScalar(0.86 + 0.2 * m + 0.14 * sc + 0.06 * sc2);
    c.offsetHSL((sc2 - 0.5) * 0.012, (sc - 0.5) * 0.06, 0);
    const wr = (vnoise(x * 4.3 + 5, y * 4.3 + 1, z * 4.3 + 9) - 0.5) * 0.9;
    const wx = x + wr * 0.35, wy = y + wr * 0.3, wz = z + wr * 0.35;
    if (pat.type === 'stripes' || pat.type === 'bands') {
      const win = sstep(from - 0.04, from + 0.04, un) * (1 - sstep(to - 0.06, to + 0.02, un));
      const k = Math.pow(Math.max(0, Math.sin(un * fr * PI * 2 + 0.6 + (pat.type === 'stripes' ? Math.abs(wz) * 3 + wr * 1.4 : 0))), 4) * sstep(pat.type === 'bands' ? -0.3 : 0.0, 0.6, u) * win;
      c.lerp(str, k * amt);
    } else if (pat.type === 'spots') {
      const f = pat.freq || 3.2, s = vnoise(wx * f + 11.3, wy * f + 3.1, wz * f + 7.7);
      const k = sstep(0.6, 0.68, s) * sstep(-0.35, 0.3, u) * (sstep(from - 0.04, from + 0.04, un) * (1 - sstep(to - 0.04, to + 0.04, un)));
      c.lerp(str, k * amt); if (k > 0.01) c.multiplyScalar(1 - 0.18 * k * (1 - sstep(0.68, 0.74, s)));
    } else if (pat.type === 'rosette') {                // розетки леопарда: тёмное кольцо со светлой серединой
      const f = pat.freq || 3.4, s = vnoise(wx * f + 5.1, wy * f + 9.3, wz * f + 2.7), ring = sstep(0.56, 0.6, s) * (1 - sstep(0.64, 0.68, s)), core = sstep(0.64, 0.7, s);
      const k = sstep(-0.4, 0.3, u); c.lerp(str, ring * amt * k); c.lerp(alt, core * 0.5 * k);
    } else if (pat.type === 'camo') {                   // камуфляж: два слоя пятен
      const f = pat.freq || 2.6, s1 = vnoise(wx * f + 1.7, wy * f + 8.1, wz * f + 4.2), s2 = vnoise(wx * f * 1.8 + 9.1, wy * f * 1.8 + 2.2, wz * f * 1.8 + 6.6);
      c.lerp(str, sstep(0.52, 0.58, s1) * amt); c.lerp(alt, sstep(0.6, 0.66, s2) * amt * 0.8);
    } else if (pat.type === 'patch') {                  // арлекин: заплатки двух контрастных цветов
      const f = pat.freq || 1.6, sp = vnoise(wx * f + 3.3, wy * f + 1.9, wz * f + 7.1);
      c.lerp(str, sstep(0.57, 0.6, sp) * 0.95); c.lerp(alt, (1 - sstep(0.36, 0.4, sp)) * 0.95);
    } else if (pat.type === 'ombre') {                  // плавный градиент от головы к хвосту
      c.lerp(str, sstep(0.15, 1.0, un) * amt);
    } else if (pat.type === 'chevron') {                // ёлочка вдоль спины
      const k = Math.pow(Math.max(0, Math.sin(un * fr * PI * 2 + Math.abs(wz) * 9 + wr * 2)), 5) * sstep(-0.2, 0.55, u);
      c.lerp(str, k * amt);
    }
    if (pat.glowLine && Math.abs(u) < 0.08 && un > (pat.from || 0) && un < (pat.to || 1)) c.lerp(hx(pat.glowLine), 0.8);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  L.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return L;
}
function colorize(geo, hex, jitter) {
  const n = geo.attributes.position.count, col = new Float32Array(n * 3), c = hx(hex), p = geo.attributes.position.array;
  for (let i = 0; i < n; i++) { const k = jitter ? 0.88 + 0.24 * vnoise(p[i * 3] * 9, p[i * 3 + 1] * 9, p[i * 3 + 2] * 9) : 1; col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
}

// ---------- скелет внутри кожи ----------
// boneUs — по возрастанию; rootIdx — корневая кость (у таза), цепочки идут от неё в обе стороны
function skinMesh(L, boneUs, rootIdx, mat) {
  const nb = boneUs.length, rest = boneUs.map(u => L.crestAtU(u)), bones = boneUs.map(() => new THREE.Bone());
  for (let i = 0; i < nb; i++) {
    if (i === rootIdx) { bones[i].position.copy(rest[i]); continue; }
    const p = i < rootIdx ? i + 1 : i - 1;
    bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]);
  }
  const n = L.geo.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const u = L.vu[v];
    let a = 0, b = 0, t = 0;
    if (u <= boneUs[0]) { a = b = 0; } else if (u >= boneUs[nb - 1]) { a = b = nb - 1; }
    else { let i = 0; while (i < nb - 2 && u > boneUs[i + 1]) i++; a = i; b = i + 1; t = sstep(0, 1, (u - boneUs[i]) / ((boneUs[i + 1] - boneUs[i]) || 1)); }
    si[v * 4] = a; si[v * 4 + 1] = b; sw[v * 4] = 1 - t; sw[v * 4 + 1] = t;
  }
  L.geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  L.geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(L.geo, mat || MAT.skin);
  mesh.add(bones[rootIdx]); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  L.geo.computeBoundingSphere();
  mesh.boundingSphere = L.geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.5;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return { mesh, bones, rest, boneUs };
}
function nearestBone(S, u) { let bi = 0, bd = 1e9; S.boneUs.forEach((bu, i) => { const d = Math.abs(bu - u); if (d < bd) { bd = d; bi = i; } }); return bi; }

// ---------- сборщик мелких деталей: всё на одной кости сливается в один меш ----------
const UNIT = {
  sph: new THREE.SphereGeometry(1, 14, 10),
  sphLo: new THREE.SphereGeometry(1, 9, 7),
  cone: new THREE.ConeGeometry(1, 1, 9, 1, true),
  coneLo: new THREE.ConeGeometry(1, 1, 6, 1, true)
};
// качество моделей зависит от настройки графики (меньше полигонов на слабых устройствах)
export function qMul() { const q = (typeof window !== 'undefined' && window.__dinoQ) || 1; return q; }
let _eyeQ = 1; const eyeG = () => (_eyeQ < 0.8 ? UNIT.sphLo : UNIT.sph);
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), Y_UP = new V3(0, 1, 0);
function M_ell(p, s, q) { return new THREE.Matrix4().compose(p, q || new THREE.Quaternion(), new V3(s[0], s[1], s[2])); }
function M_spike(base, dir, len, r) {
  const d = dir.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(Y_UP, d);
  return new THREE.Matrix4().compose(base.clone().addScaledVector(d, len / 2), q, new V3(r, len, r));
}
function M_trs(p, rx, ry, rz, s) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')); const sc = typeof s === 'number' ? new V3(s, s, s) : (s || new V3(1, 1, 1)); return new THREE.Matrix4().compose(p, q, sc); }
function mergeParts(items) {
  let nv = 0, ni = 0;
  for (const it of items) { nv += it.g.attributes.position.count; ni += it.g.index ? it.g.index.count : it.g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ind = new Uint32Array(ni);
  let ov = 0, oi = 0; const v = new V3(), nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const it of items) {
    const g = it.g; if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, T = g.attributes.uv, cnt = P.count;
    nm.getNormalMatrix(it.m); if (it.c !== undefined && it.c !== null) c.set(it.c);
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(it.m); pos[(ov + i) * 3] = v.x; pos[(ov + i) * 3 + 1] = v.y; pos[(ov + i) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(ov + i) * 3] = v.x; nor[(ov + i) * 3 + 1] = v.y; nor[(ov + i) * 3 + 2] = v.z;
      if (C && (it.c === undefined || it.c === null)) { col[(ov + i) * 3] = C.getX(i); col[(ov + i) * 3 + 1] = C.getY(i); col[(ov + i) * 3 + 2] = C.getZ(i); }
      else { const k = it.j ? 0.9 + 0.2 * vnoise(v.x * 13, v.y * 13, v.z * 13) : 1; col[(ov + i) * 3] = c.r * k; col[(ov + i) * 3 + 1] = c.g * k; col[(ov + i) * 3 + 2] = c.b * k; }
      if (T) { uv[(ov + i) * 2] = T.getX(i) * (it.uvs || 1); uv[(ov + i) * 2 + 1] = T.getY(i) * (it.uvs || 1); }
    }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) ind[oi + i] = I[i] + ov; oi += I.length; }
    else { for (let i = 0; i < cnt; i++) ind[oi + i] = ov + i; oi += cnt; }
    ov += cnt;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}
class Kit {
  constructor() { this.map = new Map(); }
  // target — объект, к которому крепим; origin — где этот объект стоит в координатах модели (в покое)
  add(target, origin, type, g, m, c, j) {
    const key = target.uuid + '|' + type;
    let e = this.map.get(key); if (!e) { e = { target, type, items: [] }; this.map.set(key, e); }
    const mm = origin ? new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z).multiply(m) : m;
    e.items.push({ g, m: mm, c, j });
  }
  build(o) {
    o = o || {};
    for (const e of this.map.values()) {
      const mat = e.type === 'skin' ? skinMat(o.emis, false) : e.type === 'skin2' ? skinMat(o.emis, true) : MAT[e.type];
      const mesh = new THREE.Mesh(mergeParts(e.items), mat);
      mesh.castShadow = e.type !== 'glow' && e.type !== 'bugwing'; mesh.receiveShadow = e.type === 'skin';
      e.target.add(mesh);
    }
    this.map.clear();
  }
}
// изогнутый рог / коготь / шип-лофт, ось — +x
const hornCache = new Map();
function hornGeo(len, r, bend, seg) {
  const key = [len, r, bend, seg || 10].map(v => (+v).toFixed(3)).join(',');
  let g = hornCache.get(key);
  if (!g) {
    const keys = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6, rr = r * Math.pow(1 - t, 0.85) + 0.004; keys.push({ x: len * t, y: bend * len * t * t, top: rr, bot: rr, w: rr }); }
    g = loft(keys, { rings: 14, seg: seg || 10, uScale: 4, vTiles: 2 }).geo; hornCache.set(key, g);
  }
  return g;
}
// закрученный рог барана: плоская спираль в плоскости xy (идёт назад, вниз и вперёд)
function spiralHornGeo(R, r0, turns) {
  const key = 'sp' + R.toFixed(3) + r0.toFixed(3) + turns;
  let g = hornCache.get(key); if (g) return g;
  const keys = [], N = 22, p0 = new V3(0, R, 0);
  for (let i = 0; i <= N; i++) {
    const t = i / N, ph = PI / 2 + t * turns * PI * 2, rr = R * (1 - 0.55 * t);
    const rad = r0 * (1 - 0.8 * t) + 0.004;
    keys.push({ x: Math.cos(ph) * rr - p0.x, y: Math.sin(ph) * rr - p0.y, top: rad, bot: rad, w: rad * 0.9, ridge: rad * 0.12 });
  }
  g = loft(keys, { rings: 60, seg: 12, uScale: 6, vTiles: 2 }).geo; hornCache.set(key, g); return g;
}
// плоская пластина / плавник: ось вдоль keys, толщина по z
function bladeGeo(keys, rings, seg) { const L = loft(keys, { rings: rings || 20, seg: seg || 14, uScale: 2, vTiles: 2 }); return L; }

// ======================================================================== ПЛАН ТЕЛА 1: ДВУНОГИЙ ХИЩНИК (тероподы)
// o: {k, slim, headK, tailK, legK, neckK, pal, pat, r (ранги эволюции), stage, teeth, sickle, emis, extras}
function theropod(o) {
  const k = o.k || 0.42, slim = o.slim || 1, hk = o.headK || 1, tk = o.tailK || 1, lk = o.legK || 1, r = o.r || {}, stage = o.stage || 0;
  const HIP = 3.5 * lk;
  const X = x => (x < 0 ? x * tk : x <= 2.8 ? x : 2.8 + (x - 2.8) * hk) * k;
  const Yb = (x, y) => (HIP + (x <= 2.8 ? y : 1.18 + (y - 1.18) * hk)) * k;
  const R = (x, v) => v * k * (x > 2.8 ? hk : (x > -3.9 && x < 2.5 ? slim : 1));
  const map = (key) => ({ x: X(key.x), y: Yb(key.x, key.y), top: R(key.x, key.top), bot: R(key.x, key.bot), w: R(key.x, key.w), sq: key.sq || 2, brow: R(key.x, key.brow || 0), cheek: R(key.x, key.cheek || 0), ridge: R(key.x, key.ridge || 0) });
  const bodyKeys = [
    { x: -6.3, y: 0.42, top: .015, bot: .015, w: .015 }, { x: -6.0, y: 0.38, top: .07, bot: .06, w: .06 },
    { x: -5.0, y: 0.3, top: .15, bot: .14, w: .12, ridge: .02 }, { x: -3.9, y: 0.22, top: .27, bot: .26, w: .22, ridge: .03 },
    { x: -2.7, y: 0.16, top: .44, bot: .42, w: .36, ridge: .04 }, { x: -1.6, y: 0.12, top: .64, bot: .62, w: .54, ridge: .05 },
    { x: -0.6, y: 0.1, top: .84, bot: .82, w: .72, ridge: .05 }, { x: 0.4, y: 0.08, top: .95, bot: 1.02, w: .86, ridge: .05 },
    { x: 1.3, y: 0.15, top: .82, bot: 1.05, w: .82, ridge: .04 }, { x: 2.0, y: 0.42, top: .6, bot: .74, w: .58, ridge: .03 },
    { x: 2.45, y: 0.85, top: .44, bot: .5, w: .44, ridge: .02 }, { x: 2.8, y: 1.18, top: .42, bot: .46, w: .45 },
    { x: 3.1, y: 1.3, top: .47, bot: .44, w: .5, sq: 2.3, cheek: .07 }, { x: 3.4, y: 1.28, top: .41, bot: .33, w: .43, sq: 2.4, brow: .11 },
    { x: 3.75, y: 1.2, top: .32, bot: .23, w: .31, sq: 2.6, ridge: .025 }, { x: 4.15, y: 1.11, top: .26, bot: .18, w: .24, sq: 2.6, ridge: .03 },
    { x: 4.45, y: 1.05, top: .19, bot: .14, w: .18, sq: 2.5, ridge: .02 }, { x: 4.62, y: 1.01, top: .08, bot: .07, w: .09, sq: 2.2 },
    { x: 4.68, y: 1.0, top: .01, bot: .01, w: .01 }
  ];
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;   // качество (кольца/сегменты)
  const L = paint(loft(bodyKeys.map(map), { rings: Math.round(110 * Q), seg: Math.round(30 * Q), uScale: 1.3 / k * 0.42, vTiles: 6 }), o.pal, o.pat);
  const bx = [-5.4, -4.3, -3.2, -2.1, -1.0, 0, 1.6, 2.45, 2.92];
  const S = skinMesh(L, bx.map(x => L.uAtX(X(x))), 5, skinMat(o.emis));
  const rig = baseRig('biped');
  rig.frame.add(S.mesh);
  rig.spine = { root: S.bones[5], tail: [4, 3, 2, 1, 0].map(i => S.bones[i]), neck: [S.bones[6], S.bones[7]], head: S.bones[8] };
  const kit = new Kit(), head = S.bones[8], headO = S.rest[8];
  const s = k * hk;
  // зубы верхней челюсти
  const fang = r.fangs || 0, toothC = fang >= 3 ? 0xb5ff6a : 0xece0c2;
  if (o.teeth !== false) for (const sd of [1, -1]) {
    for (let x = 3.55; x <= 4.5; x += 0.082) {
      const p = L.pointAtX(X(x), sd * 2.3, 0.025 * s);
      const len = (0.07 + 0.08 * Math.sin(PI * Math.min(1, (x - 3.5) / 1.05))) * s * (1 + fang * 0.22 + stage * 0.08);
      kit.add(head, headO, 'acc', UNIT.coneLo, M_spike(p.pos, new V3(-0.12, -1, sd * -0.08), len, (0.022 * k * hk + len * 0.08)), toothC);
    }
  }
  // глаза: тёмное яблоко, янтарная радужка, щель зрачка
  const glowEye = (r.sense || 0) >= 2 || o.glowEyes;
  const eyes = [];
  for (const sd of [1, -1]) {
    const e = L.pointAtX(X(3.36), sd * 1.12, 0.035 * s);
    kit.add(head, headO, 'eye', eyeG(), M_ell(e.pos, [0.068 * s, 0.068 * s, 0.068 * s]), 0x0c0a08);
    const iris = e.pos.clone().addScaledVector(e.dir, 0.045 * s).add(new V3(0.015 * s, 0, 0));
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [0.04 * s, 0.044 * s, 0.04 * s]), o.irisC || (glowEye ? 0xffd23a : 0xd99a2b));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, 0.032 * s), [0.01 * s, 0.03 * s, 0.01 * s]), 0x050403);
    eyes.push(e.pos);
    const n = L.pointAtX(X(4.48), sd * 0.6, 0.012 * s);
    kit.add(head, headO, 'acc', UNIT.sphLo, M_ell(n.pos, [0.045 * s, 0.02 * s, 0.028 * s]), 0x14100c);
  }
  kit.add(head, headO, 'acc', UNIT.sphLo, M_ell(new V3(X(3.85), Yb(3.85, 0.965), 0), [0.68 * s, 0.04 * s, 0.2 * s]), 0x5e1d1a);
  kit.add(head, headO, 'acc', UNIT.sphLo, M_ell(new V3(X(3.12), Yb(3.12, 0.98), 0), [0.22 * s, 0.13 * s, 0.26 * s]), 0x4a1614);
  // нижняя челюсть на шарнире
  const hinge = new V3(X(3.0), Yb(3.0, 1.02), 0);
  const jawPivot = new THREE.Group(); jawPivot.position.copy(hinge).sub(headO); head.add(jawPivot);
  const jawInner = new THREE.Group(); jawInner.position.copy(hinge).negate(); jawPivot.add(jawInner);
  const jawKeys = [
    { x: 2.95, y: 1.03, top: .08, bot: .12, w: .26, sq: 2.2 }, { x: 3.15, y: 0.96, top: .12, bot: .2, w: .36, sq: 2.2 },
    { x: 3.5, y: 0.9, top: .1, bot: .16, w: .33, sq: 2.3 }, { x: 3.9, y: 0.87, top: .08, bot: .12, w: .27, sq: 2.4 },
    { x: 4.3, y: 0.86, top: .07, bot: .1, w: .2, sq: 2.4 }, { x: 4.5, y: 0.87, top: .05, bot: .07, w: .14 }, { x: 4.56, y: 0.88, top: .01, bot: .01, w: .01 }
  ].map(map);
  const J = paint(loft(jawKeys, { rings: Math.round(44 * Q), seg: Math.round(22 * Q), uScale: 1.3 / k * 0.42, vTiles: 3 }), o.pal, null);
  const jm = new THREE.Mesh(J.geo, skinMat(o.emis)); jm.castShadow = true; jawInner.add(jm);
  kit.add(jawInner, null, 'acc', UNIT.sphLo, M_ell(new V3(X(3.72), Yb(3.72, 0.95), 0), [0.55 * s, 0.04 * s, 0.17 * s]), 0x9a4a46);
  if (o.teeth !== false) for (const sd of [1, -1]) for (let x = 3.62; x <= 4.45; x += 0.09) {
    const p = J.pointAtX(X(x), sd * 0.75, 0.02 * s);
    const len = (0.06 + 0.05 * Math.sin(PI * Math.min(1, (x - 3.55) / 0.95))) * s * (1 + fang * 0.2);
    kit.add(jawInner, null, 'acc', UNIT.coneLo, M_spike(p.pos, new V3(-0.12, 1, sd * -0.08), len, 0.02 * s + len * 0.08), toothC);
  }
  rig.jaw = jawPivot; rig.jawAxis = 'z'; rig.jawBase = -0.03;
  // ноги
  const legKeys = [
    { x: 0.0, y: 0.6, top: .18, bot: .18, w: .16 }, { x: 0.05, y: 0.35, top: .48, bot: .5, w: .3 }, { x: 0.08, y: 0.1, top: .62, bot: .68, w: .4 },
    { x: 0.15, y: -0.45, top: .55, bot: .72, w: .44 }, { x: 0.26, y: -0.95, top: .34, bot: .42, w: .32 },
    { x: 0.33, y: -1.25, top: .24, bot: .27, w: .23 }, { x: 0.18, y: -1.85, top: .2, bot: .25, w: .19 },
    { x: 0.0, y: -2.45, top: .14, bot: .17, w: .14 }, { x: 0.08, y: -2.9, top: .12, bot: .12, w: .12 },
    { x: 0.18, y: -3.28, top: .13, bot: .12, w: .15 }, { x: 0.2, y: -3.33, top: .05, bot: .05, w: .06 }
  ].map(q => ({ x: q.x * k, y: q.y * k * lk + (q.y < 0 ? 0 : 0), top: q.top * k * slim, bot: q.bot * k * slim, w: q.w * k * slim }));
  // нижняя точка ноги должна стоять на земле: подгоняем по последнему ключу
  const legTopY = (HIP - 0.1) * k, footY = legTopY + legKeys[legKeys.length - 1].y;
  legKeys.forEach(q => { q.y -= footY / 1; });
  const cl = r.claws || 0, clawC = cl >= 4 ? 0xff5a3a : 0x26201a;
  for (const sd of [1, -1]) {
    const leg = addLeg(rig, legKeys, new V3(X(-0.1), legTopY, sd * 0.5 * k * slim), [2, 5, 7, 9], o, Q);
    leg.side = sd; leg.ph = sd > 0 ? 0 : PI;
    const toeKeys = [{ x: -0.12, y: 0.0, top: .09, bot: .08, w: .1 }, { x: 0.2, y: 0.0, top: .08, bot: .07, w: .085 }, { x: 0.45, y: -0.02, top: .065, bot: .055, w: .065 }, { x: 0.62, y: -0.03, top: .04, bot: .035, w: .04 }, { x: 0.68, y: -0.035, top: .008, bot: .008, w: .008 }]
      .map(q => ({ x: q.x * k, y: q.y * k, top: q.top * k * slim, bot: q.bot * k * slim, w: q.w * k * slim }));
    const toe = paint(loft(toeKeys, { rings: 16, seg: 12, uScale: 3, vTiles: 2 }), o.pal, null);
    const foot = leg.bones[3], fO = leg.rest[3], end = leg.end;
    for (const a of [-0.42, 0, 0.42]) {
      const sc = a === 0 ? 1.12 : 0.95, m = M_trs(end, 0, a, 0, sc);
      kit.add(foot, fO, 'skin', toe.geo, m);
      const cm = m.clone().multiply(M_spike(new V3(0.6 * k, -0.03 * k, 0), new V3(0.94, -0.34, 0), 0.17 * k * (1 + cl * 0.25) * (o.sickle && a < 0 && sd ? 1.7 : 1), 0.045 * k));
      kit.add(foot, fO, 'acc', UNIT.coneLo, cm, clawC);
    }
  }
  // ручки с двумя пальцами
  const armKeys = [{ x: -0.05, y: 0.3, top: .17, bot: .17, w: .15 }, { x: 0.0, y: -0.05, top: .12, bot: .12, w: .11 }, { x: 0.04, y: -0.36, top: .09, bot: .1, w: .085 }, { x: 0.18, y: -0.5, top: .075, bot: .08, w: .07 }, { x: 0.36, y: -0.57, top: .06, bot: .06, w: .055 }, { x: 0.44, y: -0.58, top: .02, bot: .02, w: .02 }]
    .map(q => ({ x: q.x * k * (o.armK || 1), y: q.y * k * (o.armK || 1), top: q.top * k * slim, bot: q.bot * k * slim, w: q.w * k * slim }));
  const armL = paint(loft(armKeys, { rings: 24, seg: 14, uScale: 2, vTiles: 2 }), o.pal, null);
  const toeG = paint(loft([{ x: -0.12, y: 0, top: .09, bot: .08, w: .1 }, { x: 0.3, y: 0, top: .07, bot: .06, w: .07 }, { x: 0.6, y: -0.03, top: .03, bot: .03, w: .03 }, { x: 0.68, y: -0.035, top: .008, bot: .008, w: .008 }].map(q => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k })), { rings: 12, seg: 10 }), o.pal, null);
  const armBoneI = nearestBone(S, L.uAtX(X(1.6)));
  for (const sd of [1, -1]) {
    const g = new THREE.Group(), ap = new V3(X(1.6), (HIP - 0.45) * k, sd * 0.55 * k * slim);
    g.position.copy(ap).sub(S.rest[armBoneI]); g.rotation.x = -sd * 0.25; S.bones[armBoneI].add(g);
    const am = new THREE.Mesh(armL.geo, skinMat(o.emis)); am.castShadow = true; g.add(am);
    const ak = o.armK || 1;
    for (const zz of [0.035, -0.035]) {
      const m = M_trs(new V3(0.4 * k * ak, -0.58 * k * ak, zz * k), 0, zz > 0 ? 0.25 : -0.25, -0.6, 0.32 * ak);
      kit.add(g, null, 'skin', toeG.geo, m);
      kit.add(g, null, 'acc', UNIT.coneLo, m.clone().multiply(M_spike(new V3(0.6 * k, -0.03 * k, 0), new V3(0.94, -0.34, 0), 0.2 * k * (1 + cl * 0.3), 0.05 * k)), clawC);
    }
    rig.arms.push({ g, s: sd, bx: -sd * 0.25 });
  }
  // спинные шипы по стадиям, броня (Шкура), засада
  const spikeC = mulHex(o.pal.back, 0.8);
  const nSp = o.spikes !== undefined ? o.spikes : stage * 4;
  for (let i = 0; i < nSp; i++) {
    const x = -3.2 + 5.2 * (nSp === 1 ? 0.5 : i / (nSp - 1)), u = L.uAtX(X(x)), p = L.pointAtU(u, 0, 0.01 * k), bi = nearestBone(S, u);
    const len = (0.18 + stage * 0.07 + (o.spikeLen || 0)) * k * (1 - Math.abs(x + 0.5) / 7);
    kit.add(S.bones[bi], S.rest[bi], o.spikeType || 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.35, 1, 0), len, len * 0.32), o.spikeC || spikeC);
  }
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) {
    const x = -1.8 + i * 0.32, u = L.uAtX(X(x)), p = L.pointAtU(u, sd * 0.45, 0.01 * k), bi = nearestBone(S, u);
    kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.sphLo, M_ell(p.pos, [0.16 * k, 0.07 * k, 0.12 * k], new THREE.Quaternion().setFromUnitVectors(Y_UP, p.dir)), mulHex(o.pal.back, 0.75), true);
  }
  if (stage >= 3 || o.browHorns) for (const sd of [1, -1]) {
    const p = L.pointAtX(X(3.3), sd * 0.7, 0.01 * s);
    kit.add(head, headO, 'acc', hornGeo(0.4 * s, 0.07 * s, 0.6), M_trs(p.pos, sd * -0.3, sd * -0.3, 1.25), 0xe8dcc0);
  }
  if (o.crest) for (let i = 0; i < 7; i++) {
    const x = 2.95 + i * 0.2, p = L.pointAtX(X(x), 0, 0.005 * s);
    kit.add(head, headO, 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.4, 1, 0), (0.18 + Math.sin(i / 6 * PI) * 0.2) * s, 0.05 * s), o.crest);
  }
  if (o.extras) o.extras({ L, S, kit, head, headO, X, Yb, k, s, rig });
  kit.build({ emis: o.emis });
  // анкоры для косметики/короны (координаты головы в системе игры: x вбок, y вверх, z вперёд)
  const top = L.pointAtX(X(3.15), 0, 0);
  setHeadAnch(rig, head, top.pos.clone().sub(headO), eyes[0].clone().sub(headO), new V3(X(2.45), Yb(2.45, 0.85), 0));
  rig.walkAmp = 0.42; rig.gait = 'biped'; rig.k = k;
  rig.tagH = top.pos.y + 0.2;
  return rig;
}

// базовый «риг»: корень (в координатах игры) → body (качание/наклон) → frame (x вперёд)
function baseRig(kind) {
  const root = new THREE.Group(), body = new THREE.Group(), frame = new THREE.Group();
  frame.rotation.y = -PI / 2; root.add(body); body.add(frame);
  return { kind, root, body, frame, legs: [], arms: [], wings: [], flippers: [], fins: [], spine: null, jaw: null };
}
function setHeadAnch(rig, headBone, topRel, eyeRel, neckPos) {
  const headG = new THREE.Group(); headG.rotation.y = PI / 2; headBone.add(headG);
  // перевод из frame (x вперёд, z вбок) в координаты игры (x вбок, z вперёд): (-z, y, x)
  rig.headG = headG;
  rig.anch = { hatY: topRel.y + 0.04, hatZ: topRel.x, eyeY: eyeRel.y, eyeZ: eyeRel.x, eyeX: Math.abs(eyeRel.z), neck: [0, neckPos.y, neckPos.x], head: headG };
}
// нога: отдельная гладкая кожа с костями бедро/колено/лодыжка/стопа
function addLeg(rig, keys, at, boneKeyIdx, o, Q, opt) {
  opt = opt || {};
  const L = paint(loft(keys, { rings: Math.round((opt.rings || 46) * (Q || 1)), seg: Math.round(18 * (Q || 1)), uScale: 1.6, vTiles: 3 }), o.pal, opt.pat || null);
  const bu = boneKeyIdx.map(i => L.keys[i].u);
  const S = skinMesh(L, bu, 0, skinMat(o.emis));
  const g = new THREE.Group(); g.position.copy(at); if (opt.splay) g.rotation.x = opt.splay; if (opt.yaw) g.rotation.y = opt.yaw;
  g.add(S.mesh); (opt.parent || rig.frame).add(g);
  const last = L.keys[L.keys.length - 1];
  const leg = { g, bones: S.bones, rest: S.rest, L, end: new V3(last.x, last.y, 0), ph: 0, side: 1, front: !!opt.front };
  rig.legs.push(leg);
  return leg;
}
// пальцы/копыта на конце ноги
function addToes(kit, leg, o, n, len, w, clawC, clawLen, spread) {
  const k = o.k || 1, foot = leg.bones[leg.bones.length - 1], fO = leg.rest[leg.rest.length - 1];
  const toe = paint(loft([{ x: -len * 0.2, y: 0, top: w, bot: w * 0.85, w }, { x: len * 0.35, y: 0, top: w * 0.85, bot: w * 0.7, w: w * 0.85 }, { x: len * 0.75, y: -w * 0.2, top: w * 0.6, bot: w * 0.5, w: w * 0.6 }, { x: len, y: -w * 0.3, top: w * 0.1, bot: w * 0.1, w: w * 0.1 }], { rings: 12, seg: 10, uScale: 3, vTiles: 2 }), o.pal, null);
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * (spread || 0.9);
    const m = M_trs(leg.end, 0, a, 0, 1);
    kit.add(foot, fO, 'skin', toe.geo, m);
    if (clawLen) kit.add(foot, fO, 'acc', UNIT.coneLo, m.clone().multiply(M_spike(new V3(len * 0.85, -w * 0.3, 0), new V3(0.94, -0.34, 0), clawLen, w * 0.5)), clawC || 0x26201a);
  }
}

// ======================================================================== ПЛАН ТЕЛА 2: ЧЕТВЕРОНОГИЙ (цератопсы, стегозавры, гадрозавры, мамонт, баран)
// o: {k, head:'cera'|'hadro'|'plain'|'ram'|'mammoth'|'hare'|'goat', plates, tailSpikes, fur, horns, neckK, legK, bulk, pal, pat, r, stage}
function quadruped(o) {
  const k = o.k || 1, r = o.r || {}, stage = o.stage || 0, bulk = (o.bulk || 1), lk = o.legK || 1, nk = o.neckK || 1, tl = o.tailK || 0.82, H = o.head || 'cera';
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const hy = 1.05 * lk;              // высота позвоночника над землёй
  const TX = (x) => (x < -0.9 ? -0.9 + (x + 0.9) * tl : x);   // растяжение хвоста без нарушения порядка
  const bodyKeys = [
    { x: TX(-2.9), y: hy - 0.12, top: .012, bot: .012, w: .012 }, { x: TX(-2.7), y: hy - 0.1, top: .05, bot: .045, w: .05 },
    { x: TX(-2.1), y: hy - 0.05, top: .13, bot: .12, w: .13, ridge: .015 }, { x: TX(-1.5), y: hy, top: .26, bot: .24, w: .26, ridge: .02 },
    { x: -0.9, y: hy + 0.04, top: .5 * bulk, bot: .44 * bulk, w: .5 * bulk, ridge: .03 }, { x: -0.3, y: hy + 0.05, top: .66 * bulk, bot: .58 * bulk, w: .66 * bulk, ridge: .03 },
    { x: 0.35, y: hy + 0.02, top: .68 * bulk, bot: .64 * bulk, w: .7 * bulk, ridge: .03 }, { x: 0.95, y: hy - 0.02, top: .58 * bulk, bot: .58 * bulk, w: .6 * bulk, ridge: .02 },
    { x: 1.0 + 0.4 * nk, y: hy - 0.04 + (o.neckUp || 0) * 0.5, top: .38, bot: .4, w: .4 }
  ];
  let headKeys;
  const n0 = 1.0 + 0.4 * nk, hY = hy - 0.02 + (o.neckUp || 0);
  if (H === 'cera') headKeys = [{ x: n0 + 0.3, y: hY + 0.02, top: .34, bot: .32, w: .34 }, { x: n0 + 0.6, y: hY, top: .3, bot: .27, w: .29, sq: 2.3, brow: .05 }, { x: n0 + 0.9, y: hY - 0.06, top: .23, bot: .2, w: .2, sq: 2.4 }, { x: n0 + 1.15, y: hY - 0.12, top: .14, bot: .13, w: .12, sq: 2.2 }, { x: n0 + 1.27, y: hY - 0.16, top: .03, bot: .03, w: .03 }];
  else if (H === 'hadro') headKeys = [{ x: n0 + 0.3, y: hY + 0.05, top: .3, bot: .28, w: .28 }, { x: n0 + 0.6, y: hY + 0.02, top: .26, bot: .22, w: .24, sq: 2.3, brow: .04 }, { x: n0 + 0.95, y: hY - 0.06, top: .16, bot: .14, w: .2, sq: 2.6 }, { x: n0 + 1.25, y: hY - 0.1, top: .1, bot: .08, w: .22, sq: 3 }, { x: n0 + 1.36, y: hY - 0.11, top: .02, bot: .02, w: .05 }];
  else if (H === 'mammoth') headKeys = [{ x: n0 + 0.25, y: hY + 0.22, top: .44, bot: .38, w: .42 }, { x: n0 + 0.55, y: hY + 0.2, top: .4, bot: .3, w: .36, sq: 2.3, brow: .05 }, { x: n0 + 0.8, y: hY + 0.05, top: .26, bot: .2, w: .26 }, { x: n0 + 0.95, y: hY - 0.25, top: .14, bot: .14, w: .14 }, { x: n0 + 1.0, y: hY - 0.6, top: .1, bot: .1, w: .1 }, { x: n0 + 1.06, y: hY - 0.82, top: .02, bot: .02, w: .02 }];
  else headKeys = [{ x: n0 + 0.25, y: hY + 0.04, top: .3, bot: .26, w: .28 }, { x: n0 + 0.55, y: hY + 0.02, top: .27, bot: .22, w: .25, sq: 2.3, brow: .05 }, { x: n0 + 0.85, y: hY - 0.05, top: .18, bot: .15, w: .17, sq: 2.4 }, { x: n0 + 1.05, y: hY - 0.09, top: .1, bot: .08, w: .1 }, { x: n0 + 1.13, y: hY - 0.1, top: .02, bot: .02, w: .02 }];
  const keys = bodyKeys.concat(headKeys).map(q => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k, sq: q.sq, brow: (q.brow || 0) * k, ridge: (q.ridge || 0) * k }));
  const L = paint(loft(keys, { rings: Math.round(96 * Q), seg: Math.round(28 * Q), uScale: 1.3 / k, vTiles: 6 }), o.pal, o.pat);
  const bxs = [TX(-2.4), TX(-1.7), TX(-1.15), 0.0, 0.95, n0, n0 + 0.3].map(x => x * k);
  const S = skinMesh(L, bxs.map(x => L.uAtX(x)), 3, skinMat(o.emis));
  const rig = baseRig('quad'); rig.frame.add(S.mesh);
  rig.spine = { root: S.bones[3], tail: [2, 1, 0].map(i => S.bones[i]), neck: [S.bones[4], S.bones[5]], head: S.bones[6] };
  const kit = new Kit(), head = S.bones[6], headO = S.rest[6];
  const s = k;
  // глаза
  const eyes = [], ex = H === 'mammoth' ? n0 + 0.5 : n0 + 0.55;
  const glowEye = (r.sense || 0) >= 2 || o.glowEyes;
  for (const sd of [1, -1]) {
    const e = L.pointAtX(ex * k, sd * 1.15, 0.03 * s), es = (o.eyeK || 1) * 0.06 * s;
    kit.add(head, headO, 'eye', eyeG(), M_ell(e.pos, [es, es, es]), 0x0c0a08);
    const iris = e.pos.clone().addScaledVector(e.dir, es * 0.65);
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.6, es * 0.64, es * 0.6]), o.irisC || (glowEye ? 0xffd23a : 0x9a6a2a));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.45), [es * 0.3, es * 0.3, es * 0.3]), 0x050403);
    eyes.push(e.pos);
    if (H !== 'mammoth') { const n = L.pointAtX((headKeys[headKeys.length - 2].x - 0.04) * k, sd * 0.7, 0.01 * s); kit.add(head, headO, 'acc', UNIT.sphLo, M_ell(n.pos, [0.04 * s, 0.02 * s, 0.03 * s]), 0x14100c); }
  }
  // голова: клюв, щиток, рога, гребень, бивни
  const ivory = 0xe8dcc0, keratin = 0x3a2e24;
  const tip = headKeys[headKeys.length - 1];
  if (H === 'cera' || H === 'plain' || H === 'goat') kit.add(head, headO, 'acc', UNIT.cone, M_spike(new V3((tip.x - 0.12) * k, (tip.y - 0.0) * k, 0), new V3(1, -0.5, 0), 0.2 * s, 0.09 * s), keratin);
  if (H === 'cera') {
    // костяной щиток (фрил) — полусфера-оболочка, повёрнутая назад-вверх
    const frill = new THREE.SphereGeometry(1, 22, 10, 0, PI * 2, 0, 0.95); colorize(frill, mixHex(o.pal.side, o.pal.belly, 0.2), true);
    const fq = new THREE.Quaternion().setFromUnitVectors(Y_UP, new V3(-0.9, 0.42, 0).normalize());
    const fs = (0.62 + stage * 0.06 + (o.frillK || 0)) * s;
    kit.add(head, headO, 'skin2', frill, new THREE.Matrix4().compose(new V3((n0 + 0.15) * k, (hY + 0.25) * k, 0), fq, new V3(fs, fs * 0.55, fs * 1.05)), null);
    // каёмка щитка — маленькие шипы
    for (let i = 0; i < 9 + stage * 2; i++) {
      const bb = -PI * 0.46 + PI * 0.92 * i / (8 + stage * 2);
      const ring = new V3(Math.sin(0.95) * Math.cos(bb), Math.cos(0.95), Math.sin(0.95) * Math.sin(bb));
      const wp = ring.clone().multiply(new V3(fs, fs * 0.55, fs * 1.05)).applyQuaternion(fq).add(new V3((n0 + 0.15) * k, (hY + 0.25) * k, 0));
      const out = ring.clone().setY(0).normalize().applyQuaternion(fq);
      kit.add(head, headO, 'acc', UNIT.coneLo, M_spike(wp, out, 0.12 * s, 0.04 * s), ivory);
    }
    // два рога над глазами и носовой
    const hl = (0.5 + stage * 0.12 + (o.hornK || 0)) * s;
    for (const sd of [1, -1]) { const p = L.pointAtX((n0 + 0.5) * k, sd * 0.55, 0.01 * s); kit.add(head, headO, 'acc', hornGeo(hl, 0.075 * s, -0.25), M_trs(p.pos, sd * 0.15, sd * -0.2, 0.85), ivory); }
    const np = L.pointAtX((n0 + 1.0) * k, 0, 0.01 * s); kit.add(head, headO, 'acc', hornGeo(0.24 * s, 0.06 * s, -0.2), M_trs(np.pos, 0, 0, 1.1), ivory);
  } else if (H === 'hadro') {
    const cp = L.pointAtX((n0 + 0.45) * k, 0, 0.02 * s);
    const crest = bladeGeo([{ x: 0, y: 0, top: .12, bot: .12, w: .05 }, { x: -0.25, y: 0.25, top: .1, bot: .1, w: .045 }, { x: -0.6, y: 0.42, top: .07, bot: .07, w: .035 }, { x: -0.85, y: 0.46, top: .015, bot: .015, w: .015 }].map(q => ({ x: q.x * s, y: q.y * s, top: q.top * s, bot: q.bot * s, w: q.w * s })));
    paint(crest, palette(o.crestC || 0xc8603a), null);
    kit.add(head, headO, 'skin', crest.geo, M_trs(cp.pos, 0, 0, 0, 1), null);
  } else if (H === 'ram') {
    for (const sd of [1, -1]) {
      const p = L.pointAtX((n0 + 0.32) * k, sd * 0.62, 0.03 * s), R = 0.4 * s * (1 + stage * 0.08 + (o.hornK || 0));
      // спираль лежит в плоскости, почти параллельной боку головы, с небольшим разворотом наружу
      kit.add(head, headO, 'acc', spiralHornGeo(R, 0.13 * s * (1 + (o.hornK || 0) * 0.5), 1.0), M_trs(p.pos.clone().add(new V3(0, 0.02 * s, sd * 0.05 * s)), 0, sd * 0.45, 0, new V3(1, 1, sd)), 0xd8cdb2, true);
    }
  } else if (H === 'goat') {
    for (const sd of [1, -1]) { const p = L.pointAtX((n0 + 0.4) * k, sd * 0.4, 0.01 * s); kit.add(head, headO, 'acc', hornGeo(0.32 * s, 0.05 * s, 0.9), M_trs(p.pos, sd * 0.1, sd * -0.15, 2.3), 0xd8ccb0, true); }
  } else if (H === 'mammoth') {
    for (const sd of [1, -1]) {
      const p = L.pointAtX((n0 + 0.8) * k, sd * 2.4, 0.02 * s);
      kit.add(head, headO, 'acc', hornGeo((0.9 + stage * 0.15) * s * (o.tuskK || 1), 0.07 * s, 0.9), M_trs(p.pos, sd * 0.5, sd * 0.25, -0.9), 0xf0e8d0);
      const ep = L.pointAtX((n0 + 0.3) * k, sd * 1.3, 0.02 * s);
      kit.add(head, headO, 'skin', UNIT.sphLo, M_ell(ep.pos, [0.05 * s, 0.22 * s, 0.18 * s]), mulHex(o.pal.side, 0.8), true);
    }
  } else if (H === 'hare') {
    for (const sd of [1, -1]) {
      const p = L.pointAtX((n0 + 0.35) * k, sd * 0.4, 0.0);
      const ear = bladeGeo([{ x: 0, y: 0, top: .07, bot: .07, w: .025 }, { x: 0.05, y: 0.25, top: .085, bot: .085, w: .022 }, { x: 0.02, y: 0.48, top: .06, bot: .06, w: .02 }, { x: 0, y: 0.56, top: .01, bot: .01, w: .01 }].map(q => ({ x: q.x * s, y: q.y * s, top: q.top * s, bot: q.bot * s, w: q.w * s })));
      paint(ear, o.pal, null);
      kit.add(head, headO, 'skin', ear.geo, M_trs(p.pos, sd * 0.25, 0, -0.35, 1), null);
    }
  }
  // ноги: задние массивнее передних
  const legLen = hy * k;
  const legK = (fr) => {
    const w = (fr ? 0.24 : 0.3) * bulk * (o.legW || 1), len = legLen * (fr ? 0.98 : 1.0);
    return [{ x: 0, y: 0.3 * k, top: w * 0.5 * k, bot: w * 0.5 * k, w: w * 0.45 * k }, { x: (fr ? 0.04 : 0.06) * k, y: -len * 0.12, top: w * 1.25 * k, bot: w * 1.35 * k, w: w * 1.0 * k },
      { x: (fr ? 0.02 : 0.09) * k, y: -len * 0.45, top: w * 0.95 * k, bot: w * 1.05 * k, w: w * 0.85 * k }, { x: (fr ? 0.04 : -0.02) * k, y: -len * 0.72, top: w * 0.7 * k, bot: w * 0.75 * k, w: w * 0.68 * k },
      { x: 0.02 * k, y: -len * 0.93, top: w * 0.66 * k, bot: w * 0.72 * k, w: w * 0.68 * k }, { x: 0.05 * k, y: -len * 0.995, top: w * 0.72 * k, bot: w * 0.62 * k, w: w * 0.74 * k }, { x: 0.07 * k, y: -len, top: w * 0.1 * k, bot: w * 0.1 * k, w: w * 0.1 * k }];
  };
  const hoofC = o.hoofC || 0x2e2620;
  for (const fr of [true, false]) for (const sd of [1, -1]) {
    const lx = fr ? 0.88 : -0.42, keysL = legK(fr);
    const leg = addLeg(rig, keysL, new V3(lx * k, (hy + 0.0) * k, sd * 0.36 * k * bulk), [1, 3, 4, 5], o, Q, { front: fr });
    leg.side = sd; leg.ph = (fr ? 0 : PI) + (sd > 0 ? 0 : PI);
    // ногти-копытца
    const w = (fr ? 0.24 : 0.3) * bulk * k * (o.legW || 1);
    for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.55, p = leg.end.clone().add(new V3(Math.cos(a) * w * 0.62, 0.03 * k, Math.sin(a) * w * 0.62)); kit.add(leg.bones[3], leg.rest[3], 'acc', UNIT.sphLo, M_ell(p, [w * 0.24, w * 0.18, w * 0.2]), hoofC); }
    if ((r.climb || 0) >= 1) for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.5, p = leg.end.clone().add(new V3(Math.cos(a) * w * 0.7, 0.04 * k, Math.sin(a) * w * 0.7)); kit.add(leg.bones[3], leg.rest[3], 'acc', UNIT.coneLo, M_spike(p, new V3(1, -0.4, Math.sin(a)), 0.12 * k * (1 + r.climb * 0.15), 0.03 * k), 0xf0e6c8); }
  }
  // пластины (стегозавр), шипы на хвосте, шипы-«Шипы», броня, мех
  const plateC = o.plateC || mixHex(o.pal.side, 0xe08a4a, 0.55);
  const np = o.plates ? 9 : 0;
  for (let i = 0; i < np; i++) {
    const t = np === 1 ? 0.5 : i / (np - 1), x = (-1.9 + 3.0 * t) * k, u = L.uAtX(x), p = L.pointAtU(u, 0, 0.03 * k), bi = nearestBone(S, u);
    const h = (o.plates ? 0.32 + Math.sin(t * PI) * 0.34 : 0.14 + stage * 0.06 + Math.sin(t * PI) * 0.08) * k;
    const plate = bladeGeo([{ x: 0, y: 0, top: h * 0.45, bot: h * 0.45, w: 0.03 * k }, { x: 0, y: h * 0.5, top: h * 0.5, bot: h * 0.42, w: 0.026 * k }, { x: 0, y: h * 0.92, top: h * 0.18, bot: h * 0.14, w: 0.018 * k }, { x: 0, y: h, top: 0.01 * k, bot: 0.01 * k, w: 0.008 * k }], 14, 10);
    paint(plate, palette(plateC), { type: 'bands', amt: 0.3, freq: 2 });
    kit.add(S.bones[bi], S.rest[bi], 'skin', plate.geo, M_trs(p.pos.clone().add(new V3(0, 0, (i % 2 ? 0.05 : -0.05) * k)), 0, 0, 0, 1), null);
  }
  if (o.tailSpikes) for (const sd of [1, -1]) for (let i = 0; i < 2; i++) { const u = L.uAtX(TX(-2.3 + i * 0.25) * k), p = L.pointAtU(u, sd * 0.6, 0), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.3, 0.6, sd), 0.4 * k, 0.05 * k), ivory); }
  const spk = r.spikes || 0;
  for (let i = 0; i < spk * 2; i++) for (const sd of [1, -1]) {
    const u = L.uAtX((-1.2 + i * 0.28) * k), p = L.pointAtU(u, sd * 1.05, 0.01 * k), bi = nearestBone(S, u);
    kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.cone, M_spike(p.pos, p.dir.clone().add(new V3(-0.3, 0.35, 0)), (0.18 + spk * 0.04) * k, 0.045 * k), ivory);
  }
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) {
    const u = L.uAtX((-1.3 + i * 0.22) * k), p = L.pointAtU(u, sd * 0.5, 0.01 * k), bi = nearestBone(S, u);
    kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.sphLo, M_ell(p.pos, [0.17 * k, 0.07 * k, 0.13 * k], new THREE.Quaternion().setFromUnitVectors(Y_UP, p.dir)), mulHex(o.pal.back, 0.75), true);
  }
  if (o.fur) {
    // свисающая шерсть: пряди-конусы по бокам и на шее
    const furC = o.furC || mulHex(o.pal.side, 0.85);
    for (let i = 0; i < 34; i++) for (const sd of [1, -1]) {
      const t = i / 33, u = L.uAtX((-1.25 + 2.7 * t) * k), th = sd * (1.35 + 0.45 * Math.sin(i * 2.3)), p = L.pointAtU(u, th, 0.05 * k), bi = nearestBone(S, u);
      const len = (0.32 + 0.18 * Math.sin(i * 1.7) + 0.1 * Math.sin(t * PI)) * k * (o.furK || 1);
      kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.coneLo, M_spike(p.pos, new V3(sd * 0.12, -1, 0.04 * Math.sin(i)), len, 0.075 * k), mulHex(furC, 0.82 + 0.3 * ((i * 37) % 10) / 10), true);
    }
  }
  if ((r.herd || 0) > 0) for (let i = 0; i < r.herd; i++) { const u = L.uAtX((-0.6 + i * 0.3) * k), p = L.pointAtU(u, 0, -0.02 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'glow', UNIT.sphLo, M_ell(p.pos, [0.07 * k, 0.07 * k, 0.07 * k]), 0xffd35a); }
  if (o.extras) o.extras({ L, S, kit, head, headO, k, s, rig, n0, hY, hy });
  kit.build({ emis: o.emis });
  const top = L.pointAtX((n0 + 0.45) * k, 0, 0);
  setHeadAnch(rig, head, top.pos.clone().sub(headO), eyes[0].clone().sub(headO), new V3(n0 * k, (hY + 0.1) * k, 0));
  rig.walkAmp = 0.34; rig.gait = 'quad'; rig.k = k;
  rig.tagH = Math.max(top.pos.y, (hy + 0.7) * k) + 0.3;
  return rig;
}

// ======================================================================== ПЛАН ТЕЛА 3: ПТЕРОЗАВР
function pterosaur(o) {
  const k = o.k || 1, r = o.r || {}, stage = o.stage || 0, Q = (o.q || 1) * qMul(), bk = o.beakK || 1; _eyeQ = Q;
  const sk = (q) => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k, sq: q.sq, brow: (q.brow || 0) * k });
  const keys = [
    { x: -1.05, y: 1.34, top: .01, bot: .01, w: .01 }, { x: -0.9, y: 1.32, top: .04, bot: .04, w: .04 }, { x: -0.6, y: 1.29, top: .12, bot: .12, w: .13 },
    { x: -0.3, y: 1.28, top: .24, bot: .22, w: .25 }, { x: 0.05, y: 1.33, top: .29, bot: .29, w: .3 }, { x: 0.38, y: 1.42, top: .22, bot: .22, w: .23 },
    { x: 0.58, y: 1.62, top: .12, bot: .12, w: .12 }, { x: 0.7, y: 1.84, top: .1, bot: .1, w: .1 }, { x: 0.84, y: 1.98, top: .16, bot: .13, w: .15, brow: .02 },
    { x: 0.84 + 0.2 * bk, y: 2.01, top: .13, bot: .1, w: .12, sq: 2.3 }, { x: 0.84 + 0.5 * bk, y: 1.99, top: .075, bot: .06, w: .07, sq: 2.3 },
    { x: 0.84 + 0.86 * bk, y: 1.96, top: .035, bot: .03, w: .035 }, { x: 0.84 + 1.1 * bk, y: 1.94, top: .006, bot: .006, w: .006 }
  ].map(sk);
  const L = paint(loft(keys, { rings: Math.round(90 * Q), seg: Math.round(24 * Q), uScale: 2 / k, vTiles: 5 }), o.pal, o.pat);
  const bx = [-0.75, 0.0, 0.55, 0.72, 0.86].map(x => x * k);
  const S = skinMesh(L, bx.map(x => L.uAtX(x)), 1, skinMat(o.emis));
  const rig = baseRig('ptero'); rig.frame.add(S.mesh);
  rig.spine = { root: S.bones[1], tail: [S.bones[0]], neck: [S.bones[2], S.bones[3]], head: S.bones[4] };
  const kit = new Kit(), head = S.bones[4], headO = S.rest[4], s = k;
  const glowEye = (r.sense || 0) >= 2 || o.glowEyes, eyes = [];
  for (const sd of [1, -1]) {
    const e = L.pointAtX(0.88 * k, sd * 1.2, 0.02 * s), es = 0.042 * s;
    kit.add(head, headO, 'eye', eyeG(), M_ell(e.pos, [es, es, es]), 0x0c0a08);
    const iris = e.pos.clone().addScaledVector(e.dir, es * 0.6);
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.62, es * 0.62, es * 0.62]), o.irisC || (glowEye ? 0xffd23a : 0xe0a030));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.42), [es * 0.28, es * 0.28, es * 0.28]), 0x050403);
    eyes.push(e.pos);
  }
  // клюв (роговой чехол) и нижняя челюсть
  const beakC = o.beakC || 0xd9a640;
  const bL = paint(loft([{ x: 0.95, y: 1.995, top: .1, bot: .075, w: .1 }, { x: 0.84 + 0.5 * bk, y: 1.99, top: .078, bot: .062, w: .072 }, { x: 0.84 + 0.86 * bk, y: 1.962, top: .037, bot: .032, w: .037 }, { x: 0.84 + 1.12 * bk, y: 1.94, top: .006, bot: .006, w: .006 }].map(sk), { rings: 28, seg: 16 }), palette(beakC, { bellyK: 0.2, ns: 9 }), null);
  kit.add(head, headO, 'acc', bL.geo, new THREE.Matrix4(), null);
  const hinge = new V3(0.86 * k, 1.93 * k, 0);
  const jawPivot = new THREE.Group(); jawPivot.position.copy(hinge).sub(headO); head.add(jawPivot);
  const jawInner = new THREE.Group(); jawInner.position.copy(hinge).negate(); jawPivot.add(jawInner);
  const J = paint(loft([{ x: 0.86, y: 1.93, top: .04, bot: .06, w: .1 }, { x: 0.84 + 0.4 * bk, y: 1.9, top: .03, bot: .04, w: .06 }, { x: 0.84 + 0.85 * bk, y: 1.89, top: .02, bot: .025, w: .03 }, { x: 0.84 + 1.05 * bk, y: 1.895, top: .004, bot: .004, w: .004 }].map(sk), { rings: 24, seg: 12 }), palette(mulHex(beakC, 0.9), { bellyK: 0.2 }), null);
  const jm = new THREE.Mesh(J.geo, MAT.acc); jm.castShadow = true; jawInner.add(jm);
  rig.jaw = jawPivot; rig.jawBase = -0.02;
  // гребень
  const cr = 1 + (r.screech || 0) * 0.18 + stage * 0.15 + (o.crestK || 0);
  if (o.crest !== false) {
    const cp = L.pointAtX(0.86 * k, 0, 0.01 * s);
    const crest = bladeGeo([{ x: 0, y: 0, top: .09, bot: .09, w: .016 }, { x: -0.2, y: 0.16, top: .11, bot: .09, w: .014 }, { x: -0.48, y: 0.34, top: .07, bot: .05, w: .012 }, { x: -0.62, y: 0.42, top: .01, bot: .01, w: .006 }].map(q => ({ x: q.x * s * cr, y: q.y * s * cr, top: q.top * s * cr, bot: q.bot * s * cr, w: q.w * s })), 18, 10);
    paint(crest, palette(o.crestC || 0xc8463a, { bellyK: 0.3 }), { type: 'bands', amt: 0.4, freq: 2.5 });
    kit.add(head, headO, 'skin', crest.geo, M_trs(cp.pos, 0, 0, 0, 1), null);
  }
  if ((r.screech || 0) >= 2) { const p = L.pointAtX(0.8 * k, PI, 0.02 * s); kit.add(head, headO, 'skin', UNIT.sph, M_ell(p.pos.clone().add(new V3(0.05 * s, -0.03 * s, 0)), [0.12 * s, 0.09 * s, 0.08 * s]), 0xff8a6a, true); }
  // ноги
  const legKeys = [{ x: 0, y: 0.06, top: .07, bot: .07, w: .07 }, { x: 0.03, y: -0.3, top: .065, bot: .065, w: .06 }, { x: -0.02, y: -0.66, top: .042, bot: .042, w: .04 }, { x: 0.04, y: -1.0, top: .035, bot: .035, w: .035 }, { x: 0.1, y: -1.1, top: .04, bot: .03, w: .045 }, { x: 0.14, y: -1.12, top: .01, bot: .01, w: .01 }].map(q => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k }));
  const tal = r.talons || 0;
  for (const sd of [1, -1]) {
    const leg = addLeg(rig, legKeys, new V3(-0.12 * k, 1.12 * k, sd * 0.15 * k), [1, 2, 3, 4], o, Q, { rings: 30 });
    leg.side = sd; leg.ph = sd > 0 ? 0 : PI;
    addToes(kit, leg, o, 3, 0.16 * k, 0.025 * k, 0x1e1a16, (0.05 + tal * 0.025) * k, 1.0);
  }
  // крылья: перепонка + «рука» по передней кромке, две кости (плечо и запястье)
  const span = (1.6 + (r.wings || 0) * 0.14 + stage * 0.2) * k * (o.spanK || 1), chord = 0.9 * k * (o.chordK || 1);
  const memC = o.memC || mixHex(o.pal.side, o.pal.belly, 0.25), memC2 = (r.altitude || 0) >= 3 ? mixHex(memC, 0xffffff, 0.3) : (o.memTip || mulHex(o.pal.side, 0.8));
  for (const sd of [1, -1]) rig.wings.push(wing(rig.frame, new V3(0.28 * k, 1.44 * k, sd * 0.2 * k), sd, span, chord, o.pal, memC, memC2, o.emis, Q));
  if ((r.hide || 0) > 0) for (let i = 0; i < r.hide * 2; i++) { const u = L.uAtX((-0.3 + i * 0.12) * k), p = L.pointAtU(u, 0, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.sphLo, M_ell(p.pos, [0.08 * k, 0.04 * k, 0.07 * k]), mulHex(o.pal.back, 0.7), true); }
  if (stage >= 1) for (let i = 0; i < 2 + stage; i++) { const u = L.uAtX((-0.4 + i * 0.16) * k), p = L.pointAtU(u, 0, 0.005 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.4, 1, 0), 0.1 * k, 0.025 * k), mulHex(o.pal.back, 0.8)); }
  if (o.extras) o.extras({ L, S, kit, head, headO, k, s, rig });
  kit.build({ emis: o.emis });
  const top = L.pointAtX(0.95 * k, 0, 0);
  setHeadAnch(rig, head, top.pos.clone().sub(headO), eyes[0].clone().sub(headO), new V3(0.62 * k, 1.66 * k, 0));
  rig.walkAmp = 0.35; rig.gait = 'biped'; rig.flies = true; rig.k = k;
  rig.tagH = 2.15 * k + 0.25;
  return rig;
}
// перепончатое крыло: сетка s (от плеча к кончику) × t (от передней кромки к задней) + трубка-«рука»
function wing(parent, at, side, span, chord, pal, memC, tipC, emis, Q) {
  const NS = Math.round(16 * (Q || 1)), NT = 7, RS = 6;
  const pos = [], col = [], uv = [], idx = [], sk = [], sw = [];
  const c1 = hx(memC), c2 = hx(tipC), cc = new THREE.Color(), arm = hx(pal.back);
  const LE = (s) => new V3(0.12 * chord - 0.32 * chord * Math.pow(s, 1.6), 0.08 * span * Math.sin(PI * s) * 0.4, side * span * s);
  const ch = (s) => chord * Math.pow(1 - s, 0.75) + 0.02 * chord;
  const wgt = (s) => sstep(0.35, 0.55, s);
  // перепонка
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, le = LE(s), c = ch(s);
    for (let j = 0; j <= NT; j++) {
      const t = j / NT, p = le.clone().add(new V3(-c * t, -0.05 * chord * Math.sin(PI * t) * Math.sin(PI * Math.min(1, s * 1.3)), 0));
      pos.push(p.x, p.y, p.z); uv.push(s * 3, t * 2);
      cc.copy(c1).lerp(c2, sstep(0.3, 1, s) * 0.8).multiplyScalar(0.86 + 0.14 * (0.5 + 0.5 * Math.cos(t * PI * 6)));
      col.push(cc.r, cc.g, cc.b);
      const w = wgt(s); sk.push(0, 1, 0, 0); sw.push(1 - w, w, 0, 0);
    }
  }
  const cols = NT + 1;
  for (let i = 0; i < NS; i++) for (let j = 0; j < NT; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
  // трубка-«рука» по кромке
  const base = pos.length / 3;
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, le = LE(s), rr = (0.055 * (1 - s) + 0.012) * chord / 0.9;
    for (let j = 0; j < RS; j++) {
      const a = j / RS * PI * 2, p = le.clone().add(new V3(Math.cos(a) * rr, Math.sin(a) * rr, 0));
      pos.push(p.x, p.y, p.z); uv.push(s * 4, j / RS); col.push(arm.r, arm.g, arm.b);
      const w = wgt(s); sk.push(0, 1, 0, 0); sw.push(1 - w, w, 0, 0);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < RS; j++) { const a = base + i * RS + j, b = base + i * RS + (j + 1) % RS, c = a + RS, d = b + RS; if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sk, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const b0 = new THREE.Bone(), b1 = new THREE.Bone(); b1.position.copy(LE(0.45)); b0.add(b1);
  const mesh = new THREE.SkinnedMesh(geo, skinMat(emis, true)); mesh.add(b0); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([b0, b1]));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.6;
  mesh.castShadow = true;
  const g = new THREE.Group(); g.position.copy(at); g.add(mesh); parent.add(g);
  return { g, b0, b1, side, span };
}

// ======================================================================== ПЛАН ТЕЛА 4: МОРСКОЙ (мозазавр, плезиозавр, рыба, угорь)
function marine(o) {
  const k = o.k || 1, r = o.r || {}, stage = o.stage || 0, Q = (o.q || 1) * qMul(), bulk = o.bulk || 1; _eyeQ = Q;
  const sk = (q) => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k, sq: q.sq, brow: (q.brow || 0) * k, ridge: (q.ridge || 0) * k });
  const keys = (o.keys || [
    { x: -3.1, y: 0.62, top: .01, bot: .01, w: .01 }, { x: -2.9, y: 0.62, top: .06, bot: .06, w: .04 }, { x: -2.4, y: 0.64, top: .14, bot: .14, w: .11 },
    { x: -1.8, y: 0.68, top: .25, bot: .24, w: .2, ridge: .02 }, { x: -1.1, y: 0.74, top: .38 * bulk, bot: .36 * bulk, w: .32 * bulk, ridge: .03 }, { x: -0.4, y: 0.8, top: .48 * bulk, bot: .46 * bulk, w: .42 * bulk, ridge: .03 },
    { x: 0.3, y: 0.84, top: .5 * bulk, bot: .5 * bulk, w: .46 * bulk, ridge: .03 }, { x: 0.9, y: 0.86, top: .42, bot: .42, w: .38, ridge: .02 }, { x: 1.35, y: 0.9, top: .32, bot: .3, w: .3 },
    { x: 1.7, y: 0.93, top: .3, bot: .24, w: .28, sq: 2.3, brow: .04 }, { x: 2.1, y: 0.9, top: .22, bot: .16, w: .2, sq: 2.5 }, { x: 2.5, y: 0.86, top: .14, bot: .1, w: .13, sq: 2.4 },
    { x: 2.8, y: 0.84, top: .06, bot: .05, w: .06 }, { x: 2.9, y: 0.84, top: .01, bot: .01, w: .01 }
  ]).map(sk);
  const L = paint(loft(keys, { rings: Math.round((o.rings || 110) * Q), seg: Math.round((o.seg || 26) * Q), uScale: 1.4 / k, vTiles: 6 }), o.pal, o.pat);
  const bxs = (o.bones || [-2.6, -2.0, -1.4, -0.8, 0.2, 1.3, 1.72]).map(x => x * k);
  const rootI = o.rootI !== undefined ? o.rootI : 4;
  const S = skinMesh(L, bxs.map(x => L.uAtX(x)), rootI, skinMat(o.emis));
  const rig = baseRig(o.kind || 'marine'); rig.frame.add(S.mesh);
  const nb = bxs.length;
  rig.spine = { root: S.bones[rootI], tail: [], neck: [], head: S.bones[nb - 1] };
  for (let i = rootI - 1; i >= 0; i--) rig.spine.tail.push(S.bones[i]);
  for (let i = rootI + 1; i < nb - 1; i++) rig.spine.neck.push(S.bones[i]);
  const kit = new Kit(), head = S.bones[nb - 1], headO = S.rest[nb - 1], s = k;
  const hx0 = o.headX || 1.72, eyeX = o.eyeX || 1.85, eyes = [];
  const glowEye = (r.sense || 0) >= 2 || o.glowEyes;
  for (const sd of [1, -1]) {
    const e = L.pointAtX(eyeX * k, sd * 1.05, 0.02 * s), es = (o.eyeK || 1) * 0.06 * s;
    kit.add(head, headO, 'eye', eyeG(), M_ell(e.pos, [es, es, es]), 0x0c0a08);
    const iris = e.pos.clone().addScaledVector(e.dir, es * 0.62);
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.62, es * 0.66, es * 0.62]), o.irisC || (glowEye ? 0x7af0ff : 0xd9b23a));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.45), [es * 0.18, es * 0.4, es * 0.18]), 0x050403);
    eyes.push(e.pos);
  }
  if (o.jaw !== false) {
    const hinge = new V3((hx0 - 0.05) * k, (o.hingeY || 0.8) * k, 0);
    const jawPivot = new THREE.Group(); jawPivot.position.copy(hinge).sub(headO); head.add(jawPivot);
    const jawInner = new THREE.Group(); jawInner.position.copy(hinge).negate(); jawPivot.add(jawInner);
    const jk = (o.jawKeys || [{ x: hx0 - 0.05, y: 0.8, top: .07, bot: .12, w: .24, sq: 2.2 }, { x: 2.05, y: 0.76, top: .07, bot: .11, w: .2, sq: 2.3 }, { x: 2.45, y: 0.75, top: .05, bot: .08, w: .13, sq: 2.4 }, { x: 2.72, y: 0.76, top: .03, bot: .04, w: .06 }, { x: 2.8, y: 0.765, top: .005, bot: .005, w: .005 }]).map(sk);
    const J = paint(loft(jk, { rings: 36, seg: 18 }), o.pal, null);
    const jm = new THREE.Mesh(J.geo, skinMat(o.emis)); jm.castShadow = true; jawInner.add(jm);
    rig.jaw = jawPivot; rig.jawBase = -0.03;
    const sh = r.shock || 0, tc = sh >= 2 ? 0x9af4ff : 0xece0c2;
    if (o.teeth !== false) for (const sd of [1, -1]) {
      for (let x = hx0 + 0.15; x < (o.snoutX || 2.65); x += 0.11) { const p = L.pointAtX(x * k, sd * 2.25, 0.02 * s); kit.add(head, headO, 'acc', UNIT.coneLo, M_spike(p.pos, new V3(-0.1, -1, sd * -0.08), (0.07 + sh * 0.01) * s, 0.022 * s), tc); }
      for (let x = hx0 + 0.2; x < (o.snoutX || 2.65) - 0.05; x += 0.12) { const p = J.pointAtX(x * k, sd * 0.8, 0.015 * s); kit.add(jawInner, null, 'acc', UNIT.coneLo, M_spike(p.pos, new V3(-0.1, 1, sd * -0.08), 0.06 * s, 0.02 * s), tc); }
    }
    kit.add(jawInner, null, 'acc', UNIT.sphLo, M_ell(new V3(((hx0 + (o.snoutX || 2.65)) / 2) * k, (o.hingeY || 0.8) * k - 0.02 * k, 0), [0.4 * s, 0.03 * s, 0.12 * s]), 0x8a3a3a);
  }
  // хвостовой плавник (лопасть), спинной плавник
  const fs = 1 + (r.fins || 0) * 0.12 + (o.finK || 0);
  const finC = o.finC || mixHex(o.pal.back, o.pal.side, 0.3);
  if (o.fluke !== false) {
    const tailU = L.uAtX((o.flukeX || -2.75) * k), tp = L.pointAtU(tailU, 0, 0), bi = 0;
    for (const dirY of [1, -1]) {
      const fl = bladeGeo([{ x: 0, y: 0, top: .16, bot: .1, w: .04 }, { x: -0.22, y: dirY * 0.32, top: .14, bot: .07, w: .03 }, { x: -0.48, y: dirY * 0.6, top: .07, bot: .03, w: .02 }, { x: -0.6, y: dirY * 0.72, top: .01, bot: .01, w: .008 }].map(q => ({ x: q.x * k * fs * (o.flukeK || 1), y: q.y * k * fs * (o.flukeK || 1), top: q.top * k * fs, bot: q.bot * k * fs, w: q.w * k })), 18, 10);
      paint(fl, palette(finC, { bellyK: 0.2 }), null);
      kit.add(S.bones[bi], S.rest[bi], 'skin', fl.geo, M_trs(tp.pos.clone().add(new V3(0.12 * k, 0, 0)), 0, 0, 0, 1), null);
    }
  }
  if (o.dorsal !== false) {
    const du = L.uAtX((o.dorsalX || -0.5) * k), dp = L.pointAtU(du, 0, 0.02 * k), bi = nearestBone(S, du), dh = (o.dorsalK || 1) * (0.3 + (r.fins || 0) * 0.04 + stage * 0.08) * k;
    const df = bladeGeo([{ x: 0.25 * k, y: 0, top: .02 * k, bot: .02 * k, w: .03 * k }, { x: 0, y: dh * 0.5, top: dh * 0.35, bot: dh * 0.25, w: .025 * k }, { x: -0.25 * k, y: dh, top: .02 * k, bot: .02 * k, w: .012 * k }], 16, 10);
    paint(df, palette(finC, { bellyK: 0.15 }), null);
    kit.add(S.bones[bi], S.rest[bi], 'skin', df.geo, M_trs(dp.pos, 0, 0, 0, 1), null);
  }
  // ласты
  rig.flipAmp = o.flipAmp || 0.3;
  if (o.flippers !== false) for (const [fx, front] of [[o.frontX || 0.75, true], [o.hindX || -1.1, false]]) for (const sd of [1, -1]) {
    const u = L.uAtX(fx * k), p = L.pointAtU(u, sd * 1.75, 0.04 * k), bi = nearestBone(S, u);
    const len = (front ? 0.75 : 0.55) * k * fs * (o.flipK || 1), wd = (front ? 0.2 : 0.16) * k * fs * (o.flipK || 1);
    const fg = bladeGeo([{ x: 0, y: 0, top: wd * 0.7, bot: wd * 0.55, w: 0.13 * k }, { x: len * 0.3, y: 0, top: wd * 0.9, bot: wd * 0.7, w: 0.1 * k }, { x: len * 0.62, y: 0, top: wd * 0.85, bot: wd * 0.62, w: 0.065 * k }, { x: len * 0.88, y: 0, top: wd * 0.5, bot: wd * 0.36, w: 0.04 * k }, { x: len, y: 0, top: 0.02 * k, bot: 0.02 * k, w: 0.015 * k }], 18, 12);
    paint(fg, palette(finC, { bellyK: 0.35 }), null);
    // пластина в плоскости xy → поворачиваем, чтобы смотрела вбок (вдоль ±z) и лежала горизонтально
    const piv = new THREE.Group(); piv.position.copy(p.pos).sub(S.rest[bi]); S.bones[bi].add(piv);
    const mesh = new THREE.Mesh(fg.geo, skinMat(o.emis)); mesh.castShadow = true;
    mesh.rotation.order = 'YXZ'; mesh.rotation.set(PI / 2, -sd * (PI / 2 + (front ? 0.35 : 0.55)), -0.2);
    piv.add(mesh); piv.rotation.x = -sd * 0.25;
    rig.flippers.push({ g: piv, side: sd, front });
  }
  // электричество, жабры, гребень по стадиям
  const sh = r.shock || 0;
  for (let i = 0; i < sh * 3; i++) for (const sd of [1, -1]) { const u = L.uAtX((-1.6 + i * 0.22) * k), p = L.pointAtU(u, sd * 0.7, -0.005 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'glow', UNIT.sphLo, M_ell(p.pos, [0.05 * k, 0.05 * k, 0.05 * k]), 0x7ad8ff); }
  for (let i = 0; i < (r.gills || 0) * 2; i++) for (const sd of [1, -1]) { const u = L.uAtX((1.38 - i * 0.07) * k), p = L.pointAtU(u, sd * 1.6, -0.005 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.sphLo, M_ell(p.pos, [0.012 * k, 0.12 * k, 0.03 * k]), mulHex(o.pal.back, 0.5)); }
  const nr = o.ridge !== undefined ? o.ridge : (stage >= 2 ? 4 + stage * 2 : 0);
  for (let i = 0; i < nr; i++) { const u = L.uAtX((0.9 - i * 0.3) * k), p = L.pointAtU(u, 0, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.4, 1, 0), (0.12 + stage * 0.04) * k, 0.035 * k), mulHex(o.pal.back, 0.7)); }
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) { const u = L.uAtX((-1.0 + i * 0.25) * k), p = L.pointAtU(u, sd * 0.5, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.sphLo, M_ell(p.pos, [0.15 * k, 0.06 * k, 0.12 * k], new THREE.Quaternion().setFromUnitVectors(Y_UP, p.dir)), mulHex(o.pal.back, 0.7), true); }
  if (o.extras) o.extras({ L, S, kit, head, headO, k, s, rig });
  kit.build({ emis: o.emis });
  const top = L.pointAtX((eyeX - 0.05) * k, 0, 0);
  setHeadAnch(rig, head, top.pos.clone().sub(headO), eyes[0].clone().sub(headO), new V3((hx0 - 0.4) * k, 0.95 * k, 0));
  rig.walkAmp = 0; rig.gait = 'swim'; rig.aquatic = true; rig.k = k;
  rig.tagH = top.pos.y + 0.3;
  return rig;
}

// ======================================================================== ПЛАН 5: КРОКОДИЛ / ЯЩЕРИЦА (низкое тело, расставленные лапы)
function sprawler(o) {
  const k = o.k || 1, Q = (o.q || 1) * qMul(), snout = o.snoutK || 1, tl = o.tailK || 1; _eyeQ = Q;
  const sk = (q) => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k, sq: q.sq, brow: (q.brow || 0) * k, ridge: (q.ridge || 0) * k });
  const keys = [
    { x: -2.6 * tl, y: 0.36, top: .01, bot: .01, w: .01 }, { x: -2.4 * tl, y: 0.37, top: .05, bot: .04, w: .05 }, { x: -1.7 * tl, y: 0.4, top: .14, bot: .12, w: .14, ridge: .03 },
    { x: -1.0, y: 0.45, top: .24, bot: .2, w: .28, ridge: .04 }, { x: -0.3, y: 0.5, top: .3, bot: .26, w: .46, ridge: .04, sq: 2.4 }, { x: 0.45, y: 0.5, top: .3, bot: .26, w: .44, ridge: .04, sq: 2.4 },
    { x: 1.0, y: 0.48, top: .22, bot: .2, w: .3 }, { x: 1.3, y: 0.48, top: .18, bot: .14, w: .26, sq: 2.6, brow: .04 },
    { x: 1.3 + 0.4 * snout, y: 0.45, top: .12, bot: .08, w: .2, sq: 2.8 }, { x: 1.3 + 0.85 * snout, y: 0.43, top: .08, bot: .06, w: .14, sq: 2.8 },
    { x: 1.3 + 1.05 * snout, y: 0.43, top: .05, bot: .04, w: .1 }, { x: 1.3 + 1.12 * snout, y: 0.43, top: .01, bot: .01, w: .01 }
  ].map(sk);
  const L = paint(loft(keys, { rings: Math.round(100 * Q), seg: Math.round(26 * Q), uScale: 1.5 / k, vTiles: 6 }), o.pal, o.pat);
  const bx = [-2.1 * tl, -1.5 * tl, -0.9, 0.05, 0.95, 1.32].map(x => x * k);
  const S = skinMesh(L, bx.map(x => L.uAtX(x)), 3, skinMat(o.emis));
  const rig = baseRig('croc'); rig.frame.add(S.mesh);
  rig.spine = { root: S.bones[3], tail: [2, 1, 0].map(i => S.bones[i]), neck: [S.bones[4]], head: S.bones[5] };
  const kit = new Kit(), head = S.bones[5], headO = S.rest[5], s = k, eyes = [];
  for (const sd of [1, -1]) {
    const e = L.pointAtX(1.36 * k, sd * 0.6, 0.0), es = 0.06 * s * (o.eyeK || 1);
    kit.add(head, headO, 'eye', eyeG(), M_ell(e.pos, [es, es, es]), 0x0c0a08);
    const iris = e.pos.clone().addScaledVector(e.dir, es * 0.6);
    kit.add(head, headO, o.glowEyes ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.6, es * 0.6, es * 0.6]), o.irisC || 0xd9b23a);
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.45), [es * 0.12, es * 0.36, es * 0.12]), 0x050403);
    eyes.push(e.pos);
    if (o.teeth !== false) for (let x = 1.45; x < 1.3 + 1.0 * snout; x += 0.1) { const p = L.pointAtX(x * k, sd * 2.0, 0.01 * s); kit.add(head, headO, 'acc', UNIT.coneLo, M_spike(p.pos, new V3(0, -1, sd * 0.3), 0.06 * s, 0.018 * s), 0xece0c2); }
  }
  const hinge = new V3(1.25 * k, 0.4 * k, 0);
  const jawPivot = new THREE.Group(); jawPivot.position.copy(hinge).sub(headO); head.add(jawPivot);
  const jawInner = new THREE.Group(); jawInner.position.copy(hinge).negate(); jawPivot.add(jawInner);
  const J = paint(loft([{ x: 1.2, y: 0.42, top: .05, bot: .09, w: .26, sq: 2.4 }, { x: 1.3 + 0.5 * snout, y: 0.38, top: .04, bot: .06, w: .17, sq: 2.6 }, { x: 1.3 + 1.0 * snout, y: 0.38, top: .03, bot: .04, w: .1 }, { x: 1.3 + 1.08 * snout, y: 0.385, top: .005, bot: .005, w: .005 }].map(sk), { rings: 30, seg: 16 }), o.pal, null);
  const jm = new THREE.Mesh(J.geo, skinMat(o.emis)); jm.castShadow = true; jawInner.add(jm);
  rig.jaw = jawPivot; rig.jawBase = -0.02;
  // остеодермы (костные щитки) рядами по спине
  if (o.scutes !== false) for (let i = 0; i < 16; i++) for (const sd of [1, -1, 0]) {
    if (sd === 0 && i % 2) continue;
    const u = L.uAtX((-2.0 * tl + i * (3.0 / 15)) * k), p = L.pointAtU(u, sd * 0.35, 0.005 * k), bi = nearestBone(S, u);
    kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.coneLo, M_spike(p.pos, p.dir, 0.07 * k, 0.05 * k), mulHex(o.pal.back, 0.75), true);
  }
  // расставленные лапы
  const legKeys = (fr) => [{ x: 0, y: 0.08, top: .1, bot: .1, w: .1 }, { x: 0.05, y: -0.12, top: .1, bot: .11, w: .09 }, { x: fr ? 0.02 : -0.06, y: -0.28, top: .07, bot: .07, w: .065 }, { x: 0.05, y: -0.4, top: .065, bot: .06, w: .07 }, { x: 0.1, y: -0.44, top: .01, bot: .01, w: .01 }].map(q => ({ x: q.x * k * (o.legK || 1), y: q.y * k * (o.legK || 1), top: q.top * k * (o.legW || 1), bot: q.bot * k * (o.legW || 1), w: q.w * k * (o.legW || 1) }));
  for (const fr of [true, false]) for (const sd of [1, -1]) {
    const lx = fr ? 0.7 : -0.5;
    const leg = addLeg(rig, legKeys(fr), new V3(lx * k, 0.42 * k, sd * 0.36 * k), [1, 2, 3, 3], o, Q, { splay: -sd * 0.65, front: fr, rings: 26 });
    leg.side = sd; leg.ph = (fr ? 0 : PI) + (sd > 0 ? 0 : PI);
    addToes(kit, leg, o, 4, 0.12 * k, 0.025 * k, 0x26201a, 0.04 * k, 1.4);
  }
  if (o.extras) o.extras({ L, S, kit, head, headO, k, s, rig });
  kit.build({ emis: o.emis });
  const top = L.pointAtX(1.35 * k, 0, 0);
  setHeadAnch(rig, head, top.pos.clone().sub(headO), eyes[0].clone().sub(headO), new V3(1.0 * k, 0.5 * k, 0));
  rig.walkAmp = 0.5; rig.gait = 'quad'; rig.k = k;
  rig.tagH = 0.9 * k + 0.4;
  return rig;
}

// ======================================================================== ПЛАН 6: ЛЯГУШКА
function frog(o) {
  const k = o.k || 1;
  const sk = (q) => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k, sq: q.sq, brow: (q.brow || 0) * k });
  const keys = [{ x: -0.42, y: 0.42, top: .01, bot: .01, w: .01 }, { x: -0.38, y: 0.42, top: .1, bot: .1, w: .12 }, { x: -0.22, y: 0.42, top: .24, bot: .2, w: .3 }, { x: 0.0, y: 0.44, top: .27, bot: .22, w: .34 }, { x: 0.2, y: 0.46, top: .23, bot: .18, w: .33, sq: 2.3, brow: .05 }, { x: 0.36, y: 0.44, top: .15, bot: .12, w: .26, sq: 2.6 }, { x: 0.44, y: 0.42, top: .07, bot: .06, w: .15 }, { x: 0.47, y: 0.42, top: .01, bot: .01, w: .01 }].map(sk);
  const L = paint(loft(keys, { rings: 70, seg: 32, uScale: 3 / k, vTiles: 4 }), o.pal, o.pat);
  const rig = baseRig('frog');
  const body = new THREE.Mesh(L.geo, skinMat(o.emis)); body.castShadow = true; rig.frame.add(body);
  const kit = new Kit(), s = k, eyes = [];
  for (const sd of [1, -1]) {
    const e = L.pointAtX(0.22 * k, sd * 0.55, -0.05 * s), es = 0.09 * s;
    kit.add(rig.frame, null, 'skin', UNIT.sph, M_ell(e.pos, [es * 1.15, es * 1.15, es * 1.15]), o.pal.side, true);
    const ec = e.pos.clone().addScaledVector(e.dir, es * 0.45);
    kit.add(rig.frame, null, 'eye', UNIT.sph, M_ell(ec, [es * 0.85, es * 0.85, es * 0.85]), o.irisC || 0xd9a830);
    const fw = new V3(0.75, 0.35, sd * 0.55).normalize();
    kit.add(rig.frame, null, 'eye', UNIT.sphLo, M_ell(ec.clone().addScaledVector(fw, es * 0.72), [es * 0.42, es * 0.2, es * 0.42], new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), fw)), 0x080604);
    eyes.push(e.pos);
  }
  // мощные задние лапы (сложены), тонкие передние
  const legP = [];
  for (const sd of [1, -1]) {
    const hind = new THREE.Group(); hind.position.set(-0.2 * k, 0.32 * k, sd * 0.28 * k); rig.frame.add(hind);
    const th = paint(loft([{ x: 0, y: 0, top: .13, bot: .13, w: .11 }, { x: 0.2, y: -0.05, top: .12, bot: .1, w: .1 }, { x: 0.3, y: -0.12, top: .07, bot: .07, w: .07 }].map(sk), { rings: 16, seg: 12 }), o.pal, null);
    const sh = paint(loft([{ x: 0.3, y: -0.12, top: .07, bot: .07, w: .07 }, { x: 0.0, y: -0.22, top: .06, bot: .06, w: .06 }, { x: -0.1, y: -0.28, top: .04, bot: .04, w: .04 }, { x: 0.2, y: -0.3, top: .03, bot: .02, w: .08 }, { x: 0.32, y: -0.3, top: .01, bot: .01, w: .02 }].map(sk), { rings: 20, seg: 12 }), o.pal, null);
    kit.add(hind, null, 'skin', th.geo, new THREE.Matrix4(), null); kit.add(hind, null, 'skin', sh.geo, new THREE.Matrix4(), null);
    const front = new THREE.Group(); front.position.set(0.2 * k, 0.3 * k, sd * 0.22 * k); rig.frame.add(front);
    const fl = paint(loft([{ x: 0, y: 0, top: .05, bot: .05, w: .05 }, { x: 0.04, y: -0.18, top: .035, bot: .035, w: .035 }, { x: 0.1, y: -0.28, top: .02, bot: .02, w: .05 }, { x: 0.14, y: -0.29, top: .005, bot: .005, w: .01 }].map(sk), { rings: 14, seg: 10 }), o.pal, null);
    kit.add(front, null, 'skin', fl.geo, new THREE.Matrix4(), null);
    legP.push({ hind, front, side: sd });
  }
  if (o.extras) o.extras({ L, kit, k, s, rig });
  kit.build({ emis: o.emis });
  rig.frogLegs = legP;
  const hp = new THREE.Group(); rig.frame.add(hp);
  setHeadAnch(rig, hp, new V3(0.15 * k, 0.68 * k, 0), eyes[0], new V3(0.25 * k, 0.5 * k, 0));
  rig.spine = null; rig.gait = 'hop'; rig.k = k; rig.walkAmp = 0;
  rig.tagH = 0.8 * k + 0.2;
  return rig;
}

// ======================================================================== ПЛАН 7: НАСЕКОМОЕ (стрекоза / мотылёк)
function bug(o) {
  const k = o.k || 1, moth = !!o.moth;
  const sk = (q) => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k });
  const keys = moth
    ? [{ x: -0.32, y: 0.5, top: .01, bot: .01, w: .01 }, { x: -0.25, y: 0.5, top: .07, bot: .07, w: .07 }, { x: -0.05, y: 0.5, top: .09, bot: .09, w: .09 }, { x: 0.1, y: 0.5, top: .08, bot: .08, w: .08 }, { x: 0.2, y: 0.5, top: .06, bot: .06, w: .06 }, { x: 0.25, y: 0.5, top: .01, bot: .01, w: .01 }]
    : [{ x: -0.6, y: 0.5, top: .01, bot: .01, w: .01 }, { x: -0.55, y: 0.5, top: .025, bot: .025, w: .025 }, { x: -0.1, y: 0.5, top: .035, bot: .035, w: .035 }, { x: 0.05, y: 0.5, top: .06, bot: .06, w: .06 }, { x: 0.15, y: 0.5, top: .06, bot: .06, w: .065 }, { x: 0.22, y: 0.5, top: .05, bot: .05, w: .07 }, { x: 0.26, y: 0.5, top: .01, bot: .01, w: .01 }];
  const L = paint(loft(keys.map(sk), { rings: 30, seg: 14, uScale: 6, vTiles: 3 }), o.pal, { type: 'bands', amt: 0.6, freq: moth ? 3 : 8 });
  const rig = baseRig('bug');
  const body = new THREE.Mesh(L.geo, skinMat(o.emis)); rig.frame.add(body);
  const kit = new Kit();
  for (const sd of [1, -1]) kit.add(rig.frame, null, o.glow ? 'glow' : 'eye', UNIT.sphLo, M_ell(new V3((moth ? 0.2 : 0.2) * k, 0.52 * k, sd * 0.05 * k), [0.04 * k, 0.04 * k, 0.04 * k]), o.glow ? 0xffd040 : 0x2a4a6a);
  kit.build({ emis: o.emis });
  const wingG = (len, wd) => { const g = new THREE.CircleGeometry(1, 18); g.rotateX(-PI / 2); g.scale(wd, 1, len); g.translate(0, 0, len); colorize(g, o.wingC || 0xddeeff); return g; };
  for (const sd of [1, -1]) for (const fx of (moth ? [0.0] : [0.08, -0.02])) {
    const sh = new THREE.Group(); sh.position.set(fx * k, 0.55 * k, sd * 0.03 * k); rig.frame.add(sh);
    const m = new THREE.Mesh(wingG((moth ? 0.24 : 0.28) * k, (moth ? 0.16 : 0.06) * k), o.glow ? MAT.glow : MAT.bugwing); if (sd < 0) m.scale.z = -1;
    sh.add(m); rig.wings.push({ g: sh, side: sd, bug: true });
  }
  rig.gait = 'bug'; rig.k = k; rig.isBug = true;
  rig.tagH = 0.8 * k;
  const hp = new THREE.Group(); rig.frame.add(hp); setHeadAnch(rig, hp, new V3(0.2 * k, 0.56 * k, 0), new V3(0.2 * k, 0.52 * k, 0.05 * k), new V3(0.1 * k, 0.5 * k, 0));
  return rig;
}

// ======================================================================== ПЛАН 8: СКОРПИОН (Песчаный Повелитель)
function scorpion(o) {
  const k = o.k || 1, Q = (o.q || 1) * qMul();
  const sk = (q) => ({ x: q.x * k, y: q.y * k, top: q.top * k, bot: q.bot * k, w: q.w * k, sq: q.sq, ridge: (q.ridge || 0) * k });
  const keys = [{ x: -1.55, y: 1.0, top: .02, bot: .02, w: .02 }, { x: -1.45, y: 1.0, top: .3, bot: .26, w: .5, sq: 2.6 }, { x: -0.8, y: 1.05, top: .44, bot: .3, w: .92, sq: 2.8, ridge: .04 }, { x: 0.0, y: 1.08, top: .46, bot: .32, w: 1.0, sq: 2.8, ridge: .05 }, { x: 0.8, y: 1.08, top: .44, bot: .3, w: .9, sq: 2.6, ridge: .04 }, { x: 1.45, y: 1.06, top: .36, bot: .26, w: .66, sq: 2.4 }, { x: 1.8, y: 1.0, top: .2, bot: .18, w: .42 }, { x: 1.92, y: 0.98, top: .02, bot: .02, w: .02 }].map(sk);
  const L = paint(loft(keys, { rings: Math.round(70 * Q), seg: Math.round(28 * Q), uScale: 1.5 / k, vTiles: 6 }), o.pal, { type: 'bands', amt: 0.55, freq: 5, from: 0, to: 0.85 });
  const rig = baseRig('scorp');
  const body = new THREE.Mesh(L.geo, skinMat(o.emis)); body.castShadow = true; rig.frame.add(body);
  const kit = new Kit();
  // хвост: изогнутая цепочка над спиной + жало
  const tk = [{ x: -1.35, y: 1.15, top: .34, bot: .34, w: .36 }, { x: -2.1, y: 1.55, top: .3, bot: .3, w: .32 }, { x: -2.5, y: 2.3, top: .27, bot: .27, w: .28 }, { x: -2.3, y: 3.1, top: .24, bot: .24, w: .25 }, { x: -1.7, y: 3.6, top: .22, bot: .22, w: .22 }, { x: -1.15, y: 3.7, top: .2, bot: .2, w: .2 }, { x: -0.9, y: 3.6, top: .14, bot: .14, w: .14 }].map(sk);
  // кольца-сегменты: «перетяжки» радиуса
  const tkk = []; for (let i = 0; i < tk.length - 1; i++) { tkk.push(tk[i]); const a = tk[i], b = tk[i + 1]; tkk.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, top: (a.top + b.top) / 2 * 0.82, bot: (a.bot + b.bot) / 2 * 0.82, w: (a.w + b.w) / 2 * 0.82 }); } tkk.push(tk[tk.length - 1]);
  const TL = paint(loft(tkk, { rings: Math.round(80 * Q), seg: 18, uScale: 1.5 / k, vTiles: 4 }), o.pal, { type: 'bands', amt: 0.35, freq: 6 });
  const bu = [0, 1, 2, 3, 4, 5, 6].map(i => TL.keys[i * 2 > tkk.length - 1 ? tkk.length - 1 : i * 2].u);
  const TS = skinMesh(TL, bu, 0, skinMat(o.emis)); rig.frame.add(TS.mesh);
  const tipB = TS.bones[6], tipO = TS.rest[6];
  kit.add(tipB, tipO, 'skin', UNIT.sph, M_ell(new V3(-0.75 * k, 3.5 * k, 0), [0.26 * k, 0.2 * k, 0.2 * k]), mulHex(o.pal.side, 0.9), true);
  kit.add(tipB, tipO, 'glow', hornGeo(0.55 * k, 0.09 * k, -0.9, 10), M_trs(new V3(-0.55 * k, 3.45 * k, 0), 0, 0, -1.2, 1), 0x6aff6a);
  rig.spine = null; rig.scorpTail = TS.bones;
  // клешни
  for (const sd of [1, -1]) {
    const arm = new THREE.Group(); arm.position.set(1.5 * k, 1.0 * k, sd * 0.55 * k); rig.frame.add(arm);
    const aL = paint(loft([{ x: 0, y: 0, top: .18, bot: .18, w: .18 }, { x: 0.6, y: 0.05, top: .16, bot: .16, w: .15 }, { x: 1.0, y: 0.0, top: .14, bot: .14, w: .13 }, { x: 1.4, y: 0.05, top: .17, bot: .17, w: .15 }].map(sk), { rings: 24, seg: 14 }), o.pal, null);
    kit.add(arm, null, 'skin', aL.geo, M_trs(new V3(0, 0, 0), 0, -sd * 0.6, 0, 1), null);
    const claw = new THREE.Group(); claw.position.set(Math.cos(sd * 0.6) * 1.4 * k, 0.05 * k, sd * Math.sin(0.6) * 1.4 * k); arm.add(claw);
    const cL = paint(loft([{ x: 0, y: 0, top: .3, bot: .26, w: .3 }, { x: 0.4, y: 0.02, top: .32, bot: .28, w: .34 }, { x: 0.75, y: 0.0, top: .2, bot: .18, w: .22 }, { x: 1.0, y: 0.0, top: .04, bot: .04, w: .05 }].map(sk), { rings: 24, seg: 16 }), o.pal, null);
    kit.add(claw, null, 'skin', cL.geo, new THREE.Matrix4(), null);
    kit.add(claw, null, 'acc', hornGeo(0.6 * k, 0.11 * k, 0.4), M_trs(new V3(0.7 * k, 0.08 * k, sd * 0.1 * k), 0, sd * 0.25, 0, 1), mulHex(o.pal.back, 0.7));
    rig.arms.push({ g: claw, s: sd, scorp: true, arm });
  }
  // 8 ног — тонкие изогнутые
  const legKeys = [{ x: 0, y: 0, top: .09, bot: .09, w: .09 }, { x: 0.45, y: 0.35, top: .08, bot: .08, w: .08 }, { x: 0.95, y: 0.15, top: .06, bot: .06, w: .06 }, { x: 1.2, y: -0.9, top: .035, bot: .035, w: .035 }, { x: 1.22, y: -1.0, top: .005, bot: .005, w: .005 }].map(sk);
  const LL = paint(loft(legKeys, { rings: 24, seg: 10 }), o.pal, null);
  for (let i = 0; i < 4; i++) for (const sd of [1, -1]) {
    const lg = new THREE.Group(); lg.position.set((0.8 - i * 0.55) * k, 1.0 * k, sd * 0.75 * k); lg.rotation.y = sd * (-PI / 2 + (i - 1.5) * 0.35); rig.frame.add(lg);
    const m = new THREE.Mesh(LL.geo, skinMat(o.emis)); m.castShadow = true; lg.add(m);
    rig.legs.push({ g: lg, scorp: true, side: sd, ph: i * 0.9 + (sd > 0 ? 0 : PI), baseY: lg.rotation.y });
  }
  for (const sd of [1, -1]) { kit.add(rig.frame, null, 'glow', UNIT.sphLo, M_ell(new V3(1.62 * k, 1.28 * k, sd * 0.22 * k), [0.07 * k, 0.07 * k, 0.07 * k]), 0xffa030); kit.add(rig.frame, null, 'glow', UNIT.sphLo, M_ell(new V3(1.5 * k, 1.36 * k, sd * 0.12 * k), [0.05 * k, 0.05 * k, 0.05 * k]), 0xffa030); }
  kit.build({ emis: o.emis });
  const hp = new THREE.Group(); rig.frame.add(hp); setHeadAnch(rig, hp, new V3(1.4 * k, 1.5 * k, 0), new V3(1.62 * k, 1.28 * k, 0.22 * k), new V3(1.2 * k, 1.2 * k, 0));
  rig.gait = 'scorp'; rig.k = k; rig.tagH = 4 * k;
  return rig;
}

// ======================================================================== КЛАССЫ ИГРОКА
function pal4(color, extra) { return palette(color, extra); }
function buildCarn(o) {
  const { color, stage, r } = o;
  const pal = pal4(color);
  if ((r.ambush || 0) > 0) pal.stripe = mixHex(pal.stripe, 0x1f3a14, Math.min(0.7, r.ambush * 0.15));
  return theropod({ k: 0.42, slim: 1 + (r.pounce || 0) * 0.04, pal, pat: { type: 'stripes', amt: 0.6 + (r.ambush || 0) * 0.07, freq: 7, from: 0.05, to: 0.62 }, r, stage, q: o.q });
}
function buildHerb(o) {
  const { color, stage, r } = o;
  return quadruped({ k: 0.98, head: 'cera', bulk: 1 + (r.mass || 0) * 0.05, pal: pal4(color), pat: { type: 'spots', amt: 0.55, freq: 3.4, from: 0.15, to: 0.75 }, r, stage, q: o.q });
}
function buildFly(o) {
  const { color, stage, r } = o;
  return pterosaur({ k: 1.0, pal: pal4(color), pat: { type: 'bands', amt: 0.35, freq: 5, from: 0.0, to: 0.5 }, r, stage, q: o.q });
}
function buildAqua(o) {
  const { color, stage, r } = o;
  return marine({ k: 1.0, bulk: 1 + (r.lungs || 0) * 0.04, pal: pal4(color, { bellyTo: 0xf2f2ea, bellyK: 0.75 }), pat: { type: 'spots', amt: 0.45, freq: 2.6, from: 0.1, to: 0.8 }, r, stage, q: o.q });
}
// три морских типа игрока: мозазавр (длинный ящер с рельефной головой и вёслами), плиозавр (массивная голова, бочка-тело, четыре огромных ласта), ихтиозавр («дельфин»)
function buildMosa(o) {
  const { color, stage, r } = o;
  return marine({ k: 1.0, kind: 'marine', stage, r, q: o.q, bulk: 1 + (r.lungs || 0) * 0.04, ridge: 9, flipK: 1.35, finK: 0.1,
    pal: pal4(color, { bellyTo: 0xeee6cf, bellyK: 0.8, stripe: mulHex(color, 0.45) }), pat: { type: 'bands', amt: 0.4, freq: 7, from: -0.2, to: 0.7 },
    keys: SK([[-3.3, .6, .01, .01, .01], [-3.15, .6, .05, .05, .04], [-2.6, .62, .13, .13, .1], [-1.9, .67, .24, .24, .19], [-1.2, .74, .36, .36, .31], [-0.5, .8, .45 * (1 + (r.lungs || 0) * 0.04), .45, .41], [0.3, .84, .47, .46, .46], [0.95, .87, .38, .36, .35], [1.3, .9, .26, .23, .23],
      [1.55, .93, .26, .2, .27, 2.2, .01], [1.85, .96, .3, .19, .36, 2.2, .1], [2.15, .91, .22, .14, .27, 2.3, .06], [2.55, .87, .14, .09, .15, 2.4], [2.85, .85, .06, .05, .07], [2.95, .85, .01, .01, .01]]),
    bones: [-2.9, -2.2, -1.5, -0.7, 0.3, 1.3, 1.78], rootI: 4, headX: 1.78, eyeX: 1.98, snoutX: 2.78, hingeY: 0.88,
    jawKeys: SK([[1.7, .86, .07, .12, .31, 2.2], [2.15, .78, .06, .1, .24, 2.3], [2.55, .76, .05, .08, .15, 2.4], [2.85, .78, .03, .04, .07], [2.95, .79, .005, .005, .005]]),
    flukeX: -3.2, flukeK: 1.35, dorsal: false, frontX: 0.6, hindX: -0.85 });
}
function buildPlio(o) {
  const { color, stage, r } = o;
  return marine({ k: 0.92, kind: 'marine', stage, r, q: o.q, ridge: 0, flipK: 2.6, flipAmp: 0.75, finK: 0.15, eyeK: 1.1,
    pal: pal4(color, { bellyTo: 0xe8ecdc, bellyK: 0.75, stripe: mulHex(color, 0.4) }), pat: { type: 'spots', amt: 0.5, freq: 3.6, from: 0, to: 0.8 },
    keys: SK([[-2.5, .68, .01, .01, .01], [-2.3, .68, .06, .06, .05], [-1.7, .72, .19, .2, .17], [-1.0, .78, .4, .43, .44], [-0.2, .84, .56 * (1 + (r.lungs || 0) * 0.04), .6, .62], [0.65, .88, .55, .56, .56], [1.2, .9, .4, .38, .42], [1.5, .92, .34, .3, .4, 2.1, 0],
      [1.8, .94, .4, .27, .52, 2.1, .1], [2.3, .9, .32, .21, .42, 2.2, .06], [2.85, .86, .21, .14, .27, 2.3], [3.25, .84, .1, .07, .13], [3.42, .84, .01, .01, .01]]),
    bones: [-2.1, -1.4, -0.6, 0.25, 1.1, 1.7], rootI: 3, headX: 1.7, eyeX: 2.05, snoutX: 3.3, hingeY: 0.8,
    jawKeys: SK([[1.62, .78, .08, .16, .48, 2.1], [2.3, .72, .07, .12, .38, 2.2], [2.9, .72, .05, .08, .23], [3.3, .75, .02, .03, .09], [3.42, .76, .005, .005, .005]]),
    fluke: false, dorsal: false, frontX: 0.55, hindX: -0.85 });
}
function buildIchth(o) {
  const { color, stage, r } = o;
  return seaIchthyo({ k: 0.9, pal: pal4(color, { bellyTo: 0xeef2f4, bellyK: 0.85 }), pat: { type: 'spots', amt: 0.3, freq: 3 }, irisC: 0xe8c040, r, stage, q: o.q });
}
const BUILDERS = { carn: buildCarn, herb: buildHerb, fly: buildFly, aqua: buildAqua, mosa: buildMosa, plio: buildPlio, ichth: buildIchth };

function finalize(rig, root) {
  rig.root.traverse(m => { if (m.isMesh) m.frustumCulled = true; });
  root.userData.parts = rig; root.userData.phase = Math.random() * 6; root.userData.bite = 0;
}
export function buildDino({ cls = 'carn', color = 0x6aa84f, level = 1, evo = {}, cosmetic = '', patc = '', morph = '' } = {}) {
  const stage = CONFIG.stageIndex(level);
  PATC = patc && CONFIG.COSMETICS[patc] && CONFIG.COSMETICS[patc].c != null ? CONFIG.COSMETICS[patc].c : null;
  MORPH = morph && CONFIG.COSMETICS[morph] && CONFIG.COSMETICS[morph].m ? CONFIG.COSMETICS[morph].m : null;
  let rig; try { rig = (BUILDERS[cls] || buildCarn)({ color, stage, r: CONFIG.evoLook(cls, evo || {}), q: 1 }); } finally { PATC = null; MORPH = null; }   // вид модели — по выбранным узлам эволюции
  const root = rig.root;
  finalize(rig, root);
  root.userData.cls = cls; root.userData.stage = stage; root.userData.level = level;
  root.scale.setScalar(Sim.scaleOf(level));
  setCosmetic(root, cosmetic);
  return root;
}

// ---------- косметика, корона, аура ----------
const sphG = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const coneG = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s);
const cylG = (a, b, h, s = 6) => new THREE.CylinderGeometry(a, b, h, s);
const boxG = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const stdMat = new Map();
function sMat(hex, emis) { const key = hex + ':' + (emis || 0); let m = stdMat.get(key); if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: emis ? 0.3 : 0.05 }); if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; } stdMat.set(key, m); } return m; }
function MM(geo, hex, shadow, emis) { const m = new THREE.Mesh(geo, sMat(hex, emis)); m.castShadow = shadow !== false; return m; }
function put(parent, obj, x, y, z, sx, sy, sz) { obj.position.set(x, y, z); if (sx !== undefined) obj.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz); parent.add(obj); return obj; }
export function setCosmetic(dino, id) {
  const P = dino.userData.parts, a = P.anch; if (!a) return;
  if (P.cosm) { P.cosm.parent && P.cosm.parent.remove(P.cosm); P.cosm = null; }
  if (!id) return;
  const g = new THREE.Group(); P.cosm = g; const k = P.k || 1;
  if (id === 'scarf') {
    const t = MM(new THREE.TorusGeometry(0.3 * Math.max(0.6, k * 2.2), 0.08, 8, 20), 0xd9302a, false); t.rotation.x = Math.PI / 2; put(g, t, a.neck[0], a.neck[1], a.neck[2]);
    put(g, MM(boxG(0.14, 0.5, 0.05), 0xd9302a, false), a.neck[0] + 0.2, a.neck[1] - 0.3, a.neck[2] - 0.2).rotation.z = 0.2;
    P.body.add(g);
  } else if (id === 'party') {
    put(g, MM(coneG(0.16, 0.45, 16), 0xff6ad5, false), 0, a.hatY + 0.2, a.hatZ); put(g, MM(sphG(0.06, 10, 8), 0xffe14a, false), 0, a.hatY + 0.45, a.hatZ);
    a.head.add(g);
  } else if (id === 'glasses') {
    for (const sx of [-1, 1]) put(g, MM(cylG(0.07, 0.07, 0.03, 16), 0x111111, false), sx * (a.eyeX + 0.01), a.eyeY, a.eyeZ + 0.03).rotation.z = Math.PI / 2;
    put(g, MM(boxG(0.025, 0.025, 0.16), 0x111111, false), 0, a.eyeY + 0.03, a.eyeZ);
    a.head.add(g);
  } else if (id === 'tophat') {
    put(g, MM(cylG(0.2, 0.2, 0.04, 20), 0x151515, false), 0, a.hatY + 0.02, a.hatZ);
    put(g, MM(cylG(0.13, 0.13, 0.3, 20), 0x151515, false), 0, a.hatY + 0.18, a.hatZ);
    put(g, MM(cylG(0.135, 0.135, 0.05, 20), 0xc0302a, false), 0, a.hatY + 0.08, a.hatZ);
    a.head.add(g);
  } else if (id === 'wizard') {
    put(g, MM(cylG(0.2, 0.2, 0.03, 20), 0x2a2a8a, false), 0, a.hatY + 0.02, a.hatZ);
    put(g, MM(coneG(0.15, 0.55, 16), 0x3a3ab0, false), 0, a.hatY + 0.3, a.hatZ).rotation.z = 0.12;
    for (const [x, y, z] of [[0.08, 0.2, 0.1], [-0.07, 0.34, 0.08], [0.02, 0.12, -0.13]]) put(g, MM(sphG(0.025, 8, 6), 0xffe14a, false), x, a.hatY + y, a.hatZ + z);
    a.head.add(g);
  } else if (id === 'viking') {
    put(g, MM(sphG(0.17, 14, 8), 0x8c8c94, false), 0, a.hatY + 0.06, a.hatZ).scale.set(1, 0.75, 1);
    for (const sx of [-1, 1]) { const h = put(g, MM(coneG(0.045, 0.3, 8), 0xf2efe0, false), sx * 0.2, a.hatY + 0.2, a.hatZ); h.rotation.z = -sx * 0.7; }
    a.head.add(g);
  } else if (id === 'flower') {
    put(g, MM(new THREE.TorusGeometry(0.16, 0.025, 6, 20), 0x3f8f3a, false), 0, a.hatY + 0.04, a.hatZ).rotation.x = Math.PI / 2;
    const cols = [0xff6a9a, 0xffe14a, 0xffffff, 0xff9a3a, 0xc08aff, 0xff6a9a];
    cols.forEach((c, i) => { const an = i / cols.length * 6.283; put(g, MM(sphG(0.05, 8, 6), c, false), Math.cos(an) * 0.16, a.hatY + 0.06, a.hatZ + Math.sin(an) * 0.16); });
    a.head.add(g);
  } else if (id === 'plume') {
    const cols = [0xff4a6a, 0xffd23a, 0x3ac8ff];
    cols.forEach((c, i) => { const f = put(g, MM(sphG(0.05, 8, 6), c, false), (i - 1) * 0.06, a.hatY + 0.28, a.hatZ - 0.1 - i * 0.02); f.scale.set(0.5, 4.2, 1.2); f.rotation.x = -0.5; f.rotation.z = (i - 1) * 0.35; });
    a.head.add(g);
  } else if (id === 'skullhat') {
    put(g, MM(sphG(0.19, 14, 10), 0xf2efe0, false), 0, a.hatY + 0.08, a.hatZ).scale.set(1, 0.85, 1.1);
    for (const sx of [-1, 1]) put(g, MM(sphG(0.045, 8, 6), 0x151515, false), sx * 0.08, a.hatY + 0.08, a.hatZ + 0.17);
    put(g, MM(boxG(0.1, 0.07, 0.1), 0xe0dccb, false), 0, a.hatY - 0.02, a.hatZ + 0.19);
    a.head.add(g);
  } else if (id === 'aura') {
    const s = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.rotation.x = -Math.PI / 2; s.position.y = 0.06; s.userData.aura = true; g.add(s);
    dino.add(g);
  }
}
// отдельная корона (для ролика коронации): основание, зубцы, камни; центр — на оси, низ на y=0
export function buildCrownMesh(mode) {
  const g = new THREE.Group(), gold = sMat(0xffd35a, 0x8a5a00);
  const base = new THREE.Mesh(cylG(0.2, 0.22, 0.12, 20), gold); base.position.set(0, 0.06, 0); g.add(base);
  const n = mode === 2 ? 7 : 5;
  for (let i = 0; i < n; i++) { const ang = i / n * 6.283, c = new THREE.Mesh(coneG(0.045, mode === 2 ? 0.26 : 0.18, 8), gold); c.position.set(Math.cos(ang) * 0.18, 0.2 + (mode === 2 ? 0.07 : 0.03), Math.sin(ang) * 0.18); g.add(c);
    const j = new THREE.Mesh(sphG(0.028, 8, 6), sMat(i % 2 ? 0xff4a4a : 0x4ac8ff, 0x802020)); j.position.set(Math.cos(ang) * 0.205, 0.1, Math.sin(ang) * 0.205); g.add(j); }
  if (mode === 2) { const m = new THREE.Mesh(sphG(0.07, 12, 10), sMat(0x7af0ff, 0x2a90a0)); m.position.set(0, 0.36, 0); g.add(m); }
  return g;
}
export function setCrown(dino, mode) {      // mode: 0 нет, 1 король, 2 владыка эпох
  const P = dino.userData.parts, a = P.anch; if (!a) return;
  if (P.crown) { P.crown.parent && P.crown.parent.remove(P.crown); P.crown = null; }
  if (!mode) return;
  const g = new THREE.Group(); P.crown = g;
  const gold = sMat(0xffd35a, 0x553a00);
  const base = new THREE.Mesh(cylG(0.2, 0.22, 0.12, 20), gold); put(g, base, 0, a.hatY + 0.12, a.hatZ);
  const n = mode === 2 ? 7 : 5;
  for (let i = 0; i < n; i++) { const ang = i / n * 6.283; put(g, new THREE.Mesh(coneG(0.045, mode === 2 ? 0.26 : 0.18, 8), gold), Math.cos(ang) * 0.18, a.hatY + 0.26, a.hatZ + Math.sin(ang) * 0.18); }
  if (mode === 2) put(g, MM(sphG(0.06, 12, 10), 0x7af0ff, false, 0x2a90a0), 0, a.hatY + 0.32, a.hatZ);
  a.head.add(g);
}

// ======================================================================== АНИМАЦИЯ
// укус по фазам: замах (голова назад, пасть настежь) → бросок вперёд → захлоп челюстей → встряхивание → возврат
// b: 1 → 0 (сколько осталось от укуса)
export function biteCurve(b) {
  if (!(b > 0)) return null;
  const p = 1 - b;
  const open = sstep(0, 0.2, p) * (1 - sstep(0.4, 0.47, p)) + 0.12 * sstep(0.47, 0.55, p) * (1 - sstep(0.6, 0.8, p));
  const pull = sstep(0, 0.2, p) * (1 - sstep(0.2, 0.34, p));
  const lunge = sstep(0.18, 0.4, p) * (1 - sstep(0.52, 1, p));
  const shake = sstep(0.44, 0.52, p) * (1 - sstep(0.6, 0.86, p));
  return { open, pull, lunge, shake, p };
}
// общая процедурная анимация костей: ходьба, хвост, шея, укус, крылья, плавание
function animRig(P, tt, sw, dt, o) {
  o = o || {};
  const bc = o.bc || null, fly = !!o.fly, swim = !!o.swim, roar = !!o.roar;
  const bk = bc ? Math.max(bc.lunge, bc.open * 0.6) : 0, lunge = bc ? bc.lunge : 0, pull = bc ? bc.pull : 0, open = bc ? bc.open : 0, shake = bc ? bc.shake * Math.sin(tt * 40) : 0;
  const LEGSIGN = 1, butt = P.gait === 'quad' && P.kind !== 'croc';   // травоядные бодаются головой, а не кусают
  // фазы шага, хвоста и крыльев НАКАПЛИВАЮТСЯ (фаза += dt·частота), а не считаются как t·частота(скорость):
  // иначе при любом изменении скорости (разгон с места) фаза прыгает и ноги «быстро перебирают»
  const ddt = Math.min(Math.max(dt || 0, 0), 0.1);
  if (P.gph === undefined) { P.gph = tt % 6.2832; P.tph = P.gph; P.wph = P.gph; P.sws = sw; P.runS = 0; }
  P.sws += (sw - P.sws) * Math.min(1, ddt * 7); sw = P.sws;
  P.runS += ((o.run || 0) - P.runS) * Math.min(1, ddt * 5); const run = swim || fly ? 0 : P.runS;
  P.run = run;
  // частота шага = скорость / длина шага: ноги не «скользят» и не «буксуют». Длина цикла ~ высота бедра × масштаб динозавра.
  let legF = (P.gait === 'quad' ? 7 : 8.5) * Math.max(0.35, Math.min(1.3, sw)) * (1 + 0.28 * run);
  if (o.sc > 0 && o.v !== undefined && P.legs.length && !swim && !fly) {
    const hip = P.hipY || (P.hipY = Math.max(0.3, P.legs[0].g.position.y)), D = (P.gait === 'quad' ? 4.2 : 5.0) * hip * o.sc * (1 + 0.3 * run);
    legF = Math.max(0.8, Math.min(15, 6.2832 * o.v / D));
  }
  P.gph = (P.gph + ddt * legF) % 62.832;
  const sp = P.spine;
  if (sp) {
    const tf = swim ? 4.5 : 1.1 + sw * 2.2;
    P.tph = (P.tph + ddt * tf) % 62.832; const tP = P.tph;
    const n = sp.tail.length;
    for (let i = 0; i < n; i++) {
      const b = sp.tail[i], amp = (swim ? 0.16 : 0.07) * (1 + i * 0.35) * (P.aquatic && !swim ? 0.6 : 1) * (0.7 + sw * 0.6) / Math.max(1, n / 4) * (1 - 0.6 * run);
      b.rotation.y = Math.sin(tP - i * (swim ? 0.9 : 0.6)) * amp;
      b.rotation.z = Math.sin(tt * 0.9 - i * 0.4) * 0.02 + (fly ? 0.04 : 0) + (i < 2 ? lunge * 0.07 - pull * 0.03 : 0);
    }
    sp.root.rotation.y = swim ? Math.sin(tP + 0.6) * 0.05 : 0;
    const nk = sp.neck;
    for (let i = 0; i < nk.length; i++) {
      nk[i].rotation.y = Math.sin(tt * 0.45 + i) * 0.08 * (1 - sw * 0.5) + shake * 0.1;
      // на бегу шея вытягивается вперёд и опускается к линии спины, голова чуть кивает в такт шагам
      nk[i].rotation.z = pull * (butt ? 0.05 : 0.3) - lunge * (butt ? 0.1 : 0.34) + (roar ? 0.18 : 0) + Math.sin(tt * 0.7) * 0.02 * (1 - run) - run * (butt ? 0.07 : 0.11) / nk.length * 2;
    }
    sp.head.rotation.z = pull * (butt ? 0.04 : 0.16) - lunge * (butt ? 0.08 : 0.16) + (roar ? 0.25 : 0) + run * (0.12 + Math.cos(P.gph * 2) * 0.03);
    sp.head.rotation.y = (swim ? -Math.sin(tP + 1.2) * 0.06 : 0) + shake * 0.16;
    sp.head.rotation.x = shake * 0.12;
  }
  if (P.jaw) P.jaw.rotation.z = (P.jawBase || 0) - open * (butt ? 0.45 : P.aquatic ? 0.55 : P.kind === 'ptero' ? 0.5 : 0.95) - (roar ? 0.6 : 0);
  // всё тело подаётся вперёд в броске и чуть откидывается назад на замахе
  if (P.frame) { P.frame.position.x = (lunge * (butt ? 0.12 : 0.3) - pull * 0.07) * (P.k ? Math.min(1.6, P.k / 0.42) : 1); P.frame.rotation.z = butt ? pull * 0.3 - lunge * 0.1 : -lunge * 0.07 + pull * 0.035; }
  // походка: корпус пружинит вверх-вниз на каждом шаге и слегка раскачивается с боку на бок; в воде/полёте — плавное покачивание
  if (P.frame && !P.aquatic) {
    const ws = Math.min(1.2, sw) * (fly ? 0 : 1), bobK = (P.k ? Math.min(1.6, P.k / 0.42) : 1);
    P.frame.position.y = (fly ? Math.sin(tt * 2.4) * 0.05 : Math.abs(Math.sin(P.gph * (P.gait === 'quad' ? 0.5 : 1))) * 0.045 * ws * (1 + 0.8 * run)) * bobK;
    P.frame.rotation.x = Math.sin(P.gph * (P.gait === 'quad' ? 0.5 : 1)) * 0.035 * ws * (1 + 0.5 * run) + (fly ? Math.sin(tt * 1.3) * 0.04 : 0);
  }
  // ноги
  const gait = P.gait;
  for (const lg of P.legs) {
    if (lg.scorp) { const p = tt * (4 + sw * 6) + lg.ph; lg.g.rotation.y = lg.baseY + Math.sin(p) * 0.25 * sw; lg.g.rotation.z = Math.max(0, Math.cos(p)) * 0.2 * sw; continue; }
    // у четвероногих на бегу рысь переходит в галоп: передние и задние ноги идут парами с небольшим сдвигом
    const phR = gait === 'quad' ? (lg.front ? 0 : 2.5) + (lg.side > 0 ? 0 : 0.7) : lg.ph;
    const b = lg.bones, p = P.gph + lg.ph + (phR - lg.ph) * run, w = Math.min(1.2, sw);
    if (fly) { b[0].rotation.z = -1.0; b[1].rotation.z = 0.15; b[2].rotation.z = 0.2; continue; }
    if (swim) { b[0].rotation.z = -0.5 + Math.sin(tt * 3 + lg.ph) * 0.2; b[1].rotation.z = -0.4; b[2].rotation.z = 0.3; continue; }
    // бег: шаг шире, колено поднимается выше, толчок назад сильнее (нога разгибается в конце опоры)
    const amp = (P.walkAmp || 0.4) * (1 + (gait === 'quad' ? 0.6 : 0.5) * run), sw1 = Math.max(0, Math.cos(p)), push = Math.max(0, -Math.sin(p)) * Math.max(0, -Math.cos(p));
    b[0].rotation.z = Math.sin(p) * amp * w + run * 0.06;
    b[1].rotation.z = -sw1 * ((gait === 'quad' ? 0.45 : 0.6) + run * (gait === 'quad' ? 0.15 : 0.6)) * w + push * run * 0.15;
    b[2].rotation.z = (sw1 * (0.4 + run * 0.35) - push * run * 0.2) * w;
    if (b[3]) b[3].rotation.z = (-Math.sin(p) * (0.2 + run * 0.15) + sw1 * (0.15 + run * 0.25)) * w;
    // травоядные бьют передними лапами: привстают (замах — лапы вверх-вперёд), затем обрушивают их вниз
    if (butt && lg.front) { const wd = pull, ht = lunge; b[0].rotation.z += LEGSIGN * (wd * 1.15 - ht * 0.55); b[1].rotation.z += -(wd * 0.9) + ht * 0.7; if (b[2]) b[2].rotation.z += wd * 0.5 - ht * 0.5; }
  }
  for (const a of P.arms) {
    if (a.scorp) { a.g.rotation.y = Math.sin(tt * 1.4 + a.s) * 0.08 - bk * 0.5 * a.s; a.arm.rotation.z = bk * 0.4; continue; }
    a.g.rotation.z = Math.sin(tt * 1.3 + a.s) * 0.06 * (1 - run) + Math.sin(P.gph + (a.s > 0 ? PI : 0)) * 0.12 * run + lunge * 0.8 - pull * 0.2; a.g.rotation.x = a.bx - lunge * 0.15 * a.s;
  }
  // крылья
  if (P.wings.length) P.wph = (P.wph + ddt * (5 + sw * 3)) % 62.832;
  for (const wg of P.wings) {
    if (wg.bug) { wg.g.rotation.x = Math.sin(tt * 42) * 0.7 * wg.side; continue; }
    const s = wg.side;
    if (fly || o.boss) wg.b0.scale.set(1, 1, 1);
    if (fly) {
      const f = Math.sin(P.wph);
      wg.b0.rotation.set(-s * f * 0.65, s * 0.08, 0); wg.b1.rotation.set(-s * Math.sin(P.wph - 0.6) * 0.45, 0, 0);
    } else if (o.boss) {
      const f = Math.sin(tt * 2.2) * 0.2 + bk * 0.5;
      wg.b0.rotation.set(-s * (f + 0.25), s * 0.35, 0); wg.b1.rotation.set(-s * f * 0.6, s * 0.4, 0);
    } else {
      // сложенное крыло: прижато к боку и «сжато» по размаху
      wg.b0.scale.set(1, 1, 0.3); wg.b0.rotation.set(s * 0.55 + Math.sin(tt * 1.2) * 0.02, -s * 0.75, 0.15); wg.b1.rotation.set(s * 0.6, 0, 0);
    }
  }
  // ласты: у плиозавра — «подводный полёт» (большие взмахи вверх-вниз, передняя и задняя пары в противофазе, лопасть поворачивается),
  // у мозазавра и прочих — лёгкая греблей; частота растёт со скоростью
  if (P.flippers.length) {
    const amp = P.flipAmp || 0.3, fr = swim ? 1.5 + sw * 2.2 : 1.2 + sw * 1.4;
    P.fph = ((P.fph || 0) + ddt * fr) % 62.832;
    for (const f of P.flippers) {
      const ph = P.fph * (f.front ? 1 : 1) + (f.front ? 0 : 1.9), k = swim ? (0.55 + Math.min(1, sw) * 0.45) : 0.35;
      const flap = Math.sin(ph), dn = Math.cos(ph);
      f.g.rotation.x = -f.side * (0.25 + flap * amp * 0.8 * k * (f.front ? 1 : 0.7));          // взмах вверх-вниз
      f.g.rotation.z = (dn * amp * 0.5 - 0.1) * k * (f.front ? 1 : 0.8);                        // ход вперёд-назад
      f.g.rotation.y = f.side * dn * amp * 0.45 * k;                                            // поворот лопасти по ходу взмаха
    }
  }
  if (P.frogLegs) for (const l of P.frogLegs) { l.hind.rotation.z = -Math.max(0, Math.sin(tt * 6)) * 0.5 * sw; l.front.rotation.z = Math.sin(tt * 6) * 0.2 * sw; }
  if (P.scorpTail) { const T = P.scorpTail; for (let i = 1; i < T.length; i++) T[i].rotation.z = Math.sin(tt * 1.6 - i * 0.6) * 0.05 - bk * 0.12; T[0].rotation.y = Math.sin(tt * 0.8) * 0.1; }
}

// подпрыгивание корпуса синхронно с шагами: при ходьбе тело выше всего над опорной ногой,
// на бегу — наоборот, ниже всего в опоре и выше всего в «полёте» между шагами
function bodyBob(P, sw, swim, fly) {
  if (fly) return 0;
  if (swim) return Math.abs(Math.sin(P.gph * 0.6)) * 0.05 * sw;
  const c = Math.abs(Math.cos(P.gph)), run = P.run || 0, k = P.gait === 'quad' ? 0.6 : 1;
  return (c * 0.045 * (1 - run) + Math.pow(1 - c, 1.5) * 0.14 * run) * Math.min(1.2, sw) * k;
}
export function animateDino(dino, t, speed, dt, st) {
  st = st || {};
  const P = dino.userData.parts, ph = dino.userData.phase, tt = t + ph, cls = dino.userData.cls;
  const sw = Math.min(speed, 1.4);
  let bite = dino.userData.bite;
  if (bite > 0) { bite = Math.max(0, bite - dt * 2.1); dino.userData.bite = bite; }
  // бег: явный флаг (свой динозавр — зажат «бег») или скорость заметно выше шага своего класса
  const base = ((CONFIG.CLASSES[cls] || {}).speed || 180) / 180;
  const run = st.run !== undefined ? (st.run ? 1 : 0) : sstep(1.18, 1.4, speed / base);
  animRig(P, tt, sw, dt, { bc: biteCurve(bite), fly: st.fly, swim: st.swim && P.aquatic, run: st.guard || st.climb ? 0 : run, sc: dino.scale.x, v: speed * 6 });
  if (P.aquatic) {
    // под водой нос смотрит туда, куда плывём: вверх при всплытии, вниз при погружении
    const pt = st.swim ? Math.max(-0.65, Math.min(0.65, -(st.vy || 0) * 0.09)) : 0;
    P.pitchS = (P.pitchS || 0) + (pt - (P.pitchS || 0)) * Math.min(1, dt * 5);
    P.body.rotation.x = st.swim ? -0.04 + P.pitchS : 0; P.body.position.y = st.swim ? 0 : Math.abs(Math.sin(tt * 3)) * 0.03 * sw;
    P.frame.scale.y = 1 + Math.sin(tt * 2.2) * 0.012;
    return;
  }
  const crouch = st.guard ? -0.25 : 0;
  P.body.position.y = bodyBob(P, sw, st.swim, st.fly) + (st.swim ? -0.3 : 0) + crouch + (st.fly ? Math.sin(tt * 2) * 0.06 : 0);
  P.body.rotation.z = Math.sin(P.gph) * 0.025 * sw * (1 - 0.5 * P.run);
  // наклон корпуса вперёд на бегу (хвост поднимается противовесом), у четвероногих — качание галопа
  P.body.rotation.x = (cls === 'carn' ? 0.03 : 0) + (st.climb ? -1.35 : 0) + (st.fly ? 0.15 + Math.min(1, speed) * 0.2 : 0)
    + P.run * (P.gait === 'quad' ? Math.sin(P.gph) * 0.04 : 0.13);
  P.frame.scale.y = 1 + Math.sin(tt * 2.2) * 0.012;
  const aura = P.cosm && P.cosm.children[0];
  if (aura && aura.userData.aura) { aura.scale.setScalar(1 + Math.sin(t * 3) * 0.08); aura.material.opacity = 0.45 + Math.sin(t * 3) * 0.15; }
}

// ---------- табличка с ником ----------
const tagCache = new Map();
export function makeNameTag(text, o) {
  o = o || {};
  const key = text + '|' + (o.sub || '') + '|' + (o.color || '') + '|' + (o.star ? 1 : 0);
  let tex = tagCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 80;
    const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = (o.star ? '★ ' : '') + text + (o.badge ? '  ' + o.badge : '');
    g.font = 'bold 32px system-ui, sans-serif'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(label, 160, o.sub ? 28 : 40);
    g.fillStyle = o.color || '#ffffff'; g.fillText(label, 160, o.sub ? 28 : 40);
    if (o.sub) { g.font = 'bold 24px system-ui, sans-serif'; g.strokeText(o.sub, 160, 60); g.fillStyle = '#ffd35a'; g.fillText(o.sub, 160, 60); }
    tex = new THREE.CanvasTexture(c); tagCache.set(key, tex);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(3.6, 0.9, 1); sp.renderOrder = 10;
  return sp;
}
export function makeHpBar(w) {
  // полоска здоровья врага: контур + фон + заливка; без тумана и теста глубины, чтобы хорошо читалась и под водой, и вдали
  const g = new THREE.Group(), M = (o) => new THREE.MeshBasicMaterial(Object.assign({ depthTest: false, fog: false, toneMapped: false }, o));
  const ed = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.12, 0.34), M({ color: 0x000000 })); ed.renderOrder = 10;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.24), M({ color: 0x3a1410 })); bg.renderOrder = 11; bg.position.z = 0.001;
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.24), M({ color: 0xe8573f })); fill.renderOrder = 12; fill.position.z = 0.002;
  g.add(ed, bg, fill); g.userData.fill = fill; g.userData.w = w;
  g.setFill = (k) => { k = Math.max(0.001, Math.min(1, k)); fill.scale.x = k; fill.position.x = -(1 - k) * w / 2; fill.material.color.setHex(k > 0.5 ? 0x7ad05a : k > 0.25 ? 0xe8b83f : 0xff4a3a); };
  return g;
}

// ---------- актёр игрока ----------

// ---------------------------------------------------------------- питомцы: маленькие следующие за игроком существа
export function buildPet(id) {
  const g = new THREE.Group(), M = (c, e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: e || 0x000000 });
  const sph = (r, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m); o.position.set(x, y, z); o.scale.set(sx || 1, sy || 1, sz || 1); g.add(o); return o; };
  const eye = (x, y, z) => sph(0.04, M(0x111111), x, y, z);
  if (id === 'lizard') {
    const m = M(0x4fae4f); sph(0.22, m, 0, 0.18, 0, 1.5, 0.7, 0.8); sph(0.15, m, 0.3, 0.22, 0); eye(0.4, 0.28, 0.07); eye(0.4, 0.28, -0.07);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 8), m); tail.rotation.z = Math.PI / 2; tail.position.set(-0.45, 0.14, 0); g.add(tail);
    for (const [x, z] of [[0.12, 0.14], [0.12, -0.14], [-0.12, 0.14], [-0.12, -0.14]]) sph(0.06, m, x, 0.06, z);
  } else if (id === 'chick') {
    const m = M(0xffd84a); sph(0.24, m, 0, 0.26, 0); sph(0.15, m, 0.12, 0.5, 0); eye(0.24, 0.55, 0.07); eye(0.24, 0.55, -0.07);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), M(0xff9a2a)); beak.rotation.z = -Math.PI / 2; beak.position.set(0.3, 0.5, 0); g.add(beak);
    sph(0.1, m, -0.05, 0.3, 0.2, 1.4, 0.5, 0.5); sph(0.1, m, -0.05, 0.3, -0.2, 1.4, 0.5, 0.5);
  } else if (id === 'hedgehog') {
    const m = M(0x7a5a3a); sph(0.26, m, 0, 0.24, 0, 1.3, 0.9, 1); sph(0.12, M(0xd8b48a), 0.32, 0.18, 0); eye(0.42, 0.22, 0.06); eye(0.42, 0.22, -0.06);
    const sp = M(0x3a2a1a);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 1.4 - 0.7 + Math.PI, c = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 5), sp); c.position.set(Math.cos(a) * 0.28, 0.3 + Math.sin(i * 1.7) * 0.06 + 0.14, Math.sin(a * 2.3) * 0.2); c.rotation.z = -Math.cos(a) * 0.9; g.add(c); }
  } else {
    const m = new THREE.MeshBasicMaterial({ color: 0xfff2a0 }); sph(0.1, m, 0, 0.9, 0);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending })); halo.position.y = 0.9; g.add(halo);
    const halo2 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })); halo2.position.y = 0.9; g.add(halo2);
  }
  g.userData.id = id; g.userData.fly = id === 'firefly'; g.userData.ph = Math.random() * 6;
  return g;
}

function titleText(id) { const t = id && CONFIG.TITLES[id]; return t && typeof window !== 'undefined' && window.TN ? t.ico + ' ' + window.TN(t.n) : ''; }
export function makeActor({ nick, color, cls, level, evo, cosmetic, admin, king, lord, label, pet, title, patc, morph, colorIdx }) {
  const group = new THREE.Group();
  const actor = { title: title || '', patc: patc || '', morph: morph || '', group, color: CONFIG.COLORS[color] != null ? CONFIG.COLORS[color] : color, cls, level, evo: evo || {}, cosmetic: cosmetic || '', dino: null, tag: null, king: king ? 1 : 0, lord: lord ? 1 : 0, admin: !!admin, nick, st: {} };
  function rebuild() {
    if (actor.dino) group.remove(actor.dino);
    actor.dino = buildDino({ cls, color: actor.color, level: actor.level, evo: actor.evo, cosmetic: actor.cosmetic, patc: actor.patc, morph: actor.morph });
    group.add(actor.dino); setCrown(actor.dino, actor.lord ? 2 : actor.king ? 1 : 0);
    if (actor.tag) group.remove(actor.tag);
    actor.tag = makeNameTag(nick, { badge: actor.admin ? '★Admin' : '', color: actor.admin ? '#ffd35a' : actor.lord ? '#7af0ff' : '#ffffff', sub: label || titleText(actor.title) });
    group.add(actor.tag);
    actor.tag.position.y = (cls === 'fly' ? 2.5 : 2.3) * Sim.scaleOf(actor.level) + 0.7 + (['party', 'tophat', 'wizard', 'viking', 'flower', 'plume', 'skullhat'].indexOf(actor.cosmetic) >= 0 ? 0.45 : 0);
  }
  rebuild();
  actor.petId = ''; actor.petM = null;
  function setPet(id) {
    if (actor.petM) { group.remove(actor.petM); actor.petM.traverse(o => { o.geometry && o.geometry.dispose(); }); actor.petM = null; }
    actor.petId = id || '';
    if (id) { actor.petM = buildPet(id); actor.petM.position.set(-2, 0, 1.2); group.add(actor.petM); }
  }
  setPet(pet);
  actor.set = (o) => {
    if (o.pet != null && o.pet !== actor.petId) setPet(o.pet);
    if (o.title != null && o.title !== actor.title) { actor.title = o.title; rebuild(); }
    let r = false;
    if (o.patc != null && o.patc !== actor.patc) { actor.patc = o.patc; r = true; }
    if (o.morph != null && o.morph !== actor.morph) { actor.morph = o.morph; r = true; }
    if (o.color != null && CONFIG.COLORS[o.color] != null && CONFIG.COLORS[o.color] !== actor.color) { actor.color = CONFIG.COLORS[o.color]; r = true; }
    if (o.level != null && o.level !== actor.level) {
      // рост: новая модель плавно «дорастает» от прежнего размера до нового (при смене ступени — с лёгким рывком)
      const prevSc = Sim.scaleOf(actor.level); actor.grow = { t: 0, from: prevSc, stage: CONFIG.stageIndex(o.level) !== CONFIG.stageIndex(actor.level) };
      actor.level = o.level; r = true;
    }
    if (o.evo && JSON.stringify(o.evo) !== JSON.stringify(actor.evo)) { actor.evo = o.evo; r = true; }
    if (o.cosmetic != null && o.cosmetic !== actor.cosmetic) { actor.cosmetic = o.cosmetic; r = true; }
    if (o.king != null && (o.king ? 1 : 0) !== actor.king) { actor.king = o.king ? 1 : 0; r = true; }
    if (o.lord != null && (o.lord ? 1 : 0) !== actor.lord) { actor.lord = o.lord ? 1 : 0; r = true; }
    if (r) rebuild();
  };
  actor.update = (x, y, z, face, speed01, t, dt, st) => {
    group.position.set(x, y, z); actor.dino.rotation.y = face; actor.st = st || actor.st;
    if (actor.grow) {
      const g = actor.grow; g.t += dt; const dur = g.stage ? 2.2 : 1.0, k = Math.min(1, g.t / dur), e = k * k * (3 - 2 * k), to = Sim.scaleOf(actor.level);
      actor.dino.scale.setScalar((g.from + (to - g.from) * e) * (1 + (g.stage ? Math.sin(k * Math.PI) * 0.12 : 0)));
      if (k >= 1) { actor.grow = null; actor.dino.scale.setScalar(to); }
    }
    animateDino(actor.dino, t, speed01, dt, st);
    const pm = actor.petM;
    if (pm) {
      const sc = Sim.scaleOf(actor.level), d = 2.0 * sc + 0.6, tx = -Math.sin(face) * d + Math.cos(face) * 0.9, tz = -Math.cos(face) * d - Math.sin(face) * 0.9;
      const dx = tx - pm.position.x, dz = tz - pm.position.z, dd = Math.hypot(dx, dz);
      if (dd > 7) pm.position.set(tx, 0, tz); else { const k = 1 - Math.exp(-dt * 3.2); pm.position.x += dx * k; pm.position.z += dz * k; }
      if (dd > 0.15) pm.rotation.y = Math.atan2(-dz, dx) * 1 + 0; 
      const hop = pm.userData.fly ? 0.6 * sc + Math.sin(t * 2.4 + pm.userData.ph) * 0.25 : Math.max(0, Math.sin(t * 9 + pm.userData.ph)) * Math.min(0.25, dd * 0.3);
      pm.position.y = hop; pm.scale.setScalar(Math.max(0.8, sc * 0.55));
    }
  };
  actor.dispose = () => { group.parent && group.parent.remove(group); };
  return actor;
}

// ======================================================================== ОКЕАН: морские обитатели и боссы
// все — на основе marine(): тело-лофт вдоль оси x (голова к +x), кости, плавники, челюсть; отличия — в профиле тела и деталях
const SK = (a) => a.map(([x, y, top, bot, w, sq, brow]) => ({ x, y, top, bot, w, sq, brow }));
// светящиеся точки по бокам (фотофоры глубоководных)
function glowDots(L, S, kit, k, color, n, from, to, rad) {
  for (let i = 0; i < n; i++) for (const sd of [1, -1]) {
    const t = n > 1 ? i / (n - 1) : 0.5, u = L.uAtX((from + (to - from) * t) * k), p = L.pointAtU(u, sd * (1.6 + (i % 2) * 0.35), 0.004 * k), bi = nearestBone(S, u);
    kit.add(S.bones[bi], S.rest[bi], 'glow', UNIT.sphLo, M_ell(p.pos, [rad * k, rad * k, rad * k]), color);
  }
}
// акула: веретено, острая морда, высокий спинной плавник, вертикальная лопасть хвоста
function seaShark(o) {
  return marine(Object.assign({ kind: 'marine', teeth: true, ridge: 0,
    keys: SK([[-2.6, 1.05, .01, .01, .01], [-2.4, 1.05, .07, .06, .05], [-1.8, 1.0, .18, .16, .14], [-1.0, 1.0, .36, .32, .3], [-0.2, 1.0, .5, .44, .42], [0.6, 1.0, .52, .46, .44],
      [1.3, 0.98, .42, .36, .36], [1.8, 0.96, .3, .24, .27, 2.2, .02], [2.2, 0.94, .17, .12, .15, 2.3], [2.45, 0.93, .05, .04, .05], [2.52, 0.93, .01, .01, .01]]),
    bones: [-2.2, -1.5, -0.7, 0.2, 1.2, 1.7], rootI: 3, headX: 1.7, eyeX: 1.98, snoutX: 2.38, hingeY: 0.84,
    jawKeys: SK([[1.55, 0.84, .06, .12, .28, 2.2], [2.0, 0.82, .05, .09, .2], [2.3, 0.84, .03, .04, .08], [2.38, 0.85, .005, .005, .005]]),
    flukeX: -2.45, flukeK: 1.55, dorsalX: -0.05, dorsalK: 2.6, frontX: 0.9, hindX: -1.3, flipK: 1.25 }, o));
}
// ихтиозавр: «дельфин» с длинным тонким рылом и огромными глазами
function seaIchthyo(o) {
  return marine(Object.assign({ kind: 'marine', ridge: 0, eyeK: 2.1,
    keys: SK([[-2.7, 1.0, .01, .01, .01], [-2.5, 1.0, .06, .05, .05], [-1.9, 1.0, .16, .15, .13], [-1.1, 1.02, .34, .34, .3], [-0.2, 1.05, .48, .46, .42], [0.6, 1.06, .46, .44, .4],
      [1.2, 1.06, .34, .3, .3], [1.55, 1.06, .27, .2, .22, 2.2, .03], [1.85, 1.02, .1, .08, .08], [2.6, 1.0, .05, .04, .04], [2.9, 1.0, .01, .01, .01]]),
    bones: [-2.3, -1.6, -0.8, 0.2, 1.1, 1.5], rootI: 3, headX: 1.5, eyeX: 1.62, snoutX: 2.8, hingeY: 0.97,
    jawKeys: SK([[1.45, 0.97, .05, .1, .18], [1.9, 0.95, .03, .05, .07], [2.6, 0.96, .02, .03, .035], [2.85, 0.97, .005, .005, .005]]),
    flukeX: -2.55, flukeK: 1.45, dorsalX: 0, dorsalK: 1.6, frontX: 0.8, hindX: -1.0, flipK: 1.05 }, o));
}
// плезиозавр: широкое тело, длинная шея, маленькая голова, четыре больших ласта, короткий хвост
function plesioKeys(nk) {
  const N = (x) => 1.3 + (x - 1.3) * nk;   // растягиваем шею
  return SK([[-2.2, 0.9, .01, .01, .01], [-2.0, 0.9, .05, .05, .05], [-1.4, 0.92, .16, .15, .16], [-0.8, 0.95, .34, .36, .42], [0, 1.0, .44, .46, .6], [0.8, 1.0, .4, .42, .5],
    [1.3, 1.02, .24, .24, .24], [N(1.8), 1.12, .15, .15, .15], [N(2.4), 1.28, .12, .12, .12], [N(3.0), 1.4, .11, .11, .11],
    [N(3.0) + 0.35, 1.45, .15, .12, .15, 2.2, .03], [N(3.0) + 0.65, 1.43, .1, .07, .1, 2.3], [N(3.0) + 0.9, 1.4, .04, .03, .04], [N(3.0) + 0.97, 1.4, .01, .01, .01]]);
}
function seaPlesio(o) {
  const nk = o.neck || 1, N = (x) => 1.3 + (x - 1.3) * nk, hx = N(3.0) + 0.35;
  return marine(Object.assign({ kind: 'marine', ridge: 0, keys: plesioKeys(nk),
    bones: [-1.6, -0.8, 0.2, 1.3, N(1.9), N(2.5), N(3.0), hx], rootI: 2, headX: hx, eyeX: hx + 0.15, snoutX: hx + 0.55, hingeY: 1.38,
    jawKeys: SK([[hx - 0.05, 1.38, .04, .07, .12], [hx + 0.35, 1.36, .03, .04, .07], [hx + 0.57, 1.37, .005, .005, .005]]),
    fluke: false, dorsal: false, frontX: 0.6, hindX: -0.9, flipK: 2.1, flipAmp: 0.7 }, o));
}
// черепаха (архелон, генодус): плоское тело, панцирь с килями, клюв, огромные передние ласты
function seaTurtle(o) {
  const shellC = o.shellC || mulHex(o.pal.back, 0.75);
  return marine(Object.assign({ kind: 'marine', ridge: 0, teeth: false,
    keys: SK([[-1.6, 0.8, .01, .01, .01], [-1.4, 0.8, .06, .05, .06], [-1.0, 0.82, .2, .18, .4], [-0.3, 0.85, .32, .26, .75], [0.4, 0.86, .34, .27, .78], [1.0, 0.86, .24, .2, .5],
      [1.35, 0.9, .14, .13, .15], [1.6, 0.93, .16, .13, .16, 2.2, .02], [1.95, 0.9, .1, .08, .1], [2.1, 0.88, .03, .03, .03], [2.14, 0.88, .01, .01, .01]]),
    bones: [-1.2, -0.4, 0.4, 1.3, 1.6], rootI: 2, headX: 1.6, eyeX: 1.74, snoutX: 2.1, hingeY: 0.86,
    jawKeys: SK([[1.55, 0.86, .04, .07, .13], [1.95, 0.85, .03, .04, .07], [2.08, 0.86, .005, .005, .005]]),
    fluke: false, dorsal: false, frontX: 0.7, hindX: -0.85, flipK: 2.5,
    extras: ({ L, S, kit, k }) => {
      const rb = S.bones[2], ro = S.rest[2];
      kit.add(rb, ro, 'skin', UNIT.sph, M_ell(new V3(0.05 * k, 1.02 * k, 0), [1.05 * k, 0.3 * k, 0.86 * k]), shellC, true);
      for (let i = 0; i < 5; i++) kit.add(rb, ro, 'acc', UNIT.sph, M_ell(new V3((-0.75 + i * 0.38) * k, 1.29 * k, 0), [0.2 * k, 0.07 * k, 0.07 * k]), mulHex(shellC, 0.8));     // киль
      for (const sd of [1, -1]) for (let i = 0; i < 4; i++) kit.add(rb, ro, 'acc', UNIT.sph, M_ell(new V3((-0.55 + i * 0.38) * k, 1.18 * k, sd * 0.42 * k), [0.17 * k, 0.05 * k, 0.07 * k]), mulHex(shellC, 0.85));
      if (o.extras2) o.extras2({ L, S, kit, k });
    } }, o));
}
// аммонит / наутилус: спиральная раковина и щупальца
function seaAmmonite(o) {
  const shellC = o.shellC || o.pal.back;
  return marine(Object.assign({ kind: 'fish', ridge: 0, jaw: false, fluke: false, dorsal: false, flippers: false, eyeK: 1.6,
    keys: SK([[-0.5, 1.0, .01, .01, .01], [-0.4, 1.0, .12, .12, .12], [-0.1, 1.0, .22, .22, .22], [0.25, 1.0, .2, .2, .2], [0.5, 1.0, .14, .14, .14], [0.62, 1.0, .02, .02, .02]]),
    bones: [-0.3, 0.1, 0.4], rootI: 1, headX: 0.25, eyeX: 0.3,
    extras: ({ S, kit, k }) => {
      const rb = S.bones[1], ro = S.rest[1];
      // раковина: плоская спираль, устье спереди (там, откуда выходят щупальца), витки уходят назад
      const R = 0.55 * k, A = new V3(0.05 * k, 1.0 * k, 0), Cn = A.clone().add(new V3(-R, 0, 0));
      kit.add(rb, ro, 'skin', spiralHornGeo(R, 0.27 * k, 2.6), M_trs(A, 0, 0, -PI / 2, new V3(1, 1, 0.75)), shellC);
      kit.add(rb, ro, 'skin', UNIT.sph, M_ell(Cn, [0.3 * k, 0.3 * k, 0.12 * k]), mulHex(shellC, 0.85), true);
      if (o.stripes) for (let i = 0; i < 7; i++) { const a2 = i / 7 * 6.283; kit.add(rb, ro, 'acc', UNIT.sphLo, M_ell(Cn.clone().add(new V3(Math.cos(a2) * 0.36 * k, Math.sin(a2) * 0.36 * k, 0)), [0.05 * k, 0.16 * k, 0.17 * k], new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), a2)), 0x8a4a2a); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; kit.add(S.bones[2], S.rest[2], 'skin', UNIT.coneLo, M_spike(new V3(0.5 * k, (1.0 + Math.cos(a) * 0.08) * k, Math.sin(a) * 0.08 * k), new V3(1, Math.cos(a) * 0.35 - 0.2, Math.sin(a) * 0.35), 0.45 * k, 0.03 * k), mulHex(o.pal.belly, 0.9)); }
      if (o.glow) for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; for (const sd of [1, -1]) kit.add(rb, ro, 'glow', UNIT.sphLo, M_ell(new V3(-0.5 * k + Math.cos(a) * 0.32 * k, 1.0 * k + Math.sin(a) * 0.32 * k, sd * 0.17 * k), [0.045 * k, 0.045 * k, 0.045 * k]), o.glow); }
    } }, o));
}
// удильщик: круглое тело, огромная пасть с длинными зубами, светящаяся «удочка»
function seaAngler(o) {
  return marine(Object.assign({ kind: 'marine', ridge: 0, glowEyes: true, irisC: 0xd8f0ff, eyeK: 0.8,
    keys: SK([[-1.9, 1.0, .01, .01, .01], [-1.7, 1.0, .08, .08, .05], [-1.2, 1.0, .26, .26, .2], [-0.5, 1.0, .6, .6, .5], [0.3, 1.0, .78, .8, .66], [0.9, 1.02, .7, .74, .62, 2.2],
      [1.3, 1.05, .5, .52, .5, 2.3, .05], [1.55, 1.07, .28, .28, .3], [1.65, 1.07, .05, .05, .05]]),
    bones: [-1.4, -0.6, 0.4, 0.9], rootI: 2, headX: 0.9, eyeX: 1.18, snoutX: 1.62, hingeY: 0.78,
    jawKeys: SK([[0.75, 0.78, .14, .3, .56, 2.2], [1.3, 0.76, .12, .22, .46], [1.62, 0.8, .05, .08, .2], [1.7, 0.81, .005, .005, .005]]),
    flukeX: -1.75, flukeK: 1.3, dorsalX: -0.6, dorsalK: 0.7, frontX: 0.2, hindX: -0.6, flipK: 0.9,
    extras: ({ kit, head, headO, k }) => {
      const base = new V3(1.0 * k, 1.78 * k, 0);
      kit.add(head, headO, 'acc', hornGeo(0.9 * k, 0.025 * k, 0.9), M_trs(base, 0, 0, 1.2, 1), 0x3a3a48);
      kit.add(head, headO, 'glow', UNIT.sph, M_ell(new V3(1.52 * k, 2.3 * k, 0), [0.11 * k, 0.11 * k, 0.11 * k]), o.lureC || 0x9af4ff);
      for (const sd of [1, -1]) for (let i = 0; i < 6; i++) kit.add(head, headO, 'acc', UNIT.coneLo, M_spike(new V3((1.05 + i * 0.1) * k, 0.84 * k, sd * (0.42 - i * 0.04) * k), new V3(0.1, -1, 0), 0.22 * k, 0.025 * k), 0xf0ead8);
    } }, o));
}
// дунклеостей: бронированная голова из костных пластин, режущие «ножницы» вместо зубов
function seaDunkle(o) {
  const armor = o.armorC || 0x3a3a42;
  return marine(Object.assign({ kind: 'marine', ridge: 0, teeth: false,
    keys: SK([[-2.6, 1.05, .01, .01, .01], [-2.4, 1.05, .07, .06, .05], [-1.8, 1.0, .2, .18, .14], [-1.0, 1.0, .4, .36, .32], [-0.1, 1.0, .56, .5, .46], [0.7, 1.0, .62, .56, .52],
      [1.3, 1.0, .6, .5, .5, 2.4, .05], [1.8, 0.98, .48, .36, .42, 2.5], [2.1, 0.95, .3, .2, .3, 2.4], [2.25, 0.94, .06, .05, .06], [2.3, 0.94, .01, .01, .01]]),
    bones: [-2.2, -1.5, -0.7, 0.3, 1.3, 1.75], rootI: 3, headX: 1.3, eyeX: 1.82, snoutX: 2.25, hingeY: 0.72,
    jawKeys: SK([[1.2, 0.72, .1, .2, .44, 2.3], [1.8, 0.7, .08, .14, .34], [2.15, 0.74, .04, .06, .14], [2.25, 0.75, .005, .005, .005]]),
    flukeX: -2.45, flukeK: 1.3, dorsalX: 0.1, dorsalK: 1.3, frontX: 0.9, hindX: -1.2, flipK: 1.1,
    extras: ({ L, S, kit, head, headO, k }) => {
      kit.add(head, headO, 'skin', UNIT.sph, M_ell(new V3(1.62 * k, 1.36 * k, 0), [0.62 * k, 0.22 * k, 0.5 * k]), armor, true);
      for (const sd of [1, -1]) {
        kit.add(head, headO, 'skin', UNIT.sph, M_ell(new V3(1.55 * k, 1.05 * k, sd * 0.44 * k), [0.55 * k, 0.32 * k, 0.1 * k]), mulHex(armor, 1.1), true);
        kit.add(head, headO, 'acc', UNIT.cone, M_spike(new V3(2.1 * k, 0.8 * k, sd * 0.12 * k), new V3(0.3, -1, 0), 0.22 * k, 0.07 * k), 0xd8d0c0);
      }
      kit.add(S.bones[3], S.rest[3], 'skin', UNIT.sph, M_ell(new V3(0.9 * k, 1.42 * k, 0), [0.5 * k, 0.12 * k, 0.4 * k]), mulHex(armor, 0.9), true);
      if (o.lava) glowDots(L, S, kit, k, 0xff6a1a, 7, -1.6, 1.2, 0.05);
    } }, o));
}
// мозазавр бездны / тилозавр: тело морского ящера, фотофоры, светящиеся глаза
function seaMosa(o) {
  return marine(Object.assign({ glowEyes: true, irisC: o.irisC || 0x7af0ff, finK: 0.15,
    extras: ({ L, S, kit, k }) => { glowDots(L, S, kit, k, o.glowC || 0x6ad8ff, o.dots || 9, -2.2, 1.0, 0.045); if (o.spikes) for (let i = 0; i < o.spikes; i++) { const u = L.uAtX((1.0 - i * 0.32) * k), p = L.pointAtU(u, 0, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.5, 1, 0), (0.2 - i * 0.008) * k, 0.05 * k), 0x0e1420); } } }, o));
}

// ======================================================================== ВРАГИ
// модели кешируются по виду: клон скелета дешевле, чем новая сборка (у каждого клона свои кости)
const ENEMY_DEF = {
  compy: (a) => theropod({ k: 0.2, slim: 0.85, headK: 0.95, tailK: 1.15, legK: 1.05, pal: palette(a.color), pat: { type: 'stripes', amt: 0.55, freq: 6, from: 0.05, to: 0.6 }, q: 0.55, spikes: 0 }),
  ashling: (a) => theropod({ k: 0.21, slim: 0.85, tailK: 1.15, pal: palette(a.color), pat: { type: 'stripes', amt: 0.7, freq: 6, from: 0.05, to: 0.6 }, q: 0.55, spikes: 4, spikeType: 'glow', spikeC: 0xff7a2a, emis: 0x2a0a00 }),
  hare: (a) => quadruped({ k: 0.42, head: 'hare', bulk: 1.1, legK: 0.75, tailK: 0.2, neckK: 0.35, neckUp: 0.2, eyeK: 1.5, pal: palette(a.color, { bellyTo: 0xffffff }), pat: null, q: 0.55, legW: 0.8, extras: ({ S, kit, k }) => kit.add(S.bones[0], S.rest[0], 'skin', UNIT.sph, M_ell(S.rest[0].clone(), [0.22 * k, 0.22 * k, 0.22 * k]), 0xffffff, true) }),
  goat: (a) => quadruped({ k: 0.48, head: 'goat', bulk: 0.85, legK: 1.15, tailK: 0.3, neckK: 0.7, neckUp: 0.25, pal: palette(a.color), pat: null, q: 0.55, legW: 0.7 }),
  gecko: (a) => sprawler({ k: 0.32, snoutK: 0.45, tailK: 1.25, legW: 1.2, pal: palette(a.color), pat: { type: 'spots', amt: 0.6, freq: 6 }, q: 0.55, teeth: false, scutes: false, eyeK: 1.4 }),
  frog: (a) => frog({ k: 0.9, pal: palette(a.color, { bellyTo: 0xf0f0c0 }), pat: { type: 'spots', amt: 0.5, freq: 5 } }),
  toxfrog: (a) => frog({ k: 1.0, pal: palette(a.color, { stripe: 0x1a1a1a }), pat: { type: 'spots', amt: 0.8, freq: 7 }, irisC: 0xff4030 }),
  bug: (a) => bug({ k: 1.0, pal: palette(a.color, { back: 0x2a6a9a, stripe: 0x14304a }), wingC: 0xd6f0ff }),
  ember: (a) => bug({ k: 1.0, moth: true, glow: true, pal: palette(a.color, { stripe: 0x6a2a00 }), wingC: 0xffa040, emis: 0x401400 }),
  fish: (a) => marine({ k: 0.22, kind: 'fish', pal: palette(a.color, { bellyTo: 0xf4f6f0, bellyK: 0.8 }), pat: { type: 'stripes', amt: 0.35, freq: 4 }, q: 0.45, keys: [{ x: -2.4, y: 1.8, top: .02, bot: .02, w: .01 }, { x: -2.2, y: 1.8, top: .12, bot: .12, w: .06 }, { x: -1.4, y: 1.8, top: .55, bot: .55, w: .3 }, { x: -0.2, y: 1.82, top: .85, bot: .8, w: .45 }, { x: 0.9, y: 1.82, top: .7, bot: .65, w: .4 }, { x: 1.6, y: 1.8, top: .4, bot: .36, w: .28 }, { x: 1.9, y: 1.78, top: .1, bot: .1, w: .08 }], bones: [-1.8, -0.9, 0.1, 1.2], rootI: 2, headX: 1.2, eyeX: 1.45, jaw: false, flippers: false, flukeX: -2.2, flukeK: 1.6, dorsalX: -0.2, dorsalK: 2.2, eyeK: 2.2, ridge: 0, glowEyes: !!a.glow, irisC: a.glow, extras: a.glow ? ({ L, S, kit, k }) => glowDots(L, S, kit, k, a.glow, 4, -1.4, 0.8, 0.06) : undefined }),
  eel: (a) => marine({ k: 0.42, kind: 'fish', pal: palette(a.color), pat: { type: 'spots', amt: 0.5, freq: 3 }, q: 0.6, keys: [{ x: -3.4, y: 0.9, top: .01, bot: .01, w: .01 }, { x: -3.2, y: 0.9, top: .06, bot: .06, w: .05 }, { x: -2.0, y: 0.9, top: .14, bot: .14, w: .12 }, { x: -0.5, y: 0.9, top: .2, bot: .2, w: .18 }, { x: 0.8, y: 0.9, top: .22, bot: .22, w: .2 }, { x: 1.4, y: 0.9, top: .22, bot: .18, w: .2, sq: 2.3 }, { x: 1.9, y: 0.88, top: .12, bot: .09, w: .12 }, { x: 2.1, y: 0.87, top: .02, bot: .02, w: .02 }], bones: [-2.8, -2.0, -1.2, -0.4, 0.4, 1.1, 1.45], rootI: 4, headX: 1.4, eyeX: 1.6, snoutX: 2.0, hingeY: 0.85, jawKeys: [{ x: 1.35, y: 0.85, top: .05, bot: .08, w: .15 }, { x: 1.8, y: 0.83, top: .04, bot: .05, w: .1 }, { x: 2.05, y: 0.84, top: .005, bot: .005, w: .005 }], flippers: false, flukeX: -3.1, flukeK: 0.7, dorsalX: -1.2, dorsalK: 0.8, ridge: 0, glowEyes: true, irisC: 0xffd23a, emis: a.burn ? 0x2a0800 : undefined, extras: a.burn ? ({ L, S, kit, k }) => glowDots(L, S, kit, k, 0xff7a2a, 8, -2.8, 1.0, 0.05) : undefined }),
  raptor: (a) => theropod({ k: 0.36, slim: 0.82, headK: 0.86, tailK: 1.12, legK: 1.06, armK: 1.6, sickle: true, pal: palette(a.color), pat: { type: 'stripes', amt: 0.8, freq: 8, from: 0.05, to: 0.66 }, q: 0.7, spikes: 0 }),
  frostwolf: (a) => theropod({ k: 0.38, slim: 0.86, headK: 0.88, tailK: 1.1, legK: 1.05, armK: 1.4, sickle: true, pal: palette(a.color, { bellyTo: 0xffffff, bellyK: 0.7 }), pat: { type: 'spots', amt: 0.45, freq: 3 }, q: 0.7, spikes: 7, spikeType: 'ice', spikeLen: 0.35, irisC: 0x7af0ff, glowEyes: true }),
  cragwolf: (a) => theropod({ k: 0.4, slim: 0.92, headK: 0.9, tailK: 1.05, armK: 1.3, sickle: true, pal: palette(a.color), pat: { type: 'stripes', amt: 0.5, freq: 6 }, q: 0.7, spikes: 8, spikeC: 0xaaaab4, spikeLen: 0.2 }),
  scorp: (a) => theropod({ k: 0.38, slim: 0.86, headK: 0.85, tailK: 1.15, armK: 1.4, pal: palette(a.color, { stripe: 0xc6ff4a }), pat: { type: 'spots', amt: 0.85, freq: 3.5 }, q: 0.7, spikes: 6, spikeType: 'glow', spikeC: 0x7aff5a, irisC: 0xc6ff4a, glowEyes: true }),
  magmaraptor: (a) => theropod({ k: 0.4, slim: 0.86, headK: 0.88, tailK: 1.1, armK: 1.4, sickle: true, pal: palette(a.color, { back: 0x2a1410, stripe: 0xff6a1a }), pat: { type: 'stripes', amt: 0.9, freq: 8, from: 0.05, to: 0.7 }, emis: 0x2a0800, q: 0.7, spikes: 6, spikeType: 'glow', spikeC: 0xff7a2a, irisC: 0xffd23a, glowEyes: true }),
  stego: (a) => quadruped({ k: 0.82, head: 'plain', plates: true, tailSpikes: true, neckK: 0.7, bulk: 1.05, pal: palette(a.color), pat: { type: 'bands', amt: 0.4, freq: 6, from: 0.1, to: 0.7 }, q: 0.75 }),
  mammoth: (a) => quadruped({ k: 0.9, head: 'mammoth', fur: true, bulk: 1.25, tailK: 0.35, neckK: 0.35, legW: 1.2, pal: palette(a.color), pat: null, q: 0.75 }),
  ram: (a) => quadruped({ k: 0.85, head: 'ram', bulk: 1.05, tailK: 0.5, neckK: 0.8, neckUp: 0.2, pal: palette(a.color), pat: { type: 'spots', amt: 0.3, freq: 3 }, q: 0.75 }),
  dune: (a) => quadruped({ k: 0.85, head: 'hadro', neckK: 1.1, neckUp: 0.25, pal: palette(a.color), pat: { type: 'stripes', amt: 0.55, freq: 7, from: 0.1, to: 0.7 }, q: 0.75, crestC: 0xd06a3a }),
  ashtrike: (a) => quadruped({ k: 0.92, head: 'cera', hornK: 0.25, frillK: 0.12, stage: 1, pal: palette(a.color, { stripe: 0xff6a1a }), pat: { type: 'stripes', amt: 0.6, freq: 6 }, q: 0.75, glowEyes: true, irisC: 0xff8a2a, emis: 0x1a0600 }),
  ptero: (a) => pterosaur({ k: 0.95, pal: palette(a.color), pat: { type: 'bands', amt: 0.3, freq: 5 }, q: 0.65 }),
  vulture: (a) => pterosaur({ k: 0.85, beakK: 0.65, crest: false, pal: palette(a.color, { belly: 0xd89a8a }), pat: null, q: 0.65, beakC: 0xd8c060, memC: 0x3a2e24 }),
  fireptero: (a) => pterosaur({ k: 1.0, pal: palette(a.color, { back: 0x3a1408 }), pat: { type: 'bands', amt: 0.4, freq: 5 }, q: 0.65, crestC: 0xff7a2a, memC: 0xb0401a, memTip: 0xffa040, emis: 0x2a0800, glowEyes: true, irisC: 0xffd23a }),
  croc: (a) => sprawler({ k: 0.75, pal: palette(a.color), pat: { type: 'bands', amt: 0.45, freq: 9, from: 0.0, to: 0.6 }, q: 0.7 }),
  // ---- океан ----
  shark: (a) => seaShark({ k: 0.42, pal: palette(a.color, { bellyTo: 0xf2f4f0, bellyK: 0.85 }), pat: { type: 'stripes', amt: 0.25, freq: 5 }, q: 0.65, irisC: a.slow ? 0x9af0ff : 0x1a1a14, glowEyes: !!a.slow, finC: mulHex(a.color, 0.8) }),
  turtle: (a) => seaTurtle({ k: 0.62, pal: palette(a.color, { bellyTo: 0xe8e0c0 }), pat: { type: 'spots', amt: 0.5, freq: 4 }, q: 0.65, shellC: mulHex(a.color, 0.7) }),
  ichthyo: (a) => seaIchthyo({ k: 0.42, pal: palette(a.color, { bellyTo: 0xeef2f4, bellyK: 0.85 }), pat: { type: 'spots', amt: 0.3, freq: 3 }, q: 0.65, irisC: 0xe8c040 }),
  plesio: (a) => seaPlesio({ k: 0.55, neck: a.longNeck ? 1.6 : 1, pal: palette(a.color, { bellyTo: 0xe8ecdc }), pat: { type: 'spots', amt: 0.45, freq: 3.5 }, q: 0.65 }),
  ammonite: (a) => seaAmmonite({ k: 0.6, pal: palette(a.color, { belly: 0xd8a890 }), pat: null, q: 0.5, shellC: a.color, stripes: !!a.stripes, glow: a.glow, irisC: 0x1a1a14 }),
  angler: (a) => seaAngler({ k: 0.5, pal: palette(a.color, { bellyTo: 0x4a4a5a }), pat: { type: 'spots', amt: 0.4, freq: 4 }, q: 0.65 }),
  dunkle: (a) => seaDunkle({ k: 0.42, pal: palette(a.color, { bellyTo: 0xb8b0a0 }), pat: { type: 'stripes', amt: 0.3, freq: 4 }, q: 0.65, irisC: 0xffd23a }),
  abyssmosa: (a) => seaMosa({ k: 0.55, pal: palette(a.color, { bellyTo: 0x3a4a6a, bellyK: 0.6 }), pat: { type: 'spots', amt: 0.4, freq: 3 }, q: 0.65, emis: 0x02060c }),
  magmaeel: (a) => ENEMY_DEF.eel(Object.assign({}, a, { color: a.color })),
  lanternfish: (a) => ENEMY_DEF.fish(a)
};
const enemyProto = new Map();
function cloneRig(srcRoot) {
  // глубокий клон с костями: SkeletonUtils.clone (упрощённо)
  const map = new Map();
  const ud = srcRoot.userData; srcRoot.userData = {};
  const clone = srcRoot.clone(true);
  srcRoot.userData = ud;
  const srcList = [], dstList = [];
  srcRoot.traverse(o => srcList.push(o)); clone.traverse(o => dstList.push(o));
  for (let i = 0; i < srcList.length; i++) map.set(srcList[i], dstList[i]);
  for (let i = 0; i < srcList.length; i++) {
    const s = srcList[i], d = dstList[i];
    if (s.isSkinnedMesh) {
      const bones = s.skeleton.bones.map(b => map.get(b));
      d.bind(new THREE.Skeleton(bones, s.skeleton.boneInverses), s.bindMatrix);
      d.boundingSphere = s.boundingSphere ? s.boundingSphere.clone() : null;
    }
  }
  // переносим ссылки рига
  const P = srcRoot.userData.parts, M2 = (o) => (o ? map.get(o) || o : o);
  const R = Object.assign({}, P);
  R.root = clone; R.body = M2(P.body); R.frame = M2(P.frame); R.jaw = M2(P.jaw); R.headG = M2(P.headG);
  R.spine = P.spine ? { root: M2(P.spine.root), tail: P.spine.tail.map(M2), neck: P.spine.neck.map(M2), head: M2(P.spine.head) } : null;
  R.legs = P.legs.map(l => Object.assign({}, l, { g: M2(l.g), bones: l.bones ? l.bones.map(M2) : l.bones }));
  R.arms = P.arms.map(a => Object.assign({}, a, { g: M2(a.g), arm: M2(a.arm) }));
  R.wings = P.wings.map(w => Object.assign({}, w, { g: M2(w.g), b0: M2(w.b0), b1: M2(w.b1) }));
  R.flippers = P.flippers.map(f => Object.assign({}, f, { g: M2(f.g) }));
  if (P.frogLegs) R.frogLegs = P.frogLegs.map(l => Object.assign({}, l, { hind: M2(l.hind), front: M2(l.front) }));
  if (P.scorpTail) R.scorpTail = P.scorpTail.map(M2);
  R.anch = P.anch ? Object.assign({}, P.anch, { head: M2(P.anch.head) }) : null;
  R.cosm = null; R.crown = null;
  clone.userData = { parts: R, arch: srcRoot.userData.arch, phase: Math.random() * 6, bite: 0 };
  return clone;
}
export function buildEnemy(a) {
  let proto = enemyProto.get(a.id);
  if (!proto) {
    const mk = ENEMY_DEF[a.id] || ((ENEMY_DEF[a.model] && a.model !== a.id ? ENEMY_DEF[a.model] : { critter: ENEMY_DEF.compy, bug: ENEMY_DEF.bug, fish: ENEMY_DEF.fish, biped: ENEMY_DEF.raptor, quad: ENEMY_DEF.stego, ptero: ENEMY_DEF.ptero, croc: ENEMY_DEF.croc }[a.model])) || ENEMY_DEF.compy;
    const rig = mk(a); finalize(rig, rig.root); rig.root.userData.arch = a;
    const big = a.size >= 1.2;
    rig.root.traverse(o => { if (o.isMesh) o.castShadow = big && o.castShadow; });
    proto = rig.root; enemyProto.set(a.id, proto);
  }
  const root = cloneRig(proto);
  root.scale.setScalar(a.size * (a.model === 'bug' ? 1.2 : 1));
  return root;
}
export function animateEnemy(g, t, speed, dt, atk, flying, base) {
  const P = g.userData.parts, ph = g.userData.phase, tt = t + ph;
  // враги бегут, когда гонятся или убегают (скорость ≥ ~3/4 от их максимальной), и шагают, когда бродят
  const run = flying ? 0 : sstep(0.6, 0.85, speed / (base || 1));
  let bite = g.userData.bite; if (bite > 0) { bite = Math.max(0, bite - dt * 2.1); g.userData.bite = bite; }
  const sw = Math.min(speed, 1.4);
  if (P.isBug) { animRig(P, tt, sw, dt, {}); P.body.position.y = Math.sin(tt * 3) * 0.08; return; }
  const swim = P.aquatic;
  animRig(P, tt, swim ? Math.max(0.6, sw) : sw, dt, { bc: biteCurve(bite), fly: flying && P.flies, swim, run, sc: g.scale.x, v: speed * 6 });
  if (P.gait === 'hop') { P.body.position.y = Math.max(0, Math.sin(P.gph * 0.7)) * 0.25 * sw; return; }
  P.body.position.y = bodyBob(P, sw, swim, flying && P.flies) * 0.9 + (flying ? Math.sin(tt * 2) * 0.1 : 0);
  P.body.rotation.x = (flying && P.flies ? 0.15 : 0) + (P.run || 0) * (P.gait === 'quad' ? 0.03 + Math.sin(P.gph) * 0.04 : 0.11);
}

// ======================================================================== БОССЫ
function bossTyrant(def) {
  return theropod({ k: 0.6, slim: 1.08, headK: 1.06, pal: palette(def.color, { stripe: 0x1e120a }), pat: { type: 'stripes', amt: 0.85, freq: 7, from: 0.04, to: 0.64 }, q: 1.1, spikes: 9, spikeLen: 0.12, crest: 0xb3262c, glowEyes: true, irisC: 0xff9a2a, browHorns: true,
    extras: ({ L, kit, head, headO, X, s }) => { for (const sd of [1, -1]) for (let i = 0; i < 3; i++) { const p = L.pointAtX(X(3.5 + i * 0.12), sd * (1.5 + i * 0.1), -0.005 * s); kit.add(head, headO, 'acc', UNIT.sphLo, M_ell(p.pos, [0.12 * s, 0.012 * s, 0.02 * s], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.6))), 0x3a1a12); } } });
}
function bossFrost(def) {
  return quadruped({ k: 1.15, head: 'mammoth', fur: true, furK: 1.3, furC: 0xe8f4ff, bulk: 1.3, tailK: 0.35, neckK: 0.35, legW: 1.25, tuskK: 1.3, pal: palette(def.color, { back: 0x6a9ac0, bellyTo: 0xffffff }), pat: null, q: 1.0, glowEyes: true, irisC: 0x7af0ff,
    extras: ({ L, S, kit, k }) => {
      for (let i = 0; i < 14; i++) {
        const t = i / 13, u = L.uAtX((-1.4 + 2.6 * t) * k), th = ((i % 3) - 1) * 0.5, p = L.pointAtU(u, th, 0.05 * k), bi = nearestBone(S, u);
        const len = (0.4 + 0.25 * Math.sin(t * PI) + (i % 2) * 0.12) * k;
        kit.add(S.bones[bi], S.rest[bi], 'ice', UNIT.coneLo, M_spike(p.pos, p.dir.clone().add(new V3(-0.25, 0.6, 0)), len, len * 0.22), 0xffffff);
      }
    } });
}
function bossRam(def) {
  return quadruped({ k: 1.35, head: 'ram', hornK: 0.5, bulk: 1.2, tailK: 0.5, neckK: 0.9, neckUp: 0.25, legW: 1.15, pal: palette(def.color), pat: { type: 'bands', amt: 0.35, freq: 5 }, q: 1.0, glowEyes: true, irisC: 0xff5a2a,
    extras: ({ L, S, kit, k }) => { for (let i = 0; i < 7; i++) { const u = L.uAtX((-1.3 + i * 0.4) * k), p = L.pointAtU(u, 0, 0.02 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.sph, M_ell(p.pos, [0.3 * k, 0.12 * k, 0.4 * k]), 0x7a7a80, true); } } });
}
function bossSand(def) { return scorpion({ k: 0.85, pal: palette(def.color, { stripe: 0x6a4a1a }), q: 1.0 }); }
function bossLeviathan(def) {
  return marine({ k: 1.0, pal: palette(def.color, { bellyTo: 0xe8f4f0, bellyK: 0.7 }), pat: { type: 'spots', amt: 0.5, freq: 2.2 }, q: 1.1, glowEyes: true, irisC: 0xffd23a,
    keys: [{ x: -2.6, y: 1.3, top: .01, bot: .01, w: .01 }, { x: -2.4, y: 1.3, top: .08, bot: .08, w: .06 }, { x: -1.6, y: 1.36, top: .4, bot: .38, w: .36 }, { x: -0.6, y: 1.45, top: .78, bot: .72, w: .8, ridge: .04 }, { x: 0.4, y: 1.5, top: .82, bot: .78, w: .86, ridge: .04 }, { x: 1.2, y: 1.6, top: .5, bot: .5, w: .5 }, { x: 1.7, y: 2.0, top: .34, bot: .34, w: .34 }, { x: 2.1, y: 2.5, top: .3, bot: .3, w: .3 }, { x: 2.4, y: 2.95, top: .28, bot: .28, w: .28 }, { x: 2.75, y: 3.25, top: .3, bot: .26, w: .3, sq: 2.3, brow: .04 }, { x: 3.1, y: 3.3, top: .24, bot: .18, w: .23, sq: 2.4 }, { x: 3.5, y: 3.22, top: .13, bot: .1, w: .13 }, { x: 3.75, y: 3.18, top: .04, bot: .04, w: .04 }, { x: 3.82, y: 3.17, top: .01, bot: .01, w: .01 }],
    bones: [-2.0, -1.2, 0.0, 1.2, 1.75, 2.15, 2.45, 2.8], rootI: 2, headX: 2.8, eyeX: 2.95, snoutX: 3.7, hingeY: 3.14,
    jawKeys: [{ x: 2.75, y: 3.14, top: .07, bot: .12, w: .24 }, { x: 3.2, y: 3.08, top: .06, bot: .09, w: .17 }, { x: 3.6, y: 3.08, top: .04, bot: .05, w: .08 }, { x: 3.72, y: 3.09, top: .005, bot: .005, w: .005 }],
    frontX: 0.6, hindX: -1.2, flipK: 2.2, flukeX: -2.4, flukeK: 0.8, dorsalX: -0.3, dorsalK: 1.4, ridge: 10, finC: 0x2a6a8a });
}
function bossDragon(def) {
  return quadruped({ k: 1.25, head: 'plain', neckK: 2.2, neckUp: 0.9, tailK: 1.25, bulk: 1.05, pal: palette(def.color, { back: 0x3a0e08, belly: 0xe08a4a, stripe: 0x1a0604 }), pat: { type: 'bands', amt: 0.5, freq: 8, from: 0.02, to: 0.55 }, q: 1.0, glowEyes: true, irisC: 0xffe03a, emis: 0x1e0402,
    extras: ({ L, S, kit, head, headO, k, rig }) => {
      for (const sd of [1, -1]) { const p = L.pointAtX((L.crest[L.rings - 1].x / k - 0.65) * k, sd * 0.55, 0.01 * k); kit.add(head, headO, 'acc', hornGeo(0.7 * k, 0.1 * k, 0.5), M_trs(p.pos, sd * -0.2, sd * 0.1, 2.5), 0x2a2220); }
      for (let i = 0; i < 12; i++) { const u = L.uAtX((-2.6 + i * 0.4) * k), p = L.pointAtU(u, 0, 0.02 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.cone, M_spike(p.pos, new V3(-0.4, 1, 0), (0.35 - Math.abs(i - 5) * 0.02) * k, 0.07 * k), 0x2a2220); }
      const tip = L.pointAtU(0.05, 0, 0); kit.add(S.bones[0], S.rest[0], 'glow', UNIT.sph, M_ell(tip.pos, [0.18 * k, 0.18 * k, 0.18 * k]), 0xff6a1a);
      const sn = L.crest[L.rings - 1]; kit.add(head, headO, 'glow', UNIT.sph, M_ell(sn.clone().add(new V3(-0.05 * k, -0.04 * k, 0)), [0.09 * k, 0.06 * k, 0.09 * k]), 0xff6a1a);
      const pal = palette(0x7a1a12); for (const sd of [1, -1]) rig.wings.push(wing(rig.frame, new V3(0.6 * k, 1.75 * k, sd * 0.5 * k), sd, 3.8 * k, 2.0 * k, pal, 0x7a1a12, 0xb0401a, 0x2a0600, 1));
    } });
}
// ---- боссы океана ----
function bossMegalodon(def) { return seaShark({ k: 1.0, pal: palette(def.color, { bellyTo: 0xeef0ea, bellyK: 0.85, stripe: 0x3a4450 }), pat: { type: 'stripes', amt: 0.35, freq: 6 }, q: 1.0, irisC: 0x101010, finC: 0x4a5866, dorsalK: 2.9,
  extras: ({ L, S, kit, k }) => { for (let i = 0; i < 6; i++) for (const sd of [1, -1]) { const u = L.uAtX((-0.6 + i * 0.32) * k), p = L.pointAtU(u, sd * 0.9, 0.005 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.sphLo, M_ell(p.pos, [0.22 * k, 0.03 * k, 0.05 * k]), 0x8a96a4); } } }); }
function bossPlesioQueen(def) { return seaPlesio({ k: 1.0, neck: 1.5, pal: palette(def.color, { bellyTo: 0xe8f0dc, stripe: 0x24402c }), pat: { type: 'bands', amt: 0.45, freq: 8 }, q: 1.0, glowEyes: true, irisC: 0xb8ff6a,
  extras: ({ kit, head, headO, k }) => { for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.35; kit.add(head, headO, 'glow', UNIT.cone, M_spike(new V3((4.15 - Math.abs(a) * 0.3) * k, 1.58 * k, a * 0.25 * k), new V3(-0.4, 1, a), (0.32 - Math.abs(i - 2) * 0.06) * k, 0.045 * k), 0xb8ff6a); } } }); }
function bossKronos(def) {
  return marine({ k: 1.1, pal: palette(def.color, { back: 0x3a5a78, bellyTo: 0xf4fbff }), pat: { type: 'spots', amt: 0.35, freq: 3 }, q: 1.0, glowEyes: true, irisC: 0x7af0ff, flipK: 1.6, fluke: false, dorsal: false,
    keys: SK([[-2.6, 0.75, .01, .01, .01], [-2.4, 0.75, .06, .06, .05], [-1.8, 0.78, .2, .2, .2], [-1.0, 0.82, .42, .42, .48], [-0.2, 0.86, .52, .5, .58], [0.6, 0.88, .5, .48, .54], [1.1, 0.92, .4, .36, .4],
      [1.5, 0.98, .42, .32, .4, 2.3, .06], [2.1, 0.96, .34, .24, .32, 2.5], [2.6, 0.92, .22, .14, .2, 2.4], [2.95, 0.9, .07, .05, .07], [3.02, 0.9, .01, .01, .01]]),
    bones: [-2.0, -1.2, -0.2, 1.0, 1.5], rootI: 2, headX: 1.5, eyeX: 1.7, snoutX: 2.95, hingeY: 0.82,
    jawKeys: SK([[1.45, 0.82, .07, .16, .36, 2.3], [2.1, 0.8, .06, .12, .28], [2.65, 0.8, .04, .07, .16], [2.98, 0.82, .005, .005, .005]]),
    extras: ({ L, S, kit, k }) => { for (let i = 0; i < 12; i++) { const t = i / 11, u = L.uAtX((-1.8 + 3.0 * t) * k), th = ((i % 3) - 1) * 0.45, p = L.pointAtU(u, th, 0.03 * k), bi = nearestBone(S, u); const len = (0.3 + 0.2 * Math.sin(t * PI)) * k; kit.add(S.bones[bi], S.rest[bi], 'ice', UNIT.coneLo, M_spike(p.pos, p.dir.clone().add(new V3(-0.3, 0.5, 0)), len, len * 0.22), 0xffffff); } } });
}
function bossDunkleo(def) { return seaDunkle({ k: 1.0, lava: true, pal: palette(def.color, { bellyTo: 0x8a7a6a, stripe: 0x2a1a14 }), pat: { type: 'stripes', amt: 0.4, freq: 5 }, q: 1.0, glowEyes: true, irisC: 0xff8a2a, emis: 0x120400, armorC: 0x2a2a30 }); }
function bossTylo(def) { return seaMosa({ k: 1.15, pal: palette(def.color, { back: 0x0e1424, bellyTo: 0x3a4a6a, bellyK: 0.6, stripe: 0x0a0e18 }), pat: { type: 'bands', amt: 0.4, freq: 9 }, q: 1.0, emis: 0x02040a, irisC: 0xb07aff, glowC: 0x9a7aff, dots: 14, spikes: 9, finK: 0.4 }); }
const BOSS_B = { tyrant: bossTyrant, frost: bossFrost, rogach: bossRam, sandlord: bossSand, leviathan: bossLeviathan, dragon: bossDragon, megalodon: bossMegalodon, plesioqueen: bossPlesioQueen, kronos: bossKronos, dunkleo: bossDunkleo, tylo: bossTylo };
export function buildBoss(id, def) {
  const rig = (BOSS_B[id] || bossTyrant)(def);
  const root = rig.root; finalize(rig, root);
  root.userData.boss = id; root.userData.phase = 0;
  root.traverse(o => { if (o.isMesh) o.castShadow = o.castShadow !== false; });
  root.scale.setScalar(def.size * 0.75);
  return root;
}
export function animateBoss(g, t, speed, dt, o) {
  const P = g.userData.parts; o = o || {};
  let bite = g.userData.bite; if (bite > 0) { bite = Math.max(0, bite - dt * 1.4); g.userData.bite = bite; }
  const sw = Math.min(speed, 1.2);
  animRig(P, t * 0.75, P.aquatic ? Math.max(0.5, sw) * 0.8 : sw * 0.8, dt * 0.75, { bc: biteCurve(bite), roar: o.roar, swim: !!P.aquatic, boss: true, run: P.aquatic ? 0 : sstep(0.95, 1.15, speed) });
  P.body.position.y = bodyBob(P, sw, false, false) * 1.2 + (o.burrow ? -2.6 : 0);
  P.frame.scale.y = 1 + Math.sin(t * 1.6) * 0.012;
}

// ---------- яйцо: гладкая скорлупа с нарисованными пятнами (ничего не торчит наружу) ----------
// рисует скорлупу 512×256 по «скину» (classic, speckle, stripe, gold, crystal, lava, galaxy, jungle, candy, opal)
export function eggCanvas(skin, colorHex) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const base = new THREE.Color(colorHex == null ? 0x6aa84f : colorHex);
  let sd = 7; const R = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280), W = 512, H = 256;
  const hsl = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a == null ? 1 : a})`;
  // мягкое пятнистое «облако»: маленький шум, растянутый со сглаживанием (по горизонтали замкнут)
  const cloud = (cell, rgb, alpha, mode) => {
    const w = Math.ceil(W / cell), h = Math.ceil(H / cell), n = document.createElement('canvas'); n.width = w; n.height = h; const ng = n.getContext('2d'), im = ng.createImageData(w, h);
    const row = new Array(w); for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { const v = R(); const i = (y * w + x) * 4; im.data[i] = rgb[0]; im.data[i + 1] = rgb[1]; im.data[i + 2] = rgb[2]; im.data[i + 3] = v * 255; } }
    ng.putImageData(im, 0, 0); g.save(); g.globalAlpha = alpha; if (mode) g.globalCompositeOperation = mode; g.imageSmoothingEnabled = true; g.drawImage(n, 0, 0, W, H); g.restore();
  };
  const blot = (x, y, rx, ry, rot, col, a) => { for (const ox of [-W, 0, W]) { g.save(); g.translate(x + ox, y); g.rotate(rot); g.scale(1, ry / rx); const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, col.replace('A', a)); gr.addColorStop(0.6, col.replace('A', a * 0.7)); gr.addColorStop(1, col.replace('A', 0)); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, 6.3); g.fill(); g.restore(); } };
  const vgrad = (stops) => { const gr = g.createLinearGradient(0, 0, 0, H); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  const pores = (n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(60,45,30,${R() * a})`; g.fillRect(R() * W, R() * H, 1 + R() * 1.6, 1 + R() * 1.6); } };
  if (skin === 'speckle') {
    // пёстрое яйцо птицы: тёплая кремовая скорлупа, подкожные сиреневые и верхние бурые пятна, гуще к тупому концу
    g.fillStyle = '#e9dcbd'; g.fillRect(0, 0, W, H); cloud(14, [196, 170, 120], 0.35); cloud(5, [250, 244, 224], 0.25);
    for (let i = 0; i < 220; i++) { const y = H * (0.2 + 0.8 * Math.sqrt(R())); blot(R() * W, y, 4 + R() * 9, 3 + R() * 6, R() * 3, 'rgba(120,110,150,A)', 0.14 + R() * 0.2); }
    for (let i = 0; i < 520; i++) { const y = H * (0.15 + 0.85 * Math.pow(R(), 0.6)), r = 1 + R() * R() * 7; blot(R() * W, y, r * 1.5, r, R() * 3, `rgba(${70 + R() * 40 | 0},${42 + R() * 24 | 0},${24 + R() * 16 | 0},A)`, 0.55 + R() * 0.4); }
    pores(1200, 0.12);
  } else if (skin === 'stripe') {
    // прожилки как у чибиса: оливково-серая скорлупа и тёмные петляющие «каракули»
    g.fillStyle = '#b7ae8a'; g.fillRect(0, 0, W, H); cloud(16, [140, 140, 95], 0.4); cloud(6, [230, 222, 190], 0.25);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 90; i++) { let x = R() * W, y = R() * H, a = R() * 6.3; g.beginPath(); g.moveTo(x, y); const L = 10 + R() * 22; for (let k = 0; k < L; k++) { a += (R() - 0.5) * 1.3; x += Math.cos(a) * 5; y += Math.sin(a) * 4; g.lineTo(x, y); } g.strokeStyle = `rgba(${40 + R() * 25 | 0},${30 + R() * 20 | 0},22,${0.55 + R() * 0.4})`; g.lineWidth = 1 + R() * 2.2; g.stroke(); }
    for (let i = 0; i < 160; i++) blot(R() * W, R() * H, 3 + R() * 6, 3 + R() * 5, R() * 3, 'rgba(70,60,45,A)', 0.3);
    pores(900, 0.1);
  } else if (skin === 'gold') {
    // кованое золото: тёплые переливы, мелкая «ковка» и лёгкая патина
    vgrad(['#b98414', '#f3cf55', '#fff0a8', '#e4b230', '#a7730e']); cloud(10, [255, 235, 140], 0.35); cloud(4, [120, 78, 8], 0.22, 'multiply');
    for (let i = 0; i < 700; i++) { const x = R() * W, y = R() * H, r = 3 + R() * 7; const gr = g.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r); gr.addColorStop(0, 'rgba(255,248,200,.22)'); gr.addColorStop(1, 'rgba(110,70,0,.2)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
    for (let i = 0; i < 40; i++) blot(R() * W, R() * H, 10 + R() * 20, 6 + R() * 10, R() * 3, 'rgba(90,70,20,A)', 0.2);
  } else if (skin === 'crystal') {
    // кальцит / агат: молочно-голубые концентрические полосы с прозрачными прожилками
    g.fillStyle = '#dbe9f1'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 14; k++) { const y0 = k * 19 + R() * 6; g.beginPath(); g.moveTo(0, y0); for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + Math.sin(x / W * 12.56 + k) * 9 + Math.sin(x / 19 + k * 2) * 3); g.lineTo(W, y0 + 18); for (let x = W; x >= 0; x -= 16) g.lineTo(x, y0 + 18 + Math.sin(x / W * 12.56 + k) * 9); g.closePath(); g.fillStyle = hsl(195 + R() * 25, 35 + R() * 25, 62 + R() * 28, 0.55); g.fill(); }
    cloud(12, [255, 255, 255], 0.35); cloud(5, [120, 170, 205], 0.15, 'multiply');
    g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 1; for (let i = 0; i < 30; i++) { let x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.3) * 30; y += (R() - 0.5) * 14; g.lineTo(x, y); } g.stroke(); }
  } else if (skin === 'lava') {
    // вулканическое: шершавый базальт и тонкие тлеющие трещины
    g.fillStyle = '#2b2522'; g.fillRect(0, 0, W, H); cloud(9, [75, 60, 52], 0.5); cloud(3, [15, 12, 12], 0.45, 'multiply'); pores(1500, 0.4);
    for (let i = 0; i < 14; i++) { let x = R() * W, y = R() * H; const pts = [[x, y]]; for (let k = 0; k < 12; k++) { x += (R() - 0.5) * 44; y += (R() - 0.45) * 30; pts.push([x, y]); }
      for (const [lw, st] of [[9, 'rgba(255,70,10,.18)'], [4, 'rgba(255,110,20,.55)'], [1.6, 'rgba(255,215,120,.95)']]) { g.beginPath(); pts.forEach((p, j) => j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.strokeStyle = st; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); } }
  } else if (skin === 'galaxy') {
    // чёрный опал: тёмная основа и вспышки зелёного, синего и пурпурного
    g.fillStyle = '#0c0f1a'; g.fillRect(0, 0, W, H); cloud(20, [20, 25, 50], 0.6);
    const hs = [150, 190, 270, 310, 40, 220]; for (let i = 0; i < 55; i++) { const h = hs[i % 6] + R() * 20; blot(R() * W, R() * H, 16 + R() * 40, 10 + R() * 22, R() * 3, `hsla(${h},95%,${50 + R() * 15 | 0}%,A)`, 0.35 + R() * 0.4); }
    cloud(7, [255, 255, 255], 0.06, 'overlay'); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(210,235,255,${R() * 0.8})`; g.fillRect(R() * W, R() * H, 1, 1); }
  } else if (skin === 'jungle') {
    // как яйцо эму: тёмно-зелёная пористая скорлупа с пятнами светлее и тёмнее
    g.fillStyle = '#37543a'; g.fillRect(0, 0, W, H); cloud(14, [90, 120, 70], 0.45); cloud(6, [20, 40, 28], 0.4, 'multiply');
    for (let i = 0; i < 240; i++) blot(R() * W, R() * H, 4 + R() * 12, 3 + R() * 8, R() * 3, R() < 0.5 ? 'rgba(15,28,20,A)' : 'rgba(130,150,90,A)', 0.25 + R() * 0.3);
    for (let i = 0; i < 2200; i++) { g.fillStyle = R() < 0.5 ? `rgba(10,20,14,${R() * 0.55})` : `rgba(170,190,130,${R() * 0.35})`; const r = 0.6 + R() * 1.6; g.beginPath(); g.arc(R() * W, R() * H, r, 0, 6.3); g.fill(); }
  } else if (skin === 'candy') {
    // яйцо малиновки: чистая голубая скорлупа, несколько редких веснушек
    g.fillStyle = '#8fd0d6'; g.fillRect(0, 0, W, H); cloud(18, [140, 215, 215], 0.4); cloud(6, [80, 160, 175], 0.2, 'multiply'); cloud(5, [255, 255, 255], 0.12);
    for (let i = 0; i < 40; i++) { const y = H * (0.3 + 0.7 * R()); blot(R() * W, y, 1.5 + R() * 3, 1.2 + R() * 2.4, R() * 3, 'rgba(150,80,60,A)', 0.45 + R() * 0.4); }
    pores(700, 0.07);
  } else if (skin === 'opal') {
    // жемчуг: перламутровые переходы розового, мятного и золотистого
    vgrad(['#f4e6ec', '#e3eef5', '#e8f4e8', '#f7efdc', '#f4e6ec']);
    for (let i = 0; i < 40; i++) blot(R() * W, R() * H, 20 + R() * 60, 12 + R() * 28, R() * 3, `hsla(${[330, 190, 150, 45][i % 4]},65%,80%,A)`, 0.35 + R() * 0.3);
    cloud(16, [255, 255, 255], 0.3); cloud(4, [150, 140, 150], 0.08, 'multiply');
  } else {
    // обычное яйцо: подкрашенная в цвет динозавра скорлупа с естественными крапинами
    const pale = base.clone().lerp(new THREE.Color(0xf1e8d2), 0.62), dark = base.clone().multiplyScalar(0.45);
    g.fillStyle = '#' + pale.getHexString(); g.fillRect(0, 0, W, H); cloud(14, [dark.r * 255, dark.g * 255, dark.b * 255].map(v => v | 0), 0.18); cloud(5, [255, 252, 240], 0.22);
    const dc = `rgba(${dark.r * 255 | 0},${dark.g * 255 | 0},${dark.b * 255 | 0},A)`;
    for (let i = 0; i < 70; i++) blot(R() * W, R() * H, 3 + R() * 8, 3 + R() * 6, R() * 3, `rgba(${base.r * 200 | 0},${base.g * 200 | 0},${base.b * 200 | 0},A)`, 0.12 + R() * 0.15);
    for (let i = 0; i < 220; i++) { const r = 1 + R() * R() * 6; blot(R() * W, R() * H, r * 1.4, r, R() * 3, dc, 0.5 + R() * 0.4); }
    pores(1200, 0.1);
  }
  return c;
}
export function makeEggMesh(colorHex, skin) {
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * PI, r = Math.sin(a) * (0.82 + 0.12 * Math.cos(a)), y = -Math.cos(a) * 1.18; pts.push(new THREE.Vector2(Math.max(0.0001, r), y)); }
  const c = eggCanvas(skin, colorHex);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  const crack = document.createElement('canvas'); crack.width = 512; crack.height = 256; const cg = crack.getContext('2d'); cg.fillStyle = '#000'; cg.fillRect(0, 0, 512, 256);
  const ctex = new THREE.CanvasTexture(crack);
  const shiny = { gold: [0.3, 0.2], crystal: [0.22, 0.0], opal: [0.18, 0.0], lava: [0.85, 0.0], galaxy: [0.2, 0.0], candy: [0.45, 0.0], jungle: [0.8, 0.0] }[skin] || [0.5, 0];
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: shiny[0], metalness: shiny[1], bumpMap: BUMP, bumpScale: 0.004, emissiveMap: ctex, emissive: new THREE.Color(0xfff2c0), emissiveIntensity: 0 });
  const mk = (from, to) => {
    const p = pts.slice(from, to + 1); const geo = new THREE.LatheGeometry(p, 40);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, (from + uv.getY(i) * (to - from)) / 24);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m;
  };
  const grp = new THREE.Group();
  const lo = mk(0, 15), hi = mk(15, 24);
  grp.add(lo); grp.add(hi);
  // трещины: рисуем зигзаги по экватору на карте свечения
  let crackT = 0;
  grp.userData = {
    lo, hi, mat,
    crack(k) {
      if (k <= crackT + 0.04) return; crackT = k;
      cg.strokeStyle = '#fff'; cg.lineWidth = 3; cg.lineJoin = 'round';
      const n = Math.floor(3 + k * 9);
      cg.fillStyle = '#000'; cg.fillRect(0, 0, 512, 256);
      for (let i = 0; i < n; i++) {
        let x = (i / n) * 512 + 13, y = 256 * (1 - 15 / 24) + (i % 2 ? -6 : 6); cg.beginPath(); cg.moveTo(x, y);
        const len = 20 + k * 70; for (let j = 0; j < 6; j++) { x += (Math.sin(i * 7 + j * 3) * 0.5 + 0.5) * len / 6 * (j % 2 ? 1 : -0.4) + len / 8; y += (j % 2 ? -1 : 1) * (8 + 10 * k); cg.lineTo(x, y); }
        cg.stroke();
      }
      ctex.needsUpdate = true; mat.emissiveIntensity = 0.25 + k * 0.9;
    }
  };
  return grp;
}

// ---------- красный контур вокруг укушенного врага ----------
// «обратный корпус»: копия каждой сетки (с тем же скелетом), вытолкнутая вдоль нормалей и видимая только изнутри, — получается тонкая обводка силуэта
let _olMat = null;
function outlineMat() {
  if (_olMat) return _olMat;
  _olMat = new THREE.MeshBasicMaterial({ color: 0xff2418, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false });
  _olMat.onBeforeCompile = (sh) => {
    sh.uniforms.uOW = { value: 0.05 };
    sh.vertexShader = 'uniform float uOW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * uOW;');
  };
  return _olMat;
}
export function setOutline(root, on, color) {
  if (!root) return;
  let ol = root.userData.ol;
  if (!ol) {
    if (!on) return;
    ol = root.userData.ol = [];
    const src = [];
    root.traverse(o => { if (o.isMesh && !o.userData.isOutline && !o.isSprite && o.geometry && o.geometry.attributes && o.geometry.attributes.normal && !(o.material && o.material.transparent && o.material.opacity < 0.5)) src.push(o); });
    const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3()), w = Math.max(0.02, Math.max(sz.x, sz.y, sz.z) * 0.018 / Math.max(0.01, root.scale.x));
    const mat = outlineMat().clone(); root.userData.olMat = mat; mat.onBeforeCompile = (sh) => { sh.uniforms.uOW = { value: w }; sh.vertexShader = 'uniform float uOW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * uOW;'); };
    mat.customProgramCacheKey = () => 'ol' + w.toFixed(3);
    for (const o of src) {
      const m = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, mat) : new THREE.Mesh(o.geometry, mat);
      if (o.isSkinnedMesh) m.bind(o.skeleton, o.bindMatrix);
      m.userData.isOutline = true; m.frustumCulled = false; m.renderOrder = 3; m.castShadow = false; m.receiveShadow = false;
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); m.visible = false;
      o.parent.add(m); ol.push(m);
    }
  }
  if (on && root.userData.olMat) root.userData.olMat.color.setHex(color || 0xff2418);
  for (const m of ol) m.visible = !!on;
}

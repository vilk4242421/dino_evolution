/* Модели: 4 класса игрока, враги по биомам, 6 боссов.
   Каждое существо — одна непрерывная гладкая «кожа», вытянутая вдоль позвоночника (лофт), с текстурой чешуи,
   градиентом окраса (спина → бока → брюхо), узорами, отдельными глазами с радужкой, зубами, когтями и пальцами.
   Анимация — скелетная (кости внутри кожи), поэтому кожа гнётся плавно и это дёшево для видеокарты.
   Внутри модель строится в системе «x — вперёд, y — вверх, z — вбок», снаружи смотрит в +Z, как и раньше. */
import * as THREE from 'three';
import { TRIKE } from './trike.js';
import { REX } from './rex.js';
import { PTN } from './ptn.js';
import { VEL } from './vel.js';
import { PARA } from './para.js';
import { STEG } from './steg.js';
import { COMP } from './comp.js';
import { TROO } from './troo.js';
import { HERR } from './herr.js';
import { PLES } from './ples.js';
import { KOM } from './kom.js';
import { SPN } from './spn.js';
import { CROC } from './croc.js';
import { QTZ } from './qtz.js';
import { ICH } from './ich.js';
import { ANG } from './ang.js';
import { BRA } from './bra.js';
import { SHK } from './shk.js';
import { CRN } from './crn.js';
import { MOS } from './mos.js';
import { PLIO } from './plio.js';
import { SCP } from './scp.js';
import { LZD } from './lzd.js';
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
  horn: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.02, bumpMap: BUMP, bumpScale: 0.012 }),
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
// цвет века — по реально покрашенной коже рядом с глазом (48 ближайших вершин), а не по базовому цвету палитры: учитывает цвет, морф и узор.
// k: покраска к этому моменту уже умножена на 2 (карта деталей ~0,5), поэтому 0,5 даёт видимый цвет кожи
function lidSkin(L, mp, n, ec, k) {
  const col = L.geo.attributes.color.array, d = new Float32Array(n);
  for (let i = 0; i < n; i++) { const dx = mp[i * 3] - ec[0], dy = mp[i * 3 + 1] - ec[1], dz = Math.abs(mp[i * 3 + 2]) - Math.abs(ec[2]); d[i] = dx * dx + dy * dy + dz * dz; }
  const thr = Float32Array.from(d).sort()[Math.min(48, n - 1)]; let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) if (d[i] <= thr) { r += col[i * 3]; g += col[i * 3 + 1]; b += col[i * 3 + 2]; c++; }
  return new THREE.Color(r / c * k, g / c * k, b / c * k);
}
const lidSide = (pal) => (MORPH && MORPH.c1 != null) ? MORPH.c1 : pal.side, lidBack = (pal) => MORPH ? MORPH.c2 : pal.back;      // цвет век — как у кожи с учётом морфа из магазина
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

// щиток (остеодерма): шестиугольная выпуклая пластинка с килем вдоль x; низ утоплен в кожу, края темнее, центр светлее (атрибут shade)
function scuteGeo() {
  const A = 14, Rn = 5, pos = [], sh = [], idx = [];
  for (let j = 0; j <= Rn; j++) {
    const rho = j / Rn;
    for (let i = 0; i < A; i++) {
      const th = i / A * PI * 2, rr = rho * (1 + 0.1 * Math.cos(6 * th)), x = rr * Math.cos(th), z = rr * Math.sin(th);
      const dome = Math.pow(Math.max(0, 1 - rho * rho), 0.8), keel = 0.45 * Math.exp(-(z * z) / 0.09) * (1 - rho * rho);
      pos.push(x, -0.3 + 1.3 * (dome * 0.82 + keel), z);
      sh.push(Math.min(1.25, 0.66 + 0.45 * Math.pow(1 - rho, 0.8) + keel * 0.5));
    }
  }
  for (let j = 0; j < Rn; j++) for (let i = 0; i < A; i++) {
    const a = j * A + i, b = j * A + (i + 1) % A, c = (j + 1) * A + i, d = (j + 1) * A + (i + 1) % A;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('shade', new THREE.Float32BufferAttribute(sh, 1)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal; let up = 0; for (let i = 0; i < n.count; i++) up += n.getY(i); if (up < 0) { const I = g.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.computeVertexNormals(); }
  const uv = new Float32Array(pos.length / 3 * 2); for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = pos[i * 3] * 0.5 + 0.5; uv[i * 2 + 1] = pos[i * 3 + 2] * 0.5 + 0.5; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// шип: вогнутый конус с расширением у основания, остриё светлее основания; ось y от -0.5 до 0.5 (как у ConeGeometry)
function spikeGeo() {
  const Sg = 10, Tn = 8, pos = [], sh = [], idx = [];
  for (let j = 0; j <= Tn; j++) {
    const t = j / Tn, r = j === Tn ? 0 : Math.pow(1 - t, 1.5) * (1 + 0.5 * Math.pow(1 - t, 5));
    for (let i = 0; i < Sg; i++) { const th = i / Sg * PI * 2; pos.push(Math.cos(th) * r, t - 0.5, Math.sin(th) * r); sh.push(0.72 + 0.62 * Math.pow(t, 1.1)); }
  }
  for (let j = 0; j < Tn; j++) for (let i = 0; i < Sg; i++) { const a = j * Sg + i, b = j * Sg + (i + 1) % Sg, c = (j + 1) * Sg + i, d = (j + 1) * Sg + (i + 1) % Sg; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('shade', new THREE.Float32BufferAttribute(sh, 1)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal; let o = 0; for (let i = 0; i < n.count; i++) o += n.getX(i) * pos[i * 3] + n.getZ(i) * pos[i * 3 + 2]; if (o < 0) { const I = g.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}
UNIT.scute = scuteGeo(); UNIT.spike = spikeGeo();
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
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, SH = g.attributes.shade, T = g.attributes.uv, cnt = P.count;
    nm.getNormalMatrix(it.m); if (it.c !== undefined && it.c !== null) c.set(it.c);
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(it.m); pos[(ov + i) * 3] = v.x; pos[(ov + i) * 3 + 1] = v.y; pos[(ov + i) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(ov + i) * 3] = v.x; nor[(ov + i) * 3 + 1] = v.y; nor[(ov + i) * 3 + 2] = v.z;
      if (C && (it.c === undefined || it.c === null)) { col[(ov + i) * 3] = C.getX(i); col[(ov + i) * 3 + 1] = C.getY(i); col[(ov + i) * 3 + 2] = C.getZ(i); }
      else { const k = (it.j ? 0.9 + 0.2 * vnoise(v.x * 13, v.y * 13, v.z * 13) : 1) * (SH ? SH.getX(i) : 1); col[(ov + i) * 3] = c.r * k; col[(ov + i) * 3 + 1] = c.g * k; col[(ov + i) * 3 + 2] = c.b * k; }
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
      if (e.type === 'eye' || e.type === 'glow') mesh.userData.noOutline = true;   // глаза не обводятся: контур только по телу
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
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [0.04 * s, 0.044 * s, 0.04 * s]), o.irisC || mulHex((glowEye ? 0xffd23a : 0xd99a2b), 0.72));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, 0.032 * s), [0.017 * s, 0.036 * s, 0.017 * s]), 0x050403);
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
    kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.scute, M_ell(p.pos, [0.16 * k, 0.07 * k, 0.12 * k], new THREE.Quaternion().setFromUnitVectors(Y_UP, p.dir)), mulHex(o.pal.back, 0.9), true);
  }
  if (stage >= 3 || o.browHorns) for (const sd of [1, -1]) {
    const p = L.pointAtX(X(3.3), sd * 0.7, 0.01 * s);
    kit.add(head, headO, 'acc', hornGeo(0.4 * s, 0.07 * s, 0.6), M_trs(p.pos, sd * -0.3, sd * -0.3, 1.25), 0xe8dcc0);
  }
  if (o.crest) for (let i = 0; i < 7; i++) {
    const x = 2.95 + i * 0.2, p = L.pointAtX(X(x), 0, 0.005 * s);
    kit.add(head, headO, 'acc', UNIT.spike, M_spike(p.pos, new V3(-0.4, 1, 0), (0.18 + Math.sin(i / 6 * PI) * 0.2) * s, 0.05 * s), o.crest);
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
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.6, es * 0.64, es * 0.6]), o.irisC || mulHex((glowEye ? 0xffd23a : 0x9a6a2a), 0.72));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.45), [es * 0.2, es * 0.46, es * 0.2]), 0x050403);
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
    kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.scute, M_ell(p.pos, [0.17 * k, 0.07 * k, 0.13 * k], new THREE.Quaternion().setFromUnitVectors(Y_UP, p.dir)), mulHex(o.pal.back, 0.9), true);
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
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.62, es * 0.62, es * 0.62]), o.irisC || mulHex((glowEye ? 0xffd23a : 0xe0a030), 0.72));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.42), [es * 0.2, es * 0.44, es * 0.2]), 0x050403);
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
  if ((r.hide || 0) > 0) for (let i = 0; i < r.hide * 2; i++) { const u = L.uAtX((-0.3 + i * 0.12) * k), p = L.pointAtU(u, 0, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.scute, M_ell(p.pos, [0.08 * k, 0.04 * k, 0.07 * k]), mulHex(o.pal.back, 0.9), true); }
  if (stage >= 1) for (let i = 0; i < 2 + stage; i++) { const u = L.uAtX((-0.4 + i * 0.16) * k), p = L.pointAtU(u, 0, 0.005 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.spike, M_spike(p.pos, new V3(-0.4, 1, 0), 0.1 * k, 0.025 * k), mulHex(o.pal.back, 0.95)); }
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
    kit.add(head, headO, glowEye ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.62, es * 0.66, es * 0.62]), o.irisC || mulHex((glowEye ? 0x7af0ff : 0xd9b23a), 0.72));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.45), [es * 0.22, es * 0.46, es * 0.22]), 0x050403);
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
  for (let i = 0; i < nr; i++) { const u = L.uAtX((0.9 - i * 0.3) * k), p = L.pointAtU(u, 0, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.spike, M_spike(p.pos, new V3(-0.4, 1, 0), (0.12 + stage * 0.04) * k, 0.035 * k), mulHex(o.pal.back, 0.95)); }
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) { const u = L.uAtX((-1.0 + i * 0.25) * k), p = L.pointAtU(u, sd * 0.5, 0.01 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'skin', UNIT.scute, M_ell(p.pos, [0.15 * k, 0.06 * k, 0.12 * k], new THREE.Quaternion().setFromUnitVectors(Y_UP, p.dir)), mulHex(o.pal.back, 0.9), true); }
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
    kit.add(head, headO, o.glowEyes ? 'glow' : 'eye', eyeG(), M_ell(iris, [es * 0.6, es * 0.6, es * 0.6]), o.irisC || mulHex(0xd9b23a, 0.72));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(e.dir, es * 0.45), [es * 0.2, es * 0.44, es * 0.2]), 0x050403);
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


// ======================================================================== ТРАВОЯДНЫЙ: ТРИЦЕРАТОПС (сетка из STL, подготовлена tools/bake_trike.py → trike_uv.py → trike_rig.py → trike_js.py)
// В trike.js — правая половина сетки (левая — зеркало), UV, регионы (кожа/воротник/край/клюв/рог/когти), скелет и веса (тепловая диффузия),
// карта нормалей (чешуя и складки, запечены с исходной детальной сетки) и карта рельефа (тёмные щели между чешуями).
// Цвет кожи — вершинные цвета по палитре и узору (работают все скины, морфы и цвета узоров), рог/клюв/когти/воротник — свои цвета.
// Анимация — своя (animTrike): шаг по фазам с опорой на землю (IK ног, без скольжения), повороты, дыхание, выпас, рёв, бодание.
let TRIKE_D = null;
function b64buf(str) { const bin = atob(str), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer; }
function trikeData() {
  if (TRIKE_D) return TRIKE_D;
  const T = TRIKE, v = new Int16Array(b64buf(T.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / T.s;
  const uv16 = new Uint16Array(b64buf(T.uv)), UV = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UV[i] = uv16[i] / 65535;
  TRIKE_D = { n, P, UV, F: new Uint16Array(b64buf(T.f)), O: new Uint16Array(b64buf(T.o)), R: new Uint8Array(b64buf(T.r)), SI: new Uint8Array(b64buf(T.si)), SW: new Uint8Array(b64buf(T.sw)), bones: T.bones, lm: T.lm };
  return TRIKE_D;
}
let TRIKE_TEX = null;
function trikeTex() {
  if (TRIKE_TEX || typeof document === 'undefined') return TRIKE_TEX;
  const L = new THREE.TextureLoader(), mk = (src) => { const t = L.load(src); t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace; return t; };
  TRIKE_TEX = { nrm: mk(TRIKE.nrm), det: mk(TRIKE.det) };
  return TRIKE_TEX;
}
const trikeMats = new Map();
function trikeMat(emis) {
  const key = emis || 0; let m = trikeMats.get(key); if (m) return m;
  const T = trikeTex();
  // det — серый множитель (0.82 — нейтраль), поэтому общий цвет поднят на 1/0.82
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.22, 1.22, 1.22), vertexColors: true, roughness: 0.8, metalness: 0, map: T && T.det, normalMap: T && T.nrm, normalScale: new THREE.Vector2(1.1, 1.1) });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  trikeMats.set(key, m); return m;
}
// рог: изогнутый конус с продольными бороздками и переходом цвета (тёмное основание → кость → тёмный кончик)
function trikeHornGeo(len, r0, bend) {
  // объёмный рог: овальное сечение, продольные бороздки, кольца роста у основания, тёмное основание и кончик, затенение в бороздках
  const RG = 30, SG = 26, pos = [], col = [], idx = [], c = new THREE.Color(), cb = hx(0x6e5c44), cm = hx(0xdccfae), cl = hx(0xefe6cc), ct = hx(0x2a221a);
  for (let i = 0; i <= RG; i++) {
    const t = i / RG, x = len * t, y = bend * len * t * t, r = r0 * Math.pow(1 - t, 0.62) * (1 + 0.18 * (1 - sstep(0, 0.12, t))) * Math.min(1, 0.4 + t * 14) + 0.01 * r0;
    if (t < 0.3) c.copy(cb).lerp(cm, sstep(0, 0.3, t)); else if (t < 0.7) c.copy(cm).lerp(cl, sstep(0.3, 0.7, t)); else c.copy(cl).lerp(ct, sstep(0.78, 1, t));
    const ang = Math.atan(2 * bend * t), ring = 1 + 0.035 * Math.max(0, Math.sin(t * 70)) * (1 - sstep(0.05, 0.45, t));
    for (let j = 0; j <= SG; j++) {
      const a = j / SG * PI * 2, gv = Math.sin(a * 9 + t * 3), gr = (1 + 0.085 * gv * (1 - 0.55 * t)) * ring;
      const ny = Math.cos(a) * r * gr * 1.0, nz = Math.sin(a) * r * gr * 1.0;
      pos.push(x - ny * Math.sin(ang), y + ny * Math.cos(ang), nz);
      const ao = (0.72 + 0.28 * (0.5 + 0.5 * gv)) * (0.6 + 0.4 * sstep(0, 0.14, t)) * (ring > 1.01 ? 1.08 : 0.96) * (0.85 + 0.15 * (0.5 + 0.5 * Math.cos(a)));
      col.push(c.r * ao, c.g * ao, c.b * ao);
    }
  }
  for (let i = 0; i < RG; i++) for (let j = 0; j < SG; j++) { const a = i * (SG + 1) + j, b = a + SG + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// базис «ось x по dir, ось y — вверх, насколько можно»
function basisX(dir) { const x = dir.clone().normalize(), z = new V3().crossVectors(x, new V3(0, 1, 0)).normalize(), y = new V3().crossVectors(z, x); return new THREE.Matrix4().makeBasis(x, y, z); }
function triceratops(o) {
  const r = o.r || {}, stage = o.stage || 0, Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = trikeData(), nh = D.n, n = nh * 2, s = 0.0245, bz = 1 + (r.mass || 0) * 0.04, lm = D.lm;
  // ---- геометрия: правая половина + зеркальная левая
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), mp = new Float32Array(n * 3), reg = new Uint8Array(n);
  for (let i = 0; i < nh; i++) for (let m = 0; m < 2; m++) {
    const j = i + m * nh, sz = m ? -1 : 1;
    mp[j * 3] = D.P[i * 3]; mp[j * 3 + 1] = D.P[i * 3 + 1]; mp[j * 3 + 2] = D.P[i * 3 + 2] * sz;
    pos[j * 3] = mp[j * 3] * s; pos[j * 3 + 1] = mp[j * 3 + 1] * s; pos[j * 3 + 2] = mp[j * 3 + 2] * s * bz;
    uv[j * 2] = D.UV[i * 2]; uv[j * 2 + 1] = D.UV[i * 2 + 1]; reg[j] = D.R[i];
  }
  const nf = D.F.length / 3, idx = new Uint32Array(nf * 6);
  for (let f = 0; f < nf; f++) { const a = D.F[f * 3], b = D.F[f * 3 + 1], c = D.F[f * 3 + 2]; idx[f * 3] = a; idx[f * 3 + 1] = b; idx[f * 3 + 2] = c; idx[(nf + f) * 3] = a + nh; idx[(nf + f) * 3 + 1] = c + nh; idx[(nf + f) * 3 + 2] = b + nh; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // гладкие нормали: вершины, разрезанные швами UV и плоскостью симметрии, сшиваем по исходному номеру
  { let no = 0; for (let i = 0; i < nh; i++) no = Math.max(no, D.O[i] + 1);
    const key = new Int32Array(n); for (let i = 0; i < nh; i++) { key[i] = D.O[i]; key[i + nh] = Math.abs(D.P[i * 3 + 2]) < 1e-3 ? D.O[i] : D.O[i] + no; }
    const acc = new Float32Array(no * 2 * 3), nrm = new Float32Array(n * 3), e1 = new V3(), e2 = new V3(), fn = new V3(), pa = new V3(), pb = new V3(), pc = new V3();
    for (let f = 0; f < nf * 2; f++) {
      const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
      pa.fromArray(pos, a * 3); pb.fromArray(pos, b * 3); pc.fromArray(pos, c * 3); fn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
      for (const v of [a, b, c]) { const k = key[v] * 3; acc[k] += fn.x; acc[k + 1] += fn.y; acc[k + 2] += fn.z; }
    }
    for (let i = 0; i < n; i++) { const k = key[i] * 3; fn.set(acc[k], acc[k + 1], acc[k + 2]).normalize(); nrm[i * 3] = fn.x; nrm[i * 3 + 1] = fn.y; nrm[i * 3 + 2] = fn.z; }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); }
  // ---- раскраска: палитра/узор/морф из магазина + природные цвета роговых частей
  const nor = geo.attributes.normal.array, up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = nor[i * 3 + 1] * 0.8 + sstep(10, 60, mp[i * 3 + 1]) * 0.45 - 0.2; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, o.pal, o.pat);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), pal = o.pal;
    const boneC = hx(mixHex(0xd8c8a0, pal.side, 0.12)), beakC = hx(0x2c241d), beakC2 = hx(0x5a4a3a), clawC = hx(0x2a231d), hornB = hx(0x8a7658), hornT = hx(0xe2d6b6);
    const frC = hx(mixHex(pal.side, pal.belly, 0.25)), eye = lm.eye;
    for (let i = 0; i < n; i++) {
      const x = mp[i * 3], y = mp[i * 3 + 1], z = mp[i * 3 + 2], R = reg[i];
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (R === 1) c.lerp(frC, 0.25).multiplyScalar(1.06);                              // воротник: светлее, узор остаётся
      else if (R === 2) c.lerp(boneC, 0.8);                                             // край воротника — кость
      else if (R === 3) c.copy(beakC).lerp(beakC2, sstep(12, 22, y) * 0.6);             // клюв — тёмный рог
      else if (R === 4) { const ht = sstep(34, 48, y); c.copy(hornB).lerp(hornT, sstep(0, 0.55, ht)).lerp(hx(0x2e261e), sstep(0.8, 1, ht)); c.multiplyScalar(0.85 + 0.15 * Math.sin(Math.atan2(z, x - 66) * 9)); }   // носовой рог
      else if (R === 5) c.copy(clawC);                                                  // когти
      // глазница — тёмная впадина вокруг глаза
      const dx = x - eye[0], dy = y - eye[1], dz = Math.abs(z) - eye[2], dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dd < 5) c.lerp(hx(0x1a130e), 0.6 * (1 - sstep(2.6, 5, dd)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  // ---- скелет: позвоночник общий, ноги — правые и зеркальные левые
  const bones = [], rest = [], byName = {}, bi = {};
  const BL = D.bones.slice();
  for (const b of D.bones) if (/R$/.test(b[0])) BL.push([b[0].slice(0, -1) + 'L', b[1], [b[2][0], b[2][1], -b[2][2]]]);
  BL.forEach((b, i) => { const bn = new THREE.Bone(); bn.name = b[0]; bones.push(bn); rest.push(new V3(b[2][0] * s, b[2][1] * s, b[2][2] * s * bz)); byName[b[0]] = bn; bi[b[0]] = i; });
  BL.forEach((b, i) => {
    let pn = b[1] >= 0 ? D.bones[b[1]][0] : null; if (pn && /L$/.test(b[0]) && /R$/.test(pn)) pn = pn.slice(0, -1) + 'L';
    if (pn) { bones[i].position.copy(rest[i]).sub(rest[bi[pn]]); byName[pn].add(bones[i]); } else bones[i].position.copy(rest[i]);
  });
  const mirB = BL.map((b, i) => (/R$/.test(b[0]) ? bi[b[0].slice(0, -1) + 'L'] : i));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < nh; i++) {
    let tot = 0; for (let k = 0; k < 4; k++) tot += D.SW[i * 4 + k];
    for (let k = 0; k < 4; k++) { const b = D.SI[i * 4 + k], w = tot ? D.SW[i * 4 + k] / tot : (k ? 0 : 1); si[i * 4 + k] = b; sw[i * 4 + k] = w; si[(i + nh) * 4 + k] = mirB[b]; sw[(i + nh) * 4 + k] = w; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, trikeMat(o.emis));
  mesh.add(byName.root); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true;
  const rig = baseRig('quad'); rig.frame.add(mesh);
  rig.spine = { root: byName.root, tail: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'].map(k => byName[k]), neck: [byName.neck0, byName.neck1], head: byName.head };
  const legDef = [['thigh', 'shin', 'ankle', 'foot', 0], ['upper', 'fore', 'wrist', 'hand', 1]];
  for (const [a0, a1, a2, a3, fr] of legDef) for (const sd of ['R', 'L']) {
    const ch = [a0, a1, a2, a3].map(k => byName[k + sd]), rs = [a0, a1, a2, a3].map(k => rest[bi[k + sd]]);
    const g = new THREE.Group(); g.position.copy(rs[0]); rig.frame.add(g);
    rig.legs.push({ g, bones: ch, rest: rs, L: null, end: new V3(rs[3].x, 0, rs[3].z), ph: 0, side: sd === 'R' ? 1 : -1, front: !!fr,
      tip: new V3(((fr ? 27 : -37) - (fr ? 18 : -46)) * s, -2.5 * s, 0) });
  }
  // ---- детали на голове: глаза с веками, надглазничные рога, шипики по краю воротника
  const kit = new Kit(), head = byName.head, headO = rest[bi.head];
  const glow = (r.sense || 0) >= 2 || o.glowEyes;
  const eyeC = lm.eye, ER = 2.6 * s * (o.eyeK || 1), irisC = mulHex(o.irisC || (glow ? 0xffd23a : 0xc8862a), 0.74);
  const eyes = [], lids = [];
  // веко — цвета кожи вокруг глаза (берём средний цвет вершин рядом), чуть темнее
  const lidC = new THREE.Color(0, 0, 0); { const col = L.geo.attributes.color.array; let cnt = 0;
    for (let i = 0; i < nh; i++) { const dx = mp[i * 3] - eyeC[0], dy = mp[i * 3 + 1] - eyeC[1], dz = mp[i * 3 + 2] - eyeC[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 > 30 && d2 < 80) { lidC.r += col[i * 3]; lidC.g += col[i * 3 + 1]; lidC.b += col[i * 3 + 2]; cnt++; } }
    if (cnt) lidC.multiplyScalar(0.95 / cnt); else lidC.set(o.pal.side); }
  const lidTex = (t) => { if (!t) return t; const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(5, 3); c.needsUpdate = true; return c; };
  const lidMat = new THREE.MeshStandardMaterial({ color: lidC.clone().multiplyScalar(1.22), roughness: 0.8, map: lidTex(trikeTex() && trikeTex().det), normalMap: lidTex(trikeTex() && trikeTex().nrm), normalScale: new THREE.Vector2(1.1, 1.1) });   // текстура и рельеф кожи динозавра
  for (const sd of [1, -1]) {
    const pe = new V3((eyeC[0] + lm.eyeDir[0] * 0.4) * s, (eyeC[1] + lm.eyeDir[1] * 0.4) * s, sd * (eyeC[2] + lm.eyeDir[2] * 0.4) * s * bz), dir = (lm.eyeDir ? new V3(lm.eyeDir[0], lm.eyeDir[1], sd * lm.eyeDir[2]) : new V3(0.12, 0.05, sd)).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone(), Fd = ER * 0.45;                                       // глаз приплюснутый: сидит в ямке заподлицо, не выпирает
    const qE = (k) => [ER * k, ER * k, Fd * 0.8];
    kit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, Fd * 0.9], qd), 0x140d08);                                                                   // глазное яблоко
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.14), qE(0.93), qd), mulHex(irisC, 0.62));     // тёмный край радужки
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.2), qE(0.8), qd), irisC);                      // радужка
    kit.add(head, headO, glow ? 'glow' : 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.24), [ER * 0.42, ER * 0.42, Fd * 0.78], qd), mixHex(irisC, 0xfff0b0, 0.35));   // светлое кольцо
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.29), [ER * 0.3, ER * 0.5, Fd * 0.76], qd), 0x030202);   // зрачок
    kit.add(head, headO, 'glow', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.8).addScaledVector(ey, ER * 0.3).addScaledVector(ex, ER * 0.2), [ER * 0.1, ER * 0.1, Fd * 0.1]), 0xfffaf0);   // блик
    // веки: верхнее и нижнее — оболочки цвета кожи; закрываются, «вырастая» от края глаза к середине
    const eg = new THREE.Group(); eg.position.copy(c0).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.02, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.12, LR, Fd * (sgn > 0 ? 0.6 : 0.58)); m.position.set(0, -sgn * LR, 0); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    const tp = mkLid(1), bp = mkLid(-1);
    void ({ tp, bp }); eyes.push(pe);
  }
  const ivory = 0xe8dcc0;
  // надглазничные рога: длинные, вперёд и вверх, кончики загибаются вперёд; растут с возрастом
  { const hl = (28 + stage * 3.2) * s * (1 + (o.hornK || 0)), hr = 4.1 * s, hg = trikeHornGeo(hl, hr, -0.2), HB = [48.5, 43.6, 8.6], HD = [0.5, 0.82, 0.24];
    for (const sd of [1, -1]) {
      const b = new V3(HB[0] * s, HB[1] * s, sd * HB[2] * s * bz), dv = new V3(HD[0], HD[1], sd * HD[2]).normalize(), m = basisX(dv).setPosition(b.clone().addScaledVector(dv, -hr * 2.2));
      kit.add(head, headO, 'horn', hg, m, null);
    } }
  // край воротника: костяные шипики (эпокципиталии) по всему краю
  { let cx = 0, cy = 0, cn = 0; const rim = [];
    for (let i = 0; i < nh; i++) { if (reg[i] === 1 || reg[i] === 2) { cx += mp[i * 3]; cy += mp[i * 3 + 1]; cn++; } if (reg[i] === 2) rim.push(i); }
    cx /= cn; cy /= cn;
    const NB = 9, best = new Array(NB).fill(-1), br = new Array(NB).fill(0);
    for (const i of rim) {
      const dy = mp[i * 3 + 1] - cy, dz = mp[i * 3 + 2], th = Math.atan2(dz, dy); if (th < -0.05 || th > 1.95) continue;
      const k = Math.min(NB - 1, Math.floor((th + 0.05) / 2.0 * NB)), rr = Math.hypot(dy, dz);
      if (rr > br[k]) { br[k] = rr; best[k] = i; }
    }
    const sg = new THREE.ConeGeometry(1, 1, 7, 1, false);
    best.forEach((i, k) => {
      if (i < 0) return;
      const p = new V3(mp[i * 3], mp[i * 3 + 1], mp[i * 3 + 2]), out = new V3(0.12, p.y - cy, p.z).normalize();
      for (const sd of (Math.abs(p.z) < 1.5 ? [1] : [1, -1])) {
        const pp = new V3(p.x * s, p.y * s, sd * p.z * s * bz), dd = new V3(out.x, out.y, sd * out.z), big = k % 2 ? 1.25 : 1;
        kit.add(head, headO, 'acc', sg, M_spike(pp.addScaledVector(dd, -0.8 * s), dd, 5.2 * s * big, 2.0 * s * big), mixHex(0xd8c8a0, o.pal.side, 0.15), true);
      }
    }); }
  // ---- вид от эволюции: шипы по спине, костные бляшки, свечение стада
  const topAt = (x) => { let y = 0; for (let i = 0; i < nh; i++) if (Math.abs(mp[i * 3] - x) < 2 && mp[i * 3 + 2] < 4 && mp[i * 3 + 1] > y) y = mp[i * 3 + 1]; return y; };
  const spineB = ['tail2', 'tail1', 'tail0', 'root', 'chest'], boneAtX = (x) => { let b = 'root', bd = 1e9; for (const k of spineB) { const d = Math.abs(rest[bi[k]].x / s - x); if (d < bd) { bd = d; b = k; } } return b; };
  const spk = r.spikes || 0;
  for (let i = 0; i < spk * 2; i++) for (const sd of [1, -1]) {
    const x = -50 + i * 10, k = boneAtX(x), p = new V3(x * s, (topAt(x) - 4) * s, sd * 9 * s * bz);
    kit.add(byName[k], rest[bi[k]], 'acc', UNIT.cone, M_spike(p, new V3(-0.25, 0.8, sd * 0.5), (0.16 + spk * 0.04), 0.04), ivory);
  }
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) {
    const x = -46 + i * 9, k = boneAtX(x), p = new V3(x * s, (topAt(x) - 6) * s, sd * 12 * s * bz);
    kit.add(byName[k], rest[bi[k]], 'skin', UNIT.scute, M_ell(p, [0.15, 0.06, 0.11], new THREE.Quaternion().setFromUnitVectors(Y_UP, new V3(0, 1, sd * 0.7).normalize())), mulHex(o.pal.back, 0.9), true);
  }
  if ((r.herd || 0) > 0) for (let i = 0; i < r.herd; i++) { const x = -30 + i * 12, k = boneAtX(x); kit.add(byName[k], rest[bi[k]], 'glow', UNIT.sphLo, M_ell(new V3(x * s, (topAt(x) + 1) * s, 0), [0.07, 0.07, 0.07]), 0xffd35a); }
  if (o.extras) o.extras({ L, kit, head, headO, k: 1, s, rig });
  kit.build({ emis: o.emis });
  setHeadAnch(rig, head, new V3(lm.hat[0] * s, lm.hat[1] * s, 0).sub(headO), eyes[0].clone().sub(headO), new V3(lm.neck[0] * s, lm.neck[1] * s, 0));
  rig.walkAmp = 0.3; rig.gait = 'quad'; rig.k = 0.98;
  rig.tagH = 80 * s + 0.35;
  rig.trike = { s, lids, chest: byName.chest, hipH: 40 * s, legs: rig.legs, mesh };
  return rig;
}

// ---------- анимация трицератопса ----------
const _tv = [new V3(), new V3(), new V3(), new V3(), new V3(), new V3(), new V3()], _tq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
// поворачивает кость так, чтобы направление к её ребёнку (child.position) в мире смотрело на dirW
function aimBone(b, child, dirW) {
  const pq = _tq[0]; b.parent.getWorldQuaternion(pq); pq.invert();
  const dl = _tv[5].copy(dirW).applyQuaternion(pq).normalize(), rl = _tv[6].copy(child.position).normalize();
  b.quaternion.setFromUnitVectors(rl, dl); b.updateMatrixWorld(true);
}
function aimDir(b, restDirLocal, dirW) {
  const pq = _tq[0]; b.parent.getWorldQuaternion(pq); pq.invert();
  const dl = _tv[5].copy(dirW).applyQuaternion(pq).normalize();
  b.quaternion.setFromUnitVectors(restDirLocal, dl); b.updateMatrixWorld(true);
}
const wrapA = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
export function animTrike(dino, P, t, speed, dt, st) {
  const T = P.trike, sp = P.spine, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { ph: Math.random(), v: 0, w: 0, yaw: dino.rotation.y, acc: 0, idle: 0, graze: 0, gT: 6 + Math.random() * 5, blink: 2 + Math.random() * 3, roar: 0, run: 0, look: 0, drop: 0 });
  // скорость (мировая) → в единицах модели; угловая скорость поворота — по изменению направления
  const vW = Math.max(0, speed) * 6, vM = vW / sc;
  const yaw = dino.rotation.y, wRaw = ddt > 0 ? wrapA(yaw - S.yaw) / ddt : 0; S.yaw = yaw;
  { const wT = Math.max(-3, Math.min(3, wRaw)); S.w += (wT - S.w) * Math.min(1, ddt * (Math.abs(wT) < Math.abs(S.w) ? 18 : 6)); }
  const vPrev = S.v; S.v += (vM - S.v) * Math.min(1, ddt * (vM < S.v ? (vM < 0.05 ? 40 : 16) : 6)); S.acc += ((S.v - vPrev) / Math.max(ddt, 1e-3) - S.acc) * Math.min(1, ddt * 4);
  const swim = !!st.swim, climb = !!st.climb, fly = !!st.fly, guard = !!st.guard;
  const base = ((CONFIG.CLASSES.herb || {}).speed || 112) / 30;
  const runT = st.run !== undefined ? (st.run ? 1 : 0) : sstep(1.2, 1.5, vW / base);
  S.run += (runT * (S.v > 0.05 ? 1 : 0) - S.run) * Math.min(1, ddt * 4); const run = S.run;
  const hipH = T.hipH, Rb = 1.0;                                                        // половина длины тела (единицы модели)
  const turnV = Math.abs(S.w) * Rb, mvSp = Math.max(S.v, turnV);
  const moving = sstep(0.04, 0.25, mvSp / hipH);
  // шаг: длина цикла растёт со скоростью; частота — скорость / длина (ступни не скользят), не больше 3.2 шага/с
  // шаг: ступня за опору проходит назад ~0.5·высоты бедра (на бегу 0.75) — ноги не задираются; частота = β·скорость / длина опоры
  const beta = 0.62 - 0.22 * run;                                                        // доля опоры в цикле
  // маленький динозавр быстрее перебирает ногами; если и этого мало — длина опоры ограничена (ноги не выпрямляются в струну)
  const Sx = hipH * (0.95 + 0.2 * run), fmax = Math.min(1.6, 1.0 / Math.sqrt(Math.min(1, sc))) * (1 + 0.1 * run), Smax = hipH * (1.0 + 0.2 * run);
  // при остановке ноги не продолжают перебирать: шаг идёт только пока динозавр движется; ступни плавно встают на место
  const f = mvSp > 0.1 * hipH ? 0.86 * Math.max(0.3, Math.min(fmax, beta * mvSp / Sx)) : 0;      // трицератопс перебирает ногами чуть медленнее (−14 %)     // частота ∝ скорости (до предела)
  if (f > 0) S.ph = (S.ph + ddt * f) % 1;
  S.mv = (S.mv || 0) + ((f > 0 ? 1 : 0) - (S.mv || 0)) * Math.min(1, ddt * (f > 0 ? 8 : 16));
  // бодание / рёв
  const bc = biteCurve(dino.userData.bite || 0), pull = bc ? bc.pull : 0, lunge = bc ? bc.lunge : 0;
  if (dino.userData.roar > 0) { S.roar = 1; dino.userData.roar = 0; }
  if (S.roar > 0) S.roar = Math.max(0, S.roar - ddt / 2.2);
  const ro = S.roar > 0 ? sstep(0, 0.15, 1 - S.roar) * sstep(0, 0.25, S.roar) : 0, roShake = ro * Math.sin(t * 30) * 0.06;
  // выпас в покое: время от времени опускает голову к земле и щиплет траву
  if (mvSp < 0.05 * hipH && !swim && !climb && !bc && !ro) { S.idle += ddt; if (S.idle > S.gT) { S.graze = Math.min(1, S.graze + ddt * 0.8); if (S.idle > S.gT + 5) { S.idle = 0; S.gT = 7 + Math.random() * 8; } } else S.graze = Math.max(0, S.graze - ddt * 1.2); }
  else { S.idle = 0; S.graze = Math.max(0, S.graze - ddt * 2); }
  const gz = sstep(0, 1, S.graze), chew = gz * Math.max(0, Math.sin(t * 7)) * 0.05;
  // ---- корпус: инерция (наклон при разгоне/торможении), крен в поворотах, дыхание
  P.body.rotation.x = Math.max(-0.08, Math.min(0.08, -S.acc / Math.max(hipH, 0.1) * 0.012)) + (climb ? -1.35 : 0) + Math.sin(S.ph * PI * 2 + 0.6) * 0.07 * run * (S.mv || 0);   // в скачке корпус качается вперёд-назад
  P.body.rotation.z = Math.max(-0.1, Math.min(0.1, -S.w * S.v / hipH * 0.02));
  P.body.rotation.y = 0;
  P.frame.position.set(0, 0, (lunge * 0.07 - pull * 0.03) * hipH * 1.4); P.frame.rotation.set(0, -PI / 2, 0);
  const br = Math.sin(t * (1.6 + 1.4 * moving)) * (0.012 + 0.008 * run); T.chest.scale.set(1, 1 + br, 1 + br * 1.4);
  // ---- хвост: волна, отстающая от шага; в повороте тянется по дуге; не волочится
  const tw = S.ph * PI * 2;
  sp.tail.forEach((b, i) => {
    b.rotation.y = Math.sin(t * 0.8 - i * 0.6) * 0.05 * (1 - moving) + Math.sin(tw * 2 - i * 0.7) * 0.035 * moving * (1 + i * 0.2) - S.w * 0.05 * (i + 1) * 0.5;
    b.rotation.z = Math.sin(t * 0.6 - i * 0.5) * 0.015 + run * 0.04 + (i === 0 ? 0.02 : 0) - ro * 0.04 + Math.cos(tw * 2 - i * 0.6) * 0.015 * moving;
  });
  sp.root.rotation.set(0, Math.sin(tw * 2) * 0.02 * moving, 0);
  // ---- шея и голова: осматривается в покое, смотрит в поворот, опускает голову к траве, бодается, ревёт
  S.look += ddt; const lk = (1 - moving) * (1 - gz);
  const lookY = (Math.sin(S.look * 0.19) * 0.18 + Math.sin(S.look * 0.43 + 1) * 0.05) * lk + S.w * 0.09, lookZ = (Math.sin(S.look * 0.27 + 2) * 0.04) * lk;
  const nod = Math.sin(tw * 2 + 0.6) * 0.007 * moving;
  for (const b of sp.neck) { b.rotation.y = lookY * 0.35; b.rotation.z = lookZ * 0.4 - gz * 0.26 - pull * 0.04 - lunge * 0.03 + ro * 0.11 + nod - run * 0.04 + (swim ? 0.12 : 0); b.rotation.x = 0; }
  sp.head.rotation.y = lookY * 0.3 + roShake; sp.head.rotation.x = roShake * 0.6;
  sp.head.rotation.z = lookZ * 0.5 - gz * 0.32 + chew - pull * 0.1 + lunge * 0.1 + ro * 0.16 + nod * 0.5 + (swim ? 0.15 : 0);
  // ---- моргание
  // моргание: верхнее веко опускается быстро (0.08 с), короткая пауза, открывается медленнее (0.2 с); нижнее лишь слегка поднимается; иногда двойное
  // в покое верхнее веко чуть прикрывает глаз (тяжёлый взгляд), при ходьбе/беге — шире открыт
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u);
    if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  const droop = 0.07 * (1 - 0.6 * moving) + 0.1 * gz + 0.16 * ro;
  for (const l of T.lids) { const ty = 0.02 + droop + bl * (1.0 - droop); l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.72; l.tp.visible = bl > 0.04; l.bp.visible = bl > 0.15; }
  // ---- ноги: IK от бедра к цели ступни; цели в системе корня (земля — y = 0)
  // фазы: шаг (боковая последовательность ЗП→ПП→ЗЛ→ПЛ), бег — рысь (диагональные пары)
  // бег — скачки «с двух на две»: задние лапы толкаются парой, затем передние парой (небольшой сдвиг левой и правой)
  const offW = { RH: 0, RF: 0.25, LH: 0.5, LF: 0.75 }, offR = { RH: 0, LH: 0.06, RF: 0.5, LF: 0.56 };
  // корпус опускается, если ногам не хватает длины (маятник: выше всего над опорной ногой), и чуть приседает в защите
  P.body.position.y = 0;
  dino.updateMatrixWorld(true);
  const root = dino, wq = _tq[1], hipW = _tv[0], tg = _tv[1], ankT = _tv[2], kn = _tv[3], tmp = _tv[4];
  const fwd = new V3(), right = new V3();
  // направления «вперёд» и «вправо» модели в системе корня: x модели → +z корня, z модели → −x корня
  const drop = []; let need = 0;
  const legT = [];
  for (const lg of P.legs) {
    const key = (lg.side > 0 ? 'R' : 'L') + (lg.front ? 'F' : 'H');
    const phi = ((S.ph + offW[key] * (1 - run) + offR[key] * run) % 1 + 1) % 1;
    // перемещение земли относительно тела за опору: −(V + ω×r)·(β/f)
    const rx = lg.rest[3].x, rz = lg.rest[3].z, fr = Math.max(f, 0.3);
    let gx = -(S.v + S.w * rz) * beta / fr * moving, gz_ = S.w * rx * beta / fr * moving;
    const gl = Math.hypot(gx, gz_); if (gl > Smax) { gx *= Smax / gl; gz_ *= Smax / gl; }
    let ox, oz, oy = 0, toe = 0;
    if (swim) { const a = t * 3 + (lg.front ? 0 : PI) + (lg.side > 0 ? 0 : PI / 2); ox = Math.sin(a) * hipH * 0.25; oy = hipH * (0.35 + 0.15 * Math.cos(a)); oz = 0; toe = -0.4; }
    else if (phi < beta) { const u = phi / beta; ox = gx * (u - 0.5); oz = gz_ * (u - 0.5); }
    else { const u = (phi - beta) / (1 - beta), e = u * u * (3 - 2 * u); ox = gx * (0.5 - e); oz = gz_ * (0.5 - e); oy = Math.sin(PI * u) * hipH * (0.13 + 0.1 * run) * moving; toe = Math.sin(PI * u) * (0.3 + 0.2 * run) * moving - (u < 0.2 ? 0.3 * moving * (1 - u / 0.2) : 0); }
    const mk = S.mv; ox *= mk; oz *= mk; oy *= mk; toe *= mk;
    if (!swim) oz += lg.side * (lg.front ? 3.4 : 1.2) * T.s;                      // стойка пошире: передние ступни не сходятся внутрь
    legT.push({ lg, ox, oy, oz, toe, stance: !swim && phi < beta, sp: 0 });
  }
  // сколько опустить корпус, чтобы опорные ноги дотягивались
  if (!swim && !climb) for (const L of legT) {
    const lg = L.lg, b = lg.bones, Lmax = (b[1].position.length() + b[2].position.length()) * 0.985 + b[3].position.length() * 0;
    const dx = lg.rest[2].x + L.ox - lg.rest[0].x, dz = (lg.rest[3].z + L.oz + L.sp) - lg.rest[0].z, hy = lg.rest[0].y - (lg.rest[2].y - lg.rest[3].y) - lg.rest[3].y - L.oy;
    const reach = Math.sqrt(Math.max(0, Lmax * Lmax - dx * dx - dz * dz));
    if (L.stance || L.oy < 0.02) need = Math.max(need, hy - reach);
  }
  S.drop += (Math.min(Math.max(0, need), hipH * 0.07) + hipH * 0.02 * S.mv + (guard ? hipH * 0.22 : 0) - S.drop) * Math.min(1, ddt * 14);   // стоя — ноги прямые
  P.body.position.y = swim ? -hipH * 0.15 : -S.drop;
  dino.updateMatrixWorld(true);
  if (climb || fly) { for (const lg of P.legs) for (const b of lg.bones) b.quaternion.identity(); return; }
  for (const L of legT) {
    const lg = L.lg, b = lg.bones;
    b[0].quaternion.identity(); b[0].updateMatrixWorld(true);
    b[0].getWorldPosition(hipW);
    // цель сустава стопы (foot) в системе корня → в мир
    const fx = lg.rest[3].x + L.ox, fz = lg.rest[3].z + L.oz + L.sp, fy = lg.rest[3].y + L.oy;
    tg.set(-fz, fy, fx); root.localToWorld(tg);
    // лодыжка (ankle) — над стопой на «пястной» кости, наклон как в покое
    tmp.set(-(lg.rest[2].z - lg.rest[3].z), lg.rest[2].y - lg.rest[3].y, lg.rest[2].x - lg.rest[3].x).multiplyScalar(sc);
    root.getWorldQuaternion(wq); tmp.applyQuaternion(wq);
    ankT.copy(tg).add(tmp);
    // двухзвенная IK: бедро → колено → лодыжка; колено задних ног вперёд, локоть передних — назад
    const L1 = b[1].position.length() * sc, L2 = b[2].position.length() * sc;
    const dv = tmp.subVectors(ankT, hipW); let d = dv.length(); const dmax = (L1 + L2) * 0.999, dmin = Math.abs(L1 - L2) + 1e-4;
    if (d > dmax) { ankT.copy(hipW).addScaledVector(dv, dmax / d); d = dmax; } else if (d < dmin) d = dmin;
    const dir = dv.normalize();
    const pole = _tv[5].set(0, 0, lg.front ? -1 : 1).applyQuaternion(wq);
    const nrm = kn.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const ca = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))), al = Math.acos(ca);
    const knee = kn.multiplyScalar(Math.sin(al) * L1).addScaledVector(dir, Math.cos(al) * L1).add(hipW);
    aimBone(b[0], b[1], tmp.subVectors(knee, hipW));
    aimBone(b[1], b[2], tmp.subVectors(ankT, knee));
    const fW = _tv[4].copy(tg); aimBone(b[2], b[3], fW.sub(ankT));
    // стопа плоско на земле; в переносе — отрыв пальцев и подъём носка
    const td = _tv[4].set(-(lg.tip.z), lg.tip.y, lg.tip.x).applyAxisAngle(_tv[6].set(-1, 0, 0), 0).normalize();
    const pitch = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -L.toe);
    td.applyQuaternion(pitch).applyQuaternion(wq);
    if (!b[3].userData.tipL) b[3].userData.tipL = new V3(lg.tip.x, lg.tip.y, lg.tip.z).normalize();
    aimDir(b[3], b[3].userData.tipL, td);
  }
}

// ======================================================================== ХИЩНИК: ТИРАННОЗАВР (сетка из STL, подготовлена tools/rex_bake.py → game/rex.js)
// Сетка ~40 тыс. граней с отдельными зубами; нижняя челюсть — своя кость (рот закрывается и раскрывается); глаза с веками собираются здесь.
// Цвет кожи — вершинные цвета по палитре и узору (работают все скины, морфы и цвета узоров), зубы/когти/пасть — свои цвета; чешуя — рельеф в шейдере.
// Анимация — animRex: шаг двух ног с опорой на землю (IK, без скольжения), качание таза, хвост-противовес, дыхание, укус с броском, рёв.
let REX_D = null;
function rexData() {
  if (REX_D) return REX_D;
  const R = REX, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  REX_D = { n, P, F: new Uint16Array(b64buf(R.f)), R: new Uint8Array(b64buf(R.r)), G: new Uint8Array(b64buf(R.g)), AO: new Uint8Array(b64buf(R.ao)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), bones: R.bones, tips: R.tips, lm: R.lm };
  return REX_D;
}
const rexMats = new Map();
const REX_NOISE = `
float rxHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rxNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rxHash(i), rxHash(i + vec3(1,0,0)), f.x), mix(rxHash(i + vec3(0,1,0)), rxHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rxHash(i + vec3(0,0,1)), rxHash(i + vec3(1,0,1)), f.x), mix(rxHash(i + vec3(0,1,1)), rxHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float rxHeight(vec3 p) {
  float w = length(fwidth(p));
  float a = rxNoise(p * 38.0), b = rxNoise(p * 90.0 + 7.1), c = rxNoise(p * 9.0 + 3.3);
  float fine = 1.0 - clamp(w * 38.0 * 1.2, 0.0, 1.0), fine2 = 1.0 - clamp(w * 90.0 * 1.2, 0.0, 1.0);
  return (1.0 - abs(a * 2.0 - 1.0)) * 0.6 * fine + b * 0.2 * fine2 + c * 0.12;
}`;
function rexMat(emis) {
  const key = emis || 0; let m = rexMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRexP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRexP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRexP;' + REX_NOISE)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float h = rxHeight(vRexP); vec2 dh = vec2(dFdx(h), dFdy(h)) * 0.0016;
        vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition); vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
        float det = dot(sX, R1) * faceDirection; vec3 grad = sign(det) * (dh.x * R1 + dh.y * R2);
        normal = normalize(abs(det) * normal - grad); }`);
  };
  m.customProgramCacheKey = () => 'rexskin';
  rexMats.set(key, m); return m;
}
const REX_S = 0.32, JAW_CLOSED = 0.27, JAW_OPEN = -0.3;
function tyrannosaur(o) {
  const r = o.r || {}, stage = o.stage || 0, Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = rexData(), n = D.n, s = REX_S, lm = D.lm, mp = D.P;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = mp[i] * s;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  geo.computeVertexNormals();
  // ---- раскраска: палитра/узор/морф из магазина + зубы, когти, пасть, тёмные впадины
  const nor = geo.attributes.normal.array, up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = nor[i * 3 + 1] * 0.8 + sstep(1.5, 5.6, mp[i * 3 + 1]) * 0.45 - 0.2; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, o.pal, o.pat);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), pal = o.pal, eye = lm.eye;
    const toothB = hx(0xb8a678), toothT = hx(0xf1e9d2), mouthC = hx(mixHex(0x8e3640, pal.belly, 0.12)), mouthD = hx(0x4a181e), clawC = hx(0x2a231b), clawT = hx(0x14100c), eyeD = hx(0x120c08);
    for (let i = 0; i < n; i++) {
      const R = D.R[i], ao = D.AO[i] / 255, x = mp[i * 3], y = mp[i * 3 + 1], z = mp[i * 3 + 2];
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (R === 1) { const g = D.G[i] / 255; c.copy(toothB).lerp(toothT, sstep(0.15, 0.9, g)); c.multiplyScalar(0.94 + 0.1 * vnoise(x * 60, y * 60, z * 60)); }
      else if (R === 3) { c.copy(mouthC).lerp(mouthD, 0.25 + 0.4 * sstep(0.9, 0.5, ao)); c.multiplyScalar(0.9 + 0.2 * vnoise(x * 25, y * 25, z * 25)); }
      else if (R === 2) { c.copy(clawC).lerp(clawT, sstep(0.3, 0.95, vnoise(x * 12, y * 12, z * 12)) * 0.5); }
      else { c.multiplyScalar(0.62 + 0.38 * ao); }
      // глазница — тёмная впадина вокруг глаза
      const dx = x - eye[0], dy = y - eye[1], dz = Math.abs(z) - eye[2], dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dd < 0.22) c.lerp(eyeD, 0.22 * (1 - sstep(0.08, 0.22, dd)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  // ---- скелет
  const bones = [], rest = [], byName = {}, bi = {};
  D.bones.forEach((b, i) => { const bn = new THREE.Bone(); bn.name = b[0]; bones.push(bn); rest.push(new V3(b[2][0] * s, b[2][1] * s, b[2][2] * s)); byName[b[0]] = bn; bi[b[0]] = i; });
  D.bones.forEach((b, i) => { if (b[1] >= 0) { bones[i].position.copy(rest[i]).sub(rest[b[1]]); bones[b[1]].add(bones[i]); } else bones[i].position.copy(rest[i]); });
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { let tot = 0; for (let k = 0; k < 4; k++) tot += D.SW[i * 4 + k]; for (let k = 0; k < 4; k++) { si[i * 4 + k] = D.SI[i * 4 + k]; sw[i * 4 + k] = tot ? D.SW[i * 4 + k] / tot : (k ? 0 : 1); } }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, rexMat(o.emis));
  mesh.add(byName.root); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true;
  const rig = baseRig('biped'); rig.frame.add(mesh);
  rig.spine = { root: byName.root, tail: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'].map(k => byName[k]), neck: [byName.neck0, byName.neck1], head: byName.head };
  rig.jaw = byName.jaw; rig.jawBase = 0;
  for (const sd of ['R', 'L']) {
    const ch = ['thigh', 'shin', 'ankle', 'foot'].map(k => byName[k + sd]), rs = ['thigh', 'shin', 'ankle', 'foot'].map(k => rest[bi[k + sd]]);
    const g = new THREE.Group(); g.position.copy(rs[0]); rig.frame.add(g);
    const tp = D.tips['foot' + sd];
    rig.legs.push({ g, bones: ch, rest: rs, L: null, end: new V3(rs[3].x, 0, rs[3].z), ph: 0, side: sd === 'R' ? 1 : -1, front: false, tip: new V3(tp[0] * s - rs[3].x, tp[1] * s - rs[3].y, (tp[2] * s - rs[3].z) * 0) });
  }
  const arms = ['R', 'L'].map(sd => ({ side: sd === 'R' ? 1 : -1, b: ['upper', 'fore', 'hand'].map(k => byName[k + sd]) }));
  byName.jaw.rotation.z = JAW_CLOSED;
  // ---- детали на голове: глаза с веками
  const kit = new Kit(), head = byName.head, headO = rest[bi.head];
  const glow = (r.sense || 0) >= 2 || o.glowEyes;
  const eyeC = lm.eye, ER = 0.098 * s * (o.eyeK || 1), irisC = mulHex(o.irisC || (glow ? 0xffd23a : 0xc98a1c), 0.74);
  const eyes = [], lids = [];
  const lidC = new THREE.Color(0, 0, 0); { const col = L.geo.attributes.color.array; let cnt = 0;
    for (let i = 0; i < n; i++) { if (D.R[i]) continue; const dx = mp[i * 3] - eyeC[0], dy = mp[i * 3 + 1] - eyeC[1], dz = Math.abs(mp[i * 3 + 2]) - eyeC[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 > 0.012 && d2 < 0.05) { lidC.r += col[i * 3]; lidC.g += col[i * 3 + 1]; lidC.b += col[i * 3 + 2]; cnt++; } }
    if (cnt) lidC.multiplyScalar(0.95 / cnt); else lidC.set(o.pal.side); }
  const skinSide = (MORPH && MORPH.c1 != null) ? MORPH.c1 : o.pal.side;
  const lidMat = new THREE.MeshStandardMaterial({ color: lidC.clone().multiplyScalar(0.9), roughness: 0.8 });
  for (const sd of [1, -1]) {
    const pe = new V3(eyeC[0] * s, eyeC[1] * s, sd * eyeC[2] * s), dir = new V3(lm.eyeDir[0], lm.eyeDir[1], sd * lm.eyeDir[2]).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone(), Fd = ER * 0.82;
    const qE = (k) => [ER * k, ER * k, Fd * 0.8];
    kit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, Fd], qd), 0x1a100a);                                                                    // глазное яблоко (тёмный край)
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.2), qE(0.95), qd), mulHex(irisC, 0.5));     // тёмный лимб радужки
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.34), qE(0.86), qd), irisC);                     // радужка
    kit.add(head, headO, glow ? 'glow' : 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.46), [ER * 0.62, ER * 0.62, Fd * 0.8], qd), mixHex(irisC, 0xffe08a, 0.45));   // светлое кольцо вокруг зрачка
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.62), [ER * 0.34, ER * 0.46, Fd * 0.74], qd), 0x020101);   // зрачок: вертикальный овал
    kit.add(head, headO, 'glow', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 1.2).addScaledVector(ey, ER * 0.34).addScaledVector(ex, ER * 0.26), [ER * 0.13, ER * 0.13, Fd * 0.1]), 0xfffaf0);   // блик
    const eg = new THREE.Group(); eg.position.copy(c0).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.03, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.08, LR * 1.04, Fd * 0.78); m.position.set(0, -sgn * LR, Fd * 0.2); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) }); eyes.push(pe);
  }
  // ---- вид от эволюции: шипы по спине, костные бляшки, свечение стада
  const topAt = (x) => { let y = 0; for (let i = 0; i < n; i++) if (Math.abs(mp[i * 3] - x) < 0.25 && Math.abs(mp[i * 3 + 2]) < 0.5 && mp[i * 3 + 1] > y) y = mp[i * 3 + 1]; return y; };
  const spineB = ['tail4', 'tail3', 'tail2', 'tail1', 'tail0', 'root', 'chest', 'neck0'], boneAtX = (x) => { let b = 'root', bd = 1e9; for (const k of spineB) { const d = Math.abs(rest[bi[k]].x / s - x); if (d < bd) { bd = d; b = k; } } return b; };
  const ivory = 0xe8dcc0, spk = r.spikes || 0;
  for (let i = 0; i < spk * 2 + (spk ? 2 : 0); i++) {
    const x = 3.2 - i * 0.78, k = boneAtX(x), p = new V3(x * s, (topAt(x) - 0.08) * s, 0), tilt = new V3(-0.35, 1, 0).normalize();
    kit.add(byName[k], rest[bi[k]], 'acc', UNIT.cone, M_spike(p, tilt, (0.07 + spk * 0.03) * (1 - i * 0.03), 0.028 + spk * 0.004), ivory);
  }
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) {
    const x = 2.8 - i * 0.62, k = boneAtX(x), yy = topAt(x), p = new V3(x * s, (yy - 0.22) * s, sd * 0.34 * s);
    kit.add(byName[k], rest[bi[k]], 'skin', UNIT.scute, M_ell(p, [0.05, 0.022, 0.04], new THREE.Quaternion().setFromUnitVectors(Y_UP, new V3(0, 1, sd * 0.6).normalize())), mulHex(o.pal.back, 0.9), true);
  }
  if ((r.herd || 0) > 0) for (let i = 0; i < r.herd; i++) { const x = 2.4 - i * 0.9, k = boneAtX(x); kit.add(byName[k], rest[bi[k]], 'glow', UNIT.sphLo, M_ell(new V3(x * s, (topAt(x) + 0.05) * s, 0), [0.03, 0.03, 0.03]), 0xffd35a); }
  if (o.extras) o.extras({ L, kit, head, headO, k: 1, s, rig });
  kit.build({ emis: o.emis });
  setHeadAnch(rig, head, new V3(lm.hat[0] * s, lm.hat[1] * s, 0).sub(headO), eyes[0].clone().sub(headO), new V3(lm.neck[0] * s, lm.neck[1] * s, 0));
  rig.walkAmp = 0.3; rig.gait = 'biped'; rig.k = 0.42;
  rig.tagH = 6.3 * s + 0.35;
  rig.rex = { s, lids, chest: byName.chest, hipH: 3.7 * s, legs: rig.legs, arms, mesh, jaw: byName.jaw, root: byName.root, rootRest: rest[bi.root].clone() };
  return rig;
}

// ---------- анимация тираннозавра ----------
export function animRex(dino, P, t, speed, dt, st) {
  const T = P.rex, sp = P.spine, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { ph: Math.random(), v: 0, w: 0, yaw: dino.rotation.y, acc: 0, mv: 0, blink: 2 + Math.random() * 3, roar: 0, run: 0, look: 0, drop: 0, jaw: JAW_CLOSED, sniff: 0, sT: 5 + Math.random() * 6, idle: 0, snap: 0 });
  const vW = Math.max(0, speed) * 6, vM = vW / sc;
  const yaw = dino.rotation.y, wRaw = ddt > 0 ? wrapA(yaw - S.yaw) / ddt : 0; S.yaw = yaw;
  { const wT = Math.max(-3, Math.min(3, wRaw)); S.w += (wT - S.w) * Math.min(1, ddt * (Math.abs(wT) < Math.abs(S.w) ? 18 : 6)); }
  const vPrev = S.v; S.v += (vM - S.v) * Math.min(1, ddt * (vM < S.v ? (vM < 0.05 ? 40 : 16) : 6)); S.acc += ((S.v - vPrev) / Math.max(ddt, 1e-3) - S.acc) * Math.min(1, ddt * 4);
  const swim = !!st.swim, climb = !!st.climb, fly = !!st.fly, guard = !!st.guard;
  const base = ((CONFIG.CLASSES.carn || {}).speed || 180) / 30;
  const runT = st.run !== undefined ? (st.run ? 1 : 0) : sstep(1.2, 1.5, vW / base);
  S.run += (runT * (S.v > 0.05 ? 1 : 0) - S.run) * Math.min(1, ddt * 4); const run = S.run;
  const hipH = T.hipH, s = T.s, Rb = 1.0;
  const turnV = Math.abs(S.w) * Rb, mvSp = Math.max(S.v, turnV);
  const moving = sstep(0.04, 0.25, mvSp / hipH);
  // шаг: длина опоры ~0.45 высоты бедра (бег 0.6); частота = β·скорость / длина опоры, не больше предела
  const beta = 0.62 - 0.17 * run;
  const Sx = 1.95 * s * (1 + 0.25 * run), fmax = Math.min(1.45, 1.05 / Math.sqrt(Math.min(1, sc))) * (1 + 0.1 * run), Smax = 2.4 * s * (1 + 0.15 * run);
  const f = mvSp > 0.1 * hipH ? 0.86 * Math.max(0.35, Math.min(fmax, beta * mvSp / Sx)) : 0;      // тираннозавр перебирает ногами чуть медленнее (−14 %)
  if (f > 0) S.ph = (S.ph + ddt * f) % 1;
  S.mv += ((f > 0 ? 1 : 0) - S.mv) * Math.min(1, ddt * (f > 0 ? 8 : 16));
  // укус / рёв
  // укус (~0.7 с): замах — голова назад-вверх, пасть раскрывается; бросок вперёд-вниз; хлопок челюстей; тряска головой; возврат
  const bp = dino.userData.bite > 0 ? 1 - dino.userData.bite : -1, bc = bp >= 0 ? 1 : 0;
  const pull = bp >= 0 ? sstep(0, 0.2, bp) * (1 - sstep(0.24, 0.36, bp)) : 0, lunge = bp >= 0 ? sstep(0.2, 0.38, bp) * (1 - sstep(0.52, 0.92, bp)) : 0;
  const open = bp >= 0 ? sstep(0.03, 0.24, bp) * (1 - sstep(0.37, 0.43, bp)) + 0.12 * sstep(0.43, 0.48, bp) * (1 - sstep(0.5, 0.66, bp)) : 0;
  const shk = bp >= 0 ? sstep(0.43, 0.5, bp) * (1 - sstep(0.6, 0.92, bp)) * Math.sin(t * 22) : 0;
  if (dino.userData.roar > 0) { S.roar = 1; dino.userData.roar = 0; }
  if (S.roar > 0) S.roar = Math.max(0, S.roar - ddt / 2.6);
  const ro = S.roar > 0 ? sstep(0, 0.15, 1 - S.roar) * sstep(0, 0.28, S.roar) : 0, roShake = ro * Math.sin(t * 28) * 0.05;
  // в покое иногда принюхивается: голова вскидывается и чуть шевелит пастью
  if (mvSp < 0.05 * hipH && !swim && !climb && !bc && !ro) { S.idle += ddt; if (S.idle > S.sT) { S.sniff = Math.min(1, S.sniff + ddt * 0.9); if (S.idle > S.sT + 3.2) { S.idle = 0; S.sT = 6 + Math.random() * 8; } } else S.sniff = Math.max(0, S.sniff - ddt * 1.1); }
  else { S.idle = 0; S.sniff = Math.max(0, S.sniff - ddt * 2); }
  const sn = sstep(0, 1, S.sniff), snw = sn * Math.sin(t * 9) * 0.03;
  // ---- корпус: инерция, крен в поворотах, дыхание; на бегу корпус наклонён вперёд, хвост — противовес
  P.body.rotation.x = Math.max(-0.07, Math.min(0.07, -S.acc / Math.max(hipH, 0.1) * 0.01)) + (climb ? -1.35 : 0) + run * 0.07 * (S.mv || 0) + Math.sin(S.ph * PI * 4) * 0.012 * moving;
  P.body.rotation.z = Math.max(-0.1, Math.min(0.1, -S.w * S.v / hipH * 0.02)) + Math.sin(S.ph * PI * 2) * 0.018 * moving;
  P.body.rotation.y = 0;
  P.frame.position.set(0, 0, (lunge * 0.07 - pull * 0.03) * hipH * 1.4); P.frame.rotation.set(0, -PI / 2, 0);
  const br = Math.sin(t * (1.3 + 1.2 * moving)) * (0.014 + 0.008 * run); T.chest.scale.set(1, 1 + br, 1 + br * 1.3);
  // таз качается в такт шагам: вес переносится на опорную ногу
  const swayZ = Math.sin(S.ph * PI * 2) * 0.05 * s * 3 * moving, bobY = -Math.abs(Math.sin(S.ph * PI * 2)) * 0.03 * hipH * moving;
  T.root.position.set(T.rootRest.x, T.rootRest.y + bobY, T.rootRest.z + swayZ);
  // ---- хвост: волна против шага, не волочится
  const tw = S.ph * PI * 2;
  sp.tail.forEach((b, i) => {
    if (swim) { b.rotation.y = Math.sin(t * 3.4 - i * 0.8) * (0.07 + i * 0.045) - S.w * 0.03 * (i + 1) * 0.5; b.rotation.z = Math.sin(t * 1.7 - i * 0.5) * 0.02 - 0.02; return; }
    b.rotation.y = Math.sin(t * 0.7 - i * 0.55) * 0.04 * (1 - moving) - Math.sin(tw - i * 0.55) * 0.05 * moving * (1 + i * 0.12) - S.w * 0.04 * (i + 1) * 0.5 + (i > 1 ? roShake * 0.5 : 0);
    b.rotation.z = Math.sin(t * 0.5 - i * 0.45) * 0.012 + run * 0.025 * (i < 3 ? 1 : 0.2) + (i === 0 ? 0.01 : 0) - ro * 0.03 - lunge * 0.015 + Math.cos(tw * 2 - i * 0.5) * 0.012 * moving;
  });
  sp.root.rotation.set(0, Math.sin(tw) * 0.025 * moving, 0);
  // ---- шея и голова: осматривается, смотрит в поворот, при укусе вытягивается вперёд-вниз, в реве поднимает голову
  S.look += ddt; const lk = (1 - moving) * (1 - sn);
  const lookY = (Math.sin(S.look * 0.17) * 0.2 + Math.sin(S.look * 0.41 + 1) * 0.05) * lk + S.w * 0.08, lookZ = (Math.sin(S.look * 0.23 + 2) * 0.04) * lk;
  const nod = Math.sin(tw * 2 + 0.6) * 0.008 * moving;
  for (const b of sp.neck) { b.rotation.y = lookY * 0.4; b.rotation.z = lookZ * 0.4 + sn * 0.07 + pull * 0.03 - lunge * 0.03 + ro * 0.1 + nod - run * 0.03 + (swim ? 0.1 : 0); b.rotation.x = 0; }
  sp.head.rotation.y = lookY * 0.3 + roShake + shk * 0.1; sp.head.rotation.x = roShake * 0.5;
  sp.head.rotation.z = lookZ * 0.5 + sn * 0.12 + snw + pull * 0.06 - lunge * 0.02 + ro * 0.2 + nod * 0.5 + (swim ? 0.12 : 0);
  // ---- челюсть: в покое закрыта, чуть приоткрывается на дыхании; укус — резкое раскрытие и хлопок; рёв — максимально
  const breath = 0.012 * (1 + Math.sin(t * 1.4)) + sn * (0.03 + 0.03 * Math.sin(t * 9));
  const jT = JAW_CLOSED - breath - open * (JAW_CLOSED - JAW_OPEN) * 1.0 - ro * (JAW_CLOSED - JAW_OPEN) * 0.95 - (swim ? 0.0 : 0);
  S.jaw += (jT - S.jaw) * Math.min(1, ddt * (jT < S.jaw ? 22 : 45)); T.jaw.rotation.z = S.jaw;
  // ---- руки: маленькие, подрагивают в такт шагам; при укусе подбираются, при реве раскрываются
  for (const A of T.arms) {
    const ph = tw * 1 + (A.side > 0 ? 0 : PI), sw = Math.sin(ph) * 0.05 * moving, idl = Math.sin(t * 0.9 + (A.side > 0 ? 0 : 1.3)) * 0.02;
    A.b[0].rotation.z = sw + idl + lunge * 0.25 - ro * 0.25; A.b[0].rotation.y = A.side * ro * 0.15;
    A.b[1].rotation.z = -Math.max(0, sw) * 0.4 + 0.2 * lunge + ro * 0.15; A.b[2].rotation.z = Math.sin(t * 2.1 + A.side * 2) * 0.02 - lunge * 0.1;
  }
  // ---- моргание: верхнее веко опускается быстро, открывается медленнее; иногда двойное
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u);
    if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  const droop = 0.05 * (1 - 0.6 * moving) + 0.08 * sn + 0.12 * ro + 0.1 * open;
  for (const l of T.lids) { const ty = 0.02 + droop + bl * (1.0 - droop); l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
  // ---- ноги: IK от бедра к цели ступни; цели в системе корня (земля — y = 0). Шаг: правая и левая в противофазе.
  const offW = { R: 0, L: 0.5 };
  P.body.position.y = 0;
  dino.updateMatrixWorld(true);
  const root = dino, wq = _tq[1], hipW = _tv[0], tg = _tv[1], ankT = _tv[2], kn = _tv[3], tmp = _tv[4];
  const legT = [];
  for (const lg of P.legs) {
    const key = lg.side > 0 ? 'R' : 'L';
    const phi = ((S.ph + offW[key]) % 1 + 1) % 1;
    const rx = lg.rest[3].x, rz = lg.rest[3].z, fr = Math.max(f, 0.3);
    let gx = -(S.v + S.w * rz) * beta / fr * moving, gz_ = S.w * rx * beta / fr * moving;
    const gl = Math.hypot(gx, gz_); if (gl > Smax) { gx *= Smax / gl; gz_ *= Smax / gl; }
    let ox, oz, oy = 0, toe = 0;
    if (swim) { const a = t * 3 + (lg.side > 0 ? 0 : PI); ox = Math.sin(a) * hipH * 0.2; oy = hipH * (0.35 + 0.15 * Math.cos(a)); oz = 0; toe = -0.4; }
    else if (phi < beta) { const u = phi / beta; ox = gx * (u - 0.5); oz = gz_ * (u - 0.5); toe = -sstep(0.82, 1.0, u) * 0.35 * moving; }
    else { const u = (phi - beta) / (1 - beta), e = u * u * (3 - 2 * u); ox = gx * (0.5 - e); oz = gz_ * (0.5 - e); oy = Math.sin(PI * u) * hipH * (0.14 + 0.08 * run) * moving; toe = Math.sin(PI * u) * (0.35 + 0.2 * run) * moving - (u < 0.25 ? 0.4 * moving * (1 - u / 0.25) : 0); }
    const mk = S.mv; ox *= mk; oz *= mk; oy *= mk; toe *= mk;
    legT.push({ lg, ox, oy, oz, toe, stance: !swim && phi < beta, sp: 0 });
  }
  // сколько опустить корпус, чтобы опорные ноги дотягивались
  let need = 0;
  if (!swim && !climb) for (const L of legT) {
    const lg = L.lg, b = lg.bones, Lmax = (b[1].position.length() + b[2].position.length()) * 0.985;
    const dx = lg.rest[2].x + L.ox - lg.rest[0].x, dz = (lg.rest[3].z + L.oz + L.sp) - lg.rest[0].z - swayZ, hy = lg.rest[0].y + bobY - (lg.rest[2].y - lg.rest[3].y) - lg.rest[3].y - L.oy;
    const reach = Math.sqrt(Math.max(0, Lmax * Lmax - dx * dx - dz * dz));
    if (L.stance || L.oy < 0.02) need = Math.max(need, hy - reach);
  }
  S.drop += (Math.min(Math.max(0, need), hipH * 0.12) + hipH * 0.015 * S.mv + (guard ? hipH * 0.2 : 0) - S.drop) * Math.min(1, ddt * 14);
  P.body.position.y = swim ? -hipH * 0.12 : -S.drop;
  dino.updateMatrixWorld(true);
  if (climb || fly) { for (const lg of P.legs) for (const b of lg.bones) b.quaternion.identity(); return; }
  for (const L of legT) {
    const lg = L.lg, b = lg.bones;
    b[0].quaternion.identity(); b[0].updateMatrixWorld(true);
    b[0].getWorldPosition(hipW);
    // цель сустава пальцев (foot) в системе корня → в мир
    const fx = lg.rest[3].x + L.ox, fz = lg.rest[3].z + L.oz + L.sp, fy = lg.rest[3].y + L.oy;
    tg.set(-fz, fy, fx); root.localToWorld(tg);
    // лодыжка (ankle) — над стопой, наклон как в покое
    tmp.set(-(lg.rest[2].z - lg.rest[3].z), lg.rest[2].y - lg.rest[3].y, lg.rest[2].x - lg.rest[3].x).multiplyScalar(sc);
    root.getWorldQuaternion(wq); tmp.applyQuaternion(wq);
    ankT.copy(tg).add(tmp);
    // двухзвенная IK: бедро → колено → лодыжка; колено вперёд
    const L1 = b[1].position.length() * sc, L2 = b[2].position.length() * sc;
    const dv = tmp.subVectors(ankT, hipW); let d = dv.length(); const dmax = (L1 + L2) * 0.999, dmin = Math.abs(L1 - L2) + 1e-4;
    if (d > dmax) { ankT.copy(hipW).addScaledVector(dv, dmax / d); d = dmax; } else if (d < dmin) d = dmin;
    const dir = dv.normalize();
    const pole = _tv[5].set(0, 0, 1).applyQuaternion(wq);
    const nrm = kn.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const ca = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))), al = Math.acos(ca);
    const knee = kn.multiplyScalar(Math.sin(al) * L1).addScaledVector(dir, Math.cos(al) * L1).add(hipW);
    aimBone(b[0], b[1], tmp.subVectors(knee, hipW));
    aimBone(b[1], b[2], tmp.subVectors(ankT, knee));
    // стопа: ориентация жёстко «плоско» (как в покое: IK не скручивает её, пальцы не сходятся), пальцы — лишь наклон вверх-вниз
    { const q = _tq[2].copy(wq).multiply(P.frame.quaternion); b[2].parent.getWorldQuaternion(_tq[0]); _tq[0].invert(); b[2].quaternion.copy(_tq[0]).multiply(q); b[2].updateMatrixWorld(true);
      b[3].quaternion.setFromAxisAngle(_tv[6].set(0, 0, 1), L.toe * 0.8); }
  }
}

// ======================================================================== ЛЕТАЮЩИЙ: ПТЕРАНОДОН (модель со скелетом из Jurassic Park: The Game, tools/ptn_bake.py → game/ptn.js)
// Сетка ~7 тыс. вершин, 117 костей. В полёте играет исходная анимация взмахов (30 кадров/с, петля 3 с); на земле крылья складываются,
// ноги ставятся вниз и шагают, высота корпуса считается по стопам. Цвета — из палитры и узора игрока, тонкая фактура кожи — из исходных атласов.
// Глаза и веки собраны заново (как у хищника), нижняя челюсть — своя кость.
let PN_D = null, PN_TEX = null;
function ptnData() {
  if (PN_D) return PN_D;
  const R = PTN, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  const qs = new Int16Array(b64buf(R.clip.q)), QC = new Float32Array(qs.length); for (let i = 0; i < qs.length; i++) QC[i] = qs[i] / 32767;
  PN_D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), M: new Uint8Array(b64buf(R.m)), Rd: new Uint8Array(b64buf(R.r)), Q: new Uint8Array(b64buf(R.q)),
    par: R.par, pos: R.pos, nb: R.par.length, QC, nf: R.clip.nf, dur: R.clip.dur, tb: R.clip.tb, eyes: R.eyes, eyeR: R.eyeR };
  // главная кость каждой вершины и габариты
  const dom = new Uint8Array(n); for (let i = 0; i < n; i++) { let bk = 0, bw = -1; for (let k = 0; k < 4; k++) if (PN_D.SW[i * 4 + k] > bw) { bw = PN_D.SW[i * 4 + k]; bk = PN_D.SI[i * 4 + k]; } dom[i] = bk; }
  PN_D.tbm = {}; for (const k in R.clip.tb) { const a = R.clip.tb[k], m = [0, 0, 0]; for (const r of a) for (let c = 0; c < 3; c++) m[c] += r[c] / a.length; PN_D.tbm[k] = m; }
  PN_D.dom = dom; return PN_D;
}
function ptnTex() {
  if (PN_TEX) return PN_TEX;
  PN_TEX = new THREE.TextureLoader().load('data:image/jpeg;base64,' + PTN.tex);
  PN_TEX.flipY = false; PN_TEX.colorSpace = THREE.NoColorSpace; PN_TEX.anisotropy = 4; PN_TEX.wrapS = PN_TEX.wrapT = THREE.ClampToEdgeWrapping;
  return PN_TEX;
}
const ptnMats = new Map();
function ptnMat(emis) {
  const key = emis || 0; let m = ptnMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: ptnTex(), roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  ptnMats.set(key, m); return m;
}
const PN_POSE = { shX: 0.15, shY: 1.4, shZ: 0, elY: 2.7, wrY: 2.95, w3Y: 0.0, wrS: 0.6, elS: 0.9, lgX: 1.2, lgZ: 0.0, thZ: 1.5, knZ: 0.5, anZ: -0.5, jawC: 0, nkZ: [0, 0.12, 0.12, 0.1, 0.05, -0.05, -0.1, -0.1], hdZ: -0.3, legK: 1.6 };

if (typeof window !== 'undefined') window.__PN_POSE = PN_POSE;
const PN_S = 0.4, PN_OFF = [0.4, 0, 0], PN_JAW_OPEN = 0.62;
// кости: корень 0, таз 1, хвост 2-4, ноги 5-26 / 27-48 (бедро 5, колено 7→8, лодыжка 11), шея 49-55, голова 56 (верхний клюв, гребень), 57-58 горло, нижняя челюсть нижняя челюсть 59, крылья 79-97 (z<0) и 98-116 (z>0)
const PN_LEG = [{ b: 5, sg: 1 }, { b: 27, sg: -1 }], PN_WING = [{ ch: [79, 80, 81, 82, 83, 84, 85], sg: -1 }, { ch: [98, 100, 101, 102, 103, 104, 105], sg: 1 }];
function pteranodon(o) {
  const r = o.r || {}, stage = o.stage || 0, Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = ptnData(), n = D.n, s = PN_S, pal = o.pal, nb = D.nb, dom = D.dom;
  const mp = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { mp[i * 3] = D.P[i * 3] - PN_OFF[0]; mp[i * 3 + 1] = D.P[i * 3 + 1] - PN_OFF[1]; mp[i * 3 + 2] = D.P[i * 3 + 2] - PN_OFF[2]; pos[i * 3] = mp[i * 3] * s; pos[i * 3 + 1] = mp[i * 3 + 1] * s; pos[i * 3 + 2] = mp[i * 3 + 2] * s; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  // ---- раскраска: палитра игрока (спина-бок-брюхо + узор), перепонка/гребень/клюв/пасть/когти — отдельные цвета, умножение на карту деталей (×2: серый 0.5 = без изменений)
  const nor = D.N, up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = nor[i * 3 + 1] * 0.8 + sstep(-0.1, 0.3, mp[i * 3 + 1]) * 0.35 - 0.15; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat);
  const sideE = (MORPH && MORPH.c1 != null) ? MORPH.c1 : pal.side, bellyE = MORPH ? (MORPH.c3 != null ? MORPH.c3 : mixHex(sideE, 0xffffff, 0.5)) : pal.belly, stripeE = MORPH ? (MORPH.pc != null ? MORPH.pc : mulHex(MORPH.c2, 0.6)) : pal.stripe;
  const memC = o.memC || mixHex(sideE, bellyE, 0.35), tipC = o.memTip || mulHex(sideE, 0.8), crestC = o.crestC || mixHex(stripeE, 0xc2463a, 0.55), beakC = o.beakC || mixHex(0xd8c08a, bellyE, 0.2), mouthC = 0xb4585c;
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), cm = hx(memC), ct = hx(tipC), ccr = hx(crestC), cb = hx(beakC), cbt = hx(mulHex(beakC, 0.7)), cc = hx(0x241e19), cmo = hx(mouthC), hi = (r.altitude || 0) >= 3 ? hx(0xffffff) : null;
    for (let i = 0; i < n; i++) {
      const mw = D.M[i] / 255, rd = D.Rd[i] / 255, mo = D.Q[i] / 255, x = mp[i * 3], y = mp[i * 3 + 1], z = mp[i * 3 + 2], b = dom[i];
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (mw > 0.01) { const t = sstep(1.2, 5.6, Math.abs(z)); const cw = cm.clone().lerp(ct, t * 0.85); if (hi) cw.lerp(hi, 0.2 * t); cw.multiplyScalar(0.94 + 0.1 * vnoise(x * 3.1, z * 3.1, 4.2)); c.lerp(cw, mw); }
      if (x > 1.1 && b >= 57 && b <= 66 || b === 7) { /* голова: клюв светлее к кончику */ const cbk = cb.clone().lerp(cbt, sstep(1.9, 2.4, x)); c.lerp(cbk, 0.55 * sstep(1.6, 1.95, x)); }
      if (rd > 0.01) c.lerp(ccr.clone().multiplyScalar(0.85 + 0.2 * vnoise(x * 6, y * 6, z * 6)), Math.min(1, rd * 1.1));
      if (mo > 0.01) c.lerp(cmo, mo);
      if ((b >= 87 && b <= 95 && ((b - 87) % 3) >= 1) || (b >= 107 && b <= 115 && ((b - 107) % 3) >= 1) || (b >= 12 && b <= 23 && ((b - 12) % 3) >= 2) || (b >= 34 && b <= 45 && ((b - 34) % 3) >= 2)) c.lerp(cc, 0.8);   // когти: концы пальцев
      c.multiplyScalar(2);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  // ---- скелет: нулевые повороты покоя (позы — просто кватернионы)
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'pn' + i; bones.push(bn); rest.push(new V3((D.pos[i][0] - PN_OFF[0]) * s, (D.pos[i][1] - PN_OFF[1]) * s, (D.pos[i][2] - PN_OFF[2]) * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, ptnMat(o.emis));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('ptero'); rig.frame.add(mesh);
  rig.spine = { root: bones[0], tail: [], neck: bones.slice(49, 56), head: bones[56] };
  rig.jaw = bones[59]; rig.jawBase = 0;
  // ---- голова: поперечник у глаза и верхняя точка черепа
  const head = bones[56], headO = rest[56];
  let hw = 0.05, topY = -1e9, topX = 1.5; for (let i = 0; i < n; i++) { const x = mp[i * 3], y = mp[i * 3 + 1], az = Math.abs(mp[i * 3 + 2]); if (x > 1.43 && x < 1.52 && az > hw) hw = az; if (x > 1.55 && x < 1.75 && az < 0.1 && y > topY) { topY = y; topX = x; } }
  const glow = (r.sense || 0) >= 2 || o.glowEyes, kit = new Kit();
  const ex0 = D.eyes[0][0] - PN_OFF[0], ey0 = D.eyes[0][1] - PN_OFF[1], ER = Math.max(0.05, D.eyeR * 2.3) * s * (o.eyeK || 1), irisC = o.irisC || (glow ? 0xffd23a : 0xd9962a);
  const eyes = [], lids = [], skinSide = (MORPH && MORPH.c1 != null) ? MORPH.c1 : pal.side;
  const lidMat = new THREE.MeshStandardMaterial({ color: lidSkin(L, mp, n, [ex0, ey0, Math.abs(D.eyes[0][2]) - PN_OFF[2]], 0.5 * 0.85), roughness: 0.8 });
  for (const sd of [1, -1]) {
    const pe = new V3(ex0 * s, ey0 * s, sd * Math.max(hw * 0.86, 0.06) * s), dir = new V3(0.3, 0.1, sd * 0.95).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone(), Fd = ER * 0.82, qE = (k) => [ER * k, ER * k, Fd * 0.8];
    kit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, Fd], qd), 0x1a100a);
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.2), qE(0.95), qd), mulHex(irisC, 0.5));
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.34), qE(0.86), qd), irisC);
    kit.add(head, headO, glow ? 'glow' : 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.46), [ER * 0.62, ER * 0.62, Fd * 0.8], qd), mixHex(irisC, 0xffe08a, 0.45));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.62), [ER * 0.4, ER * 0.4, Fd * 0.74], qd), 0x020101);
    kit.add(head, headO, 'glow', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 1.2).addScaledVector(ey, ER * 0.34).addScaledVector(ex, ER * 0.26), [ER * 0.13, ER * 0.13, Fd * 0.1]), 0xfffaf0);
    const eg = new THREE.Group(); eg.position.copy(c0).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.03, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.08, LR * 1.04, Fd * 0.78); m.position.set(0, -sgn * LR, Fd * 0.2); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) }); eyes.push(pe);
  }
  // ---- вид от эволюции: бугорки и шипы вдоль спины (по высоте тела в этом месте)
  const topAt = (x) => { let m = -1e9; for (let i = 0; i < n; i++) if (Math.abs(mp[i * 3] - x) < 0.06 && Math.abs(mp[i * 3 + 2]) < 0.1 && dom[i] < 57 && mp[i * 3 + 1] > m) m = mp[i * 3 + 1]; return m > -1e8 ? m : 0.1; };
  const ivory = 0xe8dcc0;
  for (let i = 0; i < (r.hide || 0) * 2; i++) for (const sd of [1, -1]) {
    const x = -0.05 - i * 0.2, p = new V3(x * s, (topAt(x) - 0.01) * s, sd * 0.07 * s);
    kit.add(bones[0], rest[0], 'skin', UNIT.scute, M_ell(p, [0.032, 0.014, 0.028], new THREE.Quaternion()), mulHex(pal.back, 0.9), true);
  }
  if (stage >= 1) for (let i = 0; i < 2 + stage; i++) { const x = -0.1 - i * 0.2, p = new V3(x * s, (topAt(x) - 0.01) * s, 0); kit.add(bones[0], rest[0], 'acc', UNIT.cone, M_spike(p, new V3(-0.4, 1, 0).normalize(), 0.06 + stage * 0.008, 0.016), ivory); }
  if (o.extras) o.extras({ L, kit, head, headO, k: 1, s, rig });
  kit.build({ emis: o.emis });
  setHeadAnch(rig, head, new V3(topX * s, topY * s, 0).sub(headO), eyes[0].clone().sub(headO), new V3(rest[50].x, rest[50].y, 0));
  rig.anch.crownK = 0.5; rig.anch.hatZ = rig.anch.eyeZ - 0.1;   // голова птеранодона узкая и длинная: корона вдвое меньше и стоит на черепе, над глазом, а не на клюве
  rig.walkAmp = 0.35; rig.gait = 'biped'; rig.flies = true; rig.k = 0.5;
  rig.tagH = 1.3 * s * 2 + 0.5;
  const gq = bones.map(() => new THREE.Quaternion());
  rig.ptero = { s, lids, bones, rest, gq, nb, spanK: 1 + (r.wings || 0) * 0.045 + stage * 0.05, footPts: [[14, 17, 20, 23, 26], [36, 39, 42, 45, 48]] };
  return rig;
}

// ---------- анимация птеранодона ----------
const _pe = new THREE.Euler(), _pq = new THREE.Quaternion(), _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4(), _pv = new V3(), _ps = new V3(1, 1, 1);
function pnFootLow(T) {         // самая низкая точка стоп в осях корпуса (кость → родитель, без корпусного наклона)
  const bn = T.bones, D = PN_D; let low = 1e9;
  for (const grp of T.footPts) for (const tip of grp) {
    let b = tip; _pm.identity(); const ch = []; while (b >= 0) { ch.push(b); b = D.par[b]; }
    for (let k = ch.length - 1; k >= 0; k--) { const bb = bn[ch[k]]; _pm2.compose(bb.position, bb.quaternion, bb.scale); _pm.multiply(_pm2); }
    _pv.setFromMatrixPosition(_pm); if (_pv.y < low) low = _pv.y;
  }
  return low;
}
export function animPtero(dino, P, t, speed, dt, st) {
  const T = P.ptero, D = PN_D, sp = P.spine, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1, bn = T.bones, gq = T.gq, NB = T.nb, NF = D.nf;
  const S = T.st || (T.st = { ph: Math.random(), u: Math.random(), v: 0, w: 0, yaw: dino.rotation.y, mv: 0, fl: st.fly ? 1 : 0, blink: 2 + Math.random() * 3, roar: 0, look: 0, jaw: 0, sniff: 0, sT: 5 + Math.random() * 6, idle: 0, pitch: 0, roll: 0, glide: 0, lift: 0, fine: 0 });
  const vM = Math.max(0, speed) * 6 / sc;
  const yaw = dino.rotation.y, wRaw = ddt > 0 ? wrapA(yaw - S.yaw) / ddt : 0; S.yaw = yaw;
  { const wT = Math.max(-3, Math.min(3, wRaw)); S.w += (wT - S.w) * Math.min(1, ddt * (Math.abs(wT) < Math.abs(S.w) ? 12 : 5)); }
  S.v += (vM - S.v) * Math.min(1, ddt * (vM < S.v ? 14 : 6));
  const fly = !!st.fly, guard = !!st.guard, s = T.s;
  S.fl += ((fly ? 1 : 0) - S.fl) * Math.min(1, ddt * 3.5); const fl = S.fl, gr = 1 - fl;
  const moving = sstep(0.05, 0.35, S.v), mvSp = Math.max(S.v, Math.abs(S.w) * 0.5);
  // ---- укус, рёв, принюхивание
  const bp = dino.userData.bite > 0 ? 1 - dino.userData.bite : -1, bc = bp >= 0 ? 1 : 0;
  const pull = bp >= 0 ? sstep(0, 0.2, bp) * (1 - sstep(0.24, 0.36, bp)) : 0, lunge = bp >= 0 ? sstep(0.2, 0.38, bp) * (1 - sstep(0.52, 0.92, bp)) : 0;
  const open = bp >= 0 ? sstep(0.03, 0.24, bp) * (1 - sstep(0.37, 0.43, bp)) + 0.12 * sstep(0.43, 0.48, bp) * (1 - sstep(0.5, 0.66, bp)) : 0;
  const shk = bp >= 0 ? sstep(0.43, 0.5, bp) * (1 - sstep(0.6, 0.92, bp)) * Math.sin(t * 22) : 0;
  if (dino.userData.roar > 0) { S.roar = 1; dino.userData.roar = 0; }
  if (S.roar > 0) S.roar = Math.max(0, S.roar - ddt / 2.4);
  const ro = S.roar > 0 ? sstep(0, 0.15, 1 - S.roar) * sstep(0, 0.28, S.roar) : 0, roShake = ro * Math.sin(t * 26) * 0.04;
  if (mvSp < 0.05 && !fly && !bc && !ro) { S.idle += ddt; if (S.idle > S.sT) { S.sniff = Math.min(1, S.sniff + ddt * 0.9); if (S.idle > S.sT + 3) { S.idle = 0; S.sT = 6 + Math.random() * 8; } } else S.sniff = Math.max(0, S.sniff - ddt * 1.1); }
  else { S.idle = 0; S.sniff = Math.max(0, S.sniff - ddt * 2); }
  const sn = sstep(0, 1, S.sniff);
  // ---- проигрыш исходного клипа полёта: частота растёт со скоростью
  const cps = 0.62 + 0.5 * Math.min(1, speed) + (bc ? 0.25 : 0) + (fl > 0.05 ? 0 : -0.3);
  S.u = (S.u + ddt * cps * (fl > 0.05 ? 1 : 0.4)) % 1;
  S.glide += ((fly && speed > 0.75 ? 1 : 0) - S.glide) * Math.min(1, ddt * 0.8);
  const fpos = S.u * NF, f0 = Math.floor(fpos) % NF, f1 = (f0 + 1) % NF, fa = fpos - Math.floor(fpos), QC = D.QC;
  // ---- поза на земле (gq): крылья сложены, ноги вниз, шаг
  for (let i = 0; i < NB; i++) gq[i].identity();
  const E = (b, x, y, z, ord) => { _pe.set(x, y, z, ord || 'XYZ'); gq[b].setFromEuler(_pe); };
  const PZ = PN_POSE;
  for (const W of PN_WING) { const g = W.sg;
    const c = W.ch; E(c[0], PZ.shX * g, -g * PZ.shY, PZ.shZ, 'ZYX'); E(c[2], 0, g * PZ.elY, 0); E(c[3], 0, -g * PZ.wrY, 0); E(c[4], 0, g * PZ.w3Y, 0); }
  const f = mvSp > 0.1 ? Math.max(0.7, Math.min(2.6, S.v / 0.85)) : 0; if (f > 0) S.ph = (S.ph + ddt * f) % 1;
  S.mv += ((f > 0 ? 1 : 0) - S.mv) * Math.min(1, ddt * (f > 0 ? 8 : 14));
  const tw = S.ph * PI * 2, mk = S.mv * gr;
  PN_LEG.forEach((lg, i) => { const g = lg.sg, b = lg.b, ph0 = tw + (i ? PI : 0), swing = Math.sin(ph0) * 0.5 * mk, c0 = Math.cos(ph0), lift = Math.max(0, c0) * mk, lift2 = Math.sin(Math.min(1, Math.max(0, c0)) * PI * 0.5);
    E(b + 1, g * PZ.lgX, 0, PZ.lgZ + swing, 'ZYX');                    // бедро: крен вниз, затем шаг в вертикальной плоскости
    const ax = _pv.set(0, Math.sin(g * PZ.lgX), Math.cos(g * PZ.lgX)), l2 = lift2 * mk;
    const th = PZ.thZ - 0.7 * l2 - 0.2 * mk * (1 - l2), kn = PZ.knZ + 0.7 * l2 + 0.17 * mk * (1 - l2), an = PZ.anZ + 0.35 * l2;       // шаг: колено сгибается, голень подтягивается назад, стопа почти горизонтальна, в опоре — лёгкая пружина
    gq[b + 2].setFromAxisAngle(ax, th); gq[b + 3].setFromAxisAngle(ax, kn); gq[b + 6].setFromAxisAngle(ax, an);
  });
  for (let k = 0; k < 8; k++) E(49 + k, 0, 0, PZ.nkZ[k]);
  E(56, 0, 0, PZ.hdZ);
  // ---- смесь «земля ↔ клип» → кватернионы костей
  for (let b = 0; b < NB; b++) {
    const q = bn[b].quaternion, a = gq[b];
    if (fl > 0.002) {
      const i0 = (f0 * NB + b) * 4, i1 = (f1 * NB + b) * 4; let ax = QC[i0], ay = QC[i0 + 1], az = QC[i0 + 2], aw = QC[i0 + 3], bx = QC[i1], by = QC[i1 + 1], bz = QC[i1 + 2], bw = QC[i1 + 3];
      if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      const cx = ax + (bx - ax) * fa, cy = ay + (by - ay) * fa, cz = az + (bz - az) * fa, cw = aw + (bw - aw) * fa;
      let dx = a.x, dy = a.y, dz = a.z, dw = a.w; if (dx * cx + dy * cy + dz * cz + dw * cw < 0) { dx = -dx; dy = -dy; dz = -dz; dw = -dw; }
      q.set(dx + (cx - dx) * fl, dy + (cy - dy) * fl, dz + (cz - dz) * fl, dw + (cw - dw) * fl).normalize();
    } else q.copy(a);
  }
  { const kk = 1 - 0.7 * fl; for (const b of [0, 1]) { const q = bn[b].quaternion; q.set(q.x * kk, q.y * kk, q.z * kk, q.w).normalize(); } }       // качание корпуса из клипа в полёте приглушено
  // позиции с анимацией: корень и задняя кромка
  for (const k in D.tb) { const b = +k, fr = D.tb[k], p0 = fr[f0], p1 = fr[f1], rb = T.rest[b], pr = D.par[b] >= 0 ? T.rest[D.par[b]] : null;
    const mn = D.tbm[k], bk = pr ? 1 : 0.5, px = (mn[0] + (p0[0] + (p1[0] - p0[0]) * fa - mn[0]) * bk - PN_OFF[0] * (pr ? 0 : 1)) * s, py = (mn[1] + (p0[1] + (p1[1] - p0[1]) * fa - mn[1]) * bk) * s, pz = (mn[2] + (p0[2] + (p1[2] - p0[2]) * fa - mn[2]) * bk) * s;
    const gx = rb.x - (pr ? pr.x : 0), gy = rb.y - (pr ? pr.y : 0), gz = rb.z - (pr ? pr.z : 0);
    bn[b].position.set(gx + (px - gx) * fl, gy + (py - gy) * fl, gz + (pz - gz) * fl); }
  // ---- шея и голова: лёгкая S-кривая на земле, голова держит горизонт
  S.look += ddt; const lk = (1 - moving) * (1 - sn) * gr + 0.4 * fl;
  const lookY = (Math.sin(S.look * 0.17) * 0.22 + Math.sin(S.look * 0.41 + 1) * 0.06) * lk + S.w * 0.1, lookZ = Math.sin(S.look * 0.23 + 2) * 0.05 * lk;
  const vsp = Math.min(1, speed), pT = fl * (0.08 + 0.18 * vsp) - gr * 0.0;
  S.pitch += (pT - S.pitch) * Math.min(1, ddt * 5);
  const nod = Math.sin(tw * 2 + 0.6) * 0.02 * mk, hold = -S.pitch * 0.6;
  const nk = sn * -0.03 + pull * 0.05 - lunge * 0.07 + ro * 0.06 + nod + hold * 0.12 + lookZ * 0.1;
  for (let k = 1; k < 7; k++) { _pq.setFromEuler(_pe.set(0, lookY * 0.06, nk, 'XYZ')); bn[49 + k].quaternion.multiply(_pq); }
  _pq.setFromEuler(_pe.set(0, lookY * 0.3 + roShake + shk * 0.1, lookZ * 0.5 + hold * 0.4 + sn * 0.1 + pull * 0.08 - lunge * 0.2 + ro * 0.3 + nod * 0.5 + Math.sin(t * 1.3) * 0.01, 'XYZ')); bn[56].quaternion.multiply(_pq);
  // ---- челюсть
  const breath = 0.02 * (1 + Math.sin(t * 1.5)) + sn * (0.04 + 0.04 * Math.sin(t * 9));
  const jT = PN_POSE.jawC - (breath + open * PN_JAW_OPEN + ro * PN_JAW_OPEN * 0.95);
  S.jaw += (jT - S.jaw) * Math.min(1, ddt * (jT < S.jaw ? 22 : 45)); bn[59].quaternion.setFromEuler(_pe.set(0, 0, S.jaw, 'XYZ'));
  for (const [h, k8, f11] of [[7, 8, 11], [29, 30, 33]]) { bn[h].scale.setScalar(PN_POSE.legK); bn[k8].scale.setScalar(1.15 / PN_POSE.legK); bn[f11].scale.setScalar(1); }       // ноги длиннее, стопы массивнее
  // ---- размах крыла от эволюции и рёва
  for (const W of PN_WING) { const k = 1 + (T.spanK - 1) * fl + ro * 0.05 * fl; bn[W.ch[0]].scale.set(1, 1, k); bn[W.ch[2]].scale.set(1, 1, 1 - gr * (1 - PN_POSE.elS)); bn[W.ch[3]].scale.set(1, 1, 1 - gr * (1 - PN_POSE.wrS)); }
  // ---- корпус: тангаж, крен, подъём-опускание
  const rT = Math.max(-0.75, Math.min(0.75, -S.w * (0.3 + 0.4 * vsp))) * fl + Math.max(-0.08, Math.min(0.08, -S.w * S.v * 0.01)) * gr;
  S.roll += (rT - S.roll) * Math.min(1, ddt * 5);
  P.body.rotation.x = S.pitch; P.body.rotation.z = S.roll + Math.sin(tw) * 0.045 * mk; P.body.rotation.y = 0;
  // высота корпуса на земле — по стопам (ноги стоят на земле при любой позе)
  const low = gr > 0.01 ? pnFootLow(T) : 0; S.lift += ((-low + 0.03 * s) - S.lift) * Math.min(1, ddt * 10); if (gr > 0.99 && Math.abs(S.fine) < 0) S.fine = 0;
  P.frame.position.set(0, S.lift * gr, (lunge * 0.06 - pull * 0.03)); P.frame.rotation.set(0, -PI / 2, 0);
  P.body.position.y = -(guard ? 0.05 : 0);
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u);
    if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  const droop = 0.05 * (1 - 0.6 * moving) + 0.08 * sn + 0.12 * ro + 0.1 * open;
  for (const l of T.lids) { const ty = 0.02 + droop + bl * (1.0 - droop); l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}

// ======================================================================== ВРАГИ-РАПТОРЫ: Velociraptor (модель со скелетом из Jurassic Park: The Game, tools/vel_bake.py → game/vel.js)
// Сетка ~4,2 тыс. вершин, 139 костей. Клипы: стойка, шаг, бег, укус — смешиваются по скорости; шаги идут по скорости врага (без скольжения стоп),
// высота корпуса считается по стопам из самого клипа. Цвета — палитра врага, тонкая фактура — из исходных атласов; глаза и веки собраны заново.
let VL_D = null, VL_TEX = null;
const VL_TIPS = [114, 118, 120, 122, 130, 134, 136, 138], VL_CLAWS = new Set([...VL_TIPS, 69, 72, 75, 86, 89, 92]);
const VL_S = 0.9, VL_OFF = [0.1, 0, 0], VL_WALK_V = 0.98, VL_RUN_V = 7;
function velLow(D, c) {              // самая низкая точка стоп в каждом кадре клипа (прямая кинематика только по ногам)
  const nb = D.nb, out = new Float32Array(c.nf), q = new THREE.Quaternion(), loc = new V3();
  const W = Array.from({ length: nb }, () => new V3()), Rq = Array.from({ length: nb }, () => new THREE.Quaternion());
  for (let f = 0; f < c.nf; f++) {
    const done = new Uint8Array(nb);
    const calc = (b) => {
      if (done[b]) return; done[b] = 1; const p = D.par[b], i = (f * nb + b) * 4, t = c.tb[b];
      q.set(c.QC[i], c.QC[i + 1], c.QC[i + 2], c.QC[i + 3]);
      if (p < 0) { if (t) W[b].set(t[f][0], t[f][1], t[f][2]); else W[b].set(D.pos[b][0], D.pos[b][1], D.pos[b][2]); Rq[b].copy(q); }
      else { calc(p); if (t) loc.set(t[f][0], t[f][1], t[f][2]); else loc.set(D.pos[b][0] - D.pos[p][0], D.pos[b][1] - D.pos[p][1], D.pos[b][2] - D.pos[p][2]); W[b].copy(loc).applyQuaternion(Rq[p]).add(W[p]); Rq[b].copy(Rq[p]).multiply(q); }
    };
    let low = 1e9; for (const tp of VL_TIPS) { calc(tp); low = Math.min(low, W[tp].y); } out[f] = low;
  }
  return out;
}
function velData() {
  if (VL_D) return VL_D;
  const R = VEL, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  const D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), M: new Uint8Array(b64buf(R.m)), T: new Uint8Array(b64buf(R.t)),
    par: R.par, pos: R.pos, nb: R.par.length, eyes: R.eyes, eyeR: R.eyeR, clips: {} };
  for (const k in R.clips) {
    const c = R.clips[k], qs = new Int16Array(b64buf(c.q)), QC = new Float32Array(qs.length); for (let i = 0; i < qs.length; i++) QC[i] = qs[i] / 32767;
    let ox = 0, oz = 0, r0 = c.tb['0'];
    if (c.loop && r0) { let mx = 0, mz = 0; for (const r of r0) { mx += r[0]; mz += r[2]; } ox = R.pos[0][0] - mx / r0.length; oz = -mz / r0.length; }   // петля — по центру таза
    D.clips[k] = { nf: c.nf, dur: c.dur, loop: c.loop, QC, tb: c.tb, ox, oz, low: null };
  }
  for (const k in D.clips) D.clips[k].low = velLow(D, D.clips[k]);
  const dom = new Uint8Array(n); for (let i = 0; i < n; i++) { let bk = 0, bw = -1; for (let k = 0; k < 4; k++) if (D.SW[i * 4 + k] > bw) { bw = D.SW[i * 4 + k]; bk = D.SI[i * 4 + k]; } dom[i] = bk; }
  D.dom = dom; VL_D = D; return D;
}
function velTex() {
  if (VL_TEX) return VL_TEX;
  VL_TEX = new THREE.TextureLoader().load('data:image/jpeg;base64,' + VEL.tex);
  VL_TEX.flipY = false; VL_TEX.colorSpace = THREE.NoColorSpace; VL_TEX.anisotropy = 4; VL_TEX.wrapS = VL_TEX.wrapT = THREE.ClampToEdgeWrapping;
  return VL_TEX;
}
const velMats = new Map();
function velMat(emis) {
  const key = emis || 0; let m = velMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: velTex(), roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  velMats.set(key, m); return m;
}
function velociraptor(o) {
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = velData(), n = D.n, s = VL_S * (o.sK || 1), pal = o.pal, nb = D.nb, dom = D.dom;
  const mp = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mp[i * 3 + k] = D.P[i * 3 + k] - VL_OFF[k]; pos[i * 3 + k] = mp[i * 3 + k] * s * (k ? 1 : SK_X); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  // ---- раскраска: палитра (спина-бок-брюхо + узор), пасть и зубы — отдельно, когти тёмные; всё ×2 к карте деталей (0,5 = нейтрально)
  const up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = D.N[i * 3 + 1] * 0.8 + sstep(0.2, 1.2, mp[i * 3 + 1]) * 0.35 - 0.2; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), cm = hx(0xa8505a), ct = hx(0xeee6cc), cc = hx(0x241e19);
    for (let i = 0; i < n; i++) {
      const mo = D.M[i] / 255, te = D.T[i] / 255;
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (mo > 0.01) c.lerp(cm, mo);
      if (te > 0.01) c.lerp(ct, te);
      if (VL_CLAWS.has(dom[i])) c.lerp(cc, 0.8);
      c.multiplyScalar(2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  // ---- скелет: нулевые повороты покоя
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'vl' + i; bones.push(bn); rest.push(new V3((D.pos[i][0] - VL_OFF[0]) * s, (D.pos[i][1] - VL_OFF[1]) * s, (D.pos[i][2] - VL_OFF[2]) * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, velMat(o.emis));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('biped'); rig.frame.add(mesh);
  rig.spine = { root: bones[0], tail: [], neck: [], head: bones[6] };
  rig.jaw = bones[7]; rig.jawBase = 0;
  // ---- глаза и веки (как у остальных хищников)
  const head = bones[6], headO = rest[6], glow = !!o.glowEyes, kit = new Kit();
  const ex0 = D.eyes[0][0] - VL_OFF[0], ey0 = D.eyes[0][1] - VL_OFF[1], ez0 = Math.abs(D.eyes[0][2]), ER = Math.max(0.03, D.eyeR * 1.7) * s * (o.eyeK || 1), irisC = o.irisC || (glow ? 0xffd23a : 0xd9962a);
  const eyes = [], lids = [], skinSide = (MORPH && MORPH.c1 != null) ? MORPH.c1 : pal.side;
  const lidMat = new THREE.MeshStandardMaterial({ color: lidSkin(L, mp, n, [ex0, ey0, ez0], 0.5 * 0.85), roughness: 0.8 });
  for (const sd of [1, -1]) {
    const pe = new V3(ex0 * s, ey0 * s, sd * ez0 * s * 0.9), dir = new V3(0.3, 0.12, sd * 0.95).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone(), Fd = ER * 0.82, qE = (k) => [ER * k, ER * k, Fd * 0.8];
    kit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, Fd], qd), 0x1a100a);
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.2), qE(0.95), qd), mulHex(irisC, 0.5));
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.34), qE(0.86), qd), irisC);
    kit.add(head, headO, glow ? 'glow' : 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.46), [ER * 0.62, ER * 0.62, Fd * 0.8], qd), mixHex(irisC, 0xffe08a, 0.45));
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.62), [ER * 0.4, ER * 0.4, Fd * 0.74], qd), 0x020101);
    kit.add(head, headO, 'glow', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 1.2).addScaledVector(ey, ER * 0.34).addScaledVector(ex, ER * 0.26), [ER * 0.13, ER * 0.13, Fd * 0.1]), 0xfffaf0);
    const eg = new THREE.Group(); eg.position.copy(c0).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.03, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.08, LR * 1.04, Fd * 0.78); m.position.set(0, -sgn * LR, Fd * 0.2); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) }); eyes.push(pe);
  }
  // ---- шипы вдоль спины и хвоста: ищем верхние точки тела в позе стойки (кожа считается на ЦП), крепим к кости этой вершины в позе покоя
  if (o.spikes) {
    const ci = D.clips.idle, qs = new THREE.Quaternion(), restQ = bones.map(b => b.quaternion.clone());
    for (let i = 0; i < nb; i++) bones[i].quaternion.set(ci.QC[i * 4], ci.QC[i * 4 + 1], ci.QC[i * 4 + 2], ci.QC[i * 4 + 3]);
    mesh.updateMatrixWorld(true);
    const skm = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i])), pp = new Float32Array(n * 3), tv = new V3(), av = new V3();
    for (let i = 0; i < n; i++) { av.set(0, 0, 0); const r0 = new V3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); for (let k = 0; k < 4; k++) { const w = sw[i * 4 + k]; if (w > 0) av.addScaledVector(tv.copy(r0).applyMatrix4(skm[si[i * 4 + k]]), w); } pp[i * 3] = av.x; pp[i * 3 + 1] = av.y; pp[i * 3 + 2] = av.z; }
    for (let i = 0; i < nb; i++) bones[i].quaternion.copy(restQ[i]);
    mesh.updateMatrixWorld(true);
    const top = (x) => { let zc = 0, c = 0; for (let i = 0; i < n; i++) if (dom[i] < 107 && Math.abs(pp[i * 3] - x) < 0.16 * s) { zc += pp[i * 3 + 2]; c++; } if (!c) return -1; zc /= c;
      let m = -1e9, bi = -1; for (let i = 0; i < n; i++) if (dom[i] < 107 && Math.abs(pp[i * 3] - x) < 0.16 * s && Math.abs(pp[i * 3 + 2] - zc) < 0.1 * s && pp[i * 3 + 1] > m) { m = pp[i * 3 + 1]; bi = i; } return bi; };
    const x0 = 0.5 * s;
    for (let i = 0; i < o.spikes; i++) {
      const x = x0 - i * (1.9 / Math.max(1, o.spikes - 1)) * s, vi = top(x); if (vi < 0) continue;
      const len = (o.spikeLen || 0.14) * (1 - 0.35 * i / o.spikes) * s / 0.9, nrm = new V3(D.N[vi * 3], D.N[vi * 3 + 1], D.N[vi * 3 + 2]), p = new V3(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).addScaledVector(nrm, -0.012 * s);
      kit.add(bones[dom[vi]], rest[dom[vi]], o.spikeType || 'acc', UNIT.cone, M_spike(p, nrm.multiplyScalar(0.8).add(new V3(-0.3, 0.45, 0)).normalize(), len, len * 0.32), o.spikeC || 0xe8dcc0);
    }
  }
  kit.build({ emis: o.emis });
  { let topY = 0, topX = 1.2; for (let i = 0; i < n; i++) if (dom[i] >= 1 && dom[i] <= 62 && mp[i * 3 + 1] > topY) { topY = mp[i * 3 + 1]; topX = mp[i * 3]; }
    setHeadAnch(rig, head, new V3(topX * s, topY * s, 0).sub(headO), eyes[0].clone().sub(headO), new V3(rest[4].x, rest[4].y, 0)); }
  rig.walkAmp = 0.35; rig.gait = 'biped'; rig.k = 0.5;
  rig.tagH = 1.75 * s + 0.4;
  rig.vr = { s, lids, bones, rest, nb, st: null };
  return rig;
}
// ---------- анимация раптора: смесь клипов по скорости + укус ----------
const _vA = new THREE.Quaternion(), _vB = new THREE.Quaternion();
function velQ(c, f0, f1, fa, b, nb, out) {      // кватернион кости b из клипа в кадре f0..f1 (интерполяция), в out[0..3]
  const i0 = (f0 * nb + b) * 4, i1 = (f1 * nb + b) * 4, Q = c.QC;
  let bx = Q[i1], by = Q[i1 + 1], bz = Q[i1 + 2], bw = Q[i1 + 3];
  if (Q[i0] * bx + Q[i0 + 1] * by + Q[i0 + 2] * bz + Q[i0 + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  out[0] = Q[i0] + (bx - Q[i0]) * fa; out[1] = Q[i0 + 1] + (by - Q[i0 + 1]) * fa; out[2] = Q[i0 + 2] + (bz - Q[i0 + 2]) * fa; out[3] = Q[i0 + 3] + (bw - Q[i0 + 3]) * fa;
}
const _vo = [0, 0, 0, 0];
function animVel(dino, P, dt, speed, bite) {
  const T = P.vr, D = VL_D, nb = T.nb, bn = T.bones, s = T.s, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { pi: Math.random(), pw: Math.random(), pr: 0, v: 0, blink: 2 + Math.random() * 3, lift: null, look: Math.random() * 20 });
  const vc = Math.max(0, speed) * 6 / (sc * s);                  // скорость в единицах модели
  S.v += (vc - S.v) * Math.min(1, ddt * (vc < S.v ? 10 : 7));
  const moving = sstep(0.12, 0.6, S.v), rw = sstep(2.4, 4.6, S.v);
  const wi = 1 - moving, ww = moving * (1 - rw), wr = moving * rw;
  const cI = D.clips.idle, cW = D.clips.walk, cR = D.clips.run, cB = D.clips.bite;
  S.pi = (S.pi + ddt / cI.dur) % 1;
  const rW = Math.min(2.2, Math.max(0.6, S.v / VL_WALK_V)), rR = Math.min(1.7, Math.max(0.7, S.v / VL_RUN_V));
  if (ww > 0.001 || wr < 0.02) S.pw = (S.pw + ddt * rW / cW.dur) % 1;
  if (wr > 0.001 || ww < 0.02) S.pr = (S.pr + ddt * rR / cR.dur) % 1;
  if (wr < 0.02) S.pr = S.pw; else if (ww < 0.02) S.pw = S.pr;   // фазы шагов синхронны при смене походки
  // ---- укус: окно по прогрессу атаки (замах → выпад → возврат)
  const bp = bite > 0 ? 1 - bite : -1, wb = bp >= 0 ? sstep(0, 0.1, bp) * (1 - sstep(0.88, 1, bp)) : 0;
  const bf = bp < 0 ? 24 : bp < 0.3 ? 24 + 12 * bp / 0.3 : 36 + 18 * (bp - 0.3) / 0.7;
  const bf0 = Math.floor(bf), bfa = bf - bf0, bf1 = Math.min(bf0 + 1, cB.nf - 1);
  const fI = S.pi * cI.nf, fW = S.pw * cW.nf, fR = S.pr * cR.nf;
  const iI0 = Math.floor(fI) % cI.nf, iI1 = (iI0 + 1) % cI.nf, aI = fI - Math.floor(fI);
  const iW0 = Math.floor(fW) % cW.nf, iW1 = (iW0 + 1) % cW.nf, aW = fW - Math.floor(fW);
  const iR0 = Math.floor(fR) % cR.nf, iR1 = (iR0 + 1) % cR.nf, aR = fR - Math.floor(fR);
  // ---- кости: средневзвешенный кватернион клипов; укус перекрывает верх, на бегу ноги/хвост/руки остаются от бега
  for (let b = 0; b < nb; b++) {
    const gb = b >= 107 ? 0.25 : b >= 95 ? 0.5 : b >= 63 ? 0.4 : b === 0 ? 0.5 : 0;           // сколько укуса гасить на ходу
    const wB = wb * (1 - gb * moving), k = 1 - wB;
    let ax = 0, ay = 0, az = 0, aw = 0, ref = null;
    const add = (c, f0, f1, fa, w) => {
      if (w < 0.001) return; velQ(c, f0, f1, fa, b, nb, _vo);
      if (ref && ref[0] * _vo[0] + ref[1] * _vo[1] + ref[2] * _vo[2] + ref[3] * _vo[3] < 0) { _vo[0] = -_vo[0]; _vo[1] = -_vo[1]; _vo[2] = -_vo[2]; _vo[3] = -_vo[3]; }
      if (!ref) ref = [_vo[0], _vo[1], _vo[2], _vo[3]];
      ax += _vo[0] * w; ay += _vo[1] * w; az += _vo[2] * w; aw += _vo[3] * w;
    };
    add(cI, iI0, iI1, aI, wi * k); add(cW, iW0, iW1, aW, ww * k); add(cR, iR0, iR1, aR, wr * k); add(cB, bf0, bf1, bfa, wB);
    bn[b].quaternion.set(ax, ay, az, aw).normalize();
  }
  // ---- позиции: таз (из клипов), голова и плечо (из укуса)
  { const ps = (c, f0, f1, fa, b, ox, oz, out) => { const t = c.tb[b]; if (!t) return false; const p0 = t[f0], p1 = t[f1]; out[0] = p0[0] + (p1[0] - p0[0]) * fa + ox; out[1] = p0[1] + (p1[1] - p0[1]) * fa; out[2] = p0[2] + (p1[2] - p0[2]) * fa + oz; return true; };
    const r0 = D.pos[0], pk = [0, 0, 0], wB0 = wb * (1 - 0.5 * moving), kk = 1 - wB0; let x = 0, y = 0, z = 0;
    const acc = (c, f0, f1, fa, w, ox, oz) => { if (w < 0.001) return; if (ps(c, f0, f1, fa, 0, ox, oz, pk)) { x += pk[0] * w; y += pk[1] * w; z += pk[2] * w; } else { x += (r0[0] + ox) * w; y += r0[1] * w; z += (r0[2] + oz) * w; } };
    acc(cI, iI0, iI1, aI, wi * kk, 0, 0); acc(cW, iW0, iW1, aW, ww * kk, cW.ox, cW.oz); acc(cR, iR0, iR1, aR, wr * kk, cR.ox, cR.oz); acc(cB, bf0, bf1, bfa, wB0, 0, 0);
    bn[0].position.set((x - VL_OFF[0]) * s, (y - VL_OFF[1]) * s, (z - VL_OFF[2]) * s);
    for (const b of [6, 79]) { const rl = T.rest[b], pr = T.rest[D.par[b]]; if (wb > 0.001 && ps(cB, bf0, bf1, bfa, b, 0, 0, pk)) bn[b].position.set(rl.x - pr.x + (pk[0] * s - (rl.x - pr.x)) * wb, rl.y - pr.y + (pk[1] * s - (rl.y - pr.y)) * wb, rl.z - pr.z + (pk[2] * s - (rl.z - pr.z)) * wb); else bn[b].position.copy(rl).sub(pr); }
    // высота корпуса — по стопам
    const lo = (c, f0, f1, fa) => c.low[f0] + (c.low[f1] - c.low[f0]) * fa;
    const low = lo(cI, iI0, iI1, aI) * wi * kk + lo(cW, iW0, iW1, aW) * ww * kk + lo(cR, iR0, iR1, aR) * wr * kk + lo(cB, bf0, bf1, bfa) * wB0, tgt = (0.04 - low) * s;
    S.lift = S.lift == null ? tgt : S.lift + (tgt - S.lift) * Math.min(1, ddt * 14);
    P.frame.position.y = S.lift; }
  // ---- пасть открывается при укусе
  { const open = wb * (sstep(0.05, 0.3, bp) * (1 - sstep(0.36, 0.7, bp))) * 0.5; if (open > 0.002) { _vA.setFromAxisAngle(_vZ, -open); bn[7].quaternion.multiply(_vA); } }
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u);
    if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}
const _vZ = new V3(0, 0, 1), _vX = new V3(1, 0, 0);

// ======================================================================== ВРАГ: СТЕГОЗАВР (сетка из STL «Stegosaurus II», CC0; tools/steg_prep.py → tools/steg_bake.py → game/steg.js)
// 22,5 тыс. вершин, 22 кости: корпус, грудь, шея, голова, хвост (5), у каждой ноги бедро-голень-стопа. Модель без текстуры — раскраска вершинная:
// спина/бок/брюхо по палитре, пластины оранжевые, шипы хвоста — кость, когти тёмные; тени в складках из кривизны (ao).
// Своих глаз у модели нет, поэтому глаза игровые + моргающие веки. Ходьба — боковая последовательность шагов (лапа за лапой), частота шага
// привязана к скорости (опорная лапа не скользит), высота корпуса — по самой нижней стопе. Голова почти неподвижна (не качается).
const SG_DM = new Map();
const SG_S = 0.022, SG_FEET = ['HR', 'FR', 'HL', 'FL'];
function stegData(R) {
  let SG_D = SG_DM.get(R); if (SG_D) return SG_D;
  const v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const ao8 = new Uint8Array(b64buf(R.ao)), AO = new Float32Array(n); for (let i = 0; i < n; i++) AO[i] = ao8[i] / 127;
  SG_D = { n, P, AO, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), R: new Uint8Array(b64buf(R.r)), par: R.par, pos: R.pos, names: R.names, nb: R.par.length };
  SG_DM.set(R, SG_D);
  return SG_D;
}
const sgMats = new Map();
function sgMat(emis) {
  const key = emis || 0; let m = sgMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  sgMats.set(key, m); return m;
}
function stegosaurus(o) {
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = stegData(o.R || STEG), n = D.n, s = (o.S || SG_S) * (o.sK || 1), pal = o.pal, nb = D.nb, ix = (nm) => D.names.indexOf(nm);
  const pos = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) pos[i] = D.P[i] * s;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1)); geo.computeVertexNormals();
  const N = geo.attributes.normal.array, col = new Float32Array(n * 3);
  { const back = hx(pal.back), side = hx(pal.side), belly = hx(pal.belly), str = hx(pal.stripe), plA = hx(mixHex(pal.side, 0xc4501e, 0.7)), plB = hx(mixHex(pal.side, 0xf0a040, 0.62)), bone = hx(0xe6dcc0), claw = hx(0x2a2018), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = D.P[i * 3], y = D.P[i * 3 + 1], z = D.P[i * 3 + 2], reg = D.R[i], ao = D.AO[i];
      if (o.lz) {
        if (reg === 3) c.copy(claw);
        else if (reg === 1) c.copy(plA).lerp(plB, sstep(o.lz.sy0, o.lz.sy1, y)).multiplyScalar(0.9 + 0.2 * Math.sin(x * 0.55 + y * 0.35));
        else {
          const up = N[i * 3 + 1] * 0.8 + sstep(0.1 * o.lz.H, 0.95 * o.lz.H, y) * 0.35 - 0.2;
          if (up > 0.35) c.copy(back).lerp(side, 1 - sstep(0.35, 0.8, up)); else c.copy(side).lerp(belly, sstep(0.35, -0.25, up));
          const f = o.lz.spf, sp = sstep(o.lz.sp0, o.lz.sp1, vnoise(x * f, y * f, z * f)) * sstep(0.05, 0.6, up) * o.lz.spk, ba = o.lz.band ? sstep(0.55, 0.9, 0.5 + 0.5 * Math.sin(x * o.lz.band)) * sstep(0.1, 0.7, up) * 0.32 : 0;
          c.lerp(str, Math.max(sp, ba));
        }
      }
      else if (reg === 1) c.copy(plA).lerp(plB, sstep(58, 92, y)).multiplyScalar(0.9 + 0.2 * Math.sin(x * 0.9 + y * 0.35));
      else if (reg === 2) c.copy(bone).lerp(hx(0x8a7a5a), sstep(0, 1, 1 - y / 55) * 0.4);
      else if (reg === 3) c.copy(claw);
      else {
        const up = N[i * 3 + 1] * 0.8 + sstep(18, 62, y) * 0.35 - 0.2;
        if (up > 0.35) c.copy(back).lerp(side, 1 - sstep(0.35, 0.8, up)); else c.copy(side).lerp(belly, sstep(0.35, -0.25, up));
        const bnd = sstep(0.55, 0.9, 0.5 + 0.5 * Math.sin(x * 0.42)) * sstep(0.1, 0.7, up) * sstep(-45, -5, x) * 0.3; c.lerp(str, bnd);
      }
      c.multiplyScalar(ao); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'sg' + i; bones.push(bn); rest.push(new V3(D.pos[i][0] * s, D.pos[i][1] * s, D.pos[i][2] * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, sgMat(o.emis));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('quad'); rig.frame.add(mesh);
  const HEAD = ix('head'), NECK0 = ix('neck0'), head = bones[HEAD], headO = rest[HEAD];
  rig.spine = { root: bones[0], tail: [], neck: [], head };
  // ---- глаза игровые (у скана их нет) + веки
  const lids = [], eyeKit = new Kit(), lidMat = new THREE.MeshStandardMaterial({ color: hx(lidSide(pal)).multiplyScalar(0.55), roughness: 0.85 }), lidG = new THREE.SphereGeometry(1, 20, 12);
  const E0 = o.eye || [61.6, 25.6, 5.2], ER = (o.eyeR || 1.45) * s;
  for (const sd of [1, -1]) {
    const pe = new V3(E0[0] * s, E0[1] * s, sd * E0[2] * s), dir = new V3(0.3, 0.18, sd * 0.94).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone().addScaledVector(dir, -ER * (o.eyeIn || 0.6)), irisC = mulHex(o.irisC || 0xd8a030, 0.68);
    eyeKit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, ER * 0.9], qd), 0x0c0a08);
    const iris = c0.clone().addScaledVector(dir, ER * 0.5);
    eyeKit.add(head, headO, 'eye', eyeG(), M_ell(iris, [ER * 0.78, ER * 0.78, ER * 0.55], qd), irisC);
    eyeKit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.5), [ER * 0.26, ER * 0.68, ER * 0.14], qd), 0x050403);
    eyeKit.add(head, headO, 'glow', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.58).addScaledVector(ey, ER * 0.3).addScaledVector(ex, ER * 0.25), [ER * 0.11, ER * 0.11, ER * 0.08]), 0xfffaf0);
    const LR = ER * 1.15, Fd = LR * 0.75, eg = new THREE.Group(); eg.position.copy(pe).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const mkLid = sgn => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR, LR, Fd * 0.65); m.position.set(0, -sgn * LR, Fd * 0.1); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) });
  }
  eyeKit.build({ emis: o.emis });
  const HT = o.headTop || [60, 30];
  setHeadAnch(rig, head, new V3(HT[0] * s, HT[1] * s, 0).sub(headO), new V3(E0[0] * s, E0[1] * s, E0[2] * s).sub(headO), new V3(rest[NECK0].x, rest[NECK0].y, 0));
  rig.anch.crownK = 0.6;
  rig.walkAmp = 0.3; rig.gait = 'quad'; rig.k = 0.9; rig.tagH = (o.tagH || 92) * s + 0.4;
  const legNames = SG_FEET; const legs = SG_FEET.map(k => { const th = ix('th' + k), sh = ix('sh' + k), ft = ix('ft' + k); return { th, sh, ft, ph: { HR: 0, FR: 0.25, HL: 0.5, FL: 0.75 }[k], hip: rest[th], kn: rest[sh].clone().sub(rest[th]), an: rest[ft].clone().sub(rest[sh]) }; });
  rig.stg = { s, bones, rest, nb, lids, legs, legNames, tail: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'].map(ix), neck0: NECK0, neck1: ix('neck1'), chest: ix('chest'), head: HEAD, st: null, lz: o.lz ? { r: o.lz.r || 1, duty: o.lz.duty || 0.55, swing: o.lz.swing || 0.5, lift: o.lz.lift || 0.5, fmax: o.lz.fmax || 4.5 } : null };
  return rig;
}
const _sgE = new THREE.Euler(0, 0, 0, 'YXZ');
function animStego(dino, P, dt, speed, bite) {
  if (P.stg.lz) { animLiz(dino, P, dt, speed, bite); return; }
  const T = P.stg, bn = T.bones, s = T.s, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { ph: Math.random(), tp: Math.random() * 6, v: 0, lift: null, blink: 2 + Math.random() * 3, w: 0 });
  const vc = Math.max(0, speed) * 6 / (sc * s);                            // скорость в единицах модели
  S.v += (vc - S.v) * Math.min(1, ddt * (vc < S.v ? 10 : 6));
  const mv = sstep(2, 14, S.v), LEGL = 43.5;
  const A = Math.min(0.78, 0.34 + S.v * 0.002), fr = Math.min(3.0, 0.25 * S.v / (LEGL * Math.sin(Math.max(0.05, A * Math.max(mv, 0.3)))));     // размах бедра и частота шага: ход опорной ноги = скорость земли
  S.ph += ddt * fr; S.tp += ddt * (0.5 + 0.55 * mv);
  for (let i = 0; i < T.nb; i++) bn[i].quaternion.set(0, 0, 0, 1);
  const setZ = (b, a) => { bn[b].quaternion.setFromAxisAngle(_vZ, a); };
  const setE = (b, yaw, pitch) => { _sgE.set(0, yaw, pitch); bn[b].quaternion.setFromEuler(_sgE); };
  // ---- ноги: бедро, голень, стопа в плоскости шага; низшая точка стопы задаёт высоту корпуса
  const SOLE = new V3(2.5 * s, -8.6 * s, 0), cs = (a) => Math.cos(a), sn = (a) => Math.sin(a);
  let low = 1e9;
  for (const L of T.legs) {
    const u = (((S.ph + L.ph) % 1) + 1) % 1, st = u < 0.5, x = st ? 1 - 4 * u : -1 + 2 * sstep(0, 1, (u - 0.5) / 0.5);
    const sw = st ? 0 : Math.sin(Math.PI * (u - 0.5) / 0.5);
    const th = A * x * mv, kn = -0.5 * sw * mv - 0.06 * mv * (st ? 0.0 : 1), ft = -(th + kn) * 0.9 + 0.12 * sw * mv;
    setZ(L.th, th); setZ(L.sh, kn); setZ(L.ft, ft);
    // стопа: 2D-FK в плоскости x-y (повороты вокруг z; корпус не наклоняется)
    const kx = L.hip.x + L.kn.x * cs(th) - L.kn.y * sn(th), ky = L.hip.y + L.kn.x * sn(th) + L.kn.y * cs(th), a2 = th + kn;
    const ax = kx + L.an.x * cs(a2) - L.an.y * sn(a2), ay = ky + L.an.x * sn(a2) + L.an.y * cs(a2), a3 = a2 + ft;
    const sy = ay + SOLE.x * sn(a3) + SOLE.y * cs(a3);
    low = Math.min(low, sy);
  }
  const tgt = (0.4 * s - low);
  S.lift = S.lift == null ? tgt : S.lift + (tgt - S.lift) * Math.min(1, ddt * 14);
  // ---- атака (укус/удар): голова вперёд-вниз, хвост хлещет в сторону; рывок корпуса совсем маленький и строго вперёд
  const bc = biteCurve(bite || 0), pull = bc ? bc.pull : 0, lunge = bc ? bc.lunge : 0;
  P.frame.position.set(0, S.lift, lunge * 0.05);
  // ---- хвост: волна от шага (в покое — медленное покачивание)
  const tl = T.tail, nt = tl.length, amp = 0.05 + 0.07 * mv, whip = bc ? Math.sin(Math.PI * Math.min(1, bc.p * 1.6)) * 0.55 : 0;
  for (let i = 0; i < nt; i++) { const u = i / (nt - 1); setE(tl[i], amp * (0.45 + 0.9 * u) * Math.sin(S.ph * 3.1416 * (mv > 0.1 ? 1 : 0) + S.tp * (mv > 0.1 ? 0 : 1.1) - u * 2.2) + whip * (0.25 + 0.2 * u), 0.012 * Math.sin(S.tp * 0.8 - u)); }
  // ---- шея и голова: стоят (голова не качается), дыхание и бросок при атаке
  const br = 0.012 * Math.sin(S.tp * 1.7);
  setZ(T.neck0, br + 0.12 * pull - 0.05 * lunge); setZ(T.neck1, -0.1 * pull - 0.22 * lunge + 0.5 * br);
  setZ(T.chest, 0.006 * Math.sin(S.tp * 1.7));
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u); if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}

// ---- ящеры/звероящеры из STL (комодо, диметродон, горгонопсид): ноги раскинуты — бедро качается вокруг вертикали (шаг), подъём стопы — поворотом вокруг продольной оси;
// диагональная рысь (ЛП+ПЗ, ПП+ЛЗ), опорная стопа едет назад со скоростью земли (частота шага из скорости), голова неподвижна, хвост — волна.
const _lzq = new THREE.Quaternion(), _lzq2 = new THREE.Quaternion(), _lzX = new V3(1, 0, 0), _lzY = new V3(0, 1, 0), _lzv = new V3();
function animLiz(dino, P, dt, speed, bite) {
  const T = P.stg, bn = T.bones, s = T.s, Z = T.lz, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { ph: Math.random(), tp: Math.random() * 6, v: 0, lift: null, blink: 2 + Math.random() * 3, w: 0 });
  const vc = Math.max(0, speed) * 6 / (sc * s);                            // скорость в единицах модели
  S.v += (vc - S.v) * Math.min(1, ddt * (vc < S.v ? 10 : 6));
  const mv = sstep(2, 12, S.v), duty = Z.duty, ramp = 0.5 + 0.5 * Math.min(1, S.v / 60);
  let rr = 0; for (const L of T.legs) rr += Math.abs(L.kn.z + L.an.z); rr = rr / T.legs.length * Z.r / s;
  const bh = rr * Math.sin(Z.swing * ramp * Math.max(mv, 0.3));         // половина хода опорной ступни (ед. модели)
  const fr = Math.min(Z.fmax, S.v * duty / (2 * Math.max(bh, 0.5)));      // опорная ступня едет назад со скоростью земли (частота шага из скорости)
  S.ph += ddt * fr; S.tp += ddt * (0.5 + 0.55 * mv);
  for (let i = 0; i < T.nb; i++) bn[i].quaternion.set(0, 0, 0, 1);
  const PH = { FR: 0, HL: 0, FL: 0.5, HR: 0.5 };
  let low = 1e9;
  for (const L of T.legs) {
    const nm = D_NAME(T, L), sg = L.hip.z < 0 ? 1 : -1;
    const u = (((S.ph + PH[nm]) % 1) + 1) % 1, st = u < duty, x = st ? 1 - 2 * u / duty : -1 + 2 * sstep(0, 1, (u - duty) / (1 - duty));
    const sw = st ? 0 : Math.sin(Math.PI * (u - duty) / (1 - duty));
    const rl = Math.abs(L.kn.z + L.an.z) * Z.r / s, Ai = Math.asin(Math.min(0.7, bh / Math.max(rl, 1e-3))), yaw = Ai * x * mv * (L.hip.z > 0 ? 1 : -1), roll = sg * (Z.lift * sw * mv);
    _lzq.setFromAxisAngle(_lzY, yaw); _lzq2.setFromAxisAngle(_lzX, roll); bn[L.th].quaternion.copy(_lzq).multiply(_lzq2);
    _lzq.setFromAxisAngle(_lzX, sg * 0.35 * sw * mv); bn[L.sh].quaternion.copy(_lzq);
    _lzv.copy(L.kn).add(L.an).applyQuaternion(bn[L.th].quaternion);                  // стопа относительно бедра (голень без поворота)
    low = Math.min(low, L.hip.y + _lzv.y - T.rest[L.ft].y);
  }
  const tgt = -low; S.lift = S.lift == null ? tgt : S.lift + (tgt - S.lift) * Math.min(1, ddt * 14);
  const bc = biteCurve(bite || 0), pull = bc ? bc.pull : 0, lunge = bc ? bc.lunge : 0;
  P.frame.position.set(0, S.lift, lunge * 0.05);
  const tl = T.tail, nt = tl.length, amp = 0.03 + 0.14 * mv, whip = bc ? Math.sin(Math.PI * Math.min(1, bc.p * 1.6)) * 0.55 : 0;
  for (let i = 0; i < nt; i++) { const u = i / (nt - 1); _sgE.set(0, amp * (0.5 + 0.9 * u) * Math.sin(S.ph * 6.2832 * (mv > 0.1 ? 1 : 0) + S.tp * (mv > 0.1 ? 0 : 1.1) - u * 2.2) + whip * (0.25 + 0.2 * u), 0.012 * Math.sin(S.tp * 0.8 - u)); bn[tl[i]].quaternion.setFromEuler(_sgE); }
  const br = 0.012 * Math.sin(S.tp * 1.7);
  _lzq.setFromAxisAngle(_vZ, br + 0.12 * pull - 0.05 * lunge); bn[T.neck0].quaternion.copy(_lzq);
  _lzq.setFromAxisAngle(_vZ, -0.1 * pull - 0.22 * lunge + 0.5 * br); bn[T.neck1].quaternion.copy(_lzq);
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u); if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  const droop = 0.07 * (1 - 0.6 * mv);
  for (const l of T.lids) { const ty = 0.02 + droop + bl * (1.0 - droop); l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.72; l.tp.visible = bl > 0.04; l.bp.visible = bl > 0.15; }
}
function D_NAME(T, L) { return T.legNames[T.legs.indexOf(L)]; }

// ======================================================================== ВРАГИ ИЗ JURASSIC PARK: THE GAME (GLB со скелетом; tools/jp_bake.py → game/comp.js, troo.js, herr.js)
// Общий рантайм для компсогната, троодона и геррерозавра (враги). Клипы: стойка + лестница походок l0…lN (от медленной к быстрой) — соседние по скорости
// смешиваются, частота шага = скорость / скорость клипа (ступни не скользят), высота корпуса по стопам (FK, без проваливания). Свои глаза модели сохранены
// (радужка и зрачок в листе деталей), поверх — моргающие веки. Окраска: палитра (спина-бок-брюхо + узор) × карта деталей атласа.
const JP_D = new Map(), JP_T = new Map(), JP_M = new Map();
function jpLow(D, c) {
  const nb = D.nb, out = new Float32Array(c.nf), q = new THREE.Quaternion(), loc = new V3();
  const W = Array.from({ length: nb }, () => new V3()), Rq = Array.from({ length: nb }, () => new THREE.Quaternion());
  for (let f = 0; f < c.nf; f++) {
    const done = new Uint8Array(nb);
    const calc = (b) => {
      if (done[b]) return; done[b] = 1; const p = D.par[b], i = (f * nb + b) * 4, t = c.tb[b];
      if (p >= 0) calc(p);                                           // родитель — до того, как q переписывается кватернионом этой кости
      q.set(c.QC[i], c.QC[i + 1], c.QC[i + 2], c.QC[i + 3]);
      if (p < 0) { if (t) W[b].set(t[f][0], t[f][1], t[f][2]); else W[b].set(D.pos[b][0], D.pos[b][1], D.pos[b][2]); Rq[b].copy(q); }
      else { if (t) loc.set(t[f][0], t[f][1], t[f][2]); else loc.set(D.pos[b][0] - D.pos[p][0], D.pos[b][1] - D.pos[p][1], D.pos[b][2] - D.pos[p][2]); W[b].copy(loc).applyQuaternion(Rq[p]).add(W[p]); Rq[b].copy(Rq[p]).multiply(q); }
    };
    let low = 1e9; for (const tp of D.tips) { calc(tp); low = Math.min(low, W[tp].y); } out[f] = low;
  }
  return out;
}
function jpData(R) {
  let D = JP_D.get(R); if (D) return D;
  const v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), M: new Uint8Array(b64buf(R.m)), E: new Uint8Array(b64buf(R.e)), K: new Uint8Array(b64buf(R.k)), VC: R.vc ? new Uint8Array(b64buf(R.vc)) : null, VM: R.vm ? new Uint8Array(b64buf(R.vm)) : null,
    par: R.par, pos: R.pos, nb: R.par.length, tips: R.tips, neck: R.neck, head: R.head, jaw: R.jaw, eyes: R.eyes, eyeR: R.eyeR, height: R.height, clips: {}, loco: [] };
  for (const k in R.clips) {
    const c = R.clips[k], qs = new Int16Array(b64buf(c.q)), QC = new Float32Array(qs.length); for (let i = 0; i < qs.length; i++) QC[i] = qs[i] / 32767;
    let ox = 0, oz = 0, r0 = c.tb['0'];
    if (c.loop && r0) { let mx = 0, mz = 0; for (const r of r0) { mx += r[0]; mz += r[2]; } ox = R.pos[0][0] - mx / r0.length; oz = -mz / r0.length; }   // петля — по центру таза
    D.clips[k] = { nf: c.nf, dur: c.dur, loop: c.loop, v: c.v, QC, tb: c.tb, ox, oz, low: null };
  }
  for (const k in D.clips) D.clips[k].low = jpLow(D, D.clips[k]);
  D.loco = Object.keys(D.clips).filter(k => k[0] === 'l').sort((a, b) => D.clips[a].v - D.clips[b].v).map(k => D.clips[k]);
  const dom = new Uint8Array(n); for (let i = 0; i < n; i++) { let bk = 0, bw = -1; for (let k = 0; k < 4; k++) if (D.SW[i * 4 + k] > bw) { bw = D.SW[i * 4 + k]; bk = D.SI[i * 4 + k]; } dom[i] = bk; }
  D.dom = dom; JP_D.set(R, D); return D;
}
function jpMat(R, emis) {
  let T = R.tex ? JP_T.get(R) : null;
  if (R.tex && !T) { T = new THREE.TextureLoader().load('data:image/jpeg;base64,' + R.tex); T.flipY = false; T.colorSpace = THREE.NoColorSpace; T.anisotropy = 4; T.wrapS = T.wrapT = THREE.ClampToEdgeWrapping; JP_T.set(R, T); }
  const key = emis || 0; let mm = JP_M.get(R); if (!mm) JP_M.set(R, mm = new Map());
  let m = mm.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: T || null, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  mm.set(key, m); return m;
}
function jpModel(R, o) {
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = jpData(R), n = D.n, nb = D.nb, s = (o.H || 1.2) / D.height * (o.sK || 1), pal = o.pal, dom = D.dom, H = D.height;
  const mp = D.P, pos = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) pos[i] = mp[i] * s;
  for (let i = 0; i < n; i++) if (D.E[i]) {            // родные глаза модели убираем (вдавливаем в голову): ставим свои
    const e = D.eyes[mp[i * 3 + 2] * D.eyes[0][2] >= 0 ? 0 : 1], k = 0.62;
    for (let a = 0; a < 3; a++) pos[i * 3 + a] = (e[a] + (mp[i * 3 + a] - e[a]) * 0.0) * s; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  const up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = D.N[i * 3 + 1] * 0.8 + sstep(0.07 * H, 0.9 * H, mp[i * 3 + 1]) * 0.35 - 0.2; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), cm = hx(0x8a3a44), cd = hx(o.dark || 0x2a2420), mk = o.mouthK != null ? o.mouthK : 1, tn = o.tint || [1, 1, 1];
    for (let i = 0; i < n; i++) {
      if (D.VC && !D.E[i] && (!D.VM || D.VM[i])) { col[i * 3] = Math.min(1, D.VC[i * 3] / 255 * tn[0]); col[i * 3 + 1] = Math.min(1, D.VC[i * 3 + 1] / 255 * tn[1]); col[i * 3 + 2] = Math.min(1, D.VC[i * 3 + 2] / 255 * tn[2]); continue; }      // модель без текстуры: цвет в вершинах (линейный, как в листе)
      if (D.E[i] || R.raw) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1; continue; }        // глаза (и вся модель при raw — оригинальная текстура): цвета из листа (радужка/зрачок) без раскраски
      if (D.K[i]) c.copy(cd); else { const mo = D.M[i] / 255; c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); if (mo > 0.01) c.lerp(cm, mo * mk); }
      c.multiplyScalar(2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'jp' + i; bones.push(bn); rest.push(new V3(D.pos[i][0] * s, D.pos[i][1] * s, D.pos[i][2] * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, jpMat(R, o.emis));
  if (o.tilt) mesh.position.copy(rest[0]).negate();            // летун: корпус наклоняется вокруг корня (клип снят с торчащим вверх корпусом)
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('biped'); if (o.tilt) { const pg = new THREE.Group(); pg.rotation.z = o.tilt; pg.add(mesh); rig.frame.add(pg); rig.pitchG = pg; } else rig.frame.add(mesh);
  rig.spine = { root: bones[0], tail: [], neck: [], head: bones[D.head] };
  rig.jaw = bones[D.jaw]; rig.jawBase = 0;
  // ---- веки поверх родных глаз модели
  const head = bones[D.head], headO = rest[D.head], lids = [], eyeKit = new Kit();
  const lidMat = new THREE.MeshStandardMaterial({ color: (R.raw || R.lid || !L) ? hx(lidSide(pal)).multiplyScalar(0.88) : lidSkin(L, mp, n, D.eyes[0], 0.5 * 0.9), roughness: 0.85 }), lidG = new THREE.SphereGeometry(1, 20, 12);
  if (R.lid) lidMat.color.setRGB(R.lid[0][0] * (o.tint ? o.tint[0] : 1), R.lid[0][1] * (o.tint ? o.tint[1] : 1), R.lid[0][2] * (o.tint ? o.tint[2] : 1)).multiplyScalar(o.lidK || 1);       // raw-модели: цвет век — из их текстуры
  for (let k = 0; k < (R.nativeEyes ? 0 : 2); k++) {      // nativeEyes: свои глаза и веки модели (веки — кости, моргают по клипам)
    const sd = k === 0 ? 1 : -1, ER = D.eyeR[k] * s * (o.eyeK || 1), c = D.eyes[k], pe = new V3(c[0] * s, c[1] * s, c[2] * s), ed = o.eyeDir || [0.25, 0.1];
    const dir = new V3(ed[0], ed[1], sd * Math.sqrt(Math.max(0.05, 1 - ed[0] * ed[0] - ed[1] * ed[1]))).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const eg = new THREE.Group(); eg.position.copy(pe).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    { const c0 = pe.clone().addScaledVector(dir, -ER * (o.eyeIn != null ? o.eyeIn : 0.75)), irisC = mulHex(o.irisC || 0xd8a030, 0.75), slit = o.slit != null ? o.slit : 0.3;
      eyeKit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, ER * 0.92], qd), 0x0c0a08);
      const iris = c0.clone().addScaledVector(dir, ER * 0.5);
      eyeKit.add(head, headO, 'eye', eyeG(), M_ell(iris, [ER * 0.8, ER * 0.8, ER * 0.55], qd), irisC);
      eyeKit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.5), [ER * slit, ER * (slit < 0.5 ? 0.7 : slit), ER * 0.14], qd), 0x050403);
      eyeKit.add(head, headO, 'glow', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.58).addScaledVector(ey, ER * 0.3).addScaledVector(ex, ER * 0.25), [ER * 0.11, ER * 0.11, ER * 0.08]), 0xfffaf0); }
    const LR = ER * 1.06, Fd = LR * 0.3;
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.12, LR * 1.08, Fd * 0.75); m.position.set(0, -sgn * LR, Fd * 0.05); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) });
  }
  if (R.lure) { const lb = bones[R.lure.bone], lo = rest[R.lure.bone], lp = R.lure.pos, lr = R.lure.r * s;       // светящаяся лампа удильщика на конце удочки (кость качается вместе с удочкой)
    eyeKit.add(lb, lo, 'glow', UNIT.sph, M_ell(new V3(lp[0] * s, lp[1] * s, lp[2] * s), [lr * 1.12, lr * 1.12, lr * 1.12]), o.lureC || 0x9af4ff); }
  eyeKit.build({ emis: o.emis });
  { let topY = -1e9, topX = 0; const e0 = D.eyes[0], ex = e0[0], ey = e0[1];
    for (let i = 0; i < n; i++) if (Math.abs(mp[i * 3 + 2]) < 0.04 * H && mp[i * 3] > ex - 0.05 * H && mp[i * 3] < ex + 0.07 * H && mp[i * 3 + 1] > ey - 0.02 * H && mp[i * 3 + 1] > topY) { topY = mp[i * 3 + 1]; topX = mp[i * 3]; }       // макушка над глазами, по оси головы
    if (topY < -1e8) { topY = ey + 0.04 * H; topX = ex; }
    const e0b = e0, nk = rest[D.neck[0] != null ? D.neck[0] : D.head];
    setHeadAnch(rig, head, new V3(topX * s, topY * s, 0).sub(headO), new V3(e0[0] * s, e0[1] * s, Math.abs(e0[2]) * s).sub(headO), new V3(nk.x, nk.y, 0)); }
  rig.anch.crownK = o.crownK || 0.62;
  rig.walkAmp = 0.35; rig.gait = 'biped'; rig.k = 0.5; rig.tagH = o.tagH || H * s + 0.3;
  rig.jp = { R, s, lids, bones, rest, nb, st: null, jawK: o.jawK || 0.5, foot: o.foot || 0.012 * H, dip: o.dip || 1, fly: !!o.fly, fy: o.fy || 0 };
  return rig;
}
function animJP(dino, P, dt, speed, bite) {
  const T = P.jp, D = jpData(T.R), nb = T.nb, bn = T.bones, s = T.s, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1, LC = D.loco, nl = LC.length;
  const S = T.st || (T.st = { pi: Math.random(), ph: LC.map(() => Math.random()), v: 0, blink: 2 + Math.random() * 3, lift: null });
  const vc = Math.max(0, speed) * 6 / (sc * s);                  // скорость в единицах модели
  S.v += (vc - S.v) * Math.min(1, ddt * (vc < S.v ? 10 : 6));
  const v0 = nl ? LC[0].v : 1e9, moving = sstep(0.1 * v0, 0.55 * v0, S.v);
  const bc = biteCurve(bite || 0), pull = bc ? bc.pull : 0, lunge = bc ? bc.lunge : 0, open = bc ? bc.open : 0;
  // ---- лестница походок: две соседние по скорости; вес и скорость воспроизведения
  const wl = LC.map(() => 0), rate = LC.map(() => 1);
  let a = 0; while (a < nl - 1 && S.v > LC[a + 1].v) a++;
  if (a < nl - 1) { const lo = LC[a].v * 1.1, hi = LC[a + 1].v * 0.9, t = hi > lo ? sstep(lo, hi, S.v) : (S.v > (LC[a].v + LC[a + 1].v) / 2 ? 1 : 0); wl[a] = 1 - t; wl[a + 1] = t; } else wl[a] = 1;
  for (let k = 0; k < nl; k++) rate[k] = Math.min(k === 0 ? 2.2 : k === nl - 1 ? 1.9 : 1.5, Math.max(k === 0 ? 0.3 : 0.6, S.v / LC[k].v));
  let dm = 0; for (let k = 1; k < nl; k++) if (wl[k] > wl[dm]) dm = k;
  for (let k = 0; k < nl; k++) if (wl[k] > 0.001 && (k === dm || wl[k] >= 0.02)) S.ph[k] = (S.ph[k] + ddt * rate[k] / LC[k].dur) % 1;
  for (let k = 0; k < nl; k++) if (wl[k] < 0.02) S.ph[k] = S.ph[dm];                  // фазы шагов синхронны при смене походки
  const cI = D.clips.idle; S.pi = (S.pi + ddt / cI.dur) % 1;
  const fI = S.pi * cI.nf, iI0 = Math.floor(fI) % cI.nf, iI1 = (iI0 + 1) % cI.nf, aI = fI - Math.floor(fI), wi = 1 - moving;
  const fr = LC.map((c, k) => { const f = S.ph[k] * c.nf, f0 = Math.floor(f) % c.nf; return [f0, (f0 + 1) % c.nf, f - Math.floor(f)]; });
  for (let b = 0; b < nb; b++) {
    let ax = 0, ay = 0, az = 0, aw = 0, ref = null;
    const add = (c, f0, f1, fa, w) => {
      if (w < 0.001) return; velQ(c, f0, f1, fa, b, nb, _vo);
      if (ref && ref[0] * _vo[0] + ref[1] * _vo[1] + ref[2] * _vo[2] + ref[3] * _vo[3] < 0) { _vo[0] = -_vo[0]; _vo[1] = -_vo[1]; _vo[2] = -_vo[2]; _vo[3] = -_vo[3]; }
      if (!ref) ref = [_vo[0], _vo[1], _vo[2], _vo[3]];
      ax += _vo[0] * w; ay += _vo[1] * w; az += _vo[2] * w; aw += _vo[3] * w;
    };
    add(cI, iI0, iI1, aI, wi); for (let k = 0; k < nl; k++) add(LC[k], fr[k][0], fr[k][1], fr[k][2], moving * wl[k]);
    bn[b].quaternion.set(ax, ay, az, aw).normalize();
  }
  if (T.R.still) for (const b of T.R.still) bn[b].quaternion.set(0, 0, 0, 1);      // веки родной модели не двигаем: не моргает
  // ---- позиция таза из клипов; высота корпуса — по стопам смешанной позы (FK по текущим кватернионам костей)
  { const ps = (c, f0, f1, fa, ox, oz, out) => { const t = c.tb[0]; if (!t) return false; const p0 = t[f0], p1 = t[f1]; out[0] = p0[0] + (p1[0] - p0[0]) * fa + ox; out[1] = p0[1] + (p1[1] - p0[1]) * fa; out[2] = p0[2] + (p1[2] - p0[2]) * fa + oz; return true; };
    const r0 = D.pos[0], pk = [0, 0, 0]; let x = 0, y = 0, z = 0;
    const acc = (c, f0, f1, fa, w, ox, oz) => { if (w < 0.001) return; if (ps(c, f0, f1, fa, ox, oz, pk)) { x += pk[0] * w; y += pk[1] * w; z += pk[2] * w; } else { x += (r0[0] + ox) * w; y += r0[1] * w; z += (r0[2] + oz) * w; } };
    acc(cI, iI0, iI1, aI, wi, 0, 0); for (let k = 0; k < nl; k++) acc(LC[k], fr[k][0], fr[k][1], fr[k][2], moving * wl[k], LC[k].ox, LC[k].oz);
    bn[0].position.set(x * s, y * s, z * s);
    const W = T.fkW || (T.fkW = Array.from({ length: nb }, () => new V3())), Rq = T.fkR || (T.fkR = Array.from({ length: nb }, () => new THREE.Quaternion())), dn = T.fkD || (T.fkD = new Uint8Array(nb)), tv = T.fkT || (T.fkT = new V3());
    dn.fill(0);
    const calc = (b) => { if (dn[b]) return; dn[b] = 1; const p = D.par[b];
      if (p < 0) { W[b].copy(bn[b].position); Rq[b].copy(bn[b].quaternion); return; }
      calc(p); tv.copy(T.rest[b]).sub(T.rest[p]).applyQuaternion(Rq[p]); W[b].copy(tv).add(W[p]); Rq[b].copy(Rq[p]).multiply(bn[b].quaternion); };
    let low = 1e9; if (!T.fly) for (const tp of D.tips) { calc(tp); low = Math.min(low, W[tp].y); }
    const tgt = T.foot * s - low;
    S.lift = S.lift == null ? tgt : S.lift + (tgt - S.lift) * Math.min(1, ddt * 18);
    P.frame.position.set(0, T.fly ? T.fy : S.lift, lunge * 0.05); }      // укус: рывок вперёд совсем небольшой, строго по ходу (frame повёрнут: перёд = +z)
  // ---- укус: замах шеей назад-вверх, короткий кивок вниз, пасть открывается
  { const dip = (-lunge * 0.07 + pull * 0.035) * T.dip, hd = (-lunge * 0.09 + pull * 0.05) * T.dip;
    for (const b of D.neck) { _pA.setFromAxisAngle(_vZ, dip); bn[b].quaternion.multiply(_pA); }
    _pA.setFromAxisAngle(_vZ, hd); bn[D.head].quaternion.multiply(_pA);
    const jo = open * T.jawK; if (jo > 0.002) { _pA.setFromAxisAngle(_vZ, -jo); bn[D.jaw].quaternion.multiply(_pA); } }
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u);
    if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}

// ======================================================================== ИГРОК «ТРАВОЯДНЫЙ»: Parasaurolophus (Jurassic Park: The Game, GLB со скелетом, tools/para_bake.py → game/para.js)
// 5,9 тыс. вершин, 137 костей; клипы: стойка, шаг, бег, щипание травы — смешиваются по скорости (ступни не скользят: шаг по реальной скорости),
// высота корпуса считается по стопам. Свои глаза модели (радужка + зрачок) сохранены, поверх — моргающие веки. Бодание — небольшой кивок шеей, рёв — голову вверх.
let PA_D = null, PA_TEX = null;
const PA_TIPS = [20, 22, 24, 33, 35, 37], PA_NECK = [40, 41, 42, 43], PA_HEAD = 44, PA_JAW = 57, PA_TAIL = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const PA_S = 0.85, PA_OFF = [0, 0, 0], PA_WALK_V = 1.15, PA_RUN_V = 6.1;
function paraLow(D, c) {
  const nb = D.nb, out = new Float32Array(c.nf), q = new THREE.Quaternion(), loc = new V3();
  const W = Array.from({ length: nb }, () => new V3()), Rq = Array.from({ length: nb }, () => new THREE.Quaternion());
  for (let f = 0; f < c.nf; f++) {
    const done = new Uint8Array(nb);
    const calc = (b) => {
      if (done[b]) return; done[b] = 1; const p = D.par[b], i = (f * nb + b) * 4, t = c.tb[b];
      if (p >= 0) calc(p);                                           // родитель — до того, как q переписывается кватернионом этой кости
      q.set(c.QC[i], c.QC[i + 1], c.QC[i + 2], c.QC[i + 3]);
      if (p < 0) { if (t) W[b].set(t[f][0], t[f][1], t[f][2]); else W[b].set(D.pos[b][0], D.pos[b][1], D.pos[b][2]); Rq[b].copy(q); }
      else { if (t) loc.set(t[f][0], t[f][1], t[f][2]); else loc.set(D.pos[b][0] - D.pos[p][0], D.pos[b][1] - D.pos[p][1], D.pos[b][2] - D.pos[p][2]); W[b].copy(loc).applyQuaternion(Rq[p]).add(W[p]); Rq[b].copy(Rq[p]).multiply(q); }
    };
    let low = 1e9; for (const tp of PA_TIPS) { calc(tp); low = Math.min(low, W[tp].y); } out[f] = low;
  }
  return out;
}
function paraData() {
  if (PA_D) return PA_D;
  const R = PARA, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  const D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), M: new Uint8Array(b64buf(R.m)), E: new Uint8Array(b64buf(R.e)),
    par: R.par, pos: R.pos, nb: R.par.length, eyes: R.eyes, eyeR: R.eyeR, clips: {} };
  for (const k in R.clips) {
    const c = R.clips[k], qs = new Int16Array(b64buf(c.q)), QC = new Float32Array(qs.length); for (let i = 0; i < qs.length; i++) QC[i] = qs[i] / 32767;
    let ox = 0, oz = 0, r0 = c.tb['0'];
    if (c.loop && r0) { let mx = 0, mz = 0; for (const r of r0) { mx += r[0]; mz += r[2]; } ox = R.pos[0][0] - mx / r0.length; oz = -mz / r0.length; }   // петля — по центру таза
    D.clips[k] = { nf: c.nf, dur: c.dur, loop: c.loop, QC, tb: c.tb, ox, oz, low: null };
  }
  for (const k in D.clips) D.clips[k].low = paraLow(D, D.clips[k]);
  const dom = new Uint8Array(n); for (let i = 0; i < n; i++) { let bk = 0, bw = -1; for (let k = 0; k < 4; k++) if (D.SW[i * 4 + k] > bw) { bw = D.SW[i * 4 + k]; bk = D.SI[i * 4 + k]; } dom[i] = bk; }
  D.dom = dom; PA_D = D; if (typeof window !== 'undefined') window.__paD = D; return D;
}
function paraTex() {
  if (PA_TEX) return PA_TEX;
  PA_TEX = new THREE.TextureLoader().load('data:image/jpeg;base64,' + PARA.tex);
  PA_TEX.flipY = false; PA_TEX.colorSpace = THREE.NoColorSpace; PA_TEX.anisotropy = 4; PA_TEX.wrapS = PA_TEX.wrapT = THREE.ClampToEdgeWrapping;
  return PA_TEX;
}
const paraMats = new Map();
function paraMat(emis) {
  const key = emis || 0; let m = paraMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: paraTex(), roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  paraMats.set(key, m); return m;
}
function parasaurolophus(o) {
  const r = o.r || {}, Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = paraData(), n = D.n, s = PA_S * (o.sK || 1), pal = o.pal, nb = D.nb, dom = D.dom, bz = 1 + (r.mass || 0) * 0.04;
  const mp = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mp[i * 3 + k] = D.P[i * 3 + k] - PA_OFF[k]; pos[i * 3 + k] = mp[i * 3 + k] * s * (k === 2 ? bz : 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  // ---- раскраска: палитра (спина-бок-брюхо + узор); пасть — отдельно; глаза модели — родные; всё ×2 к карте деталей (0,5 = нейтрально)
  const up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = D.N[i * 3 + 1] * 0.8 + sstep(0.2, 2.6, mp[i * 3 + 1]) * 0.35 - 0.2; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), cm = hx(0x8a3a44);
    for (let i = 0; i < n; i++) {
      if (D.E[i]) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1; continue; }        // глаза: цвета из листа (радужка/зрачок) без раскраски
      const mo = D.M[i] / 255; c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (mo > 0.01) c.lerp(cm, mo);
      c.multiplyScalar(2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  // ---- скелет: нулевые повороты покоя
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'pa' + i; bones.push(bn); rest.push(new V3((D.pos[i][0] - PA_OFF[0]) * s, (D.pos[i][1] - PA_OFF[1]) * s, (D.pos[i][2] - PA_OFF[2]) * s * bz)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, paraMat(o.emis));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('biped'); rig.frame.add(mesh);
  rig.spine = { root: bones[0], tail: [], neck: [], head: bones[PA_HEAD] };
  rig.jaw = bones[PA_JAW]; rig.jawBase = 0;
  // ---- веки поверх родных глаз модели (глаза не дублируем)
  const head = bones[PA_HEAD], headO = rest[PA_HEAD], kit = new Kit();
  const ex0 = D.eyes[0][0] - PA_OFF[0], ey0 = D.eyes[0][1] - PA_OFF[1], ez0 = Math.abs(D.eyes[0][2]), ER = D.eyeR * s;
  const eyes = [], lids = [], skinSide = (MORPH && MORPH.c1 != null) ? MORPH.c1 : pal.side;
  const lidMat = new THREE.MeshStandardMaterial({ color: lidSkin(L, mp, n, [ex0, ey0, ez0], 0.5 * 0.85), roughness: 0.85 });
  for (const sd of [1, -1]) {
    const pe = new V3(ex0 * s, ey0 * s, sd * ez0 * s * bz), dir = new V3(0.25, 0.1, sd * 0.96).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const eg = new THREE.Group(); eg.position.copy(pe).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.12, Fd = LR * 0.5, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.12, LR * 1.08, Fd * 0.75); m.position.set(0, -sgn * LR, Fd * 0.05); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) }); eyes.push(pe);
  }
  // ---- шипы вдоль спины и хвоста («Шипастый хвост», «Ёж»): верхние точки тела в стойке, крепим к кости вершины
  if (r.thorns) {
    const ci = D.clips.idle, restQ = bones.map(b => b.quaternion.clone());
    for (let i = 0; i < nb; i++) bones[i].quaternion.set(ci.QC[i * 4], ci.QC[i * 4 + 1], ci.QC[i * 4 + 2], ci.QC[i * 4 + 3]);
    mesh.updateMatrixWorld(true);
    const skm = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i])), pp = new Float32Array(n * 3), tv = new V3(), av = new V3();
    for (let i = 0; i < n; i++) { av.set(0, 0, 0); const r0 = new V3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); for (let k = 0; k < 4; k++) { const w = sw[i * 4 + k]; if (w > 0) av.addScaledVector(tv.copy(r0).applyMatrix4(skm[si[i * 4 + k]]), w); } pp[i * 3] = av.x; pp[i * 3 + 1] = av.y; pp[i * 3 + 2] = av.z; }
    for (let i = 0; i < nb; i++) bones[i].quaternion.copy(restQ[i]);
    mesh.updateMatrixWorld(true);
    const bodyB = (b) => b <= 11 || (b >= 38 && b <= 43);
    const top = (x) => { let zc = 0, c = 0; for (let i = 0; i < n; i++) if (bodyB(dom[i]) && Math.abs(pp[i * 3] - x) < 0.14 * s) { zc += pp[i * 3 + 2]; c++; } if (!c) return -1; zc /= c;
      let m = -1e9, bi = -1; for (let i = 0; i < n; i++) if (bodyB(dom[i]) && Math.abs(pp[i * 3] - x) < 0.14 * s && Math.abs(pp[i * 3 + 2] - zc) < 0.1 * s && pp[i * 3 + 1] > m) { m = pp[i * 3 + 1]; bi = i; } return bi; };
    const cnt = Math.min(10, r.thorns), x0 = 1.0 * s, x1 = -3.2 * s;
    for (let i = 0; i < cnt; i++) {
      const x = x0 + (x1 - x0) * (cnt > 1 ? i / (cnt - 1) : 0), vi = top(x); if (vi < 0) continue;
      const len = (0.22 - 0.1 * i / cnt) * s, nrm = new V3(D.N[vi * 3], D.N[vi * 3 + 1], D.N[vi * 3 + 2]), p = new V3(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).addScaledVector(nrm, -0.015 * s);
      kit.add(bones[dom[vi]], rest[dom[vi]], 'acc', UNIT.cone, M_spike(p, nrm.multiplyScalar(0.6).add(new V3(-0.25, 0.7, 0)).normalize(), len, len * 0.3), 0xe8dcc0);
    }
  }
  kit.build({ emis: o.emis });
  // ---- корона/шляпа: на верхушке гребня (гребень — часть головы; на лбу он мешал бы кольцу короны)
  { let topY = 0, topX = 2.3; for (let i = 0; i < n; i++) if (dom[i] === PA_HEAD && mp[i * 3 + 1] > topY) { topY = mp[i * 3 + 1]; topX = mp[i * 3]; }
    setHeadAnch(rig, head, new V3(topX * s, topY * s, 0).sub(headO), new V3(ex0 * s, ey0 * s, ez0 * s).sub(headO), new V3(rest[40].x, rest[40].y, 0)); }
  rig.anch.crownK = 0.62;
  rig.walkAmp = 0.35; rig.gait = 'biped'; rig.k = 0.85;
  rig.tagH = 3.6 * s + 0.4;
  rig.pa = { s, lids, bones, rest, nb, st: null };
  return rig;
}
const _pA = new THREE.Quaternion();
function animPara(dino, P, dt, speed, st) {
  const T = P.pa, D = PA_D, nb = T.nb, bn = T.bones, s = T.s, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { pi: Math.random(), pw: Math.random(), pr: 0, pe: 0, v: 0, blink: 2 + Math.random() * 3, lift: null, idle: 0, gT: 6 + Math.random() * 5, graze: 0, roar: 0 });
  const vc = Math.max(0, speed) * 6 / (sc * s);                  // скорость в единицах модели
  S.v += (vc - S.v) * Math.min(1, ddt * (vc < S.v ? 10 : 6));
  const moving = sstep(0.12, 0.6, S.v), rw = sstep(3.0, 5.2, S.v);
  const bc = biteCurve(dino.userData.bite || 0), pull = bc ? bc.pull : 0, lunge = bc ? bc.lunge : 0, open = bc ? bc.open : 0;
  if (dino.userData.roar > 0) { S.roar = 1; dino.userData.roar = 0; }
  if (S.roar > 0) S.roar = Math.max(0, S.roar - ddt / 2.0);
  const ro = S.roar > 0 ? sstep(0, 0.15, 1 - S.roar) * sstep(0, 0.3, S.roar) : 0;
  // выпас в покое: время от времени щиплет траву (клип «ест»)
  if (S.v < 0.1 && !bc && !ro && !st.guard && !st.swim && !st.climb) { S.idle += ddt; if (S.idle > S.gT) { S.graze = Math.min(1, S.graze + ddt * 1.2); if (S.idle > S.gT + 5.5) { S.idle = 0; S.gT = 7 + Math.random() * 8; } } else S.graze = Math.max(0, S.graze - ddt * 1.5); }
  else { S.idle = 0; S.graze = Math.max(0, S.graze - ddt * 3); }
  const cI = D.clips.idle, cW = D.clips.walk, cR = D.clips.run, cE = D.clips.eat;
  const wg = sstep(0, 1, S.graze) * (1 - moving), wi = (1 - moving) * (1 - wg), ww = moving * (1 - rw), wr = moving * rw;
  S.pi = (S.pi + ddt / cI.dur) % 1;
  S.pe = (S.pe + ddt / cE.dur) % 1;
  const rW = Math.min(2.2, Math.max(0.6, S.v / PA_WALK_V)), rR = Math.min(1.7, Math.max(0.7, S.v / PA_RUN_V));
  if (ww > 0.001 || wr < 0.02) S.pw = (S.pw + ddt * rW / cW.dur) % 1;
  if (wr > 0.001 || ww < 0.02) S.pr = (S.pr + ddt * rR / cR.dur) % 1;
  if (wr < 0.02) S.pr = S.pw; else if (ww < 0.02) S.pw = S.pr;   // фазы шагов синхронны при смене походки
  const fI = S.pi * cI.nf, fW = S.pw * cW.nf, fR = S.pr * cR.nf, fE = S.pe * cE.nf;
  const iI0 = Math.floor(fI) % cI.nf, iI1 = (iI0 + 1) % cI.nf, aI = fI - Math.floor(fI);
  const iW0 = Math.floor(fW) % cW.nf, iW1 = (iW0 + 1) % cW.nf, aW = fW - Math.floor(fW);
  const iR0 = Math.floor(fR) % cR.nf, iR1 = (iR0 + 1) % cR.nf, aR = fR - Math.floor(fR);
  const iE0 = Math.floor(fE) % cE.nf, iE1 = (iE0 + 1) % cE.nf, aE = fE - Math.floor(fE);
  for (let b = 0; b < nb; b++) {
    let ax = 0, ay = 0, az = 0, aw = 0, ref = null;
    const add = (c, f0, f1, fa, w) => {
      if (w < 0.001) return; velQ(c, f0, f1, fa, b, nb, _vo);
      if (ref && ref[0] * _vo[0] + ref[1] * _vo[1] + ref[2] * _vo[2] + ref[3] * _vo[3] < 0) { _vo[0] = -_vo[0]; _vo[1] = -_vo[1]; _vo[2] = -_vo[2]; _vo[3] = -_vo[3]; }
      if (!ref) ref = [_vo[0], _vo[1], _vo[2], _vo[3]];
      ax += _vo[0] * w; ay += _vo[1] * w; az += _vo[2] * w; aw += _vo[3] * w;
    };
    add(cI, iI0, iI1, aI, wi); add(cW, iW0, iW1, aW, ww); add(cR, iR0, iR1, aR, wr); add(cE, iE0, iE1, aE, wg);
    bn[b].quaternion.set(ax, ay, az, aw).normalize();
  }
  // ---- позиция таза из клипов; высота корпуса — по стопам
  { const ps = (c, f0, f1, fa, b, ox, oz, out) => { const t = c.tb[b]; if (!t) return false; const p0 = t[f0], p1 = t[f1]; out[0] = p0[0] + (p1[0] - p0[0]) * fa + ox; out[1] = p0[1] + (p1[1] - p0[1]) * fa; out[2] = p0[2] + (p1[2] - p0[2]) * fa + oz; return true; };
    const r0 = D.pos[0], pk = [0, 0, 0]; let x = 0, y = 0, z = 0;
    const acc = (c, f0, f1, fa, w, ox, oz) => { if (w < 0.001) return; if (ps(c, f0, f1, fa, 0, ox, oz, pk)) { x += pk[0] * w; y += pk[1] * w; z += pk[2] * w; } else { x += (r0[0] + ox) * w; y += r0[1] * w; z += (r0[2] + oz) * w; } };
    acc(cI, iI0, iI1, aI, wi, 0, 0); acc(cW, iW0, iW1, aW, ww, cW.ox, cW.oz); acc(cR, iR0, iR1, aR, wr, cR.ox, cR.oz); acc(cE, iE0, iE1, aE, wg, 0, 0);
    bn[0].position.set((x - PA_OFF[0]) * s, (y - PA_OFF[1]) * s, (z - PA_OFF[2]) * s);
    const lo = (c, f0, f1, fa) => c.low[f0] + (c.low[f1] - c.low[f0]) * fa;
    const low = lo(cI, iI0, iI1, aI) * wi + lo(cW, iW0, iW1, aW) * ww + lo(cR, iR0, iR1, aR) * wr + lo(cE, iE0, iE1, aE) * wg, tgt = (0.02 - low) * s;
    S.lift = S.lift == null ? tgt : S.lift + (tgt - S.lift) * Math.min(1, ddt * 14);
    P.frame.position.set(0, S.lift, lunge * 0.05); }      // бодание: рывок вперёд совсем небольшой, строго по ходу (frame повёрнут: перёд = +z)
  S.cl = (S.cl || 0) + ((st.climb ? 1 : 0) - (S.cl || 0)) * Math.min(1, ddt * 5); P.body.rotation.x = -1.35 * S.cl;      // «лазание по деревьям»: корпус встаёт вдоль ствола
  // ---- бодание: замах шеей назад-вверх, короткий кивок вниз; рёв: голова вверх и пасть; щит: голова ниже
  { const gd = st.guard ? 0.1 : 0, dip = -lunge * 0.07 + pull * 0.035 + ro * 0.05 - gd * 0.5, hd = -lunge * 0.09 + pull * 0.05 + ro * 0.12 - gd * 0.6;
    for (const b of PA_NECK) { _pA.setFromAxisAngle(_vZ, dip); bn[b].quaternion.multiply(_pA); }
    _pA.setFromAxisAngle(_vZ, hd); bn[PA_HEAD].quaternion.multiply(_pA);
    const jo = Math.max(open * 0.45, ro * 0.4); if (jo > 0.002) { _pA.setFromAxisAngle(_vZ, -jo); bn[PA_JAW].quaternion.multiply(_pA); } }
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.14 ? 1 : 1 - sstep(0.14, 0.34, u);
    if (u > 0.34) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 4; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}


// ======================================================================== БРАХИОЗАВР (враг-стадо)
// Модель без скелета: кости (корпус, шея, хвост, 4 ноги) и веса запечены tools/bra_bake.py; походка и шея считаются кодом (клипов нет).
let BR_D = null, BR_TEX = null;
const BR_S = 0.4, BR_OFF = [0.2, 0, 0];
function braData() {
  if (BR_D) return BR_D;
  const R = BRA, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  BR_D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), dom: new Uint8Array(b64buf(R.dom)),
    par: R.par, pos: R.pos, nb: R.par.length, idx: R.idx, eyes: R.eyes, eyeR: R.eyeR };
  return BR_D;
}
function braTex() {
  if (BR_TEX) return BR_TEX;
  BR_TEX = new THREE.TextureLoader().load('data:image/jpeg;base64,' + BRA.tex);
  BR_TEX.flipY = false; BR_TEX.colorSpace = THREE.NoColorSpace; BR_TEX.anisotropy = 4; BR_TEX.wrapS = BR_TEX.wrapT = THREE.RepeatWrapping;
  return BR_TEX;
}
const braMats = new Map();
function braMat(emis) {
  const key = emis || 0; let m = braMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: braTex(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  braMats.set(key, m); return m;
}
function brachiosaurus(o) {
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = braData(), n = D.n, s = BR_S * (o.sK || 1), pal = o.pal, nb = D.nb, dom = D.dom, I = D.idx;
  const mp = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mp[i * 3 + k] = D.P[i * 3 + k] - BR_OFF[k]; pos[i * 3 + k] = mp[i * 3 + k] * s * (k ? 1 : SK_X); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  const up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = D.N[i * 3 + 1] * 0.8 + sstep(0.4, 2.4, mp[i * 3 + 1]) * 0.35 - 0.2; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat || null);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), cf = hx(0x3a342c), legs = new Set(); for (const k in I.legs) legs.add(I.legs[k][2]);
    for (let i = 0; i < n; i++) {
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (legs.has(dom[i]) && mp[i * 3 + 1] < 0.28) c.lerp(cf, 0.35 * (1 - mp[i * 3 + 1] / 0.28));     // подошвы чуть темнее
      c.multiplyScalar(2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'br' + i; bones.push(bn); rest.push(new V3((D.pos[i][0] - BR_OFF[0]) * s, (D.pos[i][1] - BR_OFF[1]) * s, (D.pos[i][2] - BR_OFF[2]) * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, braMat(o.emis));
  mesh.add(bones[I.root]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('quad'); rig.frame.add(mesh);
  rig.spine = { root: bones[I.root], tail: [], neck: [], head: bones[I.head] };
  // ---- глаза и веки
  const head = bones[I.head], headO = rest[I.head], glow = !!o.glowEyes, kit = new Kit();
  const ex0 = D.eyes[0][0] - BR_OFF[0], ey0 = D.eyes[0][1] - BR_OFF[1], ez0 = Math.abs(D.eyes[0][2]), ER = Math.max(0.02, D.eyeR * 1.5) * s * (o.eyeK || 1), irisC = o.irisC || (glow ? 0xffd23a : 0xd9962a);
  const eyes = [], lids = [], skinSide = (MORPH && MORPH.c1 != null) ? MORPH.c1 : pal.side;
  const lidMat = new THREE.MeshStandardMaterial({ color: lidSkin(L, mp, n, [ex0, ey0, ez0], 0.5 * 0.85), roughness: 0.8 });
  for (const sd of [1, -1]) {
    const pe = new V3(ex0 * s, ey0 * s, sd * ez0 * s * 0.95), dir = new V3(0.25, 0.1, sd * 0.95).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone(), Fd = ER * 0.82, qE = (k) => [ER * k, ER * k, Fd * 0.8];
    kit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, Fd], qd), 0x1a100a);
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.2), qE(0.95), qd), mulHex(irisC, 0.5));
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.34), qE(0.86), qd), irisC);
    kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.5), [ER * 0.5, ER * 0.5, Fd * 0.76], qd), 0x040202);
    kit.add(head, headO, 'glow', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 1.2).addScaledVector(ey, ER * 0.34).addScaledVector(ex, ER * 0.26), [ER * 0.13, ER * 0.13, Fd * 0.1]), 0xfffaf0);
    const eg = new THREE.Group(); eg.position.copy(c0).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.03, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.08, LR * 1.04, Fd * 0.78); m.position.set(0, -sgn * LR, Fd * 0.2); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) }); eyes.push(pe);
  }
  kit.build({ emis: o.emis });
  { let topY = 0, topX = 3.2; for (let i = 0; i < n; i++) if (dom[i] === I.head && mp[i * 3 + 1] > topY) { topY = mp[i * 3 + 1]; topX = mp[i * 3]; }
    setHeadAnch(rig, head, new V3(topX * s, topY * s, 0).sub(headO), eyes[0].clone().sub(headO), new V3(rest[I.neck[0]].x, rest[I.neck[0]].y, 0)); }
  rig.walkAmp = 0.3; rig.gait = 'quad'; rig.k = 1.0;
  rig.tagH = 5.76 * s + 0.3;
  rig.br = { s, lids, bones, rest, nb, st: null };
  return rig;
}
// ---------- анимация брахиозавра: шаг «по кругу» (зад-лев → пер-лев → зад-прав → пер-прав), качание шеи и хвоста, выпад шеей при атаке ----------
const BR_DUTY = 0.72;
const BR_LEG = { hl: { ph: 0.0, front: false }, fl: { ph: 0.25, front: true }, hr: { ph: 0.5, front: false }, fr: { ph: 0.75, front: true } };
function animBra(dino, P, dt, speed, bite) {
  const T = P.br, D = BR_D, I = D.idx, bn = T.bones, s = T.s, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sc = dino.scale.x || 1;
  const S = T.st || (T.st = { ph: Math.random(), v: 0, t: Math.random() * 50, blink: 2 + Math.random() * 3, lift: null });
  const vc = Math.max(0, speed) * 6 / (sc * s);
  S.v += (vc - S.v) * Math.min(1, ddt * (vc < S.v ? 6 : 4)); S.t += ddt;
  const mv = sstep(0.1, 0.5, S.v), t = S.t;
  const rate = Math.min(0.9, Math.max(0.2, S.v * 0.45));
  S.ph = (S.ph + ddt * rate * mv) % 1;
  const A = Math.min(0.55, Math.max(0.05, Math.asin(Math.min(0.6, S.v * BR_DUTY / (rate * 3.4))))) * mv;
  const bp = bite > 0 ? 1 - bite : -1, wb = bp >= 0 ? sstep(0, 0.16, bp) * (1 - sstep(0.5, 1, bp)) : 0;
  const rot = (b, x, y, z) => { bn[b].rotation.set(x, y, z); };
  // ---- ноги
  let low = 1e9;
  for (const k in BR_LEG) {
    const cfg = BR_LEG[k], [h, kn, ft] = I.legs[k], ph = (S.ph + cfg.ph) % 1, kk = cfg.front ? 0.85 : 1;
    let th, kb;
    if (ph < BR_DUTY) { const u = ph / BR_DUTY; th = A * kk * (1 - 2 * u); kb = 0.06 * Math.sin(Math.PI * u) * mv; }
    else { const u = (ph - BR_DUTY) / (1 - BR_DUTY), e = u * u * (3 - 2 * u); th = A * kk * (-1 + 2 * e); kb = (cfg.front ? 0.7 : 0.9) * Math.sin(Math.PI * u) * mv * Math.min(1, 0.4 + A * 3); }
    rot(h, 0, 0, th); rot(kn, 0, 0, -kb); rot(ft, 0, 0, -(th - kb));
    const Hy = T.rest[h].y - T.rest[I.root].y + (cfg.front ? 0.08 * s : 0), Lt = (T.rest[h].y - T.rest[kn].y), Ls = (T.rest[kn].y - T.rest[ft].y), Lf = T.rest[ft].y;
    const hy = T.rest[h].y, soleY = hy - Lt * Math.cos(th) - Ls * Math.cos(th - kb) - Lf;
    low = Math.min(low, soleY);
  }
  const tgt = -low; S.lift = S.lift == null ? tgt : S.lift + (tgt - S.lift) * Math.min(1, ddt * 12);
  // ---- корпус: лёгкое покачивание, дыхание
  const swayR = Math.sin(S.ph * 6.2832) * 0.025 * mv, br = Math.sin(t * 1.6) * 0.008;
  rot(I.root, 0 + swayR, Math.sin(S.ph * 6.2832 + 1) * 0.02 * mv, br);
  rot(I.spine, -swayR * 0.5, 0, -br * 0.5); rot(I.chest, -swayR * 0.5, -Math.sin(S.ph * 6.2832 + 1) * 0.02 * mv, 0);
  P.frame.position.y = S.lift + Math.sin(S.ph * 12.566) * 0.012 * s * mv;
  // ---- шея: волна + кивок в такт шагу; при атаке — выпад вперёд-вниз
  for (let i = 0; i < I.neck.length; i++) {
    const f = i / (I.neck.length - 1);
    const pz = Math.sin(t * 0.5 - i * 0.55) * 0.011 + Math.sin(S.ph * 6.2832 - i * 0.45) * 0.007 * mv - wb * (0.1 + 0.025 * i);
    const py = Math.sin(t * 0.3 + 1.7 - i * 0.4) * 0.02 + wb * 0.02;
    rot(I.neck[i], 0, py, pz);
  }
  { const nz = Math.sin(t * 0.6 + 0.5) * 0.015 - wb * 0.35 + Math.sin(S.ph * 6.2832) * 0.01 * mv; rot(I.head, 0, Math.sin(t * 0.4 + 2) * 0.02, nz); }
  // ---- хвост: волна, при атаке хлёст в сторону
  for (let i = 0; i < I.tail.length; i++) {
    const w = Math.sin(t * 1.0 - i * 0.7) * 0.07 + Math.sin(S.ph * 6.2832 - i * 0.6) * 0.1 * mv + Math.sin(bp * Math.PI) * (bp >= 0 ? 0.5 : 0) * (0.4 + i * 0.15);
    rot(I.tail[i], 0, w, Math.sin(t * 0.8 - i * 0.5) * 0.02);
  }
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.1 ? sstep(0, 0.1, u) : u < 0.18 ? 1 : 1 - sstep(0.18, 0.4, u);
    if (u > 0.4) S.blink = Math.random() < 0.15 ? 0.2 : 3 + Math.random() * 4; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}


// ======================================================================== МЕГАЛОДОН (игрок вместо ихтиозавра)
// Большая белая акула «Mighty Megalodon»: сетка (4 тыс. треугольников), скелет из 19 костей и клип плавания 3,3 с запечены tools/gws_bake.py.
// Клип качает тело и хвост (плавники и челюсть в нём неподвижны): ласты и спинной плавник добавляет код, пасть открывается кодом (укус). Глаза и веки собираются заново.
// Номера костей берутся из данных (SHK.bones), поэтому код не привязан к скелету.
let SK_D = null, SK_TEX = null;
const SK_S = 1.5, SK_OFF = [-0.5, -0.72, 0], SK_X = 1.1;   // SK_X — общая растяжка вдоль тела, её же используют велоцираптор и брахиозавр; у акулы не применяется
function shkData() {
  if (SK_D) return SK_D;
  const R = SHK, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  const c = R.clip, qs = new Int16Array(b64buf(c.q)), QC = new Float32Array(qs.length); for (let i = 0; i < qs.length; i++) QC[i] = qs[i] / 32767;
  SK_D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), M: new Uint8Array(b64buf(R.m)), T: new Uint8Array(b64buf(R.t)),
    par: R.par, pos: R.pos, nb: R.par.length, eyes: R.eyes, eyeR: R.eyeR, names: R.names, B: R.bones, clip: { nf: c.nf, dur: c.dur, QC, avg: c.avg } };
  const dom = new Uint8Array(n); for (let i = 0; i < n; i++) { let bk = 0, bw = -1; for (let k = 0; k < 4; k++) if (SK_D.SW[i * 4 + k] > bw) { bw = SK_D.SW[i * 4 + k]; bk = SK_D.SI[i * 4 + k]; } dom[i] = bk; }
  SK_D.dom = dom; return SK_D;
}
function shkTex() {
  if (SK_TEX) return SK_TEX;
  SK_TEX = new THREE.TextureLoader().load('data:image/jpeg;base64,' + SHK.tex);
  SK_TEX.flipY = false; SK_TEX.colorSpace = THREE.NoColorSpace; SK_TEX.anisotropy = 4; SK_TEX.wrapS = SK_TEX.wrapT = THREE.ClampToEdgeWrapping;
  return SK_TEX;
}
const shkMats = new Map();
function shkMat(emis) {
  const key = emis || 0; let m = shkMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: shkTex(), roughness: 0.55, metalness: 0.02, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  shkMats.set(key, m); return m;
}
function megalodon(o) {
  const Q = (o.q || 1) * qMul(); _eyeQ = Q;
  const D = shkData(), n = D.n, s = SK_S * (o.sK || 1), pal = o.pal, nb = D.nb, dom = D.dom, r = o.r || {}, B = D.B;
  const mp = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mp[i * 3 + k] = D.P[i * 3 + k] - SK_OFF[k]; pos[i * 3 + k] = mp[i * 3 + k] * s; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  const up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9, ymax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); ymax = Math.max(ymax, mp[i * 3 + 1]); }
  for (let i = 0; i < n; i++) { up[i] = D.N[i * 3 + 1] * 0.9 + sstep(0.4, 1.2, mp[i * 3 + 1]) * 0.5 - 0.35; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat || null);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), cm = hx(0xb04a58), ct = hx(0xf2eedc);
    for (let i = 0; i < n; i++) {
      const mo = D.M[i] / 255, te = D.T[i] / 255;
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      if (mo > 0.01) c.lerp(cm, mo);
      if (te > 0.01) c.lerp(ct, te);
      c.multiplyScalar(2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'sk' + i; bones.push(bn); rest.push(new V3((D.pos[i][0] - SK_OFF[0]) * s, (D.pos[i][1] - SK_OFF[1]) * s, (D.pos[i][2] - SK_OFF[2]) * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, shkMat(o.emis));
  mesh.add(bones[B.root]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('aqua'); rig.frame.add(mesh);
  rig.spine = { root: bones[B.root], tail: [], neck: [], head: bones[B.head], jaw: bones[B.jaw] };
  // ---- глаза и веки (чёрные, как у акулы): стоят там, где были глазные яблоки файла
  const head = bones[B.head], headO = rest[B.head], kit = new Kit(), glow = (r.sense || 0) >= 2 || o.glowEyes;
  const ER = Math.max(D.eyeR[0], D.eyeR[1]) * 1.3 * s * (o.eyeK || 1), irisC = o.irisC || (glow ? 0xffd23a : 0x0a0a0c);
  const eyes = [], lids = [], lidMat = new THREE.MeshStandardMaterial({ color: lidSkin(L, mp, n, [D.eyes[0][0] - SK_OFF[0], D.eyes[0][1] - SK_OFF[1], D.eyes[0][2] - SK_OFF[2]], 0.5 * 0.9), roughness: 0.7 });
  for (let k = 0; k < 2; k++) {
    const sd = D.eyes[k][2] > 0 ? 1 : -1, pe = new V3((D.eyes[k][0] - SK_OFF[0]) * s, (D.eyes[k][1] - SK_OFF[1]) * s, (D.eyes[k][2] - SK_OFF[2]) * s), dir = new V3(0.35, 0.1, sd * 0.93).normalize();
    const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const c0 = pe.clone(), Fd = ER * 0.85;
    kit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, Fd], qd), 0x050506);
    kit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.35), [ER * 0.78, ER * 0.78, Fd * 0.7], qd), irisC);
    if (glow) {      // улучшенное чутьё: светящаяся радужка с ярким центром и тёмным краем, вертикальная щель зрачка
      kit.add(head, headO, 'glow', eyeG(), M_ell(c0.clone().addScaledVector(dir, Fd * 0.62), [ER * 0.62, ER * 0.62, Fd * 0.45], qd), mixHex(irisC, 0xfff4b0, 0.55));
      kit.add(head, headO, 'eye', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 0.98), [ER * 0.1, ER * 0.5, Fd * 0.2], qd), 0x020101);
    }
    kit.add(head, headO, 'glow', UNIT.sphLo, M_ell(c0.clone().addScaledVector(dir, Fd * 1.1).addScaledVector(ey, ER * 0.35).addScaledVector(ex, ER * 0.28), [ER * 0.13, ER * 0.13, Fd * 0.1]), 0xfffaf0);
    const eg = new THREE.Group(); eg.position.copy(c0).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    const LR = ER * 1.04, lidG = new THREE.SphereGeometry(1, 20, 12);
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.08, LR * 1.04, Fd * 0.78); m.position.set(0, -sgn * LR, Fd * 0.2); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    eyes.push(pe);      // у акулы век нет — не моргает
  }
  kit.build({ emis: o.emis });
  { const tx = (D.eyes[0][0] - SK_OFF[0]) - 0.34; let topY = -1e9;                                  // корона — на черепе над и позади глаз: высота макушки в этом месте по самым верхним вершинам
    for (let i = 0; i < n; i++) if (Math.abs(mp[i * 3 + 2]) < 0.12 && Math.abs(mp[i * 3] - tx) < 0.07 && mp[i * 3 + 1] > topY) topY = mp[i * 3 + 1];
    setHeadAnch(rig, head, new V3(tx * s, topY * s, 0).sub(headO), eyes[0].clone().sub(headO), new V3(rest[1].x, rest[1].y, 0)); }
  rig.anch.crownK = o.crownK || 1.25;
  rig.walkAmp = 0; rig.gait = 'swim'; rig.aquatic = true; rig.k = 0.9;
  rig.tagH = ymax * s + 0.35;
  const ix = (nm) => D.names.indexOf(nm);
  rig.shk = { s, lids, bones, rest, nb, st: null, fins: { L: [ix('Fin_L_01'), ix('Fin_L_02')], R: [ix('Fin_R_01'), ix('Fin_R_02')], dorsal: [ix('Fin_01'), ix('Fin_02')] } };
  return rig;
}
const _skq = [0, 0, 0, 0], _skQ = new THREE.Quaternion();
function animShk(dino, P, t, speed, dt, st) {
  const T = P.shk, D = SK_D, C = D.clip, nb = T.nb, bn = T.bones, ddt = Math.min(Math.max(dt || 0, 0), 0.1), B = D.B;
  const S = T.st || (T.st = { A: 1, u: Math.random(), v: 0, blink: 2 + Math.random() * 3, pitch: 0, roll: 0, yaw: dino.rotation.y });
  const sp = Math.min(1.6, Math.max(0, speed)), sw = !!st.swim;                  // в воде (в том числе стоя на дне) — плавание; на суше — вялое барахтанье лёжа на брюхе
  S.v += (sp - S.v) * Math.min(1, ddt * 4);
  // ---- клип: частота взмахов растёт со скоростью (на стоянке в воде — медленное покачивание, как у акулы, которой надо плыть; на суше — вяло)
  const rate = (sw ? 0.42 + 0.9 * S.v : 0.3 + 0.35 * S.v) * (st.run ? 1.15 : 1);
  S.A += ((sw ? 1 : 0.45) - S.A) * Math.min(1, ddt * 4);      // размах движения: на суше вдвое меньше
  S.A2 = (S.A2 === undefined ? S.A : S.A2) + ((sw ? 0.14 + 0.2 * Math.min(1, S.v / 0.6) : 0.1) - (S.A2 === undefined ? S.A : S.A2)) * Math.min(1, ddt * 3);   // стоя в воде размах втрое меньше
  S.u = (S.u + ddt * rate / C.dur * 1) % 1;
  const fp = S.u * C.nf, f0 = Math.floor(fp) % C.nf, f1 = (f0 + 1) % C.nf, fa = fp - Math.floor(fp), Qc = C.QC;
  // ---- укус
  const bp = dino.userData.bite > 0 ? 1 - dino.userData.bite : -1;
  const open = bp >= 0 ? sstep(0, 0.22, bp) * (1 - sstep(0.34, 0.6, bp)) : 0, lunge = bp >= 0 ? sstep(0.12, 0.3, bp) * (1 - sstep(0.4, 0.85, bp)) : 0;
  for (let b = 0; b < nb; b++) {
    const i0 = (f0 * nb + b) * 4, i1 = (f1 * nb + b) * 4, a = C.avg[b];
    let bx = Qc[i1], by = Qc[i1 + 1], bz = Qc[i1 + 2], bw = Qc[i1 + 3];
    if (Qc[i0] * bx + Qc[i0 + 1] * by + Qc[i0 + 2] * bz + Qc[i0 + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let x = Qc[i0] + (bx - Qc[i0]) * fa, y = Qc[i0 + 1] + (by - Qc[i0 + 1]) * fa, z = Qc[i0 + 2] + (bz - Qc[i0 + 2]) * fa, w = Qc[i0 + 3] + (bw - Qc[i0 + 3]) * fa;
    const dk = b === B.head ? 0.55 : 1, k = S.A2 * dk;                             // голова качается вдвое меньше тела; стоя — размах убавлен
    if (k < 0.999) { x = a[0] + (x - a[0]) * k; y = a[1] + (y - a[1]) * k; z = a[2] + (z - a[2]) * k; w = a[3] + (w - a[3]) * k; }
    bn[b].quaternion.set(x, y, z, w).normalize();
  }
  // ---- плавники (в клипе неподвижны): ласты лениво машут, сильнее на скорости; спинной плавник чуть клонится в повороте
  { const fw = Math.sin(t * 1.5) * (0.05 + 0.04 * S.v), fr = Math.sin(t * 1.5 + 1.2) * 0.03;
    for (const sd of ['L', 'R']) { const f = T.fins[sd], sg = sd === 'L' ? 1 : -1;
      _vA.setFromAxisAngle(_vX, sg * (fw + 0.08)); bn[f[0]].quaternion.premultiply(_vA);
      _vA.setFromAxisAngle(_vZ, fr * sg); bn[f[1]].quaternion.premultiply(_vA); } }
  if (open > 0.002) {                                                          // нижняя челюсть вниз, голова чуть вверх (верхняя челюсть акулы выдвигается)
    _vA.setFromAxisAngle(_vZ, -0.78 * open); bn[B.jaw].quaternion.premultiply(_vA);
    _vA.setFromAxisAngle(_vZ, 0.12 * open); bn[B.head].quaternion.premultiply(_vA);
  }
  P.frame.position.set(0, 0, lunge * 0.05);   // рывок строго вперёд (frame повёрнут: перёд = +z родителя)
  // ---- корона на голове держится ровно: гасим поворот цепочки костей до головы (иначе клип наклоняет её вместе с головой)
  if (P.crown && P.crown.children[0] && P.headG) {
    if (!T.chain) { T.chain = []; for (let i = B.head; i >= 0; i = D.par[i]) T.chain.unshift(i); }
    _skQ.identity(); for (const i of T.chain) _skQ.multiply(bn[i].quaternion);
    _skQ.multiply(P.headG.quaternion).invert(); P.crown.children[0].quaternion.copy(_skQ);
  }
  // ---- наклон носа по вертикальной скорости и крен на поворотах; на суше — лежит на боку чуть-чуть
  const pt = sw ? Math.max(-0.6, Math.min(0.6, -(st.vy || 0) * 0.09)) : 0;
  S.pitch += (pt - S.pitch) * Math.min(1, ddt * 5);
  const yaw = dino.rotation.y, wr = ddt > 0 ? wrapA(yaw - S.yaw) / ddt : 0; S.yaw = yaw;
  S.roll += (Math.max(-0.5, Math.min(0.5, wr * 0.12)) - S.roll) * Math.min(1, ddt * 4);
  P.body.rotation.x = sw ? -0.03 + S.pitch : 0; P.body.rotation.z = sw ? S.roll : 0;
  P.body.position.y = sw ? 0 : 0.0;
  // ---- моргание
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.14 ? 1 - 0 : 1 - sstep(0.14, 0.34, u); if (u > 0.34) S.blink = 3 + Math.random() * 5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}



// ======================================================================== МОЗАЗАВР (игрок)
// Mosasaurus: сетка 11 тыс. вершин, скелет 107 костей, фотореалистичная текстура с настоящими глазами, зубами и пастью (tools/mos_bake.py).
// Клип из файла не используется (в нём нет ровного цикла плавания) — кости ведутся кодом: бегущая волна по хвосту, взмахи ластов, пасть.
let MS_D = null, MS_TEX = null, MS_N = null;
const D_EYES = () => MOS.eyes;
const MOS_S = 0.32, MOS_OFF = [-5.9, -2.06, 0];
function mosData() {
  if (MS_D) return MS_D;
  const R = MOS, v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  MS_D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)), K: new Uint8Array(b64buf(R.k)), par: R.par, pos: R.pos, nb: R.par.length, tp: R.tp };
  MS_N = {}; R.names.forEach((nm, i) => { MS_N[nm] = i; });
  const dom = new Uint8Array(n); for (let i = 0; i < n; i++) { let bk = 0, bw = -1; for (let k = 0; k < 4; k++) if (MS_D.SW[i * 4 + k] > bw) { bw = MS_D.SW[i * 4 + k]; bk = MS_D.SI[i * 4 + k]; } dom[i] = bk; }
  MS_D.dom = dom; return MS_D;
}
function mosTex() {
  if (MS_TEX) return MS_TEX;
  MS_TEX = new THREE.TextureLoader().load('data:image/jpeg;base64,' + MOS.tex);
  MS_TEX.flipY = false; MS_TEX.colorSpace = THREE.NoColorSpace; MS_TEX.anisotropy = 4; MS_TEX.wrapS = MS_TEX.wrapT = THREE.ClampToEdgeWrapping;
  return MS_TEX;
}
const mosMats = new Map();
function mosMat(emis) {
  const key = emis || 0; let m = mosMats.get(key); if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, map: mosTex(), roughness: 0.5, metalness: 0.02, side: THREE.DoubleSide });
  if (emis) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = 1; }
  mosMats.set(key, m); return m;
}
function mosasaurus(o) {
  const D = mosData(), n = D.n, s = MOS_S * (o.sK || 1), pal = o.pal, nb = D.nb, dom = D.dom, r = o.r || {};
  const mp = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mp[i * 3 + k] = D.P[i * 3 + k] - MOS_OFF[k]; pos[i * 3 + k] = mp[i * 3 + k] * s; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  const up = new Float32Array(n), vu = new Float32Array(n);
  let xmin = 1e9, xmax = -1e9; for (let i = 0; i < n; i++) { xmin = Math.min(xmin, mp[i * 3]); xmax = Math.max(xmax, mp[i * 3]); }
  for (let i = 0; i < n; i++) { up[i] = D.N[i * 3 + 1] * 0.9 + sstep(0.2, 2.6, mp[i * 3 + 1]) * 0.45 - 0.3; vu[i] = mp[i * 3] - xmin; }
  const L = paint({ geo, up, vu, U: xmax - xmin }, pal, o.pat || null);
  { const col = L.geo.attributes.color.array, c = new THREE.Color(), w = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {                                           // кожа — цвет игрока ×2 (карта нормирована на 0,5); зубы, глаза, пасть — натуральные цвета текстуры
      c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]).multiplyScalar(2);
      const k = D.K[i] / 255; if (k > 0.01) c.lerp(w, k);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    } }
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bn.name = 'ms' + i; bones.push(bn); rest.push(new V3((D.pos[i][0] - MOS_OFF[0]) * s, (D.pos[i][1] - MOS_OFF[1]) * s, (D.pos[i][2] - MOS_OFF[2]) * s)); }
  for (let i = 0; i < nb; i++) { const p = D.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(L.geo, mosMat(o.emis));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  L.geo.computeBoundingSphere(); mesh.boundingSphere = L.geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('aqua'); rig.frame.add(mesh);
  const N = MS_N, head = bones[N['Bone.025']], headO = rest[N['Bone.025']];
  rig.spine = { root: bones[N['Bone.001']], tail: [], neck: [], head };
  // ---- эволюция: щитки по спине (броня), гребень по стадиям, электрические огни; глаза — родные из модели
  const kit = new Kit(), tpY = (x, side) => { const T = D.tp, a = side ? T.y1 : T.y0, f = (x - T.x0) / T.dx, i = Math.max(0, Math.min(a.length - 2, Math.floor(f))), u = Math.max(0, Math.min(1, f - i)); return a[i] * (1 - u) + a[i + 1] * u; };
  const spineB = ['Bone.001', 'Bone.002', 'Bone.003', 'Bone.004', 'Bone.005', 'Bone.006', 'Bone.007', 'Bone.008', 'Bone.009', 'Bone.010', 'Bone.011', 'Bone.012'].map(nm => N[nm]);
  const boneAtX = x => { let best = spineB[0], bd = 1e9; for (const b of spineB) { const d = Math.abs(D.pos[b][0] - x); if (d < bd) { bd = d; best = b; } } return best; };
  const scuteC = mulHex(pal.back, 0.9);
  for (let i = 0; i < (r.hide || 0) * 3; i++) for (const sd of [1, -1]) {
    const x = -0.5 - i * 0.55, yy = tpY(x, true) - MOS_OFF[1], b = boneAtX(x);
    if (!yy) continue;
    kit.add(bones[b], rest[b], 'skin', UNIT.scute, M_ell(new V3((x - MOS_OFF[0]) * s, yy * s, sd * 0.55 * s), [0.36 * s, 0.16 * s, 0.3 * s], new THREE.Quaternion().setFromUnitVectors(Y_UP, new V3(0, 1, sd * 0.55).normalize())), scuteC, true);
  }
  const nr = o.ridge !== undefined ? o.ridge : (o.stage >= 2 ? 4 + o.stage * 2 : 0);
  { const sp = []; let ymax = -9;
    for (let i = 0; i < nr; i++) { const x = -0.3 - i * 0.9, y0 = tpY(x, false); if (!y0) continue; sp.push([x, y0]); ymax = Math.max(ymax, y0); }
    const Ltip = (0.62 + (o.stage || 0) * 0.1) * s, lean = new V3(0, 1, 0), spC = mulHex(lidSide(pal), 0.78);           // шипы строго вертикальные, одной длины: вершины идут по линии спины; цвет — кожа с учётом морфа (раньше брался «спинной» цвет палитры — выходил фиолетовым)
    for (const [x, y0] of sp) { const b = boneAtX(x); kit.add(bones[b], rest[b], 'acc', UNIT.spike, M_spike(new V3((x - MOS_OFF[0]) * s, (y0 - MOS_OFF[1]) * s - 0.03 * s, 0), lean, Ltip, 0.2 * s), spC); } }
  kit.build({ emis: o.emis });
  // ---- веки: глаза нарисованы в текстуре головы, поверх них моргающие веки цвета кожи вокруг глаза
  const lids = [], eyeKit = new Kit();
  { const ec = D_EYES(), lc = new THREE.Color(0, 0, 0); let cnt = 0;
    for (const e of ec) for (let i = 0; i < n; i++) { const dx = mp[i * 3] - e.c[0], dy = mp[i * 3 + 1] - e.c[1], dz = mp[i * 3 + 2] - e.c[2]; if (dx * dx + dy * dy + dz * dz < 0.09) { lc.r += L.geo.attributes.color.array[i * 3]; lc.g += L.geo.attributes.color.array[i * 3 + 1]; lc.b += L.geo.attributes.color.array[i * 3 + 2]; cnt++; } }
    if (cnt) lc.set(Math.min(1, 2 * lc.r / cnt) * 0.30, Math.min(1, 2 * lc.g / cnt) * 0.33, Math.min(1, 2 * lc.b / cnt) * 0.38); else lc.setRGB(0.3, 0.33, 0.38);   // кожа берётся из текстуры, тут базовый серо-голубой × оттенок игрока
    const lidMat = new THREE.MeshStandardMaterial({ color: lidSkin(L, mp, n, [ec[0].c[0] - MOS_OFF[0], ec[0].c[1] - MOS_OFF[1], ec[0].c[2] - MOS_OFF[2]], 0.5 * 0.7), roughness: 0.6 }), lidG = new THREE.SphereGeometry(1, 20, 12);
    for (const e of ec) {
      const pe = new V3((e.c[0] - MOS_OFF[0]) * s, (e.c[1] - MOS_OFF[1]) * s, (e.c[2] - MOS_OFF[2]) * s), dir = new V3(e.d[0], e.d[1], e.d[2]).normalize();
      const ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
      { const ER = e.r * s * 0.95, c0 = pe.clone().addScaledVector(dir, -ER * 0.6), irisC = mulHex(o.irisC || ((r.sense || 0) >= 2 ? 0x7af0ff : 0xe0a82a), 0.68), glow = (r.sense || 0) >= 2;
        eyeKit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, ER * 0.9], qd), 0x0c0a08);
        const iris = c0.clone().addScaledVector(dir, ER * 0.5);
        eyeKit.add(head, headO, glow ? 'glow' : 'eye', eyeG(), M_ell(iris, [ER * 0.78, ER * 0.78, ER * 0.55], qd), irisC);
        eyeKit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.5), [ER * 0.26, ER * 0.68, ER * 0.14], qd), 0x050403);
        eyeKit.add(head, headO, 'glow', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.58).addScaledVector(ey, ER * 0.3).addScaledVector(ex, ER * 0.25), [ER * 0.11, ER * 0.11, ER * 0.08]), 0xfffaf0); }
      const LR = e.r * s * 1.15, Fd = LR * 0.3, eg = new THREE.Group(); eg.position.copy(pe).sub(headO); eg.quaternion.copy(qd); head.add(eg);
      const mkLid = sgn => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.0, LR * 1.0, Fd * 0.65); m.position.set(0, -sgn * LR, Fd * 0.1); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
      void ({ tp: mkLid(1), bp: mkLid(-1) });
    } }
  eyeKit.build({ emis: o.emis });
  // якоря для короны и косметики
  { let topY = -9, topX = 2; for (let i = 0; i < n; i++) if (dom[i] === N['Bone.025'] && mp[i * 3 + 1] > topY) { topY = mp[i * 3 + 1]; topX = mp[i * 3]; }
    setHeadAnch(rig, head, new V3(topX * s, topY * s, 0).sub(headO), new V3(2.7 * s, topY * s * 0.95, 0.5 * s).sub(headO), new V3(rest[N['Bone.023']].x, rest[N['Bone.023']].y, 0)); }
  rig.anch.crownK = 1.5;
  rig.walkAmp = 0; rig.gait = 'swim'; rig.aquatic = true; rig.k = 0.95;
  rig.tagH = (D.tp.y0.reduce((a, b) => Math.max(a, b), 0) - MOS_OFF[1]) * s + 0.4;
  const ix = nm => N[nm];
  rig.mos = { s, bones, rest, nb, st: null, lids,
    tail: ['Bone.003', 'Bone.004', 'Bone.005', 'Bone.006', 'Bone.007', 'Bone.008', 'Bone.009', 'Bone.010', 'Bone.011', 'Bone.012', 'Bone.013', 'Bone.014', 'Bone.015', 'Bone.016', 'Bone.017'].map(ix),
    lobe: ['Bone.018', 'Bone.019', 'Bone.020', 'Bone.021', 'Bone.022'].map(ix), neck: ['Bone.023', 'Bone.024'].map(ix), skull: ix('Bone.025'), jaw: ix('Bone.026'),
    fl: [['Bone.027', 1], ['Bone.055', -1]].map(([nm, sd]) => ({ b: ix(nm), sd, c: [ix(nm === 'Bone.027' ? 'Bone.074' : 'Bone.095'), ix(nm === 'Bone.027' ? 'Bone.028' : 'Bone.056')] })),
    hl: [['Bone.042', 1], ['Bone.070', -1]].map(([nm, sd]) => ({ b: ix(nm), sd, c: [ix(nm === 'Bone.042' ? 'Bone.094' : 'Bone.096'), ix(nm === 'Bone.042' ? 'Bone.043' : 'Bone.071')] })) };
  return rig;
}
const _msE = new THREE.Euler(0, 0, 0, 'YXZ');
function animMos(dino, P, t, speed, dt, st) {
  const T = P.mos, bn = T.bones, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sw = !!st.swim;
  const S = T.st || (T.st = { A: 1, ph: Math.random() * 6, v: 0, fph: 0, pitch: 0, roll: 0, yaw: dino.rotation.y });
  const sp = Math.min(1.6, Math.max(0, speed));
  S.v += (sp - S.v) * Math.min(1, ddt * 4); S.A += ((sw ? 1 : 0.4) - S.A) * Math.min(1, ddt * 4);
  const f = (sw ? 0.5 + 0.7 * S.v : 0.35 + 0.3 * S.v) * 0.4 * (st.run ? 1.15 : 1);     // взмахов хвоста в секунду
  S.ph += ddt * f * 6.2832;
  for (let i = 0; i < T.nb; i++) bn[i].quaternion.set(0, 0, 0, 1);
  const A = S.A, amp = 0.05 + 0.03 * Math.min(1, S.v);                           // угол поворота на кость (рад) у основания хвоста; к концу растёт
  const setR = (b, yaw, roll, pitch) => { _msE.set(roll, yaw, pitch); bn[b].quaternion.setFromEuler(_msE); };
  const tl = T.tail, nt = tl.length, wave = [];
  for (let i = 0; i < nt; i++) { const u = i / (nt - 1); wave[i] = A * amp * (0.35 + 1.1 * u) * Math.sin(S.ph - u * 4.2); setR(tl[i], wave[i], 0, 0.012 * A * Math.sin(S.ph * 0.5 - u * 2)); }
  for (let i = 0; i < T.lobe.length; i++) { const u = (10 + i) / (nt - 1); setR(T.lobe[i], A * amp * (0.35 + 1.1 * Math.min(1, u)) * Math.sin(S.ph - Math.min(1, u) * 4.2), 0, 0); }
  const counter = -0.5 * wave[1];                                                // голова чуть гасит качание тела
  setR(T.neck[0], counter * 0.6, 0, 0); setR(T.neck[1], counter * 0.5, 0, 0);
  // ---- ласты: взмахи вверх-вниз и гребок
  S.fph = (S.fph || 0) + ddt * (0.35 + 0.5 * S.v) * 0.4 * 6.2832 * (sw ? 1 : 0.5);   // гребок ластов медленный
  const fl = A * (0.2 + 0.1 * S.v);
  for (const L of T.fl) { setR(L.b, 0.1 * fl * Math.sin(S.fph + 1), L.sd * fl * Math.sin(S.fph), 0); setR(L.c[0], 0, L.sd * fl * 0.7 * Math.sin(S.fph - 0.7), 0); }
  for (const L of T.hl) { setR(L.b, 0, L.sd * fl * 0.8 * Math.sin(S.fph + 2), 0); setR(L.c[0], 0, L.sd * fl * 0.5 * Math.sin(S.fph + 1.2), 0); }
  // ---- укус: нижняя челюсть вниз, череп вверх; рывок вперёд небольшой
  const bp = dino.userData.bite > 0 ? 1 - dino.userData.bite : -1;
  const open = bp >= 0 ? sstep(0, 0.22, bp) * (1 - sstep(0.34, 0.6, bp)) : 0, lunge = bp >= 0 ? sstep(0.12, 0.3, bp) * (1 - sstep(0.4, 0.85, bp)) : 0;
  const idle = sw ? 0.03 + 0.02 * Math.sin(S.ph * 0.5) : 0.03;
  setR(T.jaw, 0, 0, -(idle + 0.55 * open)); setR(T.skull, 0, 0, 0.1 * open);
  P.frame.position.set(0, 0, lunge * 0.05);   // совсем маленький рывок строго вперёд
  // ---- наклон по вертикальной скорости, крен на поворотах
  const pt = sw ? Math.max(-0.5, Math.min(0.5, -(st.vy || 0) * 0.08)) : 0;
  S.pitch += (pt - S.pitch) * Math.min(1, ddt * 5);
  const yaw = dino.rotation.y, wr = ddt > 0 ? wrapA(yaw - S.yaw) / ddt : 0; S.yaw = yaw;
  S.roll += (Math.max(-0.4, Math.min(0.4, wr * 0.1)) - S.roll) * Math.min(1, ddt * 4);
  P.body.rotation.x = sw ? S.pitch : 0; P.body.rotation.z = sw ? S.roll : 0; P.body.position.y = 0;
  // ---- моргание
  S.blink = S.blink === undefined ? 2 + Math.random() * 3 : S.blink; S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.16 ? 1 : 1 - sstep(0.16, 0.36, u); if (u > 0.36) S.blink = 2.5 + Math.random() * 5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}

// ======================================================================== КЛАССЫ ИГРОКА
function pal4(color, extra) { return palette(color, extra); }
function buildCarn(o) {
  const { color, stage, r } = o;
  const pal = pal4(color);
  if ((r.ambush || 0) > 0) pal.stripe = mixHex(pal.stripe, 0x1f3a14, Math.min(0.7, r.ambush * 0.15));
  return tyrannosaur({ pal, pat: { type: 'stripes', amt: 0.6 + (r.ambush || 0) * 0.07, freq: 7, from: 0.05, to: 0.62 }, r, stage, q: o.q });
}
function buildHerb(o) {
  const { color, stage, r } = o;
  return triceratops({ pal: pal4(color), pat: { type: 'spots', amt: 0.68, freq: 3.0, from: 0.12, to: 0.85 }, r, stage, q: o.q });
}
function buildFly(o) {
  const { color, stage, r } = o;
  return pteranodon({ pal: pal4(color), pat: { type: 'bands', amt: 0.35, freq: 5, from: 0.0, to: 0.5 }, r, stage, q: o.q });
}
function buildAqua(o) {
  const { color, stage, r } = o;
  return marine({ k: 1.0, bulk: 1 + (r.lungs || 0) * 0.04, pal: pal4(color, { bellyTo: 0xf2f2ea, bellyK: 0.75 }), pat: { type: 'spots', amt: 0.45, freq: 2.6, from: 0.1, to: 0.8 }, r, stage, q: o.q });
}
// три морских типа игрока: мозазавр (длинный ящер с рельефной головой и вёслами), плиозавр (массивная голова, бочка-тело, четыре огромных ласта), ихтиозавр («дельфин»)
function buildMosaOld(o) {
  const { color, stage, r } = o;
  return marine({ k: 1.0, kind: 'marine', stage, r, q: o.q, bulk: 1 + (r.lungs || 0) * 0.04, ridge: 9, flipK: 1.35, finK: 0.1,
    pal: pal4(color, { bellyTo: 0xeee6cf, bellyK: 0.8, stripe: mulHex(color, 0.45) }), pat: { type: 'bands', amt: 0.4, freq: 7, from: -0.2, to: 0.7 },
    keys: SK([[-3.3, .6, .01, .01, .01], [-3.15, .6, .05, .05, .04], [-2.6, .62, .13, .13, .1], [-1.9, .67, .24, .24, .19], [-1.2, .74, .36, .36, .31], [-0.5, .8, .45 * (1 + (r.lungs || 0) * 0.04), .45, .41], [0.3, .84, .47, .46, .46], [0.95, .87, .38, .36, .35], [1.3, .9, .26, .23, .23],
      [1.55, .93, .26, .2, .27, 2.2, .01], [1.85, .96, .3, .19, .36, 2.2, .1], [2.15, .91, .22, .14, .27, 2.3, .06], [2.55, .87, .14, .09, .15, 2.4], [2.85, .85, .06, .05, .07], [2.95, .85, .01, .01, .01]]),
    bones: [-2.9, -2.2, -1.5, -0.7, 0.3, 1.3, 1.78], rootI: 4, headX: 1.78, eyeX: 1.98, snoutX: 2.78, hingeY: 0.88,
    jawKeys: SK([[1.7, .86, .07, .12, .31, 2.2], [2.15, .78, .06, .1, .24, 2.3], [2.55, .76, .05, .08, .15, 2.4], [2.85, .78, .03, .04, .07], [2.95, .79, .005, .005, .005]]),
    flukeX: -3.2, flukeK: 1.35, dorsal: false, frontX: 0.6, hindX: -0.85 });
}
function buildMosa(o) {
  const { color, stage, r } = o;
  return mosasaurus({ pal: pal4(color, { bellyTo: 0xeee6cf, bellyK: 0.8, stripe: mulHex(color, 0.45) }), pat: { type: 'bands', amt: 0.35, freq: 7, from: -0.2, to: 0.7 }, r, stage, q: o.q });
}
function buildPlio(o) {       // игрок «плиозавр»: Pliosaurus (Sketchfab, GLB со скелетом; tools/plio_bake.py → game/plio.js). Покой — клип Idle (осматривается), плавание — Swim_Slow / Swim_Fast по скорости
  const rig = jpModel(PLIO, { H: 5.6, fly: 1, fy: 0.3, tagH: 2.4, eyeIn: 0.75, eyeDir: [0.2, 0.25], pal: palette(o.color, { bellyTo: 0xe8ecdc, bellyK: 0.7, stripe: mulHex(o.color, 0.45) }), pat: { type: 'spots', amt: 0.4, freq: 3.6, from: 0, to: 0.8 }, irisC: 0xd8a030, slit: 0.3, eyeK: 1.6, jawK: 0.5, crownK: 0.7, q: o.q });
  return rig;
}
function buildIchth(o) {       // игровой класс «ихтиозавр» (id ichth) теперь — мегалодон
  const { color, stage, r } = o;
  return megalodon({ pal: pal4(color, { bellyTo: 0xf4f6f4, bellyK: 0.9 }), pat: null, r, stage, q: o.q });
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
  let rig; try { rig = (BUILDERS[cls] || buildCarn)({ color, stage, r: Object.assign(CONFIG.evoLook(cls, evo || {}), (typeof window !== 'undefined' && window.__evoOverride) || {}), q: 1 }); } finally { PATC = null; MORPH = null; }   // вид модели — по выбранным узлам эволюции
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
// корона: скульпт автора (tools/crn_bake.py → crn.js), 8 зубцов с камнями на остриях; низ на y = 0, ось — y
let CR_GEO = null; const CR_MATS = {};
function crownGeo() {
  if (CR_GEO) return CR_GEO;
  const n = CRN.v.length ? new Int16Array(b64buf(CRN.v)).length / 3 : 0, v = new Int16Array(b64buf(CRN.v)), nr = new Int8Array(b64buf(CRN.n)), k = new Uint8Array(b64buf(CRN.k));
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), col = new THREE.Color();
  for (let i = 0; i < n * 3; i++) { P[i] = v[i] / CRN.s; N[i] = nr[i] / 127; }
  for (let i = 0; i < n; i++) { col.setHex(k[i] === 0 ? 0xd9a830 : 0xffd35a); C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; }   // пояс чуть темнее; камни красятся в материале
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('gem', new THREE.BufferAttribute(Float32Array.from(k, x => (x === 2 ? 1 : 0)), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(b64buf(CRN.f)), 1)); g.computeBoundingSphere();
  return (CR_GEO = g);
}
function crownMat(mode) {
  if (CR_MATS[mode]) return CR_MATS[mode];
  const gem = new THREE.Color(mode === 2 ? 0x4ae8ff : 0xff3a4a), m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.3, emissive: 0x3a2600, emissiveIntensity: 0.8, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {            // камни на остриях — цветные и чуть светятся (атрибут gem = 1)
    sh.uniforms.uGem = { value: gem };
    sh.vertexShader = 'attribute float gem;\nvarying float vGem;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGem = gem;');
    sh.fragmentShader = 'uniform vec3 uGem;\nvarying float vGem;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uGem, vGem);').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGem * vGem * 0.45;');
  };
  m.customProgramCacheKey = () => 'crown_' + mode;
  return (CR_MATS[mode] = m);
}
function crownMesh(mode, size) {            // размер: радиус короны в игровых единицах (король 0.22, владыка эпох 0.27)
  const m = new THREE.Mesh(crownGeo(), crownMat(mode)), k = size / CRN.r; m.scale.setScalar(k);
  m.castShadow = false; m.userData.noOutline = true; m.frustumCulled = false; return m;
}
// отдельная корона (для ролика коронации): центр — на оси, низ на y=0
export function buildCrownMesh(mode) {
  const g = new THREE.Group(); g.add(crownMesh(mode === 2 ? 2 : 1, mode === 2 ? 0.27 : 0.22)); return g;
}
// высота посадки короны: самая высокая точка головы в пределах радиуса короны (в покое) — корона садится сверху и не уходит в голову, фриз и рога
const _cv = new V3(), _cm = new THREE.Matrix4();
function crownBaseY(dino, a, R) {
  dino.updateMatrixWorld(true);
  const inv = _cm.copy(a.head.matrixWorld).invert(), r2 = R * R * 1.1, lo = a.hatY - 0.5, hi = a.hatY + 1.0; let top = -1e9;
  dino.traverse(m => {
    if (!m.isMesh || m.userData.noOutline || (m.material && m.material.side === THREE.BackSide) || !m.geometry.attributes.position) return;
    const P = m.geometry.attributes.position, mw = m.matrixWorld;
    for (let i = 0; i < P.count; i++) {
      _cv.fromBufferAttribute(P, i).applyMatrix4(mw).applyMatrix4(inv);
      if (_cv.y > lo && _cv.y < hi && _cv.x * _cv.x + (_cv.z - a.hatZ) * (_cv.z - a.hatZ) < r2 && _cv.y > top) top = _cv.y;
    }
  });
  return top > -1e8 ? Math.min(top, a.hatY + 0.25 * (R / 0.22)) - 0.02 - R * 0.16 : a.hatY;   // не выше разумного: гребни и хохолки не поднимают корону
}
export function setCrown(dino, mode) {      // mode: 0 нет, 1 король, 2 владыка эпох
  const P = dino.userData.parts, a = P.anch; if (!a) return;
  if (P.crown) { P.crown.parent && P.crown.parent.remove(P.crown); P.crown = null; }
  if (!mode) return;
  const g = new THREE.Group(); P.crown = g;
  const R = (mode === 2 ? 0.27 : 0.22) * (a.crownK || 1);
  put(g, crownMesh(mode === 2 ? 2 : 1, R), 0, crownBaseY(dino, a, R), a.hatZ);
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
      nk[i].rotation.z = pull * (butt ? 0.05 : 0.1) - lunge * (butt ? 0.06 : 0.12) + (roar ? 0.18 : 0) + Math.sin(tt * 0.7) * 0.02 * (1 - run) - run * (butt ? 0.07 : 0.11) / nk.length * 2;
    }
    sp.head.rotation.z = pull * (butt ? 0.04 : 0.06) - lunge * (butt ? 0.05 : 0.06) + (roar ? 0.25 : 0) + run * (0.12 + Math.cos(P.gph * 2) * 0.03);
    sp.head.rotation.y = (swim ? -Math.sin(tP + 1.2) * 0.06 : 0) + shake * 0.16;
    sp.head.rotation.x = shake * 0.12;
  }
  if (P.jaw) P.jaw.rotation.z = (P.jawBase || 0) - open * (butt ? 0.45 : P.aquatic ? 0.55 : P.kind === 'ptero' ? 0.5 : 0.95) - (roar ? 0.6 : 0);
  // всё тело подаётся вперёд в броске и чуть откидывается назад на замахе
  if (P.frame) { P.frame.position.z = (lunge * (butt ? 0.06 : 0.1) - pull * 0.03) * (P.k ? Math.min(1.6, P.k / 0.42) : 1); P.frame.rotation.z = butt ? pull * 0.3 - lunge * 0.1 : -lunge * 0.02 + pull * 0.01; }
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
    const LK = P.legK || 1;     // у толстоногих (трицератопс) суставы сгибаются слабее, чтобы кожа не мялась
    b[1].rotation.z = (-sw1 * ((gait === 'quad' ? 0.45 : 0.6) + run * (gait === 'quad' ? 0.15 : 0.6)) * w + push * run * 0.15) * LK;
    b[2].rotation.z = (sw1 * (0.4 + run * 0.35) - push * run * 0.2) * w * LK;
    if (b[3]) b[3].rotation.z = (-Math.sin(p) * (0.2 + run * 0.15) + sw1 * (0.15 + run * 0.25)) * w * LK;
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
  if (P.trike) { if (dino.userData.bite > 0) dino.userData.bite = Math.max(0, dino.userData.bite - dt * 2.1); animTrike(dino, P, tt, speed, dt, st); return; }
  if (P.ptero) { if (dino.userData.bite > 0) dino.userData.bite = Math.max(0, dino.userData.bite - dt * 1.6); animPtero(dino, P, tt, speed, dt, st); return; }
  if (P.mos) { if (dino.userData.bite > 0) dino.userData.bite = Math.max(0, dino.userData.bite - dt * 1.9); animMos(dino, P, tt, speed, dt, st); return; }
  if (P.shk) { if (dino.userData.bite > 0) dino.userData.bite = Math.max(0, dino.userData.bite - dt * 1.9); animShk(dino, P, tt, speed, dt, st); return; }
  if (P.rex) { if (dino.userData.bite > 0) dino.userData.bite = Math.max(0, dino.userData.bite - dt * 1.45); animRex(dino, P, tt, speed, dt, st); return; }
  if (P.jp) {      // игрок на скелетной модели (плиозавр): покой — клип Idle, плавание — по скорости; наклон по вертикальной скорости, крен на поворотах
    let bite = dino.userData.bite; if (bite > 0) { bite = Math.max(0, bite - dt * 1.9); dino.userData.bite = bite; }
    animJP(dino, P, dt, st.swim === false ? 0 : speed, bite);
    const T = P.jp, S = T.st, ddt = Math.min(Math.max(dt || 0, 0), 0.1);
    if (S.pitch === undefined) { S.pitch = 0; S.roll = 0; S.yaw = dino.rotation.y; }
    const pt = st.swim ? Math.max(-0.5, Math.min(0.5, -(st.vy || 0) * 0.08)) : 0;
    S.pitch += (pt - S.pitch) * Math.min(1, ddt * 5);
    const yaw = dino.rotation.y, wr = ddt > 0 ? wrapA(yaw - S.yaw) / ddt : 0; S.yaw = yaw;
    S.roll += (Math.max(-0.4, Math.min(0.4, wr * 0.1)) - S.roll) * Math.min(1, ddt * 4);
    P.body.rotation.x = S.pitch; P.body.rotation.z = S.roll; return; }
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
  P.body.position.y = bodyBob(P, sw, st.swim, st.fly) + (st.swim ? -0.1 : 0) + crouch + (st.fly ? Math.sin(tt * 2) * 0.06 : 0);
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
  sp.scale.set(2.9, 0.725, 1); sp.renderOrder = 10;
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

// скорпион-страж: ходьба/покой — через общий рантайм animJP (по скорости питомца), удар по врагу — клип areaAttack поверх (вес плавно растёт и спадает)
export function animPetJP(pm, dt) {
  const U = pm.userData, P = U.jpRig; if (!P) return;
  const ddt = Math.min(Math.max(dt || 0, 0), 0.1), pos = pm.position;
  if (U.ws !== undefined) U.spd = U.ws; else {      // (тестовый вызов без актёра: скорость по смещению)
    const sp = U.pp && ddt > 0 ? Math.hypot(pos.x - U.pp[0], pos.z - U.pp[1]) / ddt : 0; U.pp = [pos.x, pos.z];
    U.spd = (U.spd || 0) + (sp - (U.spd || 0)) * Math.min(1, ddt * 16); if (U.spd < 0.08) U.spd = 0; }
  animJP(pm, P, ddt, Math.min(U.spd, 14) / 6, 0);
  if (U.sting >= 0) {
    const D = jpData(P.jp.R), c = D.clips.atk, T = P.jp, bn = T.bones, nb = T.nb; U.sting += ddt / (c.dur / 1.7);
    if (U.sting >= 1) U.sting = -1; else {
      const u = U.sting, w = sstep(0, 0.14, u) * (1 - sstep(0.72, 1, u)), f = u * (c.nf - 1), f0 = Math.floor(f), f1 = Math.min(c.nf - 1, f0 + 1), fa = f - f0;
      for (let b = 0; b < nb; b++) {
        velQ(c, f0, f1, fa, b, nb, _vo); _pA.set(_vo[0], _vo[1], _vo[2], _vo[3]).normalize();
        if (bn[b].quaternion.dot(_pA) < 0) { _pA.x = -_pA.x; _pA.y = -_pA.y; _pA.z = -_pA.z; _pA.w = -_pA.w; }
        bn[b].quaternion.slerp(_pA, w);
      }
    }
  }
}
// ---------------------------------------------------------------- питомцы: маленькие следующие за игроком существа
let GROUND_FN = null;
export function setPetGround(f) { GROUND_FN = f; }
// ---- ящерка-питомец: скелетная модель с одним клипом (волнообразное движение хвоста и головы). Ходьба: клип ускоряется с ходом + шаги лапами поверх (диагональная походка)
const _lzB64 = (b) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
let _lzTex = null;
function lizardModel() {
  const D = LZD, n = D.n, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(_lzB64(D.P)), 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(_lzB64(D.N)), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(_lzB64(D.UV)), 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(new Uint8Array(_lzB64(D.SI))), 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(_lzB64(D.SW)), 4));
  geo.setIndex(new THREE.BufferAttribute(D.f32 ? new Uint32Array(_lzB64(D.F)) : new Uint16Array(_lzB64(D.F)), 1));
  if (!_lzTex) { const img = new Image(); _lzTex = new THREE.Texture(img); _lzTex.flipY = false; _lzTex.colorSpace = THREE.SRGBColorSpace; _lzTex.anisotropy = 4; img.onload = () => { _lzTex.needsUpdate = true; }; img.src = 'data:image/jpeg;base64,' + D.tex; }
  const bones = D.bones.map(b => { const o = new THREE.Bone(); o.name = b.n; o.position.fromArray(b.t); o.quaternion.fromArray(b.q); o.scale.fromArray(b.s); return o; });
  D.bones.forEach((b, i) => { if (b.p >= 0) bones[b.p].add(bones[i]); });
  const ibm = new Float32Array(_lzB64(D.IBM)), inv = D.joints.map((j, k) => new THREE.Matrix4().fromArray(ibm, k * 16));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: _lzTex, roughness: 0.85, metalness: 0 }));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(D.joints.map(j => bones[j]), inv), new THREE.Matrix4());
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const tracks = D.tr.map(t => { const nm = bones[t.b].name + '.' + (t.p === 'q' ? 'quaternion' : t.p === 'p' ? 'position' : 'scale'), T = new Float32Array(_lzB64(t.t)), V = new Float32Array(_lzB64(t.v)); return t.p === 'q' ? new THREE.QuaternionKeyframeTrack(nm, T, V) : new THREE.VectorKeyframeTrack(nm, T, V); });
  const mixer = new THREE.AnimationMixer(bones[0]), act = mixer.clipAction(new THREE.AnimationClip('wiggle', -1, tracks));       // один клип: в покое идёт медленно, при ходьбе быстрее
  act.play(); act.timeScale = 0.35;
  const by = (nm) => bones[D.bones.findIndex(b => b.n === nm)], legs = [['thigh_l', 0, 1, 'calf_l', 'foot_l'], ['thigh_r', Math.PI, 1, 'calf_r', 'foot_r'], ['upperarm_l', Math.PI, 0.7, 'lowerarm_l', 'hand_l'], ['upperarm_r', 0, 0.7, 'lowerarm_r', 'hand_r']].map(([nm, ph, k, c, f]) => ({ b: by(nm), ph, k, c: by(c), f: by(f) }));
  const sc = (1.0 / (D.bb[1][2] - D.bb[0][2])) * 1.05, wrap = new THREE.Group(), body = new THREE.Group(); body.scale.setScalar(sc); body.rotation.y = Math.PI / 2; body.add(mesh); wrap.add(body);
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qd = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3(0, 0, 1), S = { ts: 0.35, amp: 0, ph: 0, lt: null };
  wrap.userData.update = (t, spd) => {
    const dt = S.lt == null ? 0.016 : Math.min(0.1, Math.max(0, t - S.lt)); S.lt = t; S.sp = (S.sp || 0) + (spd - (S.sp || 0)) * (1 - Math.exp(-dt * 6));
    const mv = Math.min(1, Math.max(0, (S.sp - 0.03) / 0.4)), k = 1 - Math.exp(-dt * 7), e = mv * mv * (3 - 2 * mv);
    S.amp += (e - S.amp) * k; S.ts += ((0.35 + mv * 0.4) - S.ts) * k; S.ph += dt * (2.6 + Math.min(S.sp, 10) * 0.8);
    act.timeScale = S.ts; mixer.update(dt);
    if (S.amp > 0.002) { mesh.updateMatrixWorld(true);       // шаги: бедро качается вокруг боковой оси мира (перёд-назад), голень сгибается при переносе вперёд (стопа поднимается); левые/правые в противофазе
      for (const L of legs) { const sn = Math.sin(S.ph + L.ph), th = -sn * 0.46 * S.amp * L.k; L.b.parent.getWorldQuaternion(qa); L.b.getWorldQuaternion(qb); qc.setFromAxisAngle(ax, th); L.b.quaternion.copy(qa).invert().multiply(qc).multiply(qb);
        if (L.c) { L.b.updateMatrixWorld(true); const bn = Math.max(0, sn) * 0.7 * S.amp * L.k; L.c.parent.getWorldQuaternion(qa); L.c.getWorldQuaternion(qb); qc.setFromAxisAngle(ax, bn); L.c.quaternion.copy(qa).invert().multiply(qc).multiply(qb); }
        if (L.f) { L.c.updateMatrixWorld(true); const fa = (Math.cos(S.ph + L.ph) * 0.55 - Math.max(0, sn) * 0.25) * S.amp * L.k; L.f.parent.getWorldQuaternion(qa); L.f.getWorldQuaternion(qb); qc.setFromAxisAngle(ax, fa); L.f.quaternion.copy(qa).invert().multiply(qc).multiply(qb); } } }
  };
  return wrap;
}

export function buildPet(id) {
  const g = new THREE.Group(), M = (c, e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: e || 0x000000 });
  const sph = (r, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m); o.position.set(x, y, z); o.scale.set(sx || 1, sy || 1, sz || 1); g.add(o); return o; };
  const eye = (x, y, z) => sph(0.04, M(0x111111), x, y, z);
  if (id === 'lizard') {
    const lm = lizardModel(); g.add(lm); g.userData.anim = (t, spd) => lm.userData.update(t, spd); g.userData.noHop = true;
  } else if (id === 'chick') {
    const m = M(0xffd84a); sph(0.24, m, 0, 0.26, 0); sph(0.15, m, 0.12, 0.5, 0); eye(0.24, 0.55, 0.07); eye(0.24, 0.55, -0.07);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), M(0xff9a2a)); beak.rotation.z = -Math.PI / 2; beak.position.set(0.3, 0.5, 0); g.add(beak);
    sph(0.1, m, -0.05, 0.3, 0.2, 1.4, 0.5, 0.5); sph(0.1, m, -0.05, 0.3, -0.2, 1.4, 0.5, 0.5);
  } else if (id === 'hedgehog') {      // внутренний id прежний (чтобы не сломать сохранения); сейчас это скорпион-страж (Sketchfab, чёрный; скелет и клипы idle/walk/areaAttack)
    const rig = jpModel(SCP, { H: 1.0, foot: 0.08, pal: palette(0x202020), q: 0.6 });
    const wrap = new THREE.Group(); wrap.rotation.y = Math.PI / 2; wrap.add(rig.root); g.add(wrap);      // у скелетных моделей перёд = +z, у питомцев — +x
    g.userData.jpRig = rig; g.userData.noHop = true; g.userData.sting = -1; g.userData.pp = null;
  } else if (id === 'seahorse') {      // морской конёк: изогнутое тело из шаров, длинная морда, спинной плавник; плывёт вертикально
    const m = M(0xf08a30, 0x4a1c00), pts = [[0, 0.55, 0, 0.17], [-0.02, 0.38, 0, 0.19], [-0.05, 0.2, 0, 0.17], [-0.02, 0.06, 0, 0.13], [0.08, 0, 0, 0.1], [0.14, 0.07, 0, 0.07]];
    for (const [x, y, z, r] of pts) sph(r, m, x, y, z);
    sph(0.16, m, 0.03, 0.74, 0, 1.1, 0.95, 0.9); const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.24, 8), m); snout.rotation.z = -Math.PI / 2; snout.position.set(0.24, 0.72, 0); g.add(snout);
    eye(0.1, 0.8, 0.08); eye(0.1, 0.8, -0.08);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 3), M(0xffc060, 0x3a1800)); fin.rotation.z = Math.PI / 2; fin.position.set(-0.2, 0.36, 0); fin.scale.set(1, 1, 0.3); g.add(fin);
    g.userData.anim = (t) => { fin.rotation.y = Math.sin(t * 14) * 0.5; };
  } else if (id === 'crab') {          // краб: плоский панцирь, две клешни, шесть ног, глаза на стебельках
    const m = M(0xd8452c, 0x300800); sph(0.26, m, 0, 0.2, 0, 1.2, 0.55, 1.0);
    const claws = [];
    for (const sd of [1, -1]) {
      const arm = new THREE.Group(); arm.position.set(0.28, 0.2, sd * 0.2); g.add(arm);
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 6), m); a.rotation.z = Math.PI / 2; a.position.x = 0.1; arm.add(a);
      const c1 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m); c1.scale.set(1.3, 0.8, 0.9); c1.position.set(0.28, 0, sd * 0.03); arm.add(c1);
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 6), m); c2.rotation.z = -Math.PI / 2; c2.position.set(0.42, 0, sd * 0.03); arm.add(c2); claws.push(arm);
    }
    const legs = [];
    for (let i = 0; i < 3; i++) for (const sd of [1, -1]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.3, 5), m); l.position.set(-0.12 + i * 0.12, 0.1, sd * 0.3); l.rotation.x = sd * 1.0; g.add(l); legs.push([l, sd, i]);
    }
    for (const sd of [1, -1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 5), m); st.position.set(0.18, 0.4, sd * 0.1); g.add(st); sph(0.035, M(0x111111), 0.18, 0.46, sd * 0.1); }
    g.userData.anim = (t, spd) => { const a = Math.min(1, spd / 2); for (const [l, sd, i] of legs) l.rotation.x = sd * (1.0 + Math.sin(t * 16 + i * 2 + (sd > 0 ? 0 : 3)) * 0.35 * a); claws.forEach((c, k) => { c.rotation.z = Math.sin(t * 3 + k) * 0.12; }); };
  } else if (id === 'puffer') {        // фугу: круглая жёлтая рыбка с шипами и хвостом; при уколе раздувается
    const m = M(0xf2d24a, 0x3a2a00), body = new THREE.Group(); g.add(body); body.position.y = 0.3;
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), m); sp.scale.set(1.15, 1, 1); body.add(sp);
    const bel = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), M(0xfff4c8)); bel.position.set(0.02, -0.1, 0); bel.scale.set(1.1, 0.7, 0.95); body.add(bel);
    const spm = M(0xc88a20);
    for (let i = 0; i < 26; i++) { const u = Math.acos(1 - 2 * (i + 0.5) / 26), v = i * 2.399963, n = new THREE.Vector3(Math.sin(u) * Math.cos(v), Math.cos(u), Math.sin(u) * Math.sin(v));
      if (n.y < -0.5) continue; const c = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 5), spm); c.position.copy(n).multiplyScalar(0.27).multiply(new THREE.Vector3(1.15, 1, 1)); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); body.add(c); }
    for (const sd of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M(0xffffff)); e.position.set(0.22, 0.1, sd * 0.15); body.add(e); const pu = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M(0x111111)); pu.position.set(0.26, 0.1, sd * 0.16); body.add(pu);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 3), M(0xe8b830)); f.rotation.x = sd * 1.4; f.position.set(0.02, -0.02, sd * 0.28); f.scale.z = 0.3; body.add(f); }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 3), M(0xe8b830)); tail.rotation.z = Math.PI / 2; tail.position.set(-0.36, 0, 0); tail.scale.z = 0.3; body.add(tail);
    g.userData.anim = (t, spd) => { const st = g.userData.sting; let k = 1; if (st >= 0) { g.userData.sting = st + 0.016 * 2.2; k = 1 + 0.55 * Math.sin(Math.min(1, st) * Math.PI); if (g.userData.sting >= 1) g.userData.sting = -1; } body.scale.setScalar(k); tail.rotation.y = Math.sin(t * 9) * 0.5; };
    g.userData.sting = -1;
  } else if (id === 'jelly') {         // медуза: светящийся купол и щупальца
    const cm = new THREE.MeshBasicMaterial({ color: 0x66e8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), cm); bell.position.y = 0.55; g.add(bell);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd8fbff })); core.position.y = 0.6; g.add(core);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: 0x66e8ff, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending })); halo.position.y = 0.55; g.add(halo);
    const ten = [];
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, t0 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.5, 5), new THREE.MeshBasicMaterial({ color: 0x9af0ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); t0.geometry.translate(0, -0.25, 0); t0.position.set(Math.cos(a) * 0.17, 0.5, Math.sin(a) * 0.17); g.add(t0); ten.push([t0, a]); }
    g.userData.anim = (t) => { const p = 1 + Math.sin(t * 3) * 0.08; bell.scale.set(p, 1 / p, p); ten.forEach(([o, a]) => { o.rotation.x = Math.sin(t * 3 + a) * 0.25; o.rotation.z = Math.cos(t * 2.6 + a * 2) * 0.25; }); };
  } else {
    const m = new THREE.MeshBasicMaterial({ color: 0xfff2a0 }); sph(0.1, m, 0, 0.9, 0);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending })); halo.position.y = 0.9; g.add(halo);
    const halo2 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })); halo2.position.y = 0.9; g.add(halo2);
  }
  g.userData.id = id; g.userData.fly = id === 'firefly' || id === 'seahorse' || id === 'puffer' || id === 'jelly'; g.userData.sk = id === 'hedgehog' ? 1.0 : id === 'lizard' ? 0.7 : id === 'crab' ? 0.8 : 0.55; g.userData.minS = id === 'hedgehog' ? 1.15 : 0.8; g.userData.ph = Math.random() * 6;
  return g;
}

function titleText(id) { const t = id && CONFIG.TITLES[id]; return t && typeof window !== 'undefined' && window.TN ? t.ico + ' ' + window.TN(t.n) : ''; }
let _auraTex = null;
function auraSprite() {   // золотое свечение «Владыки Эпох»
  if (!_auraTex) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), q = g.createRadialGradient(64, 64, 0, 64, 64, 64); q.addColorStop(0, 'rgba(255,230,140,.55)'); q.addColorStop(0.45, 'rgba(255,200,80,.28)'); q.addColorStop(1, 'rgba(255,190,60,0)'); g.fillStyle = q; g.fillRect(0, 0, 128, 128); _auraTex = new THREE.CanvasTexture(c); }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _auraTex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(7.5); s.position.set(0, 1.3, 0); s.renderOrder = 5; return s;
}
export function makeActor({ nick, color, cls, level, evo, cosmetic, admin, king, lord, label, pet, title, patc, morph, colorIdx, end }) {
  const group = new THREE.Group();
  const actor = { title: title || '', patc: patc || '', morph: morph || '', group, color: CONFIG.COLORS[color] != null ? CONFIG.COLORS[color] : color, cls, level, evo: evo || {}, cosmetic: cosmetic || '', dino: null, tag: null, king: king ? 1 : 0, lord: lord ? 1 : 0, end: end || '', aura: null, admin: !!admin, nick, st: {} };
  function rebuild() {
    if (actor.dino) group.remove(actor.dino);
    actor.dino = buildDino({ cls, color: actor.color, level: actor.level, evo: actor.evo, cosmetic: actor.cosmetic, patc: actor.patc, morph: actor.morph });
    group.add(actor.dino); setCrown(actor.dino, actor.lord ? 2 : actor.king ? 1 : 0);
    actor.aura = null; if (actor.end === 'lord') { actor.aura = auraSprite(); actor.dino.add(actor.aura); }
    if (actor.tag) group.remove(actor.tag);
    actor.tag = makeNameTag(nick, { badge: actor.admin ? '★Admin' : '', color: actor.admin ? '#ffd35a' : actor.lord ? '#7af0ff' : '#ffffff', sub: label || titleText(actor.title) });
    group.add(actor.tag);
    actor.tag.position.y = (cls === 'fly' ? 2.5 : 2.3) * Sim.scaleOf(actor.level) + 0.7 + (['party', 'tophat', 'wizard', 'viking', 'flower', 'plume', 'skullhat'].indexOf(actor.cosmetic) >= 0 ? 0.45 : 0);
  }
  rebuild();
  actor.petId = ''; actor.petM = null; actor.groundFn = (x, z) => GROUND_FN ? GROUND_FN(x, z) : null;
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
    if (o.end != null && o.end !== actor.end) { actor.end = o.end; r = true; }
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
    if (actor.aura) { const k = 1 + 0.08 * Math.sin(t * 2.2); actor.aura.scale.setScalar(7.5 * k); actor.aura.material.opacity = 0.75 + 0.2 * Math.sin(t * 1.6); }
    const pm = actor.petM;
    if (pm) {
      const U = pm.userData, sc = Sim.scaleOf(actor.level), ps = Math.max(U.minS || 0.8, (U.minS || 0.8) - 0.36 * (U.sk || 0.55) + sc * (U.sk || 0.55));   // размер питомца растёт вместе с игроком
      const d = 0.9 * sc + 0.45 * ps + 0.3, lat = 0.3 * sc + 0.2, tx = x - Math.sin(face) * d + Math.cos(face) * lat, tz = z - Math.cos(face) * d - Math.sin(face) * lat;   // цель — в мировых координатах
      if (!U.W) U.W = [tx, tz];
      let dx = tx - U.W[0], dz = tz - U.W[1], dd = Math.hypot(dx, dz); const ox = U.W[0], oz = U.W[1];
      if (dd > 9 + sc * 3) { U.W[0] = tx; U.W[1] = tz; dx = dz = dd = 0; }
      else if (dd > 0.05 * ps) { const k = 1 - Math.exp(-dt * 10); U.W[0] += dx * k; U.W[1] += dz * k; }       // быстро нагоняет и сразу замирает, когда игрок встал
      const wsp = dt > 0 ? Math.hypot(U.W[0] - ox, U.W[1] - oz) / dt : 0; U.ws = (U.ws || 0) + (wsp - (U.ws || 0)) * Math.min(1, dt * 14); if (U.ws < 0.06) U.ws = 0;
      pm.position.x = U.W[0] - x; pm.position.z = U.W[1] - z;
      let hd = face - Math.PI / 2; if (dd > 1.4 * ps) hd = Math.atan2(-dz, dx);   // dx,dz — куда ещё идти      // у цели смотрит туда же, куда игрок; издалека — по ходу бега
      let da = hd - pm.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); pm.rotation.y += da * (1 - Math.exp(-dt * 9));
      let wx = x + pm.position.x, wz = z + pm.position.z, gh = actor.groundFn ? actor.groundFn(wx, wz) : null, base = gh == null ? 0 : gh - y; if (U.id === 'crab') base = Math.max(base, -(1.2 * sc + 0.8));
      let py, pitch = 0;
      if (!U.fly && actor.groundFn && gh != null && U.id !== 'crab') {       // длинное тело на склоне: берём самую высокую из трёх точек (нос, центр, хвост) и наклоняем по уклону — не проваливается в гору
        const hl = (U.id === 'lizard' ? 0.5 : 0.3) * ps, ry = pm.rotation.y, fx = Math.cos(ry) * hl, fz = -Math.sin(ry) * hl, h1 = actor.groundFn(wx + fx, wz + fz), h2 = actor.groundFn(wx - fx, wz - fz);
        if (h1 != null && h2 != null) { base = Math.max(gh, h1, h2) - y + 0.02 * ps; pitch = Math.atan2(h1 - h2, 2 * hl) * 0.9; }
      }
      pm.rotation.z += (pitch - pm.rotation.z) * (1 - Math.exp(-dt * 10));
      if (U.fly) py = Math.max(base + 0.25 * ps, (U.id === 'firefly' ? 0.6 * sc : 0.25 * sc + 0.3 * ps) + Math.sin(t * 2.4 + U.ph) * 0.12 * ps);
      else py = base + (U.noHop ? 0 : Math.max(0, Math.sin(t * 9 + U.ph)) * Math.min(0.25, dd * 0.3));
      pm.position.y += (py - pm.position.y) * (1 - Math.exp(-dt * 18)); if (Math.abs(py - pm.position.y) > 3) pm.position.y = py;
      pm.scale.setScalar(ps);
      if (U.jpRig) animPetJP(pm, dt); else if (U.anim) U.anim(t, U.ws / ps);
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
// ======================================================================== ПЛЕЗИОЗАВР (Dino Crisis 2, FBX без скелета → tools/ples_bake.py → game/ples.js)
// Тело, шея и голова — одно жёсткое целое (голова не качается), хвост — 2 кости с бегущей волной, 4 ласта машут «подводным полётом».
// Глаза нарисованы в текстуре модели, поверх — веки (моргание). Окраска: родная текстура × оттенок врага.
const PL_D = new Map();
function plData(R) {
  let D = PL_D.get(R); if (D) return D;
  const v = new Int16Array(b64buf(R.v)), n = v.length / 3, P = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) P[i] = v[i] / R.s;
  const nr = new Int8Array(b64buf(R.n)), N = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) N[i] = nr[i] / 127;
  const uv = new Uint16Array(b64buf(R.uv)), UVa = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) UVa[i] = uv[i] / 65535;
  D = { n, P, N, UV: UVa, F: new Uint16Array(b64buf(R.f)), SI: new Uint8Array(b64buf(R.si)), SW: new Uint8Array(b64buf(R.sw)) };
  PL_D.set(R, D); return D;
}
let PL_T = null;
function plesioModel(R, o) {
  const D = plData(R), n = D.n, s = (o.L || 6) / R.len, pal = o.pal, nb = R.par.length;
  const cx = R.x0 + R.len / 2, cy = 75, tint = hx(o.color || 0x6a8a6a), mxc = Math.max(tint.r, tint.g, tint.b, 0.01);
  tint.setRGB(1 + (tint.r / mxc - 1) * 0.8, 1 + (tint.g / mxc - 1) * 0.8, 1 + (tint.b / mxc - 1) * 0.8).multiplyScalar(o.bright || 1.9);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), P = D.P;
  const ev = R.eyes;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (P[i * 3] - cx) * s; pos[i * 3 + 1] = (P[i * 3 + 1] - cy) * s; pos[i * 3 + 2] = P[i * 3 + 2] * s;
    let nearEye = 0; for (const e of ev) { const d = Math.hypot(P[i * 3] - e[0], P[i * 3 + 1] - e[1], P[i * 3 + 2] - e[2]); if (d < 11) nearEye = Math.max(nearEye, 1 - d / 11); }
    col[i * 3] = tint.r + (1.4 - tint.r) * nearEye * 0; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
    if (nearEye > 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1.6; }                // глаз — без оттенка (родная радужка)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.N), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(D.UV, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(new Uint32Array(D.F), 1));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) { si[i] = D.SI[i]; sw[i] = D.SW[i] / 255; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const bones = [], rest = [];
  for (let i = 0; i < nb; i++) { const bn = new THREE.Bone(); bones.push(bn); const p = R.pos[i]; rest.push(new V3((p[0] - cx) * s, (p[1] - cy) * s, p[2] * s)); }
  for (let i = 0; i < nb; i++) { const p = R.par[i]; if (p >= 0) { bones[i].position.copy(rest[i]).sub(rest[p]); bones[p].add(bones[i]); } else bones[i].position.copy(rest[i]); }
  if (!PL_T) { PL_T = new THREE.TextureLoader().load('data:image/jpeg;base64,' + R.tex); PL_T.flipY = false; PL_T.colorSpace = THREE.SRGBColorSpace; PL_T.anisotropy = 4; }
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: PL_T, vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }));
  mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  geo.computeBoundingSphere(); mesh.boundingSphere = geo.boundingSphere.clone(); mesh.boundingSphere.radius *= 1.3;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rig = baseRig('aqua'); rig.frame.add(mesh);
  rig.spine = { root: bones[0], tail: [bones[1], bones[2]], neck: [], head: bones[0] };
  // ---- веки поверх нарисованных глаз (голова — часть корпуса, кость 0)
  const head = bones[0], headO = rest[0], lids = [], eyeKit = new Kit();
  const lidMat = new THREE.MeshStandardMaterial({ color: hx(0x24342e).lerp(hx(o.color || 0x6a8a6a), 0.18), roughness: 0.75 }), lidG = new THREE.SphereGeometry(1, 20, 12);
  for (let k = 0; k < 2; k++) {
    const e = ev[k], sd = e[2] > 0 ? 1 : -1, pe = new V3((e[0] - cx) * s, (e[1] - cy) * s, e[2] * s), ER = 2.4 * s;
    const dir = new V3(0.3, 0.2, sd * 0.93).normalize(), ex = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(), ey = new V3().crossVectors(dir, ex), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, dir));
    const eg = new THREE.Group(); eg.position.copy(pe).sub(headO); eg.quaternion.copy(qd); head.add(eg);
    { const c0 = pe.clone().addScaledVector(dir, -ER * 0.7), iris = c0.clone().addScaledVector(dir, ER * 0.5);
      eyeKit.add(head, headO, 'eye', eyeG(), M_ell(c0, [ER, ER, ER * 0.92], qd), 0x0c0a08);
      eyeKit.add(head, headO, 'eye', eyeG(), M_ell(iris, [ER * 0.8, ER * 0.8, ER * 0.55], qd), mulHex(0xe0a020, 0.75));
      eyeKit.add(head, headO, 'eye', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.5), [ER * 0.3, ER * 0.7, ER * 0.14], qd), 0x050403);
      eyeKit.add(head, headO, 'glow', UNIT.sphLo, M_ell(iris.clone().addScaledVector(dir, ER * 0.58).addScaledVector(ey, ER * 0.3).addScaledVector(ex, ER * 0.25), [ER * 0.11, ER * 0.11, ER * 0.08]), 0xfffaf0); }
    const LR = ER * 1.1, Fd = LR * 0.5;
    const mkLid = (sgn) => { const g = new THREE.Group(); g.position.set(0, sgn * LR, 0); const m = new THREE.Mesh(lidG, lidMat); m.scale.set(LR * 1.15, LR * 1.1, Fd * 0.70); m.position.set(0, -sgn * LR, Fd * 0.1); m.castShadow = false; m.userData.noOutline = true; g.add(m); g.scale.y = 0.02; g.visible = false; eg.add(g); return g; };
    void ({ tp: mkLid(1), bp: mkLid(-1) });
  }
  eyeKit.build({});
  { let topY = -1e9, topX = 0; for (let i = 0; i < n; i++) if (P[i * 3] > 470 && P[i * 3 + 1] > topY) { topY = P[i * 3 + 1]; topX = P[i * 3]; }
    const e0 = ev[0], nk = new V3((300 - cx) * s, (150 - cy) * s, 0);
    setHeadAnch(rig, head, new V3((topX - cx) * s, (topY - cy) * s, 0).sub(headO), new V3((e0[0] - cx) * s, (e0[1] - cy) * s, Math.abs(e0[2]) * s).sub(headO), nk); }
  rig.anch.crownK = 0.9;
  rig.walkAmp = 0; rig.gait = 'swim'; rig.aquatic = true; rig.k = 0.95;
  rig.tagH = (R.h - cy) * s + 0.4;
  rig.pl = { R, s, lids, bones, rest, nb, st: null, flapK: o.flapK || 1 };
  return rig;
}
const _plq = new THREE.Quaternion(), _plq2 = new THREE.Quaternion(), _plX = new V3(1, 0, 0), _plY = new V3(0, 1, 0);
function animPles(dino, P, dt, speed, bite) {
  const T = P.pl, bn = T.bones, ddt = Math.min(Math.max(dt || 0, 0), 0.1), sp = Math.min(Math.max(speed, 0), 1.4);
  const S = T.st || (T.st = { ph: Math.random(), sm: 0, blink: 2 + Math.random() * 3 });
  S.sm += (sp - S.sm) * Math.min(1, ddt * 3);
  const f = 0.45 + S.sm * 0.95; S.ph = (S.ph + ddt * f) % 1;                    // частота взмахов растёт со скоростью
  const w = S.ph * PI * 2, A = (0.38 + 0.2 * Math.min(1, S.sm)) * T.flapK;
  const bc = biteCurve(bite || 0), lunge = bc ? bc.lunge : 0;
  const flip = (b, sd, ph, a, tw) => {
    const up = Math.sin(w + ph) * a, twist = Math.cos(w + ph) * tw;
    _plq.setFromAxisAngle(_plX, -sd * up); _plq2.setFromAxisAngle(new V3(0, 0, 1), sd * twist); bn[b].quaternion.copy(_plq).multiply(_plq2);
  };
  flip(3, 1, 0, A, 0.3); flip(4, -1, 0, A, 0.3); flip(5, 1, 1.3, A * 0.75, 0.25); flip(6, -1, 1.3, A * 0.75, 0.25);
  const ya = 0.05 + 0.1 * Math.min(1, S.sm);
  _plq.setFromAxisAngle(_plY, Math.sin(w * 0.5 + 0.4) * ya); bn[1].quaternion.copy(_plq);
  _plq.setFromAxisAngle(_plY, Math.sin(w * 0.5 - 0.5) * ya * 1.5); bn[2].quaternion.copy(_plq);
  bn[0].quaternion.identity();
  bn[0].position.copy(T.rest[0]); bn[0].position.y += Math.sin(w * 2 + 1) * 0.012 * T.R.len * T.s * 0.1 * (0.4 + S.sm);
  P.frame.position.set(0, 0, lunge * 0.05);                                       // укус: рывок вперёд совсем небольшой, строго по ходу
  S.blink -= ddt; let bl = 0;
  if (S.blink < 0) { const u = -S.blink; bl = u < 0.08 ? sstep(0, 0.08, u) : u < 0.13 ? 1 : 1 - sstep(0.13, 0.33, u);
    if (u > 0.33) S.blink = Math.random() < 0.18 ? 0.15 : 2.5 + Math.random() * 3.5; }
  if (typeof window !== 'undefined' && window.__mosBlink != null) bl = window.__mosBlink;
  for (const l of T.lids) { const ty = 0.05 + bl * 0.95; l.tp.scale.y = ty; l.bp.scale.y = 0.02 + bl * 0.7; l.tp.visible = ty > 0.12; l.bp.visible = bl > 0.15; }
}

const ENEMY_DEF = {
  compy: (a) => jpModel(COMP, { H: 0.9, irisC: 0xd8602a, slit: 0.5, eyeK: 0.9, pal: palette(a.color, { bellyTo: 0xe8e4c0, bellyK: 0.5, stripe: mulHex(a.color, 0.55) }), pat: { type: 'stripes', amt: 0.55, freq: 6, from: 0.05, to: 0.6 }, q: 0.55 }),
  ashling: (a) => jpModel(COMP, { H: 0.95, irisC: 0xff8a2a, slit: 0.5, eyeK: 0.9, pal: palette(a.color, { bellyTo: 0xcfc2b0, bellyK: 0.45, stripe: mulHex(a.color, 0.5) }), pat: { type: 'stripes', amt: 0.7, freq: 6, from: 0.05, to: 0.6 }, q: 0.55, emis: 0x1a0600 }),
  hare: (a) => quadruped({ k: 0.42, head: 'hare', bulk: 1.1, legK: 0.75, tailK: 0.2, neckK: 0.35, neckUp: 0.2, eyeK: 1.5, pal: palette(a.color, { bellyTo: 0xffffff }), pat: null, q: 0.55, legW: 0.8, extras: ({ S, kit, k }) => kit.add(S.bones[0], S.rest[0], 'skin', UNIT.sph, M_ell(S.rest[0].clone(), [0.22 * k, 0.22 * k, 0.22 * k]), 0xffffff, true) }),
  goat: (a) => quadruped({ k: 0.48, head: 'goat', bulk: 0.85, legK: 1.15, tailK: 0.3, neckK: 0.7, neckUp: 0.25, pal: palette(a.color), pat: null, q: 0.55, legW: 0.7 }),
  gecko: (a) => sprawler({ k: 0.32, snoutK: 0.45, tailK: 1.25, legW: 1.2, pal: palette(a.color), pat: { type: 'spots', amt: 0.6, freq: 6 }, q: 0.55, teeth: false, scutes: false, eyeK: 1.4 }),
  frog: (a) => frog({ k: 0.9, pal: palette(a.color, { bellyTo: 0xf0f0c0 }), pat: { type: 'spots', amt: 0.5, freq: 5 } }),
  toxfrog: (a) => frog({ k: 1.0, pal: palette(a.color, { stripe: 0x1a1a1a }), pat: { type: 'spots', amt: 0.8, freq: 7 }, irisC: 0xff4030 }),
  bug: (a) => bug({ k: 1.0, pal: palette(a.color, { back: 0x2a6a9a, stripe: 0x14304a }), wingC: 0xd6f0ff }),
  ember: (a) => bug({ k: 1.0, moth: true, glow: true, pal: palette(a.color, { stripe: 0x6a2a00 }), wingC: 0xffa040, emis: 0x401400 }),
  fish: (a) => marine({ k: 0.22, kind: 'fish', pal: palette(a.color, { bellyTo: 0xf4f6f0, bellyK: 0.8 }), pat: { type: 'stripes', amt: 0.35, freq: 4 }, q: 0.45, keys: [{ x: -2.4, y: 1.8, top: .02, bot: .02, w: .01 }, { x: -2.2, y: 1.8, top: .12, bot: .12, w: .06 }, { x: -1.4, y: 1.8, top: .55, bot: .55, w: .3 }, { x: -0.2, y: 1.82, top: .85, bot: .8, w: .45 }, { x: 0.9, y: 1.82, top: .7, bot: .65, w: .4 }, { x: 1.6, y: 1.8, top: .4, bot: .36, w: .28 }, { x: 1.9, y: 1.78, top: .1, bot: .1, w: .08 }], bones: [-1.8, -0.9, 0.1, 1.2], rootI: 2, headX: 1.2, eyeX: 1.45, jaw: false, flippers: false, flukeX: -2.2, flukeK: 1.6, dorsalX: -0.2, dorsalK: 2.2, eyeK: 2.2, ridge: 0, glowEyes: !!a.glow, irisC: a.glow, extras: a.glow ? ({ L, S, kit, k }) => glowDots(L, S, kit, k, a.glow, 4, -1.4, 0.8, 0.06) : undefined }),
  eel: (a) => marine({ k: 0.42, kind: 'fish', pal: palette(a.color), pat: { type: 'spots', amt: 0.5, freq: 3 }, q: 0.6, keys: [{ x: -3.4, y: 0.9, top: .01, bot: .01, w: .01 }, { x: -3.2, y: 0.9, top: .06, bot: .06, w: .05 }, { x: -2.0, y: 0.9, top: .14, bot: .14, w: .12 }, { x: -0.5, y: 0.9, top: .2, bot: .2, w: .18 }, { x: 0.8, y: 0.9, top: .22, bot: .22, w: .2 }, { x: 1.4, y: 0.9, top: .22, bot: .18, w: .2, sq: 2.3 }, { x: 1.9, y: 0.88, top: .12, bot: .09, w: .12 }, { x: 2.1, y: 0.87, top: .02, bot: .02, w: .02 }], bones: [-2.8, -2.0, -1.2, -0.4, 0.4, 1.1, 1.45], rootI: 4, headX: 1.4, eyeX: 1.6, snoutX: 2.0, hingeY: 0.85, jawKeys: [{ x: 1.35, y: 0.85, top: .05, bot: .08, w: .15 }, { x: 1.8, y: 0.83, top: .04, bot: .05, w: .1 }, { x: 2.05, y: 0.84, top: .005, bot: .005, w: .005 }], flippers: false, flukeX: -3.1, flukeK: 0.7, dorsalX: -1.2, dorsalK: 0.8, ridge: 0, glowEyes: true, irisC: 0xffd23a, emis: a.burn ? 0x2a0800 : undefined, extras: a.burn ? ({ L, S, kit, k }) => glowDots(L, S, kit, k, 0xff7a2a, 8, -2.8, 1.0, 0.05) : undefined }),
  brachio: (a) => brachiosaurus({ pal: palette(a.color, { bellyTo: mulHex(a.color, 1.25) }), pat: null, q: 0.75 }),
  spino: (a) => jpModel(SPN, { H: 2.34, raw: 1, lidK: 0.8, tagH: 3.5, pal: palette(a.color), irisC: 0xe8c040, slit: 0.28, eyeK: 1, jawK: 0.6, foot: 0.02, q: 1 }),
  raptor: (a) => velociraptor({ pal: palette(a.color), pat: { type: 'stripes', amt: 0.8, freq: 8, from: 0.05, to: 0.66 }, q: 0.7 }),
  frostwolf: (a) => jpModel(TROO, { H: 1.85, irisC: 0x9ad8ff, slit: 0.3, eyeK: 0.78, mouthK: 0.35, pal: palette(a.color, { bellyTo: 0xffffff, bellyK: 0.7, stripe: mulHex(a.color, 0.7) }), pat: { type: 'spots', amt: 0.45, freq: 3 }, q: 0.7, eyeDir: [0.45, 0.1] }),
  cragwolf: (a) => jpModel(HERR, { H: 1.85, irisC: 0xe8c020, slit: 0.28, mouthK: 0, foot: 0.03, pal: palette(a.color, { bellyTo: mulHex(a.color, 1.5), bellyK: 0.5, stripe: mulHex(a.color, 0.6) }), pat: { type: 'stripes', amt: 0.5, freq: 6 }, q: 0.7 }),
  scorp: (a) => stegosaurus({ R: KOM, S: 0.024, eye: [-8, 36.6, 4.0], eyeR: 1.15, eyeIn: 0.95, headTop: [-12, 43], tagH: 47, irisC: 0xe0a030, pal: palette(a.color, { bellyTo: mixHex(a.color, 0xe8dcc0, 0.6), bellyK: 0.5, stripe: mulHex(a.color, 0.55) }), q: 0.75, lz: { H: 42, sy0: 0, sy1: 1, spf: 0.32, sp0: 0.58, sp1: 0.78, spk: 0.6, band: 0, r: 1, duty: 0.55, swing: 0.6, lift: 0.55, fmax: 7.5 } }),
  magmaraptor: (a) => velociraptor({ sK: 1.11, pal: palette(a.color, { back: 0x2a1410, stripe: 0xff6a1a }), pat: { type: 'stripes', amt: 0.9, freq: 8, from: 0.05, to: 0.7 }, emis: 0x2a0800, q: 0.7, spikes: 6, spikeType: 'glow', spikeC: 0xff7a2a, irisC: 0xffd23a, glowEyes: true }),
  stego: (a) => stegosaurus({ pal: palette(a.color, { bellyTo: 0xe6dcb0, bellyK: 0.55, stripe: mulHex(a.color, 0.6) }), q: 0.75 }),
  _quad: (a) => quadruped({ k: 0.82, head: 'plain', plates: true, tailSpikes: true, neckK: 0.7, bulk: 1.05, pal: palette(a.color), pat: { type: 'bands', amt: 0.4, freq: 6, from: 0.1, to: 0.7 }, q: 0.75 }),
  mammoth: (a) => quadruped({ k: 0.9, head: 'mammoth', fur: true, bulk: 1.25, tailK: 0.35, neckK: 0.35, legW: 1.2, pal: palette(a.color), pat: null, q: 0.75 }),
  ram: (a) => quadruped({ k: 0.85, head: 'ram', bulk: 1.05, tailK: 0.5, neckK: 0.8, neckUp: 0.2, pal: palette(a.color), pat: { type: 'spots', amt: 0.3, freq: 3 }, q: 0.75 }),
  parasaur: (a) => parasaurolophus({ pal: palette(a.color, { bellyTo: 0xe9e0c4, bellyK: 0.7, stripe: mulHex(a.color, 0.5) }), pat: { type: 'bands', amt: 0.3, freq: 6, from: -0.1, to: 0.7 }, q: 0.75 }),
  dune: (a) => quadruped({ k: 0.85, head: 'hadro', neckK: 1.1, neckUp: 0.25, pal: palette(a.color), pat: { type: 'stripes', amt: 0.55, freq: 7, from: 0.1, to: 0.7 }, q: 0.75, crestC: 0xd06a3a }),
  ashtrike: (a) => quadruped({ k: 0.92, head: 'cera', hornK: 0.25, frillK: 0.12, stage: 1, pal: palette(a.color, { stripe: 0xff6a1a }), pat: { type: 'stripes', amt: 0.6, freq: 6 }, q: 0.75, glowEyes: true, irisC: 0xff8a2a, emis: 0x1a0600 }),
  ptero: (a) => jpModel(QTZ, { H: 2.06, raw: 1, fly: 1, fy: 0, tilt: -0.5, eyeIn: 0.75, tagH: 2.2, pal: palette(a.color), irisC: 0xe0b020, slit: 0.3, eyeK: 1, jawK: 0.5, q: 1 }),   // Quetzalcoatlus (Pterosaur Quetzalcoatlus, Sketchfab; лицензия в архиве не указана)
  vulture: (a) => jpModel(QTZ, { H: 2.06, raw: 1, fly: 1, tilt: -0.5, eyeIn: 0.75, tagH: 2.2, tint: [0.6, 0.52, 0.45], pal: palette(a.color), irisC: 0xd8a020, slit: 0.3, eyeK: 1, jawK: 0.5, q: 1 }),
  fireptero: (a) => jpModel(QTZ, { H: 2.06, raw: 1, fly: 1, tilt: -0.5, eyeIn: 0.75, tagH: 2.2, tint: [1.55, 0.72, 0.5], pal: palette(a.color), irisC: 0xffa020, slit: 0.3, eyeK: 1, jawK: 0.5, emis: 0x2a0a02, q: 1 }),
  croc: (a) => jpModel(CROC, { H: 0.33, crownK: 0.55, raw: 1, eyeIn: 0.75, lidK: 1, tagH: 1.6, pal: palette(a.color), irisC: 0xe0b020, slit: 0.3, eyeK: 1, jawK: 0.5, foot: 0.01, q: 1 }),   // Sarcosuchus imperator (Nobilis 2, CC BY 4.0)
  // ---- океан ----
  shark: (a) => seaShark({ k: 0.42, pal: palette(a.color, { bellyTo: 0xf2f4f0, bellyK: 0.85 }), pat: { type: 'stripes', amt: 0.25, freq: 5 }, q: 0.65, irisC: a.slow ? 0x9af0ff : 0x1a1a14, glowEyes: !!a.slow, finC: mulHex(a.color, 0.8) }),
  turtle: (a) => seaTurtle({ k: 0.62, pal: palette(a.color, { bellyTo: 0xe8e0c0 }), pat: { type: 'spots', amt: 0.5, freq: 4 }, q: 0.65, shellC: mulHex(a.color, 0.7) }),
  ichthyo: (a) => jpModel(ICH, { H: 0.40, raw: 1, fly: 1, fy: -0.21, tagH: 0.9, pal: palette(a.color), irisC: 0xe0b020, slit: 0.3, eyeK: 1, jawK: 0.55, q: 1 }),   // Ichthyosaurus (Sketchfab; лицензия не указана)
  plesio: (a) => plesioModel(PLES, { L: a.longNeck ? 7 : a.id === "notosaur" ? 4.4 : a.id === "ventnotho" ? 5 : 5.6, color: a.color, pal: palette(a.color, { bellyTo: 0xe8ecdc }) }),
  ammonite: (a) => seaAmmonite({ k: 0.6, pal: palette(a.color, { belly: 0xd8a890 }), pat: null, q: 0.5, shellC: a.color, stripes: !!a.stripes, glow: a.glow, irisC: 0x1a1a14 }),
  angler: (a) => jpModel(ANG, { H: 1.0, raw: 1, fly: 1, fy: -0.5, tagH: 0.95, eyeIn: 0.75, eyeDir: [0.33, 0.72], pal: palette(a.color), irisC: 0xd8f0ff, slit: 0.5, eyeK: 1, jawK: 0.6, crownK: 0.9, q: 1 }),   // Anglerfish (Sketchfab; лицензия не указана)
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
  if (P.br) R.br = Object.assign({}, P.br, { bones: P.br.bones.map(M2), lids: P.br.lids.map(l => ({ tp: M2(l.tp), bp: M2(l.bp) })), st: null });
  if (P.vr) R.vr = Object.assign({}, P.vr, { bones: P.vr.bones.map(M2), lids: P.vr.lids.map(l => ({ tp: M2(l.tp), bp: M2(l.bp) })), st: null });
  if (P.stg) R.stg = Object.assign({}, P.stg, { bones: P.stg.bones.map(M2), lids: P.stg.lids.map(l => ({ tp: M2(l.tp), bp: M2(l.bp) })), st: null });
  if (P.pl) R.pl = Object.assign({}, P.pl, { bones: P.pl.bones.map(M2), lids: P.pl.lids.map(l => ({ tp: M2(l.tp), bp: M2(l.bp) })), st: null });
  if (P.jp) R.jp = Object.assign({}, P.jp, { bones: P.jp.bones.map(M2), lids: P.jp.lids.map(l => ({ tp: M2(l.tp), bp: M2(l.bp) })), st: null });
  if (P.pa) R.pa = Object.assign({}, P.pa, { bones: P.pa.bones.map(M2), lids: P.pa.lids.map(l => ({ tp: M2(l.tp), bp: M2(l.bp) })), st: null });
  R.cosm = null; R.crown = null;
  clone.userData = { parts: R, arch: srcRoot.userData.arch, phase: Math.random() * 6, bite: 0 };
  return clone;
}
export function buildEnemy(a) {
  let proto = enemyProto.get(a.id);
  if (!proto) {
    const mk = ENEMY_DEF[a.id] || ((ENEMY_DEF[a.model] && a.model !== a.id ? ENEMY_DEF[a.model] : { critter: ENEMY_DEF.compy, bug: ENEMY_DEF.bug, fish: ENEMY_DEF.fish, biped: ENEMY_DEF.raptor, quad: ENEMY_DEF._quad, ptero: ENEMY_DEF.ptero, croc: ENEMY_DEF.croc }[a.model])) || ENEMY_DEF.compy;
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
  if (P.vr) { animVel(g, P, dt, speed, bite); return; }
  if (P.br) { animBra(g, P, dt, speed, bite); return; }
  if (P.pa) { animPara(g, P, dt, speed, {}); return; }
  if (P.stg) { animStego(g, P, dt, speed, bite); return; }
  if (P.jp) { animJP(g, P, dt, speed, bite); return; }
  if (P.pl) { animPles(g, P, dt, speed, bite); return; }
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
      for (let i = 0; i < 12; i++) { const u = L.uAtX((-2.6 + i * 0.4) * k), p = L.pointAtU(u, 0, 0.02 * k), bi = nearestBone(S, u); kit.add(S.bones[bi], S.rest[bi], 'acc', UNIT.spike, M_spike(p.pos, new V3(-0.4, 1, 0), (0.35 - Math.abs(i - 5) * 0.02) * k, 0.07 * k), 0x2a2220); }
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
  _olMat = new THREE.MeshBasicMaterial({ color: 0xff2418, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
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
    root.traverse(o => { if (o.isMesh && !o.userData.isOutline && !o.userData.noOutline && !o.isSprite && o.geometry && o.geometry.attributes && o.geometry.attributes.normal && !(o.material && o.material.transparent && o.material.opacity < 0.5)) src.push(o); });
    const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3()), w = Math.max(0.01, Math.max(sz.x, sz.y, sz.z) * 0.009 / Math.max(0.01, root.scale.x));
    const mat = outlineMat().clone(); root.userData.olMat = mat; mat.onBeforeCompile = (sh) => { sh.uniforms.uOW = { value: w }; sh.vertexShader = 'uniform float uOW;\nattribute float olk;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * uOW * olk;'); };
    mat.customProgramCacheKey = () => 'ol2' + w.toFixed(3);
    const P0 = root.userData.parts, headB = P0 && P0.spine && P0.spine.head;
    for (const o of src) {
      // на голове контура нет: пасть и морда тонкие, контур налезает на лицо (через раскрытую пасть виден красный)
      let geo = o.geometry;
      { const n = geo.attributes.position.count, k = new Float32Array(n).fill(1);
        if (o.isSkinnedMesh && headB && geo.attributes.skinIndex) {
          const hi = o.skeleton.bones.indexOf(headB), hj = P0.spine.jaw ? o.skeleton.bones.indexOf(P0.spine.jaw) : -1, si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array;   // jaw — необязательная нижняя челюсть (у акулы): зубы тоже без контура
          if (hi >= 0) for (let i = 0; i < n; i++) { let hw = 0; for (let j = 0; j < 4; j++) if (si[i * 4 + j] === hi || si[i * 4 + j] === hj) hw += sw[i * 4 + j]; k[i] = 1 - Math.min(1, hw * 1.6); }
        }
        geo = new THREE.BufferGeometry(); for (const nm in o.geometry.attributes) geo.setAttribute(nm, o.geometry.attributes[nm]);
        geo.setAttribute('olk', new THREE.BufferAttribute(k, 1)); if (o.geometry.index) geo.setIndex(o.geometry.index); }
      const m = o.isSkinnedMesh ? new THREE.SkinnedMesh(geo, mat) : new THREE.Mesh(geo, mat);
      if (o.isSkinnedMesh) m.bind(o.skeleton, o.bindMatrix);
      m.userData.isOutline = true; m.frustumCulled = false; m.renderOrder = 3; m.castShadow = false; m.receiveShadow = false;
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); m.visible = false;
      o.parent.add(m); ol.push(m);
    }
  }
  if (on && root.userData.olMat) root.userData.olMat.color.setHex(color || 0xff2418);
  for (const m of ol) m.visible = !!on;
}

/*!
 * DinoNest — процедурная модель гнезда динозавра с кладкой яиц (Three.js r128+).
 * Подключите после three.min.js обычным тегом script — появится глобальный объект DinoNest.
 *
 *   const nest = DinoNest.create({ seed: 3, layout: 'ring', eggs: 14, shell: 'teal' });
 *   scene.add(nest.group);                     // начало координат — центр гнезда на уровне земли, 1 ед. = 1 м
 *   nest.update(elapsedSeconds);               // покачивание яйца, которое вот-вот вылупится
 *   nest.heightAt(x, z);                       // высота поверхности гнезда/земли
 *   nest.dispose();
 *
 * layout: 'ring'    — кладка кольцом попарно, вытянутые яйца (как у овирапторид)
 *         'cluster' — плотная кучка овальных яиц в чаше (как у майазавра)
 * shell:  'sand' | 'teal' | 'dark'
 */
import * as THREE from 'three';
const __G = { THREE };
(function (global) {
'use strict';
const T = global.THREE;
if (!T) throw new Error('DinoNest: сначала подключите three.js');
const V3 = T.Vector3, UP = new V3(0, 1, 0);

/* ---------------- random & noise ---------------- */
function rngOf(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + f() * (hi - lo); f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1)); f.pick = a => a[Math.floor(f() * a.length)];
  f.unit = () => { const u = f.range(-1, 1), t = f.range(0, 6.2832), s = Math.sqrt(1 - u * u); return new V3(s * Math.cos(t), u, s * Math.sin(t)); };
  return f;
}
function hash3(x, y, z, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s | 0, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t, c = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0,0,0), c(1,0,0), u), L(c(0,1,0), c(1,1,0), u), v), L(L(c(0,0,1), c(1,0,1), u), L(c(0,1,1), c(1,1,1), u), v), w) * 2 - 1;
}
function fbm(x, y, z, oct, s) { let a = 0.5, f = 1, sum = 0, n = 0; for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.03; } return sum / n; }
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const C = h => new T.Color(h);   // three r152+: sRGB → linear автоматически
const mixC = (o, a, b, t) => o.copy(a).lerp(b, clamp(t));

/* ---------------- merged vertex-coloured geometry ---------------- */
const _v = new V3(), _n = new V3(), _c = new T.Color(), _nm = new T.Matrix3();
class Merge {
  constructor() { this.P = []; this.N = []; this.C = []; this.I = []; }
  add(geo, m, colorFn) {
    const p = geo.attributes.position, n = geo.attributes.normal, base = this.P.length / 3; _nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i); const lx = _v.x, ly = _v.y, lz = _v.z; _v.applyMatrix4(m); _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      typeof colorFn === 'function' ? colorFn(_c, lx, ly, lz, _v, _n) : _c.copy(colorFn);
      this.P.push(_v.x, _v.y, _v.z); this.N.push(_n.x, _n.y, _n.z); this.C.push(_c.r, _c.g, _c.b);
    }
    if (geo.index) for (const k of geo.index.array) this.I.push(base + k); else for (let i = 0; i < p.count; i++) this.I.push(base + i);
  }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.N, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.P.length / 3 > 65535 ? new T.Uint32BufferAttribute(this.I, 1) : new T.Uint16BufferAttribute(this.I, 1)); g.computeBoundingSphere(); return g;
  }
}
const M = (p, q, s) => new T.Matrix4().compose(p || new V3(), q || new T.Quaternion(), typeof s === 'number' ? new V3(s, s, s) : (s || new V3(1, 1, 1)));
const qAlign = (d, spin = 0) => { const q = new T.Quaternion().setFromUnitVectors(UP, d.clone().normalize()); if (spin) q.multiply(new T.Quaternion().setFromAxisAngle(UP, spin)); return q; };
const basisM = (pos, len, nrm) => { const Y = len.clone().normalize(), Z = nrm.clone().sub(Y.clone().multiplyScalar(nrm.dot(Y))).normalize(), X = new V3().crossVectors(Y, Z); return new T.Matrix4().makeBasis(X, Y, Z).setPosition(pos); };
const perp = v => new V3().crossVectors(v, Math.abs(v.y) < 0.9 ? UP : new V3(1, 0, 0)).normalize();

function tubeGeo(pts, rads, seg = 6) {
  const n = pts.length, cols = seg + 1, pos = [], idx = []; let N = null, pT = null;
  for (let i = 0; i < n; i++) {
    const Tg = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    if (!N) N = perp(Tg); else N.applyQuaternion(new T.Quaternion().setFromUnitVectors(pT, Tg)).normalize(); pT = Tg;
    const B = new V3().crossVectors(Tg, N);
    for (let j = 0; j <= seg; j++) { const a = j / seg * 6.2832; pos.push(pts[i].x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rads[i], pts[i].y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rads[i], pts[i].z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rads[i]); }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/** Leaf/blade along +Y, curling toward +Z; curlX rolls the edges (dry leaves). */
function leafGeo(len, w, bend, curlX, widthFn, segs = 6) {
  const pos = [], idx = [], cols = 5; let y = 0, z = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, th = bend * t; if (i) { y += Math.cos(th) * len / segs; z += Math.sin(th) * len / segs; }
    const hw = w * widthFn(t) / 2, ny = -Math.sin(th), nz = Math.cos(th);
    for (let j = 0; j < cols; j++) { const u = j / (cols - 1) * 2 - 1, lift = curlX * u * u * hw * 2 + 0.15 * hw * (1 - u * u); pos.push(u * hw, y + ny * lift, z + nz * lift); }
    if (i < segs) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const W_LEAF = t => Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.75), W_TAPER = t => Math.pow(1 - t, 0.8);
function weld(geo) {
  const p = geo.attributes.position, map = new Map(), np = [], re = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) { const k = Math.round(p.getX(i) * 1e4) + '_' + Math.round(p.getY(i) * 1e4) + '_' + Math.round(p.getZ(i) * 1e4); let j = map.get(k); if (j === undefined) { j = np.length / 3; map.set(k, j); np.push(p.getX(i), p.getY(i), p.getZ(i)); } re[i] = j; }
  const idx = []; for (let i = 0; i < p.count; i += 3) { const a = re[i], b = re[i + 1], c = re[i + 2]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(np, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
let _ico3 = null;
function stoneGeo(r, amp = 0.25) {
  _ico3 ||= weld(new T.IcosahedronGeometry(1, 2));
  const g = _ico3.clone(), p = g.attributes.position, s = (r() * 9999) | 0;
  for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i); const k = 1 + amp * fbm(_v.x * 1.3, _v.y * 1.3, _v.z * 1.3, 3, s); p.setXYZ(i, _v.x * k, _v.y * k * 0.7, _v.z * k); }
  g.computeVertexNormals(); return g;
}

/* ---------------- textures ---------------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const SHELLS = {
  sand: { base: '#b9a584', mott: '#9a8462', spot: '#5e4330', spot2: '#8a6a4e', speck: 420 },
  teal: { base: '#77a092', mott: '#5e8674', spot: '#3a5248', spot2: '#55705f', speck: 260 },
  dark: { base: '#5a4a40', mott: '#7a6656', spot: '#2a1e18', spot2: '#9a8470', speck: 520 }
};
function shellTexture(kind, seed, cracked) {
  const S = SHELLS[kind], r = rngOf(seed), W = 512, H = 256, [cv, g] = canvas(W, H);
  g.fillStyle = S.base; g.fillRect(0, 0, W, H);
  const wrap = (fn) => { for (const ox of [-W, 0, W]) fn(ox); };
  for (let i = 0; i < 90; i++) { const x = r() * W, y = r() * H, rad = r.range(15, 70), a = r.range(0.04, 0.12); wrap(ox => { const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad); gr.addColorStop(0, hexA(S.mott, a)); gr.addColorStop(1, hexA(S.mott, 0)); g.fillStyle = gr; g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2); }); }
  for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H; const pts = []; for (let k = 0; k < 7; k++) pts.push([x + r.range(-14, 14), y + r.range(-8, 8)]); g.fillStyle = hexA(S.spot2, r.range(0.25, 0.5)); wrap(ox => { g.beginPath(); pts.forEach(([px, py], k) => k ? g.lineTo(px + ox, py) : g.moveTo(px + ox, py)); g.closePath(); g.fill(); }); }
  for (let i = 0; i < S.speck; i++) { const x = r() * W, y = r() * H, rad = Math.pow(r(), 3) * 3.2 + 0.5; g.fillStyle = hexA(r() < 0.7 ? S.spot : S.spot2, r.range(0.45, 0.9)); wrap(ox => { g.beginPath(); g.ellipse(x + ox, y, rad * r.range(0.7, 1.4), rad, r() * 3, 0, 6.3); g.fill(); }); }
  // soil staining toward the lower (pointed) end
  const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, 'rgba(70,50,30,.5)'); gr.addColorStop(0.35, 'rgba(70,50,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  if (cracked) {
    g.strokeStyle = 'rgba(25,18,12,.9)'; g.lineCap = 'round';
    const crack = (x, y, ang, len, w, d) => { g.lineWidth = w; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < len; k++) { ang += r.range(-0.7, 0.7); x += Math.cos(ang) * 6; y += Math.sin(ang) * 6; g.lineTo(x, y); if (d < 2 && r() < 0.12) { g.stroke(); crack(x, y, ang + r.range(-1.4, 1.4), len * 0.4, w * 0.6, d + 1); g.beginPath(); g.moveTo(x, y); } } g.stroke(); };
    for (let k = 0; k < 4; k++) crack(140 + k * 60, H * 0.38, r.range(-0.4, 0.4) + (k % 2 ? 3.14 : 0), 16, 1.8, 0);
  }
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.wrapS = T.RepeatWrapping; t.anisotropy = 4; return t;
}
function hexA(hex, a) { const c = new T.Color().setStyle(hex, T.LinearSRGBColorSpace); return `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${a})`; }
function poreTexture(seed) {
  const r = rngOf(seed), W = 512, H = 256, [cv, g] = canvas(W, H); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { const x = r() * W, y = r() * H, rad = r.range(1.2, 3.6); for (const ox of [-W, 0, W]) { const gr = g.createRadialGradient(x + ox - 0.6, y - 0.6, 0, x + ox, y, rad); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2); } }
  for (let i = 0; i < 1500; i++) { g.fillStyle = 'rgba(40,40,40,.35)'; g.fillRect(r() * W, r() * H, 1, 1); }
  const t = new T.CanvasTexture(cv); t.wrapS = T.RepeatWrapping; return t;
}
function grainTexture(seed) {
  const r = rngOf(seed), S = 512, [cv, g] = canvas(S, S); g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) { const v = 120 + r() * 120 | 0; g.fillStyle = `rgba(${v},${v},${v},.5)`; const s = r() < 0.9 ? 1 : 2.5; g.fillRect(r() * S, r() * S, s, s); }
  for (let i = 0; i < 260; i++) { const v = 60 + r() * 60 | 0, x = r() * S, y = r() * S, rad = r.range(2, 6); g.fillStyle = `rgba(${v},${v},${v},.45)`; g.beginPath(); g.ellipse(x, y, rad, rad * r.range(0.5, 1), r() * 3, 0, 6.3); g.fill(); }
  const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(14, 14); return t;
}

/* ---------------- egg geometry ---------------- */
function eggProfile(L, W, asym) { return y => { const z = y / L * 2 - 1; return W / 2 * Math.sqrt(Math.max(0, 1 - z * z)) * (1 + asym * z); }; }
function eggGeo(L, W, asym, seed, rows = 56, seg = 56) {
  const R = eggProfile(L, W, asym), pos = [], uv = [], idx = [], s = seed & 0xffff;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows, y = L * (0.5 - 0.5 * Math.cos(Math.PI * v));
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * 6.2832, r0 = R(y), nx = Math.cos(a), nz = Math.sin(a);
      const node = Math.pow(Math.max(0, noise3(nx * r0 * 160, y * 160, nz * r0 * 160, s)), 2) * 0.0016;
      const rr = r0 + (i === 0 || i === rows ? 0 : node + 0.0004 * noise3(nx * 6, y * 30, nz * 6, s + 3));
      pos.push(nx * rr, y, nz * rr); uv.push(j / seg, y / L);
    }
  }
  const cols = seg + 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal.array; for (let i = 0; i <= rows; i++) { const a = i * cols * 3, b = (i * cols + seg) * 3; for (let k = 0; k < 3; k++) { const m = (n[a + k] + n[b + k]) / 2; n[a + k] = n[b + k] = m; } }
  return g;
}
/** Curved shell fragment with jagged edges (from a hatched egg). */
function shardGeo(L, W, r) {
  const R = eggProfile(L, W, 0.08), y0 = r.range(0.25, 0.55) * L, y1 = y0 + r.range(0.18, 0.35) * L, a0 = r.range(0, 6), da = r.range(0.9, 1.8);
  const rows = 10, seg = 12, pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= seg; j++) {
    const ej = (j === 0 || j === seg) ? r.range(-0.08, 0.08) : 0, ei = (i === 0 || i === rows) ? r.range(-0.04, 0.04) * L : 0;
    const y = y0 + (y1 - y0) * i / rows + ei, a = a0 + da * (j / seg + ej), rr = R(Math.min(L, Math.max(0, y)));
    pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr); uv.push(a / 6.2832, y / L);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  g.translate(0, -(y0 + y1) / 2, 0); return g;
}

/* ---------------- terrain: ground + nest mound in one polar grid ---------------- */
function makeHeight(seed, D) {
  const s = seed & 0xffff, Rr = D * 0.36, Rw = D * 0.13, Hr = D * 0.12, Rb = D * 0.3;
  const mound = (r, a) => {
    const wob = 1 + 0.07 * noise3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0.5, s + 4);
    const rim = Hr * wob * Math.exp(-Math.pow((r - Rr * wob) / Rw, 2));
    const outer = Hr * 0.55 * Math.exp(-Math.pow(r / (D * 0.62), 2) * 1.6);
    const bowl = -D * 0.03 * (1 - sstep(0, Rb, r));
    return rim + outer + bowl;
  };
  const H = (x, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const ground = 0.05 * fbm(x * 0.35, 0.3, z * 0.35, 3, s + 1) + 0.012 * noise3(x * 4, 0.7, z * 4, s + 2);
    const clods = 0.012 * Math.pow(Math.abs(noise3(x * 14, 1.3, z * 14, s + 3)), 0.8) * sstep(D * 0.7, D * 0.2, r);
    return ground + mound(r, a) + clods;
  };
  return { H, Rr, Rb, Hr };
}
function terrain(seed, D, grain, o) {
  o = o || {};
  const { H, Rr, Rb } = makeHeight(seed, D), s = seed & 0xffff;
  const Rmax = o.rmax || 9, RING = Math.max(40, Math.round(150 * Rmax / 9)), SEG = o.rmax ? 160 : 220, pos = [], col = [], idx = [], uv = [];
  const edgeC = o.edgeColor != null ? new T.Color(o.edgeColor) : null;
  const dry = C('#a58660'), mid = C('#7d5e40'), damp = C('#4c3826'), grass = C('#6c7240'), grassD = C('#4a5530'), c = new T.Color();
  for (let i = 0; i <= RING; i++) {
    const r = Rmax * Math.pow(i / RING, 1.7);
    for (let j = 0; j < SEG; j++) {
      const a = j / SEG * 6.2832, x = Math.cos(a) * r, z = Math.sin(a) * r, ek = o.rmax ? sstep(Rmax * 0.62, Rmax, r) : 0, y = (i === 0 ? H(0, 0) : H(x, z)) * (1 - ek);
      pos.push(x, y, z); uv.push(x * 0.5, z * 0.5);
      const n1 = fbm(x * 0.8, 0.2, z * 0.8, 3, s + 9), n2 = noise3(x * 5, 0.4, z * 5, s + 10);
      mixC(c, dry, mid, 0.45 + n1 * 0.9 + n2 * 0.15);
      c.lerp(damp, sstep(Rr * 1.05, Rb * 0.5, r) * 0.85);
      const gz = sstep(D * 0.7, D * 1.2, r) * sstep(-0.1, 0.35, fbm(x * 0.45, 0.9, z * 0.45, 3, s + 11) + 0.15);
      c.lerp(n2 > 0 ? grass : grassD, gz * 0.8);
      if (edgeC) c.lerp(edgeC, ek);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < RING; i++) for (let j = 0; j < SEG; j++) { const j1 = (j + 1) % SEG, a = i * SEG + j, b = i * SEG + j1, cc = (i + 1) * SEG + j, d = (i + 1) * SEG + j1; idx.push(a, b, cc, b, d, cc); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(new T.Uint32BufferAttribute(idx, 1)); g.computeVertexNormals();
  const mat = new T.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 1, side: T.DoubleSide, polygonOffset: !!o.rmax, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new T.Mesh(g, mat); mesh.receiveShadow = true; return mesh;
}

/* ---------------- main factory ---------------- */
function create(opts = {}) {
  const o = Object.assign({ seed: 1, layout: 'ring', eggs: 14, shell: 'sand', diameter: 1.8, hatching: true, surroundings: true }, opts);
  const r = rngOf(o.seed * 977 + 13), D = o.diameter, group = new T.Group(), disposables = [];
  const { H: H0, Rr, Rb } = makeHeight(o.seed, D);
  const H = o.groundR ? (x, z) => H0(x, z) * (1 - sstep(o.groundR * 0.62, o.groundR, Math.hypot(x, z))) : H0;
  const own = x => (disposables.push(x), x);

  const grain = own(grainTexture(o.seed + 5));
  const ground = terrain(o.seed, D, grain, { rmax: o.groundR, edgeColor: o.edgeColor }); own(ground.geometry); own(ground.material); group.add(ground);

  // ---- organic lining: twigs, dry leaves, fern fronds, moss, pebbles
  const lining = new Merge(), outer = new Merge();
  const surf = (x, z, lift = 0) => new V3(x, H(x, z) + lift, z);
  const barks = ['#6a5844', '#54463a', '#7a6650', '#4a3c30', '#8a7a64'].map(C), leafCols = ['#7a5a2e', '#8f6a34', '#5e4a2a', '#9a7a3e', '#6a6a34', '#4e3e26', '#a0602a'].map(C);
  const twig = (x, z, ang, len, rad, target) => {
    const pts = [], n = 8, dir = new V3(Math.cos(ang), 0, Math.sin(ang)); let px = x, pz = z, a = ang;
    for (let i = 0; i <= n; i++) { pts.push(surf(px, pz, rad * 0.8 + 0.004)); a += r.range(-0.12, 0.12); px += Math.cos(a) * len / n; pz += Math.sin(a) * len / n; }
    const col = r.pick(barks), sn = (r() * 999) | 0;
    target.add(tubeGeo(pts, pts.map((_, i) => rad * (1 - i / n * 0.5)), 6), new T.Matrix4(), (c, lx, ly, lz) => mixC(c, col, col.clone().multiplyScalar(0.55), 0.5 + 0.7 * noise3(lx * 40, ly * 40, lz * 40, sn)));
    if (r() < 0.45) { const i = r.int(2, n - 2), b = pts[i], ba = a + r.range(0.5, 1.1) * (r() < 0.5 ? -1 : 1), bl = len * r.range(0.25, 0.4), bp = [b.clone()]; for (let k = 1; k <= 4; k++) bp.push(surf(b.x + Math.cos(ba) * bl * k / 4, b.z + Math.sin(ba) * bl * k / 4, rad * 0.5 + 0.004)); target.add(tubeGeo(bp, bp.map(() => rad * 0.5), 5), new T.Matrix4(), col); }
  };
  // woven rim of twigs, laid roughly tangentially
  for (let k = 0; k < 110; k++) {
    const a = r.range(0, 6.2832), rr = Rr * r.range(0.88, 1.3), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    twig(x, z, a + Math.PI / 2 + r.range(-0.6, 0.6), r.range(0.25, 0.7), r.range(0.005, 0.014), lining);
  }
  // dry leaves concentrated in the bowl
  const leafShapes = [t => W_LEAF(t) * (0.8 + 0.2 * Math.abs(Math.sin(t * 14))), W_LEAF, t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8)];
  for (let k = 0; k < 260; k++) {
    const rr = Rr * Math.pow(r(), 0.7) * 1.15, a = r.range(0, 6.2832), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const len = r.range(0.05, 0.11), col = r.pick(leafCols).clone().multiplyScalar(r.range(0.8, 1.15));
    const g = leafGeo(len, len * r.range(0.45, 0.65), r.range(-0.6, 0.8), r.range(0.1, 0.6), r.pick(leafShapes));
    const nrm = new V3(r.range(-0.4, 0.4), 1, r.range(-0.4, 0.4)).normalize();
    const q = new T.Quaternion().setFromUnitVectors(new V3(0, 0, 1), nrm).multiply(new T.Quaternion().setFromAxisAngle(new V3(0, 0, 1), r.range(0, 6.28)));
    lining.add(g, M(surf(x, z, 0.006), q, 1), (c, lx, ly) => { mixC(c, col, col.clone().multiplyScalar(0.6), Math.abs(lx) / (len * 0.3) * 0.6); if (ly < len * 0.08) c.multiplyScalar(0.7); });
  }
  // decaying fern fronds lining the floor of the bowl
  for (let k = 0; k < 8; k++) {
    const a = r.range(0, 6.2832), rr = Rb * r.range(0.1, 0.9), x0 = Math.cos(a) * rr, z0 = Math.sin(a) * rr, dirA = r.range(0, 6.28), len = r.range(0.35, 0.6);
    const col = C(r() < 0.5 ? '#6e6a32' : '#7e5a2e'), segs = 12, rach = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs; rach.push(surf(x0 + Math.cos(dirA + t * 0.4) * len * t, z0 + Math.sin(dirA + t * 0.4) * len * t, 0.01)); }
    lining.add(tubeGeo(rach, rach.map(() => 0.003), 4), new T.Matrix4(), col);
    for (let i = 1; i < segs; i++) for (const sg of [1, -1]) {
      const t = i / segs, pl = 0.09 * Math.sin(Math.PI * Math.min(1, t + 0.1)), d = rach[i + 1].clone().sub(rach[i]).normalize(), side = new V3(-d.z, 0, d.x).multiplyScalar(sg);
      const pin = leafGeo(pl, 0.02, 0.1, 0.4, W_TAPER, 3);
      lining.add(pin, basisM(rach[i].clone().add(new V3(0, 0.002, 0)), side.clone().addScaledVector(d, 0.35), UP), col.clone().multiplyScalar(r.range(0.8, 1.1)));
    }
  }
  // moss clumps on the rim
  const mossA = C('#2c3a1a'), mossB = C('#4c5824');
  for (let k = 0; k < 12; k++) {
    const a = r.range(0, 6.2832), rr = Rr * r.range(0.95, 1.35), x = Math.cos(a) * rr, z = Math.sin(a) * rr, sz = r.range(0.025, 0.05), sn = (r() * 999) | 0;
    lining.add(stoneGeo(r, 0.35), M(surf(x, z, sz * 0.15), null, new V3(sz * 1.3, sz * 0.55, sz)), (c, lx, ly, lz, w, n) => { mixC(c, mossA, mossB, 0.5 + noise3(w.x * 60, w.y * 60, w.z * 60, sn)); c.multiplyScalar(0.7 + 0.3 * n.y); });
  }
  // pebbles around the foot of the mound
  const stoneCols = ['#8a8278', '#6e665c', '#a29a8c', '#5a544c'].map(C);
  for (let k = 0; k < 45; k++) {
    const a = r.range(0, 6.2832), rr = D * r.range(0.45, 1.1), x = Math.cos(a) * rr, z = Math.sin(a) * rr, sz = r.range(0.02, 0.07), col = r.pick(stoneCols);
    outer.add(stoneGeo(r, 0.3), M(surf(x, z, sz * 0.25), new T.Quaternion().setFromEuler(new T.Euler(0, r.range(0, 6), 0)), new V3(sz * r.range(1, 1.5), sz, sz)), (c, lx, ly, lz, w, n) => c.copy(col).multiplyScalar(0.75 + 0.3 * n.y));
  }
  // surroundings: scattered twigs, leaf litter, grass tufts, a couple of ferns
  if (o.surroundings) {
    for (let k = 0; k < 40; k++) { const a = r.range(0, 6.2832), rr = D * r.range(0.6, 1.6); twig(Math.cos(a) * rr, Math.sin(a) * rr, r.range(0, 6.28), r.range(0.2, 0.6), r.range(0.005, 0.012), outer); }
    for (let k = 0; k < 160; k++) {
      const a = r.range(0, 6.2832), rr = D * r.range(0.5, 1.8), x = Math.cos(a) * rr, z = Math.sin(a) * rr, len = r.range(0.05, 0.1), col = r.pick(leafCols);
      const q = new T.Quaternion().setFromUnitVectors(new V3(0, 0, 1), new V3(r.range(-0.3, 0.3), 1, r.range(-0.3, 0.3)).normalize()).multiply(new T.Quaternion().setFromAxisAngle(new V3(0, 0, 1), r.range(0, 6.28)));
      outer.add(leafGeo(len, len * 0.55, r.range(-0.5, 0.6), r.range(0.1, 0.5), W_LEAF), M(surf(x, z, 0.005), q, 1), col);
    }
    const gA = C('#4e5e2a'), gB = C('#a8a858');
    for (let k = 0; k < 110; k++) {
      const a = r.range(0, 6.2832), rr = D * r.range(0.75, 2.6), x = Math.cos(a) * rr, z = Math.sin(a) * rr, base = surf(x, z, -0.01), h0 = r.range(0.12, 0.32);
      for (let b = 0; b < r.int(8, 14); b++) {
        const ang = r.range(0, 6.28), len = h0 * r.range(0.6, 1.2);
        outer.add(leafGeo(len, 0.012, r.range(0.4, 1.2), 0.2, W_TAPER, 4), M(base.clone().add(new V3(Math.cos(ang) * 0.02, 0, Math.sin(ang) * 0.02)), new T.Quaternion().setFromEuler(new T.Euler(r.range(-0.15, 0.2), ang, 0, 'YXZ')), 1), (c, lx, ly) => mixC(c, gA, gB, ly / len));
      }
    }
    for (let k = 0; k < 3; k++) {
      const a = r.range(0, 6.28), rr = D * r.range(0.9, 1.5), base = surf(Math.cos(a) * rr, Math.sin(a) * rr, 0), col = C('#3f6a2a'), dark = C('#24401a');
      for (let f = 0; f < 8; f++) {
        const fa = f / 8 * 6.28 + r.range(-0.2, 0.2), len = r.range(0.5, 0.8), segs = 12, rach = []; let y = 0, z = 0;
        for (let i = 0; i <= segs; i++) { const t = i / segs, th = 0.5 + 1.3 * t * t; if (i) { y += Math.cos(th) * len / segs; z += Math.sin(th) * len / segs; } rach.push(new V3(0, y, z)); }
        const mm = M(base, new T.Quaternion().setFromAxisAngle(UP, fa), 1);
        outer.add(tubeGeo(rach, rach.map(() => 0.004), 4), mm, dark);
        for (let i = 1; i < segs; i++) for (const sg of [1, -1]) { const t = i / segs, pl = 0.14 * Math.sin(Math.PI * Math.min(1, t + 0.08)); outer.add(leafGeo(pl, 0.04, 0.2, 0.3, W_LEAF, 3), new T.Matrix4().multiplyMatrices(mm, M(rach[i], new T.Quaternion().setFromEuler(new T.Euler(0, 0, -sg * 1.3)), 1)), (c, lx, ly) => mixC(c, dark, col, 0.4 + ly / pl)); }
      }
    }
  }
  const linMat = own(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: T.DoubleSide }));
  [lining, outer].forEach(m => { const mesh = new T.Mesh(own(m.geometry()), linMat); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); });

  // ---- eggs
  const ring = o.layout === 'ring';
  const L = ring ? 0.19 : 0.16, Wd = ring ? 0.075 : 0.115, asym = ring ? 0.1 : 0.07;
  const eggGeos = [0, 1, 2].map(k => own(eggGeo(L * (1 + (k - 1) * 0.03), Wd * (1 + (1 - k) * 0.025), asym, o.seed * 31 + k, o.eggDetail || 56, o.eggDetail || 56)));
  const pores = own(poreTexture(o.seed + 7));
  const texs = [0, 1, 2].map(k => own(shellTexture(o.shell, o.seed * 13 + k, false))), crackTex = own(shellTexture(o.shell, o.seed * 13 + 9, true));
  const eggMats = texs.map(t => own(new T.MeshStandardMaterial({ map: t, bumpMap: pores, bumpScale: 0.0018, roughness: 0.55, metalness: 0 })));
  const crackMat = own(new T.MeshStandardMaterial({ map: crackTex, bumpMap: pores, bumpScale: 0.0018, roughness: 0.55 }));
  const eggs = [], placements = [];
  const n = Math.max(2, Math.min(24, o.eggs | 0));
  if (ring) {
    // paired eggs in two tiers, pointed ends toward the centre and down
    const inner = Math.min(n, Math.max(6, Math.round(n * 0.6) & ~1)), outerN = n - inner;
    const tiers = [{ count: inner, rad: Rb * 0.6, tilt: 0.55 }, { count: outerN, rad: Rb * 0.92, tilt: 0.42 }];
    tiers.forEach((tr, ti) => {
      if (!tr.count) return; const pairs = Math.ceil(tr.count / 2), off = r.range(0, 6.28) + ti * 0.4;
      for (let pI = 0; pI < pairs; pI++) for (let e = 0; e < 2 && placements.length < (ti ? n : inner); e++) {
        const a = off + pI / pairs * 6.2832 + (e ? 1 : -1) * Math.atan2(Wd * 0.58, tr.rad) + r.range(-0.04, 0.04);
        const outv = new V3(Math.cos(a), 0, Math.sin(a)), axis = outv.clone().multiplyScalar(Math.cos(tr.tilt)).addScaledVector(UP, Math.sin(tr.tilt)).normalize();
        const cpos = new V3(Math.cos(a) * tr.rad, 0, Math.sin(a) * tr.rad); cpos.y = H(cpos.x, cpos.z) + Wd * 0.18 + ti * 0.02;
        placements.push({ base: cpos.clone().addScaledVector(axis, -L / 2), axis });
      }
    });
  } else {
    // dense, roughly upright cluster sunk into the bowl
    const pts = []; let tries = 0;
    while (pts.length < n && tries++ < 4000) {
      const rr = Rb * 0.95 * Math.sqrt(r()), a = r.range(0, 6.28), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (pts.every(p => Math.hypot(p.x - x, p.z - z) > Wd * 1.02)) pts.push(new V3(x, 0, z));
      if (tries > 1500 && pts.length < n) { /* tighten if crowded */ }
    }
    pts.forEach(p => {
      const outv = new V3(p.x, 0, p.z).normalize(), lean = 0.2 + 0.5 * (Math.hypot(p.x, p.z) / Rb);
      const axis = UP.clone().addScaledVector(outv, Math.tan(lean)).add(new V3(r.range(-0.1, 0.1), 0, r.range(-0.1, 0.1))).normalize();
      const b = new V3(p.x, H(p.x, p.z) - L * 0.22, p.z);
      placements.push({ base: b, axis });
    });
  }
  const hatchIdx = o.hatching ? Math.floor(r() * placements.length) : -1;
  placements.forEach((pl, i) => {
    const mesh = new T.Mesh(eggGeos[i % 3], i === hatchIdx ? crackMat : eggMats[(i * 7) % 3]);
    mesh.quaternion.copy(qAlign(pl.axis, r.range(0, 6.28))); mesh.position.copy(pl.base);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    eggs.push({ mesh, base: pl.base.clone(), q0: mesh.quaternion.clone(), hatching: i === hatchIdx, phase: r() * 10 });
  });
  // shell fragments from an earlier hatchling, tossed onto the rim
  for (let k = 0; k < (o.hatching ? 5 : 0); k++) {
    const a = r.range(0, 6.28), rr = Rr * r.range(0.9, 1.25), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const g = own(shardGeo(L, Wd, r)), m = new T.Mesh(g, eggMats[k % 3]); m.material.side = T.DoubleSide;
    m.position.set(x, H(x, z) + 0.012, z); m.quaternion.setFromEuler(new T.Euler(r.range(1.2, 1.9), r.range(0, 6.28), r.range(-0.3, 0.3)));
    m.castShadow = m.receiveShadow = true; group.add(m);
  }

  const axisTmp = new V3(), qTmp = new T.Quaternion();
  return {
    group, eggs: eggs.map(e => e.mesh), heightAt: H, diameter: D, layout: o.layout,
    update(t) {
      eggs.forEach(e => {
        if (!e.hatching) return;
        const tt = t + e.phase, burst = Math.pow(Math.max(0, Math.sin(tt * 0.8)), 10);
        axisTmp.set(Math.cos(tt * 0.37), 0, Math.sin(tt * 0.37));
        qTmp.setFromAxisAngle(axisTmp, 0.14 * burst * Math.sin(tt * 22));
        e.mesh.quaternion.copy(qTmp).multiply(e.q0);
      });
    },
    dispose() { group.parent && group.parent.remove(group); disposables.forEach(d => d.dispose && d.dispose()); }
  };
}

global.DinoNest = { version: '1.0.0', create, shells: Object.keys(SHELLS), eggProfile, eggGeo, shardGeo, shellTexture, poreTexture, rngOf, noise3 };
})(__G);
const DinoNest = __G.DinoNest;
export { DinoNest };

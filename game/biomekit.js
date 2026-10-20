/*!
 * BiomeKit — процедурные растения, водоросли и поверхности для 7 биомов (Three.js r128+).
 *
 * Подключение: после three.min.js подключите biome-kit.js обычным тегом script — появится глобальный объект BiomeKit.
 *
 *   const mesh = BiomeKit.createPlant('forest', 'oak', 42);    // Mesh, origin у основания
 *   const surf = BiomeKit.createSurface('volcano', {size: 60}); // { group, heightAt(x,z), sample(x,z), waterLevel }
 *   scene.add(surf.group, mesh);
 *   // в цикле рендера:
 *   BiomeKit.update(elapsedSeconds);           // ветер/течение, пульсация лавы, рябь воды
 *   BiomeKit.uniforms.uWind.value = 1;         // сила ветра (0..2)
 *
 * Все модели собраны в одну геометрию с вершинными цветами (1 draw call на растение),
 * поэтому их удобно размножать через THREE.InstancedMesh(BiomeKit.plantGeometry(...), BiomeKit.plantMaterial(), n).
 */
import * as THREE from 'three';
const __G = { THREE };
(function (global) {
'use strict';
const T = global.THREE;
if (!T) throw new Error('BiomeKit: сначала подключите three.js');
const V3 = T.Vector3, UP = new V3(0, 1, 0), ONE = new V3(1, 1, 1), WHITE = new T.Color(1, 1, 1);

/* ------------------------------------------------------------------ random & noise */
function rngOf(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  f.unit = () => { const u = f.range(-1, 1), t = f.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return new V3(s * Math.cos(t), u, s * Math.sin(t)); };
  f.seed = () => (f() * 1e9) | 0;
  return f;
}
function hash3(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0,0,0), c(1,0,0), u), L(c(0,1,0), c(1,1,0), u), v),
           L(L(c(0,0,1), c(1,0,1), u), L(c(0,1,1), c(1,1,1), u), v), w) * 2 - 1;
}
function fbm3(x, y, z, oct, s) { let a = 0.5, f = 1, sum = 0, n = 0; for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.03; } return sum / n; }
const fbm2 = (x, z, oct, s) => fbm3(x, 0.37, z, oct, s);
const ridged2 = (x, z, oct, s) => { let a = 0.5, f = 1, sum = 0, n = 0; for (let i = 0; i < oct; i++) { sum += a * (1 - Math.abs(noise3(x * f, 0.37, z * f, s + i * 17))); n += a; a *= 0.5; f *= 2.1; } return sum / n; };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ colour helpers */
const C = hex => new T.Color(hex);   // three r152+: перевод sRGB → linear делает сам Color
const jit = (c, r, a = 0.12) => c.clone().multiplyScalar(1 + r.range(-a, a));
const mixC = (out, a, b, t) => out.copy(a).lerp(b, clamp(t));

/* ------------------------------------------------------------------ shared material (wind / current + glow + caustics) */
let LITE = false;
const uniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uGlow: { value: 1 }, uFreq: { value: 1.3 } };
const VERT_HEAD = 'attribute vec3 aPlant;\nuniform float uTime;\nuniform float uWind;\nuniform float uFreq;\nvarying float vGlow;\nvarying vec3 vWP;\n';
const VERT_BODY = `
  vec3 transformed = vec3(position);
  vGlow = aPlant.z;
  vec4 o4 = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    o4 = instanceMatrix * o4;
  #endif
  o4 = modelMatrix * o4;
  float ph = o4.x * 0.37 + o4.z * 0.23;
  float tt = uTime * uFreq;
  float sw = sin(tt + ph) * 0.65 + sin(tt * 2.13 + ph * 1.7) * 0.25 + 0.35;
  transformed.x += aPlant.x * uWind * sw;
  transformed.z += aPlant.x * uWind * 0.45 * sin(tt * 0.83 + ph * 1.3);
  transformed += aPlant.y * uWind * 0.05 * vec3(sin(uTime * 6.7 + position.y * 8.0 + ph), 0.5 * sin(uTime * 7.9 + position.x * 7.0), cos(uTime * 6.1 + position.z * 8.0));
  vec4 wp4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
  #endif
  vWP = (modelMatrix * wp4).xyz;
`;
function patchMaterial(mat, caustic) {
  const cu = { value: caustic || 0 };
  mat.userData.caustic = cu;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms, { uCaustic: cu });
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    if (sh.fragmentShader.includes('#include <emissivemap_fragment>')) {
      sh.fragmentShader = 'uniform float uGlow;\nuniform float uTime;\nuniform float uCaustic;\nvarying float vGlow;\nvarying vec3 vWP;\n' +
        sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow * 1.7;
        if (uCaustic > 0.0) {
          vec2 p = vWP.xz * 0.45; float c = 0.0;
          for (int i = 0; i < 3; i++) { p += vec2(sin(p.y * 1.7 + uTime * 0.7), cos(p.x * 1.3 - uTime * 0.6)); c += pow(abs(sin(p.x + p.y)), 10.0); }
          totalEmissiveRadiance += vec3(0.30, 0.55, 0.62) * c * 0.22 * uCaustic * clamp(1.0 - vWP.y * 0.04, 0.0, 1.0);
        }`);
    }
  };
  mat.customProgramCacheKey = () => 'biomekit_' + mat.type;
  return mat;
}
let _plantMat = null, _depthMat = null;
function plantMaterial() {
  if (!_plantMat) _plantMat = patchMaterial(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: T.DoubleSide }));
  return _plantMat;
}
function depthMaterial() {
  if (!_depthMat) _depthMat = patchMaterial(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }));
  return _depthMat;
}

/* ------------------------------------------------------------------ geometry builder */
const _v = new V3(), _n = new V3(), _c = new T.Color(), _nm = new T.Matrix3(), IDENT = new T.Matrix4();
class Builder {
  constructor() { this.P = []; this.N = []; this.C = []; this.A = []; this.I = []; }
  /** o: {m: Matrix4, color, colorFn(c, lx,ly,lz, worldPos, worldNormal), flutter, glow (num|fn), stiff} */
  add(geo, o = {}) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, m = o.m || IDENT;
    _nm.getNormalMatrix(m);
    const base = this.P.length / 3, fl = o.flutter || 0, gl = o.glow || 0, st = o.stiff == null ? 1 : o.stiff;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i); const lx = _v.x, ly = _v.y, lz = _v.z; _v.applyMatrix4(m);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      if (o.colorFn) o.colorFn(_c, lx, ly, lz, _v, _n, i); else _c.copy(o.color || WHITE);
      this.P.push(_v.x, _v.y, _v.z); this.N.push(_n.x, _n.y, _n.z); this.C.push(_c.r, _c.g, _c.b);
      this.A.push(st, typeof fl === 'function' ? fl(lx, ly, lz) : fl, typeof gl === 'function' ? gl(lx, ly, lz, _v) : gl);
    }
    if (geo.index) { const ia = geo.index.array; for (let k = 0; k < ia.length; k++) this.I.push(base + ia[k]); }
    else for (let i = 0; i < pos.count; i++) this.I.push(base + i);
    return this;
  }
  /** bend: horizontal sway (units) at the top of the model for uWind = 1; exp: how fast sway grows with height */
  build(bend = 0.1, exp = 2) {
    let H = 0.01; for (let i = 1; i < this.P.length; i += 3) H = Math.max(H, this.P[i]);
    for (let i = 0; i < this.A.length; i += 3) { const y = Math.max(0, this.P[i + 1]); this.A[i] = this.A[i] * bend * Math.pow(y / H, exp); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aPlant', new T.Float32BufferAttribute(this.A, 3));
    g.setIndex(this.I.length > 65535 ? new T.Uint32BufferAttribute(this.I, 1) : new T.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/* ------------------------------------------------------------------ transforms */
const M = (p, q, s) => new T.Matrix4().compose(p || new V3(), q || new T.Quaternion(), typeof s === 'number' ? new V3(s, s, s) : (s || ONE));
const qAlign = (dir, spin = 0) => { const q = new T.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()); if (spin) q.multiply(new T.Quaternion().setFromAxisAngle(UP, spin)); return q; };
const qE = (x, y, z, order) => new T.Quaternion().setFromEuler(new T.Euler(x, y, z, order || 'YXZ'));
const at = (p, dir, s, spin) => M(p, qAlign(dir || UP, spin || 0), s);
function perp(v) { const a = Math.abs(v.y) < 0.9 ? UP : new V3(1, 0, 0); return new V3().crossVectors(v, a).normalize(); }

/* ------------------------------------------------------------------ primitive geometry */
function weld(geo) {
  const p = geo.attributes.position, map = new Map(), np = [], remap = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 1e4) + '_' + Math.round(p.getY(i) * 1e4) + '_' + Math.round(p.getZ(i) * 1e4);
    let j = map.get(k); if (j === undefined) { j = np.length / 3; map.set(k, j); np.push(p.getX(i), p.getY(i), p.getZ(i)); } remap[i] = j;
  }
  const src = geo.index ? geo.index.array : null, n = src ? src.length : p.count, idx = [];
  for (let i = 0; i < n; i += 3) { const a = remap[src ? src[i] : i], b = remap[src ? src[i + 1] : i + 1], c = remap[src ? src[i + 2] : i + 2]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(np, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const _ico = {};
function blobGeo(r, { detail = 2, amp = 0.2, freq = 1.4, sx = 1, sy = 1, sz = 1 } = {}) {
  if (!_ico[detail]) _ico[detail] = weld(new T.IcosahedronGeometry(1, detail));
  const g = _ico[detail].clone(), p = g.attributes.position, s = r.seed() & 0xffff;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i); const k = 1 + amp * fbm3(_v.x * freq + 5, _v.y * freq, _v.z * freq, 3, s);
    p.setXYZ(i, _v.x * k * sx, _v.y * k * sy, _v.z * k * sz);
  }
  g.computeVertexNormals(); return g;
}
function fixSeam(g, rows, cols) {
  const n = g.attributes.normal.array;
  for (let i = 0; i < rows; i++) { const a = i * cols * 3, b = (i * cols + cols - 1) * 3; for (let k = 0; k < 3; k++) { const m = (n[a + k] + n[b + k]) / 2; n[a + k] = n[b + k] = m; } }
  for (let i = 0; i < n.length; i += 3) { _v.set(n[i], n[i + 1], n[i + 2]).normalize(); n[i] = _v.x; n[i + 1] = _v.y; n[i + 2] = _v.z; }
}
function ribMod(th, ribs, ribAmp) { if (!ribs) return 1; const rib = Math.pow(Math.abs(Math.cos(th * ribs / 2)), 0.6); return 1 - ribAmp * (1 - rib); }
/** Smooth tube along points (parallel-transport frames). */
function tubeGeo(pts, rads, seg = 8, ribs = 0, ribAmp = 0) {
  const n = pts.length, cols = seg + 1, pos = [], idx = [];
  let N = null, prevT = null;
  for (let i = 0; i < n; i++) {
    const Tg = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    if (!N) N = perp(Tg); else { N.applyQuaternion(new T.Quaternion().setFromUnitVectors(prevT, Tg)).normalize(); }
    prevT = Tg; const B = new V3().crossVectors(Tg, N);
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * Math.PI * 2, rr = rads[i] * ribMod(a, ribs, ribAmp);
      pos.push(pts[i].x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rr, pts[i].y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rr, pts[i].z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rr);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); fixSeam(g, n, cols); return g;
}
/** Lathe around Y from profile [[r, y], ...] with optional ribs (cacti, corals, flowers). */
function latheGeo(profile, seg = 16, ribs = 0, ribAmp = 0) {
  const cols = seg + 1, pos = [], idx = [];
  profile.forEach(([r, y]) => { for (let j = 0; j <= seg; j++) { const a = j / seg * Math.PI * 2, rr = r * ribMod(a, ribs, ribAmp); pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr); } });
  for (let i = 0; i < profile.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); fixSeam(g, profile.length, cols); return g;
}
const W_TAPER = t => Math.pow(1 - t, 0.8), W_LEAF = t => Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.7), W_LANCE = t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.8), W_STRAP = t => (t < 0.9 ? 1 : (1 - t) * 10) * (0.6 + 0.4 * Math.sqrt(Math.min(1, t * 8)));
/** Leaf / blade strip along +Y bending toward +Z. fold lifts the midrib, ruffle waves the edges. */
function bladeGeo(len, w, bend, segs = 5, widthFn = W_TAPER, fold = 0.2, ruffle = 0, twist = 0) {
  const pos = [], idx = []; let y = 0, z = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, th = bend * Math.pow(t, 1.4);
    if (i > 0) { const d = len / segs; y += Math.cos(th) * d; z += Math.sin(th) * d; }
    const ww = w * widthFn(t) / 2, ny = -Math.sin(th), nz = Math.cos(th);
    const tw = twist * t, cx = Math.cos(tw), sx = Math.sin(tw);
    const rL = ruffle * Math.sin(t * 23) * t, rR = ruffle * Math.sin(t * 23 + 1.7) * t;
    pos.push(-ww * cx, y + ny * (-ww * sx + rL), z + nz * (-ww * sx + rL));
    pos.push(0, y + ny * fold * ww, z + nz * fold * ww);
    pos.push(ww * cx, y + ny * (ww * sx + rR), z + nz * (ww * sx + rR));
    if (i < segs) { const b = i * 3; idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5); }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const _sph = {}; const sphereGeo = (ws = 10, hs = 8) => (_sph[ws + '_' + hs] ||= new T.SphereGeometry(1, ws, hs));
const _cyl = {}; const cylGeo = (rt, rb, h, s = 8) => (_cyl[[rt, rb, h, s]] ||= (() => { const g = new T.CylinderGeometry(rt, rb, h, s, 1); g.translate(0, h / 2, 0); return g; })());
const _cone = {}; const coneGeo = (r, h, s = 8) => (_cone[[r, h, s]] ||= (() => { const g = new T.ConeGeometry(r, h, s, 1); g.translate(0, h / 2, 0); return g; })());

/* ------------------------------------------------------------------ reusable plant parts */
function growPath(r, start, dir, len, segs, wob, lift = 0, droop = 0) {
  const pts = [start.clone()], dirs = [dir.clone().normalize()], d = dir.clone().normalize(), p = start.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    d.add(new V3(r.range(-wob, wob), r.range(-wob, wob) * 0.5, r.range(-wob, wob))).addScaledVector(UP, lift - droop * t).normalize();
    p.addScaledVector(d, len / segs); pts.push(p.clone()); dirs.push(d.clone());
  }
  return { pts, dirs };
}
const radii = (n, r0, taper, flare = 0) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return Math.max(0.004, r0 * (1 - t * (1 - taper)) * (1 + flare * Math.exp(-t * 12))); });
function barkFn(base, dark, freq = 5, s = 1) { return (c, lx, ly, lz) => mixC(c, base, dark, 0.5 + 0.8 * noise3(lx * freq, ly * freq * 0.25, lz * freq, s)); }
function foliageFn(col, r, speck = 0.12) {
  const s = r.seed() & 0xffff;
  return (c, lx, ly, lz, w, n) => { c.copy(col).multiplyScalar((0.62 + 0.38 * (n.y * 0.5 + 0.5)) * (1 + speck * noise3(w.x * 4, w.y * 4, w.z * 4, s))); };
}
function canopy(B, r, center, spread, count, rad, cols, o = {}) {
  for (let k = 0; k < count; k++) {
    const p = center.clone().add(new V3(r.range(-1, 1) * spread.x, r.range(-0.6, 1) * spread.y, r.range(-1, 1) * spread.z));
    const s = rad * r.range(0.7, 1.15);
    B.add(blobGeo(r, { detail: 2, amp: o.amp || 0.22, freq: 1.6, sy: o.sy || 0.85 }), { m: M(p, qE(0, r.range(0, 6), 0), s), colorFn: foliageFn(jit(r.pick(cols), r, 0.1), r), flutter: o.flutter ?? 0.25 });
  }
}
function tuft(B, r, o) {
  const { n = 9, h = 0.5, w = 0.05, bend = 0.9, spread = 0.08, base, tip, flutter = 0.6, at: m0 = IDENT, glowTip = 0 } = o;
  for (let i = 0; i < n; i++) {
    const a = r.range(0, Math.PI * 2), len = h * r.range(0.6, 1.15);
    const g = bladeGeo(len, w * r.range(0.8, 1.2), bend * r.range(0.4, 1.2), 5, o.widthFn || W_TAPER, 0.25);
    const m = new T.Matrix4().multiplyMatrices(m0, M(new V3(Math.cos(a) * spread * r(), 0, Math.sin(a) * spread * r()), qE(r.range(-0.15, 0.25), a, 0), 1));
    const tc = jit(tip, r, 0.1), bc = base;
    B.add(g, { m, colorFn: (c, lx, ly) => mixC(c, bc, tc, ly / len), flutter, glow: glowTip ? (lx, ly) => sstep(0.75, 1, ly / len) * glowTip : 0 });
  }
}
function petalFlower(B, m0, r, { petals = 8, len = 0.1, w = 0.05, cup = 0.3, color, center, centerR = 0.025, flutter = 0.3, glow = 0, layers = 1, widthFn = W_LEAF }) {
  for (let L = 0; L < layers; L++) for (let k = 0; k < petals; k++) {
    const a = (k + L * 0.5) / petals * Math.PI * 2;
    const m = new T.Matrix4().multiplyMatrices(m0, M(new V3(), qE(Math.PI / 2 - cup - L * 0.35, a, 0), 1 - L * 0.18));
    B.add(bladeGeo(len, w, -0.35, 4, widthFn, 0.15), { m, colorFn: (c, lx, ly) => mixC(c, color, color.clone().multiplyScalar(0.75), 1 - ly / len), flutter, glow });
  }
  if (center) B.add(sphereGeo(8, 6), { m: new T.Matrix4().multiplyMatrices(m0, M(new V3(), null, new V3(centerR, centerR * 0.6, centerR))), color: center, flutter, glow: glow * 0.5 });
}
function stemTo(B, r, from, dir, len, rad, col, flutter = 0.2, droop = 0) {
  const { pts, dirs } = growPath(r, from, dir, len, 6, 0.06, 0, droop);
  B.add(tubeGeo(pts, radii(pts.length, rad, 0.6), 5), { color: col, flutter });
  return { tip: pts[pts.length - 1], dir: dirs[dirs.length - 1] };
}
/** Recursive branching skeleton; calls onTip(p, dir, depth) at each twig end. */
function branches(B, r, start, dir, len, rad, depth, o, onTip) {
  const segs = Math.max(3, Math.round(len * (o.segsPerUnit || 4)));
  const { pts, dirs } = growPath(r, start, dir, len, segs, o.wob ?? 0.12, o.lift ?? 0.03, o.droop ?? 0);
  const rads = radii(pts.length, rad, o.taper ?? 0.45, depth === 0 ? (o.flare || 0) : 0);
  B.add(tubeGeo(pts, rads, depth === 0 ? (o.seg0 || 10) : Math.max(4, (o.seg0 || 10) - depth * 2), o.ribs || 0, o.ribAmp || 0), { colorFn: o.colorFn, color: o.color, glow: o.glowFn || 0, flutter: depth >= 2 ? 0.05 : 0 });
  if (depth < o.depth) {
    const cnt = o.kids[depth];
    for (let k = 0; k < cnt; k++) {
      const f = o.start[depth] + (1 - o.start[depth]) * Math.min(0.95, (k + r.range(0.2, 0.8)) / cnt);
      const i = Math.min(segs, Math.round(f * segs)), t = dirs[i];
      const side = perp(t).applyAxisAngle(t, k * 2.4 + r.range(-0.5, 0.5));
      const cd = t.clone().applyAxisAngle(new V3().crossVectors(t, side).normalize(), o.angle[depth] + r.range(-0.2, 0.2)).addScaledVector(UP, o.up ? o.up[depth] : 0).normalize();
      branches(B, r, pts[i], cd, len * o.ratio[depth] * r.range(0.8, 1.15), Math.max(0.005, rads[i] * (o.radRatio || 0.6)), depth + 1, o, onTip);
    }
  }
  if (onTip && depth >= (o.tipDepth ?? o.depth)) onTip(pts[segs], dirs[segs], depth, pts, dirs);
}

/* ================================================================== PLANTS */
const P = {};
const def = (biome, id, name, latin, bend, build, opts = {}) => { (P[biome] ||= {})[id] = { id, biome, name, latin, bend, build, ...opts }; };

/* ---------------- FOREST ---------------- */
def('forest', 'oak', 'Дуб', 'Quercus robur', 0.28, r => {
  const B = new Builder(), h = r.range(2.4, 3.2), lean = new V3(r.range(-0.15, 0.15), 1, r.range(-0.15, 0.15));
  const bark = barkFn(C('#6e4c30'), C('#3e2a1a'), 6, 3);
  const { pts } = growPath(r, new V3(0, -0.15, 0), lean, h, 8, 0.07);
  B.add(tubeGeo(pts, radii(pts.length, 0.3, 0.55, 0.5), 12), { colorFn: bark });
  const top = pts[pts.length - 1], cols = ['#3f7a2a', '#4a8a30', '#55962f', '#3a6e26'].map(C);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + r.range(-0.4, 0.4), i = r.int(4, 7);
    const d = new V3(Math.cos(a), r.range(0.6, 1.2), Math.sin(a));
    const b = growPath(r, pts[i], d, r.range(1.0, 1.6), 5, 0.12);
    B.add(tubeGeo(b.pts, radii(b.pts.length, 0.13, 0.35), 7), { colorFn: bark });
    canopy(B, r, b.pts[b.pts.length - 1].clone().add(new V3(0, 0.3, 0)), new V3(0.5, 0.35, 0.5), 3, 0.85, cols);
  }
  canopy(B, r, top.clone().add(new V3(0, 0.7, 0)), new V3(0.9, 0.5, 0.9), 6, 1.05, cols);
  return B.build(0.28);
});
def('forest', 'birch', 'Берёза', 'Betula pendula', 0.35, r => {
  const B = new Builder(), h = r.range(4.2, 5.4), s = r.seed() & 0xffff;
  const white = C('#ece8dc'), black = C('#26221d');
  const birch = (c, lx, ly, lz) => { const n = noise3(lx * 9, ly * 3.2, lz * 9, s); c.copy(white).lerp(black, sstep(0.45, 0.6, n) * 0.95); if (ly < 0.5) c.lerp(black, (0.5 - ly) * 1.1); };
  const { pts, dirs } = growPath(r, new V3(0, -0.1, 0), new V3(r.range(-0.08, 0.08), 1, r.range(-0.08, 0.08)), h, 10, 0.05);
  B.add(tubeGeo(pts, radii(pts.length, 0.14, 0.25, 0.3), 10), { colorFn: birch });
  const cols = ['#78a83f', '#8ab84a', '#6b9a38'].map(C);
  for (let i = 5; i < pts.length; i++) {
    const n = i < pts.length - 1 ? r.int(1, 2) : 3;
    for (let k = 0; k < n; k++) {
      const a = r.range(0, 6.28), d = new V3(Math.cos(a), 0.45, Math.sin(a));
      const b = growPath(r, pts[i], d, r.range(0.5, 1.0) * (1.25 - i / pts.length * 0.6), 4, 0.1, 0, 0.3);
      B.add(tubeGeo(b.pts, radii(b.pts.length, 0.03, 0.3), 5), { colorFn: birch });
      const tip = b.pts[b.pts.length - 1];
      canopy(B, r, tip.clone().add(new V3(0, -0.1, 0)), new V3(0.18, 0.25, 0.18), 2, r.range(0.28, 0.4), cols, { sy: 1.35, flutter: 0.45 });
    }
  }
  return B.build(0.4);
});
def('forest', 'berry_bush', 'Куст с ягодами', 'Viburnum', 0.12, r => {
  const B = new Builder(), cols = ['#3d7228', '#4b8230', '#356424'].map(C), berry = C('#c2241c');
  const blobs = [];
  for (let k = 0; k < r.int(5, 7); k++) {
    const a = r.range(0, 6.28), d = r.range(0, 0.45), p = new V3(Math.cos(a) * d, r.range(0.35, 0.75), Math.sin(a) * d), s = r.range(0.35, 0.5);
    blobs.push([p, s]);
    B.add(blobGeo(r, { amp: 0.25, freq: 2, sy: 0.8 }), { m: M(p, qE(0, r.range(0, 6), 0), s), colorFn: foliageFn(jit(r.pick(cols), r), r), flutter: 0.3 });
  }
  for (let k = 0; k < 22; k++) {
    const [p, s] = r.pick(blobs), d = r.unit(); d.y = Math.abs(d.y) * 0.6 + 0.1; d.normalize();
    const q = p.clone().addScaledVector(d, s * 0.93);
    for (let j = 0; j < 3; j++) B.add(sphereGeo(8, 6), { m: M(q.clone().add(r.unit().multiplyScalar(0.035)), null, 0.035), color: jit(berry, r, 0.15), flutter: 0.3 });
  }
  return B.build(0.12);
});
def('forest', 'fern', 'Папоротник', 'Dryopteris filix-mas', 0.1, r => {
  const B = new Builder(), col = C('#3f7d2b'), dark = C('#24461a');
  const n = r.int(7, 10);
  for (let k = 0; k < n; k++) {
    const a = k / n * 6.28 + r.range(-0.2, 0.2), len = r.range(0.8, 1.15), tilt = r.range(0.35, 0.7);
    const rot = qE(tilt, a, 0), base = M(new V3(), rot, 1);
    const segs = 14; let y = 0, z = 0;
    const rach = []; for (let i = 0; i <= segs; i++) { const t = i / segs, th = 1.5 * t * t; if (i) { y += Math.cos(th) * len / segs; z += Math.sin(th) * len / segs; } rach.push(new V3(0, y, z)); }
    B.add(tubeGeo(rach, radii(rach.length, 0.012, 0.4), 4), { m: base, color: dark, flutter: 0.3 });
    for (let i = 1; i < segs; i++) {
      const t = i / segs, pl = 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.08)) * (1 - t * 0.35);
      for (const s of [1, -1]) {
        const m = new T.Matrix4().multiplyMatrices(base, M(rach[i], qE(0, 0, -s * (Math.PI / 2 - 0.25)), 1));
        B.add(bladeGeo(pl, 0.06, 0.25, 3, W_LANCE, 0.3), { m, colorFn: (c, lx, ly) => mixC(c, dark, col, 0.4 + ly / pl), flutter: 0.6 });
      }
    }
  }
  return B.build(0.1);
});
def('forest', 'grass', 'Трава', 'Poa', 0.12, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(10, 16), h: r.range(0.35, 0.6), w: 0.05, base: C('#2d4f1c'), tip: C('#8db44a'), spread: 0.1 }); return B.build(0.12);
});
def('forest', 'flowers', 'Ромашки и колокольчики', 'Matricaria, Campanula', 0.12, r => {
  const B = new Builder(), stem = C('#4b7a2c');
  tuft(B, r, { n: 6, h: 0.22, w: 0.05, base: C('#2f5420'), tip: C('#5e8f3a'), widthFn: W_LANCE, spread: 0.05 });
  for (let k = 0; k < r.int(4, 6); k++) {
    const a = r.range(0, 6.28), d = new V3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25);
    const bell = r() < 0.35;
    const { tip, dir } = stemTo(B, r, new V3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05), d, r.range(0.3, 0.5), 0.008, stem, 0.4, bell ? 0.6 : 0);
    if (bell) {
      // колокольчик (Campanula): поникший венчик с пятью отогнутыми лопастями, светлее к краю, зелёная чашечка и тычинки
      const g = latheGeo([[0.003, 0.004], [0.012, -0.012], [0.026, -0.038], [0.036, -0.07], [0.046, -0.1], [0.06, -0.128], [0.076, -0.148], [0.088, -0.156], [0.084, -0.16]], 15, 5, 0.12);
      const lo = C('#6a79c9'), hi = C('#c9d3f7');
      B.add(g, { m: M(tip, qE(0.5, a, 0), 1), colorFn: (c, lx, ly) => mixC(c, lo, hi, Math.min(1, Math.max(0, (-ly - 0.03) / 0.13))), flutter: 0.4 });
      B.add(latheGeo([[0.012, 0.012], [0.022, 0.0], [0.016, -0.02], [0.004, -0.03]], 6), { m: M(tip, qE(0.5, a, 0), 1), color: C('#4b7a2c'), flutter: 0.4 });
      B.add(latheGeo([[0.004, -0.06], [0.007, -0.12], [0.003, -0.15]], 5), { m: M(tip, qE(0.5, a, 0), 1), color: C('#efe6b0'), flutter: 0.4 });
    } else petalFlower(B, at(tip, dir), r, { petals: 13, len: 0.07, w: 0.025, cup: 0.15, color: C('#f6f3ea'), center: C('#efb623'), centerR: 0.024, flutter: 0.4 });
  }
  return B.build(0.12);
});
def('forest', 'amanita', 'Мухомор', 'Amanita muscaria', 0.01, r => {
  const B = new Builder(), s = r.seed() & 0xffff;
  for (let k = 0; k < r.int(1, 3); k++) {
    const sc = k ? r.range(0.5, 0.75) : 1, p = new V3(k ? r.range(-0.2, 0.2) : 0, 0, k ? r.range(-0.2, 0.2) : 0);
    const stem = latheGeo([[0.055, 0], [0.045, 0.05], [0.035, 0.18], [0.033, 0.26]], 12);
    B.add(stem, { m: M(p, null, sc), color: C('#f2ece0') });
    B.add(latheGeo([[0.034, 0.2], [0.06, 0.17], [0.065, 0.165]], 12), { m: M(p, null, sc), color: C('#e9e0cf') });
    const cap = latheGeo([[0.03, 0.24], [0.14, 0.24], [0.16, 0.27], [0.14, 0.33], [0.08, 0.37], [0, 0.385]], 18);
    const red = C('#c8231a'), wht = C('#f6f1e6');
    B.add(cap, { m: M(p, qE(r.range(-0.1, 0.1), 0, r.range(-0.1, 0.1)), sc), colorFn: (c, lx, ly, lz) => { c.copy(ly < 0.245 ? C('#efe6d2') : red); if (ly > 0.26 && noise3(lx * 40, ly * 40, lz * 40, s) > 0.55) c.copy(wht); } });
  }
  return B.build(0.01);
});

/* ---------------- SNOW ---------------- */
const SNOW = C('#f4f7fb'), SNOW_SH = C('#c9d6e6');
def('snow', 'spruce', 'Ель в снегу', 'Picea abies', 0.2, r => {
  const B = new Builder(), h = r.range(4, 5.5), s = r.seed() & 0xffff;
  B.add(tubeGeo([new V3(0, -0.1, 0), new V3(0, h * 0.5, 0), new V3(0, h, 0)], [0.17, 0.1, 0.02], 8), { color: C('#4a3322') });
  const tiers = r.int(5, 7), green = C('#24452f'), green2 = C('#2f5a3a');
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, R0 = (1.45 - t * 1.15) * r.range(0.92, 1.08), th = h * 0.32, y = 0.5 + t * (h - 0.9);
    const g = latheGeo([[0, th], [R0 * 0.35, th * 0.6], [R0 * 0.8, th * 0.16], [R0, 0], [R0 * 0.92, -0.06]], 14, 9, 0.18);
    B.add(g, { m: M(new V3(0, y, 0), qE(0, r.range(0, 6), 0), 1), colorFn: (c, lx, ly, lz, w, n) => {
      const snow = sstep(0.1, 0.35, ly / th + 0.18 * noise3(lx * 3, ly * 3, lz * 3, s)) * sstep(0.35, 0.6, n.y);
      mixC(c, ly < 0.02 ? green : green2, SNOW, snow * 0.95); c.multiplyScalar(0.75 + 0.25 * n.y);
    }, flutter: 0.05 });
  }
  B.add(blobGeo(r, { amp: 0.15, sy: 0.6 }), { m: M(new V3(0, h + 0.05, 0), null, 0.13), color: SNOW });
  return B.build(0.2);
});
def('snow', 'juniper', 'Можжевельник под снегом', 'Juniperus communis', 0.05, r => {
  const B = new Builder(), green = C('#2d4a35'), s = r.seed() & 0xffff;
  for (let k = 0; k < r.int(4, 6); k++) {
    const a = r.range(0, 6.28), d = r.range(0, 0.6), p = new V3(Math.cos(a) * d, r.range(0.15, 0.35), Math.sin(a) * d), sc = r.range(0.35, 0.55);
    B.add(blobGeo(r, { amp: 0.3, freq: 2.2, sy: 0.6 }), { m: M(p, null, sc), colorFn: (c, lx, ly, lz, w, n) => { mixC(c, green, SNOW, sstep(0.3, 0.65, n.y + 0.2 * noise3(w.x * 6, w.y * 6, w.z * 6, s))); c.multiplyScalar(0.7 + 0.3 * (n.y * 0.5 + 0.5)); } });
  }
  for (let k = 0; k < 12; k++) { const p = new V3(r.range(-0.6, 0.6), r.range(0.15, 0.4), r.range(-0.6, 0.6)); B.add(sphereGeo(6, 5), { m: M(p, null, 0.03), color: C('#3d4f8a') }); }
  return B.build(0.05);
});
def('snow', 'frost_shrub', 'Куст в инее', 'Salix lapponum', 0.1, r => {
  const B = new Builder(), wood = C('#5a4a40'), frost = C('#e8f0f8');
  for (let k = 0; k < r.int(5, 7); k++) {
    const a = r.range(0, 6.28);
    branches(B, r, new V3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05), new V3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), r.range(0.6, 0.9), 0.02, 1,
      { depth: 2, kids: [3, 2], start: [0.3, 0.3], angle: [0.6, 0.6], ratio: [0.55, 0.5], taper: 0.3, wob: 0.18, seg0: 5, segsPerUnit: 6,
        colorFn: (c, lx, ly) => mixC(c, wood, frost, sstep(0.35, 0.9, ly)) },
      (p, d) => { B.add(sphereGeo(6, 5), { m: M(p, null, 0.022), color: frost, flutter: 0.2 }); });
  }
  return B.build(0.1);
});
def('snow', 'dry_grass', 'Сухая трава', 'Calamagrostis', 0.15, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(10, 14), h: r.range(0.45, 0.7), w: 0.035, bend: 1.2, base: C('#7a6a48'), tip: C('#d9c79a'), spread: 0.06 }); return B.build(0.15);
});
def('snow', 'snowdrop', 'Подснежники', 'Galanthus nivalis', 0.06, r => {
  const B = new Builder();
  tuft(B, r, { n: 6, h: 0.22, w: 0.03, bend: 0.4, base: C('#2f5a3a'), tip: C('#6f9c7a'), widthFn: W_STRAP, spread: 0.04, flutter: 0.3 });
  for (let k = 0; k < r.int(3, 5); k++) {
    const a = r.range(0, 6.28);
    const { tip } = stemTo(B, r, new V3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), new V3(Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2), r.range(0.2, 0.28), 0.006, C('#4a7a50'), 0.3, 1.6);
    const bell = latheGeo([[0, 0], [0.018, -0.01], [0.026, -0.04], [0.02, -0.065], [0.01, -0.07]], 3);
    B.add(bell, { m: M(tip, qE(0.15, a, 0), 1), color: C('#fafaf5'), flutter: 0.3 });
    B.add(sphereGeo(6, 4), { m: M(tip, null, 0.008), color: C('#6aa86a'), flutter: 0.3 });
  }
  return B.build(0.06);
});
def('snow', 'lichen', 'Ягель', 'Cladonia rangiferina', 0.0, r => {
  const B = new Builder(), s = r.seed() & 0xffff;
  for (let k = 0; k < r.int(4, 7); k++) {
    const a = r.range(0, 6.28), d = r.range(0, 0.35);
    B.add(blobGeo(r, { detail: 3, amp: 0.45, freq: 5, sy: 0.55 }), { m: M(new V3(Math.cos(a) * d, 0.04, Math.sin(a) * d), null, r.range(0.14, 0.24)),
      colorFn: (c, lx, ly, lz, w, n) => { mixC(c, C('#a9ab92'), C('#e2e3cf'), 0.5 + 0.6 * noise3(w.x * 25, w.y * 25, w.z * 25, s)); c.multiplyScalar(0.7 + 0.3 * n.y); } });
  }
  return B.build(0.0);
});

/* ---------------- MOUNTAIN ---------------- */
def('mountain', 'mountain_pine', 'Горная сосна', 'Pinus mugo', 0.15, r => {
  const B = new Builder(), bark = barkFn(C('#6a5040'), C('#3a2a20'), 7, 5), lean = r.range(0, 6.28);
  const { pts } = growPath(r, new V3(0, -0.1, 0), new V3(Math.cos(lean) * 0.6, 1, Math.sin(lean) * 0.6), r.range(1.6, 2.2), 7, 0.15);
  B.add(tubeGeo(pts, radii(pts.length, 0.17, 0.5, 0.4), 9), { colorFn: bark });
  const cols = ['#24402e', '#2c4c35', '#1f3a2a'].map(C);
  const pad = (p) => { for (let j = 0; j < 3; j++) B.add(blobGeo(r, { amp: 0.25, freq: 2, sy: 0.32 }), { m: M(p.clone().add(new V3(r.range(-0.35, 0.35), r.range(0, 0.1), r.range(-0.35, 0.35))), qE(0, r.range(0, 6), 0), r.range(0.45, 0.65)), colorFn: foliageFn(jit(r.pick(cols), r), r, 0.2), flutter: 0.15 }); };
  for (let k = 0; k < 4; k++) {
    const i = r.int(2, pts.length - 2), a = r.range(0, 6.28);
    const b = growPath(r, pts[i], new V3(Math.cos(a), 0.15, Math.sin(a)), r.range(0.7, 1.2), 4, 0.15, 0.04);
    B.add(tubeGeo(b.pts, radii(b.pts.length, 0.07, 0.35), 6), { colorFn: bark });
    pad(b.pts[b.pts.length - 1]);
  }
  pad(pts[pts.length - 1]);
  return B.build(0.15);
});
def('mountain', 'rhododendron', 'Рододендрон', 'Rhododendron ferrugineum', 0.08, r => {
  const B = new Builder(), cols = ['#2f5530', '#3a6236'].map(C), pink = C('#d8467a'), pink2 = C('#f07aa6');
  const blobs = [];
  for (let k = 0; k < r.int(5, 7); k++) { const a = r.range(0, 6.28), d = r.range(0, 0.5), p = new V3(Math.cos(a) * d, r.range(0.25, 0.55), Math.sin(a) * d), s = r.range(0.3, 0.42); blobs.push([p, s]); B.add(blobGeo(r, { amp: 0.25, freq: 2.2, sy: 0.75 }), { m: M(p, null, s), colorFn: foliageFn(jit(r.pick(cols), r), r), flutter: 0.2 }); }
  for (let k = 0; k < 14; k++) {
    const [p, s] = r.pick(blobs), d = r.unit(); d.y = Math.abs(d.y) + 0.3; d.normalize();
    const q = p.clone().addScaledVector(d, s * 0.95);
    for (let j = 0; j < 4; j++) petalFlower(B, at(q.clone().add(r.unit().multiplyScalar(0.04)), d.clone().add(r.unit().multiplyScalar(0.5))), r, { petals: 5, len: 0.05, w: 0.04, cup: 0.6, color: jit(r() < 0.5 ? pink : pink2, r), center: null, flutter: 0.2 });
  }
  return B.build(0.08);
});
def('mountain', 'edelweiss', 'Эдельвейс', 'Leontopodium nivale', 0.05, r => {
  const B = new Builder(), wool = C('#d9dcd2'), woolD = C('#9ea597');
  for (let k = 0; k < 10; k++) B.add(bladeGeo(0.12, 0.035, 1.1, 4, W_LANCE, 0.3), { m: M(new V3(), qE(0.9, k / 10 * 6.28, 0), 1), colorFn: (c, lx, ly) => mixC(c, woolD, wool, ly / 0.12), flutter: 0.2 });
  for (let k = 0; k < r.int(3, 5); k++) {
    const a = r.range(0, 6.28);
    const { tip, dir } = stemTo(B, r, new V3(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03), new V3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3), r.range(0.12, 0.2), 0.007, woolD, 0.3);
    const m = at(tip, dir);
    petalFlower(B, m, r, { petals: 9, len: 0.06, w: 0.022, cup: 0.05, color: C('#f1f2ec'), center: null, flutter: 0.3, widthFn: W_LANCE });
    for (let j = 0; j < 5; j++) B.add(sphereGeo(7, 5), { m: new T.Matrix4().multiplyMatrices(m, M(new V3(r.range(-0.012, 0.012), 0.008, r.range(-0.012, 0.012)), null, 0.011)), color: C('#d8cf9a'), flutter: 0.3 });
  }
  return B.build(0.05);
});
def('mountain', 'moss_campion', 'Смолёвка бесстебельная', 'Silene acaulis', 0.0, r => {
  const B = new Builder(), s = r.seed() & 0xffff, g = C('#3f6a2c'), pink = C('#e46aa0');
  B.add(blobGeo(r, { detail: 3, amp: 0.12, freq: 3, sy: 0.45 }), { m: M(new V3(0, 0.02, 0), null, r.range(0.28, 0.4)),
    colorFn: (c, lx, ly, lz, w, n) => { const f = noise3(w.x * 30, w.y * 30, w.z * 30, s); mixC(c, g, pink, sstep(0.25, 0.45, f) * sstep(0.2, 0.5, n.y)); c.multiplyScalar(0.7 + 0.3 * n.y); } });
  return B.build(0.0);
});
def('mountain', 'alpine_grass', 'Альпийская трава', 'Festuca', 0.12, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(12, 18), h: r.range(0.25, 0.4), w: 0.03, bend: 1.0, base: C('#3a5a3a'), tip: C('#9fb57a'), spread: 0.05 }); return B.build(0.12);
});
def('mountain', 'gentian', 'Горечавка', 'Gentiana acaulis', 0.03, r => {
  const B = new Builder(), blue = C('#2a4fc8');
  for (let k = 0; k < 8; k++) B.add(bladeGeo(0.09, 0.045, 0.9, 3, W_LEAF, 0.3), { m: M(new V3(), qE(0.9, k / 8 * 6.28, 0), 1), color: C('#3f6e35') });
  for (let k = 0; k < r.int(2, 4); k++) {
    const a = r.range(0, 6.28), p = new V3(Math.cos(a) * 0.04, 0.02, Math.sin(a) * 0.04);
    const g = latheGeo([[0.008, 0], [0.018, 0.04], [0.026, 0.09], [0.045, 0.12], [0.05, 0.125]], 5, 5, 0.25);
    B.add(g, { m: M(p, qE(r.range(-0.2, 0.2), r.range(0, 6), r.range(-0.2, 0.2)), 1), colorFn: (c, lx, ly) => mixC(c, C('#1a6a3a'), blue, ly / 0.05), flutter: 0.2 });
  }
  return B.build(0.03);
});

/* ---------------- DESERT ---------------- */
const CACTUS = C('#4f7f3a'), CACTUS_D = C('#2f5426');
const cactusFn = s => (c, lx, ly, lz, w, n) => { mixC(c, CACTUS_D, CACTUS, 0.55 + 0.45 * n.y * 0 + 0.35 * noise3(w.x * 3, w.y * 3, w.z * 3, s)); c.multiplyScalar(0.8 + 0.2 * Math.abs(n.x)); };
def('desert', 'cactus', 'Трихоцереус', 'Echinopsis terscheckii', 0.01, r => {
  const B = new Builder(), s = r.seed() & 0xffff;
  const skin = C('#5b8a46'), skinD = C('#2c4f27'), skinTip = C('#a3c466'), cork = C('#8c7656'), corkD = C('#5e4c38');
  const wool = C('#efe8d6'), spineA = C('#f0dfa6'), spineB = C('#7a5634');
  const unitCone = coneGeo(1, 1, 4), woolGeo = sphereGeo(7, 5);
  const flowerSpots = [];
  function column(pts, R, ribs, young) {
    const n = pts.length, seg = ribs * (LITE ? 3 : 6), cols = seg + 1, pos = [], ribv = [], tv = [], fr = [], idx = [];
    let N = null, prevT = null, L = 0; const Ls = [0];
    for (let i = 1; i < n; i++) { L += pts[i].distanceTo(pts[i - 1]); Ls.push(L); }
    for (let i = 0; i < n; i++) {
      const Tg = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      if (!N) N = perp(Tg); else N.applyQuaternion(new T.Quaternion().setFromUnitVectors(prevT, Tg)).normalize();
      prevT = Tg; const Bv = new V3().crossVectors(Tg, N);
      const t = Ls[i] / L, capStart = 1 - Math.min(0.35, R * 1.6 / L);
      const prof = (t < capStart ? 1 - 0.07 * t : Math.sqrt(Math.max(0, 1 - Math.pow((t - capStart) / (1 - capStart), 2))) * (1 - 0.07 * capStart));
      const rr0 = Math.max(R * prof, 0.0015);
      fr.push({ p: pts[i], N: N.clone(), B: Bv.clone(), T: Tg, r: rr0, t, s: Ls[i] });
      for (let j = 0; j <= seg; j++) {
        const a = j / seg * Math.PI * 2, rv = Math.pow(Math.abs(Math.cos(a * ribs / 2)), 0.5), rr = rr0 * (1 - 0.2 * (1 - rv));
        pos.push(pts[i].x + (N.x * Math.cos(a) + Bv.x * Math.sin(a)) * rr, pts[i].y + (N.y * Math.cos(a) + Bv.y * Math.sin(a)) * rr, pts[i].z + (N.z * Math.cos(a) + Bv.z * Math.sin(a)) * rr);
        ribv.push(rv); tv.push(t);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); fixSeam(g, n, cols);
    B.add(g, { colorFn: (c, lx, ly, lz, w, nn, i) => {
      const rv = ribv[i], t = tv[i];
      mixC(c, skinD, skin, 0.2 + 0.8 * rv);
      c.lerp(skinTip, sstep(0.72, 1, t) * 0.55 + (young ? 0.15 : 0));
      c.multiplyScalar(0.92 + 0.12 * noise3(w.x * 14, w.y * 3, w.z * 14, s));
      if (!young) { const k = 1 - sstep(0.05, 0.38 + 0.08 * noise3(w.x * 9, 0, w.z * 9, s + 1), w.y); c.lerp(noise3(w.x * 30, w.y * 30, w.z * 30, s + 2) > 0.2 ? corkD : cork, k * 0.92); }
    } });
    // areoles along every rib ridge, staggered between neighbouring ribs
    const step = 0.075;
    for (let k = 0; k < ribs; k++) {
      const a = k / ribs * Math.PI * 2;
      for (let sp = 0.12 + (k % 2) * step / 2; sp < L * 0.995; sp += step * (1 - 0.35 * sstep(0.8, 1, sp / L))) {
        let i = 1; while (i < n - 1 && fr[i].s < sp) i++;
        const f0 = fr[i - 1], f1 = fr[i], u = (sp - f0.s) / Math.max(1e-6, f1.s - f0.s);
        const p = f0.p.clone().lerp(f1.p, u), Nn = f0.N.clone().lerp(f1.N, u).normalize(), Bn = f0.B.clone().lerp(f1.B, u).normalize(), Tn = f0.T.clone().lerp(f1.T, u).normalize();
        const rr = f0.r + (f1.r - f0.r) * u; if (rr < 0.01) continue;
        const out = Nn.clone().multiplyScalar(Math.cos(a)).addScaledVector(Bn, Math.sin(a)).normalize();
        const ap = p.clone().addScaledVector(out, rr * 1.005);
        const t = sp / L;
        if (!young && ap.y < 0.3) continue;
        if (LITE) { if (!young && t > 0.55 && t < 0.9 && r() < 0.05) flowerSpots.push({ p: ap, out, Tn }); continue; }
        B.add(woolGeo, { m: at(ap, out, new V3(0.011, 0.006, 0.011)), color: wool });
        const side = new V3().crossVectors(out, Tn).normalize();
        const nr = young ? 5 : 7;
        for (let q = 0; q < nr; q++) {
          const ang = q / nr * Math.PI * 2 + r.range(-0.2, 0.2);
          const dir = out.clone().multiplyScalar(0.35).addScaledVector(Tn, Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize();
          const len = r.range(0.022, 0.04) * (young ? 0.7 : 1);
          B.add(unitCone, { m: at(ap, dir, new V3(0.0022, len, 0.0022)), colorFn: (c, lx, ly) => mixC(c, spineA, spineB, ly) });
        }
        const cd = out.clone().addScaledVector(Tn, 0.35).normalize(), cl = r.range(0.05, 0.085) * (young ? 0.6 : 1);
        B.add(unitCone, { m: at(ap, cd, new V3(0.003, cl, 0.003)), colorFn: (c, lx, ly) => mixC(c, spineA, spineB, 0.2 + ly * 0.8) });
        if (!young && t > 0.55 && t < 0.9 && r() < 0.05) flowerSpots.push({ p: ap, out, Tn });
      }
    }
    // woolly crown at the apex
    const top = pts[n - 1];
    B.add(blobGeo(r, { amp: 0.35, freq: 4, sy: 0.45 }), { m: M(top.clone().addScaledVector(prevT, -0.01), qAlign(prevT), R * 0.38), color: wool });
  }
  // main stem + basal offsets that sweep outward then turn up
  const ribsMain = r.int(10, 12), Rm = r.range(0.15, 0.19);
  const main = growPath(r, new V3(0, -0.08, 0), new V3(r.range(-0.06, 0.06), 1, r.range(-0.06, 0.06)), r.range(1.7, 2.3), 26, 0.025);
  column(main.pts, Rm, ribsMain, false);
  const offs = r.int(2, 4), a0 = r.range(0, 6.28);
  for (let k = 0; k < offs; k++) {
    const a = a0 + k / offs * Math.PI * 2 + r.range(-0.4, 0.4), d0 = Rm * 1.2;
    const start = new V3(Math.cos(a) * d0, r.range(0.05, 0.35), Math.sin(a) * d0);
    const p = growPath(r, start, new V3(Math.cos(a), 0.35, Math.sin(a)), r.range(0.9, 1.6), 22, 0.02, 0.09);
    column(p.pts, Rm * r.range(0.78, 0.92), ribsMain - r.int(0, 2), false);
  }
  if (r() < 0.8) { const a = r.range(0, 6.28); const p = growPath(r, new V3(Math.cos(a) * 0.3, -0.05, Math.sin(a) * 0.3), new V3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3), r.range(0.22, 0.32), 8, 0.02); column(p.pts, 0.1, 9, true); }
  // large night-blooming flowers and woolly buds
  const pick = flowerSpots.sort(() => r() - 0.5).slice(0, r.int(2, 4));
  pick.forEach((f, i) => {
    const dir = f.out.clone().multiplyScalar(0.55).addScaledVector(UP, 0.85).normalize();
    if (i === pick.length - 1 && pick.length > 2) { B.add(sphereGeo(10, 8), { m: at(f.p.clone().addScaledVector(dir, 0.05), dir, new V3(0.028, 0.065, 0.028)), colorFn: (c, lx, ly, lz) => { mixC(c, C('#5d4a32'), wool, 0.5 + 0.6 * noise3(lx * 9, ly * 9, lz * 9, s)); } }); return; }
    const tubeP = []; for (let q = 0; q <= 6; q++) { const u = q / 6; tubeP.push(f.p.clone().addScaledVector(f.out, 0.07 * Math.sin(u * 1.6)).addScaledVector(UP, 0.16 * u * u + 0.02 * u)); }
    B.add(tubeGeo(tubeP, tubeP.map((_, q) => 0.016 + 0.012 * Math.pow(q / 6, 2)), 10), { colorFn: (c, lx, ly, lz) => { mixC(c, C('#5f6a3a'), C('#3a3424'), 0.5 + noise3(lx * 60, ly * 60, lz * 60, s)); if (noise3(lx * 90, ly * 90, lz * 90, s + 5) > 0.45) c.copy(wool); } });
    const head = at(tubeP[6], tubeP[6].clone().sub(tubeP[5]).normalize().addScaledVector(UP, 0.6));
    petalFlower(B, head, r, { petals: 13, len: 0.11, w: 0.034, cup: 0.15, color: C('#e2b49a'), center: null, flutter: 0.05, widthFn: W_LANCE });
    petalFlower(B, head, r, { petals: 15, len: 0.1, w: 0.045, cup: 0.42, color: C('#fbf8f0'), center: null, flutter: 0.05, layers: 2 });
    for (let q = 0; q < (LITE ? 0 : 26); q++) {
      const ang = r.range(0, 6.28), rad = r.range(0.004, 0.02);
      const base = new V3(Math.cos(ang) * rad * 0.4, 0.005, Math.sin(ang) * rad * 0.4).applyMatrix4(head);
      const tip = new V3(Math.cos(ang) * rad, r.range(0.025, 0.04), Math.sin(ang) * rad).applyMatrix4(head);
      B.add(tubeGeo([base, tip], [0.0012, 0.001], 3), { color: C('#e8e2b0') });
      B.add(sphereGeo(5, 4), { m: M(tip, null, 0.0035), color: C('#f2c83a') });
    }
    B.add(sphereGeo(8, 6), { m: M(new V3(0, 0.05, 0).applyMatrix4(head), null, 0.007), color: C('#d8e8a0') });
  });
  return B.build(0.01);
});
def('desert', 'prickly_pear', 'Опунция', 'Opuntia engelmannii', 0.02, r => {
  const B = new Builder(), s = r.seed() & 0xffff, green = C('#6e9c4c'), greenD = C('#45703a'), wool = C('#e9dfc4'), glo = C('#d8b860');
  const unitCone = coneGeo(1, 1, 4), SX = 0.075, SY = 0.36, SZ = 0.28;
  const padFn = (c, lx, ly, lz, w, n) => { mixC(c, greenD, green, 0.55 + 0.45 * Math.abs(n.y) * 0 + 0.4 * noise3(w.x * 4, w.y * 4, w.z * 4, s)); c.multiplyScalar(0.85 + 0.2 * Math.max(0, n.y)); };
  const pad = (p, rotY, tiltZ, sc, depth) => {
    const q = qE(0, rotY, tiltZ), m = M(p, q, sc);
    const pm = new T.Matrix4().multiplyMatrices(m, M(new V3(0, SY * 0.95, 0), null, 1));
    B.add(blobGeo(r, { detail: LITE ? 2 : 3, amp: 0.04, freq: 1.2, sx: SX, sy: SY, sz: SZ }), { m: pm, colorFn: padFn });
    // areoles with woolly glochid tufts on both faces
    if (!LITE) for (let u = -0.85; u <= 0.86; u += 0.2) for (let v = -0.8; v <= 0.81; v += 0.24) {
      const vv = v + ((Math.round(u * 5) & 1) ? 0.12 : 0), rr = u * u + vv * vv; if (rr > 0.8) continue;
      for (const sg of [1, -1]) {
        const loc = new V3(sg * Math.sqrt(1 - rr) * SX * 1.02, u * SY, vv * SZ).applyMatrix4(pm);
        const out = new V3(sg / SX * Math.sqrt(1 - rr), u / SY, vv / SZ).normalize().applyQuaternion(q).normalize();
        B.add(sphereGeo(6, 4), { m: at(loc, out, new V3(0.009 * sc, 0.004 * sc, 0.009 * sc)), color: glo });
        if (r() < 0.6) { const d = out.clone().addScaledVector(r.unit(), 0.5).normalize(); B.add(unitCone, { m: at(loc, d, new V3(0.002, r.range(0.025, 0.045) * sc, 0.002)), colorFn: (c, lx, ly) => mixC(c, wool, C('#9a7a52'), ly) }); }
      }
    }
    const top = new V3(0, SY * 1.9, 0).applyMatrix4(m);
    if (depth < 2) for (let k = 0; k < r.int(1, 3); k++) pad(top.clone().add(new V3(0, -0.07 * sc, 0)), rotY + r.range(-0.9, 0.9), tiltZ + r.range(-0.6, 0.6), sc * r.range(0.8, 0.92), depth + 1);
    else for (let k = 0; k < r.int(2, 4); k++) {
      const fp = top.clone().add(new V3(0, 0, r.range(-0.12, 0.12) * sc).applyQuaternion(q)).add(new V3(0, -0.01, 0));
      if (r() < 0.6) B.add(sphereGeo(10, 8), { m: M(fp.clone().add(new V3(0, 0.03, 0)), null, new V3(0.032, 0.05, 0.032)), colorFn: (c, lx, ly, lz) => { mixC(c, C('#7a1f3a'), C('#b8304e'), 0.5 + ly); } });
      else petalFlower(B, at(fp, UP), r, { petals: 10, len: 0.045, w: 0.028, cup: 0.6, color: C('#f2cf3a'), center: C('#c9d070'), centerR: 0.012, flutter: 0.05, layers: 2 });
    }
  };
  pad(new V3(0, -0.04, 0), r.range(0, 6), 0, 1, 0);
  return B.build(0.02);
});
def('desert', 'barrel_cactus', 'Эхинокактус', 'Echinocactus grusonii', 0.0, r => {
  const B = new Builder(), s = r.seed() & 0xffff, R0 = r.range(0.28, 0.38), ribs = 20;
  const prof = []; for (let i = 0; i <= 10; i++) { const a = -0.1 + i / 10 * (Math.PI / 2 + 0.1); prof.push([R0 * Math.cos(Math.max(0, a) * 0.95) + 0.001, R0 * 0.85 * Math.sin(Math.max(0, a)) + R0 * 0.25]); } prof.unshift([R0 * 0.9, 0]); prof.push([0, R0 * 1.12]);
  B.add(latheGeo(prof, LITE ? 40 : 60, ribs, 0.14), { colorFn: (c, lx, ly, lz, w, n) => { c.copy(C('#5f8a3e')).multiplyScalar(0.7 + 0.3 * n.y + 0.1 * noise3(lx * 9, ly * 9, lz * 9, s)); } });
  const spine = C('#e6c96a');
  for (let k = 0; k < ribs; k++) {
    const a = k / ribs * Math.PI * 2;
    for (let i = 2; i < 10; i += 2) {
      const [pr, py] = prof[i], base = new V3(Math.cos(a) * pr, py, Math.sin(a) * pr), d = new V3(Math.cos(a), 0.6, Math.sin(a)).normalize();
      for (let j = 0; j < (LITE ? 1 : 3); j++) B.add(coneGeo(0.006, 0.07, 4), { m: at(base, d.clone().add(r.unit().multiplyScalar(0.5)), 1), color: spine });
    }
  }
  for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; petalFlower(B, at(new V3(Math.cos(a) * 0.08, R0 * 1.08, Math.sin(a) * 0.08), UP), r, { petals: 10, len: 0.05, w: 0.02, cup: 0.8, color: C('#f2c21f'), center: C('#c98f14'), centerR: 0.012 }); }
  return B.build(0.0);
});
def('desert', 'agave', 'Агава', 'Agave americana', 0.04, r => {
  const B = new Builder(), blue = C('#7a9a92'), edge = C('#c9b45a');
  const n = r.int(16, 22);
  for (let k = 0; k < n; k++) {
    const a = k * 2.4, ring = k / n, len = r.range(0.8, 1.15) * (0.6 + ring * 0.5), tilt = 0.25 + (1 - ring) * 0.9 + r.range(-0.1, 0.1);
    const w0 = 0.2;
    B.add(bladeGeo(len, w0, 0.5, 6, t => Math.pow(1 - t, 0.9) * (0.7 + 0.3 * Math.sin(Math.min(1, t * 3) * Math.PI / 2)), 0.45), {
      m: M(new V3(0, 0.05, 0), qE(tilt, a, 0), 1),
      colorFn: (c, lx, ly) => { const e = Math.abs(lx) / (w0 / 2 * Math.pow(1 - ly / len, 0.9) + 1e-3); mixC(c, blue, edge, sstep(0.8, 1, e) * 0.85); if (ly > len * 0.93) c.copy(C('#4a3a2a')); }, flutter: 0.05 });
  }
  return B.build(0.04);
});
def('desert', 'tumbleweed', 'Перекати-поле', 'Salsola tragus', 0.06, r => {
  const B = new Builder(), col = C('#b89a68'), R0 = r.range(0.4, 0.55), c0 = new V3(0, R0 * 0.9, 0);
  for (let k = 0; k < 40; k++) {
    const p = c0.clone().addScaledVector(r.unit(), R0 * r.range(0.2, 0.9)), d = r.unit();
    const pts = []; const q = p.clone(); for (let i = 0; i < 5; i++) { pts.push(q.clone()); d.add(r.unit().multiplyScalar(0.6)).normalize(); q.addScaledVector(d, R0 * 0.18); const off = q.clone().sub(c0); if (off.length() > R0) q.copy(c0).addScaledVector(off.normalize(), R0); }
    B.add(tubeGeo(pts, pts.map(() => 0.008), 3), { color: jit(col, r, 0.2) });
  }
  return B.build(0.06);
});
def('desert', 'desert_grass', 'Пустынный злак', 'Bouteloua', 0.1, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(8, 12), h: r.range(0.3, 0.5), w: 0.03, bend: 1.3, base: C('#8a7a4a'), tip: C('#e2cf96'), spread: 0.05 }); return B.build(0.1);
});

/* ---------------- SWAMP ---------------- */
def('swamp', 'mangrove', 'Мангровое дерево', 'Rhizophora', 0.18, r => {
  const B = new Builder(), bark = barkFn(C('#5a4a3a'), C('#2e261e'), 6, 7), y0 = r.range(1.0, 1.3), h = r.range(2.2, 3);
  const { pts } = growPath(r, new V3(0, y0, 0), UP, h, 7, 0.08);
  B.add(tubeGeo(pts, radii(pts.length, 0.2, 0.5), 10), { colorFn: bark });
  const n = r.int(7, 10);
  for (let k = 0; k < n; k++) {
    const a = k / n * 6.28 + r.range(-0.2, 0.2), R1 = r.range(1.0, 1.7), yA = y0 + r.range(-0.2, 0.6), rp = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, rr = 0.12 + t * R1; rp.push(new V3(Math.cos(a) * rr, yA * (1 - t * t) + 0.35 * Math.sin(t * Math.PI) - 0.25 * t, Math.sin(a) * rr)); }
    B.add(tubeGeo(rp, rp.map((_, i) => 0.085 * (1 - i / 14)), 7), { colorFn: bark });
  }
  const cols = ['#3a5a26', '#46682c', '#334f22'].map(C), top = pts[pts.length - 1];
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + r.range(0, 1), b = growPath(r, pts[r.int(4, 6)], new V3(Math.cos(a), 0.9, Math.sin(a)), 1.1, 4, 0.1); B.add(tubeGeo(b.pts, radii(b.pts.length, 0.09, 0.4), 6), { colorFn: bark }); canopy(B, r, b.pts[4].clone().add(new V3(0, 0.3, 0)), new V3(0.5, 0.25, 0.5), 3, 0.8, cols, { sy: 0.7 }); }
  canopy(B, r, top.clone().add(new V3(0, 0.5, 0)), new V3(0.9, 0.35, 0.9), 5, 1.0, cols, { sy: 0.7 });
  return B.build(0.18);
});
def('swamp', 'willow', 'Плакучая ива', 'Salix babylonica', 0.3, r => {
  const B = new Builder(), bark = barkFn(C('#5e5040'), C('#33291f'), 5, 9), h = r.range(2.2, 2.8);
  const { pts } = growPath(r, new V3(0, -0.1, 0), new V3(r.range(-0.2, 0.2), 1, r.range(-0.2, 0.2)), h, 6, 0.1);
  B.add(tubeGeo(pts, radii(pts.length, 0.32, 0.6, 0.5), 12), { colorFn: bark });
  const cols = ['#7a9a3a', '#8aa848', '#6a8a32'].map(C), top = pts[pts.length - 1];
  canopy(B, r, top.clone().add(new V3(0, 0.6, 0)), new V3(1.2, 0.35, 1.2), 7, 0.95, cols, { sy: 0.6 });
  for (let k = 0; k < 70; k++) {
    const a = r.range(0, 6.28), d = Math.sqrt(r()) * 2.0, p = top.clone().add(new V3(Math.cos(a) * d, 0.55 - d * 0.18 + r.range(-0.1, 0.1), Math.sin(a) * d));
    const len = r.range(1.2, 2.4), g = bladeGeo(len, 0.11, 0.25, 6, t => 0.5 + 0.5 * (1 - t), 0.3);
    const col = jit(r.pick(cols), r, 0.12);
    B.add(g, { m: M(p, qE(Math.PI + r.range(-0.15, 0.15), a, 0), 1), colorFn: (c, lx, ly) => c.copy(col).multiplyScalar(0.85 + 0.25 * (ly / len)), flutter: 1.0 });
  }
  return B.build(0.3, 1.4);
});
def('swamp', 'cattail', 'Рогоз', 'Typha latifolia', 0.2, r => {
  const B = new Builder(), stem = C('#5a7a34'), head = C('#5a3a20');
  for (let k = 0; k < r.int(8, 12); k++) {
    const a = r.range(0, 6.28), d = r.range(0, 0.25), h = r.range(1.3, 1.9), p = new V3(Math.cos(a) * d, 0, Math.sin(a) * d), tilt = new V3(r.range(-0.08, 0.08), 1, r.range(-0.08, 0.08)).normalize();
    B.add(cylGeo(0.012, 0.016, h, 5), { m: at(p, tilt), color: stem });
    const hp = p.clone().addScaledVector(tilt, h * 0.78);
    B.add(latheGeo([[0, 0], [0.04, 0.02], [0.045, 0.1], [0.045, 0.2], [0.04, 0.24], [0, 0.26]], 10), { m: at(hp, tilt), colorFn: (c, lx, ly, lz, w, n) => c.copy(head).multiplyScalar(0.8 + 0.25 * n.y) });
  }
  tuft(B, r, { n: 14, h: 1.5, w: 0.06, bend: 0.8, base: C('#3e5a28'), tip: C('#8aa04a'), widthFn: W_STRAP, spread: 0.2, flutter: 0.7 });
  return B.build(0.2);
});
def('swamp', 'water_lily', 'Кувшинка', 'Nymphaea alba', 0.0, r => {
  const B = new Builder(), pad = C('#3e6e2a'), padD = C('#2a4e1c');
  for (let k = 0; k < r.int(3, 6); k++) {
    const a = r.range(0, 6.28), d = r.range(0.1, 0.65), R0 = r.range(0.2, 0.32), notch = r.range(0, 6.28), prof = [];
    const g = new T.CircleGeometry(R0, 24, notch + 0.35, Math.PI * 2 - 0.7); g.rotateX(-Math.PI / 2);
    B.add(g, { m: M(new V3(Math.cos(a) * d, 0.012 + k * 0.002, Math.sin(a) * d), null, 1), colorFn: (c, lx, ly, lz) => mixC(c, pad, padD, Math.hypot(lx, lz) / R0 * 0.6 + 0.15 * Math.sin(Math.atan2(lz, lx) * 14)) });
  }
  for (let k = 0; k < r.int(1, 2); k++) {
    const p = new V3(r.range(-0.3, 0.3), 0.02, r.range(-0.3, 0.3)), pink = r() < 0.5;
    petalFlower(B, M(p, null, 1), r, { petals: 10, len: 0.12, w: 0.045, cup: 0.35, color: pink ? C('#f3b6c8') : C('#faf8f2'), center: C('#f0c63a'), centerR: 0.03, layers: 2, flutter: 0 });
  }
  return B.build(0.0);
}, { onWater: true });
def('swamp', 'sedge', 'Осока', 'Carex', 0.15, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(14, 20), h: r.range(0.7, 1.0), w: 0.035, bend: 1.4, base: C('#2e4a22'), tip: C('#7c8f3a'), spread: 0.1, flutter: 0.6 }); return B.build(0.15);
});
def('swamp', 'hummock', 'Кочка с мхом', 'Sphagnum', 0.05, r => {
  const B = new Builder(), s = r.seed() & 0xffff;
  B.add(blobGeo(r, { detail: 3, amp: 0.2, freq: 2.5, sy: 0.5 }), { m: M(new V3(0, 0.02, 0), null, r.range(0.45, 0.6)),
    colorFn: (c, lx, ly, lz, w, n) => { mixC(c, C('#5a7a2a'), C('#a8a83a'), 0.5 + 0.7 * noise3(w.x * 9, w.y * 9, w.z * 9, s)); if (noise3(w.x * 4, w.y * 4, w.z * 4, s + 3) > 0.45) c.lerp(C('#b8504a'), 0.5); c.multiplyScalar(0.65 + 0.35 * n.y); } });
  tuft(B, r, { n: 12, h: 0.45, w: 0.03, bend: 1.2, base: C('#3a5226'), tip: C('#a0a050'), spread: 0.15, at: M(new V3(0, 0.22, 0), null, 1) });
  return B.build(0.05);
});

/* ---------------- VOLCANO ---------------- */
const CHAR = C('#1e1a18'), EMBER = C('#ff6a1a'), EMBER2 = C('#ffb03a');
def('volcano', 'charred_tree', 'Обугленное дерево', 'Arbor ustus', 0.04, r => {
  const B = new Builder(), s = r.seed() & 0xffff;
  const glowFn = (lx, ly, lz) => sstep(0.6, 0.75, noise3(lx * 6, ly * 2.5, lz * 6, s)) * (ly < 2.5 ? 1 : 0.3);
  const colorFn = (c, lx, ly, lz) => { const g = glowFn(lx, ly, lz); mixC(c, CHAR.clone().multiplyScalar(0.8 + 0.4 * noise3(lx * 10, ly * 10, lz * 10, s)), EMBER, g); };
  branches(B, r, new V3(0, -0.15, 0), new V3(r.range(-0.15, 0.15), 1, r.range(-0.15, 0.15)), r.range(2.4, 3.2), 0.22, 0,
    { depth: 3, kids: [4, 3, 2], start: [0.45, 0.3, 0.3], angle: [0.85, 0.7, 0.7], ratio: [0.55, 0.55, 0.5], radRatio: 0.55, taper: 0.35, wob: 0.15, lift: 0.04, flare: 0.6, seg0: 10, colorFn, glowFn });
  return B.build(0.04);
});
def('volcano', 'ember_shrub', 'Тлеющий куст', 'Frutex ardens', 0.05, r => {
  const B = new Builder();
  for (let k = 0; k < r.int(26, 40); k++) {
    const d = r.unit(); d.y = Math.abs(d.y) * 0.9 + 0.15; d.normalize(); const len = r.range(0.35, 0.75);
    const g = coneGeo(0.03, len, 5);
    B.add(g, { m: at(new V3(r.range(-0.08, 0.08), 0.02, r.range(-0.08, 0.08)), d), colorFn: (c, lx, ly) => mixC(c, CHAR, EMBER2, sstep(0.55, 1, ly / len)), glow: (lx, ly) => sstep(0.6, 1, ly / len) * 1.2 });
  }
  B.add(blobGeo(r, { amp: 0.3, sy: 0.5 }), { m: M(new V3(0, 0.03, 0), null, 0.18), color: CHAR });
  return B.build(0.05);
});
def('volcano', 'fire_lily', 'Огненная лилия', 'Lilium bulbiferum', 0.08, r => {
  const B = new Builder(), stem = C('#2a2420');
  tuft(B, r, { n: 7, h: 0.35, w: 0.04, bend: 0.8, base: CHAR, tip: C('#4a3a30'), widthFn: W_LANCE, spread: 0.05 });
  for (let k = 0; k < r.int(2, 4); k++) {
    const a = r.range(0, 6.28);
    const { tip, dir } = stemTo(B, r, new V3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), new V3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25), r.range(0.5, 0.8), 0.012, stem, 0.3);
    petalFlower(B, at(tip, dir), r, { petals: 6, len: 0.16, w: 0.06, cup: -0.5, color: r() < 0.5 ? C('#ff4a1a') : C('#ff8a1a'), center: C('#ffd25a'), centerR: 0.02, glow: 0.9, flutter: 0.3, widthFn: W_LANCE });
  }
  return B.build(0.08);
});
def('volcano', 'ash_grass', 'Пепельная трава', 'Gramen cinereum', 0.1, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(9, 13), h: r.range(0.3, 0.5), w: 0.035, bend: 1.0, base: C('#2a2624'), tip: C('#8a8580'), spread: 0.06, glowTip: 0.0 });
  for (let k = 0; k < 3; k++) B.add(sphereGeo(5, 4), { m: M(new V3(r.range(-0.1, 0.1), r.range(0.15, 0.35), r.range(-0.1, 0.1)), null, 0.012), color: EMBER2, glow: 1.5, flutter: 0.6 });
  return B.build(0.1);
});
def('volcano', 'magma_crystal', 'Магмовый кристалл', 'Crystallum igneum', 0.0, r => {
  const B = new Builder(), obs = C('#1a1418'), core = C('#ff5418');
  for (let k = 0; k < r.int(5, 8); k++) {
    const d = new V3(r.range(-0.6, 0.6), 1, r.range(-0.6, 0.6)).normalize(), h = r.range(0.4, 1.1) * (k ? 1 : 1.3), w = h * r.range(0.12, 0.18);
    const g = latheGeo([[0, -0.05], [w, 0], [w, h * 0.8], [0, h]], 6);
    B.add(g, { m: at(new V3(r.range(-0.15, 0.15), 0, r.range(-0.15, 0.15)), d, 1, r.range(0, 6)), colorFn: (c, lx, ly) => mixC(c, obs, core, sstep(0.0, 0.7, ly / h) * 0.7), glow: (lx, ly) => 0.25 + sstep(0.3, 0.95, ly / h) * 0.8 });
  }
  return B.build(0.0);
});

/* ---------------- SEA (algae & reef) ---------------- */
def('sea', 'kelp', 'Ламинария', 'Macrocystis pyrifera', 1.1, r => {
  const B = new Builder(), stipe = C('#6a5a22'), blade = C('#8a7a2a'), bladeD = C('#5a4a1a');
  for (let k = 0; k < r.int(2, 4); k++) {
    const h = r.range(4.5, 7), a = r.range(0, 6.28), p0 = new V3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
    const { pts, dirs } = growPath(r, p0, new V3(r.range(-0.1, 0.1), 1, r.range(-0.1, 0.1)), h, 16, 0.05);
    B.add(tubeGeo(pts, pts.map(() => 0.02), 5), { color: stipe });
    for (let i = 2; i < pts.length; i++) {
      const s = i % 2 ? 1 : -1, len = r.range(0.7, 1.1);
      B.add(sphereGeo(6, 5), { m: M(pts[i], null, 0.045), color: C('#a08a3a') });
      B.add(bladeGeo(len, 0.16, 0.6, 7, W_LEAF, 0.1, 0.035), { m: M(pts[i], qE(0, a + s * 1.4 + r.range(-0.4, 0.4), s * 0.9), 1), colorFn: (c, lx, ly) => mixC(c, bladeD, blade, ly / len), flutter: 1.2 });
    }
  }
  B.add(blobGeo(r, { amp: 0.3, sy: 0.5 }), { m: M(new V3(0, 0, 0), null, 0.18), color: C('#4a3a1a') });
  return B.build(1.1, 1.3);
}, { underwater: true });
def('sea', 'seagrass', 'Морская трава', 'Zostera marina', 0.35, r => {
  const B = new Builder(); tuft(B, r, { n: r.int(10, 16), h: r.range(0.8, 1.3), w: 0.04, bend: 0.5, base: C('#2a5a2a'), tip: C('#7aa850'), widthFn: W_STRAP, spread: 0.12, flutter: 1.0 }); return B.build(0.35, 1.5);
}, { underwater: true });
def('sea', 'branch_coral', 'Ветвистый коралл', 'Acropora', 0.0, r => {
  const B = new Builder(), cols = [['#e8705a', '#ffc2a0'], ['#c85aa0', '#f2b2dc'], ['#e8a03a', '#ffe0a0']], [c0, c1] = r.pick(cols).map(C);
  for (let k = 0; k < r.int(3, 5); k++) {
    const a = r.range(0, 6.28);
    branches(B, r, new V3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1), new V3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5), r.range(0.35, 0.5), 0.07, 0,
      { depth: 3, kids: [3, 3, 2], start: [0.4, 0.4, 0.4], angle: [0.6, 0.55, 0.5], up: [0.4, 0.5, 0.5], ratio: [0.8, 0.75, 0.7], radRatio: 0.78, taper: 0.7, wob: 0.15, lift: 0.08, seg0: 8, segsPerUnit: 10,
        colorFn: (c, lx, ly, lz) => mixC(c, c0, c1, ly / 1.2) },
      (p, d) => B.add(sphereGeo(8, 6), { m: M(p, null, 0.035), color: c1 }));
  }
  return B.build(0.0);
}, { underwater: true });
def('sea', 'brain_coral', 'Мозговой коралл', 'Diploria', 0.0, r => {
  const B = new Builder(), s = r.seed() & 0xffff, R0 = r.range(0.45, 0.65);
  const g = weld(new T.IcosahedronGeometry(1, 5)), p = g.attributes.position, col = [C('#c8b06a'), C('#8a9a4a'), C('#d8a0a0')][r.int(0, 2)];
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const w = fbm3(_v.x * 1.5, _v.y * 1.5, _v.z * 1.5, 2, s), m = Math.sin((_v.x * 9 + _v.y * 7 + w * 9) * 1.2) * Math.sin((_v.z * 9 - _v.y * 5 + w * 7) * 1.2);
    const k = 1 + 0.045 * Math.sign(m) * Math.pow(Math.abs(m), 0.4);
    p.setXYZ(i, _v.x * k * R0, Math.max(-0.1, _v.y * k * R0 * 0.75), _v.z * k * R0);
  }
  g.computeVertexNormals();
  B.add(g, { m: M(new V3(0, 0.05, 0)), colorFn: (c, lx, ly, lz, w, n) => { const rad = Math.hypot(lx, ly / 0.75, lz) / R0; c.copy(col).multiplyScalar(0.55 + 0.6 * sstep(0.97, 1.04, rad)); } });
  return B.build(0.0);
}, { underwater: true });
def('sea', 'sea_fan', 'Горгонария', 'Gorgonia ventalina', 0.15, r => {
  const B = new Builder(), col = r() < 0.5 ? C('#8a3ab8') : C('#d84a5a'), plane = r.range(0, 3.14);
  const q = qE(0, plane, 0);
  const grow2 = (p, ang, len, rad, d) => {
    const pts = [p.clone()], q0 = p.clone(); let a = ang;
    for (let i = 1; i <= 5; i++) { a += r.range(-0.15, 0.15); q0.add(new V3(Math.sin(a) * len / 5, Math.cos(a) * len / 5, 0)); pts.push(q0.clone()); }
    B.add(tubeGeo(pts, radii(pts.length, rad, 0.7), 4), { m: M(new V3(), q, 1), color: col, flutter: 0.15 });
    if (d < 5) for (const s of [-1, 1]) if (r() < 0.9) grow2(pts[r.int(3, 5)], a + s * r.range(0.3, 0.6), len * r.range(0.6, 0.8), rad * 0.75, d + 1);
  };
  grow2(new V3(), 0, r.range(0.5, 0.7), 0.03, 0);
  return B.build(0.15);
}, { underwater: true });
def('sea', 'anemone', 'Актиния', 'Actinia equina', 0.05, r => {
  const B = new Builder(), [body, tent] = r.pick([['#b83a3a', '#ff8aa0'], ['#3a8a6a', '#b0f0c0'], ['#d87a2a', '#ffd08a']]).map(C), R0 = r.range(0.14, 0.2);
  B.add(latheGeo([[R0 * 1.2, 0], [R0, 0.05], [R0 * 0.9, 0.18], [R0 * 1.05, 0.25], [R0 * 0.3, 0.26], [0, 0.24]], 18), { color: body });
  for (let k = 0; k < 44; k++) {
    const a = k * 2.4, rr = R0 * (0.35 + 0.6 * ((k * 0.618) % 1)), p = new V3(Math.cos(a) * rr, 0.25, Math.sin(a) * rr);
    const len = r.range(0.12, 0.2), d = new V3(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6);
    const { pts } = growPath(r, p, d, len, 4, 0.1, 0, 0.3);
    B.add(tubeGeo(pts, radii(pts.length, 0.012, 0.4), 4), { colorFn: (c, lx, ly) => mixC(c, tent, tent.clone().multiplyScalar(1.3), (ly - 0.25) / len), flutter: (lx, ly) => (ly - 0.25) * 8 });
  }
  return B.build(0.05);
}, { underwater: true });
def('sea', 'sea_lettuce', 'Ульва', 'Ulva lactuca', 0.25, r => {
  const B = new Builder(), col = C('#5ab83a');
  for (let k = 0; k < r.int(6, 9); k++) {
    const a = r.range(0, 6.28), len = r.range(0.3, 0.5);
    B.add(bladeGeo(len, 0.28, 0.6, 6, W_LEAF, 0.1, 0.06, r.range(-0.6, 0.6)), { m: M(new V3(), qE(r.range(0.2, 0.6), a, 0), 1), colorFn: (c, lx, ly) => c.copy(col).multiplyScalar(0.7 + 0.5 * ly / len), flutter: 0.8 });
  }
  return B.build(0.25);
}, { underwater: true });

// ракушки и камешки: гребешки с рёбрами, завитки, окатанная галька — россыпь на песке дна
def('sea', 'shells', 'Ракушки и галька', 'Pecten, Turritella', 0.0, r => {
  const B = new Builder(), cols = ['#f1dfc4', '#e6c9a8', '#f3e9d6', '#d9b48a', '#cfa3a0'].map(C);
  for (let k = 0; k < r.int(4, 7); k++) {
    const a = r.range(0, 6.28), d = r.range(0.02, 0.4), p = new V3(Math.cos(a) * d, 0, Math.sin(a) * d), col = jit(r.pick(cols), r, 0.06), sc = r.range(0.6, 1.3), t = r();
    if (t < 0.45) {         // гребешок: плоская раковина с радиальными рёбрами
      B.add(latheGeo([[0, 0.034], [0.03, 0.036], [0.065, 0.026], [0.095, 0.01], [0.1, 0.0]], 18, 13, 0.14), { m: M(p, qE(r.range(-0.5, 0.5), r.range(0, 6.28), r.range(-0.4, 0.4)), new V3(sc, sc * 0.8, sc * 0.9)), color: col });
    } else if (t < 0.7) {   // башенка: конус из колец
      B.add(latheGeo([[0.03, 0], [0.034, 0.02], [0.026, 0.04], [0.03, 0.06], [0.02, 0.08], [0.022, 0.1], [0.012, 0.125], [0.002, 0.15]], 10, 0, 0), { m: M(p.clone().setY(0.01), qE(1.35, r.range(0, 6.28), 0), sc), color: col });
    } else {                // галька
      const g = new V3(sc * r.range(0.04, 0.09), sc * r.range(0.02, 0.04), sc * r.range(0.04, 0.08));
      B.add(sphereGeo(8, 6), { m: M(p.clone().setY(0.006), qE(0, r.range(0, 6.28), 0), g), color: jit(C(r.pick(['#8b8a80', '#a69f8c', '#6d6a64', '#c2b79b'])), r, 0.08) });
    }
  }
  return B.build(0.0);
}, { underwater: true });
def('sea', 'urchin', 'Морской ёж', 'Paracentrotus', 0.0, r => {
  const B = new Builder(), body = C(r.pick(['#3b2a4f', '#2a2a3a', '#5a2f45'])), R0 = r.range(0.055, 0.08);
  B.add(sphereGeo(9, 7), { m: M(new V3(0, R0 * 0.85, 0), null, new V3(R0, R0 * 0.8, R0)), color: body });
  for (let k = 0; k < 46; k++) {
    const d = r.unit(); if (d.y < -0.15) continue;
    const base = d.clone().multiplyScalar(R0 * 0.9).add(new V3(0, R0 * 0.85, 0));
    B.add(unitCone, { m: at(base, d, new V3(0.004, r.range(0.05, 0.085), 0.004)), colorFn: (c, lx, ly) => mixC(c, body, C('#a88ac0'), ly) });
  }
  return B.build(0.0);
}, { underwater: true });
def('sea', 'starfish', 'Морская звезда', 'Asterias', 0.0, r => {
  const B = new Builder(), col = C(r.pick(['#e2602a', '#d8442f', '#e8a23a', '#b84a6a'])), n = r() < 0.2 ? 6 : 5, arm = r.range(0.1, 0.15);
  B.add(sphereGeo(8, 5), { m: M(new V3(0, 0.012, 0), null, new V3(0.04, 0.016, 0.04)), color: col });
  for (let k = 0; k < n; k++) {
    const a = k / n * 6.2832 + r.range(-0.08, 0.08), d = new V3(Math.cos(a), 0.04, Math.sin(a)).normalize();
    B.add(unitCone, { m: at(new V3(Math.cos(a) * 0.025, 0.008, Math.sin(a) * 0.025), d, new V3(0.034, arm, 0.016)), colorFn: (c, lx, ly) => mixC(c, col, C('#f6d9a0'), ly * 0.5) });
  }
  return B.build(0.0);
}, { underwater: true });

/* ================================================================== SURFACES */
const BIOMES = {
  forest:   { name: 'Лес',     sky: ['#9fc6e0', '#e3ecd8'], fog: 0xc9d8c4, sun: 0xfff0d8, amb: [0xdfeaf5, 0x5a6a3a], water: null },
  snow:     { name: 'Снег',    sky: ['#a9c1dc', '#eef3f8'], fog: 0xdfe8f2, sun: 0xfff6ee, amb: [0xe8f0ff, 0x8a98b0], water: null },
  mountain: { name: 'Горы',    sky: ['#86a8cc', '#dfe6ea'], fog: 0xc8d2da, sun: 0xfff4e4, amb: [0xdde8f4, 0x6a6a64], water: null },
  desert:   { name: 'Пустыня', sky: ['#e0b884', '#f6e7c8'], fog: 0xeedcb8, sun: 0xffe8c0, amb: [0xfff0d8, 0xa08050], water: null },
  swamp:    { name: 'Болото',  sky: ['#6e8a6a', '#c6cfa8'], fog: 0x9aa884, sun: 0xf0ecc8, amb: [0xd0dcc0, 0x3a4a2a], water: { level: 0, color: '#6f7f5c', opacity: 0.72 } },
  volcano:  { name: 'Вулкан',  sky: ['#3a1410', '#c4441e'], fog: 0x5a2418, sun: 0xffb080, amb: [0xff8a5a, 0x2a1210], water: null },
  sea:      { name: 'Море',    sky: ['#0e4a6a', '#3aa0b8'], fog: 0x1e6a84, sun: 0xd8f4ff, amb: [0x9ad8f0, 0x1a3a4a], water: { level: 7, color: '#2a8aa8', opacity: 0.42, surface: true } }
};
function heightFn(biome, s) {
  switch (biome) {
    case 'forest': return (x, z) => fbm2(x * 0.045, z * 0.045, 4, s) * 1.6 + fbm2(x * 0.3, z * 0.3, 2, s + 9) * 0.12;
    case 'snow': return (x, z) => { const d = fbm2(x * 0.05, z * 0.05, 4, s) * 1.6; const sas = 0.12 * Math.abs(Math.sin(x * 0.55 + z * 0.25 + fbm2(x * 0.1, z * 0.1, 2, s + 4) * 4)); return d + sas; };
    case 'mountain': return (x, z) => { const r = ridged2(x * 0.035, z * 0.035, 5, s); let h = Math.pow(r, 2.2) * 9 - 1.5; const k = 1.1, f = h / k, fl = Math.floor(f), tf = f - fl; h = (fl + sstep(0.6, 0.95, tf)) * k * 0.65 + h * 0.35; return h + fbm2(x * 0.4, z * 0.4, 2, s + 3) * 0.15; };
    case 'desert': return (x, z) => { const w = fbm2(x * 0.03, z * 0.03, 3, s) * 6; const u = (x * 0.06 + z * 0.02 + w * 0.15); const f = u - Math.floor(u); const dune = f < 0.72 ? sstep(0, 1, f / 0.72) : sstep(0, 1, (1 - f) / 0.28); return dune * 1.8 * (0.6 + 0.4 * fbm2(x * 0.02, z * 0.02, 2, s + 1)) + 0.05 * Math.sin(x * 2.4 + z * 0.8 + w * 3); };
    case 'swamp': return (x, z) => fbm2(x * 0.06, z * 0.06, 4, s) * 1.1 - 0.06 + fbm2(x * 0.35, z * 0.35, 2, s + 5) * 0.08;
    case 'volcano': return (x, z) => { const b = fbm2(x * 0.05, z * 0.05, 4, s) * 1.6 + fbm2(x * 0.5, z * 0.5, 2, s + 2) * 0.12; const ch = Math.abs(fbm2(x * 0.035, z * 0.035, 3, s + 7)); return b - 0.35 * (1 - sstep(0.01, 0.05, ch)); };
    case 'sea': return (x, z) => fbm2(x * 0.04, z * 0.04, 4, s) * 2.2 + 0.06 * Math.sin(x * 2.2 + fbm2(x * 0.2, z * 0.2, 2, s) * 5) + 0.04 * Math.sin(z * 3.1);
  }
}
function surfaceColor(biome, s) {
  const c1 = new T.Color(), c2 = new T.Color();
  const K = {
    forest: [C('#4f8a2c'), C('#3a6e22'), C('#7a5a3a'), C('#6a9a38')],
    snow: [C('#e4ebf4'), C('#aebfd6'), C('#6e737c'), C('#9cc4e0')],
    mountain: [C('#8a8682'), C('#5e5a56'), C('#6b8a42'), C('#f2f4f6')],
    desert: [C('#d8ae74'), C('#b98650'), C('#e4c088'), C('#a06a3a')],
    swamp: [C('#3c3424'), C('#556a2a'), C('#7a8a3a'), C('#2a2418')],
    volcano: [C('#2a2422'), C('#48403c'), C('#8a8078'), C('#ff5a14')],
    sea: [C('#d8c69a'), C('#b8a678'), C('#6a8a5a'), C('#8a8478')]
  }[biome];
  return (c, x, y, z, n, H) => {
    const nz = fbm2(x * 0.15, z * 0.15, 3, s + 11), fine = noise3(x * 1.7, y * 1.7, z * 1.7, s + 12);
    switch (biome) {
      case 'forest': mixC(c, K[0], K[1], 0.5 + nz * 1.2); c.lerp(K[3], sstep(0.2, 0.5, fine) * 0.4); c.lerp(K[2], sstep(0.32, 0.45, fbm2(x * 0.08, z * 0.08, 3, s + 21)) * 0.85); break;
      case 'snow': { const hollow = clamp((H(x, z) - y) * 0 + (1 - n.y) * 3); mixC(c, K[0], K[1], 0.25 + nz * 0.6 + hollow * 0.4); c.lerp(K[2], sstep(0.8, 0.7, n.y)); c.lerp(K[3], sstep(0.4, 0.5, fbm2(x * 0.06, z * 0.06, 2, s + 31)) * 0.8); break; }
      case 'mountain': { const strata = 0.5 + 0.5 * Math.sin(y * 4.5 + nz * 2); mixC(c, K[0], K[1], strata * 0.7 + fine * 0.2); c.lerp(K[2], sstep(0.8, 0.9, n.y) * (1 - sstep(4.2, 5.2, y)) * (0.65 + 0.35 * nz)); c.lerp(K[3], sstep(5.2, 6.2, y + nz * 1.2) * sstep(0.5, 0.7, n.y)); break; }
      case 'desert': mixC(c, K[0], K[2], 0.5 + nz * 0.8); c.lerp(K[1], (1 - n.x * 0.5 - 0.5) * 0.5 + sstep(0.95, 0.85, n.y) * 0.3); c.lerp(K[3], sstep(0.35, 0.5, fbm2(x * 0.05, z * 0.05, 2, s + 41)) * 0.35); break;
      case 'swamp': mixC(c, K[0], K[1], sstep(-0.05, 0.25, y) + nz * 0.4); c.lerp(K[2], sstep(0.3, 0.5, fine) * sstep(0.1, 0.3, y) * 0.6); c.lerp(K[3], sstep(0.05, -0.2, y)); break;
      case 'volcano': { const ch = Math.abs(fbm2(x * 0.035, z * 0.035, 3, s + 7)); mixC(c, K[0], K[1], 0.5 + nz); c.lerp(K[2], sstep(0.85, 0.98, n.y) * sstep(0.2, 0.5, fine) * 0.35); c.lerp(K[3], 1 - sstep(0.012, 0.028, ch)); c.lerp(C('#8a2a10'), (1 - sstep(0.03, 0.06, ch)) * sstep(0.012, 0.028, ch) * 0.7); break; }
      case 'sea': mixC(c, K[0], K[1], 0.5 + nz * 0.9 + fine * 0.2); c.lerp(K[2], sstep(0.3, 0.5, fbm2(x * 0.07, z * 0.07, 2, s + 51)) * 0.5); c.lerp(K[3], sstep(0.85, 0.7, n.y)); break;
    }
  };
}
function waterNormalTex() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), img = g.createImageData(S, S);
  const h = (x, y) => fbm3(x / S * 8, y / S * 8, 0.5, 3, 77) + fbm3((x / S) * 8 + 8, (y / S) * 8, 1.5, 3, 78) * 0.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h((x + 1) % S, y) - h((x - 1 + S) % S, y), dy = h(x, (y + 1) % S) - h(x, (y - 1 + S) % S), i = (y * S + x) * 4;
    img.data[i] = 128 + dx * 300; img.data[i + 1] = 128 + dy * 300; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; return t;
}
let _waterTex = null; const waterMats = [];
function createSurface(biome, opts = {}) {
  const { size = 60, seg = 180, seed = 1, flatten = 1, round = true } = opts, s = seed & 0xffff;
  const H0 = heightFn(biome, s), H = (x, z) => H0(x, z) * flatten;
  const geo = new T.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); let y = H(x, z); if (round) { const d = Math.hypot(x, z) / (size / 2); y -= sstep(0.85, 1.0, d) * 1.5; } p.setY(i, y); }
  geo.computeVertexNormals();
  const n = geo.attributes.normal, colors = [], plant = [], colFn = surfaceColor(biome, s), c = new T.Color(), nn = new V3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i); nn.fromBufferAttribute(n, i);
    colFn(c, x, y, z, nn, H); colors.push(c.r, c.g, c.b);
    let glow = 0; if (biome === 'volcano') { const ch = Math.abs(fbm2(x * 0.035, z * 0.035, 3, s + 7)); glow = (1 - sstep(0.012, 0.028, ch)) * 1.1 + (1 - sstep(0.03, 0.06, ch)) * 0.2; }
    plant.push(0, 0, glow);
  }
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aPlant', new T.Float32BufferAttribute(plant, 3));
  const mat = patchMaterial(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), biome === 'sea' ? 1 : 0);
  const mesh = new T.Mesh(geo, mat); mesh.receiveShadow = true;
  const group = new T.Group(); group.add(mesh);
  const W = BIOMES[biome].water; let water = null;
  if (W) {
    _waterTex ||= waterNormalTex();
    const wm = new T.MeshStandardMaterial({ color: C(W.color), transparent: true, opacity: W.opacity, roughness: 0.12, metalness: 0.1, normalMap: _waterTex, normalScale: new T.Vector2(0.35, 0.35), side: T.DoubleSide, depthWrite: !W.surface });
    wm.normalMap.repeat.set(size / 8, size / 8); waterMats.push(wm);
    water = new T.Mesh(new T.CircleGeometry(size / 2 * (W.surface ? 1.2 : 0.97), 64), wm); water.rotation.x = -Math.PI / 2; water.position.y = W.level; water.receiveShadow = !W.surface;
    group.add(water);
  }
  const lavaAt = (x, z) => biome === 'volcano' && Math.abs(fbm2(x * 0.035, z * 0.035, 3, s + 7)) < 0.05;
  return { group, mesh, water, heightAt: H, waterLevel: W ? W.level : -Infinity, sample: (x, z) => ({ h: H(x, z), lava: lavaAt(x, z), underWater: W ? H(x, z) < W.level : false }), biome };
}

/* ================================================================== public API */
const _geoCache = new Map();
function plantGeometry(biome, id, seed = 1) {
  const key = biome + '/' + id + '/' + seed; if (_geoCache.has(key)) return _geoCache.get(key);
  const d = P[biome] && P[biome][id]; if (!d) throw new Error('BiomeKit: нет растения ' + key);
  const g = d.build(rngOf(seed * 7919 + id.length * 131)); _geoCache.set(key, g); return g;
}
function createPlant(biome, id, seed = 1) {
  const m = new T.Mesh(plantGeometry(biome, id, seed), plantMaterial());
  m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = depthMaterial(); m.name = biome + ':' + id; return m;
}
function update(t) {
  uniforms.uTime.value = t; uniforms.uGlow.value = 1 + 0.22 * Math.sin(t * 1.7) + 0.08 * Math.sin(t * 5.3);
  waterMats.forEach(m => { m.normalMap.offset.set(t * 0.012, t * 0.008); });
}
function listPlants(biome) { return Object.values(P[biome] || {}).map(({ id, name, latin, onWater, underwater }) => ({ id, name, latin, onWater: !!onWater, underwater: !!underwater })); }

global.BiomeKit = { version: '1.0.0', setLite: v => { LITE = !!v; }, surfaceColor, heightFn, waterNormalTex, biomes: BIOMES, listPlants, plantGeometry, createPlant, plantMaterial, depthMaterial, createSurface, update, uniforms, clearCache: () => { _geoCache.forEach(g => g.dispose()); _geoCache.clear(); }, _noise: { fbm2, noise3 } };
})(__G);
const BiomeKit = __G.BiomeKit;
export { BiomeKit };

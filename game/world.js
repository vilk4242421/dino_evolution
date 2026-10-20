/* Мир: ландшафт 640×640 по карте высот, вода/лава, деревья/камни/растительность (инстансинг по чанкам с LOD), небо со звёздами,
   смена дня и ночи, погода, арена босса, порталы, мини-карта. Один конструктор на биом (6 биомов + круглая арена дуэли). */
import * as THREE from 'three';
import { BiomeKit } from './biomekit.js';
import { DinoNest } from './dinonest.js';
import { Tree } from './treekit.js';
BiomeKit.setLite(true);   // в игре без микродеталей (иголки 2 мм не видны), меньше полигонов
const CONFIG = window.CONFIG, Sim = window.Sim;

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
function compose(x, y, z, rotY, sx, sy, sz) { _q.setFromAxisAngle(UP, rotY); _p.set(x, y, z); _s.set(sx, sy, sz); return _m.compose(_p, _q, _s); }
function trs(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  if (ry) m.multiply(new THREE.Matrix4().makeRotationY(ry));
  if (rx) m.multiply(new THREE.Matrix4().makeRotationX(rx));
  if (rz) m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  return m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
}
export function mergeColored(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const part of parts) {
    const g = part.g.index ? part.g.toNonIndexed() : part.g.clone();
    g.applyMatrix4(part.m); g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(part.c);
    for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
export { trs };
const hashNoise = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const col3 = (h) => new THREE.Color(h);

// ---------- гладкое слияние деталей с цветом: нормали сохраняются (без «граней»), цвет — с градиентом и шумом ----------
const vn3 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
function snoise(x, y, z) {   // гладкий шум 3D
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf), L = (a, b, t) => a + (b - a) * t, c = (a, b, d) => vn3(xi + a, yi + b, zi + d);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
export function mergeSmooth(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.g.attributes.position.count; ni += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ind = new Uint32Array(ni);
  let ov = 0, oi = 0; const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), c1 = new THREE.Color(), c2 = new THREE.Color(), c = new THREE.Color();
  for (const p of parts) {
    const g = p.g; if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, T = g.attributes.uv, cnt = P.count;
    nm.getNormalMatrix(p.m); c1.set(p.c); c2.set(p.c2 !== undefined ? p.c2 : p.c);
    g.computeBoundingBox(); const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i); if (p.sphN) n.copy(v).normalize();
      if (p.jit) { const d = (snoise(v.x * p.jf + 3.1, v.y * p.jf + 1.7, v.z * p.jf + 5.3) - 0.5) * p.jit; v.addScaledVector(n, d); }
      const ty = (v.y - y0) / ((y1 - y0) || 1);
      v.applyMatrix4(p.m); n.applyMatrix3(nm).normalize();
      pos.set([v.x, v.y, v.z], (ov + i) * 3); nor.set([n.x, n.y, n.z], (ov + i) * 3);
      c.copy(c1).lerp(c2, ty);
      if (p.rib) { const a = Math.atan2(P.getZ(i), P.getX(i)); c.multiplyScalar(0.84 + 0.16 * Math.abs(Math.cos(a * p.rib))); }
      const k = 0.88 + 0.24 * snoise(v.x * 1.7, v.y * 1.7, v.z * 1.7); c.multiplyScalar(p.flat ? 1 : k);
      col.set([c.r, c.g, c.b], (ov + i) * 3);
      if (T) { uv[(ov + i) * 2] = T.getX(i) * (p.uvs || 1); uv[(ov + i) * 2 + 1] = T.getY(i) * (p.uvs || 1); }
    }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) ind[oi + i] = I[i] + ov; oi += I.length; } else { for (let i = 0; i < cnt; i++) ind[oi + i] = ov + i; oi += cnt; }
    ov += cnt;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}
// процедурные текстуры: зерно/травинки/камушки — тонкая детализация поверх окраса вершин
const texCache = new Map();
function detailTex(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  g.fillStyle = 'rgb(232,232,232)'; g.fillRect(0, 0, S, S);
  const R = Sim.mulberry32(kind.length * 131 + 7);
  const dot = (x, y, r, a, l) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.fillStyle = `rgba(${l},${l},${l},${a})`; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.283); g.fill(); } };
  for (let i = 0; i < 1800; i++) dot(R() * S, R() * S, 0.6 + R() * 1.6, 0.08 + R() * 0.12, R() < 0.5 ? 150 : 255);
  if (kind === 'grass') for (let i = 0; i < 900; i++) { const x = R() * S, y = R() * S, l = 4 + R() * 7, a = -1.9 + R() * 0.8; g.strokeStyle = `rgba(${R() < 0.5 ? 170 : 255},${R() < 0.5 ? 180 : 255},${R() < 0.5 ? 160 : 255},0.35)`; g.lineWidth = 1 + R(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  if (kind === 'stone' || kind === 'sand' || kind === 'ash') for (let i = 0; i < 260; i++) dot(R() * S, R() * S, 1.5 + R() * 4, 0.12 + R() * 0.18, R() < 0.5 ? 140 : 250);
  if (kind === 'sand') { g.strokeStyle = 'rgba(160,160,160,0.25)'; g.lineWidth = 2; for (let y = 0; y < S; y += 16) { g.beginPath(); for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin(x / S * 6.283 * 2 + y) * 4); g.stroke(); } }
  if (kind === 'snow') for (let i = 0; i < 500; i++) dot(R() * S, R() * S, 0.8 + R() * 1.2, 0.35, 255);
  if (kind === 'bark') { for (let x = 0; x < S; x += 6 + R() * 6) { g.strokeStyle = `rgba(110,110,110,${0.25 + R() * 0.3})`; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.05 + x) * 3, y); g.stroke(); } }
  if (kind === 'water') { g.fillStyle = 'rgb(200,200,200)'; g.fillRect(0, 0, S, S); for (let i = 0; i < 160; i++) { const x = R() * S, y = R() * S, r = 6 + R() * 22; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { const gr = g.createRadialGradient(x + ox, y + oy, r * 0.2, x + ox, y + oy, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } } }
  if (kind === 'leaf') for (let i = 0; i < 700; i++) { const x = R() * S, y = R() * S, a = R() * 6.283; g.fillStyle = `rgba(${R() < 0.5 ? 150 : 255},${R() < 0.5 ? 150 : 255},${R() < 0.5 ? 150 : 255},0.3)`; g.beginPath(); g.ellipse(x, y, 5, 2.2, a, 0, 6.283); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  texCache.set(kind, t); return t;
}
let _wn = null; const waterNrm = () => (_wn || (_wn = BiomeKit.waterNormalTex()));
// мягкая круглая точка для частиц (дым, морской снег, планктон) — вместо квадратов
let _dot = null;
function dotTex() {
  if (_dot) return _dot; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); _dot = new THREE.CanvasTexture(c); return _dot;
}
const GROUND_KIND = { forest: 'grass', snow: 'snow', mountain: 'stone', desert: 'sand', swamp: 'grass', volcano: 'ash', duel: 'stone', reef: 'sand', kelp: 'stone', arctic: 'stone', vents: 'ash', abyss: 'stone' };

// ---------- деревья по стилю: [близкая, дальняя] ----------
function treeGeos(style, biome) {
  const IC = (r, d) => new THREE.IcosahedronGeometry(r, d === undefined ? 1 : d), Cy = (a, b, h, s = 8) => new THREE.CylinderGeometry(a, b, h, s, 2), Co = (r, h, s = 11) => new THREE.ConeGeometry(r, h, s, 2);
  const leaf = (r, x, y, z, c, c2, sy, d) => ({ g: IC(r, d === undefined ? 1 : d), m: trs(x, y, z, 1, sy || 0.85, 1), c, c2, jit: r * 0.35, jf: 1.6 / r, sphN: true });
  const snowy = biome === 'snow';
  if (style === 'pine') {
    const nd = snowy ? 0xe8f2f8 : 0x4c9a60, base = snowy ? 0x2f5a46 : 0x2a5f3e;
    return [mergeSmooth([
      { g: Cy(0.22, 0.42, 2.4), m: trs(0, 1.2, 0), c: 0x4f3622, c2: 0x6a4a30, uvs: 2 },
      { g: Co(2.2, 2.6), m: trs(0, 2.9, 0), c: base, c2: snowy ? 0x9ab8c0 : 0x387a4e, jit: 0.25, jf: 1.2 },
      { g: Co(1.8, 2.4), m: trs(0, 4.4, 0), c: base, c2: snowy ? 0xc8dde6 : 0x428a57, jit: 0.22, jf: 1.4 },
      { g: Co(1.3, 2.2), m: trs(0, 5.8, 0), c: 0x387a4e, c2: snowy ? nd : 0x4c9a60, jit: 0.18, jf: 1.6 },
      { g: Co(0.7, 1.4), m: trs(0, 7.1, 0), c: 0x428a57, c2: nd, jit: 0.1, jf: 2 }
    ]), mergeSmooth([{ g: Cy(0.3, 0.4, 1.6, 6), m: trs(0, 0.8, 0), c: 0x5a3f27 }, { g: Co(2.0, 6.5, 8), m: trs(0, 4.6, 0), c: base, c2: snowy ? nd : 0x428a57 }])];
  }
  if (style === 'cactus') {
    const g1 = 0x3f8a42, g2 = 0x5fae58, cap = (r, l, x, y, z, rz) => ({ g: new THREE.CapsuleGeometry(r, l, 4, 10), m: trs(x, y, z, 1, 1, 1, 0, 0, rz || 0), c: g1, c2: g2, rib: 7, flat: false });
    return [mergeSmooth([
      cap(0.48, 3.0, 0, 1.9, 0), cap(0.28, 1.0, 0.85, 2.2, 0), cap(0.26, 0.55, 0.5, 1.55, 0, 1.57), cap(0.26, 0.8, -0.8, 2.6, 0), cap(0.25, 0.5, -0.48, 2.05, 0, 1.57),
      { g: IC(0.22, 1), m: trs(0, 3.85, 0), c: 0xe890b0, c2: 0xffc0d8 }, { g: IC(0.16, 1), m: trs(0.85, 2.95, 0), c: 0xf0d050 }
    ]), mergeSmooth([{ g: Cy(0.5, 0.55, 3.4, 6), m: trs(0, 1.7, 0), c: g1 }, { g: Cy(0.3, 0.3, 1.4, 5), m: trs(0.8, 1.9, 0), c: g2 }])];
  }
  if (style === 'mangrove') {
    const bark = 0x4a3a28;
    return [mergeSmooth([
      { g: Cy(0.26, 0.42, 2.6), m: trs(0, 2.1, 0), c: bark, c2: 0x5a4a32, uvs: 2 },
      { g: Cy(0.08, 0.16, 2.4, 7), m: trs(0.8, 1.0, 0.2, 1, 1, 1, 0, 0, -0.5), c: bark }, { g: Cy(0.08, 0.16, 2.4, 7), m: trs(-0.8, 1.0, -0.2, 1, 1, 1, 0, 0, 0.5), c: bark },
      { g: Cy(0.08, 0.16, 2.4, 7), m: trs(0.2, 1.0, -0.8, 1, 1, 1, 0.5, 0, 0), c: bark }, { g: Cy(0.08, 0.16, 2.4, 7), m: trs(-0.2, 1.0, 0.8, 1, 1, 1, -0.5, 0, 0), c: bark },
      leaf(2.0, 0, 4.3, 0, 0x3c6a30, 0x5a8a40, 0.62), leaf(1.4, 1.2, 3.9, 0.5, 0x456f34, 0x62904a), leaf(1.25, -1.1, 4.1, -0.5, 0x3a6430, 0x5a8540), leaf(1.0, 0.2, 4.9, -0.9, 0x4c7a3a, 0x6c9a50, 0.85, 0)
    ]), mergeSmooth([{ g: Cy(0.3, 0.5, 2.2, 5), m: trs(0, 1.1, 0), c: bark }, { g: IC(2.2, 0), m: trs(0, 3.6, 0, 1.1, 0.7, 1.1), c: 0x4b7a3a, sphN: true }])];
  }
  if (style === 'burnt') {
    const ch = 0x241e1d;
    return [mergeSmooth([
      { g: Cy(0.16, 0.42, 4.6), m: trs(0, 2.3, 0), c: 0x1a1514, c2: 0x2e2625, uvs: 2 },
      { g: Cy(0.07, 0.15, 2.1, 7), m: trs(0.7, 3.6, 0, 1, 1, 1, 0, 0, -0.8), c: ch }, { g: Cy(0.07, 0.14, 1.7, 7), m: trs(-0.6, 3.3, 0.2, 1, 1, 1, 0, 0, 0.9), c: ch },
      { g: Cy(0.05, 0.1, 1.2, 6), m: trs(0.2, 4.4, -0.5, 1, 1, 1, -0.7, 0, 0), c: ch }, { g: IC(0.18, 1), m: trs(0.1, 4.7, 0), c: 0xff6a2a, flat: true }, { g: IC(0.12, 1), m: trs(1.45, 4.15, 0), c: 0xff8a3a, flat: true }
    ]), mergeSmooth([{ g: Cy(0.2, 0.4, 4.4, 5), m: trs(0, 2.2, 0), c: ch }, { g: Cy(0.1, 0.15, 2, 4), m: trs(0.6, 3.5, 0, 1, 1, 1, 0, 0, -0.8), c: ch }])];
  }
  // broad: лиственное дерево с пышной кроной
  return [mergeSmooth([
    { g: new THREE.CylinderGeometry(0.26, 0.46, 3.2, 7, 1), m: trs(0, 1.6, 0), c: 0x5a3c24, c2: 0x6f4c2e, uvs: 2 },
    { g: new THREE.CylinderGeometry(0.09, 0.17, 1.8, 5, 1, true), m: trs(0.55, 3.2, 0.1, 1, 1, 1, 0, 0, -0.75), c: 0x5f4028 }, { g: new THREE.CylinderGeometry(0.08, 0.15, 1.6, 5, 1, true), m: trs(-0.5, 3.4, -0.2, 1, 1, 1, 0.2, 0, 0.8), c: 0x5f4028 },
    leaf(1.9, 0, 4.1, 0, 0x2f7a34, 0x4aa04a), leaf(1.35, 1.0, 4.6, 0.35, 0x37853a, 0x58b052), leaf(1.25, -0.95, 4.8, -0.3, 0x2f7634, 0x50a64a, 0.85, 0),
    leaf(1.1, 0.2, 5.8, 0.1, 0x3d8c3e, 0x66bc5a, 0.85, 0), leaf(0.9, -0.2, 4.4, 1.1, 0x35823a, 0x56aa4e, 0.85, 0)
  ]), mergeSmooth([{ g: Cy(0.3, 0.4, 2, 5), m: trs(0, 1, 0), c: 0x6b4a2b }, { g: IC(2.1, 0), m: trs(0, 4.6, 0, 1, 1.15, 1), c: 0x3a8a3c, c2: 0x55aa4c, sphN: true, jit: 0.5, jf: 0.8 }])];
}
// трава/мелкая растительность по биому
function groundCover(id) {
  const Co = (r, h, sg = 3) => new THREE.ConeGeometry(r, h, sg, 1, true), parts = [];
  const mk = (c1, c2, h, n) => { for (let i = 0; i < n; i++) parts.push({ g: Co(0.08, h, 3), m: trs(Math.cos(i * 2.1) * 0.08, h / 2, Math.sin(i * 2.1) * 0.08, 1, 1, 1, 0.18, i * 2.1), c: mulC(c1, 0.6), c2: i === 1 ? c2 : c1 }); };
  if (id === 'forest') { mk(0x5fa046, 0x8acb5e, 0.9, 3); parts.push({ g: new THREE.TetrahedronGeometry(0.1, 0), m: trs(0.15, 0.72, 0.1), c: 0xffe066, flat: true, sphN: true }); }
  else if (id === 'snow') { parts.push({ g: Co(0.14, 0.7, 4), m: trs(0, 0.35, 0), c: 0x9fc8e4, c2: 0xe8f6ff }, { g: Co(0.1, 0.5, 4), m: trs(0.25, 0.25, 0.1, 1, 1, 1, 0.3), c: 0xa8d4f0, c2: 0xffffff }, { g: Co(0.1, 0.45, 4), m: trs(-0.2, 0.22, -0.1, 1, 1, 1, -0.3), c: 0x88b8d8, c2: 0xe0f0fa }); }
  else if (id === 'mountain') mk(0x6a7a4a, 0x9aaa6a, 0.55, 3);
  else if (id === 'desert') { parts.push({ g: new THREE.IcosahedronGeometry(0.4, 0), m: trs(0, 0.22, 0, 1.3, 0.55, 1.3), c: 0x8a7a40, c2: 0xb8aa6a, sphN: true }, { g: Co(0.05, 0.8, 3), m: trs(0.2, 0.4, 0.1, 1, 1, 1, 0.3), c: 0x9a8a50, c2: 0xd2c080 }, { g: Co(0.05, 0.7, 3), m: trs(-0.2, 0.35, 0, 1, 1, 1, -0.3), c: 0x9a8a50, c2: 0xc8b478 }); }
  else if (id === 'swamp') { mk(0x5f8a3a, 0x9ac260, 1.6, 3); parts.push({ g: new THREE.CylinderGeometry(0.04, 0.05, 1.5, 6), m: trs(0.3, 0.75, 0), c: 0x6b5a2b }, { g: new THREE.CylinderGeometry(0.08, 0.08, 0.4, 5, 1), m: trs(0.3, 1.62, 0), c: 0x5a3a20, flat: true }); }
  else { parts.push({ g: Co(0.22, 1.0, 4), m: trs(0, 0.5, 0), c: 0x141010, c2: 0x2e2625 }, { g: Co(0.14, 0.6, 4), m: trs(0.3, 0.3, 0.1, 1, 1, 1, 0.3), c: 0x1e1a1a, c2: 0x3a302c }, { g: new THREE.IcosahedronGeometry(0.1, 0), m: trs(0, 0.1, 0.25), c: 0xff7a2a, flat: true, sphN: true }); }
  return mergeSmooth(parts);
}
const mulC = (h, f) => new THREE.Color(h).multiplyScalar(f).getHex();
// реалистичный валун: многооктавный шум + срезанные грани (сколы), плоское основание, слои породы,
// тёмные трещины в углублениях и мох/снег/песок на верхних гранях
function rockGeometry(biome, rc) {
  const g = new THREE.IcosahedronGeometry(1, 3), P = g.attributes.position, v = new THREE.Vector3(), cols = new Float32Array(P.count * 3);
  const c0 = new THREE.Color(rc[0]), c1 = new THREE.Color(rc[1]), dark = new THREE.Color(rc[0]).multiplyScalar(0.45), tmp = new THREE.Color();
  const top = { forest: 0x5a7a3a, swamp: 0x4a6a30, snow: 0xf2f8fc, mountain: 0x6a7a4a, desert: 0xd8b880, arctic: 0xe8f2f8, reef: 0xd8c8a0, kelp: 0x4a6a3a }[biome];
  const topC = top !== undefined ? new THREE.Color(top) : null;
  const planes = []; const R = Sim.mulberry32(biome.length * 71 + 3);
  for (let i = 0; i < 7; i++) { const n = new THREE.Vector3(R() * 2 - 1, R() * 1.4 - 0.2, R() * 2 - 1).normalize(); planes.push({ n, d: 0.62 + R() * 0.28 }); }
  const hd = [];
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i); const dir = v.clone().normalize();
    let r = 1 + (snoise(v.x * 1.3 + 4, v.y * 1.3, v.z * 1.3) - 0.5) * 0.55 + (snoise(v.x * 3.1, v.y * 3.1 + 7, v.z * 3.1) - 0.5) * 0.22 + (snoise(v.x * 7, v.y * 7, v.z * 7 + 3) - 0.5) * 0.07;
    v.copy(dir).multiplyScalar(r);
    for (const pl of planes) { const d = v.dot(pl.n); if (d > pl.d) v.addScaledVector(pl.n, -(d - pl.d) * 0.85); }      // сколы
    v.y = v.y < -0.05 ? -0.05 + (v.y + 0.05) * 0.15 : v.y;                                                             // основание в землю
    v.x *= 1.15; v.y = (v.y + 0.05) * 0.78 - 0.12;                                                                  // нижний край — чуть в земле
    P.setXYZ(i, v.x, v.y, v.z); hd.push(r);
  }
  g.computeVertexNormals();
  const N = g.attributes.normal, nn = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i); nn.fromBufferAttribute(N, i);
    const strata = 0.5 + 0.5 * Math.sin(v.y * 9 + snoise(v.x * 2, 0, v.z * 2) * 3);
    tmp.copy(c0).lerp(c1, strata * 0.6 + snoise(v.x * 4, v.y * 4, v.z * 4) * 0.4).multiplyScalar(0.86 + strata * 0.22);
    tmp.lerp(dark, Math.max(0, 0.95 - hd[i]) * 1.6);                                                                  // трещины и впадины темнее
    if (topC && nn.y > 0.45) tmp.lerp(topC, Math.min(1, (nn.y - 0.45) * 2.4) * (0.6 + 0.6 * snoise(v.x * 3, 1, v.z * 3)));
    tmp.multiplyScalar(0.82 + 0.3 * snoise(v.x * 11, v.y * 11, v.z * 11));
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 2);
  return g;
}
// низкая трава (травинки-инстансы с приминанием): палитра, плотность и высота по биомам
const BLADES = {
  forest:  { pal: null, mult: 1, h: 1 },
  swamp:   { pal: ['#4d5e2a', '#5f6f32', '#3f4f25', '#6e7a3a'], mult: 0.85, h: 1.1 },
  mountain:{ pal: ['#7b8a45', '#8c9a50', '#6a7a3c', '#a3a85a'], mult: 0.6, h: 0.8 },
  snow:    { pal: ['#a3a272', '#b2b182', '#8c8b5e', '#c2bd92'], mult: 0.4, h: 0.75 },
  desert:  { pal: ['#b9a864', '#c9b873', '#a89a58', '#d6c78a'], mult: 0.32, h: 0.85 },
  volcano: { pal: ['#3a3a36', '#4a4640', '#2f2f2c', '#5a4a3a'], mult: 0.35, h: 0.8 }
};
const BLADE_Q = { high: { R: 30, n: 300 }, med: { R: 22, n: 220 }, low: { R: 15, n: 140 } };
// ---------- растения BiomeKit по биомам: [вид, вес, масштаб] ----------
const KIT = {
  // лес: деревья, трава и кусты — из tree.js (дуб и берёза с корой и листьями, травинки, кусты); папоротник, цветы и грибы — BiomeKit
  forest:   { tree: [['oak', 3, 0.8], ['birch', 2, 0.8]], blades: BLADES.forest, trees: [['oak', 3, 1.45], ['birch', 2, 1.4]], cover: [['@bush', 14, 1.15], ['fern', 20, 1.7], ['fern', 8, 2.3]], water: [['water_lily', 1, 1.7]], under: [['seagrass', 1, 1.5]] },
  snow:     { blades: BLADES.snow, trees: [['spruce', 1, 1.3]], cover: [['dry_grass', 60, 1.7], ['snowdrop', 10, 1.7], ['frost_shrub', 8, 1.5], ['juniper', 6, 1.5], ['lichen', 8, 1.6]], under: [['seagrass', 1, 1.3]] },
  mountain: { blades: BLADES.mountain, trees: [['mountain_pine', 1, 2.1]], cover: [['alpine_grass', 60, 1.7], ['moss_campion', 12, 1.7], ['gentian', 10, 1.7], ['edelweiss', 6, 1.7], ['rhododendron', 4, 1.5]], under: [['seagrass', 1, 1.3]] },
  desert:   { blades: BLADES.desert, trees: [['cactus', 2, 1.6], ['prickly_pear', 1, 1.8]], cover: [['desert_grass', 60, 1.7], ['agave', 10, 1.5], ['barrel_cactus', 6, 1.6], ['tumbleweed', 6, 1.5]], water: [['water_lily', 1, 1.7]], under: [['seagrass', 1, 1.4]] },
  swamp:    { blades: BLADES.swamp, trees: [['mangrove', 3, 1.3], ['willow', 2, 1.55]], cover: [['sedge', 55, 1.7], ['cattail', 14, 1.5], ['hummock', 8, 1.6]], water: [['water_lily', 1, 1.9]],
              under: [['kelp', 2, 0.9], ['seagrass', 5, 1.5], ['branch_coral', 1, 1.5], ['brain_coral', 1, 1.5], ['sea_fan', 1, 1.5], ['anemone', 1, 1.6], ['sea_lettuce', 2, 1.6]] },
  volcano:  { blades: BLADES.volcano, trees: [['charred_tree', 3, 1.3], ['magma_crystal', 1, 2.0]], cover: [['ash_grass', 60, 1.7], ['ember_shrub', 10, 1.5], ['fire_lily', 8, 1.6]] },
  // океан: на островке — трава у гнезда; на дне — кораллы, водоросли, актинии (набор BiomeKit «Море»)
  reef:     { trees: [], cover: [['desert_grass', 30, 1.6], ['sedge', 8, 1.5]],
              under: [['shells', 10, 1.2], ['urchin', 3, 1.4], ['starfish', 3, 1.5], ['branch_coral', 5, 1.7], ['brain_coral', 4, 1.9], ['sea_fan', 4, 1.9], ['anemone', 4, 2.2], ['seagrass', 14, 1.7], ['sea_lettuce', 8, 1.9], ['kelp', 5, 1.1]] },
  kelp:     { trees: [], cover: [['sedge', 30, 1.6]], under: [['shells', 5, 1.2], ['urchin', 3, 1.4], ['starfish', 2, 1.5], ['kelp', 26, 1.1], ['seagrass', 14, 1.8], ['sea_lettuce', 9, 1.9], ['anemone', 2, 2.0], ['sea_fan', 1, 1.8]] },
  arctic:   { trees: [], cover: [['lichen', 20, 1.6], ['dry_grass', 20, 1.6]], under: [['shells', 6, 1.2], ['urchin', 4, 1.4], ['starfish', 2, 1.5], ['seagrass', 9, 1.6], ['sea_lettuce', 6, 1.8], ['anemone', 3, 2.0], ['kelp', 8, 1.0], ['sea_fan', 1, 1.7]] },
  vents:    { trees: [], cover: [['ash_grass', 20, 1.6]], under: [['shells', 4, 1.2], ['urchin', 3, 1.4], ['starfish', 3, 1.5], ['anemone', 5, 2.2], ['sea_fan', 3, 1.9], ['seagrass', 5, 1.5], ['sea_lettuce', 3, 1.6]] },
  abyss:    { trees: [], cover: [['sedge', 20, 1.5]], under: [['shells', 3, 1.2], ['urchin', 2, 1.4], ['sea_fan', 3, 2.0], ['anemone', 3, 2.2], ['brain_coral', 1, 1.8]] }
};
// в каком наборе BiomeKit лежит растение (кувшинка — в «болоте», водоросли — в «море» и т.д.)
let _pb = null;
function plantBiome(id, pref) {
  if (!_pb) { _pb = {}; for (const b of ['forest', 'snow', 'mountain', 'desert', 'swamp', 'volcano', 'sea']) for (const p of BiomeKit.listPlants(b)) (_pb[p.id] = _pb[p.id] || []).push(b); }
  const l = _pb[id] || [pref]; return l.indexOf(pref) >= 0 ? pref : l[0];
}
const KIT_BIOME = { forest: 'forest', snow: 'snow', mountain: 'mountain', desert: 'desert', swamp: 'swamp', volcano: 'volcano', reef: 'sea', kelp: 'sea', arctic: 'sea', vents: 'sea', abyss: 'sea' };
const NEST_SHELL = { forest: 'sand', snow: 'teal', mountain: 'sand', desert: 'sand', swamp: 'teal', volcano: 'dark', reef: 'teal', kelp: 'teal', arctic: 'teal', vents: 'dark', abyss: 'dark' };
// дистанции показа подробных растений по качеству графики: [деревья BiomeKit, трава и кусты]
const KIT_DIST = { high: [50, 34], med: [38, 26], low: [26, 18] };
const UNDER_DIST = { high: 56, med: 42, low: 30 };       // океан: радиус подводных зарослей
// лес (tree.js): радиусы трёх уровней деревьев и радиус травинок
const TREE_DIST = { high: [28, 60, 105, 26], med: [22, 46, 85, 20], low: [15, 32, 65, 14] };
const ROCK_C = { forest: [0x8b8d90, 0x7c7e82], snow: [0x8c9aaa, 0xaab8c8], mountain: [0x75757c, 0x66666d], desert: [0xb88f5c, 0xa67e4e], swamp: [0x5e6e5d, 0x4f5f4e], volcano: [0x2f2b2b, 0x3d3535],
  reef: [0xc8b090, 0xb89a7a], kelp: [0x6a7068, 0x5a625a], arctic: [0x8a98a8, 0x9aa8b8], vents: [0x2a2626, 0x3a3230], abyss: [0x22242c, 0x2c2e38] };
const GRASS_FILTER = { forest: [14, 1], snow: [12, 0.6], mountain: [22, 0.5], desert: [14, 0.35], swamp: [6, 1], volcano: [22, 0.55], reef: [6, 0.2], kelp: [6, 0.2], arctic: [6, 0.2], vents: [6, 0.2], abyss: [6, 0.2] };   // [макс. высота, плотность]
const WEATHER = {
  leaves: { color: 0xcde37a, size: 0.28, fall: [-0.7, -1.4], drift: 0.8, n: 1 },
  snow: { color: 0xffffff, size: 0.22, fall: [-1.8, -3.0], drift: 0.6, n: 1.3 },
  wind: { color: 0xd8dde4, size: 0.16, fall: [-0.15, -0.3], drift: 7, n: 0.7 },
  dust: { color: 0xe8cf94, size: 0.2, fall: [-0.1, -0.4], drift: 6, n: 1 },
  spores: { color: 0xc8f080, size: 0.26, fall: [0.1, 0.4], drift: 0.5, n: 0.9 },
  ash: { color: 0xc8b8b0, size: 0.22, fall: [-0.5, -1.1], drift: 1.1, n: 1 },
  // под водой: «морской снег», хлопья у курильщиков, светящийся планктон бездны
  marine: { color: 0xe8f6ff, size: 0.12, fall: [-0.12, -0.35], drift: 0.35, n: 1.2, sea: true },
  vent: { color: 0x9a8a80, size: 0.16, fall: [0.2, 0.6], drift: 0.4, n: 1.2, sea: true, rise: true },
  glow: { color: 0x7af0ff, size: 0.2, fall: [0.04, 0.18], drift: 0.3, n: 1.4, sea: true, rise: true, add: true }
};

export function buildWorld(scene, biomeId, opts) {
  opts = opts || {};
  const isDuel = biomeId === 'duel';
  const W = Sim.getWorld(biomeId);
  const cfg = W.cfg || CONFIG.BIOME.forest;     // у арены дуэли своя палитра ниже
  const MAP = CONFIG.MAP_SIZE, HALF = MAP / 2, ARENA = CONFIG.ARENA_R;
  const root = new THREE.Group(); scene.add(root);
  const disposables = [];

  // ---------- небо ----------
  const skyTop = col3(isDuel ? 0x2b3a5a : cfg.sky[0]), skyBot = col3(isDuel ? 0x8aa0c0 : cfg.sky[1]);
  const CLOUD = { forest: [0.5, 0xffffff], snow: [0.62, 0xf2f6fa], mountain: [0.55, 0xffffff], desert: [0.22, 0xfff4e4], swamp: [0.66, 0xd8e0d0], volcano: [0.72, 0x6a4a40],
    reef: [0.5, 0xffffff], kelp: [0.5, 0xffffff], arctic: [0.6, 0xf0f6fa], vents: [0.55, 0xe8eef2], abyss: [0.62, 0xc8d4e4], duel: [0.45, 0xffffff] }[W.biome] || [0.5, 0xffffff];
  const skyU = { top: { value: skyTop.clone() }, bot: { value: skyBot.clone() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: col3(isDuel ? 0xfff1d6 : cfg.sun) }, night: { value: 0 },
    uTime: { value: 0 }, uCover: { value: CLOUD[0] }, uCloudC: { value: col3(CLOUD[1]) }, uOct: { value: 5 } };
  scene.background = skyBot.clone();
  scene.fog = new THREE.Fog(skyBot.getHex(), 60, 260);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 14), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // небо: рассеяние у горизонта, ореол солнца и объёмные облака — плотность из шума, подсветка со стороны солнца,
    // тёмное «брюхо», серебристый край на просвет, облака плывут и тают у горизонта
    fragmentShader: `uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; uniform float uTime; uniform float uCover; uniform vec3 uCloudC; uniform float uOct; varying vec3 vP;
      float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { if (float(i) >= uOct) break; s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      float dens(vec2 p){ float d = fbm(p) - (1.0 - uCover) * 0.6 - 0.16; return smoothstep(0.0, 0.32, d); }
      void main(){ vec3 d = normalize(vP); float h = d.y; vec3 sd = normalize(sunDir);
        vec3 c = mix(bot, top, smoothstep(-0.05, 0.65, h));
        float mu = max(dot(d, sd), 0.0);
        c += sunCol * (pow(mu, 900.0) * 1.8 + pow(mu, 12.0) * 0.2 + pow(mu, 3.0) * 0.06) * (1.0 - night);
        c = mix(c, bot * 1.08, pow(1.0 - max(h, 0.0), 6.0) * 0.5);            // дымка у горизонта
        vec3 g = floor(d * 140.0); float st = step(0.9965, h31(g)) * smoothstep(0.05, 0.4, h);
        c += vec3(st) * night * (1.0 - uCover * 0.6);
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.38 + vec2(uTime * 0.006, uTime * 0.0025);
          float de = dens(uv);
          if (de > 0.001) {
            vec2 toS = normalize(sd.xz + vec2(1e-4)) * 0.07;
            float dl = dens(uv + toS) * 0.7 + dens(uv + toS * 2.2) * 0.3;     // сколько облака между точкой и солнцем
            float lit = exp(-dl * 2.2), day = 1.0 - night;
            vec3 cl = mix(uCloudC * mix(vec3(0.42, 0.45, 0.52), bot, 0.35), uCloudC * (0.9 + 0.35 * sunCol), lit) * (0.25 + 0.75 * day);
            cl += sunCol * pow(mu, 8.0) * (1.0 - de) * 0.9 * day;               // серебристый край на просвет
            cl = mix(cl, c, smoothstep(0.35, 0.0, h) * 0.75);                    // растворяются к горизонту
            c = mix(c, cl, de * smoothstep(0.0, 0.08, h));
          }
          // высокие перистые полосы
          float ci = fbm(vec2(d.x / (h + 0.3) * 1.6 + uTime * 0.01, d.z / (h + 0.3) * 6.0)) ;
          c = mix(c, uCloudC * (0.85 + 0.2 * (1.0 - night)), smoothstep(0.62, 0.85, ci) * 0.22 * smoothstep(0.05, 0.3, h) * (1.0 - night * 0.7));
        }
        gl_FragColor = vec4(c, 1.0); }`
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; root.add(sky);

  // ---------- свет ----------
  const hemi = new THREE.HemisphereLight(isDuel ? 0xdff0ff : cfg.hemi[0], isDuel ? 0x4a5a6a : cfg.hemi[1], 0.85); root.add(hemi);
  const sun = new THREE.DirectionalLight(isDuel ? 0xfff1d6 : cfg.sun, 1.35);
  sun.castShadow = true;
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55; sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 300; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  root.add(sun); root.add(sun.target);

  // ---------- ландшафт ----------
  const cG = (isDuel ? [0x6e6a62, 0x625e57, 0x57534d] : cfg.ground).map(col3), cEdge = col3(isDuel ? 0x6e6a62 : cfg.edge), cRock = col3(isDuel ? 0x6a6a70 : cfg.rock), cHill = col3(isDuel ? 0x6e6a62 : cfg.hill);
  const highH = { forest: 12, snow: 9, mountain: 17, desert: 13, swamp: 5.5, volcano: 13 }[W.biome] || 12;
  const arenaCol = { forest: 0xb59e72, snow: 0xb8c7d2, mountain: 0x8f8a80, desert: 0xd2b27a, swamp: 0x6e7a5a, volcano: 0x5a4a44 }[W.biome] || 0x8a8478;
  const SEG = isDuel ? 80 : 256, SIZE = isDuel ? 120 : MAP;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position, tc = new Float32Array(tp.count * 3), col = new THREE.Color(), cArena = col3(arenaCol), cBog = col3(0x3a4a22), cDrift = col3(0xf2f8fc), cMud = col3(0x6a5a3f);
  const mud = W.biome === 'swamp' ? col3(0x3d4a2a) : cMud;
  for (let i = 0; i < tp.count; i++) tp.setY(i, W.heightAt(tp.getX(i), tp.getZ(i)));
  tg.computeVertexNormals();
  // окраска поверхности — палитры и узоры BiomeKit, высоты нашего мира приведены к его масштабу
  const kitB = KIT_BIOME[W.biome], kitCol = !isDuel && kitB !== 'volcano' ? BiomeKit.surfaceColor(kitB, cfg.seed & 0xffff) : null;
  const yK = { mountain: h => (h - 2) * 0.2, swamp: h => h - W.waterY };
  const vK = [col3(0x2a2422), col3(0x48403c), col3(0x8a8078), col3(0x6a2a10)], { fbm2: kfbm, noise3: kn3 } = BiomeKit._noise;
  const nrm = tg.attributes.normal, nv = new THREE.Vector3(), Hk = (x, z) => W.heightAt(x, z);
  function colorAt(x, z, h, n, out) {
    if (isDuel) { out.copy(cG[0]).lerp(cG[1], hashNoise(x * 0.37, z * 0.37)); return out; }
    if (kitCol) kitCol(out, x, (yK[W.biome] || (() => h))(h), z, n, Hk);
    else {   // вулкан: палитра BiomeKit, но без нарисованных лавовых трещин — настоящая лава в реках
      const nz = kfbm(x * 0.15, z * 0.15, 3, 21), fine = kn3(x * 1.7, h * 1.7, z * 1.7, 22);
      out.copy(vK[0]).lerp(vK[1], Math.min(1, Math.max(0, 0.5 + nz))); out.lerp(vK[2], Math.max(0, Math.min(1, (n.y - 0.85) / 0.13)) * Math.max(0, Math.min(1, (fine - 0.2) / 0.3)) * 0.35);
      if (h < W.waterY + 1.4) out.lerp(vK[3], Math.min(1, (W.waterY + 1.4 - h) / 1.4) * 0.8);
    }
    const slope = W.slopeAt(x, z);
    if (W.ocean) return oceanColor(x, z, h, n, slope, out);
    if (h < W.waterY + 0.9 && W.biome !== 'volcano') out.lerp(h < W.waterY ? mud : cEdge, h < W.waterY ? 0.75 : Math.min(1, (W.waterY + 0.9 - h) / 0.9) * 0.8);
    if (slope > 0.75 && W.biome !== 'mountain' && W.biome !== 'snow') out.lerp(cRock, Math.min(1, (slope - 0.75) * 1.6));
    if (W.biome === 'swamp' && W.bogAt(x, z)) out.lerp(cBog, 0.7);
    if (W.biome === 'snow' && W.slowAt(x, z) < 1) out.lerp(cDrift, 0.6);
    const d = Math.hypot(x, z);
    if (d < ARENA + 2) out.lerp(cArena, 1 - Math.max(0, (d - (ARENA - 8)) / 10));
    return out;
  }
  // морское дно: песок/камень локации, лёд айсбергов, тёмные склоны, жар у курильщиков; чем глубже — тем темнее и синее
  const OF = W.features, cIce = col3(0xeaf5fb), cIceDeep = col3(0x9cc8de), cBeach = col3(0xf0e2b8), cVent = col3(0xff7a2a), cDeepT = col3(cfg.deep || 0x1f6a84);
  function oceanColor(x, z, h, n, slope, out) {
    const nz = kfbm(x * 0.05, z * 0.05, 3, 31), fine = kn3(x * 0.9, h * 0.9, z * 0.9, 32);
    out.copy(cG[0]).lerp(cG[1], Math.min(1, Math.max(0, 0.5 + nz))).lerp(cG[2], Math.max(0, fine - 0.55) * 1.6);
    if (slope > 0.6) out.lerp(cRock, Math.min(1, (slope - 0.6) * 1.4));
    if (h > W.waterY - 1.2) out.lerp(cBeach, Math.min(1, (h - W.waterY + 1.2) / 2.2) * (W.biome === 'arctic' ? 0.3 : 0.9));
    if (OF && OF.bergs.length) for (const o of OF.bergs) { const d = Math.hypot(x - o.x, z - o.z); if (d < o.r * 1.3) { out.lerp(h > -1 ? cIce : cIceDeep, Math.min(1, (o.r * 1.3 - d) / (o.r * 0.4))); break; } }
    if (OF && OF.vents.length) { const v = W.ventAt(x, z); if (v > 0) out.lerp(cVent, v * v * 0.7); }
    if (h < W.waterY) { const dk = Math.min(1, (W.waterY - h) / 60); out.lerp(cDeepT, dk * 0.45).multiplyScalar(1 - dk * 0.35); }
    const d = Math.hypot(x, z); if (d < ARENA + 2) out.lerp(cArena, 1 - Math.max(0, (d - (ARENA - 8)) / 10));
    return out;
  }
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), h = tp.getY(i); nv.fromBufferAttribute(nrm, i);
    colorAt(x, z, h, nv, col); tc[i * 3] = col.r; tc[i * 3 + 1] = col.g; tc[i * 3 + 2] = col.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  { const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * SIZE / 7, uv.getY(i) * SIZE / 7); }
  const gtex = detailTex(GROUND_KIND[isDuel ? 'duel' : W.biome] || 'grass');
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, bumpMap: gtex, bumpScale: 0.9 });
  // каустика: под водой по дну бегут светлые блики от волн (тем слабее, чем глубже)
  const causU = { uTime: { value: 0 }, uWaterY: { value: W.waterY }, uCaus: { value: W.ocean || (W.liquid === 'water' && !isDuel) ? (W.ocean ? 1 : 0.6) : 0 },
    uKind: { value: W.ocean ? 1 : ({ desert: 1, mountain: 2, snow: 3, volcano: 4 }[W.biome] || 0) }, uBump: { value: W.ocean ? 2.6 : 1.2 } };
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, causU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP; varying vec3 vWN; uniform float uTime; uniform float uWaterY; uniform float uCaus; uniform float uKind; uniform float uBump;
      float gh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gvn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh21(i), gh21(i + vec2(1.0, 0.0)), f.x), mix(gh21(i + vec2(0.0, 1.0)), gh21(i + vec2(1.0, 1.0)), f.x), f.y); }
      float gfbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * gvn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      // процедурная микро-рельеф поверхности: кочки, рябь песка на дне и в пустыне, слои породы на склонах
      float groundH(vec3 w, float slope) {
        float h = gfbm(w.xz * 2.1) * 0.7 + gvn(w.xz * 9.0) * 0.28 + gvn(w.xz * 31.0) * 0.14;
        float flatK = 1.0 - smoothstep(0.25, 0.75, slope);
        if (uKind > 0.5 && uKind < 1.5) {
          float rp = sin(dot(w.xz, vec2(0.82, 0.57)) * 3.6 + gfbm(w.xz * 0.3) * 8.0);
          h += (1.0 - abs(rp)) * 1.1 * flatK;
          h += sin(dot(w.xz, vec2(-0.45, 0.89)) * 13.0 + gfbm(w.xz * 1.2) * 5.0) * 0.16 * flatK;
        }
        if (uKind > 1.5 && uKind < 2.5) h += (0.5 + 0.5 * sin(w.y * 4.2 + gfbm(w.xz * 0.6) * 5.0)) * 0.9 * slope + gvn(w.xz * 4.0) * 0.4;
        if (uKind > 2.5 && uKind < 3.5) h += (1.0 - abs(sin(dot(w.xz, vec2(0.9, 0.43)) * 2.4 + gfbm(w.xz * 0.2) * 6.0))) * 0.7 * flatK;
        if (uKind > 3.5) h += abs(sin(gfbm(w.xz * 0.8) * 14.0)) * 0.6 + gvn(w.xz * 6.0) * 0.3;
        return h;
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gSlope = 1.0 - clamp(vWN.y, 0.0, 1.0);
        float gFade = 1.0 - smoothstep(35.0, 110.0, length(vViewPosition));
        float gMacro = gfbm(vWP.xz * 0.045);
        diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * gMacro + 0.14 * (gvn(vWP.xz * 11.0) - 0.5), gFade * 0.9 + 0.1);
        if (uKind > 0.5 && uKind < 1.5) { float rp2 = sin(dot(vWP.xz, vec2(0.82, 0.57)) * 3.6 + gfbm(vWP.xz * 0.3) * 8.0); diffuseColor.rgb *= 1.0 - 0.13 * (1.0 - abs(rp2)) * gFade; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float gh = groundH(vWP, gSlope) * 0.05 * uBump * gFade; normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(gh), dFdy(gh)), faceDirection); }`)
      .replace('#include <fog_fragment>', `
        if (uCaus > 0.0 && vWP.y < uWaterY - 0.2) {
          vec2 p = vWP.xz * 0.32; float t = uTime;
          float a = sin(p.x * 1.7 + t * 0.9 + sin(p.y * 1.3 + t * 0.6) * 1.9) * sin(p.y * 1.9 - t * 0.8 + sin(p.x * 1.1 + t * 0.5) * 1.7);
          float b = sin(p.x * 2.3 - t * 0.7 + sin(p.y * 2.1 - t * 0.4) * 1.5) * sin(p.y * 2.6 + t * 0.6);
          float c = pow(abs(a), 7.0) + pow(abs(b), 9.0) * 0.6;
          float dep = uWaterY - vWP.y;
          gl_FragColor.rgb += vec3(0.55, 0.85, 1.0) * c * uCaus * exp(-dep / 12.0) * 0.32;
        }
        #include <fog_fragment>`);
  };
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true; root.add(terrain);

  // ---------- вода / лава ----------
  let water = null, wg = null, wbase = null, lavaMat = null, waterU = null;
  // настоящая вода: волны в шейдере, рябь из двух слоёв нормалей, отражение неба по Френелю, блик солнца,
  // цвет по глубине (бирюзовая на мелководье, тёмная на глубине), пена у берега, снизу — «окно Снеллиуса»
  function waterMaterial() {
    const N = 256, dd = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i + 0.5) / N * MAP - HALF, z = (j + 0.5) / N * MAP - HALF, d = Math.max(0, Math.min(1, (W.waterY - W.heightAt(x, z)) / 16)); const o = (j * N + i) * 4; dd[o] = dd[o + 1] = dd[o + 2] = Math.round(d * 255); dd[o + 3] = 255; }
    const depthTex = new THREE.DataTexture(dd, N, N, THREE.RGBAFormat); depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
    const nrm = waterNrm(); nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    const swamp = W.liquid === 'swamp', base = col3(cfg.water);
    const shallow = swamp ? col3(0x7a8a5a) : W.biome === 'arctic' ? col3(0x8fd0e4) : W.ocean ? base.clone().lerp(col3(0x6ff0e0), 0.55) : col3(0x5ec8cc);
    const deep = swamp ? col3(0x2e3a22) : W.ocean ? col3(cfg.deep || 0x1f6a84).multiplyScalar(0.8) : base.clone().multiplyScalar(0.45);
    const U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uSunCol: { value: col3(cfg.sun) }, uDay: { value: 1 },
      uSkyTop: { value: new THREE.Color() }, uSkyBot: { value: new THREE.Color() }, uDeep: { value: deep }, uShallow: { value: shallow }, uFoam: { value: col3(swamp ? 0xb8c098 : 0xf4fbff) },
      uNrm: { value: nrm }, uDepth: { value: depthTex }, uHalf: { value: HALF }, uWaterY: { value: W.waterY }, uAmp: { value: W.ocean ? 1.7 : swamp ? 0.4 : 0.8 }, uAlpha: { value: swamp ? 0.93 : W.ocean ? 0.9 : 0.86 }
    }]);
    U.uNrm.value = nrm; U.uDepth.value = depthTex; U.uDeep.value = deep; U.uShallow.value = shallow; U.uFoam.value = col3(swamp ? 0xb8c098 : 0xf4fbff); U.uSunCol.value = col3(cfg.sun);
    return new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: `#include <common>
        #include <fog_pars_vertex>
        uniform float uTime; uniform float uAmp; varying vec3 vW; varying vec3 vN;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0); vec2 p = wp.xz; float h = 0.0, dx = 0.0, dz = 0.0;
          vec2 D[4]; D[0] = normalize(vec2(1.0, 0.3)); D[1] = normalize(vec2(-0.6, 1.0)); D[2] = normalize(vec2(0.9, -0.7)); D[3] = normalize(vec2(-1.0, -0.2));
          float A[4]; A[0] = 0.11; A[1] = 0.075; A[2] = 0.045; A[3] = 0.028;
          float L[4]; L[0] = 19.0; L[1] = 11.0; L[2] = 6.3; L[3] = 3.4;
          for (int i = 0; i < 4; i++) { float k = 6.2832 / L[i], w = sqrt(9.8 * k), ph = dot(D[i], p) * k + uTime * w; h += A[i] * uAmp * sin(ph); float c = A[i] * uAmp * k * cos(ph); dx += c * D[i].x; dz += c * D[i].y; }
          wp.y += h; vW = wp.xyz; vN = normalize(vec3(-dx, 1.0, -dz));
          vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uDay; uniform vec3 uSkyTop; uniform vec3 uSkyBot;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform sampler2D uNrm; uniform sampler2D uDepth; uniform float uHalf; uniform float uWaterY; uniform float uAlpha;
        varying vec3 vW; varying vec3 vN;
        void main() {
          float dist = length(cameraPosition - vW), near = 1.0 - smoothstep(40.0, 260.0, dist);
          vec3 n1 = texture2D(uNrm, vW.xz / 7.0 + vec2(uTime * 0.021, uTime * 0.013)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNrm, vW.xz / 19.0 - vec2(uTime * 0.012, -uTime * 0.018)).xyz * 2.0 - 1.0;
          vec3 N = normalize(vN + vec3(n1.x + n2.x, 0.0, n1.y + n2.y) * 0.28 * near);
          vec3 V = normalize(cameraPosition - vW);
          float dep = texture2D(uDepth, (vW.xz + uHalf) / (2.0 * uHalf)).r * 16.0;
          vec3 col; float alpha;
          if (cameraPosition.y >= uWaterY) {
            float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
            vec3 R = reflect(-V, N); R.y = abs(R.y);
            vec3 sky = mix(uSkyBot, uSkyTop, smoothstep(0.0, 0.55, R.y));
            float sd = max(dot(R, normalize(uSunDir)), 0.0);
            vec3 spec = uSunCol * (pow(sd, 700.0) * 7.0 + pow(sd, 80.0) * 0.35) * uDay;
            float dk = 1.0 - exp(-dep / 3.5);
            vec3 body = mix(uShallow, uDeep, dk) * (0.3 + 0.7 * uDay) * (0.75 + 0.25 * max(N.y, 0.0));
            // пена у кромки берега: полосы набегают и тают
            float shore = 1.0 - smoothstep(0.0, 0.7, dep), fn = texture2D(uNrm, vW.xz / 2.6 + uTime * 0.03).z;
            float foam = shore * smoothstep(0.45, 0.85, fn * 0.6 + 0.5 + 0.35 * sin(dep * 14.0 - uTime * 1.8));
            col = mix(body, sky, fres * 0.9) + spec;
            col = mix(col, uFoam * (0.5 + 0.5 * uDay), foam * 0.85);
            alpha = clamp(mix(0.32, uAlpha, dk) + fres * 0.5, 0.0, 1.0); alpha = max(alpha, foam * 0.9);
          } else {
            // снизу: в «окне» над головой — светлое небо, по краям — полное отражение толщи воды
            float up = max(-V.y, 0.0), win = smoothstep(0.62, 0.8, up);
            vec3 skyU = mix(uSkyBot, uSkyTop, 0.5) * 1.15 * (0.35 + 0.65 * uDay);
            float sd = max(dot(-V, normalize(uSunDir)), 0.0);
            col = mix(uDeep * 0.9, skyU, win) + uSunCol * pow(sd, 40.0) * 0.6 * uDay * win;
            col += vec3(0.8, 0.95, 1.0) * pow(max(n1.x + n2.y, 0.0), 3.0) * 0.12 * win;
            alpha = mix(0.82, 0.62, win);
          }
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`
    });
  }
  if (!isDuel) {
    const isLava = W.liquid === 'lava', WS = isLava ? 72 : 200; wg = new THREE.PlaneGeometry(MAP, MAP, WS, WS); wg.rotateX(-Math.PI / 2);
    wbase = Float32Array.from(wg.attributes.position.array);
    const wt = detailTex(isLava ? 'ash' : 'water').clone(); wt.needsUpdate = true; wt.repeat.set(MAP / 18, MAP / 18);
    lavaMat = isLava ? new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 1.2, roughness: 0.55, map: wt, emissiveMap: wt })
      : waterMaterial();
    if (false) lavaMat = new THREE.MeshStandardMaterial({ color: W.liquid === 'swamp' ? 0x6f7f5c : cfg.water, transparent: true, opacity: W.liquid === 'swamp' ? 0.8 : W.ocean ? 0.66 : 0.74, roughness: 0.12, metalness: 0.1, normalMap: waterNrm(), normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide });
    water = new THREE.Mesh(wg, lavaMat); water.position.y = W.waterY + (isLava ? 0.02 : 0); water.frustumCulled = false; water.renderOrder = 2; root.add(water);
    if (!isLava) { waterU = lavaMat.uniforms; lavaMat = null; }
  }

  // ---------- растительность ----------
  const [treeNear, treeFar] = treeGeos(isDuel ? 'none' : cfg.treeStyle, W.biome);
  const rc = ROCK_C[W.biome] || ROCK_C.forest;
  const rockGeo = rockGeometry(W.biome, rc);
  const stoneGeo = mergeSmooth([
    { g: new THREE.CylinderGeometry(0.95, 1.4, 4.5, 12, 6), m: trs(0, 2.25, 0), c: isDuel ? 0x6a6a70 : 0x7a7a76, c2: isDuel ? 0x9a9aa0 : 0xaaaaa6, jit: 0.25, jf: 1.2, uvs: 2 }, { g: new THREE.DodecahedronGeometry(1.0, 1), m: trs(0, 4.6, 0, 1, 0.55, 1), c: 0xa0a09c, jit: 0.15, jf: 2 }]);
  const coverGeo = groundCover(W.biome);
  const mkMat = (side, tex, bs) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: side || THREE.FrontSide, bumpMap: tex || null, bumpScale: bs || 1 });
  const treeMat = mkMat(null, detailTex('leaf'), 1.2), rockMat = mkMat(null, detailTex('stone'), 1.5), coverMat = mkMat(THREE.DoubleSide);

  // камни — по чанкам, как раньше
  const CH = 8, CS = MAP / CH, chunks = [];
  const chunkAt = (x, z) => {
    const cx = Math.min(CH - 1, Math.max(0, Math.floor((x + HALF) / CS))), cz = Math.min(CH - 1, Math.max(0, Math.floor((z + HALF) / CS))), idx = cz * CH + cx;
    return chunks[idx] || (chunks[idx] = { cx: -HALF + (cx + 0.5) * CS, cz: -HALF + (cz + 0.5) * CS, rocks: [], m: {} });
  };
  const tmpC = new THREE.Color();
  function instanced(geo, mat, list, withColor, shadow) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const o = list[i], s = o.s;
      im.setMatrixAt(i, compose(o.x, o.y, o.z, o.rot, s, s * (o.kind === 'rock' ? 0.85 + o.v * 0.4 : 1), s));
      if (withColor) { const v = 0.78 + (o.v != null ? o.v : 0.5) * 0.22; tmpC.setRGB(v * (0.95 + (o.v || 0) * 0.05), v, v * (0.92 + (o.v || 0) * 0.08)); im.setColorAt(i, tmpC); }
    }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.castShadow = !!shadow; im.visible = false; root.add(im);
    return im;
  }
  if (!isDuel) for (const r of W.rocks) chunkAt(r.x, r.z).rocks.push(r);
  for (const ch of chunks) { if (ch && ch.rocks.length) ch.m.r = instanced(rockGeo, rockMat, ch.rocks, true, true); }

  // ---------- растения BiomeKit: подробные вблизи, простые силуэты вдали ----------
  const kit = KIT[W.biome], kb = KIT_BIOME[W.biome];
  const kpMat = BiomeKit.plantMaterial(), kdMat = BiomeKit.depthMaterial();
  const VG = 24, GN = Math.ceil((MAP + 64) / VG);
  const gridOf = (items) => { const g = new Map(); for (const it of items) { const k = Math.floor((it.x + HALF + 32) / VG) * GN + Math.floor((it.z + HALF + 32) / VG); let a = g.get(k); if (!a) g.set(k, a = []); a.push(it); } return g; };
  const query = (g, x, z, r, out) => {
    out.length = 0; const x0 = Math.floor((x - r + HALF + 32) / VG), x1 = Math.floor((x + r + HALF + 32) / VG), z0 = Math.floor((z - r + HALF + 32) / VG), z1 = Math.floor((z + r + HALF + 32) / VG), r2 = r * r;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const a = g.get(ix * GN + iz); if (a) for (const it of a) { const dx = it.x - x, dz = it.z - z; if (dx * dx + dz * dz < r2) out.push(it); } }
    return out;
  };
  const pickW = (list, v) => { let sum = 0; for (const e of list) sum += e[1]; let t = v * sum; for (let i = 0; i < list.length; i++) { t -= list[i][1]; if (t <= 0) return i; } return list.length - 1; };
  // набор «видов × вариантов»: у каждого свой InstancedMesh, заполняется только ближними экземплярами
  function treeEntry(species, seed, lod, cap, shadow, si, v, sc) {
    const b = Tree.bake(species, seed, lod), M = Tree.materials(species);
    const im = new THREE.InstancedMesh(b.wood, M.bark, cap), im2 = new THREE.InstancedMesh(b.leaves, M.leaf, cap);
    for (const x of [im, im2]) { x.count = 0; x.castShadow = !!shadow; x.receiveShadow = true; x.frustumCulled = false; root.add(x); }
    im.customDepthMaterial = M.barkD; im2.customDepthMaterial = M.leafD;
    return { si, v, sc, im, im2 };
  }
  function treePoolOf(specs, variants, lod, cap, shadow) {
    const pools = []; specs.forEach((sp, si) => { for (let v = 0; v < variants; v++) pools.push(treeEntry(sp[0], v + 1, lod, cap, shadow, si, v, sp[2])); });
    const bySV = {}; pools.forEach(p => { bySV[p.si + '_' + p.v] = p; });
    return { pools, get: (si, v) => bySV[si + '_' + v] || pools[0] };
  }
  function kitPool(specs, variants, cap, shadow) {
    const pools = [];
    specs.forEach((sp, si) => { for (let v = 0; v < variants; v++) {
      if (sp[0][0] === '@') { pools.push(treeEntry(sp[0].slice(1), v + 1, 0, cap, false, si, v, sp[2])); continue; }
      let geo; try { geo = BiomeKit.plantGeometry(plantBiome(sp[0], kb), sp[0], v + 1); } catch (e) { geo = null; }
      if (!geo) continue;
      const im = new THREE.InstancedMesh(geo, kpMat, cap); im.count = 0; im.castShadow = !!shadow; im.receiveShadow = true; im.customDepthMaterial = kdMat; im.frustumCulled = false; root.add(im);
      pools.push({ si, v, sc: sp[2], im });
    } });
    const bySV = {}; pools.forEach(p => { bySV[p.si + '_' + p.v] = p; });
    return { pools, get: (si, v) => bySV[si + '_' + v] || bySV[si + '_0'] || pools[0] };
  }
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const setM = (im, i, it, sc, sy) => { q4.setFromAxisAngle(UP, it.rot); p4.set(it.x, it.y, it.z); s4.set(sc, sc * (sy || 1), sc); m4.compose(p4, q4, s4); im.setMatrixAt(i, m4); };
  let trees = null, cover = null, lilies = null, under = null, farTrees = null, midTrees = null, blades = null;
  const NV = 3;
  if (!isDuel && kit) {
    // деревья: вид и вариант по случайному числу дерева
    trees = W.trees; trees.forEach((t, i) => { t.ksi = pickW(kit.tree || kit.trees, t.v); t.kv = Math.floor(((t.v * 9973) % 1) * NV); t.idx = i; });
    farTrees = new THREE.InstancedMesh(treeFar, treeMat, trees.length); trees.forEach((t, i) => setM(farTrees, i, t, t.s)); farTrees.instanceMatrix.needsUpdate = true; farTrees.computeBoundingSphere(); root.add(farTrees);
    midTrees = new THREE.InstancedMesh(treeNear, treeMat, Math.min(trees.length, 700)); midTrees.count = 0; midTrees.castShadow = true; midTrees.frustumCulled = false; root.add(midTrees);
    const treePool = kit.tree ? null : kitPool(kit.trees, NV, 220, true), treeGrid = gridOf(trees);
    if (kit.tree) trees.tiers = [treePoolOf(kit.tree, NV, 0, 30, true), treePoolOf(kit.tree, NV, 1, 50, true), treePoolOf(kit.tree, NV, 2, 110, false)];
    // трава и кусты: точки по суше
    const [gMax, gDens] = GRASS_FILTER[W.biome] || [14, 1], grng = Sim.mulberry32(W.biome.length * 977 + 4242), N = Math.round(30000 * gDens), items = [];
    for (let i = 0; i < N; i++) {
      const x = (grng() * 2 - 1) * (HALF - 8), z = (grng() * 2 - 1) * (HALF - 8), h = W.heightAt(x, z);
      if (h < W.waterY + 0.45 || h > gMax + 20 || Math.hypot(x, z) < ARENA - 1 || W.slopeAt(x, z) > 0.75 || Math.hypot(x - W.nest.x, z - W.nest.z) < 9) continue;
      const v = grng(); items.push({ x, y: h - 0.03, z, rot: grng() * 6.28, s: 0.75 + grng() * 0.5, ksi: pickW(kit.cover, v), kv: (grng() * 2) | 0 });
    }
    cover = { pool: kitPool(kit.cover, 2, 900, false), grid: gridOf(items) };
    // кувшинки на мелководье, подводные растения на дне
    if (kit.water && W.liquid !== 'lava') {
      const wr = Sim.mulberry32(W.biome.length * 31 + 77), wl = [];
      for (let i = 0; i < (W.biome === 'swamp' ? 9000 : 4000) && wl.length < (W.biome === 'swamp' ? 900 : 260); i++) {
        const x = (wr() * 2 - 1) * (HALF - 10), z = (wr() * 2 - 1) * (HALF - 10), h = W.heightAt(x, z), dep = W.waterY - h;
        if (dep > 0.25 && dep < 2.2 && wr() < 0.7) wl.push({ x, y: W.waterY + 0.03, z, rot: wr() * 6.28, s: 0.7 + wr() * 0.6, ksi: 0, kv: (wr() * 2) | 0 });
      }
      lilies = { pool: kitPool(kit.water, 2, 400, false), grid: gridOf(wl) };
    }
    if (kit.under && W.liquid !== 'lava') {
      const ur = Sim.mulberry32(W.biome.length * 57 + 91), ul = [];
      const UMAX = W.ocean ? 12000 : (W.biome === 'swamp' ? 1400 : 300);
      for (let i = 0; i < (W.ocean ? 120000 : 20000) && ul.length < UMAX; i++) {
        const x = (ur() * 2 - 1) * (HALF - 10), z = (ur() * 2 - 1) * (HALF - 10), h = W.heightAt(x, z), dep = W.waterY - h;
        if (dep <= 0.9) continue;
        if (W.ocean) {   // заросли пятнами: густо на грядах и у скал, пусто на песчаных полянах арены
          const dn = kfbm(x * 0.03, z * 0.03, 2, 61); if (ur() > Math.max(0.08, Math.min(1, (dn + 0.15) * 1.6))) continue;
          if (Math.hypot(x, z) < ARENA - 2) continue;
        }
        const v = ur(); let si = pickW(kit.under, v), sp = kit.under[si][0];
        // ламинария дотягивается почти до поверхности: высота по глубине
        const sc = sp === 'kelp' ? (W.ocean ? Math.min(3.8, Math.max(0.6, dep / 9)) : dep < 3 ? 0.4 : 1) : 1;
        ul.push({ x, y: h - 0.05, z, rot: ur() * 6.28, s: (0.7 + ur() * 0.6) * sc, ksi: si, kv: (ur() * 2) | 0 });
      }
      under = { pool: kitPool(kit.under, 2, W.ocean ? 700 : 500, false), grid: gridOf(ul) };
    }
    trees.pool = treePool; trees.grid = treeGrid;
    if (kit.blades) {
      const cap = 26000, im = new THREE.InstancedMesh(Tree.bladeGeo(), Tree.grassMaterial(), cap);
      im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); root.add(im);
      blades = { im, cells: new Map(), cap, q: '', mult: kit.blades.mult || 1, hmul: kit.blades.h || 1, pal: (kit.blades.pal || Tree.grassPalette).map(h => new THREE.Color(h)) };
    }
  }
  // пересборка ближних наборов, когда камера сдвинулась
  const vegTmp = [], hiddenNow = new Set(); let vegAt = null, vegQ = '';
  function fillPool(pool, list, fn) {
    for (const p of pool.pools) p.im.count = 0;
    if (!pool.pools.length) return;
    for (const p of pool.pools) if (p.im2) p.im2.count = 0;
    for (const it of list) { const p = pool.get(it.ksi, it.kv); if (!p) continue; const im = p.im; if (im.count >= im.instanceMatrix.count) continue; fn(im, im.count, it, p.sc); if (p.im2) { p.im2.setMatrixAt(im.count, m4); p.im2.count = im.count + 1; } im.count++; }
    for (const p of pool.pools) { p.im.instanceMatrix.needsUpdate = true; if (p.im.instanceColor) p.im.instanceColor.needsUpdate = true; p.im.visible = p.im.count > 0; if (p.im2) { p.im2.instanceMatrix.needsUpdate = true; p.im2.visible = p.im2.count > 0; } }
  }
  // травинки из tree.js: по клеткам 6×6 м, у каждой клетки свой постоянный набор (не мерцает при движении)
  const BC = 6, _bo = new THREE.Object3D();
  function bladeCell(ix, iz) {
    const key = ix * 100003 + iz; let c = blades.cells.get(key); if (c) return c;
    const r = Tree.rngOf((ix * 7349 + iz * 9157) ^ 0x5bd1), mats = [], cols = [], tc = new THREE.Color();
    const nb = Math.round((BLADE_Q[blades.q] || BLADE_Q.high).n * blades.mult);
    for (let k = 0; k < nb; k++) {
      const x = (ix + r()) * BC, z = (iz + r()) * BC, pv = r(), a1 = r(), a2 = r(), a3 = r(), s1 = r(), s2 = r(), cp = r(), cs = r();
      if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) continue;
      const h = W.heightAt(x, z);
      if (h < W.waterY + 0.3 || Math.hypot(x, z) < ARENA - 1 || Math.hypot(x - W.nest.x, z - W.nest.z) < 8.5 || W.slopeAt(x, z) > 0.8) continue;
      const patch = 0.55 + 0.45 * Tree.fbm2(x * 0.18 + 3, z * 0.18, 2, 11) * 1.6;
      if (pv > patch) continue;
      _bo.position.set(x, h - 0.02, z); _bo.rotation.set(-0.15 + a1 * 0.3, a2 * 6.2832, -0.15 + a3 * 0.3);
      _bo.scale.set((0.8 + s1 * 0.5) * 1.3, (0.25 + s2 * 0.45) * (0.7 + 0.5 * Math.min(1, patch)) * 1.5 * blades.hmul, 1); _bo.updateMatrix();
      mats.push(..._bo.matrix.elements); tc.copy(blades.pal[Math.floor(cp * blades.pal.length)]).multiplyScalar(0.85 + cs * 0.3); cols.push(tc.r, tc.g, tc.b);
    }
    c = { m: new Float32Array(mats), c: new Float32Array(cols), n: cols.length / 3 };
    if (blades.cells.size > 2500) blades.cells.clear();
    blades.cells.set(key, c); return c;
  }
  function refreshBlades(cx, cz, qn) {
    if (blades.q !== qn) { blades.q = qn; blades.cells.clear(); }
    const R = (BLADE_Q[qn] || BLADE_Q.high).R;
    const im = blades.im, ma = im.instanceMatrix.array, ca = im.instanceColor.array; let n = 0;
    const x0 = Math.floor((cx - R) / BC), x1 = Math.floor((cx + R) / BC), z0 = Math.floor((cz - R) / BC), z1 = Math.floor((cz + R) / BC), list = [];
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const dx = (ix + 0.5) * BC - cx, dz = (iz + 0.5) * BC - cz, d2 = dx * dx + dz * dz; if (d2 > R * R) continue;
      list.push([d2, ix, iz]);
    }
    list.sort((a, b) => a[0] - b[0]);                       // ближние клетки первыми: при нехватке места пропадает дальняя трава
    for (const [, ix, iz] of list) { const c = bladeCell(ix, iz); if (n + c.n > blades.cap) break; ma.set(c.m, n * 16); ca.set(c.c, n * 3); n += c.n; }
    im.count = n; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
  }
  function refreshVeg(cx, cz) {
    const qn = (Q && Q.name) || 'high', [nearR, covR] = KIT_DIST[qn] || KIT_DIST.high, midR = (Q ? Q.near : 120) + 20;
    if (trees) {
      // уровни деталей деревьев: ближние подробные, дальше проще; самые дальние — силуэты farTrees
      const td = TREE_DIST[qn] || TREE_DIST.high;
      const tiers = trees.tiers ? trees.tiers.map((p, i) => ({ pool: p, r: td[i] })) : [{ pool: trees.pool, r: nearR }, { pool: { pools: [{ im: midTrees, sc: 1 }], get: () => null }, r: midR, mid: true }];
      const maxR = tiers[tiers.length - 1].r;
      query(trees.grid, cx, cz, maxR, vegTmp);
      const lists = tiers.map(() => []);
      for (const t of vegTmp) { const dx = t.x - cx, dz = t.z - cz, d2 = dx * dx + dz * dz; for (let k = 0; k < tiers.length; k++) if (d2 < tiers[k].r * tiers[k].r) { lists[k].push(t); break; } }
      tiers.forEach((tr, k) => {
        if (tr.mid) { midTrees.count = 0; for (const t of lists[k]) { if (midTrees.count >= midTrees.instanceMatrix.count) break; setM(midTrees, midTrees.count++, t, t.s); } midTrees.instanceMatrix.needsUpdate = true; }
        else fillPool(tr.pool, lists[k], (im, i, t, sc) => setM(im, i, t, t.s * sc));
      });
      // дальние силуэты: прячем те, что сейчас показаны подробно
      const nowSet = new Set(vegTmp.map(t => t.idx));
      for (const i of hiddenNow) if (!nowSet.has(i)) { setM(farTrees, i, trees[i], trees[i].s); hiddenNow.delete(i); }
      for (const i of nowSet) if (!hiddenNow.has(i)) { farTrees.setMatrixAt(i, ZERO); hiddenNow.add(i); }
      farTrees.instanceMatrix.needsUpdate = true;
    }
    if (blades) refreshBlades(cx, cz, qn);
    if (cover) fillPool(cover.pool, query(cover.grid, cx, cz, covR, vegTmp).slice(), (im, i, it, sc) => setM(im, i, it, it.s * sc));
    if (lilies) fillPool(lilies.pool, query(lilies.grid, cx, cz, covR * 1.3, vegTmp).slice(), (im, i, it, sc) => setM(im, i, it, it.s * sc));
    if (under) fillPool(under.pool, query(under.grid, cx, cz, W.ocean ? UNDER_DIST[qn] || 60 : covR * 1.2, vegTmp).slice(), (im, i, it, sc) => setM(im, i, it, it.s * sc));
    vegAt = { x: cx, z: cz }; vegQ = qn;
  }

  // ---------- арена босса: пол, камни, барьер, порталы ----------
  const stones = instanced(stoneGeo, rockMat, W.stones, true, true); stones.visible = true;
  const arenaR = isDuel ? CONFIG.DUEL_R : ARENA - 1;
  const ftex = detailTex('stone').clone(); ftex.needsUpdate = true; ftex.repeat.set(arenaR / 3, arenaR / 3);
  const arenaFloor = new THREE.Mesh(new THREE.CircleGeometry(arenaR, 64), new THREE.MeshStandardMaterial({ color: isDuel ? 0x77736a : arenaCol, roughness: 0.95, map: ftex, bumpMap: ftex, bumpScale: 1.4 }));
  arenaFloor.rotation.x = -Math.PI / 2; arenaFloor.position.y = (W.def.arenaY || 0) + 0.04; arenaFloor.receiveShadow = true; root.add(arenaFloor);
  const rune = new THREE.Mesh(new THREE.RingGeometry(arenaR * 0.62, arenaR * 0.66, 64), new THREE.MeshBasicMaterial({ color: isDuel ? 0xffd35a : 0xd9a24a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = arenaFloor.position.y + 0.03; root.add(rune);
  const barrier = new THREE.Mesh(new THREE.CylinderGeometry(ARENA - 1.6, ARENA - 1.6, 9, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  barrier.position.y = (W.def.arenaY || 0) + 4.5; barrier.visible = false; root.add(barrier);

  function makePortal(pt, colorHex) {
    const g = new THREE.Group(); g.position.set(pt.x, pt.y, pt.z); g.rotation.y = -pt.ang + Math.PI / 2;
    const stoneM = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.9, bumpMap: detailTex('stone'), bumpScale: 1.5 });
    for (const sx of [-1, 1]) { const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 6.5, 14), stoneM); pil.position.set(sx * 3.3, 3.2, 0); pil.castShadow = true; g.add(pil); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1, 1.4), stoneM); lintel.position.y = 6.8; g.add(lintel);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const film = new THREE.Mesh(new THREE.CircleGeometry(3.3, 28), mat); film.position.y = 3.4; film.scale.set(1, 1.0, 1); g.add(film);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.14, 10, 48), new THREE.MeshBasicMaterial({ color: colorHex })); ring.position.y = 3.4; g.add(ring);
    const light = new THREE.PointLight(colorHex, 1.2, 22); light.position.y = 3.4; g.add(light);
    root.add(g);
    return { group: g, film, ring, mat };
  }
  let portalIn = null, portalNext = null;
  if (!isDuel) {
    const bossCol = { forest: 0xb05a2a, snow: 0x5ac0ff, mountain: 0xc8a050, desert: 0xe8b84a, swamp: 0x3adf8a, volcano: 0xff4a2a, reef: 0xffb04a, kelp: 0x9aff6a, arctic: 0x9af0ff, vents: 0xff6a2a, abyss: 0xb07aff }[W.biome];
    portalIn = makePortal(W.portalIn, bossCol); portalNext = makePortal(W.portalNext, 0x9be37a); portalNext.group.visible = false;
  }

  // ---------- гнездо (DinoNest): вал из земли, ветки, листья, папоротник, кладка яиц ----------
  const NEST_S = 3.4;          // гнездо из файла задано в метрах (Ø 1,8 м) — увеличиваем под размер наших динозавров
  const nest = new THREE.Group(); let nestKit = null;
  if (!isDuel) {
    nest.position.set(W.nest.x, W.nest.y, W.nest.z); nest.scale.setScalar(NEST_S);
    const ec = new THREE.Color(); colorAt(W.nest.x + 14, W.nest.z, W.nest.y, UP, ec);
    nestKit = DinoNest.create({ seed: (cfg.seed % 997) + 3, layout: 'ring', eggs: 8, shell: NEST_SHELL[W.biome] || 'sand', diameter: 1.8, hatching: false, surroundings: true, groundR: 2.4, eggDetail: 30, edgeColor: ec.getHex() });
    nestKit.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    nest.add(nestKit.group); root.add(nest);
  }
  const nestInfo = nestKit ? { x: W.nest.x, z: W.nest.z, y: W.nest.y + nestKit.heightAt(0, 0) * NEST_S, scale: NEST_S, shell: NEST_SHELL[W.biome] || 'sand', kit: DinoNest } : null;

  // ---------- океан: курильщики, льдины ----------
  let ventFx = null;
  if (W.ocean && W.features) {
    const F = W.features;
    if (F.vents.length) {
      // трубы чёрных курильщиков: столбы из наростов, светящееся жерло, тёмный дым
      const parts = [], rr = Sim.mulberry32(cfg.seed + 5);
      const tube = mergeSmooth([
        { g: new THREE.CylinderGeometry(0.55, 1.25, 3.2, 10, 4), m: trs(0, 1.6, 0), c: 0x1a1614, c2: 0x2e2622, jit: 0.25, jf: 1.6 },
        { g: new THREE.CylinderGeometry(0.4, 0.62, 2.4, 9, 3), m: trs(0.1, 4.2, 0.05), c: 0x221c1a, c2: 0x3a2e28, jit: 0.18, jf: 2 },
        { g: new THREE.DodecahedronGeometry(0.7, 1), m: trs(0.6, 1.0, 0.3, 1, 0.8, 1), c: 0x2a2220, jit: 0.2, jf: 2 },
        { g: new THREE.DodecahedronGeometry(0.5, 1), m: trs(-0.5, 2.6, -0.2, 1, 0.8, 1), c: 0x2a2220, c2: 0x5a3020, jit: 0.15, jf: 2 }]);
      const vim = new THREE.InstancedMesh(tube, mkMat(null, detailTex('stone'), 1.5), F.vents.length), mouths = [];
      F.vents.forEach((v, i) => { const y = W.heightAt(v.x, v.z) - 0.3, s = 0.9 + v.v * 0.7; vim.setMatrixAt(i, compose(v.x, y, v.z, rr() * 6.28, s, s, s)); mouths.push({ x: v.x + 0.1 * s, y: y + 5.4 * s, z: v.z, s }); });
      vim.instanceMatrix.needsUpdate = true; vim.castShadow = true; vim.receiveShadow = true; root.add(vim);
      const glowG = new THREE.SphereGeometry(0.45, 12, 8), glowM = new THREE.MeshBasicMaterial({ color: 0xff8a3a, toneMapped: false });
      const gim = new THREE.InstancedMesh(glowG, glowM, mouths.length); mouths.forEach((m, i) => gim.setMatrixAt(i, compose(m.x, m.y, m.z, 0, m.s, m.s * 0.5, m.s))); gim.instanceMatrix.needsUpdate = true; root.add(gim);
      // дым: частицы поднимаются над каждой трубой
      const PN = 22, sp = new Float32Array(mouths.length * PN * 3), sl = new Float32Array(mouths.length * PN);
      for (let i = 0; i < mouths.length * PN; i++) { sl[i] = Math.random(); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      const smoke = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x3a3230, size: 2.2, transparent: true, opacity: 0.6, depthWrite: false, map: dotTex() })); smoke.frustumCulled = false; root.add(smoke);
      ventFx = { mouths, sp, sl, PN, sg };
    }
    if (W.biome === 'arctic') {
      // льдины на поверхности (сверху — белые плиты, снизу — тёмные силуэты)
      const fr = Sim.mulberry32(cfg.seed + 9), floeG = mergeSmooth([{ g: new THREE.CylinderGeometry(1, 1.08, 0.5, 9, 1), m: trs(0, 0, 0), c: 0xdcecf4, c2: 0xffffff, jit: 0.12, jf: 1.4 }]);
      const list = []; for (let i = 0; i < 400 && list.length < 140; i++) { const x = (fr() * 2 - 1) * (HALF - 20), z = (fr() * 2 - 1) * (HALF - 20); if (W.heightAt(x, z) > -2 || Math.hypot(x, z) < ARENA + 6) continue; list.push({ x, z, s: 1.5 + fr() * 4, r: fr() * 6.28 }); }
      const fim = new THREE.InstancedMesh(floeG, mkMat(null, detailTex('snow'), 0.6), list.length);
      list.forEach((f, i) => fim.setMatrixAt(i, compose(f.x, W.waterY + 0.08, f.z, f.r, f.s, 1, f.s * (0.7 + (i % 3) * 0.15)))); fim.instanceMatrix.needsUpdate = true; fim.receiveShadow = true; fim.castShadow = true; root.add(fim);
    }
  }

  // ---------- погода ----------
  const WX = WEATHER[cfg.weather] || WEATHER.leaves;
  const PMAX = CONFIG.QUALITY.high.particles * 2;
  const ppos = new Float32Array(PMAX * 3), pvel = new Float32Array(PMAX * 3);
  for (let i = 0; i < PMAX; i++) {
    ppos[i * 3] = (Math.random() * 2 - 1) * 30; ppos[i * 3 + 1] = Math.random() * 18; ppos[i * 3 + 2] = (Math.random() * 2 - 1) * 30;
    pvel[i * 3] = (Math.random() - 0.5) * WX.drift; pvel[i * 3 + 1] = WX.fall[0] + Math.random() * (WX.fall[1] - WX.fall[0]); pvel[i * 3 + 2] = (Math.random() - 0.5) * WX.drift;
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const pmat = new THREE.PointsMaterial({ color: WX.color, size: WX.sea ? WX.size * 1.6 : WX.size, transparent: true, opacity: 0.85, depthWrite: false, blending: WX.add ? THREE.AdditiveBlending : THREE.NormalBlending, map: dotTex() });
  const points = new THREE.Points(pg, pmat); points.frustumCulled = false; root.add(points);
  let pCount = PMAX, wxLevel = 0;

  // ---------- мини-карта (основа), отрисовывается один раз ----------
  const MM = 256, minimap = document.createElement('canvas'); minimap.width = MM; minimap.height = MM;
  (function drawMini() {
    const g = minimap.getContext('2d'), img = g.createImageData(MM, MM), wc = col3(isDuel ? 0x333333 : cfg.water), gc = cG[0];
    for (let py = 0; py < MM; py++) for (let px = 0; px < MM; px++) {
      const x = (px / MM - 0.5) * SIZE, z = (py / MM - 0.5) * SIZE, h = W.heightAt(x, z);
      let r, gg, b;
      if (!isDuel && h < W.waterY) { const dk = W.ocean ? 1.25 - Math.min(0.75, (W.waterY - h) / 36) : 1; r = wc.r * 255 * dk; gg = wc.g * 255 * dk; b = wc.b * 255 * dk; }
      else { const k = Math.min(1, Math.max(0, (h + 2) / 34)); r = gc.r * 255 * (0.75 + k * 0.5); gg = gc.g * 255 * (0.75 + k * 0.45); b = gc.b * 255 * (0.75 + k * 0.5); }
      if (Math.hypot(x, z) < ARENA - 1 && !isDuel) { r = 200; gg = 180; b = 130; }
      const o = (py * MM + px) * 4; img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, gg); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(15,60,25,.7)';
    for (const t of W.trees) g.fillRect(((t.x / SIZE) + 0.5) * MM - 0.6, ((t.z / SIZE) + 0.5) * MM - 0.6, 1.5, 1.5);
  })();

  // ---------- качество ----------
  let Q = CONFIG.QUALITY.high;
  // примятая трава: до 14 пятен (x, высота, z, радиус) — динозавры и след за своим; значения читает шейдер травинок
  function setTramplers(list) {
    const u = Tree.tramp; let i = 0;
    for (; i < list.length && i < u.length; i++) u[i].set(list[i].x, 0, list[i].z, list[i].r);
    for (; i < u.length; i++) u[i].w = 0;
  }
  function applyQuality(name) {
    Q = Object.assign({ name: CONFIG.QUALITY[name] ? name : 'high' }, CONFIG.QUALITY[name] || CONFIG.QUALITY.high);
    sun.castShadow = Q.shadow > 0;
    if (Q.shadow > 0 && sun.shadow.mapSize.x !== Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    pCount = Math.min(PMAX, Q.particles * 2); pg.setDrawRange(0, pCount);
    return Q;
  }
  applyQuality('high');

  // ---------- каждый кадр ----------
  const sunV = new THREE.Vector3(), tmpA = new THREE.Color(), tmpB = new THREE.Color(), nightTop = col3(0x070d1c), nightBot = col3(0x101a30);
  const fogBase = skyBot.clone();
  function setTime(tod) {
    const ang = (tod - 0.25) * Math.PI * 2, elev = Math.sin(ang), dayK = Math.min(1, Math.max(0, (elev + 0.12) / 0.4));
    sunV.set(Math.cos(ang) * 0.8, elev, 0.35).normalize();
    skyU.sunDir.value.copy(sunV);
    const nk = W.biome === 'volcano' ? (1 - dayK) * 0.55 : 1 - dayK;       // у вулкана ночью не бывает совсем темно
    tmpA.copy(skyTop).lerp(nightTop, nk); tmpB.copy(skyBot).lerp(nightBot, nk);
    // у горизонта на рассвете/закате тёплый оттенок
    const dusk = Math.max(0, 1 - Math.abs(elev) * 5) * (W.biome === 'volcano' ? 0.2 : 0.6);
    tmpB.lerp(col3(0xff9a5a), dusk * 0.5);
    skyU.top.value.copy(tmpA); skyU.bot.value.copy(tmpB); skyU.night.value = nk;
    scene.background.copy(tmpB); scene.fog.color.copy(tmpB);
    hemi.intensity = 0.28 + 0.62 * dayK; sun.intensity = 0.15 + 1.3 * dayK; lastDay = dayK;
    sunV.y = Math.max(sunV.y, 0.25);       // тени остаются даже ночью (лунный свет)
    return sunV;
  }
  const sunOffset = new THREE.Vector3(60, 90, 40);
  // под водой: туман цвета толщи воды, ближе и темнее с глубиной; небо не видно
  const deepC = col3(cfg.deep || 0x1f6a84), uwC = new THREE.Color(), blackC = col3(0x02060c); let lastDay = 1, underNow = false;
  function underwater(cam) {
    const uw = !isDuel && W.liquid !== 'lava' && cam.y < W.waterY - 0.05 && W.isWater(cam.x, cam.z);
    underNow = uw; sky.visible = !uw;
    if (!uw) return false;
    const dep = W.waterY - cam.y, dk = Math.min(1, dep / 45);
    uwC.copy(deepC).lerp(blackC, dk * 0.6).multiplyScalar(0.35 + 0.65 * lastDay);
    scene.background.copy(uwC); scene.fog.color.copy(uwC);
    const vis = (cfg.vis || 60) * (1 - dk * 0.45);
    scene.fog.near = 2; scene.fog.far = Math.max(18, Math.min(vis, Q.view));
    hemi.intensity *= 0.75 - dk * 0.35; sun.intensity *= 0.7 - dk * 0.5;
    return true;
  }
  function update(cam, focus, t, dt, tod, wx, view) {
    sky.position.copy(cam); skyU.uTime.value = t; skyU.uCover.value = Math.min(0.92, CLOUD[0] + (wx || 0) * 0.3); skyU.uOct.value = Q.name === 'low' ? 3 : Q.name === 'med' ? 4 : 5;
    const dir = setTime(tod == null ? 0.4 : tod);
    sunOffset.copy(dir).multiplyScalar(110);
    sun.target.position.set(focus.x, focus.y, focus.z); sun.position.copy(sun.target.position).add(sunOffset);
    const fogK = (cfg.fog || 1) * (1 - 0.35 * (wx || 0));
    scene.fog.far = Math.max(70, Q.view * fogK); scene.fog.near = scene.fog.far * 0.3;
    underwater(cam); causU.uTime.value = t;
    if (ventFx) {   // дым курильщиков
      const { mouths, sp, sl, PN, sg } = ventFx;
      for (let m = 0; m < mouths.length; m++) { const M = mouths[m], far = Math.hypot(M.x - cam.x, M.z - cam.z) > 90; for (let j = 0; j < PN; j++) { const i = m * PN + j; sl[i] += dt * 0.25; if (sl[i] > 1) sl[i] -= 1; const k = sl[i], h = k * 9 * M.s;
        sp[i * 3] = far ? 0 : M.x + Math.sin(j * 2.3 + t * 0.6) * k * 1.6; sp[i * 3 + 1] = far ? -999 : Math.min(W.waterY - 0.3, M.y + h); sp[i * 3 + 2] = M.z + Math.cos(j * 1.7 + t * 0.5) * k * 1.6; } }
      sg.attributes.position.needsUpdate = true;
    }
    const nearD = Q.near + 35, viewD = Math.min(Q.view, scene.fog.far) + 45, grassD = Q.grass + 35;
    for (const ch of chunks) {
      if (!ch) continue;
      const d = Math.hypot(ch.cx - cam.x, ch.cz - cam.z);
      if (ch.m.r) ch.m.r.visible = d < viewD;
    }
    if (nestKit) nest.visible = Math.hypot(cam.x - W.nest.x, cam.z - W.nest.z) < 110;
    if (!vegAt || vegQ !== ((Q && Q.name) || 'high') || Math.hypot(focus.x - vegAt.x, focus.z - vegAt.z) > 5) refreshVeg(focus.x, focus.z);
    BiomeKit.uniforms.uWind.value = ((cfg.weather === 'wind' || cfg.weather === 'dust') ? 1.5 : 0.9) + (wx || 0) * 0.8;
    BiomeKit.update(t); Tree.wind = 0.7 + (wx || 0) * 0.8; Tree.update(t);
    if (lavaMat && lavaMat.normalMap) lavaMat.normalMap.offset.set(t * 0.012, t * 0.008);
    if (waterU) {
      waterU.uTime.value = t; waterU.uSunDir.value.copy(skyU.sunDir.value); waterU.uDay.value = lastDay;
      waterU.uSkyTop.value.copy(skyU.top.value); waterU.uSkyBot.value.copy(skyU.bot.value);
    }
    if (wg && !waterU) {
      const wp = wg.attributes.position, lava = W.liquid === 'lava';
      for (let i = 0; i < wp.count; i++) {
        const x = wbase[i * 3], z = wbase[i * 3 + 2];
        wp.setY(i, Math.sin(x * 0.09 + t * (lava ? 0.6 : 1.2)) * (lava ? 0.14 : 0.1) + Math.cos(z * 0.11 + t * 0.9) * 0.08);
      }
      wp.needsUpdate = true;
      if (lava) lavaMat.emissiveIntensity = 1.0 + Math.sin(t * 1.7) * 0.25;
    }
    // погода: плотность растёт с wx
    wxLevel += ((wx || 0) - wxLevel) * Math.min(1, dt * 0.5);
    const active = Math.min(pCount, Math.round(pCount * (0.35 + 0.65 * wxLevel) * WX.n));
    pg.setDrawRange(0, active);
    const windX = (cfg.weather === 'wind' || cfg.weather === 'dust') ? 3 + wxLevel * 9 : 0;
    for (let i = 0; i < active; i++) {
      const k = i * 3;
      ppos[k] += (pvel[k] + windX + Math.sin(t + i) * 0.4) * dt; ppos[k + 1] += pvel[k + 1] * dt; ppos[k + 2] += (pvel[k + 2] + Math.cos(t * 0.8 + i) * 0.4) * dt;
      const gh = W.heightAt(ppos[k] + focus.x, ppos[k + 2] + focus.z) - focus.y;
      if (WX.sea) {     // под водой: частицы между дном и поверхностью вокруг игрока
        const top = W.waterY - focus.y - 0.2;
        if (ppos[k + 1] > top || ppos[k + 1] < gh + 0.1 || ppos[k + 1] > 14 || ppos[k + 1] < -14) { ppos[k] = (Math.random() * 2 - 1) * 30; ppos[k + 2] = (Math.random() * 2 - 1) * 30; const g2 = W.heightAt(ppos[k] + focus.x, ppos[k + 2] + focus.z) - focus.y, lo = Math.max(g2 + 0.2, -12), hi = Math.min(top, 12); ppos[k + 1] = WX.rise ? lo + Math.random() * 3 : hi - Math.random() * 3; if (hi < lo) ppos[k + 1] = -999; }
      } else if (cfg.weather === 'spores' ? ppos[k + 1] > 12 : (ppos[k + 1] < gh + 0.2 || ppos[k + 1] < -8)) {
        ppos[k] = (Math.random() * 2 - 1) * 30; ppos[k + 1] = cfg.weather === 'spores' ? gh + Math.random() * 2 : 12 + Math.random() * 7; ppos[k + 2] = (Math.random() * 2 - 1) * 30;
      }
      if (Math.abs(ppos[k]) > 34) ppos[k] = -Math.sign(ppos[k]) * 30;
      if (Math.abs(ppos[k + 2]) > 34) ppos[k + 2] = -Math.sign(ppos[k + 2]) * 30;
    }
    pg.attributes.position.needsUpdate = true; points.position.set(focus.x, focus.y, focus.z);
    // порталы и руны мерцают
    if (portalIn) {
      const pulse = 0.45 + Math.sin(t * 2.4) * 0.12;
      portalIn.mat.opacity = pulse; portalIn.film.rotation.z = t * 0.3;
      if (portalNext.group.visible) { portalNext.mat.opacity = pulse; portalNext.film.rotation.z = -t * 0.3; }
    }
    rune.rotation.z = t * 0.1;
    if (barrier.visible) barrier.material.opacity = 0.14 + Math.sin(t * 5) * 0.05;
  }
  function dispose() {
    scene.remove(root);
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
  }

  return {
    // гнездо выше ровной земли: динозавры визуально стоят на его поверхности
    // высота именно нарисованной поверхности (треугольники сетки ландшафта) минус «настоящая» высота мира:
    // на крутых перепадах сетка проходит выше/ниже формулы, и без поправки динозавр уходит под текстуру
    groundFix(x, z) {
      const st = SIZE / SEG, gx = (x + SIZE / 2) / st, gz = (z + SIZE / 2) / st;
      if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return 0;
      const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz, X0 = ix * st - SIZE / 2, Z0 = iz * st - SIZE / 2;
      const ha = W.heightAt(X0, Z0), hb = W.heightAt(X0, Z0 + st), hc = W.heightAt(X0 + st, Z0 + st), hd = W.heightAt(X0 + st, Z0);
      const hm = u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
      return hm - W.heightAt(x, z);
    },
    nestLift(x, z) { if (!nestKit) return 0; const dx = (x - W.nest.x) / NEST_S, dz = (z - W.nest.z) / NEST_S; if (dx * dx + dz * dz > 2.4 * 2.4) return 0; return Math.max(0, nestKit.heightAt(dx, dz) * NEST_S); },
    get underwater() { return underNow; },
    sim: W, root, nest: W.nest, nestInfo, sun, minimap, minimapSize: MM, mapSize: SIZE, applyQuality, update, dispose, setTramplers, barrier, portalIn, portalNext,
    setPortalNext(on) { if (portalNext) portalNext.group.visible = !!on; },
    get quality() { return Q; }
  };
}

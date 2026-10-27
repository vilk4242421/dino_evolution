/*!
 * Tree — процедурная летняя модель: дерево, поверхность земли и трава (Three.js r128+).
 * Только модели: без камеры, света и рендера.
 * Подключение: после three.min.js подключите tree.js обычным тегом script — появится глобальный объект Tree.
 * Единицы: 1 = 1 метр. Ось Y — вверх.
 *
 * БЫСТРЫЙ СТАРТ
 *   const ground = Tree.createGround({ size: 60, seed: 1 });        // поверхность
 *   scene.add(ground.mesh);
 *   const grass = Tree.createGrass({ ground, count: 20000 });        // трава по поверхности
 *   scene.add(grass.mesh);
 *   const oak = Tree.create({ species: 'oak', seed: 7 });            // дерево
 *   oak.group.position.set(5, ground.heightAt(5, -3), -3);
 *   scene.add(oak.group);
 *   // в цикле рендера (один вызов на всё):
 *   Tree.update(clock.getElapsedTime());
 *
 * ДЕРЕВО — Tree.create({ species, seed, scale })
 *   species : 'oak' (дуб, ~8 м, корни на поверхности) | 'birch' (берёза, ~10 м, свисающие ветви). По умолчанию 'oak'.
 *   seed    : целое число; одно и то же значение всегда даёт одно и то же дерево.
 *   scale   : общий масштаб, по умолчанию 1.
 *   → { group, height, crownRadius, stats: { branches, leaves }, dispose() }
 *     group — THREE.Group, начало координат у основания ствола.
 *
 * ПОВЕРХНОСТЬ — Tree.createGround({ size, segments, seed, hills })
 *   size     : сторона квадрата в метрах (по умолчанию 60);
 *   segments : детализация сетки (по умолчанию 160);
 *   seed     : форма холмов;  hills : высота холмов в метрах (по умолчанию 0.6).
 *   → { mesh, heightAt(x, z), size, dispose() }
 *     heightAt(x, z) — высота земли в точке, чтобы ставить на неё деревья, траву и персонажей.
 *
 * ТРАВА — Tree.createGrass({ ground, count, seed, avoid })
 *   ground : объект из createGround (обязательно);
 *   count  : число травинок (по умолчанию 20000; на телефонах разумно 8000–12000);
 *   avoid  : необязательный массив кругов [{ x, z, r }], где трава не растёт (например, под стволами).
 *   → { mesh (InstancedMesh), count, dispose() }
 *
 * ВЕТЕР
 *   Tree.wind = 0.8;        // сила ветра 0..2 — качаются ветви, дрожат листья, волнуется трава
 *   Tree.update(seconds);   // вызывать каждый кадр
 *
 * Тени у мешей включены — включите renderer.shadowMap.enabled и castShadow у источника света.
 * Цвета рассчитаны на renderer.outputEncoding = THREE.sRGBEncoding.
 */
import * as THREE from 'three';
const __G = { THREE };
(function (global) {
'use strict';
const T = global.THREE;
if (!T) throw new Error('Tree: сначала подключите three.js');
const V3 = T.Vector3, UP = new V3(0, 1, 0);

/* ---------- random ---------- */
function rngOf(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.unit = () => { const u = f.range(-1, 1), t = f.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return new V3(s * Math.cos(t), u, s * Math.sin(t)); };
  return f;
}

/* ---------- wind (shared uniforms, bend grows with height above the tree base) ---------- */
const U = { uTime: { value: 0 }, uWind: { value: 0.8 }, uTramp: { value: Array.from({ length: 14 }, () => new T.Vector4(0, -9999, 0, 0)) } };
function windify(mat, k, flutter) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float h = max(mvPosition.y, 0.0);
      vec4 wp = modelMatrix * mvPosition;
      vec4 base = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float ph = base.x * 0.13 + base.z * 0.07;
      float gust = 0.55 + 0.45 * sin(uTime * 0.4 + ph);
      float s = sin(uTime * 1.3 + wp.x * 0.3 + wp.z * 0.2) * 0.55 + sin(uTime * 2.4 + wp.z * 0.5) * 0.25 + 0.55;
      float b = ${k.toFixed(5)} * h * h * uWind * gust;
      wp.x += b * s;
      wp.z += b * 0.35 * sin(uTime * 1.1 + wp.x * 0.3);
      wp.xyz += ${flutter.toFixed(4)} * uWind * vec3(sin(uTime * 7.0 + wp.y * 9.0 + wp.x * 5.0), 0.6 * sin(uTime * 8.3 + wp.z * 7.0), cos(uTime * 6.4 + wp.x * 8.0));
      mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'tree_wind_' + k + '_' + flutter + '_' + mat.type;
  return mat;
}

/* ---------- procedural textures (generated once, shared) ---------- */
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function oakBark(r) {
  const [c, g] = cv(256, 512); g.fillStyle = '#6b5c4c'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${r.range(60, 120) | 0},${r.range(50, 100) | 0},${r.range(40, 80) | 0},.25)`; g.fillRect(r.range(0, 256), r.range(0, 512), r.range(1, 3), r.range(2, 10)); }
  g.strokeStyle = 'rgba(30,22,16,.85)'; g.lineCap = 'round';
  for (let k = 0; k < 22; k++) {
    let x = r.range(0, 256); g.lineWidth = r.range(2, 6); g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 16) { x += r.range(-5, 5); g.lineTo(x, y); } g.stroke();
    g.save(); g.translate(256, 0); g.stroke(); g.restore(); g.save(); g.translate(-256, 0); g.stroke(); g.restore();
  }
  for (let k = 0; k < 40; k++) { g.strokeStyle = 'rgba(30,22,16,.6)'; g.lineWidth = r.range(1, 2.5); const x = r.range(0, 256), y = r.range(0, 512); g.beginPath(); g.moveTo(x, y); g.lineTo(x + r.range(-12, 12), y + r.range(4, 10)); g.stroke(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; return t;
}
function birchBark(r) {
  const [c, g] = cv(256, 512); g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 1500; i++) { g.fillStyle = 'rgba(180,175,160,.25)'; g.fillRect(r.range(0, 256), r.range(0, 512), r.range(4, 30), 1); }
  for (let k = 0; k < 70; k++) {
    const y = r.range(0, 512), x = r.range(0, 256), w = r.range(10, 60), h = r.range(2, 7);
    g.fillStyle = `rgba(${r.range(20, 50) | 0},${r.range(18, 40) | 0},${r.range(15, 30) | 0},${r.range(0.6, 0.95)})`;
    for (const ox of [-256, 0, 256]) { g.beginPath(); g.ellipse(x + ox, y, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill(); }
  }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; return t;
}
// light-grey leaf with darker veins; per-instance colour multiplies through it
function leafTex(widthFn, lobes) {
  const W = 128, H = 256, [c, g] = cv(W, H), pts = [];
  for (let i = 0; i <= 60; i++) { const y = i / 60; pts.push([widthFn(y), y]); }
  g.beginPath(); g.moveTo(W / 2, H - 4);
  pts.forEach(([w, y]) => g.lineTo(W / 2 + w * W, H - 4 - y * (H - 24)));
  for (let i = pts.length - 1; i >= 0; i--) { const [w, y] = pts[i]; g.lineTo(W / 2 - w * W, H - 4 - y * (H - 24)); }
  g.closePath();
  const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#d6d6d6'); gr.addColorStop(0.5, '#f4f4f4'); gr.addColorStop(1, '#cfcfcf');
  g.fillStyle = gr; g.fill(); g.save(); g.clip();
  g.strokeStyle = 'rgba(120,120,120,.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 20); g.stroke();
  g.lineWidth = 1.4; g.strokeStyle = 'rgba(130,130,130,.6)';
  for (let i = 1; i < lobes; i++) { const y = H - 10 - i * (H - 30) / lobes; for (const s of [1, -1]) { g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + s * 20, y - 10, W / 2 + s * W * 0.45, y - 26); g.stroke(); } }
  g.restore(); g.fillStyle = '#8a8a8a'; g.fillRect(W / 2 - 2, H - 12, 4, 12);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const r = rngOf(4242);
  TEX = {
    oakBark: oakBark(r), birchBark: birchBark(r),
    oakLeaf: leafTex(y => Math.pow(Math.sin(Math.PI * Math.min(1, y * 1.05)), 0.7) * (0.28 + 0.13 * Math.abs(Math.sin(y * Math.PI * 4.5))) * (y < 0.04 ? 0.2 : 1), 5),
    birchLeaf: leafTex(y => Math.pow(Math.sin(Math.PI * Math.min(1, y)), 0.9) * 0.34 * (1 - 0.35 * y) * (1 + 0.07 * Math.sin(y * 80)), 6)
  };
  return TEX;
}
let LEAF_GEO = null;
function leafGeo() {
  if (LEAF_GEO) return LEAF_GEO;
  const g = new T.PlaneGeometry(0.5, 1, 1, 2); g.translate(0, 0.5, 0);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, Math.sin(y * Math.PI) * 0.06 - y * y * 0.08); }
  g.computeVertexNormals(); return (LEAF_GEO = g);
}

/* ---------- smooth tapered branch tubes (parallel-transport frames) ---------- */
function perp(v) { const a = Math.abs(v.y) < 0.9 ? UP : new V3(1, 0, 0); return new V3().crossVectors(v, a).normalize(); }
function tube(buf, pts, rads, seg, vScale) {
  const n = pts.length, base = buf.pos.length / 3; let N = null, prevT = null, len = 0;
  for (let i = 0; i < n; i++) {
    const Tg = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    if (!N) N = perp(Tg); else N.applyQuaternion(new T.Quaternion().setFromUnitVectors(prevT, Tg)).normalize();
    prevT = Tg; const B = new V3().crossVectors(Tg, N);
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    for (let j = 0; j <= seg; j++) {
      const a = j / seg * Math.PI * 2, d = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)), p = pts[i].clone().addScaledVector(d, rads[i]);
      buf.pos.push(p.x, p.y, p.z); buf.nor.push(d.x, d.y, d.z); buf.uv.push(j / seg * Math.max(1, Math.round(rads[0] * 12)), len * vScale);
    }
  }
  const cols = seg + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1; buf.idx.push(a, b, c, b, d, c); }
  buf.count++;
}

/* ---------- species parameters (per branching depth) ---------- */
const SPECIES = {
  oak: {
    trunkLen: 4.2, trunkR: 0.42, flare: 0.7, roots: 6, maxDepth: 4, vScale: 0.35,
    steps: [3, 3, 4, 5, 6], seg: [16, 10, 7, 5, 4],
    children: [7, 4, 4, 3], childStart: [0.42, 0.25, 0.25, 0.3], angle: [0.95, 0.75, 0.8, 0.7], childUp: [0.15, 0.1, 0.05, 0],
    lenRatio: [0.95, 0.62, 0.55, 0.5], radRatio: 0.62, taper: [0.55, 0.35, 0.3, 0.25, 0.2],
    wobble: [0.06, 0.18, 0.25, 0.3, 0.35], photo: [0.02, 0.05, 0.04, 0.03, 0.04], gravity: [0, 0.06, 0.05, 0.05, 0.04],
    leafDepth: 3, leafPerPt: 4, leafSize: 0.42, leafSpread: 0.18, leafUp: 0.5, wind: 0.0022,
    bark: 'oakBark', leaf: 'oakLeaf',
    palette: ['#3e6b2a', '#4f7d31', '#5b8a37', '#35602a']
  },
  // куст: короткий стволик, ветки сразу от земли, густая листва (в стиле дуба)
  bush: {
    trunkLen: 0.45, trunkR: 0.07, flare: 0.25, roots: 0, maxDepth: 3, vScale: 0.6,
    steps: [8, 6, 7, 8], seg: [6, 5, 4, 3],
    children: [8, 4, 3], childStart: [0.05, 0.25, 0.3], angle: [1.05, 0.8, 0.8], childUp: [0.35, 0.1, 0.05],
    lenRatio: [2.0, 0.6, 0.55], radRatio: 0.7, taper: [0.6, 0.4, 0.3, 0.2],
    wobble: [0.1, 0.25, 0.3, 0.35], photo: [0.06, 0.06, 0.04, 0.03], gravity: [0, 0.07, 0.08, 0.06],
    leafDepth: 1, leafPerPt: 3, leafSize: 0.2, leafSpread: 0.12, leafUp: 0.45, wind: 0.03,
    bark: 'oakBark', leaf: 'oakLeaf',
    palette: ['#355f26', '#43702c', '#4f7d31', '#2f5522']
  },
  birch: {
    trunkLen: 7.5, trunkR: 0.17, flare: 0.3, roots: 0, maxDepth: 3, vScale: 0.4,
    steps: [2.5, 3, 5, 7], seg: [12, 7, 5, 4],
    children: [11, 4, 4], childStart: [0.35, 0.2, 0.2], angle: [0.7, 0.6, 0.7], childUp: [0.25, 0, 0],
    lenRatio: [0.42, 0.6, 0.65], radRatio: 0.5, taper: [0.3, 0.3, 0.25, 0.2],
    wobble: [0.03, 0.12, 0.15, 0.18], photo: [0.02, 0.03, 0, 0], gravity: [0, 0.05, 0.25, 0.45],
    leafDepth: 2, leafPerPt: 2, leafSize: 0.28, leafSpread: 0.12, leafUp: -0.2, wind: 0.0018,
    bark: 'birchBark', leaf: 'birchLeaf',
    palette: ['#5f9a3a', '#6fa844', '#548c34']
  }
};

/* ---------- recursive branching ---------- */
function grow(P, r, lod) {
  lod = lod || { seg: 1, step: 1, leaf: 1, leafS: 1 };
  const buf = { pos: [], nor: [], uv: [], idx: [], count: 0 }, leaves = [];
  let maxY = 0, maxR = 0;
  function branch(start, dir, len, r0, d) {
    const n = Math.max(4, Math.min(16, Math.round(len * P.steps[d])));   // скелет всегда одинаковый — LOD не меняет форму дерева
    const pts = [start.clone()], rads = [r0], dirs = [dir.clone()], dd = dir.clone(), p = start.clone();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      dd.addScaledVector(r.unit(), P.wobble[d]).addScaledVector(UP, P.photo[d]).addScaledVector(UP, -P.gravity[d] * t).normalize();
      p.addScaledVector(dd, len / n); pts.push(p.clone()); dirs.push(dd.clone());
      let rad = r0 * (1 - t * (1 - P.taper[d])); if (d === 0 && P.flare) rad *= 1 + P.flare * Math.exp(-t * 14);
      rads.push(Math.max(rad, 0.004));
      maxY = Math.max(maxY, p.y); maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    }
    if (d <= P.maxDepth - (lod.cut || 0)) {
      const m = Math.max(2, Math.round(n * lod.step)), sp = [], sr = [];
      for (let j = 0; j <= m; j++) { const ii = Math.round(j * n / m); sp.push(pts[ii]); sr.push(rads[ii]); }
      tube(buf, sp, sr, Math.max(3, Math.round(P.seg[d] * lod.seg)), P.vScale);
    }
    if (d < P.maxDepth) {
      const cnt = P.children[d];
      for (let k = 0; k < cnt; k++) {
        const f = P.childStart[d] + (1 - P.childStart[d]) * Math.min(0.97, (k + r.range(0.2, 0.8)) / cnt);
        const fi = f * n, i0 = Math.floor(fi), fr = fi - i0, i1 = Math.min(n, i0 + 1);
        const sp = pts[i0].clone().lerp(pts[i1], fr), t = dirs[i0].clone().lerp(dirs[i1], fr).normalize();
        const pv = perp(t).applyAxisAngle(t, k * 2.39996 + r.range(-0.4, 0.4) + d);
        const cd = t.clone().applyAxisAngle(new V3().crossVectors(t, pv).normalize(), P.angle[d] + r.range(-0.15, 0.15)).addScaledVector(UP, P.childUp[d]).normalize();
        const pr = rads[i0] + (rads[i1] - rads[i0]) * fr;
        const cl = len * P.lenRatio[d] * (d === 0 ? (1.15 - 0.55 * f) : 1) * r.range(0.8, 1.15);
        branch(sp, cd, cl, Math.max(0.006, pr * P.radRatio), d + 1);
      }
    }
    if (d >= P.leafDepth) {
      for (let i = Math.round(n * 0.3); i <= n; i++) for (let k = 0; k < P.leafPerPt; k++) {
        const pos = pts[i].clone().addScaledVector(r.unit(), P.leafSpread);
        const ld = dirs[i].clone().multiplyScalar(0.4).add(r.unit()).addScaledVector(UP, P.leafUp).normalize();
        const keep = r() < lod.leaf;
        const L0 = { pos, dir: ld, s: P.leafSize * lod.leafS * r.range(0.75, 1.2), spin: r.range(0, Math.PI * 2), pick: r(), shade: r() };
        if (keep) leaves.push(L0);
      }
    }
  }
  branch(new V3(0, -0.1, 0), new V3(r.range(-0.05, 0.05), 1, r.range(-0.05, 0.05)).normalize(), P.trunkLen, P.trunkR, 0);
  for (let k = 0; k < (P.roots || 0); k++) { // surface roots spreading into the soil
    const a = k / P.roots * Math.PI * 2 + r.range(-0.3, 0.3), pts = [], rads = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8, rr = 0.2 + t * 1.6; pts.push(new V3(Math.cos(a) * rr, 0.35 * (1 - t) - 0.12 * t, Math.sin(a) * rr)); rads.push(P.trunkR * 0.55 * (1 - t * 0.92)); }
    tube(buf, pts, rads, Math.max(4, Math.round(8 * lod.seg)), P.vScale);
  }
  const g = new T.BufferGeometry(); g.setIndex(buf.idx);
  g.setAttribute('position', new T.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(buf.nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(buf.uv, 2));
  g.computeBoundingSphere();
  return { geo: g, leaves, branches: buf.count, height: maxY, crown: maxR };
}

/* ---------- public factory ---------- */
function create(opts = {}) {
  const o = Object.assign({ species: 'oak', seed: 1, scale: 1 }, opts);
  const P = SPECIES[o.species]; if (!P) throw new Error('Tree: неизвестный вид "' + o.species + '" (есть: ' + Object.keys(SPECIES).join(', ') + ')');
  const r = rngOf(o.seed * 7919 + 17), tex = textures(), t = grow(P, r);
  const group = new T.Group(); group.name = 'Tree:' + o.species; group.scale.setScalar(o.scale);

  const barkMat = windify(new T.MeshStandardMaterial({ map: tex[P.bark], bumpMap: tex[P.bark], bumpScale: 0.04, roughness: 0.95 }), P.wind, 0);
  const wood = new T.Mesh(t.geo, barkMat); wood.castShadow = wood.receiveShadow = true;
  wood.customDepthMaterial = windify(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), P.wind, 0);
  group.add(wood);

  const leafMat = windify(new T.MeshStandardMaterial({ map: tex[P.leaf], alphaTest: 0.5, side: T.DoubleSide, roughness: 0.65 }), P.wind, 0.012);
  const leaves = new T.InstancedMesh(leafGeo(), leafMat, t.leaves.length);
  const dummy = new T.Object3D(), q = new T.Quaternion();
  t.leaves.forEach((l, i) => { dummy.position.copy(l.pos); q.setFromUnitVectors(UP, l.dir); dummy.quaternion.copy(q); dummy.rotateY(l.spin); dummy.scale.setScalar(l.s); dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix); });
  leaves.instanceColor = new T.InstancedBufferAttribute(new Float32Array(t.leaves.length * 3), 3);
  leaves.customDepthMaterial = windify(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: tex[P.leaf], alphaTest: 0.5 }), P.wind, 0.012);
  leaves.castShadow = leaves.receiveShadow = true;
  group.add(leaves);

  const c = new T.Color(), a = leaves.instanceColor.array;
  t.leaves.forEach((l, i) => { c.set(P.palette[Math.floor(l.pick * P.palette.length)]).multiplyScalar(0.85 + l.shade * 0.3); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; });
  leaves.instanceColor.needsUpdate = true;

  return {
    group,
    height: (t.height + P.leafSize) * o.scale, crownRadius: (t.crown + P.leafSize) * o.scale,
    stats: { branches: t.branches, leaves: t.leaves.length },
    dispose() {
      if (group.parent) group.parent.remove(group);
      t.geo.dispose(); barkMat.dispose(); leafMat.dispose(); leaves.dispose();
      wood.customDepthMaterial.dispose(); leaves.customDepthMaterial.dispose();
    }
  };
}

/* ---------- ground surface ---------- */
function hash3(x, y, z, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s | 0, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function noise2(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t;
  return L(L(hash3(xi, 0, zi, s), hash3(xi + 1, 0, zi, s), u), L(hash3(xi, 0, zi + 1, s), hash3(xi + 1, 0, zi + 1, s), u), v) * 2 - 1;
}
function fbm2(x, z, oct, s) { let a = 0.5, f = 1, sum = 0, n = 0; for (let i = 0; i < oct; i++) { sum += a * noise2(x * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.03; } return sum / n; }
let GROUND_TEX = null;
function groundTex() {
  if (GROUND_TEX) return GROUND_TEX;
  const r = rngOf(99), [c, g] = cv(512, 512); g.fillStyle = '#6f7a3c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { const l = r.range(-25, 25); g.fillStyle = `rgba(${100 + l | 0},${110 + l | 0},${55 + l * 0.5 | 0},.35)`; g.fillRect(r.range(0, 512), r.range(0, 512), r.range(1, 4), r.range(1, 4)); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(110,90,60,.18)'; g.beginPath(); g.arc(r.range(0, 512), r.range(0, 512), r.range(10, 40), 0, 7); g.fill(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace;
  return (GROUND_TEX = t);
}
function createGround(opts = {}) {
  const o = Object.assign({ size: 60, segments: 160, seed: 1, hills: 0.6 }, opts), s = o.seed & 0xffff;
  const heightAt = (x, z) => fbm2(x * 0.05, z * 0.05, 4, s) * o.hills * 1.6 + fbm2(x * 0.4, z * 0.4, 2, s + 7) * 0.05;
  const geo = new T.PlaneGeometry(o.size, o.size, o.segments, o.segments); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, col = [], c = new T.Color(), A = new T.Color('#4f7a2c'), B = new T.Color('#6f9238'), D = new T.Color('#7a6a44');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i); p.setY(i, heightAt(x, z));
    c.copy(A).lerp(B, 0.5 + fbm2(x * 0.12, z * 0.12, 3, s + 3)).lerp(D, Math.max(0, fbm2(x * 0.07, z * 0.07, 3, s + 5) - 0.25) * 2.2);
    col.push(c.r * 1.6, c.g * 1.6, c.b * 1.6);
  }
  geo.setAttribute('color', new T.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const tex = groundTex().clone(); tex.needsUpdate = true; tex.repeat.set(o.size / 6, o.size / 6);
  const mat = new T.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1 });
  const mesh = new T.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'Tree:ground';
  return { mesh, heightAt, size: o.size, dispose() { if (mesh.parent) mesh.parent.remove(mesh); geo.dispose(); mat.dispose(); tex.dispose(); } };
}

/* ---------- grass (instanced blades that follow the ground) ---------- */
let BLADE_GEO = null;
function bladeGeo() {
  if (BLADE_GEO) return BLADE_GEO;
  const seg = 4, pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, w = 0.045 * (1 - t * 0.92), z = t * t * 0.18, k = 0.45 + t * 0.65;
    pos.push(-w, t, z, w, t, z); col.push(k, k, k, k, k, k);
    if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new T.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); return (BLADE_GEO = g);
}
function createGrass(opts = {}) {
  const o = Object.assign({ count: 20000, seed: 1, avoid: [] }, opts);
  if (!o.ground || !o.ground.heightAt) throw new Error('Tree.createGrass: передайте { ground } из Tree.createGround()');
  const r = rngOf(o.seed * 131 + 5), half = o.ground.size / 2 * 0.98, s = o.seed & 0xffff;
  const mat = windify(new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: 0.85 }), 1.1, 0.006);
  const mesh = new T.InstancedMesh(bladeGeo(), mat, o.count);
  const patch = (x, z) => 0.55 + 0.45 * fbm2(x * 0.18 + 3, z * 0.18, 2, s + 11) * 1.6;
  const pal = ['#5e8c32', '#6f9a3a', '#4f7a2b', '#86a548'].map(h => new T.Color(h));
  const colors = new Float32Array(o.count * 3), dummy = new T.Object3D(), c = new T.Color();
  let n = 0, tries = 0;
  while (n < o.count && tries++ < o.count * 20) {
    const x = r.range(-half, half), z = r.range(-half, half);
    if (r() > patch(x, z)) continue;
    if (o.avoid.some(a => (x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r)) continue;
    dummy.position.set(x, o.ground.heightAt(x, z) - 0.02, z);
    dummy.rotation.set(r.range(-0.15, 0.15), r.range(0, Math.PI * 2), r.range(-0.15, 0.15));
    dummy.scale.set(r.range(0.8, 1.3), r.range(0.25, 0.7) * (0.7 + 0.5 * Math.min(1, patch(x, z))), 1);
    dummy.updateMatrix(); mesh.setMatrixAt(n, dummy.matrix);
    c.copy(pal[Math.floor(r() * pal.length)]).multiplyScalar(0.85 + r() * 0.3); colors.set([c.r, c.g, c.b], n * 3);
    n++;
  }
  mesh.count = n; mesh.instanceColor = new T.InstancedBufferAttribute(colors, 3);
  mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'Tree:grass';
  return { mesh, count: n, dispose() { if (mesh.parent) mesh.parent.remove(mesh); mat.dispose(); mesh.dispose(); } };
}

/* ---------- для игры: дерево целиком в двух геометриях, чтобы ставить тысячи копий через InstancedMesh ---------- */
const LODS = [{ seg: 0.62, step: 0.6, leaf: 0.5, leafS: 1.38 }, { seg: 0.4, step: 0.4, leaf: 0.2, leafS: 2.1, cut: 1 }, { seg: 0.3, step: 0.3, leaf: 0.09, leafS: 3.0, cut: 2 }];
function bake(species, seed, lodIdx) {
  const P = SPECIES[species], r = rngOf(seed * 7919 + 17), t = grow(P, r, LODS[lodIdx || 0]);
  const quad = new T.PlaneGeometry(0.5, 1, 1, 1); quad.translate(0, 0.5, 0);
  { const p = quad.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -y * y * 0.08); } quad.computeVertexNormals(); }
  const qp = quad.attributes.position, qn = quad.attributes.normal, qu = quad.attributes.uv, qi = quad.index.array, nL = t.leaves.length;
  const pos = new Float32Array(nL * 4 * 3), nor = new Float32Array(nL * 4 * 3), uv = new Float32Array(nL * 4 * 2), col = new Float32Array(nL * 4 * 3), idx = new Uint32Array(nL * 6);
  const dummy = new T.Object3D(), q = new T.Quaternion(), v = new V3(), c = new T.Color(), nm = new T.Matrix3();
  t.leaves.forEach((l, i) => {
    dummy.position.copy(l.pos); q.setFromUnitVectors(UP, l.dir); dummy.quaternion.copy(q); dummy.rotateY(l.spin); dummy.scale.setScalar(l.s); dummy.updateMatrix(); nm.getNormalMatrix(dummy.matrix);
    c.set(P.palette[Math.floor(l.pick * P.palette.length)]).multiplyScalar(0.85 + l.shade * 0.3);
    for (let k = 0; k < 4; k++) {
      v.fromBufferAttribute(qp, k).applyMatrix4(dummy.matrix); pos.set([v.x, v.y, v.z], (i * 4 + k) * 3);
      v.fromBufferAttribute(qn, k).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (i * 4 + k) * 3);
      uv.set([qu.getX(k), qu.getY(k)], (i * 4 + k) * 2); col.set([c.r, c.g, c.b], (i * 4 + k) * 3);
    }
    for (let k = 0; k < 6; k++) idx[i * 6 + k] = qi[k] + i * 4;
  });
  const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.BufferAttribute(pos, 3)); lg.setAttribute('normal', new T.BufferAttribute(nor, 3)); lg.setAttribute('uv', new T.BufferAttribute(uv, 2)); lg.setAttribute('color', new T.BufferAttribute(col, 3)); lg.setIndex(new T.BufferAttribute(idx, 1)); lg.computeBoundingSphere();
  return { wood: t.geo, leaves: lg, height: t.height + P.leafSize, crown: t.crown + P.leafSize, tris: t.geo.index.count / 3 + nL * 2 };
}
// ветер для копий: изгиб растёт с высотой над основанием КАЖДОГО дерева (а не над нулём мира)
function windInst(mat, k, flutter, tramp) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind; if (tramp) sh.uniforms.uTramp = U.uTramp;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + (tramp ? 'uniform vec4 uTramp[14];\n' : '') + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      float sy = 1.0;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        sy = length(instanceMatrix[1].xyz);
      #endif
      float h = max(transformed.y, 0.0) * sy;
      vec4 wp = modelMatrix * mvPosition;
      vec4 base = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #endif
      float ph = base.x * 0.13 + base.z * 0.07;
      float gust = 0.55 + 0.45 * sin(uTime * 0.4 + ph);
      float s = sin(uTime * 1.3 + wp.x * 0.3 + wp.z * 0.2) * 0.55 + sin(uTime * 2.4 + wp.z * 0.5) * 0.25 + 0.55;
      float b = ${k.toFixed(5)} * h * h * uWind * gust;
      wp.x += b * s;
      wp.z += b * 0.35 * sin(uTime * 1.1 + wp.x * 0.3);
      wp.xyz += ${flutter.toFixed(4)} * uWind * vec3(sin(uTime * 7.0 + wp.y * 9.0 + wp.x * 5.0), 0.6 * sin(uTime * 8.3 + wp.z * 7.0), cos(uTime * 6.4 + wp.x * 8.0));
      ${tramp ? `
      // примятая трава: траву в радиусе от динозавров (и по их следу) пригибает к земле и отталкивает от центра
      float hf = clamp(h / 0.45, 0.0, 1.0);
      for (int i = 0; i < 14; i++) {
        vec4 tr = uTramp[i];
        if (tr.w > 0.01) {
          vec2 dd = base.xz - tr.xz; float dl = length(dd);
          float f = 1.0 - smoothstep(tr.w * 0.25, tr.w, dl);
          vec2 dir = dl > 0.001 ? dd / dl : vec2(0.0, 1.0);
          wp.xz += dir * f * hf * 0.55 * min(1.0, h * 2.2);
          wp.y -= f * hf * h * 0.62;
        }
      }` : ''}
      mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'tree_winst_' + k + '_' + flutter + '_' + mat.type + (mat.alphaTest ? 'a' : '') + (tramp ? 't' : '');
  return mat;
}
const MATS = {};
function materials(species) {
  if (MATS[species]) return MATS[species];
  const P = SPECIES[species], tex = textures();
  const bark = windInst(new T.MeshStandardMaterial({ map: tex[P.bark], bumpMap: tex[P.bark], bumpScale: 0.04, roughness: 0.95 }), P.wind, 0);
  const barkD = windInst(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), P.wind, 0);
  const leaf = windInst(new T.MeshStandardMaterial({ map: tex[P.leaf], alphaTest: 0.5, side: T.DoubleSide, roughness: 0.65, vertexColors: true }), P.wind, 0.012);
  const leafD = windInst(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: tex[P.leaf], alphaTest: 0.5 }), P.wind, 0.012);
  return (MATS[species] = { bark, barkD, leaf, leafD });
}
let GRASS_MAT = null;
function grassMaterial() { return GRASS_MAT || (GRASS_MAT = windInst(new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: 0.85 }), 1.1, 0.006, true)); }
const GRASS_PAL = ['#5e8c32', '#6f9a3a', '#4f7a2b', '#86a548'];

global.Tree = {
  bake, materials, grassMaterial, bladeGeo, grassPalette: GRASS_PAL, fbm2, rngOf,
  version: '1.1.0',
  species: Object.keys(SPECIES),
  create,
  createGround,
  createGrass,
  update(seconds) { U.uTime.value = seconds; },
  tramp: U.uTramp.value,
  get wind() { return U.uWind.value; },
  set wind(v) { U.uWind.value = v; }
};
})(__G);
const Tree = __G.Tree;
export { Tree };

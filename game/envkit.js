/* Растения окружения на присланных моделях (берёзы, дуб, куст, папоротник, снежный куст — game/envm.js) и густой травяной покров,
   плюс общий ВЕТЕР: одно направление для всего мира (деревья, кусты, трава, водоросли, частицы). Порывы бегут по местности «волнами»
   по ветру — видно, как по траве и кронам прокатывается порыв. Мягкие растения (кусты, папоротник, трава) ещё и раздвигаются телом. */
import * as THREE from 'three';
import { ENVM } from './envm.js';
import { ENVM2 } from './envm2.js';
Object.assign(ENVM.tex, ENVM2.tex); Object.assign(ENVM.m, ENVM2.m);     // вторая партия: кристаллы, камень со мхом, рогоз, ива, мангр, перекати-поле, кактусы, агава, рододендрон, горечавка, сосна, подснежник, можжевельник, ель в снегу, колокольчик, ромашка
import { Tree } from './treekit.js';

// ---------------------------------------------------------------- ветер
// uWindDir — единичный вектор по ветру (x, z); uWind — сила (0 штиль … 2 буря); uTime — время
export const WIND = { uTime: { value: 0 }, uWind: { value: 0.9 }, uWindDir: { value: new THREE.Vector2(0.8, 0.6) } };
// GLSL: смещение (x, z) точки на высоте h над основанием растения в мировых координатах (base — основание)
export const WIND_GLSL = `
uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
float windGust(vec2 b) {
  float fr = dot(b, uWindDir) * 0.045 - uTime * 0.62;                       // фронт порыва идёт по ветру (~14 м/с)
  float side = dot(b, vec2(-uWindDir.y, uWindDir.x)) * 0.021;
  return clamp(0.5 + 0.5 * sin(fr + sin(side + uTime * 0.05) * 1.6) * (0.65 + 0.35 * sin(fr * 0.41 + 1.3)), 0.0, 1.0);
}
vec2 windOffset(vec2 b, float h, float k) {
  float g = windGust(b), ph = b.x * 0.37 + b.y * 0.23;
  float osc = sin(uTime * 1.9 + ph) * 0.16 + sin(uTime * 3.3 + ph * 1.7) * 0.06;
  float bnd = k * h * h * uWind;
  return uWindDir * bnd * (0.45 + 0.85 * g + osc) + vec2(-uWindDir.y, uWindDir.x) * bnd * 0.1 * sin(uTime * 1.4 + ph * 1.9);
}`;

// ---------------------------------------------------------------- материалы
// k — изгиб на метр² высоты; fl — дрожание листвы (м); tramp — 1: мягкое (раздвигается телом), 0: твёрдое
const TRAMP_GLSL = `
  { float hf = clamp(h / 0.45, 0.0, 1.0); vec2 gsh = vec2(0.0); float gdn = 0.0;
    for (int i = 0; i < 24; i++) {
      vec4 tr = uTramp[i];
      if (tr.w > 0.01) {
        vec2 dd = base.xz - tr.xz; float dl = length(dd);
        float f = 1.0 - smoothstep(tr.w * 0.25, tr.w * TRK, dl);
        if (f > 0.0) {
          vec2 dir = dl > 0.001 ? dd / dl : vec2(0.0, 1.0);
          vec2 vv = uTrampV[i].xy; float sp = length(vv); vec2 vd = sp > 0.01 ? vv / sp : vec2(0.0);
          float a = tr.y, spring = exp(-a * 1.8) * cos(a * 6.6), press = exp(-a * 3.0);
          gsh += (dir * 0.6 + vd * clamp(sp / 7.0, 0.0, 1.0) * 0.55) * f * hf * min(1.0, h * TRS) * spring;
          gdn += f * hf * h * TRD * press;
        }
      }
    }
    float gl = length(gsh); if (gl > 0.9) gsh *= 0.9 / gl;
    wp.xz += gsh; wp.y -= min(gdn, h * 0.7); }`;
function windMat(mat, k, fl, tramp, grass) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, WIND); if (tramp) { sh.uniforms.uTramp = { value: Tree.tramp }; sh.uniforms.uTrampV = { value: Tree.trampV }; }
    sh.vertexShader = 'attribute vec2 wnd;\n' + WIND_GLSL + '\n' + (tramp ? 'uniform vec4 uTramp[24];\nuniform vec4 uTrampV[24];\n' : '') + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0); float sy = 1.0;
      vec4 base = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition; base = instanceMatrix * base; sy = length(instanceMatrix[1].xyz);
      #endif
      vec4 wp = modelMatrix * mvPosition; base = modelMatrix * base;
      float h = max(transformed.y, 0.0) * sy;
      wp.xz += windOffset(base.xz, h, ${k.toFixed(5)});
      ${grass ? 'wp.y -= dot(windOffset(base.xz, h, ' + k.toFixed(5) + '), windOffset(base.xz, h, ' + k.toFixed(5) + ')) * 0.9 / max(h, 0.05);' : ''}
      float ff = wnd.x * ${fl.toFixed(4)} * uWind * (0.4 + windGust(base.xz)); float fp = wnd.y * 6.2832;
      wp.xyz += ff * vec3(sin(uTime * 6.3 + fp + wp.y * 3.0), 0.5 * sin(uTime * 7.7 + fp * 1.3), cos(uTime * 5.9 + fp + wp.x * 2.0));
      ${tramp ? TRAMP_GLSL.replace(/TRK/g, tramp === 2 ? '1.15' : '1.0').replace(/TRS/g, tramp === 2 ? '2.4' : '0.8').replace(/TRD/g, tramp === 2 ? '0.6' : '0.1') : ''}
      mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  if (mat.side === THREE.DoubleSide && mat.type === 'MeshStandardMaterial') {     // листва и травинки: нормаль не переворачиваем на изнанке (иначе изнанка чёрная)
    const pv = mat.onBeforeCompile;
    mat.onBeforeCompile = sh => { pv(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = gl_FrontFacing ? 1.0 : -1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;'); };
  }
  mat.customProgramCacheKey = () => 'envwind_' + k + '_' + fl + '_' + tramp + (grass ? 'g' : '') + mat.type + (mat.alphaTest ? 'a' : '') + (mat.vertexColors ? 'c' : '');
  return mat;
}

// листва вдали не «тает»: на мелких мипах альфа усредняется ниже порога — компенсируем по уровню мипа (крона остаётся плотной)
function alphaMip(mat, size) {
  const pv = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => { pv && pv(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
      { vec2 tdx = dFdx(vMapUv * ${size.toFixed(1)}), tdy = dFdy(vMapUv * ${size.toFixed(1)}); float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
        diffuseColor.a *= 1.0 + mip * 0.3; }
      #endif
      #include <alphatest_fragment>`); };
  const ck = mat.customProgramCacheKey; mat.customProgramCacheKey = () => (ck ? ck() : '') + 'am';
}
// кора трипланарно в координатах модели (борозды вдоль ствола и ветвей), рельеф — из яркости той же текстуры
function triBark(mat, sc) {
  const pv = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => { pv && pv(sh);
    sh.vertexShader = 'varying vec3 vOP;\nvarying vec3 vON;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = 'varying vec3 vOP;\nvarying vec3 vON;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec3 tbw = pow(abs(normalize(vON)), vec3(4.0)); tbw /= dot(tbw, vec3(1.0));
      vec4 tbc = texture2D(map, vec2(vOP.z, vOP.y * 0.45) * ${sc.toFixed(2)}) * tbw.x + texture2D(map, vec2(vOP.x, vOP.y * 0.45) * ${sc.toFixed(2)}) * tbw.z + texture2D(map, vOP.xz * ${sc.toFixed(2)}) * tbw.y;
      diffuseColor *= tbc;`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float hh = dot(tbc.rgb, vec3(0.33)); vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition); float dhx = dFdx(hh), dhy = dFdy(hh);
        vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1); vec3 grd = sign(det) * (dhx * r1 + dhy * r2);
        normal = normalize(abs(det) * normal - grd * 0.7); }`); };
  const ck = mat.customProgramCacheKey; mat.customProgramCacheKey = () => (ck ? ck() : '') + 'tri';
}
const TEXC = {}, GRASS_K = { value: 4.4 };
function tex(name) {
  if (!name) return null; if (TEXC[name]) return TEXC[name];
  const t = new THREE.TextureLoader().load(ENVM.tex[name]); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return (TEXC[name] = t);
}
const b64 = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
const GEOC = new Map();
function partGeo(P) {
  let g = GEOC.get(P); if (g) return g;
  g = new THREE.BufferGeometry();
  const deq = (s, k) => { const a = b64(s, Int16Array), f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i] * k; return f; };   // int16 со шкалой (вторая партия моделей)
  g.setAttribute('position', new THREE.BufferAttribute(P.q ? deq(P.p, P.q) : b64(P.p, Float32Array), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b64(P.n, Int8Array), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(P.qu ? deq(P.uv, P.qu) : b64(P.uv, Float32Array), 2));
  g.setAttribute('wnd', new THREE.BufferAttribute(b64(P.w, Uint8Array), 2, true));
  if (P.c) g.setAttribute('color', new THREE.BufferAttribute(b64(P.c, Uint8Array), 3, true));
  g.setIndex(new THREE.BufferAttribute(b64(P.i, P.big ? Uint32Array : Uint16Array), 1));
  g.computeBoundingSphere(); GEOC.set(P, g); return g;
}
// жёсткость по виду: изгиб (на м² высоты), дрожание листвы, мягкость
const KIND = { oak: [0.0016, 0.05, 0], birch: [0.0024, 0.07, 0], bush: [0.03, 0.03, 2], fern: [0.05, 0.03, 2], snowbush: [0.025, 0, 2],
  crystal: [0, 0, 0], mossrock: [0, 0, 0], barrel: [0, 0, 0], saguaro: [0, 0, 0], agave: [0.004, 0, 1], tumbleweed: [0.01, 0.02, 1],
  cattail: [0.06, 0.03, 2], willow: [0.0026, 0.08, 0], mangrove: [0.0018, 0.05, 0], mpine: [0.0015, 0.03, 0], snowtree: [0.0012, 0, 0], juniper: [0.003, 0.04, 0],
  rhodo: [0.03, 0.03, 2], gentian: [0.08, 0.02, 2], snowdrop: [0.09, 0.02, 2], bluebell: [0.08, 0.03, 2], daisy: [0.08, 0.03, 2] };
const MATC = new Map();
function partMat(name, P, soft) {
  const key = name + P.k + (soft ? 's' : '');
  let m = MATC.get(key); if (m) return m;
  const [k, fl] = KIND[name] || [0.002, 0.04], tr = soft ? (KIND[name] || [])[2] || 2 : 0, leaf = P.k === 'leaf';
  const map = tex(P.tex);
  const mat = windMat(new THREE.MeshStandardMaterial({ map, vertexColors: !!P.c, alphaTest: map && leaf ? 0.5 : 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide, roughness: leaf ? 0.75 : 0.92, metalness: 0 }), k, leaf ? fl : 0, tr);
  if (!leaf) mat.side = THREE.DoubleSide;                 // кора/ветви с двух сторон: на тонких ветках и срезах упрощённой сетки нет «дыр»
  if (map && leaf) alphaMip(mat, 512);
  if (P.k === 'tri') triBark(mat, 0.55);
  if (P.k === 'glow') { mat.emissiveMap = map; mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0.9; mat.roughness = 0.25; mat.metalness = 0.1; }   // кристаллы светятся
  const dm = windMat(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map && leaf ? map : null, alphaTest: map && leaf ? 0.5 : 0, side: THREE.DoubleSide }), k, leaf ? fl : 0, tr);
  if (map && leaf) alphaMip(dm, 512);
  m = { mat, dm }; MATC.set(key, m); return m;
}
export const EnvKit = {
  has: (name) => !!(ENVM.m[name]),
  variants: (name) => (ENVM.m[name] || []).length,
  height: (name, v) => { const a = ENVM.m[name]; return a ? a[v % a.length].h : 1; },
  // части модели (кора/ветви и листва): [{ geo, mat, dm }] — для InstancedMesh
  parts(name, v, lod, soft) {
    const a = ENVM.m[name]; if (!a) return [];
    const M = a[v % a.length], L = M.lod[Math.min(lod, M.lod.length - 1)];
    return L.map(P => (P.ref ? M.lod[P.ref[0]][P.ref[1]] : P)).map(P => Object.assign({ geo: partGeo(P), leaf: P.k === 'leaf' }, partMat(name, P, soft)));   // ref — та же сетка, что на другом уровне
  },
  grassClump, grassMaterial, grassK: GRASS_K,
  // яйца гнезда — присланная модель яйца: форма вписывается в габариты прежнего яйца (тот же размер и посадка)
  fitEggs(meshes) {
    const ps = ENVM.m.egg ? EnvKit.parts('egg', 0, 0, false) : []; if (!ps.length) return;
    const src = ps[0].geo; src.computeBoundingBox(); const sb = src.boundingBox, ss = new THREE.Vector3().subVectors(sb.max, sb.min);
    const mat = EGGM || (EGGM = new THREE.MeshStandardMaterial({ map: ps[0].mat.map, roughness: 0.55, metalness: 0 })), cache = new Map();
    for (const m of meshes) {
      let g = cache.get(m.geometry);
      if (!g) {
        m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox, d = new THREE.Vector3().subVectors(b.max, b.min);
        g = new THREE.BufferGeometry(); g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal.clone()); g.setAttribute('uv', src.attributes.uv); g.setIndex(src.index);
        g.translate(-(sb.min.x + sb.max.x) / 2, -sb.min.y, -(sb.min.z + sb.max.z) / 2); g.scale(d.x / ss.x, d.y / ss.y, d.z / ss.z); g.translate((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
        g.computeBoundingSphere(); cache.set(m.geometry, g);
      }
      m.geometry = g; m.material = mat;
    }
  }
};
let EGGM = null;

// ---------------------------------------------------------------- травяной покров
// пучок: 10 травинок из атласа (широкие зелёные, узкие, жёлтые сухие — 4 столбца), каждая изогнута и наклонена наружу;
// нормали почти вверх — пучки сливаются в ровный газон без «полосатости»
let CLUMP = null;
function grassClump() {
  if (CLUMP) return CLUMP;
  const pos = [], nrm = [], uv = [], wnd = [], idx = [], rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(91);
  const NB = 10, SEG = 2;
  for (let b = 0; b < NB; b++) {
    const a = rnd() * 6.2832, r = Math.sqrt(rnd()) * 0.26, x0 = Math.cos(a) * r, z0 = Math.sin(a) * r;
    const h = 0.55 + rnd() * 0.55, w = 0.035 + rnd() * 0.035, lean = 0.12 + rnd() * 0.3, la = a + (rnd() - 0.5) * 1.2, face = rnd() * 3.1416;
    const col = rnd() < 0.1 ? 3 : (rnd() * 3) | 0, u0 = col * 0.25 + 0.01, u1 = col * 0.25 + 0.24, ph = rnd();
    const fx = Math.cos(face) * w, fz = Math.sin(face) * w, v0 = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, bend = lean * t * t, cx = x0 + Math.cos(la) * bend * h, cz = z0 + Math.sin(la) * bend * h, y = h * t * (1 - 0.15 * t * t * lean), k = 1 - t * 0.35;
      pos.push(cx - fx * k, y, cz - fz * k, cx + fx * k, y, cz + fz * k);
      const nx = Math.cos(face + 1.5708) * 0.3, nz = Math.sin(face + 1.5708) * 0.3; nrm.push(nx, 0.95, nz, nx, 0.95, nz);
      uv.push(u0, 1 - t * 0.98, u1, 1 - t * 0.98); wnd.push(t, ph, t, ph);
      if (s < SEG) { const i = v0 + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.normalizeNormals && g.normalizeNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('wnd', new THREE.Float32BufferAttribute(wnd, 2));
  g.computeBoundingSphere(); return (CLUMP = g);
}
let GMAT = null;
function grassMaterial() {
  if (GMAT) return GMAT;
  const mat = windMat(new THREE.MeshStandardMaterial({ map: tex('grass_blade'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }), 0.55, 0.012, 2, true);
  alphaMip(mat, 256);
  // цвет экземпляра — оттенок биома (поверх текстуры), снизу пучок темнее (тень у земли)
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    prev(sh);
    sh.vertexShader = 'varying float vGy;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGy = clamp(position.y / 0.9, 0.0, 1.0);');
    // оттенок биома: яркость текстуры травинки × цвет экземпляра (палитра биома), немного родного цвета текстуры
    sh.fragmentShader = 'varying float vGy;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #if defined( USE_MAP ) && defined( USE_INSTANCING_COLOR )
        { float gl = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, vColor * gl * uGrassK, 0.8); }
      #endif
      diffuseColor.rgb *= 0.55 + 0.55 * vGy;`);
    sh.fragmentShader = 'uniform float uGrassK;\n' + sh.fragmentShader; sh.uniforms.uGrassK = GRASS_K;
  };
  return (GMAT = mat);
}
if (typeof window !== 'undefined') window.__ENV = { EnvKit, WIND };   // для отладки и автотестов

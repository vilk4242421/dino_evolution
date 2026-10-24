// Упрощение замкнутой сетки (квадричная схлопывание рёбер, Гарленд–Хекберт). Запуск: node tools/decimate.js V.bin F.bin outV.bin outF.bin <целевое число граней>
const fs = require('fs');
const [, , vIn, fIn, vOut, fOut, tgtS] = process.argv;
const vb = fs.readFileSync(vIn), fb = fs.readFileSync(fIn);
const P = new Float64Array(new Float32Array(vb.buffer, vb.byteOffset, vb.length / 4));
let F = new Int32Array(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.length));
const nV = P.length / 3, nF = F.length / 3, target = +tgtS;
const Q = new Float64Array(nV * 10);            // квадрики вершин
const alive = new Uint8Array(nF).fill(1), vAlive = new Uint8Array(nV).fill(1), ver = new Int32Array(nV);
const vf = Array.from({ length: nV }, () => []);  // вершина -> грани
function addPlane(q, o, a, b, c, d, w) {
  q[o] += w * a * a; q[o + 1] += w * a * b; q[o + 2] += w * a * c; q[o + 3] += w * a * d; q[o + 4] += w * b * b;
  q[o + 5] += w * b * c; q[o + 6] += w * b * d; q[o + 7] += w * c * c; q[o + 8] += w * c * d; q[o + 9] += w * d * d;
}
function faceNormal(f, out) {
  const i = F[f * 3], j = F[f * 3 + 1], k = F[f * 3 + 2];
  const ax = P[j * 3] - P[i * 3], ay = P[j * 3 + 1] - P[i * 3 + 1], az = P[j * 3 + 2] - P[i * 3 + 2];
  const bx = P[k * 3] - P[i * 3], by = P[k * 3 + 1] - P[i * 3 + 1], bz = P[k * 3 + 2] - P[i * 3 + 2];
  out[0] = ay * bz - az * by; out[1] = az * bx - ax * bz; out[2] = ax * by - ay * bx;
  return Math.hypot(out[0], out[1], out[2]);
}
const nn = [0, 0, 0];
for (let f = 0; f < nF; f++) {
  const area2 = faceNormal(f, nn); if (area2 < 1e-12) continue;
  const a = nn[0] / area2, b = nn[1] / area2, c = nn[2] / area2, i = F[f * 3];
  const d = -(a * P[i * 3] + b * P[i * 3 + 1] + c * P[i * 3 + 2]);
  for (let t = 0; t < 3; t++) { const v = F[f * 3 + t]; addPlane(Q, v * 10, a, b, c, d, area2 * 0.5); vf[v].push(f); }
}
function qerr(q, o, x, y, z) {
  return q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x + q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y + q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
}
const qs = new Float64Array(10);
function best(u, v, res) {
  for (let t = 0; t < 10; t++) qs[t] = Q[u * 10 + t] + Q[v * 10 + t];
  // решаем A x = -b
  const a = qs[0], b = qs[1], c = qs[2], d = qs[4], e = qs[5], f = qs[7];
  const det = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
  const scale = Math.abs(a) + Math.abs(d) + Math.abs(f) + 1e-18;
  if (Math.abs(det) > 1e-9 * scale * scale * scale) {
    const r0 = -qs[3], r1 = -qs[6], r2 = -qs[8];
    const dx = r0 * (d * f - e * e) - b * (r1 * f - e * r2) + c * (r1 * e - d * r2);
    const dy = a * (r1 * f - e * r2) - r0 * (b * f - c * e) + c * (b * r2 - c * r1);
    const dz = a * (d * r2 - r1 * e) - b * (b * r2 - r1 * c) + r0 * (b * e - c * d);
    res[0] = dx / det; res[1] = dy / det; res[2] = dz / det;
    res[3] = Math.max(0, qerr(qs, 0, res[0], res[1], res[2]));
    return;
  }
  let bc = 1e300;
  for (const [x, y, z] of [[P[u * 3], P[u * 3 + 1], P[u * 3 + 2]], [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], [(P[u * 3] + P[v * 3]) / 2, (P[u * 3 + 1] + P[v * 3 + 1]) / 2, (P[u * 3 + 2] + P[v * 3 + 2]) / 2]]) {
    const er = qerr(qs, 0, x, y, z); if (er < bc) { bc = er; res[0] = x; res[1] = y; res[2] = z; }
  }
  res[3] = Math.max(0, bc);
}
// куча (минимальная)
const H = { c: [], u: [], v: [], su: [], sv: [] };
function hpush(c, u, v, su, sv) {
  let i = H.c.length; H.c.push(c); H.u.push(u); H.v.push(v); H.su.push(su); H.sv.push(sv);
  while (i > 0) { const p = (i - 1) >> 1; if (H.c[p] <= H.c[i]) break; hswap(i, p); i = p; }
}
function hswap(a, b) { for (const k of ['c', 'u', 'v', 'su', 'sv']) { const t = H[k][a]; H[k][a] = H[k][b]; H[k][b] = t; } }
function hpop() {
  const r = [H.c[0], H.u[0], H.v[0], H.su[0], H.sv[0]], n = H.c.length - 1;
  hswap(0, n); for (const k of ['c', 'u', 'v', 'su', 'sv']) H[k].pop();
  let i = 0; for (;;) { let l = 2 * i + 1, rr = l + 1, m = i; if (l < n && H.c[l] < H.c[m]) m = l; if (rr < n && H.c[rr] < H.c[m]) m = rr; if (m === i) break; hswap(i, m); i = m; }
  return r;
}
const res = [0, 0, 0, 0];
function pushEdge(u, v) { best(u, v, res); hpush(res[3], u, v, ver[u], ver[v]); }
{ const seen = new Set(); for (let f = 0; f < nF; f++) for (let t = 0; t < 3; t++) { const a = F[f * 3 + t], b = F[f * 3 + (t + 1) % 3], lo = Math.min(a, b), hi = Math.max(a, b), key = lo * nV + hi; if (!seen.has(key)) { seen.add(key); pushEdge(lo, hi); } } }
let faces = nF; const n1 = [0, 0, 0], n2 = [0, 0, 0];
function neighbors(u) { const s = new Set(); for (const f of vf[u]) if (alive[f]) for (let t = 0; t < 3; t++) { const w = F[f * 3 + t]; if (w !== u) s.add(w); } return s; }
let guard = 0;
while (faces > target && H.c.length && guard++ < 5e6) {
  const [cost, u, v, su, sv] = hpop();
  if (!vAlive[u] || !vAlive[v] || ver[u] !== su || ver[v] !== sv) continue;
  best(u, v, res); const nx = res[0], ny = res[1], nz = res[2];
  // проверка: общие соседи (топология) и переворот граней
  const nu = neighbors(u), nv = neighbors(v); let common = 0; for (const w of nu) if (nv.has(w)) common++;
  if (common !== 2) continue;
  let bad = false; const ou = [P[u * 3], P[u * 3 + 1], P[u * 3 + 2]], ov = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  for (const w of [u, v]) for (const f of vf[w]) {
    if (!alive[f]) continue; const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    if ((a === u || b === u || c === u) && (a === v || b === v || c === v)) continue;   // схлопнется
    const l0 = faceNormal(f, n1); if (l0 < 1e-14) continue;
    const sx = [P[w * 3], P[w * 3 + 1], P[w * 3 + 2]]; P[w * 3] = nx; P[w * 3 + 1] = ny; P[w * 3 + 2] = nz;
    const l1 = faceNormal(f, n2); P[w * 3] = sx[0]; P[w * 3 + 1] = sx[1]; P[w * 3 + 2] = sx[2];
    if (l1 < 1e-12 || (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / (l0 * l1) < 0.25) { bad = true; break; }
  }
  if (bad) continue;
  P[u * 3] = nx; P[u * 3 + 1] = ny; P[u * 3 + 2] = nz;
  for (let t = 0; t < 10; t++) Q[u * 10 + t] += Q[v * 10 + t];
  vAlive[v] = 0; ver[u]++; ver[v]++;
  for (const f of vf[v]) {
    if (!alive[f]) continue;
    for (let t = 0; t < 3; t++) if (F[f * 3 + t] === v) F[f * 3 + t] = u;
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    if (a === b || b === c || a === c) { alive[f] = 0; faces--; } else vf[u].push(f);
  }
  vf[u] = vf[u].filter(f => alive[f]);
  for (const w of neighbors(u)) pushEdge(Math.min(u, w), Math.max(u, w));
}
// компактная выгрузка
const map = new Int32Array(nV).fill(-1); let nv = 0; const outP = [];
const outF = [];
for (let f = 0; f < nF; f++) if (alive[f]) { for (let t = 0; t < 3; t++) { const v = F[f * 3 + t]; if (map[v] < 0) { map[v] = nv++; outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } outF.push(map[v]); } }
fs.writeFileSync(vOut, Buffer.from(new Float32Array(outP).buffer)); fs.writeFileSync(fOut, Buffer.from(new Int32Array(outF).buffer));
console.log('вершин', nv, 'граней', outF.length / 3);

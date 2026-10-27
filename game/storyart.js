/* Сюжетные ролики: процедурные 2D-сцены на canvas (без файлов). Каждая сцена: { dur, cards:[[от, до, ключ, номер]], sfx:[[t, звук]], mood, draw(g, W, H, t, P) }.
   Текст карточек рисует story.js (DOM), здесь — только картинка и тайминг. */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const eo = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
function R(seed) { let a = (seed | 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function n1(x, s) { const i = Math.floor(x), f = x - i, h = (k) => { const v = Math.sin((k + s * 17.31) * 127.1) * 43758.5453; return v - Math.floor(v); }, u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; }
const hex = (c, a) => { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const shade = (c, k) => { const n = parseInt(c.slice(1), 16); let r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; } return `rgb(${r | 0},${g | 0},${b | 0})`; };

export const SHARD_COL = { forest: '#6cff9a', snow: '#aee8ff', mountain: '#ffd08a', desert: '#ffcf5a', swamp: '#8ae6c8', volcano: '#ff6a2a' };
export const LAND = ['forest', 'snow', 'mountain', 'desert', 'swamp', 'volcano'];
export const SEA = ['reef', 'kelp', 'arctic', 'vents', 'abyss'];
const BIO = {
  forest: { sky: ['#06140d', '#2b6a47'], hill: ['#134430', '#0b2a1d', '#071a12'], amb: 'leaf', ac: '#8fe38a' },
  snow: { sky: ['#0a1830', '#9cc4e0'], hill: ['#cfe3f0', '#9db9cf', '#6f8ca6'], amb: 'snow', ac: '#cfefff' },
  mountain: { sky: ['#16152a', '#9a86a6'], hill: ['#4d4358', '#352f40', '#1f1b29'], amb: 'dust', ac: '#ffd08a' },
  desert: { sky: ['#2a1508', '#f0a857'], hill: ['#c98a45', '#a86d34', '#7d4d24'], amb: 'sand', ac: '#ffe08a' },
  swamp: { sky: ['#07181a', '#4c7d66'], hill: ['#245546', '#173d33', '#0d2822'], amb: 'mist', ac: '#8ae6c8' },
  volcano: { sky: ['#190503', '#e0501c'], hill: ['#4a1a10', '#2c0f0a', '#170705'], amb: 'ember', ac: '#ff9a4a' },
  reef: { sky: ['#063647', '#3cc6cb'], amb: 'bubble', ac: '#7af0ff' },
  kelp: { sky: ['#032a26', '#3da35e'], amb: 'bubble', ac: '#7aff9a' },
  arctic: { sky: ['#05203a', '#8ad2f0'], amb: 'bubble', ac: '#cfefff' },
  vents: { sky: ['#12060a', '#b84c1c'], amb: 'bubble', ac: '#ff8a4a' },
  abyss: { sky: ['#010207', '#0d1634'], amb: 'bubble', ac: '#6a8aff' }
};
export const BIOMES = BIO;

// ------------------------------------------------------------------ кисти
function grad(g, W, H, top, bot, y0, y1) { const q = g.createLinearGradient(0, y0 || 0, 0, y1 == null ? H : y1); q.addColorStop(0, top); q.addColorStop(1, bot); g.fillStyle = q; g.fillRect(0, 0, W, H); }
function glow(g, x, y, r, col, a) { if (r <= 0 || a <= 0) return; const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, hex(col, a)); q.addColorStop(0.35, hex(col, a * 0.4)); q.addColorStop(1, hex(col, 0)); g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
function stars(g, W, H, t, seed, n, hMax, a) { const r = R(seed); for (let i = 0; i < n; i++) { const x = r() * W, y = r() * H * hMax, s = 0.6 + r() * 1.8 * (W / 1200 + 0.4), tw = 0.5 + 0.5 * Math.sin(t * (1 + r() * 2.2) + r() * 9); g.fillStyle = `rgba(255,255,255,${(a == null ? 1 : a) * (0.2 + 0.7 * tw * r())})`; g.fillRect(x, y, s, s); } }
function ridge(g, W, H, y0, amp, fr, seed, col, sc) { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W + 8; x += 8) { const nx = (x / W) * fr + (sc || 0); g.lineTo(x, y0 - amp * (n1(nx, seed) * 0.72 + n1(nx * 2.3, seed + 5) * 0.28)); } g.lineTo(W, H); g.closePath(); g.fill(); }
function hills(g, W, H, b, t, base) { const L = b.hill; ridge(g, W, H, H * (base || 0.62), H * 0.14, 3, 3, L[0], t * 0.01); ridge(g, W, H, H * ((base || 0.62) + 0.08), H * 0.12, 4, 8, L[1], t * 0.02); ridge(g, W, H, H * ((base || 0.62) + 0.17), H * 0.1, 5, 13, L[2], t * 0.035); }
function ambient(g, W, H, t, kind, seed, k) {
  const r = R(seed || 5), n = Math.round((kind === 'sand' ? 90 : 70) * (k || 1)); g.save();
  for (let i = 0; i < n; i++) {
    const sp = 0.2 + r() * 0.8, ph = r(), x0 = r(), s = (1 + r() * 2.2) * (W / 1200 + 0.5); let x, y;
    if (kind === 'snow') { y = ((ph + t * 0.06 * sp) % 1) * H; x = (x0 + Math.sin(t * 0.6 + i) * 0.02) * W; g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); }
    else if (kind === 'ember') { y = H - ((ph + t * 0.1 * sp) % 1) * H; x = (x0 + Math.sin(t * 1.3 + i) * 0.03) * W; g.fillStyle = `rgba(255,${140 + r() * 80 | 0},60,${0.4 + 0.5 * Math.sin(t * 5 + i) ** 2})`; g.beginPath(); g.arc(x, y, s * 0.9, 0, TAU); g.fill(); }
    else if (kind === 'bubble') { y = H - ((ph + t * 0.07 * sp) % 1) * H * 1.1; x = (x0 + Math.sin(t * 0.8 + i) * 0.015) * W; g.strokeStyle = `rgba(220,245,255,${0.2 + 0.3 * r()})`; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, s * 1.6, 0, TAU); g.stroke(); }
    else if (kind === 'sand') { x = ((x0 + t * 0.25 * sp) % 1) * W; y = (0.55 + ph * 0.45) * H; g.fillStyle = 'rgba(255,225,160,0.35)'; g.fillRect(x, y, s * 6, s * 0.7); }
    else if (kind === 'leaf') { y = ((ph + t * 0.035 * sp) % 1) * H; x = (x0 + Math.sin(t * 0.5 + i * 2) * 0.04) * W; g.fillStyle = 'rgba(160,230,120,0.55)'; g.save(); g.translate(x, y); g.rotate(t * sp + i); g.scale(1, 0.45); g.beginPath(); g.arc(0, 0, s * 1.8, 0, TAU); g.fill(); g.restore(); }
    else if (kind === 'mist') { x = ((x0 + t * 0.02 * sp) % 1) * W; y = (0.55 + ph * 0.4) * H; const q = g.createRadialGradient(x, y, 0, x, y, W * 0.18); q.addColorStop(0, 'rgba(180,230,210,0.06)'); q.addColorStop(1, 'rgba(180,230,210,0)'); g.fillStyle = q; g.fillRect(x - W * 0.18, y - W * 0.18, W * 0.36, W * 0.36); }
    else { y = ((ph + t * 0.02 * sp) % 1) * H; x = ((x0 + t * 0.04 * sp) % 1) * W; g.fillStyle = 'rgba(255,230,200,0.25)'; g.fillRect(x, y, s, s); }
  }
  g.restore();
}
function rays(g, x, y, len, n, t, col, a, w) { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < n; i++) { const an = t * 0.25 + i * TAU / n, ww = (w || 0.05) * (0.6 + 0.4 * Math.sin(t * 2 + i * 3)); const q = g.createLinearGradient(x, y, x + Math.cos(an) * len, y + Math.sin(an) * len); q.addColorStop(0, hex(col, a)); q.addColorStop(1, hex(col, 0)); g.fillStyle = q; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an - ww) * len, y + Math.sin(an - ww) * len); g.lineTo(x + Math.cos(an + ww) * len, y + Math.sin(an + ww) * len); g.closePath(); g.fill(); } g.restore(); }
// огранённый осколок; spin — поворот вокруг вертикальной оси
export function drawShard(g, x, y, s, spin, col, glowA, rot) {
  glow(g, x, y, s * 3.4, col, glowA == null ? 0.7 : glowA);
  const c = Math.cos(spin), sn = Math.sin(spin), hx = 0.3 + 0.7 * Math.abs(c), P = [[0, -1.35], [0.52, -0.5], [0.44, 0.75], [0, 1.15], [-0.44, 0.75], [-0.52, -0.5]];
  g.save(); g.translate(x, y); g.rotate(rot || 0); const px = (i) => P[i][0] * s * hx, py = (i) => P[i][1] * s;
  const mid = (a) => [Math.sin(spin * 0.5) * s * 0.18 * a, 0];
  g.beginPath(); g.moveTo(0, py(0)); g.lineTo(px(5), py(5)); g.lineTo(px(4), py(4)); g.lineTo(0, py(3)); g.lineTo(mid(1)[0], py(3) * 0.2); g.closePath(); g.fillStyle = shade(col, 0.18 + 0.3 * sn); g.fill();
  g.beginPath(); g.moveTo(0, py(0)); g.lineTo(px(1), py(1)); g.lineTo(px(2), py(2)); g.lineTo(0, py(3)); g.lineTo(mid(1)[0], py(3) * 0.2); g.closePath(); g.fillStyle = shade(col, -0.2 + 0.25 * sn); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = Math.max(1, s * 0.04); g.beginPath(); for (let i = 0; i < 6; i++) g.lineTo(px(i), py(i)); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(0, py(0)); g.lineTo(0, py(3)); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.stroke();
  g.globalCompositeOperation = 'lighter'; const q = g.createLinearGradient(-s * 0.5, -s, s * 0.5, s); q.addColorStop(0, 'rgba(255,255,255,0)'); q.addColorStop(0.5 + 0.3 * Math.sin(spin * 2), 'rgba(255,255,255,0.45)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.beginPath(); for (let i = 0; i < 6; i++) g.lineTo(px(i), py(i)); g.closePath(); g.fill();
  g.restore();
}
// Сердце Искры: огранённое сердце, бьётся
export function drawHeart(g, x, y, s, t, a) {
  const beat = 1 + 0.07 * Math.pow(Math.max(0, Math.sin(t * 5)), 6) + 0.04 * Math.pow(Math.max(0, Math.sin(t * 5 - 0.9)), 6);
  glow(g, x, y, s * 3.5 * beat, '#ff5a3a', 0.55 * (a == null ? 1 : a)); glow(g, x, y, s * 2.2 * beat, '#ffd37a', 0.45 * (a == null ? 1 : a));
  g.save(); g.translate(x, y); g.scale(beat * s, beat * s); g.globalAlpha = a == null ? 1 : a;
  const path = () => { g.beginPath(); g.moveTo(0, 0.95); g.bezierCurveTo(-1.5, 0.05, -1.25, -1.0, -0.5, -0.95); g.bezierCurveTo(-0.2, -0.93, 0, -0.7, 0, -0.5); g.bezierCurveTo(0, -0.7, 0.2, -0.93, 0.5, -0.95); g.bezierCurveTo(1.25, -1.0, 1.5, 0.05, 0, 0.95); g.closePath(); };
  path(); const q = g.createRadialGradient(-0.3, -0.4, 0.05, 0, 0, 1.4); q.addColorStop(0, '#fff2c8'); q.addColorStop(0.35, '#ff9a5a'); q.addColorStop(1, '#8a1a1a'); g.fillStyle = q; g.fill();
  g.save(); path(); g.clip(); const r = R(21); g.lineWidth = 0.025;
  for (let i = 0; i < 18; i++) { const x0 = r() * 3 - 1.5, y0 = r() * 2.2 - 1.1; g.strokeStyle = `rgba(255,${200 + r() * 55 | 0},160,${0.12 + 0.3 * r()})`; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (r() - 0.5) * 1.2, y0 + (r() - 0.5) * 1.2); g.lineTo(x0 + (r() - 0.5) * 1.4, y0 + (r() - 0.5) * 1.4); g.stroke(); }
  g.globalCompositeOperation = 'lighter'; const hl = g.createLinearGradient(-1, -1, 1, 1); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.4 + 0.2 * Math.sin(t * 1.3), 'rgba(255,255,255,0.4)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = hl; g.fillRect(-2, -2, 4, 4); g.restore();
  path(); g.strokeStyle = 'rgba(255,240,200,0.8)'; g.lineWidth = 0.04; g.stroke(); g.restore();
}
export function drawEgg(g, x, y, w, h, glowA, crack, t) {
  if (glowA > 0) glow(g, x, y, h * 2.2, '#ffe9a0', glowA);
  g.save(); g.translate(x, y); const path = () => { g.beginPath(); g.moveTo(0, -h / 2); g.bezierCurveTo(w * 0.62, -h / 2, w * 0.58, h * 0.1, w * 0.46, h * 0.28); g.bezierCurveTo(w * 0.34, h * 0.52, w * 0.16, h / 2, 0, h / 2); g.bezierCurveTo(-w * 0.16, h / 2, -w * 0.34, h * 0.52, -w * 0.46, h * 0.28); g.bezierCurveTo(-w * 0.58, h * 0.1, -w * 0.62, -h / 2, 0, -h / 2); g.closePath(); };
  path(); const q = g.createRadialGradient(-w * 0.18, -h * 0.2, w * 0.05, 0, 0, h * 0.7); q.addColorStop(0, '#fff3d8'); q.addColorStop(0.5, '#d9c29a'); q.addColorStop(1, '#7a6046'); g.fillStyle = q; g.fill();
  g.save(); path(); g.clip(); const r = R(8); for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(90,60,40,${0.1 + 0.2 * r()})`; g.beginPath(); g.arc((r() - 0.5) * w, (r() - 0.5) * h, w * (0.015 + 0.03 * r()), 0, TAU); g.fill(); }
  if (glowA > 0) { g.globalCompositeOperation = 'lighter'; const gl = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.6); gl.addColorStop(0, hex('#ffe9a0', glowA * 0.7)); gl.addColorStop(1, hex('#ffe9a0', 0)); g.fillStyle = gl; g.fillRect(-w, -h, w * 2, h * 2); g.globalCompositeOperation = 'source-over'; }
  if (crack > 0) { const rc = R(33); g.strokeStyle = 'rgba(40,28,18,0.9)'; g.lineWidth = Math.max(1, w * 0.012); g.beginPath(); for (let k = 0; k < 7; k++) { let cx = (rc() - 0.5) * w * 0.7, cy = -h * 0.1 + (rc() - 0.5) * h * 0.4; g.moveTo(cx, cy); for (let s = 0; s < Math.round(crack * 7); s++) { cx += (rc() - 0.5) * w * 0.16; cy += (rc() - 0.3) * h * 0.1; g.lineTo(cx, cy); } } g.stroke(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = hex('#fff0b0', 0.6 * crack); g.lineWidth = Math.max(1, w * 0.02); g.stroke(); }
  g.restore(); path(); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1.5; g.stroke(); g.restore();
}
function nestBack(g, x, y, w) { g.save(); g.translate(x, y); g.fillStyle = '#1a120b'; g.beginPath(); g.ellipse(0, 0, w * 0.62, w * 0.17, 0, 0, TAU); g.fill(); const r = R(4); for (let i = 0; i < 90; i++) { const a = r() * TAU, rr = (0.45 + r() * 0.2) * w, x0 = Math.cos(a) * rr, y0 = Math.sin(a) * rr * 0.27; if (Math.sin(a) > 0) continue; g.strokeStyle = `rgb(${60 + r() * 50 | 0},${40 + r() * 30 | 0},${22 + r() * 14 | 0})`; g.lineWidth = 2 + r() * 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (r() - 0.5) * w * 0.22, y0 + (r() - 0.5) * w * 0.05); g.stroke(); } g.restore(); }
function nestFront(g, x, y, w) { g.save(); g.translate(x, y); const r = R(6); for (let i = 0; i < 100; i++) { const a = r() * Math.PI, rr = (0.48 + r() * 0.17) * w, x0 = Math.cos(a) * rr, y0 = Math.sin(a) * rr * 0.27 + 2; g.strokeStyle = `rgb(${70 + r() * 60 | 0},${46 + r() * 36 | 0},${26 + r() * 16 | 0})`; g.lineWidth = 2.5 + r() * 3.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (r() - 0.5) * w * 0.26, y0 + (r() - 0.5) * w * 0.06); g.stroke(); } g.restore(); }
function fireflies(g, W, H, t, n, col, y0) { const r = R(77); for (let i = 0; i < n; i++) { const x = (r() + Math.sin(t * 0.3 + i) * 0.03) * W, y = (y0 + r() * (1 - y0) * 0.8 + Math.sin(t * 0.5 + i * 1.7) * 0.02) * H, a = 0.3 + 0.7 * Math.pow(Math.sin(t * 1.4 + i * 2.3) * 0.5 + 0.5, 3); glow(g, x, y, 12 + 6 * r(), col || '#d8ff8a', a * 0.8); } }
function nightSky(g, W, H, t, c0, c1) { grad(g, W, H, c0 || '#03060f', c1 || '#14233f', 0, H * 0.75); stars(g, W, H, t, 3, 140, 0.65); }
function moon(g, W, H, x, y, r) { glow(g, x, y, r * 4, '#cfe0ff', 0.25); g.fillStyle = '#eef3ff'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.fillStyle = 'rgba(160,175,210,0.35)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.1, r * 0.25, 0, TAU); g.arc(x + r * 0.35, y + r * 0.3, r * 0.18, 0, TAU); g.fill(); }
// гнездо с яйцом ночью: основа сцен «гнездо»
function nestScene(g, W, H, t, o) {
  nightSky(g, W, H, t, o.sky0, o.sky1); moon(g, W, H, W * 0.8, H * 0.18, Math.min(W, H) * 0.045);
  ridge(g, W, H, H * 0.62, H * 0.1, 3, 31, '#0b1b2a', 0); ridge(g, W, H, H * 0.7, H * 0.09, 4, 17, '#08141f', 1); ridge(g, W, H, H * 0.78, H * 0.05, 5, 4, '#050d14', 2);
  const nx = W / 2, ny = H * 0.8, nw = Math.min(W * 0.5, H * 0.9);
  if (o.sea) { const sy = H * 0.64; g.fillStyle = '#071a30'; g.fillRect(W * 0.55, sy, W * 0.45, H - sy); g.fillStyle = 'rgba(120,170,255,0.18)'; for (let i = 0; i < 30; i++) { const x = W * 0.55 + (i * 97 % 100) / 100 * W * 0.45, y = sy + 6 + (i * 53 % 100) / 100 * H * 0.12; g.fillRect(x, y + Math.sin(t * 1.4 + i) * 2, 20 + i % 5 * 8, 1.5); } }
  if (o.bloom) { const k = o.bloom; const r = R(99); for (let i = 0; i < 26; i++) { const a = r() * Math.PI + Math.PI, rr = (0.35 + r() * 1.1) * nw * 0.6, x = nx + Math.cos(a + Math.PI) * rr * (i % 2 ? 1 : -1) * 0.95, y = ny + (r() - 0.2) * H * 0.07, h = (14 + r() * 36) * (W / 1200 + 0.4) * k; const c = ['#7affc8', '#9aff7a', '#7ad8ff', '#d89aff'][i % 4]; g.strokeStyle = shade('#2c7a4a', -0.2); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 12, y - h * 0.5, x + (r() - 0.5) * 18, y - h); g.stroke(); glow(g, x + (r() - 0.5) * 6, y - h, 10 + 12 * k, c, 0.75 * k * (0.7 + 0.3 * Math.sin(t * 2 + i))); } }
  nestBack(g, nx, ny, nw);
  if (o.eggGlow != null) drawEgg(g, nx, ny - H * 0.08, nw * 0.16, nw * 0.2, o.eggGlow, o.crack || 0, t);
  return { nx, ny, nw, ex: nx, ey: ny - H * 0.08 };
}
function after(g, nx, ny, nw) { nestFront(g, nx, ny, nw); }

// ------------------------------------------------------------------ сцены
const landPos = (W, H, i) => ({ x: W * (0.12 + 0.152 * i), y: H * (0.7 + 0.04 * (i % 2)) });
export const SCENES = {
  // ПРОЛОГ ~40 с: метеорит, шесть осколков, ищущая дом Искра, яйцо, трещина
  prologue: {
    dur: 41, mood: 'story', cards: [[0.8, 7.6, 'pro', 0], [8.6, 16.6, 'pro', 1], [17.6, 24.2, 'pro', 2], [25.2, 33.2, 'pro', 3], [34, 40.2, 'pro', 4]],
    sfx: [[2.2, 'meteor'], [10.0, 'shard'], [18, 'spark'], [27, 'heartbeat'], [31.4, 'crack'], [32.4, 'crack'], [34.2, 'crack'], [36.5, 'evo'], [38.5, 'choir_hi']],
    draw(g, W, H, t) {
      const u = Math.min(W, H);
      if (t < 17) {
        nightSky(g, W, H, t, '#02040a', '#101c36');
        // метеорит летит по дуге и падает за горизонт
        const f = sm(2.0, 7.0, t), mx = lerp(-0.1 * W, 0.56 * W, f), my = lerp(-0.1 * H, 0.64 * H, f * f);
        if (t < 7.1) { for (let i = 0; i < 26; i++) { const k = i / 26, tx = mx - (mx + 0.1 * W) * 0.0 - k * W * 0.26 * f, ty = my - k * H * 0.55 * f * (0.4 + f); glow(g, tx, ty, u * 0.05 * (1 - k) + 4, i < 8 ? '#ffe9a0' : '#ff7a2a', 0.45 * (1 - k)); } glow(g, mx, my, u * 0.1, '#fff2c0', 0.9); g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(mx, my, u * 0.012, 0, TAU); g.fill(); }
        ridge(g, W, H, H * 0.66, H * 0.07, 3, 31, '#0a1624', 0); ridge(g, W, H, H * 0.74, H * 0.06, 4, 17, '#060f18', 1);
        if (t >= 7.0 && t < 9.5) { const k = (t - 7.0) / 2.5; g.fillStyle = `rgba(255,240,200,${0.95 * (1 - k)})`; g.fillRect(0, 0, W, H); glow(g, W * 0.56, H * 0.64, u * (0.2 + 0.9 * k), '#ffd37a', 0.8 * (1 - k)); }
        if (t >= 8.2) {   // шесть осколков разлетаются по дугам к шести краям
          for (let i = 0; i < 6; i++) { const p = landPos(W, H, i), f2 = eo((t - 8.2 - i * 0.12) / 3.4), sx = W * 0.56, sy = H * 0.64, x = lerp(sx, p.x, f2), y = lerp(sy, p.y, f2) - Math.sin(f2 * Math.PI) * H * 0.42; const col = SHARD_COL[LAND[i]]; if (f2 < 1) { for (let k = 0; k < 9; k++) { const ff = Math.max(0, f2 - k * 0.025), px = lerp(sx, p.x, ff), py = lerp(sy, p.y, ff) - Math.sin(ff * Math.PI) * H * 0.42; glow(g, px, py, u * 0.025, col, 0.35 * (1 - k / 9)); } } drawShard(g, x, y, u * 0.016 * (1 - 0.3 * f2), t * 3 + i, col, 0.7 * (1 - f2) + 0.1); if (f2 >= 1) { const pu = 0.5 + 0.5 * Math.sin(t * 2 + i), g2 = sm(11.6, 14.5, t); glow(g, p.x, p.y, u * (0.07 + 0.05 * pu) * (0.4 + g2), col, 0.5 + 0.3 * g2); rays(g, p.x, p.y, u * 0.2 * g2, 5, t * 0.5 + i, col, 0.25 * g2, 0.05); } }
        }
      } else if (t < 25) {
        nightSky(g, W, H, t, '#02040a', '#0d1830'); ridge(g, W, H, H * 0.62, H * 0.08, 3, 7, '#0a1a22', 0.2); ridge(g, W, H, H * 0.72, H * 0.08, 4, 9, '#06121a', 0.8); ridge(g, W, H, H * 0.82, H * 0.06, 5, 2, '#030a10', 1.4);
        const k = (t - 17) / 7, x = W * (0.1 + 0.8 * (0.5 + 0.5 * Math.sin(k * 2.6 - 1.2))) + Math.sin(t * 3) * 8, y = H * (0.38 + 0.12 * Math.sin(k * 5 + 1)) + Math.cos(t * 2.3) * 10, fade = sm(17, 18.4, t);
        for (let i = 0; i < 18; i++) { const kk = i / 18, tx = x - (Math.cos(k * 2.6 - 1.2) * W * 0.3) * kk * 0.12, ty = y + Math.sin(kk * 4) * 6; glow(g, tx, ty, u * 0.025 * (1 - kk), '#ffe9a0', 0.25 * (1 - kk) * fade); }
        glow(g, x, y, u * 0.1, '#ffe3a0', 0.8 * fade * (0.8 + 0.2 * Math.sin(t * 6))); glow(g, x, y, u * 0.03, '#ffffff', 0.9 * fade);
        for (let i = 0; i < 6; i++) { const p = landPos(W, H, i), a = 0.15 + 0.12 * Math.sin(t * 2 + i); glow(g, p.x, p.y + 6, u * 0.08, SHARD_COL[LAND[i]], a); }
      } else {
        const zoom = sm(24.6, 28.5, t), eg = sm(25.5, 29, t), cr = sm(31, 35.5, t);
        const o = nestScene(g, W, H, t, { sky0: '#02050c', sky1: '#10203a', eggGlow: 0.18 + 0.5 * eg + 0.25 * Math.pow(Math.max(0, Math.sin(t * 4)), 6) * eg, crack: cr });
        fireflies(g, W, H, t, 18, '#d8ff8a', 0.45); after(g, o.nx, o.ny, o.nw);
        if (t > 31.2) { glow(g, o.ex, o.ey, u * (0.2 + 0.7 * sm(34, 38, t)), '#fff0b8', 0.4 + 0.5 * sm(34.5, 38, t)); }
        if (t > 36.5) { g.fillStyle = `rgba(255,248,225,${clamp((t - 36.5) / 3.4, 0, 1)})`; g.fillRect(0, 0, W, H); }
        g.fillStyle = `rgba(0,0,0,${0.9 * (1 - zoom)})`; g.fillRect(0, 0, W, H);
      }
      if (t < 1.4) { g.fillStyle = `rgba(0,0,0,${1 - t / 1.4})`; g.fillRect(0, 0, W, H); }
    }
  },
  // ОСКОЛОК: n из 6 (P.biome, P.n)
  shard: {
    dur: 8.4, mood: 'story', cards: [[3.0, 8.2, 'shard', 0]], sfx: [[0.4, 'shard'], [4.6, 'spark']],
    draw(g, W, H, t, P) {
      const b = BIO[P.biome] || BIO.forest, col = SHARD_COL[P.biome] || '#fff', u = Math.min(W, H);
      grad(g, W, H, b.sky[0], b.sky[1], 0, H * 0.8); if (P.biome !== 'desert' && P.biome !== 'volcano') stars(g, W, H, t, 5, 60, 0.4, 0.6);
      hills(g, W, H, b, t, 0.6); ambient(g, W, H, t, b.amb, 7);
      const rise = eo((t - 0.4) / 2.6), cx = W / 2, gy = H * 0.66, cy = lerp(gy, H * 0.4, rise), fly = sm(4.6, 6.0, t);
      glow(g, cx, gy, u * 0.5 * Math.min(1, t / 1.2), col, 0.5); rays(g, cx, cy, u * 0.8, 14, t, col, 0.18 * rise * (1 - fly), 0.05);
      const slots = []; for (let i = 0; i < 6; i++) slots.push({ x: W / 2 + (i - 2.5) * Math.min(W * 0.1, u * 0.14), y: H * 0.9 });
      for (let i = 0; i < 6; i++) { const s = slots[i], c = SHARD_COL[LAND[i]], lit = i < P.n - 1 || (i === P.n - 1 && fly >= 1); if (lit) glow(g, s.x, s.y, u * 0.055, c, 0.55); g.save(); g.globalAlpha = lit ? 1 : 0.28; drawShard(g, s.x, s.y, u * 0.024, lit ? t * 1.2 + i : 0.6, lit ? c : '#8896a8', lit ? 0.3 : 0); g.restore(); }
      if (fly < 1) { const s = slots[P.n - 1] || slots[5], x = lerp(cx, s.x, fly), y = lerp(cy, s.y, fly * fly * (3 - 2 * fly)) - Math.sin(fly * Math.PI) * H * 0.08, sz = lerp(u * 0.07, u * 0.024, fly); for (let k = 0; k < 8; k++) glow(g, lerp(cx, s.x, Math.max(0, fly - k * 0.03)), lerp(cy, s.y, Math.max(0, fly - k * 0.03)), u * 0.03, col, 0.25 * (1 - k / 8) * (fly > 0 ? 1 : 0)); drawShard(g, x, y, sz, t * 2.2, col, 0.85); }
      else { const pu = Math.max(0, 1 - (t - 6.0) / 1.2); glow(g, slots[P.n - 1].x, slots[P.n - 1].y, u * 0.12 * pu, '#ffffff', 0.7 * pu); }
      g.fillStyle = `rgba(0,0,0,${1 - sm(0, 0.8, t)})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(0,0,0,${sm(7.6, 8.4, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // ЗОВ МОРЯ: шесть осколков в гнезде, свет тянется к морю
  seacall: {
    dur: 15, mood: 'story', cards: [[0.8, 6.6, 'sea', 0], [7.6, 14.4, 'sea', 1]], sfx: [[1.0, 'spark'], [8.0, 'heartbeat'], [10.5, 'choir_lo']],
    draw(g, W, H, t) {
      const u = Math.min(W, H), o = nestScene(g, W, H, t, { sky0: '#02050c', sky1: '#10223c', eggGlow: 0.1, sea: 1 });
      const sy = H * 0.64;
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.32 + t * 0.35, rr = o.nw * 0.26 * (0.6 + 0.4 * sm(0.5, 3, t)), x = o.nx + Math.cos(a) * rr, y = o.ey - u * 0.05 + Math.sin(a) * rr * 0.4 - u * 0.04 * sm(0.5, 3, t) + Math.sin(t * 1.5 + i) * 4; drawShard(g, x, y, u * 0.022, t * 1.4 + i, SHARD_COL[LAND[i]], 0.4 + 0.3 * Math.sin(t * 2 + i) * sm(0, 3, t)); }
      const k = sm(5.5, 9.5, t);
      if (k > 0) { g.save(); g.globalCompositeOperation = 'lighter'; const x1 = W * 0.85, y1 = sy + H * 0.05; for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.32 + t * 0.35, x0 = o.nx + Math.cos(a) * o.nw * 0.26, y0 = o.ey - u * 0.09 + Math.sin(a) * o.nw * 0.1; const q = g.createLinearGradient(x0, y0, lerp(x0, x1, k), lerp(y0, y1, k)); q.addColorStop(0, hex(SHARD_COL[LAND[i]], 0.5)); q.addColorStop(1, hex(SHARD_COL[LAND[i]], 0)); g.strokeStyle = q; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - H * 0.12, lerp(x0, x1, k), lerp(y0, y1, k)); g.stroke(); } g.restore(); glow(g, x1, y1, u * 0.2 * k, '#9ad8ff', 0.4 * k * (0.8 + 0.2 * Math.sin(t * 3))); }
      fireflies(g, W, H, t, 10, '#d8ff8a', 0.5); after(g, o.nx, o.ny, o.nw);
      g.fillStyle = `rgba(0,0,0,${1 - sm(0, 1.0, t)})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(0,0,0,${sm(14, 15, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // ПОГРУЖЕНИЕ: впервые в океан
  dive: {
    dur: 12, mood: 'story', cards: [[1.2, 11, 'dive', 0]], sfx: [[0.4, 'splash_big'], [5.5, 'heartbeat'], [8, 'choir_lo']],
    draw(g, W, H, t) {
      const u = Math.min(W, H), d = sm(0.4, 9, t);
      const c0 = [lerp(70, 1, d), lerp(190, 6, d), lerp(210, 20, d)], c1 = [lerp(20, 3, d), lerp(120, 12, d), lerp(170, 40, d)];
      grad(g, W, H, `rgb(${c0.map(v => v | 0)})`, `rgb(${c1.map(v => v | 0)})`);
      glow(g, W * 0.5, -H * 0.1, u * 1.2, '#cff6ff', 0.55 * (1 - d)); rays(g, W * 0.5, -H * 0.1, H * 1.4, 9, t * 0.3, '#e8ffff', 0.1 * (1 - d * 0.8), 0.04);
      const wl = H * (0.14 - 0.6 * sm(0, 2.4, t)); if (wl > -H * 0.2) { g.fillStyle = 'rgba(230,255,255,0.5)'; g.beginPath(); g.moveTo(0, wl); for (let x = 0; x <= W; x += 10) g.lineTo(x, wl + Math.sin(x * 0.02 + t * 2) * 4); g.lineTo(W, wl - 30); g.lineTo(0, wl - 30); g.fill(); }
      ambient(g, W, H, t, 'bubble', 4, 1.2);
      // стражи — тёмные силуэты на разных глубинах; Сердце — внизу, мерцает
      const pass = sm(2, 9, t); for (let i = 0; i < 5; i++) { const y = H * (0.3 + 0.13 * i) - pass * H * 0.1, x = W * (0.2 + 0.15 * i + 0.03 * Math.sin(t * 0.4 + i)), s = u * (0.07 + 0.015 * i); g.fillStyle = `rgba(0,10,20,${0.25 + 0.2 * pass})`; g.beginPath(); g.ellipse(x, y, s * 2.2, s * 0.7, Math.sin(t * 0.3 + i) * 0.1, 0, TAU); g.fill(); g.beginPath(); g.moveTo(x - s * 2, y); g.lineTo(x - s * 3.4, y - s * 0.7); g.lineTo(x - s * 3.2, y + s * 0.7); g.fill(); glow(g, x + s * 1.4, y - s * 0.1, s * 0.4, '#ff9a4a', 0.35 * pass); }
      const hy = lerp(H * 1.0, H * 0.78, sm(4, 9, t)); glow(g, W / 2, hy, u * 0.5, '#ff6a3a', 0.35 * sm(3, 8, t) * (0.7 + 0.3 * Math.sin(t * 5))); drawHeart(g, W / 2, hy, u * 0.03 + u * 0.03 * sm(5, 9, t), t, sm(4, 8, t) * 0.8);
      g.fillStyle = `rgba(0,0,0,${1 - sm(0, 0.6, t)})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(0,0,0,${sm(11, 12, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // СТРАЖ ПОВЕРЖЕН: n из 5 (P.biome, P.n)
  guard: {
    dur: 7.4, mood: 'story', cards: [[2.2, 7.0, 'guard', 0]], sfx: [[0.4, 'shard'], [3.5, 'bubble']],
    draw(g, W, H, t, P) {
      const b = BIO[P.biome] || BIO.reef, u = Math.min(W, H), col = b.ac;
      grad(g, W, H, b.sky[1], b.sky[0]); rays(g, W * 0.5, -H * 0.15, H * 1.5, 8, t * 0.25, '#e8ffff', 0.07, 0.04); ambient(g, W, H, t, 'bubble', 9, 1.1);
      const rise = eo((t - 0.3) / 2.2), cx = W / 2, cy = lerp(H * 0.7, H * 0.4, rise);
      glow(g, cx, cy, u * 0.5 * rise, col, 0.5); rays(g, cx, cy, u * 0.7, 10, t, col, 0.16 * rise, 0.05);
      // жемчужина-печать стража
      g.save(); g.translate(cx, cy); const s = u * 0.07; const q = g.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s * 1.2); q.addColorStop(0, '#ffffff'); q.addColorStop(0.5, col); q.addColorStop(1, shade(col, -0.6)); g.fillStyle = q; g.beginPath(); g.arc(0, 0, s, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.stroke(); g.restore();
      for (let i = 0; i < 5; i++) { const x = W / 2 + (i - 2) * Math.min(W * 0.1, u * 0.12), y = H * 0.9, lit = i < P.n - 1 || (i === P.n - 1 && t > 3.2); if (lit) glow(g, x, y, u * 0.04, col, 0.6 * (i === P.n - 1 ? 0.6 + 0.4 * Math.sin(t * 4) : 1)); g.fillStyle = lit ? col : 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(x, y, u * 0.014, 0, TAU); g.fill(); }
      g.fillStyle = `rgba(0,0,0,${1 - sm(0, 0.6, t)})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(0,0,0,${sm(6.6, 7.4, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // СЕРДЦЕ ПОДНИМАЕТСЯ ИЗ БЕЗДНЫ и летит к гнезду
  heart: {
    dur: 18, mood: 'story', cards: [[0.8, 8.4, 'heart', 0], [11.2, 17.2, 'heart', 1]], sfx: [[0.6, 'heartbeat'], [3.2, 'heartbeat'], [6.2, 'spark'], [9.6, 'splash_big'], [12, 'choir_hi']],
    draw(g, W, H, t) {
      const u = Math.min(W, H);
      if (t < 9.8) {
        grad(g, W, H, '#010206', '#07102a'); const k = sm(0, 9, t), hy = lerp(H * 1.15, H * 0.34, k * k * (3 - 2 * k)); rays(g, W / 2, hy, H * 1.6, 12, t * 0.3, '#ff9a5a', 0.09 * k, 0.04);
        ambient(g, W, H, t, 'bubble', 12, 1.0); glow(g, W / 2, hy, u * 0.9, '#ff5a3a', 0.28 + 0.12 * Math.sin(t * 5)); drawHeart(g, W / 2, hy, u * 0.14, t, 1);
        if (t > 8.6) { g.fillStyle = `rgba(255,250,235,${clamp((t - 8.6) / 1.2, 0, 1)})`; g.fillRect(0, 0, W, H); }
      } else {
        nightSky(g, W, H, t, '#02040a', '#101c38'); moon(g, W, H, W * 0.15, H * 0.17, u * 0.04); g.fillStyle = '#071a30'; g.fillRect(0, H * 0.7, W, H * 0.3);
        ridge(g, W, H, H * 0.7, H * 0.08, 3, 5, '#0a1a22', 0.5); const f = sm(10.2, 17.2, t), x = lerp(W * 0.06, W * 0.82, f), y = H * 0.82 - Math.sin(f * Math.PI) * H * 0.5 - f * H * 0.02;
        for (let i = 0; i < 20; i++) { const kk = i / 20, ff = Math.max(0, f - kk * 0.045), px = lerp(W * 0.06, W * 0.82, ff), py = H * 0.82 - Math.sin(ff * Math.PI) * H * 0.5 - ff * H * 0.02; glow(g, px, py, u * 0.05 * (1 - kk), '#ff8a4a', 0.4 * (1 - kk)); }
        drawHeart(g, x, y, u * 0.04, t, 1); nestBack(g, W * 0.86, H * 0.86, u * 0.3); nestFront(g, W * 0.86, H * 0.86, u * 0.3); glow(g, W * 0.86, H * 0.82, u * 0.2 * sm(14, 17, t), '#ffe3a0', 0.5 * sm(14, 17, t));
        g.fillStyle = `rgba(255,250,235,${1 - clamp((t - 9.8) / 1.0, 0, 1)})`; g.fillRect(0, 0, W, H);
      }
      g.fillStyle = `rgba(0,0,0,${1 - sm(0, 0.6, t)})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(0,0,0,${sm(17.2, 18, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // ФИНАЛ: осколки и Сердце ложатся рядом с яйцом; затем выбор (P.hold — ждём выбор, сцена зацикливает сияние)
  finale: {
    dur: 22, hold: true, mood: 'finale', cards: [[1.0, 9.6, 'fin', 0], [10.6, 18.6, 'fin', 1]], sfx: [[1.0, 'choir_hi'], [4.5, 'shard'], [8.2, 'spark'], [12.5, 'heartbeat']],
    draw(g, W, H, t) {
      const u = Math.min(W, H), k = sm(1, 8.5, t), glowK = sm(6, 16, t), hold = Math.max(0, t - 18);
      const o = nestScene(g, W, H, t, { sky0: '#02050c', sky1: '#122440', eggGlow: 0.15 + 0.55 * glowK });
      for (let i = 0; i < 6; i++) { const a = Math.PI * (0.08 + 0.84 * i / 5) + Math.PI, tx = o.nx + Math.cos(a) * o.nw * 0.3, ty = o.ey + o.nw * 0.08 + Math.sin(a) * o.nw * 0.06, fx = W * (0.1 + 0.16 * i), fy = -H * 0.1, e = eo(clamp((t - 1 - i * 0.5) / 4.5, 0, 1)); drawShard(g, lerp(fx, tx, e), lerp(fy, ty, e), u * 0.02, t * 1.5 + i, SHARD_COL[LAND[i]], 0.5 + 0.4 * glowK); }
      const he = eo(clamp((t - 4) / 5, 0, 1)); drawHeart(g, lerp(W * 0.5, o.ex, he), lerp(-H * 0.2, o.ey - o.nw * 0.2, he), u * (0.03 + 0.01 * (1 - he)), t, 1);
      rays(g, o.ex, o.ey, u * 1.0, 16, t * 0.5, '#fff0c0', 0.12 * glowK, 0.04); fireflies(g, W, H, t, 16, '#fff0a0', 0.4); after(g, o.nx, o.ny, o.nw);
      if (hold) glow(g, o.ex, o.ey, u * (0.35 + 0.05 * Math.sin(t * 2)), '#ffe9a0', 0.18);
      g.fillStyle = `rgba(0,0,0,${1 - sm(0, 1, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // КОНЦОВКА «ВЛАДЫКА ЭПОХ»
  end_lord: {
    dur: 14, mood: 'finale', cards: [[2.6, 13.4, 'lord', 0]], sfx: [[0.5, 'boss'], [2.0, 'king'], [5.5, 'shard']],
    draw(g, W, H, t) {
      const u = Math.min(W, H), dim = sm(2, 8, t);
      const o = nestScene(g, W, H, t, { sky0: '#0a0803', sky1: '#3a2a10', eggGlow: 0.5 * (1 - dim) });
      glow(g, o.ex, o.ey - o.nw * 0.3, u * 0.8 * sm(1, 5, t), '#ffd35a', 0.35);
      const crown = sm(1.5, 6.5, t); for (let i = 0; i < 6; i++) { const a = Math.PI * (1.05 + 0.9 * i / 5), rr = o.nw * 0.2, x = o.ex + Math.cos(a + Math.PI) * rr * 1.0, y = o.ey - o.nw * 0.34 - Math.abs(Math.sin(a)) * o.nw * 0.03 - crown * o.nw * 0.05 + Math.sin(t * 2 + i) * 3, sx = lerp(W * (0.1 + 0.16 * i), x, eo(crown)), sy = lerp(-H * 0.1, y, eo(crown)); drawShard(g, sx, sy, u * 0.028, t * 1.2 + i, SHARD_COL[LAND[i]], 0.6); }
      ambient(g, W, H, t, 'ember', 3, 0.8); rays(g, o.ex, o.ey - o.nw * 0.3, u * 1.1, 14, t * 0.4, '#ffd35a', 0.14 * crown, 0.04); after(g, o.nx, o.ny, o.nw);
      g.fillStyle = `rgba(255,236,170,${0.9 * (1 - sm(1.6, 3.0, t)) * sm(1.4, 1.6, t)})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(0,0,0,${1 - sm(0, 1, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  // КОНЦОВКА «ХРАНИТЕЛЬ ИСКРЫ»
  end_keeper: {
    dur: 14, mood: 'finale', cards: [[2.6, 13.4, 'keeper', 0]], sfx: [[0.5, 'choir_hi'], [2.0, 'level'], [5.5, 'spark']],
    draw(g, W, H, t) {
      const u = Math.min(W, H), bl = sm(3, 11, t);
      const o = nestScene(g, W, H, t, { sky0: '#02060d', sky1: '#10305a', eggGlow: 0.4 + 0.4 * bl, bloom: bl });
      for (let i = 0; i < 6; i++) { const a = Math.PI * (1.05 + 0.9 * i / 5) + Math.PI, x = o.nx + Math.cos(a) * o.nw * 0.32, y = o.ny + Math.sin(a) * o.nw * 0.05 - 2 - (1 - eo(clamp((t - 0.5 - i * 0.3) / 3, 0, 1))) * H * 0.4; drawShard(g, x, y, u * 0.016, t + i, SHARD_COL[LAND[i]], 0.4); }
      glow(g, o.ex, o.ey, u * (0.5 + 0.2 * bl), '#aef0ff', 0.2 * bl); fireflies(g, W, H, t, 30, '#aef0ff', 0.3); fireflies(g, W, H, t + 3, 18, '#b8ff9a', 0.4);
      // северное сияние
      g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 3; i++) { const q = g.createLinearGradient(0, H * 0.05, 0, H * 0.5); q.addColorStop(0, hex(['#7affc8', '#7ab8ff', '#d89aff'][i], 0)); q.addColorStop(0.5, hex(['#7affc8', '#7ab8ff', '#d89aff'][i], 0.13 * bl)); q.addColorStop(1, hex('#ffffff', 0)); g.fillStyle = q; g.beginPath(); g.moveTo(0, H * 0.3); for (let x = 0; x <= W; x += 20) g.lineTo(x, H * (0.18 + 0.07 * i) + Math.sin(x * 0.006 + t * 0.5 + i * 2) * H * 0.05); g.lineTo(W, H * 0.5); g.lineTo(0, H * 0.5); g.fill(); } g.restore();
      after(g, o.nx, o.ny, o.nw); g.fillStyle = `rgba(0,0,0,${1 - sm(0, 1, t)})`; g.fillRect(0, 0, W, H);
    }
  },
  last: {
    dur: 8, mood: 'finale', cards: [[1.2, 7.4, 'last', 0]], sfx: [[1.2, 'spark']],
    draw(g, W, H, t) { g.fillStyle = '#020307'; g.fillRect(0, 0, W, H); stars(g, W, H, t, 3, 90, 1, 0.7); const u = Math.min(W, H); glow(g, W / 2, H * 0.36, u * 0.12 * (0.8 + 0.2 * Math.sin(t * 2)), '#ffe3a0', 0.6 * sm(0.5, 2.5, t)); g.fillStyle = `rgba(0,0,0,${sm(7.2, 8, t)})`; g.fillRect(0, 0, W, H); }
  }
};

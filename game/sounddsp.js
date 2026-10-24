/* Синтез звуков «с нуля» (без файлов): физические модели вместо простых осцилляторов.
   Голос — источник гортани + формантные резонаторы; шаги/удары/укусы — удар + шум с резонансами; окружение — фильтрованный шум.
   Все функции чистые и возвращают Float32Array (моно, SR Гц) — их можно проверить вне браузера. */
export const SR = 32000;
const TAU = Math.PI * 2;

export function rng(seed) { let a = (seed | 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- биквадратный фильтр с плавной сменой частоты
class Bq {
  constructor(type, f, q) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q || 0.707); }
  set(f, q) {
    f = Math.max(20, Math.min(f, SR * 0.46)); q = q || this.q || 0.707; this.q = q;
    const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q); let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }                       // bp: пик 0 дБ
    const a0 = 1 + a; this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
  }
  p(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mk = (dur) => new Float32Array(Math.max(1, Math.round(dur * SR)));
function norm(b, peak) {
  let m = 1e-9; for (let i = 0; i < b.length; i++) { if (!isFinite(b[i])) b[i] = 0; const a = Math.abs(b[i]); if (a > m) m = a; }
  const k = (peak || 0.9) / m; for (let i = 0; i < b.length; i++) b[i] *= k; return b;
}
function fade(b, a, r) { const na = Math.round(a * SR), nr = Math.round(r * SR); for (let i = 0; i < na && i < b.length; i++) b[i] *= i / na; for (let i = 0; i < nr && i < b.length; i++) b[b.length - 1 - i] *= i / nr; return b; }
function mix(dst, src, t0, g) { const o = Math.round((t0 || 0) * SR); for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * (g == null ? 1 : g); return dst; }
// сглаженный случайный сигнал (значения -1..1, частота изменения ~hz)
function smoothNoise(r, hz) { let a = r() * 2 - 1, b = r() * 2 - 1, ph = 0; return (dt) => { ph += dt * hz; if (ph >= 1) { ph -= 1; a = b; b = r() * 2 - 1; } const t = ph * ph * (3 - 2 * ph); return a + (b - a) * t; }; }
// шумовой удар: огибающая exp, фильтр с частотой от f0 к f1
function nburst(r, dur, f0, f1, type, q, decay, att) {
  const b = mk(dur), f = new Bq(type || 'bp', f0, q || 1); decay = decay || 5; att = att || 0.002;
  for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / dur; if ((i & 15) === 0) f.set(f0 * Math.pow(f1 / f0, p), q || 1); b[i] = f.p(r() * 2 - 1) * Math.exp(-t * decay / dur * 3) * Math.min(1, t / att); }
  return b;
}
// синус с падающей частотой (бочка, удар)
function thump(dur, f0, f1, decay, drive) {
  const b = mk(dur); let ph = 0;
  for (let i = 0; i < b.length; i++) { const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t * 22); ph += TAU * f / SR; const e = Math.exp(-t * decay) * Math.min(1, t / 0.003); b[i] = Math.tanh(Math.sin(ph) * (drive || 1.4)) * e; }
  return b;
}
// короткий акустический «отклик помещения» для гулкости удара: несколько затухающих отражений
function comb(b, delays, gain) { const o = new Float32Array(b.length); o.set(b); for (const d of delays) { const n = Math.round(d * SR); for (let i = n; i < b.length; i++) o[i] += b[i - n] * gain * Math.exp(-d * 4); } return o; }

// ================================================================== ГОЛОС
/* Источник: импульсы гортани с дрожанием и «скрипом» (субгармоника, AM 25–45 Гц) + дыхание. Дальше — параллельные форманты.
   o: dur, f0 (начальная), f1 (конечная), peak (доля длины с максимумом высоты), form (множитель формант: меньше = крупнее), growl 0..1,
   breath 0..1, drive (искажение), att, rel, open (насколько раскрывается пасть), seed */
export function voice(o) {
  const dur = o.dur || 1.2, r = rng(o.seed || 7), b = mk(dur), form = o.form || 1, growl = o.growl == null ? 0.5 : o.growl, breath = o.breath == null ? 0.2 : o.breath;
  const f0 = o.f0 || 110, f1 = o.f1 || f0 * 0.6, pk = o.peak == null ? 0.3 : o.peak, att = o.att || 0.07, rel = o.rel || Math.min(0.5, dur * 0.4), drive = o.drive || 2.2, open = o.open == null ? 1 : o.open;
  const F = [new Bq('bp', 500, 4), new Bq('bp', 1100, 6), new Bq('bp', 2400, 8), new Bq('bp', 3600, 9)], FG = [1, 0.7, 0.35, 0.18];
  const jit = smoothNoise(r, 38), jit2 = smoothNoise(r, 9), nf = new Bq('hp', 500, 0.7), tilt = new Bq('lp', 3200 * Math.min(1.6, 1 / Math.sqrt(form)), 0.7);
  let ph = 0, ph2 = 0, gph = r() * 6, last = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR, p = t / dur, dt = 1 / SR;
    // огибающая высоты: быстрый подъём до пика и спад
    const cur = p < pk ? lerp(f0 * 0.82, f0, sm(0, pk, p)) : lerp(f0, f1, sm(pk, 1, p));
    const f = cur * (1 + 0.025 * jit(dt) + 0.012 * jit2(dt) + (o.vib ? o.vib * Math.sin(TAU * (o.vibHz || 5.5) * t) : 0));
    ph += f / SR; if (ph >= 1) ph -= 1;
    ph2 += f * 0.5 / SR; if (ph2 >= 1) ph2 -= 1;
    // импульс гортани: плавное открытие, резкое закрытие (богатые гармоники)
    const g1 = ph < 0.62 ? Math.pow(Math.sin(Math.PI * ph / 0.62), 2) - 0.2 : -0.2 * (1 - (ph - 0.62) / 0.38);
    const g2 = ph2 < 0.5 ? Math.sin(Math.PI * ph2 / 0.5) : 0;
    gph += TAU * (28 + 14 * jit2(dt)) * dt;
    const am = 1 - growl * (0.5 + 0.5 * Math.sin(gph)) * (0.7 + 0.3 * jit(dt));      // «скрип/рычание»
    let src = (g1 + growl * 0.55 * g2) * am;
    src = tilt.p(src);
    const nz = nf.p(r() * 2 - 1) * breath * (0.35 + 0.65 * sm(0.4, 1, p));              // дыхание сильнее к концу
    // раскрытие пасти: форманты едут вверх к пику и вниз
    const op = (p < pk ? sm(0, pk, p) : 1 - 0.6 * sm(pk, 1, p)) * open;
    if ((i & 31) === 0) {
      F[0].set((380 + 380 * op) * form, 4 + growl * 2); F[1].set((850 + 520 * op) * form, 6); F[2].set((2200 + 420 * op) * form, 8); F[3].set((3400 + 300 * op) * form, 9);
    }
    const x = src * 0.9 + nz;
    let y = 0; for (let k = 0; k < 4; k++) y += F[k].p(x) * FG[k];
    y = Math.tanh((y * 3.2 + x * 0.2) * drive * 0.6);
    const e = Math.min(1, t / att) * (t > dur - rel ? Math.pow((dur - t) / rel, 1.5) : 1) * (0.75 + 0.25 * Math.min(1, p / pk + 0.001) ) ;
    b[i] = y * e; last = y;
  }
  return norm(b, o.peakLevel || 0.9);
}
// пронзительный крик (птерозавры, орёл, визг)
export function screech(o) {
  const dur = o.dur || 0.7, r = rng(o.seed || 3), b = mk(dur), f0 = o.f0 || 1500, f1 = o.f1 || 3000, jit = smoothNoise(r, 70);
  const bp = [new Bq('bp', 2200, 5), new Bq('bp', 4200, 6)]; let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR, p = t / dur, dt = 1 / SR, f = (p < 0.25 ? lerp(f0 * 0.8, f0, p / 0.25) : lerp(f0, f1, sm(0.25, 1, p))) * (1 + 0.04 * jit(dt) + 0.03 * Math.sin(TAU * 38 * t));
    ph += f / SR; if (ph >= 1) ph -= 1;
    const s = (2 * ph - 1) * 0.6 + (r() * 2 - 1) * 0.3;
    if ((i & 31) === 0) { bp[0].set(f * 1.3, 5); bp[1].set(f * 2.3, 6); }
    const y = Math.tanh((bp[0].p(s) + bp[1].p(s) * 0.7) * 2.5);
    b[i] = y * Math.min(1, t / 0.03) * Math.pow(1 - p, 0.7);
  }
  return norm(b, 0.85);
}
// низкий плавный зов в воде / кит
export function whale(o) {
  const dur = o.dur || 3, r = rng(o.seed || 5), b = mk(dur), f0 = o.f0 || 70, f1 = o.f1 || 140, jit = smoothNoise(r, 3), bp = new Bq('bp', 300, 3);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR, p = t / dur, dt = 1 / SR, f = lerp(f0, f1, sm(0, 1, p) * (0.5 + 0.5 * Math.sin(p * 4))) * (1 + 0.01 * jit(dt));
    ph += TAU * f / SR; ph2 += TAU * f * 2.01 / SR;
    const s = Math.sin(ph) + 0.5 * Math.sin(ph2 + Math.sin(ph * 0.5)) + 0.25 * Math.sin(ph * 3.02);
    if ((i & 63) === 0) bp.set(f * 3 + 200 * Math.sin(p * 9), 2);
    b[i] = (s * 0.6 + bp.p(s) * 0.8) * Math.sin(Math.PI * p) ** 0.7;
  }
  return norm(b, 0.85);
}

// ================================================================== УДАРЫ И ДВИЖЕНИЕ
export function footstep(surf, mass, seed) {          // surf: dirt|grass|sand|snow|rock|mud|water; mass 0.2..3
  const r = rng(seed || 1), dur = 0.1 + 0.18 * Math.min(1.5, mass), b = mk(dur);
  const low = 70 / Math.pow(Math.max(0.3, mass), 0.45), body = thump(dur, low * 1.7, low * 0.8, 24 / (0.6 + mass * 0.4), 1.2);
  mix(b, body, 0, 0.85 * Math.min(1.2, 0.4 + mass * 0.5));
  if (surf === 'sand') mix(b, nburst(r, dur, 1800, 600, 'bp', 0.7, 6, 0.01), 0, 0.5);
  else if (surf === 'snow') { mix(b, nburst(r, dur * 0.9, 3600, 1400, 'bp', 0.9, 5, 0.006), 0.01, 0.55); for (let k = 0; k < 6; k++) mix(b, nburst(r, 0.012, 4000 + r() * 3000, 2000, 'bp', 3, 3), 0.012 + r() * 0.06, 0.4); }
  else if (surf === 'rock') { mix(b, nburst(r, 0.05, 2800, 900, 'bp', 4, 4), 0, 0.7); mix(b, nburst(r, dur, 700, 400, 'bp', 6, 5), 0, 0.4); }
  else if (surf === 'mud') { mix(b, nburst(r, dur * 1.2, 300, 120, 'bp', 3, 3, 0.02), 0.01, 0.9); mix(b, nburst(r, 0.05, 900, 300, 'bp', 2, 4), 0.06, 0.35); }
  else if (surf === 'water') { mix(b, nburst(r, dur * 1.2, 1500, 400, 'bp', 0.8, 3, 0.015), 0, 0.8); for (let k = 0; k < 4; k++) mix(b, chirp(r, 500 + r() * 800, 1400 + r() * 1000, 0.05), r() * 0.12, 0.15); }
  else { mix(b, nburst(r, dur * 0.8, 1600, 500, 'bp', 0.8, 5, 0.004), 0, 0.5); mix(b, nburst(r, 0.03, 4200, 2500, 'bp', 2, 3), 0.004, surf === 'grass' ? 0.12 : 0.3); }
  return norm(fade(b, 0.001, 0.02), 0.8);
}
function chirp(r, f0, f1, dur) { const b = mk(dur); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / dur; ph += TAU * lerp(f0, f1, p) / SR; b[i] = Math.sin(ph) * Math.sin(Math.PI * p); } return b; }
export function bite(seed, heavy) {
  const r = rng(seed || 1), b = mk(0.42);
  mix(b, nburst(r, 0.025, 6500, 3000, 'hp', 0.7, 5, 0.0008), 0, 0.7);                       // щелчок челюстей
  mix(b, nburst(r, 0.2, 900, 220, 'bp', 1.5, 4, 0.004), 0.012, 0.8);                         // мясо
  mix(b, thump(0.16, 130, 60, 22, 1.3), 0.008, heavy ? 0.9 : 0.6);                           // удар челюстей
  for (let k = 0; k < (heavy ? 7 : 4); k++) mix(b, nburst(r, 0.014 + r() * 0.012, 2500 + r() * 2500, 1200, 'bp', 4, 4, 0.0008), 0.02 + r() * 0.12, 0.45);   // хруст
  mix(b, nburst(r, 0.15, 500, 200, 'bp', 3, 3, 0.04), 0.1, 0.25);
  return norm(comb(b, [0.021, 0.037], 0.18), 0.85);
}
export function hit(seed, kind) {                      // kind: body | heavy | crit | claw
  const r = rng(seed || 1), b = mk(kind === 'heavy' ? 0.7 : 0.36);
  if (kind === 'claw') { mix(b, nburst(r, 0.14, 4800, 1200, 'bp', 0.9, 4, 0.003), 0, 0.8); mix(b, nburst(r, 0.07, 2500, 800, 'bp', 2, 4), 0.02, 0.5); mix(b, thump(0.1, 160, 80, 30), 0.01, 0.4); return norm(b, 0.85); }
  const w = kind === 'heavy' ? 1 : 0.65;
  mix(b, thump(kind === 'heavy' ? 0.55 : 0.25, kind === 'heavy' ? 95 : 150, kind === 'heavy' ? 32 : 55, kind === 'heavy' ? 7 : 16, 1.6), 0, 1);
  mix(b, nburst(r, 0.12, 1400, 250, 'bp', 0.8, 5, 0.001), 0, 0.85 * w);                       // шлепок плоти
  mix(b, nburst(r, 0.03, 4500, 1500, 'hp', 0.8, 4, 0.0006), 0, 0.55);                         // хлопок
  if (kind === 'crit') { mix(b, nburst(r, 0.07, 3600, 1800, 'bp', 6, 3, 0.0006), 0.004, 0.8); for (let k = 0; k < 5; k++) mix(b, nburst(r, 0.012, 2000 + r() * 3000, 1000, 'bp', 6, 4), 0.01 + r() * 0.1, 0.5); }
  if (kind === 'heavy') { mix(b, nburst(r, 0.5, 400, 90, 'bp', 1.2, 3, 0.01), 0.01, 0.7); }
  return norm(comb(b, [0.027, 0.053, 0.081], 0.22), 0.9);
}
export function whoosh(seed, dur, f0, f1, q) {
  const r = rng(seed || 1), n = nburst(r, dur || 0.3, f0 || 500, f1 || 2400, 'bp', q || 1.1, 1.2, (dur || 0.3) * 0.35);
  return norm(fade(n, 0.01, 0.06), 0.7);
}
export function eatPlant(seed) { const r = rng(seed), b = mk(0.5); for (let k = 0; k < 4; k++) { const t = 0.03 + k * 0.085 + r() * 0.02; mix(b, nburst(r, 0.035, 3800 + r() * 1800, 1500, 'bp', 2.2, 4, 0.0008), t, 0.75); mix(b, nburst(r, 0.07, 1100, 400, 'bp', 1.2, 4, 0.003), t, 0.3); } return norm(b, 0.8); }
export function eatMeat(seed) { const r = rng(seed), b = mk(0.55); mix(b, nburst(r, 0.16, 700, 160, 'bp', 1.2, 3, 0.01), 0, 0.6); for (let k = 0; k < 3; k++) mix(b, nburst(r, 0.05, 1200 - k * 150, 280, 'bp', 1.8, 3, 0.004), 0.03 + k * 0.1, 0.8); mix(b, voice({ dur: 0.18, f0: 170, f1: 80, form: 1.1, growl: 0.2, breath: 0.1, seed: seed + 3, att: 0.02, rel: 0.08 }), 0.34, 0.35); return norm(b, 0.8); }
export function splash(seed, big) {
  const r = rng(seed), d = big ? 1.2 : 0.55, b = mk(d);
  mix(b, nburst(r, d * 0.7, 2600, 500, 'bp', 0.6, 4, 0.004), 0, big ? 0.9 : 0.6);
  mix(b, nburst(r, d, 800, 150, 'lp', 0.7, 3, 0.01), 0, big ? 0.9 : 0.4);
  for (let k = 0; k < (big ? 18 : 9); k++) mix(b, chirp(r, 500 + r() * 700, 1300 + r() * 1800, 0.03 + r() * 0.05), 0.04 + r() * d * 0.7, 0.14);   // пузырьки
  if (big) mix(b, thump(0.4, 100, 40, 8), 0, 0.7);
  return norm(b, 0.85);
}
export function bubble(seed) { const r = rng(seed), b = mk(0.2); mix(b, chirp(r, 380 + r() * 300, 1000 + r() * 900, 0.06 + r() * 0.05), 0, 1); return norm(fade(b, 0.003, 0.05), 0.5); }
export function boom(seed, dur) {
  const r = rng(seed), d = dur || 1.8, b = mk(d);
  mix(b, thump(d, 62, 24, 2.4, 1.8), 0, 1);
  mix(b, nburst(r, d * 0.9, 1400, 70, 'lp', 0.7, 3, 0.004), 0, 0.9);
  mix(b, nburst(r, d, 500, 60, 'bp', 0.8, 3.5, 0.02), 0.04, 0.6);
  for (let k = 0; k < 22; k++) mix(b, nburst(r, 0.02 + r() * 0.03, 1000 + r() * 2500, 400, 'bp', 3, 3), 0.15 + r() * d * 0.6, 0.18 * (1 - k / 26));     // осыпь
  return norm(comb(b, [0.09, 0.19, 0.31], 0.25), 0.95);
}
export function thunder(seed) {
  const r = rng(seed), d = 4.5, b = mk(d), f = new Bq('lp', 350, 0.8), g = new Bq('lp', 120, 0.8), sn = smoothNoise(r, 6);
  for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / d; const x = r() * 2 - 1; const rum = 0.55 + 0.45 * sn(1 / SR); const env = (t < 0.04 ? t / 0.04 : 1) * Math.exp(-t * 0.7) * rum * (1 + 0.8 * Math.exp(-t * 6)); if ((i & 63) === 0) f.set(1200 * Math.exp(-p * 2.6) + 80, 0.8); b[i] = (f.p(x) * 1.2 + g.p(x) * 2.2) * env; }
  for (let k = 0; k < 6; k++) mix(b, nburst(r, 0.4, 600, 100, 'lp', 0.8, 3, 0.02), 0.2 + k * 0.35 + r() * 0.3, 0.3);
  return norm(b, 0.95);
}
export function crack(seed) {         // скорлупа яйца / трещина льда
  const r = rng(seed), b = mk(0.35);
  for (let k = 0; k < 7; k++) { const t = r() * 0.16; mix(b, nburst(r, 0.006 + r() * 0.01, 3000 + r() * 4000, 1500, 'bp', 5, 3, 0.0004), t, 0.5 + r() * 0.5); }
  mix(b, nburst(r, 0.12, 2000, 700, 'bp', 3, 4, 0.0005), 0, 0.5); mix(b, thump(0.08, 220, 120, 40), 0, 0.3);
  return norm(b, 0.8);
}
export function ice(seed) {            // скрип льда: резонансные глиссандо + щелчки
  const r = rng(seed), d = 1.6, b = mk(d); let ph = 0;
  for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / d, f = 900 + 1300 * Math.pow(p, 0.7) + 80 * Math.sin(t * 40); ph += TAU * f / SR; b[i] = (Math.sin(ph) + 0.4 * Math.sin(ph * 2.3) + 0.15 * (r() * 2 - 1)) * Math.sin(Math.PI * p) ** 1.5 * 0.5; }
  for (let k = 0; k < 6; k++) mix(b, nburst(r, 0.01, 4500, 2500, 'bp', 6, 3), r() * d, 0.5);
  return norm(b, 0.55);
}

// ================================================================== МУЗЫКАЛЬНЫЕ ЭФФЕКТЫ
function bell(freqs, dur, seed, inh) {   // колокольчик/стекло: негармонические обертона с разным затуханием
  const r = rng(seed || 1), b = mk(dur);
  for (let n = 0; n < freqs.length; n++) {
    const f = freqs[n];
    for (let k = 0; k < 5; k++) { const fr = f * (k === 0 ? 1 : 1 + (inh || 1.4) * k * (0.9 + r() * 0.2) * (k % 2 ? 1 : 1.7)); if (fr > 9000) continue; const am = 1 / (1 + k * 1.3), dc = 3 + k * 2.2; let ph = r() * 6; for (let i = 0; i < b.length; i++) { const t = i / SR; ph += TAU * fr / SR; b[i] += Math.sin(ph) * am * Math.exp(-t * dc / dur * 2) * Math.min(1, t / 0.002) * 0.4; } }
  }
  return norm(b, 0.75);
}
export function coin() { return bell([1568, 2093], 0.9, 11, 0.55); }
export function chime(notes, step, dur, seed) { const b = mk(dur + step * notes.length); notes.forEach((f, i) => mix(b, bell([f], dur, (seed || 1) + i, 0.5), i * step, 0.8)); return norm(b, 0.8); }
// «хор»: стопка пил с вибрато через гласные «А-О»
export function choir(freqs, dur, seed) {
  const r = rng(seed || 2), b = mk(dur), V = [[700, 1100, 2500], [450, 800, 2500]], bp = freqs.map(() => [new Bq('bp', 700, 7), new Bq('bp', 1100, 9), new Bq('bp', 2500, 10)]), ph = freqs.map(() => r()), vib = freqs.map(() => r() * 6);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR, p = t / dur, v = sm(0.2, 0.8, p), s = freqs.length; let y = 0;
    for (let n = 0; n < s; n++) {
      const f = freqs[n] * (1 + 0.006 * Math.sin(TAU * 5.2 * t + vib[n]) + 0.002 * Math.sin(TAU * 0.9 * t * (n + 1)));
      ph[n] += f / SR; if (ph[n] >= 1) ph[n] -= 1; const saw = 2 * ph[n] - 1;
      if ((i & 63) === 0) for (let k = 0; k < 3; k++) bp[n][k].set(lerp(V[0][k], V[1][k], v), 7 + k * 1.5);
      y += (bp[n][0].p(saw) + bp[n][1].p(saw) * 0.7 + bp[n][2].p(saw) * 0.3);
    }
    b[i] = y * Math.sin(Math.PI * p) ** 1.2;
  }
  return norm(b, 0.8);
}
export function heartbeat() { const b = mk(1.0); mix(b, thump(0.3, 70, 38, 9, 1.4), 0, 1); mix(b, thump(0.28, 62, 34, 10, 1.4), 0.24, 0.75); return norm(b, 0.9); }
export function sparkPulse() { const b = mk(2.2), r = rng(4); let ph = 0, ph2 = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, f = 180 + 60 * Math.sin(t * 2); ph += TAU * f / SR; ph2 += TAU * f * 1.5 / SR; b[i] = (Math.sin(ph + 2 * Math.sin(ph2)) * 0.5 + Math.sin(ph * 2) * 0.2) * Math.sin(Math.PI * t / 2.2) ** 2 * (0.7 + 0.3 * Math.sin(t * 26)); } mix(b, bell([880, 1320], 1.6, 3, 0.4), 0.05, 0.35); return norm(b, 0.8); }
export function meteor() { const r = rng(9), d = 4.2, b = mk(d), f = new Bq('bp', 400, 0.8), g = new Bq('lp', 90, 0.8); for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / d, x = r() * 2 - 1; if ((i & 31) === 0) f.set(300 + 3500 * Math.pow(p, 2), 0.8); b[i] = (f.p(x) * 1.2 + g.p(x) * 2) * Math.pow(p, 1.5) * (1 - 0.15 * p); } mix(b, boom(5, 1.6), 3.3, 1.0); return norm(b, 0.95); }
export function portal() { const r = rng(3), d = 1.4, b = mk(d), f = new Bq('bp', 500, 2); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / d, fr = 250 * Math.pow(6, p); ph += TAU * fr / SR; if ((i & 31) === 0) f.set(fr * 2, 2); b[i] = (Math.sin(ph) * 0.5 + f.p(r() * 2 - 1) * 0.5 + Math.sin(ph * 1.5) * 0.25) * Math.sin(Math.PI * p) ** 0.8; } return norm(b, 0.8); }
export function shield() { const d = 0.9, b = mk(d); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / d, f = 220 * Math.pow(2.2, Math.min(1, p * 2)); ph += TAU * f / SR; b[i] = (Math.sin(ph) + 0.4 * Math.sin(ph * 2) + 0.2 * Math.sin(ph * 3.01)) * (0.8 + 0.2 * Math.sin(t * 60)) * Math.sin(Math.PI * p) ** 0.6; } return norm(b, 0.7); }
export function zap(seed) { const r = rng(seed), b = mk(0.45); for (let k = 0; k < 26; k++) mix(b, nburst(r, 0.006 + r() * 0.012, 2500 + r() * 5000, 1500, 'bp', 3, 3, 0.0003), r() * 0.38, 0.4 + r() * 0.6); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; ph += TAU * 120 / SR; b[i] += Math.sign(Math.sin(ph)) * 0.18 * Math.exp(-t * 7) * (r() > 0.4 ? 1 : 0.2); } return norm(b, 0.8); }
// фанфара духовых: пила через ФНЧ с вибрато и огибающей «надува»
export function brass(notes, noteDur, gap, seed) {
  const r = rng(seed || 1), total = notes.reduce((a, n) => a + (n[1] || noteDur), 0) + 0.4, b = mk(total); let t0 = 0;
  for (const n of notes) {
    const f = n[0], d = (n[1] || noteDur) + 0.3, nb = mk(d), lp = new Bq('lp', 900, 1.2), lp2 = new Bq('lp', 2800, 0.7); let ph = 0, ph2 = 0;
    for (let i = 0; i < nb.length; i++) {
      const t = i / SR, e = Math.min(1, t / 0.07) * Math.exp(-Math.max(0, t - (n[1] || noteDur)) * 6), ff = f * (1 + 0.004 * Math.sin(TAU * 5.4 * t)); ph += ff / SR; ph2 += ff * 1.003 / SR; if (ph >= 1) ph--; if (ph2 >= 1) ph2--;
      if ((i & 63) === 0) lp.set(500 + 2800 * Math.min(1, t / 0.15) * e, 1.2);
      const s = (2 * ph - 1 + 2 * ph2 - 1) * 0.5; nb[i] = lp2.p(lp.p(s)) * e * 2;
    }
    mix(b, nb, t0, 0.8); t0 += (n[1] || noteDur) + (gap || 0);
  }
  return norm(b, 0.8);
}
export function drum(kind, seed) {      // taiko | tom | shaker | snare
  const r = rng(seed || 1);
  if (kind === 'taiko') { const b = mk(0.9); mix(b, thump(0.9, 110, 52, 4.5, 1.6), 0, 1); mix(b, nburst(r, 0.12, 1800, 300, 'bp', 1, 5, 0.001), 0, 0.5); mix(b, nburst(r, 0.5, 220, 120, 'bp', 4, 3), 0, 0.3); return norm(comb(b, [0.04, 0.09], 0.2), 0.9); }
  if (kind === 'tom') { const b = mk(0.5); mix(b, thump(0.5, 190, 90, 8, 1.3), 0, 1); mix(b, nburst(r, 0.05, 2500, 800, 'bp', 1.5, 4, 0.0006), 0, 0.4); return norm(b, 0.85); }
  if (kind === 'shaker') return norm(nburst(r, 0.12, 6500, 5000, 'bp', 1.2, 4, 0.02), 0.5);
  const b = mk(0.3); mix(b, nburst(r, 0.2, 2200, 1500, 'bp', 0.9, 4, 0.0008), 0, 0.9); mix(b, thump(0.12, 240, 150, 25), 0, 0.5); return norm(b, 0.8);
}

// ================================================================== ФОНОВЫЕ ПЕТЛИ И СОБЫТИЯ ОКРУЖЕНИЯ
function loopFix(b, xf) { const n = Math.round(xf * SR), L = b.length - n, o = new Float32Array(L); for (let i = 0; i < L; i++) o[i] = b[i]; for (let i = 0; i < n; i++) { const w = i / n; o[i] = o[i] * w + b[L + i] * (1 - w); } return o; }
function noiseLoop(dur, seed, build) { const xf = 0.6, r = rng(seed), b = mk(dur + xf); build(b, r); return loopFix(b, xf); }
export function windLoop(seed, bright, gust, dur) {
  return norm(noiseLoop(dur || 8, seed, (b, r) => { const f = new Bq('bp', 500, 1.2), f2 = new Bq('lp', 900, 0.7), s1 = smoothNoise(r, 0.35), s2 = smoothNoise(r, 1.7), s3 = smoothNoise(r, 6);
    for (let i = 0; i < b.length; i++) { const a = 0.5 + 0.5 * s1(1 / SR), c = s2(1 / SR), x = r() * 2 - 1; if ((i & 63) === 0) f.set((300 + 700 * a) * bright + 200 * c, 1.1 + 1.2 * a); b[i] = (f.p(x) * (0.4 + 0.8 * a * (gust || 1)) + f2.p(x) * 0.5) * (0.85 + 0.15 * s3(1 / SR)); } }), 0.5);
}
export function waterLoop(seed, kind, dur) {     // lap — прибой/плеск, deep — подводный гул, river
  return norm(noiseLoop(dur || 9, seed, (b, r) => {
    if (kind === 'deep') { const lp = new Bq('lp', 160, 0.9), lp2 = new Bq('lp', 420, 0.8), s1 = smoothNoise(r, 0.2), s2 = smoothNoise(r, 0.7); for (let i = 0; i < b.length; i++) { const x = r() * 2 - 1; b[i] = lp.p(x) * 3 * (0.8 + 0.3 * s1(1 / SR)) + lp2.p(x) * (0.5 + 0.4 * s2(1 / SR)); } return; }
    const f = new Bq('bp', 900, 0.7), g = new Bq('lp', 300, 0.8), wv = 0.28 + r() * 0.05; for (let i = 0; i < b.length; i++) { const t = i / SR, w = 0.5 + 0.5 * Math.sin(TAU * wv * t + 1.3 * Math.sin(t * 0.7)), x = r() * 2 - 1; if ((i & 63) === 0) f.set(500 + 1700 * w * w, 0.7); b[i] = f.p(x) * (0.15 + 0.85 * w * w) + g.p(x) * 0.8 * w; }
  }), 0.45);
}
export function rainLoop(seed, dur) { return norm(noiseLoop(dur || 6, seed, (b, r) => { const f = new Bq('hp', 1500, 0.7), g = new Bq('lp', 9000, 0.7), h = new Bq('bp', 400, 0.6); for (let i = 0; i < b.length; i++) { const x = r() * 2 - 1; b[i] = g.p(f.p(x)) * 0.8 + h.p(x) * 0.5; if (r() < 0.0015) b[i] += (r() * 2 - 1) * 0.8; } }), 0.5); }
export function fireLoop(seed, dur) { return norm(noiseLoop(dur || 7, seed, (b, r) => { const lo = new Bq('lp', 200, 0.8), hi = new Bq('hp', 2500, 0.7), sn = smoothNoise(r, 2.3); for (let i = 0; i < b.length; i++) { const x = r() * 2 - 1; b[i] = lo.p(x) * 2.2 * (0.6 + 0.4 * sn(1 / SR)) + hi.p(x) * 0.12; if (r() < 0.0035) { const a = r(); for (let k = 0; k < 90 && i + k < b.length; k++) b[i + k] += (r() * 2 - 1) * Math.exp(-k / (8 + 12 * a)) * (0.4 + r() * 0.7); } } }), 0.55); }
export function rumbleLoop(seed, dur) { return norm(noiseLoop(dur || 8, seed, (b, r) => { const lp = new Bq('lp', 70, 1), l2 = new Bq('lp', 180, 0.8), sn = smoothNoise(r, 0.6); for (let i = 0; i < b.length; i++) { const x = r() * 2 - 1; b[i] = lp.p(x) * 4 * (0.6 + 0.4 * sn(1 / SR)) + l2.p(x) * 0.7; } }), 0.6); }
export function insectLoop(seed, hz, dur) { return norm(noiseLoop(dur || 6, seed, (b, r) => { let ph = 0; const pr = 11 + r() * 3; for (let i = 0; i < b.length; i++) { const t = i / SR, g = Math.max(0, Math.sin(TAU * pr * t)) ** 3 * (0.5 + 0.5 * Math.sin(TAU * 0.27 * t)); ph += TAU * (hz + 120 * Math.sin(t * 3)) / SR; b[i] = Math.sin(ph) * g * 0.6 + Math.sin(ph * 1.5) * g * 0.15; } }), 0.4); }
export function bubblesLoop(seed, dur) { return norm(noiseLoop(dur || 6, seed, (b, r) => { for (let k = 0; k < 26; k++) mix(b, chirp(r, 180 + r() * 400, 600 + r() * 1400, 0.05 + r() * 0.08), r() * (dur || 6), 0.5 + r() * 0.5); const lp = new Bq('lp', 250, 0.8); for (let i = 0; i < b.length; i++) b[i] += lp.p(r() * 2 - 1) * 0.5; }), 0.5); }
export function lavaLoop(seed, dur) { return norm(noiseLoop(dur || 7, seed, (b, r) => { const lp = new Bq('lp', 140, 1); for (let i = 0; i < b.length; i++) b[i] = lp.p(r() * 2 - 1) * 3; for (let k = 0; k < 16; k++) { const f = 60 + r() * 120, d = 0.15 + r() * 0.2, c = chirp(r, f, f * (1.8 + r()), d); mix(b, c, r() * (dur || 7), 0.35); } }), 0.6); }

// ---- разовые звуки природы
export function birdCall(seed, kind) {
  const r = rng(seed), b = mk(0.9);
  const note = (t0, f0, f1, d, am) => mix(b, fade(chirpFM(f0, f1, d, am || 0), 0.004, 0.02), t0, 0.7);
  if (kind === 1) { const n = 3 + ((r() * 3) | 0); for (let k = 0; k < n; k++) note(k * 0.11, 3200 + r() * 800, 2300 + r() * 600, 0.08); }                           // «чирик-чирик»
  else if (kind === 2) { note(0, 2000, 3600, 0.22, 25); note(0.3, 3600, 2200, 0.28, 18); }                                                                         // свист вверх-вниз
  else { for (let k = 0; k < 7; k++) note(k * 0.07, 4200 - k * 150, 3700 - k * 150, 0.045); }                                                                       // трель
  return norm(b, 0.55);
}
function chirpFM(f0, f1, dur, fm) { const b = mk(dur); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, p = t / dur, f = lerp(f0, f1, p) * (1 + (fm ? 0.04 * Math.sin(TAU * fm * t) : 0)); ph += TAU * f / SR; b[i] = (Math.sin(ph) + 0.25 * Math.sin(ph * 2)) * Math.sin(Math.PI * p) ** 0.6; } return b; }
export function frog(seed) { const r = rng(seed), b = mk(0.5), f = new Bq('bp', 500, 4); for (let k = 0; k < 4; k++) { const nb = mk(0.07); let ph = 0; for (let i = 0; i < nb.length; i++) { const t = i / SR; ph += TAU * (320 + 80 * r() * 0 + 70 * (1 - t / 0.07)) / SR; nb[i] = f.p(Math.sign(Math.sin(ph)) * 0.7 + Math.sin(ph * 2) * 0.3) * Math.sin(Math.PI * t / 0.07); } mix(b, nb, k * 0.1, 0.9); } return norm(b, 0.55); }
export function owl(seed) { const b = mk(1.4); mix(b, voice({ dur: 0.38, f0: 380, f1: 330, form: 0.6, growl: 0.05, breath: 0.1, att: 0.06, rel: 0.12, drive: 0.6, open: 0.2, seed: 5 }), 0, 0.8); mix(b, voice({ dur: 0.7, f0: 340, f1: 280, form: 0.6, growl: 0.05, breath: 0.1, att: 0.08, rel: 0.25, drive: 0.6, open: 0.2, seed: 6 }), 0.55, 0.7); return norm(b, 0.5); }
export function drip(seed) { const r = rng(seed), b = mk(0.3); mix(b, chirp(r, 1400, 2600, 0.06), 0, 0.9); mix(b, bell([1900], 0.3, seed, 0.2), 0, 0.2); return norm(b, 0.4); }
export function seagull(seed) { return screech({ dur: 0.8, f0: 1400, f1: 900, seed }); }

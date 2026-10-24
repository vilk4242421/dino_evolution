/* Звук без файлов. Эффекты синтезируются физическими моделями (sounddsp.js: голосовые форманты, шум с резонансами) в буферы при первом
   использовании; поверх — окружение по биомам (ветер, птицы, вода, огонь, подводный гул), 3D-панорама и затухание с расстоянием,
   реверберация, приглушение под водой, шаги по поверхностям, «речь» боссов и музыка (по биому, бой, босс, кино-темы). */
import * as D from './sounddsp.js';
let ctx = null, master = null, sfxBus = null, musG = null, comp = null, uw = null, verb = null, verbSend = null, musVerb = null, ambG = null, noiseBuf = null;
let vol = 0.7, musicOn = true, biome = null, combat = false, boss = false, mood = '', schedT = 0, step_ = 0, timer = 0, enabled = true, voices = 0;
try { vol = parseFloat(localStorage.getItem('dino_vol') || '0.7'); musicOn = localStorage.getItem('dino_music') !== '0'; } catch (e) { /* ignore */ }
const L = { x: 0, z: 0, rx: 1, rz: 0 };             // слушатель: позиция и вектор «вправо»
const env = { under: false, rain: 0, night: false, wind: 1 };

export function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = vol; comp.connect(master); master.connect(ctx.destination);
    uw = ctx.createBiquadFilter(); uw.type = 'lowpass'; uw.frequency.value = 20000; uw.Q.value = 0.5; uw.connect(comp);       // «под водой» — глушит всё
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.95; sfxBus.connect(uw);
    ambG = ctx.createGain(); ambG.gain.value = 0.55; ambG.connect(uw);
    musG = ctx.createGain(); musG.gain.value = musicOn ? 0.34 : 0; musG.connect(uw);
    verb = ctx.createConvolver(); verb.buffer = makeIR(1.9, 2.6, false); verbSend = ctx.createGain(); verbSend.gain.value = 0.9; verb.connect(verbSend); verbSend.connect(uw);
    musVerb = ctx.createGain(); musVerb.gain.value = 0.5; musG.connect(musVerb); musVerb.connect(verb);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    timer = setInterval(sched, 100);
    if (biome) startAmbience();
    setTimeout(prewarm, 1500);
  } catch (e) { enabled = false; }
}
export function setVolume(v) { vol = v; try { localStorage.setItem('dino_vol', String(v)); } catch (e) { /* ignore */ } if (master) master.gain.value = v; }
export function setMusic(on) { musicOn = on; try { localStorage.setItem('dino_music', on ? '1' : '0'); } catch (e) { /* ignore */ } if (musG) musG.gain.value = on ? 0.34 : 0; }
export const getVolume = () => vol; export const getMusic = () => musicOn;
function makeIR(sec, decay, dark) {
  const sr = ctx.sampleRate, n = Math.round(sec * sr), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; const k = dark ? 0.12 : 0.45; for (let i = 0; i < n; i++) { const t = i / n; lp += ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) - lp) * (k + (1 - k) * (1 - t) * 0.6); d[i] = i < sr * 0.008 ? 0 : lp * 0.8; } }
  return b;
}

// ---------------------------------------------------------------- буферы
const cache = new Map();
function mkBuf(data) { const b = ctx.createBuffer(1, data.length, D.SR); b.getChannelData(0).set(data); return b; }
function getBuf(key, gen) { let b = cache.get(key); if (!b) { b = mkBuf(gen()); cache.set(key, b); } return b; }
const rndi = (n) => (Math.random() * n) | 0, rr = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a) => a[(Math.random() * a.length) | 0];

// голоса: размер 0 (малыш) … 1 (гигант)
const sizeKey = (s) => clamp(Math.round((s == null ? 0.5 : s) * 4), 0, 4);
function roarGen(kind, sk, v) {
  const s = sk / 4, seed = 11 + v * 7 + sk;
  switch (kind) {
    case 'herb': return D.voice({ dur: 1.0 + s * 0.5, f0: 230 - s * 120, f1: 150 - s * 80, form: 1.05 - s * 0.3, growl: 0.28, breath: 0.22, peak: 0.28, vib: 0.018, vibHz: 4.5, seed, drive: 1.6 });
    case 'fly': return D.screech({ dur: 0.55 + s * 0.3, f0: 2300 - s * 900, f1: 3800 - s * 1400, seed });
    case 'aqua': return D.whale({ dur: 1.8 + s * 1.4, f0: 130 - s * 70, f1: 240 - s * 100, seed });
    case 'boss_tyrant': return D.voice({ dur: 2.0, f0: 62, f1: 34, form: 0.7, growl: 0.85, breath: 0.35, peak: 0.25, seed, drive: 3 });
    case 'boss_frost': return D.voice({ dur: 2.3, f0: 48, f1: 28, form: 0.62, growl: 0.45, breath: 0.5, peak: 0.35, seed, drive: 1.8, vib: 0.01 });
    case 'boss_rogach': return D.voice({ dur: 1.5, f0: 105, f1: 65, form: 0.82, growl: 0.65, breath: 0.2, peak: 0.2, seed, drive: 2.8 });
    case 'boss_sandlord': return D.voice({ dur: 1.9, f0: 90, f1: 55, form: 1.0, growl: 0.9, breath: 0.75, peak: 0.3, seed, drive: 2.4 });
    case 'boss_leviathan': return D.whale({ dur: 3.2, f0: 55, f1: 120, seed });
    case 'boss_dragon': return D.voice({ dur: 2.2, f0: 72, f1: 38, form: 0.78, growl: 0.95, breath: 0.6, peak: 0.3, seed, drive: 3.4 });
    case 'boss_megalodon': return D.whale({ dur: 2.6, f0: 45, f1: 85, seed });
    case 'boss_plesioqueen': return D.whale({ dur: 3.4, f0: 190, f1: 420, seed });
    case 'boss_kronos': return D.voice({ dur: 2.2, f0: 55, f1: 32, form: 0.66, growl: 0.7, breath: 0.45, peak: 0.3, seed, drive: 2.6 });
    case 'boss_dunkleo': return D.voice({ dur: 1.9, f0: 80, f1: 46, form: 0.72, growl: 0.8, breath: 0.3, peak: 0.2, seed, drive: 3.2 });
    case 'boss_tylo': return D.whale({ dur: 3.8, f0: 38, f1: 70, seed });
    default: return D.voice({ dur: 1.0 + s * 0.7, f0: 170 - s * 100, f1: 90 - s * 55, form: 1 - s * 0.28, growl: 0.4 + s * 0.35, breath: 0.25, peak: 0.28, seed, drive: 2.4 });
  }
}
const BOSS_ID = { tyrant: 1, frost: 1, rogach: 1, sandlord: 1, leviathan: 1, dragon: 1, megalodon: 1, plesioqueen: 1, kronos: 1, dunkleo: 1, tylo: 1 };
function pickRoar(opt) {
  const kind = opt.boss && BOSS_ID[opt.boss] ? 'boss_' + opt.boss : (opt.kind || 'carn'), sk = kind.startsWith('boss_') ? 4 : sizeKey(opt.size), v = rndi(2);
  return getBuf('roar:' + kind + ':' + sk + ':' + v, () => roarGen(kind, sk, v));
}
const SURF = ['dirt', 'grass', 'sand', 'snow', 'rock', 'mud', 'water'];
const massKey = (m) => m < 0.45 ? 0.3 : m < 0.8 ? 0.6 : m < 1.3 ? 1 : m < 2 ? 1.6 : 2.6;

// таблица обычных эффектов: [генератор(seed), число вариантов, громкость, реверберация, диапазон питча]
const SFX = {
  hit: [(s) => D.hit(s, 'body'), 3, 0.95, 0.12, [0.93, 1.07]],
  thud: [(s) => D.hit(s, 'heavy'), 2, 1.0, 0.3, [0.92, 1.05]],
  crit: [(s) => D.hit(s, 'crit'), 2, 1.0, 0.2, [0.95, 1.05]],
  claw: [(s) => D.hit(s, 'claw'), 3, 0.8, 0.1, [0.95, 1.08]],
  crack: [(s) => D.crack(s), 4, 0.8, 0.1, [0.92, 1.08]],
  bite: [(s) => D.bite(s, false), 3, 0.95, 0.12, [0.92, 1.06]],
  chomp: [(s) => D.bite(s, true), 2, 1.0, 0.15, [0.9, 1.04]],
  swing: [(s) => D.whoosh(s, 0.22, 600, 2600, 1.0), 3, 0.5, 0.05, [0.9, 1.15]],
  dash: [(s) => D.whoosh(s, 0.4, 350, 3200, 0.8), 2, 0.65, 0.1, [0.95, 1.05]],
  hurt: [(s) => D.voice({ dur: 0.5, f0: 250, f1: 120, form: 1.1, growl: 0.35, breath: 0.15, att: 0.02, rel: 0.2, peak: 0.2, seed: s, drive: 2 }), 3, 0.85, 0.15, [0.85, 1.15]],
  die: [(s) => D.voice({ dur: 2.0, f0: 150, f1: 40, form: 0.85, growl: 0.75, breath: 0.4, att: 0.04, peak: 0.12, seed: s, drive: 2.4 }), 2, 1.0, 0.35, [0.9, 1.05]],
  eat_plant: [(s) => D.eatPlant(s), 3, 0.7, 0.05, [0.92, 1.1]],
  eat_meat: [(s) => D.eatMeat(s), 3, 0.85, 0.08, [0.92, 1.06]],
  coin: [() => D.coin(), 1, 0.55, 0.3, [0.98, 1.02]],
  level: [() => D.chime([523, 659, 784, 1046], 0.1, 0.9, 3), 1, 0.7, 0.45, [1, 1]],
  evo: [() => { const b = D.chime([392, 523, 659, 784, 1046, 1318], 0.08, 1.1, 5), c = D.choir([262, 330, 392, 523], 2.2, 3), o = new Float32Array(Math.max(b.length, c.length)); o.set(c); for (let i = 0; i < b.length; i++) o[i] += b[i] * 0.8; return o; }, 1, 0.75, 0.55, [1, 1]],
  warn: [() => D.brass([[196, 0.16], [196, 0.3]], 0.2, 0.08, 1), 1, 0.55, 0.3, [1, 1]],
  boom: [(s) => D.boom(s, 2.0), 2, 1.0, 0.4, [0.92, 1.04]],
  quake: [(s) => D.boom(s + 3, 3.0), 1, 1.0, 0.5, [0.85, 0.95]],
  portal: [() => D.portal(), 1, 0.8, 0.5, [1, 1]],
  king: [() => D.brass([[262, 0.28], [330, 0.28], [392, 0.28], [523, 1.1]], 0.3, 0.02, 2), 1, 0.85, 0.5, [1, 1]],
  click: [(s) => { const b = D.drum('tom', s); return b.subarray(0, Math.round(0.06 * D.SR)).slice(); }, 2, 0.35, 0, [1.4, 1.6]],
  duelgo: [() => { const b = D.brass([[196, 0.2], [294, 0.6]], 0.2, 0, 4), t = D.drum('taiko', 2), o = new Float32Array(b.length); o.set(b); for (let i = 0; i < t.length && i < o.length; i++) o[i] += t[i] * 0.8; return o; }, 1, 0.9, 0.4, [1, 1]],
  count: [() => D.chime([880], 0.01, 0.35, 8), 1, 0.6, 0.15, [1, 1]],
  win: [() => D.brass([[262, 0.2], [330, 0.2], [392, 0.2], [523, 0.2], [659, 0.9]], 0.2, 0.02, 5), 1, 0.85, 0.5, [1, 1]],
  lose: [() => D.brass([[330, 0.4], [294, 0.4], [247, 0.4], [196, 1.2]], 0.4, 0.04, 6), 1, 0.7, 0.55, [1, 1]],
  splash: [(s) => D.splash(s, false), 3, 0.8, 0.2, [0.9, 1.15]],
  splash_big: [(s) => D.splash(s, true), 2, 1.0, 0.3, [0.9, 1.05]],
  bubble: [(s) => D.bubble(s), 5, 0.5, 0.2, [0.8, 1.3]],
  emote: [() => D.chime([1046], 0.01, 0.4, 2), 1, 0.4, 0.2, [0.9, 1.3]],
  shock: [(s) => D.zap(s), 3, 0.85, 0.15, [0.9, 1.1]],
  shield: [() => D.shield(), 1, 0.6, 0.35, [1, 1]],
  thunder: [(s) => D.thunder(s), 2, 1.0, 0.5, [0.9, 1.05]],
  ice: [(s) => D.ice(s), 2, 0.6, 0.4, [0.9, 1.1]],
  shard: [() => { const a = D.chime([1318, 1568, 1976, 2637], 0.14, 1.6, 7), c = D.choir([392, 494, 587, 784], 3, 4), o = new Float32Array(Math.max(a.length, c.length)); o.set(c); for (let i = 0; i < a.length; i++) o[i] += a[i]; return o; }, 1, 0.8, 0.7, [1, 1]],
  spark: [() => D.sparkPulse(), 1, 0.8, 0.5, [1, 1]],
  heartbeat: [() => D.heartbeat(), 1, 0.9, 0.2, [1, 1]],
  meteor: [() => D.meteor(), 1, 1.0, 0.4, [1, 1]],
  choir_hi: [() => D.choir([262, 330, 392, 523, 659], 7, 8), 1, 0.7, 0.7, [1, 1]],
  choir_lo: [() => D.choir([147, 175, 220, 294], 7, 9), 1, 0.7, 0.7, [1, 1]],
  taiko: [(s) => D.drum('taiko', s), 2, 0.9, 0.35, [0.95, 1.05]]
};
const LOW_PRIO = { hit: 1, claw: 1, swing: 1, bubble: 1, click: 1, count: 1, emote: 1, crack: 1, eat_plant: 1, eat_meat: 1, bite: 1 };

function play(buf, o) {
  if (voices > 34 && !(o && o.hi)) return null;
  const t = (o && o.t) || ctx.currentTime, src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = (o && o.rate) || 1;
  const g = ctx.createGain(); g.gain.value = (o && o.g) == null ? 1 : o.g; src.connect(g); let last = g;
  if (o && o.lp && o.lp < 18000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; last.connect(f); last = f; }
  if (o && o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); last.connect(p); last = p; }
  last.connect((o && o.dest) || sfxBus);
  const send = o && o.send != null ? o.send : 0; if (send > 0) { const s = ctx.createGain(); s.gain.value = send; last.connect(s); s.connect(verb); }
  voices++; src.onended = () => { voices--; try { g.disconnect(); } catch (e) { /* ignore */ } };
  src.start(t); return src;
}
// положение в пространстве: объект {x, z} → панорама, громкость и яркость по расстоянию
function spatial(opt) {
  const o = {};
  if (typeof opt === 'number') { o.pan = opt; return o; }
  if (!opt) return o;
  if (opt.x != null) {
    const dx = opt.x - L.x, dz = opt.z - L.z, d = Math.hypot(dx, dz), ref = opt.ref || 6;
    o.g = 1 / Math.pow(1 + d / ref, 1.35); o.lp = Math.max(1100, 17000 / (1 + d / (ref * 1.2)));
    o.pan = d > 0.5 ? clamp((dx * L.rx + dz * L.rz) / d, -1, 1) * Math.min(1, d / 3) * 0.85 : 0;
    o.far = d; o.send = clamp(0.1 + d / 120, 0, 0.5);
  }
  if (opt.pan != null) o.pan = opt.pan;
  if (opt.g != null) o.g = (o.g == null ? 1 : o.g) * opt.g;
  return o;
}
const lastPlay = {};
export function sfx(name, opt) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (lastPlay[name] && now - lastPlay[name] < (LOW_PRIO[name] ? 0.045 : 0.06)) return; lastPlay[name] = now;
  const sp = spatial(opt);
  if (sp.g != null && sp.g < 0.05) return;
  if (name === 'roar' || name === 'screech' || name === 'boss') {
    const o = (opt && typeof opt === 'object') ? opt : {}, kind = name === 'screech' ? 'fly' : o.kind || 'carn';
    const b = pickRoar(name === 'boss' ? { boss: o.boss, kind } : { kind, size: o.size, boss: o.boss });
    play(b, { g: (sp.g == null ? 1 : sp.g) * (name === 'boss' ? 0.95 : 0.85), rate: rr(0.95, 1.05), pan: sp.pan, lp: sp.lp, send: Math.max(sp.send || 0, 0.3), hi: true });
    if (name === 'boss') play(getBuf('boom:s', () => D.boom(5, 2.4)), { g: 0.4 * (sp.g == null ? 1 : sp.g), rate: 0.8, send: 0.4, hi: true });
    return;
  }
  const def = SFX[name]; if (!def) return;
  const v = rndi(def[1]), b = getBuf('sfx:' + name + ':' + v, () => def[0](31 + v * 17 + name.length * 3));
  play(b, { g: def[2] * (sp.g == null ? 1 : sp.g), rate: rr(def[4][0], def[4][1]), pan: sp.pan, lp: sp.lp, send: Math.max(def[3], sp.send || 0), hi: !LOW_PRIO[name] });
}
// шаг: поверхность, масса (≈ размер), позиция
export function step(surf, mass, opt) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const sp = spatial(opt); if (sp.g != null && sp.g < 0.06) return;
  const mk = massKey(mass), s = SURF.indexOf(surf) >= 0 ? surf : 'dirt', v = rndi(3);
  const b = getBuf('step:' + s + ':' + mk + ':' + v, () => D.footstep(s, mk, 5 + v * 13));
  play(b, { g: (0.38 + 0.2 * Math.min(2, mk)) * (sp.g == null ? 1 : sp.g), rate: rr(0.93, 1.08) * (0.85 + 0.15 / Math.max(0.5, mk)), pan: sp.pan, lp: sp.lp, send: sp.send || 0.1 });
}
export function listener(x, z, rx, rz) { L.x = x; L.z = z; L.rx = rx; L.rz = rz; }
// «речь» существа: слоги голосом босса, растянутые на время показа строки
const SPEECH = {
  tyrant: { f0: 75, form: 0.72, growl: 0.8, breath: 0.2 }, frost: { f0: 55, form: 0.64, growl: 0.35, breath: 0.45 }, rogach: { f0: 110, form: 0.85, growl: 0.55, breath: 0.15 },
  sandlord: { f0: 95, form: 1.0, growl: 0.75, breath: 0.7 }, leviathan: { f0: 60, form: 0.7, growl: 0.5, breath: 0.35 }, dragon: { f0: 80, form: 0.8, growl: 0.85, breath: 0.5 },
  megalodon: { f0: 65, form: 0.72, growl: 0.55, breath: 0.3 }, plesioqueen: { f0: 190, form: 1.15, growl: 0.15, breath: 0.25 }, kronos: { f0: 70, form: 0.68, growl: 0.6, breath: 0.4 },
  dunkleo: { f0: 85, form: 0.74, growl: 0.7, breath: 0.25 }, tylo: { f0: 52, form: 0.62, growl: 0.4, breath: 0.35 }, narrator: { f0: 140, form: 1.0, growl: 0.05, breath: 0.35 }
};
export function speak(who, chars, dur) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const P = SPEECH[who] || SPEECH.narrator, n = clamp(Math.round(chars / 3.2), 2, 28), gap = dur / n, t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < n; i++) {
    const v = rndi(5), b = getBuf('say:' + who + ':' + v, () => D.voice({ dur: 0.2 + v * 0.025, f0: P.f0 * (0.9 + v * 0.05), f1: P.f0 * 0.82, form: P.form * (0.9 + (v % 3) * 0.1), growl: P.growl, breath: P.breath, att: 0.025, rel: 0.09, peak: 0.3, seed: 40 + v * 5, drive: 1.6, peakLevel: 0.8 }));
    const end = i === n - 1;
    play(b, { t: t0 + i * gap + Math.random() * gap * 0.25, g: (who === 'narrator' ? 0.12 : 0.22) * (end ? 0.8 : 0.6 + Math.random() * 0.5), rate: rr(0.92, 1.1) * (end ? 0.9 : 1), send: 0.25 });
  }
}
// кино-стингеры
export function cue(name) { sfx(name); }

// ---------------------------------------------------------------- окружение
const AMB = {
  forest: { loops: [['wind', 0.35, { b: 0.9 }], ['rustle', 0.12]], shots: [['bird', 7, 16, 0.5, 'day'], ['owl', 14, 30, 0.35, 'night'], ['insect', 0, 0, 0.18, 'night']] },
  snow: { loops: [['wind', 0.55, { b: 0.7, gust: 1.8 }]], shots: [['ice', 25, 50, 0.3]] },
  mountain: { loops: [['wind', 0.5, { b: 1.1, gust: 1.6 }]], shots: [['eagle', 14, 30, 0.4, 'day'], ['rockfall', 40, 80, 0.25]] },
  desert: { loops: [['wind', 0.45, { b: 1.5, gust: 1.4 }]], shots: [['vulture', 22, 45, 0.3, 'day'], ['insect', 0, 0, 0.15, 'night']] },
  swamp: { loops: [['lap', 0.18], ['wind', 0.15, { b: 0.6 }], ['insect', 0.2]], shots: [['frog', 3, 8, 0.45], ['bubble', 5, 12, 0.3], ['bird', 12, 24, 0.25, 'day'], ['gull', 16, 32, 0.3, 'day']] },
  volcano: { loops: [['rumble', 0.4], ['fire', 0.3], ['wind', 0.2, { b: 0.6 }]], shots: [['boom', 25, 55, 0.2], ['rockfall', 12, 28, 0.2]] },
  reef: { loops: [['deep', 0.4], ['bubbles', 0.2]], shots: [['whale', 18, 40, 0.3], ['bubble', 2, 6, 0.35]] },
  kelp: { loops: [['deep', 0.45], ['bubbles', 0.12]], shots: [['whale', 20, 45, 0.25], ['bubble', 3, 8, 0.3]] },
  arctic: { loops: [['deep', 0.5], ['wind', 0.1, { b: 0.5 }]], shots: [['ice', 8, 20, 0.45], ['whale', 24, 50, 0.3]] },
  vents: { loops: [['deep', 0.5], ['lava', 0.35], ['bubbles', 0.2]], shots: [['rockfall', 10, 24, 0.2], ['bubble', 2, 6, 0.4]] },
  abyss: { loops: [['deep', 0.65], ['rumble', 0.15]], shots: [['whale', 14, 32, 0.45], ['drip', 6, 14, 0.2]] },
  duel: { loops: [['wind', 0.3, { b: 1 }]], shots: [] },
  menu: { loops: [['wind', 0.2, { b: 0.8 }]], shots: [['bird', 9, 20, 0.35, 'day']] },
  story: { loops: [['wind', 0.18, { b: 0.6 }]], shots: [] }
};
function loopBuf(id, opt) {
  const o = opt || {};
  switch (id) {
    case 'wind': return getBuf('L:wind:' + (o.b || 1) + ':' + (o.gust || 1), () => D.windLoop(3, o.b || 1, o.gust || 1));
    case 'rustle': return getBuf('L:rustle', () => D.windLoop(8, 2.6, 0.7));
    case 'lap': return getBuf('L:lap', () => D.waterLoop(2, 'lap'));
    case 'deep': return getBuf('L:deep', () => D.waterLoop(4, 'deep'));
    case 'rumble': return getBuf('L:rumble', () => D.rumbleLoop(5));
    case 'fire': return getBuf('L:fire', () => D.fireLoop(6));
    case 'lava': return getBuf('L:lava', () => D.lavaLoop(7));
    case 'bubbles': return getBuf('L:bubbles', () => D.bubblesLoop(9));
    case 'insect': return getBuf('L:insect', () => D.insectLoop(2, 4300));
    case 'rain': return getBuf('L:rain', () => D.rainLoop(1));
  }
  return null;
}
let amb = null, rainNode = null, shotNext = [];
function startLoop(id, g, opt, bus) {
  const buf = loopBuf(id, opt); if (!buf) return null;
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration;
  const gn = ctx.createGain(); gn.gain.value = 0; gn.gain.setTargetAtTime(g, ctx.currentTime, 1.2); s.connect(gn); gn.connect(bus || ambG); s.start(0, Math.random() * buf.duration);
  return { s, g: gn, base: g, id };
}
function stopLoops(list) { if (!list) return; for (const l of list) { try { l.g.gain.setTargetAtTime(0, ctx.currentTime, 0.8); l.s.stop(ctx.currentTime + 3.5); } catch (e) { /* ignore */ } } }
function startAmbience() {
  if (!ctx || !biome) return; stopLoops(amb && amb.nodes);
  const def = AMB[biome] || AMB.forest; amb = { nodes: [], def };
  for (const l of def.loops) { const n = startLoop(l[0], l[1], l[2]); if (n) amb.nodes.push(n); }
  shotNext = def.shots.map((s) => ctx.currentTime + 2 + Math.random() * (s[1] || 6));
  applyEnv();
}
function shot(kind, vol) {
  const dist = rr(10, 70), pan = rr(-0.9, 0.9), o = { g: vol / (1 + dist / 25), pan, lp: 14000 / (1 + dist / 30), send: 0.35 + dist / 150, rate: rr(0.9, 1.12) };
  switch (kind) {
    case 'bird': play(getBuf('A:bird:' + rndi(3) + ':' + rndi(2), () => D.birdCall(rndi(999), 1 + rndi(3))), o); break;
    case 'owl': play(getBuf('A:owl', () => D.owl(1)), o); break;
    case 'eagle': play(getBuf('A:eagle', () => D.screech({ dur: 1.1, f0: 1900, f1: 1200, seed: 2 })), Object.assign(o, { g: o.g * 0.7 })); break;
    case 'vulture': play(getBuf('A:vult', () => D.screech({ dur: 1.4, f0: 800, f1: 1500, seed: 6 })), Object.assign(o, { g: o.g * 0.6 })); break;
    case 'gull': play(getBuf('A:gull', () => D.seagull(3)), Object.assign(o, { g: o.g * 0.6 })); break;
    case 'frog': play(getBuf('A:frog:' + rndi(3), () => D.frog(rndi(999))), o); break;
    case 'bubble': play(getBuf('sfx:bubble:' + rndi(5), () => D.bubble(31 + 17 * 0)), Object.assign(o, { g: o.g * 1.5 })); break;
    case 'drip': play(getBuf('A:drip', () => D.drip(1)), o); break;
    case 'whale': play(getBuf('A:whale:' + rndi(3), () => D.whale({ dur: 3 + rndi(3), f0: 60 + rndi(70), f1: 110 + rndi(120), seed: rndi(99) })), Object.assign(o, { g: o.g * 1.6, send: 0.7, lp: 5000 })); break;
    case 'ice': play(getBuf('sfx:ice:0', () => D.ice(31)), o); break;
    case 'rockfall': play(getBuf('A:rock', () => D.boom(12, 1.4)), Object.assign(o, { g: o.g * 0.8, lp: 2500 })); break;
    case 'boom': play(getBuf('A:vboom', () => D.boom(14, 2.8)), Object.assign(o, { g: o.g * 1.2, lp: 1800 })); break;
  }
}
function ambTick() {
  if (!amb || !ctx) return; const now = ctx.currentTime, def = amb.def, under = env.under;
  def.shots.forEach((s, i) => {
    if (s[1] === 0) return;                                  // постоянные слои (insect) — зациклены отдельно
    if (now < shotNext[i]) return; shotNext[i] = now + rr(s[1], s[2]);
    if (s[4] === 'day' && env.night) return; if (s[4] === 'night' && !env.night) return;
    if (under && !['whale', 'bubble', 'ice', 'drip', 'rockfall', 'boom'].includes(s[0])) return;
    shot(s[0], s[3]);
  });
}
function applyEnv() {
  if (!ctx || !uw) return;
  uw.frequency.setTargetAtTime(env.under ? 720 : 20000, ctx.currentTime, 0.12);
  if (verbSend) verbSend.gain.setTargetAtTime(env.under ? 1.5 : 0.9, ctx.currentTime, 0.3);
  if (amb) for (const n of amb.nodes) { let k = 1; if (n.id === 'insect') k = env.night ? 1.4 : 0.5; if (n.id === 'wind') k = env.under ? 0.2 : env.wind; n.g.gain.setTargetAtTime(n.base * k, ctx.currentTime, 0.8); }
  if (env.rain > 0.05 && !rainNode) rainNode = startLoop('rain', 0, null);
  if (rainNode) { rainNode.g.gain.setTargetAtTime(env.under ? 0 : env.rain * 0.55, ctx.currentTime, 1.0); if (env.rain <= 0.05 && !env.under) { stopLoops([rainNode]); rainNode = null; } }
}
export function setEnv(o) {
  let ch = false; for (const k in o) if (env[k] !== o[k] && (typeof o[k] !== 'number' || Math.abs(env[k] - o[k]) > 0.08)) { env[k] = o[k]; ch = true; }
  if (ch) applyEnv();
}

// ---------------------------------------------------------------- музыка
const SC = {   // root (Гц), лад (полутона), bpm, прогрессия (степени лада на такт), тембры
  forest: { root: 220, sc: [0, 2, 4, 7, 9], bpm: 76, prog: [0, 2, 3, 1], pad: 'pad', lead: 'flute', bass: 'bass', pulse: 0 },
  snow: { root: 247, sc: [0, 2, 5, 7, 9], bpm: 60, prog: [0, 3, 2, 1], pad: 'string', lead: 'bell', bass: 'bass', pulse: 0 },
  mountain: { root: 164, sc: [0, 2, 3, 7, 10], bpm: 70, prog: [0, 3, 1, 2], pad: 'string', lead: 'flute', bass: 'bass', pulse: 1 },
  desert: { root: 196, sc: [0, 1, 4, 5, 7, 8, 10], bpm: 84, prog: [0, 1, 0, 3], pad: 'pad', lead: 'pluck', bass: 'bass', pulse: 2 },
  swamp: { root: 146, sc: [0, 3, 5, 6, 7, 10], bpm: 64, prog: [0, 2, 1, 3], pad: 'pad', lead: 'bell', bass: 'bass', pulse: 0 },
  volcano: { root: 123, sc: [0, 1, 3, 6, 7, 10], bpm: 92, prog: [0, 1, 3, 1], pad: 'string', lead: 'brass', bass: 'bass', pulse: 2 },
  reef: { root: 262, sc: [0, 2, 4, 7, 9], bpm: 68, prog: [0, 2, 3, 1], pad: 'pad', lead: 'bell', bass: 'bass', pulse: 0 },
  kelp: { root: 196, sc: [0, 2, 3, 7, 9], bpm: 60, prog: [0, 1, 3, 2], pad: 'pad', lead: 'bell', bass: 'bass', pulse: 0 },
  arctic: { root: 233, sc: [0, 2, 5, 7, 10], bpm: 54, prog: [0, 2, 1, 3], pad: 'string', lead: 'bell', bass: 'bass', pulse: 0 },
  vents: { root: 110, sc: [0, 1, 3, 6, 7, 10], bpm: 72, prog: [0, 1, 0, 3], pad: 'string', lead: 'bell', bass: 'bass', pulse: 1 },
  abyss: { root: 98, sc: [0, 1, 5, 6, 10], bpm: 48, prog: [0, 1, 0, 2], pad: 'string', lead: 'bell', bass: 'bass', pulse: 0 },
  duel: { root: 196, sc: [0, 3, 5, 7, 10], bpm: 116, prog: [0, 3, 1, 2], pad: 'string', lead: 'brass', bass: 'bass', pulse: 2 },
  menu: { root: 220, sc: [0, 2, 4, 7, 9], bpm: 70, prog: [0, 2, 3, 1], pad: 'pad', lead: 'flute', bass: 'bass', pulse: 0 },
  story: { root: 196, sc: [0, 2, 3, 7, 9], bpm: 50, prog: [0, 3, 1, 2], pad: 'string', lead: 'bell', bass: 'bass', pulse: 0 },
  finale: { root: 262, sc: [0, 2, 4, 7, 9], bpm: 58, prog: [0, 3, 2, 4], pad: 'string', lead: 'bell', bass: 'bass', pulse: 0 }
};
export function setScene(b) { if (b !== biome) { biome = b; step_ = 0; schedT = 0; if (ctx) startAmbience(); } }
export function setCombat(on) { combat = !!on; }
export function setBoss(on) { boss = !!on; }
export function setMood(m) { mood = m || ''; }
const hz = (S, deg, oct) => S.root * Math.pow(2, (S.sc[((deg % S.sc.length) + S.sc.length) % S.sc.length] + 12 * (oct + Math.floor(deg / S.sc.length))) / 12);
function env_(g, t, a, d, peak, rel) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0.0001, t + a + d, rel); }
function inst(kind, f, t, dur, vel, bus) {
  const out = ctx.createGain(); out.connect(bus); const stop = t + dur + 3;
  const osc = (type, fr, det) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; if (det) o.detune.value = det; o.start(t); o.stop(stop); return o; };
  if (kind === 'pad' || kind === 'string') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(kind === 'pad' ? 700 : 1100, t); lp.frequency.linearRampToValueAtTime(kind === 'pad' ? 1300 : 2200, t + dur * 0.7); lp.Q.value = 0.6; lp.connect(out);
    [-9, 0, 8].forEach((d, i) => { const o = osc(kind === 'pad' ? 'sawtooth' : 'sawtooth', f * (i === 1 ? 1 : 1), d), g = ctx.createGain(); g.gain.value = 0.28; o.connect(g); g.connect(lp); });
    if (kind === 'string') { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.2; lg.gain.value = 0.18 * vel; lfo.connect(lg); lg.connect(out.gain); lfo.start(t); lfo.stop(stop); }
    env_(out, t, kind === 'pad' ? 1.6 : 2.0, dur - 1.2, vel * 0.5, 1.4);
  } else if (kind === 'bass') {
    const o = osc('sine', f / 2), o2 = osc('triangle', f / 2, 4), g2 = ctx.createGain(); g2.gain.value = 0.4; o.connect(out); o2.connect(g2); g2.connect(out); env_(out, t, 0.04, dur * 0.7, vel, 0.5);
  } else if (kind === 'bell') {
    const o = osc('sine', f), o2 = osc('sine', f * 2.756), o3 = osc('sine', f * 5.4), g2 = ctx.createGain(), g3 = ctx.createGain(); g2.gain.value = 0.25; g3.gain.value = 0.08; o.connect(out); o2.connect(g2); g2.connect(out); o3.connect(g3); g3.connect(out); env_(out, t, 0.005, 0.05, vel * 0.8, 0.9);
  } else if (kind === 'pluck') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.5); lp.connect(out); const o = osc('sawtooth', f), o2 = osc('triangle', f * 2.003); o.connect(lp); const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2); g2.connect(lp); env_(out, t, 0.004, 0.02, vel * 0.8, 0.28);
  } else if (kind === 'flute') {
    const o = osc('sine', f), o2 = osc('sine', f * 2, 3), g2 = ctx.createGain(); g2.gain.value = 0.18; o2.connect(g2); const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.008, t + 0.4); vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(stop); o.connect(out); g2.connect(out);
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2; const ng = ctx.createGain(); ng.gain.setValueAtTime(0.12, t); ng.gain.setTargetAtTime(0.015, t, 0.05); n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t); n.stop(stop);
    env_(out, t, 0.09, dur * 0.8, vel * 0.7, 0.25);
  } else if (kind === 'brass') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.25); lp.connect(out); [-6, 6].forEach((d) => { const o = osc('sawtooth', f, d); o.connect(lp); }); env_(out, t, 0.1, dur * 0.6, vel * 0.35, 0.3);
  }
}
let chordFlip = 0;
function sched() {
  if (!ctx || ctx.state !== 'running') return;
  ambTick();
  if (!musicOn || !biome) return;
  const S = SC[mood && SC[mood] ? mood : biome] || SC.forest, fight = combat && !mood, bs = boss && fight, bpm = S.bpm * (bs ? 1.35 : fight ? 1.5 : 1), eighth = 60 / bpm / 2;
  if (schedT < ctx.currentTime) schedT = ctx.currentTime + 0.05;
  while (schedT < ctx.currentTime + 0.6) {
    const t = schedT, st = step_ % 32, bar = (st >> 3), chord = S.prog[bar % S.prog.length];
    if (st % 8 === 0) {
      // аккорд: терция-квинта по ладу; бас и подложка
      inst(S.pad, hz(S, chord, 0), t, eighth * 8 + 0.5, fight ? 0.55 : 0.4, musG); inst(S.pad, hz(S, chord + 2, 0), t, eighth * 8 + 0.5, fight ? 0.4 : 0.3, musG); if (!mood || mood === 'finale') inst(S.pad, hz(S, chord + 4, 0), t, eighth * 8 + 0.5, 0.28, musG);
      inst(S.bass, hz(S, chord, -1), t, eighth * 8, fight ? 0.7 : 0.45, musG);
    }
    // мелодия: фразы по гамме аккорда
    const p = fight ? 0.55 : mood ? 0.3 : biome === 'snow' || biome === 'abyss' ? 0.2 : 0.32;
    if (st % 2 === 0 && Math.random() < p) { const deg = chord + rnd([0, 1, 2, 2, 4, 4, 5, 7]), oct = rnd([0, 0, 1]); inst(fight && S.lead !== 'brass' ? 'pluck' : S.lead, hz(S, deg, oct), t, eighth * rnd([2, 3, 4]), fight ? 0.5 : 0.4, musG); }
    // ритм
    if (fight) {
      if (st % 4 === 0) play(getBuf('M:taiko', () => D.drum('taiko', 3)), { t, g: bs ? 0.9 : 0.6, dest: musG, send: 0.2 });
      if (bs && st % 8 === 6) play(getBuf('M:taiko2', () => D.drum('taiko', 5)), { t, g: 0.7, dest: musG, rate: 0.8 });
      if (st % 2 === 1) play(getBuf('M:shk', () => D.drum('shaker', 1)), { t, g: 0.3, dest: musG });
      if (st % 2 === 0) inst('pluck', hz(S, chord + (st % 8 === 4 ? 4 : 0), -1), t, eighth, 0.4, musG);
      if (bs && st % 16 === 0) inst('brass', hz(S, chord, -1), t, eighth * 5, 0.8, musG);
    } else if (S.pulse === 2 && st % 4 === 0) play(getBuf('M:tom', () => D.drum('tom', 2)), { t, g: 0.35, dest: musG, rate: 0.8 });
    else if (S.pulse === 1 && st % 16 === 0) play(getBuf('M:tom', () => D.drum('tom', 2)), { t, g: 0.3, dest: musG, rate: 0.6 });
    schedT += eighth; step_++;
  }
}
export const _dbg = () => ({ ctx, comp, master, cache });

// заранее собираем самые частые звуки по одному за такт простоя, чтобы бой не «запинался» на синтезе
function prewarm() {
  const jobs = [];
  for (const n of ['hit', 'bite', 'thud', 'hurt', 'swing', 'eat_plant', 'eat_meat', 'die', 'crit', 'dash', 'splash', 'coin', 'warn']) { const d = SFX[n]; for (let v = 0; v < d[1]; v++) jobs.push(() => getBuf('sfx:' + n + ':' + v, () => d[0](31 + v * 17 + n.length * 3))); }
  for (const kind of ['carn', 'herb', 'fly', 'aqua']) for (let sk = 0; sk < 5; sk += 2) jobs.push(() => getBuf('roar:' + kind + ':' + sk + ':0', () => roarGen(kind, sk, 0)));
  for (const s of ['grass', 'dirt', 'rock', 'sand', 'snow', 'mud', 'water']) for (const mk of [0.6, 1, 1.6]) jobs.push(() => getBuf('step:' + s + ':' + mk + ':0', () => D.footstep(s, mk, 5)));
  let i = 0; const run = () => { if (!ctx || i >= jobs.length) return; try { jobs[i++](); } catch (e) { /* ignore */ } setTimeout(run, 35); }; run();
}

/* Звук без файлов: эффекты и музыка (по биому, с боевой темой) синтезируются Web Audio. */
let ctx = null, master = null, sfxG = null, musG = null, noiseBuf = null;
let vol = 0.7, musicOn = true, biome = null, combat = false, schedT = 0, step = 0, timer = 0, enabled = true;
try { vol = parseFloat(localStorage.getItem('dino_vol') || '0.7'); musicOn = localStorage.getItem('dino_music') !== '0'; } catch (e) { /* ignore */ }

export function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
    sfxG = ctx.createGain(); sfxG.gain.value = 0.9; sfxG.connect(master);
    musG = ctx.createGain(); musG.gain.value = musicOn ? 0.35 : 0; musG.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    timer = setInterval(sched, 120);
  } catch (e) { enabled = false; }
}
export function setVolume(v) { vol = v; try { localStorage.setItem('dino_vol', String(v)); } catch (e) { /* ignore */ } if (master) master.gain.value = v; }
export function setMusic(on) { musicOn = on; try { localStorage.setItem('dino_music', on ? '1' : '0'); } catch (e) { /* ignore */ } if (musG) musG.gain.value = on ? 0.35 : 0; }
export const getVolume = () => vol; export const getMusic = () => musicOn;

function tone(freq, t0, dur, type, gain, dest, slide) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.03, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(t0, dur, gain, dest, f0, f1, type) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t0); s.stop(t0 + dur + 0.05);
}
const lastPlay = {};
export function sfx(name, pan) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (lastPlay[name] && now - lastPlay[name] < 0.06) return; lastPlay[name] = now;
  const d = sfxG, t = now;
  switch (name) {
    case 'hit': noise(t, 0.14, 0.5, d, 1800, 300); tone(160, t, 0.12, 'square', 0.18, d, 80); break;
    case 'thud': noise(t, 0.22, 0.6, d, 500, 70); tone(75, t, 0.28, 'sine', 0.5, d, 38); break;      // тяжёлый удар
    case 'crit': noise(t, 0.1, 0.45, d, 5200, 1200); tone(1500, t, 0.1, 'square', 0.1, d, 700); tone(180, t, 0.18, 'square', 0.22, d, 70); noise(t + 0.02, 0.2, 0.4, d, 700, 120); break;
    case 'crack': noise(t, 0.06, 0.55, d, 4200, 1600); noise(t + 0.03, 0.05, 0.3, d, 2600, 900); tone(1200, t, 0.03, 'square', 0.06, d, 600); break;
    case 'bite': noise(t, 0.1, 0.35, d, 3000, 600, 'bandpass'); tone(220, t, 0.09, 'sawtooth', 0.12, d, 120); break;
    case 'swing': noise(t, 0.12, 0.18, d, 900, 2400, 'bandpass'); break;
    case 'hurt': tone(300, t, 0.2, 'sawtooth', 0.22, d, 110); noise(t, 0.12, 0.25, d, 1200, 300); break;
    case 'die': tone(260, t, 0.9, 'sawtooth', 0.28, d, 50); noise(t, 0.6, 0.3, d, 900, 80); break;
    case 'eat': tone(520, t, 0.07, 'triangle', 0.2, d, 700); tone(700, t + 0.07, 0.08, 'triangle', 0.2, d, 520); break;
    case 'coin': tone(988, t, 0.08, 'square', 0.1, d); tone(1318, t + 0.08, 0.16, 'square', 0.1, d); break;
    case 'level': [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.09, 0.22, 'triangle', 0.22, d)); break;
    case 'evo': [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.07, 0.3, 'sine', 0.2, d)); noise(t, 0.6, 0.12, d, 600, 6000, 'highpass'); break;
    case 'roar': tone(110, t, 0.9, 'sawtooth', 0.3, d, 60); tone(150, t, 0.9, 'square', 0.12, d, 70); noise(t, 0.8, 0.25, d, 700, 120); break;
    case 'screech': tone(1400, t, 0.5, 'sawtooth', 0.15, d, 2600); tone(1800, t + 0.05, 0.4, 'square', 0.08, d, 900); break;
    case 'dash': noise(t, 0.25, 0.3, d, 400, 3000, 'bandpass'); break;
    case 'boss': tone(70, t, 1.6, 'sawtooth', 0.35, d, 45); tone(105, t, 1.6, 'square', 0.15, d, 60); noise(t, 1.2, 0.3, d, 500, 80); break;
    case 'warn': tone(440, t, 0.14, 'square', 0.1, d); tone(440, t + 0.2, 0.14, 'square', 0.1, d); break;
    case 'boom': noise(t, 0.7, 0.55, d, 900, 50); tone(70, t, 0.6, 'sine', 0.4, d, 30); break;
    case 'portal': tone(300, t, 0.9, 'sine', 0.25, d, 1200); tone(450, t + 0.1, 0.8, 'triangle', 0.15, d, 1500); break;
    case 'king': [392, 494, 587, 784, 988].forEach((f, i) => tone(f, t + i * 0.12, 0.5, 'triangle', 0.25, d)); break;
    case 'click': tone(660, t, 0.05, 'square', 0.07, d); break;
    case 'duelgo': tone(330, t, 0.15, 'square', 0.2, d); tone(660, t + 0.15, 0.3, 'square', 0.2, d); break;
    case 'count': tone(440, t, 0.12, 'square', 0.15, d); break;
    case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.1, 0.3, 'triangle', 0.25, d)); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, t + i * 0.16, 0.35, 'sawtooth', 0.14, d)); break;
    case 'splash': noise(t, 0.3, 0.3, d, 2500, 400); break;
    case 'emote': tone(880, t, 0.08, 'sine', 0.12, d, 1200); break;
    case 'shock': noise(t, 0.2, 0.3, d, 6000, 1500, 'highpass'); tone(600, t, 0.2, 'square', 0.1, d, 1600); break;
  }
}

// ---------- музыка ----------
const SCALES = {
  forest: { root: 220, sc: [0, 2, 4, 7, 9], bpm: 78, lead: 'triangle', pad: 'sine' },
  snow: { root: 247, sc: [0, 2, 5, 7, 9], bpm: 62, lead: 'sine', pad: 'sine' },
  mountain: { root: 164, sc: [0, 2, 3, 7, 10], bpm: 70, lead: 'triangle', pad: 'sawtooth' },
  desert: { root: 196, sc: [0, 1, 4, 5, 7, 8, 10], bpm: 88, lead: 'square', pad: 'triangle' },
  swamp: { root: 146, sc: [0, 3, 5, 6, 7, 10], bpm: 66, lead: 'sine', pad: 'triangle' },
  volcano: { root: 123, sc: [0, 1, 3, 6, 7, 10], bpm: 96, lead: 'sawtooth', pad: 'sawtooth' },
  reef: { root: 262, sc: [0, 2, 4, 7, 9], bpm: 70, lead: 'sine', pad: 'sine' },
  kelp: { root: 196, sc: [0, 2, 3, 7, 9], bpm: 62, lead: 'sine', pad: 'triangle' },
  arctic: { root: 233, sc: [0, 2, 5, 7, 10], bpm: 56, lead: 'sine', pad: 'sine' },
  vents: { root: 110, sc: [0, 1, 3, 6, 7, 10], bpm: 74, lead: 'triangle', pad: 'sawtooth' },
  abyss: { root: 98, sc: [0, 1, 5, 6, 10], bpm: 50, lead: 'sine', pad: 'sawtooth' },
  duel: { root: 196, sc: [0, 3, 5, 7, 10], bpm: 120, lead: 'square', pad: 'sawtooth' },
  menu: { root: 220, sc: [0, 2, 4, 7, 9], bpm: 72, lead: 'triangle', pad: 'sine' }
};
export function setScene(b) { if (b !== biome) { biome = b; step = 0; schedT = 0; } }
export function setCombat(on) { combat = !!on; }
const rnd = (a) => a[(Math.random() * a.length) | 0];
function sched() {
  if (!ctx || !musicOn || ctx.state !== 'running' || !biome) return;
  const S = SCALES[biome] || SCALES.forest, bpm = S.bpm * (combat ? 1.5 : 1), eighth = 60 / bpm / 2;
  if (schedT < ctx.currentTime) schedT = ctx.currentTime + 0.05;
  while (schedT < ctx.currentTime + 0.5) {
    const t = schedT, st = step % 32, f = (deg, oct) => S.root * Math.pow(2, (S.sc[deg % S.sc.length] + 12 * (oct + Math.floor(deg / S.sc.length))) / 12);
    // бас-педаль каждые 8 шагов
    if (st % 8 === 0) tone(f(st === 16 ? 2 : 0, -1), t, eighth * 8, S.pad, combat ? 0.16 : 0.1, musG);
    if (st % 16 === 0 && !combat) { tone(f(0, 0), t, eighth * 16, 'sine', 0.05, musG); tone(f(2, 0), t, eighth * 16, 'sine', 0.04, musG); }
    // мелодия: редкие ноты, в бою — чаще
    const p = combat ? 0.7 : biome === 'snow' ? 0.25 : 0.4;
    if (Math.random() < p && st % 2 === 0) tone(f((Math.random() * 7) | 0, rnd([0, 0, 1])), t, eighth * rnd([1.5, 2, 3]), S.lead, combat ? 0.07 : 0.06, musG);
    // ритм
    if (combat || biome === 'desert' || biome === 'volcano' || biome === 'duel') {
      if (st % 4 === 0) { tone(80, t, 0.14, 'sine', combat ? 0.35 : 0.2, musG, 40); }
      if (combat && st % 4 === 2) noise(t, 0.07, 0.12, musG, 5000, 3000, 'highpass');
    }
    if (biome === 'swamp' && Math.random() < 0.08) tone(rnd([600, 800, 1000]), t, 0.08, 'sine', 0.05, musG, 300);
    if (biome === 'volcano' && st % 16 === 0) noise(t, 1.2, 0.08, musG, 200, 60);
    if (biome === 'mountain' && st % 16 === 8) noise(t, 1.5, 0.04, musG, 500, 900, 'bandpass');
    schedT += eighth; step++;
  }
}

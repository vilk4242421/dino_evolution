/* Dino Evolution — клиент: рендер, ввод, предсказание движения, снимки сервера, эффекты, HUD. */
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { DinoNest } from './dinonest.js';
import { buildDino, animateDino, makeActor, makeNameTag, makeHpBar, buildEnemy, setOutline, animateEnemy, buildBoss, animateBoss, setCrown, setCosmetic, makeEggMesh } from './dinos.js';
import * as Profile from './profile.js';
import { connectOnline, connectLocal } from './net.js';
import * as Audio from './audio.js';
import { UI } from './ui.js';

const CONFIG = window.CONFIG, Sim = window.Sim, Core = window.RoomsCore, T = window.T, TN = window.TN;
const $ = id => document.getElementById(id);
const DT = 1 / CONFIG.TICK_RATE, TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => { while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; };
const lerpA = (a, b, t) => a + wrapA(b - a) * t;
const IS_TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');
const F = Core.F, ARCH_IDS = Core.ARCH_IDS;

// ---------------------------------------------------------------- рендерер
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
let scene = new THREE.Scene();
let qualityPref = 'auto', qualityName = IS_TOUCH ? 'med' : 'high';
try { qualityPref = localStorage.getItem('dino_q') || 'auto'; } catch (e) { /* ignore */ }
if (qualityPref !== 'auto') qualityName = qualityPref;
let sens = 1; try { sens = parseFloat(localStorage.getItem('dino_sens') || '1') || 1; } catch (e) { /* ignore */ }

function applyRenderQuality() {
  const Q = CONFIG.QUALITY[qualityName];
  window.__dinoQ = { low: 0.6, med: 0.8, high: 1 }[qualityName] || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  if (S && S.world) S.world.applyQuality(qualityName);
  if (menu3d.world) menu3d.world.applyQuality(qualityName);
}
window.addEventListener('resize', applyRenderQuality);

// ---------------------------------------------------------------- 3D-сцена меню (витрина динозавра и яйцо)
const menu3d = { scene: new THREE.Scene(), group: new THREE.Group(), dino: null, egg: null, world: null, t: 0, hatch: null };
(function initMenu3d() {
  const s = menu3d.scene;
  menu3d.world = buildWorld(s, 'forest');       // живой фон — лес
  menu3d.world.root.traverse(o => { if (o.isInstancedMesh) o.visible = false; });
  s.add(menu3d.group);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.4, 64), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.95 }));
  plat.position.y = -0.2; plat.receiveShadow = true; menu3d.group.add(plat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.12, 12, 64), new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.6 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; menu3d.group.add(rim);
  menu3d.group.position.set(0, 0, 0);
})();
window.__menu3d = menu3d;
function menuSetDino(o) {
  if (menu3d.dino) { menu3d.group.remove(menu3d.dino); menu3d.dino = null; }
  if (!o) return;
  menu3d.dino = buildDino(o); menu3d.dino.scale.setScalar(Math.max(1.3, Sim.scaleOf(o.level || 1) * 1.5));
  menu3d.group.add(menu3d.dino);
  if (menu3d.egg) { menu3d.group.remove(menu3d.egg); menu3d.egg = null; }
}
function makeEgg(colorHex) {
  // гладкая скорлупа: пятна нарисованы на текстуре, наружу ничего не выступает
  const g = makeEggMesh(colorHex); g.position.y = 1.18;
  const w = new THREE.Group(); w.add(g); w.userData = Object.assign({ shell: g }, g.userData); return w;
}
function menuSetDinoKeepEgg(o) {
  if (menu3d.dino) { menu3d.group.remove(menu3d.dino); menu3d.dino = null; }
  menu3d.dino = buildDino(o); menu3d.group.add(menu3d.dino);
}
function menuShowEgg(colorHex) {
  menuSetDino(null);
  if (menu3d.egg) { menu3d.group.remove(menu3d.egg); menu3d.egg = null; }
  menu3d.egg = makeEgg(colorHex); menu3d.group.add(menu3d.egg);
}
function menuHatch(o, done) {
  menuShowEgg(o.color); const eggTxt = $('eggtxt'); eggTxt.style.display = 'block'; eggTxt.textContent = T('hatching');
  const t0 = performance.now();
  menu3d.hatch = { t0, o, done, burst: false, shards: [] };
}
function updateMenu3d(dt) {
  menu3d.t += dt;
  const h = menu3d.hatch;
  if (h) {
    const t = (performance.now() - h.t0) / 1000, egg = menu3d.egg;
    if (t < 3 && egg) {
      const k = Math.min(1, t / 3);
      egg.rotation.z = Math.sin(t * (6 + k * 18)) * (0.05 + k * 0.22); egg.rotation.x = Math.cos(t * (5 + k * 14)) * (0.03 + k * 0.12);
      egg.userData.crack(k);
      if (Math.floor(t * 3) !== h.lastBeep) { h.lastBeep = Math.floor(t * 3); Audio.sfx('hit'); }
    } else if (!h.burst) {
      h.burst = true; Audio.sfx('evo');
      // верхушка отлетает, нижняя половина остаётся и уходит в землю; осколки разлетаются
      if (egg) {
        egg.rotation.set(0, 0, 0);
        const top = egg.userData.hi; h.cap = top; h.capV = new THREE.Vector3(0.6, 4.2, 0.4); h.lo = egg.userData.lo;
        h.eggGroup = egg; h.lo.userData.y0 = 0;
      }
      for (let i = 0; i < 14; i++) {
        const geo = new THREE.SphereGeometry(0.24, 6, 4, Math.random() * 6, 1.2, 1.0 + Math.random(), 0.9);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.6, side: THREE.DoubleSide }));
        const a = i / 14 * TWO_PI; m.position.set(Math.cos(a) * 0.5, 1.7, Math.sin(a) * 0.5); m.castShadow = true;
        m.userData.v = new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 1.5), 2.5 + Math.random() * 2, Math.sin(a) * (2 + Math.random() * 1.5)); menu3d.group.add(m); h.shards.push(m);
      }
      menuSetDinoKeepEgg({ cls: h.o.cls, color: h.o.color, level: 1, evo: {} }); menu3d.dino.scale.setScalar(0.18); menu3d.dino.position.y = 0.35; h.grow = 0;
      $('eggtxt').textContent = T('hatched');
    } else {
      for (const m of h.shards) { m.userData.v.y -= 9 * dt; m.position.addScaledVector(m.userData.v, dt); m.rotation.x += dt * 5; m.rotation.z += dt * 4; if (m.position.y < 0.08) { m.position.y = 0.08; m.userData.v.set(0, 0, 0); } }
      if (h.cap) { h.capV.y -= 9 * dt; h.cap.position.addScaledVector(h.capV, dt); h.cap.rotation.z += dt * 3; h.cap.rotation.x += dt * 1.5; if (h.cap.position.y < -1.0) { h.cap.visible = false; } }
      h.grow = Math.min(1, h.grow + dt * 1.1);
      const k = 1 - Math.pow(1 - h.grow, 3);
      // скорлупа исчезает раньше, чем детёныш становится больше неё
      if (h.lo) { h.lo.position.y = -k * 2.4; if (k > 0.55 && h.eggGroup) { menu3d.group.remove(h.eggGroup); h.eggGroup = null; h.lo = null; menu3d.egg = null; } }
      menu3d.dino.scale.setScalar(0.18 + k * 1.12); menu3d.dino.position.y = 0.35 * (1 - k);
      if (h.grow >= 1 && !h.finishing) { h.finishing = true; setTimeout(() => { for (const m of h.shards) menu3d.group.remove(m); if (h.eggGroup) menu3d.group.remove(h.eggGroup); menu3d.egg = null; $('eggtxt').style.display = 'none'; menu3d.hatch = null; h.done && h.done(); }, 1400); }
    }
  }
  if (menu3d.dino) { menu3d.dino.rotation.y += dt * 0.6; animateDino(menu3d.dino, menu3d.t, menu3d.dino.userData.dbgSpeed || 0, dt, menu3d.dino.userData.dbgSt || {}); }
  // камера: чуть вбок, чтобы карточка слева не закрывала динозавра
  const wide = window.innerWidth > 900, ox = wide ? 2.1 : 0, by = menu3d.world.sim.def.arenaY + 0.25;
  camera.position.set(Math.sin(menu3d.t * 0.12) * 0.5 + (wide ? 0 : 0), by + 2.6, 6.6); camera.lookAt(0, by + (wide ? 1.2 : 2.3), 0);
  camera.fov = wide ? 50 : 66; camera.updateProjectionMatrix();
  menu3d.group.position.set(ox, by, 0);
  menu3d.world.update(camera.position, { x: 0, y: by, z: 0 }, menu3d.t, dt, 0.42, 0);
}

// ---------------------------------------------------------------- ввод
const keys = new Set();
const input = { yaw: 0, pitch: 0.28, zoom: 1, atk: false, joyX: 0, joyY: 0, jump: false, down: false, sprint: false, locked: false };
let panelOpen = false;
// полный сброс ввода: зажатые клавиши, стик, кнопки. Нужен при выходе в меню, входе в игру и потере фокуса —
// иначе «залипший» стик или клавиша тянут динозавра в сторону сами по себе
let resetTouch = () => {};
function resetInput() {
  keys.clear(); input.atk = input.jump = input.down = input.sprint = input.drag = false; input.joyX = input.joyY = 0;
  resetTouch();
}
window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  const k = e.code;
  if (k === 'Tab') { e.preventDefault(); if (S && S.welcomed && !panelOpen) toggleMap(); return; }        // Tab — большая карта
  if (k === 'Escape' && mapOpen) { toggleMap(false); return; }
  if (k === 'KeyP' && S && S.welcomed && !e.repeat) { UI.openPlayers(); return; }
  if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault(); return; }
  keys.add(k);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
  if (!S || !S.welcomed || panelOpen) return;
  if (k === 'KeyE') act('e'); else if (k === 'KeyQ') act('q'); else if (k === 'KeyF') act('f');
  else if (k === 'KeyV') UI.openEvo(); else if (k === 'KeyM') UI.openPause();
  else if (k >= 'Digit1' && k <= 'Digit4') S.conn.send({ t: 'act', a: 'em', i: +k.slice(5) - 1 });
});
window.addEventListener('keyup', e => keys.delete(e.code));
const skipHatch = () => { if (S && S.hatch && !S.hatch.done && clock - S.hatch.t0 > 1.5) S.hatch.skip = true; };
window.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') skipHatch(); });
window.addEventListener('pointerdown', skipHatch);
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
canvas.addEventListener('mousedown', e => {
  Audio.init();
  if (!S || !S.welcomed || panelOpen) return;
  if (!IS_TOUCH && document.pointerLockElement !== canvas && e.button === 0) { try { canvas.requestPointerLock(); } catch (x) { /* ignore */ } }
  if (e.button === 0) input.atk = true; if (e.button === 2) input.drag = true;
});
window.addEventListener('mouseup', e => { if (e.button === 0) input.atk = false; if (e.button === 2) input.drag = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousemove', e => {
  if (!S || !S.welcomed || panelOpen) return;
  if (document.pointerLockElement === canvas || input.drag) { input.yaw -= e.movementX * 0.0032 * sens; input.pitch = clamp(input.pitch + e.movementY * 0.0030 * sens, -0.5, 1.25); }
});
canvas.addEventListener('wheel', e => { input.zoom = clamp(input.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.55, 1.9); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  input.locked = document.pointerLockElement === canvas;
  if (!input.locked && S && S.welcomed && !panelOpen && !mapOpen && !S.ending && !S.noPause) UI.openPause();
});
// сенсор: стик слева, свайп справа
(function touchInit() {
  const joy = $('joy'), knob = joy.querySelector('i'); let jid = null, cid = null, cx = 0, cy = 0;
  joy.addEventListener('touchstart', e => { const t = e.changedTouches[0]; jid = t.identifier; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; mv(t); e.preventDefault(); Audio.init(); }, { passive: false });
  function mv(t) { let dx = (t.clientX - cx) / 55, dy = (t.clientY - cy) / 55; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } input.joyX = dx; input.joyY = dy; knob.style.transform = `translate(${dx * 38}px,${dy * 38}px)`; }
  window.addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (t.identifier === jid) mv(t); else if (t.identifier === cid && S && !panelOpen) { input.yaw -= (t.clientX - cx2) * 0.0058 * sens; input.pitch = clamp(input.pitch + (t.clientY - cy2) * 0.0046 * sens, -0.5, 1.25); cx2 = t.clientX; cy2 = t.clientY; } } }, { passive: true });
  let cx2 = 0, cy2 = 0;
  const end = e => { for (const t of e.changedTouches) { if (t.identifier === jid) { jid = null; input.joyX = input.joyY = 0; knob.style.transform = ''; } if (t.identifier === cid) cid = null; } };
  window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
  canvas.addEventListener('touchstart', e => { Audio.init(); for (const t of e.changedTouches) if (cid === null && t.clientX > window.innerWidth * 0.3) { cid = t.identifier; cx2 = t.clientX; cy2 = t.clientY; } }, { passive: true });
  const hold = (id, fn) => { const b = $(id); const on = e => { e.preventDefault(); b.classList.add('held'); fn(true); }; const off = e => { b.classList.remove('held'); fn(false); }; b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off); b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off); };
  resetTouch = () => { jid = null; cid = null; knob.style.transform = ''; document.querySelectorAll('#hud .held').forEach(b => b.classList.remove('held')); };
  hold('tb-jump', v => input.jump = v); hold('tb-sprint', v => input.sprint = v); hold('tb-atk', v => input.atk = v); hold('tb-down', v => input.down = v);
})();
function act(a) { if (S && S.conn && S.welcomed && S.alive) S.conn.send({ t: 'act', a }); }
function readInput() {
  let f = 0, s = 0;
  if (!panelOpen) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    f += -input.joyY; s += input.joyX;
  }
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  const ok = !panelOpen;
  return { f, s, yaw: input.yaw, pitch: input.pitch, jump: ok && (keys.has('Space') || input.jump), down: ok && (keys.has('KeyC') || keys.has('ControlLeft') || input.down), sprint: ok && (keys.has('ShiftLeft') || keys.has('ShiftRight') || input.sprint) };
}

// ---------------------------------------------------------------- состояние сессии
let S = null;
const prefersRu = () => window.I18N.lang === 'ru';
function newSession(o) {
  return {
    o, conn: null, welcomed: false, ending: false, id: 0, room: null, world: null, W: null, biome: null, me: null, stats: null, profile: null, alive: true,
    pending: [], seq: 0, lastRs: null, off: { x: 0, y: 0, z: 0 }, players: new Map(), ents: new Map(), actor: null, mp: null, bs: null, pt: null, du: null, rush: null, al: null,
    drops: [], tod: 0.4, wx: 0, snapN: 0, lastSnapAt: 0, camShake: 0, speed: 0, lastPos: null, recent: [], effects: [], texts: [], zones: [], foodMeshes: [], lastAtk: 0,
    ping: 0, tq: 0, noPause: false, sense: 0, ach: null, bossName: '', king: false, lord: false, fx: { rings: [], parts: [] }
  };
}
const activeProfile = () => (S && S.o.online ? Profile.state.profile : Profile.state.local);

function startSession(o) {
  Audio.init(); resetInput();
  if (S) endSession(true);
  UI.closeAll(); UI.showLoading(true);
  const prof = o.online ? Profile.state.profile : Profile.state.local;
  if (!prof || !prof.hatched) { UI.showLoading(false); UI.toast(T('no_character')); UI.showMenu(); return; }
  if (ctl.pendingHatch) o.hatch = true;
  S = newSession(o);
  const mine = S;
  const h = {
    onmsg: m => { if (S === mine) handleMsg(m); },
    onclose: reason => { if (S !== mine || mine.ending) return; failSession(reason); },
    onSave: p => { Profile.saveLocal(p); }
  };
  if (o.online) S.conn = connectOnline({ token: Profile.state.token, biome: o.biome, cls: o.cls, mode: o.mode, code: o.code }, h);
  else S.conn = connectLocal({ profile: JSON.parse(JSON.stringify(prof)), biome: o.biome, cls: o.cls, mode: o.mode }, h);
  // страховка: если за 10 секунд сервер не ответил — вернуться в меню
  setTimeout(() => { if (S === mine && !mine.welcomed && !mine.ending) failSession('timeout'); }, 10000);
}
function failSession(reason) {
  fade(false, 500);
  const wasWelcomed = S && S.welcomed; const msg = reason === 'replaced' ? T('replaced') : wasWelcomed ? T('conn_lost') : (reason === 'error' || reason === 'timeout') ? T('server_off') : T(reason, null);
  endSession(false); UI.toast(msg); UI.showMenu();
}
function endSession(silent) {
  if (!S) return;
  S.ending = true;
  if (S.hatch && S.hatch.grp) { S.hatch.grp.parent && S.hatch.grp.parent.remove(S.hatch.grp); }
  try { S.conn && S.conn.close(); } catch (e) { /* ignore */ }
  if (S.world) S.world.dispose();
  for (const p of S.players.values()) p.actor && p.actor.dispose();
  S = null; scene = menu3d.scene; Audio.setScene('menu'); Audio.setCombat(false);
  if (document.pointerLockElement) document.exitPointerLock();
  $('hud').classList.remove('on'); $('respawn').classList.remove('on'); $('dreq').classList.remove('on'); $('bossbar').style.display = 'none'; $('duelbar').style.display = 'none'; $('tq').style.display = 'none';
  panelOpen = false; resetInput();
  if (!silent) { Profile.refreshProfile(); }
  UI.showLoading(false);
}

// ---------------------------------------------------------------- сообщения сервера
function handleMsg(m) {
  switch (m.t) {
    case 'welcome': onWelcome(m); break;
    case 's': onSnapshot(m); break;
    case 'join': if (S.welcomed) addPlayer(m.p); break;
    case 'leave': removePlayer(m.id); break;
    case 'upd': { const p = S.players.get(m.p.id); if (p && p.actor) { p.info = Object.assign(p.info, m.p); p.actor.set(m.p); if (m.p.king || m.p.lord) p.actor.set({ king: p.info.king, lord: p.info.lord }); } else if (m.p.id === S.id && S.actor) { S.actor.set(m.p); } break; }
    case 'prof': onProfile(m.p); break;
    case 'dead': S.deadBy = m.by; $('respawn').classList.add('on'); $('rs-s').textContent = m.by ? T('killed_by', { x: m.by }) : ''; break;
    case 'duelreq': UI.duelRequest(m.from, m.nick); Audio.sfx('warn'); break;
    case 'tq': S.tq = m.n | 0; updateTq(m); break;
    case 'info': UI.toast(T(m.m)); if (m.m === 'duel_start') Audio.sfx('duelgo'); break;
    case 'err': onErr(m); break;
    case 'pong': S.ping = Math.round(performance.now() - m.n); break;
    case 'rushend': UI.banner(T('rush_end', { n: m.wave }), 4000); break;
  }
}
function onErr(m) {
  const k = m.m;
  if (!S.welcomed && k !== 'cooldown') { failSession(k === 'unauthorized' ? 'unauthorized' : k === 'full' ? 'room_full' : k === 'bad_code' ? 'bad_code' : k === 'locked' ? 'locked' : k === 'no_character' ? 'no_character' : k); return; }
  if (k === 'replaced') { failSession('replaced'); return; }
  const map = { cooldown: 'cooldown', need_fly: 'need_fly', no_tree: 'no_tree', duel_bad: 'duel_bad', duel_busy: 'duel_busy', coins: 'coins_err', evo_level: 'evo_level', evo_points: 'evo_points_err', evo_max: 'evo_max_err', evo_locked: 'evo_locked' };
  if (k === 'boss_level') UI.toast(T('boss_level', { n: m.n })); else UI.toast(T(map[k] || k));
}
function updateTq(m) {
  const el = $('tq'); if (!m.n) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.firstElementChild.textContent = T('tourney_wait', { n: m.n }) + (m.code ? ' · ' + m.code : ''); $('tq-x').textContent = T('tourney_cancel');
}
$('tq-x').addEventListener('click', () => S && S.conn.send({ t: 'tourney_cancel' }));

function buildWorldFor(biome) {
  if (S.world) S.world.dispose();
  scene = new THREE.Scene();
  S.world = buildWorld(scene, biome); S.W = S.world.sim; S.biome = biome; S.world.applyQuality(qualityName);
  S.texts.length = 0; S.fx = { rings: [], parts: [] }; initFx();   // эффекты и всплывающие цифры живут в сцене мира
  Audio.setScene(biome);
}
function onWelcome(m) {
  if (m.proto !== CONFIG.PROTO) { failSession('server_off'); return; }
  const first = !S.welcomed; S.welcomed = true; S.id = m.id; S.room = m.room;
  if (!S.world || S.biome !== m.room.biome) buildWorldFor(m.room.biome);
  for (const p of S.players.values()) p.actor && p.actor.dispose();
  for (const e of S.ents.values()) e.group && e.group.parent && e.group.parent.remove(e.group);
  S.players.clear(); S.ents.clear(); S.pending.length = 0; S.lastRs = null; S.off = { x: 0, y: 0, z: 0 }; S.drops = []; S.zones.forEach(z => z.mesh.parent && z.mesh.parent.remove(z.mesh)); S.zones = [];
  S.bs = null; S.du = null; S.rush = null; S.pt = null; S.al = null;
  S.me = Sim.newPlayer(S.W, m.me.x, m.me.z); Sim.importState(S.me, m.me); S.lastPos = null;
  onProfile(m.prof, true);
  S.actor && S.actor.dispose();
  const pr = S.profile;
  S.actor = makeActor({ nick: pr.name, color: pr.color, cls: pr.cls, level: pr.level, evo: pr.evo, cosmetic: pr.cosmetic, admin: Profile.state.admin && S.o.online, king: pr.kings.indexOf(m.room.biome) >= 0, lord: Sim.isLord(pr) });
  scene.add(S.actor.group);
  for (const p of m.players) addPlayer(p);
  S.tod = m.tod; input.yaw = S.me.face + Math.PI; input.pitch = 0.3; S.snapN = 0;
  S.world.setPortalNext(false);
  UI.showLoading(false); UI.closeAll(); $('hud').classList.add('on'); S.lastHud = 0; buildAbilityBar();
  const inDuel = m.room.biome === 'duel';
  $('hint').textContent = IS_TOUCH ? '' : T('hint_pc'); setTimeout(() => { if ($('hint')) $('hint').style.opacity = 0; }, 14000); $('hint').style.opacity = 0.8;
  const hatchNow = first && S.o.hatch && !inDuel && S.world.nestInfo;
  if (hatchNow) { ctl.pendingHatch = null; beginHatch(); setTimeout(() => fade(false, 1300), 350); }
  else { if (S.o.hatch) { ctl.pendingHatch = null; } fade(false, 900); if (inDuel) { Audio.setScene('duel'); } else if (first) UI.banner(TN(CONFIG.BIOME[m.room.biome].n), 2600); }
  Audio.sfx('portal');
  if (S.o.online) S.pingT = setInterval(() => { if (S && S.conn) S.conn.send({ t: 'ping', n: performance.now() }); }, 4000);
  $('respawn').classList.remove('on');
}
function onProfile(p, silent) {
  const old = S.profile; S.profile = Sim.fixProfile(p);
  if (S.o.online) Profile.setServerProfile(p); else Profile.saveLocal(S.profile);
  S.stats = Sim.statsFor(S.profile.cls, S.profile.level, S.profile.evo);
  S.sense = S.stats.sense || 0;
  if (old && S.actor && old.cls === S.profile.cls && CONFIG.stageIndex(S.profile.level) > CONFIG.stageIndex(old.level) && !silent) {
    const sn = T('stage_' + CONFIG.STAGES[CONFIG.stageIndex(S.profile.level)].id); UI.banner('🦖 ' + T('grew', { s: sn }), 3200); Audio.sfx('coin');
  }
  if (S.actor) S.actor.set({ level: S.profile.level, evo: S.profile.evo, cosmetic: S.profile.cosmetic || '', lord: Sim.isLord(S.profile), king: S.profile.kings.indexOf(S.biome) >= 0 });
  // новые достижения
  const done = {}; for (const a of CONFIG.ACH) done[a.id] = !!a.t(S.profile);
  if (S.ach && !silent) for (const a of CONFIG.ACH) if (done[a.id] && !S.ach[a.id]) { UI.note('🏆 ' + TN(a.n)); Audio.sfx('coin'); }
  S.ach = done;
  if (old && S.profile.coins > old.coins) Audio.sfx('coin');
  UI.refreshOpen && UI.refreshOpen();
}
function addPlayer(info) {
  if (info.id === S.id || S.players.has(info.id)) return;
  const actor = makeActor({ nick: info.nick, color: info.color, cls: info.cls, level: info.level, evo: info.evo, cosmetic: info.cosmetic, admin: info.admin, king: info.king, lord: info.lord, label: info.bot ? '' : '' });
  scene.add(actor.group);
  S.players.set(info.id, { info, actor, buf: [], hp: 100, flags: 0, shown: false, speed: 0 });
}
function removePlayer(id) { const p = S.players.get(id); if (p) { p.actor.dispose(); S.players.delete(id); } }

// ---------------------------------------------------------------- снимки и предсказание
function reconcile(m) {
  const s = m.m, mp = m.mp, me = S.me;
  if (S.lastRs !== mp.rs || !mp.alive) {          // телепорт, возрождение или мы мертвы: берём состояние сервера как есть
    Sim.importState(me, s); S.pending.length = 0; S.lastRs = mp.rs; S.off.x = S.off.y = S.off.z = 0;
    return;
  }
  const t = Sim.newPlayer(S.W, s.x, s.z); Sim.importState(t, s);
  while (S.pending.length && S.pending[0].q <= m.a) S.pending.shift();
  for (const inp of S.pending) Sim.step(t, inp, DT, S.W, S.stats);
  const dx = t.x - me.x, dy = t.y - me.y, dz = t.z - me.z, d = Math.hypot(dx, dy, dz);
  if (d > 4) { S.off.x = S.off.y = S.off.z = 0; }
  else { S.off.x -= dx; S.off.y -= dy; S.off.z -= dz; }
  Object.assign(me, t);
}
function onSnapshot(m) {
  const now = performance.now() / 1000;
  S.snapN++; S.lastSnapAt = now; S.mp = m.mp; S.alive = !!m.mp.alive;
  if (!S.alive && !$('respawn').classList.contains('on') && S.snapN > 2) $('respawn').classList.add('on');
  if (S.alive && $('respawn').classList.contains('on')) $('respawn').classList.remove('on');
  reconcile(m);
  S.tod = m.tod; S.wx = m.wx;
  for (const r of m.p) {
    let p = S.players.get(r[0]);
    if (!p) continue;            // информацию о новом игроке пришлёт 'join'
    p.buf.push({ t: now, x: r[1], y: r[2], z: r[3], f: r[4] }); if (p.buf.length > 8) p.buf.shift();
    p.hp = r[6]; p.flags = r[7]; p.speed = r[5];
  }
  const seen = new Set();
  for (const r of m.e) { seen.add(r[0]); updateEnt(r, now); }
  for (const [id, e] of S.ents) if (!seen.has(id) && now - e.seen > 0.7) { e.group.parent && e.group.parent.remove(e.group); S.ents.delete(id); }
  if (m.f) { S.drops = m.f; S.dropsAt = now; syncFood(); }
  S.bs = m.bs || null; if (m.pt) S.pt = m.pt; S.du = m.du || null; S.rush = m.rush || null; S.al = m.al || null;
  if (S.world) { S.world.setPortalNext(S.pt && S.pt.next); S.world.barrier.visible = !!(S.bs && S.bs.st === 'fight'); }
  Audio.setCombat(!!(S.bs && S.bs.st === 'fight') || !!(S.du && S.du.st === 'fight'));
  if (m.mp.hz) S.hz = { k: m.mp.hz, t: now };
  if (m.ev) for (const ev of m.ev) onEvent(ev, now);
}
function updateEnt(r, now) {
  let e = S.ents.get(r[0]);
  if (!e) {
    const boss = typeof r[1] === 'string';
    let g, arch = null, def = null, bossId = null;
    if (boss) { bossId = r[1].slice(2); def = CONFIG.BOSSES[bossId]; g = buildBoss(bossId, def); }
    else { arch = CONFIG.ENEMIES[ARCH_IDS[r[1]]]; g = buildEnemy(arch); g.scale.multiplyScalar((1 + Math.min(30, r[9]) * 0.012) * Sim.enemySizeMul(r[9])); }
    const group = new THREE.Group(); group.add(g);
    e = { id: r[0], boss, arch, def, bossId, group, model: g, buf: [], seen: now, lv: r[9], hp: r[6], mhp: r[7], flags: 0, tag: null, bar: null, tagKey: '', animT: Math.random() * 10, speed: 0, lastPos: null, shown: true };
    const h = boss ? def.size * 3.6 : arch.size * (arch.model === 'quad' ? 2.4 : arch.model === 'ptero' ? 1.9 : arch.model === 'bug' ? 1.0 : arch.model === 'fish' ? 0.9 : arch.model === 'croc' ? 1.3 : 2.0) + 0.5;
    e.tagY = h * (boss ? 1 : Sim.enemySizeMul(r[9]));
    e.bar = makeHpBar(boss ? 3 : 1.3); e.bar.position.y = h + 0.1; e.bar.visible = false; group.add(e.bar);
    scene.add(group); S.ents.set(r[0], e);
  }
  e.seen = now; e.hp = r[6]; e.mhp = r[7]; const prevF = e.flags; e.flags = r[8]; e.lv = r[9];
  if ((r[8] & 1) && !(prevF & 1)) e.model.userData.bite = 1;
  e.buf.push({ t: now, x: r[2], y: r[3], z: r[4], f: r[5] }); if (e.buf.length > 8) e.buf.shift();
  e.phase = r[9];
}
// интерполяция буфера снимков на момент t
function sample(buf, t, out) {
  const n = buf.length; if (!n) return false;
  if (n === 1 || t <= buf[0].t) { const b = buf[0]; out.x = b.x; out.y = b.y; out.z = b.z; out.f = b.f; return true; }
  for (let i = n - 1; i > 0; i--) {
    const a = buf[i - 1], b = buf[i];
    if (t >= a.t) { const k = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1.25) : 1; out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k; out.f = lerpA(a.f, b.f, clamp(k, 0, 1)); return true; }
  }
  const b = buf[n - 1]; out.x = b.x; out.y = b.y; out.z = b.z; out.f = b.f; return true;
}

// ---------------------------------------------------------------- еда на земле
const foodGeo = {}, foodMat = {};
function foodMesh(k) {
  const col = { plant: 0x6ccf4a, meat: 0xd9534f, smeat: 0xe88a6a, fish: 0x6ac8ff, bug: 0xffe066 }[k] || 0xffffff;
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.55 });
  if (k === 'plant') {
    // кустик папоротника: изогнутые перистые листья двух оттенков зелени
    const gm = [0x3f8f3a, 0x5fb04a, 0x2f7a35].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }));
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.283 + (i % 2) * 0.3, len = 0.75 + (i % 3) * 0.18, geo = new THREE.PlaneGeometry(0.34, len, 3, 6), pa = geo.attributes.position;
      for (let v = 0; v < pa.count; v++) { const y = pa.getY(v) + len / 2, t = y / len, w = Math.sin(Math.min(1, t) * 3.0 + 0.2) * 0.9 + 0.1; pa.setX(v, pa.getX(v) * Math.max(0.12, w) * (1 - 0.5 * t * t)); pa.setY(v, y); pa.setZ(v, t * t * 0.45 * len); }
      geo.computeVertexNormals(); const l = new THREE.Mesh(geo, gm[i % 3]); l.rotation.y = a; l.rotation.x = -0.35; l.position.set(Math.cos(a) * 0.05, 0.02, Math.sin(a) * 0.05); l.castShadow = false; g.add(l);
    }
    // выделение: светящееся кольцо на земле, мягкое сияние и искры над кустом — еду видно издалека на фоне травы
    const ringM = new THREE.MeshBasicMaterial({ color: 0xd8ff5a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const rg = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40), ringM); rg.rotation.x = -Math.PI / 2; rg.position.y = 0.06; g.add(rg);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xc8ff4a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.position.y = 0.55; glow.scale.set(2.4, 2.4, 1); g.add(glow);
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    spark.position.y = 1.5; spark.scale.set(0.45, 0.45, 1); g.add(spark);
    g.scale.setScalar(1.35); g.userData.fx = { rg, glow, spark };
    return g;
  }
  else if (k === 'fish') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), m); b.scale.set(0.5, 0.6, 1.2); b.position.y = 0.35; g.add(b); const t = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 4), m); t.rotation.x = -Math.PI / 2; t.position.set(0, 0.35, -0.4); g.add(t); }
  else if (k === 'bug') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), m); b.position.y = 0.5; g.add(b); }
  else {
    // мясо: жареная ножка — сочный бугристый «барабан», суживающийся к кости, на конце кости две шишечки; лежит на земле наискосок
    const small = k === 'smeat', sc0 = small ? 0.85 : 1.35;
    const prof = [[0.001, 0], [0.12, 0.015], [0.27, 0.1], [0.38, 0.28], [0.42, 0.5], [0.37, 0.72], [0.26, 0.92], [0.14, 1.07], [0.075, 1.18], [0.001, 1.22]].map(([r, y]) => new THREE.Vector2(r, y));
    const mg = new THREE.LatheGeometry(prof, 28), pa = mg.attributes.position, cols = new Float32Array(pa.count * 3), tc = new THREE.Color(), cLo = new THREE.Color(small ? 0xd0743a : 0xb8531f), cHi = new THREE.Color(small ? 0xf0a060 : 0xe58a3e), cDk = new THREE.Color(0x6a2a10);
    for (let v = 0; v < pa.count; v++) {
      let x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v); const n = Math.sin(x * 11 + y * 7) * Math.cos(z * 9 + y * 5) * 0.5 + Math.sin(y * 17 + z * 6) * 0.25, d = 1 + n * 0.09;
      pa.setXYZ(v, x * d, y, z * d);
      tc.copy(cLo).lerp(cHi, Math.max(0, Math.min(1, 0.5 + n * 1.2 + (z > 0 ? 0.25 : -0.1)))).lerp(cDk, Math.max(0, -n * 0.8));
      cols[v * 3] = tc.r; cols[v * 3 + 1] = tc.g; cols[v * 3 + 2] = tc.b;
    }
    mg.setAttribute('color', new THREE.BufferAttribute(cols, 3)); mg.computeVertexNormals();
    const meat = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, emissive: 0x401400, emissiveIntensity: 0.35 }));
    const boneM = new THREE.MeshStandardMaterial({ color: 0xf6f0dc, roughness: 0.5 });
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.5, 10), boneM); bone.position.y = 1.4;
    const kn1 = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), boneM), kn2 = kn1.clone(); kn1.position.set(0.07, 1.68, 0); kn2.position.set(-0.07, 1.66, 0.03);
    const leg = new THREE.Group(); leg.add(meat, bone, kn1, kn2); leg.rotation.z = -1.15; leg.rotation.y = 0.5; leg.position.set(0.42 * sc0, 0.3 * sc0, 0); leg.scale.setScalar(sc0 * 0.62); g.add(leg);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff5a4a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); gl.position.y = 0.5; gl.scale.set(2.0, 2.0, 1); g.add(gl);
    g.userData.fx = { glow: gl };
  }
  return g;
}
function syncFood() {
  const list = S.drops; S.foodMeshes = S.foodMeshes || [];
  while (S.foodMeshes.length > list.length) { const f = S.foodMeshes.pop(); f.parent && f.parent.remove(f); }
  for (let i = 0; i < list.length; i++) {
    const d = list[i]; let f = S.foodMeshes[i];
    if (!f || f.userData.k !== d[3]) { if (f) f.parent.remove(f); f = foodMesh(d[3]); f.userData.k = d[3]; scene.add(f); S.foodMeshes[i] = f; }
    f.position.set(d[0], d[1] > S.W.waterY - 0.6 && S.world && S.world.meshH ? Math.max(d[1], S.world.meshH(d[0], d[2]) + 0.03) : d[1], d[2]);
  }
}

// ---------------------------------------------------------------- эффекты
const NP = 360;
let _sd = null;
function softDot() {
  if (_sd) return _sd; const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return (_sd = new THREE.CanvasTexture(c));
}
function initFx() {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(NP * 3), col = new Float32Array(NP * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.6, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, map: softDot() }));
  pts.frustumCulled = false; scene.add(pts);
  S.fx.pts = pts; S.fx.pos = pos; S.fx.col = col; S.fx.vel = new Float32Array(NP * 3); S.fx.life = new Float32Array(NP); S.fx.next = 0;
}
function burst(x, y, z, hex, n, spd, up) {
  if (!S.fx.pts) return; const c = new THREE.Color(hex), F_ = S.fx; spd = spd || 4;
  for (let i = 0; i < n; i++) {
    const k = F_.next; F_.next = (F_.next + 1) % NP;
    F_.pos[k * 3] = x; F_.pos[k * 3 + 1] = y; F_.pos[k * 3 + 2] = z;
    const a = Math.random() * TWO_PI, v = (0.3 + Math.random()) * spd;
    F_.vel[k * 3] = Math.cos(a) * v; F_.vel[k * 3 + 1] = (up === undefined ? 2 : up) + Math.random() * spd * 0.6; F_.vel[k * 3 + 2] = Math.sin(a) * v;
    F_.col[k * 3] = c.r; F_.col[k * 3 + 1] = c.g; F_.col[k * 3 + 2] = c.b; F_.life[k] = 0.5 + Math.random() * 0.6;
  }
}
function updateFx(dt) {
  const F_ = S.fx; if (F_.pts) {
  for (let i = 0; i < NP; i++) {
    if (F_.life[i] <= 0) { F_.pos[i * 3 + 1] = -999; continue; }
    F_.life[i] -= dt; F_.vel[i * 3 + 1] -= 9 * dt;
    F_.pos[i * 3] += F_.vel[i * 3] * dt; F_.pos[i * 3 + 1] += F_.vel[i * 3 + 1] * dt; F_.pos[i * 3 + 2] += F_.vel[i * 3 + 2] * dt;
  }
  F_.pts.geometry.attributes.position.needsUpdate = true; F_.pts.geometry.attributes.color.needsUpdate = true;
  }
  for (let i = F_.rings.length - 1; i >= 0; i--) {
    const r = F_.rings[i]; r.t += dt; const k = r.t / r.dur;
    if (k >= 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); F_.rings.splice(i, 1); continue; }
    r.mesh.scale.setScalar(Math.max(0.01, r.r * (0.15 + 0.85 * Math.sqrt(k)))); r.mesh.material.opacity = 0.7 * (1 - k);
  }
  for (let i = S.texts.length - 1; i >= 0; i--) {
    const t = S.texts[i]; t.t += dt; const k = t.t / t.dur;
    if (k >= 1) { scene.remove(t.sp); t.sp.material.dispose(); S.texts.splice(i, 1); continue; }
    t.sp.position.y = t.y0 + k * 2.2; t.sp.material.opacity = k < 0.6 ? 1 : (1 - k) / 0.4;
  }
  const now = performance.now() / 1000;
  for (let i = S.zones.length - 1; i >= 0; i--) {
    const z = S.zones[i], k = (now - z.t0) / z.warn;
    if (k >= 1.12) { scene.remove(z.mesh); z.mesh.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); S.zones.splice(i, 1); continue; }
    z.fill.scale.set(z.shape === 2 ? 1 : Math.min(1, k), Math.min(1, k), 1); if (z.shape === 2) z.fill.scale.set(1, Math.min(1, k), 1);
    z.fill.material.opacity = k < 1 ? 0.28 + 0.2 * Math.sin(now * 14) * (k > 0.7 ? 1 : 0) : 0.75 * (1.12 - k) / 0.12;
  }
}
const ringGeo = new THREE.RingGeometry(0.88, 1, 40);
function ring(x, y, z, hex, r, dur) {
  const m = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.25, z); m.scale.setScalar(0.1); scene.add(m); S.fx.rings.push({ mesh: m, t: 0, dur: dur || 0.6, r });
}
const textCache = new Map();
function floatText(x, y, z, text, color, size) {
  if (S.texts.length > 40) return;
  const key = text + color; let tex = textCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas'); c.width = 160; c.height = 80; const g = c.getContext('2d'); g.font = 'bold 44px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 80, 40); g.fillStyle = color; g.fillText(text, 80, 40);
    tex = new THREE.CanvasTexture(c); if (textCache.size > 200) textCache.clear(); textCache.set(key, tex);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); sp.renderOrder = 20;
  const s = size || 1; sp.scale.set(2.0 * s, 1.0 * s, 1); sp.position.set(x, y, z); scene.add(sp); S.texts.push({ sp, t: 0, dur: 1.0, y0: y });
}
function spawnTelegraph(shape, x, z, ang, a, b, warn, hz) {
  const col = hz ? 0xffa030 : 0xff3a2a, y = S.W.heightAt(x, z) + 0.35;
  const mk = (op) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  let g1, g2;
  if (shape === 0) { g1 = new THREE.CircleGeometry(a, 40); g2 = g1.clone(); }
  else if (shape === 3) { g1 = new THREE.RingGeometry(a * 0.4, a, 48); g2 = g1.clone(); }
  else if (shape === 1) { g1 = new THREE.CircleGeometry(a, 32, Math.PI / 2 - b / 2, b); g2 = g1.clone(); }
  else { g1 = new THREE.PlaneGeometry(b, a); g1.translate(0, a / 2, 0); g2 = g1.clone(); }
  const outline = new THREE.Mesh(g1, mk(0.16)), fill = new THREE.Mesh(g2, mk(0.3));
  fill.renderOrder = 6; outline.renderOrder = 5;
  const grp_ = new THREE.Group(); grp_.add(outline, fill); grp_.rotation.x = Math.PI / 2;
  const holder = new THREE.Group(); holder.position.set(x, y, z); holder.rotation.y = shape === 0 || shape === 3 ? 0 : ang; holder.add(grp_);
  scene.add(holder); S.zones.push({ mesh: holder, fill, t0: performance.now() / 1000, warn: Math.max(0.2, warn), shape });
  Audio.sfx('warn');
}
function posOf(id) {
  if (id === S.id) { const a = S.actor; return a ? a.group.position : null; }
  const p = S.players.get(id); if (p) return p.actor.group.position;
  const e = S.ents.get(id); return e ? e.group.position : null;
}
const EMOJI = ['👋', '😄', '😡', '❤'];
function onEvent(ev, now) {
  const k = ev[0]; let p;
  switch (k) {
    case 'h': {
      p = posOf(ev[1]); if (!p) break; const me = ev[1] === S.id;
      if (ev[3] === 3) { floatText(p.x, p.y + 2.4, p.z, T('dodge'), '#9be37a', 1); break; }
      if (ev[3] === 4) { const te = S.ents.get(ev[1]); if (te && now - (te.tsAt || 0) > 1.2) { te.tsAt = now; floatText(p.x, p.y + 2.6, p.z, T('too_strong'), '#ffb43a', 1.1); Audio.sfx('hit'); } break; }   // слишком сильный враг      // уворот
      const col = me ? '#ff6a5a' : ev[3] === 1 ? '#ffb43a' : ev[3] === 2 ? '#7ad8ff' : '#ffffff';
      floatText(p.x, p.y + 2.2, p.z, (me ? '-' : '') + ev[2], col, ev[3] ? 1.3 : 1);
      burst(p.x, p.y + 1.1, p.z, me ? 0xff3a2a : 0xffe08a, me ? 8 : 6, 3.5); Audio.sfx(me ? 'hurt' : 'hit');
      if (me) S.camShake = Math.max(S.camShake, 0.25);
      else { const te = S.ents.get(ev[1]); if (te) { te.olUntil = now + 0.7; te.olOn = true; setOutline(te.model, true, 0xff2418); } }   // красный контур укушенного врага
      const pl = S.players.get(ev[1]); if (pl) pl.hurt = now;
      break;
    }
    case 'k': { const e = S.ents.get(ev[1]); if (e) { burst(e.group.position.x, e.group.position.y + 1, e.group.position.z, 0xffd35a, 18, 5); e.group.parent && e.group.parent.remove(e.group); S.ents.delete(ev[1]); } break; }
    case 'd': p = posOf(ev[1]); if (p) burst(p.x, p.y + 1, p.z, 0xcc3322, 22, 5); if (ev[1] === S.id) { Audio.sfx('die'); S.camShake = 0.6; } break;
    case 'lv': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffe066, 4, 0.9); burst(p.x, p.y + 1, p.z, 0xffe066, 24, 5); } if (ev[1] === S.id) { Audio.sfx('level'); UI.banner(T('lv_up', { n: ev[2] }), 2200); } break;
    case 'xp': if (ev[1] === S.id) { p = posOf(ev[1]); if (p) floatText(p.x, p.y + 3.0, p.z, '+' + ev[2] + ' XP', '#9be37a', 0.8); } break;
    case 'eat': p = posOf(ev[1]); if (p) burst(p.x, p.y + 1.4, p.z, ev[2] === 'plant' ? 0x6ccf4a : 0xd9534f, 8, 2.5); if (ev[1] === S.id) Audio.sfx('eat'); break;
    case 'b': { const pl = ev[1] === S.id ? S.actor : (S.players.get(ev[1]) || {}).actor; if (pl) pl.dino.userData.bite = 1; if (ev[1] === S.id) Audio.sfx('swing'); break; }
    case 'evo': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0x7af0ff, 5, 1.0); burst(p.x, p.y + 1, p.z, 0x7af0ff, 30, 6); } if (ev[1] === S.id) { Audio.sfx('evo'); UI.banner(T('evo_done'), 1600); } break;
    case 'dash': p = posOf(ev[1]); if (p) burst(p.x, p.y + 0.5, p.z, 0xffffff, 10, 3, 0.5); Audio.sfx('dash'); break;
    case 'dive': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffffff, 3, 0.4); burst(p.x, p.y, p.z, 0xdddddd, 14, 4); } Audio.sfx('boom'); break;
    case 'roar': p = posOf(ev[1]); if (p) ring(p.x, p.y, p.z, 0xff7a4a, ev[2] || 14, 0.8); Audio.sfx('roar'); if (ev[1] !== S.id) S.camShake = Math.max(S.camShake, 0.1); break;
    case 'screech': p = posOf(ev[1]); if (p) ring(p.x, p.y, p.z, 0xffe14a, ev[2] || 10, 0.7); Audio.sfx('screech'); break;
    case 'herd': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xc9a86a, ev[2] || 9, 0.6); burst(p.x, p.y + 0.3, p.z, 0xb59a6a, 26, 5); if (ev[1] === S.id) S.camShake = Math.max(S.camShake || 0, 0.35); } Audio.sfx('hit'); break;
    case 'grd': p = posOf(ev[1]); if (p) burst(p.x, p.y + 1.0, p.z, 0x9ad8ff, 10, 2.5); break;   // щит: светящийся пузырь вокруг динозавра (без плоского «круга-таблички»)
    case 'fly': p = posOf(ev[1]); if (p) burst(p.x, p.y + 0.3, p.z, 0xdddddd, 12, 3); break;
    case 'arc': { const a = posOf(ev[1]), b = posOf(ev[2]); if (a && b) { for (let i = 0; i < 8; i++) { const t = i / 7; burst(a.x + (b.x - a.x) * t, a.y + 1 + (b.y - a.y) * t, a.z + (b.z - a.z) * t, 0x7ad8ff, 2, 1, 0); } Audio.sfx('shock'); } break; }
    case 'em': p = posOf(ev[1]); if (p) { floatText(p.x, p.y + 3.6, p.z, EMOJI[ev[2]] || '?', '#ffffff', 1.4); Audio.sfx('emote'); } break;
    case 'tel': spawnTelegraph(ev[1], ev[2], ev[3], ev[4], ev[5], ev[6], ev[7], ev[8]); break;
    case 'shake': S.camShake = Math.max(S.camShake, ev[1] * 0.7); Audio.sfx('boom'); break;
    case 'boss': {
      if (ev[2] === 'start') { UI.banner(T('boss_start'), 2200); Audio.sfx('boss'); }
      else if (ev[2] === 'dead') { UI.banner(T('boss_dead'), 3200); Audio.sfx('king'); const e = S.ents.get(ev[1]); if (e) for (let i = 0; i < 4; i++) burst(e.group.position.x, e.group.position.y + 2 + i, e.group.position.z, 0xffb04a, 30, 8); }
      break;
    }
    case 'bossph': UI.banner(T('boss_phase', { n: ev[2] + 1 }), 1800); Audio.sfx('boss'); break;
    case 'summon': Audio.sfx('roar'); break;
    case 'burrow': { const e = S.ents.get(ev[1]); if (e) { e.burrowed = !!ev[2]; burst(e.group.position.x, e.group.position.y, e.group.position.z, 0xc9a25a, 24, 6); } Audio.sfx('boom'); break; }
    case 'king': {
      p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffd35a, 8, 1.4); burst(p.x, p.y + 2, p.z, 0xffd35a, 40, 8); }
      if (ev[1] === S.id) { UI.banner(ev[4] ? T('lord_new') : T('king_new', { b: TN(CONFIG.BIOME[ev[2]].n) }), 4200); Audio.sfx('king'); }
      break;
    }
    case 'port': Audio.sfx('portal'); break;
    case 'rush': UI.banner(T('rush_wave', { n: ev[1] }), 2200); Audio.sfx('boss'); break;
    case 'rushwave': UI.banner(T('rush_clear', { c: ev[2] }), 2200); Audio.sfx('win'); break;
    case 'duelgo': UI.banner(T('duel_go'), 1200); Audio.sfx('duelgo'); break;
    case 'duelend': break;
    case 'duelwin': { const win = ev[1] === S.id; UI.banner(win ? T('duel_win') : T('duel_lose'), 3000); Audio.sfx(win ? 'win' : 'lose'); break; }
    case 'champ': UI.banner(T('champ', { x: ev[1] === S.id ? S.profile.name : ((S.players.get(ev[1]) || {}).info || {}).nick || '?' }), 4000); Audio.sfx('king'); break;
    case 'warn': Audio.sfx('warn'); break;
    case 'shot': { const e = S.ents.get(ev[1]); if (e) { const a = e.group.position; for (let i = 0; i < 10; i++) { const t = i / 9; burst(a.x + (ev[2] - a.x) * t, a.y + 1.2 + (ev[3] - a.y) * t, a.z + (ev[4] - a.z) * t, 0x9aff4a, 1, 0.5, 0); } Audio.sfx('swing'); } break; }
  }
}

// ---------------------------------------------------------------- способности и панель
const ABIL = {
  atk: { ico: '🦷', n: { ru: 'Атака', en: 'Attack' } }, pounce: { ico: '⚡', n: { ru: 'Рывок', en: 'Pounce' } }, roar: { ico: '📣', n: { ru: 'Рёв', en: 'Roar' } },
  guard: { ico: '🛡', n: { ru: 'Щит', en: 'Guard' } }, herd: { ico: '🦶', n: { ru: 'Топот', en: 'Stomp' } }, screech: { ico: '📢', n: { ru: 'Крик', en: 'Screech' } },
  dive: { ico: '🦅', n: { ru: 'Пике', en: 'Dive' } }, sonic: { ico: '🔊', n: { ru: 'Звук', en: 'Sonic' } }, torpedo: { ico: '🚀', n: { ru: 'Торпеда', en: 'Torpedo' } },
  climb: { ico: '🌲', n: { ru: 'Лазание', en: 'Climb' } }, fly: { ico: '🪽', n: { ru: 'Взлёт', en: 'Fly' } }
};
function buildAbilityBar() {
  $('tb-sprint').style.display = CONFIG.CLASSES[S.profile.cls].noSprint ? 'none' : '';
  const cls = S.profile.cls, A = CONFIG.ABILITIES[cls], bar = $('abil'); bar.innerHTML = '';
  const defs = [['atk', 'atk', 'LMB', null], ['e', A.e.id, 'E', A.e.cd], ['q', A.q.id, 'Q', A.q.cd]];
  if (cls === 'herb') defs.push(['f', 'climb', 'F', 0]); if (cls === 'fly') defs.push(['f', 'fly', 'F', 0]);
  S.abBtns = [];
  for (const [slot, id, key, cd] of defs) {
    const b = document.createElement('button'); b.className = 'ab'; b.innerHTML = `<small>${key === 'LMB' ? (IS_TOUCH ? '' : '🖱') : key}</small><span>${(id === 'atk' ? CONFIG.CLS_INFO[cls].atkIco : ABIL[id].ico)}</span><div class="cd"></div><div class="nm">${TN(ABIL[id].n)}</div>`;
    const down = e => { e.preventDefault(); Audio.init(); if (slot === 'atk') { input.atk = true; b.classList.add('held'); } else act(slot); };
    const up = () => { if (slot === 'atk') { input.atk = false; b.classList.remove('held'); } };
    b.addEventListener('touchstart', down, { passive: false }); b.addEventListener('touchend', up); b.addEventListener('mousedown', down); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);
    bar.appendChild(b); S.abBtns.push({ slot, b, cd, el: b.querySelector('.cd') });
  }
}

// ---------------------------------------------------------------- вылупление: яйцо в гнезде, трещины, скорлупа, детёныш
function fade(on, ms) {
  const el = $('fade'); if (!el) return Promise.resolve();
  ms = ms || 700; el.style.transitionDuration = ms + 'ms';
  el.classList.toggle('on', !!on);
  return new Promise(r => setTimeout(r, ms + 40));
}
function splitEggGeos(L, Wd, asym, yb, seed) {
  const R = DinoNest.eggProfile(L, Wd, asym), seg = 56, rows = 24, n3 = DinoNest.noise3;
  // линия разлома — зубчатая, как настоящая трещина
  const jag = a => yb + L * (0.03 * (Math.abs(((a * 9 / 6.2832) % 1) - 0.5) * 4 - 1) + 0.012 * Math.sin(a * 23 + seed) + 0.02 * n3(Math.cos(a) * 2, Math.sin(a) * 2, 0.5, seed));
  const part = (lo) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, k = 0.5 - 0.5 * Math.cos(Math.PI * t);
      for (let j = 0; j <= seg; j++) {
        const a = j / seg * 6.2832, ye = jag(a), y = lo ? ye * k : ye + (L - ye) * k, r = R(Math.min(L, Math.max(0, y)));
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r); uv.push(j / seg, y / L);
      }
    }
    const cols = seg + 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  return { lo: part(true), hi: part(false), jag };
}
function beginHatch() {
  const ni = S.world.nestInfo, me = S.me, r = DinoNest.rngOf(((me.x * 13) | 0) + 77);
  const floorY = ni ? ni.y : me.y;
  const L = 1.15, Wd = 0.74, yb = L * 0.64, seed = (r() * 999) | 0;
  const tex = DinoNest.shellTexture(ni ? ni.shell : 'sand', seed, false), pores = DinoNest.poreTexture(seed + 3);
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: pores, bumpScale: 0.004, roughness: 0.55, side: THREE.DoubleSide });
  const G = splitEggGeos(L, Wd, 0.08, yb, seed);
  const grp = new THREE.Group(); grp.position.set(me.x, floorY - 0.06, me.z); scene.add(grp);
  const lo = new THREE.Mesh(G.lo, mat); lo.castShadow = lo.receiveShadow = true;
  const cy = (yb + L) / 2; G.hi.translate(0, -cy, 0);
  const hi = new THREE.Mesh(G.hi, mat); hi.position.y = cy; hi.castShadow = hi.receiveShadow = true;
  const rock = new THREE.Group(); rock.add(lo); rock.add(hi); grp.add(rock);
  // трещины рисуются по текстуре постепенно: главная — ровно по линии разлома, от неё ветки
  const cv = tex.image, g2 = cv.getContext('2d'), W = cv.width, H = cv.height, segs = [];
  const toPx = (a, y) => [a / 6.2832 * W, H * (1 - y / L)];
  const starts = [r() * 6.28, r() * 6.28, r() * 6.28];
  starts.forEach((a0, si) => {
    for (const dir of [1, -1]) { let a = a0, prev = toPx(a, G.jag(a)); for (let k = 0; k < 40; k++) { a += dir * 0.06; const p = toPx(((a % 6.2832) + 6.2832) % 6.2832, G.jag(((a % 6.2832) + 6.2832) % 6.2832)); if (Math.abs(p[0] - prev[0]) < W / 2) segs.push({ a: prev, b: p, w: 2.4, o: si * 0.12 + k / 40 }); prev = p; } }
  });
  for (let k = 0; k < 16; k++) {   // ветвящиеся трещинки вверх и вниз от линии
    const a = r() * 6.2832; let p = toPx(a, G.jag(a)), ang = (r() < 0.5 ? -1 : 1) * (1.2 + r() * 0.7), o = 0.3 + r() * 0.6;
    for (let q = 0; q < 6; q++) { ang += r() * 0.8 - 0.4; const np = [p[0] + Math.cos(ang) * 7, p[1] + Math.sin(ang) * 7]; segs.push({ a: p, b: np, w: 1.4, o: o + q * 0.02 }); p = np; }
  }
  segs.sort((x, y) => x.o - y.o);
  S.hatch = { t0: clock, grp, rock, lo, hi, mat, tex, g2, segs, drawn: 0, floorY, L, yb, chips: [], burst: false, tip: 0, capV: null, done: false, blend: 0, camA: me.face || 0, knocks: [2.0, 2.9, 3.5, 3.9], skip: false };
  $('hud').classList.remove('on'); input.yaw = (me.face || 0) + Math.PI; input.pitch = 0.32;
  const hh = $('hatchhint'); if (hh) { hh.textContent = T('hatch_skip'); hh.classList.add('on'); }
}
function chip(h, big) {
  const r = Math.random, geo = DinoNest.shardGeo(h.L * (big ? 0.9 : 0.55), 0.74 * (big ? 0.9 : 0.55), DinoNest.rngOf((r() * 9999) | 0));
  const m = new THREE.Mesh(geo, h.mat); m.castShadow = true;
  const a = r() * 6.28; m.position.set(Math.cos(a) * 0.3, h.yb + 0.02, Math.sin(a) * 0.3);
  m.userData.v = new THREE.Vector3(Math.cos(a) * (1 + r() * 1.5), 2 + r() * 2, Math.sin(a) * (1 + r() * 1.5)); m.userData.w = new THREE.Vector3(r() * 8, r() * 8, r() * 8);
  h.grp.add(m); h.chips.push(m);
}
const HATCH_END = 7.4;
function updateHatch(dt) {
  const h = S.hatch; if (!h) return;
  let t = clock - h.t0;
  if (h.skip && t < HATCH_END) { h.t0 -= (HATCH_END - t); t = HATCH_END; }
  // трещины: прогресс 0 → 1 за 1,2–4,2 с
  const c = Math.min(1, Math.max(0, (t - 1.2) / 3.0)), want = Math.floor(c * h.segs.length);
  if (want > h.drawn) {
    const g = h.g2; g.strokeStyle = 'rgba(28,20,14,.92)'; g.lineCap = 'round';
    for (let i = h.drawn; i < want; i++) { const sg = h.segs[i]; g.lineWidth = sg.w; g.beginPath(); g.moveTo(sg.a[0], sg.a[1]); g.lineTo(sg.b[0], sg.b[1]); g.stroke(); }
    h.drawn = want; h.tex.needsUpdate = true;
    if (Math.random() < 0.5) Audio.sfx('crack');
  }
  // яйцо раскачивается толчками: детёныш бьётся изнутри
  if (!h.burst) {
    const pulse = Math.pow(Math.max(0, Math.sin(t * 2.3)), 8) * (0.25 + c * 0.9);
    h.rock.rotation.z = Math.sin(t * 24) * 0.09 * pulse; h.rock.rotation.x = Math.cos(t * 19) * 0.06 * pulse;
    while (h.knocks.length && t > h.knocks[0]) { h.knocks.shift(); Audio.sfx('crack'); chip(h, false); h.rock.rotation.z += 0.12; }
  }
  if (!h.burst && t > 4.35) {
    h.burst = true; h.rock.rotation.set(0, 0, 0); Audio.sfx('evo'); Audio.sfx('crack');
    h.capV = new THREE.Vector3(0.9, 3.6, 0.5); h.capW = new THREE.Vector3(2.5, 0.4, 3.2);
    for (let i = 0; i < 4; i++) chip(h, i < 2);
    burst(h.grp.position.x, h.floorY + h.yb, h.grp.position.z, 0xf3ead6, 16, 3);
  }
  if (h.capV) {   // верхушка скорлупы летит и падает на край гнезда
    h.capV.y -= 9.8 * dt; h.hi.position.addScaledVector(h.capV, dt); h.hi.rotation.x += h.capW.x * dt; h.hi.rotation.z += h.capW.z * dt;
    if (h.hi.position.y < 0.12) { h.hi.position.y = 0.12; h.capV.multiplyScalar(0.25); h.capV.y = Math.abs(h.capV.y) * 0.3; h.capW.multiplyScalar(0.5); if (h.capV.length() < 0.3) h.capV = null; }
  }
  for (const m of h.chips) { const v = m.userData.v; if (!v) continue; v.y -= 9.8 * dt; m.position.addScaledVector(v, dt); m.rotation.x += m.userData.w.x * dt; m.rotation.z += m.userData.w.z * dt; if (m.position.y < 0.05) { m.position.y = 0.05; m.userData.v = null; m.rotation.x = Math.PI / 2 + Math.random() * 0.6; } }
  // нижняя половинка заваливается набок, когда детёныш выбрался
  if (t > 4.95 && h.tip < 1) { h.tip = Math.min(1, h.tip + dt * 2.2); h.lo.rotation.z = -1.35 * h.tip * h.tip; h.lo.position.x = 0.35 * h.tip; h.lo.position.y = 0.18 * Math.sin(h.tip * Math.PI) + 0.05 * h.tip; }
  if (t > 6.1 && !h.roared) { h.roared = true; if (S.actor) S.actor.dino.userData.bite = 1; Audio.sfx('roar'); }
  if (t > HATCH_END && !h.done) {
    h.done = true; $('hud').classList.add('on'); const hh = $('hatchhint'); if (hh) hh.classList.remove('on');
    UI.banner(TN(CONFIG.BIOME[S.biome].n), 2600);
    setTimeout(() => { if (S && S.hatch === h) { /* скорлупки остаются в гнезде ещё минуту */ } }, 10);
    h.cleanAt = clock + 70;
  }
  if (h.done) h.blend = Math.min(1, h.blend + dt / 1.3);
  if (h.cleanAt && clock > h.cleanAt) { h.grp.parent && h.grp.parent.remove(h.grp); h.mat.dispose(); h.tex.dispose(); S.hatch = null; }
}
// поза детёныша в катсцене: прячется в яйце, затем выбирается и растёт до своего размера
function hatchPose(a) {
  const h = S.hatch; if (!h || h.blend >= 1) return;
  const t = clock - h.t0, base = Sim.scaleOf(S.profile.level);
  if (!h.burst) { a.dino.visible = false; a.tag.visible = false; return; }
  a.dino.visible = true; a.tag.visible = h.done;
  // 1) из отверстия выглядывает маленькая голова (тело ещё в скорлупе), 2) скорлупа заваливается, 3) детёныш выбирается и растёт
  const sm = (a0, a1, x) => { const q = Math.min(1, Math.max(0, (x - a0) / (a1 - a0))); return q * q * (3 - 2 * q); };
  const peek = sm(4.35, 4.95, t), g = sm(5.05, 6.5, t), e = 1 - Math.pow(1 - g, 3);
  a.dino.scale.setScalar(base * (0.2 + 0.8 * e));
  const inside = (h.yb - 0.36) * peek - 0.15 * (1 - peek);
  a.dino.position.y = (h.floorY - S.py) + inside * (1 - e) + 0.08 * Math.sin(g * Math.PI);
  a.dino.rotation.y = S.me.face + Math.sin(t * 3) * 0.15 * (1 - e);
}
const _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _tmpCam = new THREE.PerspectiveCamera();
function hatchCamera(dt) {
  const h = S.hatch; if (!h || h.blend >= 1) return false;
  const t = clock - h.t0, gp = h.grp.position, u = Math.min(1, t / HATCH_END), a = h.camA + (u * u * (3 - 2 * u)) * Math.PI * 0.92, R = 3.4 + u * 1.4, lift = h.burst ? 0.9 : 0.55;
  _tmpCam.position.set(gp.x + Math.sin(a) * R, h.floorY + 1.5 + Math.min(1, t / 7) * 0.5, gp.z + Math.cos(a) * R);
  _tmpCam.lookAt(gp.x, h.floorY + lift, gp.z);
  if (h.blend <= 0) { camera.position.copy(_tmpCam.position); camera.quaternion.copy(_tmpCam.quaternion); camera.fov = 50; camera.updateProjectionMatrix(); return true; }
  return { pos: _tmpCam.position.clone(), q: _tmpCam.quaternion.clone() };
}

// ---------------------------------------------------------------- камера
let camDist = 8, camShakeT = 0;
function placeCamera(dt, px, py, pz, now) {
  const sc = Sim.scaleOf(S.profile.level), me = S.me;
  let dist = (4.2 + sc * 3.4) * input.zoom * (me.fly ? 1.25 : 1) * (S.bs && S.bs.st === 'fight' ? 1.4 : 1);
  const tx = px, ty = py + 1.3 * sc, tz = pz, cp = Math.cos(input.pitch), dx = Math.sin(input.yaw) * cp, dy = Math.sin(input.pitch), dz = Math.cos(input.yaw) * cp;
  let d = dist;
  for (let k = 1; k <= 10; k++) {
    const t = k / 10 * dist, x = tx + dx * t, y = ty + dy * t, z = tz + dz * t;
    let hit = S.W.heightAt(x, z) + 0.45 > y;
    if (!hit) { const near = Sim.obstaclesNear(S.W, x, z, 2.5); for (let i = 0; i < near.length; i++) { const o = near[i]; if (o.kind !== 'tree' && o.kind !== 'rock' && o.kind !== 'stone') continue; if (Math.hypot(o.x - x, o.z - z) < o.r + 0.25 && y < o.y + (o.h || 3)) { hit = true; break; } } }
    if (hit) { d = Math.max(1.4, (k - 1) / 10 * dist); break; }
  }
  camDist += (d - camDist) * Math.min(1, dt * (d < camDist ? 25 : 3));
  let x = tx + dx * camDist, y = ty + dy * camDist, z = tz + dz * camDist;
  const gy = S.W.heightAt(x, z) + 0.5; if (y < gy) y = gy;
  if (S.camShake > 0.01) { const s = S.camShake; x += (Math.random() - 0.5) * s; y += (Math.random() - 0.5) * s; z += (Math.random() - 0.5) * s; S.camShake *= Math.pow(0.02, dt); }
  camera.position.set(x, y, z); camera.lookAt(tx, ty + (CONFIG.isAqua(S.profile.cls) ? camDist * 0.2 : 0), tz);   // в воде динозавр чуть ниже по экрану — лучше видно, что происходит вокруг
  camera.fov += ((me.fly ? 70 : 62) - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- фиксированный шаг (25 Гц): ввод → предсказание → сервер
function fixedStep() {
  if (!S.alive) return;
  const du = S.du, frozen = (du && du.st !== 'fight') || (S.hatch && !S.hatch.done);
  const raw = readInput(), c = frozen ? { f: 0, s: 0, yaw: raw.yaw, pitch: raw.pitch, jump: false, down: false, sprint: false } : raw;
  S.seq++; c.q = S.seq;
  S.prev = { x: S.me.x, y: S.me.y, z: S.me.z };
  Sim.step(S.me, c, DT, S.W, S.stats);
  S.running = !!(c.sprint && !S.stats.noSprint && (Math.abs(c.f) + Math.abs(c.s) > 0.1) && S.me.stam > 1 && !S.me.grd && !S.me.fly);
  S.pending.push(c); if (S.pending.length > 40) S.pending.shift();
  const r2 = v => Math.round(v * 1000) / 1000;
  S.conn.send({ t: 'in', q: c.q, f: r2(c.f), s: r2(c.s), yaw: r2(c.yaw), pt: r2(c.pitch), j: c.jump ? 1 : 0, d: c.down ? 1 : 0, sp: c.sprint ? 1 : 0 });
  const now = performance.now();
  if (input.atk && !panelOpen && !frozen && now - S.lastAtk > 190) { S.lastAtk = now; S.conn.send({ t: 'act', a: 'atk' }); }
}

// ---------------------------------------------------------------- кадр: актёры, камера, HUD
const _s = { x: 0, y: 0, z: 0, f: 0 };
function flagsAnim(fl) { return { fly: !!(fl & F.FLY), swim: !!(fl & F.SUB), climb: !!(fl & F.CLM), guard: !!(fl & F.GRD) }; }
// прижимаем к нарисованной земле только тех, кто стоит на ней (в прыжке/полёте/воде поправка плавно исчезает)
function surfFix(x, y, z) {
  const W = S.W; if (!S.world.groundFix || W.isWater(x, z)) return 0;
  const k = 1 - clamp((y - W.heightAt(x, z)) / 1.2, 0, 1); return k > 0 ? S.world.groundFix(x, z) * k : 0;
}
// на поверхности воды динозавр качается на волнах и никогда не торчит над водой
function waveY(x, y, z, water, sc, aq) {
  if (!water || !S.world.waveAt) return y;
  const W = S.W, wv = S.world.waveAt(x, z), off = aq ? 1.15 * sc - 0.15 : 0.55 + 0.25 * sc, k = clamp(1 - (W.waterY - y - off) / 1.6, 0, 1);   // у поверхности — качается на волнах, глубже — волны затухают
  return Math.min(y + wv * k, W.waterY + wv - off);
}
function updateActors(dt, t, now) {
  const me = S.me, W = S.W, a = S.actor;
  // свой динозавр: интерполяция между шагами предсказания + сглаживание коррекций
  const k = clamp(S.acc / DT, 0, 1), pv = S.prev || me;
  S.off.x *= Math.pow(0.0001, dt); S.off.y *= Math.pow(0.0001, dt); S.off.z *= Math.pow(0.0001, dt);
  const x = pv.x + (me.x - pv.x) * k + S.off.x, y = pv.y + (me.y - pv.y) * k + S.off.y, z = pv.z + (me.z - pv.z) * k + S.off.z;
  if (S.lastPos) { const v = Math.hypot(x - S.lastPos.x, z - S.lastPos.z) / Math.max(dt, 1e-3); S.speed += (clamp(v / 6, 0, 1.6) - S.speed) * Math.min(1, dt * 12); }
  S.lastPos = { x, z };
  const water = W.isWater(me.x, me.z) && me.y < W.waterY + 0.35 && !me.fly && !me.clm;
  a.update(x, waveY(x, y, z, water, Sim.scaleOf(S.profile.level), CONFIG.isAqua(S.profile.cls)), z, me.face, S.speed, t, dt, { fly: !!me.fly, swim: water, climb: !!me.clm, guard: !!me.grd, run: !!S.running && S.speed > 0.3, vy: me.vy });
  const dead = !S.alive; a.dino.rotation.z = dead ? 1.45 : 0; a.dino.position.y = (dead ? 0.35 : 0) + (S.world.nestLift ? S.world.nestLift(x, z) : 0) + surfFix(x, y, z);
  a.group.visible = true; a.dino.visible = true; a.tag.visible = true; { const k = clamp(camDist / 8, 0.5, 1.5); a.tag.scale.set(3.6 * k, 0.9 * k, 1); }
  if (S.hatch) hatchPose(a); else if (a.dino.userData.hatchFix) { a.dino.userData.hatchFix = false; }
  shieldFx(a, false); ownShieldRing(a, (S.mp && S.mp.sh > 0) || !!me.grd, t);   // свой щит — кольцо на земле: сфера вокруг камеры превращалась в «табличку»
  S.px = x; S.py = y; S.pz = z;
  trN = 0; trAdd(x, z, (S.me.fly || S.W.isWater(x, z) ? 0 : 0.8 + 1.5 * Sim.scaleOf(S.profile.level)), 1);
  // след за своим динозавром: трава поднимается не сразу, а за пару секунд
  { trailT -= dt; const mv = Math.hypot(x - trailLast.x, z - trailLast.z); if (trailT <= 0 && mv > 0.6 && !S.me.fly) { trailT = 0.28; trailLast.x = x; trailLast.z = z; trail.push({ x, z, r: 0.7 + 1.2 * Sim.scaleOf(S.profile.level), age: 0 }); if (trail.length > 7) trail.shift(); } }
  for (let i = trail.length - 1; i >= 0; i--) { const q = trail[i]; q.age += dt; if (q.age > 2.4) trail.splice(i, 1); else trAdd(q.x, q.z, q.r * (1 - q.age / 2.4), 0); }
  // другие игроки
  const rt = now - 0.12;
  for (const p of S.players.values()) {
    if (!p.buf.length) { p.actor.group.visible = false; continue; }
    sample(p.buf, rt, _s); const fl = p.flags, an = flagsAnim(fl), dd = Math.hypot(_s.x - x, _s.z - z);
    if (!an.fly) trAdd(_s.x, _s.z, 0.8 + 1.5 * Sim.scaleOf(p.info.level || 1), 1);
    const hidden = (fl & F.HIDE) && dd > 7;
    p.actor.group.visible = !hidden;
    const water2 = !an.fly && W.isWater(_s.x, _s.z) && _s.y < W.waterY + 0.35;
    p.actor.update(_s.x, waveY(_s.x, _s.y, _s.z, an.swim || water2, Sim.scaleOf(p.actor.level), CONFIG.isAqua(p.actor.cls)), _s.z, _s.f, clamp(p.speed / 6, 0, 1.6), t, dt, { fly: an.fly, swim: an.swim || water2, climb: an.climb, guard: an.guard });
    if ((fl & F.ATK) && !(p.prevFlags & F.ATK)) p.actor.dino.userData.bite = 1;
    p.prevFlags = fl;
    const d = !!(fl & F.DEAD); p.actor.dino.rotation.z = d ? 1.45 : 0; p.actor.dino.position.y = (d ? 0.35 : 0) + (an.fly ? 0 : surfFix(_s.x, _s.y, _s.z));
    shieldFx(p.actor, !!(fl & (F.SHIELD | F.GRD)));
    p.actor.tag.visible = dd < 60; { const k = clamp(Math.hypot(camera.position.x - _s.x, camera.position.z - _s.z) / 12, 0.45, 2.4); p.actor.tag.scale.set(3.6 * k, 0.9 * k, 1); }
  }
}
let _shMat = null;
function shieldMat() {
  // только светящийся край пузыря (без плоской заливки): нигде не превращается в «табличку», даже когда сфера уходит в землю
  return _shMat || (_shMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color(0x6ad0ff) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = pow(f, 3.0) * 0.55; gl_FragColor = vec4(uC * (0.6 + f), a); }'
  }));
}
function ownShieldRing(actor, on, t) {
  if (!actor.sring) { const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0x6ad0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.08; m.renderOrder = 5; actor.group.add(m); actor.sring = m; }
  actor.sring.visible = !!on;
  if (on) { const s = Sim.scaleOf(actor.level) * 2.1 * (1 + 0.06 * Math.sin(t * 5)); actor.sring.scale.set(s, s, s); actor.sring.material.opacity = 0.55 + 0.25 * Math.sin(t * 5); }
}
function shieldFx(actor, on) {
  if (!actor.shield) { actor.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shieldMat()); actor.shield.renderOrder = 5; actor.group.add(actor.shield); }
  actor.shield.visible = !!on;
  if (on) { const s = Sim.scaleOf(actor.level) * 1.9; actor.shield.scale.set(s, s, s); actor.shield.position.y = s * 0.55; }
}
const markTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(4, 6); g.lineTo(28, 6); g.lineTo(16, 28); g.closePath(); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); return new THREE.CanvasTexture(c); })();
// примятая трава: собираем динозавров вокруг камеры, самые близкие — в шейдер
let trN = 0; const trList = [], trail = [], trailLast = { x: 1e9, z: 1e9 }; let trailT = 0;
function trAdd(x, z, r, near) {
  if (r <= 0.05) return;
  const dx = x - camera.position.x, dz = z - camera.position.z, d2 = dx * dx + dz * dz; if (d2 > 3600) return;
  const o = trList[trN] || (trList[trN] = { x: 0, z: 0, r: 0, d: 0 }); o.x = x; o.z = z; o.r = r; o.d = near ? -1 : d2; trN++;
}
function flushTramplers() {
  const l = trList.slice(0, trN).sort((a, b) => a.d - b.d); S.world.setTramplers(l);
}
function updateEnts(dt, t, now) {
  const rt = now - 0.12, viewD = (CONFIG.QUALITY[qualityName].view || 200) + 30, cp = camera.position;
  // ближайший враг (до ~11 м) подсвечивается жёлтым контуром — понятно, кого сейчас атакуешь
  let nearE = null, nearD = (S.W.ocean ? 14 : 11);
  for (const e of S.ents.values()) { if (e.boss || (e.flags & 16) || !e.group.visible) continue; const q = e.group.position, dq = Math.hypot(q.x - S.px, q.z - S.pz); if (dq < nearD && Math.abs(q.y - S.py) < 12) { nearD = dq; nearE = e; } }
  for (const e of S.ents.values()) {
    if (!sample(e.buf, rt, _s)) continue;
    const g = e.group; g.position.set(_s.x, _s.y + (e.arch && e.arch.fly ? 0 : surfFix(_s.x, _s.y, _s.z)), _s.z); e.model.rotation.y = _s.f;
    const dd = Math.hypot(_s.x - S.px, _s.z - S.pz), vis = dd < viewD && !(e.flags & 8);
    g.visible = vis; if (!vis) continue;
    if (e.boss) trAdd(_s.x, _s.z, 1 + (e.def.size || 3) * 1.2, 0); else if (e.arch && !e.arch.fly && !e.arch.water && !e.arch.tiny) trAdd(_s.x, _s.z, 0.6 + e.arch.size * 1.6, 0);
    if (e.lastPos) { const v = Math.hypot(_s.x - e.lastPos.x, _s.z - e.lastPos.z) / Math.max(dt, 1e-3); e.speed += (clamp(v / (e.boss ? 4.5 : 6), 0, 1.6) - e.speed) * Math.min(1, dt * 8); }
    e.lastPos = { x: _s.x, z: _s.z };
    if (e.boss) animateBoss(e.model, t + e.animT, e.speed, dt, { burrow: !!(e.flags & 64), roar: false });
    else animateEnemy(e.model, t + e.animT, e.speed, dt, e.flags & 1, e.arch && e.arch.fly, ((e.arch && e.arch.speed) || 180) / 180);
    if (e.boss && (e.flags & 64)) e.model.position.y = -2.6 * e.def.size / 3; else if (e.boss) e.model.position.y = 0;
    // подпись и полоска здоровья
    const friend = !!(e.flags & 16), aggro = !!(e.flags & 2), key = (friend ? 'f' : aggro ? 'a' : 'n');
    if (!e.tag || e.tagKey !== key) {
      if (e.tag) g.remove(e.tag);
      const nm = e.boss ? TN(e.def.n) : TN(e.arch.n), col = friend ? '#9be37a' : aggro ? '#ff8a7a' : e.boss ? '#ffb04a' : '#ffffff';
      e.tag = makeNameTag(nm, { color: col, sub: e.boss ? '' : T('level_short') + e.lv }); e.tag.position.y = e.tagY + 0.5; g.add(e.tag); e.tagKey = key;
    }
    e.tag.visible = dd < (e.boss ? 90 : 38); { const k = clamp(Math.hypot(camera.position.x - _s.x, camera.position.z - _s.z) / 12, 0.45, e.boss ? 4 : 2.4); e.tag.scale.set(3.6 * k, 0.9 * k, 1); }
    if (e.olOn && now > e.olUntil) { e.olOn = false; e.olY = false; setOutline(e.model, false); }
    if (!e.olOn) { const yel = e === nearE; if (yel && !e.olY) { e.olY = true; setOutline(e.model, true, 0xffd23a); } else if (!yel && e.olY) { e.olY = false; setOutline(e.model, false); } }
    e.bar.visible = !e.boss && dd < (S.W.ocean ? 70 : 48) && (e.hp < e.mhp || aggro); if (e.bar.visible) { e.bar.setFill(e.mhp > 0 ? e.hp / e.mhp : 1); e.bar.quaternion.copy(camera.quaternion); const bk = clamp(dd / 14, 0.8, 2.6); e.bar.scale.set(bk, bk, 1); }
    // чутьё: метки добычи и врагов сквозь рельеф
    if (S.sense && !e.boss && dd < S.sense && dd > 9) {
      if (!e.mark) { e.mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex, depthTest: false, transparent: true, opacity: 0.9 })); e.mark.scale.set(0.9, 0.9, 1); e.mark.renderOrder = 15; g.add(e.mark); }
      e.mark.visible = true; e.mark.position.y = e.tagY + 1.4; e.mark.material.color.setHex(friend ? 0x9be37a : e.arch.role === 'hostile' ? 0xff4a3a : e.arch.role === 'herd' ? 0xffd35a : 0x6ccf4a);
    } else if (e.mark) e.mark.visible = false;
  }
}

// ---------------------------------------------------------------- HUD
const miniCv = $('mini-cv'), miniCtx = miniCv.getContext('2d');
function drawMinimap() {
  const g = miniCtx, N = miniCv.width, c = N / 2, R = 130, k = c / R, w = S.world, me = S.me;
  g.clearRect(0, 0, N, N); g.save(); g.beginPath(); g.arc(c, c, c, 0, TWO_PI); g.clip(); g.fillStyle = '#0a1410'; g.fillRect(0, 0, N, N);
  g.translate(c, c); g.rotate(input.yaw);
  const size = w.mapSize; g.drawImage(w.minimap, -(S.px + size / 2) * k, -(S.pz + size / 2) * k, size * k, size * k);
  const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc((x - S.px) * k, (z - S.pz) * k, r, 0, TWO_PI); g.fill(); };
  const W = S.W;
  if (!W.duel) {
    dot(W.nest.x, W.nest.z, '#ffd35a', 4); dot(W.portalIn.x, W.portalIn.z, '#e8573f', 5);
    if (W.features && W.features.caves) for (const c of W.features.caves) { g.strokeStyle = '#e8f4ff'; g.lineWidth = 3; g.beginPath(); g.moveTo((c.x - Math.cos(c.a) * c.L / 2 - S.px) * k, (c.z - Math.sin(c.a) * c.L / 2 - S.pz) * k); g.lineTo((c.x + Math.cos(c.a) * c.L / 2 - S.px) * k, (c.z + Math.sin(c.a) * c.L / 2 - S.pz) * k); g.stroke(); }
    if (S.profile.cls === 'herb' && S.drops) for (const d of S.drops) if (d[3] === 'plant') dot(d[0], d[2], '#c8ff4a', 3);   // еда травоядного — на мини-карте
    if (S.pt && S.pt.next) dot(W.portalNext.x, W.portalNext.z, '#9be37a', 5);
  }
  const sr = Math.max(34, S.sense || 0);
  for (const e of S.ents.values()) {
    const p = e.group.position;                                           // видно всех врагов в зоне сервера, а не только ближних
    if (e.boss) { dot(p.x, p.z, '#ff3a2a', 6); continue; }
    const hostile = e.arch.role === 'hostile', col = (e.flags & 16) ? '#9be37a' : hostile ? '#ff5a4a' : e.arch.role === 'herd' ? '#ffd35a' : e.arch.role === 'fish' || e.arch.role === 'bug' ? '#6ad8ff' : '#8cff7a';
    dot(p.x, p.z, '#000', (hostile ? 4.2 : 3.2)); dot(p.x, p.z, col, hostile ? 3.1 : 2.2);
  }
  for (const p of S.players.values()) { const q = p.actor.group.position; dot(q.x, q.z, p.info.bot ? '#cfcfcf' : '#6ac8ff', 3.6); }
  g.restore();
  // игрок — стрелка по центру, компас по ободу
  g.save(); g.translate(c, c); g.rotate(Math.PI - S.me.face + input.yaw); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.stroke(); g.fill(); g.restore();
  const nx = c + Math.sin(input.yaw) * (c - 13), ny = c - Math.cos(input.yaw) * (c - 13);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(nx, ny, 10, 0, TWO_PI); g.fill(); g.fillStyle = '#ff6a5a'; g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(window.I18N.lang === 'ru' ? 'С' : 'N', nx, ny + 1);
}
// ---------------------------------------------------------------- большая карта (Tab; на телефоне — нажать на мини-карту)
let mapOpen = false;
const bigCv = $('bigmap-cv'), bigCtx = bigCv.getContext('2d');
function toggleMap(on) {
  mapOpen = on === undefined ? !mapOpen : !!on;
  $('bigmap').classList.toggle('on', mapOpen);
  if (mapOpen) { if (document.pointerLockElement) document.exitPointerLock(); drawBigMap(); }
}
// на телефоне — касание мини-карты открывает карту, касание карты закрывает (preventDefault: без «призрачного» клика)
$('mini').addEventListener('touchend', e => { e.preventDefault(); if (S && S.welcomed) toggleMap(true); }, { passive: false });
$('mini').addEventListener('click', () => { if (S && S.welcomed) toggleMap(true); });
$('bigmap').addEventListener('touchend', e => { e.preventDefault(); toggleMap(false); }, { passive: false });
$('bigmap').addEventListener('click', () => toggleMap(false));
function drawBigMap() {
  if (!mapOpen || !S || !S.world) return;
  const g = bigCtx, N = bigCv.width, w = S.world, W = S.W, size = w.mapSize, k = N / size, P = (x) => (x + size / 2) * k;
  g.clearRect(0, 0, N, N); g.imageSmoothingEnabled = true; g.drawImage(w.minimap, 0, 0, N, N);
  // сетка и подписи
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; for (let i = 1; i < 8; i++) { const v = i / 8 * N; g.beginPath(); g.moveTo(v, 0); g.lineTo(v, N); g.moveTo(0, v); g.lineTo(N, v); g.stroke(); }
  const icon = (x, z, txt, sz) => { g.font = `${sz || 22}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, P(x), P(z)); };
  const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(P(x), P(z), r, 0, TWO_PI); g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5; g.stroke(); };
  if (!W.duel) {
    g.strokeStyle = 'rgba(232,87,63,.8)'; g.lineWidth = 3; g.beginPath(); g.arc(P(0), P(0), CONFIG.ARENA_R * k, 0, TWO_PI); g.stroke();
    icon(0, 0, '💀', 26); icon(W.nest.x, W.nest.z, '🥚', 24); icon(W.portalIn.x, W.portalIn.z, '🌀', 20);
    if (W.features && W.features.caves) for (const c of W.features.caves) { g.strokeStyle = '#e8f4ff'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(P(c.x - Math.cos(c.a) * c.L / 2), P(c.z - Math.sin(c.a) * c.L / 2)); g.lineTo(P(c.x + Math.cos(c.a) * c.L / 2), P(c.z + Math.sin(c.a) * c.L / 2)); g.stroke(); g.lineCap = 'butt'; icon(c.x, c.z - 14, '🕳', 16); }   // сквозные пещеры
    if (S.pt && S.pt.next) icon(W.portalNext.x, W.portalNext.z, '✨', 22);
  }
  const sr = Math.max(60, S.sense || 0);
  for (const e of S.ents.values()) {
    if (e.boss) continue; const p = e.group.position, d = Math.hypot(p.x - S.px, p.z - S.pz); if (d > sr || !e.arch) continue;
    dot(p.x, p.z, (e.flags & 16) ? '#9be37a' : e.arch.role === 'hostile' ? '#ff5a4a' : e.arch.role === 'herd' ? '#ffd35a' : '#8cff7a', 3.2);
  }
  for (const p of S.players.values()) { const q = p.actor.group.position; dot(q.x, q.z, '#6ac8ff', 5); }
  // игрок
  g.save(); g.translate(P(S.px), P(S.pz)); g.rotate(Math.PI - S.me.face); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.stroke(); g.fill(); g.restore();
  $('bigmap-t').textContent = (S.biome === 'duel' ? T('duel') : TN(CONFIG.BIOME[S.biome].n)) + (W.ocean ? ' · ' + T('depth_m', { n: Math.max(0, Math.round(W.waterY - S.py)) }) : '');
}
const CLS_ICO = Object.fromEntries(Object.keys(CONFIG.CLS_INFO).map(k => [k, CONFIG.CLS_INFO[k].ico]));
let lastHud = 0, fpsAcc = 0, fpsN = 0, fpsShow = 60;
function updateHud(now, dt) {
  const mp = S.mp; if (!mp) return;
  const pr = S.profile, st = S.stats, setW = (id, v) => { $(id).firstElementChild.style.width = clamp(v * 100, 0, 100) + '%'; };
  const setT = (id, txt) => { const el = $(id).lastElementChild; if (el._t !== txt) { el._t = txt; el.textContent = txt; } };
  setW('b-hp', mp.hp / mp.mh); setW('b-st', S.me.stam / CONFIG.STAM_MAX); setW('b-fd', mp.fd / CONFIG.FOOD_MAX);
  const need = pr.level >= CONFIG.MAX_LEVEL ? 1 : CONFIG.xpForLevel(pr.level); setW('b-xp', pr.level >= CONFIG.MAX_LEVEL ? 1 : mp.xp / need);
  const aq = CONFIG.isAqua(pr.cls); $('b-br').style.display = aq ? '' : 'none'; if (aq) { setW('b-br', mp.br / mp.bm); setT('b-br', `${T('breath')} ${Math.ceil(mp.br)}/${Math.round(mp.bm)}`); }
  { const low = aq && mp.br <= 5; $('b-br').classList.toggle('low', !!low); if (low && S.alive && !(S.hz && now / 1000 - S.hz.t < 1.2)) { const hz = $('hz'); hz.className = 'big'; hz.style.display = 'block'; hz.textContent = '⚠ ' + T('breath_low'); S.lowBr = now; } }
  setT('b-hp', `HP ${Math.ceil(mp.hp)}/${mp.mh > 0 ? mp.mh : Math.ceil(mp.hp)}`);
  setT('b-st', `${T('stamina')} ${Math.round(S.me.stam)}/${CONFIG.STAM_MAX}`);
  setT('b-fd', `${T('hunger')} ${Math.round(mp.fd)}/${CONFIG.FOOD_MAX}`);
  setT('b-xp', pr.level >= CONFIG.MAX_LEVEL ? `${T('level_short')}${pr.level} MAX` : `XP ${Math.max(0, Math.floor(mp.xp))}/${need}`);
  const stage = CONFIG.STAGES[CONFIG.stageIndex(pr.level)].id;
  $('lvl-t').textContent = `${CLS_ICO[pr.cls]} ${pr.name} · ${T('level_short')}${pr.level} · ${T('stage_' + stage)}`; $('coins').textContent = '🪙 ' + pr.coins;
  const deb = []; if (mp.dots) deb.push('☠'); if (mp.sh > 0) deb.push('🛡 ' + Math.ceil(mp.sh) + 'с'); if (mp.hid) deb.push('🌿'); if (S.me.stun > 0) deb.push('💫'); if (S.me.clm) deb.push('🌳'); if (mp.rg >= 2) deb.push('🔥');
  if (S.sense) deb.push('👁'); $('debuf').textContent = deb.join(' ');
  const hz = $('hz'); if (S.hz && now / 1000 - S.hz.t < 1.2) { hz.className = ''; hz.style.display = 'block'; hz.textContent = '⚠ ' + T('hz_' + S.hz.k); } else if (S.lowBr !== now) hz.style.display = 'none';
  // ячейки способностей
  if (S.abBtns) for (const a of S.abBtns) {
    let frac = 0; if (a.slot === 'e') frac = mp.cd[1] / (a.cd || 1); else if (a.slot === 'q') frac = mp.cd[2] / (a.cd || 1); else if (a.slot === 'atk') frac = mp.cd[0] / (CONFIG.CLASSES[pr.cls].atkCd || 0.5);
    a.el.style.height = clamp(frac, 0, 1) * 100 + '%';
  }
  // босс
  const bb = $('bossbar'), bs = S.bs;
  if (bs && bs.st !== 'idle') { bb.style.display = 'block'; const def = CONFIG.BOSSES[bs.k]; bb.querySelector('.nm').textContent = TN(def.n); bb.querySelector('.bar > div').style.width = clamp(bs.hp / bs.mh * 100, 0, 100) + '%'; bb.querySelector('.ph').textContent = '●'.repeat(bs.ph + 1) + '○'.repeat(Math.max(0, 2 - bs.ph)) + (bs.inv ? ' 🛡' : ''); } else bb.style.display = 'none';
  // дуэль
  const db = $('duelbar'), du = S.du;
  if (du) {
    db.style.display = 'block'; const opp = S.players.get(du.opp);
    db.querySelector('.vs').textContent = T('duel_vs', { x: opp ? opp.info.nick : '?' }) + (du.tn ? ' · ' + T('tourney') : '');
    db.querySelector('.tm').textContent = du.st === 'count' ? Math.ceil(du.l) : du.st === 'fight' ? Math.ceil(du.l) + ' с' : '';
    if (du.st === 'count' && Math.ceil(du.l) !== S.lastCount) { S.lastCount = Math.ceil(du.l); Audio.sfx('count'); }
  } else db.style.display = 'none';
  // возрождение
  if (!S.alive) { $('rs-t').textContent = mp.rt > 0 ? T('respawn_in', { n: Math.ceil(mp.rt) }) : T('you_died'); }
  // подсказки у порталов
  const ph = $('portalhint'), W = S.W; ph.style.display = 'none';
  if (S.pt && !W.duel && S.alive) {
    const dIn = Math.hypot(S.px - W.portalIn.x, S.pz - W.portalIn.z), dNx = Math.hypot(S.px - W.portalNext.x, S.pz - W.portalNext.z);
    if (dIn < 22) { ph.style.display = 'block'; ph.textContent = pr.level >= S.pt.req ? (S.pt.cool > 0 ? T('boss_cool', { n: S.pt.cool }) : T('portal_hint')) : T('portal_boss', { n: S.pt.req }); ph.style.color = pr.level >= S.pt.req ? '#9be37a' : '#ffb066'; }
    else if (S.pt.next && dNx < 22) { ph.style.display = 'block'; ph.textContent = T('portal_next'); ph.style.color = '#9be37a'; }
  }
  // сведения справа
  const b = S.room.biome, bn = b === 'duel' ? T('duel') : TN(CONFIG.BIOME[b].n), mode = S.room.mode === 'code' ? T('mode_code', { c: S.room.code }) : S.room.mode === 'rush' ? 'Boss Rush' + (S.rush ? ' · ' + S.rush.w : '') : S.room.mode === 'duel' ? '' : S.o.online ? '' : T('mode_solo');
  const day = S.tod > 0.22 && S.tod < 0.78 ? '☀' : '🌙';
  $('info').innerHTML = `${bn}${mode ? ' · ' + mode : ''}<br>${day} · 👥 ${S.players.size + 1}${S.o.online ? ' · ' + (S.ping || '–') + ' мс' : ''} · ${fpsShow} fps`;
  const vert = !!(S.me.fly || (CONFIG.isAqua(pr.cls) && S.me.y < S.W.waterY && S.W.isDeep(S.me.x, S.me.z)));
  document.body.classList.toggle('vert', vert);
  if (vert !== S.vertLbl) { S.vertLbl = vert; $('tb-jump').textContent = T(vert ? 'b_up' : 'b_jump'); }
}

// ---------------------------------------------------------------- автокачество
let aqT = 0, aqN = 0, aqLow = 0, aqHigh = 0, aqDowngraded = false;
function autoQuality(dt) {
  aqT += dt; aqN++;
  if (aqT < 3) return;
  const fps = aqN / aqT; aqT = 0; aqN = 0; fpsShow = Math.round(fps);
  if (qualityPref !== 'auto') return;
  const target = IS_TOUCH ? CONFIG.TARGET_FPS_MOBILE : CONFIG.TARGET_FPS_DESKTOP, order = ['low', 'med', 'high'], i = order.indexOf(qualityName);
  if (fps < target * 0.8) { aqLow++; aqHigh = 0; if (aqLow >= 2 && i > 0) { qualityName = order[i - 1]; aqLow = 0; aqDowngraded = true; applyRenderQuality(); } }
  else if (fps > target * 0.97 && !aqDowngraded) { aqHigh++; aqLow = 0; if (aqHigh >= 3 && i < 2) { qualityName = order[i + 1]; aqHigh = 0; applyRenderQuality(); } }
  else { aqLow = 0; aqHigh = 0; }
}

// ---------------------------------------------------------------- главный цикл
let last = performance.now(), clock = 0;
const _errSeen = new Set();
function safe(fn, a, b, c) { try { fn(a, b, c); } catch (e) { const k = fn.name + ':' + e.message; if (!_errSeen.has(k)) { _errSeen.add(k); console.error(k, e); } } }
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs; clock += dt;
  autoQuality(dt);
  if (!S || !S.welcomed) { updateMenu3d(dt); renderer.render(menu3d.scene, camera); return; }
  const now = nowMs / 1000;
  S.acc = (S.acc || 0) + dt;
  let n = 0; while (S.acc >= DT && n < 5) { S.acc -= DT; n++; fixedStep(); } if (n === 5) S.acc = 0;
  // каждый блок защищён: ошибка в одном (например, у редкого объекта) не должна останавливать всю игру
  safe(updateActors, dt, clock, now);
  safe(updateEnts, dt, clock, now);
  safe(updateFx, dt);
  if (S.hatch) updateHatch(dt);
  const hc = S.hatch ? hatchCamera(dt) : false;
  if (hc !== true) {
    placeCamera(dt, S.px, S.py, S.pz, now);
    if (hc && hc.pos) { const e = S.hatch.blend * S.hatch.blend * (3 - 2 * S.hatch.blend); _cp.copy(camera.position); _cq.copy(camera.quaternion); camera.position.lerpVectors(hc.pos, _cp, e); camera.quaternion.slerpQuaternions(hc.q, _cq, e); }
  }
  flushTramplers();
  S.world.update(camera.position, { x: S.px, y: S.py, z: S.pz }, clock, dt, S.tod, S.wx);
  if (S.foodMeshes) for (const f of S.foodMeshes) { f.rotation.y += dt * 1.2; const fx = f.userData.fx; if (fx) { const q = Math.sin(clock * 3 + f.position.x), r = 1 + 0.18 * q; if (!fx.rg) { fx.glow.material.opacity = 0.3 + 0.15 * q; continue; } fx.rg.scale.set(r, r, 1); fx.glow.material.opacity = 0.45 + 0.2 * q; fx.spark.position.y = 1.5 + 0.2 * Math.sin(clock * 2.2 + f.position.z); fx.spark.material.opacity = 0.6 + 0.3 * q; } }
  if (now - lastHud > 0.1) { lastHud = now; updateHud(nowMs, dt); drawMinimap(); drawBigMap(); }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- связка с интерфейсом
const ctl = {
  start: startSession,
  // смена динозавра без выхода в главное меню: тот же мир/комната/код, другой тип (у каждого свой прогресс)
  switchType(cls) {
    if (!S || !S.welcomed) return; const o = S.o, biome = S.room.biome === 'duel' ? S.profile.biome : S.room.biome;
    startSession(Object.assign({}, o, { cls, biome, hatch: false }));
  },
  leave() { endSession(false); UI.showMenu(); },
  send(o) { if (S && S.conn) S.conn.send(o); },
  get session() { return S; },
  activeProfile, menuSetDino, menuShowEgg, menuHatch, fade, pendingHatch: null,
  setPanelOpen(v) { panelOpen = v; if (S && S.conn && !S.o.online) S.conn.paused = !!v;   // одиночная игра на паузе, пока открыто меню
    if (document.pointerLockElement) { if (v) document.exitPointerLock(); } resetInput(); },
  relock() { if (!IS_TOUCH && S && S.welcomed) { try { canvas.requestPointerLock(); } catch (e) { /* ignore */ } } },
  setQuality(q) { qualityPref = q; try { localStorage.setItem('dino_q', q); } catch (e) { /* ignore */ } if (q !== 'auto') qualityName = q; else { qualityName = IS_TOUCH ? 'med' : 'high'; aqDowngraded = false; } applyRenderQuality(); },
  getQuality: () => qualityPref,
  setSens(v) { sens = v; try { localStorage.setItem('dino_sens', String(v)); } catch (e) { /* ignore */ } }, getSens: () => sens,
  audio: Audio, IS_TOUCH, isTouch: IS_TOUCH,
  rebuildHud() { if (S && S.welcomed) { buildAbilityBar(); } }
};
$('menubtn').addEventListener('click', () => { Audio.init(); UI.openPause(); });
$('menubtn').addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });

(async function boot() {
  applyRenderQuality();
  scene = menu3d.scene;
  try {
    await Profile.restore();
    UI.init(ctl);
    UI.applyLang();
    UI.showMenu();
    Audio.setScene('menu');
  } catch (e) { console.error(e); const el = $('loaderr'); if (el) el.textContent = 'Ошибка запуска: ' + e.message; return; }
  $('loading').style.display = 'none';
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-кэш необязателен */ });
  window.__dino = { get S() { return S; }, get clock() { return clock; }, ctl, THREE, foodMesh, scene, renderer, Profile, input, camera, menu3d, menuSetDino };      // для отладки и автотестов
})();

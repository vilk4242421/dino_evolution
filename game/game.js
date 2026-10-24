/* Dino Evolution — клиент: рендер, ввод, предсказание движения, снимки сервера, эффекты, HUD. */
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { DinoNest } from './dinonest.js';
import { eggCanvas, buildCrownMesh, buildDino, animateDino, makeActor, makeNameTag, makeHpBar, buildEnemy, setOutline, animateEnemy, buildBoss, animateBoss, setCrown, setCosmetic, makeEggMesh } from './dinos.js';
import * as Profile from './profile.js';
import { connectOnline, connectLocal } from './net.js';
import * as Audio from './audio.js';
import { Story, Decor } from './story.js';
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
renderer.shadowMap.enabled = true; renderer.shadowMap.type = IS_TOUCH ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;   // на телефоне тени проще и дешевле
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
let scene = new THREE.Scene();
let qualityPref = 'auto', qualityName = IS_TOUCH ? 'med' : 'high';
try { qualityPref = localStorage.getItem('dino_q') || 'auto'; } catch (e) { /* ignore */ }
if (qualityPref !== 'auto') qualityName = qualityPref;
let sens = 1; try { sens = parseFloat(localStorage.getItem('dino_sens') || '1') || 1; } catch (e) { /* ignore */ }

let resScale = 1;   // адаптивное разрешение: 0.55…1 от базового (понижается само, если FPS низкий)
function applyRenderQuality() {
  const Q = CONFIG.QUALITY[qualityName];
  window.__dinoRes = resScale; window.__dinoQ = { low: 0.6, med: 0.8, high: 1 }[qualityName] || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? Q.prT : Q.pr) * resScale);
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
  menu3d.dino = buildDino(o); menu3d.dino.scale.setScalar(0.85 + 1.35 * clamp((Sim.scaleOf(3) - 0.36) / 1.74, 0, 1));   // в меню динозавр всегда размером как на 3 уровне
  menu3d.group.add(menu3d.dino);
  if (menu3d.egg) { menu3d.group.remove(menu3d.egg); menu3d.egg = null; }
}
function makeEgg(colorHex, skin) {
  // гладкая скорлупа: пятна нарисованы на текстуре, наружу ничего не выступает
  const g = makeEggMesh(colorHex, skin); g.position.y = 1.18;
  const w = new THREE.Group(); w.add(g); w.userData = Object.assign({ shell: g }, g.userData); return w;
}
function menuSetDinoKeepEgg(o) {
  if (menu3d.dino) { menu3d.group.remove(menu3d.dino); menu3d.dino = null; }
  menu3d.dino = buildDino(o); menu3d.group.add(menu3d.dino);
}
function menuShowEgg(colorHex, skin) {
  menuSetDino(null);
  if (menu3d.egg) { menu3d.group.remove(menu3d.egg); menu3d.egg = null; }
  menu3d.egg = makeEgg(colorHex, skin); menu3d.group.add(menu3d.egg);
}
function menuHatch(o, done) {
  menuShowEgg(o.color, o.eggskin); const eggTxt = $('eggtxt'); eggTxt.style.display = 'block'; eggTxt.textContent = T('hatching');
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
  if (menu3d.dino) { menu3d.dino.rotation.y = 0.5; animateDino(menu3d.dino, menu3d.t, menu3d.dino.userData.dbgSpeed || 0, dt, menu3d.dino.userData.dbgSt || {}); }
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
  if (k === 'KeyE') act('e'); else if (k === 'KeyQ') act('q'); else if (k === 'KeyF') act('f'); else if (k === 'KeyX') act('x');
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
  function mv(t) { let dx = (t.clientX - cx) / 44, dy = (t.clientY - cy) / 44; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } input.joyX = dx; input.joyY = dy; knob.style.transform = `translate(${dx * 30}px,${dy * 30}px)`; }
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
  S.ending = true; try { Story.abort(); } catch (e) { /* ignore */ }
  if (S.decor) { try { S.decor.dispose(); } catch (e) { /* ignore */ } S.decor = null; }
  if (S.coro) { try { endCoro(true); } catch (e) { /* ignore */ } }
  if (S.bc) { document.body.classList.remove('cine'); S.bc = null; } if (S.warp) { document.body.classList.remove('cine'); const d = S.warp.done; S.warp = null; d && d(); }
  $('tut').classList.remove('on');
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
    case 'loot': UI.banner('🦴 +' + m.bone + '  🟫 +' + m.hide + ' · ' + T('loot_t'), 3600); break;
    case 'redeemed': { if (m.ok) { UI.banner('🎟 ' + T('promo_ok', { c: m.coins }), 3600); Audio.sfx('level'); setTimeout(() => UI.openShop && UI.openShop(), 400); } else UI.toast(T(m.err === 'used_code' ? 'promo_used' : 'promo_bad')); break; }
    case 'crafted': { const c = CONFIG.COSMETICS[m.id]; if (c) { UI.banner('🛠 ' + TN(c.n), 3200); Audio.sfx('level'); } break; }
    case 'elo': { const lg = CONFIG.leagueOf(m.elo); UI.banner(lg.ico + ' ' + (m.d > 0 ? '+' : '') + m.d + ' · ' + T('rating') + ' ' + m.elo + (m.up ? ' · ' + T('league_up', { n: TN(lg.n) }) : ''), 4200); if (m.d > 0) Audio.sfx('level'); break; }
    case 'achok': { const a = CONFIG.achById(m.id), r = CONFIG.ACH_REWARD[m.id] || {}; if (a) { UI.banner('🎁 ' + TN(a.n) + (r.c ? ' · +' + r.c + ' 🪙' : '') + (r.title ? ' · ' + CONFIG.TITLES[r.title].ico + ' ' + TN(CONFIG.TITLES[r.title].n) : ''), 4200); Audio.sfx('coin'); } break; }
    case 'login': showLogin(m.l); break;
    case 'dead': S.deadBy = m.by; S.revWait = !!m.rv; $('respawn').classList.add('on'); $('rs-s').textContent = m.by ? T('killed_by', { x: m.by }) : ''; break;
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
  el.style.display = 'block'; el.firstElementChild.textContent = m.duel ? T('duel_search') : T('tourney_wait', { n: m.n }) + (m.code ? ' · ' + m.code : ''); $('tq-x').textContent = T('tourney_cancel');
}
$('tq-x').addEventListener('click', () => S && S.conn.send({ t: 'tourney_cancel' }));

function buildWorldFor(biome) {
  if (S.decor) { S.decor.dispose(); S.decor = null; }
  if (S.world) S.world.dispose();
  scene = new THREE.Scene();
  S.world = buildWorld(scene, biome); S.W = S.world.sim; S.biome = biome; S.world.applyQuality(qualityName);
  S.texts.length = 0; S.fx = { rings: [], parts: [] }; initFx();   // эффекты и всплывающие цифры живут в сцене мира
  S.decor = new Decor(scene);
  Audio.setScene(biome);
}
function onWelcome(m) {
  if (m.proto !== CONFIG.PROTO) { failSession('server_off'); return; }
  const first = !S.welcomed; S.welcomed = true; S.id = m.id; S.room = m.room; S.host = m.host || 0;
  if (first && S.o && (S.o.duelq || S.o.tourneyJoin)) { const kind = S.o.duelq ? 'duelq' : 'tourney'; S.o.duelq = S.o.tourneyJoin = false; setTimeout(() => S && S.conn && S.welcomed && S.conn.send({ t: kind }), 2200); }
  if (!first && S.warp) endWarp();          // перелёт в новый мир: ролик портала закончен, новый динозавр не должен его «доигрывать»
  if (!first && S.bc) endBcine();
  if (!first && !S.warp && !S.coro && !S.bc) document.body.classList.remove('cine');
  if (!S.world || S.biome !== m.room.biome) buildWorldFor(m.room.biome);
  for (const p of S.players.values()) p.actor && p.actor.dispose();
  for (const e of S.ents.values()) e.group && e.group.parent && e.group.parent.remove(e.group);
  S.players.clear(); S.ents.clear(); S.pending.length = 0; S.lastRs = null; S.off = { x: 0, y: 0, z: 0 }; S.drops = []; S.zones.forEach(z => z.mesh.parent && z.mesh.parent.remove(z.mesh)); S.zones = [];
  S.nestGrp = null; S.nestKey = ''; S.bs = null; S.du = null; S.rush = null; S.pt = null; S.al = null; if (S.secM) { for (const m of S.secM.values()) scene.remove(m); S.secM.clear(); } prevNight = prevStorm = null;
  S.me = Sim.newPlayer(S.W, m.me.x, m.me.z); Sim.importState(S.me, m.me); S.lastPos = null;
  onProfile(m.prof, true);
  if (m.login) setTimeout(() => showLogin(m.login), 1800);
  if (m.season) setTimeout(() => { const se = m.season, lg = CONFIG.LEAGUES.find(x => x.id === se.league); UI.banner(lg.ico + ' ' + T('season_end', { n: TN(lg.n), c: se.coins }) + (se.title ? ' · ' + CONFIG.TITLES[se.title].ico + ' ' + TN(CONFIG.TITLES[se.title].n) : '') + (se.cos ? ' · 🎁 ' + TN(CONFIG.COSMETICS[se.cos].n) : ''), 7000); Audio.sfx('coin'); }, 6000);
  setTimeout(() => { if (S && S.welcomed && !S.ending) tutStart(); }, 2500);
  S.actor && S.actor.dispose();
  const pr = S.profile;
  S.actor = makeActor({ nick: pr.name, color: pr.color, cls: pr.cls, level: pr.level, evo: pr.evo, cosmetic: pr.cosmetic, pet: pr.pet || '', title: pr.title || '', patc: pr.patc || '', morph: pr.morph || '', admin: Profile.state.admin && S.o.online, king: pr.kings.indexOf(m.room.biome) >= 0, lord: Sim.isLord(pr), end: pr.ending || '' });
  scene.add(S.actor.group);
  for (const p of m.players) addPlayer(p);
  S.tod = m.tod; input.yaw = S.me.face + Math.PI; input.pitch = 0.3; S.snapN = 0;
  S.world.setPortalNext(false);
  UI.showLoading(false); UI.closeAll(); $('hud').classList.add('on'); S.lastHud = 0; buildAbilityBar();
  const inDuel = m.room.biome === 'duel';
  $('hint').textContent = IS_TOUCH ? '' : T('hint_pc'); setTimeout(() => { if ($('hint')) $('hint').style.opacity = 0; }, 14000); $('hint').style.opacity = 0.8;
  const hatchNow = first && S.o.hatch && !inDuel && S.world.nestInfo;
  const sw = Story.onWelcome(S.profile, { hatchNow: !!hatchNow, sea: !inDuel && CONFIG.OCEANS.indexOf(m.room.biome) >= 0 });
  if (hatchNow) {
    ctl.pendingHatch = null; const mine = S;
    const go = () => { if (S !== mine || S.ending) return; beginHatch(); setTimeout(() => fade(false, 1300), 350); };
    if (sw.needPrologue) Story.queue(async () => { fade(false, 300); await Story.play('prologue'); if (S === mine && !S.ending) S.conn && S.conn.send({ t: 'story', k: 'pro' }); go(); }); else go();
  }
  else { if (S.o.hatch) { ctl.pendingHatch = null; } fade(false, 900); if (inDuel) { Audio.setScene('duel'); } else if (first) UI.banner(TN(CONFIG.BIOME[m.room.biome].n), 2600); }
  Audio.sfx('portal');
  if (first) setTimeout(() => { if (S && S.welcomed && !S.ending) sw.after(); }, 3000);
  try { localStorage.removeItem('dino_maxlv'); } catch (e) { /* ignore */ }      // остаток старого режима
  if (S.o.online) S.pingT = setInterval(() => { if (S && S.conn) S.conn.send({ t: 'ping', n: performance.now() }); }, 4000);
  $('respawn').classList.remove('on');
}
function showLogin(l) {   // награда за вход в новый день
  if (!l) return;
  UI.banner('🔥 ' + T('streak_n', { n: l.streak }) + ' · +' + l.coins + ' 🪙' + (l.cos ? ' · 🎁 ' + TN(CONFIG.COSMETICS[l.cos].n) : ''), 4600); Audio.sfx('coin');
}
function onProfile(p, silent) {
  const old = S.profile; S.profile = Sim.fixProfile(p);
  if (S.o.online) Profile.setServerProfile(p); else Profile.saveLocal(S.profile);
  S.stats = Sim.statsFor(S.profile.cls, S.profile.level, S.profile.evo);
  S.sense = S.stats.sense || 0;
  if (old && S.actor && old.cls === S.profile.cls && CONFIG.stageIndex(S.profile.level) > CONFIG.stageIndex(old.level) && !silent) {
    const sn = T('stage_' + CONFIG.STAGES[CONFIG.stageIndex(S.profile.level)].id); UI.banner('🦖 ' + T('grew', { s: sn }), 3200); Audio.sfx('coin');
  }
  if (S.actor) S.actor.set({ level: S.profile.level, evo: S.profile.evo, cosmetic: S.profile.cosmetic || '', pet: S.profile.pet || '', title: S.profile.title || '', patc: S.profile.patc || '', morph: S.profile.morph || '', color: S.profile.color, lord: Sim.isLord(S.profile), end: S.profile.ending || '', king: S.profile.kings.indexOf(S.biome) >= 0 });
  // новые достижения
  const done = {}; for (const a of CONFIG.ACH) done[a.id] = !!a.t(S.profile);
  if (S.ach && !silent) for (const a of CONFIG.ACH) if (done[a.id] && !S.ach[a.id]) { UI.note('🏆 ' + TN(a.n)); Audio.sfx('coin'); }
  S.ach = done;
  if (old && S.profile.coins > old.coins) Audio.sfx('coin');
  UI.refreshOpen && UI.refreshOpen();
}
function addPlayer(info) {
  if (info.id === S.id || S.players.has(info.id)) return;
  const actor = makeActor({ nick: info.nick, color: info.color, cls: info.cls, level: info.level, evo: info.evo, cosmetic: info.cosmetic, pet: info.pet || '', title: info.title || '', patc: info.patc || '', morph: info.morph || '', admin: info.admin, king: info.king, lord: info.lord, end: info.end || '', label: info.bot ? '' : '' });
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
  S.tod = m.tod; S.wx = m.wx; weatherBanners();
  if (m.sc) updateSecretMeshes(m.sc);
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
  if ((r[8] & 1) && !(prevF & 1)) { e.model.userData.bite = 1; Audio.sfx(e.boss ? 'chomp' : 'swing', { x: r[2], z: r[4], ref: e.boss ? 20 : 6 }); }
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
    let fy = d[1] > S.W.waterY - 0.6 && S.world && S.world.meshH ? Math.max(d[1], S.world.meshH(d[0], d[2]) + 0.03) : d[1];
    if (S.world && S.world.waveAt && !S.W.ocean && S.W.liquid !== 'lava' && S.world.meshH && S.world.meshH(d[0], d[2]) < S.W.waterY - 0.05) {   // еда над водой плавает на поверхности и качается на волнах
      const k = clock * 1.7 + d[0] * 0.7; fy = S.W.waterY + S.world.waveAt(d[0], d[2]) * 0.9 + 0.04 + Math.sin(k) * 0.025;
    }
    f.position.set(d[0], fy, d[2]);
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
// ---- звук: тип голоса по классу/виду, позиция, шаги
const kindOfCls = (cls) => { const c = CONFIG.CLASSES[cls]; return !c ? 'carn' : c.aqua ? 'aqua' : cls === 'fly' ? 'fly' : cls === 'herb' ? 'herb' : 'carn'; };
function voiceOf(id) {   // {kind, size, boss} голоса существа по его id
  if (id === S.id) return { kind: kindOfCls(S.profile.cls), size: Sim.scaleOf(S.profile.level) / 2.1 };
  const p = S.players.get(id); if (p) return { kind: kindOfCls(p.info.cls), size: Sim.scaleOf(p.info.level || 1) / 2.1 };
  const e = S.ents.get(id); if (e) { if (e.boss) return { kind: 'carn', size: 1, boss: e.bossId }; const a = e.arch || {}; return { kind: a.fly ? 'fly' : a.water ? 'aqua' : a.model === 'quad' ? 'herb' : 'carn', size: Math.min(1, (a.size || 1) / 3) }; }
  return { kind: 'carn', size: 0.5 };
}
const sndAt = (p, o) => Object.assign({ x: p.x, z: p.z }, o || {});
function stepSurf(water) { if (water) return 'water'; const b = S.biome; return b === 'snow' ? 'snow' : b === 'desert' ? 'sand' : b === 'mountain' || b === 'volcano' ? 'rock' : b === 'swamp' ? 'mud' : 'grass'; }
// один звук на шаг: длина шага растёт с размером; в воздухе — тишина
function footSound(o, x, z, mass, ground, water, ref) {
  if (o.stD === undefined) { o.stD = 0; o.stX = x; o.stZ = z; return; }
  const d = Math.hypot(x - o.stX, z - o.stZ); o.stX = x; o.stZ = z; if (d > 3) return;
  if (!ground) { o.stD = 0; return; }
  o.stD += d; const stride = 0.8 + mass * 1.5;
  if (o.stD >= stride) { o.stD -= stride; Audio.step(stepSurf(water), mass, { x, z, ref: ref || 6 }); }
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
      const heavy = ev[3] === 1 || ev[2] >= 30, crit = ev[3] === 1;
      floatText(p.x, p.y + 2.2, p.z, (me ? '-' : '') + ev[2], col, heavy ? 1.6 : ev[3] ? 1.3 : 1);
      burst(p.x, p.y + 1.1, p.z, me ? 0xff3a2a : 0xffe08a, me ? 8 : 6, 3.5);
      if (heavy) { burst(p.x, p.y + 1.1, p.z, 0xc4180e, 14, 5.5, 3); burst(p.x, p.y + 1.3, p.z, 0xffffff, 8, 7, 1); ring(p.x, p.y, p.z, me ? 0xff3a2a : 0xffd35a, 2.6, 0.35); }   // удар посильнее: капли, искры и кольцо
      { const sp = sndAt(p); if (me) { Audio.sfx('hurt', sp); Audio.sfx(heavy ? 'thud' : 'hit', sp); } else if (crit) { Audio.sfx('crit', sp); Audio.sfx('thud', sp); } else Audio.sfx(heavy ? 'thud' : Math.random() < 0.55 ? 'bite' : 'hit', sp); }
      if (me) { S.camShake = Math.max(S.camShake, heavy ? 0.55 : 0.25); const hf = $('hurtfx'); hf.classList.remove('go'); void hf.offsetWidth; hf.classList.add('go'); }
      else { S.camShake = Math.max(S.camShake, heavy ? 0.2 : 0.07); const te = S.ents.get(ev[1]); if (te) { te.olUntil = now + 0.7; te.olOn = true; setOutline(te.model, true, 0xff2418); } }   // красный контур укушенного врага
      const pl = S.players.get(ev[1]); if (pl) pl.hurt = now;
      break;
    }
    case 'k': { const e = S.ents.get(ev[1]); if (e) { const bs = (e.arch && e.arch.size) || 1; burst(e.group.position.x, e.group.position.y + 1, e.group.position.z, 0xffd35a, 18, 5); burst(e.group.position.x, e.group.position.y + 1, e.group.position.z, 0xc4180e, Math.round(8 + 10 * bs), 4.5, 3); if (bs >= 1) { ring(e.group.position.x, e.group.position.y, e.group.position.z, 0xffd35a, 2.5 * bs, 0.5); const sp = sndAt(e.group.position); Audio.sfx('thud', sp); Audio.sfx('die', Object.assign({ g: 0.7 }, sp)); } e.group.parent && e.group.parent.remove(e.group); S.ents.delete(ev[1]); } break; }
    case 'd': p = posOf(ev[1]); if (p) burst(p.x, p.y + 1, p.z, 0xcc3322, 22, 5); if (ev[1] === S.id) { Audio.sfx('die'); S.camShake = 0.6; } else if (p) Audio.sfx('die', sndAt(p)); break;
    case 'lv': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffe066, 4, 0.9); burst(p.x, p.y + 1, p.z, 0xffe066, 24, 5); } if (ev[1] === S.id) { Audio.sfx('level'); UI.banner(T('lv_up', { n: ev[2] }), 2200); } break;
    case 'xp': if (ev[1] === S.id) { p = posOf(ev[1]); if (p) floatText(p.x, p.y + 3.0, p.z, '+' + ev[2] + ' XP', '#9be37a', 0.8); } break;
    case 'eat': p = posOf(ev[1]); if (p) burst(p.x, p.y + 1.4, p.z, ev[2] === 'plant' ? 0x6ccf4a : 0xd9534f, 8, 2.5); if (p) Audio.sfx(ev[2] === 'plant' ? 'eat_plant' : 'eat_meat', ev[1] === S.id ? null : sndAt(p)); break;
    case 'b': { const pl = ev[1] === S.id ? S.actor : (S.players.get(ev[1]) || {}).actor; if (pl) pl.dino.userData.bite = 1; { const q = posOf(ev[1]); if (q) Audio.sfx('swing', ev[1] === S.id ? null : sndAt(q, { g: 0.7 })); } break; }
    case 'evo': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0x7af0ff, 5, 1.0); burst(p.x, p.y + 1, p.z, 0x7af0ff, 30, 6); } if (ev[1] === S.id) { Audio.sfx('evo'); UI.banner(T('evo_done'), 1600); } break;
    case 'ult': { trikeRoar(ev[1]); p = posOf(ev[1]); const id = ev[2], R = ev[3] || 8;
      if (p) { const col = { rampage: 0xff5a2a, quake: 0xc9a86a, storm: 0xbfe6ff, whirl: 0x4aa8ff, tide: 0x6affc8, frenzy: 0xffe14a }[id] || 0xffffff;
        ring(p.x, p.y, p.z, rfxBurst(ev[1], p) || col, R || 8, 1.1); ring(p.x, p.y + 0.3, p.z, 0xffffff, (R || 8) * 0.6, 0.8); burst(p.x, p.y + 1, p.z, col, 60, 9, 4); }
      if (p) Audio.sfx(id === 'quake' ? 'quake' : 'roar', sndAt(p, voiceOf(ev[1]))); if (ev[1] === S.id) { S.camShake = Math.max(S.camShake || 0, 0.5); UI.banner(CONFIG.ABIL_INFO[id].ico + ' ' + TN(CONFIG.ABIL_INFO[id].n), 2200); } break; }
    case 'heal': p = posOf(ev[1]); if (p) { burst(p.x, p.y + 1.5, p.z, 0x6affc8, 18, 3, 3); } break;
    case 'pet': { p = posOf(ev[1]); if (p) { if (ev[2] === 1) { burst(p.x, p.y + 1.2, p.z, 0xffd35a, 10, 3, 2); if (ev[1] === S.id) { floatText(p.x, p.y + 2.8, p.z, '+' + ev[3] + ' 🪙', '#ffd35a', 1); Audio.sfx('coin'); } } else if (ev[2] === 0) burst(p.x, p.y + 1.5, p.z, 0x6affc8, 8, 2, 2); else { const t = S.ents.get(ev[3]); if (t) burst(t.group.position.x, t.group.position.y + 1, t.group.position.z, 0x8a6a3a, 8, 3, 1); } } break; }
    case 'dash': p = posOf(ev[1]); if (p) { burst(p.x, p.y + 0.5, p.z, 0xffffff, 10, 3, 0.5); Audio.sfx('dash', sndAt(p)); } break;
    case 'dive': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffffff, 3, 0.4); burst(p.x, p.y, p.z, 0xdddddd, 14, 4); Audio.sfx('dash', sndAt(p)); Audio.sfx('thud', sndAt(p)); } break;
    case 'roar': trikeRoar(ev[1]); p = posOf(ev[1]); if (p) ring(p.x, p.y, p.z, rfxBurst(ev[1], p) || 0xff7a4a, ev[2] || 14, 0.8); if (p) Audio.sfx('roar', sndAt(p, voiceOf(ev[1]))); if (ev[1] !== S.id) S.camShake = Math.max(S.camShake, 0.1); break;
    case 'screech': p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffe14a, ev[2] || 10, 0.7); Audio.sfx('screech', sndAt(p, voiceOf(ev[1]))); } break;
    case 'herd': trikeRoar(ev[1]); p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xc9a86a, ev[2] || 9, 0.6); burst(p.x, p.y + 0.3, p.z, 0xb59a6a, 26, 5); if (ev[1] === S.id) S.camShake = Math.max(S.camShake || 0, 0.35); Audio.sfx('thud', sndAt(p)); } break;
    case 'grd': p = posOf(ev[1]); if (p) { burst(p.x, p.y + 1.0, p.z, 0x9ad8ff, 10, 2.5); Audio.sfx('shield', ev[1] === S.id ? null : sndAt(p)); } break;   // щит: светящийся пузырь вокруг динозавра (без плоского «круга-таблички»)
    case 'fly': p = posOf(ev[1]); if (p) burst(p.x, p.y + 0.3, p.z, 0xdddddd, 12, 3); break;
    case 'arc': { const a = posOf(ev[1]), b = posOf(ev[2]); if (a && b) { for (let i = 0; i < 8; i++) { const t = i / 7; burst(a.x + (b.x - a.x) * t, a.y + 1 + (b.y - a.y) * t, a.z + (b.z - a.z) * t, 0x7ad8ff, 2, 1, 0); } Audio.sfx('shock', sndAt(a)); } break; }
    case 'em': p = posOf(ev[1]); if (p) { floatText(p.x, p.y + 3.6, p.z, EMOJI[ev[2]] || '?', '#ffffff', 1.4); Audio.sfx('emote', sndAt(p)); } break;
    case 'tel': spawnTelegraph(ev[1], ev[2], ev[3], ev[4], ev[5], ev[6], ev[7], ev[8]); break;
    case 'shake': S.camShake = Math.max(S.camShake, ev[1] * 0.7); Audio.sfx('boom', { g: 0.7 }); break;
    case 'boss': {
      if (ev[2] === 'start') { UI.banner(T('boss_start'), 2200); { const be = S.ents.get(ev[1]); Audio.sfx('boss', { boss: be && be.bossId }); } Audio.setBoss(true); if (!S.rush && S.biome !== 'duel') { Story.bossIntro(S.biome, S.profile.kings.indexOf(S.biome) >= 0); { const bid = ev[1], tryBc = (n) => { if (!S || !S.welcomed) return; const be = S.ents.get(bid); if (be && be.group) startBcine(be); else if (n < 25) setTimeout(() => tryBc(n + 1), 120); }; tryBc(0); } } }
      else if (ev[2] === 'reset') Audio.setBoss(false);
      else if (ev[2] === 'dead') { Audio.setBoss(false); if (!S.rush && S.biome !== 'duel') Story.bossOutro(S.biome); UI.banner(T('boss_dead'), 3200); Audio.sfx('king'); const e = S.ents.get(ev[1]); if (e) Audio.sfx('die', { x: e.group.position.x, z: e.group.position.z, ref: 30 }); if (e) for (let i = 0; i < 4; i++) burst(e.group.position.x, e.group.position.y + 2 + i, e.group.position.z, 0xffb04a, 30, 8); }
      break;
    }
    case 'bossph': UI.banner(T('boss_phase', { n: ev[2] + 1 }), 1800); { const be = S.ents.get(ev[1]); Audio.sfx('boss', { boss: be && be.bossId }); } break;
    case 'summon': { const be = S.ents.get(ev[1]); if (be) Audio.sfx('roar', sndAt(be.group.position, { boss: be.bossId, ref: 20 })); break; }
    case 'burrow': { const e = S.ents.get(ev[1]); if (e) { e.burrowed = !!ev[2]; burst(e.group.position.x, e.group.position.y, e.group.position.z, 0xc9a25a, 24, 6); Audio.sfx('boom', sndAt(e.group.position, { ref: 20 })); } break; }
    case 'king': {
      p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0xffd35a, 8, 1.4); burst(p.x, p.y + 2, p.z, 0xffd35a, 40, 8); }
      if (ev[1] === S.id) { if (ev[3]) { Story.afterKing(ev[2], S.profile); Story.queue(() => startWarp()); } if (ev[3] || ev[4]) startCoro({ biome: ev[2], lord: ev[4], xp: ev[5], coins: ev[6] }); else { UI.banner(T('king_new', { b: TN(CONFIG.BIOME[ev[2]].n) }), 4200); Audio.sfx('king'); } }
      break;
    }
    case 'rev': { p = posOf(ev[1]); if (p) { ring(p.x, p.y, p.z, 0x6cff9a, 5, 1.0); burst(p.x, p.y + 1.2, p.z, 0x6cff9a, 28, 6, 4); floatText(p.x, p.y + 2.6, p.z, '❤', '#6cff9a', 1.6); } Audio.sfx('level'); if (ev[1] === S.id) UI.banner('❤ ' + T('rev_you'), 2600); break; }
    case 'rare': if (ev[1] === S.id) { UI.banner('⛈ ' + T('rare_find', { c: ev[2] }), 3000); Audio.sfx('coin'); const q = posOf(S.id); if (q) burst(q.x, q.y + 2, q.z, 0xffe066, 20, 5, 3); } break;
    case 'bolt': boltFx(ev[1], ev[2]); break;
    case 'sec': { const q = posOf(ev[1]); if (q) { burst(q.x, q.y + 1.5, q.z, 0xffd35a, 36, 6, 4); ring(q.x, q.y, q.z, 0xffd35a, 4, 0.8); }
      if (ev[1] === S.id) { UI.banner(ev[2] === 'chest' ? '📦 ' + T('sec_chest', { c: ev[3] }) : ev[2] === 'pearl' ? '🦪 ' + T('sec_pearl', { c: ev[3] }) : '✨ ' + T('sec_fruit', { b: T('buff_' + ev[4]) }), 3400); Audio.sfx(ev[2] === 'chest' ? 'coin' : 'level'); } break; }
    case 'quest': if (ev[1] === S.id) { const q = (S.profile.daily && S.profile.daily.q || [])[ev[2]]; UI.banner('✅ ' + T('quest_done') + (q ? ': ' + UI.questText(q) : '') + ' · +' + ev[3] + ' 🪙' + (ev[4] ? ' · ' + T('quest_all') : ''), 3800); Audio.sfx('coin'); } break;
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
  defs.push(['x', CONFIG.ULTS[cls].id, 'X', null]);
  S.abBtns = [];
  for (const [slot, id, key, cd] of defs) {
    const b = document.createElement('button'); b.className = 'ab'; b.innerHTML = `<small>${key === 'LMB' ? (IS_TOUCH ? '' : '🖱') : key}</small><span>${(id === 'atk' ? CONFIG.CLS_INFO[cls].atkIco : (ABIL[id] || CONFIG.ABIL_INFO[id]).ico)}</span><div class="cd"></div><b class="ct"></b><div class="nm">${TN((ABIL[id] || CONFIG.ABIL_INFO[id]).n)}</div>`;
    const down = e => { e.preventDefault(); Audio.init(); if (slot === 'atk') { input.atk = true; b.classList.add('held'); } else act(slot); };
    const up = () => { if (slot === 'atk') { input.atk = false; b.classList.remove('held'); } };
    b.addEventListener('touchstart', down, { passive: false }); b.addEventListener('touchend', up); b.addEventListener('mousedown', down); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);
    bar.appendChild(b); S.abBtns.push({ slot, b, cd, el: b.querySelector('.cd'), ct: b.querySelector('.ct') });
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
  const skin = S.profile && S.profile.eggskin && CONFIG.COSMETICS[S.profile.eggskin] ? S.profile.eggskin.slice(2) : '';
  let tex; if (skin) { tex = new THREE.CanvasTexture(eggCanvas(skin, CONFIG.COLORS[S.profile.color])); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; } else tex = DinoNest.shellTexture(ni ? ni.shell : 'sand', seed, false);
  const pores = DinoNest.poreTexture(seed + 3);
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
  if (t > 6.1 && !h.roared) { h.roared = true; if (S.actor) S.actor.dino.userData.bite = 1; Audio.sfx('roar', { kind: kindOfCls(S.profile.cls), size: 0.05 }); }
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
// трицератопс поднимает голову и ревёт (рёв, топот стада, ульта)
function trikeRoar(id) { const pl = id === S.id ? S.actor : (S.players.get(id) || {}).actor; if (pl && pl.dino) pl.dino.userData.roar = 1; }
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
const _lf = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _tmpCam = new THREE.PerspectiveCamera();
function hatchCamera(dt) {
  const h = S.hatch; if (!h || h.blend >= 1) return false;
  const t = clock - h.t0, gp = h.grp.position, u = Math.min(1, t / HATCH_END), a = h.camA + (u * u * (3 - 2 * u)) * Math.PI * 0.92, R = 3.4 + u * 1.4, lift = h.burst ? 0.9 : 0.55;
  _tmpCam.position.set(gp.x + Math.sin(a) * R, h.floorY + 1.5 + Math.min(1, t / 7) * 0.5, gp.z + Math.cos(a) * R);
  _tmpCam.lookAt(gp.x, h.floorY + lift, gp.z);
  if (h.blend <= 0) { camera.position.copy(_tmpCam.position); camera.quaternion.copy(_tmpCam.quaternion); camera.fov = 50; camera.updateProjectionMatrix(); return true; }
  return { pos: _tmpCam.position.clone(), q: _tmpCam.quaternion.clone() };
}





// ---------------------------------------------------------------- секреты (сундуки, золотые плоды), молнии, ночь и гроза
function secretMesh(kind) {
  const g = new THREE.Group();
  if (kind === 0) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.8 }), gold = new THREE.MeshStandardMaterial({ color: 0xffd35a, emissive: 0x6a4a00, roughness: 0.4, metalness: 0.5 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.65), wood); b.position.y = 0.3; g.add(b);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 12, 1, false, 0, Math.PI), wood); lid.rotation.z = Math.PI / 2; lid.position.y = 0.58; lid.rotation.y = 0; g.add(lid);
    for (const x of [-0.32, 0.32]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.7), gold); band.position.set(x, 0.32, 0); g.add(band); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.08), gold); lock.position.set(0, 0.5, 0.34); g.add(lock);
  } else if (kind === 2) {          // жемчужина в гигантской раковине
    const sh = new THREE.MeshStandardMaterial({ color: 0xe8d4c0, roughness: 0.45, side: THREE.DoubleSide }), ribs = (c) => { const geo = new THREE.SphereGeometry(0.62, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + 0.05 * Math.cos(a * 12); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } geo.computeVertexNormals(); return geo; };
    const low = new THREE.Mesh(ribs(), sh); low.scale.set(1, 0.55, 0.85); low.position.y = 0.05; g.add(low);
    const up = new THREE.Mesh(ribs(), sh); up.scale.set(1, 0.5, 0.85); up.rotation.x = Math.PI - 0.7; up.position.set(0, 0.42, -0.42); g.add(up);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xbfd8ff, emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.2 })); pearl.position.y = 0.3; g.add(pearl);
  } else {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd35a, emissive: 0xc08a10, emissiveIntensity: 0.9, roughness: 0.3 })); fruit.position.y = 0.9; g.add(fruit);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), new THREE.MeshStandardMaterial({ color: 0x4aa84a })); leaf.position.set(0, 1.35, 0); g.add(leaf);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 9, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.position.y = 4.5; g.add(beam);
  g.userData.kind = kind; return g;
}
function updateSecretMeshes(list) {
  if (!S.secM) S.secM = new Map();
  const seen = new Set();
  for (const r of list) {
    seen.add(r[0]); let m = S.secM.get(r[0]);
    if (!m) { m = secretMesh(r[1]); scene.add(m); S.secM.set(r[0], m); }
    m.position.set(r[2], r[3], r[4]); m.userData.y0 = r[3];
  }
  for (const [id, m] of S.secM) if (!seen.has(id)) { scene.remove(m); m.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); S.secM.delete(id); }
}
let secSpark = 0;
function secretsFx(dt) {
  if (!S.secM) return; secSpark -= dt;
  for (const m of S.secM.values()) {
    if (m.userData.kind === 1) { m.rotation.y += dt * 1.5; m.position.y = m.userData.y0 + Math.sin(clock * 2 + m.position.x) * 0.12; }
    if (secSpark <= 0 && Math.hypot(m.position.x - S.px, m.position.z - S.pz) < 45) burst(m.position.x, m.position.y + 0.9, m.position.z, 0xffd35a, 2, 0.8, 2);
  }
  if (secSpark <= 0) secSpark = 0.35;
}
function boltFx(x, z) {
  if (!S || !S.W) return;
  const y0 = S.W.heightAt(x, z), pts = []; let px = x, pz = z;
  for (let i = 0; i <= 12; i++) { const k = i / 12; pts.push(new THREE.Vector3(px, y0 + 70 * (1 - k), pz)); px += (Math.random() - 0.5) * 7 * (1 - k * 0.4); pz += (Math.random() - 0.5) * 7 * (1 - k * 0.4); }
  pts[0].x = x; pts[0].z = z;
  const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })); ln.frustumCulled = false;
  scene.add(ln); setTimeout(() => { scene.remove(ln); ln.geometry.dispose(); ln.material.dispose(); }, 260);
  burst(x, y0 + 0.5, z, 0xcfe4ff, 24, 7, 3);
  const f = $('boltfx'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const d = Math.hypot(x - S.px, z - S.pz); setTimeout(() => Audio.sfx('thunder', { x, z, ref: 70 }), Math.min(2600, d / 340 * 1000));
  if (d < 40) S.camShake = Math.max(S.camShake, 0.3);
}

// ---------------------------------------------------------------- следы и эффекты рёва из магазина
function rfxOf(id) { const k = id === S.id ? S.profile.rfx : (S.players.get(id) && S.players.get(id).info.rfx); return k && CONFIG.COSMETICS[k] ? k : ''; }
function rfxBurst(id, p) {
  const k = rfxOf(id); if (!k) return 0;
  const c = CONFIG.COSMETICS[k].c; burst(p.x, p.y + 1.2, p.z, c, k === 'r_skull' ? 30 : 40, k === 'r_toxic' ? 3 : 7, k === 'r_skull' ? 7 : 3); return c;
}


// ---------------------------------------------------------------- украшения гнезда (трофеи и яйца хозяина комнаты)
function nestOwnerList() {
  if (!S || !S.profile) return [];
  const host = S.room && S.room.mode !== 'public' && S.host && S.host !== S.id ? S.players.get(S.host) : null;
  return host && host.info ? (host.info.nest || []) : ((S.profile.nest && S.profile.nest.put) || []);
}
// ---- текстуры и заготовки для реалистичного декора гнезда (кэшируются)
const _nt = {};
function nestCanvasTex(key, w, h, draw) {
  if (_nt[key]) return _nt[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return (_nt[key] = t);
}
function leafTex(c1, c2) {      // лист с прожилками и зубчатым краем
  return nestCanvasTex('leaf' + c1 + c2, 128, 256, (g, w, h) => {
    const sh = () => { g.beginPath(); g.moveTo(w / 2, h - 4); g.bezierCurveTo(w * 0.02, h * 0.72, w * 0.02, h * 0.28, w / 2, 4); g.bezierCurveTo(w * 0.98, h * 0.28, w * 0.98, h * 0.72, w / 2, h - 4); g.closePath(); };
    const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, c2); gr.addColorStop(1, c1); sh(); g.fillStyle = gr; g.fill();
    g.save(); sh(); g.clip(); g.strokeStyle = 'rgba(255,255,230,.38)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(w / 2, h - 2); g.lineTo(w / 2, 8); g.stroke(); g.lineWidth = 1.1;
    for (let i = 0; i < 11; i++) { const y = h - 26 - i * 20; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * 24, y - 12, w / 2 + s * 52, y - 34); g.stroke(); } }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,30,0' : '255,255,200'},${Math.random() * 0.07})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    g.restore();
  });
}
function frondTex() {           // вайя папоротника с парными перышками
  return nestCanvasTex('frond', 128, 256, (g, w, h) => {
    g.strokeStyle = '#2c6a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 4); g.stroke();
    for (let i = 0; i < 24; i++) { const y = h - 12 - i * 10, L = (w / 2 - 6) * Math.sin((1 - i / 25) * 2.9 + 0.2) * 0.95 + 5; for (const s of [-1, 1]) { g.fillStyle = `hsl(${105 + i * 1.2},50%,${26 + (i % 2) * 5}%)`; g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * L * 0.5, y - 9, w / 2 + s * L, y - 4); g.quadraticCurveTo(w / 2 + s * L * 0.5, y + 1, w / 2, y + 3); g.fill(); } }
  });
}
function featherTex(c1, c2) {   // перо с бородками
  return nestCanvasTex('feather' + c1 + c2, 96, 256, (g, w, h) => {
    const sh = () => { g.beginPath(); g.moveTo(w / 2, h - 2); g.bezierCurveTo(-8, h * 0.7, 4, h * 0.2, w / 2, 2); g.bezierCurveTo(w - 4, h * 0.2, w + 8, h * 0.7, w / 2, h - 2); g.closePath(); };
    const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, c2); gr.addColorStop(1, c1); sh(); g.fillStyle = gr; g.fill(); g.save(); sh(); g.clip();
    for (let i = 0; i < 70; i++) { const y = h - 20 - i * 3.2; for (const s of [-1, 1]) { g.strokeStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.22})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w / 2 + s * 46, y - 16 - Math.random() * 6); g.stroke(); } }
    g.strokeStyle = 'rgba(245,235,215,.95)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 6); g.stroke(); g.restore();
  });
}
function bentPlane(w, h, sx, sy, bend, twist) {  // изогнутая плоскость для листьев и перьев
  const geo = new THREE.PlaneGeometry(w, h, sx, sy); geo.translate(0, h / 2, 0); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h, x = p.getX(i); p.setZ(i, -t * t * bend + Math.abs(x) * (twist || 0.25) * w); }
  geo.computeVertexNormals(); return geo;
}
function lumpGeo(r, det, rough, seed) {          // неровный камешек / кочка
  const geo = new THREE.IcosahedronGeometry(r, det), p = geo.attributes.position; let s = seed || 3;
  for (let i = 0; i < p.count; i++) { s = (s * 9301 + 49297) % 233280; const k = 1 + ((s / 233280) - 0.5) * rough; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  geo.computeVertexNormals(); return geo;
}
function nestItemMesh(id) {
  const it = CONFIG.nestItem(id), g = new THREE.Group(), col = it ? it.c : 0xffffff;
  const mat = (c, e, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, emissive: e || 0x000000 }, o || {}));
  const add = (geo, m, x, y, z, rx, ry, rz, sx, sy, sz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); if (sx) o.scale.set(sx, sy, sz); o.castShadow = true; g.add(o); return o; };
  const SG = (r, w, h) => new THREE.SphereGeometry(r, w || 12, h || 9), CG = (a, b, h, n) => new THREE.CylinderGeometry(a, b, h, n || 8), CO = (r, h, n) => new THREE.ConeGeometry(r, h, n || 8);
  const eggLathe = () => { const pts = []; for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI; pts.push(new THREE.Vector2(Math.max(0.0001, Math.sin(a) * (0.82 + 0.12 * Math.cos(a))), -Math.cos(a) * 1.18)); } return new THREE.LatheGeometry(pts, 28); };
  const eggMesh = (skin, hex, sh, k) => { const tex = new THREE.CanvasTexture(eggCanvas(skin, hex)); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; const e = new THREE.Mesh(eggLathe(), new THREE.MeshStandardMaterial({ map: tex, roughness: sh[0], metalness: sh[1] })); e.scale.setScalar(0.4 * (k || 1)); e.castShadow = true; return e; };
  const nestPad = (r) => add(CG(r, r * 1.15, 0.05, 14), mat(0x6e5a3a, 0, { roughness: 1 }), 0, 0.02, 0);
  if (it && it.eggskin) {            // яйцо со скином из магазина на соломенной подстилке
    const sk = it.eggskin.slice(2), sh = { gold: [0.3, 0.2], crystal: [0.22, 0], opal: [0.18, 0], lava: [0.85, 0], galaxy: [0.2, 0], candy: [0.45, 0], jungle: [0.8, 0] }[sk] || [0.5, 0];
    nestPad(0.34); for (let i = 0; i < 14; i++) { const a = i * 2.4; add(CG(0.008, 0.008, 0.34, 4), mat(0xb89a52, 0, { roughness: 1 }), Math.cos(a) * 0.28, 0.07, Math.sin(a) * 0.28, 1.2, -a, 0); }
    const e = eggMesh(sk, 0x6aa84f, sh); e.position.y = 0.47 + 0.04; g.add(e);
    if (sk === 'galaxy' || sk === 'lava' || sk === 'gold') { const gl = new THREE.Mesh(SG(0.62, 12, 10), new THREE.MeshBasicMaterial({ color: sk === 'lava' ? 0xff6a1a : sk === 'gold' ? 0xffd35a : 0x8a6aff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })); gl.position.y = 0.5; g.add(gl); }
  } else if (id.indexOf('egg_') === 0) {
    const sk = { egg_blue: ['candy', [0.45, 0]], egg_spot: ['speckle', [0.5, 0]], egg_gold: ['gold', [0.3, 0.2]] }[id] || ['', [0.5, 0]];
    nestPad(0.3); const e = eggMesh(sk[0], col, sk[1], 0.9); e.position.y = 0.46; g.add(e);
  } else if (id === 'bones') {       // бедренные кости и рёбра
    const bone = mat(col, 0, { roughness: 0.85 });
    [[0, 0, 0.3], [0.1, 1.1, 0.55], [-0.1, 2.2, 0.9]].forEach(([y0, ry, off], i) => { const b = new THREE.Group(); const sh = new THREE.Mesh(CG(0.045, 0.058, 0.85, 8), bone); sh.rotation.z = Math.PI / 2; b.add(sh); for (const sx of [-1, 1]) { for (const dz of [-0.045, 0.045]) { const kn = new THREE.Mesh(SG(0.075, 10, 8), bone); kn.position.set(sx * 0.44, 0, dz); b.add(kn); } } b.position.set(0, 0.07 + i * 0.09, off * 0.0); b.rotation.y = ry; b.position.x = (i - 1) * 0.02; b.traverse(o => o.castShadow = true); g.add(b); });
    for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.28 - i * 0.025, 0.018, 6, 14, Math.PI * 0.8), bone, 0.3 + i * 0.07, 0.04, -0.35, Math.PI / 2, 0, 0.6 + i * 0.25);
  } else if (id === 'hide') {        // шкура, растянутая на рамке
    const sh = new THREE.Shape(); sh.moveTo(0, 0.5); sh.bezierCurveTo(0.2, 0.52, 0.34, 0.6, 0.46, 0.5); sh.bezierCurveTo(0.58, 0.46, 0.62, 0.3, 0.52, 0.2); sh.bezierCurveTo(0.6, 0.08, 0.5, -0.06, 0.4, -0.04); sh.bezierCurveTo(0.3, -0.1, 0.22, -0.3, 0.1, -0.28); sh.bezierCurveTo(0.02, -0.3, -0.04, -0.12, -0.14, -0.04); sh.bezierCurveTo(-0.3, -0.06, -0.4, 0.1, -0.34, 0.22); sh.bezierCurveTo(-0.46, 0.34, -0.44, 0.5, -0.3, 0.5); sh.bezierCurveTo(-0.2, 0.6, -0.08, 0.5, 0, 0.5);
    const geo = new THREE.ShapeGeometry(sh, 10), pp = geo.attributes.position, cs = new Float32Array(pp.count * 3), c0 = new THREE.Color(col), c1 = new THREE.Color(0x3e2814);
    for (let i = 0; i < pp.count; i++) { const n = Math.sin(pp.getX(i) * 31) * Math.cos(pp.getY(i) * 27) * 0.5 + 0.5, k = 0.35 + 0.65 * n, c = c0.clone().lerp(c1, 1 - k); cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b; pp.setZ(i, Math.sin(pp.getX(i) * 9) * 0.015); }
    geo.setAttribute('color', new THREE.BufferAttribute(cs, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })); m.position.set(0, 0.62, 0.04); m.scale.setScalar(1.15); m.castShadow = true; g.add(m);
    const wood = mat(0x5a3a1c, 0, { roughness: 1 }); for (const sx of [-1, 1]) add(CG(0.025, 0.03, 1.4, 6), wood, sx * 0.5, 0.7, 0, 0, 0, sx * -0.08); add(CG(0.02, 0.02, 1.1, 6), wood, 0, 1.28, 0, 0, 0, Math.PI / 2); add(CG(0.02, 0.02, 1.0, 6), wood, 0, 0.05, 0, 0, 0, Math.PI / 2);
  } else if (id.indexOf('leaves_') === 0) {             // веер больших листьев с прожилками
    const pal = { leaves_green: [['#58b04a', '#2d7a30'], ['#6cc058', '#3a8a35']], leaves_red: [['#d9602a', '#8a2a14'], ['#c0401c', '#7a2210']], leaves_gold: [['#ffd24a', '#c88a10'], ['#f0b820', '#a87008']] }[id];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, pr = pal[i % 2], m = new THREE.MeshStandardMaterial({ map: leafTex(pr[0], pr[1]), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.65, emissive: id === 'leaves_gold' ? 0x3a2600 : 0 });
      const L = new THREE.Mesh(bentPlane(0.36, 0.62, 3, 6, 0.28, 0.2), m); L.rotation.set(-1.15 + (i % 3) * 0.28, a, (i % 2 ? 0.2 : -0.2)); L.position.set(Math.cos(a) * 0.05, 0.05 + (i % 3) * 0.04, Math.sin(a) * 0.05); L.castShadow = true; g.add(L); }
  } else if (id === 'fern') {        // кустик папоротника из дугой выгнутых вай
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.3, m = new THREE.MeshStandardMaterial({ map: frondTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 });
      const F = new THREE.Mesh(bentPlane(0.5, 1.0 - (i % 3) * 0.12, 2, 10, 0.55, 0), m); F.rotation.set(-0.55 - (i % 3) * 0.2, a, 0); F.position.set(0, 0.03, 0); F.castShadow = true; g.add(F); }
  } else if (id === 'flowers') {     // ромашки, космеи и колокольчики на стебельках с листочками
    const kinds = [{ pet: 0xffffff, mid: 0xf2c418, n: 12, len: 0.12, w: 0.035 }, { pet: 0xf06aa0, mid: 0xf2b418, n: 8, len: 0.13, w: 0.05 }, { pet: 0x8a6ae0, mid: 0xf8e060, n: 6, len: 0.11, w: 0.05 }];
    for (let i = 0; i < 7; i++) { const k = kinds[i % 3], a = i * 0.9, r = 0.1 + (i % 4) * 0.1, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.45 + (i % 3) * 0.14, lean = Math.cos(a * 2) * 0.1;
      const st = add(CG(0.01, 0.014, h, 5), mat(0x3a7a32), x + lean * h / 2, h / 2, z, 0, 0, -lean); const lf = new THREE.Mesh(bentPlane(0.08, 0.2, 1, 3, 0.05, 0), new THREE.MeshStandardMaterial({ map: leafTex('#4aa040', '#2a6a28'), alphaTest: 0.5, side: THREE.DoubleSide })); lf.position.set(x, h * 0.3, z); lf.rotation.set(-1.0, a + 1.5, 0); g.add(lf);
      const head = new THREE.Group(); head.position.set(x + lean * h, h, z); head.rotation.set(0.35, a, 0); g.add(head);
      for (let p = 0; p < k.n; p++) { const pa = p / k.n * Math.PI * 2, pt = new THREE.Mesh(SG(1, 6, 4), mat(k.pet, 0, { roughness: 0.5, side: THREE.DoubleSide })); pt.scale.set(k.w, 0.012, k.len); pt.position.set(Math.cos(pa) * k.len * 0.9, 0, Math.sin(pa) * k.len * 0.9); pt.rotation.y = -pa + Math.PI / 2; pt.rotation.z = 0.0; pt.castShadow = true; head.add(pt); }
      const mid = new THREE.Mesh(SG(0.045, 8, 6), mat(k.mid, 0.1, { roughness: 0.9 })); mid.scale.y = 0.6; mid.position.y = 0.012; head.add(mid); }
  } else if (id === 'mushrooms') {   // мухомор, лисичка и белый гриб с настоящей формой шляпки
    const species = [{ cap: 0xd2302a, stem: 0xf3ecd8, k: 1, spots: true, gills: 0xf0e0c0 }, { cap: 0xe0a02a, stem: 0xf0d890, k: 0.62, gills: 0xe8b860 }, { cap: 0x9a6a3e, stem: 0xe9dcc0, k: 0.8, gills: 0xefe2c4 }];
    [[0, 0, 0], [0.34, 0.1, 1], [-0.26, 0.22, 2], [0.12, -0.3, 1], [-0.12, -0.2, 0]].forEach(([x, z, si], i) => { const sp = species[si], k = sp.k * (i > 2 ? 0.55 : 1);
      const sp1 = []; for (let j = 0; j <= 8; j++) { const t = j / 8; sp1.push(new THREE.Vector2(0.05 + 0.03 * Math.pow(1 - t, 2) + 0.02 * Math.sin(t * 3), t * 0.4)); } const stem = new THREE.Mesh(new THREE.LatheGeometry(sp1, 12), mat(sp.stem, 0, { roughness: 0.85 })); stem.scale.setScalar(k); stem.position.set(x, 0, z); stem.castShadow = true; g.add(stem);
      const cp = []; for (let j = 0; j <= 10; j++) { const t = j / 10, a = t * Math.PI / 2; cp.push(new THREE.Vector2(Math.sin(a) * 0.27 * (si === 1 ? 1.15 : 1), Math.cos(a) * 0.17 * (si === 1 ? 0.8 : 1))); } cp.push(new THREE.Vector2(0.0001, 0));
      const cap = new THREE.Mesh(new THREE.LatheGeometry(cp, 16), mat(sp.cap, 0, { roughness: 0.55, side: THREE.DoubleSide })); cap.scale.setScalar(k); cap.position.set(x, 0.37 * k, z); cap.rotation.z = (i % 2 ? 0.06 : -0.05); cap.castShadow = true; g.add(cap);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(0.25 * k, 14), mat(sp.gills, 0, { side: THREE.DoubleSide })); gl.rotation.x = Math.PI / 2; gl.position.set(x, 0.372 * k, z); g.add(gl);
      if (sp.spots) for (let s = 0; s < 9; s++) { const sa = s * 2.4, sr = 0.05 + (s % 3) * 0.07, h = Math.cos(Math.asin(Math.min(0.95, sr / 0.27))) * 0.17; const d = new THREE.Mesh(SG(0.022 + (s % 2) * 0.012, 6, 5), mat(0xfaf5e6, 0, { roughness: 0.8 })); d.scale.y = 0.4; d.position.set(x + Math.cos(sa) * sr * k, 0.37 * k + h * k, z + Math.sin(sa) * sr * k); g.add(d); } });
  } else if (id === 'moss') {        // мягкие моховые подушки из множества бугорков
    const pal = [0x3f8a34, 0x5aa244, 0x6fb24e, 0x2f7230];
    [[0, 0, 0.5], [0.42, 0.12, 0.34], [-0.38, 0.2, 0.38], [0.1, -0.38, 0.3]].forEach(([x, z, r], i) => { for (let k = 0; k < 14; k++) { const a = k * 2.4 + i, d = Math.sqrt(k / 14) * r * 0.85, br = r * (0.28 + ((k * 7) % 5) * 0.045); add(lumpGeo(br, 1, 0.35, k + i * 9), mat(pal[(k + i) % 4], 0, { roughness: 1 }), x + Math.cos(a) * d, br * 0.35, z + Math.sin(a) * d, 0, 0, 0, 1, 0.62, 1); } });
    for (let i = 0; i < 6; i++) { const a = i * 1.1, s = add(lumpGeo(0.06, 1, 0.4, i + 40), mat(0x8a8a82, 0, { roughness: 1 }), Math.cos(a) * 0.55, 0.03, Math.sin(a) * 0.5, 0, 0, 0, 1, 0.6, 1); }
  } else if (id === 'shells') {      // гребешок с рёбрами и спиральная ракушка
    const sc = (x, z, r, rot, c1, c2) => { const geo = new THREE.CircleGeometry(r, 28, Math.PI * 0.12, Math.PI * 0.76), p = geo.attributes.position, cs = new Float32Array(p.count * 3), A = new THREE.Color(c1), B = new THREE.Color(c2);
      for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), rr = Math.hypot(px, py) / r, an = Math.atan2(py, px), rib = 0.5 + 0.5 * Math.cos(an * 16), c = A.clone().lerp(B, rr * 0.7 + rib * 0.3); cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b; p.setZ(i, rr * rr * 0.12 * r / 0.2 + rib * 0.012); }
      geo.setAttribute('color', new THREE.BufferAttribute(cs, 3)); geo.computeVertexNormals(); const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, side: THREE.DoubleSide })); m.rotation.set(-Math.PI / 2 + 0.35, 0, rot); m.position.set(x, 0.05, z); m.castShadow = true; g.add(m); const ear = add(CG(r * 0.3, r * 0.3, 0.02, 3), mat(c2, 0, { roughness: 0.3 }), x, 0.045, z); };
    sc(0, 0, 0.3, 0.3, 0xfff0e0, 0xe8a890); sc(0.4, 0.2, 0.22, 2.2, 0xffe0d0, 0xd88a78); sc(-0.36, 0.26, 0.2, 4.2, 0xf6e8d8, 0xc89a78);
    for (let i = 0; i < 9; i++) { const t = i / 8, r = 0.1 * (1 - t * 0.85); add(SG(r, 10, 8), mat(i % 2 ? 0xf0d0b8 : 0xe4b898, 0, { roughness: 0.3 }), -0.15 + t * 0.12, 0.08 + r * 0.6 + t * 0.12, -0.34 + Math.cos(t * 7) * 0.05, 0, 0, 0, 1, 1, 1); }
    add(CG(0.0, 0.07, 0.2, 10), mat(0xe8c8a8, 0, { roughness: 0.3 }), 0.1, 0.1, -0.38, 0, 0, Math.PI / 2 - 0.25);
  } else if (id === 'feathers') {    // веер длинных перьев с бородками, воткнутых в песок
    const cs = [['#1aa0e8', '#0a4a8a'], ['#ff5a7a', '#a01a44'], ['#ffd23a', '#c8780a'], ['#4ad88a', '#0a7a4a'], ['#a06aff', '#4a1a9a'], ['#ff9a3a', '#a0420a'], ['#3ae8e8', '#0a6a7a']];
    nestPad(0.22); for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.26, m = new THREE.MeshStandardMaterial({ map: featherTex(cs[i][0], cs[i][1]), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5 });
      const F = new THREE.Mesh(bentPlane(0.2, 0.95 - Math.abs(i - 3) * 0.05, 2, 8, 0.2, 0.1), m); F.position.set(a * 0.15, 0.03, 0); F.rotation.set(-0.1, 0, -a * 0.9); F.castShadow = true; g.add(F); }
  } else if (id === 'crystals') {    // шестигранные кристаллы-друзы на породе
    const rock = add(lumpGeo(0.4, 1, 0.5, 11), mat(0x4a4a56, 0, { roughness: 0.95 }), 0, 0.06, 0, 0, 0, 0, 1, 0.45, 1);
    const cp = (h, w) => { const p = [new THREE.Vector2(0.0001, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, h * 0.72), new THREE.Vector2(0.0001, h)]; return new THREE.LatheGeometry(p, 6); };
    const cols = [[0x9a6aff, 0x4a2a99], [0x6ad8ff, 0x2a7a99], [0xff6ad0, 0x992a80]];
    [[0, 0, 1, 0, 0], [0.22, 0.08, 0.7, 0.35, 0.5], [-0.2, 0.1, 0.8, -0.4, 1.2], [0.08, -0.2, 0.55, 0.15, -0.6], [-0.05, 0.22, 0.45, -0.2, 2.1], [0.28, -0.12, 0.4, 0.5, 1.6]].forEach(([x, z, k, rz, ry], i) => { const c = cols[i % 3]; const m = new THREE.MeshStandardMaterial({ color: c[0], emissive: c[1], emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.9, flatShading: true }); add(cp(0.9 * k, 0.1 * k + 0.02), m, x, 0.1, z, 0.1, ry, rz); });
    add(SG(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9a7aff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.4, 0);
  } else if (id === 'lantern') {     // кованый фонарь на столбике
    const iron = mat(0x2e2a28, 0, { roughness: 0.55, metalness: 0.6 }), wood = mat(0x5a3e24, 0, { roughness: 0.95 });
    add(CG(0.05, 0.07, 1.15, 8), wood, 0, 0.58, 0); add(CG(0.16, 0.2, 0.06, 10), wood, 0, 0.03, 0); add(CG(0.025, 0.025, 0.34, 6), iron, 0.15, 1.12, 0, 0, 0, Math.PI / 2); add(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), iron, 0.3, 1.1, 0, 0, 0, 0);
    const lx = 0.3, ly = 0.9; add(CG(0.12, 0.1, 0.05, 4), iron, lx, ly - 0.14, 0, 0, Math.PI / 4, 0);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) add(CG(0.008, 0.008, 0.28, 4), iron, lx + dx * 0.075, ly, dz * 0.075);
    add(new THREE.BoxGeometry(0.15, 0.24, 0.15), mat(0xffd98a, 0xffa828, { emissiveIntensity: 1.35, transparent: true, opacity: 0.85, roughness: 0.15 }), lx, ly, 0);
    add(SG(0.04, 8, 6), mat(0xfff2b0, 0xffe080, { emissiveIntensity: 2 }), lx, ly - 0.04, 0);
    add(CO(0.13, 0.12, 4), iron, lx, ly + 0.18, 0, 0, Math.PI / 4, 0); add(new THREE.TorusGeometry(0.03, 0.008, 6, 10), iron, lx, ly + 0.27, 0, Math.PI / 2, 0, 0);
    add(SG(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }), lx, ly, 0);
  } else {       // трофей босса: череп хищника на деревянной подставке
    const bone = mat(0xe8e0c8, 0, { roughness: 0.8 }), dark = mat(0x151210, 0, { roughness: 1 }), wood = mat(0x5a3e24, 0, { roughness: 1 });
    add(CG(0.38, 0.44, 0.2, 12), wood, 0, 0.1, 0); add(new THREE.TorusGeometry(0.4, 0.035, 6, 20), mat(col, 0x222200, { roughness: 0.4, metalness: 0.3 }), 0, 0.21, 0, Math.PI / 2, 0, 0);
    const sk = new THREE.Group(); sk.position.set(0, 0.55, -0.05); sk.rotation.x = -0.12; g.add(sk);
    const cr = new THREE.Mesh(SG(0.26, 14, 10), bone); cr.scale.set(0.9, 0.85, 1.1); cr.position.set(0, 0.1, -0.05); sk.add(cr);
    const sn = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.5), bone); sn.position.set(0, 0.03, 0.32); sk.add(sn);
    const snT = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.18), bone); snT.position.set(0, 0.05, 0.58); sk.add(snT);
    const jw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.5), bone); jw.position.set(0, -0.12, 0.28); jw.rotation.x = 0.1; sk.add(jw);
    for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) { const th = new THREE.Mesh(CO(0.022, 0.07, 5), mat(0xf6f0dc)); th.position.set(sx * 0.1, -0.05 - (i % 2) * 0.005, 0.14 + i * 0.07); th.rotation.x = Math.PI; sk.add(th); const tb = new THREE.Mesh(CO(0.02, 0.06, 5), mat(0xf6f0dc)); tb.position.set(sx * 0.085, -0.06, 0.12 + i * 0.07); tb.scale.y = 0.8; sk.add(tb); }
    for (const sx of [-1, 1]) { const eye = new THREE.Mesh(SG(0.075, 10, 8), dark); eye.scale.set(1, 1.1, 0.7); eye.position.set(sx * 0.17, 0.12, 0.14); sk.add(eye); const nos = new THREE.Mesh(SG(0.03, 6, 5), dark); nos.position.set(sx * 0.06, 0.1, 0.6); sk.add(nos); const hn = new THREE.Mesh(CO(0.05, 0.3, 7), bone); hn.position.set(sx * 0.2, 0.3, -0.05); hn.rotation.z = -sx * 0.45; sk.add(hn); }
    sk.traverse(o => o.castShadow = true);
  }
  return g;
}
function updateNestDeco() {
  if (!S || !S.world || !S.W) return;
  const list = nestOwnerList(), key = S.biome + '|' + list.join(',');
  if (S.nestKey === key) return; S.nestKey = key;
  if (S.nestGrp) { scene.remove(S.nestGrp); S.nestGrp.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); S.nestGrp = null; }
  if (!list.length) return;
  const g = new THREE.Group(), n = S.W.nest, R = 4.4;
  list.forEach((id, i) => {
    if (!CONFIG.nestItem(id)) return; const m = nestItemMesh(id), a = 0.5 + i / list.length * Math.PI * 2, x = n.x + Math.cos(a) * R, z = n.z + Math.sin(a) * R;
    const gh = S.world && S.world.meshH ? S.world.meshH : S.W.heightAt; let gy = gh(x, z);
    for (let q = 0; q < 8; q++) { const qa = q * 0.7854; gy = Math.min(gy, gh(x + Math.cos(qa) * 0.9, z + Math.sin(qa) * 0.9)); }
    m.position.set(x, gy - 0.03, z); m.rotation.y = -a + Math.PI / 2; m.scale.setScalar(2.0); g.add(m);
  });
  scene.add(g); S.nestGrp = g;
}

let prevNight = null, prevStorm = null;
function weatherBanners() {
  const night = S.tod < 0.22 || S.tod > 0.78, storm = S.wx > 0.6;
  if (prevNight !== null) { if (night && !prevNight) UI.banner('🌙 ' + T('night_on'), 3600); if (storm && !prevStorm) UI.banner('⛈ ' + T('storm_on'), 3600); }
  prevNight = night; prevStorm = storm;
}

// ---------------------------------------------------------------- спасение друзей и наблюдение
let revHold = 0, revTarget = null;
function nearestFallen() {
  let best = null, bd = 8;
  for (const [id, p] of S.players) { if (!(p.flags & F.DEAD) || (p.info && p.info.bot) || !p.actor) continue; const q = p.actor.group.position, d = Math.hypot(q.x - S.px, q.z - S.pz); if (d < bd) { bd = d; best = { id, p, d }; } }
  return best;
}
function spectateTarget() {
  let best = null, bd = 1e9;
  for (const [id, p] of S.players) { if ((p.flags & F.DEAD) || (p.info && p.info.bot) || !p.actor) continue; const q = p.actor.group.position, d = Math.hypot(q.x - S.px, q.z - S.pz); if (d < bd) { bd = d; best = q; } }
  return best;
}
function updateRevive(dt) {
  const b = $('revbtn'); if (!S.alive || S.coro) { b.classList.remove('on'); revHold = 0; return; }
  const f = nearestFallen(); revTarget = f ? f.id : null;
  if (!f) { b.classList.remove('on'); revHold = 0; return; }
  b.classList.add('on'); $('revbtn-t').textContent = T('rev_btn', { n: (f.p.info && f.p.info.nick) || '?' });
  if (revHold > 0) { revHold += dt; $('revbtn-f').style.width = Math.min(100, revHold / 2 * 100) + '%'; if (revHold >= 2) { revHold = 0; S.conn && S.conn.send({ t: 'revive', id: revTarget }); $('revbtn-f').style.width = '0%'; } } else $('revbtn-f').style.width = '0%';
}
{
  const b = $('revbtn'), on = e => { e.preventDefault(); e.stopPropagation(); if (revTarget) revHold = 0.001; }, off = () => { revHold = 0; };
  b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off); b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
  window.addEventListener('keydown', e => { if (e.code === 'KeyR' && revTarget && !e.repeat && S && S.alive) revHold = 0.001; }); window.addEventListener('keyup', e => { if (e.code === 'KeyR') revHold = 0; });
}

// ---------------------------------------------------------------- короткое обучение для новичка (шаги отмечаются сами)
const TUT_STEPS = [
  { k: 'move', t: 'tut_move', ok: () => Math.hypot(S.px - S.tut.x0, S.pz - S.tut.z0) > 12 },
  { k: 'look', t: 'tut_look', ok: () => Math.abs(input.yaw - S.tut.yaw0) > 1.0 },
  { k: 'sprint', t: 'tut_sprint', ok: () => !!input.sprint },
  { k: 'atk', t: 'tut_atk', ok: () => !!input.atk },
  { k: 'eat', t: 'tut_eat', ok: () => (S.profile.stats.eaten | 0) > S.tut.eat0 },
  { k: 'kill', t: 'tut_kill', ok: () => (S.profile.stats.kills | 0) > S.tut.kill0 }
];
function tutStart() {
  const pr = S.profile; if (pr.tut || !pr.hatched || (pr.stats.kills | 0) > 3 || pr.level > 3) { S.tut = null; $('tut').classList.remove('on'); return; }
  try { if (localStorage.getItem('dino_tut_' + pr.name) === '1') { S.tut = null; return; } } catch (e) { /* ignore */ }
  S.tut = { i: 0, x0: S.px, z0: S.pz, yaw0: input.yaw, eat0: pr.stats.eaten | 0, kill0: pr.stats.kills | 0, t0: clock };
  $('tut').classList.add('on'); tutShow();
}
function tutShow() { const t = S.tut; if (!t) return; $('tut-t').textContent = T(TUT_STEPS[t.i].t); $('tut-n').textContent = (t.i + 1) + '/' + TUT_STEPS.length; }
function tutDone(skip) {
  const t = S.tut; if (!t) return; S.tut = null; $('tut').classList.remove('on');
  try { localStorage.setItem('dino_tut_' + S.profile.name, '1'); } catch (e) { /* ignore */ }
  if (!skip) { S.conn && S.conn.send({ t: 'tut' }); UI.banner('🎓 ' + T('tut_done'), 3800); Audio.sfx('win'); }
}
function tutUpdate() {
  const t = S.tut; if (!t || S.coro || S.hatch) return;
  if (clock - t.t0 < 3) return;
  if (TUT_STEPS[t.i].ok()) { t.i++; Audio.sfx('coin'); if (t.i >= TUT_STEPS.length) { tutDone(false); return; } tutShow(); }
}
$('tut-x').addEventListener('click', () => tutDone(true));

// ---------------------------------------------------------------- коронация после победы над боссом (ролик ~8 с)
const CORO_LAND = 3.4, CORO_DUR = 8.2;
function startCoro(o) {
  if (!S || !S.actor || S.coro || S.hatch) return;
  if (S.bc) endBcine();
  const c = S.coro = { t0: clock, lord: !!o.lord, biome: o.biome, xp: o.xp | 0, coins: o.coins | 0, landed: false, end: false, blend: 0, lastT: 0, sparkT: 0, freezeT: null, grp: new THREE.Group(), pose: null };
  // колонна света: мягкие края (ярче в центре) и растворяется кверху
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uOp: { value: 0 }, uCol: { value: new THREE.Color(0xffc44a) } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; varying float vH; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vP = mv.xyz; vH = uv.y; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uOp; uniform vec3 uCol; varying vec3 vN; varying vec3 vP; varying float vH; void main(){ float d = abs(dot(normalize(vN), normalize(-vP))); float a = pow(d, 1.8) * (1.0 - smoothstep(0.35, 1.0, vH)) * uOp; gl_FragColor = vec4(uCol * (0.7 + 0.6 * d), a); }' });
  c.pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.1, 70, 32, 1, true), mat); c.pillar.position.y = 34; c.grp.add(c.pillar);
  c.crown = buildCrownMesh(c.lord ? 2 : 1); c.glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  c.crown.add(c.glow); c.crown.visible = false; c.grp.add(c.crown);
  scene.add(c.grp);
  document.body.classList.add('cine'); const el = $('coro'); el.classList.add('on'); el.classList.remove('landed', 'sub');
  $('coro-t1').textContent = c.lord ? T('coro_lord') : T('coro_king', { b: TN(CONFIG.BIOME[o.biome].n).toUpperCase() });
  $('coro-t2').textContent = T('coro_sub'); $('coro-t3').textContent = '+' + c.xp + ' XP · +' + c.coins + ' 🪙';
  Audio.sfx('boss');
  c.skipOk = clock + 1.4;
}
function endCoro(now) {
  const c = S && S.coro; if (!c) return;
  c.grp.parent && c.grp.parent.remove(c.grp); c.grp.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
  document.body.classList.remove('cine'); $('coro').classList.remove('on', 'landed', 'sub');
  const P = S.actor && S.actor.dino && S.actor.dino.userData.parts; if (P && P.crown) P.crown.visible = true;
  S.coroBlend = now ? null : { t: 0, pos: c.pose ? c.pose.pos : null, q: c.pose ? c.pose.q : null };
  S.coro = null;
}
const _ccv = new THREE.Vector3();
function updateCoro(dt) {
  const c = S.coro; if (!c) return false;
  const t = c.freezeT != null ? c.freezeT : clock - c.t0, a = S.actor, sc = Sim.scaleOf(S.profile.level), gp = a.group.position, u = Math.min(1, t / CORO_DUR);
  const P = a.dino.userData.parts, head = (P && P.anch && P.anch.head) ? P.anch.head.getWorldPosition(_ccv).clone() : new THREE.Vector3(gp.x, gp.y + 1.8 * sc, gp.z);
  head.y += 0.22 * sc;
  if (t >= CORO_DUR || c.end) { c.endT = c.endT || clock; }
  // колонна света, корона и эффекты
  c.grp.position.set(gp.x, gp.y, gp.z);
  const pf = Math.min(1, Math.max(0, (t - 0.2) / 0.9)) * (1 - Math.min(1, Math.max(0, (t - 5.6) / 1.2)));
  c.pillar.material.uniforms.uOp.value = 0.5 * pf;
  const kS = Math.max(1, sc * 1.6);
  if (t >= 1.0 && t < CORO_LAND) {
    const k = (t - 1.0) / (CORO_LAND - 1.0), e = k * k * (3 - 2 * k), y0 = head.y - gp.y + 8 + sc * 2;
    c.crown.visible = true; c.crown.scale.setScalar(kS * (4.2 - 3.2 * e)); c.crown.position.set(head.x - gp.x, y0 + (head.y - gp.y - y0) * e, head.z - gp.z); c.crown.rotation.y = t * 7 * (1 - 0.8 * e); c.glow.scale.setScalar(1.5 + 0.4 * Math.sin(t * 9));
  } else if (t < 1.0) c.crown.visible = false;
  if (t >= CORO_LAND && !c.landed) {
    c.landed = true; c.crown.visible = false;
    burst(head.x, head.y, head.z, 0xffd35a, 90, 9, 4); burst(head.x, head.y, head.z, 0xffffff, 40, 6, 3); ring(gp.x, gp.y, gp.z, 0xffd35a, 9 * sc, 1.2); ring(gp.x, gp.y, gp.z, 0xffffff, 5 * sc, 0.8);
    S.camShake = 0.5; Audio.sfx('boom'); setTimeout(() => Audio.sfx('king'), 120);
    const f = $('coro-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); $('coro').classList.add('landed'); setTimeout(() => { if (S && S.coro === c) $('coro').classList.add('sub'); }, 900);
  }
  if (t < CORO_LAND || t > 0) { if (t >= CORO_LAND && P && P.crown) P.crown.visible = true; else if (P && P.crown) P.crown.visible = false; }
  if (t > 0.8 && t < 6.2 && clock - c.sparkT > 0.07 && c.freezeT == null) { c.sparkT = clock; const r = (0.5 + Math.random()) * sc * 1.6, an = Math.random() * 6.283; burst(gp.x + Math.cos(an) * r, gp.y + 0.2, gp.z + Math.sin(an) * r, 0xffd35a, 3, 1.5, 4); }
  // камера: облёт от низкого ракурса спереди вокруг динозавра
  const ang = input.yaw + Math.PI * (0.9 + 1.15 * u * u * (3 - 2 * u)), R0 = (3.4 + sc * 2.4) * (0.85 + 0.3 * u), cy = gp.y + (0.5 + 0.9 * u) * sc + 0.4;
  let R = R0;   // если на пути дерево или камень — подъезжаем ближе к динозавру
  for (let k = 0; k < 8; k++) {
    const cx = gp.x + Math.sin(ang) * R, cz = gp.z + Math.cos(ang) * R; let blocked = false;
    const near = Sim.obstaclesNear(S.W, cx, cz, 6); for (let i = 0; i < near.length; i++) { const o = near[i]; if ((o.kind === 'tree' || o.kind === 'rock' || o.kind === 'stone') && Math.hypot(o.x - cx, o.z - cz) < o.r + (o.kind === 'tree' ? 3.2 : 1.2)) { blocked = true; break; } }
    if (!blocked) break; R *= 0.82;
  }
  _tmpCam.position.set(gp.x + Math.sin(ang) * R, cy, gp.z + Math.cos(ang) * R);
  const gy = S.W.heightAt(_tmpCam.position.x, _tmpCam.position.z) + 0.6; if (_tmpCam.position.y < gy) _tmpCam.position.y = gy;
  const sm2 = (a0, a1, x) => { const q = Math.min(1, Math.max(0, (x - a0) / (a1 - a0))); return q * q * (3 - 2 * q); };
  const lookY = gp.y + (1.3 + 0.3 * u) * sc + 0.2, bump = sm2(1.0, 2.3, t) * (1 - sm2(3.6, 4.8, t));   // пока падает корона — смотрим выше, на неё и голову
  _tmpCam.lookAt(gp.x, lookY + (head.y + 1.3 - lookY) * 0.55 * bump - 0.9 * sc * sm2(3.6, 5, t), gp.z);
  camera.position.copy(_tmpCam.position); camera.quaternion.copy(_tmpCam.quaternion); camera.fov = 56 - 8 * u; camera.updateProjectionMatrix();
  c.pose = { pos: _tmpCam.position.clone(), q: _tmpCam.quaternion.clone() };
  if (c.freezeT == null && (t >= CORO_DUR || c.end)) endCoro(false);
  return true;
}
function skipCoro() { const c = S && S.coro; if (c && clock >= c.skipOk) c.end = true; }
window.addEventListener('pointerdown', skipCoro); window.addEventListener('keydown', e => { if (S && S.coro && (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter')) skipCoro(); });


// ---------------------------------------------------------------- 3D-ролики: встреча с боссом и «всасывание в портал»
let flashEl = null;
function warpFlash(on, ms) {
  if (!flashEl) { flashEl = document.createElement('div'); flashEl.style.cssText = 'position:fixed;inset:0;z-index:250;background:#fff;opacity:0;pointer-events:none;transition:opacity .5s'; document.body.appendChild(flashEl); }
  flashEl.style.transition = 'opacity ' + (ms || 500) + 'ms'; flashEl.style.opacity = on ? '1' : '0';
}
const _bcv = new THREE.Vector3();
function startBcine(be) {
  if (!S || S.coro || S.hatch || S.bc || S.warp || !be || !be.group) return;
  S.bc = { t0: clock, dur: 6.2, e: be, roared: false, pose: null };
  document.body.classList.add('cine');
}
function endBcine() {
  const c = S && S.bc; if (!c) return;
  document.body.classList.remove('cine');
  S.coroBlend = c.pose ? { t: 0, pos: c.pose.pos, q: c.pose.q } : null; S.bc = null;
}
function updateBcine(dt) {
  const c = S.bc; if (!c) return false;
  const t = clock - c.t0, e = c.e, bp = e.group.position, def = CONFIG.BOSSES[e.bossId] || { size: 3 }, sz = def.size, me = S.actor.group.position;
  const sm = (a0, a1, x) => { const q = Math.min(1, Math.max(0, (x - a0) / (a1 - a0))); return q * q * (3 - 2 * q); };
  const fa = Math.atan2(me.x - bp.x, me.z - bp.z);          // направление от босса к игроку
  let ang, R, h, ly;
  if (t < 2.3) { const k = sm(0, 2.3, t); ang = fa + 0.9 - 0.5 * k; R = sz * (7.5 - 3.2 * k); h = bp.y + sz * (0.35 + 0.5 * k); ly = bp.y + sz * (1.15 + 0.3 * k); }
  else if (t < 4.4) { const k = sm(2.3, 4.4, t); ang = fa + 0.4 - 1.5 * k; R = sz * (4.3 + 0.8 * k); h = bp.y + sz * (0.85 + 0.25 * k); ly = bp.y + sz * 1.55; }
  else { const k = sm(4.4, 6.2, t); ang = fa - 1.1 + 1.1 * k; R = sz * (5.1 + 1.6 * k); h = bp.y + sz * (1.1 - 0.35 * k); ly = bp.y + sz * (1.55 - 0.45 * k); }
  if (t > 2.3 && !c.roared) { c.roared = true; S.camShake = 0.7; Audio.sfx('roar', { kind: 'big', size: 1.6, boss: e.bossId }); const bx = bp.x, bz = bp.z; ring(bx, bp.y + 0.2, bz, 0xffffff, sz * 3, 0.9); }
  _tmpCam.position.set(bp.x + Math.sin(ang) * R, h, bp.z + Math.cos(ang) * R);
  const gy = S.W.heightAt(_tmpCam.position.x, _tmpCam.position.z) + 0.8; if (_tmpCam.position.y < gy) _tmpCam.position.y = gy;
  _tmpCam.lookAt(bp.x, ly, bp.z);
  if (S.camShake > 0.01) { const s = S.camShake; _tmpCam.position.x += (Math.random() - 0.5) * s; _tmpCam.position.y += (Math.random() - 0.5) * s; S.camShake *= Math.pow(0.05, dt); }
  camera.position.copy(_tmpCam.position); camera.quaternion.copy(_tmpCam.quaternion); camera.fov = 52 - 8 * sm(0, 4, t); camera.updateProjectionMatrix();
  c.pose = { pos: _tmpCam.position.clone(), q: _tmpCam.quaternion.clone() };
  if (t >= c.dur || c.end) endBcine();
  return true;
}
// всасывание в портал следующей локации (после коронации)
function startWarp() {
  return new Promise(res => {
    if (!S || !S.welcomed || S.coro || S.hatch || S.bc || S.warp || !S.W.portalNext) { res(); return; }
    const wl = CONFIG.worldList(CONFIG.worldOf(S.biome)); if (wl.indexOf(S.biome) >= wl.length - 1 || S.profile.kings.indexOf(S.biome) < 0) { res(); return; }
    const gp = S.actor.group.position, P = S.W.portalNext;
    S.warp = { t0: clock, dur: 7, start: gp.clone(), s0: S.actor.group.scale.x, sent: false, spT: 0, done: res, pose: null };
    if (S.world.setPortalNext) S.world.setPortalNext(true);
    document.body.classList.add('cine'); Audio.sfx('portal'); ring(P.x, P.y + 1.5, P.z, 0x9be37a, 8, 1.4);
  });
}
function endWarp() {
  const w = S && S.warp; if (!w) return; S.warp = null;
  try { S.actor.group.scale.setScalar(w.s0); S.actor.group.visible = true; S.actor.group.rotation.set(0, 0, 0); } catch (e) { /* ignore */ }
  document.body.classList.remove('cine'); warpFlash(false, 900); w.done && w.done();
}
function updateWarp(dt) {
  const w = S.warp; if (!w) return false;
  const t = clock - w.t0, a = S.actor, P = S.W.portalNext, sc = Sim.scaleOf(S.profile.level);
  const sm = (a0, a1, x) => { const q = Math.min(1, Math.max(0, (x - a0) / (a1 - a0))); return q * q * (3 - 2 * q); };
  const px = P.x, py = P.y + 1.8, pz = P.z;
  const k = sm(1.4, 5.4, t), kk = Math.pow(k, 2.2), sp = (1 - kk) * 2.8 * sc, an = kk * 20;      // сначала «упирается», потом тянет всё быстрее
  const dx = px - w.start.x, dz = pz - w.start.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
  const x = w.start.x + dx * kk + (nx * Math.cos(an) * sp), z = w.start.z + dz * kk + (nz * Math.cos(an) * sp);
  const y = w.start.y + (py - w.start.y) * kk + Math.sin(an) * sp * 0.8 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 1.2 * sc;
  a.group.position.set(x, y, z);
  // притяжение воронки: тело вытягивается вдоль направления к порталу, сжимается поперёк, кувыркается и уменьшается
  const yaw = Math.atan2(dx, dz), str = 1 + 2.6 * k * k, sq = Math.max(0.3, 1 - 0.68 * Math.pow(k, 1.4)), shr = Math.max(0.03, 1 - 0.97 * Math.pow(k, 1.25));
  const struggle = (1 - k) * Math.min(1, t / 0.6) * (t < 1.6 ? 1 : 0.35);
  a.group.rotation.set(Math.sin(t * 7) * 0.12 * struggle - 0.35 * k, yaw, an * 0.8 + Math.sin(t * 5) * 0.1 * struggle);
  a.group.scale.set(w.s0 * shr * sq, w.s0 * shr * sq, w.s0 * shr * str);
  if (t > 0.3 && t < 5.6 && clock - w.spT > 0.04) {
    w.spT = clock;
    if (t < 3.2) burst(w.start.x, w.start.y + 0.25, w.start.z, 0xcbb98a, 3, 2.2);                                   // пыль и листья срываются с земли
    burst(x, y, z, 0x9be37a, 3, 2.5);
    for (let j = 0; j < 3; j++) { const ang = an * 0.5 + j * 2.094 + t * 6, r = (1.2 + 6.5 * (1 - k)) * sc; burst(px + nx * Math.cos(ang) * r, py + Math.sin(ang) * r * 0.85, pz + nz * Math.cos(ang) * r, j % 2 ? 0xbff7ff : 0x9be37a, 2, 1.8); }   // спираль воронки
    if (t > 1.4) burst(px, py, pz, 0xffffff, 2, 6);
  }
  if (t > 0.4 && !w.r1) { w.r1 = true; ring(px, py - 0.6, pz, 0x9be37a, 5, 1.0); }
  if (t > 2.4 && !w.r2) { w.r2 = true; ring(px, py - 0.6, pz, 0xbff7ff, 8, 1.1); }
  if (t > 0.4 && t < 5.6) S.camShake = Math.max(S.camShake || 0, 0.03 + 0.28 * k * k);
  // камера: сбоку, затем следует за динозавром к порталу
  const cax = (w.start.x + px) / 2, caz = (w.start.z + pz) / 2, base = Math.atan2(dx, dz) + Math.PI / 2;
  const camT = new THREE.Vector3(cax + Math.sin(base) * (10 + sc * 4) * (1 - 0.5 * k), Math.max(w.start.y, py) + 2.4 + sc, caz + Math.cos(base) * (10 + sc * 4) * (1 - 0.5 * k));
  const gy = S.W.heightAt(camT.x, camT.z) + 1; if (camT.y < gy) camT.y = gy;
  _tmpCam.position.copy(camT);
  const look = _bcv.set(x * (0.55 + 0.35 * k) + cax * (0.45 - 0.35 * k), (y + py) / 2, z * (0.55 + 0.35 * k) + caz * (0.45 - 0.35 * k)); _tmpCam.lookAt(look); _tmpCam.rotateZ(0.32 * k * Math.sin(an * 0.25 + 0.6));      // камера слегка кренится вместе с воронкой
  if (S.camShake > 0.01) { const s = S.camShake; _tmpCam.position.x += (Math.random() - 0.5) * s; _tmpCam.position.y += (Math.random() - 0.5) * s; S.camShake *= Math.pow(0.1, dt); }
  camera.position.copy(_tmpCam.position); camera.quaternion.copy(_tmpCam.quaternion); camera.fov = 50 + 30 * sm(3.2, 5.6, t); camera.updateProjectionMatrix();
  w.pose = { pos: _tmpCam.position.clone(), q: _tmpCam.quaternion.clone() };
  if (t > 5.0 && !w.flash) { w.flash = true; warpFlash(true, 700); Audio.sfx('boom'); }
  if (t > 5.8 && !w.sent) { w.sent = true; a.group.visible = false; if (S.conn) S.conn.send({ t: 'story', k: 'cine' }); S.conn && S.conn.send({ t: 'warp' }); }
  if (t >= w.dur || w.end) endWarp();
  return true;
}
function skipCine() { if (S && S.bc && clock - S.bc.t0 > 1.2) S.bc.end = true; if (S && S.warp && clock - S.warp.t0 > 1.0 && clock - S.warp.t0 < 5.8) S.warp.t0 = clock - 5.7; }
window.addEventListener('pointerdown', skipCine); window.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') skipCine(); });

// ---------------------------------------------------------------- камера
let camDist = 8, camShakeT = 0;
let guardEl = null;
function guardHint(on) {
  if (!guardEl) { guardEl = document.createElement('div'); guardEl.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);padding:8px 18px;border-radius:14px;background:rgba(20,60,110,.78);border:2px solid #6ad0ff;color:#e8f6ff;font:600 17px system-ui,sans-serif;z-index:30;pointer-events:none;box-shadow:0 0 18px rgba(106,208,255,.55);display:none;text-align:center'; document.body.appendChild(guardEl); }
  if (on) guardEl.textContent = T('guard_on');
  guardEl.style.display = on ? 'block' : 'none';
}
function placeCamera(dt, px, py, pz, now) {
  const sc = Sim.scaleOf(S.profile.level), me = S.me;
  let dist = (4.2 + sc * 3.4) * input.zoom * (me.fly ? 1.25 : me.clm ? 1.35 : 1) * (S.bs && S.bs.st === 'fight' ? 1.4 : 1);
  const tx = px, ty = py + (me.clm ? 2.2 : 1.3) * sc, tz = pz, cp = Math.cos(input.pitch), dx = Math.sin(input.yaw) * cp, dy = Math.sin(input.pitch), dz = Math.cos(input.yaw) * cp;
  let d = dist;
  for (let k = 1; k <= 10; k++) {
    const t = k / 10 * dist, x = tx + dx * t, y = ty + dy * t, z = tz + dz * t;
    let hit = S.W.heightAt(x, z) + 0.45 > y;
    if (!hit) { const near = Sim.obstaclesNear(S.W, x, z, 2.5); for (let i = 0; i < near.length; i++) { const o = near[i]; if ((o.kind !== 'tree' || me.clm) && o.kind !== 'rock' && o.kind !== 'stone') continue; if (Math.hypot(o.x - x, o.z - z) < o.r + 0.25 && y < o.y + (o.h || 3)) { hit = true; break; } } }
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
  const du = S.du, frozen = (du && du.st !== 'fight') || (S.hatch && !S.hatch.done) || !!S.coro || !!S.bc || !!S.warp;
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
  const W = S.W, wv = S.world.waveAt(x, z), off = aq ? 1.15 * sc - 0.15 : 0.12 + 0.08 * sc, k = clamp(1 - (W.waterY - y - off) / 1.6, 0, 1);   // у поверхности — качается на волнах, глубже — волны затухают
  return Math.min(y + wv * k, W.waterY + wv - off);
}
function updateActors(dt, t, now) {
  const me = S.me, W = S.W, a = S.actor;
  // свой динозавр: интерполяция между шагами предсказания + сглаживание коррекций
  const k = clamp(S.acc / DT, 0, 1), pv = S.prev || me;
  S.off.x *= Math.pow(0.0001, dt); S.off.y *= Math.pow(0.0001, dt); S.off.z *= Math.pow(0.0001, dt);
  const x = pv.x + (me.x - pv.x) * k + S.off.x, y = pv.y + (me.y - pv.y) * k + S.off.y, z = pv.z + (me.z - pv.z) * k + S.off.z;
  if (S.lastPos) { const v = Math.hypot(x - S.lastPos.x, z - S.lastPos.z) / Math.max(dt, 1e-3); { const tv = clamp(v / 6, 0, 1.6); S.speed += (tv - S.speed) * Math.min(1, dt * (tv < S.speed ? 30 : 12)); if (tv < 0.01 && S.speed < 0.03) S.speed = 0; } }
  S.lastPos = { x, z };
  const water = W.isWater(me.x, me.z) && me.y < W.waterY + 0.35 && !me.fly && !me.clm;
  if (!S.warp) a.group.rotation.set(0, 0, 0);      // после портала не оставаться под наклоном
  a.update(x, waveY(x, y, z, water, Sim.scaleOf(S.profile.level), CONFIG.isAqua(S.profile.cls)), z, me.face, S.speed, t, dt, { fly: !!me.fly, swim: water, climb: !!me.clm, guard: !!me.grd, run: !!S.running && S.speed > 0.3, vy: me.vy });
  { const sc0 = Sim.scaleOf(S.profile.level), aq0 = CONFIG.isAqua(S.profile.cls);
    if (S.alive && !S.hatch) {
      footSound(S, x, z, sc0 * 1.1, !me.fly && !me.clm && Math.abs(me.vy || 0) < 2, water && !aq0 ? true : false);
      if (water && !S.wasWater) Audio.sfx(sc0 > 1 ? 'splash_big' : 'splash', null);
      if (aq0 && water && S.speed > 0.3 && Math.random() < dt * 1.2) Audio.sfx('bubble', null);
    }
    S.wasWater = water; }
  const dead = !S.alive; a.dino.rotation.z = dead ? 1.45 : 0; a.dino.position.y = (dead ? 0.35 : 0) + (S.world.nestLift ? S.world.nestLift(x, z) : 0) + surfFix(x, y, z);
  a.group.visible = true; a.dino.visible = true; a.tag.visible = true; { const k = clamp(camDist / 8, 0.5, 1.5); a.tag.scale.set(3.6 * k, 0.9 * k, 1); }
  if (S.hatch) hatchPose(a); else if (a.dino.userData.hatchFix) { a.dino.userData.hatchFix = false; }
  guardHint(!!me.grd && S.alive); shieldFx(a, false); ownShieldRing(a, !!(S.mp && S.mp.sh > 0) || !!me.grd, t);   // свой щит — кольцо на земле: сфера вокруг камеры превращалась в «табличку»
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
    if (!(fl & F.DEAD) && dd < 55) footSound(p, _s.x, _s.z, Sim.scaleOf(p.info.level || 1) * 1.1, !an.fly && !an.climb, water2 && !CONFIG.isAqua(p.actor.cls));
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
    if (dd < 60 && !(e.flags & 16)) { if (e.boss) { if (!(e.flags & 64)) footSound(e, _s.x, _s.z, 1.3 + (e.def.size || 3) * 0.5, !(e.def.fly), false, 22); } else if (e.arch && !e.arch.fly && !e.arch.water && !e.arch.tiny) footSound(e, _s.x, _s.z, e.arch.size * 0.8, true, false); }
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
    { const tk = e.tag.scale.y / 0.9; e.tag.position.y = e.bar.visible ? Math.max(e.tagY + 0.5, e.bar.position.y + 0.2 * e.bar.scale.y + 0.45 * tk + 0.08) : e.tagY + 0.5; }   // здоровье не залезает на название: подпись поднимается над полоской
    // чутьё: метки добычи и врагов сквозь рельеф
    if (S.sense && !e.boss && dd < S.sense && dd > 9) {
      if (!e.mark) { e.mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex, depthTest: false, transparent: true, opacity: 0.9 })); e.mark.scale.set(0.9, 0.9, 1); e.mark.renderOrder = 15; g.add(e.mark); }
      e.mark.visible = true; e.mark.position.y = e.tagY + 1.4; e.mark.material.color.setHex(friend ? 0x9be37a : e.arch.role === 'hostile' ? 0xff4a3a : e.arch.role === 'herd' ? 0xffd35a : 0x6ccf4a);
    } else if (e.mark) e.mark.visible = false;
  }
}

// ---------------------------------------------------------------- HUD
// значок игрока-друга на картах: яркий ромб с белой обводкой и первой буквой ника (боты — серые), чтобы не путать с точками зверей
function friendMark(g, x, y, r, info, bot, rot) {
  g.save(); g.translate(x, y); g.rotate(rot || 0);
  g.beginPath(); g.moveTo(0, -r * 1.35); g.lineTo(r, 0); g.lineTo(0, r * 1.35); g.lineTo(-r, 0); g.closePath();
  g.fillStyle = bot ? '#b8b8b8' : '#ff4fd8'; g.fill(); g.lineWidth = Math.max(1.6, r * 0.28); g.strokeStyle = '#fff'; g.stroke();
  const ch = String((info && info.nick) || '?').trim().charAt(0).toUpperCase();
  if (ch && !bot) { g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(r * 1.25) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 2; g.strokeStyle = 'rgba(80,0,70,.9)'; g.strokeText(ch, 0, r * 0.08); g.fillText(ch, 0, r * 0.08); }
  g.restore();
}
const miniCv = $('mini-cv'), miniCtx = miniCv.getContext('2d');
function drawMinimap() {
  const g = miniCtx, N = miniCv.width, c = N / 2, R = 160, k = c / R, w = S.world, me = S.me;
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
  for (const p of S.players.values()) { const q = p.actor.group.position; friendMark(g, (q.x - S.px) * k, (q.z - S.pz) * k, 7.5, p.info, p.info.bot, -input.yaw); }
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
let mapShutAt = 0;   // когда карту закрыли: сразу после закрытия касание «просачивается» на мини-карту под крестиком и открывало её снова
function toggleMap(on) {
  const was = mapOpen; mapOpen = on === undefined ? !mapOpen : !!on;
  if (was && !mapOpen) mapShutAt = performance.now();
  $('bigmap').classList.toggle('on', mapOpen);
  if (mapOpen) { if (document.pointerLockElement) document.exitPointerLock(); drawBigMap(); }
}
// на телефоне — касание мини-карты открывает карту, касание карты закрывает (preventDefault: без «призрачного» клика)
$('mini').addEventListener('touchend', e => { e.preventDefault(); if (S && S.welcomed && performance.now() - mapShutAt > 800) toggleMap(true); }, { passive: false });
$('mini').addEventListener('click', () => { if (S && S.welcomed && performance.now() - mapShutAt > 800) toggleMap(true); });
$('bigmap').addEventListener('touchend', e => { e.preventDefault(); toggleMap(false); }, { passive: false });
$('bigmap').addEventListener('click', () => toggleMap(false));
// единственный крестик: закрывает карту сразу при касании (и не даёт касанию пройти на мини-карту)
{
  const b = $('bigmap-x'), close = e => { e.preventDefault(); e.stopPropagation(); toggleMap(false); };
  b.addEventListener('touchstart', close, { passive: false });
  b.addEventListener('pointerdown', close);
  b.addEventListener('click', close);
}
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
    if (e.boss || !e.arch) continue; const p = e.group.position;   // все враги, которые знает клиент (сервер шлёт в радиусе AOI)
    dot(p.x, p.z, (e.flags & 16) ? '#9be37a' : e.arch.role === 'hostile' ? '#ff5a4a' : e.arch.role === 'herd' ? '#ffd35a' : '#8cff7a', 3.2);
  }
  for (const p of S.players.values()) { const q = p.actor.group.position; friendMark(g, P(q.x), P(q.z), 11, p.info, p.info.bot, 0); }
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
  { const bf = $('buff'), on = !!mp.bf && mp.bt > 0; if (on) { const txt = T('buff_' + mp.bf) + ' · ' + Math.floor(mp.bt / 60) + ':' + String(mp.bt % 60).padStart(2, '0'); if (bf._t !== txt) { bf._t = txt; bf.textContent = '✨ ' + txt; } } bf.style.display = on ? 'block' : 'none'; }
  { const bf = $('buff'), on = !!mp.bf && mp.bt > 0; if (on) { const txt = T('buff_' + mp.bf) + ' · ' + Math.floor(mp.bt / 60) + ':' + String(mp.bt % 60).padStart(2, '0'); if (bf._t !== txt) { bf._t = txt; bf.textContent = '✨ ' + txt; } } bf.style.display = on ? 'block' : 'none'; }
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
    let frac = 0; if (a.slot === 'e') frac = mp.cd[1] / (a.cd || 1); else if (a.slot === 'q') frac = mp.cd[2] / (a.cd || 1); else if (a.slot === 'x') { frac = 1 - mp.ul / 100; const rdy = mp.ul >= 100; a.b.classList.toggle('ult-ready', rdy); a.b.classList.toggle('ult-on', mp.ut > 0); } else if (a.slot === 'atk') frac = mp.cd[0] / (CONFIG.CLASSES[pr.cls].atkCd || 0.5);
    a.el.style.height = clamp(frac, 0, 1) * 100 + '%';
    { // числовой таймер: секунды до готовности (для ульты — проценты заряда или секунды действия)
      let rem = 0, txt = '';
      if (a.slot === 'e') rem = mp.cd[1]; else if (a.slot === 'q') rem = mp.cd[2]; else if (a.slot === 'atk') rem = mp.cd[0];
      if (a.slot === 'x') txt = mp.ut > 0 ? mp.ut + T('sec_short') : (mp.ul >= 100 ? '' : Math.floor(mp.ul) + '%');
      else if (rem > 0.05) txt = rem >= 10 ? String(Math.ceil(rem)) : rem.toFixed(1);
      if (a.ct && a.ct._t !== txt) { a.ct._t = txt; a.ct.textContent = txt; }
    }
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
  if (!S.alive) { $('rs-t').textContent = mp.rt > 0 ? T('respawn_in', { n: Math.ceil(mp.rt) }) : T('you_died'); if (S.revWait && mp.rt > 0) $('rs-s').textContent = T('rev_wait'); }
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
const RES_MIN = 0.55;
function autoQuality(dt) {
  aqT += dt; aqN++;
  if (aqT < 1.5) return;
  const fps = aqN / aqT; aqT = 0; aqN = 0; fpsShow = Math.round(fps);
  if (qualityPref !== 'auto') return;
  const target = IS_TOUCH ? CONFIG.TARGET_FPS_MOBILE : CONFIG.TARGET_FPS_DESKTOP, order = ['low', 'med', 'high'], i = order.indexOf(qualityName);
  if (fps < target * 0.85) {
    aqLow++; aqHigh = 0;
    if (aqLow >= 2) {
      aqLow = 0;
      // сначала плавно снижаем разрешение картинки, и только когда оно уже минимальное — переходим на более низкое качество
      if (resScale > RES_MIN + 0.01) { resScale = Math.max(RES_MIN, resScale - (fps < target * 0.6 ? 0.2 : 0.1)); applyRenderQuality(); }
      else if (i > 0) { qualityName = order[i - 1]; resScale = 0.8; aqDowngraded = true; applyRenderQuality(); }
    }
  } else if (fps > target * 0.97) {
    aqHigh++; aqLow = 0;
    if (aqHigh >= 4 && resScale < 1) { resScale = Math.min(1, resScale + 0.05); aqHigh = 0; applyRenderQuality(); }   // запас по FPS — возвращаем резкость
    else if (aqHigh >= 6 && resScale >= 1 && !aqDowngraded && i < 2) { qualityName = order[i + 1]; aqHigh = 0; applyRenderQuality(); }
  } else { aqLow = 0; aqHigh = 0; }
}

// ---------------------------------------------------------------- главный цикл
let last = performance.now(), clock = 0;
const _errSeen = new Set();
function safe(fn, a, b, c) { try { fn(a, b, c); } catch (e) { const k = fn.name + ':' + e.message; if (!_errSeen.has(k)) { _errSeen.add(k); console.error(k, e); } } }
let lastEnv = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const rawDt = (nowMs - last) / 1000, dt = Math.min(0.05, rawDt); last = nowMs; clock += dt;
  autoQuality(Math.min(1, rawDt));   // реальное время кадра (не обрезанное), чтобы FPS считался честно
  if (!S || !S.welcomed) { updateMenu3d(dt); renderer.render(menu3d.scene, camera); return; }
  const now = nowMs / 1000;
  S.acc = (S.acc || 0) + dt;
  let n = 0; while (S.acc >= DT && n < 5) { S.acc -= DT; n++; fixedStep(); } if (n === 5) S.acc = 0;
  // каждый блок защищён: ошибка в одном (например, у редкого объекта) не должна останавливать всю игру
  safe(updateActors, dt, clock, now);
  safe(updateEnts, dt, clock, now);
  safe(updateFx, dt);
  if (S.hatch) updateHatch(dt);
  updateRevive(dt); secretsFx(dt); updateNestDeco();
  if (S.decor) { S.decor.sync(S, S.world, S.profile); S.decor.update(clock); }
  const cc = S.coro ? updateCoro(dt) : S.bc ? updateBcine(dt) : S.warp ? updateWarp(dt) : false;
  const hc = cc ? true : S.hatch ? hatchCamera(dt) : false;
  if (hc !== true) {
    { const sp = !S.alive ? spectateTarget() : null; if (sp) placeCamera(dt, sp.x, sp.y, sp.z, now); else placeCamera(dt, S.px, S.py, S.pz, now); }
    if (hc && hc.pos) { const e = S.hatch.blend * S.hatch.blend * (3 - 2 * S.hatch.blend); _cp.copy(camera.position); _cq.copy(camera.quaternion); camera.position.lerpVectors(hc.pos, _cp, e); camera.quaternion.slerpQuaternions(hc.q, _cq, e); }
  }
  if (S.coroBlend && S.coroBlend.pos) { const cb = S.coroBlend; cb.t += dt; const e = Math.min(1, cb.t / 0.8), k = e * e * (3 - 2 * e); _cp.copy(camera.position); _cq.copy(camera.quaternion); camera.position.lerpVectors(cb.pos, _cp, k); camera.quaternion.slerpQuaternions(cb.q, _cq, k); if (e >= 1) S.coroBlend = null; }
  flushTramplers();
  { const f = _lf.set(0, 0, -1).applyQuaternion(camera.quaternion), l = Math.hypot(f.x, f.z) || 1; Audio.listener(S.px, S.pz, -f.z / l, f.x / l); }
  S.world.update(camera.position, { x: S.px, y: S.py, z: S.pz }, clock, dt, S.tod, S.wx);
  if (S.foodMeshes) for (const f of S.foodMeshes) { f.rotation.y += dt * 1.2; const fx = f.userData.fx; if (fx) { const q = Math.sin(clock * 3 + f.position.x), r = 1 + 0.18 * q; if (!fx.rg) { fx.glow.material.opacity = 0.3 + 0.15 * q; continue; } fx.rg.scale.set(r, r, 1); fx.glow.material.opacity = 0.45 + 0.2 * q; fx.spark.position.y = 1.5 + 0.2 * Math.sin(clock * 2.2 + f.position.z); fx.spark.material.opacity = 0.6 + 0.3 * q; } }
  if (now - lastEnv > 0.3) { lastEnv = now; const W = S.W, cy = camera.position.y;
    Audio.setEnv({ under: !!(W.ocean ? cy < W.waterY - 0.15 : (W.isWater(camera.position.x, camera.position.z) && cy < W.waterY - 0.15)), rain: !W.ocean && S.biome !== 'volcano' && S.wx > 0.45 ? Math.min(1, (S.wx - 0.35) * 1.6) : 0, night: S.tod < 0.22 || S.tod > 0.78, wind: S.wx > 0.6 ? 1.6 : 1 }); }
  if (now - lastHud > 0.1) { lastHud = now; tutUpdate(); updateHud(nowMs, dt); drawMinimap(); drawBigMap(); }
  if (!Story.busy()) renderer.render(scene, camera);   // во время полноэкранного ролика 3D-сцену не рисуем
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
  eggThumb: (skin, colorHex) => {
    const c = eggCanvas(skin, colorHex), t = document.createElement('canvas'); t.width = 120; t.height = 150; const g = t.getContext('2d');
    g.save(); g.beginPath(); g.moveTo(60, 6); g.bezierCurveTo(100, 6, 114, 70, 108, 96); g.bezierCurveTo(102, 128, 84, 146, 60, 146); g.bezierCurveTo(36, 146, 18, 128, 12, 96); g.bezierCurveTo(6, 70, 20, 6, 60, 6); g.closePath(); g.clip();
    g.drawImage(c, 100, 0, 312, 256, 0, 0, 120, 150);
    const sh = g.createRadialGradient(42, 44, 4, 60, 84, 84); sh.addColorStop(0, 'rgba(255,255,255,.55)'); sh.addColorStop(0.25, 'rgba(255,255,255,0)'); sh.addColorStop(0.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = sh; g.fillRect(0, 0, 120, 150); g.restore();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(60, 6); g.bezierCurveTo(100, 6, 114, 70, 108, 96); g.bezierCurveTo(102, 128, 84, 146, 60, 146); g.bezierCurveTo(36, 146, 18, 128, 12, 96); g.bezierCurveTo(6, 70, 20, 6, 60, 6); g.stroke();
    return t.toDataURL(); }, activeProfile, menuSetDino, menuShowEgg, menuHatch, fade, pendingHatch: null,
  setPanelOpen(v) { panelOpen = v; if (S && S.conn && !S.o.online) S.conn.paused = !!v;   // одиночная игра на паузе, пока открыто меню
    if (document.pointerLockElement) { if (v) document.exitPointerLock(); } resetInput(); },
  relock() { if (!IS_TOUCH && S && S.welcomed) { try { canvas.requestPointerLock(); } catch (e) { /* ignore */ } } },
  setQuality(q) { qualityPref = q; try { localStorage.setItem('dino_q', q); } catch (e) { /* ignore */ } if (q !== 'auto') qualityName = q; else { qualityName = IS_TOUCH ? 'med' : 'high'; aqDowngraded = false; } applyRenderQuality(); },
  getQuality: () => qualityPref,
  setSens(v) { sens = v; try { localStorage.setItem('dino_sens', String(v)); } catch (e) { /* ignore */ } }, getSens: () => sens,
  audio: Audio, story: Story, IS_TOUCH, isTouch: IS_TOUCH,
  rebuildHud() { if (S && S.welcomed) { buildAbilityBar(); } }
};
$('menubtn').addEventListener('click', () => { Audio.init(); UI.openPause(); });
$('menubtn').addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });

(async function boot() {
  applyRenderQuality();
  scene = menu3d.scene;
  try {
    await Profile.restore();
    Story.init({ Audio, send: (m) => { if (S && S.conn) S.conn.send(m); }, pause: (on) => { if (S && S.welcomed) { ctl.setPanelOpen(!!on); } }, alive: () => !!(S && S.welcomed && !S.ending), coroActive: () => !!(S && (S.coro || S.bc || S.warp)), banner: (t, ms) => UI.banner(t, ms), getEnding: () => (S && S.profile && S.profile.ending) || '', onEnding: (id) => { if (S) { S.profile.ending = id; if (S.actor) S.actor.set({ end: id }); } } });
    UI.init(ctl);
    UI.applyLang();
    UI.showMenu();
    Audio.setScene('menu');
  } catch (e) { console.error(e); const el = $('loaderr'); if (el) el.textContent = 'Ошибка запуска: ' + e.message; return; }
  $('loading').style.display = 'none';
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-кэш необязателен */ });
  window.__dino = { Story, startCoro, startBcine, startWarp, get coro() { return S && S.coro; }, buildEnemy, animateEnemy, get S() { return S; }, get clock() { return clock; }, ctl, THREE, foodMesh, scene, renderer, Profile, input, camera, menu3d, menuSetDino };      // для отладки и автотестов
})();

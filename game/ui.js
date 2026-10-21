/* Интерфейс вне игрового мира: меню, вход, создание динозавра, эволюция и магазин, достижения, рейтинг, настройки, пауза, список игроков и дуэли. */
import * as P from './profile.js';
const CONFIG = window.CONFIG, Sim = window.Sim, T = window.T, TN = window.TN;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ctl = null, openName = null, openRender = null, toastT = 0, bannerT = 0;
{ const vl = document.getElementById('verlbl'); if (vl) vl.textContent = 'v' + CONFIG.VERSION; }
const CLS_ICO = Object.fromEntries(Object.keys(CONFIG.CLS_INFO).map(k => [k, CONFIG.CLS_INFO[k].ico]));
const BIOME_ICO = { forest: '🌲', snow: '❄️', mountain: '⛰️', desert: '🏜️', swamp: '🐊', volcano: '🌋', reef: '🐠', kelp: '🌿', arctic: '🧊', vents: '♨️', abyss: '🦑' };
const AUTH_ERR = {
  bad_nick: { ru: 'Ник: 3–14 символов (буквы, цифры, _ и -)', en: 'Nickname: 3–14 chars (letters, digits, _ and -)' }, bad_password: { ru: 'Пароль: от 6 символов', en: 'Password: 6+ characters' },
  nick_taken: { ru: 'Этот ник уже занят', en: 'Nickname already taken' }, bad_credentials: { ru: 'Неверный ник или пароль', en: 'Wrong nickname or password' },
  rate_limited: { ru: 'Слишком много попыток, подождите минуту', en: 'Too many attempts, wait a minute' }, server_error: { ru: 'Ошибка сервера', en: 'Server error' },
  in_game: { ru: 'Сначала выйдите из игры', en: 'Leave the game first' }, class_locked: { ru: 'Класс нельзя менять', en: 'Class is locked' }
};
const errText = e => { const m = AUTH_ERR[e && e.message]; return m ? m[window.I18N.lang] : (e && e.name === 'TypeError' ? T('server_off') : (e && e.message) || T('server_off')); };
const inGame = () => !!(ctl.session && ctl.session.welcomed);
const screens = ['menu', 'auth', 'create', 'panel'];

function show(id) { for (const s of screens) $(s).classList.toggle('on', s === id); }
function closeAll() { for (const s of screens) $(s).classList.remove('on'); closePanelState(); }
function closePanelState() { openName = null; openRender = null; if (ctl && inGame()) ctl.setPanelOpen(false); }
function openPanel(name, html, after) {
  const was = openName; openName = name; $('panel-card').innerHTML = html; show('panel');
  $('panel-card').scrollTop = 0; if (inGame()) ctl.setPanelOpen(true);
  after && after($('panel-card')); return was;
}
function panelClose() { $('panel').classList.remove('on'); closePanelState(); if (!inGame()) showMenu(); else ctl.relock(); }
function btnClick(root, sel, fn) { root.querySelectorAll(sel).forEach(b => b.addEventListener('click', e => { ctl.audio.init(); ctl.audio.sfx('click'); fn(b, e); })); }

export const UI = {
  init(c) {
    ctl = c;
    $('a-close').onclick = () => { showMenu(); };
    $('a-login').onclick = () => authGo(false); $('a-reg').onclick = () => authGo(true);
    ['a-nick', 'a-pass'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') authGo(false); }));
    $('dreq-n').onclick = () => { $('dreq').classList.remove('on'); if (dreqFrom) ctl.send({ t: 'duelans', from: dreqFrom, ok: false }); dreqFrom = 0; };
    $('dreq-y').onclick = () => { $('dreq').classList.remove('on'); if (dreqFrom) ctl.send({ t: 'duelans', from: dreqFrom, ok: true }); dreqFrom = 0; };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openName && inGame()) { panelClose(); } });
  },
  applyLang() {
    document.querySelectorAll('[data-i]').forEach(el => { el.textContent = T(el.dataset.i); });
    document.documentElement.lang = window.I18N.lang; $('c-name').placeholder = T('dino_name');
  },
  showLoading(on) { const el = $('loading'); el.style.display = on ? 'flex' : 'none'; if (on) $('loaderr').textContent = ''; },
  toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms || 2600); },
  banner(msg, ms) { const b = $('banner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), ms || 2200); },
  note(msg) { const n = document.createElement('div'); n.textContent = msg; $('notes').appendChild(n); setTimeout(() => n.remove(), 4600); while ($('notes').children.length > 5) $('notes').firstChild.remove(); },
  closeAll, showMenu, openAbout, openChange, openEvo, openAch, openLeaders, openSettings, openPause, openPlayers, duelRequest,
  refreshOpen() { if (openName && openRender) openRender(); }
};

// ---------------------------------------------------------------- главное меню
function activeProf() { return P.state.token && P.state.profile && P.state.profile.hatched ? P.state.profile : P.state.local; }
export function showMenu() {
  closePanelState(); $('hud').classList.remove('on');
  const st = P.state, prof = activeProf();
  const acc = st.user ? `<b>${esc(st.user)}</b>${st.admin ? '<span class="badge">ADMIN</span>' : ''}` : `<b>${T('guest')}</b>`;
  $('menu-card').innerHTML = `
    <h1>DINO EVOLUTION</h1><p class="sub">${T('tagline')}</p>
    <div id="acc"><span>${acc}</span><button class="sm" id="m-acc">${st.user ? T('signout') : T('signin')}</button></div>
    ${!st.serverUp ? `<p class="sub" style="color:#ffb066">${T('offline_note')}</p>` : ''}
    <button class="pri" data-go="online" ${!st.serverUp ? 'disabled' : ''}>${T('play_online')}</button>
    <button data-go="code" ${!st.serverUp ? 'disabled' : ''}>${T('friends')}</button>
    <button data-go="single">${T('single')}</button>
    <div class="grid2">
      <button data-go="leaders">${T('leaderboard')}</button><button data-go="evo">${T('evolution')}</button>
      <button data-go="ach">${T('achievements')}</button><button data-go="settings">${T('settings')}</button>
    </div>`;
  const root = $('menu-card');
  $('m-acc').onclick = async () => { ctl.audio.init(); if (st.user) { await P.logout(); showMenu(); } else openAuth(() => showMenu()); };
  btnClick(root, '[data-go]', b => {
    const g = b.dataset.go;
    if (g === 'online' || g === 'code' || g === 'single') goPlay(g);
    else if (g === 'leaders') openLeaders(); else if (g === 'evo') openEvo(); else if (g === 'ach') openAch(); else openSettings();
  });
  show('menu');
  if (prof && prof.hatched) ctl.menuSetDino({ cls: prof.cls, color: CONFIG.COLORS[prof.color], level: prof.level, evo: prof.evo, cosmetic: prof.cosmetic }); else ctl.menuShowEgg(0x6aa84f);
  ctl.audio.setScene('menu');
}

function goPlay(kind) {
  const online = kind !== 'single';
  if (online && !P.state.serverUp) { UI.toast(T('server_off')); return; }
  if (online && !P.state.token) { openAuth(() => goPlay(kind)); return; }
  const prof = online ? P.state.profile : P.state.local;
  if (!prof || !prof.hatched) { openCreate(online, () => goPlay(kind), false); return; }
  // только что вылупившийся: сразу в первый биом, без экрана выбора
  if (ctl.pendingHatch && kind !== 'code') { ctl.start({ online, biome: Sim.homeBiome(prof), mode: online ? 'public' : 'solo' }); return; }   // морской вылупляется в океане
  if (ctl.pendingHatch) ctl.fade(false, 600);
  openPlayPanel(online, kind === 'code');
}

// ---------------------------------------------------------------- вход
let authDone = null;
function openAuth(done) { authDone = done; $('a-err').textContent = ''; show('auth'); $('a-nick').focus(); UI.applyLang(); }
async function authGo(reg) {
  const nick = $('a-nick').value.trim(), pw = $('a-pass').value; $('a-err').textContent = '';
  $('a-login').disabled = $('a-reg').disabled = true;
  try { await (reg ? P.register(nick, pw) : P.login(nick, pw)); $('a-pass').value = ''; const d = authDone; authDone = null; d && d(); }
  catch (e) { $('a-err').textContent = errText(e); }
  $('a-login').disabled = $('a-reg').disabled = false;
}

// ---------------------------------------------------------------- выбор биома и режима
function openPlayPanel(online, codeFocus) {
  const prof = online ? P.state.profile : P.state.local;
  // 1) игрок сам выбирает режим (суша / океан), 2) тип в этом режиме (у каждого типа свой уровень и эволюция), 3) локацию
  let world = CONFIG.worldOf(prof.biome), cls = prof.cls;
  const bestType = w => { let b = null, bl = 0; for (const t of CONFIG.TYPES[w]) { const l = Sim.typeLevel(prof, t); if (l > bl) { bl = l; b = t; } } return b || CONFIG.TYPES[w][0]; };
  if (CONFIG.clsWorld(cls) !== world) cls = bestType(world);
  const firstOpen = (w) => { const l = CONFIG.worldList(w); let b = l[0]; for (const x of l) if (Sim.canEnterBiome(prof, x)) b = x; return b; };
  let roomCode = randCode();   // при открытии меню в поле сразу подставлен случайный код новой комнаты
  let sel = CONFIG.worldList(world).indexOf(prof.biome) >= 0 && Sim.canEnterBiome(prof, prof.biome) ? prof.biome : firstOpen(world);
  const worldBtn = (w) => {
    const pct = CONFIG.worldProgress(prof, w), n = CONFIG.worldKings(prof, w), all = CONFIG.worldList(w).length, sp = CONFIG.worldSpecies(w).length, seen = CONFIG.worldSeen(prof, w);
    return `<button class="wt ${w === world ? 'on' : ''}" data-w="${w}"><span class="wn">${w === 'sea' ? '🌊 ' + T('world_sea') : '🌍 ' + T('world_land')}</span>
      <span class="wp">${pct}%</span><span class="wbar"><i style="width:${pct}%"></i></span>
      <small>${T('world_stat', { a: n, b: all, c: seen, d: sp })}</small></button>`;
  };
  const typeCard = (k) => {
    const I = CONFIG.CLS_INFO[k], lv = Sim.typeLevel(prof, k), st = lv ? T('level_short') + lv + ' · ' + T('stage_' + CONFIG.STAGES[CONFIG.stageIndex(lv)].id) : T('type_new');
    return `<div class="tp ${k === cls ? 'sel' : ''}" data-k="${k}"><i>${I.ico}</i><b>${esc(TN(I.n))}</b><small>${st}</small></div>`;
  };
  const render = () => {
    const grid = CONFIG.worldList(world).map(b => {
      const ok = Sim.canEnterBiome(prof, b), king = prof.kings.indexOf(b) >= 0;
      return `<div class="bm ${ok ? '' : 'lock'} ${b === sel ? 'sel' : ''}" data-b="${b}"><i>${ok ? BIOME_ICO[b] : '🔒'}</i>${esc(TN(CONFIG.BIOME[b].n))}<small>${king ? '👑 ' + T('king_mark') : T('req_boss', { n: CONFIG.BOSS_LEVEL[b] })}</small></div>`;
    }).join('');
    const I = CONFIG.CLS_INFO[cls], lv = Sim.typeLevel(prof, cls);
    return `<h2>${T('play_title')}</h2><div class="worlds">${worldBtn('land')}${worldBtn('sea')}</div>
      <h3>${T('type_title')}</h3><div class="types">${CONFIG.TYPES[world].map(typeCard).join('')}</div>
      <div class="tdesc"><p>${esc(TN(I.d))}</p>${statsGrid(cls, Math.max(1, lv))}${world === 'sea' ? `<p class="sub">${T('sea_land_note')}</p>` : ''}${abilList(cls)}${lv ? '' : `<p class="sub">${T('type_new_d')}</p>`}</div>
      <h3>${T('tab_biomes')}</h3><p class="sub">${T('unlock_next')}</p><div class="biomes">${grid}</div>
      ${online ? `<button class="pri" id="pp-pub">${T('public_room')}</button>
      <label>${T('code_room')}</label><div class="row"><input id="pp-code" inputmode="text" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${roomCode}" placeholder="${T('code_ph')}" style="margin:0;text-transform:uppercase;letter-spacing:3px;font-weight:800"><button id="pp-dice" title="${T('new_room')}">🎲</button><button id="pp-join">${T('join_code')}</button></div>`
      : `<button class="pri" id="pp-solo">${T('single')}</button>`}
      ${Sim.isLord(prof) && !CONFIG.isAqua(cls) ? `<button id="pp-rush">🔥 ${T('boss_rush')}</button>` : ''}
      <div class="err" id="pp-err"></div><button id="pp-back">${T('back')}</button>`;
  };
  const bind = (root) => {
    btnClick(root, '.bm', b => { if (!b.classList.contains('lock')) { sel = b.dataset.b; draw(); } });
    btnClick(root, '.tp', b => { cls = b.dataset.k; ctl.menuSetDino({ cls, color: CONFIG.COLORS[prof.color], level: Math.max(1, Sim.typeLevel(prof, cls)), evo: {} }); draw(); });
    btnClick(root, '.wt', b => { const w = b.dataset.w; if (w !== world) { world = w; sel = firstOpen(w); cls = bestType(w); draw(); } });
    const go = (mode, code) => { closeAll(); ctl.start({ online, biome: sel, cls, mode, code }); };
    $('pp-back') && ($('pp-back').onclick = () => showMenu());
    $('pp-pub') && ($('pp-pub').onclick = () => go('public')); $('pp-solo') && ($('pp-solo').onclick = () => go('solo'));
    $('pp-rush') && ($('pp-rush').onclick = () => { const code = online && $('pp-code') && /^[A-Za-z]{5,8}$/.test($('pp-code').value) ? $('pp-code').value.toUpperCase() : undefined; go('rush', code); });
    $('pp-join') && ($('pp-join').onclick = () => { const c = $('pp-code').value.trim().toUpperCase(); if (!/^[A-Z]{5,8}$/.test(c)) { $('pp-err').textContent = T('bad_code'); return; } go('code', c); });
    $('pp-dice') && ($('pp-dice').onclick = () => { roomCode = randCode(); $('pp-code').value = roomCode; });
    $('pp-code') && ($('pp-code').oninput = e => { e.target.value = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase(); roomCode = e.target.value; });
    if (codeFocus && $('pp-code')) $('pp-code').focus();
  };
  const draw = () => { openPanel('play', render(), bind); openRender = null; };
  draw();
  ctl.menuSetDino({ cls, color: CONFIG.COLORS[prof.color], level: Math.max(1, Sim.typeLevel(prof, cls)), evo: cls === prof.cls ? prof.evo : {} });
}

// ---------------------------------------------------------------- создание динозавра и вылупление
let createState = null;
// значки способностей типа: Атака · E · Q · F
function abilChips(k) {
  const A = CONFIG.ABILITIES[k], AI = CONFIG.ABIL_INFO, f = k === 'fly' ? 'fly' : k === 'herb' ? 'climb' : '';
  return [['atk', 'LMB'], [A.e.id, 'E'], [A.q.id, 'Q'], f ? [f, 'F'] : null].filter(Boolean).map(([id, key]) => `<u>${key === 'LMB' ? CONFIG.CLS_INFO[k].atkIco : AI[id].ico} ${esc(TN(id === 'atk' ? CONFIG.CLS_INFO[k].atkN : AI[id].n))}</u>`).join('');
}
// краткие характеристики типа для выбора: здоровье, урон, скорость, выносливость и т.д. (на уровне lv, без эволюции)
function statsGrid(k, lv) {
  const st = Sim.statsFor(k, lv || 1, {}), aq = CONFIG.isAqua(k), c = CONFIG.CLASSES[k], n1 = v => (Math.round(v * 10) / 10).toString();
  const cell = (a, b) => `<div class="sr"><span>${a}</span><b>${b}</b></div>`;
  const walk = st.speed / 30, run = c.noSprint ? 0 : walk * st.sprintMult;
  return `<div class="stats sm">${cell(T('st_hp'), st.hp)}${cell(T('st_dmg'), n1(st.dmg))}${cell(T('st_atkspd'), n1(1 / st.atkCd) + ' ' + T('per_s'))}${cell(T('st_stam'), CONFIG.STAM_MAX)}`
    + (aq ? cell(T('st_spd_water'), n1(st.swimSpd / 30 * 3.6 / 3.6)) + cell(T('st_spd_land'), n1(walk)) : cell(T('st_walk'), n1(walk)) + cell(T('st_runspd'), run ? n1(run) : T('st_none')))
    + cell(T('st_armor'), Math.round(st.armor * 100) + '%') + cell(T('st_dodge'), Math.round(st.fx.dodge || 0) + '%') + `</div>`;
}
// подробные описания способностей типа (атака, E, Q, F)
function abilList(k) {
  const A = CONFIG.ABILITIES[k], AI = CONFIG.ABIL_INFO, f = k === 'fly' ? 'fly' : k === 'herb' ? 'climb' : '';
  const row = (key, ico, nm, d) => `<li><b>${ico} ${esc(nm)}</b> <kbd>${key}</kbd><span>${esc(d)}</span></li>`;
  const cdf = (id, cd) => TN(AI[id].d).replace('{cd}', cd);
  return '<ul class="abl">' + row(IS_TOUCH_UI ? '⚔' : 'ЛКМ', CONFIG.CLS_INFO[k].atkIco, TN(CONFIG.CLS_INFO[k].atkN), TN(AI.atk.d)) + row('E', AI[A.e.id].ico, TN(AI[A.e.id].n), cdf(A.e.id, A.e.cd)) + row('Q', AI[A.q.id].ico, TN(AI[A.q.id].n), cdf(A.q.id, A.q.cd))
    + (f ? row('F', AI[f].ico, TN(AI[f].n), cdf(f, 0)) : '') + '</ul>';
}
const IS_TOUCH_UI = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
function openCreate(online, done, newRun) {
  const prof = online ? P.state.profile : P.state.local;
  createState = { color: Math.max(0, prof.color || 0), cls: prof.cls || 'carn', name: prof.name || P.state.user || '' };
  $('c-name').value = createState.name; $('c-err').textContent = '';
  $('c-colors').innerHTML = CONFIG.COLORS.map((c, i) => `<div class="sw ${i === createState.color ? 'sel' : ''}" data-c="${i}" style="background:#${c.toString(16).padStart(6, '0')}"></div>`).join('');
  const clsCard = k => { const I = CONFIG.CLS_INFO[k], A = CONFIG.ABILITIES[k];
    return `<div class="cls ${k === createState.cls ? 'sel' : ''}" data-k="${k}"><b>${I.ico} ${esc(TN(I.n))}</b><span>${esc(TN(I.d))}</span><em>${abilChips(k)}</em>${statsGrid(k, 1)}</div>`; };
  $('c-classes').innerHTML = ['land', 'sea'].map(w => `<div class="wh">${w === 'sea' ? '🌊 ' + T('world_sea') : '🌍 ' + T('world_land')}</div>` + CONFIG.TYPES[w].map(clsCard).join('')).join('');
  const preview = () => ctl.menuSetDino({ cls: createState.cls, color: CONFIG.COLORS[createState.color], level: 1, evo: {} });
  btnClick($('c-colors'), '.sw', b => { createState.color = +b.dataset.c; $('c-colors').querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x === b)); preview(); });
  btnClick($('c-classes'), '.cls', b => { createState.cls = b.dataset.k; $('c-classes').querySelectorAll('.cls').forEach(x => x.classList.toggle('sel', x === b)); preview(); });
  $('c-back').onclick = () => showMenu();
  $('c-go').onclick = async () => {
    const name = $('c-name').value.replace(/[<>]/g, '').trim();
    if (name.length < 2) { $('c-err').textContent = T('dino_name'); return; }
    $('c-go').disabled = true; $('c-err').textContent = '';
    try {
      await P.createCharacter({ name, color: createState.color, cls: createState.cls, hatched: true }, online, newRun);
      // экран плавно темнеет, дальше — сразу в мир: яйцо в гнезде вылупляется уже в игре
      ctl.pendingHatch = { cls: createState.cls, color: CONFIG.COLORS[createState.color] };
      await ctl.fade(true, 800);
      show(null); screens.forEach(s => $(s).classList.remove('on'));
      done && done();
      setTimeout(() => { if (!ctl.session) ctl.fade(false, 700); }, 60);
    } catch (e) { $('c-err').textContent = errText(e); }
    $('c-go').disabled = false;
  };
  UI.applyLang(); show('create'); ctl.menuShowEgg(CONFIG.COLORS[createState.color]);
  // на экране создания сразу показываем выбранного динозавра
  setTimeout(preview, 0);
}

// ---------------------------------------------------------------- эволюция и магазин
let evoTree = 'life', evoSel = '';
const fmtV = v => (Math.round(v * 10) / 10).toString();
function treeSpent(prof, t) { let n = 0; for (const k in prof.evo || {}) if (k.indexOf(t + ':') === 0) n += prof.evo[k] | 0; return n; }
function openEvo(tab) {
  tab = tab || 'evo';
  const render = () => {
    const live = inGame(), prof = live ? ctl.session.profile : activeProf();
    if (!prof || !prof.hatched) { openPanel('evo', `<h2>${T('evolution')}</h2><p class="sub">${T('no_character')}</p><button id="pn-x">${T('back')}</button>`, r => { $('pn-x').onclick = panelClose; }); return; }
    const pts = CONFIG.evoPoints(prof.level, prof.evo), head = `<div class="row" style="margin-bottom:8px"><h2 style="margin:0;flex:2">${CLS_ICO[prof.cls]} ${esc(prof.name)} · ${T('level_short')}${prof.level}</h2><div class="pts" style="text-align:right">${T('evo_points', { n: pts })} · 🪙 ${prof.coins}</div></div>
      <div class="tabs"><button data-tab="evo" class="${tab === 'evo' ? 'on' : ''}">${T('evolution')}</button><button data-tab="shop" class="${tab === 'shop' ? 'on' : ''}">${T('shop')}</button></div>`;
    let body = '';
    if (tab === 'evo') {
      // деревья эволюции: граф 2 → 4 → 8; выбранная ветка светится, соседняя развилка — тусклая
      const trees = CONFIG.treesFor(prof.cls); if (trees.indexOf(evoTree) < 0) evoTree = trees[0];
      const T0 = CONFIG.TREES[evoTree], ev = prof.evo || {};
      const tabs2 = trees.map(t => `<button data-tree="${t}" class="${t === evoTree ? 'on' : ''}">${CONFIG.TREES[t].ico} ${esc(TN(CONFIG.TREES[t].n))}<small>${treeSpent(prof, t)}</small></button>`).join('');
      const Wd = 360, rowsY = [44, 164, 284], paths = [['L', 'R'], ['LL', 'LR', 'RL', 'RR'], ['LLL', 'LLR', 'LRL', 'LRR', 'RLL', 'RLR', 'RRL', 'RRR']];
      const pos = {}; paths.forEach((row, d) => row.forEach((p, i) => { pos[p] = { x: (i + 0.5) / row.length * Wd, y: rowsY[d] }; }));
      const rk = p => ev[evoTree + ':' + p] | 0, onPath = p => { for (let i = 1; i <= p.length; i++) if (!rk(p.slice(0, i))) return false; return true; };
      const reach = p => p.length === 1 || rk(p.slice(0, -1)) >= CONFIG.EVO_MAX;           // родитель прокачан полностью
      let lines = '';
      for (const p in pos) if (p.length > 1) { const a = pos[p.slice(0, -1)], b = pos[p], on = onPath(p); lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${on ? 'on' : reach(p) && onPath(p.slice(0, -1)) ? 'av' : ''}"/>`; }
      const nodes = Object.keys(pos).map(p => {
        const id = evoTree + ':' + p, n = T0.nodes[p], r = rk(p), can = CONFIG.evoCanBuy(prof.cls, prof.level, ev, id);
        const cls = r ? 'on' : can === 'ok' ? 'av' : can === 'taken' ? 'alt' : 'lock', sz = p.length === 3 ? 50 : 66;
        const pips = [0, 1, 2].map(i => `<i class="${i < r ? 'f' : ''}"></i>`).join('');
        return `<div class="en ${cls} ${evoSel === id ? 'sel' : ''} d${p.length}" data-node="${id}" style="left:${pos[p].x / Wd * 100}%;top:${pos[p].y}px;width:${sz}px;height:${sz}px"><span>${n.ico}</span><b>${pips}</b></div>`;
      }).join('');
      // карточка выбранного узла
      let card = `<p class="sub">${T('evo_hint')}</p>`;
      const sn = CONFIG.evoNode(evoSel);
      if (sn && sn.tree === evoTree) {
        const r = ev[evoSel] | 0, can = CONFIG.evoCanBuy(prof.cls, prof.level, ev, evoSel), sib = CONFIG.sibling(evoSel), sibN = CONFIG.evoNode(sib);
        const fxl = Object.keys(sn.node.fx).map(k => `<li>${esc(TN(CONFIG.FX[k]).replace('{v}', fmtV(sn.node.fx[k] * Math.max(1, r))))}</li>`).join('');
        let btn;
        if (can === 'ok') btn = `<button class="pri" data-buy="${evoSel}" ${live ? '' : 'disabled'}>${T('evo_up', { r: r + 1, m: CONFIG.EVO_MAX })}</button>`;
        else if (can === 'taken') btn = `<button class="pri" data-sw="${evoSel}" ${live ? '' : 'disabled'}>${T('evo_switch', { n: TN(sibN.node.n) })}</button>`;
        else btn = `<button disabled>${can === 'max' ? T('evo_max') : can === 'level' ? T('evo_need_lv', { l: CONFIG.EVO_TIER_LV[sn.path.length - 1] }) : can === 'parent' ? T('evo_need_parent') : can === 'points' ? T('evo_points_err') : T('evo_locked')}</button>`;
        card = `<div class="ecard"><h4>${sn.node.ico} ${esc(TN(sn.node.n))} <small>${T('evo_rank', { r, m: CONFIG.EVO_MAX })}</small></h4><ul>${fxl}</ul>
          <p class="sub">${r ? T('evo_now') : T('evo_per_rank')} · ${T('evo_vs', { n: TN(sibN.node.n) })}</p>${btn}</div>`;
      }
      body = `<div class="ttabs">${tabs2}</div><div class="etree"><svg viewBox="0 0 ${Wd} 330" preserveAspectRatio="none">${lines}</svg>${nodes}</div>${card}
        <div class="row" style="margin-top:10px"><button data-reset="1" class="red" ${live && CONFIG.evoSpent(prof.evo) > 0 ? '' : 'disabled'}>${T('evo_reset_free')}</button></div>${live ? '' : `<p class="sub">${T('offline_progress')}</p>`}`;
    } else {
      body = '<div class="shop">' + Object.keys(CONFIG.COSMETICS).map(id => {
        const c = CONFIG.COSMETICS[id], own = prof.cosmetics.indexOf(id) >= 0, eq = prof.cosmetic === id;
        const btn = own ? `<button data-eq="${eq ? '' : id}" ${live ? '' : 'disabled'}>${eq ? T('unequip') : T('equip')}</button>` : `<button data-shop="${id}" ${live && prof.coins >= c.price ? '' : 'disabled'}>${T('buy')} · 🪙 ${c.price}</button>`;
        return `<div class="br"><h4>${esc(TN(c.n))}</h4><p>${own ? T('owned') : ''}</p>${btn}</div>`;
      }).join('') + '</div>';
    }
    openPanel('evo', head + body + `<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
      btnClick(root, '[data-tab]', b => { tab = b.dataset.tab; render(); });
      btnClick(root, '[data-buy]', b => ctl.send({ t: 'evo', id: b.dataset.buy }));
      btnClick(root, '[data-sw]', b => ctl.send({ t: 'evosw', id: b.dataset.sw }));
      btnClick(root, '[data-tree]', b => { evoTree = b.dataset.tree; evoSel = ''; render(); });
      btnClick(root, '[data-node]', b => { evoSel = b.dataset.node; render(); });
      btnClick(root, '[data-reset]', () => ctl.send({ t: 'evoreset' }));
      btnClick(root, '[data-shop]', b => ctl.send({ t: 'buy', id: b.dataset.shop }));
      btnClick(root, '[data-eq]', b => ctl.send({ t: 'equip', id: b.dataset.eq }));
      $('pn-x').onclick = panelClose;
    });
    openRender = render;
  };
  render(); openRender = render;
}

// ---------------------------------------------------------------- достижения и рейтинг
function openAch() {
  const prof = inGame() ? ctl.session.profile : activeProf();
  const list = CONFIG.ACH.map(a => { const ok = prof && prof.hatched ? !!a.t(prof) : false; return `<div class="a ${ok ? 'on' : ''}"><i>${a.ico}</i><div><b>${esc(TN(a.n))}</b><span>${esc(TN(a.d))}</span></div></div>`; });
  const n = list.filter(x => x.includes('class="a on"')).length;
  openPanel('ach', `<h2>🏆 ${T('ach_title')} <small style="color:var(--mut)">${n}/${CONFIG.ACH.length}</small></h2><div class="ach">${list.join('')}</div><button id="pn-x" style="margin-top:12px">${T('back')}</button>`, () => { $('pn-x').onclick = panelClose; });
}
async function openLeaders(tab) {
  tab = tab || 'wins';
  openPanel('lb', `<h2>${T('lb_title')}</h2><p class="sub">…</p><button id="pn-x">${T('back')}</button>`, () => { $('pn-x').onclick = panelClose; });
  let data = null; try { data = await P.leaderboard(); } catch (e) { /* сервер недоступен */ }
  const me = (P.state.user || '').toLowerCase();
  let table;
  if (!data) table = `<p class="sub">${T('server_off')}</p>`;
  else {
    const rows = tab === 'wins' ? data.wins : data.kings;
    table = rows.length ? `<table><tr><th>${T('lb_place')}</th><th>${T('lb_name')}</th><th>${tab === 'wins' ? T('lb_wins_n') : T('lb_kings_n')}</th><th>${T('level_short')}</th></tr>` + rows.map((r, i) =>
      `<tr class="${r.nickKey === me ? 'me' : ''}"><td>${i + 1}</td><td>${r.cls ? CLS_ICO[r.cls] + ' ' : ''}${esc(r.nick)}${r.lord ? ' 🌟' : ''}</td><td>${tab === 'wins' ? r.wins : r.count + '/6'}</td><td>${r.level || ''}</td></tr>`).join('') + '</table>' : `<p class="sub">${T('lb_empty')}</p>`;
  }
  if (openName !== 'lb') return;
  openPanel('lb', `<h2>🏆 ${T('lb_title')}</h2><div class="tabs"><button data-t="wins" class="${tab === 'wins' ? 'on' : ''}">${T('lb_wins')}</button><button data-t="kings" class="${tab === 'kings' ? 'on' : ''}">${T('lb_kings')}</button></div>${table}<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
    btnClick(root, '[data-t]', b => openLeaders(b.dataset.t)); $('pn-x').onclick = panelClose;
  });
}

// ---------------------------------------------------------------- настройки
function openSettings() {
  const live = inGame(), lang = window.I18N.lang;
  const html = `<h2>${T('settings')}</h2><div class="grid2"><div>
    <label>${T('settings_lang')}</label><select id="s-lang"><option value="ru" ${lang === 'ru' ? 'selected' : ''}>Русский</option><option value="en" ${lang === 'en' ? 'selected' : ''}>English</option></select>
    <label>${T('quality')}</label><select id="s-q">${['auto', 'high', 'med', 'low'].map(q => `<option value="${q}" ${ctl.getQuality() === q ? 'selected' : ''}>${T('q_' + q)}</option>`).join('')}</select>
    <label>${T('sens')}</label><input id="s-sens" type="range" min="0.3" max="2.5" step="0.1" value="${ctl.getSens()}"></div><div>
    <label>${T('volume')}</label><input id="s-vol" type="range" min="0" max="1" step="0.05" value="${ctl.audio.getVolume()}">
    <label><input id="s-mus" type="checkbox" ${ctl.audio.getMusic() ? 'checked' : ''} style="width:auto;margin:0 8px 0 0">${T('music')}</label>
    <div style="height:10px"></div>
    <button id="s-newrun" ${live ? 'disabled' : ''}>${T('new_run')}</button>
    ${P.state.user ? `<button id="s-logout" ${live ? 'disabled' : ''}>${T('logout')}</button>` : ''}</div></div>
    <button class="pri" id="pn-x">${T('back')}</button>`;
  openPanel('settings', html, root => {
    $('s-lang').onchange = e => { window.I18N.set(e.target.value); UI.applyLang(); ctl.rebuildHud(); openSettings(); };
    $('s-q').onchange = e => ctl.setQuality(e.target.value);
    $('s-sens').oninput = e => ctl.setSens(parseFloat(e.target.value));
    $('s-vol').oninput = e => ctl.audio.setVolume(parseFloat(e.target.value)); $('s-mus').onchange = e => ctl.audio.setMusic(e.target.checked);
    $('s-newrun').onclick = async () => {
      if (!confirm(T('new_run_q'))) return;
      const online = !!P.state.token && !!P.state.profile && P.state.profile.hatched, prof = online ? P.state.profile : P.state.local;
      try { await P.createCharacter({ name: prof.name, color: prof.color, cls: null, hatched: false }, online, true); openCreate(online, () => showMenu(), true); } catch (e) { UI.toast(errText(e)); }
    };
    if ($('s-logout')) $('s-logout').onclick = async () => { await P.logout(); showMenu(); };
    $('pn-x').onclick = panelClose;
  });
}

// ---------------------------------------------------------------- пауза, игроки, дуэли, турнир
function randCode() { const a = new Uint32Array(6); (window.crypto || window.msCrypto).getRandomValues(a); return Array.from(a, v => String.fromCharCode(65 + v % 26)).join(''); }
function openPause() {
  if (!inGame()) return;
  const S = ctl.session, code = S.room.code;
  openPanel('pause', `<h2>${T('menu')} Dino Evolution</h2>${code ? `<p class="sub">${T('copy_code')}: <b style="color:var(--ac2);font-size:20px">${code}</b></p>` : ''}
    <button class="pri" id="ps-resume">${T('resume')}</button>
    <div class="grid2"><button id="ps-about">🦖 ${T('about_dino')}</button><button id="ps-chg" ${S.room.mode === 'duel' || S.room.mode === 'rush' ? 'disabled' : ''}>🔄 ${T('change_dino')}</button></div>
    <div class="grid2"><button id="ps-evo">${T('evolution')}</button><button id="ps-pl">${T('players')}</button><button id="ps-ach">${T('achievements')}</button><button id="ps-set">${T('settings')}</button></div>
    <button class="red" id="ps-exit">${T('to_menu')}</button>`, root => {
    $('ps-resume').onclick = panelClose; $('ps-about').onclick = openAbout; $('ps-chg').onclick = openChange; $('ps-evo').onclick = () => openEvo(); $('ps-pl').onclick = openPlayers; $('ps-ach').onclick = openAch; $('ps-set').onclick = openSettings;
    $('ps-exit').onclick = () => { closePanelState(); $('panel').classList.remove('on'); ctl.leave(); };
  });
}
// ---------------------------------------------------------------- смена динозавра прямо из паузы (в пределах мира: суша — свои, океан — свои)
function openChange() {
  if (!inGame()) return;
  const S = ctl.session, pr = S.profile, world = CONFIG.clsWorld(pr.cls);
  const card = k => {
    const I = CONFIG.CLS_INFO[k], lv = Sim.typeLevel(pr, k), cur = k === pr.cls;
    return `<div class="cls ${cur ? 'sel' : ''}" data-k="${k}"><b>${I.ico} ${esc(TN(I.n))} <small>${lv ? T('level_short') + lv + ' · ' + T('stage_' + CONFIG.STAGES[CONFIG.stageIndex(lv)].id) : T('type_new')}${cur ? ' · ' + T('now_playing') : ''}</small></b><span>${esc(TN(I.d))}</span><em>${abilChips(k)}</em>${statsGrid(k, Math.max(1, lv))}</div>`;
  };
  openPanel('change', `<h2>🔄 ${T('change_dino')}</h2><p class="sub">${T('change_dino_d')}</p>${CONFIG.TYPES[world].map(card).join('')}<button id="pn-x" style="margin-top:12px">${T('resume')}</button>`, root => {
    btnClick(root, '.cls', b => { if (b.dataset.k === pr.cls) { panelClose(); return; } closePanelState(); $('panel').classList.remove('on'); ctl.switchType(b.dataset.k); });
    $('pn-x').onclick = panelClose;
  });
}
// ---------------------------------------------------------------- «О динозавре»: характеристики сейчас, способности и описания
function openAbout() {
  if (!inGame()) return;
  const render = () => {
    const S = ctl.session; if (!S || !S.profile) return;
    const pr = S.profile, st = Sim.statsFor(pr.cls, pr.level, pr.evo), I = CONFIG.CLS_INFO[pr.cls], mp = S.mp || {};
    const si = CONFIG.stageIndex(pr.level), nextSt = CONFIG.STAGES[si + 1];
    const need = pr.level >= CONFIG.MAX_LEVEL ? 0 : CONFIG.xpForLevel(pr.level), fx = st.fx || {}, aq = CONFIG.isAqua(pr.cls);
    const n1 = v => (Math.round(v * 10) / 10).toString(), pc = v => Math.round(v * 100) + '%';
    const row = (k, v) => `<div class="sr"><span>${k}</span><b>${v}</b></div>`;
    const rows = [
      row(T('st_hp'), `${Math.ceil(mp.hp != null ? mp.hp : st.hp)} / ${st.hp}`),
      row(T('st_dmg'), n1(st.dmg)),
      row(T('st_atkspd'), n1(1 / st.atkCd) + ' ' + T('per_s')),
      row(T('st_reach'), n1(st.reach) + ' ' + T('m')),
      row(aq ? T('st_spd_land') : T('st_walk'), n1(st.speed / 30) + ' ' + T('ms')),
      pr.cls === 'fly' || aq ? '' : row(T('st_runspd'), n1(st.speed * st.sprintMult / 30) + ' ' + T('ms')),
      aq ? row(T('st_spd_water'), n1(st.swimSpd / 30) + ' ' + T('ms')) : st.flySpd && pr.cls === 'fly' ? row(T('st_spd_fly'), n1(st.flySpd / 30) + ' ' + T('ms')) : '',
      row(T('st_size'), '×' + n1(st.scale / 0.5) + ' · ' + n1(st.scale * 4.2) + ' ' + T('m')),
      row(T('st_armor'), pc(st.armor)),
      row(T('st_dodge'), Math.round(fx.dodge || 0) + '%'),
      row(T('st_regen'), n1(st.regen) + ' ' + T('hp_s')),
      row(T('st_stam'), `${CONFIG.STAM_MAX} · ${T('st_regen_x')} ×${n1(st.stamRegen)}`),
      aq ? row(T('st_breath'), Math.round(st.breathMax) + ' ' + T('sec')) : '',
      row(T('st_diet'), CONFIG.CLASSES[pr.cls].diet.map(d => TN(CONFIG.DIET_N[d])).join(', '))
    ].join('');
    // выбранные ветки эволюции
    const perks = Object.keys(pr.evo || {}).filter(id => pr.evo[id] > 0).map(id => { const e = CONFIG.evoNode(id); return e ? `<span class="pk">${e.node.ico} ${esc(TN(e.node.n))} <small>${pr.evo[id]}/${CONFIG.EVO_MAX}</small></span>` : ''; }).join('');
    const html = `<h2>${CLS_ICO[pr.cls]} ${esc(pr.name)} <small style="color:var(--mut);font-weight:400">${esc(TN(I.n))}</small></h2>
      <div class="sr big"><span>${T('level_short')}${pr.level} · ${T('stage_' + CONFIG.STAGES[si].id)}</span><b>${need ? 'XP ' + Math.max(0, Math.floor(mp.xp != null ? mp.xp : pr.xp)) + ' / ' + need : 'MAX'}</b></div>
      <p class="sub">${nextSt ? T('grow_next', { l: nextSt.from, s: T('stage_' + nextSt.id) }) : T('grow_max')}</p>
      <div class="stats">${rows}</div>
      <h3>${T('abilities')}</h3>${abilList(pr.cls)}
      <h3>${T('perks')}</h3><div class="perks">${perks || `<span class="sub">${T('perks_none')}</span>`}</div>
      <div class="row" style="margin-top:12px"><button id="ab-evo">${T('evolution')}</button><button class="pri" id="pn-x">${T('resume')}</button></div>`;
    openPanel('about', html, root => { $('pn-x').onclick = panelClose; $('ab-evo').onclick = () => openEvo(); });
    openRender = render;
  };
  render();
}
function openPlayers() {
  if (!inGame()) return;
  const render = () => {
    const S = ctl.session; if (!S) return;
    const mode = S.room.mode, canDuel = S.o.online && (mode === 'public' || mode === 'code') && S.biome !== 'duel' && S.alive;
    const rows = [...S.players.entries()].map(([id, p]) => {
      const i = p.info; return `<tr><td>${CLS_ICO[i.cls] || ''} ${esc(i.nick)}${i.king ? ' 👑' : ''}${i.lord ? ' 🌟' : ''}${i.admin ? '<span class="badge">ADMIN</span>' : ''}${i.bot ? ' 🤖' : ''}</td><td>${T('level_short')}${i.level}</td><td style="text-align:right">${!i.bot && canDuel ? `<button class="sm" data-duel="${id}">⚔ ${T('duel')}</button>` : ''}</td></tr>`;
    });
    const tq = S.tq > 0;
    const html = `<h2>${T('players')}</h2>${rows.length ? `<table>${rows.join('')}</table>` : `<p class="sub">${T('no_players')}</p>`}
      ${S.o.online && canDuel ? `<h3>${T('tourney')}</h3><button id="pl-t">${tq ? T('tourney_cancel') : T('tourney_join')}</button>` : ''}
      <div class="row">${[0, 1, 2, 3].map(i => `<button data-em="${i}" style="font-size:22px">${['👋', '😄', '😡', '❤'][i]}</button>`).join('')}</div>
      <button class="pri" id="pn-x" style="margin-top:12px">${T('resume')}</button>`;
    openPanel('players', html, root => {
      btnClick(root, '[data-duel]', b => { ctl.send({ t: 'duel', to: +b.dataset.duel }); UI.toast(T('duel_wait')); panelClose(); });
      btnClick(root, '[data-em]', b => ctl.send({ t: 'act', a: 'em', i: +b.dataset.em }));
      if ($('pl-t')) $('pl-t').onclick = () => { ctl.send(tq ? { t: 'tourney_cancel' } : { t: 'tourney' }); panelClose(); };
      $('pn-x').onclick = panelClose;
    });
    openRender = render;
  };
  render();
}
let dreqFrom = 0, dreqT = 0;
function duelRequest(from, nick) {
  dreqFrom = from; $('dreq-t').textContent = T('duel_req', { x: nick }); $('dreq-y').textContent = T('accept'); $('dreq-n').textContent = T('decline'); $('dreq').classList.add('on');
  clearTimeout(dreqT); dreqT = setTimeout(() => { if (dreqFrom === from) { $('dreq').classList.remove('on'); dreqFrom = 0; } }, 15000);
}

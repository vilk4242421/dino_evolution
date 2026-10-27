/* Интерфейс вне игрового мира: меню, вход, создание динозавра, эволюция и магазин, достижения, рейтинг, настройки, пауза, список игроков и дуэли. */
import * as P from './profile.js';
import { CLS_IMG } from './clsicons.js';
const CONFIG = window.CONFIG, Sim = window.Sim, T = window.T, TN = window.TN;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ctl = null, openName = null, openRender = null, toastT = 0, bannerT = 0;
{ const vl = document.getElementById('verlbl'); if (vl) vl.textContent = 'v' + CONFIG.VERSION; }
const cIco = (k, big) => CLS_IMG[k] ? `<img class="cimg${big ? ' big' : ''}" src="${CLS_IMG[k]}" alt="">` : CONFIG.CLS_INFO[k].ico;      // иконка класса: картинка, а при её отсутствии — эмодзи
const CLS_ICO = Object.fromEntries(Object.keys(CONFIG.CLS_INFO).map(k => [k, CONFIG.CLS_INFO[k].ico]));
const BIOME_ICO = { forest: '🌲', snow: '❄️', mountain: '⛰️', desert: '🏜️', swamp: '🐊', volcano: '🌋', reef: '🐠', kelp: '🌿', arctic: '🧊', vents: '♨️', abyss: '🦑' };
const AUTH_ERR = {
  bad_nick: { ru: 'Ник: 3–15 символов (буквы, цифры, _ и -)', en: 'Nickname: 3–15 chars (letters, digits, _ and -)' }, bad_password: { ru: 'Пароль: от 6 символов', en: 'Password: 6+ characters' },
  bad_name: { ru: 'Имя динозавра: 3–15 символов', en: 'Dino name: 3–15 characters' }, nick_taken: { ru: 'Этот ник уже занят', en: 'Nickname already taken' }, bad_credentials: { ru: 'Неверный ник или пароль', en: 'Wrong nickname or password' },
  rate_limited: { ru: 'Слишком много попыток, подождите минуту', en: 'Too many attempts, wait a minute' }, server_error: { ru: 'Ошибка сервера', en: 'Server error' },
  in_game: { ru: 'Сначала выйдите из игры', en: 'Leave the game first' }, class_locked: { ru: 'Класс нельзя менять', en: 'Class is locked' }, type_locked: { ru: 'Этот вид откроется на 7 уровне любого типа', en: 'This type unlocks at level 7 of any type' }
};
const errText = e => { const m = AUTH_ERR[e && e.message]; return m ? m[window.I18N.lang] : (e && e.name === 'TypeError' ? T('server_off') : (e && e.message) || T('server_off')); };
const inGame = () => !!(ctl.session && ctl.session.welcomed);
const screens = ['menu', 'auth', 'create', 'panel'];

function show(id) { for (const s of screens) $(s).classList.toggle('on', s === id); }
function closeAll() { for (const s of screens) $(s).classList.remove('on'); closePanelState(); }
let pauseChain = false;      // окна, открытые из меню паузы, держат игру замороженной; окна по горячим клавишам — нет
function closePanelState() { pauseChain = false; openName = null; openRender = null; if (ctl && inGame()) ctl.setPanelOpen(false); }
function openPanel(name, html, after) {
  const was = openName; openName = name; $('panel-card').innerHTML = '<button class="pclose" id="pclose" aria-label="close">✕</button>' + html; show('panel');
  const frz = name === 'pause' || pauseChain; if (name === 'pause') pauseChain = true;
  $('pclose').onclick = () => { ctl.audio.sfx('click'); panelClose(); };
  $('panel-card').scrollTop = 0; if (inGame()) ctl.setPanelOpen(true, frz);
  after && after($('panel-card')); return was;
}
(function () { const p = document.getElementById('panel'); let down = false; if (!p) return; p.addEventListener('pointerdown', e => { down = e.target === p; }); p.addEventListener('click', e => { if (down && e.target === p) { down = false; panelClose(); } }); })();      // клик по пустому месту вокруг окна закрывает его
function panelClose() { $('panel').classList.remove('on'); closePanelState(); if (!inGame()) showMenu(); else ctl.relock(); }
function btnClick(root, sel, fn) { root.querySelectorAll(sel).forEach(b => b.addEventListener('click', e => { ctl.audio.init(); ctl.audio.sfx('click'); fn(b, e); })); }

function questText(q) { const d = CONFIG.QUESTS[q.id]; return TN(d.t).replace('{n}', d.mins ? Math.round(q.n / 60) : q.n); }
// окно «Задания»: серия входов и 3 задания дня
function openQuests() {
  const live = inGame(), real = live ? ctl.session.profile : activeProf();
  if (!real || !real.hatched) { UI.toast(T('quest_need_dino')); return; }
  const pr = JSON.parse(JSON.stringify(real)); Sim.dailyRoll(pr, Date.now());      // показываем уже с учётом новой даты
  const d = pr.daily, doneN = d.q.filter(x => x.done).length;
  const rows = d.q.map(x => { const def = CONFIG.QUESTS[x.id], pct = Math.round(100 * x.h / x.n), cur = def.mins ? Math.floor(x.h / 60) : x.h, need = def.mins ? Math.round(x.n / 60) : x.n;
    return `<div class="a ${x.done ? 'on' : ''}"><i>${def.ico}</i><div style="flex:1"><b>${esc(questText(x))}</b><span>${cur}/${need} · +${def.coins} 🪙${x.done ? ' ✅' : ''}</span><div class="qbar"><i style="width:${pct}%"></i></div></div></div>`; }).join('');
  const left = 7 - (d.streak % 7 || 7);
  openPanel('quests', `<h2>📅 ${T('quests')} <small style="color:var(--mut)">${doneN}/${d.q.length}</small></h2>
    <p class="sub">🔥 ${T('streak_n', { n: d.streak })} · ${T('streak_best', { n: d.best })}<br>${left ? T('streak_gift', { n: left }) : T('streak_gift_today')}</p>
    <div class="ach qlist">${rows}</div>
    <p class="sub">${T('quest_bonus', { c: CONFIG.QUEST_BONUS })}${d.bonus ? ' ✅' : ''}</p>
    <p class="sub">${T('quest_new_day')}</p>
    <button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => { $('pn-x').onclick = panelClose; });
}

export const UI = {
  questText,
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
  showLoading(on, o) {      // окно загрузки: o = { sea, ico, msg, det }; det — полоска с процентами (загрузка мира); закрытие — без параметров
    const el = $('loading'); el.style.display = on ? 'flex' : 'none';
    if (on) {
      $('loaderr').textContent = ''; o = o || {}; el.classList.toggle('sea', !!o.sea); $('loadico').textContent = o.ico || '🦖'; $('loadmsg').textContent = o.msg || T('loading'); $('loadhint').textContent = o.hint || '';
      const bar = $('loadbar'), f = $('loadfill'); bar.classList.toggle('det', !!o.det); f.style.transition = 'none'; f.style.transform = ''; $('loadpct').textContent = o.det ? '0%' : '';
    }
  },
  // процент: полоска плавно едет сама за ms миллисекунд (transform идёт в потоке композитора и не замирает, пока страница занята построением мира)
  loadProgress(p, ms, msg) {
    const f = $('loadfill'); if (!f || !$('loadbar').classList.contains('det')) return;
    f.style.transition = 'transform ' + (ms || 200) + 'ms linear'; f.getBoundingClientRect(); f.style.transform = 'scaleX(' + Math.max(0.02, Math.min(1, p / 100)) + ')';
    if (!ms || ms <= 400) $('loadpct').textContent = Math.round(p) + '%';      // во время долгого этапа процент не меняем (поток занят), бегущая полоска едет сама
    if (msg) $('loadmsg').textContent = msg;
  },
  loadMsg(msg) { const m = $('loadmsg'); if (m && msg) m.textContent = msg; },
  toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms || 2600); },
  banner(msg, ms) { const b = $('banner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), ms || 2200); },
  note(msg) { const n = document.createElement('div'); n.textContent = msg; $('notes').appendChild(n); setTimeout(() => n.remove(), 4600); while ($('notes').children.length > 5) $('notes').firstChild.remove(); },
  closeAll, showMenu, openAbout, openChange, openEvo, openShop, openAch, openLeaders, openSettings, openPause, openPlayers, duelRequest,
  refreshOpen() { if (openName && openRender) openRender(); }
};

// ---------------------------------------------------------------- главное меню
function activeProf() { return P.state.token && P.state.profile && P.state.profile.hatched ? P.state.profile : P.state.local; }
const ADM = '<span class="adm">Admin<i class="sp s1"></i><i class="sp s2"></i><i class="sp s3"></i><i class="sp s4"></i></span>';
export function showMenu() {
  closePanelState(); $('hud').classList.remove('on');
  const st = P.state, prof = activeProf();
  const acc = st.user ? `<b>${esc(st.user)}</b>${st.admin ? ADM : ''}` : `<b>${T('guest')}</b>`;
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
    </div>
    <div class="grid2"><button data-go="quests">📅 ${T('quests')}</button><button data-go="nest">🪺 ${T('nest')}</button></div>
    <div class="grid2"><button data-go="duel">🥊 ${T('duel_menu')}</button><button data-go="shop">🏪 ${T('shop')}</button></div>
    <button data-go="wardrobe" class="pri2">🚪 ${T('wardrobe')}</button>`;
  const root = $('menu-card');
  $('m-acc').onclick = async () => { ctl.audio.init(); if (st.user) { await P.logout(); showMenu(); } else openAuth(() => showMenu()); };
  btnClick(root, '[data-go]', b => {
    const g = b.dataset.go;
    if (g === 'online' || g === 'code' || g === 'single') goPlay(g);
    else if (g === 'leaders') openLeaders(); else if (g === 'quests') openQuests(); else if (g === 'evo') openEvo(); else if (g === 'ach') openAch(); else if (g === 'nest') openNest(); else if (g === 'duel') openDuelMenu(); else if (g === 'wardrobe') openWardrobe(); else if (g === 'shop') openShop(); else openSettings();
  });
  show('menu');
  if (prof && prof.hatched) ctl.menuSetDino({ cls: prof.cls, color: CONFIG.COLORS[prof.color], level: prof.level, evo: prof.evo, cosmetic: prof.cosmetic, patc: prof.patc, morph: prof.morph }); else ctl.menuShowEgg(0x6aa84f);
  ctl.audio.setScene('menu');
}

function goPlay(kind) {
  const solo = kind === 'single', acct = !!(P.state.token && P.state.serverUp && P.state.online);
  const online = !solo || acct;      // с аккаунтом «Одиночная» идёт в личной комнате на сервере: прогресс общий на всех устройствах
  if (online && !P.state.serverUp) { UI.toast(T('server_off')); return; }
  if (online && !P.state.token) { openAuth(() => goPlay(kind)); return; }
  const prof = online ? P.state.profile : P.state.local;
  if (!prof || !prof.hatched) { openCreate(online, () => goPlay(kind), false); return; }
  // только что вылупившийся: сразу в первый биом, без экрана выбора
  if (ctl.pendingHatch && kind !== 'code') { ctl.start({ online, biome: Sim.homeBiome(prof), mode: online && !solo ? 'public' : 'solo' }); return; }   // морской вылупляется в океане
  if (ctl.pendingHatch) ctl.fade(false, 600);
  openPlayPanel(online, kind === 'code', solo);
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
function openPlayPanel(online, codeFocus, soloMode) {
  const prof = online ? P.state.profile : P.state.local;
  // 1) игрок сам выбирает режим (суша / океан), 2) тип в этом режиме (у каждого типа свой уровень и эволюция), 3) локацию
  let world = CONFIG.worldOf(prof.biome), cls = prof.cls;
  const bestType = w => { let b = null, bl = 0; for (const t of CONFIG.TYPES[w]) { const l = Sim.typeLevel(prof, t); if (l > bl) { bl = l; b = t; } } return b || CONFIG.TYPES[w][0]; };
  if (CONFIG.clsWorld(cls) !== world) cls = bestType(world);
  const landOk = Sim.landDone(prof), vp = () => Object.assign({}, prof, { kings: CONFIG.typeKings(prof, cls), landDone: landOk });      // у каждого типа динозавра своё прохождение
  const firstOpen = (w) => { const l = CONFIG.worldList(w); let b = l[0]; for (const x of l) if (Sim.canEnterBiome(vp(), x)) b = x; return b; };
  let roomCode = randCode();   // при открытии меню в поле сразу подставлен случайный код новой комнаты
  let sel = CONFIG.worldList(world).indexOf(prof.biome) >= 0 && Sim.canEnterBiome(vp(), prof.biome) ? prof.biome : firstOpen(world);
  const worldBtn = (w) => {
    const pct = CONFIG.worldProgress(prof, w), n = CONFIG.worldKings(prof, w), all = CONFIG.worldList(w).length, sp = CONFIG.worldSpecies(w).length, seen = CONFIG.worldSeen(prof, w);
    if (w === 'sea' && !landOk) return `<button class="wt lock" data-w="sea" data-lock="1" style="opacity:.55;cursor:not-allowed"><span class="wn">🔒 ${T('world_sea')}</span><span class="wp" style="font-size:15px;color:#ffb25a">${T('sea_locked_short')}</span><small>${T('sea_locked')}</small></button>`;
    return `<button class="wt ${w === world ? 'on' : ''}" data-w="${w}"><span class="wn">${w === 'sea' ? '🌊 ' + T('world_sea') : '🌍 ' + T('world_land')}</span>
      <span class="wp">${pct}%</span><span class="wbar"><i style="width:${pct}%"></i></span>
      <small>${T('world_stat', { a: n, b: all, c: seen, d: sp })}</small></button>`;
  };
  const typeCard = (k) => {
    const I = CONFIG.CLS_INFO[k], lv = Sim.typeLevel(prof, k), st = lv ? T('level_short') + lv + ' · ' + T('stage_' + CONFIG.STAGES[CONFIG.stageIndex(lv)].id) : T('type_new');
    const lockN = CONFIG.TYPE_MIN_LV[k] && !Sim.typeUnlocked(prof, k) ? CONFIG.TYPE_MIN_LV[k] : 0;
    if (lockN) return `<div class="tp lock" data-lock="${lockN}" style="opacity:.45"><i>🔒</i><b>${esc(TN(I.n))}</b><small>${T('type_lock_n', { n: lockN })}</small></div>`;
    return `<div class="tp ${k === cls ? 'sel' : ''}" data-k="${k}"><i>${cIco(k, true)}</i><b>${esc(TN(I.n))}</b><small>${st}</small></div>`;
  };
  const render = () => {
    const grid = CONFIG.worldList(world).map(b => {
      const ok = Sim.canEnterBiome(vp(), b), king = CONFIG.typeKings(prof, cls).indexOf(b) >= 0;
      return `<div class="bm ${ok ? '' : 'lock'} ${b === sel ? 'sel' : ''}" data-b="${b}"><i>${ok ? BIOME_ICO[b] : '🔒'}</i>${esc(TN(CONFIG.BIOME[b].n))}<small>${king ? '👑 ' + T('king_mark') : T('req_boss', { n: CONFIG.BOSS_LEVEL[b] })}</small></div>`;
    }).join('');
    const I = CONFIG.CLS_INFO[cls], lv = Sim.typeLevel(prof, cls);
    return `<h2>${T('play_title')}</h2><div class="worlds">${worldBtn('land')}${worldBtn('sea')}</div>
      <h3>${T('type_title')}</h3><div class="types">${CONFIG.TYPES[world].map(typeCard).join('')}</div>
      <div class="tdesc"><p>${esc(TN(I.d))}</p>${statsGrid(cls, Math.max(1, lv))}${world === 'sea' ? `<p class="sub">${T('sea_land_note')}</p>` : ''}${abilList(cls)}${lv ? '' : `<p class="sub">${T('type_new_d')}</p>`}</div>
      <h3>${T('tab_biomes')}</h3><p class="sub">${T('unlock_next')}</p><div class="biomes">${grid}</div>
      ${world === 'sea' && !landOk ? `<p class="sub" style="color:#ffb25a;font-weight:700">🔒 ${T('sea_locked')}</p><button id="pp-back">${T('back')}</button>` : ''}
      ${world === 'sea' && !landOk ? '<div style="display:none">' : ''}
      ${online && !soloMode ? `<button class="pri" id="pp-pub">${T('public_room')}</button>
      <label>${T('code_room')}</label><div class="row"><input id="pp-code" inputmode="text" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${roomCode}" placeholder="${T('code_ph')}" style="margin:0;text-transform:uppercase;letter-spacing:3px;font-weight:800"><button id="pp-dice" title="${T('new_room')}">🎲</button><button id="pp-join">${T('join_code')}</button></div>`
      : `<button class="pri" id="pp-solo">${T('single')}</button>`}
      ${Sim.isLord(prof) && !CONFIG.isAqua(cls) ? `<button id="pp-rush">🔥 ${T('boss_rush')}</button>` : ''}
      <div class="err" id="pp-err"></div>${world === 'sea' && !landOk ? '</div>' : `<button id="pp-back">${T('back')}</button>`}`;
  };
  const bind = (root) => {
    btnClick(root, '.bm', b => { if (!b.classList.contains('lock')) { sel = b.dataset.b; draw(); } });
    btnClick(root, '.tp', b => { if (b.dataset.lock) { UI.toast(T('type_lock_n', { n: b.dataset.lock })); return; } cls = b.dataset.k; if (!Sim.canEnterBiome(vp(), sel)) sel = firstOpen(world); ctl.menuSetDino({ cls, color: CONFIG.COLORS[prof.color], level: Math.max(1, Sim.typeLevel(prof, cls)), evo: cls === prof.cls ? prof.evo : {}, cosmetic: prof.cosmetic, patc: prof.patc, morph: prof.morph }); draw(); });
    btnClick(root, '.wt', b => { if (b.dataset.lock) { UI.toast(T('sea_locked_short')); return; } const w = b.dataset.w; if (w !== world) { world = w; sel = firstOpen(w); cls = bestType(w); draw(); } });
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
  ctl.menuSetDino({ cls, color: CONFIG.COLORS[prof.color], level: Math.max(1, Sim.typeLevel(prof, cls)), evo: cls === prof.cls ? prof.evo : {}, cosmetic: prof.cosmetic, patc: prof.patc, morph: prof.morph });
}

// ---------------------------------------------------------------- создание динозавра и вылупление
let createState = null;
// значки способностей типа: Атака · E · Q · F
function abilChips(k) {
  const A = CONFIG.ABILITIES[k], AI = CONFIG.ABIL_INFO, f = k === 'fly' ? 'fly' : k === 'herb' ? 'climb' : '';
  return [['atk', 'LMB'], [A.e.id, 'E'], [A.q.id, 'Q'], f ? [f, 'F'] : null, CONFIG.ULTS[k] ? [CONFIG.ULTS[k].id, 'X'] : null].filter(Boolean).map(([id, key]) => `<u>${key === 'LMB' ? CONFIG.CLS_INFO[k].atkIco : AI[id].ico} ${esc(TN(id === 'atk' ? CONFIG.CLS_INFO[k].atkN : AI[id].n))}</u>`).join('');
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
    + (f ? row('F', AI[f].ico, TN(AI[f].n), cdf(f, 0)) : '') + (CONFIG.ULTS[k] ? row('X', AI[CONFIG.ULTS[k].id].ico, TN(AI[CONFIG.ULTS[k].id].n), cdf(CONFIG.ULTS[k].id, 0)) : '') + '</ul>';
}
const IS_TOUCH_UI = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
function openCreate(online, done, newRun) {
  const prof = online ? P.state.profile : P.state.local;
  createState = { color: Math.max(0, prof.color || 0), cls: prof.cls || 'carn', name: prof.name || P.state.user || '' };
  $('c-name').value = createState.name; $('c-err').textContent = '';
  $('c-colors').innerHTML = CONFIG.COLORS.map((c, i) => `<div class="sw ${i === createState.color ? 'sel' : ''}" data-c="${i}" style="background:#${c.toString(16).padStart(6, '0')}"></div>`).join('');
  const clsCard = k => { const I = CONFIG.CLS_INFO[k], A = CONFIG.ABILITIES[k];
    const seaLk = CONFIG.clsWorld(k) === 'sea' && !Sim.landDone(prof), lk = !!CONFIG.TYPE_MIN_LV[k] || seaLk;
    return `<div class="cls ${lk ? 'lock' : ''} ${k === createState.cls ? 'sel' : ''}" data-k="${k}" ${lk ? 'style="opacity:.45"' : ''}><b>${lk ? '🔒 ' : ''}${cIco(k)} ${esc(TN(I.n))}${lk ? ' <small>' + (seaLk ? T('sea_locked_short') : T('type_lock_n', { n: CONFIG.TYPE_MIN_LV[k] })) + '</small>' : ''}</b><span>${esc(TN(I.d))}</span><em>${abilChips(k)}</em>${statsGrid(k, 1)}</div>`; };
  $('c-classes').innerHTML = ['land', 'sea'].map(w => `<div class="wh">${w === 'sea' ? '🌊 ' + T('world_sea') : '🌍 ' + T('world_land')}</div>` + CONFIG.TYPES[w].map(clsCard).join('')).join('');
  const preview = () => ctl.menuSetDino({ cls: createState.cls, color: CONFIG.COLORS[createState.color], level: 1, evo: {} });
  btnClick($('c-colors'), '.sw', b => { createState.color = +b.dataset.c; $('c-colors').querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x === b)); preview(); });
  btnClick($('c-classes'), '.cls', b => { if (CONFIG.clsWorld(b.dataset.k) === 'sea' && !Sim.landDone(prof)) { UI.toast(T('sea_locked_short')); return; } if (CONFIG.TYPE_MIN_LV[b.dataset.k]) { UI.toast(T('type_lock_n', { n: CONFIG.TYPE_MIN_LV[b.dataset.k] })); return; } createState.cls = b.dataset.k; $('c-classes').querySelectorAll('.cls').forEach(x => x.classList.toggle('sel', x === b)); preview(); });
  $('c-back').onclick = () => showMenu();
  $('c-go').onclick = async () => {
    const name = $('c-name').value.replace(/[<>]/g, '').trim();
    if (name.length < CONFIG.NAME_MIN) { $('c-err').textContent = T('dino_name'); return; }
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
  UI.applyLang(); show('create'); ctl.menuShowEgg(CONFIG.COLORS[createState.color], (activeProf() || {}).eggskin);
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
    const live = inGame(), prof = live ? ctl.session.profile : activeProf(), offEdit = !live && prof === P.state.local;      // офлайн-профиль можно прокачивать и из меню
    if (!prof || !prof.hatched) { openPanel('evo', `<h2>${T('evolution')}</h2><p class="sub">${T('no_character')}</p><button id="pn-x">${T('back')}</button>`, r => { $('pn-x').onclick = panelClose; }); return; }
    const pts = CONFIG.evoPoints(prof.level, prof.evo), head = `<div class="row" style="margin-bottom:8px"><h2 style="margin:0;flex:2">${CLS_ICO[prof.cls]} ${esc(prof.name)} · ${T('level_short')}${prof.level}</h2><div class="pts" style="text-align:right">${T('evo_points', { n: pts })} · 🪙 ${prof.coins}</div></div>`;
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
        if (can === 'ok') btn = `<button class="pri" data-buy="${evoSel}" ${live || offEdit ? '' : 'disabled'}>${T('evo_up', { r: r + 1, m: CONFIG.EVO_MAX })}</button>`;
        else if (can === 'taken') btn = `<button class="pri" data-sw="${evoSel}" ${live || offEdit ? '' : 'disabled'}>${T('evo_switch', { n: TN(sibN.node.n) })}</button>`;
        else btn = `<button disabled>${can === 'max' ? T('evo_max') : can === 'level' ? T('evo_need_lv', { l: CONFIG.EVO_TIER_LV[sn.path.length - 1] }) : can === 'parent' ? T('evo_need_parent') : can === 'points' ? T('evo_points_err') : T('evo_locked')}</button>`;
        card = `<div class="ecard"><h4>${sn.node.ico} ${esc(TN(sn.node.n))} <small>${T('evo_rank', { r, m: CONFIG.EVO_MAX })}</small></h4><ul>${fxl}</ul>
          <p class="sub">${r ? T('evo_now') : T('evo_per_rank')} · ${T('evo_vs', { n: TN(sibN.node.n) })}</p>${btn}</div>`;
      }
      body = `<div class="ttabs">${tabs2}</div><div class="etree"><svg viewBox="0 0 ${Wd} 330" preserveAspectRatio="none">${lines}</svg>${nodes}</div>${card}
        <div class="row" style="margin-top:10px"><button data-reset="1" class="red" ${(live || offEdit) && CONFIG.evoSpent(prof.evo) > 0 ? '' : 'disabled'}>${T('evo_reset_free')}</button></div>${live ? '' : `<p class="sub">${T('offline_progress')}</p>`}`;
    }
    openPanel('evo', head + body + `<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
      const offDo = (fn) => { if (!fn(prof)) return; P.saveLocal(); render(); };
      btnClick(root, '[data-buy]', b => { if (offEdit) offDo(pr => { const id = b.dataset.buy; if (CONFIG.evoCanBuy(pr.cls, pr.level, pr.evo, id) !== 'ok') return false; pr.evo = pr.evo || {}; pr.evo[id] = (pr.evo[id] | 0) + 1; return true; }); else ctl.send({ t: 'evo', id: b.dataset.buy }); });
      btnClick(root, '[data-sw]', b => { if (offEdit) offDo(pr => { const o = CONFIG.evoSwitch(pr.cls, pr.level, pr.evo || {}, b.dataset.sw); if (!o) return false; pr.evo = o; return true; }); else ctl.send({ t: 'evosw', id: b.dataset.sw }); });
      btnClick(root, '[data-tree]', b => { evoTree = b.dataset.tree; evoSel = ''; render(); });
      btnClick(root, '[data-node]', b => { evoSel = b.dataset.node; render(); });
      btnClick(root, '[data-reset]', () => { if (offEdit) offDo(pr => { pr.evo = {}; return true; }); else ctl.send({ t: 'evoreset' }); });
      $('pn-x').onclick = panelClose;
    });
    openRender = render;
  };
  render(); openRender = render;
}

// ---------------------------------------------------------------- достижения и рейтинг
function openAch() {
  const live = inGame(), prof = live ? ctl.session.profile : activeProf(), had = prof && prof.hatched;
  const claimed = (prof && prof.claimed) || [], titles = (prof && prof.titles) || [];
  let ready = 0;
  const list = CONFIG.ACH.map(a => {
    const ok = had ? !!a.t(prof) : false, r = CONFIG.ACH_REWARD[a.id] || {}, got = claimed.indexOf(a.id) >= 0;
    const rw = [r.c ? '🪙 ' + r.c : '', r.title ? CONFIG.TITLES[r.title].ico + ' ' + TN(CONFIG.TITLES[r.title].n) : '', r.cos && CONFIG.COSMETICS[r.cos] ? '🎁 ' + TN(CONFIG.COSMETICS[r.cos].n) : ''].filter(Boolean).join(' · ');
    let btn = '';
    if (ok && !got) { ready++; btn = live ? `<button data-claim="${a.id}" class="claim">${T('claim')}</button>` : `<em>${T('claim_in_game')}</em>`; } else if (got) btn = `<em>✔ ${T('claimed')}</em>`;
    return `<div class="a ${ok ? 'on' : ''}"><i>${a.ico}</i><div><b>${esc(TN(a.n))}</b><span>${esc(TN(a.d))}</span><span class="rw">${esc(rw)}</span>${btn}</div></div>`;
  });
  const n = CONFIG.ACH.filter(a => had && a.t(prof)).length;
  const curT = prof && prof.title;
  const tit = `<h3>${T('titles')}</h3><div class="titles"><button data-title="" class="${curT ? '' : 'sel'}">${T('no_title')}</button>` + titles.map(id => `<button data-title="${id}" class="${curT === id ? 'sel' : ''}" ${live ? '' : 'disabled'}>${CONFIG.TITLES[id].ico} ${esc(TN(CONFIG.TITLES[id].n))}</button>`).join('') + '</div>';
  openPanel('ach', `<h2>🏆 ${T('ach_title')} <small style="color:var(--mut)">${n}/${CONFIG.ACH.length}</small></h2>${tit}${ready && live ? `<button id="ach-all" class="claim">${T('claim_all')} (${ready})</button>` : ''}<div class="ach">${list.join('')}</div><button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
    const again = () => setTimeout(openAch, 450);
    btnClick(root, '[data-claim]', b => { ctl.send({ t: 'claim', id: b.dataset.claim }); again(); });
    btnClick(root, '[data-title]', b => { ctl.send({ t: 'settitle', id: b.dataset.title }); again(); });
    const all = root.querySelector('#ach-all'); if (all) all.onclick = () => { root.querySelectorAll('[data-claim]').forEach(b => ctl.send({ t: 'claim', id: b.dataset.claim })); again(); };
    $('pn-x').onclick = panelClose;
  });
}

// ---------------------------------------------------------------- магазин (отдельное окно; в главном меню и в игре)
let shopTab = 'color', shopOnline = null;
function openShop(tab) {
  if (tab) shopTab = tab;
  const live = inGame(), hasOnline = !!(P.state.token && P.state.profile && P.state.profile.hatched), hasLocal = !!(P.state.local && P.state.local.hatched);
  if (!live && shopOnline === null) shopOnline = hasOnline;
  if (!live && shopOnline && !hasOnline) shopOnline = false;
  const prof = live ? ctl.session.profile : (shopOnline ? P.state.profile : P.state.local);
  if (!prof || !prof.hatched) { openPanel('shop', `<h2>🏪 ${T('shop')}</h2><p class="sub">${T('no_character')}</p><button id="pn-x">${T('back')}</button>`, () => { $('pn-x').onclick = panelClose; }); return; }
  const mats = prof.mats || { bone: 0, hide: 0 };
  const act = async (op, a) => {
    try {
      if (live) { ctl.send(Object.assign({ t: op }, a)); setTimeout(() => openShop(), 450); }
      else { const r = await P.shopMenu(shopOnline, op, a); if (!r.ok) UI.toast(T(r.err === 'coins' ? 'err_coins' : 'err_mats')); if (!live) { const pf = shopOnline ? P.state.profile : P.state.local; ctl.menuSetDino && pf && ctl.menuSetDino({ cls: pf.cls, color: CONFIG.COLORS[pf.color], level: pf.level, evo: pf.evo, cosmetic: pf.cosmetic, patc: pf.patc, morph: pf.morph }); openShop(); } }
    } catch (e) { UI.toast(T('server_off')); }
  };
  const priceBtn = (id, c, extra) => {
    const own = prof.cosmetics.indexOf(id) >= 0, slot = CONFIG.cosSlot(id), f = CONFIG.SLOT_FIELD[slot], eq = prof[f] === id;
    if (own) return `<button data-eq="${eq ? '' : id}" data-slot="${slot}">${eq ? T('unequip') : T('equip')}</button>`;
    if (c.craft) { const okc = mats.bone >= (c.craft.bone | 0) && mats.hide >= (c.craft.hide | 0); return `<button data-craft="${id}" ${okc ? '' : 'disabled'}>🛠 ${T('craft')} · 🦴${c.craft.bone | 0} 🟫${c.craft.hide | 0}</button>`; }
    return `<button data-buy="${id}" ${prof.coins >= c.price ? '' : 'disabled'}>${T('buy')} · 🪙 ${c.price}</button>`;
  };
  const hx6 = n => '#' + n.toString(16).padStart(6, '0');
  const cosCard = id => {
    const c = CONFIG.COSMETICS[id], own = prof.cosmetics.indexOf(id) >= 0; let pre = '';
    if (c.m) { const base = c.m.c1 != null ? c.m.c1 : CONFIG.COLORS[prof.color]; pre = `<div class="mo"><i style="background:${hx6(base)}"></i><i style="background:${hx6(c.m.c2)}"></i>${c.m.c3 != null ? `<i style="background:${hx6(c.m.c3)}"></i>` : ''}<b>${c.m.c3 != null ? '3' : '2'}</b></div>`; }
    else if (CONFIG.cosSlot(id) === 'egg') pre = `<img class="eggp" src="${ctl.eggThumb(id.slice(2), CONFIG.COLORS[prof.color])}">`;
    else if (c.c != null) pre = `<i class="sw" style="background:${hx6(c.c)}"></i>`;
    return `<div class="br">${pre}<h4>${esc(TN(c.n))}</h4><p>${own ? T('owned') : ''}</p>${priceBtn(id, c)}</div>`;
  };
  const bySlot = (slot, craft) => Object.keys(CONFIG.COSMETICS).filter(id => CONFIG.cosSlot(id) === slot && !!CONFIG.COSMETICS[id].craft === !!craft);
  const grid = ids => '<div class="shop">' + ids.map(cosCard).join('') + '</div>';
  let body = '';
  if (shopTab === 'color') {
    body = `<p class="sub">${T('wd_color_moved')}</p><h4 class="sh">${T('shop_morphs')}</h4><p class="sub">${T('shop_morphs_hint')}</p><div class="row"><button data-eq="" data-slot="morph" ${prof.morph ? '' : 'class="sel"'}>${T('no_morph')}</button></div>` + grid(bySlot('morph', false));
  } else if (shopTab === 'outfit') body = `<h4 class="sh">${T('shop_hats')}</h4>` + grid(bySlot('hat', false)) + `<h4 class="sh">${T('shop_pats')}</h4><p class="sub">${T('shop_pats_hint')}</p>` + grid(bySlot('pat', false));
  else if (shopTab === 'pets') {
    const card = id => { const c = CONFIG.PETS[id], own = prof.pets.indexOf(id) >= 0, eq = prof.pet === id;
      const btn = own ? `<button data-pet="${eq ? '' : id}">${eq ? T('unequip') : T('equip')}</button>` : `<button data-buypet="${id}" ${prof.coins >= c.price ? '' : 'disabled'}>${T('buy')} · 🪙 ${c.price}</button>`;
      return `<div class="br"><h4>${c.ico} ${esc(TN(c.n))}</h4><p>${esc(TN(c.d))} ${own ? '· ' + T('owned') : ''}</p>${btn}</div>`; };
    const ids = Object.keys(CONFIG.PETS).sort((a, b) => CONFIG.PETS[a].price - CONFIG.PETS[b].price), col = sea => `<div><h4 class="sh">${sea ? T('pets_sea') : T('pets_land')}</h4><div class="shop" style="grid-template-columns:1fr">${ids.filter(id => !!CONFIG.PETS[id].sea === sea).map(card).join('')}</div></div>`;
    body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">${col(false)}${col(true)}</div>`;
  }
  else if (shopTab === 'fx') body = `<h4 class="sh">${T('shop_roars')}</h4>` + grid(bySlot('rfx', false));
  else if (shopTab === 'egg') body = `<h4 class="sh">${T('shop_eggs')}</h4><p class="sub">${T('shop_eggs_hint')}</p><div class="row"><button data-eq="" data-slot="egg" ${prof.eggskin ? '' : 'class="sel"'}>${T('egg_classic')}</button></div>` + grid(bySlot('egg', false));
  else if (shopTab === 'nest') {
    const nest = prof.nest || { items: [], put: [] };
    body = `<p class="sub">${T('nest_hint')}</p><div class="shop">` + Object.keys(CONFIG.NEST_ITEMS).filter(id => !CONFIG.NEST_ITEMS[id].craft && !CONFIG.NEST_ITEMS[id].shopHidden).map(id => {
      const it = CONFIG.NEST_ITEMS[id], own = nest.items.indexOf(id) >= 0;
      return `<div class="br"><h4>${it.ico} ${esc(TN(it.n))}</h4><p>${own ? T('owned') : ''}</p>${own ? '' : `<button data-nbuy="${id}" ${prof.coins >= it.price ? '' : 'disabled'}>${T('buy')} · 🪙 ${it.price}</button>`}</div>`; }).join('') + `</div><button id="sh-nest" style="margin-top:8px">🪺 ${T('nest_open')}</button>`;
  } else body = `<h4 class="sh">🛠 ${T('shop_craft')}</h4><p class="sub">${T('mats_hint')}</p>` + grid(Object.keys(CONFIG.COSMETICS).filter(id => CONFIG.COSMETICS[id].craft));
  const tabs = [['color', '🦎', T('tab_skins')], ['outfit', '👒', T('tab_outfit')], ['pets', '🐾', T('shop_pets')], ['fx', '✨', T('tab_fx')], ['egg', '🥚', T('tab_egg')], ['nest', '🪺', T('tab_nest')], ['craft', '🛠', T('tab_craft')]];
  const srcSw = !live && hasOnline && hasLocal ? `<div class="tabs"><button data-src="1" class="${shopOnline ? 'on' : ''}">🌐 ${T('prof_online')}</button><button data-src="0" class="${shopOnline ? '' : 'on'}">👤 ${T('prof_local')}</button></div>` : '';
  openPanel('shop', `<div class="row" style="margin-bottom:6px"><h2 style="margin:0;flex:2">🏪 ${T('shop')}</h2><div class="pts" style="text-align:right">🪙 ${prof.coins} · 🦴 ${mats.bone} · 🟫 ${mats.hide}</div></div>${srcSw}
    <div class="row" style="margin:4px 0 8px"><input id="sh-code" maxlength="30" placeholder="🎟 ${T('promo')}" autocomplete="off" style="flex:2"><button id="sh-redeem" style="flex:1">${T('promo_go')}</button></div>
    <div class="tabs shoptabs">${tabs.map(([k, i, n]) => `<button data-st="${k}" class="${shopTab === k ? 'on' : ''}">${i} ${n}</button>`).join('')}</div>${body}<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
    const rb = root.querySelector('#sh-redeem');
    if (rb) rb.onclick = async () => {
      const code = $('sh-code').value; if (!code.trim()) return;
      if (live) { ctl.send({ t: 'redeem', code }); return; }
      try { const r = await P.shopMenu(shopOnline, 'redeem', { code }); if (!r.ok) { UI.toast(T(r.err === 'used_code' ? 'promo_used' : 'promo_bad')); return; } UI.toast(T('promo_ok').replace('{c}', r.coins || 100000)); openShop(); }
      catch (e) { UI.toast(T(e.message === 'used_code' ? 'promo_used' : e.message === 'rate_limited' ? 'promo_rate' : e.message === 'bad_code' ? 'promo_bad' : 'server_off')); }
    };
    btnClick(root, '[data-st]', b => { shopTab = b.dataset.st; openShop(); });
    btnClick(root, '[data-src]', b => { shopOnline = b.dataset.src === '1'; openShop(); });
    btnClick(root, '[data-buy]', b => act('buy', { id: b.dataset.buy }));
    btnClick(root, '[data-craft]', b => act('craft', { id: b.dataset.craft }));
    btnClick(root, '[data-eq]', b => act('equip', { id: b.dataset.eq, slot: b.dataset.slot }));
    btnClick(root, '[data-buypet]', b => act('buypet', { id: b.dataset.buypet }));
    btnClick(root, '[data-pet]', b => act('setpet', { id: b.dataset.pet }));
    btnClick(root, '[data-color]', b => act('setcolor', { i: +b.dataset.color }));
    btnClick(root, '[data-nbuy]', b => act('nestbuy', { id: b.dataset.nbuy }));
    const nb = root.querySelector('#sh-nest'); if (nb) nb.onclick = openNest;
    $('pn-x').onclick = panelClose;
  });
}

// ---------------------------------------------------------------- гнездо: трофеи и яйца
function openNest() {
  const live = inGame(), prof = live ? ctl.session.profile : activeProf(); if (!prof || !prof.hatched) return;
  const online = !live && !!(P.state.token && P.state.profile && P.state.profile.hatched);
  const nest = prof.nest || { items: [], put: [] }, mats = prof.mats || { bone: 0, hide: 0 };
  const owned = [], shop = [];
  CONFIG.ALL_BIOMES.forEach(b => { if (CONFIG.nestOwned(prof, 'tr_' + b)) owned.push('tr_' + b); });
  Object.keys(CONFIG.NEST_ITEMS).forEach(id => { if (nest.items.indexOf(id) >= 0) owned.push(id); else if (!CONFIG.NEST_ITEMS[id].shopHidden) shop.push(id); });
  const put = nest.put.filter(id => CONFIG.nestOwned(prof, id));
  const nm = id => { const it = CONFIG.nestItem(id); return id.indexOf('tr_') === 0 ? '💀 ' + T('trophy_of', { b: TN(CONFIG.BIOME[id.slice(3)].n) }) : it.ico + ' ' + TN(it.n); };
  const full = put.length >= CONFIG.NEST_MAX;
  const ownedHtml = owned.map(id => { const on = put.indexOf(id) >= 0;
    return `<div class="br${on ? '' : ' off'}"><h4>${esc(nm(id))}</h4><p>${on ? T('nest_placed') : T('nest_stored')}</p><button data-np="${id}" ${!on && full ? 'disabled' : ''}>${on ? '✖ ' + T('nest_remove') : '＋ ' + T('nest_return')}</button></div>`; }).join('');
  const shopHtml = shop.map(id => { const it = CONFIG.NEST_ITEMS[id]; const okb = it.craft ? mats.bone >= (it.craft.bone | 0) && mats.hide >= (it.craft.hide | 0) : prof.coins >= it.price;
    return `<div class="br"><h4>${esc(nm(id))}</h4><button data-nb="${id}" ${okb ? '' : 'disabled'}>${it.craft ? '🛠 ' + T('craft') + ' · ' + (it.craft.bone ? '🦴' + it.craft.bone : '🟫' + it.craft.hide) : T('buy') + ' · 🪙 ' + it.price}</button></div>`; }).join('');
  openPanel('nest', `<h2>🪺 ${T('nest')} <small style="color:var(--mut)">${put.length}/${CONFIG.NEST_MAX}</small></h2><p class="sub">${T('nest_hint')}</p><p class="sub">🪙 ${prof.coins} · 🦴 ${mats.bone} · 🟫 ${mats.hide}</p>
    <h4 class="sh">${T('nest_have')}</h4><div class="shop">${ownedHtml || `<p class="sub">${T('nest_none')}</p>`}</div>${shopHtml ? `<h4 class="sh">${T('nest_shop')}</h4><div class="shop">${shopHtml}</div>` : ''}<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
    const nact = async (op, a) => {
      try {
        if (live) { ctl.send(Object.assign({ t: op }, a)); setTimeout(openNest, 450); }
        else { const r = await P.shopMenu(online, op, a); if (!r.ok) UI.toast(T(r.err === 'coins' ? 'err_coins' : 'err_mats')); openNest(); }
      } catch (e) { UI.toast(T('server_off')); }
    };
    btnClick(root, '[data-np]', b => { const id = b.dataset.np, i = put.indexOf(id); if (i >= 0) put.splice(i, 1); else if (put.length < CONFIG.NEST_MAX) put.push(id); nact('nestput', { put }); });
    btnClick(root, '[data-nb]', b => nact('nestbuy', { id: b.dataset.nb }));
    $('pn-x').onclick = panelClose;
  });
}

// ---------------------------------------------------------------- гардероб: всё оформление динозавра, что есть у игрока (покупки — в магазине)
let wdTab = 'color';
function openWardrobe(tab) {
  if (tab) wdTab = tab;
  const live = inGame(), hasOnline = !!(P.state.token && P.state.profile && P.state.profile.hatched), hasLocal = !!(P.state.local && P.state.local.hatched);
  if (!live && shopOnline === null) shopOnline = hasOnline;
  if (!live && shopOnline && !hasOnline) shopOnline = false;
  const prof = live ? ctl.session.profile : (shopOnline ? P.state.profile : P.state.local);
  if (!prof || !prof.hatched) { openPanel('wardrobe', `<h2>🚪 ${T('wardrobe')}</h2><p class="sub">${T('no_character')}</p><button id="pn-x">${T('back')}</button>`, () => { $('pn-x').onclick = panelClose; }); return; }
  const act = async (op, a) => {
    try {
      if (live) { ctl.send(Object.assign({ t: op }, a)); setTimeout(() => openWardrobe(), 450); }
      else { await P.shopMenu(shopOnline, op, a); const pf = shopOnline ? P.state.profile : P.state.local; ctl.menuSetDino && pf && ctl.menuSetDino({ cls: pf.cls, color: CONFIG.COLORS[pf.color], level: pf.level, evo: pf.evo, cosmetic: pf.cosmetic, patc: pf.patc, morph: pf.morph }); openWardrobe(); }
    } catch (e) { UI.toast(T('server_off')); }
  };
  const hx6 = n => '#' + n.toString(16).padStart(6, '0');
  const ownedBySlot = slot => prof.cosmetics.filter(id => CONFIG.COSMETICS[id] && CONFIG.cosSlot(id) === slot);
  const card = id => {
    const c = CONFIG.COSMETICS[id], slot = CONFIG.cosSlot(id), eq = prof[CONFIG.SLOT_FIELD[slot]] === id; let pre = '';
    if (c.m) { const base = c.m.c1 != null ? c.m.c1 : CONFIG.COLORS[prof.color]; pre = `<div class="mo"><i style="background:${hx6(base)}"></i><i style="background:${hx6(c.m.c2)}"></i>${c.m.c3 != null ? `<i style="background:${hx6(c.m.c3)}"></i>` : ''}</div>`; }
    else if (slot === 'egg') pre = `<img class="eggp" src="${ctl.eggThumb(id.slice(2), CONFIG.COLORS[prof.color])}">`;
    else if (c.c != null) pre = `<i class="sw" style="background:${hx6(c.c)}"></i>`;
    return `<div class="br${eq ? ' worn' : ''}">${pre}<h4>${esc(TN(c.n))}</h4><button data-eq="${eq ? '' : id}" data-slot="${slot}">${eq ? '✔ ' + T('unequip') : T('equip')}</button></div>`;
  };
  const none = (slot, label) => `<div class="row"><button data-eq="" data-slot="${slot}" ${prof[CONFIG.SLOT_FIELD[slot]] ? '' : 'class="sel"'}>${label}</button></div>`;
  const grid = ids => ids.length ? '<div class="shop">' + ids.map(card).join('') + '</div>' : `<p class="sub">${T('wd_empty')}</p>`;
  let body = '';
  if (wdTab === 'color') body = `<h4 class="sh">${T('shop_color')}</h4><p class="sub">${T('shop_color_hint')}</p><div class="swatches">` + CONFIG.COLORS.map((c, i) => `<button data-color="${i}" class="${prof.color === i ? 'sel' : ''}" style="background:${hx6(c)}"></button>`).join('') + '</div>';
  else if (wdTab === 'skins') body = none('morph', T('no_morph')) + grid(ownedBySlot('morph'));
  else if (wdTab === 'outfit') body = `<h4 class="sh">${T('shop_hats')}</h4>` + none('hat', T('wd_nothing')) + grid(ownedBySlot('hat')) + `<h4 class="sh">${T('shop_pats')}</h4>` + none('pat', T('wd_nothing')) + grid(ownedBySlot('pat'));
  else if (wdTab === 'fx') body = `<h4 class="sh">${T('shop_roars')}</h4>` + none('rfx', T('wd_nothing')) + grid(ownedBySlot('rfx'));
  else if (wdTab === 'pets') {
    const card = id => { const c = CONFIG.PETS[id], eq = prof.pet === id;
      return `<div class="br${eq ? ' worn' : ''}"><h4>${c.ico} ${esc(TN(c.n))}</h4><p>${esc(TN(c.d))}</p><button data-pet="${eq ? '' : id}">${eq ? '✔ ' + T('unequip') : T('equip')}</button></div>`; };
    const own = prof.pets.filter(id => CONFIG.PETS[id]).sort((a, b) => CONFIG.PETS[a].price - CONFIG.PETS[b].price), col = sea => `<div><h4 class="sh">${sea ? T('pets_sea') : T('pets_land')}</h4><div class="shop" style="grid-template-columns:1fr">${own.filter(id => !!CONFIG.PETS[id].sea === sea).map(card).join('') || `<p class="sub">${T('wd_empty')}</p>`}</div></div>`;
    body = `<div class="row"><button data-pet="" ${prof.pet ? '' : 'class="sel"'}>${T('wd_nothing')}</button></div>` + (own.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">${col(false)}${col(true)}</div>` : `<p class="sub">${T('wd_empty')}</p>`);
  }
  else if (wdTab === 'egg') body = `<p class="sub">${T('shop_eggs_hint')}</p><div class="row"><button data-eq="" data-slot="egg" ${prof.eggskin ? '' : 'class="sel"'}>${T('egg_classic')}</button></div>` + grid(ownedBySlot('egg'));
  const tabs = [['color', '🎨', T('tab_color')], ['skins', '🦎', T('tab_skins')], ['outfit', '👒', T('tab_outfit')], ['fx', '✨', T('tab_fx')], ['pets', '🐾', T('shop_pets')], ['egg', '🥚', T('tab_egg')]];
  const srcSw = !live && hasOnline && hasLocal ? `<div class="tabs"><button data-src="1" class="${shopOnline ? 'on' : ''}">🌐 ${T('prof_online')}</button><button data-src="0" class="${shopOnline ? '' : 'on'}">👤 ${T('prof_local')}</button></div>` : '';
  openPanel('wardrobe', `<div class="row" style="margin-bottom:6px"><h2 style="margin:0;flex:2">🚪 ${T('wardrobe')}</h2><button class="sm" id="wd-shop">🏪 ${T('shop')}</button></div>${srcSw}
    <div class="tabs shoptabs">${tabs.map(([k, i, n]) => `<button data-wt="${k}" class="${wdTab === k ? 'on' : ''}">${i} ${n}</button>`).join('')}</div>${body}<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
    btnClick(root, '[data-wt]', b => { wdTab = b.dataset.wt; openWardrobe(); });
    btnClick(root, '[data-src]', b => { shopOnline = b.dataset.src === '1'; openWardrobe(); });
    btnClick(root, '[data-eq]', b => act('equip', { id: b.dataset.eq, slot: b.dataset.slot }));
    btnClick(root, '[data-pet]', b => act('setpet', { id: b.dataset.pet }));
    btnClick(root, '[data-color]', b => act('setcolor', { i: +b.dataset.color }));
    $('wd-shop').onclick = () => openShop();
    $('pn-x').onclick = panelClose;
  });
}

// ---------------------------------------------------------------- дуэль из главного меню
function openDuelMenu() {
  const prof = P.state.profile && P.state.token ? P.state.profile : null, up = P.state.serverUp;
  const lg = CONFIG.leagueOf((prof && prof.elo) || 1000);
  openPanel('duelm', `<h2>🥊 ${T('duel_menu')}</h2>${prof ? `<div class="ratehead"><b>${lg.ico} ${esc(TN(lg.n))} · ${prof.elo | 0}</b><span>${T('duels_wl', { w: prof.dw | 0, l: prof.dl | 0 })}</span></div>` : ''}
    <p class="sub">${T('duel_menu_hint')}</p>
    <button class="pri" id="dm-q" ${up ? '' : 'disabled'}>🥊 ${T('duel_find')}</button>
    <button id="dm-t" ${up ? '' : 'disabled'}>🏆 ${T('tourney')}</button>
    <button id="pn-x" style="margin-top:10px">${T('back')}</button>`, () => {
    const go = (kind) => {
      const online = true;
      if (!P.state.token) { openAuth(() => go(kind)); return; }
      const prof = online ? P.state.profile : P.state.local;
      if (!prof || !prof.hatched) { openCreate(online, () => go(kind), false); return; }
      panelClose();
      ctl.start({ online, biome: Sim.homeBiome(prof), mode: online ? 'public' : 'solo', duelq: kind === 'q', tourneyJoin: kind === 't' });
    };
    $('dm-q').onclick = () => go('q'); $('dm-t').onclick = () => go('t'); $('pn-x').onclick = panelClose;
  });
}
function ratingHead() {
  const pr = inGame() ? ctl.session.profile : activeProf(); if (!pr) return '';
  const elo = pr.elo | 0 || 1000, lg = CONFIG.leagueOf(elo), nx = CONFIG.LEAGUES.find(x => x.min > elo);
  const rw = lg.reward, rewTxt = '🪙 ' + rw.c + (rw.title ? ' · ' + CONFIG.TITLES[rw.title].ico + ' ' + TN(CONFIG.TITLES[rw.title].n) : '') + (rw.cos ? ' · 🎁 ' + TN(CONFIG.COSMETICS[rw.cos].n) : '');
  return `<div class="ratehead"><b>${lg.ico} ${esc(TN(lg.n))} · ${elo}</b><span>${T('duels_wl', { w: pr.dw | 0, l: pr.dl | 0 })}${nx ? ' · ' + T('to_next', { n: nx.min - elo, l: TN(nx.n) }) : ''}</span><span>${T('season_left', { d: CONFIG.seasonLeftDays(Date.now()) })} · ${T('season_reward')}: ${esc(rewTxt)}</span></div>`;
}
async function openLeaders(tab) {
  tab = tab || 'wins';
  openPanel('lb', `<h2>${T('lb_title')}</h2><p class="sub">…</p><button id="pn-x">${T('back')}</button>`, () => { $('pn-x').onclick = panelClose; });
  let data = null; try { data = await P.leaderboard(); } catch (e) { /* сервер недоступен */ }
  const me = (P.state.user || '').toLowerCase();
  let table;
  if (!data) table = `<p class="sub">${T('server_off')}</p>`;
  else {
    const rows = tab === 'wins' ? data.wins : tab === 'elo' ? (data.elo || []) : tab === 'coins' ? (data.coins || []) : data.kings;
    table = rows.length ? `<table><tr><th>${T('lb_place')}</th><th>${T('lb_name')}</th><th>${tab === 'wins' ? T('lb_wins_n') : tab === 'elo' ? T('rating') : tab === 'coins' ? T('lb_coins_n') : T('lb_kings_n')}</th><th>${T('level_short')}</th></tr>` + rows.map((r, i) =>
      `<tr class="${r.nickKey === me ? 'me' : ''}"><td>${i + 1}</td><td>${r.cls ? CLS_ICO[r.cls] + ' ' : ''}${esc(r.nick)}${r.lord ? ' 🌟' : ''}${r.admin ? ADM : ''}</td><td>${tab === 'wins' ? r.wins : tab === 'elo' ? CONFIG.leagueOf(r.elo).ico + ' ' + r.elo : tab === 'coins' ? '🪙 ' + r.coins : r.count + '/6'}</td><td>${r.level || ''}</td></tr>`).join('') + '</table>' : `<p class="sub">${T('lb_empty')}</p>`;
  }
  if (openName !== 'lb') return;
  openPanel('lb', `<h2>🏆 ${T('lb_title')}</h2><div class="tabs"><button data-t="wins" class="${tab === 'wins' ? 'on' : ''}">${T('lb_wins')}</button><button data-t="kings" class="${tab === 'kings' ? 'on' : ''}">${T('lb_kings')}</button><button data-t="elo" class="${tab === 'elo' ? 'on' : ''}">${T('rating')}</button><button data-t="coins" class="${tab === 'coins' ? 'on' : ''}">🪙 ${T('lb_coins')}</button></div>${tab === 'elo' ? ratingHead() : ''}${table}<button id="pn-x" style="margin-top:12px">${T('back')}</button>`, root => {
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
    <div style="margin:10px 0 0;font-size:11px;opacity:.6;text-align:center">${lang === 'ru' ? '3D-модели: тираннозавр и трицератопс — из присланных STL; птеранодон, паразавролофус и велоцираптор (враги «Раптор» и «Магмовый раптор») — Jurassic Park: The Game (Telltale Games / Universal), присланные модели; брахиозавр — Creazilla.com (Creazilla Open-Source License); мегалодон — «Mighty Megalodon» (Sketchfab, лицензия не указана), корона — скульпт; мозазавр — модель «Mosasaurus»; стегозавр — «Stegosaurus II» (sjpiper145, Thingiverse, CC0); компсогнат, троодон и геррерозавр — Jurassic Park: The Game (Telltale / Universal); плезиозавр — Dino Crisis 2 (Capcom), вариант 2; варан — «Komodo Dragon» (Thingiverse); спинозавр — «Spinosaurus animation» (лицензия не указана); болотный крокодил (саркозух) — «Sarcosuchus imperator» — Nobilis 2 (CC BY 4.0); летающие враги — «Pterosaur Quetzalcoatlus» (Sketchfab, лицензия не указана); ихтиозавр — «Ichthyosaurus» (Sketchfab, лицензия не указана); плиозавр — «Pliosaurus kevani» (Sketchfab, лицензия не указана); питомец-скорпион — Sketchfab, лицензия не указана; удильщик — «Anglerfish 3D» (Sketchfab, лицензия не указана); все присланы автором игры' : '3D models: tyrannosaur and triceratops from supplied STL files; pteranodon, parasaurolophus and velociraptor from Jurassic Park: The Game (Telltale / Universal), supplied models; brachiosaurus — Creazilla.com (Creazilla Open-Source License); megalodon — “Mighty Megalodon” (Sketchfab, license not specified), crown — sculpt; mosasaur — “Mosasaurus” model; stegosaurus — “Stegosaurus II” (sjpiper145, Thingiverse, CC0); compsognathus, troodon and herrerasaurus — Jurassic Park: The Game (Telltale / Universal); plesiosaur — Dino Crisis 2 (Capcom), variant 2; komodo dragon — “Komodo Dragon” (Thingiverse); spinosaurus — “Spinosaurus animation” (license not specified); swamp crocodile (Sarcosuchus) — “Sarcosuchus imperator” by Nobilis 2 (CC BY 4.0); flying enemies — “Pterosaur Quetzalcoatlus” (Sketchfab, license not specified); ichthyosaur — “Ichthyosaurus” (Sketchfab, license not specified); pliosaur — “Pliosaurus kevani” (Sketchfab, license not specified); scorpion pet — Sketchfab, license not specified; anglerfish — “Anglerfish 3D” (Sketchfab, license not specified); all supplied by the game author'}</div>
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
    ${(() => {      // одна сетка: «Игроки» только в комнате; нечётная кнопка в конце растягивается на всю ширину — пустых ячеек нет
      const room = !(S.o && (!S.o.online || S.o.mode === 'solo'));
      const bs = [`<button id="ps-evo">${T('evolution')}</button>`, room ? `<button id="ps-pl">${T('players')}</button>` : '', `<button id="ps-ach">${T('achievements')}</button>`, `<button id="ps-set">${T('settings')}</button>`,
        `<button id="ps-nest">🪺 ${T('nest')}</button>`, `<button id="ps-shop">🏪 ${T('shop')}</button>`, `<button id="ps-q">📅 ${T('quests')}</button>`, `<button id="ps-wd">🚪 ${T('wardrobe')}</button>`, `<button id="ps-story">${ctl.story.tr('storyBtn')}</button>`].filter(Boolean);
      if (bs.length % 2) bs[bs.length - 1] = bs[bs.length - 1].replace('<button ', '<button style="grid-column:1/-1" ');
      return '<div class="grid2">' + bs.join('') + '</div>';
    })()}
    ${S.room.mode === 'rush' || S.room.mode === 'duel' ? '' : `<button id="ps-loc">🗺 ${T('locations_btn')}</button>`}
    <button class="red" id="ps-exit">${T('to_menu')}</button>`, root => {
    $('ps-resume').onclick = panelClose; $('ps-about').onclick = openAbout; $('ps-chg').onclick = openChange; $('ps-evo').onclick = () => openEvo(); if ($('ps-pl')) $('ps-pl').onclick = openPlayers; $('ps-ach').onclick = openAch; $('ps-nest').onclick = openNest; $('ps-wd').onclick = () => openWardrobe(); $('ps-shop').onclick = () => openShop(); $('ps-set').onclick = openSettings; $('ps-q').onclick = openQuests;
    $('ps-exit').onclick = () => { closePanelState(); $('panel').classList.remove('on'); ctl.leave(); };
    $('ps-story').onclick = openStory;
    if ($('ps-loc')) $('ps-loc').onclick = openLocations;
  });
}
function openLocations() {
  const S = ctl.session, pr = S.profile, w = CONFIG.worldOf(S.biome);
  const rows = CONFIG.worldList(w).map(b => { const ok = Sim.canEnterBiome(pr, b), here = b === S.biome;
    return `<button class="bm ${ok ? '' : 'lock'} ${here ? 'sel' : ''}" data-b="${b}" ${ok && !here ? '' : 'disabled'} style="text-align:left"><i>${ok ? BIOME_ICO[b] : '🔒'}</i> ${esc(TN(CONFIG.BIOME[b].n))}<small>${here ? T('loc_here') : ok ? (pr.kings.indexOf(b) >= 0 ? '👑 ' + T('king_mark') : T('loc_go')) : T('req_boss', { n: CONFIG.BOSS_LEVEL[b] })}</small></button>`; }).join('');
  openPanel('locations', `<h2>🗺 ${T('locations_btn')}</h2><p class="sub">${T('loc_note')}</p><div class="biomes">${rows}</div><button id="lc-back">${T('back')}</button>`, root => {
    btnClick(root, '.bm', b => { if (b.disabled) return; ctl.session.conn.send({ t: 'goto', biome: b.dataset.b }); panelClose(); });
    $('lc-back').onclick = openPause;
  });
}
function openStory() {
  const prof = (ctl.session && ctl.session.profile) || ctl.activeProfile();
  openPanel('story', ctl.story.panelHtml(prof), root => ctl.story.bindPanel(root, panelClose, fn => { closePanelState(); $('panel').classList.remove('on'); fn(); }));
}
// ---------------------------------------------------------------- смена динозавра прямо из паузы (в пределах мира: суша — свои, океан — свои)
function openChange() {
  if (!inGame()) return;
  const S = ctl.session, pr = S.profile, world = CONFIG.clsWorld(pr.cls);
  const card = k => {
    const I = CONFIG.CLS_INFO[k], lv = Sim.typeLevel(pr, k), cur = k === pr.cls, lk = !Sim.typeUnlocked(pr, k);
    return `<div class="cls ${cur ? 'sel' : ''} ${lk ? 'lock' : ''}" data-k="${k}" ${lk ? 'data-lk="1" style="opacity:.45"' : ''}><b>${cIco(k)} ${esc(TN(I.n))} <small>${lv ? T('level_short') + lv + ' · ' + T('stage_' + CONFIG.STAGES[CONFIG.stageIndex(lv)].id) : T('type_new')}${cur ? ' · ' + T('now_playing') : ''}</small></b><span>${esc(TN(I.d))}</span><em>${abilChips(k)}</em>${statsGrid(k, Math.max(1, lv))}</div>`;
  };
  openPanel('change', `<h2>🔄 ${T('change_dino')}</h2><p class="sub">${T('change_dino_d')}</p>${CONFIG.TYPES[world].map(card).join('')}<button id="pn-x" style="margin-top:12px">${T('resume')}</button>`, root => {
    btnClick(root, '.cls', b => { if (b.dataset.lk) { UI.toast(T('type_lock_n', { n: CONFIG.TYPE_MIN_LV[b.dataset.k] })); return; } if (b.dataset.k === pr.cls) { panelClose(); return; } closePanelState(); $('panel').classList.remove('on'); ctl.switchType(b.dataset.k); });
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
      const i = p.info; return `<tr><td>${CLS_ICO[i.cls] || ''} ${esc(i.nick)}${i.king ? ' 👑' : ''}${i.lord ? ' 🌟' : ''}${i.admin ? ADM : ''}${i.bot ? ' 🤖' : ''}</td><td>${T('level_short')}${i.level}</td><td style="text-align:right">${!i.bot && canDuel ? `<button class="sm" data-duel="${id}">⚔ ${T('duel')}</button>` : ''}</td></tr>`;
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

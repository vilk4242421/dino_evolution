'use strict';
/* Проверка игровой логики комнат без сети: бой, опыт, эволюция, босс и корона, портал в следующий биом, дуэль, турнир, босс-раш. */
const assert = require('assert');
const Core = require('../game/rooms.js'), Sim = Core.Sim, CF = Core.CF;
const DT = 1 / CF.TICK_RATE;
let passed = 0;
const ok = (c, m) => { assert(c, m); passed++; console.log('  ✓', m); };
function mkConn() { const c = { msgs: [], send(t) { this.msgs.push(JSON.parse(t)); }, last(t) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; }, all(t) { return this.msgs.filter(m => m.t === t); }, clear() { this.msgs.length = 0; } }; return c; }
function profile(cls, level, extra) { const p = Sim.defaultProfile('T_' + cls); p.cls = cls; p.hatched = true; p.level = level; p.totalXp = CF.cumXp(level); p.xp = 0; p.coins = 500; return Object.assign(p, extra || {}); }
function tick(hub, n) { for (let i = 0; i < n; i++) hub.tick(); }
function events(conn) { const out = []; conn.all('s').forEach(s => (s.ev || []).forEach(e => out.push(e))); return out; }
function lastS(conn) { return conn.last('s'); }
function nearestEnt(room, p, pred) { let best = null, bd = 1e9; room.ents.forEach(e => { if (e.dead || !e.st || (pred && !pred(e))) return; const d = Math.hypot(e.st.x - p.st.x, e.st.z - p.st.z); if (d < bd) { bd = d; best = e; } }); return best; }
function put(room, p, x, z) { p.st.x = x; p.st.z = z; p.st.y = room.W.heightAt(x, z); p.st.vy = 0; p.rs++; }
function attackLoop(hub, p, e, max) {
  let n = 0;
  while (!e.dead && e.hp > 0 && n < (max || 400)) {
    const room = p.room;
    p.st.x = e.st.x - Math.sin(p.st.face) * 1.6; p.st.z = e.st.z - Math.cos(p.st.face) * 1.6; p.st.y = room.W.heightAt(p.st.x, p.st.z);
    p.st.face = Math.atan2(e.st.x - p.st.x, e.st.z - p.st.z);
    p.hp = p.stats.hp; p.food = 100;
    p.q.push({ q: ++p.lastQ, f: 0, s: 0, yaw: p.st.face + Math.PI, jump: false, down: false, sprint: false });
    room.action(p, { a: 'atk' });
    hub.tick(); n++;
  }
  return n;
}

console.log('1. Вход, бой, опыт, еда');
for (const cls of ['carn', 'herb', 'fly', 'mosa']) {
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn();
  const bio = CF.isAqua(cls) ? 'reef' : 'forest';
  const r = hub.join({ profile: profile(cls, 1), conn, userId: 1, biome: bio, mode: 'public' });
  ok(!r.error && r.player, cls + ': вход в ' + bio);
  tick(hub, 30);
  const w = conn.last('welcome'); ok(w && w.room.biome === bio && w.prof.cls === cls, cls + ': welcome с профилем');
  const p = r.player, room = r.room;
  const prey = nearestEnt(room, p, e => e.arch && (e.role === 'prey' || e.role === 'herd' || e.role === 'hostile'));
  put(room, p, prey.st.x - 3, prey.st.z);
  const xp0 = p.profile.totalXp; attackLoop(hub, p, prey, 600);
  ok(prey.dead || prey.hp <= 0, cls + ': враг побеждён (' + prey.arch.id + ')');
  tick(hub, 5);
  ok(p.profile.totalXp > xp0, cls + ': опыт начислен (+' + (p.profile.totalXp - xp0) + ')');
  ok(p.profile.stats.kills >= 1, cls + ': счётчик побед растёт');
  hub.leave(p);
}

console.log('2. Эволюция и магазин');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), r = hub.join({ profile: profile('carn', 12), conn, userId: 1, biome: 'forest', mode: 'public' }), p = r.player, room = r.room;
  ok(CF.evoPoints(12, {}) === 11, 'очки эволюции = уровень − 1');
  const buy = id => hub.onMessage(p, { t: 'evo', id });
  ok(CF.treesFor('carn').join() === 'life,fight,wild,hunt' && CF.treesFor('mosa').indexOf('deep') >= 0, 'у каждого класса 4 дерева: Здоровье, Урон, Выживание + своё');
  buy('fight:L'); ok(p.profile.evo['fight:L'] === 1, 'Урон → «Сила челюстей» ступень 1');
  buy('fight:R'); ok(!p.profile.evo['fight:R'], 'на развилке можно взять только один путь');
  buy('fight:LL'); ok(!p.profile.evo['fight:LL'], 'следующая развилка закрыта, пока узел не прокачан до конца');
  const dmg0 = p.stats.dmg; buy('fight:L'); buy('fight:L'); tick(hub, 2); ok(p.profile.evo['fight:L'] === 3 && p.stats.dmg > dmg0, 'узел прокачан до 3, урон вырос');
  buy('fight:LL'); buy('fight:LL'); ok(p.profile.evo['fight:LL'] === 2 && p.stats.fx.venom > 0, 'следующая развилка: «Ядовитый укус» (яд при ударе)');
  hub.onMessage(p, { t: 'evosw', id: 'fight:LR' }); ok(p.profile.evo['fight:LR'] === 2 && !p.profile.evo['fight:LL'] && p.stats.fx.bleed > 0 && !p.stats.fx.venom, 'переключили развилку на «Рваные раны»: очки перешли, яд → кровотечение');
  hub.onMessage(p, { t: 'evosw', id: 'fight:R' }); ok(p.profile.evo['fight:R'] === 3 && !p.profile.evo['fight:L'] && !p.profile.evo['fight:LR'] && CF.evoPoints(12, p.profile.evo) === 8, 'смена верхней развилки сбрасывает нижние ветки и возвращает очки');
  buy('sky:L'); ok(!p.profile.evo['sky:L'], 'дерево другого класса недоступно');
  const hp0 = p.stats.hp; buy('life:L'); tick(hub, 3); ok(p.stats.hp > hp0, 'Здоровье → «Крепкое тело» повышает максимум HP');
  buy('hunt:L'); ok(p.stats.ranks.pounce === 1, 'дерево «Охота» качает охотничий рывок');
  const coins = p.profile.coins; hub.onMessage(p, { t: 'evoreset' }); ok(p.profile.coins === coins && CF.evoSpent(p.profile.evo) === 0, 'полный сброс бесплатный');
  ok(Object.keys(Sim.fixProfile({ evo: { fangs: 3, vit: 2 } }).evo).length === 0, 'старая эволюция сбрасывается, очки возвращаются');
  hub.onMessage(p, { t: 'buy', id: 'scarf' }); ok(p.profile.cosmetics.indexOf('scarf') >= 0, 'покупка косметики'); hub.onMessage(p, { t: 'equip', id: 'scarf' }); ok(p.profile.cosmetic === 'scarf', 'надели шарф');
  hub.leave(p);
}

console.log('3. Босс леса, корона, портал в снежные равнины');
{
  const saved = []; const hub = new Core.Hub({ onSave(p) { saved.push(p.profile.kings.slice()); } }), conn = mkConn();
  const pr = profile('carn', 30, { coins: 0 }); const r = hub.join({ profile: pr, conn, userId: 1, biome: 'forest', mode: 'public' }), p = r.player, room = r.room;
  p.stats.hp = p.stats.hp; tick(hub, 10);
  const W = room.W; ok(room.boss && room.boss.bossId === 'tyrant', 'в арене стоит Старый Тираннозавр');
  put(room, p, W.portalIn.x - Math.cos(W.portalIn.ang) * 1, W.portalIn.z - Math.sin(W.portalIn.ang) * 1); tick(hub, 40);
  ok(Math.hypot(p.st.x, p.st.z) < CF.ARENA_R, 'портал перенёс игрока в арену');
  ok(room.boss.state === 'fight' || room.boss.state === 'wait' || room.boss.state === 'intro', 'бой с боссом начался: ' + room.boss.state);
  // босс не должен убивать мгновенно и использует атаки с предупреждением
  let tel = 0; for (let i = 0; i < 400 && room.boss.hp > 0 && p.alive; i++) { p.hp = p.stats.hp; p.q.push({ q: ++p.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: false, sprint: false }); hub.tick(); }
  tel = events(conn).filter(e => e[0] === 'tel').length; ok(tel > 0, 'босс выдаёт зоны-предупреждения (' + tel + ')');
  // добиваем: ставим HP на минимум и бьём
  const b = room.boss; b.hp = 5;
  attackLoop(hub, p, b, 300); tick(hub, 10);
  ok(b.dead || b.hp <= 0, 'босс повержен');
  ok(p.profile.kings.indexOf('forest') >= 0, 'игрок стал королём леса');
  ok(saved.length > 0 && saved[saved.length - 1].indexOf('forest') >= 0, 'профиль сохранён с короной');
  ok(events(conn).some(e => e[0] === 'king'), 'событие «king» отправлено');
  tick(hub, 30);
  ok(lastS(conn).pt && lastS(conn).pt.next === 1, 'портал в следующий биом открыт');
  ok(Sim.canEnterBiome(p.profile, 'snow'), 'снежные равнины открыты');
  // идём в портал выхода
  conn.clear(); put(room, p, W.portalNext.x - Math.cos(W.portalNext.ang) * 1, W.portalNext.z - Math.sin(W.portalNext.ang) * 1);
  tick(hub, 120);
  const w2 = conn.last('welcome'); ok(w2 && w2.room.biome === 'snow', 'переход в биом «Снежные равнины» (welcome)');
  ok(conn.player && conn.player.room.biome === 'snow', 'conn.player обновлён после перехода');
  hub.leave(conn.player);
}

console.log('4. Ограничения биомов и босса');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn();
  ok(hub.join({ profile: profile('carn', 5), conn, userId: 1, biome: 'snow', mode: 'public' }).error === 'locked', 'закрытый биом не открывается');
  ok(hub.join({ profile: profile('carn', 5), conn, userId: 1, biome: 'forest', mode: 'rush' }).error === 'locked', 'босс-раш только для Владык эпох');
  const r = hub.join({ profile: profile('carn', 5), conn, userId: 1, biome: 'forest', mode: 'public' }), p = r.player, room = r.room, W = room.W;
  tick(hub, 10); put(room, p, W.portalIn.x - Math.cos(W.portalIn.ang) * 1, W.portalIn.z - Math.sin(W.portalIn.ang) * 1); conn.clear(); tick(hub, 60);
  ok(Math.hypot(p.st.x, p.st.z) > CF.ARENA_R, 'до 10 уровня в арену не пускает');
  ok(conn.all('err').some(m => m.m === 'boss_level'), 'сообщение «нужен уровень»');
  hub.leave(p);
}

console.log('5. Среда: холод, лава, вода (морской), полёт');
{
  const hub = new Core.Hub({ onSave() { } }), kings = ['forest', 'snow', 'mountain', 'desert', 'swamp'];
  const conn = mkConn(), r = hub.join({ profile: profile('carn', 20, { kings }), conn, userId: 1, biome: 'volcano', mode: 'public' }), p = r.player, room = r.room;
  tick(hub, 5); let lava = null; for (let i = 0; i < 4000 && !lava; i++) { const x = (Math.random() * 2 - 1) * 280, z = (Math.random() * 2 - 1) * 280; if (room.W.isLava(x, z) && Math.hypot(x, z) > 60) lava = { x, z }; }
  ok(!!lava, 'в вулкане есть лава'); put(room, p, lava.x, lava.z); const hp0 = p.hp; tick(hub, 50); ok(p.hp < hp0 || !p.alive, 'лава наносит урон');
  hub.leave(p);
  const conn2 = mkConn(), r2 = hub.join({ profile: profile('mosa', 10), conn: conn2, userId: 2, biome: 'reef', mode: 'public' }), q = r2.player;
  tick(hub, 5); let wat = null; for (let k = 0; k < 50 && !wat; k++) { const c = r2.room.W.randomWater(r2.room.rng); if (c && c.y < r2.room.W.waterY - 3) wat = c; } ok(!!wat, 'в океане есть глубокая вода'); put(r2.room, q, wat.x, wat.z); q.st.y = r2.room.W.waterY - 3;
  let minBr = 1e9, wasSub = false, maxDepth = 0;
  for (let i = 0; i < 80; i++) { q.q.push({ q: ++q.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: true, sprint: false }); hub.tick(); minBr = Math.min(minBr, q.breath); wasSub = wasSub || q.sub; maxDepth = Math.max(maxDepth, r2.room.W.waterY - q.st.y); }
  ok(wasSub && minBr < q.stats.breathMax, 'морской под водой тратит воздух (глубина ' + maxDepth.toFixed(1) + ')'); hub.leave(q);
  const conn3 = mkConn(), r3 = hub.join({ profile: profile('fly', 10), conn: conn3, userId: 3, biome: 'forest', mode: 'public' }), f = r3.player; tick(hub, 5);
  r3.room.action(f, { a: 'f' }); for (let i = 0; i < 50; i++) { f.q.push({ q: ++f.lastQ, f: 0, s: 0, yaw: 0, jump: true, down: false, sprint: false }); hub.tick(); }
  ok(f.st.fly === 1 && f.st.y > r3.room.W.heightAt(f.st.x, f.st.z) + 3, 'летающий взлетает по F + Пробел'); hub.leave(f);
}

console.log('6. Дуэль 1 на 1');
{
  let saved = 0; const hub = new Core.Hub({ onSave() { saved++; } }), c1 = mkConn(), c2 = mkConn();
  const a = hub.join({ profile: profile('carn', 10), conn: c1, userId: 1, biome: 'forest', mode: 'public' }), b = hub.join({ profile: profile('herb', 10), conn: c2, userId: 2, biome: 'forest', mode: 'public' });
  ok(a.room === b.room, 'два игрока в одной публичной комнате'); tick(hub, 30);
  put(a.room, a.player, 60, 60); put(b.room, b.player, 62, 60);
  hub.onMessage(a.player, { t: 'duel', to: b.player.id }); ok(c2.last('duelreq'), 'вызов дошёл до второго игрока');
  hub.onMessage(b.player, { t: 'duelans', from: a.player.id, ok: true }); tick(hub, 5);
  ok(a.player.room.mode === 'duel' && b.player.room === a.player.room, 'игроки перенесены в комнату дуэли');
  ok(c1.last('welcome').room.mode === 'duel', 'клиент получил welcome арены дуэли');
  const dr = a.player.room; tick(hub, 3 * 25 + 10); ok(dr.duel.state === 'fight', 'после отсчёта — бой');
  b.player.hp = 1; a.player.st.x = 0; a.player.st.z = 0; b.player.st.x = 1.5; b.player.st.z = 0; a.player.st.face = Math.PI / 2;
  for (let i = 0; i < 80 && dr.duel && dr.duel.state === 'fight'; i++) { a.player.q.push({ q: ++a.player.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: false, sprint: false }); dr.action(a.player, { a: 'atk' }); hub.tick(); }
  tick(hub, 5 * 25 + 10);
  ok(a.player.profile.wins === 1, 'победа над живым игроком засчитана (wins=1)');
  ok(b.player.profile.wins === 0, 'проигравший без побед');
  ok(a.player.room.mode !== 'duel' && a.player.room.biome === 'forest', 'победитель вернулся в лес'); ok(c1.all('welcome').length >= 2, 'повторный welcome при возврате');
  ok(b.player.hp > 0, 'проигравший жив после возврата'); hub.leave(a.player); hub.leave(b.player);
}

console.log('7. Дуэль с ботом и турнир на 4');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), r = hub.join({ profile: profile('carn', 12), conn, userId: 1, biome: 'forest', mode: 'public' }), p = r.player;
  tick(hub, 10); put(r.room, p, 70, 70); hub.onMessage(p, { t: 'tourney' }); ok(conn.last('tq') && conn.last('tq').n === 1, 'встали в очередь турнира');
  tick(hub, 25 * 45); ok(p.room.mode === 'duel', 'через 40 с очередь добирается ботами — начался полуфинал');
  const dr = p.room, opp = dr.duel && (dr.duel.a === p ? dr.duel.b : dr.duel.a); ok(opp && opp.bot, 'соперник — бот');
  tick(hub, 25 * 3 + 5); opp.hp = 1; p.st.x = 0; p.st.z = 0; opp.st.x = 1.4; opp.st.z = 0;
  for (let i = 0; i < 100 && dr.duel && dr.duel.state === 'fight'; i++) { p.q.push({ q: ++p.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: false, sprint: false }); p.st.face = Math.atan2(opp.st.x - p.st.x, opp.st.z - p.st.z); dr.action(p, { a: 'atk' }); hub.tick(); }
  tick(hub, 25 * 6);
  ok(p.profile.wins === 0, 'победа над ботом не идёт в рейтинг');
  hub.leave(p);
}

console.log('8. Босс-раш для Владыки эпох');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), kings = CF.BIOMES.slice();
  const r = hub.join({ profile: profile('carn', 30, { kings }), conn, userId: 1, biome: 'forest', mode: 'rush' }), p = r.player, room = r.room;
  ok(!r.error && room.mode === 'rush' && room.rush, 'комната босс-раша создана'); tick(hub, 25 * 10);
  ok(room.boss && !room.boss.dead, 'босс первой волны появился'); room.boss.hp = 3; attackLoop(hub, p, room.boss, 400); tick(hub, 25 * 8);
  ok(events(conn).some(e => e[0] === 'rushwave'), 'первая волна пройдена'); hub.leave(p);
}

console.log('9. Игрок один: без стаи и спутников');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), r = hub.join({ profile: profile('herb', 12, { kings: ['forest'] }), conn, userId: 1, biome: 'forest', mode: 'public' }), p = r.player, room = r.room;
  tick(hub, 25 * 3); room.action(p, { a: 'q' }); tick(hub, 10);
  let allies = 0; room.ents.forEach(e => { if (e.owner === p) allies++; }); ok(allies === 0, 'игрок один: союзников нет (' + allies + ')');
  ok(events(conn).some(e => e[0] === 'herd'), 'топот травоядного сработал');
  let bots = 0; room.players.forEach(x => { if (x.bot) bots++; }); ok(bots === 0, 'ботов-спутников нет');
  hub.leave(p);
}
console.log('10. Океан: 5 локаций, морские динозавры, боссы, прогресс');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn();
  ok(hub.join({ profile: profile('carn', 30), conn, userId: 1, biome: 'reef', mode: 'solo' }).error === 'bad_type', 'без смены типа сухопутному в океан нельзя');
  {
    const c1 = mkConn(), r1 = hub.join({ profile: profile('carn', 30), conn: c1, userId: 11, biome: 'reef', cls: 'plio', mode: 'solo' });
    ok(!r1.error && r1.player.cls === 'plio' && r1.player.profile.level === 1, 'игрок сам выбирает воду: хищник 30 ур. → плиозавр 1 ур.');
    ok(r1.player.profile.slots.carn && r1.player.profile.slots.carn.level === 30, 'прогресс хищного сохранён в слоте');
    hub.leave(r1.player);
    const c2 = mkConn(), r2b = hub.join({ profile: r1.player.profile, conn: c2, userId: 11, biome: 'forest', cls: 'carn', mode: 'solo' });
    ok(!r2b.error && r2b.player.profile.level === 30 && r2b.player.profile.slots.plio, 'возврат на сушу: хищный снова 30 ур., плиозавр сохранён');
    hub.leave(r2b.player);
  }
  ok(CF.OCEANS.length === 5 && CF.OCEANS.every(b => CF.BIOME[b] && CF.BIOME[b].ocean && CF.BOSSES[CF.BIOME[b].boss]), 'в океане 5 локаций, у каждой свой босс');
  for (const b of CF.OCEANS) {
    const W = Sim.getWorld(b), own = Object.keys(CF.BIOME[b].spawn);
    ok(own.every(id => CF.ENEMIES[id].water) && own.filter(id => CF.ENEMIES[id].role === 'hostile' || CF.ENEMIES[id].role === 'herd').length >= 2, b + ': свои плавающие динозавры (' + own.join(', ') + ')');
    ok(W.nest.y > W.waterY + 1 && W.heightAt(0, 0) < W.waterY - 3, b + ': гнездо на островке, арена босса под водой');
  }
  const pr = profile('mosa', 1); const r = hub.join({ profile: pr, conn, userId: 1, mode: 'solo' }), p = r.player, room = r.room;
  ok(room.biome === 'reef', 'морской динозавр по умолчанию появляется в океане (риф)');
  tick(hub, 20);
  let ys = []; room.ents.forEach(e => { if (e.arch && e.arch.water) ys.push(e.st.y); });
  const spread = Math.max(...ys) - Math.min(...ys);
  ok(ys.length > 60 && spread > 4, 'морские обитатели плавают на разной глубине (' + ys.length + ' шт., разброс ' + spread.toFixed(1) + ' м)');
  // ныряем глубоко: дыхания хватает надолго
  const deep = (() => { for (let x = -150; x < 150; x += 7) for (let z = -150; z < 150; z += 7) if (room.W.heightAt(x, z) < -9 && Math.hypot(x, z) > 60) return { x, z }; })();
  put(room, p, deep.x, deep.z); p.st.y = room.W.heightAt(deep.x, deep.z) + 1; p.shield = 0;
  for (let i = 0; i < 25 * 25; i++) { p.hp = p.stats.hp; p.food = 100; p.q.push({ q: ++p.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: true, sprint: false }); hub.tick(); }
  ok(p.sub && p.breath > 0 && p.st.y < -6, 'под водой 25 с — воздух ещё есть (' + p.breath.toFixed(1) + ' из ' + p.stats.breathMax + ')');
  // враг на глубине атакует и добивается
  const sh = nearestEnt(room, p, e => e.arch && e.arch.id === 'hybodus');
  ok(!!sh, 'на рифе есть гибодусы');
  hub.leave(p);
  // прохождение: босс рифа → корона → портал в ламинариевый лес; проценты
  const conn2 = mkConn(), pr2 = profile('mosa', 30), r2 = hub.join({ profile: pr2, conn: conn2, userId: 2, biome: 'reef', mode: 'solo' }), p2 = r2.player, room2 = r2.room;
  tick(hub, 10); ok(room2.boss && room2.boss.bossId === 'megalodon', 'на арене рифа — Древний Мегалодон');
  put(room2, p2, room2.W.portalIn.x - Math.cos(room2.W.portalIn.ang), room2.W.portalIn.z - Math.sin(room2.W.portalIn.ang)); tick(hub, 30);
  ok(Math.hypot(p2.st.x, p2.st.z) < CF.ARENA_R, 'портал перенёс на подводную арену');
  for (let i = 0; i < 200; i++) { p2.hp = p2.stats.hp; p2.q.push({ q: ++p2.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: false, sprint: false }); hub.tick(); }
  ok(events(conn2).some(e => e[0] === 'tel'), 'Мегалодон атакует зонами');
  room2.boss.hp = 5; attackLoop(hub, p2, room2.boss, 300); tick(hub, 10);
  ok(p2.profile.kings.indexOf('reef') >= 0, 'король рифа');
  const wps = CF.worldProgress(p2.profile, 'sea'); ok(wps >= 10 && wps < 40 && CF.worldProgress(p2.profile, 'land') === 0, 'прогресс мира: боссы + бестиарий (океан ' + wps + ' %, суша 0 %), а не уровни');
  ok(Sim.canEnterBiome(p2.profile, 'kelp') && !Sim.canEnterBiome(p2.profile, 'arctic'), 'открылся Ламинариевый лес, дальше — закрыто');
  ok(Sim.canEnterBiome(p2.profile, 'forest') && !Sim.canEnterBiome(p2.profile, 'snow'), 'цепочка суши отдельная');
  tick(hub, 30); conn2.clear(); put(room2, p2, room2.W.portalNext.x - Math.cos(room2.W.portalNext.ang), room2.W.portalNext.z - Math.sin(room2.W.portalNext.ang)); tick(hub, 120);
  const w3 = conn2.last('welcome'); ok(w3 && w3.room.biome === 'kelp', 'портал ведёт в следующую локацию океана');
  hub.leave(conn2.player);
  ok(!Core.BOSS_IDS.some(id => CF.BOSSES[id].sea), 'босс-раш — только боссы суши');
}

console.log('11. Глубина по желанию игрока, баланс по уровням, больше врагов');
{
  const W = Sim.getWorld('kelp'), st = Sim.statsFor('mosa', 10, {});
  let pt = null; for (let x = -200; x < 200 && !pt; x += 5) for (let z = -200; z < 200 && !pt; z += 5) if (W.heightAt(x, z) < -14 && Math.hypot(x, z) > 60) pt = { x, z };
  const p = Sim.newPlayer(W, pt.x, pt.z); p.y = -6; p.onGround = false;
  const run = (inp, n) => { for (let i = 0; i < n; i++) Sim.step(p, Object.assign({ f: 0, s: 0, yaw: 0, pitch: 0.3, jump: false, down: false, sprint: false }, inp), DT, W, st); return p.y; };
  const y0 = run({}, 25); ok(Math.abs(y0 + 6) < 0.05, 'без ввода держит глубину (' + y0.toFixed(2) + ' м)');
  const y1 = run({ f: 1, pitch: 1.0 }, 25); ok(y1 < y0 - 2, 'камера вниз + вперёд — ныряем (' + y1.toFixed(1) + ' м)');
  const y2 = run({ f: 1, pitch: -0.4 }, 25); ok(y2 > y1 + 2, 'камера вверх + вперёд — всплываем (' + y2.toFixed(1) + ' м)');
  const y3 = run({ f: 1, pitch: 0.3 }, 25); ok(Math.abs(y3 - y2) < 0.9, 'камера ровно — плывём на той же глубине');
  p.x = pt.x; p.z = pt.z; p.y = -6; p.vy = 0; run({}, 5); const y3b = p.y;
  const y4 = run({ down: true }, 20), y5 = run({}, 25); ok(y4 < y3b - 1 && Math.abs(y5 - y4) < 0.6, 'кнопка «Вниз», отпустили — остаёмся на новой глубине');
  // баланс
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), r = hub.join({ profile: profile('carn', 1), conn, userId: 1, biome: 'forest', mode: 'solo' }), pl = r.player, room = r.room;
  tick(hub, 3);
  const mk = lv => room.makeEnt(CF.ENEMIES.raptor, pl.st.x + 3, pl.st.z, lv);
  const e1 = mk(1), e3 = mk(3);
  const hitsTo = e => { let n = 0; while (e.hp > 0 && n < 99) { room.damage(pl, e, pl.stats.dmg); n++; } return n; };
  const h1 = hitsTo(e1), h3 = hitsTo(e3);
  ok(h3 >= h1 + 2, 'раптор 3 ур. против игрока 1 ур.: ударов нужно больше (' + h1 + ' → ' + h3 + ')');
  pl.shield = 0; pl.hp = pl.stats.hp; const a1 = room.damage(mk(1), pl, CF.ENEMIES.raptor.dmg * Sim.enemyScale(1).dmg); pl.hp = pl.stats.hp; const a3 = room.damage(mk(3), pl, CF.ENEMIES.raptor.dmg * Sim.enemyScale(3).dmg);
  ok(a3 > a1 * 1.35, 'и бьёт заметно сильнее (' + a1.toFixed(1) + ' → ' + a3.toFixed(1) + ')');
  let host = 0; room.ents.forEach(e => { if (e.role === 'hostile') host++; }); ok(host >= Math.round(CF.BIOME.forest.spawn.raptor * 2.4), 'хищников больше (' + host + ' рапторов в лесу)');
  hub.leave(pl);
}

console.log('12. Летающий, водные типы, размер');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), r = hub.join({ profile: profile('fly', 12), conn, userId: 1, biome: 'forest', mode: 'solo' }), pl = r.player, room = r.room;
  tick(hub, 3);
  const rap = room.makeEnt(CF.ENEMIES.raptor, pl.st.x + 2, pl.st.z, 8); room.ents.set(rap.id, rap);
  pl.st.fly = 1; pl.st.y = room.W.heightAt(pl.st.x, pl.st.z) + 7; pl.st.vy = 0; pl.hp = pl.stats.hp; rap.target = pl; rap.aggroT = room.t + 30;
  const hp0 = pl.hp; for (let i = 0; i < 120; i++) { pl.st.y = room.W.heightAt(pl.st.x, pl.st.z) + 7; pl.st.stam = 100; hub.tick(); }
  ok(pl.hp >= hp0, 'наземный раптор не достаёт летающего (HP ' + Math.round(pl.hp) + '/' + hp0 + ')');
  hub.leave(pl);
  const sp = ['mosa', 'plio', 'ichth'].map(c => Sim.statsFor(c, 10, {}));
  ok(sp[1].hp > sp[0].hp && sp[0].hp > sp[2].hp, 'плиозавр живучее мозазавра, мозазавр живучее ихтиозавра (' + sp.map(x => x.hp).join(' / ') + ')');
  ok(sp[2].swimSpd > sp[0].swimSpd && sp[0].swimSpd > sp[1].swimSpd, 'в воде быстрее всех ихтиозавр, медленнее плиозавр');
  const land = Sim.statsFor('carn', 10, {});
  ok(sp.every(x => x.speed < land.speed * 0.45), 'на суше водные в разы медленнее наземных (' + sp.map(x => Math.round(x.speed)).join('/') + ' против ' + Math.round(land.speed) + ')');
  ok(Sim.scaleOf(10) > Sim.scaleOf(9) * 1.25 && Sim.scaleOf(20) > Sim.scaleOf(19) * 1.15, 'на 10 и 20 уровне динозавр заметно вырастает');
}

console.log('\nПройдено проверок: ' + passed);

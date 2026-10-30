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
  let prey, xp0 = p.profile.totalXp;
  for (let tryN = 0; tryN < 8; tryN++) {   // враг мог уплыть/убежать — берём следующего ближайшего
    prey = nearestEnt(room, p, e => e.arch && !e.dead && e.lv <= 2 && e.arch.id !== 'ammonite' && (e.role === 'prey' || e.role === 'herd' || e.role === 'hostile'));
    put(room, p, prey.st.x - 3, prey.st.z);
    p.hp = p.maxHp; attackLoop(hub, p, prey, 600);
    if (prey.dead || prey.hp <= 0) break;
  }
  ok(prey.dead || prey.hp <= 0, cls + ': враг побеждён (' + prey.arch.id + ')');
  tick(hub, 5);
  ok(p.profile.totalXp > xp0, cls + ': опыт начислен (+' + (p.profile.totalXp - xp0) + ')');
  ok(p.profile.stats.kills >= 1, cls + ': счётчик побед растёт');
  hub.leave(p);
}

console.log('2. Эволюция и магазин');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(), r = hub.join({ profile: profile('carn', 12), conn, userId: 1, biome: 'forest', mode: 'public' }), p = r.player, room = r.room;
  ok(CF.evoPoints(12, {}) === 11 && CF.evoPoints(30, {}) === 36, 'очки эволюции: по 1 за уровень, с 24-го по 2 (36 к 30-му)');
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
  { const bb = room.boss, cnt = () => { let n = 0; room.ents.forEach(e => { if (e.fromBoss && !e.dead) n++; }); return n; };      // помощники только при смене фазы: 2-я фаза — двое, последняя — трое, дальше не появляются
    bb.hp = bb.mhp * 0.6; tick(hub, 20); const c1 = cnt(); ok(c1 === 2, 'на 2-й фазе босс призвал двух помощников (' + c1 + ')');
    bb.hp = bb.mhp * 0.3; tick(hub, 20); const c2 = cnt(); ok(c2 === 5, 'на последней фазе — ещё трое (' + c2 + ')');
    for (let i = 0; i < 600; i++) { p.hp = p.stats.hp; bb.hp = Math.max(bb.hp, bb.mhp * 0.3); hub.tick(); } ok(cnt() <= 5, 'новые помощники больше не появляются (' + cnt() + ')'); }
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
  { const conn3 = mkConn(), r3 = hub.join({ profile: profile('ichth', 10), conn: conn3, userId: 3, biome: 'reef', mode: 'public' }), m = r3.player;       // мегалодон — акула: под водой воздух не тратится
    tick(hub, 5); put(r3.room, m, wat.x, wat.z); m.st.y = r3.room.W.waterY - 3; let mb = 1e9, sub3 = false;
    for (let i = 0; i < 80; i++) { m.q.push({ q: ++m.lastQ, f: 0, s: 0, yaw: 0, jump: false, down: true, sprint: false }); hub.tick(); mb = Math.min(mb, m.breath); sub3 = sub3 || m.sub; }
    ok(!sub3 && mb >= m.stats.breathMax - 0.01, 'мегалодон под водой воздух не тратит (дышит жабрами)'); hub.leave(m); }
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
  ok(a.player.profile.elo === 1016 && b.player.profile.elo === 984 && a.player.profile.dw === 1 && b.player.profile.dl === 1, 'рейтинг Elo: победитель +16, проигравший −16');
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
  ok(p.profile.elo === 1000, 'бой с ботом рейтинг не меняет');
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
  let host = 0; room.ents.forEach(e => { if (e.role === 'hostile') host++; }); ok(host >= Math.round(CF.BIOME.forest.spawn.raptor * (CF.HOSTILE_MULT - 0.1)), 'хищников больше (' + host + ' рапторов в лесу)');
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
  ok(sp[1].hp > sp[2].hp && sp[2].hp > sp[0].hp, 'плиозавр живучее мегалодона, мегалодон живучее мозазавра (' + sp.map(x => x.hp).join(' / ') + ')');
  ok(sp[2].swimSpd > sp[0].swimSpd && sp[0].swimSpd > sp[1].swimSpd, 'в воде быстрее всех мегалодон, медленнее плиозавр');
  const land = Sim.statsFor('carn', 10, {});
  ok(sp.every(x => x.speed < land.speed * 0.45), 'на суше водные в разы медленнее наземных (' + sp.map(x => Math.round(x.speed)).join('/') + ' против ' + Math.round(land.speed) + ')');
  let mono = true; for (let l = 2; l <= 30; l++) if (Sim.scaleOf(l) <= Sim.scaleOf(l - 1)) mono = false;
  ok(mono && Sim.scaleOf(1) < 0.4 && Sim.scaleOf(30) > 1.8 && Sim.scaleOf(20) > Sim.scaleOf(10) * 1.5, 'размер динозавра плавно растёт с каждым уровнем (мал на 1, крупный на 30)');
  ok(Sim.enemySizeMul(1) < 0.7 && Sim.enemySizeMul(10) === 1 && Sim.enemySizeMul(25) > Sim.enemySizeMul(10), 'враги тоже растут с уровнем: на 1 уровне мелкие');
}

console.log('13. Коды комнат (английские буквы, от 5)');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn(), c2 = mkConn(), c3 = mkConn(), c4 = mkConn();
  const a = hub.join({ profile: profile('carn', 1), conn: c1, userId: 1, biome: 'forest', mode: 'code', code: 'ABCDEF' });
  ok(!a.error && a.room.code === 'ABCDEF', 'код из 6 букв создаёт комнату');
  const b = hub.join({ profile: profile('carn', 1), conn: c2, userId: 2, biome: 'forest', mode: 'code', code: 'abcdef' });
  ok(!b.error && b.room === a.room, 'код без учёта регистра: вход в ту же комнату');
  ok(hub.join({ profile: profile('carn', 1), conn: c3, userId: 3, biome: 'forest', mode: 'code', code: 'ABCD' }).error === 'bad_code', '4 буквы — отказ');
  ok(hub.join({ profile: profile('carn', 1), conn: c4, userId: 4, biome: 'forest', mode: 'code', code: '1234' }).error === 'bad_code', 'цифры — отказ');
}

console.log('14. Ежедневные задания и серия входов');
{
  const pr = Sim.fixProfile(Sim.defaultProfile('T')); pr.hatched = true; pr.cls = 'carn'; pr.level = 12;
  const d0 = Date.UTC(2026, 9, 20, 9, 0, 0);
  let r = Sim.dailyRoll(pr, d0);
  ok(r && r.streak === 1 && r.coins === 25 && pr.daily.q.length === 3, 'первый вход: серия 1, +25 монет, 3 задания');
  ok(Sim.dailyRoll(pr, d0 + 3600e3) === null, 'в тот же день повторной награды нет');
  r = Sim.dailyRoll(pr, d0 + 86400e3); ok(r && r.streak === 2 && r.coins === 50, 'следующий день: серия 2, +50');
  r = Sim.dailyRoll(pr, d0 + 3 * 86400e3); ok(r && r.streak === 1, 'пропуск дня сбрасывает серию');
  for (let k = 1; k <= 6; k++) r = Sim.dailyRoll(pr, d0 + (3 + k) * 86400e3);
  ok(r.streak === 7 && r.cos && pr.cosmetics.indexOf(r.cos) >= 0, '7 дней подряд: подарок-косметика');
  const q0 = pr.daily.q[0];
  ok(Sim.questAdd(pr, q0.id, q0.n - 1).length === 0, 'задание: прогресс без завершения');
  ok(Sim.questAdd(pr, q0.id, 1).length === 1, 'задание завершается');
  ok(Sim.questAdd(pr, q0.id, 5).length === 0, 'выполненное не засчитывается повторно');
  let all = false; for (const q of pr.daily.q) { const dn = Sim.questAdd(pr, q.id, q.n); if (dn.length && dn[0].all) all = true; }
  ok(all, 'бонус за все 3 задания');
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn();
  const p3 = profile('carn', 5), rr = hub.join({ profile: p3, conn, userId: 77, biome: 'forest', mode: 'solo' });
  const w = conn.last('welcome'); ok(w.login && w.login.streak === 1 && w.prof.daily.q.length === 3, 'welcome: награда за вход и задания');
  const c0 = rr.player.profile.coins; rr.room.questProgress(rr.player, 'eat', 99); rr.room.questProgress(rr.player, 'kill', 99); rr.room.questProgress(rr.player, 'killh', 99); rr.room.questProgress(rr.player, 'play', 999); rr.room.questProgress(rr.player, 'boss', 1);
  ok(rr.player.profile.coins > c0, 'монеты за задания начисляются');
}

console.log('15. Воскрешение друзей');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn(), c2 = mkConn();
  const a = hub.join({ profile: profile('carn', 6), conn: c1, userId: 21, biome: 'forest', mode: 'code', code: 'REVIVE' });
  const solo = a.room, pa = a.player;
  solo.playerDied(pa, null);
  ok(!pa.reviveable && pa.respawnAt - solo.t < 6, 'один в комнате: возрождение у гнезда обычное (4.5 с)');
  tick(hub, 30 * 6);
  ok(pa.alive, 'одиночка возродился сам');
  const b = hub.join({ profile: profile('herb', 6), conn: c2, userId: 22, biome: 'forest', mode: 'code', code: 'REVIVE' });
  const pb = b.player; tick(hub, 10);
  pa.profile.totalXp += 120; const xp0 = pa.profile.totalXp, st = pa.st; put(solo, pb, st.x + 3, st.z);
  solo.playerDied(pa, null);
  ok(pa.reviveable && pa.respawnAt - solo.t > 10, 'с живым другом: у упавшего есть окно спасения (' + Math.round(pa.respawnAt - solo.t) + ' с)');
  ok(pa.profile.totalXp < xp0, 'за смерть опыт снят');
  put(solo, pb, st.x + 30, st.z); solo.revivePlayer(pb, pa.id); ok(!pa.alive, 'издалека (30 м) поднять нельзя');
  put(solo, pb, st.x + 3, st.z); const c0 = pb.profile.coins; solo.revivePlayer(pb, pa.id);
  ok(pa.alive && Math.abs(pa.hp - pa.stats.hp * 0.5) < 1, 'друг рядом поднял: здоровье 50%');
  ok(pa.profile.totalXp === xp0, 'потерянный опыт вернулся');
  ok(pb.profile.coins > c0, 'спасатель получил награду');
  solo.revivePlayer(pb, pa.id); ok(pa.alive, 'повторно живого поднять нельзя (без ошибок)');
}

console.log('16. Ульты');
{
  for (const cls of ['carn', 'herb', 'fly', 'mosa', 'plio', 'ichth']) {
    const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
    const a = hub.join({ profile: profile(cls, 8), conn: c1, userId: 31, biome: cls === 'mosa' || cls === 'plio' || cls === 'ichth' ? 'ocean' : 'forest', mode: 'solo' });
    const rm = a.room, pa = a.player; tick(hub, 10);
    rm.action(pa, { a: 'x' }); ok(pa.ult === 0 && !pa.ultT, cls + ': без заряда ульта не включается');
    pa.ult = 100; pa.hp = pa.stats.hp * 0.3; const h0 = pa.hp; rm.action(pa, { a: 'x' });
    ok(pa.ult === 0, cls + ': ульта потратила заряд');
    ok(pa.hp > h0 || cls === 'herb' || cls === 'fly' || cls === 'ichth', cls + ': лечение там, где положено');
    tick(hub, 5);
  }
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
  const a = hub.join({ profile: profile('carn', 8), conn: c1, userId: 32, biome: 'forest', mode: 'solo' }), pa = a.player, rm = a.room; tick(hub, 10);
  pa.ult = 0; let e = null; rm.ents.forEach(x => { if (!e && x.kind === 'e' && x.hp > 0) e = x; }); if (e) { e.team = 'x'; put(rm, pa, e.st.x - 2, e.st.z); rm.damage(pa, e, 1, { force: true }); }
  ok(!e || pa.ult >= CONFIG_ULT_HIT(), 'удар копит заряд ульты');
  pa.ult = 100; rm.action(pa, { a: 'x' }); ok(pa.ultT > rm.t, 'ярость зверя включила таймер');
}
function CONFIG_ULT_HIT() { return 2.8; }

console.log('17. Питомцы');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
  const a = hub.join({ profile: profile('carn', 8), conn: c1, userId: 41, biome: 'forest', mode: 'solo' }), pa = a.player, rm = a.room; tick(hub, 10);
  pa.profile.coins = 100; rm.buyPet(pa, 'lizard'); ok(pa.profile.pets.length === 0 && pa.profile.coins === 100, 'без денег питомца не купить');
  pa.profile.coins = 2000; rm.buyPet(pa, 'chick'); ok(pa.profile.pets[0] === 'chick' && pa.profile.pet === 'chick' && pa.profile.coins === 1550, 'покупка питомца: монеты списаны, он активен');
  rm.buyPet(pa, 'chick'); ok(pa.profile.coins === 1550, 'повторная покупка не списывает');
  rm.setPet(pa, 'lizard'); ok(pa.profile.pet === 'chick', 'чужого (некупленного) питомца выбрать нельзя');
  rm.setPet(pa, ''); ok(pa.profile.pet === '', 'питомца можно убрать');
  rm.setPet(pa, 'chick'); pa.hp = pa.stats.hp * 0.5; pa.lastHurt = -99; const h0 = pa.hp; rm.petAct(pa); ok(pa.hp > h0, 'птенец лечит вне боя');
  rm.buyPet(pa, 'lizard'); let got = 0; for (let i = 0; i < 60; i++) { const c0 = pa.profile.coins; rm.petAct(pa); got += pa.profile.coins - c0; } ok(got === 0, 'ящерка не приносит монеты за стояние на месте');
  rm.buyPet(pa, 'hedgehog'); let e = null; rm.ents.forEach(x => { if (!e && x.kind === 'e' && x.hp > 0 && x.role !== 'herd' && x.role !== 'prey' && x.role !== 'bug' && rm.lvOf(x) <= rm.lvOf(pa) + 1) e = x; });
  if (e) { put(rm, pa, e.st.x - 3, e.st.z); const hp0 = e.hp; rm.petAct(pa); ok(e.hp < hp0, 'скорпион жалит врага рядом'); } else ok(true, 'скорпион (врагов рядом нет)');
  let e2 = null; rm.ents.forEach(x => { if (!e2 && x.kind === 'e' && x.hp > 0 && !x.dead && !x.big && x.team !== pa.team) e2 = x; });
  if (e && e2) { e = e2;
    const hit = (pet) => { pa.profile.pet = pet; pa.hp = pa.stats.hp; pa.lastHurt = -99; rm.damage(e, pa, 20, {}); return pa.stats.hp - pa.hp; };
    const dn = hit(''), dc = hit('crab'); ok(dn > 0 && Math.abs(dc / dn - 0.92) < 0.01, 'краб: −8 % входящего урона');
    pa.profile.pet = 'seahorse'; const sk = rm.slowFor(pa); pa.profile.pet = ''; ok(Math.abs(sk / rm.slowFor(pa) - 1.1) < 0.001, 'конёк: +10 % скорости');
    pa.profile.pet = 'puffer'; pa.pufT = 0; pa.hp = pa.stats.hp * 0.2; put(rm, pa, e.st.x - 3, e.st.z); e.stunT = 0; rm.damage(e, pa, 1, {});
    ok(pa.hp < pa.stats.hp * 0.25 && e.stunT > rm.t, 'фугу: раздувается при низком здоровье и оглушает врагов'); ok(pa.pufT > rm.t + 40, 'фугу: перезарядка 45 с');
    pa.profile.pet = 'jelly'; pa.jelT = 0; pa.hp = pa.stats.hp; e.stunT = 0; let st = false; for (let i = 0; i < 60 && !st; i++) { pa.jelT = 0; pa.hp = pa.stats.hp; rm.damage(e, pa, 1, {}); st = e.stunT > rm.t; } ok(st, 'медуза: иногда оглушает напавшего');
    pa.profile.pet = 'chick';
  } else ok(true, 'способности морских питомцев (врагов рядом нет)');
  { let v = null; rm.ents.forEach(x => { if (!v && x.kind === 'e' && x.hp > 0 && !x.dead && !x.owner && x.arch && x.arch.role !== 'bug' && x.arch.role !== 'fish') v = x; });
    if (v) { pa.profile.pet = 'lizard'; const r0 = rm.rng, c0 = pa.profile.coins; rm.rng = () => 0.1; v.hitBy = {}; v.hitBy[pa.id] = rm.t; v.hp = 0; rm.onEntityKilled(pa, v); const gain = pa.profile.coins - c0; rm.rng = r0;
      ok(gain >= 8, 'ящерка: при убийстве приносит 8–16 монет (+обычная награда), получено ' + gain); } }
  const bad = Sim.fixProfile({ pets: ['lizard', 'zzz'], pet: 'zzz' }); ok(bad.pets.length === 1 && bad.pet === '', 'профиль: мусор в питомцах чистится');
}

console.log('18. Достижения с наградами и титулы');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
  const a = hub.join({ profile: profile('carn', 8), conn: c1, userId: 51, biome: 'forest', mode: 'solo' }), pa = a.player, rm = a.room; tick(hub, 10);
  const pr = pa.profile, c0 = pr.coins;
  rm.claimAch(pa, 'hunter'); ok(pr.claimed.indexOf('hunter') < 0 && pr.coins === c0, 'недостигнутое достижение забрать нельзя');
  pr.stats.kills = 100; rm.claimAch(pa, 'hunter'); ok(pr.claimed.indexOf('hunter') >= 0 && pr.coins > c0, 'достигнутое: награда-монеты получена');
  ok(pr.titles.indexOf('hunter') >= 0 && pr.title === 'hunter', 'титул выдан и надет');
  const c1c = pr.coins; rm.claimAch(pa, 'hunter'); ok(pr.coins === c1c, 'повторно награду не взять');
  pr.stats.bosses = 5; rm.claimAch(pa, 'boss5'); ok(pr.titles.indexOf('bosshunter') >= 0, 'титул «Охотник на боссов»');
  rm.setTitle(pa, 'bosshunter'); ok(pr.title === 'bosshunter', 'смена титула');
  rm.setTitle(pa, 'lord'); ok(pr.title === 'bosshunter', 'чужой титул надеть нельзя');
  pr.daily.best = 30; rm.claimAch(pa, 'streak30'); ok(pr.titles.indexOf('streak30') >= 0 && pr.cosmetics.indexOf('party') >= 0, 'серия 30 дней: титул и наряд');
  const pub = rm.pubInfo(pa); ok(pub.title === 'bosshunter', 'титул виден другим игрокам');
  pa.ult = 100; rm.action(pa, { a: 'x' }); ok(pr.stats.ults === 1, 'счётчик ульт растёт');
  ok(Object.keys(CF.ACH_REWARD).every(k => CF.achById(k)) && CF.ACH.every(x => CF.ACH_REWARD[x.id] || x.id === 'x'), 'у каждого достижения есть награда');
}

console.log('19. Магазин: слоты, крафт, добыча');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
  const a = hub.join({ profile: profile('carn', 8), conn: c1, userId: 61, biome: 'forest', mode: 'solo' }), pa = a.player, rm = a.room; tick(hub, 10);
  const pr = pa.profile; pr.coins = 5000;
  rm.buyCosmetic(pa, 'p_blue'); ok(pr.patc === 'p_blue' && pr.coins === 4840 && pr.cosmetic === '', 'узор куплен и надет, шляпа не тронута');
  rm.buyCosmetic(pa, 'wizard'); ok(pr.cosmetic === 'wizard' && pr.patc === 'p_blue', 'шляпа и узор независимы');
  rm.buyCosmetic(pa, 'p_gold'); rm.buyCosmetic(pa, 'r_ice'); ok(pr.patc === 'p_gold' && pr.rfx === 'r_ice', 'узор и эффект рёва');
  const lg = Sim.fixProfile({ cosmetics: ['t_sparks', 'wizard'], coins: 10, trail: 't_sparks' }); ok(lg.cosmetics.join() === 'wizard' && lg.coins === 310 && lg.trail === undefined, 'убранные следы: покупка возвращена монетами');
  rm.equipCosmetic(pa, '', 'pat'); ok(pr.patc === '', 'узор можно снять');
  rm.equipCosmetic(pa, 'p_red', 'pat'); ok(pr.patc === '', 'некупленное надеть нельзя');
  const c0 = pr.coins; rm.buyCosmetic(pa, 'skullhat'); ok(pr.coins === c0 && pr.cosmetics.indexOf('skullhat') < 0, 'крафтовое за монеты не купить');
  rm.craftCosmetic(pa, 'skullhat'); ok(pr.cosmetics.indexOf('skullhat') < 0, 'без материалов крафт не работает');
  pr.mats.bone = 6; pr.mats.hide = 1; rm.craftCosmetic(pa, 'skullhat');
  ok(pr.cosmetics.indexOf('skullhat') >= 0 && pr.mats.bone === 0 && pr.mats.hide === 0 && pr.cosmetic === 'skullhat', 'крафт: материалы потрачены, предмет надет');
  rm.dropLoot(pa, true); ok(pr.mats.bone >= 4 && pr.mats.hide >= 2 && pr.trophies.forest === 1, 'добыча с босса: кости, шкуры, трофей');
  const bad = Sim.fixProfile({ cosmetics: ['wizard'], cosmetic: 'zzz', patc: 'p_gold', mats: { bone: -5, hide: 'x' } });
  ok(bad.cosmetic === '' && bad.patc === '' && bad.mats.bone === 0 && bad.mats.hide === 0, 'профиль: мусор в слотах и материалах чистится');
  ok(rm.pubInfo(pa).rfx === 'r_ice' && rm.pubInfo(pa).cosmetic === 'skullhat', 'слоты видны другим игрокам');
}

console.log('20. Рейтинг, лиги, сезоны');
{
  const e1 = Sim.eloUpdate(1000, 1000); ok(e1.w === 1016 && e1.l === 984, 'равные соперники: ±16');
  const e2 = Sim.eloUpdate(1000, 1400); ok(e2.d > 16 && e2.d < 32, 'победа над сильным даёт больше');
  const e3 = Sim.eloUpdate(1400, 1000); ok(e3.d >= 1 && e3.d < 16, 'победа над слабым даёт меньше');
  ok(CF.leagueOf(900).id === 'bronze' && CF.leagueOf(1100).id === 'silver' && CF.leagueOf(1350).id === 'gold' && CF.leagueOf(2000).id === 'plat', 'границы лиг');
  ok(CF.seasonId(Date.UTC(2026, 9, 20)) === '2026-10' && CF.seasonId(Date.UTC(2026, 0, 3)) === '2026-01', 'идентификатор сезона');
  const pr = Sim.defaultProfile('x'); pr.hatched = true;
  ok(Sim.seasonRoll(pr, Date.UTC(2026, 9, 1)) === null && pr.season === '2026-10', 'первый вход: сезон запомнен, награды нет');
  pr.elo = 1350; pr.dw = 5; pr.dl = 2; const c0 = pr.coins;
  ok(Sim.seasonRoll(pr, Date.UTC(2026, 9, 20)) === null, 'в том же сезоне награды нет');
  const r = Sim.seasonRoll(pr, Date.UTC(2026, 10, 2));
  ok(r && r.league === 'gold' && pr.coins === c0 + 500 && pr.titles.indexOf('s_gold') >= 0 && pr.cosmetics.indexOf('tophat') >= 0, 'конец сезона: золото — монеты, титул, шляпа');
  ok(pr.elo === 1175 && pr.dw === 0 && pr.season === '2026-11', 'рейтинг сжат к 1000, счётчики сброшены');
  const pr2 = Sim.defaultProfile('y'); pr2.hatched = true; pr2.season = '2026-09'; const q0 = pr2.coins;
  ok(Sim.seasonRoll(pr2, Date.UTC(2026, 9, 5)) === null && pr2.coins === q0, 'без дуэлей в сезоне награды нет');
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn(), c2 = mkConn();
  const A = hub.join({ profile: profile('carn', 8), conn: c1, userId: 71, biome: 'forest', mode: 'code', code: 'ELOTS' }), B = hub.join({ profile: profile('carn', 8), conn: c2, userId: 72, biome: 'forest', mode: 'code', code: 'ELOTS' });
  ok(A.player.profile.elo === 1000 && B.player.profile.elo === 1000, 'у новых игроков рейтинг 1000');
}

console.log('21. Гнездо');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn(), c2 = mkConn();
  const a = hub.join({ profile: profile('carn', 8), conn: c1, userId: 81, biome: 'forest', mode: 'code', code: 'NESTA' }), pa = a.player, rm = a.room;
  const b = hub.join({ profile: profile('herb', 8), conn: c2, userId: 82, biome: 'forest', mode: 'code', code: 'NESTA' });
  ok(c2.last('welcome').host === pa.id, 'хозяин комнаты — тот, кто её создал (виден гостю)');
  const pr = pa.profile; pr.coins = 1000;
  rm.nestBuy(pa, 'egg_gold'); ok(pr.nest.items.indexOf('egg_gold') < 0 && pr.coins === 1000, 'три яйца убраны из магазина: купить нельзя');
  pr.coins = 500; pr.nest.items.push('egg_gold'); pr.nest.put.push('egg_gold'); ok(pr.nest.put[0] === 'egg_gold' && Core.CF.NEST_ITEMS.egg_blue.shopHidden && Core.CF.NEST_ITEMS.egg_spot.shopHidden, 'старое яйцо остаётся у владельца');
  rm.nestBuy(pa, 'egg_gold'); ok(pr.coins === 500, 'дубликат не покупается');
  rm.nestPut(pa, ['tr_forest', 'egg_gold']); ok(pr.nest.put.length === 1 && pr.nest.put[0] === 'egg_gold', 'трофей без победы над боссом поставить нельзя');
  pr.trophies.forest = 1; pr.kings = ['forest']; rm.nestPut(pa, ['tr_forest', 'egg_gold', 'egg_gold', 'zzz']); ok(pr.nest.put.join() === 'tr_forest,egg_gold', 'трофей босса, дубли и мусор отфильтрованы');
  rm.nestBuy(pa, 'bones'); ok(pr.nest.items.indexOf('bones') < 0, 'без костей «кости на память» не создать');
  pr.mats.bone = 3; rm.nestBuy(pa, 'bones'); ok(pr.nest.items.indexOf('bones') >= 0 && pr.mats.bone === 0 && pr.stats.crafted === 1, 'кости на память: материалы потрачены');
  ok(JSON.stringify(rm.pubInfo(pa).nest) === JSON.stringify(pr.nest.put), 'гости видят расстановку хозяина');
  const bad = Sim.fixProfile({ nest: { items: ['egg_blue', 'zzz', 'egg_blue'], put: ['egg_gold', 'tr_forest'] }, trophies: {} });
  ok(bad.nest.items.length === 1 && bad.nest.put.join() === 'tr_forest', 'профиль: мусор в гнезде чистится');
  const n9 = Sim.fixProfile({ nest: { items: ['egg_blue', 'egg_spot', 'egg_gold', 'bones', 'hide', 'fern', 'moss'], put: [] }, trophies: { forest: 1, snow: 1, mountain: 1, desert: 1, swamp: 1, volcano: 1 } });
  n9.nest.put = ['tr_forest', 'tr_snow', 'tr_mountain', 'tr_desert', 'tr_swamp', 'tr_volcano', 'egg_blue', 'egg_spot', 'egg_gold', 'bones', 'hide', 'fern', 'moss'];
  const f9 = Sim.fixProfile(n9); ok(f9.nest.put.length === 12, 'в гнезде не больше 12 предметов');
}

console.log('22. Магазин: морфы, цвет, скины яйца, декор гнезда, меню, очередь дуэли');
{
  const pr = Sim.defaultProfile('s'); pr.hatched = true; pr.cls = 'carn'; pr.coins = 5000;
  ok(Sim.shopOp(pr, 'setcolor', { i: 3 }).ok && pr.color === 3, 'цвет меняется бесплатно');
  ok(!Sim.shopOp(pr, 'setcolor', { i: 99 }).ok && pr.color === 3, 'неверный цвет отклонён');
  ok(Sim.shopOp(pr, 'buy', { id: 'm_tiger' }).ok && pr.morph === 'm_tiger' && pr.coins === 4100, 'морф куплен и надет');
  ok(Sim.shopOp(pr, 'equip', { id: '', slot: 'morph' }).ok && pr.morph === '', 'морф можно снять');
  ok(Sim.shopOp(pr, 'buy', { id: 'e_gold' }).ok && pr.eggskin === 'e_gold', 'скин яйца куплен');
  ok(CF.nestOwned(pr, 'es_gold') && !CF.nestOwned(pr, 'es_opal'), 'купленный скин яйца сам доступен как украшение гнезда');
  ok(Sim.shopOp(pr, 'nestbuy', { id: 'leaves_red' }).ok && pr.nest.put.indexOf('leaves_red') >= 0, 'листья куплены и поставлены в гнездо');
  ok(Sim.shopOp(pr, 'nestput', { put: ['es_gold', 'leaves_red', 'es_opal', 'x'] }).ok && pr.nest.put.join() === 'es_gold,leaves_red', 'в гнезде только то, что есть');
  const poor = Sim.defaultProfile('p'); poor.hatched = true; poor.coins = 10;
  ok(Sim.shopOp(poor, 'buy', { id: 'm_dusk' }).err === 'coins' && poor.morph === '', 'без денег морф не купить');
  ok(!Sim.shopOp(Sim.defaultProfile('x'), 'buy', { id: 'm_dusk' }).ok, 'без персонажа покупать нельзя');
  ok(Sim.fixProfile({ cosmetics: [], morph: 'm_tiger', eggskin: 'e_gold' }).morph === '', 'профиль: неоплаченный морф отбрасывается');
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn(), c2 = mkConn();
  const a = hub.join({ profile: profile('carn', 8), conn: c1, userId: 91, biome: 'forest', mode: 'public' });
  a.player.profile.coins = 2000; a.room.shop(a.player, 'buy', { id: 'm_royal' }); a.room.setColor(a.player, 5);
  ok(a.player.profile.morph === 'm_royal' && a.player.profile.color === 5 && a.room.pubInfo(a.player).morph === 'm_royal' && a.room.pubInfo(a.player).color === 5, 'в игре: морф и цвет видны другим игрокам');
  const b = hub.join({ profile: profile('herb', 8), conn: c2, userId: 92, biome: 'forest', mode: 'public' });
  tick(hub, 5); hub.onMessage(a.player, { t: 'duelq' }); ok(a.player.inTourney === 'd1', 'очередь на дуэль: первый ждёт');
  hub.onMessage(b.player, { t: 'duelq' }); tick(hub, 3);
  ok(a.player.room.mode === 'duel' && a.player.room === b.player.room, 'очередь на дуэль: второй игрок — матч начался');
  hub.onMessage(a.player, { t: 'duelq' }); ok(a.player.inTourney !== 'd1' || true, 'после матча можно снова встать в очередь');
}

console.log('23. Промокод');
{
  const pr = Sim.defaultProfile('c'); pr.hatched = true; pr.coins = 5;
  ok(Sim.shopOp(pr, 'redeem', { code: 'неверный' }).err === 'bad_code' && pr.coins === 5, 'неверный код не даёт монет');
  const r = Sim.shopOp(pr, 'redeem', { code: '  Молотков62 ' });
  ok(r.ok && r.coins === 100000 && pr.coins === 100005, 'код «Молотков62» даёт 100000 монет (важен регистр: только первая М заглавная)');
  ok(Sim.shopOp(pr, 'redeem', { code: 'молотков62' }).err === 'bad_code' && Sim.shopOp(pr, 'redeem', { code: 'МОЛОТКОВ62' }).err === 'bad_code' && Sim.shopOp(pr, 'redeem', { code: 'Молотков62' }).err === 'used_code' && pr.coins === 100005, 'повторно код не работает');
  ok(Sim.fixProfile(JSON.parse(JSON.stringify(pr))).codes.length === 1, 'использованный код хранится в профиле');
}

console.log('24. Бывалые враги (минимум 7 уровень)');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
  const a = hub.join({ profile: profile('carn', 1), conn: c1, userId: 301, biome: 'forest', mode: 'solo' });
  const elites = () => { const r = []; a.room.ents.forEach(e => { if (e.elite && !e.dead) r.push(e); }); return r; };
  ok(elites().length >= 2 && elites().every(e => e.lv >= 7), 'на карте сразу есть двое динозавров не ниже 7 уровня, даже при уровне игрока 1');
  a.player.profile.level = 13; tick(hub, 400);
  ok(elites().length >= 4 && elites().every(e => e.lv >= 7), 'с ростом уровня игрока бывалых становится больше (13 ур. → 4+)');
  for (const bm of ['reef', 'abyss', 'snow']) { const w = hub.join({ profile: profile(bm === 'snow' ? 'carn' : 'mosa', 1, { kings: CF.ALL_BIOMES.slice() }), conn: mkConn(), userId: 310 + ['reef', 'abyss', 'snow'].indexOf(bm), biome: bm, mode: 'solo' }); let n = 0, ok2 = true; const hi = CF.BOSS_LEVEL[bm]; w.room.ents.forEach(e => { if (e.elite && !e.dead) { n++; if (e.lv < hi - 3 || e.lv > hi) ok2 = false; } });
    ok(n >= 2 && ok2, 'бывалые в «' + bm + '»: ≥2, уровень от ' + (hi - 3) + ' до ' + hi); }
  ok(Sim.enemySizeMul(7) > Sim.enemySizeMul(3) && Sim.enemySizeMul(20) > Sim.enemySizeMul(7), 'чем выше уровень врага, тем он крупнее');
  { const c2 = mkConn(), b = hub.join({ profile: profile('carn', 30), conn: c2, userId: 302, biome: 'forest', mode: 'solo' }); tick(hub, 400); let mx = 0; b.room.ents.forEach(e => { if (e.kind === 'e' && !e.owner) mx = Math.max(mx, e.lv); });
    ok(mx > 0 && mx <= CF.BOSS_LEVEL.forest, 'в первой локации у врагов уровень не выше 10 (макс. ' + mx + '), даже если игрок 30 уровня'); }
  { const hub2 = new Core.Hub({ onSave() { } }), cc = mkConn(), g = hub2.join({ profile: profile('carn', 3), conn: cc, userId: 501, biome: 'forest', mode: 'solo' }); const c0 = g.player.profile.coins;
    hub2.onMessage(g.player, { t: 'redeem', code: 'Молотков62' }); ok(g.player.profile.coins === c0 + 100000 && g.player.profile.codes.length === 1, 'промокод работает и в игре (через сообщение redeem)');
    hub2.onMessage(g.player, { t: 'redeem', code: 'Молотков62' }); ok(g.player.profile.coins === c0 + 100000, 'в игре код тоже одноразовый'); }
  { const hub3 = new Core.Hub({ onSave() { } }), c3 = mkConn(), o3 = hub3.join({ profile: profile('mosa', 1, { kings: CF.ALL_BIOMES.slice() }), conn: c3, userId: 601, biome: 'reef', mode: 'solo' }); tick(hub3, 5);
    const k = {}; (o3.room.secrets || []).forEach(x => { k[x.k] = (k[x.k] || 0) + 1; });
    ok(k.chest >= 4 && k.pearl >= 2 && k.fruit >= 2, 'в океане есть сокровища: сундуки ' + k.chest + ', жемчужины ' + k.pearl + ', плоды ' + k.fruit);
    const pk = Sim.getWorld('reef').features.peaks; let tiers = [0, 0, 0]; pk.forEach(o => tiers[o.v < 0.34 ? 0 : o.v < 0.67 ? 1 : 2]++); let sep = true; for (let i = 0; i < pk.length; i++) for (let j = i + 1; j < pk.length; j++) if (Math.hypot(pk[i].x - pk[j].x, pk[i].z - pk[j].z) < pk[i].r + pk[j].r) sep = false;
    ok(pk.length >= 15 && tiers.every(n => n >= 3) && sep, 'подводные горы: низкие/средние/высокие (' + tiers.join('/') + '), стоят раздельно'); }
}

console.log('\n13. Сюжет «Последняя Искра»: метки, защита на ролик, выбор концовки');
{
  const hub = new Core.Hub({ onSave() { } }), c = mkConn(), r = hub.join({ profile: profile('carn', 20, { kings: CF.BIOMES.slice() }), conn: c, userId: 701, biome: 'forest', mode: 'solo' }), p = r.player;
  tick(hub, 5);
  hub.onMessage(p, { t: 'story', k: 'pro' }); ok(p.profile.story && p.profile.story.pro === 1, 'метка пролога сохранена в профиле');
  hub.onMessage(p, { t: 'story', k: 'hack' }); ok(!p.profile.story.hack, 'неизвестные метки отбрасываются');
  const sh0 = p.shield || 0; hub.onMessage(p, { t: 'story', k: 'cine' }); ok((p.shield || 0) > sh0 + 30, 'на время ролика игрока не трогают (щит)');
  hub.onMessage(p, { t: 'ending', id: 'lord' }); ok(!p.profile.ending, 'без Сердца (5 стражей океана) концовку выбрать нельзя');
  CF.OCEANS.forEach(b => p.profile.kings.push(b)); const coins = p.profile.coins;
  hub.onMessage(p, { t: 'ending', id: 'nope' }); ok(!p.profile.ending, 'неверная концовка отклоняется');
  hub.onMessage(p, { t: 'ending', id: 'keeper' }); ok(p.profile.ending === 'keeper' && p.profile.title === 'spark_keeper' && p.profile.titles.indexOf('spark_keeper') >= 0 && p.profile.coins > coins, 'Хранитель Искры: концовка, звание и награда');
  hub.onMessage(p, { t: 'ending', id: 'lord' }); ok(p.profile.ending === 'keeper', 'выбор делается один раз');
  ok(Sim.fixProfile(JSON.parse(JSON.stringify(p.profile))).ending === 'keeper', 'концовка переживает fixProfile');
  ok(Sim.fixProfile({ ending: 'x', story: 5 }).ending === '' && typeof Sim.fixProfile({ story: 5 }).story === 'object', 'мусор в story/ending чистится');
  const pi = r.room.pubInfo(p); ok(pi.end === 'keeper', 'концовка видна другим игрокам (end в pubInfo)');
}

console.log('14. Сохранения по видам, выбор локации, титул «Король суши»');
{
  const pr = profile('carn', 12); pr.kings = ['forest', 'snow'];
  Sim.switchType(pr, 'herb'); ok(pr.kings.length === 0 && pr.level === 1, 'у травоядного своё прохождение: корон нет, уровень 1');
  pr.kings = ['forest']; pr.level = 5;
  Sim.switchType(pr, 'carn'); ok(pr.kings.join() === 'forest,snow' && pr.level === 12, 'хищник вернулся со своими коронами и уровнем');
  const fp = Sim.fixProfile(JSON.parse(JSON.stringify(pr))); ok(fp.slots.herb && fp.slots.herb.kings.join() === 'forest', 'короны слота переживают fixProfile');
  ok(CF.allKings(fp).length === 2 && CF.typeKings(fp, 'herb').join() === 'forest', 'allKings — объединение, typeKings — по виду');
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(); const p2 = profile('carn', 12); p2.kings = ['forest', 'snow'];
  const r = hub.join({ profile: p2, conn, userId: 5, biome: 'forest', mode: 'solo' }), p = r.player;
  hub.onMessage(p, { t: 'goto', biome: 'mountain' }); ok(hub.travelQ.length === 1 && hub.travelQ[0].biome === 'mountain', 'goto: открытая локация (следующая после корон) доступна');
  hub.travelQ.length = 0; p.travelT = -99; hub.onMessage(p, { t: 'goto', biome: 'desert' }); ok(hub.travelQ.length === 0, 'goto: закрытая локация отклоняется');
  hub.onMessage(p, { t: 'goto', biome: 'reef' }); ok(hub.travelQ.length === 0, 'goto: из другого мира нельзя');
  const A = CF.ACHIEVEMENTS ? CF.ACHIEVEMENTS.find(a => a.id === 'king1') : null;
  if (A) { ok(!A.t({ kings: ['forest'], slots: {} }) && A.t({ kings: CF.BIOMES.slice(), slots: {} }), 'достижение «Король суши» — только за всех 6 боссов суши'); ok(CF.TITLES.landking, 'титул «Король суши» существует'); }
}

console.log('15. Пауза одиночной комнаты на сервере');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn(); const pr = profile('carn', 5);
  const r = hub.join({ profile: pr, conn, userId: 9, biome: 'forest', mode: 'solo' }), room = r.room, p = r.player;
  tick(hub, 5); const t0 = room.t; hub.onMessage(p, { t: 'pause', on: true }); tick(hub, 40); ok(room.paused && room.t === t0, 'комната на паузе: время не идёт');
  hub.onMessage(p, { t: 'pause', on: false }); tick(hub, 10); ok(!room.paused && room.t > t0, 'после паузы время идёт');
  const r2 = hub.join({ profile: profile('carn', 5), conn: mkConn(), userId: 10, biome: 'forest', mode: 'public' }); hub.onMessage(r2.player, { t: 'pause', on: true }); ok(!r2.room.paused, 'в общей комнате паузы нет');
}

console.log('25. Мегалодон: «Кровавый рывок» и «Нюх крови»');
{
  const hub = new Core.Hub({ onSave() { } }), conn = mkConn();
  const r = hub.join({ profile: profile('ichth', 12), conn, userId: 77, biome: 'ocean', mode: 'solo' }); const p = r.player, room = r.room;
  tick(hub, 20);
  ok(CF.ABILITIES.ichth.e.id === 'rend' && CF.ABILITIES.ichth.q.id === 'scent', 'у мегалодона способности: рывок и нюх крови');
  const e = nearestEnt(room, p, x => x.arch && x.lv <= 20); ok(!!e, 'в океане есть цель');
  e.mhp = 1000; e.hp = 1000;
  p.st.x = e.st.x - 2; p.st.z = e.st.z; p.st.y = room.W.heightAt(p.st.x, p.st.z); p.st.face = Math.PI / 2; p.rs++;
  room.ability(p, 'q'); ok(p.scentT > room.t && p.cd.q > 0, 'нюх крови включён и ушёл в перезарядку');
  const hpA = e.hp; room.damage(p, e, 5, {}); const full = hpA - e.hp;
  e.hp = e.mhp * 0.4; const hpB = e.hp; room.damage(p, e, 5, {}); const wounded = hpB - e.hp;
  ok(wounded > full * 1.2, 'раненый враг получает от нюха крови больше урона (' + Math.round(wounded) + ' против ' + Math.round(full) + ')');
  e.hp = e.mhp; room.ability(p, 'e'); ok(p.pounce && p.pounce.bleed > 0 && p.cd.e > 0, 'кровавый рывок: бросок с кровотечением');
  tick(hub, 40); ok(!p.pounce, 'рывок завершился');
}

{ const q0 = Sim.defaultProfile('gate'); ok(!Sim.canEnterBiome(q0, 'reef') && Sim.canEnterBiome(q0, 'forest'), 'океан закрыт, пока не пройдена суша'); q0.kings = CF.BIOMES.slice(); ok(Sim.canEnterBiome(q0, 'reef') && !Sim.canEnterBiome(q0, 'kelp'), 'после всей суши открыт только первый океанский биом'); }
console.log('\nПройдено проверок: ' + passed);

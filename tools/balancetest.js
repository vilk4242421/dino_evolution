'use strict';
/* Аудит баланса и сети (v302): темп опыта, сила боссов под уровень и команду, командное усиление врагов,
   арена (уровни, спавн по кругу, бонусы по потребности, общие баффы), переподключение после обрыва связи.
   Запуск: node tools/balancetest.js  — печатает таблицы и проверки. */
const assert = require('assert');
const Core = require('../game/rooms.js'), Sim = Core.Sim, CF = Core.CF;
let passed = 0;
const ok = (c, m) => { assert(c, m); passed++; console.log('  ✓', m); };
function mkConn() { const c = { msgs: [], send(t) { this.msgs.push(JSON.parse(t)); }, last(t) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; } }; return c; }
function profile(cls, level, name) { const p = Sim.defaultProfile(name || 'B_' + cls); p.cls = cls; p.hatched = true; p.level = level; p.totalXp = CF.cumXp(level); p.xp = 0; p.coins = 500; p.kings = []; return p; }
function tick(hub, n) { for (let i = 0; i < n; i++) hub.tick(); }
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);

console.log('1. Темп опыта: до 7 уровня — быстро, дальше каждый уровень заметно дороже (≈ +15 % к темпу)');
{
  const row = []; for (let l = 2; l <= 14; l++) row.push(l + ':' + CF.xpForLevel(l));
  console.log('   XP до следующего уровня  ' + row.join('  '));
  const g = l => CF.xpForLevel(l + 1) / CF.xpForLevel(l);
  const early = (g(3) + g(4) + g(5) + g(6)) / 4, late = (g(8) + g(9) + g(10) + g(11) + g(12)) / 5;
  console.log('   средний рост цены уровня: 3→7 ×' + f2(early) + ', 8→13 ×' + f2(late));
  ok(CF.xpForLevel(14) / CF.xpForLevel(7) > 1.5, 'после 7-го уровня каждый следующий требует ощутимо больше опыта');
  if (CF.XP_PACE) { const k7 = CF.XP_PACE(7), k14 = CF.XP_PACE(14); console.log('   множитель темпа: ур.7 ×' + f2(k7) + ', ур.14 ×' + f2(k14)); ok(k14 / k7 > 1.1 && k14 / k7 < 1.2, 'замедление после 7 уровня плавное и ≈15 %'); }
}

console.log('2. Сила босса под уровень бойцов (суша, лес) и размер команды');
{
  const bio = 'forest', req = CF.BOSS_LEVEL[bio];
  const rows = [];
  for (const [lv, n] of [[req, 1], [req + 5, 1], [req + 12, 1], [req, 3], [req + 5, 3]]) {
    const hub = new Core.Hub({ onSave() { } });
    const ps = []; let room;
    for (let i = 0; i < n; i++) { const r = hub.join({ profile: profile('carn', lv, 'B' + i + '_' + lv), conn: mkConn(), userId: 100 + i, biome: bio, mode: n > 1 ? 'code' : 'solo', code: n > 1 ? 'BALQ' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[lv % 26] : undefined }); ps.push(r.player); room = r.room; }
    tick(hub, 5);
    ps.forEach((p, i) => { p.st.x = i * 2 - 2; p.st.z = 3; p.st.y = room.W.heightAt(p.st.x, p.st.z); p.rs++; });
    room.boss.state = 'idle'; room.startFight(n);
    const b = room.boss, st = ps[0].stats, dps = st.dmg / st.atkCd, ttk = b.mhp / (dps * n), hit = 100 * (b.dmgK || 0.85) * room.bossK(b, ps[0]) / (b.dmgK || 0.85);
    rows.push({ lv, n, lvK: b.lvK, lvD: b.lvD, teamK: b.teamK, ttk, k: room.bossK(b, ps[0]), hp: ps[0].stats.hp });
    hub.leave && ps.forEach(p => hub.leave(p));
  }
  console.log('   ур.  игроков  HP×ур  удар×ур  удар×команда  бой, с (чистый dps)  урон-множ.');
  rows.forEach(r => console.log('   ' + String(r.lv).padEnd(5) + String(r.n).padEnd(9) + f2(r.lvK).padEnd(7) + f2(r.lvD).padEnd(9) + f2(r.teamK).padEnd(14) + String(Math.round(r.ttk)).padEnd(21) + f2(r.k)));
  ok(rows[0].lvK === 1 && rows[0].teamK === 1, 'эталонный игрок требуемого уровня: босс без поправок');
  ok(rows[1].lvK > 1.05 && rows[2].lvK > rows[1].lvK, 'перекачанным бойцам босс выдаёт больше HP');
  ok(rows[2].ttk < rows[0].ttk && rows[2].ttk > rows[0].ttk * 0.5, 'перекачанный всё ещё убивает быстрее, но не в разы (' + Math.round(rows[2].ttk) + ' с против ' + Math.round(rows[0].ttk) + ' с)');
  ok(Math.abs(rows[3].teamK - 1.2) < 1e-6, 'команда из 3: босс бьёт на +20 %');
  ok(rows[3].ttk / rows[0].ttk > 0.7 && rows[3].ttk / rows[0].ttk < 1.0, 'команда из 3 бьёт босса ≈ столько же по времени (HP +70 % за игрока)');
}

console.log('3. Командная игра: обычные враги крепче и злее с каждым игроком');
{
  const hub = new Core.Hub({ onSave() { } });
  const r1 = hub.join({ profile: profile('carn', 5, 'T1'), conn: mkConn(), userId: 201, biome: 'forest', mode: 'code', code: 'TEAMX' });
  const room = r1.room; tick(hub, 12);
  const foe = [...room.ents.values()].find(e => e.kind === 'e' && e.team === 'e' && !e.owner);
  ok(!!foe, 'в мире есть враги');
  const h1 = foe.mhp, d1 = foe.dmg;
  hub.join({ profile: profile('carn', 5, 'T2'), conn: mkConn(), userId: 202, biome: 'forest', mode: 'code', code: 'TEAMX' });
  hub.join({ profile: profile('carn', 5, 'T3'), conn: mkConn(), userId: 203, biome: 'forest', mode: 'code', code: 'TEAMX' });
  tick(hub, 12);
  console.log('   1 игрок: HP ' + Math.round(h1) + ', урон ' + f2(d1) + '  →  3 игрока: HP ' + Math.round(foe.mhp) + ', урон ' + f2(foe.dmg));
  ok(Math.abs(foe.mhp / h1 - 1.6) < 0.01 && Math.abs(foe.dmg / d1 - 1.16) < 0.01, '3 игрока: HP ×1.6, урон ×1.16');
  const fresh = room.makeEnt(foe.arch, 5, 5, 3);
  ok(Math.abs(fresh.mhp / fresh.bHp - 1.6) < 0.01, 'новые враги сразу появляются усиленными');
}

console.log('4. Арена: уровни, спавн по кругу, бонусы по потребности, общие баффы');
{
  for (const team of [false, true]) {
    const hub = new Core.Hub({ onSave() { } }), N = team ? 3 : 1, ps = []; let room;
    for (let i = 0; i < N; i++) { const r = hub.join({ profile: profile('carn', 12, 'A' + i + team), conn: mkConn(), userId: 300 + i + (team ? 10 : 0), biome: 'forest', mode: team ? 'arenat' : 'arena', code: team ? 'ARX' : undefined }); ps.push(r.player); room = r.room; }
    ok(!!room.arena && room.players.size >= N, (team ? 'совместная' : 'одиночная') + ' арена: ' + N + ' игрок(а) в комнате');
    room.arena.nextT = room.t; tick(hub, 2);
    const R = room.arena; ok(R.state === 'fight' && R.wave === 1, 'волна 1 началась');
    const q = R.q.slice(), sp = [], orig = room.arenaSpawn; room.arenaSpawn = function (qq) { orig.call(this, qq); let last = null; this.ents.forEach(e => { if (e.wave) last = e; }); sp.push(Math.atan2(last.st.z, last.st.x)); };
    tick(hub, Math.round(CF.TICK_RATE * 8)); room.arenaSpawn = orig;
    const angs = sp.sort((a, b) => a - b);
    let gap = 0; for (let i = 0; i < angs.length; i++) gap = Math.max(gap, ((i + 1 < angs.length ? angs[i + 1] : angs[0] + 6.2832) - angs[i]));
    console.log('   ' + (team ? 'команда' : 'соло') + ': врагов в 1-й волне ' + q.length + ', ур. ' + q[0].lv + ', HP×' + f2(q[0].hpK) + ', наибольший пустой сектор ' + Math.round(gap * 57.3) + '°');
    ok(gap < 2.4, 'враги разнесены по кругу (нет пустой половины арены)');
    if (team) ok(q[0].hpK / ((CF.ARENA.EARLY || [1])[0]) > 1.25 && q.length >= 6, 'в команде врагов больше и они крепче');
    ok(q[0].lv <= Math.round(12 + CF.ARENA.LV_GAP), 'уровень врагов не уходит дальше среднего + ' + CF.ARENA.LV_GAP);
    // бонусы: при низком HP — аптечка рядом с раненым; при полном — ярость/скорость по очереди
    R.bonus = []; ps.forEach(p => { p.hp = p.stats.hp; });
    const kinds = []; for (let i = 0; i < 4; i++) { room.arenaBonusSpawn(); kinds.push(R.bonus[R.bonus.length - 1].k); }
    ok(kinds.indexOf('heal') < 0 && kinds.indexOf('dmg') >= 0 && kinds.indexOf('spd') >= 0, 'при полном здоровье — ярость и скорость по очереди (' + kinds.join(', ') + ')');
    R.bonus = []; ps[0].hp = ps[0].stats.hp * 0.25; room.arenaBonusSpawn();
    const hb = R.bonus[0], dh = Math.hypot(hb.x - ps[0].st.x, hb.z - ps[0].st.z);
    ok(hb.k === 'heal' && dh > 2 && dh < 16, 'раненому — аптечка в ' + dh.toFixed(1) + ' м: добежать надо, но недалеко');
    if (team) {
      ps.forEach(p => { p.hp = p.stats.hp * 0.5; p.aDmgT = 0; }); const h1 = ps[1].hp;
      room.arenaPick(ps[0], { k: 'heal', x: 0, y: 0, z: 0 }); room.arenaPick(ps[0], { k: 'dmg', x: 0, y: 0, z: 0 });
      ok(ps[1].hp > h1 && ps[1].aDmgT > room.t + CF.ARENA.DMG_T * 0.6, 'бонус делится с союзниками (лечение +15 %, ярость 70 % длительности)');
    }
  }
}

console.log('4б. Арена: все начинают с 1 уровня, растут по волнам');
{
  const hub = new Core.Hub({ onSave() { } }), r = hub.join({ profile: profile('carn', 25, 'AL'), conn: mkConn(), userId: 360, biome: 'forest', mode: 'arena' });
  const p = r.player, room = r.room, real = Sim.statsFor('carn', 25, p.profile.evo);
  ok(p.arLv === 1 && Math.abs(p.stats.hp - Sim.statsFor('carn', 1, {}).hp) < 1e-6, 'игрок 25 уровня на арене — с 1 уровня (HP ' + Math.round(p.stats.hp) + ' вместо ' + Math.round(real.hp) + ')');
  room.arena.nextT = room.t; tick(hub, 2); room.ents.forEach(e => { if (e.wave) room.ents.delete(e.id); }); room.arena.q = []; tick(hub, 3);
  ok(p.arLv === 1 + CF.ARENA.LV_UP && p.profile.level === 25, 'после волны — уровень арены ' + p.arLv + ', настоящий уровень профиля не тронут');
}

console.log('4в. Арена: сложность по волнам (модель tools/arenabal.js — доля здоровья, теряемая за волну)');
{
  for (const c of ['carn', 'herb', 'flyer']) {
    const r = JSON.parse(require('child_process').execFileSync('node', [__dirname + '/arenabal.js', c, '1'], { env: Object.assign({}, process.env, { RAW: '1', AR: '' }) }).toString());
    console.log('   ' + c + ': ' + r.slice(0, 15).map((f, i) => (i + 1) + ':' + (f == null ? '—' : Math.round(f * 100) + '%')).join(' '));
    ok(r[0] < 0.25 && r[1] < 0.3 && r[3] < 0.5 && r[13] > r[3] * 2, c + ': первые волны лёгкие, дальше сложность растёт');
  }
}

console.log('5. Обрыв связи (VPN): динозавр ждёт, возвращение в тот же мир на то же место');
{
  const hub = new Core.Hub({ onSave() { } }), c1 = mkConn();
  const r = hub.join({ profile: profile('carn', 6, 'R1'), conn: c1, userId: 401, biome: 'forest', mode: 'public' });
  const p = r.player, room = r.room; tick(hub, 5);
  p.st.x = 17; p.st.z = -9; p.profile.coins = 777;
  let saved = 0; hub.onSave = () => saved++;
  hub.disconnect(p); ok(p.gone && !p.conn, 'при обрыве прогресс сохраняется, динозавр остаётся в мире');
  tick(hub, Math.round(CF.TICK_RATE * 12));
  ok(room.players.get(p.id) === p, 'через 12 с динозавр всё ещё ждёт (держим ' + CF.DISCONNECT_KEEP_SEC + ' с)');
  const c2 = mkConn(); ok(hub.resume(p, c2), 'переподключение принято');
  const w = c2.last('welcome');
  ok(w && w.id === p.id && Math.abs(w.me.x - p.st.x) < 1 && w.prof.coins === 777, 'тот же динозавр, та же позиция и монеты');
  ok(!p.gone && p.conn === c2, 'игрок снова в игре');
}

console.log('\nПройдено проверок: ' + passed);

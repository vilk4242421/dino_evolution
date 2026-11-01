'use strict';
/* Модель сложности арены по волнам: настоящие враги из комнаты (уровень, HP, урон), игрок на «уровне арены».
   Время зачистки = суммарное HP / урон игрока в секунду; полученный урон — одновременно атакуют до 3 врагов, попадает доля HIT ударов.
   Запуск: node tools/arenabal.js [класс] [игроков] */
const Core = require('../game/rooms.js'), Sim = Core.Sim, CF = Core.CF, A = CF.ARENA;
if (process.env.AR && process.env.AR.length > 1) Object.assign(A, JSON.parse(process.env.AR));
const cls = process.argv[2] || 'carn', N = +(process.argv[3] || 1), HIT = 0.55, MAXAT = 2, PDPS_K = 1.25;   // способности/рывки ≈ +25 % к чистому урону
function mkConn() { return { send() { } }; }
function profile(c, lv, n) { const p = Sim.defaultProfile(n); p.cls = c; p.hatched = true; p.level = lv; p.totalXp = CF.cumXp(lv); return p; }
const hub = new Core.Hub({ onSave() { } }); let room; const ps = [];
for (let i = 0; i < N; i++) { const r = hub.join({ profile: profile(cls, 30, 'P' + i), conn: mkConn(), userId: 900 + i, biome: process.argv[4] || 'forest', mode: N > 1 ? 'arenat' : 'arena', code: N > 1 ? 'ABALXX' : undefined }); room = r.room || room; ps.push(r.player || r.p || r); }
room = room || [...hub.rooms.values()].find(x => x.isArena && x.isArena());
const pl = [...room.players.values()].filter(p => !p.bot);
let hp = 1, rows = [];
for (let w = 1; w <= 20; w++) {
  const lv = 1 + A.LV_UP * (w - 1); pl.forEach(p => { p.arLv = lv; room.refreshStats(p); });
  room.ents.forEach((e, id) => { if (e.wave) room.ents.delete(id); }); room.boss = null;
  room.arena.wave = w - 1; room.startArenaWave(); const q = room.arena.q.slice(); room.arena.q = [];
  const es = q.map(x => { room.arenaSpawn(x); return [...room.ents.values()].filter(e => e.wave).pop(); });
  if (room.boss) { room.boss.hp = room.boss.hp || room.boss.mhp || room.boss.baseHp; es.push(room.boss); }
  const st = pl[0].stats, pd = st.dmg / st.atkCd * PDPS_K * N;
  let t = 0, taken = 0;
  es.sort((a, b) => a.hp - b.hp);
  for (let i = 0; i < es.length; i++) { const e = es[i], tt = e.hp / pd, at = es.slice(i, i + MAXAT * N); t += tt; taken += tt * at.reduce((s, x) => s + (x.boss ? st.hp * A.BOSS_HIT * 1.6 : x.dmg) / (x.boss ? 2.2 : 1.15), 0) * HIT / N; }
  hp = Math.min(1, hp + A.HEAL);
  const bon = Math.floor(Math.max(0, t - A.BONUS_FIRST) / A.BONUS_EVERY[1] + (t > A.BONUS_FIRST ? 1 : 0)) * A.HEAL_K * 0.5;   // аптечки во время волны (≈ каждая вторая — лечение)
  const frac = taken / st.hp; hp = Math.min(1, hp - frac + bon);
  if (!process.env.RAW) rows.push([w, lv, es.length, es[0] ? es[0].lv : '-', Math.round(st.hp), st.dmg.toFixed(1), Math.round(es.reduce((s, e) => s + e.hp, 0)), Math.round(t), Math.round(frac * 100) + '%', Math.round(Math.max(hp, -9) * 100) + '%']);
  if (process.env.RAW) { rows.push(frac); continue; }
  if (hp <= 0) { rows.push(['— гибель на волне ' + w]); break; }
}
if (process.env.RAW) { console.log(JSON.stringify(rows)); process.exit(0); }
console.log(cls + ' × ' + N + '\nволна ур.игр врагов ур.вр HP игр урон игр ΣHP врагов бой,с урон% остаток%');
rows.forEach(r => console.log(r.join('\t')));

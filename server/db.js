'use strict';
/* Хранилище: PostgreSQL (DATABASE_URL, например Neon) или JSON-файл, если переменной нет (или модуль pg не установлен).
   Интерфейс одинаковый: createUser, findByNick, createToken, userByToken, deleteToken, saveProfile, countUsers, topWins, topKings.
   Таблицы создаются сами при первом запуске. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
const lastKing = p => { const k = (p && p.kingAt) || {}; let m = 0; for (const b in k) m = Math.max(m, k[b] || 0); return m; };
function winsRow(u) { const p = u.profile || {}; return { nick: u.display, nickKey: u.nick, wins: p.wins | 0, level: p.level | 0, cls: p.cls || null }; }
const LAND = ['forest', 'snow', 'mountain', 'desert', 'swamp', 'volcano'];   // «Владыка эпох» — все 6 боссов суши (океан считается в общем числе корон)
function kingsRow(u) { const p = u.profile || {}, ks = p.kings || [], k = ks.length; return { nick: u.display, nickKey: u.nick, count: k, lord: LAND.every(b => ks.indexOf(b) >= 0), at: lastKing(p), level: p.level | 0 }; }
function eloRow(u) { const p = u.profile || {}; return { nick: u.display, nickKey: u.nick, elo: p.elo | 0, played: (p.dw | 0) + (p.dl | 0), level: p.level | 0, cls: p.cls || null }; }
function coinsRow(u) { const p = u.profile || {}; return { nick: u.display, nickKey: u.nick, coins: p.coins | 0, level: p.level | 0, cls: p.cls || null }; }
function sortCoins(rows) { return rows.filter(r => r.coins > 0).sort((a, b) => b.coins - a.coins); }
function sortElo(rows) { return rows.filter(r => r.played > 0).sort((a, b) => b.elo - a.elo || b.played - a.played); }
function sortWins(rows) { return rows.filter(r => r.wins > 0).sort((a, b) => b.wins - a.wins || b.level - a.level); }
function sortKings(rows) { return rows.filter(r => r.count > 0).sort((a, b) => b.count - a.count || a.at - b.at); }

function jsonStore(file) {
  let data = { nextId: 1, users: {}, tokens: {} };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* новый файл */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const byNick = {};
  for (const id in data.users) byNick[data.users[id].nick] = data.users[id];
  let timer = null;
  function flush() {
    timer = null;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }
  function schedule() { if (!timer) timer = setTimeout(flush, 400); }
  process.on('exit', () => { if (timer) { try { flush(); } catch (e) { /* ignore */ } } });
  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { if (timer) flush(); process.exit(0); }));
  return {
    kind: 'json (' + file + ')',
    async createUser(u) {
      if (byNick[u.nick]) return null;
      const id = data.nextId++;
      const rec = Object.assign({ id, created: Date.now() }, u);
      data.users[id] = rec; byNick[u.nick] = rec; schedule();
      return rec;
    },
    async findByNick(nick) { return byNick[nick] || null; },
    async createToken(userId, token, expMs) {
      const now = Date.now();
      for (const k in data.tokens) if (data.tokens[k].exp < now) delete data.tokens[k];
      data.tokens[sha(token)] = { userId, exp: expMs };
      schedule();
    },
    async userByToken(token) {
      const t = data.tokens[sha(token)];
      if (!t) return null;
      if (t.exp < Date.now()) { delete data.tokens[sha(token)]; schedule(); return null; }
      return data.users[t.userId] || null;
    },
    async deleteToken(token) { delete data.tokens[sha(token)]; schedule(); },
    async saveProfile(id, profile) { if (data.users[id]) { data.users[id].profile = profile; schedule(); } },
    async countUsers() { return Object.keys(data.users).length; },
    async topWins(n) { return sortWins(Object.values(data.users).map(winsRow)).slice(0, n); },
    async topKings(n) { return sortKings(Object.values(data.users).map(kingsRow)).slice(0, n); },
    async topElo(n) { return sortElo(Object.values(data.users).map(eloRow)).slice(0, n); },
    async topCoins(n) { return sortCoins(Object.values(data.users).map(coinsRow)).slice(0, n); }
  };
}

async function pgStore(url) {
  const { Pool } = require('pg');     // необязательная зависимость: npm install pg
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, nick TEXT UNIQUE NOT NULL, display TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL,
    profile JSONB NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires TIMESTAMPTZ NOT NULL)`);
  await pool.query('DELETE FROM tokens WHERE expires < now()');
  return {
    kind: 'postgresql',
    async createUser(u) {
      const r = await pool.query('INSERT INTO users(nick,display,hash,salt,profile) VALUES($1,$2,$3,$4,$5) ON CONFLICT (nick) DO NOTHING RETURNING *',
        [u.nick, u.display, u.hash, u.salt, JSON.stringify(u.profile)]);
      return r.rows[0] || null;
    },
    async findByNick(nick) { const r = await pool.query('SELECT * FROM users WHERE nick=$1', [nick]); return r.rows[0] || null; },
    async createToken(userId, token, expMs) { await pool.query('INSERT INTO tokens(token_hash,user_id,expires) VALUES($1,$2,$3)', [sha(token), userId, new Date(expMs)]); },
    async userByToken(token) {
      const r = await pool.query('SELECT u.* FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires>now()', [sha(token)]);
      return r.rows[0] || null;
    },
    async deleteToken(token) { await pool.query('DELETE FROM tokens WHERE token_hash=$1', [sha(token)]); },
    async saveProfile(id, profile) { await pool.query('UPDATE users SET profile=$2 WHERE id=$1', [id, JSON.stringify(profile)]); },
    async countUsers() { const r = await pool.query('SELECT count(*)::int AS n FROM users'); return r.rows[0].n; },
    async topWins(n) {
      const r = await pool.query("SELECT nick, display, profile FROM users WHERE COALESCE((profile->>'wins')::int,0) > 0 ORDER BY (profile->>'wins')::int DESC LIMIT $1", [n]);
      return sortWins(r.rows.map(winsRow));
    },
    async topKings(n) {
      const r = await pool.query("SELECT nick, display, profile FROM users WHERE jsonb_array_length(COALESCE(profile->'kings','[]'::jsonb)) > 0 ORDER BY jsonb_array_length(profile->'kings') DESC LIMIT 200");
      return sortKings(r.rows.map(kingsRow)).slice(0, n);
    },
    async topElo(n) {
      const r = await pool.query("SELECT nick, display, profile FROM users WHERE (COALESCE((profile->>'dw')::int,0) + COALESCE((profile->>'dl')::int,0)) > 0 ORDER BY COALESCE((profile->>'elo')::int,1000) DESC LIMIT $1", [n]);
      return sortElo(r.rows.map(eloRow));
    },
    async topCoins(n) {
      const r = await pool.query("SELECT nick, display, profile FROM users WHERE COALESCE((profile->>'coins')::bigint,0) > 0 ORDER BY (profile->>'coins')::bigint DESC LIMIT $1", [n]);
      return sortCoins(r.rows.map(coinsRow));
    }
  };
}

module.exports = async function initStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try { const s = await pgStore(url); console.log('[db] PostgreSQL подключён'); return s; }
    catch (e) { console.error('[db] PostgreSQL недоступен (' + e.message + '), использую JSON-файл'); }
  }
  const file = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
  console.log('[db] JSON-файл: ' + file);
  return jsonStore(file);
};

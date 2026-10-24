'use strict';
/* Dino Evolution — сервер: статика, HTTP API (аккаунты, профиль, рейтинг), /stats и WebSocket-комнаты на одном порту.
   Без npm-зависимостей (pg — по желанию, только для PostgreSQL). Вся игровая логика — в ../game (общая с офлайн-режимом). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { attach } = require('./ws.js');
const initStore = require('./db.js');
const CONFIG = require('../game/config.js');
const Sim = require('../game/sim.js');
const Rooms = require('../game/rooms.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ADMINS = (process.env.ADMINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const PUBLIC = path.join(__dirname, '..', 'game');
const NICK_RE = /^[\p{L}\p{N}_-]{3,15}$/u;
const isAdmin = nick => ADMINS.includes(String(nick).toLowerCase());

let store = null;
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => e ? rej(e) : res(k)));

// ---------------------------------------------------------------- лимиты
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 120000)) hits.delete(k); }, 60000).unref();
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

// ---------------------------------------------------------------- профиль
/* Прогресс (уровень, опыт, эволюция, монеты, победы, короли) принадлежит серверу и меняется только игрой в комнате.
   Через HTTP клиент может лишь создать персонажа (имя, цвет, класс, вылупление) или начать новый забег. */
function applyCreate(old, inc, newRun) {
  const C = CONFIG;
  if (!inc || typeof inc !== 'object' || Array.isArray(inc)) return { error: 'invalid_profile' };
  const name = typeof inc.name === 'string' ? inc.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, C.NAME_MAX) : '';
  if (!Number.isInteger(inc.color) || inc.color < 0 || inc.color >= C.COLORS.length) return { error: 'invalid_profile' };
  if (typeof inc.hatched !== 'boolean') return { error: 'invalid_profile' };
  const cls = inc.cls === null ? null : (typeof inc.cls === 'string' && C.CLASSES[inc.cls] ? inc.cls : undefined);
  if (cls === undefined) return { error: 'invalid_profile' };
  if (inc.hatched && (!cls || !name)) return { error: 'invalid_profile' };
  if (inc.hatched && name.length < C.NAME_MIN) return { error: 'bad_name' };
  if (cls && C.TYPE_MIN_LV && C.TYPE_MIN_LV[cls] && (newRun || !old || !old.hatched)) return { error: 'type_locked' };
  let p = Sim.fixProfile(JSON.parse(JSON.stringify(old || Sim.defaultProfile(''))));
  if (newRun) {
    const d = Sim.defaultProfile(name);
    ['wins', 'kings', 'kingAt', 'cosmetics', 'cosmetic', 'pets', 'pet', 'claimed', 'codes', 'titles', 'title', 'patc', 'rfx', 'morph', 'eggskin', 'color', 'mats', 'trophies', 'elo', 'dw', 'dl', 'season', 'coins', 'stats', 'playTime', 'daily', 'tut', 'nest', 'story', 'ending'].forEach(k => { if (p[k] !== undefined) d[k] = p[k]; });
    p = d;
  } else if (p.hatched && p.cls && cls !== p.cls) return { error: 'class_locked' };
  p.name = name; p.color = inc.color;
  if (!p.hatched) { p.cls = cls; p.hatched = inc.hatched; }
  p.savedAt = Date.now();
  return { profile: p };
}

// ---------------------------------------------------------------- HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm'
};
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20000) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
async function authUser(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const user = await store.userByToken(m[1]);
  return user ? { user, token: m[1] } : null;
}
const userInfo = u => ({ nick: u.display, admin: isAdmin(u.nick) });
async function issueToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.createToken(user.id, token, Date.now() + CONFIG.TOKEN_DAYS * 86400000);
  return token;
}
const online = new Map();   // userId -> player (один вход на аккаунт)
function liveProfile(user) { const p = online.get(user.id); return p && p.profile ? p.profile : user.profile; }

let lbCache = { at: 0, data: null };
async function leaderboard() {
  if (lbCache.data && Date.now() - lbCache.at < 8000) return lbCache.data;
  const [wins, kings, elo, coins] = await Promise.all([store.topWins(50), store.topKings(50), store.topElo(50), store.topCoins(50)]);
  const mark = rows => rows.map(r => (isAdmin(r.nickKey) ? Object.assign({}, r, { admin: true }) : r));
  lbCache = { at: Date.now(), data: { wins: mark(wins), kings: mark(kings), elo: mark(elo), coins: mark(coins) } };
  return lbCache.data;
}

async function handleApi(req, res, pathname) {
  const ip = clientIp(req);
  if (req.method === 'POST' && (pathname === '/api/register' || pathname === '/api/login')) {
    if (rateLimited(ip, 12, 60000)) return json(res, 429, { error: 'rate_limited' });
    const b = await readBody(req);
    const display = typeof b.nick === 'string' ? b.nick.trim() : '';
    const pw = typeof b.password === 'string' ? b.password : '';
    if (!NICK_RE.test(display)) return json(res, 400, { error: 'bad_nick' });
    if (pw.length < 6 || pw.length > 64) return json(res, 400, { error: 'bad_password' });
    const nick = display.toLowerCase();
    if (pathname === '/api/register') {
      const salt = crypto.randomBytes(16);
      const hash = (await scrypt(pw, salt)).toString('hex');
      const profile = Sim.defaultProfile(display); profile.savedAt = Date.now();
      const user = await store.createUser({ nick, display, hash, salt: salt.toString('hex'), profile });
      if (!user) return json(res, 409, { error: 'nick_taken' });
      return json(res, 200, { token: await issueToken(user), user: userInfo(user), profile: user.profile });
    }
    const user = await store.findByNick(nick);
    const salt = user ? Buffer.from(user.salt, 'hex') : crypto.randomBytes(16);
    const hash = await scrypt(pw, salt);
    const ok = user && crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'));
    if (!ok) return json(res, 401, { error: 'bad_credentials' });
    return json(res, 200, { token: await issueToken(user), user: userInfo(user), profile: liveProfile(user) });
  }
  if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, version: CONFIG.VERSION });
  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    if (rateLimited('lb' + ip, 60, 60000)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await leaderboard());
  }

  const auth = await authUser(req);
  if (!auth) return json(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && pathname === '/api/me') return json(res, 200, { user: userInfo(auth.user), profile: liveProfile(auth.user) });
  if (req.method === 'POST' && pathname === '/api/logout') {
    await store.deleteToken(auth.token);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/profile') {
    if (rateLimited('p' + auth.user.id, 20, 60000)) return json(res, 429, { error: 'rate_limited' });
    if (online.has(auth.user.id)) return json(res, 409, { error: 'in_game', profile: liveProfile(auth.user) });
    const b = await readBody(req);
    const result = applyCreate(auth.user.profile, b.profile, !!b.newRun);
    if (result.error) return json(res, 400, { error: result.error, profile: auth.user.profile });
    auth.user.profile = result.profile;
    await store.saveProfile(auth.user.id, result.profile);
    return json(res, 200, { profile: result.profile });
  }
  if (req.method === 'POST' && pathname === '/api/shop') {
    if (rateLimited('s' + auth.user.id, 60, 60000)) return json(res, 429, { error: 'rate_limited' });
    if (online.has(auth.user.id)) return json(res, 409, { error: 'in_game', profile: liveProfile(auth.user) });
    const b = await readBody(req);
    const OPS = ['redeem', 'buy', 'craft', 'equip', 'buypet', 'setpet', 'setcolor', 'nestbuy', 'nestput'];
    if (!OPS.includes(b.op)) return json(res, 400, { error: 'bad_op' });
    const pr = Sim.fixProfile(JSON.parse(JSON.stringify(auth.user.profile)));
    if (b.op === 'redeem' && rateLimited('c' + auth.user.id, 8, 60000)) return json(res, 429, { error: 'rate_limited' });
    const r = Sim.shopOp(pr, b.op, { id: b.id, slot: b.slot, i: b.i, put: b.put, code: b.code });
    if (!r.ok) return json(res, 400, { error: r.err, profile: auth.user.profile });
    pr.savedAt = Date.now(); auth.user.profile = pr;
    await store.saveProfile(auth.user.id, pr);
    return json(res, 200, { profile: pr, coins: r.coins | 0 });
  }
  return json(res, 404, { error: 'not_found' });
}

// ---------------------------------------------------------------- статика
function buildHash() {
  const h = crypto.createHash('sha1');
  (function walk(dir) {
    for (const f of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, f), st = fs.statSync(full);
      if (st.isDirectory()) walk(full); else h.update(f + st.size + st.mtimeMs);
    }
  })(PUBLIC);
  return h.digest('hex').slice(0, 10);
}
const BUILD = buildHash();

async function statsPage(res) {
  const accounts = await store.countUsers();
  const hs = hub.stats();
  const html = `<!doctype html><meta charset="utf-8"><title>Dino Evolution — stats</title>
<style>body{font:16px system-ui;background:#10201a;color:#e8f3df;padding:32px}td{padding:4px 18px 4px 0}b{color:#9be37a}</style>
<h2>Dino Evolution — /stats</h2><table>
<tr><td>Хранилище</td><td><b>${store.kind.replace(/[<>&]/g, '')}</b></td></tr>
<tr><td>Аккаунтов</td><td><b>${accounts}</b></td></tr>
<tr><td>Комнат / игроков онлайн</td><td><b>${hs.rooms} / ${hs.players}</b></td></tr>
<tr><td>Версия / сборка</td><td><b>${CONFIG.VERSION} / ${BUILD}</b></td></tr></table>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC, rel));
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    if (path.basename(full) === 'sw.js') {        // версия кэша меняется вместе с файлами игры
      const body = fs.readFileSync(full, 'utf8').replace(/__BUILD__/g, BUILD);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': rel.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const pathname = (req.url || '/').split('?')[0];
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (pathname === '/stats') return await statsPage(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, pathname);
  } catch (e) {
    if (res.headersSent) return res.end();
    const code = e.message === 'too_large' ? 413 : e.message === 'bad_json' ? 400 : 500;
    if (code === 500) console.error('[http]', e);
    json(res, code, { error: code === 500 ? 'server_error' : e.message });
  }
});

// ---------------------------------------------------------------- игра
const pendingSave = new Map();    // userId -> profile (сохраняем пачкой, чтобы не писать в базу на каждое событие)
async function flushSaves() {
  const items = [...pendingSave]; pendingSave.clear();
  for (const [id, prof] of items) {
    try { await store.saveProfile(id, prof); } catch (e) { console.error('[save]', e.message); pendingSave.set(id, prof); }
  }
}
setInterval(flushSaves, 5000).unref();

const hub = new Rooms.Hub({
  onSave(p) { if (p && !p.bot && p.userId) pendingSave.set(p.userId, p.profile); },
  onGone(p) { if (online.get(p.userId) === p) online.delete(p.userId); }
});
setInterval(() => { try { hub.tick(); } catch (e) { console.error('[tick]', e); } }, 1000 / CONFIG.TICK_RATE);

function sendConn(conn, obj) { try { conn.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } }

attach(server, '/ws', conn => {
  let helloing = false, count = 0;
  const rateTimer = setInterval(() => { count = 0; }, 1000);
  const helloTimer = setTimeout(() => { if (!conn.player) conn.close(4000); }, 5000);
  const pingTimer = setInterval(() => { if (Date.now() - conn.lastRecv > 45000) conn.kill(); else conn.ping(); }, 15000);

  conn.onmessage = async raw => {
    if (++count > CONFIG.MAX_MSG_PER_SEC) return conn.close(4008);
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      if (conn.player || helloing) return;
      helloing = true;
      try {
        const tok = typeof m.token === 'string' && /^[a-f0-9]{64}$/.test(m.token) ? m.token : null;
        const user = tok ? await store.userByToken(tok) : null;
        if (!user) { sendConn(conn, { t: 'err', m: 'unauthorized' }); return conn.close(4001); }
        if (!conn.open) return;
        const prev = online.get(user.id);
        let profile = user.profile;
        if (prev && prev.room) {                       // второй вход выбивает первый
          profile = prev.profile;
          const pc = prev.conn; prev.conn = null;
          if (pc) { sendConn(pc, { t: 'err', m: 'replaced' }); pc.player = null; pc.close(4003); }
          hub.leave(prev);
          online.delete(user.id);
        }
        const mode = ['public', 'code', 'solo', 'rush'].includes(m.mode) ? m.mode : 'public';
        const res = hub.join({ profile, conn, userId: user.id, admin: isAdmin(user.nick), biome: m.biome, cls: typeof m.cls === 'string' ? m.cls : undefined, mode: mode === 'solo' ? 'public' : mode, code: m.code });
        if (res.error) { sendConn(conn, { t: 'err', m: res.error }); helloing = false; return; }
        conn.player = res.player;
        online.set(user.id, res.player);
        user.profile = res.player.profile;
        pendingSave.set(user.id, res.player.profile);
      } catch (e) {
        console.error('[ws hello]', e); conn.close(1011);
      }
      helloing = false;
      return;
    }
    if (m.t === 'ping') return sendConn(conn, { t: 'pong', n: +m.n || 0 });
    if (conn.player) hub.onMessage(conn.player, m);
  };
  conn.onclose = () => {
    clearInterval(rateTimer); clearTimeout(helloTimer); clearInterval(pingTimer);
    const p = conn.player;
    if (p && p.conn === conn) hub.disconnect(p);
  };
});

initStore().then(s => {
  store = s;
  server.listen(PORT, () => {
    console.log('Dino Evolution ' + CONFIG.VERSION + ' — http://localhost:' + PORT + '  (хранилище: ' + store.kind + ')');
    if (ADMINS.length) console.log('Админы: ' + ADMINS.join(', '));
  });
}).catch(e => { console.error('Не удалось запустить сервер:', e); process.exit(1); });

async function shutdown() { try { await flushSaves(); } catch (e) { /* ignore */ } process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

/* Аккаунт и профили. Онлайн-профиль живёт на сервере (прогресс меняет только игра в комнате); офлайн-профиль — только на этом устройстве. */
const CONFIG = window.CONFIG, Sim = window.Sim;
const LS = 'dino_';
export const state = { token: null, user: null, admin: false, profile: null, local: null, online: false, serverUp: true };

const lsGet = k => { try { return localStorage.getItem(LS + k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, v); } catch (e) { /* приватный режим */ } };
const lsDel = k => { try { localStorage.removeItem(LS + k); } catch (e) { /* ignore */ } };
function loadJson(k) { try { const p = JSON.parse(lsGet(k)); return p && typeof p === 'object' ? Sim.fixProfile(p) : null; } catch (e) { return null; } }

export function apiBase() {
  if (CONFIG.SERVER_URL) return CONFIG.SERVER_URL.replace(/\/+$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return 'http://localhost:3000';
}
export const wsUrl = () => apiBase().replace(/^http/, 'ws') + '/ws';

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(apiBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
  let data = {}; try { data = await res.json(); } catch (e) { /* пусто */ }
  if (!res.ok) { const e = new Error(data.error || 'server_error'); e.status = res.status; e.data = data; throw e; }
  return data;
}
export { api };

const localKey = () => 'local_' + (state.user ? 'u_' + state.user.toLowerCase() : 'guest');
export function loadLocal() { state.local = loadJson(localKey()) || Sim.defaultProfile(state.profile && state.profile.name || ''); return state.local; }
export function saveLocal(p) { if (p) state.local = p; if (state.local) lsSet(localKey(), JSON.stringify(state.local)); }
export function setServerProfile(p) { state.profile = Sim.fixProfile(p); }

function applySession(d) {
  state.token = d.token || state.token; state.user = d.user.nick; state.admin = !!d.user.admin; state.online = true; state.serverUp = true;
  lsSet('token', state.token); lsSet('user', state.user); lsSet('admin', state.admin ? '1' : '');
}
export async function restore() {
  state.token = lsGet('token');
  if (state.token) {
    try { const d = await api('GET', '/api/me'); applySession(d); setServerProfile(d.profile); loadLocal(); return; }
    catch (e) {
      if (e.status === 401) { state.token = null; lsDel('token'); lsDel('user'); lsDel('admin'); }
      else { state.user = lsGet('user'); state.admin = !!lsGet('admin'); state.online = false; state.serverUp = false; state.profile = null; loadLocal(); return; }
    }
  }
  state.user = null; state.admin = false; state.online = false; state.profile = null; loadLocal();
  try { await api('GET', '/api/health'); state.serverUp = true; } catch (e) { state.serverUp = false; }
}
export async function register(nick, password) { const d = await api('POST', '/api/register', { nick, password }); applySession(d); setServerProfile(d.profile); loadLocal(); }
export async function login(nick, password) { const d = await api('POST', '/api/login', { nick, password }); applySession(d); setServerProfile(d.profile); loadLocal(); }
export async function logout() {
  try { if (state.token) await api('POST', '/api/logout', {}); } catch (e) { /* токен всё равно забываем */ }
  state.token = null; state.user = null; state.admin = false; state.online = false; state.profile = null; lsDel('token'); lsDel('user'); lsDel('admin'); loadLocal();
}
// покупки из главного меню (вне комнаты): онлайн — через сервер, одиночный профиль — прямо в браузере
export async function shopMenu(online, op, a) {
  if (online) { const d = await api('POST', '/api/shop', Object.assign({ op }, a || {})); setServerProfile(d.profile); return { ok: true, coins: d.coins | 0 }; }
  const p = state.local, r = Sim.shopOp(p, op, a); if (r.ok) saveLocal(p); return r;
}
export async function refreshProfile() {
  if (!state.token) return;
  try { const d = await api('GET', '/api/me'); setServerProfile(d.profile); state.online = true; } catch (e) { if (e.status === 401) state.token = null; }
}
// создание персонажа / новый забег: онлайн — через сервер, офлайн — локально
export async function createCharacter(fields, online, newRun) {
  if (online) {
    const d = await api('POST', '/api/profile', { profile: fields, newRun: !!newRun });
    setServerProfile(d.profile); return state.profile;
  }
  let p = loadLocal();
  if (newRun) { const d = Sim.defaultProfile(fields.name); ['wins', 'kings', 'kingAt', 'cosmetics', 'cosmetic', 'pets', 'pet', 'claimed', 'codes', 'titles', 'title', 'patc', 'rfx', 'morph', 'eggskin', 'color', 'mats', 'trophies', 'elo', 'dw', 'dl', 'season', 'coins', 'stats', 'playTime', 'daily', 'tut', 'nest'].forEach(k => { if (p[k] !== undefined) d[k] = p[k]; }); p = d; }
  p.name = fields.name; p.color = fields.color; if (!p.hatched) { p.cls = fields.cls; p.hatched = fields.hatched; }
  saveLocal(p); return p;
}
export async function leaderboard() { return api('GET', '/api/leaderboard'); }

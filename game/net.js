/* Подключение к игре: онлайн — WebSocket на сервер; офлайн — тот же самый игровой код (RoomsCore) прямо в браузере. */
import { wsUrl } from './profile.js';
const CONFIG = window.CONFIG, Sim = window.Sim;

export function connectOnline(o, h) {
  let ws = null, closed = false;
  const conn = {
    online: true,
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { closed = true; try { ws && ws.close(); } catch (e) { /* ignore */ } }
  };
  try { ws = new WebSocket(wsUrl()); } catch (e) { setTimeout(() => h.onclose('error'), 0); return conn; }
  let opened = false;
  ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'hello', token: o.token, biome: o.biome, cls: o.cls, mode: o.mode, code: o.code })); h.onopen && h.onopen(); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } h.onmsg(m); };
  ws.onclose = e => { if (!closed) h.onclose(opened ? 'lost' : 'error'); closed = true; };
  ws.onerror = () => { /* onclose сообщит */ };
  return conn;
}

export function connectLocal(o, h) {
  const Core = window.RoomsCore;
  let hub = null, timer = 0, player = null, last = performance.now(), acc = 0, closed = false;
  const fake = { send(text) { if (!closed) { try { h.onmsg(JSON.parse(text)); } catch (e) { console.error(e); } } } };
  hub = new Core.Hub({ onSave(p) { if (p && p.profile && !p.bot) h.onSave && h.onSave(p.profile); } });
  const conn = {
    online: false,
    player() { return fake.player; },
    send(obj) { if (fake.player && !closed) hub.onMessage(fake.player, obj); },
    close() {
      if (closed) return; closed = true; clearInterval(timer);
      try { if (fake.player) hub.leave(fake.player); } catch (e) { /* ignore */ }
    }
  };
  const res = hub.join({ profile: o.profile, conn: fake, userId: 0, admin: false, biome: o.biome, cls: o.cls, mode: o.mode === 'rush' ? 'rush' : 'solo', code: null });
  if (res.error) { setTimeout(() => h.onclose(res.error), 0); closed = true; return conn; }
  fake.player = res.player;
  const dt = 1000 / CONFIG.TICK_RATE;
  timer = setInterval(() => {
    const now = performance.now(); if (conn.paused) { last = now; return; } acc += Math.min(250, now - last); last = now;
    let n = 0;
    while (acc >= dt && n < 4) { acc -= dt; n++; try { hub.tick(); } catch (e) { console.error('[local tick]', e); } }
    if (n === 4) acc = 0;
  }, 16);
  h.onopen && setTimeout(h.onopen, 0);
  return conn;
}

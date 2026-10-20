'use strict';
/* Минимальный WebSocket-сервер (RFC 6455) без зависимостей: рукопожатие, маскированные кадры, фрагментация, ping/pong, close. */
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 4096;

class WSConn {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.open = true; this.frag = null; this.lastRecv = Date.now();
    this.onmessage = null; this.onclose = null; this.player = null;
    socket.setNoDelay(true);
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }
  onData(d) {
    this.lastRecv = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > MAX_PAYLOAD * 8) return this.kill();
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this.kill();
        len = b.readUInt32BE(6); off = 10;
      }
      if (!masked || len > MAX_PAYLOAD) return this.kill();      // клиент обязан маскировать
      if (b.length < off + 4 + len) return;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ b[off + (i & 3)];
      this.buf = b.slice(off + 4 + len);
      if (op === 8) { this.sendFrame(8, Buffer.alloc(0)); return this.kill(); }
      if (op === 9) { this.sendFrame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) {
        if (fin) this.deliver(payload); else this.frag = [payload];
      } else if (op === 0 && this.frag) {
        this.frag.push(payload);
        if (this.frag.reduce((s, x) => s + x.length, 0) > MAX_PAYLOAD) return this.kill();
        if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this.deliver(all); }
      } else return this.kill();
      if (!this.open) return;
    }
  }
  deliver(buf) { if (this.onmessage) { try { this.onmessage(buf.toString('utf8')); } catch (e) { console.error('[ws]', e); } } }
  sendFrame(op, payload) {
    if (!this.open) return;
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(n, 6); }
    if (this.socket.writableLength > 1 << 20) return this.kill();    // клиент не успевает читать
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(text) { this.sendFrame(1, Buffer.from(text, 'utf8')); }
  ping() { this.sendFrame(9, Buffer.alloc(0)); }
  close(code) { if (!this.open) return; const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000, 0); this.sendFrame(8, b); setTimeout(() => this.kill(), 200).unref(); }
  kill() { if (this.open) { try { this.socket.destroy(); } catch (e) { /* ignore */ } } this.finish(); }
  finish() { if (!this.open) return; this.open = false; if (this.onclose) this.onclose(); }
}

function attach(server, wsPath, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if ((req.url || '').split('?')[0] !== wsPath || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    onConnection(new WSConn(socket));
  });
}
module.exports = { WSConn, attach };

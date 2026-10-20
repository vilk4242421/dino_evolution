/* Dino Evolution — дуэли 1 на 1 и турнир на 4 игрока (методы Room и Hub).
   Дуэль идёт в отдельной круглой арене без помощников и еды; победа засчитывается только в матчах с живыми людьми. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  var Sim = Core.Sim, CF = Core.CF, DT = Core.DT, Room = Core.Room, Hub = Core.Hub, RP = Room.prototype, HP = Hub.prototype;
  var AR = CF.ARENA_R, r1 = Core.r1, wrap = Core.wrap, dist = Core.dist;
  var BOT_NAMES = ['Грозный', 'Клык', 'Шторм', 'Рёв', 'Тень', 'Утёс'];

  // ---------------------------------------------------------------- комната: вход/выход игрока без пересоздания
  RP.welcomeMsg = function (p) {
    return {
      t: 'welcome', id: p.id, proto: CF.PROTO, room: { id: this.id, biome: this.biome, code: this.code, mode: this.mode }, tick: CF.TICK_RATE,
      me: Sim.exportState(p.st), prof: p.profile, tod: Core.r3(this.tod), players: this.roster(p.id), nest: this.W.nest, t0: r1(this.t)
    };
  };
  RP.adopt = function (p, o) {
    o = o || {};
    p.room = this; p.team = o.team || 'p'; p.q.length = 0; p.dots = []; p.wantAtk = false; p.pounce = null; p.diveT = 0; p.hidden = false;
    var s = p.st;
    s.fly = 0; s.clm = 0; s.grd = 0; s.dsh = 0; s.stun = 0; s.lock = 0; s.vy = 0; s.slow = 1; s.onGround = true;
    if (o.pos) { s.x = o.pos.x; s.z = o.pos.z; s.face = o.pos.face || 0; } else { var sp = this.spawnPoint(o.index || 0); s.x = sp.x; s.z = sp.z; if (this.W.duel) s.face = sp.x < 0 ? Math.PI / 2 : -Math.PI / 2; }
    s.y = this.W.heightAt(s.x, s.z); s.stam = CF.STAM_MAX;
    this.refreshStats(p, true);
    if (o.fullHp) p.hp = p.stats.hp;
    p.alive = true; p.rs++; p.cd = { atk: 0, e: 0, q: 0, f: 0 }; p.combo = 0;
    this.players.set(p.id, p);
    this.sendTo(p, this.welcomeMsg(p));
    this.broadcast({ t: 'join', p: this.pubInfo(p) }, p.id);
  };
  RP.detach = function (p, quiet) {
    this.releaseAllies(p);
    this.players.delete(p.id);
    if (!quiet) this.broadcast({ t: 'leave', id: p.id });
  };

  // ---------------------------------------------------------------- вызов на дуэль
  RP.handleExtra = function (p, m) {
    if (m.t === 'duel') this.hub.requestDuel(this, p, m.to | 0);
    else if (m.t === 'duelans') this.hub.answerDuel(this, p, m.from | 0, !!m.ok);
    else if (m.t === 'tourney') this.hub.joinTourney(p, m.code);
    else if (m.t === 'tourney_cancel') this.hub.dropFromQueues(p, true);
  };
  RP.duelFrozen = function (p) { return !!(this.duel && this.duel.state !== 'fight'); };

  HP.requestDuel = function (room, a, toId) {
    var b = room.players.get(toId), self = this;
    var ok = b && b !== a && !a.bot && !b.bot && a.alive && b.alive && !a.gone && !b.gone && room.mode !== 'duel' && room.mode !== 'rush' && room.mode !== 'solo';
    if (!ok) { room.sendTo(a, { t: 'err', m: 'duel_bad' }); return; }
    if (Math.hypot(a.st.x, a.st.z) < AR + 2 || Math.hypot(b.st.x, b.st.z) < AR + 2) { room.sendTo(a, { t: 'err', m: 'duel_bad' }); return; }
    if (a.inTourney || b.inTourney) { room.sendTo(a, { t: 'err', m: 'duel_busy' }); return; }
    if (room.t - (a.duelReqT || -99) < 3) return;
    a.duelReqT = room.t;
    room.duelReqs = room.duelReqs || {};
    room.duelReqs[b.id + ':' + a.id] = room.t + 15;
    room.sendTo(b, { t: 'duelreq', from: a.id, nick: a.name });
    room.sendTo(a, { t: 'info', m: 'duel_sent' });
  };
  HP.answerDuel = function (room, b, fromId, ok) {
    var a = room.players.get(fromId), key = b.id + ':' + fromId;
    if (!room.duelReqs || !(room.duelReqs[key] > room.t)) return;
    delete room.duelReqs[key];
    if (!a || !ok) { if (a) room.sendTo(a, { t: 'info', m: 'duel_declined' }); return; }
    if (!a.alive || !b.alive || a.gone || b.gone || a.room !== room || b.room !== room) return;
    this.startMatch(a, b, {});
  };

  // ---------------------------------------------------------------- матч
  HP.startMatch = function (A, B, o) {
    var biome = (A.ret && A.ret.room && A.ret.room.biome) || (A.room && A.room.biome) || 'forest';
    var duel = this.createRoom({ biome: biome, mode: 'duel' });
    [A, B].forEach(function (p, i) {
      var from = p.room;
      if (!p.ret) {                                          // первый переход: запоминаем, куда вернуть
        p.ret = { room: from, x: p.st.x, z: p.st.z, face: p.st.face, hp: p.hp };
        from.hold = (from.hold | 0) + 1;
      }
      if (from && from !== duel) from.detach(p);
      duel.adopt(p, { team: i ? 'b' : 'a', index: i, fullHp: true });
      duel.broadcast({ t: 'info', m: 'duel_start' });
    });
    duel.duel = { a: A, b: B, state: 'count', t0: duel.t, tEnd: duel.t + CF.DUEL_COUNTDOWN + CF.DUEL_SEC, winner: null, tourney: o.tourney || null, overT: 0, res: null };
    return duel;
  };
  RP.duelSnapshot = function (p, msg) {
    var d = this.duel, opp = d.a === p ? d.b : d.a;
    msg.du = { st: d.state, l: Core.r1(d.state === 'count' ? d.t0 + CF.DUEL_COUNTDOWN - this.t : Math.max(0, d.tEnd - this.t)), opp: opp ? opp.id : 0, w: d.winner ? d.winner.id : 0, res: d.res, bot: (d.a.bot || d.b.bot) ? 1 : 0, tn: d.tourney ? d.tourney.round : 0 };
  };
  RP.duelBotThink = function (b) {
    var d = this.duel; if (!d || d.state !== 'fight' || !b.alive) { b.q.length = 0; return; }
    var opp = d.a === b ? d.b : d.a, s = b.st, a = b.ai || (b.ai = { q: 0 }), f = 0, yaw = 0;
    if (opp && opp.alive) {
      var dd = dist(s, opp.st), reach = b.stats.reach + 0.8;
      if (dd > reach * 0.8) { f = 1; yaw = Core.angTo(s, opp.st) + Math.PI; }
      else { s.face = wrap(s.face + wrap(Core.angTo(s, opp.st) - s.face) * 0.5); if (b.cd.atk <= 0) b.wantAtk = true; }
    }
    a.q++; b.lastQ = a.q; b.q.push({ q: a.q, f: f, s: 0, yaw: yaw, jump: false, down: false, sprint: false });
    if (b.q.length > 2) b.q.shift();
  };
  RP.botThink = (function (prev) { return function (b) { if (this.mode === 'duel') return this.duelBotThink(b); return prev.call(this, b); }; })(RP.botThink);
  RP.noRespawn = (function (prev) { return function (p) { return this.mode === 'duel' || prev.call(this, p); }; })(RP.noRespawn);
  RP.onPlayerDeath = function (p, src) {
    var d = this.duel; if (!d || d.state === 'over') return;
    var w = d.a === p ? d.b : d.a;
    this.finishDuel(w && w.alive ? w : null, 'ko');
  };
  RP.finishDuel = function (winner, reason) {
    var d = this.duel; if (!d || d.state === 'over') return;
    d.state = 'over'; d.winner = winner; d.res = reason; d.overT = this.t + 4;
    this.events.push(['duelend', winner ? winner.id : 0]);
    if (winner) winner.shield = this.t + 5;
  };
  RP.updateExtra = function () {
    var d = this.duel; if (!d) return;
    var t = this.t;
    if (d.state === 'count' && t >= d.t0 + CF.DUEL_COUNTDOWN) { d.state = 'fight'; this.events.push(['duelgo']); }
    if (d.state === 'fight' && t >= d.tEnd) {
      var ha = d.a.hp, hb = d.b.hp;
      this.finishDuel(ha > hb + 0.01 ? d.a : hb > ha + 0.01 ? d.b : null, 'time');
    }
    if (d.state === 'over' && t >= d.overT && !d.done) { d.done = true; this.hub.matchOver(this); }
  };
  // за пределами арены дуэли ничего не едят и не лечатся
  var baseEat = RP.eatNear;
  RP.eatNear = function (p) { if (this.mode === 'duel') return; baseEat.call(this, p); };

  HP.matchOver = function (duel) {
    var d = duel.duel, self = this, w = d.winner, A = d.a, B = d.b;
    var humans = !A.bot && !B.bot && !A.leftDuel && !B.leftDuel;
    if (w && humans) {
      var pr = w.profile;
      pr.wins = (pr.wins | 0) + 1;
      var xp = 120 + w.profile.level * 12;
      duel.gainXp(w, xp); duel.gainCoins(w, 20 + (d.tourney ? 10 : 0));
      duel.markDirty(w); duel.flushProfile(w, true);
      duel.events.push(['duelwin', w.id, xp]);
    }
    var tn = d.tourney;
    // турнир: победитель остаётся ждать, проигравший возвращается
    [A, B].forEach(function (p) {
      if (p.leftDuel) return;
      var keep = tn && p === w && tn.round === 1;
      if (keep) { p.alive = true; p.hp = p.stats.hp; p.shield = duel.t + 60; return; }
      self.returnPlayer(p, duel);
    });
    if (tn) this.tourneyMatchDone(tn, duel, w);
    // комната дуэли закрывается сама, когда в ней не остаётся людей
    duel.duelClosing = true;
    if (!tn || tn.round === 2) this.closeDuelRoom(duel);
  };
  HP.closeDuelRoom = function (duel) {
    var self = this;
    duel.players.forEach(function (p) { if (!p.bot && !p.leftDuel) self.returnPlayer(p, duel); });
    this.rooms.delete(duel.id);
  };
  HP.returnPlayer = function (p, duel) {
    var ret = p.ret; p.ret = null; p.inTourney = false;
    if (duel && duel.players.has(p.id)) duel.detach(p, true);
    if (p.bot || !ret) return;
    var room = ret.room;
    if (room) room.hold = Math.max(0, (room.hold | 0) - 1);
    if (!room || !this.rooms.has(room.id)) {
      var res = this.join({ profile: p.profile, conn: p.conn, userId: p.userId, admin: p.admin, biome: room ? room.biome : 'forest', mode: 'public' });
      if (res.player && p.conn) p.conn.player = res.player;
      return;
    }
    p.team = 'p'; p.hp = Math.max(ret.hp, p.stats.hp * 0.3);
    room.adopt(p, { pos: { x: ret.x, z: ret.z, face: ret.face } });
    p.shield = room.t + 4;
  };
  // игрок вышел/отключился во время дуэли: победа сопернику
  HP.duelLeft = function (room, player) {
    var d = room.duel; if (!d) return;
    player.leftDuel = true;
    var opp = d.a === player ? d.b : d.a;
    if (d.state !== 'over') {
      room.finishDuel(opp && !opp.leftDuel ? opp : null, 'left');
      if (!d.done) { d.done = true; d.overT = room.t; this.matchOver(room); }
    }
    if (player.ret && player.ret.room) player.ret.room.hold = Math.max(0, (player.ret.room.hold | 0) - 1);
  };
  var baseCheck = HP.checkRoom;
  HP.checkRoom = function (room) {
    if (room.hold > 0) return;
    if (room.mode === 'duel') { if (!room.hasHuman() || room.duelClosing && !room.hasHuman()) this.rooms.delete(room.id); return; }
    baseCheck.call(this, room);
  };

  // ---------------------------------------------------------------- турнир
  HP.joinTourney = function (p, code) {
    var room = p.room;
    if (!room || p.bot || p.inTourney || room.mode === 'duel' || room.mode === 'rush' || room.mode === 'solo' || !p.alive) { if (room) room.sendTo(p, { t: 'err', m: 'duel_busy' }); return; }
    var key = typeof code === 'string' && /^\d{4}$/.test(code) ? code : 'public';
    this.queues = this.queues || {};
    var q = this.queues[key] || (this.queues[key] = { key: key, players: [], t0: 0 });
    if (q.players.indexOf(p) >= 0) return;
    q.players.push(p); p.inTourney = key; if (q.players.length === 1) q.t0 = room.t;
    this.queueNotify(q);
    if (q.players.length >= 4) this.startTourney(q, false);
  };
  HP.queueNotify = function (q) {
    q.players.forEach(function (p) { if (p.room) p.room.sendTo(p, { t: 'tq', n: q.players.length, code: q.key === 'public' ? null : q.key }); });
  };
  HP.dropFromQueues = function (p, notify) {
    if (!this.queues || !p.inTourney) return;
    var q = this.queues[p.inTourney];
    if (q) {
      var i = q.players.indexOf(p); if (i >= 0) q.players.splice(i, 1);
      this.queueNotify(q);
      if (!q.players.length) delete this.queues[p.inTourney];
    }
    if (p.inTourney && !p.ret) p.inTourney = false;
    if (notify && p.room) p.room.sendTo(p, { t: 'tq', n: 0 });
  };
  HP.makeDuelBot = function (room, avgLevel, i) {
    var pr = Sim.defaultProfile(BOT_NAMES[i % BOT_NAMES.length]);
    pr.hatched = true; pr.cls = i % 2 ? 'herb' : 'carn'; pr.color = (i * 5) % 12; pr.level = Core.clamp(Math.round(avgLevel), 1, 30);
    var b = room.makePlayer(pr, null, { bot: true, index: i }); b.room = room; b.ai = { q: 0 };
    room.refreshStats(b); b.hp = b.stats.hp;
    return b;
  };
  HP.startTourney = function (q, fill) {
    var self = this;
    delete this.queues[q.key];
    var ps = q.players.slice(), host = ps[0].room, avg = ps.reduce(function (s, p) { return s + p.profile.level; }, 0) / ps.length;
    var n = 0; while (ps.length < 4) { ps.push(this.makeDuelBot(host, avg, n++)); }
    var tn = { players: ps, round: 1, results: [], pending: 0, champ: null };
    ps.forEach(function (p) { if (!p.bot) { p.inTourney = 'run'; p.room.sendTo(p, { t: 'info', m: 'tourney_start' }); } });
    [[ps[0], ps[1]], [ps[2], ps[3]]].forEach(function (pair, i) {
      tn.pending++;
      self.startMatch(pair[0], pair[1], { tourney: { round: 1, ref: tn, idx: i } });
    });
    tn.active = true;
  };
  HP.tourneyMatchDone = function (tref, duel, winner) {
    var tn = tref.ref, self = this;
    tn.pending--;
    if (tref.round === 1) {
      tn.results.push(winner || (duel.duel.a.leftDuel ? duel.duel.b : duel.duel.a));
      if (tn.pending === 0) {
        tn.round = 2;
        var w0 = tn.results[0], w1 = tn.results[1];
        // победители оставались в своих комнатах дуэли; переселяем в финальную
        var f = this.startMatch(w0, w1, { tourney: { round: 2, ref: tn, idx: 0 } });
        tn.pending = 1;
        // старые комнаты полуфинала закрываем
        [w0, w1].forEach(function () { });
        this.rooms.forEach(function (r) { if (r.mode === 'duel' && r !== f && r.duelClosing && !r.hasHuman()) self.rooms.delete(r.id); });
      }
    } else {
      var champ = winner || null;
      tn.champ = champ;
      if (champ && !champ.bot) {
        var pr = champ.profile; pr.stats.tourney = (pr.stats.tourney | 0) + 1;
        duel.gainCoins(champ, 150); duel.gainXp(champ, 300 + champ.profile.level * 20);
        duel.markDirty(champ); duel.flushProfile(champ, true);
        duel.events.push(['champ', champ.id]);
      }
    }
  };
  HP.tourneyTick = function () {
    // обработка переходов через порталы (между обновлениями комнат)
    var q;
    while ((q = this.travelQ.shift())) { if (q.p.room && q.p.alive && !q.p.gone && q.p.conn) this.travel(q.p, q.biome); }
    if (!this.queues) return;
    for (var k in this.queues) {
      var queue = this.queues[k];
      if (!queue.players.length) { delete this.queues[k]; continue; }
      var host = queue.players[0].room;
      if (host && host.t - queue.t0 > 40) this.startTourney(queue, true);
    }
  };
});

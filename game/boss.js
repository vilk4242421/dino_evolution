/* Dino Evolution — боссы (3 фазы, красные зоны урона), порталы, арена, король биома, среда и погода, босс-раш (методы Room). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  var Sim = Core.Sim, CF = Core.CF, DT = Core.DT, Room = Core.Room, RP = Room.prototype;
  var clamp = Core.clamp, wrap = Core.wrap, dist = Core.dist, r1 = Core.r1, r2 = Core.r2, newId = Core.newId, ARCH = CF.ENEMIES;
  var AR = CF.ARENA_R;
  var SHAPE = { circle: 0, cone: 1, line: 2, ring: 3 };

  // ---------------------------------------------------------------- босс
  RP.makeBoss = function (bossId, mult) {
    var def = CF.BOSSES[bossId], W = this.W;
    var b = {
      id: newId(), kind: 'b', bossId: bossId, def: def, team: 'e', st: { x: 0, y: W.heightAt(0, 0), z: 0, face: W.portalIn ? Math.atan2(W.portalIn.x, W.portalIn.z) : 0 },
      hp: def.hp * mult, mhp: def.hp * mult, baseHp: def.hp * mult, mult: mult, phase: 0, state: 'idle', inv: true, radius: def.size * 0.85, big: true, dead: false,
      atkCd: 0, atkAnim: 0, action: null, nextAtk: 0, burrowed: false, minions: [], noFightT: 0, fn: 0, hitBy: null, dots: [], speed: def.speed, lastHurt: -99, flyer: bossId === 'dragon'
    };
    return b;
  };
  RP.initBoss = function () {
    if (this.mode === 'rush' || this.mode === 'duel') return;
    var id = this.W.cfg.boss;
    this.boss = this.makeBoss(id, 1);
    this.ents.set(this.boss.id, this.boss);
  };
  RP.bossFighters = function () {
    var out = [];
    this.players.forEach(function (p) { if (p.alive && !p.gone && Math.hypot(p.st.x, p.st.z) < AR - 0.5) out.push(p); });
    return out;
  };
  RP.startFight = function (n) {
    var b = this.boss; if (!b || b.state !== 'idle') return;
    b.state = 'fight'; b.inv = false; b.fn = n;
    b.mhp = b.baseHp * (1 + CF.BOSS_HP_PER_PLAYER * (n - 1)); b.hp = b.mhp; b.phase = 0;
    b.nextAtk = this.t + 2.5; b.action = null; b.noFightT = 0;
    this.events.push(['boss', b.id, 'start']);
  };
  RP.resetBoss = function () {
    var b = this.boss; if (!b) return;
    b.state = 'idle'; b.inv = true; b.hp = b.baseHp; b.mhp = b.baseHp; b.phase = 0; b.action = null; b.burrowed = false; b.hitBy = null; b.dots = [];
    b.st.x = 0; b.st.z = 0; b.st.y = this.W.heightAt(0, 0);
    this.clearMinions(b); this.zones = [];
    this.events.push(['boss', b.id, 'reset']);
  };
  RP.clearMinions = function (b) {
    var self = this;
    this.ents.forEach(function (e) { if (e.fromBoss) self.ents.delete(e.id); });
  };
  RP.addZone = function (z) {
    z.t0 = this.t; z.id = newId();
    this.zones.push(z);
    this.events.push(['tel', SHAPE[z.shape], r1(z.x), r1(z.z), r2(z.ang || 0), r1(z.a), r1(z.b || 0), r2(z.warn), z.hz ? 1 : 0]);
  };
  RP.inZone = function (z, p) {
    var s = p.st, rad = p.stats ? p.stats.radius : 0.6, dx = s.x - z.x, dz = s.z - z.z, d = Math.hypot(dx, dz);
    if (z.shape === 'circle') return d <= z.a + rad;
    if (z.shape === 'ring') return d <= z.a + rad && d >= z.a * 0.4;
    if (z.shape === 'cone') { if (d > z.a + rad) return false; if (d < 1.2) return true; return Math.abs(wrap(Math.atan2(dx, dz) - z.ang)) <= z.b / 2; }
    if (z.shape === 'line') {
      var fx = Math.sin(z.ang), fz = Math.cos(z.ang), along = dx * fx + dz * fz, perp = Math.abs(dx * fz - dz * fx);
      return along >= -1 && along <= z.a && perp <= z.b / 2 + rad;
    }
    return false;
  };
  RP.resolveZone = function (z) {
    var self = this;
    this.players.forEach(function (p) {
      if (!p.alive || p.gone || p.shield > self.t) return;
      if (z.shape !== 'cone' && p.st.fly && p.st.y - self.W.heightAt(p.st.x, p.st.z) > 6 && !z.hz) return;     // высоко в воздухе — выше земляных атак
      if (!self.inZone(z, p)) return;
      var raw = z.dmg * (z.mult || 1);
      var done = self.damage(z.src || null, p, raw, { force: true, noThorns: true });
      if (done <= 0 || p.hp <= 0) return;
      var fx = z.fx || {};
      if (fx.stun) p.st.stun = Math.max(p.st.stun, fx.stun);
      if (fx.slow) p.slowT = self.t + fx.slow;
      if (fx.freeze) { p.slowT = self.t + fx.freeze; p.st.stun = Math.max(p.st.stun, 0.6); }
      if (fx.poison) self.addDot(p, 'poison', fx.poison * (z.mult || 1), 5, z.src);
      if (fx.burn) self.addDot(p, 'burn', fx.burn * (z.mult || 1), 4, z.src);
      if (fx.knock) {
        var dx = p.st.x - z.x, dz = p.st.z - z.z, l = Math.hypot(dx, dz) || 1, dir = z.shape === 'line' ? { x: Math.sin(z.ang), z: Math.cos(z.ang) } : { x: dx / l, z: dz / l };
        var rr = Sim.resolve(self.W, p.st.x + dir.x * fx.knock, p.st.z + dir.z * fx.knock, p.stats.radius); p.st.x = rr.x; p.st.z = rr.z; p.rs++;
      }
    });
    if (z.shake) this.events.push(['shake', z.shake]);
  };
  RP.updateZones = function () {
    for (var i = this.zones.length - 1; i >= 0; i--) {
      var z = this.zones[i];
      if (this.t >= z.t0 + z.warn) { this.zones.splice(i, 1); this.resolveZone(z); if (z.onHit) z.onHit(); }
    }
  };

  // ---------------------------------------------------------------- атаки босса
  RP.pickAttack = function (b) {
    var list = b.def.attacks.filter(function (a) { return a.ph <= b.phase; }), sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i].wt;
    var r = this.rng() * sum;
    for (i = 0; i < list.length; i++) { r -= list[i].wt; if (r <= 0) return list[i]; }
    return list[0];
  };
  RP.randInArena = function (margin) { var a = this.rng() * 6.283, d = Math.sqrt(this.rng()) * (AR - margin); return { x: Math.cos(a) * d, z: Math.sin(a) * d }; };
  RP.bossAttack = function (b, atk, tgt) {
    var t = this.t, pf = 1 - 0.14 * b.phase, warn = atk.warn * pf, s = b.st, self = this;
    var dmgMult = b.mult > 1 ? 1 + (b.mult - 1) * 0.5 : 1;
    var fx = { stun: atk.stun, slow: atk.slow, freeze: atk.freeze, poison: atk.poison, burn: atk.burn, knock: atk.knock };
    var face = Core.angTo(s, tgt.st);
    b.action = { atk: atk, until: t + warn + 0.5, hitAt: t + warn };
    b.atkAnim = warn + 0.5; b.st.face = face;
    var base = { warn: warn, dmg: atk.dmg, src: b, fx: fx, shake: atk.shake, mult: dmgMult, id: atk.id };
    var z;
    if (atk.shape === 'multi') {
      var n = atk.n + (b.phase >= 2 ? 2 : 0);
      var humans = this.bossFighters();
      for (var i = 0; i < n; i++) {
        var pos;
        if (atk.at === 'target' && humans.length) { var tp = humans[i % humans.length]; pos = { x: tp.st.x + (this.rng() - 0.5) * 6, z: tp.st.z + (this.rng() - 0.5) * 6 }; }
        else if (humans.length && i % 2 === 0) { var rp = humans[(this.rng() * humans.length) | 0]; pos = { x: rp.st.x + (this.rng() - 0.5) * 10, z: rp.st.z + (this.rng() - 0.5) * 10 }; }
        else pos = this.randInArena(3);
        var dd = Math.hypot(pos.x, pos.z); if (dd > AR - 1) { pos.x *= (AR - 1) / dd; pos.z *= (AR - 1) / dd; }
        z = Object.assign({ shape: 'circle', x: pos.x, z: pos.z, a: atk.r }, base);
        this.addZone(z);
      }
    } else if (atk.shape === 'circle') {
      var cx = atk.at === 'target' ? tgt.st.x : s.x, cz = atk.at === 'target' ? tgt.st.z : s.z;
      if (atk.burrow) { b.burrowed = true; b.inv = true; this.events.push(['burrow', b.id, 1]); z = Object.assign({ shape: 'circle', x: cx, z: cz, a: atk.r }, base); z.onHit = function () { b.burrowed = false; b.inv = false; b.st.x = cx; b.st.z = cz; b.st.y = self.W.heightAt(cx, cz); self.events.push(['burrow', b.id, 0]); }; }
      else z = Object.assign({ shape: 'circle', x: cx, z: cz, a: atk.r }, base);
      this.addZone(z);
    } else if (atk.shape === 'ring') {
      this.addZone(Object.assign({ shape: 'ring', x: s.x, z: s.z, a: atk.r }, base));
      if (atk.summon) this.bossSummon(b, atk.summon, atk.n || 2, warn);
    } else if (atk.shape === 'cone') {
      this.addZone(Object.assign({ shape: 'cone', x: s.x, z: s.z, ang: face, a: atk.len, b: atk.ang }, base));
    } else if (atk.shape === 'line') {
      z = Object.assign({ shape: 'line', x: s.x, z: s.z, ang: face, a: atk.len, b: atk.w }, base);
      if (atk.dash) z.onHit = function () { var rr = Sim.resolve(self.W, 0, 0, 0); var ex = clamp(s.x + Math.sin(face) * atk.len * 0.8, -AR + 3, AR - 3), ez = clamp(s.z + Math.cos(face) * atk.len * 0.8, -AR + 3, AR - 3); var dd = Math.hypot(ex, ez); if (dd > AR - 3) { ex *= (AR - 3) / dd; ez *= (AR - 3) / dd; } b.dashTo = { x: ex, z: ez }; };
      this.addZone(z);
    }
  };
  RP.bossSummon = function (b, archId, n, delay) {
    var self = this, arch = ARCH[archId];
    for (var i = 0; i < n; i++) {
      var a = this.rng() * 6.283, d = 8 + this.rng() * 6, x = Math.cos(a) * d, z = Math.sin(a) * d;
      var lv = Math.max(arch.lv[0], Math.min(arch.lv[1], arch.lv[1]));
      var m = this.makeEnt(arch, x, z, lv, { team: 'e', hpMult: 0.7, dmgMult: 0.8 });
      m.boss = false; m.fromBoss = true; m.target = null; m.home = { x: 0, z: 0 };
      m.xpNone = true;
    }
    this.events.push(['summon', b.id]);
  };
  RP.onMinionDead = function () { };

  RP.updateBoss = function () {
    var b = this.boss, t = this.t, self = this;
    if (!b) { if (this.bossCool && t >= this.bossCool && this.mode !== 'rush') { this.bossCool = 0; this.initBoss(); } return; }
    if (b.dead) return;
    var fighters = this.bossFighters();
    if (b.state === 'idle') {
      if (fighters.length) this.startFight(fighters.filter(function (p) { return !p.bot; }).length || 1);
      return;
    }
    // бой
    if (!fighters.length) { b.noFightT += DT; if (b.noFightT > 8) this.resetBoss(); }
    else b.noFightT = 0;
    var humansIn = fighters.filter(function (p) { return !p.bot; }).length;
    if (humansIn > b.fn) {                                                  // новый игрок вошёл в бой: HP босса растёт
      var add = b.baseHp * CF.BOSS_HP_PER_PLAYER * (humansIn - b.fn); b.mhp += add; b.hp += add; b.fn = humansIn;
    }
    this.tickDots(b);
    if (b.dead) return;
    // фаза
    var frac = b.hp / b.mhp, ph = frac < CF.BOSS_PHASES[2] ? 2 : frac < CF.BOSS_PHASES[1] ? 1 : 0;
    if (ph > b.phase) {
      b.phase = ph; b.inv = true; b.phaseUntil = t + 2.2; b.action = null; b.nextAtk = t + 3;
      this.events.push(['bossph', b.id, ph]); this.events.push(['shake', 1]);
      if (b.def.attacks.some(function (a) { return a.summon; })) { var sm = b.def.attacks.filter(function (a) { return a.summon; })[0]; this.bossSummon(b, sm.summon, 2, 1); }
    }
    if (b.phaseUntil && t >= b.phaseUntil) { b.phaseUntil = 0; b.inv = !!b.burrowed; }
    b.atkAnim -= DT;
    if (b.phaseUntil) return;
    // выбор цели
    var tgt = null, bd = 1e9;
    fighters.forEach(function (p) { var d = dist(p.st, b.st); if (d < bd) { bd = d; tgt = p; } });
    if (!tgt) return;
    if (b.dashTo) {                                                          // рывок по линии
      var dx = b.dashTo.x - b.st.x, dz = b.dashTo.z - b.st.z, d2 = Math.hypot(dx, dz), sp = 24 * DT;
      if (d2 <= sp) { b.st.x = b.dashTo.x; b.st.z = b.dashTo.z; b.dashTo = null; } else { b.st.x += dx / d2 * sp; b.st.z += dz / d2 * sp; }
      b.st.y = this.W.heightAt(b.st.x, b.st.z); b.moving = true; return;
    }
    if (b.action) { if (t >= b.action.until) b.action = null; b.moving = false; return; }
    var reach = b.radius + 3.5;
    if (bd > reach && t < b.nextAtk) {                                      // идёт к цели
      var spd = b.speed * (1 + 0.12 * b.phase) * (b.slowT > t ? 0.5 : 1), ang = Core.angTo(b.st, tgt.st);
      b.st.face = wrap(b.st.face + wrap(ang - b.st.face) * Math.min(1, 6 * DT));
      var nx = b.st.x + Math.sin(ang) * spd * DT, nz = b.st.z + Math.cos(ang) * spd * DT, dd = Math.hypot(nx, nz);
      if (dd > AR - 3) { nx *= (AR - 3) / dd; nz *= (AR - 3) / dd; }
      b.st.x = nx; b.st.z = nz; b.st.y = this.W.heightAt(nx, nz); b.moving = true;
      return;
    }
    b.moving = false;
    if (t >= b.nextAtk) {
      var atk = this.pickAttack(b);
      this.bossAttack(b, atk, tgt);
      b.nextAtk = t + 2.2 - 0.35 * b.phase + this.rng() * 0.9 + atk.warn;
    }
  };
  RP.onEntityKilledBoss = function (src, b) {
    var self = this;
    b.dead = true; b.state = 'dead'; this.zones = []; this.clearMinions(b);
    this.events.push(['boss', b.id, 'dead']); this.events.push(['shake', 1.5]);
    this.ents.delete(b.id); this.boss = null;
    if (this.mode === 'rush') { this.rushWaveDone(b); return; }
    var wld = CF.worldOf(this.biome), wl = CF.worldList(wld), idx = wl.indexOf(this.biome), req = CF.BOSS_LEVEL[this.biome], parts = [];
    this.players.forEach(function (p) {
      if (p.bot || p.gone) return;
      var hit = b.hitBy && b.hitBy[p.id] && self.t - b.hitBy[p.id] < 40, inside = p.alive && Math.hypot(p.st.x, p.st.z) < AR;
      if (hit || inside) parts.push(p);
    });
    parts.forEach(function (p) {
      var pr = p.profile, first = pr.kings.indexOf(self.biome) < 0 && CF.worldKings(pr, wld) === idx;
      var xp = Math.round(CF.xpForLevel(req) * 1.5 * b.def.xp * (first ? 1 : 0.2)), coins = first ? 150 + idx * 80 : 40;
      if (first) { pr.kings.push(self.biome); pr.kingAt[self.biome] = Date.now(); pr.stats.bosses = (pr.stats.bosses | 0) + 1; }
      else pr.stats.bosses = (pr.stats.bosses | 0) + 1;
      self.gainXp(p, xp); self.gainCoins(p, coins); self.questProgress(p, 'boss', 1); self.dropLoot(p, first);
      if (first || Sim.isLord(pr)) p.shield = Math.max(p.shield || 0, self.t + 9);   // на время ролика коронации игрока не трогают
      var lord = Sim.isLord(pr);
      self.events.push(['king', p.id, self.biome, first ? 1 : 0, lord ? 1 : 0, xp, coins]);
      self.broadcast({ t: 'upd', p: { id: p.id, king: true, lord: lord } });
      p.hp = p.stats.hp; self.markDirty(p); self.flushProfile(p, true);
    });
    this.bossCool = this.t + 240;
  };
  // босса убили (вызывается из kill)
  var baseKill = RP.kill;
  RP.kill = function (src, dst, o) {
    if (dst.kind === 'b') { if (dst.dead) return; dst.hp = 0; dst.dead = true; this.onEntityKilledBoss(src, dst); return; }
    return baseKill.call(this, src, dst, o);
  };

  // ---------------------------------------------------------------- порталы и запоры арены
  RP.lockFor = function (p) {
    if (this.mode === 'rush') return 1;
    var b = this.boss; if (!b) return 0;
    var d = Math.hypot(p.st.x, p.st.z);
    if (b.state === 'fight') return d < AR - 1 ? 1 : 2;
    return d < AR - 1 ? 0 : 2;      // арена запечатана: войти можно только через портал
  };
  RP.updatePortals = function () {
    var self = this, b = this.boss, W = this.W;
    if (this.mode === 'rush' || this.mode === 'duel') return;
    this.players.forEach(function (p) {
      if (p.bot || !p.alive || p.gone) return;
      var s = p.st, pr = p.profile;
      var din = Math.hypot(s.x - W.portalIn.x, s.z - W.portalIn.z);
      if (b && !b.dead && din < 3.4 && Math.hypot(s.x, s.z) > AR) {
        if (pr.level >= CF.BOSS_LEVEL[self.biome]) {
          var a = W.portalIn.ang;
          s.x = Math.cos(a) * (AR - 6); s.z = Math.sin(a) * (AR - 6); s.y = W.heightAt(s.x, s.z); s.vy = 0; s.fly = 0; s.clm = 0; s.dsh = 0; s.lock = 0; p.rs++;
          s.face = Math.atan2(-s.x, -s.z);
          self.events.push(['port', p.id]);
        } else if (self.t - (p.warnT || -99) > 3) { p.warnT = self.t; self.sendTo(p, { t: 'err', m: 'boss_level', n: CF.BOSS_LEVEL[self.biome] }); }
      }
      var dn = Math.hypot(s.x - W.portalNext.x, s.z - W.portalNext.z);
      var wl = CF.worldList(CF.worldOf(self.biome)), idx = wl.indexOf(self.biome);
      if (dn < 3.4 && idx < wl.length - 1 && pr.kings.indexOf(self.biome) >= 0 && Math.hypot(s.x, s.z) > AR) {
        if (self.t - (p.travelT || -99) > 3) { p.travelT = self.t; self.hub.travelQ.push({ p: p, biome: wl[idx + 1] }); }
      }
    });
  };

  // ---------------------------------------------------------------- погода и среда
  RP.updateWorld = function () {
    var cyc = (this.t % 150) / 150;
    this.wx = clamp(Math.sin(clamp((cyc - 0.5) / 0.4, 0, 1) * Math.PI), 0, 1);
    var hz = this.W.cfg.hazard;
    if (this.mode === 'duel') return;
    if (this.t > this.rockT && (hz === 'rockfall' || hz === 'lava')) {
      this.rockT = this.t + (hz === 'rockfall' ? 4 + (1 - this.wx) * 6 : 6 + this.rng() * 5);
      var self = this, ps = [];
      this.players.forEach(function (p) { if (p.alive && !p.gone && !p.bot && Math.hypot(p.st.x, p.st.z) > AR + 3) ps.push(p); });
      if (ps.length) {
        var p = ps[(this.rng() * ps.length) | 0], a = this.rng() * 6.283, d = 4 + this.rng() * 16;
        this.addZone({ shape: 'circle', x: p.st.x + Math.cos(a) * d, z: p.st.z + Math.sin(a) * d, a: 3.6, warn: 1.5, dmg: hz === 'lava' ? 34 : 28, src: null, hz: 1, fx: hz === 'lava' ? { burn: 3 } : {} });
      }
    }
  };
  RP.slowFor = function (p) {
    var k = (p.slowT > this.t ? 0.65 : 1) * (p.ultT > this.t ? p.ultSpd : 1), hz = this.W.cfg.hazard;
    if (p.buffK === 'speed' && p.buffT > this.t) k *= 1.2;
    if (this.mode === 'duel') return k;
    if ((hz === 'cold' || hz === 'heat') && this.wx > 0.5) k *= 1 - 0.18 * this.wx * (1 - p.stats.resist * 0.5);
    return k;
  };
  RP.envDamage = function (p, dps, label) {
    if (p.st && p.st.clm) return;                                                    // на дереве — неуязвим и для холода, жара, лавы
    p.hp -= dps * DT; p.lastHurt = this.t; p.hz = label; p.hzT = this.t;
    if (p.hp <= 0) { p.hp = 0; p.deadBy = label; this.playerDied(p, { name: label }); }
  };
  RP.environment = function (p) {
    if (this.mode === 'duel' || p.shield > this.t) return;
    var W = this.W, s = p.st, hz = W.cfg.hazard, res = p.stats.resist, H = CF.HAZARD;
    if (hz === 'cold' && this.wx > 0.5 && !s.clm) this.envDamage(p, H.cold * (1 - res) * this.wx, 'cold');
    else if (hz === 'heat') {
      var noon = this.tod > 0.33 && this.tod < 0.67;
      if (noon || this.wx > 0.5) {
        var shade = W.isWater(s.x, s.z) || W.isWater(s.x + 9, s.z) || W.isWater(s.x - 9, s.z) || W.isWater(s.x, s.z + 9) || W.isWater(s.x, s.z - 9);
        if (!shade) this.envDamage(p, H.heat * 0.6 * (1 - res) * (noon ? 1 : this.wx), 'heat');
      }
    } else if (hz === 'poison' && !s.fly && W.bogAt(s.x, s.z)) this.envDamage(p, H.poison * (1 - res), 'poison');
    else if (hz === 'vent') { var vh = W.ventAt(s.x, s.z); if (vh > 0) this.envDamage(p, H.vent * vh * (1 - res * 0.7), 'vent'); }
    else if (hz === 'lava' && W.isLava(s.x, s.z) && (!s.fly || s.y < W.waterY + 2) && !s.clm) this.envDamage(p, H.lava * (1 - res * 0.5), 'lava');
  };

  // ---------------------------------------------------------------- босс-раш (режим «Владыки эпох»)
  RP.initRush = function () {
    this.rush = { wave: 0, state: 'break', nextT: this.t + 8, over: false, coins: 0 };
  };
  RP.startRushWave = function () {
    var R = this.rush, id = Core.BOSS_IDS[R.wave % Core.BOSS_IDS.length], mult = 1 + CF.BOSS_RUSH_STEP * R.wave;
    this.boss = this.makeBoss(id, mult); this.ents.set(this.boss.id, this.boss);
    var n = Math.max(1, this.humans());
    this.boss.state = 'idle'; this.startFight(n);
    this.boss.inv = true; this.boss.phaseUntil = this.t + 3;
    R.state = 'fight';
    this.events.push(['rush', R.wave + 1]);
  };
  RP.rushWaveDone = function (b) {
    var R = this.rush; R.wave++; R.state = 'break'; R.nextT = this.t + 8;
    var self = this, coins = 40 + 20 * R.wave;
    this.players.forEach(function (p) {
      if (p.bot || p.gone) return;
      self.gainCoins(p, coins); self.gainXp(p, Math.round(CF.xpForLevel(Math.max(10, p.profile.level)) * 0.4));
      if (p.alive) p.hp = Math.min(p.stats.hp, p.hp + p.stats.hp * 0.4);
      if (R.wave > (p.profile.stats.rush | 0)) p.profile.stats.rush = R.wave;
      self.markDirty(p); self.flushProfile(p, true);
    });
    this.events.push(['rushwave', R.wave, coins]);
  };
  RP.updateRush = function () {
    var R = this.rush, self = this; if (!R || R.over) return;
    var alive = 0; this.players.forEach(function (p) { if (!p.bot && p.alive && !p.gone) alive++; });
    if (R.state === 'break' && this.t >= R.nextT && alive) this.startRushWave();
    if (!alive && this.hasHuman() && R.state !== 'over') {
      R.over = true; R.state = 'over';
      this.players.forEach(function (p) { if (!p.bot) self.sendTo(p, { t: 'rushend', wave: R.wave }); });
    }
  };
  RP.noRespawn = function () { return this.mode === 'rush'; };
  RP.onHumanJoin = (function (prev) {
    return function (p) {
      prev.call(this, p);
      if (this.mode === 'rush') { p.st.x = (this.humans() - 1) * 4 - 2; p.st.z = 6; p.st.y = this.W.heightAt(p.st.x, p.st.z); p.shield = this.t + 4; p.rs++; }
    };
  })(RP.onHumanJoin);
  RP.initSpawns = (function (prev) { return function () { if (this.mode === 'rush') return; prev.call(this); }; })(RP.initSpawns);
  RP.initPlants = (function (prev) { return function () { if (this.mode === 'rush') return; prev.call(this); }; })(RP.initPlants);

  RP.updateBossAndZones = function () {
    if (this.mode === 'duel') return;
    this.updateBoss(); this.updateZones(); this.updatePortals();
    if (this.rush) this.updateRush();
  };
  RP.extraSnapshot = function (p, msg) {
    var b = this.boss;
    if (b && (b.state === 'fight' || Math.hypot(p.st.x, p.st.z) < AR + 40)) msg.bs = { id: b.id, k: b.bossId, hp: Math.round(b.hp), mh: Math.round(b.mhp), ph: b.phase, st: b.state, inv: b.inv ? 1 : 0 };
    var wl = CF.worldList(CF.worldOf(this.biome)), idx = wl.indexOf(this.biome), pr = p.profile;
    msg.pt = { req: CF.BOSS_LEVEL[this.biome], boss: b && !b.dead ? 1 : 0, next: pr.kings.indexOf(this.biome) >= 0 && idx < wl.length - 1 ? 1 : 0, cool: this.bossCool ? Math.max(0, Math.round(this.bossCool - this.t)) : 0 };
    if (this.rush) msg.rush = { w: this.rush.wave + 1, st: this.rush.state };
    if (p.hzT && this.t - p.hzT < 0.5) msg.mp.hz = p.hz;
    if (this.duel) this.duelSnapshot(p, msg);
    // союзники и их хозяин — подсветка списка союзников
    var al = [], self = this;
    this.ents.forEach(function (e) { if (e.owner === p) al.push([e.id, Math.round(e.hp / e.mhp * 100), e.arch.id]); });
    if (al.length) msg.al = al;
  };
});

/* Dino Evolution — ИИ мира: враги, дичь, стада, союзники, боты (методы Room). Подключается после rooms.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  var Sim = Core.Sim, CF = Core.CF, DT = Core.DT, Room = Core.Room, RP = Room.prototype;
  var clamp = Core.clamp, wrap = Core.wrap, dist = Core.dist, r1 = Core.r1, newId = Core.newId, ARCH = CF.ENEMIES;
  var BOT_NAMES = ['Рекс', 'Тина', 'Бронти', 'Раптор', 'Дило', 'Анки', 'Пахи', 'Игуа', 'Rexy', 'Spike'];

  // ---------------------------------------------------------------- создание
  RP.lvAt = function (arch, x, z) {
    var lo = arch.lv[0], hi = arch.lv[1];
    if (lo === hi) return lo;
    var d = Math.hypot(x, z), t = 1 - clamp(d / (this.W.half * 0.9), 0, 1);       // опаснее ближе к арене в центре
    var n = this.W.nest, nd = Math.hypot(x - n.x, z - n.z);
    t = clamp(t * 1.25 - (nd < 120 ? 0.35 : 0), 0, 1);
    return Math.round(lo + (hi - lo) * t);
  };
  RP.makeEnt = function (arch, x, z, lv, o) {
    o = o || {};
    // потолок уровня врагов на локации — уровень её босса (в первой локации не выше 10)
    var cap = CF.BOSS_LEVEL && CF.BOSS_LEVEL[this.biome]; if (cap && !o.owner) lv = Math.min(lv, cap);
    var W = this.W, sc = Sim.enemyScale(lv), y;
    var water = !!arch.water, swimY;
    // в океане водные плавают на разной глубине (своя «полка»), в озёрах суши — у поверхности, как раньше
    if (water && W.ocean) { var g0 = W.heightAt(x, z); swimY = this.pickSwimY(arch, g0); }
    y = water ? (swimY !== undefined ? swimY : W.waterY - 1.0) : W.heightAt(x, z);
    if (arch.fly) y += arch.alt || 3;
    var e = {
      id: newId(), kind: 'e', arch: arch, role: arch.role, lv: lv, team: o.team || (arch.role === 'hostile' ? 'e' : 'n'),
      st: { x: x, y: y, z: z, face: this.rng() * 6.28 - 3.14 }, home: { x: x, z: z },
      hp: arch.hp * sc.hp * (o.hpMult || 1), mhp: arch.hp * sc.hp * (o.hpMult || 1), dmg: arch.dmg * sc.dmg * (o.dmgMult || 1), speed: arch.speed / 30,
      radius: Math.max(0.35, arch.size * Sim.enemySizeMul(lv) * 0.55 + lv * 0.01), state: 'idle', target: null, atkCd: 0, atkAnim: 0, stunT: 0, fleeT: 0, aggroT: 0, wanderT: 0,
      wx: x, wz: z, swimY: swimY, dots: [], hitBy: null, moving: false, dead: false, lastHurt: -99, bob: this.rng() * 6.28, owner: o.owner || null, expire: o.expire || 0, big: arch.size >= 1.4
    };
    this.ents.set(e.id, e);
    return e;
  };
  RP.spawnEnemy = function (archId, pos) {
    var arch = ARCH[archId], W = this.W, p = pos;
    if (!p) {
      if (arch.water) p = W.randomWater(this.rng);
      else p = W.randomLand(this.rng, 45);
      if (!p) return null;
    }
    return this.makeEnt(arch, p.x, p.z, this.lvAt(arch, p.x, p.z));
  };
  // «бывалые»: на карте всегда есть динозавры минимум 7 уровня — двое сразу, а с ростом уровня игроков их становится больше
  RP.eliteWant = function (topL) { return 2 + Math.floor(Math.max(0, topL - 1) / 6); };
  RP.spawnElite = function (topL, near) {
    var W = this.W, table = W.cfg.spawn, cands = [], all = [], id, a, k, p;
    var hi = (CF.BOSS_LEVEL && CF.BOSS_LEVEL[this.biome]) || CF.MAX_LEVEL, lo = Math.max(1, hi - 3);   // бывалые: от (уровень босса − 3) до уровня босса
    for (id in table) { a = ARCH[id]; if (!a || a.tiny || (a.role !== 'hostile' && a.role !== 'herd') || !a.lv || !!a.water !== !!W.ocean) continue; all.push(a); if (a.lv[1] >= lo) cands.push(a); }
    if (!cands.length) cands = all;
    if (!cands.length) return null;
    var arch = cands[(this.rng() * cands.length) | 0], n = W.nest;
    for (k = 0; k < 24; k++) {
      p = arch.water ? W.randomWater(this.rng) : W.randomLand(this.rng, 45); if (!p) continue;
      if (Math.hypot(p.x - n.x, p.z - n.z) < 110) continue;
      if (near && Math.hypot(p.x - near.x, p.z - near.z) < 60) continue;
      var lv = clamp(topL + [-1, 0, 0, 1][(this.rng() * 4) | 0], lo, hi);
      var e = this.makeEnt(arch, p.x, p.z, lv); e.elite = true; return e;
    }
    return null;
  };
  RP.eliteFill = function (humans) {
    if (this.mode === 'rush' || this.W.duel) return;
    var topL = 1, cnt = 0, i, self = this;
    for (i = 0; i < humans.length; i++) if (humans[i].alive && !humans[i].gone) topL = Math.max(topL, humans[i].profile.level | 0);
    this.ents.forEach(function (e) { if (e.elite && !e.dead) cnt++; });
    if (cnt < this.eliteWant(topL)) this.spawnElite(topL, humans[0] && humans[0].st);
  };
  RP.initSpawns = function () {
    var table = this.W.cfg.spawn;
    for (var id in table) {
      // больше динозавров (баланс: SPAWN_MULT), букашки и рыба — как раньше
      var role = ARCH[id].role, n = Math.round(table[id] * (role === 'bug' || role === 'fish' ? 1 : role === 'hostile' ? (CF.HOSTILE_MULT || 1) : (CF.SPAWN_MULT || 1)));
      if (ARCH[id].water && !this.W.randomWater(this.rng)) continue;            // в этом биоме нет глубокой воды
      for (var i = 0; i < n; i++) this.spawnEnemy(id);
    }
    if (this.mode !== 'rush' && !this.W.duel) for (var j = 0; j < this.eliteWant(1); j++) this.spawnElite(1);
  };
  // защищает от падения при отсутствии воды: если воды нет — рыбу не создаём
  RP.queueRespawn = function (archId) { this.respawnQ.push({ t: this.t + (CF.RESPAWN_MIN || 22) + this.rng() * (CF.RESPAWN_RND || 22), id: archId }); };

  // ---------------------------------------------------------------- награда и смерть
  RP.onEntityKilled = function (src, e) {
    var self = this, arch = e.arch;
    this.events.push(['k', e.id, src && (src.owner || src).kind === 'p' ? (src.owner || src).id : 0]);
    this.ents.delete(e.id);
    if (e.owner || e.fromBoss) return;                                         // союзник или помощник босса
    var x = e.st.x, z = e.st.z;
    if (arch.drop) {
      var n = arch.tiny ? 1 : (arch.size >= 1.3 ? 3 : 2);
      for (var i = 0; i < n; i++) this.addDrop(arch.drop, x + (this.rng() - 0.5) * 2.4, z + (this.rng() - 0.5) * 2.4, arch.water ? (this.W.ocean ? e.st.y : this.W.waterY - 0.2) : undefined);
    }
    if (e.hitBy) {
      for (var pid in e.hitBy) {
        if (this.t - e.hitBy[pid] > 20) continue;
        var p = this.players.get(+pid);
        if (!p || p.bot) continue;
        var xp = Sim.xpReward(arch, e.lv, p.profile.level) * (arch.role === 'hostile' && this.isNight() ? 1.2 : 1);   // ночью за хищников на 20% больше опыта
        this.gainXp(p, xp);
        this.gainCoins(p, 1 + Math.floor(e.lv / 5) + (arch.role === 'hostile' ? 1 : 0));
        p.profile.stats.kills = (p.profile.stats.kills | 0) + 1;
        this.rareFind(p);
        if (arch.role !== 'bug' && arch.role !== 'fish') { this.questProgress(p, 'kill', 1); if (arch.role === 'hostile') this.questProgress(p, 'killh', 1); }
        if (!p.profile.seen) p.profile.seen = [];
        if (p.profile.seen.indexOf(arch.id) < 0 && arch.role !== 'bug') { p.profile.seen.push(arch.id); this.sendTo(p, { t: 'seen', id: arch.id }); }
        this.markDirty(p);
      }
    }
    if (this.mode !== 'rush' && !e.fill) this.queueRespawn(arch.id);
  };

  // ---------------------------------------------------------------- движение
  RP.groundOK = function (e, x, z) {
    var W = this.W, a = e.arch;
    if (W.isLava(x, z)) return !!(a.fly) || e.owner && false;
    if (a.water) return W.isDeep(x, z);
    if (a.fly) return true;
    if (W.isDeep(x, z)) return !!a.amph;
    return true;
  };
  RP.moveEnt = function (e, tx, tz, mult) {
    var s = e.st, W = this.W, a = e.arch, sp = e.speed * mult * (e.slowT > this.t ? 0.5 : 1);
    var dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { e.moving = false; return d; }
    var base = Math.atan2(dx, dz), tries = [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0], i, nx, nz, ang;
    for (i = 0; i < tries.length; i++) {
      ang = base + tries[i];
      nx = s.x + Math.sin(ang) * sp * DT; nz = s.z + Math.cos(ang) * sp * DT;
      if (!this.groundOK(e, nx, nz)) continue;
      var n = W.nest; if (e.team === 'e' && !e.boss && Math.hypot(nx - n.x, nz - n.z) < 22 && Math.hypot(s.x - n.x, s.z - n.z) > Math.hypot(nx - n.x, nz - n.z)) continue;   // у гнезда безопасно
      if (!a.fly && !a.water && W.heightAt(nx, nz) - W.heightAt(s.x, s.z) > 0.9) continue;
      if (!e.boss && !e.owner && Math.hypot(nx, nz) < CF.ARENA_R + 4 && Math.hypot(s.x, s.z) > CF.ARENA_R + 4) continue;   // в арену не заходят
      break;
    }
    if (i === tries.length) { e.moving = false; return d; }
    var r = Sim.resolve(W, nx, nz, a.fly ? 0.1 : e.radius * 0.8);
    s.x = r.x; s.z = r.z;
    s.face = wrap(s.face + wrap(ang - s.face) * Math.min(1, 9 * DT));
    e.moving = true;
    this.fixY(e);
    return d;
  };
  RP.fixY = function (e) {
    var s = e.st, W = this.W, a = e.arch, g = W.heightAt(s.x, s.z);
    e.bob += DT * 2;
    if (a.water) {
      var want;
      if (W.ocean) {                                                         // в океане — в трёх измерениях: за целью на её глубину
        var tg = e.target && e.target.st, base = tg ? tg.y : (e.swimY !== undefined ? e.swimY : W.waterY - 1.0);
        if (e.role === 'prey' || e.role === 'fish') { var np = this.nearestPlayer(e, 10); if (np) base = s.y + (s.y > np.st.y ? 1.5 : -1.5); }
        want = clamp(base + Math.sin(e.bob) * 0.3, g + 0.6, W.waterY - 0.6 - (a.size || 1) * 0.3);
        s.y += (want - s.y) * Math.min(1, 2.2 * DT);
      } else { want = Math.max(g + 0.4, W.waterY - 1.0 - Math.sin(e.bob) * 0.2); s.y += (want - s.y) * Math.min(1, 5 * DT); }
    }
    else if (a.fly) {
      var alt = (a.tiny ? 1.8 + Math.sin(e.bob) * 0.6 : (a.alt || 8) + Math.sin(e.bob * 0.5) * 1.5) + (e.diveTo !== undefined ? e.diveTo : 0);
      s.y += (g + alt - s.y) * Math.min(1, 3 * DT);
    }
    else if (a.amph && W.isWater(s.x, s.z)) s.y += (W.waterY - 0.4 - s.y) * Math.min(1, 6 * DT);
    else s.y += (g - s.y) * Math.min(1, 12 * DT);
  };
  RP.wander = function (e, speedMult, radius) {
    var s = e.st;
    if (this.t > e.wanderT || Math.hypot(e.wx - s.x, e.wz - s.z) < 1.5) {
      e.wanderT = this.t + 3 + this.rng() * 5;
      var a = this.rng() * 6.283, d = 4 + this.rng() * radius;
      e.wx = e.home.x + Math.cos(a) * d; e.wz = e.home.z + Math.sin(a) * d;
      if (this.rng() < 0.3) { e.wx = s.x; e.wz = s.z; e.moving = false; }       // иногда стоит на месте
      if (e.arch.water && this.W.ocean && this.rng() < 0.4) { e.swimY = this.pickSwimY(e.arch, this.W.heightAt(e.wx, e.wz)); }
    }
    this.moveEnt(e, e.wx, e.wz, speedMult);
  };

  // ---------------------------------------------------------------- цели
  RP.friendly = function (e, p) {
    if (this.mode === 'rush') return false;
    if (e.boss || e.fromBoss) return false;
    return e.role === 'hostile' && (p.profile.kings || []).indexOf(this.biome) >= 0;
  };
  // глубина плавания: мелкая рыба и добыча держатся в верхних слоях (там, где начинает игрок), крупные хищники — по всей толще
  RP.pickSwimY = function (arch, g0) {
    var W = this.W, top = W.waterY - 2, range = Math.max(0.5, W.waterY - 2.5 - g0), r = this.rng();
    if (arch.tiny || arch.role === 'fish' || arch.role === 'prey' || arch.lv && arch.lv[1] <= 5) return Math.max(g0 + 1, top - r * Math.min(range, 16));
    return g0 + 1 + r * range;
  };
  RP.canSee = function (e, p, aggro) {
    var d = dist(e.st, p.st), a = aggro;
    if (p.stats.stealth) a *= 1 - p.stats.stealth;
    if (p.hidden) a *= 1 - Math.min(0.9, 0.15 * (p.stats.ranks.ambush | 0) + 0.25);
    else if (p.cls === 'carn' && p.stats.ranks.ambush && p.still > 0.6) a *= 1 - 0.15 * p.stats.ranks.ambush;
    if (p.sub && !e.arch.water) a *= 0.4;
    if ((this.tod < 0.2 || this.tod > 0.8) && p.cls === 'carn') a *= 0.75;           // ночью хищный скрытнее
    return d < a;
  };
  // высота игрока над землёй/дном; летающего (fly) наземные враги не достают: ни в ближнем бою, ни издалека
  RP.airborne = function (p) { return !!(p.st && p.st.fly); };
  RP.canHitAir = function (e, p) {
    if (!this.airborne(p)) return true;
    var a = e.arch; if (!a) return false;
    if (a.fly && !a.tiny) return true;                                              // летающие враги — могут
    if (a.ranged) return (p.st.y - this.W.heightAt(p.st.x, p.st.z)) < 4;              // дальнобойные только по низко летящим
    return false;
  };
  // сильные враги (уровень выше игрока) замечают его с меньшей дальности: −12% за уровень разницы (минимум ×0.6); слабые — как обычно
  RP.aggroK = function (e, p) {
    var d = (e.lv || 0) - (p.profile ? p.profile.level : 0);
    return d > 0 ? Math.max(0.6, 1 - 0.12 * d) : 1;
  };
  RP.pickTarget = function (e) {
    var best = null, bd = 1e9, self = this, a = e.arch, aggro = (a.aggro || 20) * (CF.AGGRO_MULT || 0.75);
    // не больше MAX_CHASERS врагов гонятся за одним игроком одновременно: остальные ждут, пока кто-то отстанет или погибнет
    if (this._chTick !== this.tick) {
      this._chTick = this.tick; this._chN = {};
      this.ents.forEach(function (q) { if (!q.dead && q.target && q.target.kind === 'p' && q.arch && q.arch.role === 'hostile') self._chN[q.target.id] = (self._chN[q.target.id] || 0) + 1; });
    }
    var maxCh = CF.MAX_CHASERS || 4;
    this.players.forEach(function (p) {
      if ((self._chN[p.id] || 0) >= maxCh && e.target !== p) return;
      if (!p.alive || p.gone || p.shield > self.t || self.friendly(e, p)) return;
      if (p.st.clm) return;                                                          // на дереве не достать никому
      if (!self.canHitAir(e, p)) return;                                             // летающего с земли не достать
      if (a.water && !self.W.isWater(p.st.x, p.st.z)) return;                       // водные нападают только на тех, кто в воде
      var n = self.W.nest; if (Math.hypot(p.st.x - n.x, p.st.z - n.z) < 20) return;
      if (!self.canSee(e, p, aggro * self.aggroK(e, p))) return;
      var d = dist(e.st, p.st); if (d < bd) { bd = d; best = p; }
    });
    if (best && e.target !== best && a.role === 'hostile') self._chN[best.id] = (self._chN[best.id] || 0) + 1;     // учитываем сразу, иначе в один тик целью выберут все
    return best;
  };
  RP.nearestPlayer = function (e, maxD) {
    var best = null, bd = maxD, self = this;
    this.players.forEach(function (p) { if (!p.alive || p.gone) return; var d = dist(e.st, p.st); if (d < bd) { bd = d; best = p; } });
    return best;
  };

  // ---------------------------------------------------------------- враги
  RP.attackFrom = function (e, p) {
    var a = e.arch, t = this.t;
    if (p.kind === 'p' && !this.canHitAir(e, p)) { e.target = null; return; }
    e.atkCd = t + (a.ranged ? 1.8 : 1.15); e.atkAnim = 0.3;
    if (a.ranged && dist(e.st, p.st) > e.radius + 3) {
      e.shootAt = t + 0.6; e.shootTarget = p; this.events.push(['warn', e.id]);
      return;
    }
    this.hitTarget(e, p, e.dmg);
  };
  RP.hitTarget = function (e, p, dmg) {
    var a = e.arch;
    var done = this.damage(e, p, dmg);
    if (done > 0 && p.hp > 0) {
      if (a.poison) this.addDot(p, 'poison', a.poison * (1 + e.lv * 0.04), 5, e);
      if (a.burn) this.addDot(p, 'burn', a.burn * (1 + e.lv * 0.04), 4, e);
      if (a.slow && p.kind === 'p') p.slowT = this.t + 2.5;
    }
  };
  RP.enemyThink = function (e) {
    var t = this.t, s = e.st, a = e.arch, self = this;
    if (e.stunT > t) { e.moving = false; return; }
    this.tickDots(e); if (e.dead) return;
    e.atkAnim -= DT;
    if (e.shootAt && t >= e.shootAt) {
      e.shootAt = 0; var tg = e.shootTarget;
      if (tg && tg.hp > 0 && (tg.alive !== false) && dist(e.st, tg.st) < (a.ranged || 20) * 1.35) { this.events.push(['shot', e.id, r1(tg.st.x), r1(tg.st.y), r1(tg.st.z)]); this.hitTarget(e, tg, e.dmg); }
    }
    var role = e.role, p, d;
    if (role === 'bug') {
      this.wander(e, 0.5, 8);
      var near = null;
      this.players.forEach(function (q) { if (!near && q.alive && !q.gone && CF.CLASSES[q.cls].diet.indexOf('bug') >= 0 && Core.dist3(q.st, s) < 2.4) near = q; });
      if (near) { e.dead = true; this.ents.delete(e.id); this.consume(near, 'bug'); this.queueRespawn(a.id); }
      return;
    }
    if (role === 'fish') {
      p = this.nearestPlayer(e, 9);
      if (p && p.st.y < this.W.waterY + 1 && this.W.isWater(p.st.x, p.st.z) && e.hp > 0) { var ang = Math.atan2(s.x - p.st.x, s.z - p.st.z); this.moveEnt(e, s.x + Math.sin(ang) * 6, s.z + Math.cos(ang) * 6, 1.1); }
      else this.wander(e, 0.5, 14);
      return;
    }
    if (role === 'prey') {
      p = this.nearestPlayer(e, 15);
      if ((p && !p.hidden) || e.fleeT > t) {
        var from = (e.fleeT > t && e.fleeFrom && e.fleeFrom.st) ? e.fleeFrom : p;
        if (from) { var af = Math.atan2(s.x - from.st.x, s.z - from.st.z) + Math.sin(t * 2 + e.bob) * 0.5; this.moveEnt(e, s.x + Math.sin(af) * 10, s.z + Math.cos(af) * 10, 1.1); return; }
      }
      this.wander(e, 0.4, 12);
      return;
    }
    // herd и hostile: драка
    var tgt = e.target;
    if (role === 'herd') {
      if (e.aggroT > t && tgt && tgt.hp > 0 && tgt.alive !== false && !tgt.gone && (tgt.kind !== 'p' || this.canHitAir(e, tgt))) { /* мстит */ } else { e.target = null; tgt = null; }
    } else {
      if (e.fleeT > t) { var fa = e.fleeFrom && e.fleeFrom.st ? Math.atan2(s.x - e.fleeFrom.st.x, s.z - e.fleeFrom.st.z) : 0; this.moveEnt(e, s.x + Math.sin(fa) * 10, s.z + Math.cos(fa) * 10, 1.0); return; }
      if (tgt && (tgt.hp <= 0 || tgt.alive === false || tgt.gone || (tgt.kind === 'p' && (this.friendly(e, tgt) || tgt.shield > t || !this.canHitAir(e, tgt))))) { tgt = e.target = null; }
      if (!tgt || (this.tick + e.id) % 8 === 0) {
        var np = this.pickTarget(e);
        if (np) { tgt = e.target = np; e.lostT = t; }
        else if (tgt && !this.canSee(e, tgt, (a.aggro || 20) * 1.6 * (CF.AGGRO_MULT || 0.75) * (tgt.kind === 'p' ? this.aggroK(e, tgt) : 1))) { if (t - (e.lostT || 0) > 4) tgt = e.target = null; }
      }
    }
    if (tgt) {
      d = dist(e.st, tgt.st);
      var home = Math.hypot(s.x - e.home.x, s.z - e.home.z);
      if (home > 95) { e.target = null; e.aggroT = 0; this.moveEnt(e, e.home.x, e.home.z, 1.0); return; }
      var reach = e.radius + (tgt.stats ? tgt.stats.radius : 0.6) + 1.0;
      if (a.fly) {
        e.diveTo = d < 9 ? -(a.alt || 8) + 1.5 : 0;
      }
      if (a.ranged && d < a.ranged && d > 6) { this.faceTo(e, tgt); e.moving = false; if (t >= e.atkCd) this.attackFrom(e, tgt); if (a.fly) this.fixY(e); return; }
      var dyT = a.water && this.W.ocean ? Math.abs(s.y - tgt.st.y) : 0;      // под водой цель может быть выше/ниже
      if (d > reach) this.moveEnt(e, tgt.st.x, tgt.st.z, 1.0);
      else { this.faceTo(e, tgt); e.moving = false; if (dyT < reach + 1.2 && t >= e.atkCd) this.attackFrom(e, tgt); else if (dyT >= reach + 1.2) this.fixY(e); }
      if (a.fly && d <= reach) this.fixY(e);
    } else {
      e.diveTo = 0;
      var hd = Math.hypot(s.x - e.home.x, s.z - e.home.z);
      if (hd > 40) this.moveEnt(e, e.home.x, e.home.z, 0.8); else this.wander(e, role === 'herd' ? 0.35 : 0.45, 20);
    }
  };
  RP.faceTo = function (e, tgt) { e.st.face = wrap(e.st.face + wrap(Core.angTo(e.st, tgt.st) - e.st.face) * Math.min(1, 12 * DT)); };

  // ---------------------------------------------------------------- союзники
  RP.releaseAllies = function (p) {
    var self = this;
    this.ents.forEach(function (e) { if (e.owner === p) { self.ents.delete(e.id); } });
    p.allies = [];
  };
  RP.spawnAlly = function (p, archId, o) {
    var arch = ARCH[archId], s = p.st, a = this.rng() * 6.28;
    var e = this.makeEnt(arch, s.x + Math.cos(a) * 3, s.z + Math.sin(a) * 3, Math.max(1, p.profile.level), { team: 'p', owner: p, hpMult: o.hpMult || 1, dmgMult: o.dmgMult || 1, expire: o.expire || 0 });
    e.home = { x: s.x, z: s.z }; e.role = 'ally'; e.allyKind = o.kind;
    return e;
  };
  RP.spawnHerdAllies = function (p, n) {
    var r = p.stats.ranks.herd | 0, self = this;
    this.ents.forEach(function (e) { if (e.owner === p && e.allyKind === 'herd') self.ents.delete(e.id); });
    for (var i = 0; i < n; i++) this.spawnAlly(p, CF.ALLY.herb, { kind: 'herd', expire: this.t + CF.HERD_SEC + r * 3, hpMult: 1.4 + 0.15 * r, dmgMult: 0.9 + 0.12 * r });
  };
  RP.allyThink = function (e) {
    var t = this.t, o = e.owner, s = e.st, self = this;
    if (!o || o.gone === undefined || !this.players.has(o.id) || (e.expire && t > e.expire)) { e.dead = true; this.ents.delete(e.id); return; }
    if (!o.alive) { return; }
    if (e.stunT > t) return;
    this.tickDots(e); if (e.dead) return;
    e.atkAnim -= DT;
    var d = dist(s, o.st);
    if (d > 70) { s.x = o.st.x + 2; s.z = o.st.z + 2; s.y = this.W.heightAt(s.x, s.z); return; }
    // цель: ближайший враг рядом с хозяином
    var tgt = e.target;
    if (tgt && (tgt.hp <= 0 || tgt.dead || !this.ents.has(tgt.id))) tgt = e.target = null;
    if (!tgt || (this.tick + e.id) % 10 === 0) {
      var best = null, bd = 18;
      this.ents.forEach(function (x) {
        if (x.team !== 'e' || !(x.hp > 0) || x.dead) return;
        var dd = Math.min(dist(x.st, s), dist(x.st, o.st) + 2); if (dd < bd) { bd = dd; best = x; }
      });
      if (!best && (this.W.duel === false)) { /* нет цели */ }
      tgt = e.target = best;
    }
    if (tgt) {
      var dt2 = dist(s, tgt.st), reach = e.radius + (tgt.radius || 1) + 1.0;
      if (dt2 > reach) this.moveEnt(e, tgt.st.x, tgt.st.z, 1.05);
      else { this.faceTo(e, tgt); e.moving = false; if (t >= e.atkCd) { e.atkCd = t + 1.1; e.atkAnim = 0.3; this.damage(e, tgt, e.dmg); } }
    } else if (d > 8) this.moveEnt(e, o.st.x + Math.sin(e.id) * 3, o.st.z + Math.cos(e.id) * 3, d > 20 ? 1.3 : 0.9);
    else e.moving = false;
  };
  // король биома: ручные динозавры биома следуют за ним
  RP.ensureKingAllies = function (p) {
    return;   // за игроком никто не ходит: биом просто становится дружелюбным
    if (this.mode === 'rush' || p.bot || this.W.duel) return;
    if ((p.profile.kings || []).indexOf(this.biome) < 0) return;
    var n = 0, self = this;
    this.ents.forEach(function (e) { if (e.owner === p && e.allyKind === 'king') n++; });
    if (n >= CF.KING_ALLIES) return;
    if (p.kingAllyT && this.t < p.kingAllyT) return;
    p.kingAllyT = this.t + 20;
    this.spawnAlly(p, CF.ALLY.king[this.biome], { kind: 'king', hpMult: 1.2, dmgMult: 0.8 });
  };

  // ---------------------------------------------------------------- боты (играют вместо людей в одиночной игре)
  RP.addBots = function (n) {
    var humans = [], self = this;
    this.players.forEach(function (p) { if (!p.bot) humans.push(p); });
    var lvl = humans.length ? humans[0].profile.level : 1;
    for (var i = 0; i < n; i++) {
      var pr = Sim.defaultProfile(BOT_NAMES[(this.rng() * BOT_NAMES.length) | 0]);
      pr.hatched = true; pr.cls = i % 2 ? 'herb' : 'carn'; pr.color = (this.rng() * 12) | 0; pr.level = clamp(lvl + ((this.rng() * 5) | 0) - 2, 1, 30);
      var b = this.makePlayer(pr, null, { bot: true, index: i + 2 });
      b.room = this; b.profile.evo = {}; b.ai = { t: 0, tx: 0, tz: 0, q: 0 };
      this.refreshStats(b); b.hp = b.stats.hp; b.shield = this.t + 3;
      this.players.set(b.id, b);
      this.broadcast({ t: 'join', p: this.pubInfo(b) }, b.id);
    }
  };
  RP.botThink = function (b) {
    if (!b.alive) return;
    var a = b.ai, s = b.st, self = this, tgt = null, bd = 34;
    if (this.tick % 6 === 0 || !a.tgt || a.tgt.hp <= 0 || a.tgt.dead) {
      a.tgt = null;
      this.ents.forEach(function (e) {
        if (e.dead || !(e.hp > 0) || e.team === 'p' || e.role === 'bug' || (e.role === 'fish') || e.boss) return;
        if (e.role === 'herd' && b.cls === 'herb') return;
        var d = dist(e.st, s); if (d < bd && e.lv <= b.profile.level + 4) { bd = d; a.tgt = e; }
      });
    }
    tgt = a.tgt;
    var f = 0, yaw = 0, sp = false;
    if (tgt) {
      var d = dist(tgt.st, s), reach = b.stats.reach + (tgt.radius || 0.6);
      if (d > reach * 0.8) { f = 1; yaw = Core.angTo(s, tgt.st) + Math.PI; sp = d > 12 && s.stam > 50; }
      else { s.face = wrap(s.face + wrap(Core.angTo(s, tgt.st) - s.face) * 0.5); if (b.cd.atk <= 0) b.wantAtk = true; }
    } else {
      // следуем за ближайшим человеком или бродим
      var hum = null, hd = 1e9;
      this.players.forEach(function (p) { if (!p.bot && p.alive && !p.gone) { var dd = dist(p.st, s); if (dd < hd) { hd = dd; hum = p; } } });
      if (hum && hd > 9) { f = 1; yaw = Core.angTo(s, hum.st) + Math.PI; sp = hd > 30 && s.stam > 50; }
      else if (hum) { f = 0; }
      else { if (this.t > (a.wt || 0)) { a.wt = this.t + 4; a.tx = s.x + (this.rng() - 0.5) * 40; a.tz = s.z + (this.rng() - 0.5) * 40; } f = 1; yaw = Math.atan2(a.tx - s.x, a.tz - s.z) + Math.PI; }
    }
    if (this.W.isDeep(s.x, s.z) && !b.stats) f = 0;
    a.q++; b.lastQ = a.q;
    b.q.push({ q: a.q, f: f, s: 0, yaw: yaw, jump: false, down: false, sprint: sp });
    if (b.q.length > 2) b.q.shift();
  };
  RP.slowFor = function (p) { return (p.slowT > this.t ? 0.65 : 1) * (p.buffK === 'speed' && p.buffT > this.t ? 1.2 : 1) * (p.ultT > this.t ? p.ultSpd : 1); };

  // ---------------------------------------------------------------- такт сущностей

  // «подпитка» прокачки: рядом с каждым игроком всегда должно быть достаточно врагов, которых он может победить (уровень L-2…L+1).
  // Если их мало — рядом появляются существа местных видов нужного уровня; убитые не возрождаются, далёкие со временем убираются.
  RP.isNight = function () { return this.tod < 0.22 || this.tod > 0.78; };
  RP.isStorm = function () { return this.wx > 0.6; };
  RP.levelFill = function (humans) {
    if (this.mode === 'rush' || this.W.duel) return;
    this.eliteFill(humans);
    var W = this.W, self = this, table = W.cfg.spawn, ids = [];
    for (var id in table) if (ARCH[id] && ARCH[id].role !== 'bug') ids.push(id);
    if (!ids.length) return;
    var fills = [];
    this.ents.forEach(function (e) { if (e.fill && !e.dead) fills.push(e); });
    var near = function (e, p, R) { return Math.abs(e.st.x - p.st.x) < R && Math.abs(e.st.z - p.st.z) < R; };
    for (var h = 0; h < humans.length; h++) {
      var p = humans[h]; if (!p.alive || p.gone) continue;
      var L = p.profile.level, hostN = 0, othN = 0, xH = 0, xO = 0, herdN = 0, hostList = [];
      this.ents.forEach(function (e) {
        if (e.dead || e.kind !== 'e' || e.owner || e.boss || e.arch.role === 'bug' || e.fromBoss) return;
        var isH = e.arch.role === 'hostile';
        if (e.lv >= L - 1 && e.lv <= L + 1 && near(e, p, 130)) { if (isH) { hostN++; hostList.push(e); } else othN++; }
        if (e.xtra && near(e, p, 170)) { if (isH) xH++; else xO++; }
        if (e.arch.role === 'herd' && e.lv >= L - 2 && e.lv <= L + 2 && near(e, p, 150)) herdN++;
      });
      // «ядро»: вокруг игрока на разных расстояниях и в разных местах — до 4 нападающих и 5 обычных врагов его уровня (L−1…L+1)
      // чем выше уровень, тем больше врагов: на 1–3 уровне поменьше нападающих (спокойный старт), к 7+ — полный набор
      var KS = L <= 3 ? 0 : L <= 6 ? 1 : 2, fH = [3, 5, CF.FILL_HOST || 7][KS], fO = [6, 8, CF.FILL_OTHER || 9][KS],
          fXH = [2, 3, CF.FILL_XHOST || 4][KS], fXO = [4, 5, CF.FILL_XOTHER || 6][KS];
      if (this.isNight()) { fH += 2; fXH += 1; }   // ночью хищников больше
      // слишком много нападающих вашего уровня (природные + подпитка): лишних, что далеко и не гонятся, тихо убираем — баланс по таблице
      if (hostN > fH + 1) {
        hostList = hostList.filter(function (e) { return !e.target && Math.hypot(e.st.x - p.st.x, e.st.z - p.st.z) > 45; })
          .sort(function (a, b) { return Math.hypot(b.st.x - p.st.x, b.st.z - p.st.z) - Math.hypot(a.st.x - p.st.x, a.st.z - p.st.z); });
        for (var rm = 0; rm < Math.min(2, hostN - fH - 1, hostList.length); rm++) { hostList[rm].dead = true; this.ents.delete(hostList[rm].id); hostN--; }
      }
      var plan = [], q;
      for (q = hostN; q < fH; q++) plan.push({ lv: Math.max(1, L + [-1, 0, 0, 1][(this.rng() * 4) | 0]), host: true, xtra: false });
      for (q = othN; q < fO; q++) plan.push({ lv: Math.max(1, L + [-1, 0, 0, 1][(this.rng() * 4) | 0]), host: false, xtra: false });
      // «случайные»: ещё до 4 нападающих и 6 обычных любого уровня, раскиданных по карте шире
      for (q = xH; q < fXH; q++) plan.push({ lv: Math.max(1, L - 3 + ((this.rng() * 5) | 0)), host: true, xtra: true });
      for (q = xO; q < fXO; q++) plan.push({ lv: Math.max(1, L - 3 + ((this.rng() * 8) | 0)), host: false, xtra: true });
      // всегда рядом есть 4 нейтральных динозавра (стадо) уровней L−2…L+2: их не бывает меньше, на любом уровне игрока
      for (q = herdN; q < (CF.FILL_NEUTRAL || 4); q++) plan.unshift({ lv: Math.max(1, L - 2 + ((this.rng() * 5) | 0)), host: false, xtra: false, herdOnly: true });
      for (var n = 0; n < Math.min(4, plan.length); n++) {
        var pl = plan[n], tl = pl.lv, host = pl.host, cands = [];
        for (var i = 0; i < ids.length; i++) { var a = ARCH[ids[i]]; if (!!a.water !== !!W.ocean) continue; if ((a.role === 'hostile') !== host) continue; if (pl.herdOnly && a.role !== 'herd') continue; if (tl >= a.lv[0] - 2) cands.push(a); }
        if (!cands.length) continue;
        var arch = cands[(this.rng() * cands.length) | 0], pos = null;
        for (var k = 0; k < 18 && !pos; k++) {
          var ang = this.rng() * 6.283, dd = pl.xtra ? 55 + this.rng() * 90 : 45 + this.rng() * 65, x = p.st.x + Math.cos(ang) * dd, z = p.st.z + Math.sin(ang) * dd;
          if (Math.abs(x) > W.half - 30 || Math.abs(z) > W.half - 30 || Math.hypot(x, z) < CF.ARENA_R + 8) continue;
          var gh = W.heightAt(x, z);
          if (arch.water ? !W.isDeep(x, z) : (gh < W.waterY + 0.8 || W.isLava(x, z) || W.slopeAt(x, z) > 0.7)) continue;
          if (host) { var crowd = false; for (var f2 = 0; f2 < fills.length; f2++) if (!fills[f2].dead && fills[f2].arch.role === 'hostile' && Math.hypot(fills[f2].st.x - x, fills[f2].st.z - z) < 34) { crowd = true; break; } if (crowd) continue; }   // нападающие — не кучей, а в разных местах
          pos = { x: x, z: z };
        }
        if (!pos) continue;
        var e = this.makeEnt(arch, pos.x, pos.z, tl); e.fill = true; e.xtra = pl.xtra; fills.push(e);
      }
    }
    // лимит и уборка: самых далёких от игроков «подпитывающих» убираем
    var cap = 60 * Math.max(1, humans.length);
    if (fills.length > cap) {
      fills.sort(function (a, b) { var da = 1e9, db = 1e9; for (var i = 0; i < humans.length; i++) { da = Math.min(da, Math.hypot(a.st.x - humans[i].st.x, a.st.z - humans[i].st.z)); db = Math.min(db, Math.hypot(b.st.x - humans[i].st.x, b.st.z - humans[i].st.z)); } return db - da; });
      for (var j = 0; j < fills.length - cap; j++) { fills[j].dead = true; this.ents.delete(fills[j].id); }
    }
  };

  // ---------------------------------------------------------------- гроза и секреты
  // в грозу шанс редкой находки (монеты) при победе и еде
  RP.petAct = function (p) {
    var pt = p.profile.pet, s = p.st, self = this;
    if (pt === 'chick' && p.hp < p.stats.hp && this.t - (p.lastHurt || 0) > 4) { p.hp = Math.min(p.stats.hp, p.hp + p.stats.hp * 0.04); this.events.push(['pet', p.id, 0]); }
    else if (pt === 'lizard' && this.rng() < 0.3) { var c = 3 + ((this.rng() * 6) | 0) + Math.floor(p.profile.level / 4); this.gainCoins(p, c); this.events.push(['pet', p.id, 1, c]); }
    else if (pt === 'hedgehog') {
      var best = null, bd = 8;
      this.ents.forEach(function (e) {
        if (!(e.hp > 0) || e.dead || e.team === p.team || e.kind === 'b' || e.role === 'bug' || e.kind !== 'e' || e.role === 'herd' || e.role === 'prey') return;
        var d = dist(e.st, s); if (d < bd) { bd = d; best = e; }
      });
      if (best) { this.damage(p, best, p.stats.dmg * 0.35, { noThorns: true, noUlt: true }); this.events.push(['pet', p.id, 2, best.id]); }
    }
  };
  RP.rareFind = function (p) {
    if (!this.isStorm() || p.bot || this.rng() > 0.12) return;
    var c = 12 + ((this.rng() * 28) | 0); this.gainCoins(p, c); this.events.push(['rare', p.id, c]);
  };
  RP.updateStorm = function () {
    if (!this.isStorm() || this.W.duel || this.mode === 'rush' || this.t < (this.boltT || 0)) return;
    this.boltT = this.t + 5 + this.rng() * 8;
    var hs = []; this.players.forEach(function (q) { if (!q.bot && q.alive && !q.gone) hs.push(q); });
    if (!hs.length) return;
    var q = hs[(this.rng() * hs.length) | 0];
    this.events.push(['bolt', r1(q.st.x + (this.rng() - 0.5) * 110), r1(q.st.z + (this.rng() - 0.5) * 110)]);
  };
  // секреты: сундуки (монеты) и золотые плоды (усиление на время). Показываются только вблизи, после сбора возрождаются в другом месте
  var BUFFS = ['speed', 'dmg', 'regen'];
  RP.secretPos = function (kind) {
    var W = this.W, st = this.W.nest;
    for (var k = 0; k < 40; k++) {
      var x, z, y;
      if (W.features && W.features.caves && W.features.caves.length && kind === 'chest' && k < 14) { var c = W.features.caves[(this.rng() * W.features.caves.length) | 0]; x = c.x + (this.rng() - 0.5) * c.L * 0.5 * Math.cos(c.a); z = c.z + (this.rng() - 0.5) * c.L * 0.5 * Math.sin(c.a); y = c.f + 0.6; }
      else { x = (this.rng() - 0.5) * (W.half - 40) * 2; z = (this.rng() - 0.5) * (W.half - 40) * 2; y = W.heightAt(x, z); }
      if (Math.hypot(x, z) < CF.ARENA_R + 12 || Math.hypot(x - st.x, z - st.z) < 45) continue;
      if (W.ocean ? !W.isDeep(x, z) : (y < W.waterY + 0.8 || W.isLava(x, z) || W.slopeAt(x, z) > 0.6)) continue;
      return { x: r1(x), y: r1(y), z: r1(z) };
    }
    return null;
  };
  RP.updateSecrets = function (humans) {
    if (this.W.duel || this.mode === 'rush') return;
    if (!this.secrets) {
      this.secrets = [];
      // в океане сокровищ больше: 10 сундуков, 3 золотых плода и 4 жемчужины в гигантских раковинах
      var NS = this.W.ocean ? 17 : 7, nChest = this.W.ocean ? 10 : 4, nFruit = this.W.ocean ? 3 : 3;
      for (var i = 0; i < NS; i++) { var kind = i < nChest ? 'chest' : i < nChest + nFruit ? 'fruit' : 'pearl', pos = this.secretPos(kind); if (pos) this.secrets.push({ id: newId(), k: kind, x: pos.x, y: pos.y, z: pos.z, ready: 0 }); }
    }
    for (var j = 0; j < this.secrets.length; j++) {
      var sc = this.secrets[j]; if (sc.ready > this.t) continue;
      for (var h = 0; h < humans.length; h++) {
        var p = humans[h]; if (!p.alive || p.gone) continue;
        if (Math.hypot(p.st.x - sc.x, p.st.z - sc.z) > 3.2 || Math.abs(p.st.y - sc.y) > 7) continue;
        this.collectSecret(p, sc); break;
      }
    }
  };
  RP.collectSecret = function (p, sc) {
    var lv = p.profile.level, coins = 0, buff = '';
    if (sc.k === 'pearl') { coins = 90 + lv * 6 + ((this.rng() * 80) | 0); this.gainCoins(p, coins); this.gainXp(p, 30 + lv * 6); }
    else if (sc.k === 'chest') { coins = 35 + lv * 3 + ((this.rng() * 40) | 0); this.gainCoins(p, coins); this.gainXp(p, 20 + lv * 4); }
    else { buff = BUFFS[(this.rng() * BUFFS.length) | 0]; p.buffK = buff; p.buffT = this.t + 90; this.gainXp(p, 12 + lv * 2); }
    this.events.push(['sec', p.id, sc.k, coins, buff]);
    this.markDirty(p);
    var pos = this.secretPos(sc.k); if (pos) { sc.x = pos.x; sc.y = pos.y; sc.z = pos.z; }
    sc.ready = this.t + 240;
  };

  RP.updateEnts = function () {
    var t = this.t, self = this, humans = [];
    this.players.forEach(function (p) { if (!p.bot && !p.gone) humans.push(p); });
    this.ents.forEach(function (e) {
      if (e.dead) { self.ents.delete(e.id); return; }
      if (e.kind === 'b') return;                                                // боссом занимается boss.js
      if (e.owner) { self.allyThink(e); return; }
      var near = false;
      for (var i = 0; i < humans.length; i++) if (Math.abs(humans[i].st.x - e.st.x) < 150 && Math.abs(humans[i].st.z - e.st.z) < 150) { near = true; break; }
      if (!near && !e.boss) return;                                              // далеко от игроков мир «спит»
      self.enemyThink(e);
    });
    if (this.tick % 30 === 7) this.levelFill(humans);
    if (this.tick % 25 === 11) this.updateStorm();
    if (this.tick % 5 === 2) this.updateSecrets(humans);
    if (this.tick % 75 === 9) humans.forEach(function (p) { if (p.alive && !p.gone && p.profile.pet) self.petAct(p); });
    if (this.tick % 25 === 5) humans.forEach(function (p) { if (p.alive && p.buffK === 'regen' && p.buffT > self.t) p.hp = Math.min(p.stats.hp, p.hp + p.stats.hp * 0.03); });
    if (this.tick % 30 === 3) humans.forEach(function (p) { if (p.alive && !p.gone) { p.profile.playTime = (p.profile.playTime | 0) + 1; self.questProgress(p, 'play', 1); } });
    // союзники-короли
    if (this.tick % 25 === 0) this.players.forEach(function (p) { if (!p.bot && p.alive) self.ensureKingAllies(p); });
    // возрождение мира
    for (var i = this.respawnQ.length - 1; i >= 0; i--) {
      var q = this.respawnQ[i];
      if (t >= q.t) {
        this.respawnQ.splice(i, 1);
        var pos = null;
        for (var k = 0; k < 5; k++) {
          var cand = ARCH[q.id].water ? this.W.randomWater(this.rng) : this.W.randomLand(this.rng, 45);
          if (!cand) break;
          var ok = true;
          for (var j = 0; j < humans.length; j++) if (Math.hypot(humans[j].st.x - cand.x, humans[j].st.z - cand.z) < 45) { ok = false; break; }
          if (ok) { pos = cand; break; }
        }
        if (pos) this.spawnEnemy(q.id, pos); else this.respawnQ.push({ t: t + 8, id: q.id });
      }
    }
  };
  RP.onHumanJoin = function (p) {
    // игрок в одиночной игре один — без ботов-спутников
  };
});

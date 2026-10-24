/* Dino Evolution — игровая логика комнат (ядро). UMD: работает на сервере (онлайн) и в браузере (одиночная игра офлайн).
   Ничего не знает о сети: у игрока есть conn с методом send(text). Клиент присылает только ввод и команды,
   позиции, урон, опыт, награды и профиль считает только эта логика.
   Дополнения (методы Room) лежат в ai.js (враги, боты, союзники), boss.js (боссы, зоны урона, среда, босс-раш), duel.js (дуэли, турнир). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var Core = factory(require('./sim.js'), require('./config.js'));
    require('./ai.js')(Core); require('./boss.js')(Core); require('./duel.js')(Core);
    module.exports = Core;
  } else { root.RoomsCore = root.Rooms = factory(root.Sim, root.CONFIG); }
})(typeof self !== 'undefined' ? self : this, function (Sim, CF) {
  'use strict';
  var DT = 1 / CF.TICK_RATE;
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var r3 = function (v) { return Math.round(v * 1000) / 1000; };
  var clamp = Sim.clamp, wrap = Sim.wrap;
  var nextEntId = 1;
  function newId() { return nextEntId++; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  function angTo(a, b) { return Math.atan2(b.x - a.x, b.z - a.z); }
  var ARCH_IDS = Object.keys(CF.ENEMIES), ARCH_INDEX = {};
  ARCH_IDS.forEach(function (k, i) { ARCH_INDEX[k] = i; });
  var BOSS_IDS = Object.keys(CF.BOSSES).filter(function (k) { return !CF.BOSSES[k].sea; });   // босс-раш — боссы суши

  var Core = { Sim: Sim, CF: CF, DT: DT, r1: r1, r2: r2, r3: r3, clamp: clamp, wrap: wrap, newId: newId, dist: dist, dist3: dist3, angTo: angTo, ARCH_IDS: ARCH_IDS, ARCH_INDEX: ARCH_INDEX, BOSS_IDS: BOSS_IDS };

  // флаги игрока в снимке
  var F = { SHIELD: 1, FLY: 2, SUB: 4, CLM: 8, GRD: 16, ATK: 32, DEAD: 64, HIDE: 128, KING: 256, LORD: 512, STUN: 1024, MOVE: 2048, BOT: 4096, ALLY: 8192 };
  Core.F = F;

  function Room(hub, o) {
    this.hub = hub; this.id = o.id; this.biome = o.biome; this.code = o.code || null; this.mode = o.mode || 'public';
    this.W = Sim.getWorld(this.biome);
    this.players = new Map(); this.ents = new Map(); this.drops = []; this.plants = []; this.zones = [];
    this.events = []; this.t = 0; this.tick = 0; this.tod = 0.3; this.wx = 0; this.noPlayersT = 0;
    this.maxHumans = this.mode === 'solo' ? 1 : this.mode === 'duel' ? 2 : CF.MAX_ROOM;
    this.rng = Sim.mulberry32((Math.random() * 1e9) | 0);
    this.respawnQ = [];
    this.boss = null; this.bossCool = 0; this.rush = null; this.duel = null;
    this.hazT = 0; this.rockT = 6;
    if (this.mode !== 'duel') { this.initPlants(); this.initSpawns(); this.initBoss(); }
    if (this.mode === 'rush') this.initRush();
  }
  Core.Room = Room;
  var RP = Room.prototype;

  // ---------------------------------------------------------------- игроки
  RP.humans = function () { var n = 0; this.players.forEach(function (p) { if (!p.bot && !p.gone) n++; }); return n; };
  RP.hasHuman = function () { var h = false; this.players.forEach(function (p) { if (!p.bot) h = true; }); return h; };

  RP.pubInfo = function (p) {
    return {
      id: p.id, nick: p.name, color: p.color, cls: p.cls, level: p.profile.level, evo: p.profile.evo, cosmetic: p.profile.cosmetic || '', pet: p.profile.pet || '', title: p.profile.title || '', nest: p.profile.nest ? p.profile.nest.put : [], patc: p.profile.patc || '', rfx: p.profile.rfx || '', morph: p.profile.morph || '',
      admin: !!p.admin, king: (p.profile.kings || []).indexOf(this.biome) >= 0, lord: Sim.isLord(p.profile), end: p.profile.ending || '', bot: !!p.bot, team: p.team
    };
  };
  RP.refreshStats = function (p, keepRatio) {
    var pr = p.profile, old = p.stats ? p.hp / p.stats.hp : 1;
    p.stats = Sim.statsFor(p.cls, pr.level, pr.evo);
    p.hp = keepRatio ? clamp(old, 0, 1) * p.stats.hp : Math.min(p.hp, p.stats.hp);
  };
  RP.makePlayer = function (profile, conn, opts) {
    opts = opts || {};
    var pos = this.spawnPoint(opts.index || 0);
    var pr = profile;
    var p = {
      id: newId(), kind: 'p', conn: conn || null, profile: pr, userId: opts.userId || 0, name: pr.name || 'Dino', color: pr.color | 0, cls: pr.cls || 'carn',
      admin: !!opts.admin, bot: !!opts.bot, team: 'p', alive: true, gone: false, goneAt: 0,
      st: Sim.newPlayer(this.W, pos.x, pos.z), stats: null, hp: 1, food: CF.FOOD_MAX, breath: CF.BREATH_MAX,
      q: [], ack: 0, lastQ: 0, rs: 0, respawnAt: 0, shield: 0, cd: { atk: 0, e: 0, q: 0, f: 0 }, combo: 0, comboT: 0, rage: 0,
      lastHurt: -99, lastAtk: -99, dots: [], buffs: {}, hitBy: null, emoteT: -9, atkAnim: 0, spr: false, still: 0, hidden: false,
      pounce: null, ult: 0, ultT: 0, ultMul: 1, ultSpd: 1, diveT: 0, diveAlt: 0, allies: [], dirty: false, dirtyT: 0, deadBy: '', lastProf: 0, killT: 0, input: { f: 0, s: 0 }, dmgDone: 0
    };
    p.st.face = opts.face !== undefined ? opts.face : 0;
    this.refreshStats(p); p.hp = p.stats.hp;
    p.breath = p.stats.breathMax;
    return p;
  };
  RP.spawnPoint = function (index) {
    if (this.W.duel) { var s = index % 2 ? 1 : -1; return { x: s * (CF.DUEL_R - 7), z: 0 }; }
    // первый игрок появляется в центре гнезда (там его яйцо), остальные — вокруг
    var n = this.W.nest, a = index * 1.57, rr = index ? 4 : 0;
    return { x: n.x + Math.cos(a) * rr, z: n.z + Math.sin(a) * rr };
  };
  RP.addPlayer = function (profile, conn, opts) {
    var p = this.makePlayer(profile, conn, opts);
    p.room = this;
    var self = this;
    this.players.set(p.id, p);
    if (!p.bot && !this.hostId) this.hostId = p.id;
    if (!p.bot && p.profile.hatched) { var lr = Sim.dailyRoll(p.profile, Date.now()); if (lr) { p.loginInfo = lr; p.dirty = true; } var se = Sim.seasonRoll(p.profile, Date.now()); if (se) { p.seasonInfo = se; p.dirty = true; } }   // новый день: задания и награда за вход
    if (p.conn) this.sendTo(p, this.welcomeMsg(p));
    this.broadcast({ t: 'join', p: this.pubInfo(p) }, p.id);
    if (!p.bot) { this.onHumanJoin(p); }
    return p;
  };
  RP.roster = function (exceptId) {
    var out = [], self = this;
    this.players.forEach(function (p) { if (p.id !== exceptId) out.push(self.pubInfo(p)); });
    return out;
  };
  RP.removePlayer = function (p) {
    this.releaseAllies(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'leave', id: p.id });
    this.onHumanLeave(p);
  };
  RP.sendTo = function (p, obj) { if (p.conn) { try { p.conn.send(JSON.stringify(obj)); } catch (e) { /* сокет закрыт */ } } };
  RP.broadcast = function (obj, exceptId) {
    var s = JSON.stringify(obj);
    this.players.forEach(function (p) { if (p.conn && p.id !== exceptId && !p.gone) { try { p.conn.send(s); } catch (e) { /* ignore */ } } });
  };
  RP.markDirty = function (p) { p.dirty = true; };
  RP.flushProfile = function (p, force) {
    if (!p.dirty && !force) return;
    p.dirty = false;
    var pr = p.profile; pr.xp = pr.totalXp - CF.cumXp(pr.level);
    this.sendTo(p, { t: 'prof', p: pr });
    if (this.hub.onSave) this.hub.onSave(p);
  };
  // прогресс ежедневных заданий (type: kill | killh | eat | play | boss)
  RP.questProgress = function (p, type, n) {
    if (p.bot || !p.profile || !p.profile.hatched) return;
    var pr = p.profile, rl = Sim.dailyRoll(pr, Date.now());
    if (rl) { p.loginInfo = rl; this.sendTo(p, { t: 'login', l: rl }); this.markDirty(p); }
    var done = Sim.questAdd(pr, type, n || 1);
    if (!done.length) return;
    for (var i = 0; i < done.length; i++) {
      pr.stats.quests = (pr.stats.quests | 0) + 1;
      var c = done[i].coins + (done[i].all ? CF.QUEST_BONUS : 0);
      this.gainCoins(p, c);
      this.events.push(['quest', p.id, done[i].i, c, done[i].all ? 1 : 0]);
    }
    this.markDirty(p);
  };
  RP.onHumanJoin = function () { };
  RP.onHumanLeave = function () { };

  // ---------------------------------------------------------------- опыт, уровни, монеты
  RP.gainXp = function (p, amount) {
    var pr = p.profile; if (p.bot || amount <= 0) return;
    var maxT = CF.cumXp(CF.MAX_LEVEL);
    var before = pr.level;
    if (p.stats && p.stats.fx.xp) amount *= 1 + p.stats.fx.xp / 100;
    if (pr.pet === 'firefly') amount *= 1.1;
    pr.totalXp = Math.min(maxT, pr.totalXp + Math.round(amount));
    var lv = CF.levelFromTotal(pr.totalXp);
    if (lv > pr.level) {
      pr.level = lv; this.refreshStats(p); p.hp = p.stats.hp; p.food = Math.min(CF.FOOD_MAX, p.food + 20);
      this.events.push(['lv', p.id, lv]);
      this.broadcast({ t: 'upd', p: { id: p.id, level: lv } }, p.id);
      this.onLevelUp(p, before, lv);
    }
    this.events.push(['xp', p.id, Math.round(amount)]);
    this.markDirty(p);
  };
  RP.onLevelUp = function () { };
  RP.gainCoins = function (p, n) {
    if (p.bot || n <= 0) return;
    if (p.stats && p.stats.fx.coins) n = Math.round(n * (1 + p.stats.fx.coins / 100));
    p.profile.coins += n; p.profile.stats.coinsEarned = (p.profile.stats.coinsEarned || 0) + n; this.markDirty(p);
  };

  // ---------------------------------------------------------------- команды клиента
  RP.handle = function (p, m) {
    switch (m.t) {
      case 'in': {
        var inp = Sim.cleanInput(m);
        if (inp && inp.q > p.lastQ && p.q.length < 12) { p.lastQ = inp.q; p.q.push(inp); }
        break;
      }
      case 'act': this.action(p, m); break;
      case 'evo': this.buyEvo(p, m.id); break;
      case 'evoreset': this.resetEvo(p); break;
      case 'evosw': this.switchEvo(p, m.id); break;
      case 'revive': this.revivePlayer(p, m.id); break;
      case 'story': {   // сюжетные метки: пролог, зов моря, погружение, Сердце (один раз); «cine» — защита на время ролика
        var sk = m.k;
        if (sk === 'cine') { p.shield = Math.max(p.shield || 0, this.t + 40); break; }
        if (['pro', 'call', 'dive', 'heart'].indexOf(sk) >= 0) { var spf = p.profile; if (!spf.story || typeof spf.story !== 'object') spf.story = {}; if (!spf.story[sk]) { spf.story[sk] = 1; this.markDirty(p); this.flushProfile(p, true); } }
        break;
      }
      case 'ending': this.chooseEnding(p, m.id); break;
      case 'warp': {   // ролик «всасывает в портал»: после победы над боссом отправляем в следующую локацию
        var wl2 = CF.worldList(CF.worldOf(this.biome)), ix2 = wl2.indexOf(this.biome);
        if (this.mode !== 'rush' && this.mode !== 'duel' && ix2 >= 0 && ix2 < wl2.length - 1 && p.profile.kings.indexOf(this.biome) >= 0 && this.t - (p.travelT || -99) > 3) { p.travelT = this.t; p.shield = Math.max(p.shield || 0, this.t + 6); this.hub.travelQ.push({ p: p, biome: wl2[ix2 + 1] }); }
        break;
      }
      case 'goto': {   // выбор пройденной локации прямо из игры
        var gb = String(m.biome || '');
        if (this.mode !== 'rush' && this.mode !== 'duel' && gb !== this.biome && CF.worldOf(gb) === CF.worldOf(this.biome) && Sim.canEnterBiome(p.profile, gb) && p.alive && this.t - (p.travelT || -99) > 3) { p.travelT = this.t; p.shield = Math.max(p.shield || 0, this.t + 6); this.hub.travelQ.push({ p: p, biome: gb }); }
        break;
      }
      case 'tut': if (!p.profile.tut && p.profile.hatched) { p.profile.tut = 1; this.gainCoins(p, 50); this.markDirty(p); this.flushProfile(p, true); } break;      // обучение пройдено: +50 монет один раз
      case 'buy': this.buyCosmetic(p, m.id); break;
      case 'claim': this.claimAch(p, m.id); break;
      case 'settitle': this.setTitle(p, m.id); break;
      case 'buypet': this.buyPet(p, m.id); break;
      case 'setpet': this.setPet(p, m.id); break;
      case 'equip': this.equipCosmetic(p, m.id, m.slot); break;
      case 'nestbuy': this.nestBuy(p, m.id); break;
      case 'nestput': this.nestPut(p, m.put); break;
      case 'setcolor': this.setColor(p, m.i | 0); break;
      case 'redeem': this.redeemCode(p, m.code); break;
      case 'craft': this.craftCosmetic(p, m.id); break;
      case 'ping': this.sendTo(p, { t: 'pong', n: +m.n || 0 }); break;
      default: this.handleExtra(p, m);
    }
  };
  RP.handleExtra = function () { };

  RP.action = function (p, m) {
    if (!p.alive || p.gone || this.duelFrozen(p)) return;
    var a = m.a;
    if (a === 'atk') p.wantAtk = true;
    else if (a === 'e' || a === 'q') this.ability(p, a);
    else if (a === 'x') this.ultimate(p);
    else if (a === 'f') this.actF(p);
    else if (a === 'em') {
      var i = m.i | 0;
      if (i >= 0 && i < 4 && this.t - p.emoteT > 1.2) { p.emoteT = this.t; this.events.push(['em', p.id, i]); }
    }
  };
  RP.duelFrozen = function () { return false; };

  // ---------------------------------------------------------------- эволюция и косметика (проверяет сервер)
  RP.buyEvo = function (p, id) {
    var pr = p.profile;
    if (typeof id !== 'string' || p.bot) return;
    var res = CF.evoCanBuy(pr.cls, pr.level, pr.evo, id);
    if (res !== 'ok') { this.sendTo(p, { t: 'err', m: 'evo_' + res }); return; }
    pr.evo[id] = (pr.evo[id] | 0) + 1;
    this.applyEvo(p, id);
  };
  // применить новую эволюцию: характеристики, внешний вид у всех, сохранение
  RP.applyEvo = function (p, id) {
    var pr = p.profile;
    this.refreshStats(p, true);
    this.broadcast({ t: 'upd', p: { id: p.id, evo: pr.evo, level: pr.level } }, p.id);
    this.events.push(['evo', p.id, id]);
    this.markDirty(p); this.flushProfile(p, true);
  };
  // переключить развилку на соседний узел (бесплатно, в любой момент)
  RP.switchEvo = function (p, id) {
    var pr = p.profile;
    if (typeof id !== 'string' || p.bot) return;
    var ne = CF.evoSwitch(pr.cls, pr.level, pr.evo, id);
    if (!ne) { this.sendTo(p, { t: 'err', m: 'evo_locked' }); return; }
    pr.evo = ne; this.applyEvo(p, id);
  };
  RP.resetEvo = function (p) {
    var pr = p.profile;
    if (p.bot || !CF.evoSpent(pr.evo)) return;
    if (pr.coins < CF.EVO_RESET_COST) { this.sendTo(p, { t: 'err', m: 'coins' }); return; }
    pr.coins -= CF.EVO_RESET_COST; pr.evo = {};
    this.refreshStats(p, true);
    this.broadcast({ t: 'upd', p: { id: p.id, evo: pr.evo, level: pr.level } }, p.id);
    this.markDirty(p); this.flushProfile(p, true);
  };
  // общий путь: операция магазина над профилем игрока + рассылка внешнего вида
  RP.shop = function (p, op, a) {
    var r = Sim.shopOp(p.profile, op, a);
    if (!r.ok) { if (r.err === 'coins' || r.err === 'mats') this.sendTo(p, { t: 'err', m: r.err }); return r; }
    var f = r.field, pr = p.profile;
    if (f === 'color') p.color = pr.color;
    var u = { id: p.id }; u[f] = f === 'nest' ? pr.nest.put : pr[f];
    if (f !== 'coins') this.broadcast({ t: 'upd', p: u }, p.id);          // монеты чужим не рассылаем
    this.markDirty(p); this.flushProfile(p, true);
    return r;
  };
  RP.buyCosmetic = function (p, id) { this.shop(p, 'buy', { id: id }); };
  // крафт из костей и шкур боссов
  RP.craftCosmetic = function (p, id) { var r = this.shop(p, 'craft', { id: id }); if (r.ok) this.sendTo(p, { t: 'crafted', id: id }); };
  // добыча с босса: кости и шкуры (+ трофей биома для гнезда)
  RP.dropLoot = function (p, first) {
    var pr = p.profile, bone = 2 + ((this.rng() * 2) | 0) + (first ? 2 : 0), hide = 1 + ((this.rng() * 2) | 0) + (first ? 1 : 0);
    pr.mats.bone += bone; pr.mats.hide += hide; pr.trophies[this.biome] = (pr.trophies[this.biome] | 0) + 1;
    this.sendTo(p, { t: 'loot', bone: bone, hide: hide });
  };
  RP.setColor = function (p, i) { this.shop(p, 'setcolor', { i: i }); };
  RP.redeemCode = function (p, code) {
    p.redeemTries = (p.redeemTries | 0) + 1;
    if (p.redeemTries > 10) { this.sendTo(p, { t: 'err', m: 'bad_code' }); return; }
    var r = this.shop(p, 'redeem', { code: code });
    this.sendTo(p, { t: 'redeemed', ok: r.ok ? 1 : 0, err: r.err || '', coins: r.coins | 0 });
  };
  RP.nestBuy = function (p, id) { this.shop(p, 'nestbuy', { id: id }); };
  RP.nestPut = function (p, list) { this.shop(p, 'nestput', { put: list }); };
  RP.claimAch = function (p, id) {
    var pr = p.profile, a = CF.achById(id), r = CF.ACH_REWARD[id];
    if (!a || !r || pr.claimed.indexOf(id) >= 0 || !pr.hatched || !a.t(pr)) return;
    pr.claimed.push(id);
    if (r.c) this.gainCoins(p, r.c);
    if (r.cos && CF.COSMETICS[r.cos] && pr.cosmetics.indexOf(r.cos) < 0) pr.cosmetics.push(r.cos);
    if (r.title && pr.titles.indexOf(r.title) < 0) { pr.titles.push(r.title); if (!pr.title) this.setTitle(p, r.title, true); }
    this.sendTo(p, { t: 'achok', id: id });
    this.markDirty(p); this.flushProfile(p, true);
  };
  RP.setTitle = function (p, id, quiet) {
    var pr = p.profile;
    if (id !== '' && pr.titles.indexOf(id) < 0) return;
    pr.title = id;
    this.broadcast({ t: 'upd', p: { id: p.id, title: id } }, p.id);
    if (!quiet) { this.markDirty(p); this.flushProfile(p, true); }
  };
  RP.buyPet = function (p, id) { this.shop(p, 'buypet', { id: id }); };
  RP.setPet = function (p, id) { this.shop(p, 'setpet', { id: id }); };
  RP.equipCosmetic = function (p, id, slot) { this.shop(p, 'equip', { id: id, slot: slot }); };

  // ---------------------------------------------------------------- урон, смерть
  // можно ли src бить dst (нет дружественного огня; в дуэли — разные команды)
  RP.hostile = function (a, b) {
    if (!a || !b || a === b) return false;
    if (a.team === b.team) return false;
    if (a.team === 'n' || b.team === 'n') return true;     // нейтральные (дичь, стадо) — цель для всех
    return true;
  };
  RP.isAir = function (e) {
    var s = e.st; if (e.kind === 'p') return !!s.fly;
    return !!(e.arch && e.arch.fly && !e.arch.tiny);                 // боссы (и дракон) всегда достижимы для укуса: иначе наземный игрок не победил бы дракона
  };
  RP.canReach = function (att, dst) {      // «в воздухе бьют только летающие и дальнобойные»
    if (dst.kind === 'p' ? dst.st.clm : dst.clm) return false;                       // на дереве не бьют никого: ни наземные, ни летающие, ни дальнобойные
    if (this.isAir(dst) && !this.isAir(att) && !(att.arch && att.arch.ranged) && !(att.kind === 'b')) return false;
    return true;
  };
  // множитель урона босса по игроку: нормировка босса × поправка на уровень игрока относительно требуемого
  RP.bossK = function (src, p) {
    if (this.mode === 'duel' || !src || !p.profile) return 1;
    return (src.dmgK || 0.85) * clamp(1 - 0.05 * (p.profile.level - (CF.BOSS_LEVEL[this.biome] || 10)), 0.25, 1.2);
  };
  RP.damage = function (src, dst, raw, o) {
    o = o || {};
    if (!dst || !(dst.hp > 0) || dst.inv) return 0;
    if (dst.kind === 'p' && dst.shield > this.t) return 0;
    if (dst.kind === 'p' && dst.st && dst.st.clm) return 0;                         // на дереве — неуязвим для всего (включая зоны боссов)
    if (dst.kind === 'p' && dst.gone) return 0;
    if (!o.force && !this.hostile(src, dst)) return 0;
    var amount = raw;
    if (src.kind === 'p' && src.buffK === 'dmg' && src.buffT > this.t) amount *= 1.25;
    if (src.kind === 'p' && src.ultT > this.t) amount *= src.ultMul;     // золотой плод: +25% урона
    // баланс по уровням: боец выше уровнем бьёт заметно сильнее, ниже — намного слабее (1 ур. против 4 ур. = ×0.36 урона)
    var sl = this.lvOf(src), dl = this.lvOf(dst);
    if (!o.force && src.kind === 'p' && dst.kind === 'e' && sl && dl && dl - sl >= CF.maxLvUp(dst)) { this.events.push(['h', dst.id, 0, 4]); return 0; }   // враг на 2+ уровня выше — не победить
    if (sl && dl && !o.force) amount *= CF.lvFactor(sl, dl);
    // босс: чем выше уровень игрока относительно требуемого, тем легче бой (и наоборот)
    if (!o.force && this.mode !== 'duel') {
      var bpl = src.kind === 'p' ? src : (src.owner && src.owner.kind === 'p' ? src.owner : null), breq = CF.BOSS_LEVEL[this.biome] || 10;
      if (dst.kind === 'b' && bpl) amount *= 2 * clamp(1 + 0.15 * (bpl.profile.level - breq), 0.6, 5) * clamp(Math.pow(14 / ((CF.CLASSES[bpl.cls] && CF.CLASSES[bpl.cls].dmg) || 14), 0.7), 0.8, 2);   // слабый по урону класс получает поправку против босса
      else if (dst.kind === 'p' && src.fromBoss) amount *= 0.85 * clamp(1 - 0.05 * (dst.profile.level - breq), 0.25, 1.2);
    }
    if (dst.kind === 'p' && src && src.kind === 'b') amount *= this.bossK(src, dst);
    if (dst.kind === 'p' && src && this.mode !== 'duel' && this.mode !== 'rush') { if (src.kind === 'b') amount = Math.min(amount, 0.4 * dst.stats.hp); else if (src.fromBoss) amount = Math.min(amount, 0.07 * dst.stats.hp); }   // ни один удар босса не убивает с одного раза, помощники бьют слабо
    if (dst.kind === 'p' && dst.stats.fx.dodge && !o.force && this.rng() * 100 < dst.stats.fx.dodge) { this.events.push(['h', dst.id, 0, 3]); return 0; }   // увернулся
    if (dst.kind === 'p') {
      amount *= 1 - dst.stats.armor;
      if (dst.st.grd) amount *= 1 - CF.GUARD_BLOCK;
    } else if (dst.armorMult) amount *= dst.armorMult;
    if (dst.kind === 'e' && dst.stunT > 0 && o.stunBonus) amount *= 1.0;
    amount = Math.max(0, amount);
    dst.hp -= amount; dst.lastHurt = this.t;
    if (src) {
      var owner = src.owner || src;
      if (owner.kind === 'p') { if (!dst.hitBy) dst.hitBy = {}; dst.hitBy[owner.id] = this.t; owner.lastAtk = this.t; owner.dmgDone += amount; if (!o.noUlt) owner.ult = Math.min(CF.ULT_MAX, (owner.ult || 0) + CF.ULT_HIT); }
      if (dst.kind === 'p' && !o.force) dst.ult = Math.min(CF.ULT_MAX, (dst.ult || 0) + CF.ULT_HURT);
      if (dst.kind === 'e' && dst.role === 'herd') { dst.aggroT = this.t + 8; dst.target = owner; }
      if (dst.kind === 'e' && dst.role === 'prey') { dst.fleeT = this.t + 4; dst.fleeFrom = owner; }
    }
    // шипы возвращают часть урона нападающему
    if (dst.kind === 'p' && src && !o.noThorns && dst.stats.fx.thorns && src.hp > 0 && src.kind !== 'b') {
      var back = amount * dst.stats.fx.thorns / 100;
      src.hp -= back; if (src.hp <= 0) this.kill(dst, src);
    }
    this.events.push(['h', dst.id, Math.round(amount), o.crit ? 1 : 0]);
    if (dst.hp <= 0) { dst.hp = 0; this.kill(src, dst, o); }
    return amount;
  };
  // уровень участника боя (у игрока — из профиля, у врага — свой); боссы и союзники без поправки
  RP.lvOf = function (x) {
    if (!x) return 0; if (x.owner) return 0;
    if (x.kind === 'p') return this.W.duel || this.mode === 'duel' ? 0 : x.profile.level;
    if (x.kind === 'e' && !x.fromBoss) return x.lv || 0;
    return 0;
  };
  RP.addDot = function (dst, kind, dps, secs, src) {
    if (!dst || !(dst.hp > 0) || (dst.kind === 'p' && dst.shield > this.t)) return;
    if (!dst.dots) dst.dots = [];
    for (var i = 0; i < dst.dots.length; i++) if (dst.dots[i].k === kind) { dst.dots[i].dps = Math.max(dst.dots[i].dps, dps); dst.dots[i].t = Math.max(dst.dots[i].t, secs); dst.dots[i].src = src; return; }
    dst.dots.push({ k: kind, dps: dps, t: secs, src: src });
  };
  RP.tickDots = function (e) {
    if (!e.dots || !e.dots.length) return;
    for (var i = e.dots.length - 1; i >= 0; i--) {
      var d = e.dots[i];
      d.t -= DT;
      if (e.kind === 'p' && e.stats) { var rs = d.k === 'poison' || d.k === 'burn' ? e.stats.resist * 0.6 : 0; d.cur = d.dps * (1 - rs); } else d.cur = d.dps;
      var sl = d.src ? this.lvOf(d.src) : 0, dl = this.lvOf(e); if (sl && dl) d.cur *= (d.src && d.src.kind === 'p' && e.kind === 'e' && dl - sl >= CF.maxLvUp(e)) ? 0 : CF.lvFactor(sl, dl);   // яд и кровотечение тоже зависят от разницы уровней
      if (e.kind === 'p' && e.st && e.st.clm) { e.dots.length = 0; return; }       // на дереве яд, огонь и кровотечение не действуют
      e.hp -= d.cur * DT; e.lastHurt = this.t;
      if (d.src && d.src.kind === 'p' && e.hitBy !== undefined) { if (!e.hitBy) e.hitBy = {}; e.hitBy[d.src.id] = this.t; }
      if (e.hp <= 0) { e.hp = 0; this.kill(d.src && d.src.hp > 0 ? d.src : null, e); return; }
      if (d.t <= 0) e.dots.splice(i, 1);
    }
  };

  RP.kill = function (src, dst, o) {
    if (dst.dead) return;
    if (dst.kind === 'p') { this.playerDied(dst, src); return; }
    dst.dead = true; dst.hp = 0;
    this.onEntityKilled(src, dst);
  };
  RP.onEntityKilled = function () { };
  RP.playerDied = function (p, src) {
    if (!p.alive) return;
    var lostNow = 0;
    p.ult = 0; p.ultT = 0; p.alive = false; p.hp = 0; p.respawnAt = this.t + 4.5; p.q.length = 0; p.dots = []; p.st.clm = 0; p.st.fly = 0; p.st.grd = 0; p.st.dsh = 0; p.wantAtk = false;
    p.deadBy = src ? (src.name || (src.arch && src.arch.n) || (src.owner && src.owner.name) || '') : '';
    p.deadByRaw = src ? (src.arch ? { id: src.arch.id } : src.bossId ? { boss: src.bossId } : { name: src.name || '' }) : null;
    this.events.push(['d', p.id]);
    this.onPlayerDeath(p, src);
    if (!p.bot && !this.W.duel) {
      var pr = p.profile, into = pr.totalXp - CF.cumXp(pr.level), lose = Math.floor(into * CF.DEATH_XP_LOSS);
      pr.totalXp -= lose; pr.stats.deaths = (pr.stats.deaths | 0) + 1; this.markDirty(p); lostNow = lose;
    }
    // в комнате с живым другом есть время, чтобы он поднял: респаун позже, потерянный опыт вернётся при спасении
    p.lostXp = 0; p.reviveable = false;
    if (!p.bot && !this.W.duel && this.mode !== 'rush' && this.anyAliveHuman(p)) { p.reviveable = true; p.respawnAt = this.t + CF.REVIVE_SEC; p.lostXp = lostNow || 0; }
    this.sendTo(p, { t: 'dead', by: p.deadByRaw, in: p.reviveable ? CF.REVIVE_SEC : 4.5, rv: p.reviveable ? 1 : 0 });
  };
  RP.anyAliveHuman = function (except) {
    var found = false;
    this.players.forEach(function (o) { if (o !== except && !o.bot && !o.gone && o.alive) found = true; });
    return found;
  };
  // друг поднимает упавшего: тот встаёт на месте с половиной здоровья, потерянный опыт возвращается
  RP.revivePlayer = function (p, id) {
    var q = this.players.get(+id);
    if (!q || q === p || q.alive || !q.reviveable || p.bot || !p.alive || p.gone) return;
    if (Math.hypot(p.st.x - q.st.x, p.st.z - q.st.z) > 9) return;
    q.alive = true; q.reviveable = false; q.hp = Math.max(1, q.stats.hp * 0.5); q.shield = this.t + 3; q.rs++; q.dots = []; q.food = Math.max(q.food, 40);
    q.st.stun = 0; q.st.vy = 0; q.st.lock = 0; q.deadBy = '';
    if (q.lostXp) { q.profile.totalXp += q.lostXp; q.profile.stats.deaths = Math.max(0, (q.profile.stats.deaths | 0) - 1); q.lostXp = 0; }
    this.events.push(['rev', q.id, p.id]);
    this.gainXp(p, 20 + p.profile.level * 3); this.gainCoins(p, 15);
    this.flushProfile(q, true); this.markDirty(p);
  };
  RP.onPlayerDeath = function () { };
  RP.respawnPlayer = function (p) {
    var pos = this.spawnPoint(0);
    var s = p.st;
    s.x = pos.x + (this.rng() - 0.5) * 4; s.z = pos.z + (this.rng() - 0.5) * 4; s.y = this.W.heightAt(s.x, s.z); s.vy = 0; s.onGround = true;
    s.fly = 0; s.clm = 0; s.grd = 0; s.dsh = 0; s.stun = 0; s.lock = 0; s.stam = CF.STAM_MAX;
    p.hp = p.stats.hp; p.food = Math.max(p.food, 40); p.alive = true; p.shield = this.t + CF.SHIELD_SEC; p.rs++; p.dots = [];
    p.breath = p.stats.breathMax; p.deadBy = '';
    this.flushProfile(p, true);
  };

  // ---------------------------------------------------------------- еда
  var FOOD_VAL = { plant: [12, 2, 1], meat: [28, 4, 8], smeat: [14, 3, 4], fish: [14, 3, 4], bug: [8, 2, 2] };   // сытость, опыт, HP
  RP.addDrop = function (kind, x, z, y) {
    if (this.drops.length > 140) this.drops.shift();
    var yy = y !== undefined ? y : Math.max(this.W.heightAt(x, z), this.W.waterY - 0.2);
    this.drops.push({ k: kind, x: r1(x), y: r1(yy), z: r1(z), exp: this.t + 90 });
  };
  RP.eatNear = function (p) {
    var s = p.st, reach = p.stats.radius + 1.3, preach = p.stats.radius + 1.8, diet = CF.CLASSES[p.cls].diet, i, f;
    for (i = this.drops.length - 1; i >= 0; i--) {
      f = this.drops[i];
      if (diet.indexOf(f.k) < 0) continue;
      if (Math.hypot(f.x - s.x, f.z - s.z) > reach || Math.abs(f.y - s.y) > reach + 4) continue;   // подбор — по кружочку вокруг еды
      this.drops.splice(i, 1); this.consume(p, f.k);
    }
    if (diet.indexOf('plant') >= 0) {
      for (i = 0; i < this.plants.length; i++) {
        f = this.plants[i];
        if (f.ready > this.t) continue;
        if (Math.hypot(f.x - s.x, f.z - s.z) > preach) continue;
        f.ready = this.t + 30; this.consume(p, 'plant');
      }
    }
  };
  RP.consume = function (p, kind) {
    var v = FOOD_VAL[kind] || FOOD_VAL.plant;
    p.food = Math.min(CF.FOOD_MAX, p.food + v[0]); p.hp = Math.min(p.stats.hp, p.hp + v[2] * (1 + p.profile.level * 0.15));
    if (!p.bot) { p.profile.stats.eaten = (p.profile.stats.eaten | 0) + 1; this.questProgress(p, 'eat', 1); this.rareFind(p); this.gainXp(p, kind === 'plant' ? Math.round(5 + p.profile.level * 1.2 + CF.xpForLevel(p.profile.level) * 0.09) : v[1] + Math.floor(p.profile.level * 0.3)); }   // растения: опыт растёт с уровнем (~30 кустов на уровень)
    this.events.push(['eat', p.id, kind]);
  };
  RP.initPlants = function () {
    if (this.W.ocean) return;                                                // в океане растений-еды нет
    var W = this.W, r = Sim.mulberry32(W.cfg.seed + 555), n = this.biome === 'desert' || this.biome === 'volcano' ? 130 : 270;
    for (var i = 0; i < n; i++) { var s = W.randomLand(r, 0); this.plants.push({ x: r1(s.x), y: r1(s.y), z: r1(s.z), ready: 0 }); }
  };

  // ---------------------------------------------------------------- атаки
  RP.targetsNear = function (p, reach, cone) {
    var s = p.st, out = [], self = this;
    var test = function (e) {
      if (!(e.hp > 0) || e.dead || e.inv || e.hidden || !self.hostile(p, e) || e.role === 'bug') return;
      var es = e.st, dx = es.x - s.x, dz = es.z - s.z, d = Math.sqrt(dx * dx + dz * dz), er = e.radius || (e.stats && e.stats.radius) || 0.6;
      if (e.kind === 'b' && p.kind === 'p') er *= 1.7;                       // у босса огромное тело: бьём по его габаритам, а не по центру
      if (d > reach + er) return;
      if (d > er + 0.4 && Math.abs(wrap(Math.atan2(dx, dz) - s.face)) > cone) return;
      var dy = Math.abs(es.y - s.y);
      if (dy > reach + 3 + (p.st.fly || e.kind === 'b' ? 12 : 0)) return;
      if (!self.canReach(p, e)) return;
      out.push({ e: e, d: d });
    };
    this.ents.forEach(function (e) { if (e.team !== p.team) test(e); });
    if (this.W.duel || this.mode === 'duel') this.players.forEach(function (o) { if (o !== p && o.alive && o.team !== p.team) test(o); });
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
  };
  RP.doAttack = function (p) {
    var st = p.stats, s = p.st, cls = p.cls;
    p.cd.atk = st.atkCd; p.atkAnim = 0.25; p.lastAtk = this.t;
    this.events.push(['b', p.id]);
    var targets = this.targetsNear(p, st.reach, 1.05);
    var ranks = st.ranks, mult = 1, dive = false;
    var inWater = this.W.isWater(s.x, s.z);
    if (st.aqua) mult *= inWater ? 1.2 : st.landDmg;
    if (cls === 'fly' && s.fly && s.vy < -3) { dive = true; }
    if (!targets.length) { p.combo = 0; return; }
    var main = targets[0].e;
    // ярость хищного: после трёх попаданий подряд следующий удар двойной
    var rageNow = false;
    if (cls === 'carn') {
      if (p.combo >= CF.RAGE_HITS) { mult *= CF.RAGE_MULT; rageNow = true; p.combo = 0; } else p.combo++;
      p.comboT = this.t + 3;
      if (main.hp < main.mhp * CF.FINISH_HP) mult *= CF.FINISH_MULT;          // добивание
      if (p.hidden && ranks.ambush) mult *= 1 + 0.2 * ranks.ambush;           // удар из засады
    }
    if (cls === 'herb') {
      if (p.spr) { mult *= 1.5 * (1 + 0.12 * (ranks.mass | 0)); this.knock(p, main, 5 + (ranks.mass | 0), 0.6); }
    }
    if (dive) {
      var alt = Math.max(0, s.y - main.st.y);
      mult *= Math.min(4, 1 + (alt / 10) * (0.1 + 0.06 * (ranks.altitude | 0)) + 0.5);
      this.events.push(['dive', p.id]);
    }
    // бонусы деревьев эволюции
    var fx = st.fx || {}, night = this.tod < 0.22 || this.tod > 0.78;
    if (fx.lastStand && p.hp < p.stats.hp * 0.35) mult *= 1 + fx.lastStand / 100;
    if (fx.nightDmg && night) mult *= 1 + fx.nightDmg / 100;
    var critNow = fx.crit && this.rng() * 100 < fx.crit;
    if (critNow) mult *= 1.6 + (fx.critDmg || 0) / 100;
    var dmg = st.dmg * mult, hits = 0, cap = cls === 'herb' || cls === 'fly' ? 2 : 1;
    for (var i = 0; i < targets.length && hits < cap; i++) {
      var e = targets[i].e;
      var d2 = dmg;
      if (fx.execute && e.mhp && e.hp < e.mhp * 0.3) d2 *= 1 + fx.execute / 100;
      if (fx.bigDmg && (e.big || e.kind === 'b')) d2 *= 1 + fx.bigDmg / 100;
      if (fx.firstStrike && e.kind === 'e' && e.target !== p) d2 *= 1 + fx.firstStrike / 100;
      if (cls === 'fly' && ranks.talons && e.arch && e.arch.tiny) d2 *= 1 + 0.15 * ranks.talons;
      var done = this.damage(p, e, d2, { crit: rageNow || dive || critNow });
      hits++;
      if (done <= 0) continue;
      if (e.hp > 0) this.hitEffects(p, e, done);
      else if (cls === 'fly' && ranks.talons && e.arch && e.arch.tiny && dive) { this.consume(p, 'smeat'); }   // хватает мелкую добычу в пикировании
    }
    if (dive) { s.dsh = 0; }
    if (p.pounce) { /* рывок уже учтён */ }
  };
  RP.hitEffects = function (p, e, done) {
    var r = p.stats.ranks, cls = p.cls, fx = p.stats.fx || {}, lk = 1 + p.profile.level * 0.04;
    if (fx.venom) this.addDot(e, 'poison', fx.venom * lk, 4, p);
    if (fx.bleed) this.addDot(e, 'bleed', fx.bleed * lk, 4, p);
    if (fx.leech) p.hp = Math.min(p.stats.hp, p.hp + done * fx.leech / 100);
    if (fx.stunHit && e.kind === 'e' && !e.big && this.rng() * 100 < fx.stunHit) { e.stunT = this.t + 0.8; this.events.push(['stun', e.id]); }
    if (p.stats.aqua && r.shock) {
      var bonus = r.shock * 3 * (1 + p.profile.level * 0.05);
      var pl0 = this.lvOf(p), el0 = this.lvOf(e); if (pl0 && el0) bonus *= el0 - pl0 >= CF.maxLvUp(e) ? 0 : CF.lvFactor(pl0, el0);
      e.hp -= bonus; this.events.push(['h', e.id, Math.round(bonus), 2]); e.hitBy = e.hitBy || {}; e.hitBy[p.id] = this.t;
      if (e.hp <= 0) { e.hp = 0; this.kill(p, e); return; }
      if (r.shock >= 3) {                                                     // цепной разряд
        var self = this, hop = null, hd = 9;
        this.ents.forEach(function (o) { if (o !== e && o.hp > 0 && self.hostile(p, o) && o.role !== 'bug') { var d = dist(o.st, e.st); if (d < hd) { hd = d; hop = o; } } });
        if (hop) { this.damage(p, hop, bonus * 1.2, { noThorns: true }); this.events.push(['arc', e.id, hop.id]); }
      }
      if (r.shock >= 5 && e.stunT !== undefined && e.kind === 'e') e.stunT = this.t + 0.8;
    }
  };
  RP.knock = function (src, dst, dist_, stun) {
    var s = src.st, d = dst.st, dx = d.x - s.x, dz = d.z - s.z, l = Math.hypot(dx, dz) || 1;
    if (dst.big || dst.kind === 'b') return;
    var nx = d.x + dx / l * dist_, nz = d.z + dz / l * dist_;
    var r = Sim.resolve(this.W, nx, nz, dst.radius || 0.6);
    d.x = r.x; d.z = r.z;
    if (dst.kind === 'p') { dst.st.stun = Math.max(dst.st.stun, stun || 0); dst.st.dsh = 0; dst.rs++; }
    else if (stun) dst.stunT = this.t + stun;
  };

  // ---------------------------------------------------------------- способности

  // ---------- ульта ----------
  RP.ultimate = function (p) {
    var u = CF.ULTS[p.cls], st = p.stats, s = p.st, self = this, t = this.t;
    if (!u || (p.ult || 0) < CF.ULT_MAX - 0.01 || p.st.clm || this.duelFrozen(p)) return;
    p.ult = 0; this.events.push(['ult', p.id, u.id, u.r || 0]); if (!p.bot) p.profile.stats.ults = (p.profile.stats.ults | 0) + 1;
    if (u.sec) { p.ultT = t + u.sec; p.ultMul = u.dmg || 1; p.ultSpd = u.spd || 1; }
    if (u.heal) p.hp = Math.min(st.hp, p.hp + st.hp * u.heal);
    if (u.shield) p.shield = Math.max(p.shield || 0, t + u.shield);
    if (u.r && u.dmg) {
      this.ents.forEach(function (e) {
        if (!(e.hp > 0) || e.dead || e.team === p.team || e.kind === 'b' || e.role === 'bug') return;
        var d0 = dist(e.st, s); if (d0 >= u.r) return;
        e.stunT = t + u.stun; self.damage(p, e, st.dmg * u.dmg * (1 - 0.35 * d0 / u.r), { noThorns: true, noUlt: true });
        if (d0 > 0.1 && u.id === 'quake') { e.st.x += (e.st.x - s.x) / d0 * 3; e.st.z += (e.st.z - s.z) / d0 * 3; }
      });
      if (this.W.duel || this.mode === 'duel') this.players.forEach(function (o) {
        if (o !== p && o.alive && o.team !== p.team && dist(o.st, s) < u.r) { o.st.stun = Math.max(o.st.stun, u.stun * 0.6); self.damage(p, o, st.dmg * u.dmg * 0.5, { noThorns: true, noUlt: true }); }
      });
    }
    if (u.allyHeal) this.players.forEach(function (o) {
      if (o !== p && o.alive && o.team === p.team && dist(o.st, s) < u.r) { o.hp = Math.min(o.stats.hp, o.hp + o.stats.hp * u.allyHeal); self.events.push(['heal', o.id]); }
    });
  };
  RP.ability = function (p, key) {
    var def = CF.ABILITIES[p.cls][key], st = p.stats, s = p.st, r = st.ranks, id = def.id, self = this;
    var cdv = p.cd[key];
    if (cdv > 0 && id !== 'guard') { this.sendTo(p, { t: 'err', m: 'cooldown' }); return; }
    if (id === 'guard') {                                                      // защитная стойка (переключатель)
      if (cdv > 0) return;
      p.cd.e = 0.6; s.grd = s.grd ? 0 : 1; s.dsh = 0; this.events.push(['grd', p.id, s.grd]); return;
    }
    if (s.clm || s.grd) return;
    if (id === 'pounce') {
      var dd = 8 * (1 + 0.15 * (r.pounce | 0)), tt = 0.28;
      s.dsh = tt; s.dvx = Math.sin(s.face) * dd / tt; s.dvz = Math.cos(s.face) * dd / tt; s.dvy = 0;
      p.pounce = { at: this.t + tt, mult: 1.6 };
      p.cd.e = Math.max(2.5, def.cd - 0.7 * (r.pounce | 0)); this.events.push(['dash', p.id]);
    } else if (id === 'roar') {
      var rr = 14 + 3 * (r.roar | 0), rt = 3.5 + 0.7 * (r.roar | 0);
      p.cd[key] = def.cd; this.events.push(['roar', p.id, rr]);
      this.ents.forEach(function (e) {
        if (e.kind !== 'e' || !(e.hp > 0) || e.arch === undefined) return;
        if (dist(e.st, s) < rr) { e.fleeT = self.t + rt; e.fleeFrom = p; e.target = null; e.slowT = self.t + rt; }
      });
    } else if (id === 'herd') {
      // «Тяжёлый топот»: удар по земле вокруг — урон, оглушение, враги отлетают
      p.cd.q = def.cd;
      var hr = r.herd | 0, srad = 8 + 1.2 * hr, sdmg = st.dmg * (1.3 + 0.15 * hr), sstun = 0.9 + 0.25 * hr;
      this.events.push(['herd', p.id, srad]);
      this.ents.forEach(function (e) {
        if (!(e.hp > 0) || e.dead || e.team === p.team || e.kind === 'b' || e.role === 'bug') return;
        var d0 = dist(e.st, s); if (d0 >= srad) return;
        e.stunT = self.t + sstun; self.damage(p, e, sdmg * (1 - 0.4 * d0 / srad), { noThorns: true });
        if (d0 > 0.1) { e.st.x += (e.st.x - s.x) / d0 * 2.5; e.st.z += (e.st.z - s.z) / d0 * 2.5; }
      });
      if (this.W.duel || this.mode === 'duel') this.players.forEach(function (o) {
        if (o !== p && o.alive && o.team !== p.team && dist(o.st, s) < srad) { o.st.stun = Math.max(o.st.stun, sstun * 0.7); self.damage(p, o, sdmg * 0.6, { noThorns: true }); }
      });
    } else if (id === 'screech' || id === 'sonic') {
      var rk = id === 'screech' ? (r.screech | 0) : (r.shock | 0);
      var rad = 10 + 1.6 * rk, stunT = 1 + 0.4 * rk;
      p.cd[key] = id === 'screech' ? Math.max(6, def.cd - 1.5 * rk) : def.cd;
      this.events.push(['screech', p.id, rad]);
      this.ents.forEach(function (e) {
        if (!(e.hp > 0) || e.dead || e.team === p.team || e.kind === 'b' || e.role === 'bug') return;
        if (dist(e.st, s) < rad) { e.stunT = self.t + stunT; e.target = e.target; self.damage(p, e, st.dmg * 0.5, { noThorns: true }); }
      });
      if (this.W.duel || this.mode === 'duel') this.players.forEach(function (o) {
        if (o !== p && o.alive && o.team !== p.team && dist(o.st, s) < rad) { o.st.stun = Math.max(o.st.stun, stunT); self.damage(p, o, st.dmg * 0.5, { noThorns: true }); }
      });
    } else if (id === 'dive') {
      if (!s.fly) { this.sendTo(p, { t: 'err', m: 'need_fly' }); return; }
      var alt = Math.max(0, s.y - this.W.heightAt(s.x, s.z));
      s.dsh = 0.8; s.dvx = Math.sin(s.face) * 9; s.dvz = Math.cos(s.face) * 9; s.dvy = -22;
      p.diveT = 0.9; p.diveAlt = alt; p.cd.q = def.cd; this.events.push(['dash', p.id]);
    } else if (id === 'torpedo') {
      var wat = this.W.isWater(s.x, s.z);
      var dd2 = wat ? 14 : 5, tt2 = 0.4;
      s.dsh = tt2; s.dvx = Math.sin(s.face) * dd2 / tt2; s.dvz = Math.cos(s.face) * dd2 / tt2; s.dvy = 0;
      p.pounce = { at: this.t + tt2, mult: wat ? 1.4 : 0.8, stun: 0.5 };
      p.cd[key] = def.cd; this.events.push(['dash', p.id]);
    }
  };
  RP.actF = function (p) {
    var s = p.st, W = this.W;
    if (p.cls === 'fly') {
      if (s.fly) { s.fly = 0; return; }
      if (p.cd.f > 0 || p.stats === null) return;
      if (s.stam < 15 || s.grd) return;
      s.fly = 1; s.vy = 9; s.onGround = false; s.y += 0.2; p.cd.f = 0.6; this.events.push(['fly', p.id]);
    } else if (p.cls === 'herb' && p.stats.canClimb) {
      if (s.clm) {                                                           // слезаем
        var tr = W.treeNear(s.x, s.z, 4); s.clm = 0;
        var a = s.face + 3.14; s.x += Math.sin(a) * 1.6; s.z += Math.cos(a) * 1.6; s.y = W.heightAt(s.x, s.z); s.vy = 0; s.onGround = true; return;
      }
      var t = W.treeNear(s.x, s.z, 3.2);
      if (!t) { this.sendTo(p, { t: 'err', m: 'no_tree' }); return; }
      s.clm = 1; s.x = t.x; s.z = t.z; s.y = t.y + t.h * 0.78; s.vy = 0; s.onGround = false; s.grd = 0; p.rs++;
    }
  };
  RP.tickPounce = function (p) {
    if (p.pounce && this.t >= p.pounce.at) {
      var pn = p.pounce; p.pounce = null;
      var targets = this.targetsNear(p, p.stats.reach + 0.8, 1.6);
      if (targets.length) {
        var e = targets[0].e;
        var done = this.damage(p, e, p.stats.dmg * pn.mult, { crit: true });
        if (done > 0 && e.hp > 0) { this.hitEffects(p, e, done); if (pn.stun) { if (e.kind === 'p') e.st.stun = Math.max(e.st.stun, pn.stun); else e.stunT = this.t + pn.stun; } }
        this.events.push(['b', p.id]);
      }
    }
    if (p.diveT > 0) {
      p.diveT -= DT;
      var s = p.st, tg = this.targetsNear(p, p.stats.reach + 1.5, 2.5);
      if (tg.length) {
        var e2 = tg[0].e, alt = Math.max(0, p.diveAlt);
        var mult = Math.min(4.5, 1.5 + (alt / 10) * (0.1 + 0.06 * (p.stats.ranks.altitude | 0)) * 2);
        var dn = this.damage(p, e2, p.stats.dmg * mult, { crit: true });
        if (dn > 0 && e2.hp > 0) this.hitEffects(p, e2, dn);
        else if (e2.hp <= 0 && p.stats.ranks.talons && e2.arch && e2.arch.tiny) this.consume(p, 'smeat');
        p.diveT = 0; s.dsh = 0; this.events.push(['dive', p.id]);
      }
      if (s.onGround) p.diveT = 0;
    }
  };

  // ---------------------------------------------------------------- шаг игрока
  RP.processPlayer = function (p) {
    var s = p.st, st = p.stats, t = this.t, W = this.W;
    if (!p.alive) {
      while (p.q.length) p.ack = p.q.shift().q;
      if (p.reviveable && !this.anyAliveHuman(p)) { p.reviveable = false; p.respawnAt = Math.min(p.respawnAt, t + 2); }
      if (t >= p.respawnAt && !this.noRespawn(p)) { p.reviveable = false; this.respawnPlayer(p); }
      return;
    }
    if (p.gone) { p.q.length = 0; return; }
    var n = 0, inp = null, any = false;
    while (p.q.length && n < 3) {
      inp = p.q.shift(); p.ack = inp.q; n++; any = true;
      p.input.f = inp.f; p.input.s = inp.s;
      s.slow = this.slowFor(p); s.lock = this.lockFor(p);
      var mx = s.x, mz = s.z;
      Sim.step(s, this.duelFrozen(p) ? { f: 0, s: 0, yaw: 0, jump: false } : inp, DT, W, st);
      p.spr = !!(inp.sprint && (Math.abs(inp.f) + Math.abs(inp.s) > 0.1) && s.stam > 1);
      p.moved = Math.hypot(s.x - mx, s.z - mz) / DT;
    }
    if (!any) { s.slow = this.slowFor(p); s.lock = this.lockFor(p); p.moved *= 0.5; }
    // стоим на месте — засада
    if (p.moved < 0.3) p.still += DT; else p.still = 0;
    p.hidden = !!(st.ranks.ambush && p.still > 1.2 && !s.fly && (this.tod < 0.22 || this.tod > 0.78 || p.still > 2.5));
    if (p.hidden && p.lastAtk > t - 0.4) p.hidden = false;
    // таймеры
    p.cd.atk -= DT; p.cd.e -= DT; p.cd.q -= DT; p.cd.f -= DT; p.atkAnim -= DT;
    if (p.comboT < t) p.combo = 0;
    if (p.wantAtk) { p.wantAtk = false; if (p.cd.atk <= 0 && !s.clm && !s.grd) this.doAttack(p); }
    this.tickPounce(p);
    this.tickDots(p);
    if (!p.alive) return;
    // сытость, регенерация
    var duel = this.mode === 'duel', hungerMult = p.cls === 'carn' ? 1.4 : 1;
    if (!duel) p.food = Math.max(0, p.food - CF.FOOD_DRAIN * hungerMult * (st.foodMult || 1) * DT);
    if (p.food <= 0 && !duel && !s.clm) { p.hp -= CF.STARVE_DPS * DT; p.lastHurt = t; if (p.hp <= 0) { p.hp = 0; this.playerDied(p, null); return; } }
    else if (!duel && t - p.lastHurt > CF.COMBAT_REGEN_DELAY && p.hp < st.hp) p.hp = Math.min(st.hp, p.hp + st.regen * DT);
    if (s.clm) { p.hp = Math.min(st.hp, p.hp + (4 * (st.ranks.climb | 0)) * DT); s.stam = Math.min(CF.STAM_MAX, s.stam + CF.STAM_REGEN * 1.6 * DT); }   // на дереве отдыхаем: выносливость восстанавливается всегда
    // дыхание морского под водой
    var sub = p.stats.aqua && !s.fly && s.y < W.waterY - 0.3 - 1.15 * p.stats.scale && W.isWater(s.x, s.z);
    if (sub) { p.breath -= DT * (W.ocean ? 0.35 : 1); if (p.breath <= 0) { p.breath = 0; p.hp -= 6 * DT; p.lastHurt = t; if (p.hp <= 0) { p.hp = 0; this.playerDied(p, null); return; } } }
    else p.breath = Math.min(st.breathMax, p.breath + 8 * DT);
    p.sub = sub;
    this.environment(p);
    if (!p.alive) return;
    this.eatNear(p);
    if (p.dirty && t - p.lastProf > 1) { p.lastProf = t; this.flushProfile(p); }
  };
  RP.noRespawn = function () { return false; };
  RP.slowFor = function (p) { return 1; };
  RP.environment = function () { };

  // ---------------------------------------------------------------- снимки
  RP.flagsOf = function (p) {
    var f = 0, s = p.st, t = this.t;
    if (p.shield > t) f |= F.SHIELD; if (s.fly) f |= F.FLY; if (p.sub) f |= F.SUB; if (s.clm) f |= F.CLM; if (s.grd) f |= F.GRD;
    if (p.atkAnim > 0) f |= F.ATK; if (!p.alive) f |= F.DEAD; if (p.hidden) f |= F.HIDE; if (s.stun > 0) f |= F.STUN;
    if (p.moved > 0.5) f |= F.MOVE; if (p.bot) f |= F.BOT;
    return f;
  };
  RP.snapshotFor = function (p) {
    var s = p.st, t = this.t, self = this, i, me;
    me = Sim.exportState(s);
    for (var k in me) if (typeof me[k] === 'number') me[k] = r3(me[k]);
    var st = p.stats;
    var mp = {
      hp: r1(p.hp), mh: st.hp, fd: r1(p.food), br: r1(p.breath), bm: r1(st.breathMax), alive: p.alive ? 1 : 0, rs: p.rs,
      rt: p.alive ? 0 : r1(Math.max(0, p.respawnAt - t)), sh: p.shield > t ? r1(p.shield - t) : 0,
      cd: [r1(Math.max(0, p.cd.atk)), r1(Math.max(0, p.cd.e)), r1(Math.max(0, p.cd.q))], rg: p.combo | 0, ul: Math.round(p.ult || 0), ut: p.ultT > t ? Math.round(p.ultT - t) : 0,
      lv: p.profile.level, xp: p.profile.totalXp - CF.cumXp(p.profile.level), hid: p.hidden ? 1 : 0, dots: p.dots.length,
      bf: p.buffK && p.buffT > t ? p.buffK : '', bt: p.buffK && p.buffT > t ? Math.round(p.buffT - t) : 0
    };
    var others = [];
    this.players.forEach(function (o) {
      if (o === p) return;
      others.push([o.id, r1(o.st.x), r1(o.st.y), r1(o.st.z), r2(o.st.face), r1(o.moved || 0), Math.round(o.hp / o.stats.hp * 100), self.flagsOf(o)]);
    });
    var es = [], aoi = CF.AOI, ax = s.x, az = s.z;
    this.ents.forEach(function (e) {
      if (e.dead || (e.kind !== 'b' && (Math.abs(e.st.x - ax) > aoi || Math.abs(e.st.z - az) > aoi))) return;
      es.push(self.entRow(e));
    });
    var msg = { t: 's', n: this.tick, a: p.ack, m: me, mp: mp, p: others, e: es, tod: r3(this.tod), wx: r2(this.wx) };
    if (this.tick % 5 === p.id % 5) {
      var fs = [];
      var diet = CF.CLASSES[p.cls].diet;                                       // показываем только ту еду, которую этот динозавр может съесть
      for (i = 0; i < this.drops.length; i++) { var d = this.drops[i]; if (diet.indexOf(d.k) >= 0 && Math.abs(d.x - ax) < 70 && Math.abs(d.z - az) < 70) fs.push([d.x, d.y, d.z, d.k]); }
      if (diet.indexOf('plant') >= 0) for (i = 0; i < this.plants.length; i++) { var pl = this.plants[i]; if (pl.ready <= t && Math.abs(pl.x - ax) < 70 && Math.abs(pl.z - az) < 70) fs.push([pl.x, pl.y, pl.z, 'plant']); }
      msg.f = fs;
      if (this.secrets) { var sc = []; for (i = 0; i < this.secrets.length; i++) { var q2 = this.secrets[i]; if (q2.ready <= t && Math.abs(q2.x - ax) < 70 && Math.abs(q2.z - az) < 70) sc.push([q2.id, q2.k === 'chest' ? 0 : q2.k === 'pearl' ? 2 : 1, q2.x, q2.y, q2.z]); } msg.sc = sc; }
    }
    if (this.events.length) msg.ev = this.events;
    this.extraSnapshot(p, msg);
    return msg;
  };
  RP.entRow = function (e) {
    var f = 0; if (e.atkAnim > 0) f |= 1; if (e.target && e.kind === 'e') f |= 2; if (e.stunT > this.t) f |= 4; if (e.hidden) f |= 8; if (e.owner) f |= 16; if (e.moving) f |= 32;
    if (e.kind === 'b') return [e.id, 'B:' + e.bossId, r1(e.st.x), r1(e.st.y), r1(e.st.z), r2(e.st.face), Math.round(e.hp), Math.round(e.mhp), f | (e.burrowed ? 64 : 0), e.phase | 0];
    return [e.id, ARCH_INDEX[e.arch.id], r1(e.st.x), r1(e.st.y), r1(e.st.z), r2(e.st.face), Math.round(e.hp), Math.round(e.mhp), f, e.lv];
  };
  RP.extraSnapshot = function () { };
  RP.sendSnapshots = function () {
    var self = this;
    this.players.forEach(function (p) { if (p.conn && !p.gone) { try { p.conn.send(JSON.stringify(self.snapshotFor(p))); } catch (e) { /* ignore */ } } });
    this.events = [];
  };

  // ---------------------------------------------------------------- такт
  RP.update = function () {
    this.tick++; this.t += DT;
    this.tod = (0.3 + this.t / CF.DAY_LENGTH) % 1;
    var self = this;
    this.updateWorld();
    this.players.forEach(function (p) {
      if (p.gone && self.t - p.goneAt > CF.DISCONNECT_KEEP_SEC) { self.removePlayer(p); if (self.hub.onGone) self.hub.onGone(p); return; }
      if (p.bot) self.botThink(p);
      self.processPlayer(p);
    });
    this.updateEnts();
    this.updateBossAndZones();
    this.updateDrops();
    this.updateExtra();
  };
  RP.updateWorld = function () { };
  RP.updateExtra = function () { };
  RP.updateDrops = function () {
    if (this.tick % 25 === 0) for (var i = this.drops.length - 1; i >= 0; i--) if (this.drops[i].exp < this.t) this.drops.splice(i, 1);
  };

  // ======================================================================== HUB
  function Hub(opts) { opts = opts || {}; this.rooms = new Map(); this.nextRoomId = 1; this.onSave = opts.onSave || null; this.onGone = opts.onGone || null; this.tourney = null; this.travelQ = []; }
  Core.Hub = Hub;
  var HP = Hub.prototype;
  HP.createRoom = function (o) {
    o.id = this.nextRoomId++;
    var room = new Room(this, o);
    this.rooms.set(room.id, room);
    return room;
  };
  HP.findPublic = function (biome) {
    var found = null;
    this.rooms.forEach(function (r) { if (!found && r.mode === 'public' && r.biome === biome && r.humans() < r.maxHumans) found = r; });
    return found;
  };
  HP.findCode = function (code) {
    var found = null;
    this.rooms.forEach(function (r) { if (!found && r.code === code && r.mode !== 'duel') found = r; });
    return found;
  };
  // o: {profile, conn, userId, admin, biome, mode: public|code|solo|rush, code}
  HP.join = function (o) {
    var pr = Sim.fixProfile(o.profile);
    if (!pr.hatched || !pr.cls) return { error: 'no_character' };
    // игрок сам выбирает мир и тип: при входе активный тип профиля меняется (у каждого типа свой прогресс)
    if (typeof o.cls === 'string' && o.cls !== pr.cls) {
      if (!CF.CLASSES[o.cls]) return { error: 'bad_type' };
      if (!Sim.typeUnlocked(pr, o.cls)) return { error: 'type_locked' };
      Sim.switchType(pr, o.cls);
    }
    var biome = CF.ALL_BIOMES.indexOf(o.biome) >= 0 ? o.biome : (CF.ALL_BIOMES.indexOf(pr.biome) >= 0 && Sim.typeFits(pr.cls, pr.biome) ? pr.biome : Sim.homeBiome(pr)), mode = o.mode || 'public', room = null;
    if (mode !== 'rush' && !Sim.typeFits(pr.cls, biome)) return { error: 'bad_type' };
    if (mode === 'rush' && CF.isAqua(pr.cls)) return { error: 'bad_type' };
    if (mode === 'rush' && !Sim.isLord(pr)) return { error: 'locked' };
    if (mode !== 'rush' && !Sim.canEnterBiome(pr, biome)) return { error: 'locked' };
    var code = typeof o.code === 'string' && /^[A-Za-z]{5,8}$/.test(o.code) ? o.code.toUpperCase() : null;
    if (mode === 'code' || (mode === 'rush' && code)) {
      if (!code) return { error: 'bad_code' };
      room = this.findCode(code);
      if (room) {
        if (room.humans() >= room.maxHumans) return { error: 'full' };
        if (room.mode !== 'rush' && !Sim.canEnterBiome(pr, room.biome)) return { error: 'locked' };
        if (room.mode !== 'rush' && !Sim.typeFits(pr.cls, room.biome)) return { error: 'bad_type' };
      } else room = this.createRoom({ biome: biome, code: code, mode: mode === 'rush' ? 'rush' : 'code' });
    } else if (mode === 'solo' || mode === 'rush') {
      room = this.createRoom({ biome: biome, mode: mode });
    } else {
      room = this.findPublic(biome) || this.createRoom({ biome: biome, mode: 'public' });
    }
    pr.biome = room.biome;
    var player = room.addPlayer(pr, o.conn, { userId: o.userId, admin: o.admin, index: room.humans() });
    return { room: room, player: player };
  };
  HP.leave = function (player) {
    var room = player.room; if (!room) return;
    room.flushProfile(player, true);
    player.conn = null;
    this.dropFromQueues(player);
    if (room.mode === 'duel') this.duelLeft(room, player);
    room.removePlayer(player);
    this.checkRoom(room);
  };
  // отключение без выхода: динозавр остаётся DISCONNECT_KEEP_SEC секунд
  HP.disconnect = function (player) {
    var room = player.room; if (!room) return;
    room.flushProfile(player, true);
    player.conn = null;
    if (room.mode === 'duel') { this.duelLeft(room, player); room.removePlayer(player); this.checkRoom(room); return; }
    player.gone = true; player.goneAt = room.t; player.shield = room.t + 999;
    this.dropFromQueues(player);
  };
  HP.checkRoom = function (room) {
    if (!room.hasHuman()) { room.dispose(); this.rooms.delete(room.id); }
  };
  HP.sendErr = function (p, m) { p.room.sendTo(p, { t: 'err', m: m }); };
  HP.onMessage = function (p, m) {
    if (!p || !p.room || !m || typeof m.t !== 'string') return;
    p.room.handle(p, m);
  };
  // переход в другой биом через портал: игрок выходит из комнаты и входит в новую
  HP.travel = function (player, biome) {
    var room = player.room, pr = player.profile, conn = player.conn, userId = player.userId, admin = player.admin, mode = room.mode === 'solo' ? 'solo' : 'public';
    if (!Sim.canEnterBiome(pr, biome)) return;
    room.flushProfile(player, true);
    player.conn = null;
    room.removePlayer(player); this.checkRoom(room);
    var res = this.join({ profile: pr, conn: conn, userId: userId, admin: admin, biome: biome, mode: mode });
    if (res.player && conn) { conn.player = res.player; }
    return res;
  };
  HP.tick = function () {
    var self = this;
    this.rooms.forEach(function (room) { room.update(); room.sendSnapshots(); });
    this.tourneyTick();
  };
  HP.stats = function () {
    var humans = 0; this.rooms.forEach(function (r) { humans += r.humans(); });
    return { rooms: this.rooms.size, players: humans };
  };
  RP.dispose = function () { };
  HP.dropFromQueues = function () { };
  HP.tourneyTick = function () { };
  HP.duelLeft = function () { };

  return Core;
});

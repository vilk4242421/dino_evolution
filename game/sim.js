/* Dino Evolution — общие правила и физика (UMD). Подключается и на клиенте, и на сервере (и в офлайн-режиме).
   Всё здесь детерминировано: один и тот же ввод даёт один и тот же результат, поэтому клиент предсказывает своё движение.
   Содержит: генерацию 6 биомов по карте высот, коллизии, ходьбу/плавание/полёт/лазание, характеристики из класса и эволюции. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.Sim = factory(root.CONFIG);
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';
  var CF = CONFIG;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrap(a) { while (a > Math.PI) a -= 6.283185307; while (a < -Math.PI) a += 6.283185307; return a; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iz, seed) {
    var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z, seed) {
    var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    var u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, seed, oct) {
    var s = 0, a = 0.5, f = 1, n = 0;
    for (var i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }

  // ======================================================================== БИОМЫ
  var HALF = CF.MAP_SIZE / 2, ARENA = CF.ARENA_R;
  // nest — желаемая точка гнезда; waterY — уровень жидкости (вода/лава)
  var DEF = {
    forest:   { waterY: -1.5, arenaY: 2.5, nest: [-190, -150] },
    snow:     { waterY: -1.5, arenaY: 3.0, nest: [170, 160] },
    mountain: { waterY: -1.5, arenaY: 4.0, nest: [-180, 170] },
    desert:   { waterY: -2.0, arenaY: 3.0, nest: [190, -170] },
    swamp:    { waterY: 0.0,  arenaY: 2.2, nest: [-170, -180] },
    volcano:  { waterY: -1.5, arenaY: 3.5, nest: [180, 170] },
    // океан: уровень воды 0, арена босса — подводное плато на глубине 4.5 м, гнездо — на песчаном островке
    reef:     { waterY: 0, arenaY: -20, nest: [-185, -160], ocean: true },
    kelp:     { waterY: 0, arenaY: -24, nest: [175, -170], ocean: true },
    arctic:   { waterY: 0, arenaY: -24, nest: [-175, 175], ocean: true },
    vents:    { waterY: 0, arenaY: -27, nest: [185, 170], ocean: true },
    abyss:    { waterY: 0, arenaY: -36, nest: [-180, -175], ocean: true }
  };

  // ---------- рельеф морского дна ----------
  // острова, айсберги, курильщики — списком (их же рисует клиент)
  function oceanFeatures(id, seed) {
    var r = mulberry32(seed + 313), F = { islands: [], bergs: [], vents: [], spires: [], caves: [], peaks: [] }, i, a, d;
    var put = function (list, n, rmin, rmax, minD) {
      for (var k = 0; k < n * 20 && list.length < n; k++) {
        a = r() * 6.283; d = 70 + r() * (HALF - 110);
        var x = Math.cos(a) * d, z = Math.sin(a) * d, rr = rmin + r() * (rmax - rmin), ok = true;
        for (var j = 0; j < list.length; j++) if (Math.hypot(list[j].x - x, list[j].z - z) < list[j].r + rr + (minD || 12)) { ok = false; break; }
        if (ok) list.push({ x: x, z: z, r: rr, v: r() });
      }
    };
    if (id === 'reef') put(F.islands, 6, 8, 16, 30);
    if (id === 'arctic') put(F.bergs, 22, 7, 18, 10);
    if (id === 'vents') put(F.vents, 26, 3.5, 5.5, 14);
    if (id === 'abyss' || id === 'kelp') put(F.spires, id === 'abyss' ? 30 : 18, 3, 7, 10);
    put(F.peaks, 16, 14, 34, 20);                                                    // подводные горы разной высоты: от холмов до вершин почти у поверхности
    // сквозные пещеры: подводный скальный массив с туннелем по оси (две стены + каменный свод, рисует клиент)
    var CAVE_F = { reef: -26, kelp: -42, arctic: -46, vents: -58, abyss: -92 }, nc = { reef: 10, kelp: 12, arctic: 12, vents: 12, abyss: 14 }[id] || 10, ndef = DEF[id];
    for (var kc = 0; kc < 4000 && F.caves.length < nc; kc++) {
      a = r() * 6.283; d = 90 + r() * (HALF - 190);
      var cx = Math.cos(a) * d, cz = Math.sin(a) * d, L = 34 + r() * 14, ok2 = Math.hypot(cx - ndef.nest[0], cz - ndef.nest[1]) > 120;
      for (var jc = 0; ok2 && jc < F.caves.length; jc++) if (Math.hypot(F.caves[jc].x - cx, F.caves[jc].z - cz) < 52) ok2 = false;
      if (ok2) F.caves.push({ x: cx, z: cz, a: r() * 3.1416, L: L, w: 7 + r() * 3.5, f: CAVE_F[id], H: Math.min(22 + r() * 26, -5 - CAVE_F[id]), rb: 10 + r() * 3 });
    }
    return F;
  }
  function oceanBase(id, F, seed, x, z, def) {
    var h, i, o, d;
    if (id === 'reef') {
      h = -8 + (fbm(x / 120, z / 120, seed, 4) - 0.5) * 7;
      var rr = 1 - Math.abs(fbm(x / 38, z / 38, seed + 21, 3) * 2 - 1);                // гряды кораллов почти до поверхности
      h += smooth(0.72, 0.96, rr) * 6.2;
      for (i = 0; i < F.islands.length; i++) { o = F.islands[i]; d = Math.hypot(x - o.x, z - o.z); if (d < o.r * 2.2) h = Math.max(h, lerp(h, 1.4 + o.v * 0.8, 1 - smooth(o.r * 0.6, o.r * 2.2, d))); }
    } else if (id === 'kelp') {
      h = -13 + (fbm(x / 90, z / 90, seed, 4) - 0.5) * 9 + (fbm(x / 24, z / 24, seed + 11, 2) - 0.5) * 2;
      var kr = 1 - Math.abs(fbm(x / 60, z / 60, seed + 31, 3) * 2 - 1); h += smooth(0.7, 0.95, kr) * 5;      // скальные гряды
    } else if (id === 'arctic') {
      h = -12 + (fbm(x / 100, z / 100, seed, 4) - 0.5) * 7;
      for (i = 0; i < F.bergs.length; i++) { o = F.bergs[i]; d = Math.hypot(x - o.x, z - o.z); if (d < o.r * 1.25) { var top = 2.2 + o.v * 3 + (fbm(x / 9, z / 9, seed + i, 2) - 0.5) * 1.6; h = Math.max(h, lerp(h, top, 1 - smooth(o.r * 0.85, o.r * 1.25, d))); } }
    } else if (id === 'vents') {
      h = -16 + (fbm(x / 110, z / 110, seed, 4) - 0.5) * 9 + (fbm(x / 26, z / 26, seed + 11, 3) - 0.5) * 3;
      var cv = Math.abs(vnoise(x / 90 + 2.2, z / 90 - 6.6, seed + 5) - 0.5); h -= (1 - smooth(0, 0.09, cv)) * 7;   // разломы
      for (i = 0; i < F.vents.length; i++) { o = F.vents[i]; d = Math.hypot(x - o.x, z - o.z); if (d < o.r * 2) h += (1 - smooth(0, o.r * 2, d)) * (3 + o.v * 2); }
    } else {
      h = -24 + (fbm(x / 120, z / 120, seed, 4) - 0.5) * 8;
      var ca = Math.abs(vnoise(x / 110 + 4.1, z / 110 + 1.3, seed + 5) - 0.5); h -= (1 - smooth(0, 0.1, ca)) * 14;   // жёлоб
    }
    if (h < 0) h *= ({ reef: 3.9, kelp: 4.05, arctic: 4.65, vents: 4.5, abyss: 4.8 }[id] || 2.6);       // глубина океана: до ~40–100 м
    for (i = 0; i < F.spires.length; i++) { o = F.spires[i]; d = Math.hypot(x - o.x, z - o.z); if (d < o.r * 1.6) h += (1 - smooth(o.r * 0.4, o.r * 1.6, d)) * (id === 'abyss' ? 24 : 12) * (0.4 + o.v * 1.4); }
    for (i = 0; F.peaks && i < F.peaks.length; i++) { o = F.peaks[i]; d = Math.hypot(x - o.x, z - o.z); if (d < o.r * 2.2) { var pk = (1 - smooth(o.r * 0.25, o.r * 2.2, d)) * (0.65 + 0.35 * fbm(x / 12, z / 12, seed + 90 + i, 2)); h = Math.max(h, Math.min(h + pk * (8 + o.v * o.v * 70), -3.5 - (1 - o.v) * (1 - o.v) * 34)); } }
    for (i = 0; F.caves && i < F.caves.length; i++) {
      o = F.caves[i]; var cdx = x - o.x, cdz = z - o.z; if (cdx * cdx + cdz * cdz > 70 * 70) continue;
      var cu = Math.abs(cdx * Math.cos(o.a) + cdz * Math.sin(o.a)), cv = Math.abs(-cdx * Math.sin(o.a) + cdz * Math.cos(o.a));
      var cenv = 1 - smooth(o.L / 2 - 2, o.L / 2 + 16, cu);
      var cwall = smooth(o.w, o.w + 5, cv) * (1 - smooth(o.w + 12, o.w + 30, cv));
      var ctop = o.f + o.H * (0.85 + 0.3 * vnoise(x / 9, z / 9, seed + 400 + i));
      if (cenv > 0 && cwall > 0) h = Math.max(h, lerp(h, ctop, cenv * cwall));
      var cfl = (1 - smooth(o.w + 1, o.w + 6, cv)) * (1 - smooth(o.L / 2 + 6, o.L / 2 + 18, cu));      // ровное дно туннеля
      if (cfl > 0) h = lerp(h, o.f, cfl);
    }
    // островок с гнездом
    var di = Math.hypot(x - def.nest[0], z - def.nest[1]);
    if (di < 62) { var ih = 2.4 + (fbm(x / 8, z / 8, seed + 77, 2) - 0.5) * 0.6; h = Math.max(h, lerp(h, ih, 1 - smooth(10, 62, di))); }
    return h;
  }

  function makeHeight(id, def, seed) {
    var oases = [], OF = def.ocean ? oceanFeatures(id, seed) : null;
    if (id === 'desert') {
      var orng = mulberry32(seed + 99);
      for (var i = 0; i < 5; i++) {
        var a = orng() * 6.283, d = 90 + orng() * 190;
        oases.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 22 + orng() * 14 });
      }
    }
    var fn = function (x, z) {
      var h;
      if (OF) {
        h = oceanBase(id, OF, seed, x, z, def);
      } else if (id === 'forest') {
        h = (fbm(x / 140, z / 140, seed, 4) - 0.5) * 26 + 3.4;
        h += (fbm(x / 30, z / 30, seed + 11, 2) - 0.5) * 3;
        var c = Math.abs(vnoise(x / 95 + 13.7, z / 95 - 4.2, seed + 5) - 0.5);        // ручьи
        h -= (1 - smooth(0, 0.075, c)) * 4.6;   // ширина ~10 м: сетка ландшафта (2.5 м) должна её показать
      } else if (id === 'snow') {
        h = (fbm(x / 150, z / 150, seed, 4) - 0.5) * 18 + 3.4;
        h += (fbm(x / 22, z / 22, seed + 11, 2) - 0.5) * 2.4;
        var cs = Math.abs(vnoise(x / 120 + 5.1, z / 120 + 9.9, seed + 5) - 0.5);       // замёрзшие озёра и проруби
        h -= (1 - smooth(0, 0.07, cs)) * 5;
      } else if (id === 'mountain') {
        var r = 1 - Math.abs(fbm(x / 110, z / 110, seed, 4) * 2 - 1);                  // гребни
        h = r * r * 52 - 4 + (fbm(x / 38, z / 38, seed + 11, 3) - 0.5) * 7;
        var cm = Math.abs(vnoise(x / 130 + 3.3, z / 130 + 8.8, seed + 5) - 0.5);        // ущелья с реками
        h -= (1 - smooth(0, 0.075, cm)) * 11;
      } else if (id === 'desert') {
        var dn = fbm(x / 160, z / 160, seed, 3);
        h = 4 + (dn - 0.5) * 8 + Math.sin(x * 0.045 + dn * 6) * 3.2 + Math.sin((x + z) * 0.03 + 1.7) * 2.2 + (fbm(x / 26, z / 26, seed + 11, 2) - 0.5) * 1.6;
        for (var o = 0; o < oases.length; o++) {
          var od = Math.hypot(x - oases[o].x, z - oases[o].z);
          h -= (1 - smooth(oases[o].r * 0.35, oases[o].r, od)) * 9.5;
        }
      } else if (id === 'swamp') {
        h = 0.55 + (fbm(x / 60, z / 60, seed, 4) - 0.5) * 7.5 + (fbm(x / 20, z / 20, seed + 11, 2) - 0.5) * 1.4;
      } else {   // volcano
        h = 6 + (fbm(x / 130, z / 130, seed, 4) - 0.5) * 30 + (fbm(x / 28, z / 28, seed + 11, 3) - 0.5) * 4;
        var cv = Math.abs(vnoise(x / 80 + 2.2, z / 80 - 6.6, seed + 5) - 0.5);          // лавовые реки
        h -= (1 - smooth(0, 0.085, cv)) * 13;
      }
      var d2 = Math.sqrt(x * x + z * z);                                                  // арена босса
      var k = 1 - smooth(ARENA, ARENA + 18, d2);
      h = h * (1 - k) + def.arenaY * k;
      var m = Math.max(Math.abs(x), Math.abs(z));                                         // горы по краю карты
      if (OF) h = lerp(h, Math.max(h, -3), smooth(HALF - 60, HALF - 12, m));                // у океана — риф-барьер под водой
      else h += smooth(HALF - 70, HALF - 12, m) * 30;
      return h;
    };
    fn.features = OF;
    return fn;
  }

  // ======================================================================== МИР
  var CELL = 16, OFF = HALF + 16, STRIDE = 64, cache = {};
  function cellKey(ix, iz) { return ix * STRIDE + iz; }
  function addObstacle(W, o) {
    W.obstacles.push(o);
    var k = cellKey(Math.floor((o.x + OFF) / CELL), Math.floor((o.z + OFF) / CELL));
    (W.grid[k] || (W.grid[k] = [])).push(o);
  }
  var _empty = [];
  function obstaclesNear(W, x, z, r) {
    var out = null;
    var x0 = Math.floor((x - r + OFF) / CELL), x1 = Math.floor((x + r + OFF) / CELL);
    var z0 = Math.floor((z - r + OFF) / CELL), z1 = Math.floor((z + r + OFF) / CELL);
    for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) {
      var cell = W.grid[cellKey(ix, iz)];
      if (cell) { if (!out) out = []; for (var i = 0; i < cell.length; i++) out.push(cell[i]); }
    }
    return out || _empty;
  }

  var TREE_H = { broad: 6.5, pine: 7.5, cactus: 3.6, mangrove: 5.2, burnt: 5.5 };
  var TREE_R = { broad: 0.5, pine: 0.45, cactus: 0.55, mangrove: 0.6, burnt: 0.45 };

  function getWorld(biome) {
    if (cache[biome]) return cache[biome];
    if (biome === 'duel') return (cache.duel = makeDuelWorld());
    var B = CF.BIOME[biome] ? biome : 'forest';
    var cfg = CF.BIOME[B], def = DEF[B];
    var heightRaw = makeHeight(B, def, cfg.seed), lava = cfg.liquid === 'lava';
    // лава — твёрдая «поверхность» (по ней можно бежать, но она жжёт); вода остаётся водой
    var heightAt = lava ? function (x, z) { var h = heightRaw(x, z); return h < def.waterY ? def.waterY - 0.05 : h; } : heightRaw;
    var W = {
      biome: B, cfg: cfg, def: def, heightAt: heightAt, heightRaw: heightRaw, waterY: def.waterY, lava: lava, liquid: cfg.liquid,
      half: HALF, arena: { x: 0, z: 0, r: ARENA }, trees: [], rocks: [], stones: [], obstacles: [], grid: {}, duel: false,
      ocean: !!def.ocean, features: heightRaw.features || null
    };
    W.slopeAt = function (x, z) {
      return (Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1))) / 2;
    };
    W.caveAt = function (x, z) {
      var C = W.features && W.features.caves; if (!C) return null;
      for (var i = 0; i < C.length; i++) {
        var o = C[i], dx = x - o.x, dz = z - o.z; if (dx * dx + dz * dz > o.L * o.L) continue;
        if (Math.abs(dx * Math.cos(o.a) + dz * Math.sin(o.a)) < o.L / 2 && Math.abs(-dx * Math.sin(o.a) + dz * Math.cos(o.a)) < o.w + 3.5) return o;
      }
      return null;
    };
    W.isWater = function (x, z) { return !lava && heightAt(x, z) < W.waterY; };
    W.isDeep = function (x, z) { return !lava && heightAt(x, z) < W.waterY - 0.9; };
    W.isLava = function (x, z) { return lava && heightRaw(x, z) < W.waterY; };
    // сугробы замедляют, ядовитая топь жжёт
    W.slowAt = function (x, z) {
      if (B === 'kelp') return vnoise(x / 30, z / 30, cfg.seed + 31) > 0.62 ? 0.8 : 1;    // густые заросли ламинарии
      if (B !== 'snow') return 1;
      return vnoise(x / 24, z / 24, cfg.seed + 31) > 0.66 ? 0.62 : 1;
    };
    // жар у чёрных курильщиков: ближе 7 м к трубе и ниже её верхушки + 6 м
    W.ventAt = function (x, z, y) {
      if (!W.features || !W.features.vents.length) return 0;
      var v = W.features.vents, best = 0;
      for (var i = 0; i < v.length; i++) { var d = Math.hypot(x - v[i].x, z - v[i].z); if (d < 7) best = Math.max(best, 1 - d / 7); }
      return best;
    };
    W.bogAt = function (x, z) {
      if (B !== 'swamp') return false;
      return vnoise(x / 20, z / 20, cfg.seed + 41) > 0.7 && heightAt(x, z) > W.waterY - 0.6;
    };

    // гнездо: ближайшая ровная сухая точка рядом с желаемой
    var nest = null;
    for (var rad = 0; rad < 140 && !nest; rad += 4) {
      for (var a = 0; a < 12 && !nest; a++) {
        var nx = def.nest[0] + Math.cos(a / 12 * 6.2832) * rad, nz = def.nest[1] + Math.sin(a / 12 * 6.2832) * rad;
        var nh = heightAt(nx, nz);
        if (nh > W.waterY + 1.6 && W.slopeAt(nx, nz) < 0.3 && Math.abs(nx) < HALF - 80 && Math.abs(nz) < HALF - 80 && !(lava && W.isLava(nx, nz))) nest = { x: nx, z: nz, y: nh };
      }
    }
    W.nest = nest || { x: def.nest[0], z: def.nest[1], y: heightAt(def.nest[0], def.nest[1]) };
    // гнездо стоит на ровной площадке: рельеф вокруг плавно выравнивается до его высоты (одинаково на сервере и в браузере)
    var NF = W.nest, baseH = heightAt;
    heightAt = function (x, z) {
      var h = baseH(x, z), dd = Math.hypot(x - NF.x, z - NF.z);
      if (dd < 22) { var kk = 1 - smooth(12, 22, dd); h = h * (1 - kk) + NF.y * kk; }
      return h;
    };
    W.heightAt = heightAt;

    // порталы у входов на арену: вход к боссу — ближе к гнезду, выход в следующий биом — напротив
    var na = Math.round(Math.atan2(W.nest.z, W.nest.x) / (Math.PI / 2)) * (Math.PI / 2);
    W.portalIn = { x: Math.cos(na) * (ARENA + 7), z: Math.sin(na) * (ARENA + 7), ang: na };
    W.portalNext = { x: Math.cos(na + Math.PI) * (ARENA + 7), z: Math.sin(na + Math.PI) * (ARENA + 7), ang: na + Math.PI };
    W.portalIn.y = heightAt(W.portalIn.x, W.portalIn.z); W.portalNext.y = heightAt(W.portalNext.x, W.portalNext.z);
    // камни арены (20 штук, 4 прохода)
    for (var i = 0; i < 20; i++) {
      if (i % 5 === 0) continue;
      var ang = i / 20 * 6.2832, sx = Math.cos(ang) * (ARENA + 1), sz = Math.sin(ang) * (ARENA + 1);
      var st = { x: sx, z: sz, y: heightAt(sx, sz), r: 1.5, s: 1, rot: ang, kind: 'stone', h: 5 };
      W.stones.push(st); if (!W.ocean) addObstacle(W, st);              // под водой над камнями проплывают
    }

    var rng = mulberry32(cfg.seed * 7 + 3);
    var tstyle = cfg.treeStyle, TR = TREE_R[tstyle] || 0.5;
    for (var tries = 0; tries < 30000 && W.trees.length < cfg.trees; tries++) {
      var x = (rng() * 2 - 1) * (HALF - 14), z = (rng() * 2 - 1) * (HALF - 14);
      var h = heightAt(x, z);
      if (h < W.waterY + 0.7 || W.slopeAt(x, z) > 0.8) continue;
      if (lava && W.isLava(x, z)) continue;
      if (Math.hypot(x, z) < ARENA + 12 || Math.hypot(x - W.nest.x, z - W.nest.z) < 15) continue;
      if (Math.hypot(x - W.portalIn.x, z - W.portalIn.z) < 7 || Math.hypot(x - W.portalNext.x, z - W.portalNext.z) < 7) continue;
      var dens = vnoise(x / 48, z / 48, cfg.seed + 7);
      if (rng() > smooth(0.25, 0.7, dens) * 0.92 + 0.05) continue;
      var near = obstaclesNear(W, x, z, 3.5), ok = true;
      for (var j = 0; j < near.length; j++) { if (Math.hypot(near[j].x - x, near[j].z - z) < 3.2) { ok = false; break; } }
      if (!ok) continue;
      var s = 0.8 + rng() * 0.9;
      var tr = { x: x, z: z, y: h, s: s, r: TR * s, rot: rng() * 6.28, v: rng(), kind: 'tree', h: (TREE_H[tstyle] || 6) * s };
      W.trees.push(tr); addObstacle(W, tr);
    }
    for (var rt = 0; rt < 6000 && W.rocks.length < cfg.rocks; rt++) {
      var rx = (rng() * 2 - 1) * (HALF - 14), rz = (rng() * 2 - 1) * (HALF - 14);
      var rh = heightAt(rx, rz);
      if ((!W.ocean && rh < W.waterY - 0.2) || (lava && W.isLava(rx, rz)) || Math.hypot(rx - W.nest.x, rz - W.nest.z) < 13) continue;
      if (Math.hypot(rx, rz) < ARENA + 8) continue;
      if (Math.hypot(rx - W.portalIn.x, rz - W.portalIn.z) < 6 || Math.hypot(rx - W.portalNext.x, rz - W.portalNext.z) < 6) continue;
      var rs = 0.7 + rng() * 1.8;
      var rk = { x: rx, z: rz, y: rh, s: rs, r: 0.95 * rs, rot: rng() * 6.28, v: rng(), kind: 'rock', h: 1.4 * rs };
      W.rocks.push(rk); if (!W.ocean) addObstacle(W, rk);
    }
    // ближайшее дерево, на которое можно залезть
    W.treeNear = function (x, z, maxD) {
      var near = obstaclesNear(W, x, z, maxD + 2), best = null, bd = 1e9;
      for (var i = 0; i < near.length; i++) {
        var o = near[i]; if (o.kind !== 'tree' || tstyle === 'cactus') continue;
        var d = Math.hypot(o.x - x, o.z - z) - o.r;
        if (d < maxD && d < bd) { bd = d; best = o; }
      }
      return best;
    };
    W.randomLand = function (r, minFromNest) {
      for (var k = 0; k < 60; k++) {
        var px = (r() * 2 - 1) * (HALF - 40), pz = (r() * 2 - 1) * (HALF - 40);
        var ph = heightAt(px, pz);
        if (ph < W.waterY + 0.8 || (lava && W.isLava(px, pz)) || W.slopeAt(px, pz) > 0.7) continue;
        if (Math.hypot(px, pz) < ARENA + 6) continue;
        if (minFromNest && Math.hypot(px - W.nest.x, pz - W.nest.z) < minFromNest) continue;
        var nb = obstaclesNear(W, px, pz, 2), blocked = false;
        for (var j = 0; j < nb.length; j++) if (Math.hypot(nb[j].x - px, nb[j].z - pz) < nb[j].r + 1.2) { blocked = true; break; }
        if (!blocked) return { x: px, z: pz, y: ph };
      }
      return { x: W.nest.x + 8, z: W.nest.z, y: W.nest.y };
    };
    W.randomWater = function (r) {
      for (var k = 0; k < 200; k++) {
        var px = (r() * 2 - 1) * (HALF - 30), pz = (r() * 2 - 1) * (HALF - 30);
        if (W.isDeep(px, pz) && Math.hypot(px, pz) > ARENA + 6) return { x: px, z: pz, y: heightAt(px, pz) };
      }
      return null;
    };
    cache[B] = W;
    return W;
  }

  // круглая арена дуэли: плоская, без препятствий
  function makeDuelWorld() {
    var W = {
      biome: 'duel', cfg: null, def: { waterY: -50, arenaY: 0, nest: [0, 0] }, heightAt: function () { return 0; }, heightRaw: function () { return 0; },
      waterY: -50, lava: false, liquid: 'water', half: 60, arena: { x: 0, z: 0, r: CF.DUEL_R }, trees: [], rocks: [], stones: [], obstacles: [], grid: {}, duel: true,
      nest: { x: 0, z: 0, y: 0 }
    };
    W.slopeAt = function () { return 0; }; W.isWater = W.isDeep = W.isLava = function () { return false; };
    W.slowAt = function () { return 1; }; W.bogAt = function () { return false; };
    W.treeNear = function () { return null; };
    for (var i = 0; i < 24; i++) {
      var a = i / 24 * 6.2832, st = { x: Math.cos(a) * (CF.DUEL_R + 1.5), z: Math.sin(a) * (CF.DUEL_R + 1.5), y: 0, r: 1.5, s: 1, rot: a, kind: 'stone', h: 5 };
      W.stones.push(st);
    }
    return W;
  }

  // ======================================================================== ХАРАКТЕРИСТИКИ
  // размер растёт ступенями: при 10, 20 и 30 уровне динозавр заметно вырастает (плюс плавный рост внутри ступени)
  var STAGE_SCALE = [1, 1.3, 1.6, 1.85];
  function scaleOf(level) {
    var l = clamp(level | 0 || 1, 1, CF.MAX_LEVEL);
    return (0.5 + (l - 1) * 0.022) * STAGE_SCALE[CF.stageIndex(l)];
  }
  // характеристики из класса, уровня и эволюции (evo: {ветка: ранг}); одинаково считаются на клиенте и сервере
  function statsFor(cls, level, evo) {
    var c = CF.CLASSES[cls] || CF.CLASSES.carn;
    level = clamp(level | 0 || 1, 1, CF.MAX_LEVEL);
    var fx = CF.evoTotals(cls, evo || {}), e = function (k) { return clamp(fx[k] | 0, 0, 5); }, v = function (k) { return fx[k] || 0; };
    var sc = scaleOf(level);
    var hpMult = (1 + c.hpPerLevel * (level - 1)) * (1 + v('hp') / 100 + (cls === 'herb' ? 0.10 * e('mass') : 0));
    var dmgMult = (1 + c.dmgPerLevel * (level - 1)) * (1 + v('dmg') / 100);
    var aq = CF.isAqua(cls), sprintMult = c.sprint || CF.SPRINT_MULT, gl = aq ? e('gills') * 0.15 : 0, spd = 1 + v('speed') / 100;
    if (c.dodge) fx.dodge = (fx.dodge || 0) + c.dodge;
    var hp = Math.round(c.hp * hpMult);
    // ranks — ступени способностей классов (их читают механики рывка, засады, топота, полёта, разряда…)
    var ranks = {}; ['pounce', 'ambush', 'roar', 'mass', 'herd', 'climb', 'wings', 'talons', 'altitude', 'screech', 'fins', 'lungs', 'gills', 'shock'].forEach(function (k) { ranks[k] = e(k); });
    var st = {
      sprintMult: sprintMult, noSprint: !!c.noSprint,
      cls: cls, level: level, hp: hp, speed: c.speed * spd, dmg: c.dmg * dmgMult,
      scale: sc, radius: 0.5 * sc + 0.1, reach: c.reach * (0.6 + sc * 0.4) + 0.4, atkCd: c.atkCd, ranks: ranks, fx: fx,
      regen: (CF.REGEN_BASE + CF.REGEN_PCT * hp) + v('regen') * (1 + level * 0.08),
      armor: Math.min(0.55, (v('armor') + (c.armor || 0)) / 100), resist: Math.min(1, v('resist') / 100),
      sense: v('sense') ? Math.round(v('sense')) : 0, stealth: Math.min(0.8, v('stealth') / 100),
      stamRegen: 1 + v('stamina') / 100, foodMult: Math.max(0.4, 1 - v('foodSave') / 100),
      swimSpd: (aq ? c.waterSpeed * (1 + 0.08 * e('fins')) : c.speed) * spd,
      aqua: aq, landStam: aq ? 0.5 + 0.5 * gl : 1, landDmg: aq ? 0.75 + 0.25 * gl : 1,
      breathMax: CF.BREATH_MAX * (1 + 0.25 * e('lungs')),
      flySpd: c.speed * 1.12 * (1 + 0.05 * e('wings')) * spd, flyDrain: CF.FLY_DRAIN * (1 - 0.1 * e('wings')),
      freeSoar: e('wings') >= 4, canClimb: cls === 'herb' && e('climb') >= 1
    };
    return st;
  }

  // ======================================================================== СОСТОЯНИЕ ИГРОКА
  function newPlayer(W, x, z) {
    return { x: x, y: W.heightAt(x, z), z: z, vy: 0, onGround: true, face: 0, stam: CF.STAM_MAX, fly: 0, clm: 0, grd: 0, dsh: 0, dvx: 0, dvz: 0, dvy: 0, stun: 0, slow: 1, lock: 0, ca: 0 };
  }
  var FIELDS = ['x', 'y', 'z', 'vy', 'face', 'stam', 'dsh', 'dvx', 'dvz', 'dvy', 'stun', 'slow'];
  function exportState(p) {
    var o = { og: p.onGround ? 1 : 0, fly: p.fly | 0, clm: p.clm | 0, grd: p.grd | 0, lock: p.lock | 0, ca: p.ca || 0 };
    for (var i = 0; i < FIELDS.length; i++) o[FIELDS[i]] = p[FIELDS[i]];
    return o;
  }
  function importState(p, s) {
    for (var i = 0; i < FIELDS.length; i++) if (s[FIELDS[i]] !== undefined) p[FIELDS[i]] = s[FIELDS[i]];
    p.onGround = !!s.og; p.fly = s.fly | 0; p.clm = s.clm | 0; p.grd = s.grd | 0; p.lock = s.lock | 0; p.ca = s.ca || 0;
  }
  function cleanInput(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var f = +raw.f, s = +raw.s, yaw = +raw.yaw, q = raw.q | 0;
    if (!isFinite(f) || !isFinite(s) || !isFinite(yaw) || q <= 0) return null;
    var pt = +raw.pt; if (!isFinite(pt)) pt = 0.3;
    return { q: q, f: clamp(f, -1, 1), s: clamp(s, -1, 1), yaw: yaw % 6.2832, pitch: clamp(pt, -0.6, 1.3), jump: !!raw.j, down: !!raw.d, sprint: !!raw.sp };
  }

  var _r = { x: 0, z: 0 };
  function resolve(W, x, z, r) {
    if (W.obstacles.length) {
      for (var k = 0; k < 2; k++) {
        var near = obstaclesNear(W, x, z, r + 3);
        for (var i = 0; i < near.length; i++) {
          var o = near[i], dx = x - o.x, dz = z - o.z, d = Math.sqrt(dx * dx + dz * dz), m = o.r + r;
          if (d < m) {
            if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
            x = o.x + dx / d * m; z = o.z + dz / d * m;
          }
        }
      }
    }
    var lim = W.half - 4;
    _r.x = clamp(x, -lim, lim); _r.z = clamp(z, -lim, lim);
    return _r;
  }
  function applyLock(W, p) {
    var d = Math.sqrt(p.x * p.x + p.z * p.z);
    if (W.duel) { var lim = CF.DUEL_R - 1.2; if (d > lim) { p.x *= lim / d; p.z *= lim / d; } return; }
    if (p.lock === 1) { var l1 = ARENA - 1.6; if (d > l1) { p.x *= l1 / d; p.z *= l1 / d; } }
    else if (p.lock === 2) { var l2 = ARENA + 2.2; if (d < l2) { if (d < 1e-3) { p.x = l2; } else { p.x *= l2 / d; p.z *= l2 / d; } } }
  }

  // Один фиксированный шаг физики. p — состояние, inp — очищенный ввод, st — statsFor().
  function step(p, inp, dt, W, st) {
    var f = clamp(+inp.f || 0, -1, 1), s = clamp(+inp.s || 0, -1, 1), jump = !!inp.jump, down = !!inp.down, sprint = !!inp.sprint;
    if (p.stun > 0) { p.stun = Math.max(0, p.stun - dt); f = 0; s = 0; jump = false; down = false; sprint = false; }
    var l = Math.sqrt(f * f + s * s);
    if (l > 1) { f /= l; s /= l; l = 1; }
    var moving = l > 0.05;
    var yaw = +inp.yaw || 0, sy = Math.sin(yaw), cy = Math.cos(yaw);
    var dx = -sy * f + cy * s, dz = -cy * f - sy * s;
    var ground = W.heightAt(p.x, p.z);
    var deep = ground < W.waterY - 0.9 && !W.lava, aqua = !!st.aqua;
    var inWater = ground < W.waterY && !W.lava;
    var slow = (p.slow || 1) * W.slowAt(p.x, p.z);
    if (st.noSprint) sprint = false;                                    // летающий не бегает вообще
    if (aqua && !inWater) sprint = false;                               // на суше водный только ползёт: без рывка

    if (p.clm) { p.vy = 0; p.onGround = false; p.stam = Math.min(CF.STAM_MAX, p.stam + CF.STAM_REGEN * (st.stamRegen || 1) * 1.6 * dt); return p; }   // на дереве отдыхаем: выносливость быстро восстанавливается           // на дереве: стоим (позицию задаёт сервер)
    if (p.grd) { moving = false; }                                    // защитная стойка: не двигаемся

    var speed, swimMode = false, flying = !!p.fly;
    if (flying) {
      speed = st.flySpd * CF.SPEED_SCALE;
    } else if (inWater && aqua) {
      speed = st.swimSpd * CF.SPEED_SCALE; swimMode = deep; if (sprint && p.stam > 1) speed *= CF.SPRINT_MULT;
    } else {
      speed = st.speed * CF.SPEED_SCALE;
      if (inWater) speed *= (deep ? 0.55 : 0.8);
      if (sprint && moving && p.stam > 1) speed *= st.sprintMult;
    }
    speed *= slow;
    var sprinting = sprint && moving && p.stam > 1 && !p.grd;

    // выносливость
    var maxStam = aqua && !inWater ? CF.STAM_MAX * st.landStam : CF.STAM_MAX;
    if (flying) {
      var drain = 0;
      if (jump && p.stam > 1) drain += st.flyDrain; else if (!st.freeSoar) drain += st.flyDrain * 0.3;
      if (sprint && moving) drain += CF.STAM_DRAIN * 0.5;
      p.stam = Math.max(0, p.stam - drain * dt);
    } else if (sprinting) {
      p.stam = Math.max(0, p.stam - CF.STAM_DRAIN * dt);
    } else {
      p.stam = Math.min(maxStam, p.stam + CF.STAM_REGEN * (st.stamRegen || 1) * dt * (moving ? 0.6 : 1) * (aqua && !inWater ? st.landStam : 1));
    }
    if (p.stam > maxStam) p.stam = Math.max(maxStam, p.stam - 20 * dt);

    // горизонталь
    var ox = p.x, oz = p.z, mvx = 0, mvz = 0;
    if (p.dsh > 0) {                                                  // рывок/таран/пикирование: движение задано сервером
      p.dsh = Math.max(0, p.dsh - dt); mvx = p.dvx; mvz = p.dvz;
    } else if (moving) { mvx = dx * speed; mvz = dz * speed; }
    else if (flying) { mvx = Math.sin(p.face) * st.flySpd * CF.SPEED_SCALE * 0.38; mvz = Math.cos(p.face) * st.flySpd * CF.SPEED_SCALE * 0.38; }
    if (mvx !== 0 || mvz !== 0) {
      var nx = ox + mvx * dt, nz = oz + mvz * dt;
      var r = resolve(W, nx, nz, st.radius), cx = r.x, cz = r.z;
      if (!flying && p.onGround && W.heightAt(cx, cz) - p.y > 0.55) {  // слишком крутой подъём — скользим по осям
        var r1 = resolve(W, nx, oz, st.radius), ax = r1.x, az = r1.z, okX = W.heightAt(ax, az) - p.y <= 0.55;
        var r2 = resolve(W, ox, nz, st.radius), bx = r2.x, bz = r2.z, okZ = W.heightAt(bx, bz) - p.y <= 0.55;
        if (okX) { cx = ax; cz = az; } else if (okZ) { cx = bx; cz = bz; } else { cx = ox; cz = oz; }
      }
      p.x = cx; p.z = cz;
      if (moving && p.dsh <= 0 || flying && moving) {
        var tf = Math.atan2(dx, dz);
        p.face = wrap(p.face + wrap(tf - p.face) * Math.min(1, 12 * dt));
      } else if (p.dsh > 0) { p.face = Math.atan2(p.dvx, p.dvz); }
    }
    if (p.lock || W.duel) applyLock(W, p);

    // вертикаль
    ground = W.heightAt(p.x, p.z);
    deep = ground < W.waterY - 0.9 && !W.lava;
    if (flying) {
      var tv;
      if (jump && p.stam > 1) tv = CF.FLY_ASCEND; else if (down) tv = -CF.FLY_DIVE; else tv = -(st.freeSoar ? 0.5 : CF.FLY_SINK);
      if (p.stam <= 1) tv = Math.min(tv, -5);
      if (p.dsh > 0 && p.dvy !== undefined) tv = p.dvy;
      p.vy += (tv - p.vy) * Math.min(1, 6 * dt);
      p.y += p.vy * dt;
      var ceil = ground + CF.FLY_MAX_ALT; if (p.y > ceil) { p.y = ceil; if (p.vy > 0) p.vy = 0; }
      p.onGround = false;
      if (p.y <= ground + 0.02) {                                       // посадка
        p.y = ground; p.vy = 0; p.onGround = true; p.fly = 0;
      }
    } else if (swimMode) {
      // глубина — куда хочет игрок: «Вверх»/«Вниз» или плыть вперёд туда, куда смотрит камера (камера вниз — ныряем);
      // без ввода динозавр держит текущую глубину
      var tvs = 0, pitch = inp.pitch !== undefined ? +inp.pitch : 0.3;
      if (jump) tvs = CF.SWIM_VERT * (1 + (st.swimSpd / 240 - 1)); else if (down) tvs = -CF.SWIM_VERT;
      else if (moving && f > 0.05) { var tilt = clamp((pitch - 0.3) * 2.0, -1, 1); if (Math.abs(tilt) > 0.12) tvs = -tilt * speed * 0.8 * f; }
      p.vy += (tvs - p.vy) * Math.min(1, (tvs === 0 ? 10 : 5) * dt);      // отпустил — быстро останавливается на своей глубине
      p.y += p.vy * dt;
      var top = W.waterY + 0.15 - 1.15 * (st.scale || 1), bot = ground + 0.5;   // спина у поверхности, а не весь динозавр над водой
      if (p.y > top) { p.y = top; p.vy = 0; }
      if (p.y < bot) { p.y = bot; p.vy = 0; }
      var cvr = W.caveAt && W.caveAt(p.x, p.z);                         // каменный свод пещеры: нельзя нырнуть сквозь него сверху и всплыть снизу
      if (cvr) {
        var rb = cvr.f + cvr.rb, rt = cvr.f + cvr.H;
        if (p.y > (rb + rt) / 2) { if (p.y < rt) { p.y = rt; if (p.vy < 0) p.vy = 0; } } else if (p.y > rb - 0.4) { p.y = rb - 0.4; if (p.vy > 0) p.vy = 0; }
      }
      p.onGround = false;
    } else if (deep) {                                                  // не морской: плывёт по поверхности
      var target = W.waterY - 0.55 - 0.25 * st.scale;
      p.y += (target - p.y) * Math.min(1, 6 * dt);
      p.vy = 0; p.onGround = false;
    } else {
      if (jump && p.onGround && !p.grd) { p.vy = CF.JUMP_V; p.onGround = false; }
      p.vy -= CF.GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= ground) { p.y = ground; p.vy = 0; p.onGround = true; } else if (p.y > ground + 0.02) p.onGround = false;
    }
    return p;
  }

  // ======================================================================== ПРОФИЛЬ
  function defaultProfile(name) {
    return {
      name: name || '', color: 0, cls: null, hatched: false,
      level: 1, xp: 0, totalXp: 0, evo: {}, kings: [], kingAt: {}, cosmetics: [], cosmetic: '',
      coins: 0, playTime: 0, wins: 0, biome: 'forest', savedAt: 0,
      slots: {}, seen: [],          // slots — сохранённый прогресс других типов; seen — победённые виды (бестиарий)
      stats: { kills: 0, deaths: 0, bosses: 0, eaten: 0, tourney: 0, rush: 0, coinsEarned: 0 }
    };
  }
  function fixProfile(p) {
    var d = defaultProfile('');
    p = Object.assign(d, p || {});
    p.stats = Object.assign(defaultProfile('').stats, p.stats || {});
    if (!p.evo || typeof p.evo !== 'object') p.evo = {};
    p.evo = CF.evoClean(p.evo);             // старая эволюция (до деревьев) сбрасывается — очки возвращаются
    if (!Array.isArray(p.kings)) p.kings = [];
    if (!p.kingAt || typeof p.kingAt !== 'object') p.kingAt = {};
    if (!Array.isArray(p.cosmetics)) p.cosmetics = [];
    if (p.cls === 'aqua') p.cls = 'mosa';                  // старый морской динозавр стал мозазавром
    if (p.cls && !CF.CLASSES[p.cls]) p.cls = 'carn';
    var sl = {};
    if (p.slots && typeof p.slots === 'object') for (var k in p.slots) {
      var q = p.slots[k], key = k === 'aqua' ? 'mosa' : k;
      if (!CF.CLASSES[key] || !q || typeof q !== 'object' || key === p.cls) continue;
      var lv = clamp(q.level | 0 || 1, 1, CF.MAX_LEVEL);
      var tx = Math.max(CF.cumXp(lv), +q.totalXp || 0);
      sl[key] = { level: lv, totalXp: tx, xp: Math.max(0, Math.min(tx - CF.cumXp(lv), +q.xp || 0)), evo: CF.evoClean(q.evo || {}) };
    }
    p.slots = sl;
    p.seen = (Array.isArray(p.seen) ? p.seen : []).filter(function (id, i, a) { return CF.ENEMIES[id] && a.indexOf(id) === i; }).slice(0, 120);
    return p;
  }
  // переключить активный тип (хищный / травоядный / летающий / морские): прогресс прежнего типа сохраняется, у нового — свой. Возвращает 'same' | 'switch' | 'new' | 'bad'
  function switchType(p, cls) {
    if (!CF.CLASSES[cls]) return 'bad';
    if (p.cls === cls) return 'same';
    var slots = Object.assign({}, p.slots || {});
    if (p.cls) slots[p.cls] = { level: p.level, totalXp: p.totalXp, xp: p.xp, evo: p.evo || {} };
    var q = slots[cls], isNew = !q;
    delete slots[cls];
    p.slots = slots; p.cls = cls;
    p.level = q ? q.level : 1; p.totalXp = q ? q.totalXp : 0; p.xp = q ? q.xp : 0; p.evo = q ? CF.evoClean(q.evo) : {};
    return isNew ? 'new' : 'switch';
  }
  // уровень типа (для меню): у активного — из профиля, у остальных — из сохранённого слота
  function typeLevel(p, cls) { if (p.cls === cls) return p.level; var q = p.slots && p.slots[cls]; return q ? q.level : 0; }
  // сколько биомов открыто игроку (индекс последнего доступного + 1)
  // у каждого мира (суша / океан) своя цепочка: следующая локация открывается после босса предыдущей
  function unlockedBiomes(p, w) { var l = CF.worldList(w || 'land'); return Math.min(l.length, CF.worldKings(p, w || 'land') + 1); }
  function canEnterBiome(p, biome) {
    var w = CF.worldOf(biome), i = CF.worldList(w).indexOf(biome);
    if (i < 0) return false;
    return i < unlockedBiomes(p, w);
  }
  // подходит ли тип биому: наземные — на сушу, морские — в океан
  function typeFits(cls, biome) { return CF.clsWorld(cls) === CF.worldOf(biome); }
  function isLord(p) { return CF.worldKings(p, 'land') >= CF.BIOMES.length; }
  function homeBiome(p, cls) { return CF.isAqua(cls || (p && p.cls)) ? CF.OCEANS[0] : CF.BIOMES[0]; }

  // ======================================================================== ВРАГИ (общие формулы)
  // враги 1–3 уровней были слишком мелкими: крупнее, чтобы их было видно и удобно бить
  function enemySizeMul(lv) { return lv <= 1 ? 2.0 : lv === 2 ? 1.8 : lv === 3 ? 1.58 : lv === 4 ? 1.35 : lv === 5 ? 1.18 : lv === 6 ? 1.08 : 1; }
  function enemyScale(lv) { return { hp: 1 + 0.12 * (lv - 1), dmg: 1 + 0.08 * (lv - 1) }; }   // 1.5: враги заметно крепче с уровнем
  // награда опыта за победу над врагом уровня lv игроком уровня plv
  function xpReward(arch, lv, plv) {
    var base = (8 + lv * 7) * (arch.xp || 1) * (CF.XP_KILL_MULT || 1);
    var diff = plv - lv;
    var k = diff <= 2 ? 1 : Math.max(0.15, 1 - (diff - 2) * 0.12);
    return Math.max(1, Math.round(base * k));
  }

  return {
    CONFIG: CF, clamp: clamp, smooth: smooth, lerp: lerp, wrap: wrap, mulberry32: mulberry32, vnoise: vnoise, fbm: fbm,
    getWorld: getWorld, obstaclesNear: obstaclesNear, DEF: DEF,
    step: step, newPlayer: newPlayer, exportState: exportState, importState: importState, applyLock: applyLock, resolve: resolve,
    cleanInput: cleanInput, statsFor: statsFor, scaleOf: scaleOf,
    defaultProfile: defaultProfile, fixProfile: fixProfile, unlockedBiomes: unlockedBiomes, canEnterBiome: canEnterBiome, typeFits: typeFits, switchType: switchType, typeLevel: typeLevel, isLord: isLord, homeBiome: homeBiome,
    enemyScale: enemyScale, enemySizeMul: enemySizeMul, xpReward: xpReward, TREE_H: TREE_H
  };
});

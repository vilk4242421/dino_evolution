/* Dino Evolution — конфиг и числа баланса (UMD: window.CONFIG в браузере, require в Node).
   ВСЕ числа баланса — здесь: HP, урон, опыт на уровень, цены, кулдауны, древо эволюции, биомы, враги, боссы. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CONFIG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var C = {
    // Адрес сервера. Пусто = тот же адрес, с которого открыта страница.
    // Для APK / открытия как файл укажите, например: 'https://dino-evolution.onrender.com'
    SERVER_URL: '',
    VERSION: '1.7.11',
    PROTO: 6,                 // увеличивайте при несовместимых изменениях сети

    // --- сеть ---
    TICK_RATE: 25,            // тиков в секунду (сервер и фиксированный шаг клиента)
    MAX_ROOM: 4,              // игроков в комнате
    DISCONNECT_KEEP_SEC: 10,  // сколько динозавр остаётся после отключения
    MAX_MSG_PER_SEC: 80,      // лимит сообщений от клиента
    TOKEN_DAYS: 90,
    AOI: 140,                 // радиус «интереса»: врагов дальше не рассылаем (м)

    // --- мир и физика ---
    MAP_SIZE: 640,            // каждый биом — карта 640 × 640 м
    ARENA_R: 30,              // радиус арены босса в центре
    SPEED_SCALE: 1 / 30,      // «скорость 180» = 6 м/с
    GRAVITY: 28,
    JUMP_V: 9.5,
    SPRINT_MULT: 1.7,
    STAM_MAX: 100, STAM_DRAIN: 25, STAM_REGEN: 16,
    FOOD_MAX: 100, FOOD_DRAIN: 0.35,      // сытость в секунду (≈5 минут до нуля)
    STARVE_DPS: 2.5,                      // урон в секунду при нулевой сытости
    DAY_LENGTH: 300,                      // секунд на сутки
    FLY_MAX_ALT: 70, FLY_ASCEND: 7, FLY_DIVE: 15, FLY_SINK: 1.6, FLY_DRAIN: 9,
    SWIM_VERT: 5.5,
    BREATH_MAX: 30,

    // --- прогресс ---
    MAX_LEVEL: 30,
    XP_BASE: 50,
    // --- баланс 1.2: динозавров больше, опыт с каждого меньше (время на уровень примерно то же) ---
    SPAWN_MULT: 1.7,          // во сколько раз больше динозавров в биоме
    AGGRO_MULT: 0.6,          // дальность обнаружения врагов (множитель к aggro каждого вида)
    MAX_CHASERS: 3,           // сколько нападающих врагов одновременно гонятся за одним игроком
    HOSTILE_MULT: 1.4,        // 1.5: хищников-врагов ещё больше
    LEVEL_DIFF_UP: 0.18,      // +18% урона за каждый уровень, на который боец выше соперника (макс. ×2.2)
    LEVEL_DIFF_DOWN: 0.6,     // слабее на уровень — урон делится на 1 + 0.6·разница (3 уровня → ×0.36, минимум ×0.1)
    XP_KILL_MULT: 0.58,       // множитель опыта за победу
    RESPAWN_MIN: 16, RESPAWN_RND: 16,   // через сколько секунд появляется новый динозавр
    XP_EXP: 1.5,              // опыт на уровень: 50 * уровень^1.5
    DEATH_XP_LOSS: 0.2,       // потеря опыта текущего уровня (сам уровень остаётся)
    SHIELD_SEC: 5,           // щит после возрождения
    NAME_MAX: 14,
    EVO_RESET_COST: 200,      // цена сброса очков эволюции (монеты)
    REGEN_BASE: 1.2, REGEN_PCT: 0.008,    // восстановление HP в секунду (вне боя)
    COMBAT_REGEN_DELAY: 4,

    // Ступени: детёныш 1–9, подросток 10–19, взрослый 20–29, древний 30
    STAGES: [{ id: 'baby', from: 1 }, { id: 'young', from: 10 }, { id: 'adult', from: 20 }, { id: 'ancient', from: 30 }],

    COLORS: [0x6aa84f, 0x3d85c6, 0xcc4125, 0xe69138, 0xf1c232, 0x8e7cc3,
             0xc27ba0, 0x45818e, 0x7f6000, 0x999999, 0x38761d, 0xa61c00],

    // --- классы (hp, speed, dmg — из ТЗ) ---
    CLASSES: {
      carn: { hp: 110, speed: 162, sprint: 1.51, dmg: 14, hpPerLevel: 0.05, dmgPerLevel: 0.05, atkCd: 0.5, reach: 3.0, diet: ['meat', 'smeat', 'fish'] },
      herb: { hp: 190, speed: 112, sprint: 1.91, dmg: 17, hpPerLevel: 0.05, dmgPerLevel: 0.05, atkCd: 1.05, reach: 2.8, diet: ['plant'] },
      fly:  { hp: 60,  speed: 200, noSprint: true, dmg: 6, hpPerLevel: 0.05, dmgPerLevel: 0.05, atkCd: 0.33, reach: 2.8, diet: ['smeat', 'fish', 'bug', 'meat'] },
      // водные: speed — скорость НА СУШЕ (намного ниже, чем у наземных), waterSpeed — в воде. aqua: true — морской вид
      mosa:  { aqua: true, hp: 115, speed: 56, dmg: 14, hpPerLevel: 0.05, dmgPerLevel: 0.05, atkCd: 0.55, reach: 3.2, diet: ['fish', 'smeat'], waterSpeed: 245 },
      plio:  { aqua: true, hp: 190, speed: 44, dmg: 11, hpPerLevel: 0.055, dmgPerLevel: 0.05, atkCd: 0.78, reach: 3.5, diet: ['fish', 'smeat'], waterSpeed: 185, armor: 12 },
      ichth: { aqua: true, hp: 80,  speed: 66, dmg: 10, hpPerLevel: 0.05, dmgPerLevel: 0.05, atkCd: 0.42, reach: 2.7, diet: ['fish'], waterSpeed: 310, dodge: 8 }
    },
    // типы динозавров в каждом мире: у каждого типа свой уровень, опыт и эволюция
    TYPES: { land: ['carn', 'herb', 'fly'], sea: ['mosa', 'plio', 'ichth'] },
    // способности: Атака (ЛКМ), Рывок (Shift), E, Q, F (лазание/взлёт). cd — секунды
    ABILITIES: {
      carn: { e: { id: 'pounce', cd: 7 },  q: { id: 'roar', cd: 20 } },
      herb: { e: { id: 'guard', cd: 1 },    q: { id: 'herd', cd: 14 } },
      fly:  { e: { id: 'screech', cd: 16 }, q: { id: 'dive', cd: 6 } },
      mosa:  { e: { id: 'torpedo', cd: 6 }, q: { id: 'roar', cd: 20 } },
      plio:  { e: { id: 'guard', cd: 1 },   q: { id: 'sonic', cd: 16 } },
      ichth: { e: { id: 'torpedo', cd: 4 }, q: { id: 'sonic', cd: 14 } }
    },
    RAGE_HITS: 3, RAGE_MULT: 2, FINISH_HP: 0.2, FINISH_MULT: 1.5,
    GUARD_BLOCK: 0.5, HERD_SEC: 20, HERD_COUNT: 3,
    DUEL_SEC: 90, DUEL_COUNTDOWN: 3, DUEL_R: 24,

    // --- эволюция: деревья с развилками (см. C.TREES ниже) ---
    EVO_MAX: 3,                     // у каждого узла 3 ступени, 1 очко за ступень; очков = уровень − 1
    EVO_TIER_LV: [2, 8, 16],        // с какого уровня открывается 1-я, 2-я и 3-я развилка
    EVO_RESET_COST: 0,              // переключение и сброс бесплатные

    // --- косметика (монеты) ---
    COSMETICS: {
      scarf:  { price: 120, n: { ru: 'Красный шарф', en: 'Red scarf' } },
      aura:   { price: 300, n: { ru: 'Золотая аура', en: 'Golden aura' } },
      party:  { price: 180, n: { ru: 'Праздничный колпак', en: 'Party hat' } },
      glasses:{ price: 240, n: { ru: 'Очки', en: 'Sunglasses' } }
    },

    BIOMES: ['forest', 'snow', 'mountain', 'desert', 'swamp', 'volcano'],        // мир «Суша»
    OCEANS: ['reef', 'kelp', 'arctic', 'vents', 'abyss'],                        // мир «Океан» (только морской динозавр)
    // уровень, с которого открывается портал на арену босса
    BOSS_LEVEL: { forest: 10, snow: 14, mountain: 18, desert: 22, swamp: 26, volcano: 30, reef: 10, kelp: 15, arctic: 20, vents: 25, abyss: 30 },

    // --- правдоподобие профиля (проверяет сервер при синхронизации офлайн-прогресса) ---
    XP_CAP_PER_MIN: 1500, XP_SLACK: 800,
    COINS_CAP_PER_MIN: 900, COINS_SLACK: 600,
    KING_MIN_SEC: 150,         // минимум игрового времени между двумя победами над боссами
    STAT_CAP_PER_MIN: 80,

    // --- графика ---
    QUALITY: {
      high: { view: 300, near: 120, grass: 80, shadow: 2048, pr: 2,   particles: 220 },
      med:  { view: 230, near: 95,  grass: 55, shadow: 1024, pr: 1.5, particles: 110 },
      low:  { view: 160, near: 65,  grass: 35, shadow: 0,    pr: 1,   particles: 50 }
    },
    TARGET_FPS_DESKTOP: 60, TARGET_FPS_MOBILE: 30
  };

  // ---------- враги ----------
  // role: prey (убегает), herd (нейтральное стадо, огрызается), hostile (нападает), bug/fish — еда
  // lv: [мин, макс] базовый уровень (растёт к центру карты); xp: множитель награды
  function E(id, ru, en, o) { o.id = id; o.n = { ru: ru, en: en }; return o; }
  C.ENEMIES = {
    compy:  E('compy', 'Компсогнат', 'Compy', { model: 'critter', color: 0x9bb36a, size: 0.55, hp: 12, dmg: 0, speed: 150, role: 'prey', drop: 'smeat', lv: [1, 6], xp: 0.45, tiny: true }),
    bug:    E('bug', 'Стрекозы', 'Dragonflies', { model: 'bug', color: 0xbfe8ff, size: 0.35, hp: 3, dmg: 0, speed: 90, role: 'bug', drop: 'bug', lv: [1, 1], xp: 0.15, fly: true, tiny: true }),
    fish:   E('fish', 'Рыба', 'Fish', { model: 'fish', color: 0x6fb2d9, size: 0.5, hp: 8, dmg: 0, speed: 130, role: 'fish', drop: 'fish', lv: [1, 1], xp: 0.2, water: true, tiny: true }),
    raptor: E('raptor', 'Раптор', 'Raptor', { model: 'biped', color: 0xb5651d, size: 0.8, hp: 55, dmg: 9, speed: 190, role: 'hostile', aggro: 22, drop: 'meat', lv: [1, 9], xp: 1 }),
    stego:  E('stego', 'Стегозавр', 'Stegosaur', { model: 'quad', color: 0x7a9a4a, size: 1.2, hp: 140, dmg: 7, speed: 105, role: 'herd', drop: 'meat', lv: [3, 11], xp: 1.1, plates: true }),
    hare:   E('hare', 'Снежный заяц', 'Snow hare', { model: 'critter', color: 0xeef3f7, size: 0.55, hp: 14, dmg: 0, speed: 160, role: 'prey', drop: 'smeat', lv: [8, 14], xp: 0.45, tiny: true }),
    frostwolf: E('frostwolf', 'Ледяной хищник', 'Frost stalker', { model: 'biped', color: 0x9fd0ee, size: 0.9, hp: 95, dmg: 13, speed: 200, role: 'hostile', aggro: 26, drop: 'meat', lv: [10, 16], xp: 1, slow: 0.35, pack: true }),
    mammoth: E('mammoth', 'Шерстистый динозавр', 'Woolly dino', { model: 'quad', color: 0x8a6b4a, size: 1.6, hp: 300, dmg: 15, speed: 95, role: 'herd', drop: 'meat', lv: [11, 17], xp: 1.2, fur: true }),
    goat:   E('goat', 'Горный козлик', 'Cliff goat', { model: 'critter', color: 0xb3a58a, size: 0.65, hp: 18, dmg: 0, speed: 170, role: 'prey', drop: 'smeat', lv: [13, 18], xp: 0.45, tiny: true }),
    cragwolf: E('cragwolf', 'Горный хищник', 'Crag hunter', { model: 'biped', color: 0x6d6d78, size: 1.0, hp: 140, dmg: 18, speed: 195, role: 'hostile', aggro: 28, drop: 'meat', lv: [15, 21], xp: 1 }),
    ptero:  E('ptero', 'Птерозавр', 'Pterosaur', { model: 'ptero', color: 0x8b5e83, size: 1.0, hp: 90, dmg: 14, speed: 210, role: 'hostile', aggro: 34, drop: 'meat', lv: [15, 21], xp: 1.2, fly: true, alt: 14 }),
    ram:    E('ram', 'Горный рогач', 'Horned ram', { model: 'quad', color: 0xa88b5a, size: 1.5, hp: 340, dmg: 21, speed: 110, role: 'herd', drop: 'meat', lv: [16, 22], xp: 1.2, horns: true }),
    gecko:  E('gecko', 'Песчаная ящерка', 'Sand gecko', { model: 'critter', color: 0xd9bf7a, size: 0.55, hp: 18, dmg: 0, speed: 165, role: 'prey', drop: 'smeat', lv: [18, 23], xp: 0.45, tiny: true }),
    vulture: E('vulture', 'Падальщик', 'Scavenger', { model: 'ptero', color: 0x5a4a3a, size: 0.8, hp: 100, dmg: 15, speed: 200, role: 'hostile', aggro: 30, drop: 'meat', lv: [19, 24], xp: 1, fly: true, alt: 10 }),
    scorp:  E('scorp', 'Ядовитый ящер', 'Venom lizard', { model: 'biped', color: 0x9a6bd0, size: 0.9, hp: 170, dmg: 20, speed: 185, role: 'hostile', aggro: 24, drop: 'meat', lv: [20, 26], xp: 1.1, poison: 3.5 }),
    dune:   E('dune', 'Дюнный траходонт', 'Dune grazer', { model: 'quad', color: 0xc9a25a, size: 1.4, hp: 400, dmg: 24, speed: 105, role: 'herd', drop: 'meat', lv: [21, 26], xp: 1.2 }),
    frog:   E('frog', 'Болотная лягушка', 'Marsh frog', { model: 'critter', color: 0x5fa86b, size: 0.6, hp: 22, dmg: 0, speed: 150, role: 'prey', drop: 'smeat', lv: [22, 27], xp: 0.45, tiny: true }),
    croc:   E('croc', 'Болотный крокодил', 'Swamp croc', { model: 'croc', color: 0x4d6b3a, size: 1.2, hp: 260, dmg: 26, speed: 150, role: 'hostile', aggro: 22, drop: 'meat', lv: [23, 28], xp: 1.1, amph: true }),
    toxfrog: E('toxfrog', 'Ядовитая жаба', 'Toxic toad', { model: 'critter', color: 0xc6e83c, size: 1.0, hp: 150, dmg: 22, speed: 150, role: 'hostile', aggro: 30, drop: 'meat', lv: [23, 28], xp: 1.1, ranged: 22, poison: 4 }),
    eel:    E('eel', 'Болотный угорь', 'Marsh eel', { model: 'fish', color: 0x3d6b6b, size: 1.1, hp: 200, dmg: 24, speed: 190, role: 'hostile', aggro: 20, drop: 'fish', lv: [24, 29], xp: 1.1, water: true }),
    ashling: E('ashling', 'Пепельный компсо', 'Ash compy', { model: 'critter', color: 0x8a5a4a, size: 0.6, hp: 25, dmg: 0, speed: 165, role: 'prey', drop: 'smeat', lv: [26, 30], xp: 0.45, tiny: true }),
    magmaraptor: E('magmaraptor', 'Магмовый раптор', 'Magma raptor', { model: 'biped', color: 0xd9432a, size: 1.0, hp: 300, dmg: 32, speed: 200, role: 'hostile', aggro: 28, drop: 'meat', lv: [26, 30], xp: 1.1, burn: 4 }),
    ashtrike: E('ashtrike', 'Пепельный цератопс', 'Ash trike', { model: 'quad', color: 0x5a4a48, size: 1.6, hp: 520, dmg: 30, speed: 105, role: 'herd', drop: 'meat', lv: [27, 30], xp: 1.2, horns: true }),
    fireptero: E('fireptero', 'Огненный птерозавр', 'Fire pterosaur', { model: 'ptero', color: 0xe0642a, size: 1.1, hp: 260, dmg: 28, speed: 215, role: 'hostile', aggro: 34, drop: 'meat', lv: [27, 30], xp: 1.2, fly: true, alt: 16, ranged: 26, burn: 3 }),
    ember:  E('ember', 'Искровые мотыльки', 'Ember moths', { model: 'bug', color: 0xffa040, size: 0.35, hp: 3, dmg: 0, speed: 90, role: 'bug', drop: 'bug', lv: [1, 1], xp: 0.15, fly: true, tiny: true }),

    // ---------- океан: все плавают (water), добыча и враги дают рыбу — её ест морской динозавр ----------
    // Коралловый риф
    reeffish:  E('reeffish', 'Рифовая рыба', 'Reef fish', { model: 'fish', color: 0xf2b33a, size: 0.45, hp: 8, dmg: 0, speed: 140, role: 'fish', drop: 'fish', lv: [1, 1], xp: 0.2, water: true, tiny: true }),
    ammonite:  E('ammonite', 'Аммонит', 'Ammonite', { model: 'ammonite', color: 0xd8a070, size: 0.7, hp: 14, dmg: 0, speed: 120, role: 'prey', drop: 'fish', lv: [1, 7], xp: 0.45, water: true, tiny: true }),
    hybodus:   E('hybodus', 'Гибодус', 'Hybodus shark', { model: 'shark', color: 0x7a8a96, size: 0.85, hp: 55, dmg: 9, speed: 200, role: 'hostile', aggro: 22, drop: 'fish', lv: [1, 9], xp: 1, water: true }),
    barracuda: E('barracuda', 'Барракуда', 'Barracuda', { model: 'fish', color: 0x9aaab8, size: 0.6, hp: 18, dmg: 3, speed: 215, role: 'hostile', aggro: 16, drop: 'fish', lv: [1, 4], xp: 0.55, water: true }),
    pikefish:  E('pikefish', 'Щука', 'Pike', { model: 'fish', color: 0x7a9a4a, size: 0.65, hp: 22, dmg: 3.5, speed: 210, role: 'hostile', aggro: 16, drop: 'fish', lv: [1, 5], xp: 0.55, water: true }),
    icebiter:  E('icebiter', 'Ледяной зубатка', 'Ice wolffish', { model: 'fish', color: 0xa8c8d8, size: 0.65, hp: 26, dmg: 4, speed: 205, role: 'hostile', aggro: 16, drop: 'fish', lv: [4, 9], xp: 0.55, water: true }),
    ventbiter: E('ventbiter', 'Огненный пиранья', 'Vent piranha', { model: 'fish', color: 0xd0502a, size: 0.6, hp: 30, dmg: 5, speed: 215, role: 'hostile', aggro: 16, drop: 'fish', lv: [8, 14], xp: 0.55, water: true }),
    gulper:    E('gulper', 'Глубинный клыкач', 'Fangtooth', { model: 'fish', color: 0x2a2a3a, size: 0.65, hp: 34, dmg: 6, speed: 205, role: 'hostile', aggro: 16, drop: 'fish', lv: [12, 18], xp: 0.55, water: true }),
    archelon:  E('archelon', 'Архелон', 'Archelon', { model: 'turtle', color: 0x6a7a4a, size: 1.25, hp: 150, dmg: 7, speed: 100, role: 'herd', drop: 'fish', lv: [3, 11], xp: 1.1, water: true }),
    // Ламинариевый лес
    kelpfish:  E('kelpfish', 'Ламинариевая рыба', 'Kelp fish', { model: 'fish', color: 0x9ac24a, size: 0.5, hp: 10, dmg: 0, speed: 140, role: 'fish', drop: 'fish', lv: [1, 1], xp: 0.2, water: true, tiny: true }),
    nautilus:  E('nautilus', 'Наутилус', 'Nautilus', { model: 'ammonite', color: 0xe8dcc8, size: 0.75, hp: 18, dmg: 0, speed: 125, role: 'prey', drop: 'fish', lv: [8, 14], xp: 0.45, water: true, tiny: true, stripes: true }),
    ichthyo:   E('ichthyo', 'Ихтиозавр', 'Ichthyosaur', { model: 'ichthyo', color: 0x5a7aa8, size: 0.95, hp: 100, dmg: 13, speed: 220, role: 'hostile', aggro: 26, drop: 'fish', lv: [9, 16], xp: 1, water: true, pack: true }),
    plesio:    E('plesio', 'Плезиозавр', 'Plesiosaur', { model: 'plesio', color: 0x6a8a6a, size: 1.3, hp: 300, dmg: 15, speed: 110, role: 'herd', drop: 'fish', lv: [10, 17], xp: 1.2, water: true }),
    // Ледяной океан
    icefish:   E('icefish', 'Ледяная рыба', 'Icefish', { model: 'fish', color: 0xcfe8f4, size: 0.5, hp: 10, dmg: 0, speed: 140, role: 'fish', drop: 'fish', lv: [1, 1], xp: 0.2, water: true, tiny: true }),
    iceammon:  E('iceammon', 'Ледяной аммонит', 'Ice ammonite', { model: 'ammonite', color: 0xbfd8ea, size: 0.75, hp: 20, dmg: 0, speed: 125, role: 'prey', drop: 'fish', lv: [13, 18], xp: 0.45, water: true, tiny: true }),
    frostshark: E('frostshark', 'Ледяная акула', 'Frost shark', { model: 'shark', color: 0xdfeef6, size: 1.0, hp: 150, dmg: 18, speed: 210, role: 'hostile', aggro: 28, drop: 'fish', lv: [14, 21], xp: 1, water: true, slow: 0.35 }),
    elasmo:    E('elasmo', 'Эласмозавр', 'Elasmosaurus', { model: 'plesio', color: 0xa8c0d0, size: 1.5, hp: 360, dmg: 21, speed: 105, role: 'herd', drop: 'fish', lv: [15, 22], xp: 1.2, water: true, longNeck: true }),
    // Чёрные курильщики (гидротермальные источники)
    ventfish:  E('ventfish', 'Огненная рыба', 'Vent fish', { model: 'fish', color: 0xd06a3a, size: 0.5, hp: 12, dmg: 0, speed: 145, role: 'fish', drop: 'fish', lv: [1, 1], xp: 0.2, water: true, tiny: true }),
    ventammon: E('ventammon', 'Жаровой аммонит', 'Vent ammonite', { model: 'ammonite', color: 0x8a3a2a, size: 0.8, hp: 26, dmg: 0, speed: 130, role: 'prey', drop: 'fish', lv: [18, 23], xp: 0.45, water: true, tiny: true, glow: 0xff7a2a }),
    dunkle:    E('dunkle', 'Дунклеостей', 'Dunkleosteus', { model: 'dunkle', color: 0x55555e, size: 1.2, hp: 230, dmg: 24, speed: 175, role: 'hostile', aggro: 24, drop: 'fish', lv: [19, 26], xp: 1.1, water: true }),
    magmaeel:  E('magmaeel', 'Магмовый угорь', 'Magma eel', { model: 'eel', color: 0x6a2a1a, size: 1.1, hp: 180, dmg: 22, speed: 195, role: 'hostile', aggro: 22, drop: 'fish', lv: [20, 26], xp: 1.1, water: true, burn: 3 }),
    henodus:   E('henodus', 'Генодус', 'Henodus', { model: 'turtle', color: 0x3e3834, size: 1.45, hp: 430, dmg: 24, speed: 95, role: 'herd', drop: 'fish', lv: [20, 26], xp: 1.2, water: true }),
    // Бездна
    lanternfish: E('lanternfish', 'Светящийся анчоус', 'Lanternfish', { model: 'fish', color: 0x2a3a5a, size: 0.5, hp: 12, dmg: 0, speed: 145, role: 'fish', drop: 'fish', lv: [1, 1], xp: 0.2, water: true, tiny: true, glow: 0x7af0ff }),
    abyssammon: E('abyssammon', 'Глубинный аммонит', 'Abyssal ammonite', { model: 'ammonite', color: 0x4a3a7a, size: 0.85, hp: 30, dmg: 0, speed: 130, role: 'prey', drop: 'fish', lv: [24, 29], xp: 0.45, water: true, tiny: true, glow: 0xb07aff }),
    angler:    E('angler', 'Удильщик', 'Anglerfish', { model: 'angler', color: 0x2e2e3e, size: 1.1, hp: 280, dmg: 30, speed: 160, role: 'hostile', aggro: 16, drop: 'fish', lv: [24, 30], xp: 1.1, water: true, poison: 3 }),
    abyssmosa: E('abyssmosa', 'Мозазавр бездны', 'Abyssal mosasaur', { model: 'abyssmosa', color: 0x1e2a3a, size: 1.5, hp: 480, dmg: 32, speed: 210, role: 'hostile', aggro: 30, drop: 'fish', lv: [26, 30], xp: 1.2, water: true })
  };
  // союзники и стадо
  C.ALLY = { herb: 'stego', king: { forest: 'raptor', snow: 'frostwolf', mountain: 'cragwolf', desert: 'scorp', swamp: 'croc', volcano: 'magmaraptor', reef: 'hybodus', kelp: 'ichthyo', arctic: 'frostshark', vents: 'dunkle', abyss: 'angler' } };
  C.KING_ALLIES = 3;

  // ---------- биомы ----------
  // dens — плотность растительности; fog — множитель дальности тумана; spawn — {враг: число на карту}
  C.BIOME = {
    forest: {
      water: 0x3f94c4, seed: 1337, ground: [0x5fa04a, 0x4b8c3d, 0x3b7433], edge: 0xd5c488, rock: 0x8a8b86, hill: 0x6f7f5a,
      sky: [0x5ea3d9, 0xcfe6d0], sun: 0xfff1d6, hemi: [0xdff0ff, 0x4a6b3a], fog: 1.0, liquid: 'water', weather: 'leaves',
      trees: 1800, rocks: 260, treeStyle: 'broad', music: 'forest',
      spawn: { compy: 34, bug: 24, fish: 16, raptor: 16, stego: 10 }, hazard: null,
      n: { ru: 'Лес', en: 'Forest' }, boss: 'tyrant'
    },
    snow: {
      water: 0x8fc4e0, seed: 2711, ground: [0xe8f0f5, 0xd5e4ee, 0xbdd3e2], edge: 0xcfe4f0, rock: 0x7d8a99, hill: 0xf4f9fc,
      sky: [0x8fb3d4, 0xe3eef6], sun: 0xf0f6ff, hemi: [0xe8f4ff, 0x8ea8bd], fog: 0.8, liquid: 'water', weather: 'snow',
      trees: 1100, rocks: 300, treeStyle: 'pine', music: 'snow',
      spawn: { hare: 30, bug: 14, fish: 12, frostwolf: 18, mammoth: 10 }, hazard: 'cold',
      n: { ru: 'Снежные равнины', en: 'Snow Plains' }, boss: 'frost'
    },
    mountain: {
      water: 0x4a88b0, seed: 4099, ground: [0x8c8a80, 0x77756c, 0x5f5e58], edge: 0xa8a294, rock: 0x6c6c72, hill: 0x9a9a9e,
      sky: [0x6e86a8, 0xd2d9e0], sun: 0xfff4e0, hemi: [0xdfe8f5, 0x6a6a6a], fog: 0.9, liquid: 'water', weather: 'wind',
      trees: 700, rocks: 900, treeStyle: 'pine', music: 'mountain',
      spawn: { goat: 30, bug: 12, fish: 10, cragwolf: 16, ptero: 10, ram: 8 }, hazard: 'rockfall',
      n: { ru: 'Горы', en: 'Mountains' }, boss: 'rogach'
    },
    desert: {
      water: 0x3fb0b8, seed: 5231, ground: [0xe3c488, 0xd8b576, 0xc79f5f], edge: 0xf0d9a0, rock: 0xb08a5a, hill: 0xe8cf94,
      sky: [0x7fb8e8, 0xf4e1b8], sun: 0xfff0c8, hemi: [0xfff4dc, 0xb08a4a], fog: 0.9, liquid: 'water', weather: 'dust',
      trees: 260, rocks: 320, treeStyle: 'cactus', music: 'desert',
      spawn: { gecko: 28, bug: 14, fish: 8, vulture: 12, scorp: 16, dune: 8 }, hazard: 'heat',
      n: { ru: 'Пустыня', en: 'Desert' }, boss: 'sandlord'
    },
    swamp: {
      water: 0x4a6b3a, seed: 6173, ground: [0x4f6b3a, 0x435c33, 0x384b2b], edge: 0x6b6b3a, rock: 0x5b6a5a, hill: 0x55704a,
      sky: [0x6f8f7a, 0xb9c9a8], sun: 0xe8f0c0, hemi: [0xcfe0c0, 0x2f4a2a], fog: 0.55, liquid: 'swamp', weather: 'spores',
      trees: 1300, rocks: 150, treeStyle: 'mangrove', music: 'swamp',
      spawn: { frog: 32, bug: 26, fish: 30, croc: 14, toxfrog: 12, eel: 10 }, hazard: 'poison',
      n: { ru: 'Болото и побережье', en: 'Swamp & Coast' }, boss: 'leviathan'
    },
    volcano: {
      water: 0xff5a1a, seed: 7919, ground: [0x4a4240, 0x3b3534, 0x2c2827], edge: 0x6a4a3a, rock: 0x2f2b2b, hill: 0x5a4a48,
      sky: [0x5a1c14, 0xd9632a], sun: 0xffb070, hemi: [0xffa070, 0x3a1a14], fog: 0.65, liquid: 'lava', weather: 'ash',
      trees: 260, rocks: 700, treeStyle: 'burnt', music: 'volcano',
      spawn: { ashling: 28, ember: 22, magmaraptor: 16, ashtrike: 8, fireptero: 10 }, hazard: 'lava',
      n: { ru: 'Вулкан', en: 'Volcano' }, boss: 'dragon'
    },

    // ================= ОКЕАН =================
    // ocean: true — весь мир под водой (островок с гнездом); deep — цвет толщи воды, vis — видимость под водой (м)
    reef: {
      ocean: true, water: 0x2aa6c4, deep: 0x1f8aa6, vis: 95, seed: 8111, ground: [0xe8d6a4, 0xd8c08a, 0xc8ac78], edge: 0xf0e2b8, rock: 0xc8a888, hill: 0xe8d6a4,
      sky: [0x4aa8e8, 0xcdeaf4], sun: 0xfff6dc, hemi: [0xe8f8ff, 0x6a9aa8], fog: 1.0, liquid: 'water', weather: 'marine',
      trees: 0, rocks: 160, treeStyle: 'none', music: 'reef',
      spawn: { reeffish: 95, barracuda: 24, ammonite: 30, hybodus: 16, archelon: 10 }, hazard: null,
      n: { ru: 'Коралловый риф', en: 'Coral Reef' }, boss: 'megalodon'
    },
    kelp: {
      ocean: true, water: 0x2a8a8a, deep: 0x1d6a6a, vis: 70, seed: 8233, ground: [0x8a8a5a, 0x6f7a4a, 0x5a663e], edge: 0xc8c090, rock: 0x6a7068, hill: 0x8a8a5a,
      sky: [0x5a96c8, 0xc8dce0], sun: 0xf6f2dc, hemi: [0xd8f0e8, 0x3a5a4a], fog: 0.85, liquid: 'water', weather: 'marine',
      trees: 0, rocks: 320, treeStyle: 'none', music: 'kelp',
      spawn: { kelpfish: 85, pikefish: 22, nautilus: 26, ichthyo: 16, plesio: 10 }, hazard: null,
      n: { ru: 'Ламинариевый лес', en: 'Kelp Forest' }, boss: 'plesioqueen'
    },
    arctic: {
      ocean: true, water: 0x5a9ab8, deep: 0x3a6f8a, vis: 75, seed: 8377, ground: [0x9aa8b4, 0x86929c, 0x707c86], edge: 0xe8f2f8, rock: 0x8a98a8, hill: 0xf4f9fc,
      sky: [0x8fb3d4, 0xe3eef6], sun: 0xf0f6ff, hemi: [0xe8f4ff, 0x6a8aa0], fog: 0.85, liquid: 'water', weather: 'marine',
      trees: 0, rocks: 260, treeStyle: 'none', music: 'arctic',
      spawn: { icefish: 80, icebiter: 20, iceammon: 26, frostshark: 18, elasmo: 10 }, hazard: 'cold',
      n: { ru: 'Ледяной океан', en: 'Frozen Sea' }, boss: 'kronos'
    },
    vents: {
      ocean: true, water: 0x2a5a6a, deep: 0x16323c, vis: 55, seed: 8521, ground: [0x3a3634, 0x2e2a29, 0x24201f], edge: 0x6a5a4a, rock: 0x2a2626, hill: 0x4a4240,
      sky: [0x4a7090, 0xb8c8d0], sun: 0xffe8d0, hemi: [0xd0e0e8, 0x3a2a24], fog: 0.7, liquid: 'water', weather: 'vent',
      trees: 0, rocks: 520, treeStyle: 'none', music: 'vents',
      spawn: { ventfish: 70, ventbiter: 18, ventammon: 24, dunkle: 16, magmaeel: 10, henodus: 8 }, hazard: 'vent',
      n: { ru: 'Чёрные курильщики', en: 'Hydrothermal Vents' }, boss: 'dunkleo'
    },
    abyss: {
      ocean: true, water: 0x1a3a5a, deep: 0x0c1c34, vis: 50, seed: 8663, ground: [0x2a2e3a, 0x22252f, 0x1a1c24], edge: 0x5a5a6a, rock: 0x22242c, hill: 0x2a2e3a,
      sky: [0x2a4a6a, 0x8aa0b8], sun: 0xc8d8f0, hemi: [0xa0b8d8, 0x101420], fog: 0.6, liquid: 'water', weather: 'glow',
      trees: 0, rocks: 300, treeStyle: 'none', music: 'abyss',
      spawn: { lanternfish: 70, gulper: 18, abyssammon: 24, angler: 16, abyssmosa: 10 }, hazard: null,
      n: { ru: 'Бездна', en: 'The Abyss' }, boss: 'tylo'
    }
  };
  // урон среды в секунду (до сопротивления «Шкуры»)
  C.HAZARD = { cold: 3.0, heat: 3.0, poison: 4.0, lava: 45, ash: 1.0, vent: 9 };   // vent — жар у чёрных курильщиков

  // ---------- боссы ----------
  // shape: circle (в точке цели/самого босса), cone, line, ring, multi (несколько кругов)
  // at: self|target|rand; warn — секунды предупреждения (красная зона); dmg — урон; ph — с какой фазы доступна
  function A(o) { return o; }
  C.BOSSES = {
    tyrant: {
      n: { ru: 'Старый Тираннозавр', en: 'Old Tyrannosaur' }, model: 'tyrant', hp: 3500, size: 3.2, speed: 4.6, color: 0x8a4b2a, xp: 1.6,
      attacks: [
        A({ id: 'bite', shape: 'cone', warn: 0.9, len: 9, ang: 1.3, dmg: 42, ph: 0, wt: 4 }),
        A({ id: 'charge', shape: 'line', warn: 1.3, len: 34, w: 5, dmg: 58, dash: true, ph: 0, wt: 3 }),
        A({ id: 'roar', shape: 'ring', warn: 1.5, r: 17, dmg: 22, stun: 0.9, shake: 1, summon: 'raptor', n: 3, ph: 1, wt: 2 }),
        A({ id: 'stomp', shape: 'circle', at: 'self', warn: 1.2, r: 11, dmg: 38, ph: 2, wt: 3 })
      ]
    },
    frost: {
      n: { ru: 'Ледяной Гигант', en: 'Ice Giant' }, model: 'frost', hp: 6500, size: 3.6, speed: 3.8, color: 0x9fd0ee, xp: 1.6,
      attacks: [
        A({ id: 'smash', shape: 'circle', at: 'self', warn: 1.1, r: 9, dmg: 48, ph: 0, wt: 3 }),
        A({ id: 'breath', shape: 'cone', warn: 1.4, len: 22, ang: 1.0, dmg: 42, freeze: 2.5, ph: 0, wt: 4 }),
        A({ id: 'shards', shape: 'multi', at: 'target', n: 5, warn: 1.3, r: 3.8, dmg: 34, ph: 1, wt: 3 }),
        A({ id: 'blizzard', shape: 'ring', warn: 1.8, r: 24, dmg: 30, slow: 3, summon: 'frostwolf', n: 2, shake: 1, ph: 2, wt: 2 })
      ]
    },
    rogach: {
      n: { ru: 'Горный Рогач', en: 'Mountain Horned One' }, model: 'rogach', hp: 10000, size: 3.4, speed: 4.4, color: 0x8a7a5a, xp: 1.6,
      attacks: [
        A({ id: 'rocks', shape: 'multi', at: 'rand', n: 5, warn: 1.5, r: 4.2, dmg: 45, ph: 0, wt: 4 }),
        A({ id: 'gore', shape: 'cone', warn: 1.0, len: 10, ang: 1.2, dmg: 55, ph: 0, wt: 3 }),
        A({ id: 'slam', shape: 'circle', at: 'self', warn: 1.5, r: 12, dmg: 58, shake: 1, ph: 1, wt: 3 }),
        A({ id: 'charge', shape: 'line', warn: 1.2, len: 36, w: 6, dmg: 62, dash: true, ph: 1, wt: 3 }),
        A({ id: 'avalanche', shape: 'multi', at: 'rand', n: 9, warn: 1.6, r: 4.2, dmg: 48, ph: 2, wt: 3 })
      ]
    },
    sandlord: {
      n: { ru: 'Песчаный Повелитель', en: 'Sand Lord' }, model: 'sandlord', hp: 15000, size: 3.4, speed: 4.2, color: 0xc9a25a, xp: 1.6,
      attacks: [
        A({ id: 'sweep', shape: 'cone', warn: 1.0, len: 12, ang: 2.1, dmg: 56, ph: 0, wt: 3 }),
        A({ id: 'spit', shape: 'line', warn: 1.2, len: 32, w: 3.5, dmg: 42, poison: 5, ph: 0, wt: 3 }),
        A({ id: 'burrow', shape: 'circle', at: 'target', burrow: true, warn: 2.4, r: 8, dmg: 70, ph: 1, wt: 4 }),
        A({ id: 'sandstorm', shape: 'ring', warn: 1.8, r: 23, dmg: 34, slow: 3, shake: 1, ph: 2, wt: 2 })
      ]
    },
    leviathan: {
      n: { ru: 'Морской Левиафан', en: 'Sea Leviathan' }, model: 'leviathan', hp: 21000, size: 3.8, speed: 4.0, color: 0x3d7f9a, xp: 1.6,
      attacks: [
        A({ id: 'tail', shape: 'cone', warn: 1.0, len: 14, ang: 1.9, dmg: 62, ph: 0, wt: 4 }),
        A({ id: 'spit', shape: 'multi', at: 'target', n: 4, warn: 1.3, r: 4, dmg: 44, poison: 5, ph: 0, wt: 3 }),
        A({ id: 'tide', shape: 'line', warn: 1.8, len: 62, w: 17, dmg: 58, knock: 10, shake: 1, ph: 1, wt: 3 }),
        A({ id: 'whirl', shape: 'ring', warn: 1.6, r: 20, dmg: 40, stun: 1, summon: 'eel', n: 2, ph: 2, wt: 2 })
      ]
    },
    dragon: {
      n: { ru: 'Вулканический Дракон', en: 'Volcanic Dragon' }, model: 'dragon', hp: 28000, size: 3.8, speed: 4.6, color: 0xb02a1a, xp: 1.8,
      attacks: [
        A({ id: 'fire', shape: 'cone', warn: 1.3, len: 26, ang: 0.95, dmg: 66, burn: 5, ph: 0, wt: 4 }),
        A({ id: 'lavarain', shape: 'multi', at: 'rand', n: 7, warn: 1.5, r: 4.6, dmg: 52, ph: 0, wt: 3 }),
        A({ id: 'wing', shape: 'circle', at: 'self', warn: 1.2, r: 13, dmg: 62, shake: 1, ph: 1, wt: 3 }),
        A({ id: 'geysers', shape: 'multi', at: 'target', n: 6, warn: 1.2, r: 4, dmg: 54, burn: 4, ph: 2, wt: 3 }),
        A({ id: 'inferno', shape: 'ring', warn: 1.9, r: 24, dmg: 48, summon: 'magmaraptor', n: 2, shake: 1, ph: 2, wt: 2 })
      ]
    }
  };
  // ---------- боссы океана ----------
  C.BOSSES.megalodon = {
    n: { ru: 'Древний Мегалодон', en: 'Ancient Megalodon' }, model: 'megalodon', hp: 3500, size: 3.0, speed: 5.0, color: 0x6a7a88, xp: 1.6, sea: true,
    attacks: [
      A({ id: 'bite', shape: 'cone', warn: 0.9, len: 10, ang: 1.2, dmg: 42, ph: 0, wt: 4 }),
      A({ id: 'charge', shape: 'line', warn: 1.2, len: 34, w: 5, dmg: 56, dash: true, ph: 0, wt: 3 }),
      A({ id: 'tail', shape: 'circle', at: 'self', warn: 1.1, r: 10, dmg: 36, ph: 1, wt: 3 }),
      A({ id: 'frenzy', shape: 'ring', warn: 1.5, r: 17, dmg: 24, shake: 1, summon: 'hybodus', n: 3, ph: 1, wt: 2 })
    ]
  };
  C.BOSSES.plesioqueen = {
    n: { ru: 'Королева плезиозавров', en: 'Plesiosaur Queen' }, model: 'plesioqueen', hp: 6500, size: 3.2, speed: 4.0, color: 0x4a7a5a, xp: 1.6, sea: true,
    attacks: [
      A({ id: 'neck', shape: 'cone', warn: 1.0, len: 17, ang: 0.8, dmg: 46, ph: 0, wt: 4 }),
      A({ id: 'bubbles', shape: 'multi', at: 'target', n: 5, warn: 1.3, r: 3.8, dmg: 34, ph: 0, wt: 3 }),
      A({ id: 'wave', shape: 'line', warn: 1.6, len: 50, w: 12, dmg: 44, knock: 9, shake: 1, ph: 1, wt: 3 }),
      A({ id: 'whirl', shape: 'ring', warn: 1.7, r: 22, dmg: 30, stun: 0.9, summon: 'ichthyo', n: 2, ph: 2, wt: 2 })
    ]
  };
  C.BOSSES.kronos = {
    n: { ru: 'Ледяной Кронозавр', en: 'Frost Kronosaurus' }, model: 'kronos', hp: 10000, size: 3.4, speed: 4.4, color: 0x8ab0c8, xp: 1.6, sea: true,
    attacks: [
      A({ id: 'crush', shape: 'cone', warn: 1.0, len: 11, ang: 1.3, dmg: 56, ph: 0, wt: 4 }),
      A({ id: 'shards', shape: 'multi', at: 'rand', n: 6, warn: 1.4, r: 4.2, dmg: 44, freeze: 2, ph: 0, wt: 3 }),
      A({ id: 'slam', shape: 'circle', at: 'self', warn: 1.4, r: 12, dmg: 58, shake: 1, ph: 1, wt: 3 }),
      A({ id: 'blizzard', shape: 'ring', warn: 1.8, r: 24, dmg: 34, slow: 3, summon: 'frostshark', n: 2, ph: 2, wt: 2 })
    ]
  };
  C.BOSSES.dunkleo = {
    n: { ru: 'Дунклеостей-титан', en: 'Titan Dunkleosteus' }, model: 'dunkleo', hp: 15000, size: 3.2, speed: 4.2, color: 0x4a4a54, xp: 1.6, sea: true,
    attacks: [
      A({ id: 'crush', shape: 'cone', warn: 1.0, len: 12, ang: 1.6, dmg: 60, ph: 0, wt: 4 }),
      A({ id: 'eruption', shape: 'multi', at: 'target', n: 5, warn: 1.3, r: 4, dmg: 46, burn: 5, ph: 0, wt: 3 }),
      A({ id: 'charge', shape: 'line', warn: 1.2, len: 36, w: 6, dmg: 64, dash: true, ph: 1, wt: 3 }),
      A({ id: 'inferno', shape: 'ring', warn: 1.8, r: 23, dmg: 40, summon: 'magmaeel', n: 2, shake: 1, ph: 2, wt: 2 })
    ]
  };
  C.BOSSES.tylo = {
    n: { ru: 'Тилозавр Бездны', en: 'Abyssal Tylosaurus' }, model: 'tylo', hp: 22000, size: 3.6, speed: 4.6, color: 0x1e2a44, xp: 1.8, sea: true,
    attacks: [
      A({ id: 'bite', shape: 'cone', warn: 1.0, len: 14, ang: 1.5, dmg: 64, ph: 0, wt: 4 }),
      A({ id: 'ink', shape: 'multi', at: 'rand', n: 7, warn: 1.5, r: 4.4, dmg: 48, poison: 5, ph: 0, wt: 3 }),
      A({ id: 'tide', shape: 'line', warn: 1.7, len: 60, w: 16, dmg: 58, knock: 10, shake: 1, ph: 1, wt: 3 }),
      A({ id: 'crush', shape: 'circle', at: 'self', warn: 1.2, r: 13, dmg: 62, shake: 1, ph: 1, wt: 3 }),
      A({ id: 'abyss', shape: 'ring', warn: 1.9, r: 24, dmg: 48, summon: 'angler', n: 2, shake: 1, ph: 2, wt: 2 })
    ]
  };
  C.BOSS_PHASES = [1, 0.66, 0.33];     // доли HP, с которых начинаются фазы
  C.BOSS_HP_PER_PLAYER = 0.7;          // +70% HP за каждого дополнительного игрока в бою
  C.BOSS_RUSH_STEP = 0.3;              // босс-раш: +30% HP и урона за каждую волну

  // ---------- достижения (счётчики лежат в profile.stats) ----------
  C.ACH = [
    { id: 'first', ico: '🥩', n: { ru: 'Первая кровь', en: 'First blood' }, d: { ru: 'Победить первого врага', en: 'Defeat your first enemy' }, t: function (p) { return p.stats.kills >= 1; } },
    { id: 'hunter', ico: '🏹', n: { ru: 'Охотник', en: 'Hunter' }, d: { ru: 'Победить 100 врагов', en: 'Defeat 100 enemies' }, t: function (p) { return p.stats.kills >= 100; } },
    { id: 'glutton', ico: '🍖', n: { ru: 'Обжора', en: 'Glutton' }, d: { ru: 'Съесть 150 раз', en: 'Eat 150 times' }, t: function (p) { return p.stats.eaten >= 150; } },
    { id: 'lv10', ico: '🦖', n: { ru: 'Подросток', en: 'Teenager' }, d: { ru: 'Достичь 10 уровня', en: 'Reach level 10' }, t: function (p) { return p.level >= 10; } },
    { id: 'lv20', ico: '🦕', n: { ru: 'Взрослый', en: 'Adult' }, d: { ru: 'Достичь 20 уровня', en: 'Reach level 20' }, t: function (p) { return p.level >= 20; } },
    { id: 'lv30', ico: '🐉', n: { ru: 'Древний', en: 'Ancient' }, d: { ru: 'Достичь 30 уровня', en: 'Reach level 30' }, t: function (p) { return p.level >= 30; } },
    { id: 'evo', ico: '🧬', n: { ru: 'Эволюционист', en: 'Evolutionist' }, d: { ru: 'Вложить 10 очков эволюции', en: 'Spend 10 evolution points' }, t: function (p) { return C.evoSpent(p.evo) >= 10; } },
    { id: 'king1', ico: '👑', n: { ru: 'Король биома', en: 'Biome king' }, d: { ru: 'Победить первого босса', en: 'Defeat your first boss' }, t: function (p) { return p.kings.length >= 1; } },
    { id: 'sea1', ico: '🌊', n: { ru: 'Владыка рифа', en: 'Reef ruler' }, d: { ru: 'Победить первого босса океана', en: 'Defeat your first ocean boss' }, t: function (p) { return C.worldKings(p, 'sea') >= 1; } },
    { id: 'sea5', ico: '🔱', n: { ru: 'Повелитель океана', en: 'Lord of the Ocean' }, d: { ru: 'Победить всех 5 боссов океана', en: 'Defeat all 5 ocean bosses' }, t: function (p) { return C.worldKings(p, 'sea') >= 5; } },
    { id: 'king3', ico: '🏰', n: { ru: 'Три королевства', en: 'Three realms' }, d: { ru: 'Стать королём 3 биомов', en: 'Become king of 3 biomes' }, t: function (p) { return C.worldKings(p, 'land') >= 3; } },
    { id: 'lord', ico: '🌟', n: { ru: 'Владыка эпох', en: 'Lord of the Ages' }, d: { ru: 'Стать королём всех 6 биомов суши', en: 'Become king of all 6 land biomes' }, t: function (p) { return C.worldKings(p, 'land') >= 6; } },
    { id: 'duel1', ico: '⚔', n: { ru: 'Дуэлянт', en: 'Duelist' }, d: { ru: 'Выиграть дуэль у живого игрока', en: 'Win a duel against a human' }, t: function (p) { return p.wins >= 1; } },
    { id: 'duel10', ico: '🏆', n: { ru: 'Чемпион арены', en: 'Arena champion' }, d: { ru: '10 побед в дуэлях', en: '10 duel wins' }, t: function (p) { return p.wins >= 10; } },
    { id: 'tourney', ico: '🥇', n: { ru: 'Победитель турнира', en: 'Tournament winner' }, d: { ru: 'Выиграть турнир дуэлей', en: 'Win a duel tournament' }, t: function (p) { return p.stats.tourney >= 1; } },
    { id: 'rush5', ico: '🔥', n: { ru: 'Босс-раш', en: 'Boss rush' }, d: { ru: 'Дойти до 5 волны босс-раша', en: 'Reach wave 5 of the boss rush' }, t: function (p) { return p.stats.rush >= 5; } },
    { id: 'rich', ico: '🪙', n: { ru: 'Копилка', en: 'Piggy bank' }, d: { ru: 'Накопить 1000 монет', en: 'Hold 1000 coins' }, t: function (p) { return p.coins >= 1000 || (p.stats.coinsEarned || 0) >= 1000; } },
    { id: 'tough', ico: '💀', n: { ru: 'Не сдаваться', en: 'Never give up' }, d: { ru: 'Погибнуть 10 раз и продолжить', en: 'Die 10 times and keep going' }, t: function (p) { return p.stats.deaths >= 10; } }
  ];

  // ---------- описания типов и способностей (одни и те же для меню, паузы и панели способностей) ----------
  C.ABIL_INFO = {
    atk:     { ico: '🦷', n: { ru: 'Атака', en: 'Attack' }, d: { ru: 'Обычный удар по цели впереди. Три удара подряд без промаха — «ярость»: следующий удар ×2. Добивание цели с малым здоровьем бьёт на 50 % сильнее.', en: 'A basic hit on the target ahead. Three hits in a row trigger rage: the next hit is ×2. Finishing a weak target hits 50% harder.' } },
    pounce:  { ico: '⚡', n: { ru: 'Рывок', en: 'Pounce' }, d: { ru: 'Прыжок вперёд на ~8 м и мощный удар ×1.6 по первой цели на пути. Перезарядка {cd} с.', en: 'Leap ~8 m forward and strike the first target for ×1.6 damage. Cooldown {cd}s.' } },
    roar:    { ico: '📣', n: { ru: 'Рёв', en: 'Roar' }, d: { ru: 'Враги вокруг (до 14 м) пугаются, убегают и замедляются на 3.5 с. Перезарядка {cd} с.', en: 'Enemies within 14 m panic, flee and are slowed for 3.5s. Cooldown {cd}s.' } },
    guard:   { ico: '🛡', n: { ru: 'Щит', en: 'Guard' }, d: { ru: 'Стойка: входящий урон −50 %, но двигаться нельзя. Включается и выключается нажатием.', en: 'Stance: incoming damage −50%, but you cannot move. Toggle on and off.' } },
    herd:    { ico: '🦶', n: { ru: 'Топот', en: 'Stomp' }, d: { ru: 'Удар по земле: урон и оглушение всем вокруг (8 м), врагов отбрасывает. Перезарядка {cd} с.', en: 'Ground slam: damage and stun to everything around (8 m), knocks enemies back. Cooldown {cd}s.' } },
    screech: { ico: '📢', n: { ru: 'Крик', en: 'Screech' }, d: { ru: 'Оглушает и ранит врагов в радиусе 10 м. Перезарядка {cd} с.', en: 'Stuns and hurts enemies within 10 m. Cooldown {cd}s.' } },
    dive:    { ico: '🦅', n: { ru: 'Пике', en: 'Dive' }, d: { ru: 'Бросок вниз с высоты: чем выше, тем сильнее удар. Работает только в полёте. Перезарядка {cd} с.', en: 'Plunge from height: the higher you are, the harder the hit. Only while flying. Cooldown {cd}s.' } },
    sonic:   { ico: '🔊', n: { ru: 'Звук', en: 'Sonic' }, d: { ru: 'Звуковой удар: оглушает и ранит врагов вокруг (10 м). Перезарядка {cd} с.', en: 'Sonic blast: stuns and hurts enemies around (10 m). Cooldown {cd}s.' } },
    torpedo: { ico: '🚀', n: { ru: 'Торпеда', en: 'Torpedo' }, d: { ru: 'Быстрый бросок: в воде 14 м (на суше только 5 м), удар ×1.4 и короткое оглушение. Перезарядка {cd} с.', en: 'Fast charge: 14 m in water (only 5 m on land), ×1.4 hit and a short stun. Cooldown {cd}s.' } },
    climb:   { ico: '🌲', n: { ru: 'Лазание', en: 'Climb' }, d: { ru: 'F у дерева — залезть на него и осмотреться сверху (открывается эволюцией «Лазание»).', en: 'F near a tree — climb it and look around (unlocked by the Climb evolution).' } },
    fly:     { ico: '🪽', n: { ru: 'Взлёт', en: 'Fly' }, d: { ru: 'F — взлететь или приземлиться. В полёте тратится выносливость; наземные хищники до летающего не достают.', en: 'F — take off or land. Flying drains stamina; ground predators cannot reach a flyer.' } }
  };
  C.CLS_INFO = {
    carn:  { ico: '🦖', atkIco: '🦷', n: { ru: 'Хищный', en: 'Carnivore' }, atkN: { ru: 'Укус', en: 'Bite' }, d: { ru: 'Быстрый охотник: высокий урон и ярость после серии ударов. Быстро голодает, ест мясо.', en: 'Fast hunter: high damage and rage after a streak of hits. Gets hungry quickly, eats meat.' } },
    herb:  { ico: '🦕', atkIco: '🐗', n: { ru: 'Травоядный', en: 'Herbivore' }, atkN: { ru: 'Удар', en: 'Bash' }, d: { ru: 'Самый живучий: много здоровья, щит и топот. Ест растения, лазает по деревьям.', en: 'The sturdiest: lots of health, guard and stomp. Eats plants, climbs trees.' } },
    fly:   { ico: '🦅', atkIco: '🪶', n: { ru: 'Летающий', en: 'Flyer' }, atkN: { ru: 'Когти', en: 'Talons' }, d: { ru: 'Хрупкий, но быстрый и в небе: наземные хищники до него не достают. Бьёт сверху сильнее.', en: 'Fragile but fast and airborne: ground predators cannot reach it. Hits harder from above.' } },
    mosa:  { ico: '🐊', atkIco: '🦈', n: { ru: 'Мозазавр', en: 'Mosasaur' }, atkN: { ru: 'Укус', en: 'Bite' }, d: { ru: 'Универсальный хищник океана: быстрый, сильный укус, торпеда и рёв.', en: 'All-round ocean predator: fast, strong bite, torpedo and roar.' } },
    plio:  { ico: '🐋', atkIco: '🦷', n: { ru: 'Плиозавр', en: 'Pliosaur' }, atkN: { ru: 'Хватка', en: 'Grip' }, d: { ru: 'Танк океана: много здоровья и броня +12 %, но медленнее. Щит и звуковой удар.', en: 'Ocean tank: lots of health and +12% armor, but slower. Guard and sonic blast.' } },
    ichth: { ico: '🐬', atkIco: '🐟', n: { ru: 'Ихтиозавр', en: 'Ichthyosaur' }, atkN: { ru: 'Таран', en: 'Ram' }, d: { ru: 'Самый быстрый и увёртливый (уворот 8 %), частые удары, но мало здоровья. Ест рыбу.', en: 'Fastest and slipperiest (8% dodge), rapid strikes, but low health. Eats fish.' } }
  };
  C.DIET_N = { plant: { ru: 'растения', en: 'plants' }, meat: { ru: 'мясо', en: 'meat' }, smeat: { ru: 'мелкую добычу', en: 'small prey' }, fish: { ru: 'рыбу', en: 'fish' }, bug: { ru: 'насекомых', en: 'insects' } };

  // ---------- вспомогательные функции ----------
  // два мира: суша и океан. worldOf — к какому миру относится биом; worldList — его локации по порядку
  C.WORLDS = { land: C.BIOMES, sea: C.OCEANS };
  C.ALL_BIOMES = C.BIOMES.concat(C.OCEANS);
  C.isAqua = function (cls) { var c = C.CLASSES[cls]; return !!(c && c.aqua); };
  C.clsWorld = function (cls) { return C.isAqua(cls) ? 'sea' : 'land'; };
  C.lvFactor = function (att, def) {
    var d = att - def;
    return d >= 0 ? Math.min(2.2, 1 + C.LEVEL_DIFF_UP * d) : Math.max(0.1, 1 / (1 + C.LEVEL_DIFF_DOWN * -d));
  };
  C.worldOf = function (b) { return C.OCEANS.indexOf(b) >= 0 ? 'sea' : 'land'; };
  C.worldList = function (w) { return C.WORLDS[w] || C.BIOMES; };
  C.worldKings = function (p, w) { var l = C.worldList(w), n = 0, k = (p && p.kings) || []; for (var i = 0; i < k.length; i++) if (l.indexOf(k[i]) >= 0) n++; return n; };
  // Освоение мира (не по уровням!): 50% — побеждённые боссы, 50% — «бестиарий»: сколько видов существ этого мира игрок победил
  var _sp = {};
  C.worldSpecies = function (w) {
    if (_sp[w]) return _sp[w];
    var out = [], l = C.worldList(w);
    for (var i = 0; i < l.length; i++) { var t = C.BIOME[l[i]].spawn; for (var id in t) if (C.ENEMIES[id] && C.ENEMIES[id].role !== 'bug' && out.indexOf(id) < 0) out.push(id); }
    return (_sp[w] = out);
  };
  C.worldSeen = function (p, w) { var sp = C.worldSpecies(w), seen = (p && p.seen) || [], n = 0; for (var i = 0; i < sp.length; i++) if (seen.indexOf(sp[i]) >= 0) n++; return n; };
  C.worldProgress = function (p, w) {
    var bk = C.worldKings(p, w) / C.worldList(w).length, sp = C.worldSpecies(w).length || 1;
    return Math.round((bk * 0.5 + C.worldSeen(p, w) / sp * 0.5) * 100);
  };
  C.xpForLevel = function (l) { return Math.round(C.XP_BASE * Math.pow(l, C.XP_EXP)); };
  C.cumXp = function (level) { var s = 0; for (var l = 1; l < level; l++) s += C.xpForLevel(l); return s; };
  C.levelFromTotal = function (total) { var l = 1; while (l < C.MAX_LEVEL && total >= C.cumXp(l + 1)) l++; return l; };
  C.stageIndex = function (level) { var idx = 0; for (var i = 0; i < C.STAGES.length; i++) if (level >= C.STAGES[i].from) idx = i; return idx; };
  // ======================================================================== ДЕРЕВЬЯ ЭВОЛЮЦИИ
  // Каждое дерево — двоичное: на 1-й ступени выбор из двух (L / R), у выбранного — своя развилка из двух (LL / LR) и т.д., 3 уровня.
  // Варианты одной развилки равны по силе. Узел качается до 3 ступеней; следующая развилка открывается, когда узел прокачан полностью.
  // Выбор в развилке можно поменять в любой момент бесплатно: очки переходят на соседний узел, нижние ветки сбрасываются (очки возвращаются).
  // fx — эффект за одну ступень. Ключи эффектов описаны в C.FX.
  C.FX = {
    hp:       { ru: 'Здоровье +{v}%', en: 'Health +{v}%' },
    regen:    { ru: 'Восстановление +{v} HP/с', en: 'Regeneration +{v} HP/s' },
    armor:    { ru: 'Броня +{v}%', en: 'Armor +{v}%' },
    resist:   { ru: 'Стойкость к яду, холоду и жару +{v}%', en: 'Poison/cold/heat resistance +{v}%' },
    leech:    { ru: 'Вампиризм: {v}% урона лечит', en: 'Lifesteal {v}% of damage' },
    thorns:   { ru: 'Шипы: возвращают {v}% урона', en: 'Thorns reflect {v}% of damage' },
    lastStand:{ ru: 'При HP ниже 35%: урон +{v}%', en: 'Below 35% HP: damage +{v}%' },
    foodSave: { ru: 'Голод медленнее на {v}%', en: 'Hunger {v}% slower' },
    stamina:  { ru: 'Выносливость восстанавливается на {v}% быстрее', en: 'Stamina regenerates {v}% faster' },
    dmg:      { ru: 'Урон +{v}%', en: 'Damage +{v}%' },
    crit:     { ru: 'Шанс крита +{v}%', en: 'Crit chance +{v}%' },
    critDmg:  { ru: 'Сила крита +{v}%', en: 'Crit damage +{v}%' },
    execute:  { ru: 'Урон по раненым (HP < 30%) +{v}%', en: 'Damage to wounded (HP < 30%) +{v}%' },
    bigDmg:   { ru: 'Урон по крупным и боссам +{v}%', en: 'Damage to big foes and bosses +{v}%' },
    venom:    { ru: 'Ядовитый укус: {v} урона/с 4 с', en: 'Venom bite: {v} dmg/s for 4 s' },
    bleed:    { ru: 'Кровотечение: {v} урона/с 4 с', en: 'Bleeding: {v} dmg/s for 4 s' },
    stunHit:  { ru: 'Шанс оглушить ударом {v}%', en: '{v}% chance to stun on hit' },
    speed:    { ru: 'Скорость +{v}%', en: 'Speed +{v}%' },
    sense:    { ru: 'Чутьё: видишь врагов за {v} м', en: 'Senses: spot enemies within {v} m' },
    stealth:  { ru: 'Враги замечают на {v}% позже', en: 'Enemies notice you {v}% later' },
    dodge:    { ru: 'Шанс увернуться {v}%', en: '{v}% dodge chance' },
    firstStrike: { ru: 'Удар по тому, кто тебя не заметил: +{v}%', en: 'Hit on unaware foes: +{v}%' },
    nightDmg: { ru: 'Урон ночью +{v}%', en: 'Damage at night +{v}%' },
    xp:       { ru: 'Опыт +{v}%', en: 'XP +{v}%' },
    coins:    { ru: 'Монеты +{v}%', en: 'Coins +{v}%' },
    // способности классов (значение — ступени способности)
    pounce:   { ru: 'Охотничий рывок: дальше и чаще (+{v})', en: 'Hunting dash: farther, more often (+{v})' },
    ambush:   { ru: 'Засада в траве: скрытность и удар (+{v})', en: 'Grass ambush: stealth and strike (+{v})' },
    roar:     { ru: 'Рёв: шире и дольше пугает (+{v})', en: 'Roar: wider, longer fear (+{v})' },
    mass:     { ru: 'Масса: HP +10%, таран сильнее (+{v})', en: 'Mass: HP +10%, stronger ram (+{v})' },
    herd:     { ru: 'Тяжёлый топот: урон, радиус, оглушение (+{v})', en: 'Heavy stomp: damage, radius, stun (+{v})' },
    climb:    { ru: 'Лазание по деревьям (F), лечение наверху (+{v})', en: 'Tree climbing (F), heal up there (+{v})' },
    wings:    { ru: 'Полёт быстрее и дешевле; с 4 — парение бесплатно (+{v})', en: 'Faster, cheaper flight; free soaring from 4 (+{v})' },
    talons:   { ru: 'Когти: хватает мелкую добычу в пике (+{v})', en: 'Talons: grab small prey in a dive (+{v})' },
    altitude: { ru: 'Пикирование: урон за высоту (+{v})', en: 'Dive: damage per altitude (+{v})' },
    screech:  { ru: 'Крик: оглушает дольше и шире (+{v})', en: 'Screech: longer, wider stun (+{v})' },
    fins:     { ru: 'Плавники: скорость в воде +8% (+{v})', en: 'Fins: swim speed +8% (+{v})' },
    lungs:    { ru: 'Лёгкие: под водой на 25% дольше (+{v})', en: 'Lungs: 25% longer underwater (+{v})' },
    gills:    { ru: 'Дыхание на суше: штраф меньше (+{v})', en: 'Land breathing: smaller penalty (+{v})' },
    shock:    { ru: 'Электрический укус; с 3 — цепь, с 5 — оглушение (+{v})', en: 'Shock bite; chains from 3, stuns at 5 (+{v})' }
  };
  function N(ru, en, ico, fx) { return { n: { ru: ru, en: en }, ico: ico, fx: fx }; }
  C.TREES = {
    life: { cls: null, ico: '❤', n: { ru: 'Здоровье', en: 'Health' }, nodes: {
      L: N('Крепкое тело', 'Sturdy body', '💪', { hp: 6 }),                R: N('Быстрое заживление', 'Fast healing', '🩹', { regen: 0.7 }),
      LL: N('Толстая шкура', 'Thick hide', '🛡', { armor: 4 }),            LR: N('Запас жира', 'Fat reserves', '🍖', { hp: 4, foodSave: 8 }),
      RL: N('Пиявка', 'Leech', '🩸', { leech: 3 }),                        RR: N('Второе дыхание', 'Second wind', '🌬', { regen: 0.4, resist: 8 }),
      LLL: N('Костяная броня', 'Bone armor', '🦴', { armor: 5 }),          LLR: N('Шипы', 'Spikes', '🌵', { thorns: 8 }),
      LRL: N('Гигант', 'Giant', '⛰', { hp: 8 }),                           LRR: N('Неутомимый', 'Tireless', '🔋', { hp: 3, stamina: 12 }),
      RLL: N('Кровопийца', 'Bloodsucker', '🧛', { leech: 4 }),              RLR: N('Ярость выжившего', 'Survivor\'s rage', '🔥', { lastStand: 12 }),
      RRL: N('Иммунитет', 'Immunity', '🧪', { resist: 14, regen: 0.2 }),   RRR: N('Регенерация', 'Regeneration', '✨', { regen: 0.9 }) } },
    fight: { cls: null, ico: '⚔', n: { ru: 'Урон', en: 'Damage' }, nodes: {
      L: N('Сила челюстей', 'Jaw strength', '🦷', { dmg: 5 }),             R: N('Точность', 'Precision', '🎯', { crit: 5 }),
      LL: N('Ядовитый укус', 'Venom bite', '☠', { venom: 2 }),             LR: N('Рваные раны', 'Tearing wounds', '🩸', { bleed: 2 }),
      RL: N('Смертельный удар', 'Deadly blow', '💥', { critDmg: 15 }),     RR: N('Добивание', 'Finisher', '🗡', { execute: 12 }),
      LLL: N('Нейротоксин', 'Neurotoxin', '🧫', { venom: 3 }),             LLR: N('Яд-паралитик', 'Paralytic venom', '😵', { venom: 1, stunHit: 3 }),
      LRL: N('Глубокие раны', 'Deep wounds', '🔪', { bleed: 3 }),          LRR: N('Жажда крови', 'Bloodlust', '🩸', { bleed: 1, leech: 2 }),
      RLL: N('Убийца', 'Assassin', '🌑', { crit: 4, critDmg: 8 }),         RLR: N('Свирепость', 'Ferocity', '😤', { dmg: 6 }),
      RRL: N('Палач', 'Executioner', '⚰', { execute: 16 }),               RRR: N('Охотник на гигантов', 'Giant slayer', '🐘', { bigDmg: 12 }) } },
    wild: { cls: null, ico: '🍃', n: { ru: 'Выживание', en: 'Survival' }, nodes: {
      L: N('Быстрые лапы', 'Swift feet', '🐾', { speed: 4 }),              R: N('Выносливость', 'Endurance', '🔋', { stamina: 15 }),
      LL: N('Чутьё', 'Senses', '👁', { sense: 14 }),                       LR: N('Скрытность', 'Stealth', '🌿', { stealth: 10 }),
      RL: N('Экономный', 'Frugal', '🥩', { foodSave: 12 }),                 RR: N('Опыт выживания', 'Survivor\'s wisdom', '📖', { xp: 4 }),
      LLL: N('Ночное зрение', 'Night vision', '🌙', { sense: 10, crit: 2 }), LLR: N('Инстинкт', 'Instinct', '💨', { dodge: 4 }),
      LRL: N('Тень', 'Shadow', '🌫', { stealth: 12 }),                      LRR: N('Удар из тени', 'Strike from shadow', '🗡', { firstStrike: 15 }),
      RLL: N('Стальной желудок', 'Iron stomach', '🍀', { foodSave: 10, regen: 0.3 }), RLR: N('Стальные мышцы', 'Steel muscles', '🏃', { stamina: 12, speed: 2 }),
      RRL: N('Мудрость', 'Wisdom', '🦉', { xp: 6 }),                        RRR: N('Удача', 'Luck', '🪙', { coins: 12 }) } },
    hunt: { cls: 'carn', ico: '🦖', n: { ru: 'Охота', en: 'Hunt' }, nodes: {
      L: N('Охотничий рывок', 'Hunting dash', '⚡', { pounce: 1 }),         R: N('Засада', 'Ambush', '🌾', { ambush: 1 }),
      LL: N('Прыжок хищника', 'Predator leap', '🦘', { pounce: 1, dmg: 2 }), LR: N('Грозный рёв', 'Dread roar', '📣', { roar: 1 }),
      RL: N('Камуфляж', 'Camouflage', '🦎', { ambush: 1, stealth: 5 }),     RR: N('Ночной охотник', 'Night hunter', '🌙', { nightDmg: 9 }),
      LLL: N('Разрыв', 'Rend', '🩸', { bleed: 2 }),                         LLR: N('Таран', 'Ram', '💫', { stunHit: 4 }),
      LRL: N('Ужас', 'Terror', '😱', { roar: 1, speed: 2 }),               LRR: N('Вожак', 'Alpha', '👑', { dmg: 4 }),
      RLL: N('Призрак', 'Ghost', '👻', { stealth: 10 }),                    RLR: N('Удар из засады', 'Ambush strike', '🎯', { ambush: 1, crit: 2 }),
      RRL: N('Лунный клык', 'Moon fang', '🌕', { nightDmg: 10 }),           RRR: N('Тёмное зрение', 'Dark sight', '👁', { sense: 15 }) } },
    herd: { cls: 'herb', ico: '🦕', n: { ru: 'Стадо', en: 'Herd' }, nodes: {
      L: N('Масса', 'Mass', '⛰', { mass: 1 }),                             R: N('Лазание по деревьям', 'Tree climbing', '🌲', { climb: 1 }),
      LL: N('Тяжёлый топот', 'Heavy stomp', '🦶', { herd: 1 }),            LR: N('Шипастый хвост', 'Spiked tail', '🌵', { thorns: 6 }),
      RL: N('Отдых на дереве', 'Treetop rest', '🍃', { climb: 1, regen: 0.3 }), RR: N('Наблюдатель', 'Lookout', '👁', { sense: 15 }),
      LLL: N('Землетрясение', 'Earthquake', '🌋', { herd: 1, dmg: 2 }),     LLR: N('Несокрушимый', 'Unbreakable', '🛡', { armor: 4 }),
      LRL: N('Ёж', 'Hedgehog', '🦔', { thorns: 8 }),                        LRR: N('Бульдозер', 'Bulldozer', '🚜', { mass: 1, stunHit: 2 }),
      RLL: N('Древолаз', 'Tree dweller', '🐒', { climb: 1, hp: 3 }),        RLR: N('Бегун', 'Runner', '🏃', { speed: 4 }),
      RRL: N('Тревога', 'Alarm', '🔔', { sense: 10, dodge: 2 }),            RRR: N('Мудрое стадо', 'Wise herd', '🦉', { xp: 5 }) } },
    sky: { cls: 'fly', ico: '🦅', n: { ru: 'Небо', en: 'Sky' }, nodes: {
      L: N('Крылья', 'Wings', '🪽', { wings: 1 }),                          R: N('Когти', 'Talons', '🦅', { talons: 1 }),
      LL: N('Парение', 'Soaring', '☁', { wings: 1 }),                      LR: N('Высота', 'Altitude', '⛅', { altitude: 1 }),
      RL: N('Крик', 'Screech', '📣', { screech: 1 }),                       RR: N('Хватка', 'Grip', '✊', { talons: 1, dmg: 2 }),
      LLL: N('Попутный ветер', 'Tailwind', '💨', { speed: 4 }),             LLR: N('Буревестник', 'Storm bird', '⛈', { stamina: 15 }),
      LRL: N('Пике', 'Nosedive', '🎯', { altitude: 1, crit: 2 }),           LRR: N('Стрела', 'Arrow', '🏹', { dmg: 4 }),
      RLL: N('Оглушающий крик', 'Stunning screech', '😵', { screech: 1 }),  RLR: N('Паника', 'Panic', '😱', { stealth: 8 }),
      RRL: N('Рыболов', 'Fisher', '🐟', { talons: 1, leech: 2 }),           RRR: N('Хищная птица', 'Bird of prey', '🩸', { bleed: 2 }) } },
    deep: { cls: 'aqua', ico: '🌊', n: { ru: 'Глубины', en: 'Depths' }, nodes: {
      L: N('Плавники', 'Fins', '🐟', { fins: 1 }),                          R: N('Лёгкие', 'Lungs', '🫁', { lungs: 1 }),
      LL: N('Электрический укус', 'Shock bite', '⚡', { shock: 1 }),        LR: N('Торпеда', 'Torpedo', '🚀', { dmg: 3, speed: 2 }),
      RL: N('Дыхание на суше', 'Land breathing', '🌊', { gills: 1 }),       RR: N('Глубоководный', 'Deep diver', '🫧', { armor: 3, resist: 6 }),
      LLL: N('Цепная молния', 'Chain lightning', '🌩', { shock: 1 }),       LLR: N('Разряд', 'Discharge', '😵', { stunHit: 4 }),
      LRL: N('Акулья хватка', 'Shark grip', '🦈', { bleed: 2 }),            LRR: N('Стремительный', 'Swift', '💨', { fins: 1, speed: 2 }),
      RLL: N('Амфибия', 'Amphibian', '🐸', { gills: 1, hp: 3 }),            RLR: N('Ил', 'Silt', '🌫', { stealth: 8 }),
      RRL: N('Давление', 'Pressure', '⛰', { hp: 5 }),                      RRR: N('Хладнокровие', 'Cold blood', '🧊', { regen: 0.5 }) } }
  };
  C.TREE_ORDER = ['life', 'fight', 'wild', 'hunt', 'herd', 'sky', 'deep'];
  C.treesFor = function (cls) { return C.TREE_ORDER.filter(function (t) { return C.treeFits(C.TREES[t], cls); }); };
  C.treeFits = function (t, cls) { return t.cls === null || t.cls === cls || (t.cls === 'aqua' && C.isAqua(cls)); };
  C.evoNode = function (id) { var p = String(id).split(':'), t = C.TREES[p[0]]; return t && p[1] && t.nodes[p[1]] ? { tree: p[0], path: p[1], node: t.nodes[p[1]], t: t } : null; };
  C.evoSpent = function (evo) { var s = 0; for (var k in evo) if (C.evoNode(k)) s += Math.max(0, Math.min(C.EVO_MAX, evo[k] | 0)); return s; };
  C.evoPoints = function (level, evo) { return (level - 1) - C.evoSpent(evo || {}); };
  C.sibling = function (id) { var n = C.evoNode(id); if (!n) return null; var p = n.path, last = p[p.length - 1]; return n.tree + ':' + p.slice(0, -1) + (last === 'L' ? 'R' : 'L'); };
  // можно ли купить ступень узла: ok | locked | max | level | parent | taken (выбран соседний — сначала переключить) | points
  C.evoCanBuy = function (cls, level, evo, id) {
    var n = C.evoNode(id); evo = evo || {};
    if (!n || !C.treeFits(n.t, cls)) return 'locked';
    var r = evo[id] | 0; if (r >= C.EVO_MAX) return 'max';
    if (level < C.EVO_TIER_LV[n.path.length - 1]) return 'level';
    if (n.path.length > 1 && (evo[n.tree + ':' + n.path.slice(0, -1)] | 0) < C.EVO_MAX) return 'parent';
    if ((evo[C.sibling(id)] | 0) > 0) return 'taken';
    if (C.evoPoints(level, evo) < 1) return 'points';
    return 'ok';
  };
  // переключить развилку на этот узел: ступени соседа переходят сюда, его нижние ветки сбрасываются. Возвращает новый evo или null
  C.evoSwitch = function (cls, level, evo, id) {
    var n = C.evoNode(id); if (!n || !C.treeFits(n.t, cls)) return null;
    var sib = C.sibling(id), r = evo[sib] | 0; if (r <= 0) return null;
    if (level < C.EVO_TIER_LV[n.path.length - 1]) return null;
    var out = {}, sp = sib.split(':')[1];
    for (var k in evo) { var m = C.evoNode(k); if (!m || evo[k] <= 0) continue; if (m.tree === n.tree && m.path.indexOf(sp) === 0) continue; out[k] = evo[k] | 0; }
    out[id] = r; return out;
  };
  // суммарные эффекты выбранных узлов: { ключ: значение } + ступени способностей (для старых механик и внешнего вида)
  var CLASS_FX = ['pounce', 'ambush', 'roar', 'mass', 'herd', 'climb', 'wings', 'talons', 'altitude', 'screech', 'fins', 'lungs', 'gills', 'shock'];
  C.evoTotals = function (cls, evo) {
    var tot = {}, k, f;
    for (k in evo || {}) {
      var n = C.evoNode(k), r = Math.max(0, Math.min(C.EVO_MAX, evo[k] | 0)); if (!n || !r || !C.treeFits(n.t, cls)) continue;
      for (f in n.node.fx) tot[f] = (tot[f] || 0) + n.node.fx[f] * r;
    }
    for (var i = 0; i < CLASS_FX.length; i++) if (tot[CLASS_FX[i]]) tot[CLASS_FX[i]] = Math.min(5, tot[CLASS_FX[i]]);
    return tot;
  };
  // «ступени» в старом формате — для внешнего вида модели (шипы, чешуя, светящиеся глаза…)
  C.evoLook = function (cls, evo) {
    var t = C.evoTotals(cls, evo), lv = function (v, per) { return Math.min(5, Math.round((v || 0) / per)); };
    var o = { hide: lv(t.armor, 4), sense: lv(t.sense, 10), vit: lv(t.hp, 8), fangs: lv(t.dmg + (t.venom || 0) * 2, 6), claws: lv(t.bleed, 2), spikes: lv(t.thorns, 6) };
    for (var i = 0; i < CLASS_FX.length; i++) o[CLASS_FX[i]] = t[CLASS_FX[i]] | 0;
    return o;
  };
  // старый формат эволюции (ключи без «:») больше не действует — очки возвращаются
  C.evoClean = function (evo) { var o = {}; for (var k in evo || {}) if (C.evoNode(k) && (evo[k] | 0) > 0) o[k] = Math.min(C.EVO_MAX, evo[k] | 0); return o; };
  return C;
});

/* Тексты интерфейса RU/EN. window.T(key, vars) — перевод с подстановкой {x}. */
(function () {
  var D = {
    ru: {
      loading: 'Загрузка…', tagline: 'Вылупись. Расти. Стань владыкой эпох.', play_online: 'Играть онлайн', single: 'Одиночная игра (без сети)',
      friends: 'Комната по коду', leaderboard: 'Таблица лидеров', evolution: 'Эволюция', achievements: 'Достижения', settings: 'Настройки',
      account: 'Аккаунт', nick: 'Ник (3–14 символов)', password: 'Пароль (от 6 символов)', login: 'Войти', register: 'Регистрация', back: 'Назад',
      guest: 'Гость', signin: 'Войти / создать аккаунт', signout: 'Выйти', offline_note: 'Сервер недоступен — доступна одиночная игра.',
      create_title: 'Твой динозавр', dino_name: 'Имя (3–15 символов)', skin: 'Цвет шкуры', class: 'Класс (на этом прохождении менять нельзя)', hatch: 'Вылупить!',
      cls_carn: 'Хищный', cls_herb: 'Травоядный', cls_fly: 'Летающий', cls_aqua: 'Морской',
      cls_carn_d: 'Быстрый и опасный. E — рывок, Q — рёв. Три удара подряд — ярость ×2.', cls_herb_d: 'Крепкий. E — стойка щита, Q — стадо союзников, таран в беге, F — лазание по деревьям.',
      cls_fly_d: 'Хрупкий, но в небе. F — взлёт/посадка, Q — пикирование, E — крик. Бьёт сверху сильнее.', cls_aqua_d: 'Король воды. Свободно плавает, Q — торпеда, E — звуковой удар. На суше слабее.',
      settings_lang: 'Язык', quality: 'Качество графики', q_auto: 'Авто', q_high: 'Высокое', q_med: 'Среднее', q_low: 'Низкое', sens: 'Чувствительность камеры', volume: 'Громкость звука', music: 'Музыка',
      new_run: 'Новое прохождение', logout: 'Выйти из аккаунта', new_run_q: 'Начать заново? Уровень, эволюция и класс сбросятся. Монеты, победы и короны сохранятся.',
      stamina: 'Выносливость', hunger: 'Сытость', breath: 'Воздух', menu: '☰', hint_pc: 'WASD — ход · мышь — камера · ЛКМ — атака · Shift — бег · Пробел — прыжок · E / Q / F — способности · V — эволюция · 1–4 — эмоции',
      b_sprint: 'Бег', b_jump: 'Прыжок', b_up: 'Вверх', b_atk: 'Атака', b_down: 'Вниз',
      level_short: 'Ур.', coins: 'Монеты',
      play_title: 'Куда отправимся?', biome_locked: 'Закрыто: победи босса предыдущего биома', public_room: 'Публичная комната', code_room: 'Комната по коду: свой случайный код (отправьте друзьям) или код друга', new_room: 'Другой случайный код', code_ph: 'ABCDE',
      join_code: 'Войти / создать', locations_btn: 'Локации', loc_here: 'Вы здесь', loc_go: 'Перейти', loc_note: 'Можно вернуться в любую уже открытую локацию своего мира. Прогресс сохраняется.', world_land: 'Суша', dodge: 'Уворот!', too_strong: 'Слишком силён!', depth_m: 'глубина {n} м', map_legend: '🥚 гнездо · 💀 арена босса · 🌀 портал к боссу · ✨ портал дальше · 🔴 хищники · 🟡 стадо · 🟢 добыча · 💗 ромб — друг — нажми, чтобы закрыть', evo_hint: 'Нажми на узел. На каждой развилке — выбор из двух равных путей; выбор можно поменять в любой момент бесплатно.', evo_up: 'Прокачать: ступень {r} из {m} (1 очко)', evo_switch: 'Выбрать этот путь вместо «{n}»', evo_need_parent: 'Сначала прокачай узел выше до конца', evo_rank: 'ступень {r}/{m}', evo_now: 'Сейчас', evo_per_rank: 'За ступень', evo_vs: 'другой путь: «{n}»', evo_reset_free: 'Сбросить всё (бесплатно)', world_sea: 'Океан', world_done: 'Пройдено {n} из {m}', sea_only: 'Только для морского динозавра', hz_vent: 'Жар курильщика!', boss_rush: 'Босс-раш (для Владык эпох)', king_mark: 'Король', req_boss: 'Босс с {n} ур.',
      connecting: 'Подключение…', conn_lost: 'Соединение потеряно', replaced: 'Вы вошли с другого устройства', unauthorized: 'Нужно войти в аккаунт', no_character: 'Сначала вылупите динозавра',
      need_login_online: 'Для онлайна нужен аккаунт', room_full: 'Комната заполнена', bad_code: 'Введите от 5 до 8 английских букв', locked: 'Биом ещё закрыт', server_off: 'Сервер недоступен',
      evo_title: 'Эволюция', evo_points: 'Очков: {n}', evo_reset: 'Сброс очков ({c} монет)', evo_tier: 'ступень {r} из 5', evo_buy: 'Развить ({c})', evo_max: 'Максимум', evo_need_lv: 'С {l} ур.', evo_branch_common: 'Общие', evo_branch_class: 'Ветки класса',
      ach_title: 'Достижения', lb_title: 'Таблица лидеров', lb_wins: 'Победы в дуэлях', lb_kings: 'Короли биомов', lb_empty: 'Пока никого', lb_place: 'Место', lb_name: 'Игрок', lb_wins_n: 'Побед', lb_kings_n: 'Биомов', lord: 'Владыка эпох',
      shop: 'Магазин', owned: 'Куплено', equip: 'Надеть', unequip: 'Снять', buy: 'Купить',
      respawn_in: 'Возрождение через {n} с', you_died: 'Ты погиб', killed_by: 'Тебя победил: {x}',
      shield: 'Щит', boss_start: 'Бой с боссом!', boss_dead: 'Босс повержен!', boss_phase: 'Фаза {n}', king_new: 'Ты — король биома «{b}»!', lord_new: 'Ты — Владыка эпох!',
      portal_boss: 'Портал к боссу — с {n} ур.', portal_next: 'Портал в следующий биом открыт', portal_hint: 'Войди в портал', boss_cool: 'Босс восстанавливается: {n} с',
      duel: 'Дуэль', duel_to: 'Вызвать на дуэль', duel_req: '{x} вызывает тебя на дуэль!', accept: 'Принять', decline: 'Отказать', duel_wait: 'Вызов отправлен', duel_declined: 'Вызов отклонён', duel_start: 'Дуэль начинается!',
      duel_bad: 'Нельзя вызвать этого игрока', duel_busy: 'Игрок занят', duel_win: 'Победа!', duel_lose: 'Поражение', duel_draw: 'Ничья', duel_go: 'В бой!', duel_vs: 'против {x}',
      tourney: 'Турнир на 4', tourney_join: 'Встать в очередь турнира', tourney_cancel: 'Выйти из очереди', tourney_wait: 'Очередь турнира: {n}/4', tourney_start: 'Турнир начался!', champ: 'Победитель турнира: {x}',
      rush_wave: 'Босс-раш — волна {n}', rush_end: 'Босс-раш окончен: волн {n}', rush_clear: 'Волна пройдена! +{c} монет',
      guard_on: '🛡 Режим щита — E, чтобы выйти', cooldown: 'Способность перезаряжается', need_fly: 'Сначала взлети (F)', no_tree: 'Рядом нет дерева', boss_level: 'Нужен {n} уровень',
      evo_level: 'Не хватает уровня', evo_points_err: 'Не хватает очков', evo_max_err: 'Уже максимум', evo_locked: 'Недоступно', coins_err: 'Не хватает монет',
      hz_cold: 'Метель! Держи сытость выше 60% (холод вдвое слабее), залезь на дерево (F, травоядные) или прокачай стойкость в Эволюции. Метель проходит сама', hz_heat: 'Жара!', hz_poison: 'Ядовитая топь!', hz_lava: 'Лава жжёт!', hz_rockfall: 'Камнепад!',
      lv_up: 'Новый уровень: {n}', eat: 'Вкусно!', evo_done: 'Эволюция!',
      resume: 'Продолжить', to_menu: 'В главное меню', players: 'Игроки в комнате', no_players: 'Пока ты один', room: 'Комната', mode_solo: 'Одиночная', mode_code: 'Код {c}',
      about_hunger: 'Голод: ешь еду вокруг — {d}', diet_plant: 'растения', diet_meat: 'мясо', diet_smeat: 'мелкую добычу', diet_fish: 'рыбу', diet_bug: 'насекомых',
      sound_on: 'Звук включён', stats_kills: 'Побед над врагами', copy_code: 'Код комнаты', day: 'День', night: 'Ночь', ok: 'Ок', cancel: 'Отмена', close: 'Закрыть',
      sync_fail: 'Не удалось сохранить', offline_progress: 'Офлайн-прогресс хранится на этом устройстве', mobile_hint: 'Левый стик — ход, свайп справа — камера',
      emote0: '👋', emote1: '😄', emote2: '😡', emote3: '❤', tab_biomes: 'Биомы', unlock_next: 'Победи босса, чтобы открыть следующий биом', stage_baby: 'Детёныш', stage_young: 'Подросток', stage_adult: 'Взрослый', stage_ancient: 'Древний',
      hatch_tap: 'Нажми на яйцо!', hatching: 'Вылупляется…', hatched: 'Ты вылупился!', hatch_skip: 'Клик или пробел — пропустить', change_name: 'Имя', your_class: 'Класс'
    },
    en: {
      loading: 'Loading…', tagline: 'Hatch. Grow. Become Lord of the Ages.', play_online: 'Play online', single: 'Single player (offline)',
      friends: 'Room by code', leaderboard: 'Leaderboard', evolution: 'Evolution', achievements: 'Achievements', settings: 'Settings',
      account: 'Account', nick: 'Nickname (3–14 chars)', password: 'Password (6+ chars)', login: 'Log in', register: 'Sign up', back: 'Back',
      guest: 'Guest', signin: 'Log in / sign up', signout: 'Log out', offline_note: 'Server unreachable — single player is available.',
      create_title: 'Your dinosaur', dino_name: 'Name (3–15 chars)', skin: 'Skin colour', class: 'Class (locked for this run)', hatch: 'Hatch!',
      cls_carn: 'Carnivore', cls_herb: 'Herbivore', cls_fly: 'Flyer', cls_aqua: 'Marine',
      cls_carn_d: 'Fast and deadly. E — pounce, Q — roar. Three hits in a row trigger rage ×2.', cls_herb_d: 'Sturdy. E — guard stance, Q — heavy stomp, ram while sprinting, F — climb trees.',
      cls_fly_d: 'Fragile but airborne. F — take off/land, Q — dive, E — screech. Hits harder from above.', cls_aqua_d: 'Lord of water. Swims freely, Q — torpedo, E — sonic blast. Weaker on land.',
      settings_lang: 'Language', quality: 'Graphics quality', q_auto: 'Auto', q_high: 'High', q_med: 'Medium', q_low: 'Low', sens: 'Camera sensitivity', volume: 'Sound volume', music: 'Music',
      new_run: 'New run', logout: 'Log out', new_run_q: 'Start over? Level, evolution and class reset. Coins, wins and crowns stay.',
      stamina: 'Stamina', hunger: 'Hunger', breath: 'Air', menu: '☰', hint_pc: 'WASD — move · mouse — camera · LMB — attack · Shift — sprint · Space — jump · E / Q / F — abilities · V — evolution · 1–4 — emotes',
      b_sprint: 'Sprint', b_jump: 'Jump', b_up: 'Up', b_atk: 'Attack', b_down: 'Down',
      level_short: 'Lv.', coins: 'Coins',
      play_title: 'Where to?', biome_locked: 'Locked: defeat the previous biome boss', public_room: 'Public room', code_room: 'Room by code: your random code (send it to friends) or a friend\'s code', new_room: 'Another random code', code_ph: 'ABCDE',
      join_code: 'Join / create', locations_btn: 'Locations', loc_here: 'You are here', loc_go: 'Go', loc_note: 'You can return to any location you have already unlocked in your world. Progress is kept.', world_land: 'Land', dodge: 'Dodge!', too_strong: 'Too strong!', depth_m: 'depth {n} m', map_legend: '🥚 nest · 💀 boss arena · 🌀 boss portal · ✨ next portal · 🔴 predators · 🟡 herd · 🟢 prey · 💗 diamond — friend — tap to close', evo_hint: 'Tap a node. Each fork is a choice between two equal paths; you can switch at any time for free.', evo_up: 'Upgrade: rank {r} of {m} (1 point)', evo_switch: 'Take this path instead of “{n}”', evo_need_parent: 'Max out the node above first', evo_rank: 'rank {r}/{m}', evo_now: 'Now', evo_per_rank: 'Per rank', evo_vs: 'other path: “{n}”', evo_reset_free: 'Reset all (free)', world_sea: 'Ocean', world_done: '{n} of {m} cleared', sea_only: 'Sea dinosaurs only', hz_vent: 'Vent heat!', boss_rush: 'Boss rush (Lords of the Ages)', king_mark: 'King', req_boss: 'Boss from lv. {n}',
      connecting: 'Connecting…', conn_lost: 'Connection lost', replaced: 'Signed in from another device', unauthorized: 'Please log in', no_character: 'Hatch a dinosaur first',
      need_login_online: 'An account is required to play online', room_full: 'Room is full', bad_code: 'Enter 5–8 English letters', locked: 'Biome is locked', server_off: 'Server unreachable',
      evo_title: 'Evolution', evo_points: 'Points: {n}', evo_reset: 'Reset points ({c} coins)', evo_tier: 'tier {r} of 5', evo_buy: 'Evolve ({c})', evo_max: 'Maxed', evo_need_lv: 'From lv. {l}', evo_branch_common: 'Common', evo_branch_class: 'Class branches',
      ach_title: 'Achievements', lb_title: 'Leaderboard', lb_wins: 'Duel wins', lb_kings: 'Biome kings', lb_empty: 'Nobody yet', lb_place: '#', lb_name: 'Player', lb_wins_n: 'Wins', lb_kings_n: 'Biomes', lord: 'Lord of the Ages',
      shop: 'Shop', owned: 'Owned', equip: 'Equip', unequip: 'Unequip', buy: 'Buy',
      respawn_in: 'Respawn in {n} s', you_died: 'You died', killed_by: 'Defeated by: {x}',
      shield: 'Shield', boss_start: 'Boss fight!', boss_dead: 'Boss defeated!', boss_phase: 'Phase {n}', king_new: 'You are the king of {b}!', lord_new: 'You are the Lord of the Ages!',
      portal_boss: 'Boss portal — from lv. {n}', portal_next: 'Portal to the next biome is open', portal_hint: 'Step into the portal', boss_cool: 'Boss is recovering: {n} s',
      duel: 'Duel', duel_to: 'Challenge to a duel', duel_req: '{x} challenges you to a duel!', accept: 'Accept', decline: 'Decline', duel_wait: 'Challenge sent', duel_declined: 'Challenge declined', duel_start: 'The duel begins!',
      duel_bad: 'Cannot challenge this player', duel_busy: 'Player is busy', duel_win: 'Victory!', duel_lose: 'Defeat', duel_draw: 'Draw', duel_go: 'Fight!', duel_vs: 'vs {x}',
      tourney: '4-player tournament', tourney_join: 'Join tournament queue', tourney_cancel: 'Leave queue', tourney_wait: 'Tournament queue: {n}/4', tourney_start: 'Tournament started!', champ: 'Tournament winner: {x}',
      rush_wave: 'Boss rush — wave {n}', rush_end: 'Boss rush over: {n} waves', rush_clear: 'Wave cleared! +{c} coins',
      guard_on: '🛡 Guard mode — press E to exit', cooldown: 'Ability on cooldown', need_fly: 'Take off first (F)', no_tree: 'No tree nearby', boss_level: 'Level {n} required',
      evo_level: 'Level too low', evo_points_err: 'Not enough points', evo_max_err: 'Already maxed', evo_locked: 'Unavailable', coins_err: 'Not enough coins',
      hz_cold: 'Blizzard! Keep hunger above 60% (half the cold damage), climb a tree (F, herbivores) or evolve resistance. It passes on its own', hz_heat: 'Scorching heat!', hz_poison: 'Toxic bog!', hz_lava: 'Lava burns!', hz_rockfall: 'Rockfall!',
      lv_up: 'Level up: {n}', eat: 'Yum!', evo_done: 'Evolved!',
      resume: 'Resume', to_menu: 'Main menu', players: 'Players in room', no_players: 'You are alone', room: 'Room', mode_solo: 'Solo', mode_code: 'Code {c}',
      about_hunger: 'Hunger: eat food around you — {d}', diet_plant: 'plants', diet_meat: 'meat', diet_smeat: 'small prey', diet_fish: 'fish', diet_bug: 'insects',
      sound_on: 'Sound on', stats_kills: 'Enemies defeated', copy_code: 'Room code', day: 'Day', night: 'Night', ok: 'OK', cancel: 'Cancel', close: 'Close',
      sync_fail: 'Could not save', offline_progress: 'Offline progress is stored on this device', mobile_hint: 'Left stick — move, swipe right — camera',
      emote0: '👋', emote1: '😄', emote2: '😡', emote3: '❤', tab_biomes: 'Biomes', unlock_next: 'Defeat the boss to unlock the next biome', stage_baby: 'Hatchling', stage_young: 'Juvenile', stage_adult: 'Adult', stage_ancient: 'Ancient',
      hatch_tap: 'Tap the egg!', hatching: 'Hatching…', hatched: 'You hatched!', hatch_skip: 'Click or Space to skip', change_name: 'Name', your_class: 'Class'
    }
  };

  Object.assign(D.ru, {
    tab_color: 'Цвет', tab_outfit: 'Наряды', tab_fx: 'Эффекты', tab_egg: 'Яйцо', tab_nest: 'Гнездо', tab_craft: 'Мастерская', shop_color: 'Цвет динозавра', shop_color_hint: 'Основной цвет можно менять бесплатно и в любой момент, даже в игре.', shop_morphs: 'Морфы (окраска и узор)', shop_morphs_hint: '2 цвета — спина другого цвета; 3 цвета — спина, бока и брюхо; в «своих» морфах цвет не зависит от вашего.', no_morph: 'Без морфа', shop_pats_hint: 'Меняет цвет рисунка (полосы, пятна) на вашем динозавре.', shop_eggs: 'Скины яйца', shop_eggs_hint: 'Видны при вылуплении, а купленный скин сам появляется в «Гнезде» как украшение.', egg_classic: 'Обычное', nest_open: 'Открыть гнездо и расставить', prof_online: 'Онлайн-профиль', prof_local: 'Одиночная игра', err_coins: 'Не хватает монет', err_mats: 'Не хватает костей или шкур',
    wardrobe: 'Гардероб', tab_skins: 'Скины', wd_color_moved: 'Цвет динозавра меняется в Гардеробе (кнопка в меню).', wd_empty: 'Пока ничего нет — загляни в магазин.', wd_nothing: 'Без украшения', nest_stored: 'в сундуке', nest_remove: 'Убрать', nest_return: 'Вернуть', sec_short: 'с', duel_menu: 'Дуэль', duel_menu_hint: 'Бой 1 на 1 на арене: победа даёт опыт, монеты и рейтинг.', duel_find: 'Найти соперника (рейтинг)', duel_bot: 'Тренировка с ботом', duel_search: 'Поиск соперника… (отмена — кнопка ниже)', shop: 'Магазин',
    nest: 'Гнездо', nest_hint: 'Трофеи боссов и яйца украшают гнездо в мире. Создайте комнату по коду — друзья увидят ваше гнездо.', nest_have: 'Ваши предметы', nest_shop: 'Добавить в коллекцию', nest_none: 'Пока пусто: победите босса или купите яйцо.', nest_place: 'Поставить', nest_placed: 'в гнезде', trophy_of: 'трофей ({b})',
    lb_coins: 'Монеты', lb_coins_n: 'Монет', promo: 'Промокод', promo_go: 'Ввести', promo_ok: 'Промокод принят: +{c} 🪙', promo_bad: 'Неверный промокод', promo_used: 'Промокод уже использован', promo_rate: 'Слишком часто, подожди минуту',
    type_lock_n: 'откроется на {n} уровне любого типа',
    rating: 'Рейтинг', league_up: 'новая лига: {n}!', season_end: 'Сезон завершён: лига {n}, +{c} 🪙', duels_wl: 'Дуэли: {w} поб. / {l} пор.', to_next: 'до «{l}»: {n}', season_left: 'до конца сезона дней: {d}', season_reward: 'награда сейчас',
    shop_hats: 'Шляпы и наряды', shop_trails: 'Следы', shop_pats: 'Цвета узоров', shop_roars: 'Эффекты рёва', shop_craft: 'Мастерская (из добычи боссов)', craft: 'Создать', mats_hint: 'кости и шкуры падают с боссов', loot_t: 'добыча с босса',
    claim: 'Забрать', claim_all: 'Забрать всё', claimed: 'получено', claim_in_game: 'награда — в игре', titles: 'Титулы', no_title: 'Без титула',
    shop_pets: 'Питомцы', shop_cos: 'Наряды',
    rare_find: 'Редкая находка в грозу! +{c} 🪙', night_on: 'Наступила ночь: хищников больше, опыт за них +20%', storm_on: 'Гроза: шанс редких находок', sec_chest: 'Сундук! +{c} 🪙', sec_pearl: 'Жемчужина! +{c} 🪙', sec_fruit: 'Золотой плод: {b}', buff_speed: 'Скорость +20%', buff_dmg: 'Урон +25%', buff_regen: 'Регенерация',
    rev_btn: '🤝 Поднять {n} (держи)', rev_wait: 'Друг может тебя поднять', rev_you: 'Друг поднял тебя!',
    tut_move: 'Иди вперёд: джойстик слева (на компьютере — WASD)', tut_look: 'Покрути камеру: проведи пальцем по экрану (на компьютере — мышь)', tut_sprint: 'Побеги: держи кнопку «Бег» (на компьютере — Shift)', tut_atk: 'Атакуй: кнопка «Атака» (на компьютере — клик мыши)', tut_eat: 'Поешь: подойди к еде (она подсвечена), еда лечит и даёт опыт', tut_kill: 'Победи слабого врага (зелёная точка на мини-карте)', tut_done: 'Обучение пройдено! +50 монет. Задания дня — в меню ☰',
    coro_king: 'КОРОЛЬ: {b}', coro_lord: 'ВЛАДЫКА ЭПОХ', coro_sub: 'Босс повержен — корона твоя!', coro_skip: 'нажми, чтобы пропустить',
    quests: 'Задания дня', quest_done: 'Задание выполнено', quest_all: 'ВСЕ задания дня! 🎉', quest_need_dino: 'Сначала вылупись', streak_n: 'Серия входов: {n}', streak_best: 'рекорд {n}',
    streak_gift: 'Подарок (косметика) через {n} дн. подряд', streak_gift_today: 'Сегодня подарок за 7 дней подряд!', quest_bonus: 'За все 3 задания — бонус +{c} 🪙', quest_new_day: 'Новые задания каждый день в 00:00 по Москве. Заходи каждый день — серия растёт, награда за вход тоже.',
    breath_low: 'Мало воздуха! Всплывай!', ms: 'м/с', st_walk: 'Ходьба', st_runspd: 'Бег', st_none: 'нет', change_dino: 'Сменить динозавра', change_dino_d: 'Выбери другого динозавра этого мира — не выходя в главное меню. Прогресс каждого сохраняется.', now_playing: 'Сейчас играешь',
    class: 'Первый тип (остальные доступны в меню игры — у каждого свой уровень)', type_title: 'Тип динозавра', type_new: 'Новый', type_new_d: 'Этот тип ты ещё не играл: начнёшь с 1 уровня. Прогресс остальных типов сохранится.',
    sea_land_note: 'На суше водные динозавры очень медленные и слабее — их стихия вода.', world_stat: 'Боссы {a}/{b} · виды {c}/{d}', about_dino: 'О динозавре', abilities: 'Способности', perks: 'Эволюция', perks_none: 'Пока ничего не выбрано — открой дерево эволюции (V).',
    st_hp: 'Здоровье', st_dmg: 'Урон за удар', st_atkspd: 'Скорость атаки', st_reach: 'Дальность', st_spd: 'Скорость', st_spd_land: 'Скорость на суше', st_spd_water: 'Скорость в воде', st_spd_fly: 'Скорость полёта', st_size: 'Размер', st_armor: 'Броня', st_dodge: 'Уворот',
    st_regen: 'Лечение', st_stam: 'Выносливость', st_regen_x: 'восстановление', st_breath: 'Запас воздуха', st_diet: 'Питание', per_s: 'уд/с', m: 'м', hp_s: 'HP/с', sec: 'с',
    grow_next: 'Следующий рост — на {l} уровне ({s}): динозавр станет заметно крупнее.', grow_max: 'Динозавр вырос до максимального размера.', grew: 'Ты вырос! Теперь ты — {s}', lv_up_hp: 'Ур. {n}'
  });
  Object.assign(D.en, {
    tab_color: 'Color', tab_outfit: 'Outfits', tab_fx: 'Effects', tab_egg: 'Egg', tab_nest: 'Nest', tab_craft: 'Workshop', shop_color: 'Dino color', shop_color_hint: 'Base color is free to change any time, even in game.', shop_morphs: 'Morphs (coat and pattern)', shop_morphs_hint: '2-tone: different back color; 3-tone: back, sides and belly; "own" morphs ignore your base color.', no_morph: 'No morph', shop_pats_hint: 'Recolors the pattern (stripes, spots) on your dino.', shop_eggs: 'Egg skins', shop_eggs_hint: 'Seen when hatching; a bought skin also appears in your Nest as decor.', egg_classic: 'Classic', nest_open: 'Open nest & arrange', prof_online: 'Online profile', prof_local: 'Single player', err_coins: 'Not enough coins', err_mats: 'Not enough bones or hides',
    wardrobe: 'Wardrobe', tab_skins: 'Skins', wd_color_moved: 'Change dino colour in the Wardrobe (menu button).', wd_empty: 'Nothing yet — check the shop.', wd_nothing: 'None', nest_stored: 'stored', nest_remove: 'Remove', nest_return: 'Return', sec_short: 's', duel_menu: 'Duel', duel_menu_hint: '1v1 on the arena: win for XP, coins and rating.', duel_find: 'Find opponent (rated)', duel_bot: 'Practice vs bot', duel_search: 'Searching for opponent… (press cancel to stop)', shop: 'Shop',
    nest: 'Nest', nest_hint: 'Boss trophies and eggs decorate the nest in the world. Create a code room — friends will see your nest.', nest_have: 'Your items', nest_shop: 'Add to collection', nest_none: 'Empty so far: beat a boss or buy an egg.', nest_place: 'Place', nest_placed: 'in nest', trophy_of: 'trophy ({b})',
    lb_coins: 'Coins', lb_coins_n: 'Coins', promo: 'Promo code', promo_go: 'Redeem', promo_ok: 'Code accepted: +{c} 🪙', promo_bad: 'Invalid code', promo_used: 'Code already used', promo_rate: 'Too fast, wait a minute',
    type_lock_n: 'unlocks at level {n} of any type',
    rating: 'Rating', league_up: 'new league: {n}!', season_end: 'Season over: {n} league, +{c} 🪙', duels_wl: 'Duels: {w} W / {l} L', to_next: '{n} to {l}', season_left: 'days left in season: {d}', season_reward: 'reward now',
    shop_hats: 'Hats & outfits', shop_trails: 'Trails', shop_pats: 'Pattern colors', shop_roars: 'Roar effects', shop_craft: 'Workshop (boss loot)', craft: 'Craft', mats_hint: 'bones and hides drop from bosses', loot_t: 'boss loot',
    claim: 'Claim', claim_all: 'Claim all', claimed: 'claimed', claim_in_game: 'claim in game', titles: 'Titles', no_title: 'No title',
    shop_pets: 'Pets', shop_cos: 'Outfits',
    rare_find: 'Rare storm find! +{c} 🪙', night_on: 'Night falls: more predators, +20% XP from them', storm_on: 'Thunderstorm: chance of rare finds', sec_chest: 'Treasure chest! +{c} 🪙', sec_pearl: 'Pearl! +{c} 🪙', sec_fruit: 'Golden fruit: {b}', buff_speed: 'Speed +20%', buff_dmg: 'Damage +25%', buff_regen: 'Regeneration',
    rev_btn: '🤝 Revive {n} (hold)', rev_wait: 'A friend can revive you', rev_you: 'A friend revived you!',
    tut_move: 'Move: left stick (on PC — WASD)', tut_look: 'Look around: drag on the screen (on PC — mouse)', tut_sprint: 'Sprint: hold the Sprint button (on PC — Shift)', tut_atk: 'Attack: the Attack button (on PC — mouse click)', tut_eat: 'Eat: walk to food (it is highlighted), food heals and gives XP', tut_kill: 'Defeat a weak enemy (green dot on the minimap)', tut_done: 'Tutorial complete! +50 coins. Daily quests are in the ☰ menu',
    coro_king: 'KING OF THE {b}', coro_lord: 'LORD OF THE AGES', coro_sub: 'The boss is defeated — the crown is yours!', coro_skip: 'tap to skip',
    quests: 'Daily quests', quest_done: 'Quest complete', quest_all: 'ALL daily quests! 🎉', quest_need_dino: 'Hatch first', streak_n: 'Login streak: {n}', streak_best: 'best {n}',
    streak_gift: 'Gift (cosmetic) in {n} more days in a row', streak_gift_today: 'Today: 7-day streak gift!', quest_bonus: 'All 3 quests — bonus +{c} 🪙', quest_new_day: 'New quests every day at 00:00 Moscow time. Come back daily — the streak and the login reward grow.',
    breath_low: 'Low on air! Surface!', ms: 'm/s', st_walk: 'Walk', st_runspd: 'Run', st_none: 'none', change_dino: 'Change dinosaur', change_dino_d: 'Pick another dinosaur of this world without leaving to the main menu. Each keeps its own progress.', now_playing: 'Playing now',
    class: 'First type (the rest are available in the play menu — each has its own level)', type_title: 'Dinosaur type', type_new: 'New', type_new_d: 'You have not played this type yet: it starts at level 1. Your other types keep their progress.',
    sea_land_note: 'On land marine dinosaurs are very slow and weaker — water is their home.', world_stat: 'Bosses {a}/{b} · species {c}/{d}', about_dino: 'About your dino', abilities: 'Abilities', perks: 'Evolution', perks_none: 'Nothing picked yet — open the evolution tree (V).',
    st_hp: 'Health', st_dmg: 'Damage per hit', st_atkspd: 'Attack speed', st_reach: 'Reach', st_spd: 'Speed', st_spd_land: 'Speed on land', st_spd_water: 'Speed in water', st_spd_fly: 'Flight speed', st_size: 'Size', st_armor: 'Armor', st_dodge: 'Dodge',
    st_regen: 'Healing', st_stam: 'Stamina', st_regen_x: 'regen', st_breath: 'Breath', st_diet: 'Diet', per_s: 'hits/s', m: 'm', hp_s: 'HP/s', sec: 's',
    grow_next: 'Next growth at level {l} ({s}): your dinosaur gets noticeably bigger.', grow_max: 'Your dinosaur is fully grown.', grew: 'You grew! You are now: {s}', lv_up_hp: 'Lv {n}'
  });
  var lang = 'ru';
  try { lang = localStorage.getItem('dino_lang') || ((navigator.language || 'ru').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en'); } catch (e) { /* ignore */ }
  if (!D[lang]) lang = 'ru';
  window.I18N = {
    get lang() { return lang; },
    set(l) { if (D[l]) { lang = l; try { localStorage.setItem('dino_lang', l); } catch (e) { /* ignore */ } } },
    has(k) { return D[lang][k] != null || D.ru[k] != null; }
  };
  window.T = function (k, v) {
    var s = D[lang][k]; if (s == null) s = D.ru[k]; if (s == null) return k;
    if (v) for (var x in v) s = s.split('{' + x + '}').join(v[x]);
    return s;
  };
  // название по объекту {ru,en}
  window.TN = function (o) { return o ? (o[lang] || o.ru || '') : ''; };
})();

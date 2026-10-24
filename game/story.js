/* «Последняя Искра» — сюжет Dino Evolution: пролог, шесть осколков (боссы суши), пять стражей океана, Сердце Искры, финал и две концовки.
   Здесь: тексты (RU/EN), субтитры боссов, проигрыватель роликов (сцены в storyart.js), очередь событий после победы над боссом,
   выбор концовки и 3D-украшения гнезда. Прогресс берётся из профиля: kings (побеждённые боссы), story (просмотренные ролики), ending. */
import * as THREE from 'three';
import { SCENES, SHARD_COL, LAND, SEA, BIOMES } from './storyart.js';

const TX = {
  ru: {
    pro: [
      ['Давным-давно…', 'Давным-давно с неба упал метеорит. Он не уничтожил мир, а раскололся на шесть осколков, и каждый ушёл в землю своего края.'],
      ['Шесть осколков', 'Из осколков пробилась сила, которую древние существа назвали Искрой. Она будит инстинкты, заставляет расти, менять форму и учиться драться. Тот, кто соберёт все осколки, станет Владыкой Эпох.'],
      ['Искра ищет дом', 'Но Искра не просто сила. Она живая, и она ищет дом.'],
      ['Яйцо в гнезде светилось…', 'Вы вылупляетесь из яйца в одиноком гнезде на опушке леса. Яйцо светилось ещё до того, как треснуть: внутри был крошечный след Искры.'],
      ['Твой путь начинается', 'Вы растёте быстрее остальных, и это чувствуют все вокруг. Для мелких вы чужак, которого надо прогнать, для сильных — соперник, которого надо остановить.']
    ],
    sea: [['', 'Когда все шесть осколков собраны, они слабо светятся в гнезде.'], ['', 'Но Искра по-прежнему зовёт — теперь уже из глубины моря: шести осколков недостаточно.']],
    dive: [['Акт II. Океан', 'Под водой лежит седьмая, главная часть: «Сердце Искры». Её охраняют пять древних существ. Они не враги суши — они стражи, которые выбрали самые тёмные места, чтобы Сердце никто не нашёл.']],
    heart: [['', 'Победа над пятью стражами открывает Сердце. Оно поднимается из бездны…'], ['', '…и летит к тому единственному месту, куда стремилось всё это время.']],
    fin: [['Финал', 'Сердце Искры возвращается в гнездо, где вы вылупились. Все шесть осколков и Сердце ложатся рядом с яйцом, и вы наконец понимаете, чего хотела Искра. Не власти, а дома. Каждое яйцо в мире было её попыткой его найти, в том числе ваше.'], ['', 'Перед вами выбор, и вы делаете его один раз.']],
    lord: [['Владыка Эпох', 'Вы забираете всю силу. Искра гаснет, но вы становитесь самым могучим существом в мире, и вас признают все края.', 'Корона из осколков в гнезде и золотое свечение у динозавра']],
    keeper: [['Хранитель Искры', 'Вы кладёте осколки в гнездо и оставляете Искру миру. Вы остаётесь обычным динозавром, зато гнездо начинает светиться, а на суше и в океане растёт новая жизнь: яркие кусты, светящиеся кораллы, новые существа.', 'Светящееся яйцо в гнезде и мягкое сияние вокруг гнезда']],
    last: [['', 'Искра нашла свой дом. А ты нашёл свой.']],
    shardN: 'Осколок {n} / 6', guardN: 'Страж {n} / 5', skip: 'Пропустить · Esc / Пробел / клик', act1: 'Акт I. Суша',
    chooseT: 'Твой выбор', lordBtn: 'Забрать всю силу', keepBtn: 'Оставить Искру миру', once: 'Выбор делается один раз.',
    storyBtn: '📖 Сюжет', storyTitle: 'Последняя Искра', shards: 'Осколки', guards: 'Стражи океана', heartT: 'Сердце Искры', ending: 'Концовка', none: '—', replay: 'Смотреть',
    prologueB: 'Пролог', seaB: 'Зов моря', diveB: 'Акт II. Океан', heartB: 'Сердце поднимается', finB: 'Финал', gotHeart: 'Получено', bossIntro: 'Страж осколка', guardIntro: 'Страж Сердца',
    titleLord: 'Владыка Эпох', titleKeeper: 'Хранитель Искры', needAll: 'Нужны все 6 осколков и 5 стражей.', replayLocked: 'Ещё не открыто'
  },
  en: {
    pro: [
      ['Long ago…', 'Long ago a meteorite fell from the sky. It did not destroy the world — it split into six shards, and each sank into the land of its own realm.'],
      ['Six shards', 'A power broke through from the shards, which the ancient creatures called the Spark. It awakens instincts, makes you grow, change shape and learn to fight. Whoever gathers every shard becomes the Lord of Ages.'],
      ['The Spark seeks a home', 'But the Spark is not just power. It is alive, and it is looking for a home.'],
      ['The egg in the nest glowed…', 'You hatch from an egg in a lonely nest at the edge of the forest. The egg glowed even before it cracked: inside was a tiny trace of the Spark.'],
      ['Your path begins', 'You grow faster than the others, and everyone around can feel it. To the small you are a stranger to be driven off; to the strong, a rival to be stopped.']
    ],
    sea: [['', 'When all six shards are gathered, they glow faintly in the nest.'], ['', 'But the Spark still calls — now from the depths of the sea: six shards are not enough.']],
    dive: [['Act II. The Ocean', 'Beneath the water lies the seventh, main part: the Heart of the Spark. Five ancient creatures guard it. They are not enemies of the land — they are guardians who chose the darkest places so that no one would find the Heart.']],
    heart: [['', 'Defeating the five guardians opens the Heart. It rises from the abyss…'], ['', '…and flies to the one place it has been yearning for all along.']],
    fin: [['Finale', 'The Heart of the Spark returns to the nest where you hatched. All six shards and the Heart come to rest beside the egg, and at last you understand what the Spark wanted. Not power, but a home. Every egg in the world was its attempt to find one — yours too.'], ['', 'A choice lies before you, and you make it only once.']],
    lord: [['Lord of Ages', 'You take all the power. The Spark goes out, but you become the mightiest creature in the world, and every realm acknowledges you.', 'A crown of shards in the nest and a golden glow around your dinosaur']],
    keeper: [['Keeper of the Spark', 'You lay the shards in the nest and leave the Spark to the world. You remain an ordinary dinosaur, but the nest begins to glow, and new life grows on land and in the ocean: bright bushes, glowing corals, new creatures.', 'A glowing egg in the nest and a soft shimmer around it']],
    last: [['', 'The Spark found its home. And you found yours.']],
    shardN: 'Shard {n} / 6', guardN: 'Guardian {n} / 5', skip: 'Skip · Esc / Space / click', act1: 'Act I. The Land',
    chooseT: 'Your choice', lordBtn: 'Take all the power', keepBtn: 'Leave the Spark to the world', once: 'You choose only once.',
    storyBtn: '📖 Story', storyTitle: 'The Last Spark', shards: 'Shards', guards: 'Ocean guardians', heartT: 'Heart of the Spark', ending: 'Ending', none: '—', replay: 'Watch',
    prologueB: 'Prologue', seaB: 'The call of the sea', diveB: 'Act II. The Ocean', heartB: 'The Heart rises', finB: 'Finale', gotHeart: 'Obtained', bossIntro: 'Shard keeper', guardIntro: 'Guardian of the Heart',
    titleLord: 'Lord of Ages', titleKeeper: 'Keeper of the Spark', needAll: 'All 6 shards and 5 guardians are needed.', replayLocked: 'Not unlocked yet'
  }
};
// боссы: имя, реплика до боя и после победы (с доски сюжета)
const BOSS = {
  forest: { id: 'tyrant', ru: ['Старый Тираннозавр', '«Я слышал твой первый крик. Слишком рано для тебя, слишком поздно для меня»', '«Ты сильнее, чем я боялся. Тогда помни: Искра берёт столько же, сколько даёт»'], en: ['The Old Tyrannosaur', '"I heard your first cry. Too early for you, too late for me."', '"You are stronger than I feared. Then remember: the Spark takes as much as it gives."'] },
  snow: { id: 'frost', ru: ['Ледяной Гигант', '«Останься у меня. Уйдёшь с осколком, и озеро растает»', '«Лёд треснул, и мне стало тепло. Странное ощущение»'], en: ['The Ice Giant', '"Stay with me. Leave with the shard, and the lake will thaw."', '"The ice cracked, and I felt warm. A strange feeling."'] },
  mountain: { id: 'rogach', ru: ['Горный Рогач', '«Пришёл на мою скалу? Докажи, что имеешь на это право»', '«Хорошая голова. Крепче моей»'], en: ['The Mountain Horned One', '"Come to my rock? Prove you have the right."', '"A good head. Harder than mine."'] },
  desert: { id: 'sandlord', ru: ['Песчаный Повелитель', '«Здесь нет воды и тени. Если ты слабее песка, песок тебя похоронит»', '«Песок помнит всех, кто сюда приходил. Тебя он запомнит надолго»'], en: ['The Sand Lord', '"There is no water or shade here. If you are weaker than the sand, the sand will bury you."', '"The sand remembers everyone who came here. It will remember you for a long time."'] },
  swamp: { id: 'leviathan', ru: ['Морской Левиафан', '«Я приплыл не за осколком. Я приплыл посмотреть на того, кто их соберёт»', '«Теперь не останавливайся. Следующий осколок горит под вулканом. И не только он»'], en: ['The Sea Leviathan', '"I did not come for the shard. I came to see the one who will gather them."', '"Now do not stop. The next shard burns beneath the volcano. And not only that one."'] },
  volcano: { id: 'dragon', ru: ['Вулканический Дракон', '«Забери её у меня. Только сначала докажи, что не сгоришь»', '«Наконец-то тихо внутри. Спасибо»'], en: ['The Volcanic Dragon', '"Take it from me. But first prove you won\'t burn."', '"Finally it\'s quiet inside. Thank you."'] },
  reef: { id: 'megalodon', ru: ['Древний Мегалодон', '«Тут тепло и красиво. Незачем сюда спускаться»', '«Дальше вода холоднее»'], en: ['The Ancient Megalodon', '"It\'s warm and beautiful here. No reason to descend."', '"Beyond this, the water is colder."'] },
  kelp: { id: 'plesioqueen', ru: ['Королева плезиозавров', '«Ты слишком шумишь для этих зарослей. Здесь живут тихие»', '«Иди. Но слушай течение: оно ведёт вниз»'], en: ['The Plesiosaur Queen', '"You make too much noise for this thicket. The quiet ones live here."', '"Go. But listen to the current: it leads down."'] },
  arctic: { id: 'kronos', ru: ['Ледяной Кронозавр', '«Холод не прощает слабых. Даже тех, у кого есть Искра»', '«Ты не замёрз. Значит, сердце уже горит»'], en: ['The Ice Kronosaurus', '"Cold does not forgive the weak. Not even those with the Spark."', '"You haven\'t frozen. So your heart is already burning."'] },
  vents: { id: 'dunkleo', ru: ['Дунклеостей-титан', '«Здесь вода кипит, а ты не боишься. Это глупо или это сила?»', '«Глупо, но сильно. Тилозавр ждёт внизу»'], en: ['The Dunkleosteus Titan', '"The water boils here and you aren\'t afraid. Is that foolish, or is it strength?"', '"Foolish, but strong. The Tylosaurus waits below."'] },
  abyss: { id: 'tylo', ru: ['Тилозавр Бездны', '«Вернись. Назад ещё можно»', '«Теперь ты знаешь, что такое Искра. Решай сам»'], en: ['The Abyssal Tylosaurus', '"Go back. It is still possible to turn back."', '"Now you know what the Spark is. Decide for yourself."'] }
};
const lang = () => (window.I18N && window.I18N.lang === 'en') ? 'en' : 'ru';
const tx = () => TX[lang()];
const biomeName = (b) => { const c = window.CONFIG && window.CONFIG.BIOME[b]; return c ? c.n[lang()] : b; };
let cur = null, H = null, cine = null, subsEl = null, barsEl = null, nameEl = null, running = false, subTimer = 0, subQ = [], subBusy = false, chain = Promise.resolve(), seenIntro = {}, introT = 0;

export const Story = {
  init(host) { H = host; build(); },
  busy() { return running; },
  seek(sec) { if (cur) cur.t = sec; },
  tr(k) { return tx()[k]; },
  abort() { if (cine && running) { cine.abort = true; } subQ = []; if (subsEl) subsEl.classList.remove('on'); hideBars(); },
  // ---- прогресс
  stat(p) { const k = new Set(CONFIG.allKings(p)); return { land: LAND.filter(b => k.has(b)).length, sea: SEA.filter(b => k.has(b)).length, ending: (p && p.ending) || '', story: (p && p.story) || {} }; },
  bossLines(biome) { const b = BOSS[biome]; return b ? b[lang()] : null; },
  speakerOf(biome) { const b = BOSS[biome]; return b ? b.id : 'narrator'; },
  // ---- субтитры (не останавливают бой)
  say(who, name, text, ms) { subQ.push({ who, name, text, ms }); if (!subBusy) nextSub(); },
  // ролик-«знакомство» с боссом: чёрные полосы и имя; затем реплика
  bossIntro(biome, beaten) {
    const b = BOSS[biome]; if (!b) return; const l = b[lang()], now = performance.now();
    if (now - introT < 4000) return; introT = now;
    if (!beaten || !seenIntro[biome]) {
      seenIntro[biome] = 1; barsEl.classList.add('on'); nameEl.classList.add('on'); nameEl.querySelector('.n').textContent = l[0].toUpperCase();
      nameEl.querySelector('.s').textContent = (SEA.indexOf(biome) >= 0 ? tx().guardIntro : tx().bossIntro) + ' · ' + biomeName(biome);
      setTimeout(() => nameEl.classList.remove('on'), 4600); setTimeout(hideBars, 6000);
    }
    setTimeout(() => this.say(b.id, l[0], l[1], 0), 2500);
  },
  bossOutro(biome) { const b = BOSS[biome]; if (!b) return; const l = b[lang()]; setTimeout(() => this.say(b.id, l[0], l[2], 0), 1300); },
  // ---- ролики
  play(name, P) { return playScene(name, P || {}); },
  queue(fn) { chain = chain.then(async () => { while (H.coroActive() && H.alive()) await wait(300); if (!H.alive() && !Story.force) return; try { await fn(); } catch (e) { console.error(e); } }); return chain; },
  // после первой победы над боссом: осколок/страж → зов моря → Сердце → финал
  afterKing(biome, profile) {
    const have = new Set(CONFIG.allKings(profile)); have.add(biome); const st = { story: profile.story || {} };
    const land = LAND.filter(b => have.has(b)).length, sea = SEA.filter(b => have.has(b)).length, isSea = SEA.indexOf(biome) >= 0;
    this.queue(async () => {
      if (isSea) {
        await playScene('guard', { biome, n: sea });
        if (sea >= 5) { await playScene('heart', {}); H.send({ t: 'story', k: 'heart' }); }
      } else {
        await playScene('shard', { biome, n: land });
        if (land >= 6 && sea < 5 && !st.story.call && sea === 0) { await playScene('seacall', {}); H.send({ t: 'story', k: 'call' }); }
      }
      if (land >= 6 && sea >= 5 && !profile.ending) await runFinale();
    });
  },
  // при входе в игру: прологи/погружение/финал, если ещё не были показаны
  onWelcome(profile, o) {
    const st = profile.story || {}, p = { hatchNow: !!o.hatchNow, sea: !!o.sea };
    return {
      needPrologue: p.hatchNow && !st.pro,
      after: () => {
        const have = new Set(CONFIG.allKings(profile)), land = LAND.filter(b => have.has(b)).length, sea = SEA.filter(b => have.has(b)).length;
        if (p.sea && !st.dive && sea < 5 && land >= 6) this.queue(async () => { await playScene('dive', {}); H.send({ t: 'story', k: 'dive' }); });
        if (land >= 6 && sea >= 5 && !profile.ending) this.queue(async () => { await wait(2500); if (!H.alive()) return; await runFinale(); });
      }
    };
  },
  replayable(profile) { const s = this.stat(profile), st = s.story; return { pro: !!st.pro, call: !!st.call || s.land >= 6, dive: !!st.dive || s.sea > 0, heart: !!st.heart || s.sea >= 5, fin: !!s.ending }; },
  // ---- панель «Сюжет» в меню: прогресс и повтор роликов
  panelHtml(profile) {
    const T = tx(), st = this.stat(profile), rp = this.replayable(profile), k = new Set(CONFIG.allKings(profile));
    const chip = (b, i, kind) => { const own = k.has(b), col = SHARD_COL[b] || (BIOMES[b] && BIOMES[b].ac) || '#9ad8ff'; return `<button class="st-r" ${own ? '' : 'disabled'} data-s="${kind}:${b}:${i + 1}" style="border-left:5px solid ${own ? col : '#556'};text-align:left;opacity:${own ? 1 : 0.55}">${own ? (kind === 'shard' ? '🔷' : '🔵') : '▫️'} ${biomeName(b)}<br><small>${BOSS[b][lang()][0]}</small></button>`; };
    const sc = (id, name, on) => `<button class="st-r" ${on ? '' : 'disabled'} data-s="${id}" style="${on ? '' : 'opacity:.5'}">🎬 ${name}</button>`;
    return `<h2>📖 ${T.storyTitle}</h2>
      <h3>${T.act1} · ${T.shards} ${st.land}/6</h3><div class="grid2">${LAND.map((b, i) => chip(b, i, 'shard')).join('')}</div>
      <h3>${T.guards} ${st.sea}/5</h3><div class="grid2">${SEA.map((b, i) => chip(b, i, 'guard')).join('')}</div>
      <h3>${T.heartT}: ${st.sea >= 5 ? '❤ ' + T.gotHeart : T.none} · ${T.ending}: ${st.ending === 'lord' ? '👑 ' + T.titleLord : st.ending === 'keeper' ? '🥚 ' + T.titleKeeper : T.none}</h3>
      <div class="grid2">${sc('pro', T.prologueB, rp.pro)}${sc('call', T.seaB, rp.call)}${sc('dive', T.diveB, rp.dive)}${sc('heart', T.heartB, rp.heart)}${st.ending ? sc('end', st.ending === 'lord' ? T.titleLord : T.titleKeeper, true) : ''}</div>
      <button class="pri" id="st-close">OK</button>`;
  },
  bindPanel(root, closeFn, endFn) {
    root.querySelectorAll('.st-r').forEach(b => b.addEventListener('click', () => {
      const [k, a, n] = b.dataset.s.split(':'); H.Audio.sfx('click');
      endFn(() => {
        if (k === 'shard' || k === 'guard') Story.queue(() => playScene(k, { biome: a, n: +n }));
        else if (k === 'pro') Story.queue(() => playScene('prologue', {}));
        else if (k === 'call') Story.queue(() => playScene('seacall', {}));
        else if (k === 'dive') Story.queue(() => playScene('dive', {}));
        else if (k === 'heart') Story.queue(() => playScene('heart', {}));
        else if (k === 'end') Story.queue(async () => { await playScene(H.getEnding() === 'lord' ? 'end_lord' : 'end_keeper', {}); await playScene('last', {}); });
      });
    }));
    const c = root.querySelector('#st-close'); if (c) c.onclick = closeFn;
  },
  decor: null
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ DOM
function build() {
  if (document.getElementById('cine')) return;
  const st = document.createElement('style');
  st.textContent = `
  #cine{position:fixed;inset:0;z-index:70;display:none;background:#000;color:#fff;font-family:system-ui,sans-serif;user-select:none;-webkit-user-select:none}
  #cine.on{display:block} #cine canvas{position:absolute;inset:0;width:100%;height:100%}
  #cine .cc{position:absolute;left:0;right:0;bottom:11vh;text-align:center;padding:0 6vw;opacity:0;transition:opacity .15s;pointer-events:none}
  #cine .ct{font-weight:900;font-size:clamp(24px,5.4vw,56px);letter-spacing:2px;color:#ffe9a8;text-shadow:0 0 22px rgba(255,200,90,.7),0 3px 10px #000;margin-bottom:10px}
  #cine .cb{max-width:min(860px,90vw);margin:0 auto;font-size:clamp(15px,2.3vw,24px);line-height:1.5;text-shadow:0 2px 8px #000,0 0 14px #000}
  #cine .cs{max-width:min(860px,90vw);margin:12px auto 0;font-size:clamp(13px,1.9vw,20px);font-style:italic;color:#cfe6ff;text-shadow:0 2px 6px #000}
  #cine .cr{margin:14px auto 0;font-size:clamp(12px,1.7vw,18px);color:#ffd35a;text-shadow:0 2px 6px #000}
  #cine .bars i{position:absolute;left:0;right:0;height:7vh;background:#000} #cine .bars i:first-child{top:0} #cine .bars i:last-child{bottom:0}
  #cine .cskip{position:absolute;right:16px;top:calc(7vh + 8px);font-size:12px;opacity:.55;text-shadow:0 1px 3px #000;pointer-events:none}
  #cine .cch{position:absolute;inset:0;display:none;align-items:center;justify-content:center;gap:4vw;flex-wrap:wrap;padding:0 4vw;background:rgba(0,0,0,.45)}
  #cine .cch.on{display:flex} #cine .cch h2{position:absolute;top:12vh;left:0;right:0;text-align:center;margin:0;font-size:clamp(22px,4vw,40px);color:#ffe9a8;text-shadow:0 2px 10px #000}
  #cine .cch p.o{position:absolute;bottom:9vh;left:0;right:0;text-align:center;font-size:13px;opacity:.7}
  #cine .opt{width:min(380px,86vw);padding:20px 22px;border-radius:18px;cursor:pointer;border:2px solid rgba(255,255,255,.35);background:rgba(10,14,24,.78);text-align:left;transition:transform .15s,border-color .15s,box-shadow .15s;color:#fff;font:inherit}
  #cine .opt:hover,#cine .opt:focus{transform:translateY(-4px);outline:none} #cine .opt b{display:block;font-size:clamp(18px,2.4vw,26px);margin-bottom:8px} #cine .opt span{display:block;font-size:clamp(13px,1.6vw,16px);line-height:1.45;opacity:.9} #cine .opt em{display:block;margin-top:10px;font-style:normal;font-size:13px;color:#ffd35a}
  #cine .opt.l:hover{border-color:#ffd35a;box-shadow:0 0 30px rgba(255,200,80,.5)} #cine .opt.k:hover{border-color:#8affd8;box-shadow:0 0 30px rgba(120,255,210,.5)}
  #subs{position:fixed;left:50%;bottom:19vh;transform:translateX(-50%);width:min(860px,92vw);z-index:60;pointer-events:none;opacity:0;transition:opacity .35s;text-align:center}
  #subs.on{opacity:1} #subs .w{display:inline-block;max-width:100%;padding:9px 18px 11px;border-radius:14px;background:rgba(8,10,18,.68);border-bottom:3px solid var(--sc,#ffd35a);box-shadow:0 4px 18px rgba(0,0,0,.45)}
  #subs .n{font-weight:800;font-size:clamp(12px,1.6vw,15px);letter-spacing:1.5px;text-transform:uppercase;color:var(--sc,#ffd35a);margin-bottom:3px} #subs .t{font-size:clamp(15px,2.1vw,21px);line-height:1.4;color:#fff;text-shadow:0 1px 4px #000}
  #bbars i{position:fixed;left:0;right:0;height:0;background:#000;z-index:44;transition:height .7s ease;pointer-events:none} #bbars i:first-child{top:0} #bbars i:last-child{bottom:0} #bbars.on i{height:10vh}
  #bname{position:fixed;left:0;right:0;top:56%;text-align:center;z-index:45;pointer-events:none;opacity:0;transform:scale(1.06);transition:opacity .7s,transform 1.2s} #bname.on{opacity:1;transform:scale(1)}
  #bname .n{font-weight:900;font-size:clamp(26px,6vw,62px);letter-spacing:4px;color:#fff;text-shadow:0 0 22px rgba(255,70,40,.85),0 3px 10px #000} #bname .s{margin-top:6px;font-size:clamp(12px,2vw,20px);letter-spacing:3px;color:#ffd0b0;text-transform:uppercase;text-shadow:0 2px 6px #000}`;
  document.head.appendChild(st);
  cine = document.createElement('div'); cine.id = 'cine';
  cine.innerHTML = '<canvas></canvas><div class="bars"><i></i><i></i></div><div class="cc"><div class="ct"></div><div class="cb"></div><div class="cs"></div><div class="cr"></div></div><div class="cskip"></div><div class="cch"></div>';
  document.body.appendChild(cine);
  subsEl = document.createElement('div'); subsEl.id = 'subs'; subsEl.innerHTML = '<div class="w"><div class="n"></div><div class="t"></div></div>'; document.body.appendChild(subsEl);
  barsEl = document.createElement('div'); barsEl.id = 'bbars'; barsEl.innerHTML = '<i></i><i></i>'; document.body.appendChild(barsEl);
  nameEl = document.createElement('div'); nameEl.id = 'bname'; nameEl.innerHTML = '<div class="n"></div><div class="s"></div>'; document.body.appendChild(nameEl);
}
const hideBars = () => { barsEl && barsEl.classList.remove('on'); };
const SPK_COL = { tyrant: '#ff9a5a', frost: '#9fe0ff', rogach: '#d8b27a', sandlord: '#ffd36a', leviathan: '#7ad8c8', dragon: '#ff6a3a', megalodon: '#7ac8ff', plesioqueen: '#c89aff', kronos: '#9ad0ff', dunkleo: '#ff8a5a', tylo: '#7a8aff', narrator: '#ffe9a8' };
function nextSub() {
  const q = subQ.shift(); if (!q) { subBusy = false; subsEl.classList.remove('on'); return; }
  subBusy = true; const el = subsEl, nm = el.querySelector('.n'), tt = el.querySelector('.t');
  el.style.setProperty('--sc', SPK_COL[q.who] || '#ffd35a'); nm.textContent = q.name || ''; nm.style.display = q.name ? 'block' : 'none'; tt.textContent = ''; el.classList.add('on');
  const txt = q.text, dur = Math.max(1.2, txt.length / 26), hold = q.ms || Math.max(3600, txt.length * 62 + 1800); let i = 0, t0 = performance.now();
  H.Audio.speak(q.who, txt.length, dur);
  clearInterval(subTimer); subTimer = setInterval(() => { i = Math.min(txt.length, Math.floor((performance.now() - t0) / 1000 * txt.length / dur)); tt.textContent = txt.slice(0, i); if (i >= txt.length) { clearInterval(subTimer); setTimeout(() => { el.classList.remove('on'); setTimeout(nextSub, 380); }, hold - dur * 1000); } }, 40);
}

// ------------------------------------------------------------------ проигрыватель роликов
function cardOf(key, idx, P) {
  const T = tx();
  if (key === 'shard') { const b = BOSS[P.biome], l = b ? b[lang()] : ['', '', '']; return { t: T.shardN.replace('{n}', P.n), b: biomeName(P.biome), s: l[0] + ': ' + l[2] }; }
  if (key === 'guard') { const b = BOSS[P.biome], l = b ? b[lang()] : ['', '', '']; return { t: T.guardN.replace('{n}', P.n), b: biomeName(P.biome), s: l[0] + ': ' + l[2] }; }
  const c = T[key] && T[key][idx]; return c ? { t: c[0], b: c[1], r: c[2] } : { t: '', b: '' };
}
function playScene(name, P) {
  const def = SCENES[name]; if (!def || !cine) return Promise.resolve();
  return new Promise((resolve) => {
    if (running) { resolve(); return; }
    running = true; cine.abort = false; document.body.classList.add('cine'); cine.classList.add('on');
    const cv = cine.querySelector('canvas'), g = cv.getContext('2d'), cc = cine.querySelector('.cc'), ct = cc.querySelector('.ct'), cb = cc.querySelector('.cb'), cs = cc.querySelector('.cs'), cr = cc.querySelector('.cr'), skipEl = cine.querySelector('.cskip'), ch = cine.querySelector('.cch');
    let W = 0, Hh = 0, dpr = 1; const fit = () => { dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = window.innerWidth; Hh = window.innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit(); window.addEventListener('resize', fit); ch.classList.remove('on'); ch.innerHTML = '';
    skipEl.textContent = tx().skip; skipEl.style.opacity = 0;
    H.pause(true); H.send({ t: 'story', k: 'cine' }); H.Audio.setMood(def.mood || 'story');
    let nextShield = 30, t = 0, last = performance.now(), sfxI = 0, done = false, curCard = -1, skipAt = 0.9, choosing = false, endAt = def.dur;
    const sfxs = (def.sfx || []).slice().sort((a, b) => a[0] - b[0]);
    const finish = () => { if (done) return; done = true; running = false; cur = null; cancelAnimationFrame(raf); window.removeEventListener('resize', fit); window.removeEventListener('keydown', key, true); cine.removeEventListener('pointerdown', click); cine.classList.remove('on'); document.body.classList.remove('cine'); cc.style.opacity = 0; ch.classList.remove('on'); H.pause(false); H.Audio.setMood(''); resolve(); };
    const skip = () => { if (t < skipAt || done) return; if (def.hold && !choosing) { if (t < 18.2) { t = 18.2; curCard = -1; sfxI = sfxs.length; } return; } if (def.hold) return; endAt = Math.min(endAt, t + 0.5); fadeOut = performance.now(); };
    let fadeOut = 0;
    const key = (e) => { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); skip(); } };
    const click = () => skip();
    window.addEventListener('keydown', key, true); cine.addEventListener('pointerdown', click);
    const showChoice = () => {
      choosing = true; const T = tx(); cc.style.opacity = 0;
      ch.innerHTML = `<h2>${T.chooseT}</h2><button class="opt l"><b>${T.titleLord}</b><span>${T.lord[0][1]}</span><em>🎁 ${T.lord[0][2]}</em></button><button class="opt k"><b>${T.titleKeeper}</b><span>${T.keeper[0][1]}</span><em>🎁 ${T.keeper[0][2]}</em></button><p class="o">${T.once}</p>`;
      ch.classList.add('on'); skipEl.style.opacity = 0;
      const pick = (id) => { if (P.onChoice) P.onChoice(id); ch.classList.remove('on'); endAt = t + 0.3; };
      ch.querySelector('.l').addEventListener('click', (e) => { e.stopPropagation(); pick('lord'); }); ch.querySelector('.k').addEventListener('click', (e) => { e.stopPropagation(); pick('keeper'); });
      H.Audio.sfx('spark');
    };
    const loop = (now) => {
      if (done) return; raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - last) / 1000); last = now; t += dt; cur = { get t() { return t; }, set t(v) { t = v; } };
      if (cine.abort || (!H.alive() && !Story.force)) { finish(); return; }
      if (t > nextShield) { nextShield = t + 30; H.send({ t: 'story', k: 'cine' }); }
      if (def.hold && !choosing && t >= 18.4) showChoice();
      g.clearRect(0, 0, W, Hh); def.draw(g, W, Hh, t, P);
      while (sfxI < sfxs.length && t >= sfxs[sfxI][0]) { H.Audio.sfx(sfxs[sfxI][1]); sfxI++; }
      // карточки
      let idx = -1; (def.cards || []).forEach((c, i) => { if (t >= c[0] && t < c[1]) idx = i; });
      if (!choosing && idx >= 0) {
        const c = def.cards[idx]; if (idx !== curCard) { curCard = idx; const d = cardOf(c[2], c[3], P); ct.textContent = d.t || ''; ct.style.display = d.t ? 'block' : 'none'; cb.textContent = d.b || ''; cs.textContent = d.s || ''; cs.style.display = d.s ? 'block' : 'none'; cr.textContent = d.r ? '🎁 ' + d.r : ''; cr.style.display = d.r ? 'block' : 'none'; }
        cc.style.opacity = Math.max(0, Math.min(1, (t - c[0]) / 0.9, (c[1] - t) / 0.9)).toFixed(3);
      } else if (!choosing) cc.style.opacity = 0;
      skipEl.style.opacity = (!choosing && t > skipAt && t < endAt - 0.8) ? 0.55 : 0;
      if (fadeOut) { const k = Math.min(1, (performance.now() - fadeOut) / 450); g.fillStyle = `rgba(0,0,0,${k})`; g.fillRect(0, 0, W, Hh); cc.style.opacity = Math.min(parseFloat(cc.style.opacity) || 0, 1 - k); }
      if (t >= endAt && !(def.hold && !choosing)) finish();
    };
    let raf = requestAnimationFrame(loop);
  });
}
async function runFinale() {
  let chosen = null;
  await playScene('finale', { onChoice: (id) => { chosen = id; } });
  if (!chosen) return;
  H.send({ t: 'ending', id: chosen }); H.onEnding(chosen);
  await playScene(chosen === 'lord' ? 'end_lord' : 'end_keeper', {});
  await playScene('last', {});
  H.banner((chosen === 'lord' ? '👑 ' + tx().titleLord : '🌟 ' + tx().titleKeeper), 5200);
}
Story.runFinale = runFinale;

// ------------------------------------------------------------------ 3D-украшения гнезда: осколки, Сердце, корона, светящееся яйцо, кусты и кораллы
const glowTex = (() => { let t = null; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), q = g.createRadialGradient(32, 32, 0, 32, 32, 32); q.addColorStop(0, 'rgba(255,255,255,1)'); q.addColorStop(0.3, 'rgba(255,255,255,.45)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(0, 0, 64, 64); t = new THREE.CanvasTexture(c); return t; }; })();
const sprite = (col, size, op) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col, transparent: true, opacity: op == null ? 0.6 : op, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); return s; };
function shardMesh(col, size) {
  const g = new THREE.Group(), geo = new THREE.OctahedronGeometry(1, 0); geo.scale(0.34, 1, 0.34);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.3, flatShading: true })); g.add(m); g.add(sprite(col, 3.4, 0.55)); g.scale.setScalar(size); g.userData.m = m; return g;
}
function heartMesh() {
  const g = new THREE.Group(), sh = new THREE.Shape(); sh.moveTo(0, -0.95); sh.bezierCurveTo(1.5, -0.05, 1.25, 1.0, 0.5, 0.95); sh.bezierCurveTo(0.2, 0.93, 0, 0.7, 0, 0.5); sh.bezierCurveTo(0, 0.7, -0.2, 0.93, -0.5, 0.95); sh.bezierCurveTo(-1.25, 1.0, -1.5, -0.05, 0, -0.95);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.18, bevelSegments: 2, curveSegments: 10 }); geo.center();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xff6a3a, emissive: 0xff3a1a, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.2, flatShading: true })); g.add(m); g.add(sprite(0xff7a4a, 5, 0.7)); g.add(sprite(0xffd37a, 3, 0.5)); return g;
}
export class Decor {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.key = ''; this.items = []; }
  dispose() { this.scene.remove(this.group); this.group.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }); }
  sync(S, W, profile) {
    const st = Story.stat(profile), key = [S.biome, st.land, st.sea, st.ending, W.nestInfo ? 1 : 0].join('|'); if (key === this.key) return; this.key = key;
    this.group.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }); this.group.clear(); this.items = [];
    const ni = W.nestInfo, sim = S.W, have = new Set(CONFIG.allKings(profile));
    if (ni) {
      const cx = ni.x, cz = ni.z, cy = ni.y, R = 4.6;
      if (st.ending === 'keeper') {
        const egg = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffe9a0, emissiveIntensity: 1.1, roughness: 0.5 })); egg.scale.set(0.8, 1.05, 0.8); egg.position.set(cx, cy + 1.05, cz); this.group.add(egg);
        const gl = sprite(0xffe9a0, 9, 0.5); gl.position.set(cx, cy + 1.4, cz); this.group.add(gl); this.items.push({ o: gl, k: 'pulse', base: 9 });
      }
      let n = 0; LAND.forEach((b, i) => { if (!have.has(b)) return; const s = shardMesh(SHARD_COL[b], 0.9); const a = (i / 6) * Math.PI * 2 + 0.4; s.position.set(cx + Math.cos(a) * R, cy + 1.3, cz + Math.sin(a) * R); this.group.add(s); this.items.push({ o: s, k: 'shard', a, R, cx, cz, y: cy + 1.3, i }); n++; });
      if (st.sea >= 5 && st.ending !== 'lord') { const h = heartMesh(); h.scale.setScalar(0.9); h.position.set(cx, cy + 3.2, cz); this.group.add(h); this.items.push({ o: h, k: 'heart', y: cy + 3.2 }); }
      if (st.ending === 'lord') {
        const crown = new THREE.Group(); const band = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 8, 28), new THREE.MeshStandardMaterial({ color: 0xffd35a, emissive: 0xffa010, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.3 })); band.rotation.x = Math.PI / 2; crown.add(band);
        LAND.forEach((b, i) => { const s = shardMesh(SHARD_COL[b], 0.9); const a = (i / 6) * Math.PI * 2; s.position.set(Math.cos(a) * 1.5, 0.9, Math.sin(a) * 1.5); crown.add(s); });
        const gl = sprite(0xffd35a, 10, 0.55); gl.position.y = 0.6; crown.add(gl); crown.position.set(cx, cy + 3.4, cz); this.group.add(crown); this.items.push({ o: crown, k: 'crown', y: cy + 3.4 });
      }
    }
    if (st.ending === 'keeper') {   // новая жизнь: светящиеся кусты (суша) и кораллы (океан)
      const ox = ni ? ni.x : 0, oz = ni ? ni.z : 0, sea = !!sim.ocean, r = (function (a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(91);
      const cols = sea ? [0x7affd8, 0xff7ad8, 0x7ab8ff, 0xffe27a] : [0x7affc8, 0x9aff7a, 0x7ad8ff, 0xd89aff], cnt = sea ? 46 : 38;
      for (let i = 0; i < cnt; i++) {
        const a = r() * Math.PI * 2, rad = (sea ? 10 + r() * 55 : 7 + r() * 22), x = ox + Math.cos(a) * rad, z = oz + Math.sin(a) * rad, gh = S.world && S.world.meshH ? S.world.meshH : sim.heightAt, y = gh(x, z); if (!sea && sim.isWater && sim.isWater(x, z)) continue;
        const col = cols[i % cols.length], g = new THREE.Group();
        if (sea) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2 + r() * 1.2, 7), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.0, roughness: 0.5 })); m.position.y = 0.6; g.add(m); for (let k = 0; k < 2; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), m.material); b.position.set((r() - 0.5) * 0.8, 0.9 + r() * 0.8, (r() - 0.5) * 0.8); g.add(b); } }
        else { const m = new THREE.Mesh(new THREE.SphereGeometry(0.8 + r() * 0.6, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2e8f4a, emissive: col, emissiveIntensity: 0.55, roughness: 0.8 })); m.scale.y = 0.75; m.position.y = 0.55; g.add(m); for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), new THREE.MeshBasicMaterial({ color: col })); b.position.set((r() - 0.5) * 1.3, 0.5 + r() * 0.7, (r() - 0.5) * 1.3); g.add(b); } }
        const gl = sprite(col, 3.2, 0.5); gl.position.y = 1.0; g.add(gl); g.position.set(x, y, z); this.group.add(g); this.items.push({ o: gl, k: 'pulse', base: 3.2, ph: r() * 6 });
      }
    }
  }
  update(t) {
    for (const it of this.items) {
      if (it.k === 'shard') { const a = it.a + t * 0.12; it.o.position.set(it.cx + Math.cos(a) * it.R, it.y + Math.sin(t * 1.4 + it.i) * 0.18, it.cz + Math.sin(a) * it.R); it.o.rotation.y = t * 0.9 + it.i; }
      else if (it.k === 'heart') { const b = 1 + 0.08 * Math.pow(Math.max(0, Math.sin(t * 4.5)), 6); it.o.scale.setScalar(0.9 * b); it.o.position.y = it.y + Math.sin(t * 1.1) * 0.15; it.o.rotation.y = t * 0.5; }
      else if (it.k === 'crown') { it.o.rotation.y = t * 0.4; it.o.position.y = it.y + Math.sin(t * 1.2) * 0.12; }
      else if (it.k === 'pulse') { const s = it.base * (0.85 + 0.15 * Math.sin(t * 1.7 + (it.ph || 0))); it.o.scale.setScalar(s); }
    }
  }
}

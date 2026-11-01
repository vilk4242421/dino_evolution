/* Рисованные иконки меню в «мобильном» стиле: толстый тёмный контур, сочные градиенты, глянцевый блик, мягкая тень.
   ICON(name, size) → строка SVG. Все рисунки в поле 100×100, у каждого свои id градиентов (несколько копий на странице не конфликтуют). */
let _n = 0;
const OL = '#1d1430';                                    // контур
const lg = (id, a, b, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const rg = (id, a, b) => `<radialGradient id="${id}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
const shadow = (cy = 92, rx = 30) => `<ellipse cx="50" cy="${cy}" rx="${rx}" ry="5" fill="#000" opacity=".28"/>`;
const S = `stroke="${OL}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
const gloss = (d) => `<path d="${d}" fill="#fff" opacity=".45"/>`;

const DRAW = {
  // ▶ играть: зелёный скруглённый треугольник
  play: (u) => `<defs>${lg(u + 'a', '#9cf55a', '#22a83a')}</defs>${shadow(93, 26)}
    <path d="M30 14 Q22 10 22 20 L22 80 Q22 90 30 86 L84 56 Q92 50 84 44 Z" fill="url(#${u}a)" ${S}/>
    ${gloss('M30 22 Q28 19 30 18 L70 40 Q60 40 44 46 Q34 50 30 56 Z')}`,
  // шестерёнка
  gear: (u) => {
    let d = ''; const N = 8, R1 = 40, R2 = 30;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, w = 0.2, p = (r, a) => `${(50 + Math.cos(a) * r).toFixed(1)} ${(50 + Math.sin(a) * r).toFixed(1)}`;
      d += (i ? 'L' : 'M') + p(R2, a0 - 0.36) + ' L' + p(R1, a0 - w) + ' L' + p(R1, a0 + w) + ' L' + p(R2, a0 + 0.36) + ' ';
    }
    return `<defs>${lg(u + 'a', '#c9d2ff', '#6a74c8')}${lg(u + 'b', '#3a3f7a', '#5d64b0')}</defs>${shadow(93, 30)}
    <path d="${d}Z" fill="url(#${u}a)" ${S}/><circle cx="50" cy="50" r="12" fill="url(#${u}b)" ${S}/>
    ${gloss('M28 36 Q34 22 50 20 Q40 26 36 38 Z')}`;
  },
  // кубок
  trophy: (u) => `<defs>${lg(u + 'a', '#ffe36a', '#e08a12')}${lg(u + 'b', '#c97a1a', '#7a4410')}</defs>${shadow(94, 26)}
    <path d="M30 22 Q12 22 14 38 Q16 52 34 54" fill="none" stroke="${OL}" stroke-width="13" stroke-linecap="round"/><path d="M30 22 Q12 22 14 38 Q16 52 34 54" fill="none" stroke="url(#${u}a)" stroke-width="5" stroke-linecap="round"/>
    <path d="M70 22 Q88 22 86 38 Q84 52 66 54" fill="none" stroke="${OL}" stroke-width="13" stroke-linecap="round"/><path d="M70 22 Q88 22 86 38 Q84 52 66 54" fill="none" stroke="url(#${u}a)" stroke-width="5" stroke-linecap="round"/>
    <path d="M26 14 L74 14 L72 40 Q70 62 50 66 Q30 62 28 40 Z" fill="url(#${u}a)" ${S}/>
    <path d="M44 64 L56 64 L58 76 L42 76 Z" fill="url(#${u}a)" ${S}/>
    <rect x="30" y="76" width="40" height="12" rx="3" fill="url(#${u}b)" ${S}/>
    ${gloss('M33 19 L46 19 Q42 34 44 54 Q34 48 33 36 Z')}`,
  // выход: красная дверь со стрелкой
  exit: (u) => `<defs>${lg(u + 'a', '#ff6a5a', '#b81c2a')}${lg(u + 'b', '#ffffff', '#ffd0c8')}</defs>${shadow(93, 26)}
    <rect x="18" y="10" width="44" height="80" rx="5" fill="url(#${u}a)" ${S}/><circle cx="52" cy="52" r="4" fill="#ffd35a" ${S}/>
    <path d="M52 40 L72 40 L72 30 L92 50 L72 70 L72 60 L52 60 Z" fill="url(#${u}b)" ${S}/>
    ${gloss('M24 16 L40 16 L34 60 L24 70 Z')}`,
  // глобус
  globe: (u) => `<defs>${rg(u + 'a', '#8ee0ff', '#1f6fd0')}${lg(u + 'b', '#8ef06a', '#2e9a3a')}</defs>${shadow(94, 28)}
    <circle cx="50" cy="48" r="38" fill="url(#${u}a)" ${S}/>
    <path d="M24 30 Q34 22 44 28 Q50 34 42 40 Q36 46 40 54 Q38 62 30 60 Q22 50 24 30 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M56 18 Q70 20 78 34 Q70 36 64 32 Q58 30 56 18 Z M58 50 Q70 44 80 52 Q80 66 68 76 Q62 70 64 62 Q56 58 58 50 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M26 26 Q38 12 56 12 Q40 18 32 34 Z')}`,
  // ключ
  key: (u) => `<defs>${lg(u + 'a', '#fff08a', '#e0941a')}</defs>${shadow(94, 28)}
    <circle cx="32" cy="34" r="20" fill="url(#${u}a)" ${S}/><circle cx="32" cy="34" r="7" fill="#7a4a10" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M44 48 L82 84 L74 92 L68 86 L62 92 L56 86 L60 80 L36 56 Z" fill="url(#${u}a)" ${S}/>
    ${gloss('M18 30 Q20 18 32 16 Q24 22 24 32 Z')}`,
  // арена: колизей из оранжевого камня с арками и флажками
  arena: (u) => `<defs>${lg(u + 'a', '#ffc27a', '#c8622a')}${lg(u + 'b', '#ffd9a0', '#e08a3a')}${lg(u + 'c', '#ff5a5a', '#c41a2a')}</defs>${shadow(94, 38)}
    <path d="M12 36 Q50 20 88 36 L88 84 Q50 94 12 84 Z" fill="url(#${u}a)" ${S}/>
    <path d="M12 36 Q50 20 88 36 Q50 50 12 36 Z" fill="url(#${u}b)" ${S}/>
    ${[18, 31, 44, 57, 70].map(x => `<path d="M${x + 1} 58 L${x + 1} 50 Q${x + 6} 43 ${x + 11} 50 L${x + 11} 58 Z" fill="#5a2a14" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    ${[18, 31, 44, 57, 70].map(x => `<path d="M${x + 1} 84 L${x + 1} 72 Q${x + 6} 64 ${x + 11} 72 L${x + 11} 85 Z" fill="#5a2a14" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <path d="M30 26 L30 8 L44 13 L30 18 M70 26 L70 8 L84 13 L70 18" fill="url(#${u}c)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M16 38 Q30 30 46 28 Q30 36 22 46 Z')}`,
  // круговые стрелки (сменить)
  swap: (u) => `<defs>${lg(u + 'a', '#7ae0ff', '#1a7ad0')}${lg(u + 'b', '#9cf55a', '#23963a')}</defs>${shadow(93, 28)}
    <path d="M18 46 Q20 18 50 16 Q68 16 78 28 L86 20 L88 48 L60 46 L68 38 Q62 30 50 30 Q34 30 32 46 Z" fill="url(#${u}a)" ${S}/>
    <path d="M82 54 Q80 82 50 84 Q32 84 22 72 L14 80 L12 52 L40 54 L32 62 Q38 70 50 70 Q66 70 68 54 Z" fill="url(#${u}b)" ${S}/>`,
  // игроки
  people: (u) => `<defs>${lg(u + 'a', '#8ad0ff', '#2a6ad0')}${lg(u + 'b', '#ffb07a', '#d8642a')}${lg(u + 'c', '#ffe0c0', '#e8b088')}</defs>${shadow(94, 34)}
    <circle cx="66" cy="32" r="13" fill="url(#${u}c)" ${S}/><path d="M46 84 Q46 52 66 52 Q86 52 86 84 Z" fill="url(#${u}b)" ${S}/>
    <circle cx="38" cy="34" r="15" fill="url(#${u}c)" ${S}/><path d="M12 88 Q12 54 38 54 Q64 54 64 88 Z" fill="url(#${u}a)" ${S}/>
    ${gloss('M18 80 Q20 62 32 58 Q24 68 24 80 Z')}`,
  // книга (сюжет)
  book: (u) => `<defs>${lg(u + 'a', '#c07aff', '#5a2aa8')}${lg(u + 'b', '#ffffff', '#e8dcc0')}</defs>${shadow(94, 34)}
    <path d="M10 24 Q30 16 50 26 Q70 16 90 24 L90 82 Q70 74 50 84 Q30 74 10 82 Z" fill="url(#${u}a)" ${S}/>
    <path d="M16 22 Q32 16 48 24 L48 76 Q32 68 16 74 Z M84 22 Q68 16 52 24 L52 76 Q68 68 84 74 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M22 34 L42 36 M22 44 L42 46 M22 54 L40 56 M58 36 L78 34 M58 46 L78 44 M58 56 L76 54" stroke="#9a8a6a" stroke-width="3" stroke-linecap="round"/>`,
  // карта (локации)
  map: (u) => `<defs>${lg(u + 'a', '#fff0c0', '#e0c080')}${lg(u + 'b', '#8ef06a', '#3aa83a')}</defs>${shadow(94, 36)}
    <path d="M10 22 L36 12 L64 22 L90 12 L90 78 L64 88 L36 78 L10 88 Z" fill="url(#${u}a)" ${S}/>
    <path d="M36 12 L36 78 M64 22 L64 88" stroke="${OL}" stroke-width="3" opacity=".5"/>
    <path d="M18 60 Q30 40 46 52 Q56 60 70 42" fill="none" stroke="#c43a2a" stroke-width="4" stroke-dasharray="6 5" stroke-linecap="round"/>
    <path d="M70 26 Q80 26 80 36 Q80 44 70 54 Q60 44 60 36 Q60 26 70 26 Z" fill="#e8343a" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="70" cy="36" r="4" fill="#fff"/>`,
  // домик (в главное меню)
  home: (u) => `<defs>${lg(u + 'a', '#ff7a5a', '#c42a2a')}${lg(u + 'b', '#fff0c0', '#e0c080')}${lg(u + 'c', '#8ad0ff', '#2a6ad0')}</defs>${shadow(94, 34)}
    <path d="M20 48 L20 88 L80 88 L80 48 Z" fill="url(#${u}b)" ${S}/><rect x="42" y="62" width="16" height="26" rx="3" fill="url(#${u}c)" stroke="${OL}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M8 52 L50 14 L92 52 L82 58 L50 30 L18 58 Z" fill="url(#${u}a)" ${S}/>
    ${gloss('M20 48 L50 20 L46 30 L24 50 Z')}`,
  // гнездо с яйцами
  nest: (u) => `<defs>${lg(u + 'a', '#d8a060', '#7a4a1a')}${rg(u + 'b', '#ffffff', '#9ae0c8')}${rg(u + 'c', '#fff6d0', '#e8c070')}</defs>${shadow(94, 38)}
    <ellipse cx="38" cy="50" rx="14" ry="18" fill="url(#${u}b)" ${S}/><ellipse cx="62" cy="48" rx="14" ry="19" fill="url(#${u}c)" ${S}/>
    <path d="M8 56 Q50 46 92 56 Q88 86 50 88 Q12 86 8 56 Z" fill="url(#${u}a)" ${S}/>
    <path d="M14 62 Q50 54 86 62 M18 72 Q50 64 82 72" fill="none" stroke="${OL}" stroke-width="3" opacity=".55"/>
    ${gloss('M30 38 Q34 32 40 32 Q34 38 34 46 Z')}`,
  // лапа (питомцы)
  paw: (u) => `<defs>${rg(u + 'a', '#ffc08a', '#d0642a')}</defs>${shadow(94, 26)}
    <path d="M50 46 Q72 46 76 70 Q78 86 62 84 Q56 82 50 82 Q44 82 38 84 Q22 86 24 70 Q28 46 50 46 Z" fill="url(#${u}a)" ${S}/>
    <ellipse cx="20" cy="44" rx="9" ry="12" fill="url(#${u}a)" ${S}/><ellipse cx="38" cy="24" rx="9" ry="12" fill="url(#${u}a)" ${S}/>
    <ellipse cx="62" cy="24" rx="9" ry="12" fill="url(#${u}a)" ${S}/><ellipse cx="80" cy="44" rx="9" ry="12" fill="url(#${u}a)" ${S}/>`,
  // палитра (цвет)
  palette: (u) => `<defs>${lg(u + 'a', '#ffe8c0', '#d8a868')}</defs>${shadow(94, 36)}
    <path d="M50 10 Q90 10 92 46 Q92 62 76 60 Q62 58 64 72 Q66 88 48 88 Q10 86 8 50 Q8 10 50 10 Z" fill="url(#${u}a)" ${S}/>
    <circle cx="30" cy="40" r="8" fill="#e8343a" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="48" cy="26" r="8" fill="#ffd35a" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="70" cy="32" r="8" fill="#3ac24a" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="30" cy="64" r="8" fill="#3a8aff" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
  // искры (эффекты)
  sparkle: (u) => `<defs>${lg(u + 'a', '#fff6a0', '#ffb01a')}${lg(u + 'b', '#c0f0ff', '#5ab0ff')}</defs>${shadow(94, 24)}
    <path d="M44 10 Q48 38 74 44 Q48 50 44 82 Q40 50 14 44 Q40 38 44 10 Z" fill="url(#${u}a)" ${S}/>
    <path d="M78 10 Q80 22 90 24 Q80 26 78 38 Q76 26 66 24 Q76 22 78 10 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M78 62 Q79 70 86 72 Q79 74 78 82 Q77 74 70 72 Q77 70 78 62 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  // яйцо
  egg: (u) => `<defs>${rg(u + 'a', '#ffffff', '#9ae08a')}</defs>${shadow(94, 26)}
    <path d="M50 8 Q78 8 80 54 Q80 88 50 88 Q20 88 20 54 Q22 8 50 8 Z" fill="url(#${u}a)" ${S}/>
    <circle cx="40" cy="44" r="6" fill="#4aa83a" opacity=".7"/><circle cx="60" cy="62" r="8" fill="#4aa83a" opacity=".7"/><circle cx="58" cy="32" r="4" fill="#4aa83a" opacity=".7"/>
    ${gloss('M32 26 Q40 14 50 14 Q40 22 36 40 Z')}`,
  // корона
  crown: (u) => `<defs>${lg(u + 'a', '#fff08a', '#e0941a')}</defs>${shadow(92, 34)}
    <path d="M12 30 L30 52 L50 18 L70 52 L88 30 L82 80 L18 80 Z" fill="url(#${u}a)" ${S}/>
    <circle cx="50" cy="62" r="7" fill="#e8343a" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="30" cy="66" r="5" fill="#3a8aff" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="70" cy="66" r="5" fill="#3ac24a" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M20 40 L30 54 L42 34 L36 60 L22 62 Z')}`,
  // график (рейтинг)
  chart: (u) => `<defs>${lg(u + 'a', '#9cf55a', '#23963a')}${lg(u + 'b', '#ffe36a', '#e08a12')}${lg(u + 'c', '#7ae0ff', '#1a7ad0')}</defs>${shadow(94, 34)}
    <rect x="14" y="56" width="18" height="32" rx="3" fill="url(#${u}c)" ${S}/><rect x="41" y="40" width="18" height="48" rx="3" fill="url(#${u}b)" ${S}/><rect x="68" y="20" width="18" height="68" rx="3" fill="url(#${u}a)" ${S}/>
    <path d="M14 44 L44 24 L60 32 L84 10" fill="none" stroke="${OL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 44 L44 24 L60 32 L84 10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  // монета
  coin: (u) => `<defs>${rg(u + 'a', '#fff6a0', '#e0941a')}</defs>${shadow(93, 28)}
    <circle cx="50" cy="48" r="38" fill="url(#${u}a)" ${S}/><circle cx="50" cy="48" r="27" fill="none" stroke="#b8700e" stroke-width="4"/>
    <path d="M50 30 L55 42 L68 42 L58 50 L62 63 L50 55 L38 63 L42 50 L32 42 L45 42 Z" fill="#fff0b0" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M20 40 Q24 18 46 12 Q30 22 28 42 Z')}`,
  // ДНК
  dna: (u) => {
    let a = '', b = '', rungs = '';
    for (let i = 0; i <= 20; i++) { const y = 10 + i * 4, x = 50 + Math.sin(i / 20 * Math.PI * 2.2) * 22; a += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y; b += (i ? 'L' : 'M') + (100 - x).toFixed(1) + ' ' + y;
      if (i % 3 === 1) rungs += `<path d="M${x.toFixed(1)} ${y} L${(100 - x).toFixed(1)} ${y}" stroke="${OL}" stroke-width="8" stroke-linecap="round"/><path d="M${x.toFixed(1)} ${y} L${(100 - x).toFixed(1)} ${y}" stroke="${i % 2 ? '#ffd35a' : '#7ae0ff'}" stroke-width="3.5" stroke-linecap="round"/>`; }
    return `<defs>${lg(u + 'a', '#ff8ad0', '#c0307a')}${lg(u + 'b', '#8ad8ff', '#2a6ad0')}</defs>${shadow(95, 22)}${rungs}
    <path d="${a}" fill="none" stroke="${OL}" stroke-width="13" stroke-linecap="round"/><path d="${a}" fill="none" stroke="url(#${u}a)" stroke-width="7" stroke-linecap="round"/>
    <path d="${b}" fill="none" stroke="${OL}" stroke-width="13" stroke-linecap="round"/><path d="${b}" fill="none" stroke="url(#${u}b)" stroke-width="7" stroke-linecap="round"/>`;
  },
  // боксёрская перчатка
  glove: (u) => `<defs>${rg(u + 'a', '#ff8a7a', '#c41a24')}${lg(u + 'b', '#ffffff', '#c8d0e0')}</defs>${shadow(94, 26)}
    <path d="M30 30 Q30 10 54 10 Q82 10 84 36 Q86 58 70 64 L70 70 L34 70 L32 58 Q18 56 16 44 Q14 32 26 32 Z" fill="url(#${u}a)" ${S}/>
    <path d="M26 34 Q38 36 40 48" fill="none" stroke="${OL}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <rect x="30" y="68" width="44" height="22" rx="5" fill="url(#${u}b)" ${S}/>
    ${gloss('M38 18 Q50 12 64 16 Q50 20 44 32 Q38 28 38 18 Z')}`,
  // медаль
  medal: (u) => `<defs>${lg(u + 'a', '#ff5a6a', '#b0182a')}${lg(u + 'b', '#5ab0ff', '#1a5ac0')}${rg(u + 'c', '#fff09a', '#d8860e')}</defs>${shadow(95, 24)}
    <path d="M28 6 L46 6 L56 44 L40 48 Z" fill="url(#${u}a)" ${S}/><path d="M72 6 L54 6 L44 44 L60 48 Z" fill="url(#${u}b)" ${S}/>
    <circle cx="50" cy="64" r="26" fill="url(#${u}c)" ${S}/>
    <path d="M50 50 L54 60 L65 60 L56 67 L60 78 L50 71 L40 78 L44 67 L35 60 L46 60 Z" fill="#fff6c8" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M30 60 Q34 44 50 40 Q38 48 36 62 Z')}`,
  // календарь
  calendar: (u) => `<defs>${lg(u + 'a', '#ffffff', '#d8e0ee')}${lg(u + 'b', '#ff7a6a', '#c4243a')}</defs>${shadow(94, 30)}
    <rect x="14" y="16" width="72" height="72" rx="10" fill="url(#${u}a)" ${S}/>
    <path d="M14 26 Q14 16 24 16 L76 16 Q86 16 86 26 L86 38 L14 38 Z" fill="url(#${u}b)" ${S}/>
    <rect x="28" y="8" width="8" height="18" rx="4" fill="#6a7088" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><rect x="64" y="8" width="8" height="18" rx="4" fill="#6a7088" stroke="${OL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M32 62 L44 74 L70 48" fill="none" stroke="${OL}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 62 L44 74 L70 48" fill="none" stroke="#3ac24a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    ${gloss('M20 22 Q22 19 26 19 L46 19 L40 30 L20 34 Z')}`,
  // магазин: лавка с полосатым навесом
  shop: (u) => `<defs>${lg(u + 'a', '#ffd88a', '#c07a2a')}${lg(u + 'b', '#7ad0ff', '#2a7ad0')}</defs>${shadow(94, 34)}
    <rect x="18" y="44" width="64" height="44" rx="4" fill="url(#${u}a)" ${S}/><rect x="40" y="58" width="20" height="30" rx="3" fill="url(#${u}b)" stroke="${OL}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M10 44 L18 14 L82 14 L90 44 Q82 52 74 44 Q66 52 58 44 Q50 52 42 44 Q34 52 26 44 Q18 52 10 44 Z" fill="#fff" ${S}/>
    <path d="M26 44 L30 14 L42 14 L42 44 Q34 52 26 44 Z M58 44 L58 14 L70 14 L74 44 Q66 52 58 44 Z" fill="#e8343a" stroke="none"/>
    <path d="M10 44 L18 14 L82 14 L90 44 Q82 52 74 44 Q66 52 58 44 Q50 52 42 44 Q34 52 26 44 Q18 52 10 44 Z" fill="none" ${S}/>
    ${gloss('M20 18 L36 18 L30 36 L16 38 Z')}`,
  // гардероб: цилиндр
  hat: (u) => `<defs>${lg(u + 'a', '#a07aff', '#4a2aa8')}${lg(u + 'b', '#ff6a8a', '#c41a4a')}</defs>${shadow(93, 36)}
    <ellipse cx="50" cy="76" rx="40" ry="12" fill="url(#${u}a)" ${S}/>
    <path d="M28 76 L30 18 Q50 10 70 18 L72 76 Q50 84 28 76 Z" fill="url(#${u}a)" ${S}/>
    <path d="M29 58 Q50 66 71 58 L71.5 68 Q50 76 28.5 68 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M34 22 Q42 17 50 16 L44 54 L34 52 Z')}`,
  // динозавр (одиночная игра)
  dino: (u) => `<defs>${lg(u + 'a', '#9cf55a', '#23963a')}${lg(u + 'b', '#fff6c8', '#e8d090')}</defs>${shadow(94, 34)}
    <path d="M12 84 Q20 66 30 60 Q22 46 30 32 Q38 16 60 16 Q86 16 88 36 Q90 50 74 50 L60 50 Q66 60 64 72 L70 88 L58 88 L52 76 Q44 80 36 78 L34 88 L22 88 L24 80 Q18 84 12 84 Z" fill="url(#${u}a)" ${S}/>
    <path d="M62 42 L84 42 Q86 48 78 48 L62 48 Z" fill="url(#${u}b)" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="66" cy="28" r="6" fill="#fff" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="68" cy="28" r="3" fill="${OL}"/>
    <path d="M34 22 L28 12 L40 18 M44 16 L42 6 L52 14" fill="#ffd35a" stroke="${OL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${gloss('M34 34 Q40 22 54 20 Q44 28 40 40 Z')}`,
  // назад
  back: (u) => `<defs>${lg(u + 'a', '#c9d2e8', '#6a7898')}</defs>${shadow(92, 26)}
    <path d="M14 50 L46 18 L46 36 L84 36 Q90 36 90 42 L90 58 Q90 64 84 64 L46 64 L46 82 Z" fill="url(#${u}a)" ${S}/>
    ${gloss('M22 48 L42 28 L42 40 L80 40 L80 46 L40 46 Z')}`
};
export function ICON(name, size) {
  const f = DRAW[name]; if (!f) return '';
  const u = 'ic' + (++_n) + '_';
  return `<svg class="gic" viewBox="0 0 100 100" width="${size || 28}" height="${size || 28}" aria-hidden="true">${f(u)}</svg>`;
}
export const ICON_NAMES = Object.keys(DRAW);

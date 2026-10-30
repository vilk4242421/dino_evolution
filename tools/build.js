'use strict';
/* Склеивает ES-модули клиента (game/*.js + vendor/three.module.js) в один обычный скрипт game/bundle.js,
   чтобы игра открывалась двойным кликом по index.html (file://) без сервера. Запуск: node tools/build.js */
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', 'game');
const mods = { three: path.join(G, 'vendor', 'three.module.js') };
['profile', 'sounddsp', 'audio', 'trike', 'rex', 'ptn', 'vel', 'para', 'bra', 'shk', 'mos', 'plio', 'scp', 'lzd', 'crn', 'steg', 'comp', 'troo', 'herr', 'ples', 'kom', 'spn', 'croc', 'qtz', 'ich', 'ang', 'dinos', 'biomekit', 'dinonest', 'treekit', 'world', 'storyart', 'story', 'net', 'clsicons', 'ui', 'game'].forEach(n => mods[n] = path.join(G, n + '.js'));
const key = s => s === 'three' ? 'three' : path.basename(s, '.js');
let out = '/* Dino Evolution — собранный клиент (node tools/build.js). Не редактировать вручную. */\n(function(){\n"use strict";\nvar __m={};\n';
for (const name of Object.keys(mods)) {
  let src = fs.readFileSync(mods[name], 'utf8'), names = [], pre = '';
  src = src.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';?[ \t]*$/gm, (_, v, f) => { pre += `var ${v}=__m[${JSON.stringify(key(f))}];\n`; return ''; });
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s+'([^']+)';?[ \t]*$/gm, (_, list, f) => {
    pre += 'var ' + list.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(/\s+as\s+/); return (b || a) + `=__m[${JSON.stringify(key(f))}].${a}`; }).join(',') + ';\n'; return '';
  });
  let ret = '';
  const tail = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (tail) {
    src = src.slice(0, tail.index);
    ret = tail[1].split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(/\s+as\s+/); return JSON.stringify(b || a) + ':' + a; }).join(',');
  }
  src = src.replace(/^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (_, l) => { l.split(',').map(s => s.trim()).filter(Boolean).forEach(s => { const [a, b] = s.split(/\s+as\s+/); names.push([b || a, a]); }); return ''; });
  src = src.replace(/(?<=^|[;}]\s*)export\s+(async\s+function|function|const|let|class)\s+(\w+)/gm, (_, k, n) => { names.push([n, n]); return k + ' ' + n; });
  src = src.replace(/^export\s+const\s+(\w+)\s*=\s*([^;]*);\s*export\s+const\s+(\w+)/gm, m => m);
  if (/^\s*export\b/m.test(src)) throw new Error('необработанный export в ' + name);
  const extra = names.map(([e, l]) => JSON.stringify(e) + ':' + l).join(',');
  out += `__m[${JSON.stringify(name)}]=(function(){\n${pre}${src}\nreturn {${[ret, extra].filter(Boolean).join(',')}};\n})();\n`;
}
out += '})();\n';
fs.writeFileSync(path.join(G, 'bundle.js'), out);
console.log('game/bundle.js: ' + (out.length / 1024 | 0) + ' КБ');

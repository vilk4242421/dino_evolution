'use strict';
/* Версия для превью-артефакта (лимит 16 МБ на файл): index.html + скрипты отдельными файлами, bundle.js разрезан на части (≤ ~12 МБ) по границе модулей.
   Запуск: node tools/build.js && node tools/multi.js  →  dist/multi/ */
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', 'game'), OUT = path.join(__dirname, '..', 'dist', 'multi');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let html = fs.readFileSync(path.join(G, 'index.html'), 'utf8');
const uri = n => 'data:image/png;base64,' + fs.readFileSync(path.join(G, n)).toString('base64');
html = html.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, '').replace(/<meta name="msapplication[^>]*>\s*/g, '').replace(/<link rel="manifest"[^>]*>\s*/g, '');
html = html.replace('<title>', '<link rel="icon" type="image/png" href="' + uri('icon-32.png') + '">\n<title>');
const b = fs.readFileSync(path.join(G, 'bundle.js'), 'utf8');
const head = b.slice(0, b.indexOf('__m["') ), tail = '})();\n';
const body = b.slice(head.length, b.length - tail.length);
const cuts = []; const re = /\n__m\["[^"]+"\]=\(function\(\)\{/g; let m; while ((m = re.exec(body))) cuts.push(m.index + 1);
const NP = Math.max(2, Math.ceil(body.length / 12e6)), parts = [0];             // сколько частей нужно, чтобы каждая была ≤ ~12 МБ (лимит артефакта 16 МБ на файл)
for (let k = 1; k < NP; k++) { const tgt = body.length * k / NP; parts.push(cuts.reduce((a, c) => Math.abs(c - tgt) < Math.abs(a - tgt) ? c : a, cuts[0])); }
parts.push(body.length);
for (let k = 0; k < NP; k++) {
  const pre = k === 0 ? head.replace('var __m={};', 'var __m=window.__dm={};') : '(function(){\n"use strict";\nvar __m=window.__dm;\n';
  fs.writeFileSync(path.join(OUT, 'bundle' + (k + 1) + '.js'), pre + body.slice(parts[k], parts[k + 1]) + tail);
}
html = html.replace('<script src="bundle.js"', Array.from({ length: NP }, (_, k) => '<script src="bundle' + (k + 1) + '.js"').join('></script>\n'));
fs.writeFileSync(path.join(OUT, 'index.html'), html);
const others = ['config.js', 'sim.js', 'rooms.js', 'ai.js', 'boss.js', 'duel.js', 'i18n.js'];
others.forEach(f => fs.copyFileSync(path.join(G, f), path.join(OUT, f)));
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);

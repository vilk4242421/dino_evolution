'use strict';
/* Версия для превью-артефакта (лимит 16 МБ на файл): index.html + скрипты отдельными файлами, bundle.js разрезан на две части по границе модулей.
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
const mid = body.length / 2; let cut = cuts.reduce((a, c) => Math.abs(c - mid) < Math.abs(a - mid) ? c : a, cuts[0]);
fs.writeFileSync(path.join(OUT, 'bundle1.js'), head.replace('var __m={};', 'var __m=window.__dm={};') + body.slice(0, cut) + tail);
fs.writeFileSync(path.join(OUT, 'bundle2.js'), '(function(){\n"use strict";\nvar __m=window.__dm;\n' + body.slice(cut) + tail);
html = html.replace('<script src="bundle.js"', '<script src="bundle1.js"></script>\n<script src="bundle2.js"');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
const others = ['config.js', 'sim.js', 'rooms.js', 'ai.js', 'boss.js', 'duel.js', 'i18n.js'];
others.forEach(f => fs.copyFileSync(path.join(G, f), path.join(OUT, f)));
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);

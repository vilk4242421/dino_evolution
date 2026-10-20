'use strict';
/* Собирает всю игру в один файл dist/dino-evolution.html (все скрипты, Three.js и иконка — внутри).
   Удобно для превью и для открытия без сервера: офлайн-режим работает полностью.
   Запуск: node tools/build.js && node tools/single.js */
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', 'game'), OUT = path.join(__dirname, '..', 'dist');
let html = fs.readFileSync(path.join(G, 'index.html'), 'utf8');
const esc = s => s.replace(/<\/script/gi, '<\\/script');
html = html.replace(/<script src="([^"]+)"([^>]*)><\/script>/g, (m, src) => {
  const f = path.join(G, src);
  if (!fs.existsSync(f)) return m;
  return '<script>' + esc(fs.readFileSync(f, 'utf8')) + '\n</script>';
});
const icon = path.join(G, 'icon-192.png');
if (fs.existsSync(icon)) {
  const uri = 'data:image/png;base64,' + fs.readFileSync(icon).toString('base64');
  html = html.replace(/href="icon-192\.png"/g, 'href="' + uri + '"');
}
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'dino-evolution.html'), html);
console.log('dist/dino-evolution.html: ' + (html.length / 1024 | 0) + ' КБ');

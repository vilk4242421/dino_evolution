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
const uri = n => 'data:image/png;base64,' + fs.readFileSync(path.join(G, n)).toString('base64');
html = html.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, '').replace(/<meta name="msapplication[^>]*>\s*/g, '');
if (fs.existsSync(path.join(G, 'icon-192.png'))) {
  html = html.replace('<title>', '<link rel="icon" type="image/png" href="' + uri('icon-32.png') + '">\n<link rel="apple-touch-icon" href="' + uri('apple-touch-icon.png') + '">\n<title>');
}
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'dino-evolution.html'), html);
console.log('dist/dino-evolution.html: ' + (html.length / 1024 | 0) + ' КБ');

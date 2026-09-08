/**
 * Кладёт лендинг внутрь приложения: ../results/landing.html → public/landing.html.
 *
 * Источник правды остаётся один — файл в results/. Здесь только копия, которую
 * отдаёт сервер, и она пересобирается перед каждой сборкой (см. prebuild).
 * Править лендинг нужно в results/, иначе правку затрёт.
 *
 * Панель «Что изменилось» остаётся: пока идёт приёмка, она и есть способ
 * показать, что поменялось. Перед настоящей публикацией её нужно убрать —
 * для этого достаточно поставить STRIP_DEVLOG в true.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../results/landing.html');
const DEST = resolve(here, 'public/landing.html');

// На сервер едет только product-mvp/, папки results/ там нет — и не нужно:
// готовая копия приезжает в public/ вместе со сборкой. Молча выходим, но лишь
// когда копия на месте. Если нет ни исходника, ни копии — это уже поломка,
// и сборка обязана упасть, а не выкатить сайт без главной страницы.
if (!existsSync(SRC)) {
  if (existsSync(DEST)) {
    console.log('лендинг: исходника рядом нет, используем готовую копию public/landing.html');
    process.exit(0);
  }
  console.error(
    'лендинг не найден: нет ни ../results/landing.html, ни public/landing.html — главную страницу отдавать нечем',
  );
  process.exit(1);
}

let html = readFileSync(SRC, 'utf8');
const before = html.length;

/** Вырезает узел целиком по открывающему тегу с нужным id. */
function cutById(source, id) {
  const at = source.indexOf(`id="${id}"`);
  if (at < 0) return { html: source, cut: false };
  const open = source.lastIndexOf('<', at);
  const tag = source.slice(open + 1).match(/^[a-z]+/i)?.[0];
  if (!tag) return { html: source, cut: false };

  // Ищем парный закрывающий тег с учётом вложенности.
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'gi');
  re.lastIndex = open;
  let depth = 0;
  let m;
  while ((m = re.exec(source))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      return { html: source.slice(0, open) + source.slice(m.index + m[0].length), cut: true };
    }
  }
  return { html: source, cut: false };
}

/** Переключатель на день публикации: панель приёмки убрать, лендинг оставить. */
const STRIP_DEVLOG = false;

const cuts = [];
if (STRIP_DEVLOG) {
  for (const id of ['devlog', 'dlOpen']) {
    const r = cutById(html, id);
    html = r.html;
    if (r.cut) cuts.push(id);
  }
  // Обработчик панели без самой панели только мусорит в консоль.
  html = html.replace(
    /\/\* DEV: панель изменений[^]*?\}\)\(\);\n?/,
    '/* DEV-панель «Что изменилось» вырезана при публикации — см. sync-landing.mjs */\n',
  );
  // Стили удалённой панели: незачем возить мёртвый код.
  html = html.replace(
    /\/\* =+ DEV: панель изменений[^]*?\*\/[^]*?(?=\.reveal\{)/,
    '/* стили DEV-панели вырезаны при публикации — см. sync-landing.mjs */\n',
  );
}

writeFileSync(DEST, html, 'utf8');

console.log(
  `лендинг → public/landing.html: ${(before / 1024).toFixed(0)} КБ → ${(html.length / 1024).toFixed(0)} КБ` +
    (STRIP_DEVLOG
      ? cuts.length
        ? ` (вырезано: ${cuts.join(', ')})`
        : ' (dev-панель не найдена — уже убрана?)'
      : ' (панель «Что изменилось» оставлена: идёт приёмка)'),
);

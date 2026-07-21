import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateFingerprint } from './fingerprint';

const card = (name: string, price: string) => `<html><body>
  <div class="product card"><h1 class="product__title">${name}</h1>
  <span class="product__price">${price}</span>
  <button class="btn btn--buy">Купить</button></div></body></html>`;

const article = `<html><body>
  <article class="post"><h1 class="post__title">Новость</h1>
  <p class="post__text">Текст новости</p></article></body></html>`;

test('однотипные карточки товара дают один отпечаток (A)', () => {
  assert.equal(templateFingerprint(card('Дрель', '5000')), templateFingerprint(card('Пила', '9900')));
});

test('другая структура — другой отпечаток (A)', () => {
  assert.notEqual(templateFingerprint(card('Дрель', '5000')), templateFingerprint(article));
});

test('скрипты и стили на отпечаток не влияют (A)', () => {
  const withNoise = card('Дрель', '5000').replace('<body>', '<body><script>var x=1</script><style>.a{}</style>');
  assert.equal(templateFingerprint(withNoise), templateFingerprint(card('Дрель', '5000')));
});

test('пустой HTML не роняет функцию (A, граница)', () => {
  assert.equal(typeof templateFingerprint(''), 'string');
});

test('undefined не роняет функцию и даёт тот же отпечаток, что пустая строка (A, граница)', () => {
  // Код защищается через `html ?? ''` — проверяем сам этот случай, а не
  // только пустую строку.
  assert.equal(
    templateFingerprint(undefined as unknown as string),
    templateFingerprint('')
  );
});

test('null не роняет функцию и даёт тот же отпечаток, что пустая строка (A, граница)', () => {
  assert.equal(
    templateFingerprint(null as unknown as string),
    templateFingerprint('')
  );
});

/* ── Три случая, найденные ревью 2026-07-21. Ради них и переделан подход. ── */

const cardWithBadge = `<html><body>
  <div class="product card"><span class="discount-badge">Скидка</span>
  <h1 class="product__title">Дрель</h1>
  <span class="product__price">5000</span>
  <button class="btn btn--buy">Купить</button></div></body></html>`;

test('необязательный блок «Скидка» не рвёт совпадение однотипных карточек (A)', () => {
  // Раньше один лишний элемент сдвигал позиционный список, карточки считались
  // разными, и выборка однотипных не срабатывала вовсе.
  assert.equal(templateFingerprint(cardWithBadge), templateFingerprint(card('Дрель', '5000')));
});

test('огромное меню не схлопывает разные страницы в один отпечаток (A)', () => {
  // Раньше 450 пунктов меню занимали все 400 позиций, и главная не отличалась
  // от карточки товара — мы пропускали страницы, которые надо было проверить.
  const nav = `<nav>${'<li class="menu__item"><a class="menu__link">п</a></li>'.repeat(450)}</nav>`;
  const home = `<html><body>${nav}<section class="hero"><h1 class="hero__title">Главная</h1></section></body></html>`;
  const product = `<html><body>${nav}<div class="product card"><h1 class="product__title">Дрель</h1>
    <span class="product__price">5000</span></div></body></html>`;
  assert.notEqual(templateFingerprint(home), templateFingerprint(product));
});

test('огромная страница разбирается за разумное время (A, стоимость)', () => {
  // Раньше ограничение в 400 элементов не ограничивало стоимость: разбор шёл
  // по всему документу, и мегабайтная страница стоила больше секунды.
  const huge = `<html><body>${'<div class="row"><span class="cell">x</span></div>'.repeat(50000)}</body></html>`;
  const t0 = Date.now();
  templateFingerprint(huge);
  assert.ok(Date.now() - t0 < 500, `отпечаток огромной страницы занял ${Date.now() - t0}мс`);
});

/* ── Ревью 2026-07-21, Critical 2: обрезка по длине строки не ограничивает
   стоимость — квадратичный разбор битой/глубоко вложенной разметки. ── */

test('100 000 незакрытых <b> обрабатываются быстро, а не квадратично (A, стоимость)', () => {
  // Ровно предел MAX_HTML = 300_000 символов: '<b>' × 100 000 = 300 000
  // символов. Раньше обрезка по длине строки ничего не резала — все 100 000
  // тегов доходили до парсера, и построение дерева росло квадратично.
  const brokenMarkup = `<html><body>${'<b>'.repeat(100_000)}</body></html>`;
  const t0 = Date.now();
  templateFingerprint(brokenMarkup);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 500, `отпечаток 100 000 незакрытых <b> занял ${elapsed}мс`);
});

test('вложенность <div> глубиной 20 000 обрабатывается быстро (A, стоимость)', () => {
  // Глубокая вложенность — другой вход с той же квадратичной болезнью
  // парсера, не покрытый обрезкой по длине строки.
  const deep = `<html><body>${'<div>'.repeat(20_000)}x${'</div>'.repeat(20_000)}</body></html>`;
  const t0 = Date.now();
  templateFingerprint(deep);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 500, `отпечаток вложенности глубиной 20 000 занял ${elapsed}мс`);
});

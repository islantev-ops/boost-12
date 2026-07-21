import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlShape, normalizeForQueue } from './crawl';

test('карточки одного раздела дают одну форму адреса (A)', () => {
  assert.equal(urlShape('https://site.ru/catalog/drel-123/'), urlShape('https://site.ru/catalog/pila-456/'));
});

test('разные одиночные страницы не сливаются (A, защита от пропуска)', () => {
  // Именно здесь ломался отпечаток разметки: у «404» и «Спасибо за заказ»
  // каркас одинаковый, и по нему они неотличимы. Адрес их различает.
  assert.notEqual(urlShape('https://site.ru/404'), urlShape('https://site.ru/thanks'));
  assert.notEqual(urlShape('https://site.ru/career/'), urlShape('https://site.ru/compliance/'));
});

test('новости одного раздела группируются (A)', () => {
  assert.equal(urlShape('https://site.ru/news/406/'), urlShape('https://site.ru/news/414/'));
});

test('главная и мусорный адрес не роняют функцию (A, граница)', () => {
  assert.equal(typeof urlShape('https://site.ru/'), 'string');
  assert.equal(typeof urlShape('не-адрес'), 'string');
});

test('normalizeForQueue: якорь убирается', () => {
  assert.equal(
    normalizeForQueue('https://site.ru/page#section'),
    normalizeForQueue('https://site.ru/page'),
  );
});

test('normalizeForQueue: utm_* и yclid/gclid убираются', () => {
  const withTracking = 'https://site.ru/page?utm_source=vk&utm_medium=cpc&yclid=123&gclid=456&from=main&ref=abc';
  assert.equal(normalizeForQueue(withTracking), normalizeForQueue('https://site.ru/page'));
});

test('normalizeForQueue: значащие параметры остаются', () => {
  const withPage = normalizeForQueue('https://site.ru/catalog?page=2');
  assert.notEqual(withPage, normalizeForQueue('https://site.ru/catalog'));
  assert.match(withPage, /page=2/);
});

test('normalizeForQueue: завершающий слеш нормализуется', () => {
  assert.equal(normalizeForQueue('https://site.ru/page/'), normalizeForQueue('https://site.ru/page'));
});

test('normalizeForQueue: хост в нижнем регистре', () => {
  assert.equal(normalizeForQueue('https://SITE.ru/page'), normalizeForQueue('https://site.ru/page'));
});

test('normalizeForQueue: путь в регистре НЕ меняется', () => {
  assert.notEqual(normalizeForQueue('https://site.ru/Page'), normalizeForQueue('https://site.ru/page'));
});

test('normalizeForQueue: мусорный адрес не роняет функцию', () => {
  assert.equal(typeof normalizeForQueue('не-адрес'), 'string');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlShape } from './crawl';

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

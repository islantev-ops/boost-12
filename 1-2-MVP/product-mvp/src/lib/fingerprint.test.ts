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

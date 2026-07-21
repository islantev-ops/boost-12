import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlShape, normalizeForQueue, checkBudgets, MAX_TOTAL_HTML, loadWithFooterRetry } from './crawl';
import type { LoadResult } from './browser';

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

/* ─────────────────── Правка 3: бюджет по объёму скачанного HTML ─────────────────── */

const PAGE_LIMIT = 300;

test('checkBudgets: все три бюджета в норме — обход продолжается (null)', () => {
  assert.equal(checkBudgets(10, 1_000_000, 0, Date.now() + 1000, PAGE_LIMIT), null);
});

test('checkBudgets: страниц уже достаточно — pageLimit', () => {
  assert.equal(checkBudgets(PAGE_LIMIT, 0, 0, Date.now() + 1000, PAGE_LIMIT), 'pageLimit');
});

test('checkBudgets: дедлайн прошёл — timeLimit', () => {
  assert.equal(checkBudgets(0, 0, Date.now() + 10, Date.now(), PAGE_LIMIT), 'timeLimit');
});

test('checkBudgets: суммарный объём HTML превысил MAX_TOTAL_HTML — sizeLimit', () => {
  assert.equal(checkBudgets(0, MAX_TOTAL_HTML + 1, 0, Date.now() + 1000, PAGE_LIMIT), 'sizeLimit');
});

test('checkBudgets: ровно на границе бюджета объёма — ещё не превышен', () => {
  assert.equal(checkBudgets(0, MAX_TOTAL_HTML, 0, Date.now() + 1000, PAGE_LIMIT), null);
});

test('checkBudgets: несколько условий верны одновременно — побеждает более ранняя проверка (pageLimit)', () => {
  assert.equal(checkBudgets(PAGE_LIMIT, MAX_TOTAL_HTML + 1, 0, Date.now() + 1000, PAGE_LIMIT), 'pageLimit');
});

/* ─────────────────── Правка 3: подвал, дорисованный скриптом ─────────────────── */

const WITH_LINKS = '<html><body><a href="/a">A</a><a href="/b">B</a></body></html>';
const NO_LINKS = '<html><body><p>Пусто, подвал ещё не дорисован</p></body></html>';

function fakeLoad(html: string, base = 'https://site.ru/'): LoadResult {
  return { url: base, status: 200, html, text: 'x', blocked: false };
}

test('loadWithFooterRetry: ссылки есть с первого раза — второго вызова load нет (обычные сайты не платят цену)', async () => {
  const calls: unknown[] = [];
  const load = async (url: string, opts?: { extraWaitMs?: number }) => {
    calls.push(opts);
    return fakeLoad(WITH_LINKS);
  };
  const result = await loadWithFooterRetry(load, 'https://site.ru/');
  assert.equal(calls.length, 1, 'страница со ссылками не должна вызывать повторное чтение');
  assert.equal(result?.html, WITH_LINKS);
});

test('loadWithFooterRetry: ноль ссылок на первом чтении, подвал дорисовался на повторе — используется повтор', async () => {
  const calls: (undefined | { extraWaitMs?: number })[] = [];
  const load = async (url: string, opts?: { extraWaitMs?: number }) => {
    calls.push(opts);
    return calls.length === 1 ? fakeLoad(NO_LINKS) : fakeLoad(WITH_LINKS);
  };
  const result = await loadWithFooterRetry(load, 'https://site.ru/');
  assert.equal(calls.length, 2, 'при нуле ссылок обязан быть ровно один повтор');
  assert.ok(calls[1]?.extraWaitMs && calls[1].extraWaitMs > 0, 'повтор обязан ждать дорисовки');
  assert.ok(calls[1].extraWaitMs! <= 3000, 'ожидание короткое — 2-3 секунды, не больше');
  assert.equal(result?.html, WITH_LINKS, 'должен вернуться результат повтора, а не пустышка');
});

test('loadWithFooterRetry: ноль ссылок даже после повтора — ровно один повтор, без циклов', async () => {
  const calls: unknown[] = [];
  const load = async (url: string, opts?: { extraWaitMs?: number }) => {
    calls.push(opts);
    return fakeLoad(NO_LINKS);
  };
  const result = await loadWithFooterRetry(load, 'https://site.ru/');
  assert.equal(calls.length, 2, 'ровно один повтор, даже если он тоже не помог — циклов быть не должно');
  assert.equal(result?.html, NO_LINKS);
});

test('loadWithFooterRetry: первая загрузка не удалась (null) — повтора нет', async () => {
  const calls: unknown[] = [];
  const load = async (url: string, opts?: { extraWaitMs?: number }) => {
    calls.push(opts);
    return null;
  };
  const result = await loadWithFooterRetry(load, 'https://site.ru/');
  assert.equal(calls.length, 1, 'если страница не загрузилась вовсе — повторять нечего');
  assert.equal(result, null);
});

test('loadWithFooterRetry: страница осталась заглушкой антибота — повтора нет (это отдельная логика)', async () => {
  const calls: unknown[] = [];
  const load = async (url: string, opts?: { extraWaitMs?: number }) => {
    calls.push(opts);
    return { url: 'https://site.ru/', status: 200, html: NO_LINKS, text: 'x', blocked: true };
  };
  const result = await loadWithFooterRetry(load, 'https://site.ru/');
  assert.equal(calls.length, 1, 'антибот-заглушку не нужно донагружать этим механизмом');
  assert.equal(result?.blocked, true);
});

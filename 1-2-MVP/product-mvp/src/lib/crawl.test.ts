import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  urlShape,
  normalizeForQueue,
  checkBudgets,
  MAX_TOTAL_HTML,
  MAX_PAGES,
  RESERVED_FOR_PROBES,
  RESERVED_MS,
  RESERVED_BYTES,
  loadWithFooterRetry,
  createFooterRetryState,
  toQueueEntry,
} from './crawl';
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
  const withTracking = 'https://site.ru/page?utm_source=vk&utm_medium=cpc&yclid=123&gclid=456';
  assert.equal(normalizeForQueue(withTracking), normalizeForQueue('https://site.ru/page'));
});

/* ─────────────────── Раунд 3: ref/from больше не отбрасываются ─────────────────── */

test('normalizeForQueue: ref НЕ отбрасывается — на части сайтов ?ref=SKU123 меняет содержимое страницы', () => {
  assert.notEqual(
    normalizeForQueue('https://site.ru/page?ref=SKU123'),
    normalizeForQueue('https://site.ru/page'),
  );
});

test('normalizeForQueue: from НЕ отбрасывается', () => {
  assert.notEqual(
    normalizeForQueue('https://site.ru/page?from=main'),
    normalizeForQueue('https://site.ru/page'),
  );
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

/* ─────────────────── Раунд 3: адрес очереди и ключ дедупликации разделены ─────────────────── */

test('toQueueEntry: в очередь идёт ОРИГИНАЛЬНЫЙ адрес со слешем, ключ — без слеша', () => {
  const entry = toQueueEntry('https://site.ru/catalog/');
  assert.equal(entry.url, 'https://site.ru/catalog/', 'запрашивать нужно оригинальный адрес — сервер может не редиректить');
  assert.equal(entry.key, normalizeForQueue('https://site.ru/catalog/'), 'ключ — нормализованная форма');
  assert.notEqual(entry.url, entry.key, 'на этом примере адрес и ключ обязаны различаться (слеш)');
});

test('toQueueEntry: адрес без изменений, даже если нормализация трогает регистр хоста', () => {
  const entry = toQueueEntry('https://SITE.ru/Page');
  assert.equal(entry.url, 'https://SITE.ru/Page', 'адрес — как ссылка на странице, без нормализации хоста');
  assert.equal(entry.key, normalizeForQueue('https://SITE.ru/Page'));
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

test('checkBudgets: явный sizeLimit-параметр проверяется вместо MAX_TOTAL_HTML по умолчанию', () => {
  assert.equal(checkBudgets(0, 1000, 0, Date.now() + 1000, PAGE_LIMIT, 500), 'sizeLimit');
  assert.equal(checkBudgets(0, 1000, 0, Date.now() + 1000, PAGE_LIMIT, 5000), null);
});

/* ─────────────────── Раунд 3: резерв ВСЕХ трёх бюджетов под фазу проб ───────────────────
 *
 * В прошлом раунде резерв (RESERVED_FOR_PROBES) урезал только лимит страниц.
 * Время и объём резерва не имели — если основной цикл выходил по timeLimit
 * или sizeLimit, фаза проб проверяла ТЕ ЖЕ полные бюджеты и обрывалась на
 * первой же итерации: ни одна проба не выполнялась именно на тяжёлых
 * сайтах, где документ вероятнее всего не прилинкован.
 *
 * Тест ниже проверяет это на чистой функции: урезанный бюджет (для
 * основного цикла) должен сигнализировать об остановке РАНЬШЕ, чем полный
 * бюджет (для фазы проб) — то есть у проб остаётся возможность выполниться.
 */

test('резерв времени: урезанный дедлайн уже истёк, а полный — ещё нет (пробы могут выполниться)', () => {
  const now = Date.now();
  const reducedDeadline = now - 1; // основной цикл уже обязан остановиться
  const fullDeadline = now + RESERVED_MS; // а с учётом резерва время ещё есть
  assert.equal(
    checkBudgets(0, 0, now, reducedDeadline, MAX_PAGES - RESERVED_FOR_PROBES, MAX_TOTAL_HTML),
    'timeLimit',
    'основной цикл обязан остановиться по урезанному дедлайну',
  );
  assert.equal(
    checkBudgets(0, 0, now, fullDeadline, MAX_PAGES, MAX_TOTAL_HTML),
    null,
    'полный бюджет времени ещё не исчерпан — фаза проб обязана суметь выполниться',
  );
});

test('резерв объёма: урезанный бюджет байт уже превышен, а полный — ещё нет (пробы могут выполниться)', () => {
  const now = Date.now();
  const bytesUsed = MAX_TOTAL_HTML - RESERVED_BYTES + 1; // на грамм больше урезанного бюджета
  assert.equal(
    checkBudgets(0, bytesUsed, now, now + 1000, MAX_PAGES - RESERVED_FOR_PROBES, MAX_TOTAL_HTML - RESERVED_BYTES),
    'sizeLimit',
    'основной цикл обязан остановиться по урезанному бюджету байт',
  );
  assert.equal(
    checkBudgets(0, bytesUsed, now, now + 1000, MAX_PAGES, MAX_TOTAL_HTML),
    null,
    'полный бюджет байт ещё не исчерпан — фаза проб обязана суметь выполниться',
  );
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

/* ─────────────────── Раунд 3: самообучающийся повтор ───────────────────
 *
 * Без обучения каждая честная тупиковая страница (нет внутренних ссылок,
 * подвал ни при чём) получает повтор с ожиданием FOOTER_RETRY_WAIT_MS. На
 * сайте с сотней таких страниц это добавляет минуты и приближает timeLimit.
 * После нескольких неудачных повторов подряд логично предположить, что сайт
 * просто не дорисовывает подвал скриптом, и платить дальше незачем.
 */

test('loadWithFooterRetry: без передачи state поведение как раньше — повтор всегда', async () => {
  const calls: unknown[] = [];
  const load = async (url: string, opts?: { extraWaitMs?: number }) => {
    calls.push(opts);
    return fakeLoad(NO_LINKS);
  };
  await loadWithFooterRetry(load, 'https://site.ru/p1');
  await loadWithFooterRetry(load, 'https://site.ru/p2');
  await loadWithFooterRetry(load, 'https://site.ru/p3');
  await loadWithFooterRetry(load, 'https://site.ru/p4');
  assert.equal(calls.length, 8, 'без state счётчик не ведётся — повтор выполняется на каждой странице');
});

test('loadWithFooterRetry: после 3 неудачных повторов подряд повторы прекращаются', async () => {
  const state = createFooterRetryState();
  let calls = 0;
  const load = async () => {
    calls++;
    return fakeLoad(NO_LINKS);
  };
  await loadWithFooterRetry(load, 'https://site.ru/p1', state);
  await loadWithFooterRetry(load, 'https://site.ru/p2', state);
  await loadWithFooterRetry(load, 'https://site.ru/p3', state);
  assert.equal(state.disabled, true, 'после трёх неудач подряд повторы обязаны выключиться');

  const before = calls;
  await loadWithFooterRetry(load, 'https://site.ru/p4', state);
  assert.equal(calls, before + 1, 'при выключенных повторах — только первое чтение, без повтора');
});

test('loadWithFooterRetry: успешный повтор сбрасывает счётчик неудач', async () => {
  const state = createFooterRetryState();
  state.consecutiveFailures = 2; // как будто уже было две неудачи подряд
  const load = async (url: string, opts?: { extraWaitMs?: number }) =>
    opts ? fakeLoad(WITH_LINKS) : fakeLoad(NO_LINKS);
  await loadWithFooterRetry(load, 'https://site.ru/p', state);
  assert.equal(state.consecutiveFailures, 0, 'успешный повтор обязан сбросить счётчик неудач');
  assert.equal(state.disabled, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './checks';
import type { HostingFact, SiteSnapshot } from './types';

const CLEAN_HTML = '<html><body><h1>Магазин</h1><footer>© 2026</footer></body></html>';

function snapshot(hosting: HostingFact | null, html = CLEAN_HTML): SiteSnapshot {
  return {
    inputUrl: 'https://example.ru/',
    finalUrl: 'https://example.ru/',
    reachable: true,
    cms: 'bitrix',
    clientRendered: false,
    footerVisible: true,
    hosting,
    pages: [{ url: 'https://example.ru/', status: 200, html, text: 'Магазин' }],
  };
}

const RU: HostingFact = {
  ips: ['31.31.198.246'], country: 'RU', netname: 'REGRU-NETWORK',
  geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
};

const check1of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 1)!;

/**
 * Про базу данных клиента отчёт не должен говорить НИЧЕГО — мы её не видели.
 * Запрет действует на все ветки формулировки, поэтому проверяем каждый тест.
 *
 * Регексп ловит фразы, приписывающие нам знание о конкретной базе сайта/клиента
 * («база данных сайта», «база данных клиента», «ваша база», «где ваша база»,
 * «хранение в базе за рубежом»), но НЕ трогает статью 152-ФЗ дословно —
 * «...с использованием баз данных, находящихся за пределами территории РФ» —
 * это законная формулировка нормы, а не утверждение про конкретную базу.
 *
 * Альтернатива «хранени…в базе» использует класс `[а-яё]*`, а не `\w*`: в JS
 * `\w` — это `[A-Za-z0-9_]`, кириллицу он не берёт, и с `\w*` эта альтернатива
 * не срабатывала никогда (проверено: «хранение в базе» → false).
 */
const DB_CLAIM = /баз[аы]\s+данных\s+(сайта|клиента)|ваша\s+база|где.*база|хранени[а-яё]*\s+в\s+базе/i;

function assertNoDbClaim(summary: string) {
  assert.doesNotMatch(summary, DB_CLAIM, 'про базу данных клиента не пишем ничего — мы её не видели');
}

test('DB_CLAIM: кириллица теперь ловится, норма 152-ФЗ дословно — по-прежнему нет (A, регресс)', () => {
  // \w в JS — это [A-Za-z0-9_], кириллицу не берёт: альтернатива с \w* никогда
  // не срабатывала на русском тексте. Проверено: «хранение в базе» → false
  // при старом регекспе. [а-яё]* это чинит.
  assert.match('на сайте есть хранение в базе за рубежом', DB_CLAIM);
  // Дословная формулировка ст. 152-ФЗ разрешена — это не утверждение про
  // конкретную базу клиента, а норма закона, её печатать можно.
  assert.doesNotMatch(
    'Закон запрещает запись, накопление и хранение персональных данных граждан РФ ' +
      'с использованием баз данных, находящихся за пределами территории РФ.',
    DB_CLAIM,
  );
});

test('сайт в РФ и без счётчиков — соответствует', () => {
  const f = check1of(snapshot(RU));
  assert.equal(f.verdict, 'ok');
  assert.match(f.summary, /31\.31\.198\.246/, 'IP обязан быть в тексте — его перепроверяют');
  assert.match(f.summary, /REGRU-NETWORK/);
  assertNoDbClaim(f.summary);
});

test('сайт за границей, оба источника сошлись на одной стране — нарушение', () => {
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: 'DE', netname: 'HETZNER-NET',
    geoCountry: 'DE', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /страна DE/, 'страны совпали — печатаем одну');
  assert.match(f.summary, /подтверждено источниками: rdap, ipwho\.is/);
  assertNoDbClaim(f.summary);
});

test('ARIN без country, страну назвал только ipwho.is — нарушение без ложной ссылки на rdap', () => {
  const f = check1of(snapshot({
    ips: ['8.8.8.8'], country: null, netname: 'GOGL',
    geoCountry: 'US', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /страна US/);
  // rdap ОТВЕТИЛ (confirmedBy), но страну не назвал (country: null) — в тексте
  // не должно быть ссылки на rdap как на источник, подтвердивший страну.
  // Источник один — грамматически «источником» (ед. число), не «источниками».
  assert.match(f.summary, /подтверждено источником: ipwho\.is\./, 'страну назвала только геобаза');
  assert.doesNotMatch(f.summary, /источник\w*: rdap/);
  assertNoDbClaim(f.summary);
});

test('оба источника не-RU, но назвали разные страны — печатаем обе с атрибуцией', () => {
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: 'DE', netname: 'HETZNER-NET',
    geoCountry: 'US', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /реестр называет страну DE, геобаза — US/,
    'страны разошлись — нельзя выдавать одну за согласованную обеими источниками');
  assert.match(f.summary, /подтверждено источниками: rdap, ipwho\.is/);
  assertNoDbClaim(f.summary);
});

test('источники разошлись (RDAP не-RU, геобаза RU) — вручную, а не обвинение', () => {
  const f = check1of(snapshot({
    ips: ['1.2.3.4'], country: 'DE', netname: 'SOME-NET',
    geoCountry: 'RU', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'manual');
  assertNoDbClaim(f.summary);
});

test('за CDN — вручную', () => {
  const f = check1of(snapshot({
    ips: ['104.16.132.229'], country: null, netname: 'CLOUDFLARENET',
    geoCountry: null, isCdn: true, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /CDN/);
  assertNoDbClaim(f.summary);
});

test('второй источник не ответил — вручную, не нарушение', () => {
  const f = check1of(snapshot({
    ips: ['8.8.8.8'], country: null, netname: 'GOGL',
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'manual');
  assertNoDbClaim(f.summary);
});

test('RDAP не ответил вовсе — вручную, даже если геобаза назвала заграницу (C2, регресс)', () => {
  // Дизайн-документ §4.2, правило 1: «RDAP недоступен → unknown, не ok».
  // Раньше hostingFactor не читал confirmedBy вовсе, и при молчании RDAP
  // геобаза (ipwho.is) в одиночку выносила «нарушение». rdap.org — сервис без
  // SLA, недоступность у него не редкость.
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: null, netname: null,
    geoCountry: 'DE', isCdn: false, confirmedBy: ['ipwho.is'],
  }));
  assert.equal(f.verdict, 'manual', 'один источник не должен обвинять в одиночку');
  assert.doesNotMatch(f.summary, /за пределами РФ/, 'обвинения по одному источнику быть не должно');
  assertNoDbClaim(f.summary);
});

test('хостинг не выяснен вовсе — вручную', () => {
  const a = check1of(snapshot(null));
  assert.equal(a.verdict, 'manual');
  assertNoDbClaim(a.summary);

  const b = check1of(snapshot({
    ips: [], country: null, netname: null, geoCountry: null,
    isCdn: false, confirmedBy: [], error: 'DNS не отдал адрес',
  }));
  assert.equal(b.verdict, 'manual');
  assertNoDbClaim(b.summary);
});

test('Google Analytics перебивает даже российский хостинг', () => {
  const html = '<html><body><script src="https://www.google-analytics.com/analytics.js"></script></body></html>';
  const f = check1of(snapshot(RU, html));
  assert.equal(f.verdict, 'violation');
  assertNoDbClaim(f.summary);
});

/* ─────────────────── грязный вход: hostingFactor обязан нормализовать сам ─────────────────── */

test('грязный вход: country в нижнем регистре не должен ложно обвинить российский сайт', () => {
  const f = check1of(snapshot({
    ips: ['31.31.198.246'], country: 'ru', netname: 'REGRU-NETWORK',
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'ok', 'RU в любом регистре — это РФ, а не нарушение');
  assertNoDbClaim(f.summary);
});

test('грязный вход: CDN без имени сети — текст не содержит буквального "null"', () => {
  const f = check1of(snapshot({
    ips: ['104.16.132.229'], country: null, netname: null,
    geoCountry: null, isCdn: true, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'manual');
  assert.doesNotMatch(f.summary, /\bnull\b/i, 'отсутствие имени сети — не повод печатать литерал null');
  assertNoDbClaim(f.summary);
});

test('грязный вход: пустая строка вместо country — не rdap, а только геобаза назвала страну', () => {
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: '', netname: 'HETZNER-NET',
    geoCountry: 'DE', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /страна DE/);
  assert.match(f.summary, /подтверждено источником: ipwho\.is\./,
    'пустая строка country нормализуется в null — rdap страну не называл; источник один, значит "источником"');
  assertNoDbClaim(f.summary);
});

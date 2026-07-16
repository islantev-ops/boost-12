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

test('ARIN без country, страну назвал только ipwho.is — вручную, а не нарушение (правка 2026-07-16)', () => {
  // Раньше это был тест на «нарушение»: RDAP (ARIN) промолчал про страну,
  // ipwho.is в одиночку назвал US — и этого хватало на violation. Владелец
  // продукта решил (2026-07-16, дизайн-документ §4.2): обвинять по одному
  // источнику нельзя никогда, даже когда RDAP ответил, но страну не назвал.
  // В целевом сегменте такой сайт (американский хостинг вне RIPE) — редкость,
  // так что цена решения — редкое «вручную» вместо частой возможности солгать.
  const f = check1of(snapshot({
    ips: ['8.8.8.8'], country: null, netname: 'GOGL',
    geoCountry: 'US', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'manual');
  assert.doesNotMatch(f.summary, /за пределами РФ/, 'обвинения по одному источнику быть не должно');
  assertNoDbClaim(f.summary);
});

test('обвинение невозможно, когда страну назвал только один источник (правка 2026-07-16)', () => {
  // Итог правила одной фразой (спека §4.2): обвиняем ровно тогда, когда ОБА
  // источника независимо назвали не-российскую страну. Проверяем обе стороны
  // асимметрии: страну знает только геобаза, и страну знает только RDAP.
  const onlyGeoNamed = check1of(snapshot({
    ips: ['8.8.8.8'], country: null, netname: 'GOGL',
    geoCountry: 'US', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(onlyGeoNamed.verdict, 'manual', 'страну назвала только геобаза — RDAP молчал о ней');
  assert.doesNotMatch(onlyGeoNamed.summary, /за пределами РФ/);

  const onlyRdapNamed = check1of(snapshot({
    ips: ['5.9.1.1'], country: 'DE', netname: 'HETZNER-NET',
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.equal(onlyRdapNamed.verdict, 'manual', 'страну назвал только RDAP — второй источник не ответил');
  assert.doesNotMatch(onlyRdapNamed.summary, /за пределами РФ/);

  assertNoDbClaim(onlyGeoNamed.summary);
  assertNoDbClaim(onlyRdapNamed.summary);
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

test('за CDN, но RDAP по адресу молчал (CDN опознан только через ipwho.is) — текст про CDN, не про молчание RDAP (MINOR, регресс)', () => {
  // Раньше проверка «RDAP не ответил» шла ПЕРЕД проверкой CDN, и такой адрес
  // получал текст «Реестр RDAP не ответил» вместо «Сайт отдаётся через CDN» —
  // вердикт (manual) не менялся, но текст вводил в заблуждение о причине.
  const f = check1of(snapshot({
    ips: ['197.234.240.1'], country: null, netname: null,
    geoCountry: 'US', isCdn: true, confirmedBy: ['ipwho.is'],
  }));
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /CDN/, 'причина — CDN, а не молчание RDAP');
  assert.doesNotMatch(f.summary, /RDAP не ответил/);
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

/*
 * ─────────── CRITICAL / IMPORTANT 2 (отчёт о финальном ревью): намёк на RU
 * от RDAP по ЛЮБОМУ проверенному адресу останавливает и обвинение, и
 * автоматическое оправдание ───────────
 *
 * geo.ts после починки для такого случая отдаёт ровно эту форму факта:
 * country/geoCountry/netname — null, confirmedBy — ['rdap'] (RDAP ответил,
 * но однозначного «все RU» нет). Эти тесты фиксируют, что hostingFactor
 * превращает такой факт в «вручную», а не в «нарушение» (было бы, если бы
 * RDAP молчал про обвиняемый адрес, но geoCountry всё равно взялся от
 * ошибшегося ipwho.is) и не в «ok» (было бы, если бы намёк на RU по
 * умолчанию выбирался представителем без проверки остальных адресов).
 */
test('намёк на RU от RDAP по одному из нескольких адресов — вручную, НЕ нарушение (CRITICAL, регресс)', () => {
  // Воспроизводит фактическую форму бага: два адреса одного хостера, RDAP
  // молчал про 31.31.198.246 и ответил RU/REGRU-NETWORK про 31.31.198.247,
  // ipwho.is ошибочно называл DE. После фикса geo.ts эта ситуация никогда не
  // доходит до ipwho.is и не долетает как geoCountry: 'DE' — но даже если бы
  // где-то по цепочке снова протекло дальше, эта проверка гарантирует, что
  // hostingFactor сам по себе не выносит «нарушение» на этой форме факта.
  const f = check1of(snapshot({
    ips: ['31.31.198.246', '31.31.198.247'], country: null, netname: null,
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.notEqual(f.verdict, 'violation', 'реестр прямо назвал соседний адрес российским — обвинять нельзя');
  assert.notEqual(f.verdict, 'ok', 'подтверждён не весь набор адресов — автоматически оправдывать тоже нельзя');
  assert.equal(f.verdict, 'manual');
  assert.doesNotMatch(f.summary, /за пределами РФ/);
  assertNoDbClaim(f.summary);
});

test('намёк на RU от RDAP по одному адресу, второй вовсе не подтверждён — вручную, НЕ ok (IMPORTANT 2, регресс)', () => {
  // Воспроизводит IMPORTANT 2: RDAP ответил RU по первому адресу и промолчал
  // про второй. Старый код без явно нероссийского адреса брал представителем
  // именно RU-адрес (idx по умолчанию 0) и выносил «ok», хотя второй адрес
  // реестр не подтвердил вовсе.
  const f = check1of(snapshot({
    ips: ['31.31.198.246', '5.9.1.1'], country: null, netname: null,
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.notEqual(f.verdict, 'ok', 'второй адрес реестр не подтвердил — "ok" не по данным, а по умолчанию');
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

test('грязный вход: пустая строка вместо country — нормализуется в null, RDAP страну не называл — вручную', () => {
  // Пустая строка country нормализуется в null функцией normCountry — с точки
  // зрения hostingFactor это тот же случай «RDAP страну не назвал», что и
  // ARIN: обвинять по одному источнику (geoCountry) нельзя.
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: '', netname: 'HETZNER-NET',
    geoCountry: 'DE', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'manual');
  assert.doesNotMatch(f.summary, /за пределами РФ/);
  assertNoDbClaim(f.summary);
});

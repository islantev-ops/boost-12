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
    blockedByAntibot: false,
    coverage: {
      crawled: 5, discovered: 5, skippedByTemplate: 0, skippedByLimit: 0,
      complete: true, stopReason: 'done' as const,
    },
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

/* ─────────────────── IMPORTANT 1: непроверенный адрес не звучит в тексте как измеренный ─────────────────── */

test('IMPORTANT 1 (регресс): непроверенный адрес не попадает в текст обвинения как измеренный', () => {
  // Два адреса в ips: RDAP молчал про первый (его страну никто не узнавал),
  // страна и сеть получены только по второму — это отражено полем ip. Текст
  // обвинения обязан называть только его, а не оба адреса.
  const f = check1of(snapshot({
    ips: ['1.1.1.1', '2.2.2.2'], ip: '2.2.2.2', country: 'DE', netname: 'HETZNER-NET',
    geoCountry: 'DE', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /2\.2\.2\.2/, 'реально проверенный адрес обязан быть в тексте');
  assert.doesNotMatch(f.summary, /1\.1\.1\.1/, 'непроверенный адрес не должен звучать как измеренный');
  assertNoDbClaim(f.summary);
});

test('IMPORTANT 1 (регресс): в ветке «все адреса RU» по-прежнему печатаются все ips — эту ветку не меняли', () => {
  // Явный контроль на «ok»-ветку: там allRu требует подтверждения ВСЕХ
  // адресов, поэтому печатать их все — корректно и осталось как было.
  const f = check1of(snapshot({
    ips: ['31.31.198.246', '31.31.198.247'], country: 'RU', netname: 'REGRU-NETWORK',
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'ok');
  assert.match(f.summary, /31\.31\.198\.246/);
  assert.match(f.summary, /31\.31\.198\.247/);
});

/* ─────────────────── IMPORTANT 2: счётчик Google не должен вытеснять IP/сеть/страну ─────────────────── */

test('IMPORTANT 2 (регресс): при найденном Google Analytics в summary остаются и счётчик, и IP/сеть/страна', () => {
  // Раньше при найденном счётчике summary состоял ТОЛЬКО из фразы про
  // счётчик — hf.detail (IP, сеть, страна размещения) терялся. docx.ts
  // печатает в отчёт только summary (не factors), поэтому у сайта с Google
  // Analytics и заграничным сервером в Word не было ни IP, ни хостера,
  // ни страны — против критерия готовности спеки §9.4.
  const html = '<html><body><script src="https://www.google-analytics.com/analytics.js"></script></body></html>';
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: 'DE', netname: 'HETZNER-NET',
    geoCountry: 'DE', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }, html));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /Google Analytics/, 'счётчик — почему нарушение');
  assert.match(f.summary, /5\.9\.1\.1/, 'IP обязан остаться в отчёте');
  assert.match(f.summary, /HETZNER-NET/, 'сеть обязана остаться в отчёте');
  assert.match(f.summary, /страна DE/, 'страна обязана остаться в отчёте');
  assertNoDbClaim(f.summary);
});

test('IMPORTANT 2 (регресс): счётчик найден и хостинг в РФ — IP/сеть/страна тоже не теряются', () => {
  const html = '<html><body><script src="https://www.google-analytics.com/analytics.js"></script></body></html>';
  const f = check1of(snapshot(RU, html));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /Google Analytics/);
  assert.match(f.summary, /31\.31\.198\.246/, 'IP российского хостинга тоже должен остаться в отчёте');
  assert.match(f.summary, /REGRU-NETWORK/);
  assertNoDbClaim(f.summary);
});

/* ─────────────────── MINOR 1: неверный формат country не даёт обвинить ─────────────────── */

test("MINOR 1 (регресс): country: 'RUSSIAN FEDERATION' — не обвинение", () => {
  // Полное название страны вместо двухбуквенного ISO-кода (RFC 9083). До
  // фикса normCountry просто триммил и поднимал регистр, не проверяя формат:
  // такая строка выглядела бы как «названа не-RU страна», а раз оба
  // источника (RDAP и геобаза) якобы назвали одну и ту же не-RU страну —
  // получалось violation с самоопровергающейся фразой «страна RUSSIAN
  // FEDERATION». hostingFactor обязан защититься сам, тем же принципом, что
  // и «грязный вход» тесты выше (регистр, пустая строка), не полагаясь на
  // то, что источник данных (geo.ts) всегда чист.
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: 'RUSSIAN FEDERATION', netname: 'SOME-NET',
    geoCountry: 'RUSSIAN FEDERATION', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.notEqual(f.verdict, 'violation', 'не двухбуквенный код — считаем, что источники страну не назвали');
  assert.doesNotMatch(f.summary, /RUSSIAN FEDERATION/);
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

/* ═══════════════════════════════════════════════════════════════════════
 * Баг: в JS `\w` = `[A-Za-z0-9_]` — кириллицу не берёт, `\b` (граница строится
 * через \w) после кириллицы работает неверно. Регулярки вида
 * `персональн\w*\s+данн` на русском тексте не совпадают никогда: после корня
 * всегда идёт кириллическое окончание, а \w* его не берёт.
 *
 * Полное расследование с доказательствами по каждому месту:
 * .superpowers/sdd/regex-cyrillic-sweep.md (путь от корня репозитория boost 12).
 *
 * Стиль замены — как в DB_CLAIM выше: `\w*` → `[а-яё]*`. Во всех 6 местах
 * ниже текст на входе регекспа уже приведён к нижнему регистру самим кодом
 * checks.ts до вызова .test() (проверено чтением каждого места), поэтому
 * заглавные буквы отдельно обрабатывать не нужно — класс [а-яё] (нижний
 * регистр) без флага i достаточен.
 * ═══════════════════════════════════════════════════════════════════════ */

const check3of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 3)!;
const check4of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 4)!;
const check5of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 5)!;
const check6of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 6)!;
const check7of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 7)!;
const check8of = (s: SiteSnapshot) => runChecks(s).find((f) => f.checkId === 8)!;

/** Для check8 нужно несколько страниц с разным `text` — snapshot() даёт только одну (text всегда 'Магазин'). */
function multiPageSnapshot(pages: SiteSnapshot['pages']): SiteSnapshot {
  return {
    inputUrl: pages[0].url,
    finalUrl: pages[0].url,
    reachable: true,
    cms: null,
    clientRendered: false,
    footerVisible: true,
    blockedByAntibot: false,
    coverage: {
      crawled: pages.length, discovered: pages.length, skippedByTemplate: 0, skippedByLimit: 0,
      complete: true, stopReason: 'done' as const,
    },
    hosting: null,
    pages,
  };
}

/* ─────────────────── Место 1 (regex-cyrillic-sweep.md №1): check3, textRe ─────────────────── */

test('check3: подпись ссылки "обработка персональных данных" без слова "конфиденциальность" — документ находится (RED)', () => {
  // Реальная подпись, которая встречается на сайтах (находка №1 отчёта).
  // Альтернативы 2 и 3 регекспа (`персональн\w*\s+данн`, `обработк\w*\s+персональн`)
  // используют \w* — после корня всегда кириллическое окончание, обе мертвы всегда.
  const html = '<html><body><a href="/docs/doc-1/">Обработка персональных данных</a></body></html>';
  const f = check3of(snapshot(null, html));
  assert.equal(f.verdict, 'ok', 'подпись «обработка персональных данных» обязана опознаваться как документ');
  assert.match(f.summary, /опубликована/);
});

test('check3: голое "Политика" без "конфиденциальности"/"персональных данных" — документом не считается (защита от расширения regex)', () => {
  // Комментарий в коде check3 прямо предупреждает: «Политика» бывает и «policy»,
  // и «politics» — газетный раздел не должен приниматься за документ.
  const html = '<html><body><a href="/news/politika/">Политика</a></body></html>';
  const f = check3of(snapshot(null, html));
  assert.equal(f.verdict, 'violation', 'ссылка в новостной раздел «Политика» не должна приниматься за документ');
});

/* ─────────────────── Место 2 (№2): check4, textRe ─────────────────── */

test('check4: подпись ссылки "Согласие на обработку персональных данных" без слова "даю" — документ находится (RED)', () => {
  // Самая частая формулировка на сайтах — подпись без «даю» перед «согласие».
  // Альтернатива 1 (`соглас\w*\s+на\s+обработку`) мертва всегда: после «соглас»
  // перед пробелом обязательно кириллическое окончание («ие», «ия»).
  const html = '<html><body><a href="/docs/doc-2/">Согласие на обработку персональных данных</a></body></html>';
  const f = check4of(snapshot(null, html));
  const docFactor = f.factors.find((x) => x.name.startsWith('Отдельный документ'))!;
  assert.equal(docFactor.vote, 'ok', 'подпись без слова «даю» тоже обязана опознаваться как согласие на обработку');
});

test('check4: "согласование сроков доставки" — деловой термин, не согласие на обработку ПДн (защита от расширения regex)', () => {
  const html = '<html><body><a href="/docs/doc-3/">Согласование сроков доставки</a></body></html>';
  const f = check4of(snapshot(null, html));
  const docFactor = f.factors.find((x) => x.name.startsWith('Отдельный документ'))!;
  assert.equal(docFactor.vote, 'violation', '«согласование» — координация сроков, а не согласие на обработку персональных данных');
});

/* ─────────────────── Место 3 (№3): check5, textRe ─────────────────── */

test('check5: подпись ссылки "Пользовательское соглашение" — документ находится (RED)', () => {
  // Комментарий в коде check5 прямо называет эту формулировку целевой — но
  // регексп её не ловил: `пользовательск\w*\s+соглашени` мертва всегда.
  const html = '<html><body><a href="/docs/doc-4/">Пользовательское соглашение</a></body></html>';
  const f = check5of(snapshot(null, html));
  assert.equal(f.verdict, 'ok', 'самая частая формулировка сайтов обязана опознаваться как документ');
});

test('check5: "Соглашение сторон о поставке" — обычный договорной термин, не документ сайта (защита от расширения regex)', () => {
  const html = '<html><body><a href="/docs/doc-5/">Соглашение сторон о поставке</a></body></html>';
  const f = check5of(snapshot(null, html));
  assert.equal(f.verdict, 'violation', 'договорной термин не должен приниматься за пользовательское соглашение/оферту сайта');
});

/* ─────────────────── Место 4 (№4): hasConsentAction, "ок\b" в плашке куки ─────────────────── */

/** Плашка куки с одной кнопкой — проверяет, опознаёт ли hasConsentAction её текст как согласие. */
function consentButtonRecognized(buttonText: string): boolean {
  const html =
    `<html><body><div class="cookie-banner">Мы используем куки на сайте. <button>${buttonText}</button></div></body></html>`;
  const f = check6of(snapshot(null, html));
  const bannerFactor = f.factors.find((x) => x.name === 'Плашка куки в разметке страницы')!;
  return bannerFactor.vote === 'ok';
}

test('hasConsentAction: кнопка "Ок" и варианты — распознаются как согласие (RED: \\b после кириллицы не работает)', () => {
  // \b — переход \w <-> не-\w. Кириллическая «к» не входит в \w, поэтому
  // `ок\b` совпадает, только если сразу после «ок» идёт ЛАТИНСКАЯ буква/цифра —
  // случай, которого на кнопке «Ок»/«ОК» не бывает никогда.
  assert.equal(consentButtonRecognized('Ок'), true, 'голое «Ок» — частый минималистичный вариант кнопки');
  assert.equal(consentButtonRecognized('ОК.'), true, 'с точкой в конце');
  assert.equal(consentButtonRecognized('Нажмите ОК'), true, '«ок» в середине фразы');
  assert.equal(consentButtonRecognized('Ок!'), true, 'с восклицательным знаком');
});

test('hasConsentAction: "около/окно/оказалось/окончательно" — НЕ кнопка согласия (защита от расширения regex на соседние слова)', () => {
  assert.equal(consentButtonRecognized('Забронировать окно'), false, '«окно» — расписание, не согласие');
  assert.equal(consentButtonRecognized('Узнать, что находится около'), false, '«около» не должно давать ложное срабатывание');
  assert.equal(consentButtonRecognized('Оказалось интересно'), false, '«оказалось» не должно давать ложное срабатывание');
  assert.equal(consentButtonRecognized('Оформить окончательно'), false, '«окончательно» не должно давать ложное срабатывание');
});

/* ─────────────────── Место 5 (№5): check6, hasPolicyLink ─────────────────── */

test('check6/hasPolicyLink: ссылка "Обработка персональных данных" в плашке куки — находится (RED)', () => {
  // Кнопка «Принять» уже распознаётся верно и без фикса места 4 (альтернатива
  // «приня» не завязана на \w) — изолируем проверку именно на ссылке.
  const html =
    '<html><body><div class="cookie-banner">Мы используем куки на сайте. ' +
    '<button>Принять</button> <a href="/docs/doc-6/">Обработка персональных данных</a></div></body></html>';
  const f = check6of(snapshot(null, html));
  const linkFactor = f.factors.find((x) => x.name === 'Ссылка на Политику конфиденциальности в плашке')!;
  assert.equal(linkFactor.vote, 'ok', 'подпись без слова «конфиденциальность» тоже обязана опознаваться');
});

test('check6/hasPolicyLink: ссылка "Политика возврата товара" в плашке — это не Политика конфиденциальности (защита от расширения regex)', () => {
  const html =
    '<html><body><div class="cookie-banner">Мы используем куки на сайте. ' +
    '<button>Принять</button> <a href="/docs/doc-7/">Политика возврата товара</a></div></body></html>';
  const f = check6of(snapshot(null, html));
  const linkFactor = f.factors.find((x) => x.name === 'Ссылка на Политику конфиденциальности в плашке')!;
  assert.equal(linkFactor.vote, 'violation', '«политика возврата» не должна приниматься за Политику конфиденциальности');
});

/* ─────────────────── Место 6 (№6): check8, mentionsMailing ─────────────────── */

test('check8/mentionsMailing: Политика описывает рассылку словами "информационные сообщения" (RED)', () => {
  const s = multiPageSnapshot([
    {
      url: 'https://example.ru/',
      status: 200,
      html: '<html><body>Подписка на рассылку новостей</body></html>',
      text: 'Подписка на рассылку новостей',
    },
    {
      url: 'https://example.ru/privacy/',
      status: 200,
      html: '<html><body>Политика конфиденциальности</body></html>',
      text: 'Политика конфиденциальности. Мы направляем вам информационные сообщения о заказе.',
    },
  ]);
  const f = check8of(s);
  const mailingFactor = f.factors.find((x) => x.name === 'Рассылка описана в целях Политики')!;
  assert.equal(mailingFactor.vote, 'ok', '«информационные сообщения» без слова «рассылка» тоже обязано засчитываться');
});

test('check8/mentionsMailing: Политика упоминает "информационную систему", а не рассылку — не засчитываем (защита от расширения regex)', () => {
  const s = multiPageSnapshot([
    {
      url: 'https://example.ru/',
      status: 200,
      html: '<html><body>Подписка на рассылку новостей</body></html>',
      text: 'Подписка на рассылку новостей',
    },
    {
      url: 'https://example.ru/privacy/',
      status: 200,
      html: '<html><body>Политика конфиденциальности</body></html>',
      text: 'Политика конфиденциальности. У нас есть информационная система обработки заказов.',
    },
  ]);
  const f = check8of(s);
  const mailingFactor = f.factors.find((x) => x.name === 'Рассылка описана в целях Политики')!;
  assert.equal(mailingFactor.vote, 'violation', '«информационная система» — не описание целей рассылки в Политике');
});

/**
 * Обход упёрся в потолок — заявлять «документа нет» нельзя: мы не видели
 * часть сайта. Это ровно тот случай, из-за которого аудит писал «форм не
 * найдено», не открыв страницу с формой (gdpgroup.ru, 2026-07-21).
 */
test('неполный обход: вывод об отсутствии уходит в manual, а не в нарушение (A)', () => {
  const s = snapshot(RU);
  const partial: SiteSnapshot = {
    ...s,
    coverage: { crawled: 300, discovered: 1200, skippedByTemplate: 40, skippedByLimit: 860, complete: false, stopReason: 'pageLimit' },
  };
  const f = runChecks(partial).find((x) => x.checkId === 3)!;
  assert.equal(f.verdict, 'manual', 'при неполном обходе «Политики нет» — не нарушение');
});

test('неполный обход: причина и цифры названы в тексте фактора (A, требование владельца)', () => {
  const s = snapshot(RU);
  const partial: SiteSnapshot = {
    ...s,
    coverage: { crawled: 300, discovered: 1200, skippedByTemplate: 40, skippedByLimit: 860, complete: false, stopReason: 'pageLimit' },
  };
  const f = runChecks(partial).find((x) => x.checkId === 3)!;
  const text = f.factors.map((x) => x.detail).join(' ');
  assert.match(text, /300/, 'сколько обошли — должно быть в тексте');
  assert.match(text, /1200/, 'сколько нашли — должно быть в тексте');
  assert.match(text, /потолок|не просмотрена/i, 'причина должна быть названа словами');
});

test('полный обход: вывод об отсутствии по-прежнему заявляется как нарушение (A, регресс)', () => {
  const f = runChecks(snapshot(RU)).find((x) => x.checkId === 3)!;
  assert.equal(f.verdict, 'violation', 'при полном обходе «документа нет» — обычное нарушение');
});

/**
 * Ревью задачи 2 (Critical 1 и 2): summary — это текст, который видит клиент
 * в карточке (FindingCard.tsx) и в Word-отчёте (docx.ts). Он ветвился по
 * вердикту, а не по canProveAbsence, и при неполном обходе называл неверную
 * причину («подвал не виден») вместо настоящей (обход не завершён, с цифрами).
 */
const PARTIAL_COVERAGE = {
  crawled: 300, discovered: 1200, skippedByTemplate: 40, skippedByLimit: 860,
  complete: false, stopReason: 'pageLimit' as const,
};

test('check3: summary при неполном обходе называет цифры охвата, а не «нам не видно» (CRITICAL 1)', () => {
  const s = snapshot(RU);
  const partial: SiteSnapshot = { ...s, coverage: PARTIAL_COVERAGE };
  const f = check3of(partial);
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /300/, 'сколько обошли — должно быть в summary');
  assert.match(f.summary, /1200/, 'сколько нашли — должно быть в summary');
  assert.doesNotMatch(f.summary, /нам не видно/, 'старая неверная причина не должна выводиться');
});

test('check4: summary при неполном обходе называет цифры охвата, а не «нам не видно» (CRITICAL 1)', () => {
  const s = snapshot(RU);
  const partial: SiteSnapshot = { ...s, coverage: PARTIAL_COVERAGE };
  const f = check4of(partial);
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /300/, 'сколько обошли — должно быть в summary');
  assert.match(f.summary, /1200/, 'сколько нашли — должно быть в summary');
  assert.doesNotMatch(f.summary, /нам не видно/, 'старая неверная причина не должна выводиться');
});

test('check5: summary при неполном обходе называет цифры охвата, а не «нам не видно» (CRITICAL 1)', () => {
  const s = snapshot(RU);
  const partial: SiteSnapshot = { ...s, coverage: PARTIAL_COVERAGE };
  const f = check5of(partial);
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /300/, 'сколько обошли — должно быть в summary');
  assert.match(f.summary, /1200/, 'сколько нашли — должно быть в summary');
  assert.doesNotMatch(f.summary, /нам не видно/, 'старая неверная причина не должна выводиться');
});

test('check6: summary при неполном обходе (без следов куки в скриптах) называет цифры охвата, а не «скрипт» (CRITICAL 2)', () => {
  const s = snapshot(RU); // CLEAN_HTML не содержит ни плашки, ни слова «cookie»/«куки»
  const partial: SiteSnapshot = { ...s, coverage: PARTIAL_COVERAGE };
  const f = check6of(partial);
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /300/, 'сколько обошли — должно быть в summary');
  assert.match(f.summary, /1200/, 'сколько нашли — должно быть в summary');
  assert.doesNotMatch(f.summary, /скрипт/i, 'причина «скрипт» неверна — следов куки в скриптах нет');
});

/**
 * Ревью задачи 2 (остаток): check7 при отсутствии форм вообще не различал
 * «форм нет, обход полный» (вывод достоверен) и «форм нет, обход неполный»
 * (форма могла быть на непросмотренной странице) — summary был зашит одной
 * фразой на оба случая и никогда не называл охват. Это ровно инцидент
 * gdpgroup.ru: «форм не найдено», хотя открыто 5 страниц из 15.
 */
test('check7: summary при неполном обходе без форм называет цифры охвата, а не «чекбоксов не найдено» (review)', () => {
  const s = snapshot(RU); // CLEAN_HTML — без единой формы, подвал виден, не SPA
  const partial: SiteSnapshot = { ...s, coverage: PARTIAL_COVERAGE };
  const f = check7of(partial);
  assert.match(f.summary, /300/, 'сколько обошли — должно быть в summary');
  assert.match(f.summary, /1200/, 'сколько нашли — должно быть в summary');
  assert.doesNotMatch(
    f.summary,
    /Заранее отмеченных чекбоксов не найдено/,
    'старая недостоверная формулировка про весь сайт не должна выводиться',
  );
});

test('check7: summary при полном обходе без форм называет обход достоверным, без цифр охвата (review, регресс)', () => {
  const f = check7of(snapshot(RU)); // coverage.complete: true по умолчанию, форм нет
  assert.match(f.summary, /обойдён полностью/, 'при полном обходе вывод должен называться достоверным');
  assert.doesNotMatch(f.summary, /\d/, 'цифр охвата при полном обходе быть не должно');
});

/**
 * Задача 3, правка 2: обход может остановиться по бюджету объёма скачанного
 * HTML (защита сервера с 2 ГБ памяти от переполнения), а не только по потолку
 * страниц или лимиту времени. Причина в summary обязана называть себя верно —
 * владелец продукта требует, чтобы «требует ручной проверки» объясняло себя,
 * а не молчаливо отписывалось чужой формулировкой.
 */
const SIZE_LIMIT_COVERAGE = {
  crawled: 120, discovered: 900, skippedByTemplate: 5, skippedByLimit: 780,
  complete: false, stopReason: 'sizeLimit' as const,
};

test('check3: summary при stopReason "sizeLimit" называет верную причину и цифры охвата, не потолок/время (правка 2)', () => {
  const s = snapshot(RU);
  const partial: SiteSnapshot = { ...s, coverage: SIZE_LIMIT_COVERAGE };
  const f = check3of(partial);
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /120/, 'сколько обошли — должно быть в summary');
  assert.match(f.summary, /900/, 'сколько нашли — должно быть в summary');
  assert.doesNotMatch(f.summary, /потолок обхода/i, 'причина «потолок страниц» здесь неверна');
  assert.doesNotMatch(f.summary, /лимит времени/i, 'причина «лимит времени» здесь неверна');
  assert.match(f.summary, /объ[её]м/i, 'настоящая причина — объём скачанного HTML — обязана быть названа');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHosting, type GeoDeps } from './geo';

/** Подставные зависимости: ни DNS, ни сети. */
function deps(over: Partial<GeoDeps> = {}): GeoDeps {
  return {
    resolve4: async () => ['31.31.198.246'],
    fetchJson: async () => null,
    ...over,
  };
}

const RDAP_RU = { country: 'RU', name: 'REGRU-NETWORK' };
const RDAP_CDN = { name: 'CLOUDFLARENET' };
const RDAP_ARIN = { name: 'GOGL' };

test('российский адрес: страна из RDAP, ipwho.is не спрашиваем', async () => {
  let ipwhoCalls = 0;
  const fact = await resolveHosting('https://example.ru/', deps({
    fetchJson: async (url) => {
      if (url.includes('rdap.org')) return RDAP_RU;
      ipwhoCalls += 1;
      return { success: true, country_code: 'RU' };
    },
  }));
  assert.equal(fact.country, 'RU');
  assert.equal(fact.netname, 'REGRU-NETWORK');
  assert.equal(fact.isCdn, false);
  assert.deepEqual(fact.confirmedBy, ['rdap']);
  assert.equal(ipwhoCalls, 0, 'для RU второй источник дёргать незачем');
});

test('заграница: RDAP дал не-RU, ipwho.is подтвердил', async () => {
  const fact = await resolveHosting('https://example.com/', deps({
    fetchJson: async (url) =>
      url.includes('rdap.org')
        ? { country: 'DE', name: 'HETZNER-NET' }
        : { success: true, country_code: 'DE' },
  }));
  assert.equal(fact.country, 'DE');
  assert.equal(fact.geoCountry, 'DE');
  assert.deepEqual(fact.confirmedBy, ['rdap', 'ipwho.is']);
});

test('ARIN не отдаёт country — страну берём у ipwho.is', async () => {
  const fact = await resolveHosting('https://example.com/', deps({
    fetchJson: async (url) =>
      url.includes('rdap.org') ? RDAP_ARIN : { success: true, country_code: 'US' },
  }));
  assert.equal(fact.country, null, 'у ARIN поля country нет');
  assert.equal(fact.geoCountry, 'US');
  assert.deepEqual(fact.confirmedBy, ['rdap', 'ipwho.is']);
});

/* ─────────────────── C1: CDN опознаётся не только по точному имени ─────────────────── */

test('CDN: CLOUDFLARENET-EU опознаётся по вхождению подстроки (C1, регресс)', async () => {
  // 141.101.64.0/18 и 188.114.96.0/20 — опубликованные диапазоны Cloudflare,
  // RDAP отдаёт для них имя сети CLOUDFLARENET-EU. При точном сравнении со
  // строкой 'CLOUDFLARENET' это имя не ловилось, и российский сайт за таким
  // диапазоном получал ложное обвинение вместо «вручную».
  let ipwhoCalls = 0;
  const fact = await resolveHosting('https://example.com/', deps({
    fetchJson: async (url) => {
      if (url.includes('rdap.org')) return { name: 'CLOUDFLARENET-EU' };
      ipwhoCalls += 1;
      return { success: true, country_code: 'US' };
    },
  }));
  assert.equal(fact.isCdn, true);
  assert.equal(ipwhoCalls, 0, 'CDN опознан по RDAP — второй источник не нужен');
});

test('CDN: безымянный диапазон опознаётся по connection.org в ipwho.is (C1, регресс)', async () => {
  // 197.234.240.0/22 — опубликованный диапазон Cloudflare, RDAP для него не
  // отдаёт поле name вовсе (но отвечает и называет country). Без сигнала от
  // ipwho.is такой диапазон проходил как обычный хостинг с реальной страной.
  const fact = await resolveHosting('https://example.com/', deps({
    fetchJson: async (url) =>
      url.includes('rdap.org')
        ? { country: 'US' } // как у 197.234.240.0/22: country есть, name — нет
        : { success: true, country_code: 'US', connection: { org: 'Cloudflare, Inc.' } },
  }));
  assert.equal(fact.isCdn, true);
});

test('CDN: опознаём и второй источник не спрашиваем', async () => {
  let ipwhoCalls = 0;
  const fact = await resolveHosting('https://example.com/', deps({
    fetchJson: async (url) => {
      if (url.includes('rdap.org')) return RDAP_CDN;
      ipwhoCalls += 1;
      return { success: true, country_code: 'US' };
    },
  }));
  assert.equal(fact.isCdn, true);
  assert.equal(ipwhoCalls, 0, 'за CDN происхождение не видно, спрашивать нечего');
});

test('DNS не резолвится — факт с ошибкой, без выдумок', async () => {
  const fact = await resolveHosting('https://example.ru/', deps({
    resolve4: async () => { throw new Error('ENOTFOUND'); },
  }));
  assert.deepEqual(fact.ips, []);
  assert.equal(fact.country, null);
  assert.ok(fact.error, 'причина обязана быть названа');
});

test('RDAP молчит — страны нет, ipwho.is всё равно спрашиваем', async () => {
  const fact = await resolveHosting('https://example.ru/', deps({
    fetchJson: async (url) => (url.includes('rdap.org') ? null : { success: true, country_code: 'RU' }),
  }));
  assert.equal(fact.country, null);
  assert.equal(fact.geoCountry, 'RU');
  assert.deepEqual(fact.confirmedBy, ['ipwho.is']);
});

test('ipwho.is вернул success:false — страну не берём', async () => {
  const fact = await resolveHosting('https://example.com/', deps({
    fetchJson: async (url) =>
      url.includes('rdap.org') ? RDAP_ARIN : { success: false, message: 'reserved range' },
  }));
  assert.equal(fact.geoCountry, null);
  assert.deepEqual(fact.confirmedBy, ['rdap']);
});

/* ─────────────────── I1: несколько A-записей — проверяем ВСЕ ─────────────────── */

test('несколько A-записей, все в РФ — ok без второго источника (I1)', async () => {
  let ipwhoCalls = 0;
  const fact = await resolveHosting('https://example.ru/', deps({
    resolve4: async () => ['31.31.198.246', '31.31.198.247'],
    fetchJson: async (url) => {
      if (url.includes('rdap.org')) return RDAP_RU;
      ipwhoCalls += 1;
      return { success: true, country_code: 'RU' };
    },
  }));
  assert.deepEqual(fact.ips, ['31.31.198.246', '31.31.198.247']);
  assert.equal(fact.country, 'RU');
  assert.equal(ipwhoCalls, 0, 'все адреса подтверждены RDAP как RU — второй источник не нужен');
});

test('несколько A-записей, один в РФ по RDAP, другой за границей — намёк на RU останавливает и обвинение, и оправдание (I1 + CRITICAL, регресс)', async () => {
  // Первый адрес RDAP подтвердил как RU, второй — как DE. Раньше (I1) код
  // смотрел только на ips[0] и в понедельник давал «ok», а во вторник —
  // обвинение, в зависимости от порядка DNS-ротации. I1 это починил, но
  // финальное ревью (CRITICAL) нашло следующий слой бага: даже проверив ВСЕ
  // адреса, старый код игнорировал явный RU от RDAP по соседнему адресу и
  // всё равно обвинял по DE. По спеке §4.2 «любой намёк на Россию снимает
  // обвинение» — правильный итог здесь «не знаем», а не «за границей».
  let ipwhoCalls = 0;
  const fact = await resolveHosting('https://example.ru/', deps({
    resolve4: async () => ['31.31.198.246', '5.9.1.1'],
    fetchJson: async (url) => {
      if (url.includes('rdap.org')) {
        return url.includes('31.31.198.246') ? RDAP_RU : { country: 'DE', name: 'HETZNER-NET' };
      }
      ipwhoCalls += 1;
      return { success: true, country_code: 'DE' };
    },
  }));
  assert.deepEqual(fact.ips, ['31.31.198.246', '5.9.1.1'], 'все проверенные A-записи сохраняются');
  assert.notEqual(fact.country, 'RU', 'полностью подтвердить RU нельзя — второй адрес реестр назвал DE');
  assert.equal(fact.country, null, 'намёк на RU не даёт и обвинить по DE — country тоже null');
  assert.equal(fact.geoCountry, null, 'второй источник не спрашиваем: намёка на RU уже достаточно, чтобы не обвинять');
  assert.equal(ipwhoCalls, 0, 'RU-намёк останавливает проверку раньше, чем доходит до ipwho.is');
  assert.deepEqual(fact.confirmedBy, ['rdap']);
});

/* ─────────────────── CRITICAL: RDAP молчит именно про обвиняемый адрес ─────────────────── */

test('RDAP молчит про адрес, по которому мог бы выноситься вердикт, но отвечает RU про соседний — обвинения нет (CRITICAL, регресс)', async () => {
  // Точное воспроизведение из отчёта о финальном ревью: два адреса одного
  // российского хостера. RDAP молчит про 31.31.198.246 (в старом коде именно
  // он становился «представителем» по умолчанию, раз явно нероссийского
  // адреса не нашлось) и отвечает RU/REGRU-NETWORK про 31.31.198.247.
  // ipwho.is при этом ошибается и называет DE.
  //
  // Старый баг был двойным: (1) confirmedBy для проверки «RDAP ответил?»
  // считался глобально — «ответил хоть про какой-то адрес» — хотя RDAP не
  // сказал НИЧЕГО про адрес, по которому в итоге выносился вердикт; (2) сам
  // явный RU от соседнего адреса игнорировался вместо того, чтобы остановить
  // обвинение. Результат был: {country: null, geoCountry: 'DE',
  // confirmedBy: ['rdap','ipwho.is']} → verdict: violation.
  let ipwhoCalls = 0;
  const fact = await resolveHosting('https://example.ru/', deps({
    resolve4: async () => ['31.31.198.246', '31.31.198.247'],
    fetchJson: async (url) => {
      if (url.includes('rdap.org')) {
        return url.includes('31.31.198.246') ? null : RDAP_RU;
      }
      ipwhoCalls += 1;
      return { success: true, country_code: 'DE' }; // ipwho.is ошибается
    },
  }));
  assert.equal(fact.country, null, 'полного подтверждения RU нет — один адрес RDAP не проверил');
  assert.equal(fact.geoCountry, null, 'ошибке ipwho.is (DE) даже не дали случиться — до неё не дошли');
  assert.deepEqual(fact.confirmedBy, ['rdap'], 'RDAP реально ответил (про соседний адрес) — это не молчание реестра');
  assert.equal(ipwhoCalls, 0, 'намёк на RU снимает обвинение раньше похода ко второму источнику');
});

/* ─────────────────── IMPORTANT 2: неподтверждённый адрес не даёт "ok" по умолчанию ─────────────────── */

test('RDAP ответил RU по первому адресу и промолчал про второй — НЕ ok (IMPORTANT 2, регресс)', async () => {
  // Старый код: allRu требовал ВСЕ адреса RU, это условие не выполнялось —
  // но дальше flaggedIdx = perIp.findIndex(явно не-RU) не находил ничего
  // (второй адрес просто null, а не явно иностранный), падал на idx = 0,
  // и раз perIp[0].country === 'RU', возвращал country: 'RU' → hostingFactor
  // выдавал «ok», хотя второй адрес реестр не подтвердил вовсе. Комментарий
  // в geo.ts к тому моменту уже утверждал обратное — сам код это не делал.
  const fact = await resolveHosting('https://example.ru/', deps({
    resolve4: async () => ['31.31.198.246', '5.9.1.1'],
    fetchJson: async (url) =>
      url.includes('rdap.org') ? (url.includes('31.31.198.246') ? RDAP_RU : null) : null,
  }));
  assert.notEqual(fact.country, 'RU', 'RU подтверждён не для всех проверенных адресов — не "ok" по умолчанию');
  assert.equal(fact.country, null);
  assert.deepEqual(fact.confirmedBy, ['rdap'], 'RDAP ответил (про первый адрес) — это отражено честно');
});

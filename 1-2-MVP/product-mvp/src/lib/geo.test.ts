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

test('несколько A-записей: проверяем первую, но сохраняем все', async () => {
  const fact = await resolveHosting('https://example.ru/', deps({
    resolve4: async () => ['31.31.198.246', '31.31.198.247'],
    fetchJson: async (url) => (url.includes('rdap.org') ? RDAP_RU : null),
  }));
  assert.deepEqual(fact.ips, ['31.31.198.246', '31.31.198.247']);
});

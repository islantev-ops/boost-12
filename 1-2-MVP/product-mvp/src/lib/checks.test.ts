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

test('сайт в РФ и без счётчиков — соответствует', () => {
  const f = check1of(snapshot(RU));
  assert.equal(f.verdict, 'ok');
  assert.match(f.summary, /31\.31\.198\.246/, 'IP обязан быть в тексте — его перепроверяют');
  assert.match(f.summary, /REGRU-NETWORK/);
});

test('сайт за границей, оба источника сошлись — нарушение', () => {
  const f = check1of(snapshot({
    ips: ['5.9.1.1'], country: 'DE', netname: 'HETZNER-NET',
    geoCountry: 'DE', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
  assert.match(f.summary, /DE/);
  assert.doesNotMatch(f.summary, /баз[аы] данных сайта|ваша база|где.*база/i,
    'про базу клиента не пишем ничего — мы её не видели');
});

test('ARIN без country, ipwho.is назвал США — нарушение', () => {
  const f = check1of(snapshot({
    ips: ['8.8.8.8'], country: null, netname: 'GOGL',
    geoCountry: 'US', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'violation');
});

test('источники разошлись — вручную, а не обвинение', () => {
  const f = check1of(snapshot({
    ips: ['1.2.3.4'], country: 'DE', netname: 'SOME-NET',
    geoCountry: 'RU', isCdn: false, confirmedBy: ['rdap', 'ipwho.is'],
  }));
  assert.equal(f.verdict, 'manual');
});

test('за CDN — вручную', () => {
  const f = check1of(snapshot({
    ips: ['104.16.132.229'], country: null, netname: 'CLOUDFLARENET',
    geoCountry: null, isCdn: true, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'manual');
  assert.match(f.summary, /CDN/);
});

test('второй источник не ответил — вручную, не нарушение', () => {
  const f = check1of(snapshot({
    ips: ['8.8.8.8'], country: null, netname: 'GOGL',
    geoCountry: null, isCdn: false, confirmedBy: ['rdap'],
  }));
  assert.equal(f.verdict, 'manual');
});

test('хостинг не выяснен вовсе — вручную', () => {
  assert.equal(check1of(snapshot(null)).verdict, 'manual');
  assert.equal(check1of(snapshot({
    ips: [], country: null, netname: null, geoCountry: null,
    isCdn: false, confirmedBy: [], error: 'DNS не отдал адрес',
  })).verdict, 'manual');
});

test('Google Analytics перебивает даже российский хостинг', () => {
  const html = '<html><body><script src="https://www.google-analytics.com/analytics.js"></script></body></html>';
  const f = check1of(snapshot(RU, html));
  assert.equal(f.verdict, 'violation');
});

# Проверка №1: география сервера — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверка №1 «Данные не уходят за границу» перестаёт всегда возвращать
«вручную» и начинает выдавать `ok` для сайтов в РФ и `violation` для заграничных.

**Architecture:** Новый модуль `src/lib/geo.ts` — единственное место, знающее про
DNS и внешние геоисточники. Он отдаёт факт о хостинге; `checks.ts` про сеть не
знает, получает готовый факт из снапшота и раздаёт голоса. Сетевые зависимости
внедряются параметром, поэтому и модуль, и проверка тестируются без сети.
`auditSite` склеивает: краулит, резолвит хостинг, кладёт в снапшот.

**Tech Stack:** TypeScript, Next 16 (Node runtime), `node:dns/promises`, `fetch`,
тесты — встроенный `node:test` через `tsx`.

## Global Constraints

- **Дизайн-документ:** [`docs/superpowers/specs/2026-07-16-check1-geografiya-servera-design.md`](../specs/2026-07-16-check1-geografiya-servera-design.md). Расхождение плана со спекой — ошибка плана.
- **Любая неопределённость → `unknown` → «вручную».** Никогда `ok`, никогда `violation`. PRD §8: тихого четвёртого исхода нет.
- **Обвиняем только при прямом подтверждении** источником Б не-российской страны, при этом источник А не говорит «RU».
- **Про базу данных клиента в отчёте не пишем ничего** — ни утверждения, ни вопроса. Только измеренный факт (IP, страна, netname) и норма близко к тексту.
- **Ссылка на норму — только с якорем на часть статьи:** `https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/#dst14` (152-ФЗ ст. 18 ч. 5). Уже лежит в `legal.ts`, новых ссылок не изобретать.
- **Состав чек-листа не меняем.** Лендинг уже обещает «Сервер в РФ» и помечает пункт как [Авто]. Лендинг и PRD не трогаем.
- **RDAP только через `https://rdap.org/ip/<IP>` с переходом по редиректам.** Не `rdap.db.ripe.net`: он отдаёт 301 на не-RIPE адреса.
- **Комментарии по-русски**, в тон существующему коду: объясняют «почему», а не «что».

---

## Файловая структура

| Файл | Ответственность |
|---|---|
| `src/lib/geo.ts` (создать) | Единственное место, знающее про DNS, RDAP и ipwho.is. Отдаёт `HostingFact`. |
| `src/lib/geo.test.ts` (создать) | Тесты `resolveHosting` на подставных зависимостях, без сети. |
| `src/lib/types.ts` (изменить) | Тип `HostingFact`; поле `hosting` в `SiteSnapshot`. |
| `src/lib/crawl.ts` (изменить) | Проставляет `hosting: null` в оба возврата. Про гео не знает. |
| `src/lib/audit.ts` (изменить) | Склейка: краул + резолв хостинга → снапшот. |
| `src/lib/checks.ts` (изменить) | `check1`: убрать мёртвый фактор, добавить фактор хостинга и формулировки. |
| `src/lib/checks.test.ts` (создать) | Тесты фактора хостинга и вердикта `check1` на фикстурах. |
| `package.json` (изменить) | `tsx` в devDependencies, скрипт `test`. |

---

## Task 1: Инфраструктура тестов и починка `check-site`

Тестов в проекте нет вообще, а `npm run check-site` из README падает: скрипт
зовёт `tsx`, которого нет в зависимостях. Обе дырки закрываются одной задачей —
без работающего тест-раннера остальные задачи писать не во что.

**Files:**
- Modify: `1-2-MVP/product-mvp/package.json`
- Create: `1-2-MVP/product-mvp/src/lib/smoke.test.ts` (временный, удаляется в этой же задаче)

**Interfaces:**
- Consumes: ничего.
- Produces: команда `npm test` в `1-2-MVP/product-mvp`, запускающая `node:test` через `tsx`; работающий `npm run check-site <url>`.

- [ ] **Step 1: Поставить tsx в зависимости**

Из каталога `1-2-MVP/product-mvp`:

```bash
npm install --save-dev tsx
```

- [ ] **Step 2: Добавить скрипт test в package.json**

В `1-2-MVP/product-mvp/package.json`, в блок `"scripts"`, рядом с `check-site`:

```json
    "test": "node --import tsx --test src/lib/*.test.ts",
```

Почему `--import tsx`, а не `node --test` напрямую: в коде импорты без
расширений (`./types`), нативный резолвер ESM их не понимает, а tsx понимает.

- [ ] **Step 3: Написать временный тест, проверяющий, что раннер жив**

Создать `1-2-MVP/product-mvp/src/lib/smoke.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Verdict } from './types';

test('раннер запускается и видит типы проекта', () => {
  const v: Verdict = 'manual';
  assert.equal(v, 'manual');
});
```

- [ ] **Step 4: Запустить тест**

```bash
npm test
```

Ожидается: `# pass 1`, `# fail 0`, код выхода 0.

Если падает на импорте `./types` — значит `--import tsx` не подхватился;
проверить, что tsx установился (`npx tsx --version`).

- [ ] **Step 5: Проверить, что check-site теперь работает без npx**

```bash
npm run check-site https://yarcmyk.ru/
```

Ожидается: печатается `=== https://yarcmyk.ru/ ===`, `CMS: bitrix`, список из 10
пунктов. Раньше падало с «tsx не является внутренней или внешней командой».

- [ ] **Step 6: Удалить временный тест**

```bash
rm 1-2-MVP/product-mvp/src/lib/smoke.test.ts
```

- [ ] **Step 7: Коммит**

```bash
git add 1-2-MVP/product-mvp/package.json 1-2-MVP/product-mvp/package-lock.json
git commit -m "Тест-раннер и починка check-site: tsx в зависимости

README обещал npm run check-site, а команда падала: скрипт зовёт tsx,
которого не было в зависимостях. Заодно появился npm test — тестов
в проекте не было вовсе."
```

---

## Task 2: Тип HostingFact и поле в снапшоте

Отдельная маленькая задача: типы нужны и `geo.ts`, и `checks.ts`, а их правка
затрагивает `crawl.ts`. Отделена, чтобы следующие задачи не спорили за одни
файлы.

**Files:**
- Modify: `1-2-MVP/product-mvp/src/lib/types.ts`
- Modify: `1-2-MVP/product-mvp/src/lib/crawl.ts:256-267` и `crawl.ts:306-314`

**Interfaces:**
- Consumes: ничего.
- Produces: тип `HostingFact` и поле `SiteSnapshot.hosting: HostingFact | null`.

- [ ] **Step 1: Добавить тип HostingFact в types.ts**

В `src/lib/types.ts`, перед `export type SiteSnapshot`:

```ts
/**
 * Где физически стоит сайт. Факт, а не вывод: это ровно то, что вернули
 * источники, без домыслов о базе данных.
 *
 * `country` берётся из RDAP и есть только у RIPE-региона: у ответов ARIN поля
 * страны нет вовсе. Поэтому `null` здесь значит «реестр страну не назвал»,
 * а не «страны нет».
 */
export type HostingFact = {
  /** Все A-записи домена */
  ips: string[];
  /** ISO-код страны из RDAP; null — реестр страну не сообщил */
  country: string | null;
  /** Имя сети из RDAP: REGRU-NETWORK, CLOUDFLARENET */
  netname: string | null;
  /** Страна по данным ipwho.is; null — не спрашивали или не ответил */
  geoCountry: string | null;
  /** netname опознан как CDN — за ним происхождение не видно */
  isCdn: boolean;
  /** Какие источники реально ответили: 'rdap', 'ipwho.is' */
  confirmedBy: string[];
  /** Человекочитаемая причина, почему факт неполон */
  error?: string;
};
```

- [ ] **Step 2: Добавить поле hosting в SiteSnapshot**

В `src/lib/types.ts`, в `export type SiteSnapshot`, после `footerVisible`:

```ts
  /**
   * Где стоит сайт. Заполняется в `auditSite`, не в `crawlSite`: краул знает
   * про страницы, гео — про сеть, и мешать их не нужно. `null` — не смотрели.
   */
  hosting: HostingFact | null;
```

- [ ] **Step 3: Проставить hosting в обоих возвратах crawlSite**

В `src/lib/crawl.ts`, в возврате «сайт не открывается» (около строки 256),
после `pages: []`:

```ts
      hosting: null,
```

И в финальном возврате (около строки 306), после `pages,`:

```ts
    hosting: null,
```

- [ ] **Step 4: Проверить, что типы сходятся**

```bash
npx tsc --noEmit
```

Ожидается: ошибок нет. Если ругается на отсутствующий `hosting` в тестовых
фикстурах — их пока нет, значит ошибок и не будет.

- [ ] **Step 5: Коммит**

```bash
git add 1-2-MVP/product-mvp/src/lib/types.ts 1-2-MVP/product-mvp/src/lib/crawl.ts
git commit -m "Тип HostingFact и поле hosting в снапшоте"
```

---

## Task 3: Модуль geo.ts — резолв хостинга

Ядро задачи. Пишется по TDD: сначала тесты на подставных зависимостях, потом
реализация. Сеть в тестах не трогаем — иначе тесты будут падать от чужого
хостинга, а не от наших багов.

**Files:**
- Create: `1-2-MVP/product-mvp/src/lib/geo.ts`
- Create: `1-2-MVP/product-mvp/src/lib/geo.test.ts`

**Interfaces:**
- Consumes: `HostingFact` из `./types` (Task 2).
- Produces:
  - `export type GeoDeps = { resolve4(host: string): Promise<string[]>; fetchJson(url: string): Promise<unknown | null> }`
  - `export async function resolveHosting(url: string, deps?: GeoDeps): Promise<HostingFact>`
  - `export const CDN_NETNAMES: string[]`

- [ ] **Step 1: Написать падающие тесты**

Создать `1-2-MVP/product-mvp/src/lib/geo.test.ts`:

```ts
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
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
npm test
```

Ожидается: падение с `Cannot find module './geo'`.

- [ ] **Step 3: Написать geo.ts**

Создать `1-2-MVP/product-mvp/src/lib/geo.ts`:

```ts
import { resolve4 as dnsResolve4 } from 'node:dns/promises';
import type { HostingFact } from './types';

const TIMEOUT_MS = 12_000;

/**
 * Имена сетей CDN по данным RDAP. За CDN настоящий хостинг не виден: адрес
 * принадлежит посреднику, а не сайту.
 *
 * Список пополняется ТОЛЬКО по факту встречи, не по памяти: лишняя запись
 * уводит здоровый сайт в «вручную». CLOUDFLARENET проверен на 104.16.132.229.
 */
export const CDN_NETNAMES = ['CLOUDFLARENET'];

/** Сеть и DNS вынесены в зависимости — иначе проверку не протестировать. */
export type GeoDeps = {
  resolve4(host: string): Promise<string[]>;
  fetchJson(url: string): Promise<unknown | null>;
};

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'follow', // rdap.org отвечает 301 в нужный реестр
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Ответ не пришёл или пришёл не JSON. Это «не знаем», а не «нарушение».
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const defaultDeps: GeoDeps = { resolve4: dnsResolve4, fetchJson };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Где стоит сайт.
 *
 * Асимметрия по спеке §4.2: RDAP сказал RU — верим и на этом останавливаемся
 * (ошибка тут даёт пропуск, а не ложное обвинение). Всё остальное — заявка на
 * обвинение, её обязан подтвердить независимый источник.
 */
export async function resolveHosting(url: string, deps: GeoDeps = defaultDeps): Promise<HostingFact> {
  const empty: HostingFact = {
    ips: [], country: null, netname: null, geoCountry: null,
    isCdn: false, confirmedBy: [],
  };

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ...empty, error: 'Адрес сайта не разбирается.' };
  }

  let ips: string[];
  try {
    ips = await deps.resolve4(host);
  } catch {
    return { ...empty, error: `DNS не отдал адрес для ${host}.` };
  }
  if (!ips.length) return { ...empty, error: `DNS не отдал адрес для ${host}.` };

  const confirmedBy: string[] = [];
  const rdap = (await deps.fetchJson(`https://rdap.org/ip/${ips[0]}`)) as
    | { country?: unknown; name?: unknown }
    | null;
  if (rdap) confirmedBy.push('rdap');

  const country = rdap ? str(rdap.country)?.toUpperCase() ?? null : null;
  const netname = rdap ? str(rdap.name)?.toUpperCase() ?? null : null;
  const isCdn = Boolean(netname && CDN_NETNAMES.includes(netname));

  // За CDN спрашивать гео бессмысленно: ответят про узел CDN, а не про сайт.
  // Российский адрес подтверждать нечем: RDAP тут и есть первоисточник.
  if (isCdn || country === 'RU') {
    return { ips, country, netname, geoCountry: null, isCdn, confirmedBy };
  }

  const geo = (await deps.fetchJson(`https://ipwho.is/${ips[0]}`)) as
    | { success?: unknown; country_code?: unknown }
    | null;
  const geoOk = Boolean(geo && geo.success === true);
  const geoCountry = geoOk ? str(geo!.country_code)?.toUpperCase() ?? null : null;
  if (geoCountry) confirmedBy.push('ipwho.is');

  return { ips, country, netname, geoCountry, isCdn, confirmedBy };
}
```

- [ ] **Step 4: Прогнать тесты**

```bash
npm test
```

Ожидается: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Проверить на живых адресах, что настоящая сеть отвечает как ждём**

```bash
npx tsx -e "import('./src/lib/geo.ts').then(async (m) => { for (const u of ['https://yarkremlin.ru/','https://example.com/']) console.log(u, JSON.stringify(await m.resolveHosting(u))); })"
```

Ожидается: у `yarkremlin.ru` — `country: "RU"`, `netname: "REGRU-NETWORK"`,
`confirmedBy: ["rdap"]`. У `example.com` — `geoCountry` заполнен, `confirmedBy`
содержит `ipwho.is`.

- [ ] **Step 6: Коммит**

```bash
git add 1-2-MVP/product-mvp/src/lib/geo.ts 1-2-MVP/product-mvp/src/lib/geo.test.ts
git commit -m "geo.ts: резолв хостинга через RDAP и ipwho.is

RDAP берём через rdap.org с редиректами: rdap.db.ripe.net отдаёт 301 на
не-RIPE адреса, и заграничный сайт остался бы без ответа. Поле country
есть только у RIPE, у ARIN его нет — для заграницы страну даёт ipwho.is.

Второй источник дёргаем, только когда RDAP не сказал RU: обвинение
требует подтверждения, соответствие — нет."
```

---

## Task 4: Склейка в auditSite

**Files:**
- Modify: `1-2-MVP/product-mvp/src/lib/audit.ts`

**Interfaces:**
- Consumes: `resolveHosting` из `./geo` (Task 3); `SiteSnapshot.hosting` (Task 2).
- Produces: снапшот с заполненным `hosting` на входе в `runChecks`.

- [ ] **Step 1: Заполнить hosting в auditSite**

Заменить содержимое `src/lib/audit.ts`:

```ts
import { findAnglicisms } from './anglicisms';
import { runChecks } from './checks';
import { crawlSite } from './crawl';
import { resolveHosting } from './geo';
import type { AuditResult } from './types';

/** Вставил ссылку → аудит → перепроверка. PRD §5.1–5.3. */
export async function auditSite(url: string): Promise<AuditResult> {
  const crawled = await crawlSite(url);

  if (!crawled.reachable) {
    return { snapshot: crawled, findings: [], anglicisms: [] };
  }

  // Краул знает про страницы, geo — про сеть. Склеиваем здесь, чтобы ни один
  // из них не знал про другого.
  const snapshot = { ...crawled, hosting: await resolveHosting(crawled.finalUrl) };

  return {
    snapshot,
    findings: runChecks(snapshot),
    anglicisms: findAnglicisms(snapshot),
  };
}
```

- [ ] **Step 2: Проверить типы**

```bash
npx tsc --noEmit
```

Ожидается: ошибок нет.

- [ ] **Step 3: Прогнать на живом сайте**

```bash
npm run check-site https://yarkremlin.ru/
```

Ожидается: аудит отрабатывает как раньше (вердикты пока не изменились —
`check1` ещё не тронут). Падений нет, время выросло на 1–2 секунды.

- [ ] **Step 4: Коммит**

```bash
git add 1-2-MVP/product-mvp/src/lib/audit.ts
git commit -m "auditSite: резолвим хостинг и кладём в снапшот"
```

---

## Task 5: Переписать check1

**Files:**
- Modify: `1-2-MVP/product-mvp/src/lib/checks.ts:201-293`
- Create: `1-2-MVP/product-mvp/src/lib/checks.test.ts`

**Interfaces:**
- Consumes: `SiteSnapshot.hosting` (Task 2), `HostingFact` (Task 2).
- Produces: `check1`, дающий `ok` / `violation` / `manual` вместо вечного `manual`.

- [ ] **Step 1: Написать падающие тесты**

Создать `1-2-MVP/product-mvp/src/lib/checks.test.ts`:

```ts
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
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
npm test
```

Ожидается: падения в `checks.test.ts` — сейчас `check1` всегда `manual`.
Проходит только тест про CDN и про невыясненный хостинг (там `manual` и ожидается).

- [ ] **Step 3: Заменить мёртвый фактор на фактор хостинга**

В `src/lib/checks.ts` удалить блок «Гео-размещение сервера требует внешних баз…»
с фактором `Физическое размещение сервера в РФ` (строки ~268-276) и вставить
вместо него:

```ts
  factors.push(hostingFactor(s.hosting));
```

- [ ] **Step 4: Добавить функцию hostingFactor перед check1**

В `src/lib/checks.ts`, перед `function check1`:

```ts
/**
 * Голос за размещение сайта. Спека §4.2.
 *
 * Обвиняем ровно в одном случае: источник Б прямо назвал не-российскую страну,
 * и источник А этому не противоречит. Любой намёк на Россию, любое молчание
 * источника, любой CDN — `unknown`. Ошибка в сторону «не знаем» стоит одного
 * пункта в отчёте, ошибка в сторону обвинения — всего доверия.
 */
function hostingFactor(h: SiteSnapshot['hosting']): Factor {
  const name = 'Размещение сайта';

  if (!h || !h.ips.length) {
    return { name, vote: 'unknown', detail: h?.error ?? 'Где стоит сайт, выяснить не удалось.' };
  }

  const where = `IP ${h.ips[0]}${h.netname ? `, сеть ${h.netname}` : ''}`;

  if (h.isCdn) {
    return {
      name,
      vote: 'unknown',
      detail: `Сайт отдаётся через CDN (${h.netname}). За CDN физическое размещение снаружи не определяется: адрес принадлежит посреднику. ${where}.`,
    };
  }

  if (h.country === 'RU') {
    return { name, vote: 'ok', detail: `Сайт размещён в РФ: ${where}, страна RU по данным RIPE.` };
  }

  if (!h.geoCountry) {
    return {
      name,
      vote: 'unknown',
      detail: `Страну размещения подтвердить нечем: второй источник не ответил. ${where}.`,
    };
  }

  if (h.geoCountry === 'RU') {
    return {
      name,
      vote: 'unknown',
      detail: `Источники разошлись: реестр${h.country ? ` называет страну ${h.country}` : ' страну не назвал'}, геобаза — RU. ${where}.`,
    };
  }

  return {
    name,
    vote: 'violation',
    detail: `Сайт размещён за пределами РФ: ${where}, страна ${h.country ?? h.geoCountry} — подтверждено источниками: ${h.confirmedBy.join(', ')}.`,
  };
}
```

- [ ] **Step 5: Переписать summary в check1**

В `src/lib/checks.ts`, в `return` из `check1`, заменить поле `summary` на:

```ts
    summary: (() => {
      const hf = factors.find((f) => f.name === 'Размещение сайта')!;
      if (verdict === 'violation') {
        // Печатаем только измеренное. Про базу данных клиента — ни слова:
        // мы её не видели, а заграница и без того красный флаг.
        return found
          ? `На сайте установлен ${found}. Данные посетителей передаются на серверы за пределами РФ, что противоречит требованию о локализации персональных данных.`
          : `${hf.detail} Закон запрещает запись, накопление и хранение персональных данных граждан РФ с использованием баз данных, находящихся за пределами территории РФ.`;
      }
      if (verdict === 'ok') {
        return `Google Analytics и Google Tag Manager не обнаружены. ${hf.detail}`;
      }
      return gatedEv.length
        ? `Код счётчика Google на сайте есть, но срабатывает он только после согласия. Заявлять передачу данных нельзя — нужна проверка в браузере. ${hf.detail}`
        : `Google Analytics и Google Tag Manager не обнаружены. ${hf.detail}`;
    })(),
```

- [ ] **Step 6: Прогнать тесты**

```bash
npm test
```

Ожидается: `# fail 0`. Все тесты `geo.test.ts` и `checks.test.ts` зелёные.

- [ ] **Step 7: Коммит**

```bash
git add 1-2-MVP/product-mvp/src/lib/checks.ts 1-2-MVP/product-mvp/src/lib/checks.test.ts
git commit -m "check1: живой фактор размещения вместо заглушки

Фактор «размещение сервера» был захардкожен как unknown и ронял в manual
всю проверку, включая исправную часть про Google Analytics. Теперь он
голосует по факту: RU → ok, подтверждённая заграница → violation, CDN и
любая неопределённость → manual.

Про базу данных клиента в отчёте не пишем: мы её не видели."
```

---

## Task 6: Проверка на контрольной выборке

Критерий готовности из спеки §9.1 — не «тесты зелёные», а «на пяти реальных
сайтах пункт №1 даёт `ок` вместо пяти «вручную»».

**Files:** только чтение, изменений нет.

**Interfaces:**
- Consumes: всё из задач 1–5.
- Produces: подтверждение, что цель достигнута.

- [ ] **Step 1: Прогнать все пять сайтов**

```bash
cd 1-2-MVP/product-mvp
for u in https://yarcmyk.ru/ https://magic-yarn.ru/ https://zapovednaya-polyana.ru/ https://yarkremlin.ru/ https://we-energy.ru/; do
  npm run check-site "$u" 2>&1 | grep -E '^ 1\.|^===';
done
```

Ожидается: у всех пяти строка вида
`1. [ок       ] Передача данных за границу` — вместо прежнего `[вручную  ]`.

Все пять хостятся в РФ (проверено при диагностике: REG.RU и YARNET), счётчиков
Google на них не найдено. Если хоть один даёт `вручную` — разобраться, почему:
это либо новый CDN в цепочке, либо источник не ответил. Если хоть один даёт
`нарушение` — это регресс, останавливаться и чинить.

- [ ] **Step 2: Проверить, что IP и хостер попали в отчёт**

```bash
npm run check-site https://yarkremlin.ru/ 2>&1 | grep -A 2 '^ 1\.'
```

Ожидается: в тексте видны IP `31.31.198.246` и `REGRU-NETWORK`.

- [ ] **Step 3: Проверить заграничный сайт целиком**

```bash
npm run check-site https://example.com/ 2>&1 | grep -E '^ 1\.' -A 2
```

Ожидается: `[НАРУШЕНИЕ]`, в тексте — страна и источники. Если `вручную` —
посмотреть, что вернул `resolveHosting` (шаг 5 задачи 3).

- [ ] **Step 4: Линт и типы**

```bash
npm run lint && npx tsc --noEmit
```

Ожидается: чисто.

- [ ] **Step 5: Коммит, если что-то поправилось**

```bash
git add -A 1-2-MVP/product-mvp
git commit -m "Проверка №1 на контрольной выборке: 5/5 дают ок вместо вручную"
```

---

## Самопроверка плана

**Покрытие спеки:**

| Раздел спеки | Задача |
|---|---|
| §4.1 границы проверки, удаление мёртвого фактора | Task 5, шаги 3–4 |
| §4.2 RDAP через rdap.org, порядок решений, CDN | Task 3 |
| §4.2 отвергнутые источники | зафиксировано в спеке, кода не требует |
| §4.3 устройство кода, `geo.ts` как единственное место про сеть | Task 3, Task 4 |
| §5 формулировки, IP/netname/страна в отчёте | Task 5, шаги 4–5; тест на отсутствие упоминаний базы |
| §6 граничные случаи (8 строк) | Task 3 (тесты DNS, RDAP, ipwho.is), Task 5 (тесты вердиктов) |
| §7 починка check-site | Task 1 |
| §9 критерии готовности | Task 6 |
| §10 список CDN | Task 3, `CDN_NETNAMES` с комментарием о пополнении по факту |

Не покрыто намеренно: §8 «вне скоупа» — англицизмы, проверка №4, глубина
обхода, скриншоты. Отдельные задачи.

**Плейсхолдеры:** не найдено. Код приведён во всех шагах, где меняется код;
команды — с ожидаемым выводом.

**Согласованность типов:** `HostingFact` (Task 2) → `resolveHosting` (Task 3) →
`SiteSnapshot.hosting` (Task 4) → `hostingFactor` (Task 5). Поля `ips`,
`country`, `netname`, `geoCountry`, `isCdn`, `confirmedBy`, `error` названы
одинаково во всех задачах и тестах. `GeoDeps` объявлен в Task 3 и используется
только там.

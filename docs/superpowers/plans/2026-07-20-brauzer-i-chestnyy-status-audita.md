# Браузерная загрузка страниц и честный статус защиты — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Аудит получает страницы через реальный браузер (Playwright/Chromium), проходит антибот-защиту как обычный пользователь, а если не прошёл — честно помечает сайт «закрыт защитой» вместо выдачи ложных нарушений.

**Architecture:** Новый модуль `browser.ts` открывает одну сессию Chromium, проходит челлендж на главной один раз (кука сохраняется в контексте) и переиспользует контекст для остальных страниц. Чистая функция `isAntibotChallenge` определяет заглушку по маркерам и покрывается юнит-тестами. `crawlSite` переключается с `fetch` на браузерную сессию; страницы-заглушки в снапшот не попадают, а если заглушкой оказалась главная — снапшот помечается `blockedByAntibot`, и `auditSite` не запускает проверки.

**Tech Stack:** TypeScript, Next.js 16, Playwright (Chromium), cheerio (парсинг уже загруженного HTML), `node --test` для юнит-тестов.

## Global Constraints

- Проект: `1-2-MVP/product-mvp`. Все пути ниже — относительно этой папки.
- Next.js в проекте с breaking changes: перед правкой Next-специфичного кода читать `node_modules/next/dist/docs/` (см. `AGENTS.md`). В этом плане Next-специфики почти нет — трогаем `src/lib/*` и один route.
- Юнит-тесты запускаются: `npm test` (`node --import tsx --test src/lib/*.test.ts`).
- Ветка работы: `feature/browser-audit` (уже создана, там лежит спека).
- Мы используем НЕзамаскированный браузер: не добавлять stealth-плагины, ротацию прокси, подмену `navigator.webdriver`, решалки капчи. Честный headed-браузер — и всё. Если сайт не пропустил — это валидный исход `blocked`, а не повод усиливать обход. (Спека, раздел «Позиция по обходу защиты».)
- Playwright уже в `devDependencies`, Chromium 1228 установлен. В этом плане переносим `playwright` в `dependencies` (Task 6).
- Не изобретать `htmlToText` заново — она экспортируется из `crawl.ts`, переиспользовать.

---

## Файловая структура

| Файл | Ответственность | Действие |
|---|---|---|
| `src/lib/antibot.ts` | Чистая функция «это заглушка антибота?» по маркерам | Создать |
| `src/lib/antibot.test.ts` | Юнит-тесты детектора на маркерах KillBot и на чистом HTML | Создать |
| `src/lib/browser.ts` | Сессия Chromium: открыть, загрузить страницу (пройдя челлендж), закрыть | Создать |
| `src/lib/types.ts` | Поле `blockedByAntibot` в `SiteSnapshot` | Изменить |
| `src/lib/crawl.ts` | Источник HTML: браузер вместо `fetch`; заглушки не попадают в `pages` | Изменить |
| `src/lib/checks.test.ts` | Хелпер `snapshot()` — добавить новое поле | Изменить |
| `src/lib/audit.ts` | Ветка `blockedByAntibot` → без проверок и письма | Изменить |
| `src/app/api/audits/route.ts` | Отдавать признак `blockedByAntibot` наружу; поправить устаревший комментарий | Изменить |
| `package.json` | `playwright` из dev в обычные зависимости | Изменить |
| `verify-browser.mts` | Ручной интеграционный прогон против живых сайтов | Создать (временный) |

`crawl.ts` (браузерная сессия, сеть) и `antibot.ts` (чистая логика) разделены намеренно: детектор тестируется юнитами без сети, сетевая часть проверяется интеграционным скриптом — так же, как в репозитории уже устроено (`crawl.ts` без юнит-тестов, есть `check-site.mts`).

---

## Task 1: Детектор заглушки антибота (чистая функция)

**Files:**
- Create: `src/lib/antibot.ts`
- Test: `src/lib/antibot.test.ts`

**Interfaces:**
- Produces: `export function isAntibotChallenge(input: { html: string; title?: string }): boolean`

Детектор — чистая функция над строками, без сети. Возвращает `true`, если страница похожа на промежуточную заглушку антибота (челлендж), а не на реальный сайт. Проверяет набор групп маркеров; расширяется добавлением группы.

- [ ] **Step 1: Написать падающий тест**

Маркеры KillBot взяты с живого прогона rustehnika.ru (2026-07-20): заголовок «Проверка пользователя…» / «user verification», в HTML — `window.kbErrors`, `kbReloaded`, `window.kbleEm`.

Создать `src/lib/antibot.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAntibotChallenge } from './antibot';

// Заглушка KillBot: заголовок-верификация + служебные скрипты kb*.
const KILLBOT_STUB = `<html><head>
  <title id="pageTitle">KillBot user verification [1.2.3.4]</title>
  <script>if (typeof window.kbErrors === 'undefined'){window.kbErrors=[];}
  window.kbleEm=true; document.cookie="kbReloaded=1"; location.reload();</script>
</head><body>Проверка пользователя...</body></html>`;

// Промежуточный экран той же заглушки: заголовок по-русски.
const KILLBOT_WAIT = `<html><head><title>Проверка пользователя...</title></head><body></body></html>`;

// Настоящий сайт: обычный заголовок, никаких kb*.
const REAL_SITE = `<html><head>
  <title>Качественное оборудование для автосервиса | Рустехника</title>
</head><body><nav>Каталог</nav><footer>Контакты</footer></body></html>`;

test('заглушку KillBot по скриптам kb* распознаём (A)', () => {
  assert.equal(isAntibotChallenge({ html: KILLBOT_STUB }), true);
});

test('промежуточный экран «Проверка пользователя» по заголовку распознаём (A)', () => {
  assert.equal(isAntibotChallenge({ html: KILLBOT_WAIT, title: 'Проверка пользователя...' }), true);
});

test('настоящий сайт заглушкой НЕ считаем (A, регресс против ложных срабатываний)', () => {
  assert.equal(isAntibotChallenge({ html: REAL_SITE, title: 'Рустехника' }), false);
});

test('пустой ввод — не заглушка (A, граница)', () => {
  assert.equal(isAntibotChallenge({ html: '' }), false);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module './antibot'` (или `isAntibotChallenge is not a function`).

- [ ] **Step 3: Реализовать минимально**

Создать `src/lib/antibot.ts`:

```ts
/**
 * Признак того, что перед нами промежуточная заглушка антибот-защиты
 * (челлендж), а не реальная страница сайта. Нужен, чтобы не принять экран
 * «Проверка пользователя…» за сайт: иначе аудит найдёт в коде защиты чужие
 * счётчики и припишет их клиенту (проверено на rustehnika.ru: googletagmanager
 * с id=kbsmKi принадлежал KillBot, а не сайту).
 *
 * Чистая функция над строками — без сети, тестируется юнитами. Набор групп
 * маркеров расширяется: сейчас проверен только KillBot на живом сайте,
 * маркеры Cloudflare/DDoS-Guard добавлены по публичным признакам и на живом
 * сайте НЕ проверены.
 */
export function isAntibotChallenge(input: { html: string; title?: string }): boolean {
  const html = input.html ?? '';
  const title = (input.title ?? '').toLowerCase();

  // KillBot — проверено на живом сайте (rustehnika.ru, 2026-07-20).
  if (/window\.kbErrors|kbReloaded|window\.kbleEm|killbot/i.test(html)) return true;
  if (/user verification|проверка пользовател/i.test(title)) return true;
  if (/<title[^>]*>[^<]*(user verification|проверка пользовател)/i.test(html)) return true;

  // Cloudflare / DDoS-Guard — по публичным признакам, НЕ проверено на живом сайте.
  if (/\/cdn-cgi\/challenge-platform\//i.test(html)) return true;
  if (/just a moment\.\.\.|checking your browser before accessing|ddos-guard/i.test(title)) return true;

  return false;
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — все 4 теста `antibot.test.ts` зелёные, остальные тесты не сломаны.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/antibot.ts src/lib/antibot.test.ts
git commit -m "Детектор заглушки антибота: чистая функция isAntibotChallenge"
```

---

## Task 2: Браузерная сессия (Playwright)

**Files:**
- Create: `src/lib/browser.ts`
- Create: `verify-browser.mts` (временный интеграционный скрипт)

**Interfaces:**
- Consumes: `isAntibotChallenge` из `./antibot`; `htmlToText` из `./crawl`.
- Produces:
  - `export type LoadResult = { url: string; status: number; html: string; text: string; blocked: boolean } | null`
  - `export class BrowserSession { static open(): Promise<BrowserSession>; load(url: string): Promise<LoadResult>; close(): Promise<void> }`

Одна сессия = один контекст Chromium. Челлендж проходится один раз на первой странице (кука живёт в контексте), остальные страницы загружаются быстро в том же контексте. `load` возвращает `blocked: true`, если после ожидания страница всё ещё заглушка; `null` — если навигация не удалась.

Юнит-тестами это не покрываем (нужны браузер, xvfb, сеть) — проверяем интеграционным скриптом, по образцу `check-site.mts`, который уже есть в репозитории.

- [ ] **Step 1: Реализовать модуль**

Создать `src/lib/browser.ts`:

```ts
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { htmlToText } from './crawl';
import { isAntibotChallenge } from './antibot';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const NAV_TIMEOUT_MS = 30_000;
// Антибот держит экран «Проверка пользователя…» несколько секунд, затем сам
// перезагружается на реальный сайт. На rustehnika.ru переход занял ~19с.
const CHALLENGE_WAIT_MS = 30_000;
const POLL_STEP_MS = 1_000;

export type LoadResult = {
  url: string;
  status: number;
  html: string;
  text: string;
  /** Страница осталась заглушкой антибота — не настоящий контент сайта. */
  blocked: boolean;
} | null;

export class BrowserSession {
  private constructor(
    private browser: Browser,
    private context: BrowserContext,
  ) {}

  static async open(): Promise<BrowserSession> {
    // headed (headless:false): headless Chromium KillBot не пропускает —
    // проверено, застревает на «Проверка пользователя…» >26с. На сервере без
    // экрана процесс запускается под xvfb (см. Task 6).
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ userAgent: UA, locale: 'ru-RU' });
    return new BrowserSession(browser, context);
  }

  async load(url: string): Promise<LoadResult> {
    const page = await this.context.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const status = resp?.status() ?? 0;

      // Ждём, пока антибот сам уйдёт на реальный сайт.
      const deadline = Date.now() + CHALLENGE_WAIT_MS;
      let blocked = true;
      while (Date.now() < deadline) {
        const title = await page.title().catch(() => '');
        const html = await page.content().catch(() => '');
        if (!isAntibotChallenge({ html, title })) {
          blocked = false;
          break;
        }
        await page.waitForTimeout(POLL_STEP_MS);
      }

      const html = await page.content().catch(() => '');
      return {
        url: page.url() || url,
        status,
        html,
        text: htmlToText(html),
        blocked,
      };
    } catch {
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}
```

Примечание: `Date.now()` здесь — обычный рантайм-код Node, не workflow-скрипт; ограничение из Workflow-тула к нему не относится.

- [ ] **Step 2: Написать интеграционный скрипт проверки**

Создать `verify-browser.mts` в корне проекта:

```ts
// Временный интеграционный прогон. Удаляется после проверки (Task 6).
import { BrowserSession } from './src/lib/browser';

const url = process.argv[2] ?? 'https://www.rustehnika.ru/';
const session = await BrowserSession.open();
const t0 = Date.now();
const res = await session.load(url);
await session.close();

console.log('url    :', url);
console.log('time   :', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('status :', res?.status);
console.log('blocked:', res?.blocked);
console.log('title? :', /<title[^>]*>([^<]*)/i.exec(res?.html ?? '')?.[1]?.slice(0, 80));
console.log('gtm    :', (res?.html.match(/googletagmanager\.com/g) || []).length);
console.log('killbot:', (res?.html.match(/window\.kb|kbsmKi/g) || []).length);
```

- [ ] **Step 3: Прогнать против защищённого сайта**

Run: `npx tsx verify-browser.mts https://www.rustehnika.ru/`
Expected (при живом сайте): `blocked: false`, в заголовке — «Рустехника», `killbot: 0`, `gtm: 0`. Прошли заглушку на реальный сайт за ~15–25с.

Если сайт отдал `blocked: true` — это тоже валидный, корректно распознанный исход (антибот усилили). Главное, чтобы НЕ было `blocked: false` с заголовком «Проверка пользователя…» — это означало бы дырявый детектор.

- [ ] **Step 4: Прогнать против обычного сайта**

Взять любой заведомо открытый сайт без антибота (например, `https://example.com/`).

Run: `npx tsx verify-browser.mts https://example.com/`
Expected: `blocked: false`, статус 200, разумный заголовок. Обычные сайты не ломаются.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/browser.ts verify-browser.mts
git commit -m "Браузерная сессия Chromium: проход антибота и загрузка страниц"
```

---

## Task 3: Поле blockedByAntibot в SiteSnapshot

**Files:**
- Modify: `src/lib/types.ts:125-148`
- Modify: `src/lib/checks.test.ts:8-19`

**Interfaces:**
- Produces: `SiteSnapshot.blockedByAntibot: boolean`

Отдельный шаг, потому что добавление поля в тип ломает компиляцию во всех местах, где `SiteSnapshot` конструируется (два в `crawl.ts`, один в `checks.test.ts`). Здесь чиним тип и тест-хелпер; конструкторы в `crawl.ts` починит Task 4.

- [ ] **Step 1: Добавить поле в тип**

В `src/lib/types.ts`, в `SiteSnapshot` (после `footerVisible`, строка ~141) добавить:

```ts
  /**
   * Сайт закрыт антибот-защитой (Cloudflare, DDoS-Guard, KillBot): даже
   * реальный браузер не прошёл челлендж, вместо сайта отдаётся заглушка.
   * Тогда автопроверка невозможна — проверки не запускаются, письмо не
   * генерируется (см. auditSite). Иначе в коде заглушки нашлись бы чужие
   * счётчики и ушли бы клиенту как его нарушение.
   */
  blockedByAntibot: boolean;
```

- [ ] **Step 2: Починить тест-хелпер**

В `src/lib/checks.test.ts`, в объекте `snapshot()` (строки ~9–18) добавить поле рядом с `footerVisible: true,`:

```ts
    footerVisible: true,
    blockedByAntibot: false,
```

- [ ] **Step 3: Проверить компиляцию и падение в нужных местах**

Run: `npx tsc --noEmit`
Expected: ошибки ТОЛЬКО в `src/lib/crawl.ts` (два `return` без `blockedByAntibot`). `checks.test.ts` и остальное компилируются. Это подтверждает, что все конструкторы `SiteSnapshot` найдены — их ровно три.

- [ ] **Step 4: Прогнать юнит-тесты**

Run: `npm test`
Expected: `checks.test.ts` и `antibot.test.ts` проходят (тесты не зависят от `crawl.ts`, tsx компилирует пофайлово). Если `npm test` спотыкается на типах `crawl.ts` — это ожидаемо и чинится в Task 4; в этом случае убедиться, что сами тест-файлы логически не сломаны, и перейти к Task 4.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/types.ts src/lib/checks.test.ts
git commit -m "SiteSnapshot.blockedByAntibot: флаг закрытого защитой сайта"
```

---

## Task 4: Переключить crawlSite на браузер

**Files:**
- Modify: `src/lib/crawl.ts` (импорты; `fetchPage` → сессия; `crawlSite` целиком: строки 86-104 и 247-317)

**Interfaces:**
- Consumes: `BrowserSession`, `LoadResult` из `./browser`; поле `SiteSnapshot.blockedByAntibot` из Task 3.
- Produces: `crawlSite` возвращает снапшот, где заглушки не попали в `pages`, а заглушка-главная даёт `blockedByAntibot: true`.

Логику отбора страниц (`collectLinks`, `PROBE_PATHS`, канарейка, `looksLikeNotFound`, `signature`) НЕ трогаем — меняем только источник HTML и обработку заглушек. `MAX_PAGES` остаётся 18 (полный обход — отдельный шаг вне этого плана).

- [ ] **Step 1: Заменить импорты и удалить старый fetchPage**

В начало `src/lib/crawl.ts` добавить импорт:

```ts
import { BrowserSession, type LoadResult } from './browser';
```

Удалить функцию `fetchPage` целиком (строки 86-104) и константу `UA` (строки 4-5, она теперь живёт в `browser.ts`). `TIMEOUT_MS` тоже больше не используется здесь — удалить строку 7. Оставить `MAX_PAGES`.

- [ ] **Step 2: Переписать crawlSite под сессию**

Заменить тело `crawlSite` (строки 247-317) на версию с сессией. Ключевые отличия: `session.load` вместо `fetchPage`; заглушки (`page.blocked`) в `pages` не добавляем; заглушка-главная → ранний возврат с `blockedByAntibot: true`; сессия закрывается в `finally`.

```ts
export async function crawlSite(inputUrl: string): Promise<SiteSnapshot> {
  const start = normalizeUrl(inputUrl);
  const session = await BrowserSession.open();
  try {
    let home = await session.load(start);
    // https не ответил — пробуем http, но фиксируем это честно
    if (!home && start.startsWith('https://')) {
      home = await session.load(start.replace(/^https:/, 'http:'));
    }

    if (!home) {
      return {
        inputUrl: start,
        finalUrl: start,
        reachable: false,
        error: 'Сайт не открывается: нет ответа или отдаётся не HTML.',
        cms: null,
        clientRendered: false,
        footerVisible: false,
        blockedByAntibot: false,
        hosting: null,
        pages: [],
      };
    }

    // Даже реальный браузер не прошёл защиту — автопроверка невозможна.
    // Не запускаем проверки: в коде заглушки чужие счётчики, они не про клиента.
    if (home.blocked) {
      return {
        inputUrl: start,
        finalUrl: home.url,
        reachable: true,
        error: 'Сайт закрыт антибот-защитой: автоматическая проверка невозможна, нужна ручная проверка в браузере.',
        cms: null,
        clientRendered: false,
        footerVisible: false,
        blockedByAntibot: true,
        hosting: null,
        pages: [],
      };
    }

    const pages: CrawledPage[] = [{ url: home.url, status: home.status, html: home.html, text: home.text }];
    const visited = new Set([home.url]);

    for (const link of collectLinks(home.html, home.url)) {
      if (pages.length >= MAX_PAGES) break;
      if (visited.has(link)) continue;
      visited.add(link);
      const page = await session.load(link);
      // Заглушку антибота в снапшот не берём — она не про клиента.
      if (page && !page.blocked) {
        pages.push({ url: page.url, status: page.status, html: page.html, text: page.text });
      }
    }

    // Контрольный запрос по заведомо несуществующему адресу — фингерпринт soft-404.
    const canary = await session.load(new URL(`/nnq-${'probe'}-404-check/`, home.url).toString());
    const canarySignature =
      canary && !canary.blocked && canary.status === 200
        ? signature({ url: canary.url, status: canary.status, html: canary.html, text: canary.text })
        : null;

    // Документы, опубликованные, но не прилинкованные с главной.
    for (const path of PROBE_PATHS) {
      if (pages.length >= MAX_PAGES) break;
      let probe: string;
      try {
        probe = new URL(path, home.url).toString();
      } catch {
        continue;
      }
      if (visited.has(probe)) continue;
      visited.add(probe);
      const page = await session.load(probe);
      if (!page || page.blocked || page.status !== 200) continue;
      const cp: CrawledPage = { url: page.url, status: page.status, html: page.html, text: page.text };
      if (looksLikeNotFound(cp)) continue;
      if (canarySignature && signature(cp) === canarySignature) continue;
      if (cp.text.length < 200) continue;
      pages.push(cp);
    }

    return {
      inputUrl: start,
      finalUrl: home.url,
      reachable: true,
      cms: detectCms(home.html),
      clientRendered: detectClientRendered(home.html),
      footerVisible: detectFooter(home.html, home.url),
      blockedByAntibot: false,
      hosting: null,
      pages,
    };
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 3: Проверить компиляцию**

Run: `npx tsc --noEmit`
Expected: без ошибок. (`LoadResult` импортирован для читаемости типов; если линтер ругается на неиспользуемый импорт — убрать `type LoadResult` из импорта, оставив `BrowserSession`.)

- [ ] **Step 4: Прогнать юнит-тесты**

Run: `npm test`
Expected: PASS — все тесты (`antibot`, `checks`, `geo`) зелёные.

- [ ] **Step 5: Интеграционный прогон полного аудита**

Run: `npx tsx check-site.mts https://www.rustehnika.ru/`
Expected — ОДИН из двух честных исходов, но НЕ прежнее ложное «НАРУШЕНИЕ по Google Analytics»:
- либо `доступен: true`, страниц ≥ 2, реальные проверки (браузер прошёл);
- либо `доступен: true`, но снапшот помечен как закрытый защитой, страниц 0, нарушений 0 (браузер не прошёл — Task 5 покажет это как честный статус).

- [ ] **Step 6: Коммит**

```bash
git add src/lib/crawl.ts
git commit -m "crawlSite грузит страницы браузером; заглушки антибота не идут в снапшот"
```

---

## Task 5: Честный статус в audit.ts и наружу через route

**Files:**
- Modify: `src/lib/audit.ts:8-24`
- Modify: `src/app/api/audits/route.ts:6, 36`

**Interfaces:**
- Consumes: `SiteSnapshot.blockedByAntibot` (Task 3), заполняемый `crawlSite` (Task 4).

Проверки не запускаем на закрытом защитой сайте — по образцу существующей ветки `!reachable`. Наружу отдаём признак, чтобы UI показал честный статус, а не пустой отчёт.

- [ ] **Step 1: Добавить ветку в auditSite**

В `src/lib/audit.ts` после блока `if (!crawled.reachable)` (строка 13) добавить:

```ts
  // Сайт закрыт антибот-защитой — содержимое недостоверно. Проверки не
  // запускаем и письмо не генерируем: иначе выдали бы нарушения по коду
  // заглушки, которого у клиента нет. То же поведение, что и для недоступного.
  if (crawled.blockedByAntibot) {
    return { snapshot: crawled, findings: [], anglicisms: [] };
  }
```

- [ ] **Step 2: Отдать признак наружу из route**

В `src/app/api/audits/route.ts`, в успешном ответе POST (строка ~36) добавить поле `blockedByAntibot`:

```ts
    const id = await saveAudit(result);
    return NextResponse.json({
      id,
      reachable: result.snapshot.reachable,
      blockedByAntibot: result.snapshot.blockedByAntibot,
      error: result.snapshot.error ?? null,
    });
```

- [ ] **Step 3: Поправить устаревший комментарий**

В `src/app/api/audits/route.ts` строка 6 сейчас: `// Аудит скачивает до 12 страниц чужого сайта — это долго и всегда «живое».` Число неверное (в коде `MAX_PAGES = 18`) и способ изменился. Заменить на:

```ts
// Аудит открывает до 18 страниц чужого сайта настоящим браузером (Playwright):
// это долго и всегда «живое». Часть сайтов под защитой — тогда снапшот
// помечается blockedByAntibot и проверки не запускаются.
```

- [ ] **Step 4: Проверить компиляцию и тесты**

Run: `npx tsc --noEmit && npm test`
Expected: без ошибок типов, все юнит-тесты проходят.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/audit.ts src/app/api/audits/route.ts
git commit -m "Закрытый защитой сайт: честный статус, без проверок и письма"
```

---

## Task 6: Playwright в прод-зависимости, чистка, чек-лист VPS

**Files:**
- Modify: `package.json`
- Delete: `verify-browser.mts`

**Interfaces:** нет (инфраструктурный шаг).

- [ ] **Step 1: Перенести playwright в dependencies**

Run: `npm install playwright --save --save-exact`
Затем убедиться, что `playwright` пропал из `devDependencies` в `package.json` и остался только в `dependencies` (если задвоился — удалить строку из `devDependencies` вручную).

- [ ] **Step 2: Удалить временный скрипт проверки**

```bash
git rm verify-browser.mts
```

- [ ] **Step 3: Финальные тесты и сборка**

Run: `npm test && npm run build`
Expected: тесты зелёные; сборка проходит. Если сборка падает из-за импорта `playwright` в серверном коде — убедиться, что модуль `browser.ts` не тянется в клиентские компоненты (он только в `src/lib/*`, серверная сторона).

- [ ] **Step 4: Коммит**

```bash
git add package.json package-lock.json
git commit -m "Playwright в прод-зависимости; убран временный verify-browser"
```

- [ ] **Step 5: Записать чек-лист выката на VPS (не код — заметка в PR/спеке)**

Перед деплоем на боевой VPS выполнить и подтвердить (блокирующее, спека, раздел «Инфраструктура и риски»):
1. Установить системные библиотеки Chromium и xvfb: `npx playwright install --with-deps chromium` (Linux) + `xvfb`.
2. Запускать Next.js-процесс под виртуальным дисплеем: `xvfb-run -a npm start` (или systemd-юнит с `xvfb-run`).
3. Снять RAM/CPU сервера и убедиться, что Chromium (200–500 МБ на вкладку) живёт рядом с Next.js и PostgreSQL. Если не тянет — вернуться к развилке «отдельный сервис для браузера» (обсуждалось при брейншторме).

---

## Self-Review

**Покрытие спеки:**
- «Получение страниц через реальный браузер» → Task 2 (сессия) + Task 4 (интеграция в crawl). ✓
- «Честный статус blockedByAntibot, письмо не генерируется» → Task 3 (поле) + Task 4 (заполнение) + Task 5 (ветка auditSite + вывод наружу). ✓
- «Фильтр от чужих скриптов антибота» → реализован чище, чем в спеке: заглушки не попадают в `pages` вообще (Task 4, `if (page && !page.blocked)` и ранний возврат для главной), поэтому `checks.ts` править не нужно — проверки физически не видят код антибота. Достигает цели спеки («не засчитывать трекеры из кода антибота») с меньшим риском, чем маркер-фильтр внутри check1. ✓
- «НЕ в этой спеке: полный обход, фон, таблица pages» → не входит; `MAX_PAGES` не тронут, архитектура запроса синхронная. ✓
- «Позиция по обходу защиты — без маскировки» → Global Constraints + комментарии в `browser.ts`. ✓
- Открытый вопрос «честный User-Agent» → намеренно НЕ трогаем (спека: решается отдельно); UA перенесён в `browser.ts` как есть. ✓
- Критерий «заглушка KillBot не даёт срабатывания трекера» → Task 1 юнит-тест + Task 4 (заглушка не в `pages`). ✓
- Критерий «сайты без защиты аудируются как раньше» → Task 2 Step 4 + Task 4 Step 4/5 (юнит-тесты checks регрессят на чистых снапшотах). ✓
- Критерий «ресурсы VPS проверены до выката» → Task 6 Step 5. ✓

**Плейсхолдеры:** не найдено — весь код и все команды приведены дословно.

**Согласованность типов:** `isAntibotChallenge({ html, title })` — одна сигнатура в Task 1, так же вызывается в `browser.ts` (Task 2). `LoadResult`/`BrowserSession.load/open/close` — определены в Task 2, потребляются в Task 4 с теми же именами. `blockedByAntibot` — одно имя в типе (Task 3), в конструкторах (Task 4), в ветках (Task 5), в тесте (Task 3). `CrawledPage` собирается из полей `LoadResult` явно (`{ url, status, html, text }`) — поле `blocked` в снапшот не протекает.

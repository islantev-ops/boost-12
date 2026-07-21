# Фоновый аудит и обход всего сайта — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Аудит обходит сайт целиком (а не 18 страниц по спискам ключевых слов), работает фоновой задачей с прогрессом и честно сообщает, какую часть сайта он видел.

**Architecture:** `crawlSite` превращается в обход в ширину с приоритетной очередью, шаблонной выборкой и бюджетами; факты охвата едут в снапшоте и через единственный шлюз `canProveAbsence` запрещают вывод «документа нет» при неполном обходе. HTTP-роут перестаёт ждать результат: он ставит задачу в очередь на один аудит и сразу отдаёт `id`, UI опрашивает статус.

**Tech Stack:** TypeScript, Next.js 16, PostgreSQL (`pg`), Playwright (Chromium), cheerio, `node --test` через tsx.

## Global Constraints

- Проект: `1-2-MVP/product-mvp`. Все пути ниже — относительно этой папки, кроме `1-2-MVP/results/landing.html`.
- Тесты: `npm test` (= `node --import tsx --test src/lib/*.test.ts`). Типы: `npx tsc --noEmit`. Сборка: `npm run build`.
- Next.js в проекте с breaking changes — перед правкой Next-специфики читать `node_modules/next/dist/docs/` (см. `AGENTS.md`).
- Границы обхода из спеки, ровно эти значения: потолок **300** страниц, пауза **500 мс** между запросами, лимит времени на обход **20 минут**, не более **5** страниц на один отпечаток шаблона.
- Очередь: **строго один аудит одновременно** (сервер 2 ГБ RAM, Chromium 200–500 МБ на вкладку).
- Автоочистка хранит страницы для **последних 20 аудитов**. Записи `audits`, `findings`, `letters`, `anglicisms` **не удаляются и не переписываются НИКОГДА** — владелец держит их как историю версий. Перепрогон старого аудита запрещён.
- Браузер честный: не добавлять stealth-плагины, ротацию прокси, подмену `navigator.webdriver`, решатели капчи.
- Вердикт `manual` из-за неполного обхода **обязан называть причину и цифры охвата**.
- Панель «Что изменилось» правится ТОЛЬКО в `1-2-MVP/results/landing.html` (источник правды); `product-mvp/public/landing.html` пересобирается скриптом `sync-landing`.

---

## Файловая структура

| Файл | Ответственность | Действие |
|---|---|---|
| `src/lib/fingerprint.ts` | Отпечаток шаблона страницы — чистая функция | Создать |
| `src/lib/fingerprint.test.ts` | Юнит-тесты отпечатка | Создать |
| `src/lib/types.ts` | `CrawlCoverage` + поле `coverage` в `SiteSnapshot` | Изменить |
| `src/lib/checks.ts` | Шлюз `canProveAbsence` + причина неполного охвата | Изменить |
| `src/lib/checks.test.ts` | Тесты честности охвата | Изменить |
| `src/lib/crawl.ts` | Обход в ширину, приоритет, выборка, бюджеты | Изменить |
| `schema.sql` | Статус и прогресс в `audits`, таблица `pages` | Изменить |
| `src/lib/db.ts` | Создание/прогресс/финал аудита, сохранение страниц, очистка | Изменить |
| `src/lib/queue.ts` | Очередь на один аудит + восстановление после перезапуска | Создать |
| `src/app/api/audits/route.ts` | POST ставит в очередь и сразу отдаёт `id` | Изменить |
| `src/app/api/audits/[id]/status/route.ts` | Статус для опроса | Создать |
| `src/components/AuditProgress.tsx` | Клиентский опрос статуса | Создать |
| `src/app/audit/[id]/page.tsx` | Прогресс во время работы + строка охвата | Изменить |
| `src/app/audit/page.tsx` | Пометка «идёт проверка» в списке | Изменить |
| `1-2-MVP/results/landing.html` | Записи в панель «Что изменилось» | Изменить |

Чистая логика (`fingerprint.ts`) отделена от сетевой (`crawl.ts`) намеренно: отпечаток тестируется юнитами без браузера, обход проверяется интеграционно через `check-site.mts` — так уже устроен репозиторий.

---

## Task 1: Отпечаток шаблона страницы

**Files:**
- Create: `src/lib/fingerprint.ts`
- Test: `src/lib/fingerprint.test.ts`

**Interfaces:**
- Produces: `export function templateFingerprint(html: string): string`

Чистая функция: по HTML возвращает короткую строку-отпечаток каркаса разметки без учёта текста. Две карточки товара с разным содержанием дают одинаковый отпечаток, страница другого устройства — другой.

- [ ] **Step 1: Написать падающий тест**

Создать `src/lib/fingerprint.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateFingerprint } from './fingerprint';

const card = (name: string, price: string) => `<html><body>
  <div class="product card"><h1 class="product__title">${name}</h1>
  <span class="product__price">${price}</span>
  <button class="btn btn--buy">Купить</button></div></body></html>`;

const article = `<html><body>
  <article class="post"><h1 class="post__title">Новость</h1>
  <p class="post__text">Текст новости</p></article></body></html>`;

test('однотипные карточки товара дают один отпечаток (A)', () => {
  assert.equal(templateFingerprint(card('Дрель', '5000')), templateFingerprint(card('Пила', '9900')));
});

test('другая структура — другой отпечаток (A)', () => {
  assert.notEqual(templateFingerprint(card('Дрель', '5000')), templateFingerprint(article));
});

test('скрипты и стили на отпечаток не влияют (A)', () => {
  const withNoise = card('Дрель', '5000').replace('<body>', '<body><script>var x=1</script><style>.a{}</style>');
  assert.equal(templateFingerprint(withNoise), templateFingerprint(card('Дрель', '5000')));
});

test('пустой HTML не роняет функцию (A, граница)', () => {
  assert.equal(typeof templateFingerprint(''), 'string');
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module './fingerprint'`.

- [ ] **Step 3: Реализовать минимально**

Создать `src/lib/fingerprint.ts`:

```ts
import * as cheerio from 'cheerio';

/**
 * Отпечаток каркаса страницы: теги и первый класс каждого элемента, без текста.
 *
 * Нужен, чтобы не качать 3000 одинаковых карточек товара: страницы с одним
 * отпечатком считаются однотипными, и с каждого берётся несколько
 * представителей. Текст намеренно игнорируется — он у карточек разный, а
 * каркас один.
 *
 * Ограничение в 400 элементов держит функцию быстрой на больших страницах и
 * не меняет сути: каркас виден уже по началу разметки.
 */
export function templateFingerprint(html: string): string {
  const $ = cheerio.load(html ?? '');
  $('script, style, noscript, svg').remove();

  const parts: string[] = [];
  $('body *').each((_, el) => {
    if (parts.length >= 400) return false;
    const tag = (el as { tagName?: string }).tagName ?? '';
    const cls = ($(el).attr('class') ?? '').trim().split(/\s+/)[0] ?? '';
    parts.push(cls ? `${tag}.${cls}` : tag);
  });

  return hash(parts.join('>'));
}

/** djb2 — короткий стабильный хеш, криптостойкость здесь не нужна. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — 4 новых теста зелёные, прежние не сломаны.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/fingerprint.ts src/lib/fingerprint.test.ts
git commit -m "Отпечаток шаблона страницы для выборки однотипных страниц"
```

---

## Task 2: Факты охвата в снапшоте и честность выводов

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/checks.ts` (строки 89–103, 113–115, 494–512, 931–933, 972–983)
- Modify: `src/lib/checks.test.ts` (хелпер `snapshot`)
- Modify: `src/lib/crawl.ts` (три конструктора снапшота — временные значения)

**Interfaces:**
- Produces: тип `CrawlCoverage` и поле `SiteSnapshot.coverage: CrawlCoverage`.

Ключевая задача спеки: при неполном обходе вывод «документа нет» запрещён, а
вердикт `manual` обязан назвать причину и цифры. В коде уже есть единственный
шлюз для таких выводов — `canProveAbsence`. Расширяем его, и все проверки
чинятся разом.

В `crawl.ts` пока ставим временные значения (обход ещё старый) — настоящие
цифры появятся в Task 3.

- [ ] **Step 1: Добавить тип охвата**

В `src/lib/types.ts` перед `export type SiteSnapshot` добавить:

```ts
/**
 * Сколько сайта мы реально посмотрели. Нужен, чтобы отчёт не выдавал
 * «документа нет» после обхода трети сайта: вывод об отсутствии допустим
 * только при полном обходе.
 */
export type CrawlCoverage = {
  /** Сколько страниц скачали */
  crawled: number;
  /** Сколько внутренних адресов вообще нашли на сайте */
  discovered: number;
  /** Пропущено как однотипные (лимит на один отпечаток шаблона) */
  skippedByTemplate: number;
  /** Пропущено из-за потолка страниц или лимита времени */
  skippedByLimit: number;
  /** Обход закончился сам, а не упёрся в бюджет */
  complete: boolean;
  /** Почему обход остановился */
  stopReason: 'done' | 'pageLimit' | 'timeLimit';
};
```

И в `SiteSnapshot`, после `blockedByAntibot: boolean;`, добавить:

```ts
  /** Факты охвата: сколько сайта мы посмотрели. См. canProveAbsence в checks.ts */
  coverage: CrawlCoverage;
```

- [ ] **Step 2: Написать падающие тесты честности**

В `src/lib/checks.test.ts` в хелпер `snapshot()` добавить поле рядом с `blockedByAntibot: false,`:

```ts
    coverage: {
      crawled: 5, discovered: 5, skippedByTemplate: 0, skippedByLimit: 0,
      complete: true, stopReason: 'done' as const,
    },
```

И добавить в конец файла тесты:

```ts
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
```

- [ ] **Step 3: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL — первые два новых теста падают (`verdict` = `violation` вместо `manual`, в тексте нет цифр). Третий проходит.

- [ ] **Step 4: Расширить шлюз и добавить причину**

В `src/lib/checks.ts` заменить `canProveAbsence` (строки 89–91) на:

```ts
function canProveAbsence(s: SiteSnapshot): boolean {
  return !s.clientRendered && s.footerVisible && s.coverage.complete;
}

/**
 * Почему нельзя заявить «этого на сайте нет». Возвращает готовую фразу для
 * отчёта: причину и цифры охвата. Требование владельца — вердикт «требует
 * ручной проверки» обязан объяснять себя, а не отписываться.
 */
function absenceUnknownReason(s: SiteSnapshot): string {
  if (s.clientRendered) return SPA_REASON;
  if (!s.footerVisible) return NO_FOOTER_REASON;
  const why =
    s.coverage.stopReason === 'timeLimit'
      ? 'исчерпан лимит времени на обход'
      : 'достигнут потолок обхода';
  return (
    `Обойдено страниц: ${s.coverage.crawled} из ${s.coverage.discovered} найденных на сайте, ${why}. ` +
    'На осмотренных страницах не найдено, но заявлять отсутствие нельзя — часть сайта не просмотрена.'
  );
}
```

- [ ] **Step 5: Подставить причину в пять мест вывода**

В `src/lib/checks.ts` заменить текст детали в местах, где он ветвился по `canProveAbsence`.

`absenceGateFactor` (строки ~97–101) — заменить блок `detail:` на:

```ts
    detail: canProveAbsence(s)
      ? 'HTML и подвал отдаются сервером, сайт обойдён полностью — отсутствие ссылки показательно.'
      : absenceUnknownReason(s),
```

Проверка 2 (строки ~497 и ~511) — обе ветки `: canProveAbsence(s)` заменить на `: canProveAbsence(s)` с новым отрицательным текстом: там, где сейчас стоит `canProveAbsence(s) ? A : B`, заменить `B` на `absenceUnknownReason(s)`.

Проверка 7 (строки ~932–934) — блок заменить на:

```ts
      detail: canProveAbsence(s)
        ? 'Форм сбора персональных данных на осмотренных страницах не найдено, сайт обойдён полностью.'
        : absenceUnknownReason(s),
```

Проверка 8 (строки ~973 и ~982) — так же: отрицательную ветку заменить на `absenceUnknownReason(s)`.

- [ ] **Step 6: Заполнить временные значения в crawl.ts**

В `src/lib/crawl.ts` во ВСЕХ трёх `return` со снапшотом добавить поле (настоящие цифры придут в Task 3):

в ветке «сайт не открылся» и в ветке `home.blocked`:

```ts
      coverage: { crawled: 0, discovered: 0, skippedByTemplate: 0, skippedByLimit: 0, complete: false, stopReason: 'done' },
```

в финальном успешном `return`:

```ts
      coverage: { crawled: pages.length, discovered: pages.length, skippedByTemplate: 0, skippedByLimit: 0, complete: true, stopReason: 'done' },
```

- [ ] **Step 7: Запустить тесты и типы**

Run: `npx tsc --noEmit && npm test`
Expected: типы чистые; все тесты, включая три новых, проходят.

- [ ] **Step 8: Коммит**

```bash
git add src/lib/types.ts src/lib/checks.ts src/lib/checks.test.ts src/lib/crawl.ts
git commit -m "Честность про охват: при неполном обходе «этого нет» уходит в manual с причиной и цифрами"
```

---

## Task 3: Обход всего сайта в ширину

**Files:**
- Modify: `src/lib/crawl.ts` (константы вверху и функция `crawlSite`)

**Interfaces:**
- Consumes: `templateFingerprint` из `./fingerprint` (Task 1); `CrawlCoverage` (Task 2); `BrowserSession` из `./browser`.
- Produces: `crawlSite(inputUrl, onProgress?)` — второй необязательный аргумент `(crawled: number, url: string) => void` для прогресса (используется в Task 6).

Подсказки перестают быть фильтром: `collectLinks` возвращает ВСЕ внутренние
ссылки со скором, обход идёт по приоритету. Это и открывает `/career/`.

- [ ] **Step 1: Заменить константы и `collectLinks`**

В `src/lib/crawl.ts` заменить строку `const MAX_PAGES = 18;` на:

```ts
const MAX_PAGES = 300;
const CRAWL_MS = 20 * 60 * 1000;
const POLITE_DELAY_MS = 500;
const PER_TEMPLATE = 5;

/** Не ставим в очередь то, что не является HTML-страницей. */
const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|png|jpe?g|gif|svg|webp|ico|mp4|mp3|avi|css|js|json|xml|rss)$/i;
```

Добавить импорт после существующих:

```ts
import { templateFingerprint } from './fingerprint';
```

Заменить конец `collectLinks` (строка `if (score > 0) scored.push({ url: abs, score });`) на:

```ts
    // Скор больше НЕ фильтр, а приоритет: страницы документов и форм идут
    // первыми, остальные — следом. Раньше `score > 0` выбрасывал всё
    // остальное, и страница «Карьера» с формой не обходилась никогда.
    if (SKIP_EXT.test(new URL(abs).pathname)) return;
    scored.push({ url: abs, score });
```

- [ ] **Step 2: Переписать обход в `crawlSite`**

Заменить блок от `const pages: CrawledPage[] = [...]` до конца цикла `PROBE_PATHS` (строки ~266–305) на обход в ширину:

```ts
    const homePage: CrawledPage = { url: home.url, status: home.status, html: home.html, text: home.text };
    const pages: CrawledPage[] = [homePage];
    const visited = new Set([home.url]);
    const templates = new Map<string, number>([[templateFingerprint(home.html), 1]]);

    // Очередь с приоритетом: документы и формы первыми, остальное следом.
    const queue: { url: string; score: number }[] = [];
    const discovered = new Set<string>([home.url]);
    const enqueue = (html: string, base: string) => {
      for (const { url, score } of collectLinksScored(html, base)) {
        if (discovered.has(url)) continue;
        discovered.add(url);
        queue.push({ url, score });
      }
    };
    enqueue(home.html, home.url);

    const deadline = Date.now() + CRAWL_MS;
    let skippedByTemplate = 0;
    let stopReason: 'done' | 'pageLimit' | 'timeLimit' = 'done';

    while (queue.length) {
      if (pages.length >= MAX_PAGES) { stopReason = 'pageLimit'; break; }
      if (Date.now() > deadline) { stopReason = 'timeLimit'; break; }

      queue.sort((a, b) => b.score - a.score);
      const next = queue.shift()!;
      if (visited.has(next.url)) continue;
      visited.add(next.url);

      await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      const page = await session.load(next.url);
      if (!page || page.blocked || page.status !== 200) continue;

      // Однотипных страниц (карточки товара) берём ограниченное число.
      const fp = templateFingerprint(page.html);
      const seenOfTemplate = templates.get(fp) ?? 0;
      if (seenOfTemplate >= PER_TEMPLATE) { skippedByTemplate++; continue; }
      templates.set(fp, seenOfTemplate + 1);

      const cp: CrawledPage = { url: page.url, status: page.status, html: page.html, text: page.text };
      pages.push(cp);
      onProgress?.(pages.length, cp.url);
      enqueue(cp.html, cp.url);
    }

    // Документы, опубликованные, но не прилинкованные ниоткуда.
    const canary = await session.load(new URL(`/nnq-${'probe'}-404-check/`, home.url).toString());
    const canarySignature =
      canary && !canary.blocked && canary.status === 200
        ? signature({ url: canary.url, status: canary.status, html: canary.html, text: canary.text })
        : null;

    for (const path of PROBE_PATHS) {
      if (pages.length >= MAX_PAGES) break;
      let probe: string;
      try { probe = new URL(path, home.url).toString(); } catch { continue; }
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
```

- [ ] **Step 3: Отдать факты охвата и принять onProgress**

Заменить сигнатуру функции:

```ts
export async function crawlSite(
  inputUrl: string,
  onProgress?: (crawled: number, url: string) => void,
): Promise<SiteSnapshot> {
```

И финальный успешный `return` — поле `coverage` заменить на настоящие цифры:

```ts
      coverage: {
        crawled: pages.length,
        discovered: discovered.size,
        skippedByTemplate,
        skippedByLimit: stopReason === 'done' ? 0 : queue.length,
        complete: stopReason === 'done',
        stopReason,
      },
```

- [ ] **Step 4: Добавить `collectLinksScored`**

`collectLinks` сейчас возвращает `string[]`. Обходу нужны скоры. Переименовать существующую функцию в `collectLinksScored` и вернуть пары, заменив её последнюю строку:

```ts
function collectLinksScored(html: string, base: string): { url: string; score: number }[] {
```

и

```ts
  return scored.sort((a, b) => b.score - a.score);
}
```

Старое имя `collectLinks` больше нигде не используется — удалить упоминания не требуется, функция одна.

- [ ] **Step 5: Проверить типы и тесты**

Run: `npx tsc --noEmit && npm test`
Expected: типы чистые, все тесты проходят.

- [ ] **Step 6: Интеграционный прогон на живом сайте**

Run: `npx tsx check-site.mts https://gdpgroup.ru/`
Expected: `страниц:` заметно больше 5 (весь сайт — примерно 12–16 страниц), проверка 7 сообщает про найденную форму («во всех найденных формах сбора ПДн (1) есть чекбокс согласия»), а НЕ «форм не найдено». Прогон занимает пару минут — это нормально.

- [ ] **Step 7: Коммит**

```bash
git add src/lib/crawl.ts
git commit -m "Обход всего сайта: приоритетная очередь вместо фильтра по ключевым словам"
```

---

## Task 4: Схема БД — статус аудита и таблица страниц

**Files:**
- Modify: `schema.sql`

**Interfaces:**
- Produces: колонки `audits.status`, `audits.pages_crawled`, `audits.current_url`, `audits.coverage`; таблица `pages`.

- [ ] **Step 1: Добавить колонки статуса в `audits`**

В `schema.sql` в `CREATE TABLE audits`, после `blocked_by_antibot ...`, добавить:

```sql
  -- Аудит идёт фоном: HTTP-запрос не ждёт результата (внешний прокси рвёт
  -- соединение на 30-й секунде), клиент опрашивает статус.
  status          TEXT        NOT NULL DEFAULT 'done'
                  CHECK (status IN ('queued','crawling','checking','done','failed','blocked')),
  pages_crawled   INTEGER     NOT NULL DEFAULT 0,
  current_url     TEXT,
  -- Факты охвата: сколько сайта посмотрели. Нужны отчёту, чтобы не заявлять
  -- «документа нет» после неполного обхода.
  coverage        JSONB,
```

- [ ] **Step 2: Добавить таблицу `pages`**

В `schema.sql` после `CREATE TABLE audits (...);` добавить:

```sql
-- Копии обойдённых страниц. Нужны, чтобы спорный вывод можно было поднять
-- дословно: раньше аудит был невоспроизводим — HTML жил только в памяти.
CREATE TABLE pages (
  id            SERIAL PRIMARY KEY,
  audit_id      INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url           TEXT    NOT NULL,
  status        INTEGER NOT NULL,
  html          TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  template_hash TEXT    NOT NULL
);

CREATE INDEX idx_pages_audit ON pages(audit_id);
```

И в блок `DROP TABLE` вверху файла добавить первой строкой:

```sql
DROP TABLE IF EXISTS pages CASCADE;
```

- [ ] **Step 3: Записать миграцию для боевой БД**

`schema.sql` пересоздаёт таблицы — на боевой БД его накатывать нельзя. Записать в отчёт задачи и в чек-лист выката:

```sql
ALTER TABLE audits ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pages_crawled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS current_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS coverage JSONB;
CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url TEXT NOT NULL, status INTEGER NOT NULL,
  html TEXT NOT NULL, text TEXT NOT NULL, template_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_audit ON pages(audit_id);
```

Существующие 27 аудитов получат `status='done'` — они и правда завершены, переписывать их нельзя (Global Constraints).

- [ ] **Step 4: Коммит**

```bash
git add schema.sql
git commit -m "Схема: статус и прогресс аудита, таблица копий страниц"
```

---

## Task 5: Функции БД для фонового аудита

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Consumes: колонки из Task 4; `CrawlCoverage` из Task 2.
- Produces:
  - `createQueuedAudit(inputUrl: string): Promise<number>`
  - `setAuditStatus(id: number, status: string, patch?: { pagesCrawled?: number; currentUrl?: string | null; error?: string | null }): Promise<void>`
  - `finishAudit(id: number, result: AuditResult): Promise<void>`
  - `failStaleAudits(): Promise<number>`
  - `getAuditStatus(id: number): Promise<{ status: string; pages_crawled: number; current_url: string | null } | null>`
  - поля `status`, `pages_crawled`, `current_url`, `coverage` в `AuditRow`

- [ ] **Step 1: Расширить `AuditRow`**

В `src/lib/db.ts` в `type AuditRow` после `blocked_by_antibot: boolean;` добавить:

```ts
  status: string;
  pages_crawled: number;
  current_url: string | null;
  coverage: CrawlCoverage | null;
```

и добавить `CrawlCoverage` в импорт типов из `./types`.

- [ ] **Step 2: Добавить функции жизненного цикла**

В `src/lib/db.ts` перед `saveAudit` добавить:

```ts
/** Заводит запись до начала работы: клиент сразу получает id и следит за прогрессом. */
export async function createQueuedAudit(inputUrl: string): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO audits (input_url, final_url, cms, reachable, client_rendered, status)
     VALUES ($1, $1, NULL, true, false, 'queued') RETURNING id`,
    [inputUrl],
  );
  return rows[0].id;
}

export async function setAuditStatus(
  id: number,
  status: string,
  patch: { pagesCrawled?: number; currentUrl?: string | null; error?: string | null } = {},
): Promise<void> {
  await getPool().query(
    `UPDATE audits SET status = $2,
       pages_crawled = COALESCE($3, pages_crawled),
       current_url   = COALESCE($4, current_url),
       error         = COALESCE($5, error)
     WHERE id = $1`,
    [id, status, patch.pagesCrawled ?? null, patch.currentUrl ?? null, patch.error ?? null],
  );
}

export async function getAuditStatus(id: number) {
  const { rows } = await getPool().query<{ status: string; pages_crawled: number; current_url: string | null }>(
    'SELECT status, pages_crawled, current_url FROM audits WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Перезапуск сервера посреди аудита оставил бы задачу висеть в «crawling»
 * навсегда. Помечаем такие честно — «прервано», а не делаем вид, что работа идёт.
 */
export async function failStaleAudits(): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE audits SET status = 'failed',
       error = COALESCE(error, 'Проверка прервана перезапуском сервера. Запустите её заново.')
     WHERE status IN ('queued','crawling','checking')`,
  );
  return rowCount ?? 0;
}
```

- [ ] **Step 3: Добавить запись результата в существующую запись**

`saveAudit` создаёт НОВУЮ строку — для фонового режима нужна запись в уже
созданную. В `src/lib/db.ts` после `saveAudit` добавить:

```ts
/**
 * Дописывает результат в уже заведённую запись (её id клиент получил сразу).
 * Страницы сохраняем целиком: без них аудит невоспроизводим.
 */
export async function finishAudit(id: number, result: AuditResult): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { snapshot, findings, anglicisms } = result;

    await client.query(
      `UPDATE audits SET final_url = $2, cms = $3, reachable = $4, error = $5,
         client_rendered = $6, blocked_by_antibot = $7, coverage = $8,
         pages_crawled = $9, current_url = NULL,
         status = CASE WHEN $7 THEN 'blocked' ELSE 'done' END
       WHERE id = $1`,
      [
        id, snapshot.finalUrl, snapshot.cms, snapshot.reachable, snapshot.error ?? null,
        snapshot.clientRendered, snapshot.blockedByAntibot,
        JSON.stringify(snapshot.coverage), snapshot.coverage.crawled,
      ],
    );

    for (const p of snapshot.pages) {
      await client.query(
        'INSERT INTO pages (audit_id, url, status, html, text, template_hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, p.url, p.status, p.html, p.text, templateFingerprint(p.html)],
      );
    }

    for (const f of findings) {
      await client.query(
        `INSERT INTO findings
           (audit_id, check_id, title, what, verdict, method, summary, norms, factors, evidence, doc, severity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id, f.checkId, f.title, f.what, f.verdict, f.method, f.summary,
          JSON.stringify(f.norms), JSON.stringify(f.factors), JSON.stringify(f.evidence),
          f.doc ? JSON.stringify(f.doc) : null, f.severity,
        ],
      );
    }

    const { subject, body } = buildLetter(snapshot, findings);
    if (body) {
      await client.query('INSERT INTO letters (audit_id, subject, body) VALUES ($1, $2, $3)', [id, subject, body]);
    }

    for (const a of anglicisms.slice(0, 200)) {
      await client.query(
        'INSERT INTO anglicisms (audit_id, word, suggestion, url, context) VALUES ($1,$2,$3,$4,$5)',
        [id, a.word, a.suggestion, a.url, a.context],
      );
    }

    // Копии страниц тяжёлые и нужны недолго. Удаляем только их и только у
    // старых аудитов — сами аудиты, находки и письма не трогаем НИКОГДА.
    await client.query(
      `DELETE FROM pages WHERE audit_id IN (
         SELECT id FROM audits ORDER BY id DESC OFFSET 20
       )`,
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

Добавить импорт вверху файла:

```ts
import { templateFingerprint } from './fingerprint';
```

- [ ] **Step 4: Проверить типы**

Run: `npx tsc --noEmit && npm test`
Expected: типы чистые, тесты проходят.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/db.ts
git commit -m "БД: жизненный цикл фонового аудита, сохранение страниц, очистка старых копий"
```

---

## Task 6: Очередь на один аудит

**Files:**
- Create: `src/lib/queue.ts`

**Interfaces:**
- Consumes: `crawlSite(url, onProgress)` (Task 3), `createQueuedAudit`/`setAuditStatus`/`finishAudit`/`failStaleAudits` (Task 5), `resolveHosting`, `runChecks`, `findAnglicisms`.
- Produces: `export function enqueueAudit(id: number, url: string): void`

Очередь держит **один аудит одновременно**: на 2 ГБ второй Chromium не влезет.

- [ ] **Step 1: Реализовать очередь**

Создать `src/lib/queue.ts`:

```ts
import { findAnglicisms } from './anglicisms';
import { runChecks } from './checks';
import { crawlSite } from './crawl';
import { failStaleAudits, finishAudit, setAuditStatus } from './db';
import { resolveHosting } from './geo';

/**
 * Очередь аудитов: строго по одному одновременно.
 *
 * Причина жёсткая: на сервере 2 ГБ памяти, а Chromium ест 200–500 МБ на
 * вкладку. Два параллельных аудита кладут сервер вместе с базой.
 */
const waiting: { id: number; url: string }[] = [];
let running = false;

export function enqueueAudit(id: number, url: string): void {
  waiting.push({ id, url });
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  const job = waiting.shift();
  if (!job) return;
  running = true;
  try {
    await runAudit(job.id, job.url);
  } catch (e) {
    await setAuditStatus(job.id, 'failed', {
      error: `Проверка не выполнена: ${e instanceof Error ? e.message : String(e)}`,
    }).catch(() => {});
  } finally {
    running = false;
    void pump();
  }
}

async function runAudit(id: number, url: string): Promise<void> {
  await setAuditStatus(id, 'crawling', { pagesCrawled: 0 });

  const snapshot = await crawlSite(url, (crawled, currentUrl) => {
    void setAuditStatus(id, 'crawling', { pagesCrawled: crawled, currentUrl }).catch(() => {});
  });

  if (!snapshot.reachable || snapshot.blockedByAntibot) {
    await finishAudit(id, { snapshot, findings: [], anglicisms: [] });
    return;
  }

  await setAuditStatus(id, 'checking');
  const withHosting = { ...snapshot, hosting: await resolveHosting(snapshot.finalUrl) };
  await finishAudit(id, {
    snapshot: withHosting,
    findings: runChecks(withHosting),
    anglicisms: findAnglicisms(withHosting),
  });
}

/**
 * Перезапуск pm2 посреди работы оставил бы аудиты висеть в «идёт проверка».
 * Помечаем их прерванными при старте — молчаливо зависших быть не должно.
 */
let recovered = false;
export async function recoverOnce(): Promise<void> {
  if (recovered) return;
  recovered = true;
  await failStaleAudits().catch(() => {});
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add src/lib/queue.ts
git commit -m "Очередь аудитов: по одному одновременно, восстановление после перезапуска"
```

---

## Task 7: API — постановка в очередь и статус

**Files:**
- Modify: `src/app/api/audits/route.ts`
- Create: `src/app/api/audits/[id]/status/route.ts`

**Interfaces:**
- Consumes: `enqueueAudit`, `recoverOnce` (Task 6), `createQueuedAudit`, `getAuditStatus` (Task 5).

- [ ] **Step 1: Переписать POST**

В `src/app/api/audits/route.ts` заменить блок от `const result = await auditSite(...)` до конца `POST` на:

```ts
  try {
    await recoverOnce();
    const id = await createQueuedAudit(url.trim());
    enqueueAudit(id, url.trim());
    // Отвечаем сразу: внешний прокси рвёт соединение на 30-й секунде, а обход
    // сайта идёт минуты. Клиент следит за прогрессом опросом статуса.
    return NextResponse.json({ id, status: 'queued' });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Не удалось поставить проверку в очередь.',
        detail: e instanceof Error ? e.message : String(e),
        dbOffline: true,
      },
      { status: 503 },
    );
  }
```

Заменить импорты в начале файла: убрать `auditSite` и `saveAudit`, добавить:

```ts
import { createQueuedAudit, listAudits } from '@/lib/db';
import { enqueueAudit, recoverOnce } from '@/lib/queue';
```

И обновить комментарий на строке 6:

```ts
// Аудит идёт фоном: POST ставит задачу в очередь и сразу отдаёт id, потому что
// внешний прокси платформы рвёт HTTP-запрос на 30-й секунде, а обход сайта
// занимает минуты. Прогресс клиент забирает опросом /api/audits/[id]/status.
```

- [ ] **Step 2: Создать роут статуса**

Создать `src/app/api/audits/[id]/status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getAuditStatus, parseId } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });
  try {
    const row = await getAuditStatus(id);
    if (!row) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });
    return NextResponse.json({
      status: row.status,
      pagesCrawled: row.pages_crawled,
      currentUrl: row.current_url,
    });
  } catch {
    return NextResponse.json({ error: 'База недоступна.' }, { status: 503 });
  }
}
```

- [ ] **Step 3: Проверить типы и сборку**

Run: `npx tsc --noEmit && npm run build`
Expected: типы чистые, сборка проходит, в списке роутов есть `/api/audits/[id]/status`.

- [ ] **Step 4: Коммит**

```bash
git add src/app/api/audits/route.ts src/app/api/audits/[id]/status/route.ts
git commit -m "API: POST ставит аудит в очередь и сразу отвечает; роут статуса для опроса"
```

---

## Task 8: Прогресс и строка охвата в интерфейсе

**Files:**
- Create: `src/components/AuditProgress.tsx`
- Modify: `src/app/audit/[id]/page.tsx`
- Modify: `src/app/audit/page.tsx`

**Interfaces:**
- Consumes: роут `/api/audits/[id]/status` (Task 7), `AuditRow.status`/`coverage` (Task 5).

- [ ] **Step 1: Компонент опроса статуса**

Создать `src/components/AuditProgress.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Пока аудит идёт, страница показывает прогресс и раз в 2 секунды спрашивает
 * статус. WebSocket платформа запрещает — только опрос или SSE.
 */
export default function AuditProgress({ id }: { id: number }) {
  const router = useRouter();
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/audits/${id}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (stop) return;
        setPages(data.pagesCrawled ?? 0);
        setCurrent(data.currentUrl ?? null);
        if (['done', 'failed', 'blocked'].includes(data.status)) {
          stop = true;
          router.refresh();
        }
      } catch {
        /* сеть моргнула — попробуем на следующем тике */
      }
    };
    void tick();
    const timer = setInterval(() => { if (!stop) void tick(); }, 2000);
    return () => { stop = true; clearInterval(timer); };
  }, [id, router]);

  return (
    <div className="frost mt-5 px-5 py-4">
      <b className="text-lead text-ice">Идёт проверка сайта…</b>
      <p className="mt-1 text-body text-muted">
        Обойдено страниц: <b className="tabular-nums text-ink">{pages}</b>
        {current && <> · сейчас: <span className="text-faint">{current}</span></>}
      </p>
      <p className="mt-2 text-caption text-faint">
        Страницы открываются настоящим браузером — это занимает несколько минут. Страница обновится сама.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Показать прогресс на странице аудита**

В `src/app/audit/[id]/page.tsx` добавить импорт:

```tsx
import AuditProgress from '@/components/AuditProgress';
```

После строки `const noReport = !audit.reachable || audit.blocked_by_antibot;` добавить:

```tsx
  const running = ['queued', 'crawling', 'checking'].includes(audit.status);
```

Заменить условие блока статуса `{noReport ? (` на `{running ? (<AuditProgress id={audit.id} />) : noReport ? (` — то есть добавить ветку прогресса первой. Полный блок:

```tsx
        {running ? (
          <AuditProgress id={audit.id} />
        ) : noReport ? (
          <p className="mt-5 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-body text-gold">
            {audit.error ??
              (audit.blocked_by_antibot
                ? 'Сайт закрыт антибот-защитой: автоматическая проверка невозможна, нужна ручная проверка в браузере.'
                : 'Сайт не открылся.')}
          </p>
        ) : (
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
            <Metric value={violations.length} label="подтверждённых нарушений" tone="danger" />
            <Metric value={manual.length} label="требуют ручной проверки" tone="gold" />
            <Metric value={ok.length} label="соответствуют" tone="safe" />
            <Metric value={anglicisms.length} label="иностранных слов" tone="muted" />
          </div>
        )}
```

Гейт кнопки Word заменить с `{!noReport && (` на `{!noReport && !running && (`, и гейт секций находок с `{!noReport && (` на `{!noReport && !running && (`.

- [ ] **Step 3: Показать строку охвата в готовом отчёте**

В том же файле после блока про CMS (`{audit.cms && audit.cms !== 'bitrix' && (...)}`) добавить:

```tsx
        {!running && !noReport && audit.coverage && (
          <p className="mt-4 text-body text-muted">
            Осмотрено страниц: <b className="text-ink">{audit.coverage.crawled}</b> из{' '}
            {audit.coverage.discovered} найденных на сайте
            {!audit.coverage.complete && (
              <> — обход остановлен: {audit.coverage.stopReason === 'timeLimit' ? 'исчерпан лимит времени' : 'достигнут потолок страниц'}</>
            )}
            {audit.coverage.skippedByTemplate > 0 && (
              <> · пропущено однотипных: {audit.coverage.skippedByTemplate}</>
            )}
          </p>
        )}
```

- [ ] **Step 4: Пометка «идёт проверка» в списке**

В `src/app/audit/page.tsx` в `AuditCard` заменить статус-блок на версию с ветвью работы:

```tsx
      {['queued', 'crawling', 'checking'].includes(audit.status) ? (
        <span className="text-body text-ice">идёт проверка…</span>
      ) : !audit.reachable ? (
        <span className="text-body text-gold">сайт не открылся</span>
      ) : audit.blocked_by_antibot ? (
        <span className="text-body text-gold">закрыт защитой</span>
      ) : (
        <div className="flex items-center gap-4 text-sm">
          <Stat value={audit.violations} label="нарушений" tone="danger" />
          <Stat value={audit.manual} label="вручную" tone="muted" />
        </div>
      )}
```

- [ ] **Step 5: Проверить типы, тесты и сборку**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: типы чистые, тесты проходят, сборка `exit 0`.

- [ ] **Step 6: Коммит**

```bash
git add src/components/AuditProgress.tsx src/app/audit/
git commit -m "Интерфейс: прогресс во время проверки и честная строка охвата в отчёте"
```

---

## Task 9: Панель «Что изменилось» и чек-лист выката

**Files:**
- Modify: `1-2-MVP/results/landing.html`

**Interfaces:** нет.

Требование владельца: каждая доработка вносится в панель. Правится только
источник правды в `results/`.

- [ ] **Step 1: Добавить записи**

В `1-2-MVP/results/landing.html` найти `<div class="dl-h">` и заменить дату в
`<span class="dl-t">` на дату и время этой работы в формате `ДД.ММ, ЧЧ:ММ МСК`.
Сразу после `<ul>` вставить три записи (время — фактическое время внесения):

```html
    <li><time>ДД.ММ ЧЧ:ММ</time><b>Аудит обходит сайт целиком.</b> Раньше открывались 18 страниц, отобранных по списку ключевых слов, — страница «Карьера» с формой сбора данных в этот список не попадала и не проверялась никогда. Теперь обход идёт по всем внутренним ссылкам, а ключевые слова определяют лишь порядок: документы и формы смотрим первыми. Однотипные страницы (карточки товара) берём по несколько штук на шаблон, чтобы каталог не растягивал проверку на часы</li>
    <li><time>ДД.ММ ЧЧ:ММ</time><b>Проверка идёт фоном, с прогрессом.</b> Раньше браузер ждал ответа и на защищённых сайтах получал ошибку 504: внешний прокси рвёт соединение на 30-й секунде, а обход занимает минуты. Теперь проверка ставится в очередь, страница сразу открывается и показывает, сколько страниц уже обойдено</li>
    <li><time>ДД.ММ ЧЧ:ММ</time>⚠️ <b>Отчёт больше не выдаёт неполный обход за полный.</b> Появилась строка «осмотрено страниц N из M». Если обход упёрся в потолок, вывод «документа на сайте нет» не заявляется как нарушение — пункт уходит в «требует ручной проверки» и прямо называет причину и цифры. Раньше отчёт писал «не найдено», умалчивая, что видел треть сайта</li>
```

- [ ] **Step 2: Синхронизировать копию и проверить**

Run: `cd 1-2-MVP/product-mvp && npm run sync-landing`
Expected: сообщение о копировании; затем `grep -c "обходит сайт целиком" public/landing.html` возвращает 1.

- [ ] **Step 3: Записать чек-лист выката в отчёт**

Не код — внести в отчёт задачи:
1. Накатить миграцию из Task 4 Step 3 на боевую БД (`sudo -u postgres psql -d auditdb`).
2. `git pull`, `npm ci`, `npm run build`, `DISPLAY=:99 pm2 restart product-mvp --update-env`.
3. Проверить: аудит gdpgroup.ru открывает `/career/`, проверка 7 сообщает про форму; 504 не воспроизводится.

- [ ] **Step 4: Коммит**

```bash
git add 1-2-MVP/results/landing.html 1-2-MVP/product-mvp/public/landing.html
git commit -m "«Что изменилось»: обход всего сайта, фоновый режим, честная строка охвата"
```

---

## Self-Review

**Покрытие спеки:**
- §1 фоновая задача, очередь по одному, статусы, восстановление после перезапуска → Task 5 (`failStaleAudits`), Task 6 (очередь, `recoverOnce`), Task 7 (POST в очередь). ✓
- §2 обход в ширину, подсказки как приоритет, шаблонная выборка, потолок 300 / пауза 500 мс / лимит 20 мин, пропуск файлов → Task 1 (отпечаток), Task 3 (обход, константы, `SKIP_EXT`). ✓
- §3 факты охвата, запрет «нарушения» при неполном обходе, причина и цифры в `manual` → Task 2 (`CrawlCoverage`, `canProveAbsence`, `absenceUnknownReason`, тесты обоих направлений). ✓
- §4 таблица `pages` с полным HTML, автоочистка 20 последних, неприкосновенность старых аудитов → Task 4 (схема), Task 5 (`finishAudit` пишет страницы, `DELETE FROM pages ... OFFSET 20`, аудиты не трогаются). ✓
- §5 прогресс, «идёт проверка» в списке, опрос 2 с, строка охвата → Task 8. ✓
- §6 панель «Что изменилось», правка только в `results/` → Task 9. ✓
- Границы работы (PDF, честный UA, параллельные аудиты, перепрогон старых) → в план не входят, задач нет. ✓
- Критерии готовности: 504 → Task 7 Step 3 + чек-лист; `/career/` → Task 3 Step 6; вердикт при потолке → Task 2 Step 2; перезапуск pm2 → Task 6; хранение и очистка → Task 5; регресс → `npm test` в каждой задаче. ✓

**Плейсхолдеры:** в Task 9 намеренно оставлены `ДД.ММ ЧЧ:ММ` — это фактическое
время внесения записи, его нельзя знать заранее; в шаге явно сказано подставить
реальное время. Остальной код и команды приведены дословно.

**Согласованность типов:** `CrawlCoverage` объявлен в Task 2 и потребляется в
Task 3 (заполнение), Task 5 (`AuditRow.coverage`, `finishAudit`), Task 8 (UI) —
имена полей `crawled`/`discovered`/`skippedByTemplate`/`skippedByLimit`/
`complete`/`stopReason` совпадают везде. `templateFingerprint(html): string` из
Task 1 вызывается в Task 3 и Task 5. `crawlSite(url, onProgress?)` объявлен в
Task 3 и вызывается в Task 6 с той же сигнатурой. `enqueueAudit(id, url)` и
`recoverOnce()` из Task 6 вызываются в Task 7. Статусы
`queued|crawling|checking|done|failed|blocked` одинаковы в схеме (Task 4),
очереди (Task 6), роуте статуса (Task 7) и UI (Task 8).

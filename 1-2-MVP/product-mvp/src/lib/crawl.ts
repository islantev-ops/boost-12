import * as cheerio from 'cheerio';
import type { CrawledPage, SiteSnapshot } from './types';
import { BrowserSession } from './browser';
import { templateFingerprint } from './fingerprint';

const MAX_PAGES = 300;
const CRAWL_MS = 20 * 60 * 1000;
const POLITE_DELAY_MS = 500;
const PER_TEMPLATE = 5;
// Слоты, зарезервированные под PROBE_PATHS. Без резерва основной обход на
// крупном сайте (каталог сам по себе даёт 300 страниц) выедает MAX_PAGES
// целиком, и подстраховка не срабатывает НИКОГДА — то есть отключается
// именно там, где нужнее всего: на сайтах, где документ не прилинкован, а
// каталог большой. Резерв меньше основного бюджета, но гарантирован всегда.
const RESERVED_FOR_PROBES = 20;

/**
 * Форма адреса страницы: последний сегмент пути заменяется звёздочкой.
 * `/catalog/drel-123/` → `/catalog/*`, `/404` → `/404`, `/news/406/` → `/news/*`.
 *
 * Нужна вместе с отпечатком разметки, потому что отпечаток НЕ различает
 * структурно одинаковые страницы: у «404» и «Спасибо за заказ» одинаковый
 * каркас (заголовок, абзац, кнопка, общая шапка), и по разметке они
 * неотличимы в принципе. Если сгруппировать их вместе, лимит на группу может
 * съесть одну из них, и мы пропустим непроверенную страницу — та самая беда,
 * из-за которой не открывалась `/career/`. Адреса же у них разные, и по
 * адресу они расходятся. Карточки товара при этом остаются одной группой.
 */
export function urlShape(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    return rawUrl;
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return `/${segments[0] ?? ''}`;
  return `/${segments.slice(0, -1).join('/')}/*`;
}

/** Не ставим в очередь то, что не является HTML-страницей. */
const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|png|jpe?g|gif|svg|webp|ico|mp4|mp3|avi|css|js|json|xml|rss)$/i;

/**
 * Типовые адреса документов. Проверяем их напрямую, даже если на них нет
 * ссылок: документ может быть опубликован, но не прилинкован с главной.
 * Без этого вывод «документа нет» держался бы только на ссылках с главной —
 * и легко превращался бы в ложное обвинение.
 */
const PROBE_PATHS = [
  '/politika-konfidencialnosti/',
  '/policy/',
  '/privacy/',
  '/privacy-policy/',
  '/about/privacy.php',
  '/personal-data/',
  '/soglasie/',
  '/soglasie-na-obrabotku-personalnyh-dannyh/',
  '/consent/',
  '/oferta/',
  '/public-offer/',
  '/offer/',
  '/terms/',
  '/user-agreement/',
  '/soglashenie/',
  '/cookie/',
  '/cookie-policy/',
];

/**
 * Ссылки на эти страницы ищем в первую очередь — там живут документы.
 *
 * Без «politika» и голого «политик»: по-русски это слово значит ещё и
 * «politics», и на новостных сайтах уводит в раздел новостей, съедая обход.
 */
const DOC_HINTS = [
  'politika-konfidencial',
  'policy',
  'privacy',
  'konfidencial',
  'personal-data',
  'personaldata',
  'oferta',
  'public-offer',
  'soglashenie',
  'user-agreement',
  'terms',
  'soglasie',
  'consent',
  'cookie',
  'kuki',
];

const DOC_TEXT_HINTS = [
  'конфиденциальн',
  'персональн',
  'оферт',
  'пользовательское соглашение',
  'условия использования',
  'согласие на обработку',
  'куки',
  'cookie',
];

/**
 * Страницы, где обычно стоит форма сбора данных. Без них проверка №7 смотрела
 * бы только на главную и, не найдя там формы, выдавала «форм нет» — то есть
 * справку о чистоте сайту, у которого форма живёт на «Контактах».
 */
const FORM_HINTS = ['kontakt', 'contact', 'zakaz', 'order', 'callback', 'feedback', 'zayav', 'obratn'];

const FORM_TEXT_HINTS = ['контакт', 'заказать', 'оставить заявку', 'обратная связь', 'написать нам', 'заявк'];

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Параметры отслеживания: не меняют содержимое страницы, только дублируют её в очереди. */
const TRACKING_PARAMS = new Set(['yclid', 'gclid', 'from', 'ref']);

/**
 * Приводит адрес к каноническому виду перед постановкой в очередь и перед
 * проверкой `discovered`. Без этого один и тот же документ ставится в очередь
 * снова и снова под разными масками (якорь, utm-метка, слеш на конце) — и
 * бюджет обхода уходит на копии одной страницы вместо новых.
 *
 * Путь НЕ приводим к нижнему регистру: часть серверов (в первую очередь на
 * Linux-хостинге) различает `/Page` и `/page` как разные ресурсы, и склейка
 * дала бы 404 там, где сейчас всё работает.
 */
export function normalizeForQueue(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  u.hash = '';
  u.host = u.host.toLowerCase();

  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const qs = params.toString();
  u.search = qs ? `?${qs}` : '';

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.toString();
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function detectCms(html: string, headers?: Headers): string | null {
  const h = html.toLowerCase();
  if (h.includes('/bitrix/') || h.includes('bx-') || h.includes('bitrix_sessid')) return 'bitrix';
  if (h.includes('/wp-content/') || h.includes('/wp-includes/')) return 'wordpress';
  if (h.includes('/local/templates/')) return 'bitrix';
  if (h.includes('tilda') || h.includes('tildacdn')) return 'tilda';
  if (h.includes('cs-cart')) return 'cs-cart';
  if (h.includes('modx')) return 'modx';
  if (h.includes('joomla')) return 'joomla';
  if (h.includes('opencart')) return 'opencart';
  void headers;
  return null;
}

/**
 * Признак того, что страница рисуется на клиенте. Для таких сайтов вывод
 * «на сайте чего-то нет» недостоверен — это не нарушение, а повод для ручной
 * проверки.
 *
 * Главный признак — отсутствие текста. Крупные магазины отдают роботу пустую
 * оболочку с одним скриптом: по ней нельзя заключить ничего, кроме «мы ничего
 * не увидели». Считать такую страницу серверной — значит объявить нарушением
 * каждый документ, которого мы не разглядели.
 */
function detectClientRendered(html: string): boolean {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
  const linkCount = cheerio.load(html)('a[href]').length;
  const hasSpaRoot = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html);

  // Пустая разметка — ничего не доказывает, сколько бы скриптов там ни было.
  // Порог намеренно низкий: у небольшого магазина на главной может быть и
  // двести слов, и это нормальная серверная страница, а не оболочка. Основную
  // защиту от ложных выводов даёт detectFooter, а не этот признак.
  if (visibleText.length < 200) return true;
  // Текст есть, но ни одной ссылки — навигацию рисует скрипт.
  if (linkCount === 0) return true;
  if (hasSpaRoot && visibleText.length < 1200) return true;
  return false;
}

/** Отпечаток страницы, чтобы отличать настоящий документ от типовой заглушки. */
function signature(page: CrawledPage): string {
  return `${page.html.length}:${page.text.slice(0, 120)}`;
}

/**
 * Виден ли подвал в серверном HTML.
 *
 * Ссылки на документы живут в подвале. Страница может быть серверной по
 * содержанию, но дорисовывать подвал скриптом — так делает половина крупных
 * сайтов. Тогда «ссылки на Политику нет» означает лишь «мы не видели подвала»,
 * и заявлять нарушение нельзя. Признак подвала — тег <footer> со ссылками либо
 * типовые ссылки подвала: контакты, о компании, реклама.
 */
function detectFooter(html: string, base: string): boolean {
  const $ = cheerio.load(html);
  if ($('footer a[href]').length >= 3) return true;

  const FOOTER_LINKS = [
    'контакт',
    'о компании',
    'о нас',
    'реклама',
    'вакансии',
    'обратная связь',
    'правообладател',
  ];

  // Считаем разные адреса, а не повторы одной ссылки: шапка новостного сайта
  // повторяет «Рекламу» трижды, и это не подвал.
  const distinct = new Set<string>();
  $('a[href]').each((_, el) => {
    const text = $(el).text().toLowerCase().replace(/\s+/g, ' ').trim();
    if (!FOOTER_LINKS.some((f) => text.includes(f))) return;
    try {
      distinct.add(new URL($(el).attr('href') ?? '', base).toString());
    } catch {
      /* мусорный href — не считаем */
    }
  });
  return distinct.size >= 2;
}

/**
 * Часть сайтов отдаёт «страница не найдена» с кодом 200. Принять такую
 * страницу за опубликованный документ — значит пропустить нарушение.
 */
function looksLikeNotFound(page: CrawledPage): boolean {
  const head = page.text.slice(0, 500).toLowerCase();
  return (
    /страница не найдена|ничего не найдено|page not found|404/.test(head) && page.text.length < 2000
  );
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/** Собирает внутренние ссылки, приоритезируя страницы с документами. */
function collectLinksScored(html: string, base: string): { url: string; score: number }[] {
  const $ = cheerio.load(html);
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, base).toString().split('#')[0];
    } catch {
      return;
    }
    if (!sameHost(abs, base) || seen.has(abs)) return;
    seen.add(abs);

    const path = abs.toLowerCase();
    const text = $(el).text().toLowerCase();
    let score = 0;
    if (DOC_HINTS.some((h) => path.includes(h))) score += 10;
    if (DOC_TEXT_HINTS.some((h) => text.includes(h))) score += 8;
    if (FORM_HINTS.some((h) => path.includes(h))) score += 6;
    if (FORM_TEXT_HINTS.some((h) => text.includes(h))) score += 5;
    // Скор больше НЕ фильтр, а приоритет: страницы документов и форм идут
    // первыми, остальные — следом. Раньше `score > 0` выбрасывал всё
    // остальное, и страница «Карьера» с формой не обходилась никогда.
    if (SKIP_EXT.test(new URL(abs).pathname)) return;
    scored.push({ url: abs, score });
  });

  return scored.sort((a, b) => b.score - a.score);
}

export async function crawlSite(
  inputUrl: string,
  onProgress?: (crawled: number, url: string) => void,
): Promise<SiteSnapshot> {
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
        coverage: { crawled: 0, discovered: 0, skippedByTemplate: 0, skippedByLimit: 0, complete: false, stopReason: 'done' },
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
        coverage: { crawled: 0, discovered: 0, skippedByTemplate: 0, skippedByLimit: 0, complete: false, stopReason: 'done' },
        hosting: null,
        pages: [],
      };
    }

    const homePage: CrawledPage = { url: home.url, status: home.status, html: home.html, text: home.text };
    const pages: CrawledPage[] = [homePage];
    onProgress?.(pages.length, homePage.url);
    // `visited` НЕ дублирует дедупликацию очереди: URL попадает в `queue`
    // ровно один раз (это гарантирует проверка `discovered.has` внутри
    // enqueue — до того, как элемент попадёт в очередь), поэтому проверка
    // «уже видели» в основном цикле была бы недостижима. `visited` нужен
    // отдельно — чтобы фаза проб (PROBE_PATHS) не запрашивала повторно адрес,
    // который уже пришёл через обычные ссылки и обход, и чтобы не бить по
    // одному адресу дважды между пробами.
    const visited = new Set([home.url]);
    // Ключ группы — форма адреса ВМЕСТЕ с отпечатком разметки. Одного
    // отпечатка мало: структурно одинаковые, но разные по смыслу страницы
    // («404» и «Спасибо за заказ») слились бы в одну группу и одна из них
    // могла бы не попасть в обход.
    const groupKey = (url: string, html: string) => `${urlShape(url)}|${templateFingerprint(html)}`;
    const templates = new Map<string, number>([[groupKey(home.url, home.html), 1]]);

    // Очередь с приоритетом: документы и формы первыми, остальное следом.
    const queue: { url: string; score: number }[] = [];
    const discovered = new Set<string>([home.url]);
    const enqueue = (html: string, base: string) => {
      for (const { url, score } of collectLinksScored(html, base)) {
        // Нормализация ДО проверки discovered: без неё один и тот же документ
        // с разным регистром хоста, якорем, utm-меткой или слешем на конце
        // считается новым адресом каждый раз и съедает бюджет обхода копиями
        // одной страницы вместо новых.
        const normalized = normalizeForQueue(url);
        if (discovered.has(normalized)) continue;
        discovered.add(normalized);
        // Если после очистки трекинга в адресе остались query-параметры — это
        // почти всегда фильтр каталога или пагинация. Не выбрасываем совсем
        // (`?page=2` может вести на страницы, которых больше нигде нет), но
        // обходим их последними: скор на 1 меньше.
        const hasQuery = normalized.includes('?');
        queue.push({ url: normalized, score: hasQuery ? score - 1 : score });
      }
    };
    enqueue(home.html, home.url);

    const deadline = Date.now() + CRAWL_MS;
    let skippedByTemplate = 0;
    let stopReason: 'done' | 'pageLimit' | 'timeLimit' = 'done';

    while (queue.length) {
      // Лимит основного обхода урезан на RESERVED_FOR_PROBES: иначе крупный
      // каталог выбирает весь MAX_PAGES ДО фазы проб, и подстраховка ниже
      // отключается целиком именно там, где она нужнее всего.
      if (pages.length >= MAX_PAGES - RESERVED_FOR_PROBES) { stopReason = 'pageLimit'; break; }
      if (Date.now() > deadline) { stopReason = 'timeLimit'; break; }

      queue.sort((a, b) => b.score - a.score);
      const next = queue.shift()!;
      visited.add(next.url);

      await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      const page = await session.load(next.url);
      if (!page || page.blocked || page.status !== 200) continue;

      // Однотипных страниц (карточки товара) берём ограниченное число.
      const key = groupKey(page.url, page.html);
      const seenOfTemplate = templates.get(key) ?? 0;
      if (seenOfTemplate >= PER_TEMPLATE) { skippedByTemplate++; continue; }
      templates.set(key, seenOfTemplate + 1);

      const cp: CrawledPage = { url: page.url, status: page.status, html: page.html, text: page.text };
      pages.push(cp);
      onProgress?.(pages.length, cp.url);
      enqueue(cp.html, cp.url);
    }

    // Документы, опубликованные, но не прилинкованные ниоткуда.
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
    const canary = await session.load(new URL(`/nnq-${'probe'}-404-check/`, home.url).toString());
    const canarySignature =
      canary && !canary.blocked && canary.status === 200
        ? signature({ url: canary.url, status: canary.status, html: canary.html, text: canary.text })
        : null;

    for (const path of PROBE_PATHS) {
      // Пробы ограничены полным MAX_PAGES (не урезанным), а не наоборот:
      // именно под них зарезервированы RESERVED_FOR_PROBES слотов выше.
      if (pages.length >= MAX_PAGES) break;
      if (Date.now() > deadline) { stopReason = 'timeLimit'; break; }
      let probe: string;
      try { probe = new URL(path, home.url).toString(); } catch { continue; }
      if (visited.has(probe)) continue;
      visited.add(probe);
      await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      const page = await session.load(probe);
      if (!page || page.blocked || page.status !== 200) continue;
      const cp: CrawledPage = { url: page.url, status: page.status, html: page.html, text: page.text };
      if (looksLikeNotFound(cp)) continue;
      if (canarySignature && signature(cp) === canarySignature) continue;
      if (cp.text.length < 200) continue;

      // Тот же лимит «не больше PER_TEMPLATE на группу», что и в основном
      // обходе: без него проба могла бы протащить в pages шестую и седьмую
      // копию одного шаблона в обход общего правила.
      const key = groupKey(cp.url, cp.html);
      const seenOfTemplate = templates.get(key) ?? 0;
      if (seenOfTemplate >= PER_TEMPLATE) { skippedByTemplate++; continue; }
      templates.set(key, seenOfTemplate + 1);

      pages.push(cp);
      // Проба нашла страницу — значит страница обнаружена. discovered должен
      // отражать ВСЕ найденные адреса (обычным обходом и пробами), иначе в
      // отчёте «обойдено N из M найденных» получается N > M — числа, которые
      // противоречат сами себе на первый взгляд читателя.
      discovered.add(probe);
      onProgress?.(pages.length, cp.url);
    }

    return {
      inputUrl: start,
      finalUrl: home.url,
      reachable: true,
      cms: detectCms(home.html),
      clientRendered: detectClientRendered(home.html),
      footerVisible: detectFooter(home.html, home.url),
      blockedByAntibot: false,
      coverage: {
        crawled: pages.length,
        discovered: discovered.size,
        skippedByTemplate,
        skippedByLimit: stopReason === 'done' ? 0 : queue.length,
        complete: stopReason === 'done',
        stopReason,
      },
      hosting: null,
      pages,
    };
  } finally {
    await session.close();
  }
}

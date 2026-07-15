import * as cheerio from 'cheerio';
import type { CrawledPage, SiteSnapshot } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 18;

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

async function fetchPage(url: string): Promise<CrawledPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('html')) return null;
    const html = await res.text();
    return { url: res.url || url, status: res.status, html, text: htmlToText(html) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
function collectLinks(html: string, base: string): string[] {
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
    if (score > 0) scored.push({ url: abs, score });
  });

  return scored.sort((a, b) => b.score - a.score).map((s) => s.url);
}

export async function crawlSite(inputUrl: string): Promise<SiteSnapshot> {
  const start = normalizeUrl(inputUrl);

  let home = await fetchPage(start);
  // https не ответил — пробуем http, но фиксируем это честно
  if (!home && start.startsWith('https://')) {
    home = await fetchPage(start.replace(/^https:/, 'http:'));
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
      pages: [],
    };
  }

  const pages: CrawledPage[] = [home];
  const visited = new Set([home.url]);

  for (const link of collectLinks(home.html, home.url)) {
    if (pages.length >= MAX_PAGES) break;
    if (visited.has(link)) continue;
    visited.add(link);
    const page = await fetchPage(link);
    if (page) pages.push(page);
  }

  // Контрольный запрос по заведомо несуществующему адресу. Многие сайты
  // отдают на него код 200 и обычную оболочку. Зная, как выглядит их «ничего
  // не найдено», мы не примем такую заглушку за опубликованный документ.
  const canary = await fetchPage(new URL(`/nnq-${'probe'}-404-check/`, home.url).toString());
  const canarySignature = canary && canary.status === 200 ? signature(canary) : null;

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
    const page = await fetchPage(probe);
    if (!page || page.status !== 200) continue;
    if (looksLikeNotFound(page)) continue;
    if (canarySignature && signature(page) === canarySignature) continue;
    // Документ без текста — не документ.
    if (page.text.length < 200) continue;
    pages.push(page);
  }

  return {
    inputUrl: start,
    finalUrl: home.url,
    reachable: true,
    cms: detectCms(home.html),
    clientRendered: detectClientRendered(home.html),
    footerVisible: detectFooter(home.html, home.url),
    pages,
  };
}

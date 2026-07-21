import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { CHECKS, subjectOf, type Check } from './legal';
import type { CrawledPage, DocRef, Evidence, Factor, Finding, SiteSnapshot, Verdict } from './types';

/** Что возвращает каждая проверка 1–10. */
type CheckResult = {
  factors: Factor[];
  verdict: Verdict;
  summary: string;
  /** Документ, который проверка прочитала — чтобы вывод можно было открыть и сверить */
  doc?: DocRef;
};

/* ────────────────────────── вспомогательное ────────────────────────── */

/** Обрезает фрагмент кода до читаемого размера, не ломая смысл. */
function snip(html: string, max = 320): string {
  const one = html.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * Пруф вырезаем из ИСХОДНОГО html по смещениям, которые дал парсер, а не из
 * того, что вернёт `$.html(el)`.
 *
 * Разница решающая. Парсер пересобирает разметку по-своему: `<script async src=…>`
 * превращается в `<script async="" src=…>`. Такой строки на сайте нет — человек
 * откроет исходник, поищет её и не найдёт. Пруф, который нельзя найти на сайте,
 * не пруф, а ещё один повод не поверить.
 *
 * Требует cheerio.load(html, { sourceCodeLocationInfo: true }) — см. loadWithPos.
 */
function evidenceFrom(pageUrl: string, pageHtml: string, el: AnyNode, fallback?: string): Evidence {
  const loc = (el as { sourceCodeLocation?: { startOffset: number; endOffset: number } }).sourceCodeLocation;
  if (loc && typeof loc.startOffset === 'number') {
    const exact = pageHtml.slice(loc.startOffset, loc.endOffset);
    return {
      url: pageUrl,
      snippet: snip(exact),
      line: pageHtml.slice(0, loc.startOffset).split('\n').length,
      // Дословный кусок исходника: по нему ищут на странице через Ctrl+F.
      exact: exact.length > 400 ? `${exact.slice(0, 400)}…` : exact,
    };
  }
  return { url: pageUrl, snippet: snip(fallback ?? '') };
}

/** Разбор с запоминанием позиций в исходнике — иначе пруф не найти на странице. */
function loadWithPos(html: string) {
  return cheerio.load(html, { sourceCodeLocationInfo: true });
}

/**
 * Нарушение «что-то запрещённое ПРИСУТСТВУЕТ»: любое найденное доказательство
 * заявляем сразу — фрагмент кода можно открыть и перепроверить.
 * `unknown` роняет в manual только если нарушений не нашли вовсе.
 */
function byPresence(factors: Factor[]): Verdict {
  if (factors.some((f) => f.vote === 'violation')) return 'violation';
  if (factors.some((f) => f.vote === 'unknown')) return 'manual';
  return 'ok';
}

/**
 * Нарушение «обязательного НЕТ»: заявляем, только когда все факторы сошлись
 * и страница отдаётся сервером. На SPA отсутствие в HTML ничего не доказывает —
 * PRD §5.3: не заявляем как подтверждённое и не отбрасываем.
 */
function byAbsence(factors: Factor[]): Verdict {
  if (factors.some((f) => f.vote === 'unknown')) return 'manual';
  if (factors.every((f) => f.vote === 'violation')) return 'violation';
  if (factors.every((f) => f.vote === 'ok')) return 'ok';
  return 'manual'; // факторы противоречат друг другу
}

const SPA_REASON =
  'Контент страницы собирается скриптами на стороне посетителя — по исходному HTML отсутствие элемента не доказывается.';

const NO_FOOTER_REASON =
  'Подвал сайта в исходном HTML не виден — его дорисовывает скрипт. Ссылки на документы живут именно там, поэтому их отсутствие в коде ничего не доказывает.';

/**
 * Можно ли вообще делать вывод «документа на сайте нет».
 *
 * Только если страница отдаётся сервером И подвал виден в коде. Иначе мы не
 * видели того места, где ссылка обязана быть, и обвинение будет ложным.
 */
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

function absenceGateFactor(s: SiteSnapshot, found: boolean): Factor {
  return {
    name: 'Место, где ссылка обязана быть, видно в коде',
    vote: found ? 'ok' : canProveAbsence(s) ? 'violation' : 'unknown',
    detail: canProveAbsence(s)
      ? 'HTML и подвал отдаются сервером, сайт обойдён полностью — отсутствие ссылки показательно.'
      : absenceUnknownReason(s),
  };
}

/**
 * Голос «мы ничего не нашли».
 *
 * «Соответствует» — только если мы видели всю страницу целиком, включая подвал:
 * иконки соцсетей и форма подписки живут именно там. Если подвала не видно,
 * «ничего не нашли» означает «мы не смотрели», и выдавать это за соответствие
 * нельзя — так молча пропускается реальное нарушение (PRD §8).
 */
function nothingFound(s: SiteSnapshot): 'ok' | 'unknown' {
  return canProveAbsence(s) ? 'ok' : 'unknown';
}

/**
 * Ищет ссылку на документ по адресу и по тексту ссылки.
 *
 * Текст сверяется регулярным выражением, а не набором подстрок: по-русски один
 * документ называют по-разному («Пользовательское соглашение», «Соглашение об
 * использовании сайта», «Условия использования»), и список подстрок либо
 * пропускает половину названий, либо цепляет новости.
 */
/**
 * Слова, которые делают «policy» и «terms» совсем другим документом. Политика
 * возврата и условия доставки — не Политика конфиденциальности и не оферта;
 * принять их за нужный документ значит выдать справку о чистоте вместо
 * пропущенного нарушения.
 */
const WRONG_DOC = /return|shipping|refund|delivery|exchange|payment|warranty|garant|dostavk|vozvrat|oplat|cookie/;

function findLink(
  snapshot: SiteSnapshot,
  hrefHints: string[],
  textRe: RegExp,
): { evidence: Evidence; href: string; url: string; label: string } | null {
  for (const page of snapshot.pages) {
    const $ = loadWithPos(page.html);
    let hit: { evidence: Evidence; href: string; url: string; label: string } | null = null;
    $('a[href]').each((_, el) => {
      if (hit) return;
      const rawHref = $(el).attr('href') ?? '';
      const href = rawHref.toLowerCase();
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const byHref = hrefHints.some((h) => href.includes(h)) && !WRONG_DOC.test(href);
      if (!byHref && !textRe.test(text.toLowerCase())) return;
      // Адрес нужен абсолютный: «/politika/» в отчёте открыть нельзя.
      let url: string;
      try {
        url = new URL(rawHref, page.url).toString();
      } catch {
        return;
      }
      hit = {
        evidence: evidenceFrom(page.url, page.html, el as AnyNode),
        href,
        url,
        label: text || url,
      };
    });
    if (hit) return hit;
  }
  return null;
}

/** Страница документа среди скачанных — по адресу или заголовку. */
function findDocPage(snapshot: SiteSnapshot, hints: string[]) {
  return snapshot.pages.find((p) => {
    const u = p.url.toLowerCase();
    const head = p.text.slice(0, 600).toLowerCase();
    return hints.some((h) => u.includes(h) || head.includes(h));
  });
}

/* ────────────────────────── проверки 1–10 ────────────────────────── */

/**
 * Браузер исполняет <script> только с JS-типом (или вовсе без type).
 * `type="text/html"`, `text/template` и подобное — инертные данные: счётчик
 * оттуда не работает, пока его не вставит другой скрипт. Считать такой код
 * работающим счётчиком — ложное срабатывание.
 */
function isExecutable(type: string | undefined): boolean {
  if (!type) return true;
  const t = type.trim().toLowerCase();
  return t === 'text/javascript' || t === 'application/javascript' || t === 'module' || t === '';
}

/**
 * Счётчик может быть заряжен через загрузчик согласия (у Битрикса это
 * data-bx-gdpr-*): код лежит в странице, но отправляется на серверы Google
 * только после того, как посетитель согласится. Заявлять «данные уже уходят»
 * в этом случае нельзя — это вопрос ручной проверки.
 */
function isConsentGated(rawTag: string): boolean {
  return /data-bx-gdpr|gdpr-counter|consent-loader|data-cookie-consent|data-cookieconsent/i.test(rawTag);
}

/** Добавляет точку в конце фразы, если её там нет — иначе она сливается со следующим предложением. */
function withPeriod(s: string): string {
  const t = s.trim();
  return t && !/[.!?…]$/.test(t) ? `${t}.` : t;
}

/**
 * Канонизирует код страны: обрезает пробелы, поднимает регистр, пустую строку
 * сводит к null. Заодно требует двухбуквенный ISO-код (RFC 9083) — MINOR 1 из
 * финального ревью: geo.ts валидирует country/country_code на входе, но
 * hostingFactor обязан быть корректным и сам по себе (см. комментарий выше
 * про регистр и пустые строки), а не полагаться на то, что источник данных
 * всегда чист. Строка вроде "RUSSIAN FEDERATION" не должна восприниматься
 * как «названа не-RU страна» — иначе получается самоопровергающаяся фраза
 * «страна RUSSIAN FEDERATION».
 */
function normCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

/**
 * Голос за размещение сайта. Спека §4.2 (правка от 2026-07-16: упрощение
 * правила по решению владельца продукта).
 *
 * Обвиняем ровно в одном случае: ОБА источника независимо назвали
 * не-российскую страну. Молчание любого из них, любой намёк на Россию, любой
 * CDN — `unknown`. Ошибка в сторону «не знаем» стоит одного пункта в отчёте,
 * ошибка в сторону обвинения — всего доверия.
 *
 * Порядок решений:
 *  0. Источник А (RDAP) вообще не ответил по проверяемому адресу — `unknown`,
 *     источник Б в одиночку не обвиняет.
 *  1. RDAP назвал RU — `ok`, источник Б не спрашиваем.
 *  2. RDAP ответил, но страну не назвал (как ARIN) — `unknown`. Раньше отсюда
 *     шли к источнику Б и могли обвинить по нему одному; теперь это запрещено
 *     без исключений. Основание: в целевом сегменте сайт на ARIN практически
 *     не встречается — реальные сайты в зоне RIPE (РФ и Европа), где страна
 *     есть всегда, так что это правило ничего не стоит на практике.
 *  3. RDAP назвал не-RU страну — только теперь спрашиваем источник Б: RU у
 *     него — расхождение (`unknown`), та же не-RU страна или другая не-RU
 *     страна — `violation`.
 */
function hostingFactor(raw: SiteSnapshot['hosting']): Factor {
  const name = 'Размещение сайта';

  if (!raw || !raw.ips.length) {
    return {
      name,
      vote: 'unknown',
      detail: raw?.error ? withPeriod(raw.error) : 'Где стоит сайт, выяснить не удалось.',
    };
  }

  // Функция обязана быть корректной сама по себе, а не полагаться на то, что
  // geo.ts всегда отдаёт чистые данные: регистр страны, пустые строки вместо null.
  const h = {
    ...raw,
    country: normCountry(raw.country),
    geoCountry: normCountry(raw.geoCountry),
    netname: raw.netname && raw.netname.trim() ? raw.netname.trim() : null,
    ip: raw.ip && raw.ip.trim() ? raw.ip.trim() : null,
  };

  // IMPORTANT 1 (финальное ревью): в текст печатаем только адрес, по которому
  // реально получены country/netname (h.ip) — а не весь список проверенных
  // адресов (h.ips). Раньше сюда шли ВСЕ checked-адреса, хотя страну и сеть
  // узнавали только у одного (флагованного); остальные проверенные, но
  // неподтверждённые адреса печатались в фразе про заграницу как измеренные.
  // h.ip не задан — либо country/netname ещё не определены, либо (ветка «все
  // адреса RU», её не трогаем) они относятся ко всем h.ips сразу.
  const where = h.ip
    ? `IP ${h.ip}${h.netname ? `, сеть ${h.netname}` : ''}`
    : `IP ${h.ips.join(', ')}${h.netname ? `, сеть ${h.netname}` : ''}`;

  // CDN проверяем ПЕРЕД тем, ответил ли RDAP (пункт 0 ниже). isCdn может быть
  // установлен и по ipwho.is (connection.org), когда RDAP по адресу молчал —
  // тогда порядок «RDAP не ответил → CDN» давал менее точный текст: адрес за
  // CDN описывался как «реестр не ответил», хотя причина манильного вердикта
  // в другом. Сам вердикт (manual) от порядка не меняется, меняется только
  // точность формулировки (MINOR из отчёта о регрессе).
  if (h.isCdn) {
    return {
      name,
      vote: 'unknown',
      detail: `Сайт отдаётся через CDN${h.netname ? ` (${h.netname})` : ''}. За CDN физическое размещение снаружи не определяется: адрес принадлежит посреднику. ${where}.`,
    };
  }

  // Пункт 0 (дизайн-документ §4.2, правило 1): RDAP — первоисточник; без его
  // ответа второй источник (геобаза) не имеет права обвинять в одиночку.
  // rdap.org — бесплатный сервис без SLA: живой прогон дал не-200 на 2 из 20
  // быстрых запросов, и без этой проверки вердикт менялся между прогонами.
  if (!h.confirmedBy.includes('rdap')) {
    return {
      name,
      vote: 'unknown',
      detail: `Реестр RDAP не ответил, подтвердить размещение нечем. ${where}.`,
    };
  }

  if (h.country === 'RU') {
    // Не называем конкретный реестр: rdap.org редиректит куда угодно (RIPE,
    // APNIC, AFRINIC — проверено вживую), и это не всегда RIPE.
    return { name, vote: 'ok', detail: `Сайт размещён в РФ: ${where}, страна RU по данным реестра RDAP.` };
  }

  // Решение владельца продукта от 2026-07-16 (дизайн-документ §4.2): в
  // целевом сегменте сайт на американском хостинге (ARIN, без поля country)
  // практически не встречается — сайты либо в РФ, либо в Европе, а Европа и
  // Россия — зона RIPE, где country есть всегда. Значит, реестр, ответивший
  // без страны, — не повод спрашивать второй источник и обвинять по нему в
  // одиночку: это против правила «обвиняем только когда оба источника
  // независимо назвали не-российскую страну». Раньше здесь шли дальше и
  // могли получить violation по одному ipwho.is — это и есть баг, который
  // правка устраняет.
  if (!h.country) {
    return {
      name,
      vote: 'unknown',
      detail: `Реестр RDAP ответил, но страну не назвал. Обвинять по одному источнику нельзя. ${where}.`,
    };
  }

  // RDAP назвал не-RU страну — дальше решает второй источник (спрашиваем его
  // здесь, а не раньше: только теперь есть что подтверждать).
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
      detail: `Источники разошлись: реестр называет страну ${h.country}, геобаза — RU. ${where}.`,
    };
  }

  // Дошли сюда — оба источника независимо назвали не-российскую страну
  // (h.country и h.geoCountry оба заведомо непустые, см. проверки выше). Но
  // «страна» у них может быть разной: country из RDAP — это страна
  // регистранта адресного блока (какой бы реестр ни ответил), а не
  // обязательно страна машины. Печатаем ровно то, что сказал каждый
  // источник, а не выдаём одну страну за согласованную обеими.
  const countryText =
    h.country !== h.geoCountry
      ? `реестр называет страну ${h.country}, геобаза — ${h.geoCountry}`
      : `страна ${h.geoCountry}`;

  return {
    name,
    vote: 'violation',
    detail: `Сайт размещён за пределами РФ: ${where}, ${countryText} — подтверждено источниками: rdap, ipwho.is.`,
  };
}

/** 1. Данные не уходят за границу: сервер в РФ, нет Google Analytics, нет GTM. */
function check1(s: SiteSnapshot): CheckResult {
  const factors: Factor[] = [];
  const gaEv: Evidence[] = [];
  const gtmEv: Evidence[] = [];
  const gatedEv: Evidence[] = [];

  for (const page of s.pages) {
    const $ = loadWithPos(page.html);
    $('script').each((_, el) => {
      const src = ($(el).attr('src') ?? '').toLowerCase();
      const body = $(el).html() ?? '';
      const raw = $.html(el as AnyNode);

      const mentionsGa =
        src.includes('google-analytics.com') ||
        src.includes('googletagmanager.com/gtag/js') ||
        (!src && /GoogleAnalyticsObject|gtag\s*\(\s*['"]config['"]|\bga\s*\(\s*['"]create['"]/.test(body));
      const mentionsGtm =
        src.includes('googletagmanager.com/gtm.js') || (!src && /GTM-[A-Z0-9]{4,}/.test(body));

      if (!mentionsGa && !mentionsGtm) return;

      // Код есть, но не исполняется или ждёт согласия — это не доказательство
      // передачи данных. Уводим в ручную проверку, а не в нарушение.
      if (!isExecutable($(el).attr('type')) || isConsentGated(raw)) {
        gatedEv.push(evidenceFrom(page.url, page.html, el as AnyNode, raw));
        return;
      }
      if (mentionsGa) gaEv.push(evidenceFrom(page.url, page.html, el as AnyNode, raw));
      if (mentionsGtm) gtmEv.push(evidenceFrom(page.url, page.html, el as AnyNode, raw));
    });

    $('noscript iframe[src*="googletagmanager.com"]').each((_, el) => {
      gtmEv.push(evidenceFrom(page.url, page.html, el as AnyNode));
    });
  }

  factors.push({
    name: 'Google Analytics в коде страниц',
    vote: gaEv.length ? 'violation' : 'ok',
    detail: gaEv.length
      ? `Найден работающий код Google Analytics на страницах: ${gaEv.length}. Данные посетителей уходят на серверы Google за пределами РФ.`
      : 'Работающего кода Google Analytics на скачанных страницах не найдено.',
    evidence: gaEv[0],
  });

  factors.push({
    name: 'Google Tag Manager в коде страниц',
    vote: gtmEv.length ? 'violation' : 'ok',
    detail: gtmEv.length
      ? `Найден работающий код Google Tag Manager на страницах: ${gtmEv.length}.`
      : 'Работающего кода Google Tag Manager на скачанных страницах не найдено.',
    evidence: gtmEv[0],
  });

  if (gatedEv.length) {
    factors.push({
      name: 'Счётчик Google заряжен под согласие',
      vote: 'unknown',
      detail:
        `Код счётчика Google на страницах есть (найдено: ${gatedEv.length}), но он не исполняется сразу: ` +
        'лежит в неисполняемом теге или подключается загрузчиком согласия. Уходят ли данные на самом деле — ' +
        'зависит от поведения плашки, это нужно проверить в браузере.',
      evidence: gatedEv[0],
    });
  }

  const hf = hostingFactor(s.hosting);
  factors.push(hf);

  const verdict = byPresence(factors);
  const found = [gaEv.length && 'Google Analytics', gtmEv.length && 'Google Tag Manager']
    .filter(Boolean)
    .join(' и ');

  return {
    factors,
    verdict,
    summary: (() => {
      if (verdict === 'violation') {
        // Печатаем только измеренное. Про базу данных клиента — ни слова:
        // мы её не видели, а заграница и без того красный флаг.
        //
        // IMPORTANT 2 (финальное ревью): при найденном счётчике summary
        // раньше содержал ТОЛЬКО фразу про счётчик, а hf.detail (IP, сеть,
        // страна размещения) терялся — в Word-отчёте (docx.ts печатает
        // только summary, factors туда не идут) у сайта с Google Analytics
        // не было ни IP, ни хостера, ни страны, хотя критерий готовности
        // (спека §9.4) требует их для каждого вердикта. Нужны обе части:
        // счётчик — почему нарушение, hf.detail — что мы измерили про
        // размещение. Это не противоречие даже для RU-хостинга: GA шлёт
        // данные на серверы Google независимо от того, где стоит сам сайт.
        return found
          ? `На сайте установлен ${found}. Данные посетителей передаются на серверы за пределами РФ, что противоречит требованию о локализации персональных данных. ${hf.detail}`
          : `${hf.detail} Закон запрещает запись, накопление и хранение персональных данных граждан РФ с использованием баз данных, находящихся за пределами территории РФ.`;
      }
      if (verdict === 'ok') {
        return `Google Analytics и Google Tag Manager не обнаружены. ${hf.detail}`;
      }
      return gatedEv.length
        ? `Код счётчика Google на сайте есть, но срабатывает он только после согласия. Заявлять передачу данных нельзя — нужна проверка в браузере. ${hf.detail}`
        : `Google Analytics и Google Tag Manager не обнаружены. ${hf.detail}`;
    })(),
  };
}

/** 2. Нет логотипов и ссылок запрещённых соцсетей. */
function check2(s: SiteSnapshot): CheckResult {
  const hits: Evidence[] = [];
  const hosts = ['instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'instagr.am'];

  for (const page of s.pages) {
    const $ = loadWithPos(page.html);
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') ?? '').toLowerCase();
      if (hosts.some((h) => href.includes(h))) {
        hits.push(evidenceFrom(page.url, page.html, el as AnyNode));
      }
    });
    // Иконки соцсетей: <img>, а также <use xlink:href="#icon-instagram"> в SVG-спрайтах.
    $('img, use').each((_, el) => {
      const src = ($(el).attr('src') ?? $(el).attr('href') ?? $(el).attr('xlink:href') ?? '').toLowerCase();
      const alt = ($(el).attr('alt') ?? '').toLowerCase();
      if (/instagram|facebook|\bfb[-_.]/.test(src) || /instagram|facebook/.test(alt)) {
        hits.push(evidenceFrom(page.url, page.html, el as AnyNode));
      }
    });
  }

  const factors: Factor[] = [
    {
      name: 'Ссылки и логотипы Инстаграма и Фейсбука',
      vote: hits.length ? 'violation' : nothingFound(s),
      detail: hits.length
        ? `Найдено упоминаний в коде: ${hits.length}. Мета признана экстремистской организацией, её символика на сайте недопустима.`
        : canProveAbsence(s)
          ? 'Ссылок и логотипов Инстаграма и Фейсбука в коде страниц не найдено.'
          : absenceUnknownReason(s),
      evidence: hits[0],
    },
  ];

  return {
    factors,
    verdict: byPresence(factors),
    summary: hits.length
      ? `На сайте есть ссылки или логотипы Инстаграма/Фейсбука (найдено мест: ${hits.length}). Мета признана экстремистской организацией — её символика на сайте недопустима.`
      : canProveAbsence(s)
        ? 'Ссылок и логотипов запрещённых соцсетей не обнаружено.'
        : absenceUnknownReason(s),
  };
}

/** 3. Политика конфиденциальности опубликована и доступна с любой страницы. */
function check3(s: SiteSnapshot): CheckResult {
  // Осторожно с «политикой»: по-русски это и «policy», и «politics». На сайте
  // газеты ссылка «Политика» ведёт в новостной раздел, а не в документ.
  // Опознаём только по однозначным словам: «конфиденциальности», «персональных
  // данных». Голое «политика» и адрес /politika/ ничего не доказывают.
  const link = findLink(
    s,
    ['politika-konfidencial', 'policy', 'privacy', 'konfidencial', 'personal-data', 'personaldata'],
    // \w в JS кириллицу не берёт ([A-Za-z0-9_]) — после корня всегда кириллическое
    // окончание («персональных», «обработка»), поэтому вместо \w* используем
    // [а-яё]* (см. .superpowers/sdd/regex-cyrillic-sweep.md, находка №1).
    /конфиденциальн|персональн[а-яё]*\s+данн|обработк[а-яё]*\s+персональн/,
  );

  const factors: Factor[] = [
    {
      name: 'Ссылка на Политику конфиденциальности в коде страниц',
      vote: link ? 'ok' : 'violation',
      detail: link
        ? `Ссылка найдена: ${link.href}`
        : 'Ссылка на Политику конфиденциальности не найдена ни на одной из скачанных страниц.',
      evidence: link?.evidence,
    },
    absenceGateFactor(s, Boolean(link)),
  ];

  const verdict = link ? 'ok' : byAbsence(factors);

  return {
    factors,
    verdict,
    doc: link ? { url: link.url, label: 'Политика конфиденциальности' } : undefined,
    summary:
      verdict === 'violation'
        ? 'На сайте не найдена опубликованная Политика конфиденциальности: ни в ссылках на страницах, ни по типовым адресам. Это самостоятельный состав: документ должен быть опубликован и доступен с любой страницы.'
        : verdict === 'ok'
          ? 'Политика конфиденциальности опубликована — вот она, можно открыть и прочитать.'
          : `Ссылку на Политику конфиденциальности найти не удалось. ${absenceUnknownReason(s)}`,
  };
}

/** 4. Согласие на обработку ПДн — отдельный документ с обязательным составом. */
function check4(s: SiteSnapshot): CheckResult {
  // \w* кириллицу не берёт — «согласие»/«согласия» перед \s+обработку никогда
  // не матчились (находка №2 отчёта), заменено на [а-яё]*.
  const link = findLink(s, ['soglasie', 'consent'], /соглас[а-яё]*\s+на\s+обработку|даю\s+соглас/);
  const doc = findDocPage(s, ['soglasie', 'consent', 'согласие на обработку']);

  const factors: Factor[] = [
    {
      name: 'Отдельный документ «Согласие на обработку ПДн»',
      vote: link || doc ? 'ok' : 'violation',
      detail:
        link || doc
          ? `Отдельный документ найден: ${link?.href ?? doc?.url}`
          : 'Отдельный документ «Согласие на обработку персональных данных» не найден: ни среди ссылок на страницах сайта, ни по типовым адресам публикации.',
      evidence: link?.evidence,
    },
    absenceGateFactor(s, Boolean(link || doc)),
  ];

  // Документ есть — проверяем обязательный состав по ст. 9 ч. 4.
  if (doc) {
    const t = doc.text.toLowerCase();
    const parts: [string, boolean][] = [
      ['цель обработки', /цел[ьия]\s+обработк|в целях/.test(t)],
      ['перечень действий', /перечень действий|перечень операций|действия с персональными/.test(t)],
      ['срок действия', /срок[а]?\s+(действия|обработки|хранения)|действует в течение/.test(t)],
      ['способ отзыва', /отзыв|отозвать/.test(t)],
    ];
    const missing = parts.filter(([, present]) => !present).map(([name]) => name);
    factors.push({
      name: 'Обязательный состав согласия (цель, перечень действий, срок, отзыв)',
      vote: missing.length ? 'violation' : 'ok',
      detail: missing.length
        ? `В тексте документа не найдено: ${missing.join(', ')}.`
        : 'В документе присутствуют все обязательные элементы состава согласия.',
      evidence: missing.length
        ? { url: doc.url, snippet: snip(doc.text, 280) }
        : undefined,
    });
  }

  const hasDoc = Boolean(link || doc);
  const composition = factors.find((f) => f.name.startsWith('Обязательный состав'));
  const verdict: Verdict = !hasDoc
    ? byAbsence(factors.slice(0, 2))
    : composition?.vote === 'violation'
      ? 'violation'
      : composition
        ? 'ok'
        : 'manual';

  return {
    factors,
    verdict,
    doc: link
      ? { url: link.url, label: 'Согласие на обработку персональных данных' }
      : doc
        ? { url: doc.url, label: 'Согласие на обработку персональных данных' }
        : undefined,
    summary: !hasDoc
      ? verdict === 'violation'
        ? 'Отдельный документ «Согласие на обработку персональных данных» не найден: ни в ссылках на страницах сайта, ни по типовым адресам публикации. Согласие не может быть частью Политики — это разные документы с разным назначением.'
        : `Отдельный документ «Согласие на обработку персональных данных» найти не удалось. ${absenceUnknownReason(s)}`
      : composition?.vote === 'violation'
        ? `Документ с согласием есть, но его состав неполон: ${composition.detail}`
        : 'Отдельный документ с согласием опубликован, обязательный состав присутствует.',
  };
}

/** 5. Оферта или пользовательское соглашение. */
function check5(s: SiteSnapshot): CheckResult {
  // «Соглашение» само по себе встречается в новостях, поэтому требуем рядом
  // слово, которое делает его документом: пользовательское, об использовании,
  // лицензионное. Голое «offer» в адресе не берём — это чаще «спецпредложения».
  const link = findLink(
    s,
    ['oferta', 'public-offer', 'agreement', 'soglashenie', 'terms', 'usloviya'],
    // 4 из 5 альтернатив использовали \w* рядом с кириллицей и не срабатывали
    // никогда, включая целевую «пользовательское соглашение» (находка №3).
    /оферт|пользовательск[а-яё]*\s+соглашени|соглашени[а-яё]*\s+об\s+использован|лицензионн[а-яё]*\s+соглашени|услови[а-яё]*\s+использован/,
  );

  const factors: Factor[] = [
    {
      name: 'Ссылка на оферту или пользовательское соглашение',
      vote: link ? 'ok' : 'violation',
      detail: link
        ? `Документ найден: ${link.href}`
        : 'Ни публичной оферты, ни пользовательского соглашения не найдено: ни в ссылках на страницах сайта, ни по типовым адресам публикации.',
      evidence: link?.evidence,
    },
    absenceGateFactor(s, Boolean(link)),
  ];

  const verdict = link ? 'ok' : byAbsence(factors);

  return {
    factors,
    verdict,
    doc: link ? { url: link.url, label: link.label || 'Оферта / пользовательское соглашение' } : undefined,
    summary:
      verdict === 'violation'
        ? 'Ни публичной оферты, ни пользовательского соглашения на сайте не найдено: ни в ссылках на страницах, ни по типовым адресам. Интернет-магазину нужна оферта, остальным — пользовательское соглашение.'
        : verdict === 'ok'
          ? 'Оферта или пользовательское соглашение опубликованы — вот документ, можно открыть.'
          : `Ни оферты, ни пользовательского соглашения найти не удалось. ${absenceUnknownReason(s)}`,
  };
}

/** Плашка куки, найденная в разметке: сам узел, страница и её исходник. */
type Banner = { page: CrawledPage; el: AnyNode; $: cheerio.CheerioAPI };

/** Кнопка согласия внутри блока: «Принять», «Согласен», «Хорошо». */
function hasConsentAction($: cheerio.CheerioAPI, el: AnyNode): boolean {
  const $el = $(el as never);
  if ($el.find('[class*="accept" i], [class*="agree" i], [class*="soglas" i]').length > 0) return true;
  let found = false;
  $el.find('button, a, input[type="button"], input[type="submit"]').each((_, b) => {
    if (found) return;
    const t = `${$(b).text()} ${$(b).attr('value') ?? ''}`.toLowerCase();
    // `ок\b` не годится: \b — переход \w<->не-\w, а кириллическая «к» это не
    // \w, поэтому граница после «ок» никогда не находилась (находка №4 отчёта).
    // Нужна не просто замена класса, а явная проверка «дальше не буква» —
    // иначе «ок» ловится и внутри «около»/«окно»/«оказалось».
    if (/приня|соглас|хорошо|(?<![a-zа-яё])ок(?![a-zа-яё])|понятно|accept|agree|allow|got it/.test(t)) found = true;
  });
  return found;
}

/**
 * Ищет ПЛАШКУ СОГЛАСИЯ — блок, где есть и текст про куки, и кнопка согласия.
 *
 * Одного слова «cookie» в классе мало. У Битрикса, например, на служебных
 * страницах лежит `bx-main-cookie-policy-settings` — это окно настроек куки,
 * и кнопки «Принять» там нет по определению. Приняв его за плашку, инструмент
 * заявлял «нет кнопки согласия» и обвинял сайт на пустом месте.
 *
 * Поэтому кандидат обязан выглядеть плашкой целиком. Не нашли такого — значит,
 * плашку мы не опознали, и это повод для ручной проверки, а не для обвинения.
 */
function findBanner(s: SiteSnapshot): Banner | null {
  for (const page of s.pages) {
    const $ = loadWithPos(page.html);
    let found: Banner | null = null;

    const consider = (el: AnyNode) => {
      if (found) return;
      const text = $(el as never).text().replace(/\s+/g, ' ').trim();
      // Большой контейнер — это страница целиком, а не плашка: слово «куки»
      // в нём может быть из статьи.
      if (text.length > 800 || !/куки|cookie/i.test(text)) return;
      if (!hasConsentAction($, el)) return;
      found = { page, el, $ };
    };

    $('[class*="cookie" i], [id*="cookie" i], [class*="kuki" i], [id*="kuki" i]').each((_, el) =>
      consider(el as AnyNode),
    );
    if (found) return found;

    // Вёрстка вида <div class="consent-bar"> — слова cookie в атрибутах нет.
    $('div, section, aside').each((_, el) => consider(el as AnyNode));
    if (found) return found;
  }
  return null;
}

/** 6. Плашка куки при первом заходе + её обязательное содержание. */
function check6(s: SiteSnapshot): CheckResult {
  const raw = s.pages.map((p) => p.html).join('\n').toLowerCase();
  const factors: Factor[] = [];

  const banner = findBanner(s);
  // Слово cookie в скриптах без разметки = плашку рисует скрипт: она есть,
  // но её содержимое из исходника не прочитать.
  const traceInScripts = /cookie|куки/.test(raw);

  factors.push({
    name: 'Плашка куки в разметке страницы',
    vote: banner ? 'ok' : traceInScripts ? 'unknown' : 'violation',
    detail: banner
      ? 'Плашка найдена прямо в коде страницы — её состав разобран ниже.'
      : traceInScripts
        ? 'Упоминания куки в коде есть, но самой плашки в разметке нет: её дорисовывает скрипт. Прочитать её состав из исходника нельзя — нужен просмотр в браузере.'
        : 'В коде сайта нет ни одного упоминания куки — плашки согласия нет.',
    evidence: banner ? evidenceFrom(banner.page.url, banner.page.html, banner.el) : undefined,
  });

  if (!banner) {
    factors.push(absenceGateFactor(s, traceInScripts));
    const verdict: Verdict = traceInScripts ? 'manual' : byAbsence(factors);
    return {
      factors,
      verdict,
      summary:
        verdict === 'violation'
          ? 'Плашки согласия на куки нет: в коде сайта нет ни одного упоминания куки. Согласие на обработку через куки не собирается.'
          : traceInScripts
            ? 'Плашку рисует скрипт — в исходном коде её нет, поэтому состав проверить нечем: нужен просмотр страницы в браузере.'
            : `Плашки согласия на куки в коде не найдено. ${absenceUnknownReason(s)}`,
    };
  }

  // Плашка в разметке — дальше всё определяем сами, по её содержимому.
  const $b = banner.$(banner.el as never);
  const bannerText = $b.text().replace(/\s+/g, ' ').trim();
  const links: { href: string; text: string }[] = [];
  $b.find('a[href]').each((_, a) => {
    links.push({
      href: (banner.$(a).attr('href') ?? '').toLowerCase(),
      text: banner.$(a).text().toLowerCase().replace(/\s+/g, ' ').trim(),
    });
  });

  const hasPolicyLink = links.some(
    (l) =>
      (/konfidencial|privacy|policy|personal-?data|politika-konfidencial/.test(l.href) && !WRONG_DOC.test(l.href)) ||
      // \w* та же находка №5: «персональных данных» без \w* не матчилась.
      /конфиденциальн|персональн[а-яё]*\s+данн/.test(l.text),
  );
  const hasCookieLink = links.some(
    (l) => /cookie|kuki/.test(l.href) || /куки|cookie/.test(l.text),
  );
  factors.push({
    name: 'Ссылка на Политику конфиденциальности в плашке',
    vote: hasPolicyLink ? 'ok' : 'violation',
    detail: hasPolicyLink
      ? 'В плашке есть ссылка на Политику конфиденциальности.'
      : `В плашке нет ссылки на Политику конфиденциальности. Согласие должно быть информированным: посетителю нужно дать прочитать, на что он соглашается. Найденные ссылки: ${links.length ? links.map((l) => l.href).join(', ') : 'ни одной'}.`,
  });

  factors.push({
    name: 'Ссылка на Политику куки в плашке',
    vote: hasCookieLink ? 'ok' : 'violation',
    detail: hasCookieLink
      ? 'В плашке есть ссылка на документ о куки.'
      : 'В плашке нет отдельной ссылки на Политику куки — посетитель не может узнать, какие куки и зачем ставятся.',
  });

  const metrikaUsed = /mc\.yandex\.ru|metrika|ym\(\s*\d+/.test(raw);
  // Требуем рядом «яндекс»: голое «метрики» — обычное деловое слово
  // («отслеживаем ключевые метрики»), уведомлением оно не является.
  const metrikaRe = /яндекс[^а-яё]{0,3}метрик|yandex[^a-z]{0,3}metrika/;
  const policy = findDocPage(s, ['policy', 'privacy', 'konfidencial', 'политика конфиденциальн', 'персональных данных']);
  const metrikaMentioned =
    metrikaRe.test(bannerText.toLowerCase()) || (policy ? metrikaRe.test(policy.text.toLowerCase()) : false);

  factors.push({
    name: 'Упоминание Яндекс.Метрики',
    vote: !metrikaUsed ? 'ok' : metrikaMentioned ? 'ok' : policy ? 'violation' : 'unknown',
    detail: !metrikaUsed
      ? 'Яндекс.Метрика на сайте не обнаружена — требование неприменимо.'
      : metrikaMentioned
        ? 'Яндекс.Метрика используется и упомянута в плашке или в Политике.'
        : policy
          ? 'Яндекс.Метрика установлена, но не упомянута ни в плашке, ни в тексте Политики — правила Метрики требуют уведомить посетителей.'
          : 'Яндекс.Метрика установлена и в плашке не упомянута, но текст Политики прочитать не удалось — уведомление может быть там.',
  });

  const verdict = byPresence(factors);
  const missing = [
    !hasPolicyLink && 'ссылки на Политику конфиденциальности',
    !hasCookieLink && 'ссылки на Политику куки',
    metrikaUsed && !metrikaMentioned && policy && 'упоминания Яндекс.Метрики',
  ].filter(Boolean);

  return {
    factors,
    verdict,
    doc: { url: banner.page.url, label: 'Страница с плашкой куки' },
    summary:
      verdict === 'violation'
        ? `Плашка куки на сайте есть, но её состав неполон: не хватает ${missing.join(', ')}. Согласие на куки должно быть информированным — плашка обязана дать прочитать, на что соглашается посетитель.`
        : verdict === 'ok'
          ? 'Плашка куки на месте, состав полный: есть кнопка согласия и ссылки на документы.'
          : 'Плашка куки на месте и разобрана, но часть требований проверить нечем — подробности в факторах.',
  };
}

/**
 * Похож ли чекбокс на согласие: смотрим его имя, id и текст подписи рядом.
 * Согласие на ПДн и на рассылку — да; «подарочная упаковка» и «запомнить меня» —
 * нет, их предвыбор законом не запрещён.
 */
const CONSENT_WORDS =
  /соглас|персональн|обработк|политик|оферт|рассылк|подписк|уведомлен|newsletter|subscribe|agree|consent|privacy/i;

function isConsentBox($: cheerio.CheerioAPI, box: AnyNode): boolean {
  const $b = $(box);
  const own = `${$b.attr('name') ?? ''} ${$b.attr('id') ?? ''} ${$b.attr('class') ?? ''}`;
  if (CONSENT_WORDS.test(own)) return true;

  // Подпись: <label for="…">, объемлющий <label> или соседний текст.
  const id = $b.attr('id');
  const byFor = id ? $(`label[for="${id}"]`).text() : '';
  const wrapping = $b.closest('label').text();
  const nearby = $b.parent().text();
  return CONSENT_WORDS.test(`${byFor} ${wrapping} ${nearby}`);
}

/** 7. Активное согласие в формах: отдельные чекбоксы, не отмеченные заранее. */
function check7(s: SiteSnapshot): CheckResult {
  const preChecked: Evidence[] = [];
  const noCheckbox: Evidence[] = [];
  let pdForms = 0;

  for (const page of s.pages) {
    const $ = loadWithPos(page.html);
    $('form').each((_, el) => {
      const $f = $(el);
      const html = $.html(el as AnyNode);

      // Поиск и вход — не про сбор ПДн, исключаем, чтобы не выдумать нарушение.
      // Форму входа опознаём по полю пароля: обёртка может называться как
      // угодно («modal__form»), а вот `name="username"` легко принять за имя.
      const isAuth =
        $f.find('input[type="password"]').length > 0 ||
        /login|auth|signin|password/i.test(
          `${$f.attr('action') ?? ''} ${$f.attr('class') ?? ''} ${$f.attr('id') ?? ''}`,
        );
      const isSearch =
        $f.find('input[type="search"]').length > 0 ||
        /search|poisk|найти/i.test(`${$f.attr('action') ?? ''} ${$f.attr('class') ?? ''} ${$f.attr('id') ?? ''}`);
      if (isAuth || isSearch) return;

      // Форма собирает персональные данные?
      const collectsPd =
        $f.find('input[type="email"], input[type="tel"]').length > 0 ||
        $f.find('input[name*="mail" i], input[name*="phone" i], input[name*="tel" i], input[name*="name" i]').length > 0;
      if (!collectsPd) return;
      pdForms += 1;

      const boxes = $f.find('input[type="checkbox"]');
      if (boxes.length === 0) {
        noCheckbox.push(evidenceFrom(page.url, page.html, el as AnyNode, html));
        return;
      }
      boxes.each((__, box) => {
        const $b = $(box);
        // `checked` в разметке = галочка стоит заранее.
        if ($b.attr('checked') === undefined) return;
        // ...но только если это галочка согласия. Заранее отмеченная «подарочная
        // упаковка» или «уведомить о доставке» — обычная настройка, а не согласие;
        // обвинять за неё в обработке без согласия нельзя.
        if (!isConsentBox($, box)) return;
        preChecked.push(evidenceFrom(page.url, page.html, box as AnyNode));
      });
    });
  }

  const factors: Factor[] = [];

  factors.push({
    name: 'Чекбоксы согласия, отмеченные по умолчанию',
    vote: preChecked.length ? 'violation' : 'ok',
    detail: preChecked.length
      ? `Найдено заранее отмеченных чекбоксов: ${preChecked.length}. Атрибут checked в коде означает, что галочка стоит до действия посетителя — такое согласие не является активным.`
      : 'Заранее отмеченных чекбоксов в формах не найдено.',
    evidence: preChecked[0],
  });

  if (pdForms > 0) {
    factors.push({
      name: 'Формы сбора ПДн без чекбокса согласия',
      vote: noCheckbox.length ? 'violation' : 'ok',
      detail: noCheckbox.length
        ? `Форм, которые собирают персональные данные без чекбокса согласия: ${noCheckbox.length}.`
        : `Во всех найденных формах сбора ПДн (${pdForms}) есть чекбокс согласия.`,
      evidence: noCheckbox[0],
    });
  } else {
    factors.push({
      name: 'Формы сбора персональных данных',
      vote: nothingFound(s),
      detail: canProveAbsence(s)
        ? 'Форм сбора персональных данных на осмотренных страницах не найдено, сайт обойдён полностью.'
        : absenceUnknownReason(s),
    });
  }

  factors.push({
    name: 'Сохранение факта согласия на стороне сервера',
    vote: 'unknown',
    detail:
      'Доказать наличие согласия обязан оператор. Сохраняется ли факт согласия в базе — по внешнему виду сайта не определяется.',
  });

  const verdict = byPresence(factors);

  return {
    factors,
    verdict,
    summary: preChecked.length
      ? `В формах есть чекбоксы согласия, отмеченные по умолчанию (найдено: ${preChecked.length}). Заранее проставленная галочка не является согласием: посетитель не совершал действия.`
      : noCheckbox.length
        ? `Формы собирают персональные данные без чекбокса согласия (найдено форм: ${noCheckbox.length}). Обработка ведётся без согласия в письменной форме.`
        : pdForms === 0
          ? `Форм сбора персональных данных не найдено. ${
              canProveAbsence(s)
                ? 'Сайт обойдён полностью, поэтому вывод достоверен. Сохранение факта согласия всё равно определить нельзя: по внешнему виду сайта оно не видно.'
                : absenceUnknownReason(s)
            }`
          : `Во всех найденных формах сбора персональных данных (${pdForms}) есть чекбокс согласия. Сохранение факта согласия требует ручной проверки: по внешнему виду сайта оно не определяется.`,
  };
}

/** 8. Рассылки: описаны в целях Политики, информационная и рекламная — раздельно. */
function check8(s: SiteSnapshot): CheckResult {
  const raw = s.pages.map((p) => p.text).join(' ').toLowerCase();
  const policy = findDocPage(s, ['policy', 'privacy', 'konfidencial', 'политика конфиденциальн', 'персональных данных']);

  const hasSubscribe =
    /подпис(ка|аться|ку)|рассылк|новостей на почту|subscribe/.test(raw) ||
    s.pages.some((p) => /name=["'][^"']*subscribe/i.test(p.html));

  const factors: Factor[] = [];

  if (!hasSubscribe) {
    factors.push({
      name: 'Наличие подписки или рассылки на сайте',
      vote: nothingFound(s),
      detail: canProveAbsence(s)
        ? 'Форм подписки и упоминаний рассылки на сайте не найдено — требование к целям рассылки неприменимо.'
        : absenceUnknownReason(s),
    });
    return {
      factors,
      verdict: canProveAbsence(s) ? 'ok' : 'manual',
      summary: canProveAbsence(s)
        ? 'Подписки и рассылки на сайте не обнаружено — требование неприменимо.'
        : absenceUnknownReason(s),
    };
  }

  factors.push({
    name: 'Наличие подписки или рассылки на сайте',
    vote: 'ok',
    detail: 'На сайте есть подписка или упоминание рассылки — значит, цели рассылки должны быть описаны в Политике.',
  });

  if (!policy) {
    factors.push({
      name: 'Цели рассылки в Политике',
      vote: 'unknown',
      detail: 'Текст Политики не удалось скачать — проверить описание целей рассылки нельзя.',
    });
  } else {
    const t = policy.text.toLowerCase();
    // \w* та же находка №6: «информационные сообщения» без \w* не матчилась —
    // после «информационн» перед пробелом всегда кириллическое окончание.
    const mentionsMailing = /рассылк|информационн[а-яё]* сообщени/.test(t);
    const separates = /рекламн/.test(t) && /информационн/.test(t);
    factors.push({
      name: 'Рассылка описана в целях Политики',
      vote: mentionsMailing ? 'ok' : 'violation',
      detail: mentionsMailing
        ? 'В Политике есть описание рассылки среди целей обработки.'
        : 'На сайте есть подписка, но в Политике рассылка среди целей обработки не описана.',
      evidence: mentionsMailing ? undefined : { url: policy.url, snippet: snip(policy.text, 280) },
    });
    factors.push({
      name: 'Информационная и рекламная рассылка разделены',
      vote: separates ? 'ok' : 'unknown',
      detail: separates
        ? 'В Политике различаются информационная и рекламная рассылки.'
        : 'Разделение информационной и рекламной рассылки по тексту Политики однозначно не читается — нужна ручная проверка юристом.',
    });
  }

  const verdict = byPresence(factors);

  return {
    factors,
    verdict,
    // Утверждаем что-то про текст Политики — значит, обязаны дать её открыть.
    doc: policy ? { url: policy.url, label: 'Политика — раздел с целями обработки' } : undefined,
    summary:
      verdict === 'violation'
        ? 'На сайте есть подписка, но в Политике рассылка не описана среди целей обработки. Рекламная рассылка без согласия — отдельный состав по закону о рекламе. Политику, которую мы прочитали, можно открыть по ссылке ниже и проверить.'
        : 'Рассылка упомянута в Политике. Разделение информационной и рекламной рассылки требует ручной проверки.',
  };
}

/** 9 и 10 — по внешнему виду сайта не определяются (PRD §5.2). */
function manualCheck(check: Check): CheckResult {
  return {
    factors: [
      {
        name: 'Автоматическая проверка неприменима',
        vote: 'unknown',
        detail: check.manualReason ?? 'Пункт проверяется вручную.',
      },
    ],
    verdict: 'manual',
    summary: check.manualReason ?? 'Пункт требует ручной проверки.',
  };
}

/* ────────────────────────── сборка ────────────────────────── */

/** Вес нарушения для отбора топ-3 в письмо: чем крупнее санкция, тем выше. */
const SEVERITY: Record<number, number> = {
  7: 100, // 300–700 тыс ₽ — обработка без согласия
  2: 90, // экстремистская символика
  1: 80, // данные за границу
  3: 70, // 30–60 тыс ₽ — нет Политики
  4: 60,
  6: 50,
  8: 40,
  5: 30,
  9: 20,
  10: 10,
};

const RUNNERS: Record<number, (s: SiteSnapshot) => CheckResult> = {
  1: check1,
  2: check2,
  3: check3,
  4: check4,
  5: check5,
  6: check6,
  7: check7,
  8: check8,
};

export function runChecks(snapshot: SiteSnapshot): Finding[] {
  return CHECKS.map((check) => {
    const runner = RUNNERS[check.id];
    const result = runner ? runner(snapshot) : manualCheck(check);
    const evidence = result.factors
      .map((f) => f.evidence)
      .filter((e): e is Evidence => Boolean(e));

    return {
      checkId: check.id,
      // В отчёте — нейтральное имя предмета: факт сообщает вердикт, а не заголовок.
      title: subjectOf(check),
      what: check.what,
      verdict: result.verdict,
      method: check.method,
      norms: check.norms,
      summary: result.summary,
      factors: result.factors,
      evidence,
      doc: result.doc,
      severity: SEVERITY[check.id] ?? 0,
    };
  });
}

import * as cheerio from 'cheerio';

/** Больше этого не разбираем: каркас виден задолго до конца документа, а
 *  разбор мегабайтной страницы стоит секунду. Обрезка — единственное, что
 *  реально ограничивает стоимость: селектор всё равно проходит документ. */
const MAX_HTML = 300_000;

/**
 * Отпечаток каркаса страницы: набор элементов вёрстки, из которых она сложена.
 *
 * Нужен, чтобы не качать 3000 одинаковых карточек товара: страницы с одним
 * отпечатком считаются однотипными, и с каждой группы берётся несколько
 * представителей. Текст игнорируется — он у карточек разный, а каркас один.
 *
 * Правило «схлопывания редких»: если пара (тег, первый класс) встретилась на
 * странице 2 и более раз — это часть каркаса, кладём `tag.class`. Если один
 * раз — это может быть необязательное украшение, кладём только `tag`.
 *
 * Так единичный `span.discount-badge` схлопывается в `span`, который на
 * карточке и так есть, и бейдж «Скидка» не рвёт совпадение однотипных
 * карточек. При этом повторяющиеся элементы (`li.menu__item` × 450) класс
 * сохраняют и продолжают различать типы страниц.
 *
 * Отпечаток — МНОЖЕСТВО ключей: ни порядок, ни счётчики не учитываются, иначе
 * один лишний блок сдвигает всё и ломает группировку.
 */
export function templateFingerprint(html: string): string {
  const $ = cheerio.load((html ?? '').slice(0, MAX_HTML));
  $('script, style, noscript, svg').remove();

  const raw = new Map<string, { tag: string; cls: string; count: number }>();
  $('*').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? '';
    const cls = ($(el).attr('class') ?? '').trim().split(/\s+/)[0] ?? '';
    const key = `${tag} ${cls}`;
    const entry = raw.get(key);
    if (entry) entry.count++;
    else raw.set(key, { tag, cls, count: 1 });
  });

  const keys = new Set<string>();
  for (const { tag, cls, count } of raw.values()) {
    keys.add(count >= 2 && cls ? `${tag}.${cls}` : tag);
  }

  return hash([...keys].sort().join('|'));
}

/** djb2 — короткий стабильный хеш, криптостойкость здесь не нужна. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

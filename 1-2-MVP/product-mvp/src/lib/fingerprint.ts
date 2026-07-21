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

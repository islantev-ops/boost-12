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

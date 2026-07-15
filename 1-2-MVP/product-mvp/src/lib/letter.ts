import { NORMS } from './legal';
import type { Finding, SiteSnapshot } from './types';

/**
 * Холодное письмо владельцу сайта. PRD §5.4: только топ-3 самых сильных
 * ПОДТВЕРЖДЁННЫХ нарушения, по каждому — конкретный риск и штраф со ссылкой
 * на первоисточник. Пункты «требует ручной проверки» в письмо не попадают:
 * заявлять непроверенное нельзя.
 */

export function topViolations(findings: Finding[], limit = 3): Finding[] {
  return findings
    .filter((f) => f.verdict === 'violation')
    .sort((a, b) => b.severity - a.severity)
    .slice(0, limit);
}

function fineLine(finding: Finding): string {
  const withFine = finding.norms.map((k) => NORMS[k]).find((n) => 'fine' in n && n.fine);
  const norm = withFine ?? NORMS[finding.norms[0]];
  const fine = withFine && 'fine' in withFine ? ` Штраф юрлицу — ${withFine.fine}.` : '';
  return `${fine} Норма: ${norm.label} — ${norm.url}`;
}

export function buildLetter(snapshot: SiteSnapshot, findings: Finding[]) {
  const top = topViolations(findings);
  const host = safeHost(snapshot.finalUrl);

  const subject = top.length
    ? `${host}: нашли ${top.length} ${plural(top.length, 'нарушение', 'нарушения', 'нарушений')} закона о персональных данных`
    : `${host}: результаты проверки сайта`;

  if (!top.length) return { subject, body: '' };

  const blocks = top
    .map((f, i) => `${i + 1}. ${f.title}\n${f.summary}\n${fineLine(f).trim()}`)
    .join('\n\n');

  const cmsLine =
    snapshot.cms === 'bitrix'
      ? 'Мы занимаемся поддержкой сайтов на 1С-Битрикс и такие вещи правим под ключ.'
      : 'Мы занимаемся поддержкой сайтов и такие вещи правим под ключ.';

  const body = `Здравствуйте!

Проверили ваш сайт ${host} на соответствие требованиям закона о персональных данных. Нашли то, за что сейчас штрафует Роскомнадзор. Показываю самое существенное:

${blocks}

По каждому пункту у нас есть фрагмент кода вашего сайта, где видно проблему, — можете перепроверить сами. Полный отчёт со всеми пунктами приложу, если интересно.

${cmsLine} Если хотите, пришлю разбор целиком и скажу, сколько займёт устранение.

С уважением,
[ваше имя]`;

  return { subject, body };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

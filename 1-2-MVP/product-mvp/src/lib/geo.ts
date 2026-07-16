import { resolve4 as dnsResolve4 } from 'node:dns/promises';
import type { HostingFact } from './types';

const TIMEOUT_MS = 12_000;

/**
 * Сколько A-записей проверяем через RDAP. Домен с гео-балансировкой или
 * резервом может отдавать несколько адресов, и дизайн (§6) требует проверить
 * все, а не только первый. Ограничиваемся первыми четырьмя — иначе время
 * аудита растёт линейно от числа записей, а сайт с 5+ по-настоящему разными
 * адресами — редкость, для которой и так нужна ручная проверка.
 */
const MAX_IPS_CHECKED = 4;

/**
 * Подстроки в имени сети RDAP, по которым опознаём CDN. За CDN настоящий
 * хостинг не виден: адрес принадлежит посреднику, а не сайту.
 *
 * Сравнение — по вхождению подстроки, а не точным равенством. Прогон всех 15
 * опубликованных диапазонов Cloudflare показал разные имена сети:
 * CLOUDFLARENET, CLOUDFLARENET-EU (141.101.64.0/18, 188.114.96.0/20),
 * CLOUDFLARE_103_21_244_0 и подобные (103.21.244.0/22, 103.22.200.0/22,
 * 103.31.4.0/22). При точном равенстве 8 из 15 диапазонов проходили как
 * «нарушение» — ложное обвинение российского сайта за Cloudflare.
 *
 * Тот же список используется и для поля connection.org в ответе ipwho.is —
 * это подстраховка для диапазонов без имени сети в RDAP вовсе (проверено на
 * 197.234.240.0/22).
 *
 * Список пополняется ТОЛЬКО по факту встречи, не по памяти. Но здесь опаснее
 * пропущенная запись (здоровый сайт → ложное обвинение), чем лишняя (здоровый
 * сайт → «вручную») — при сомнении добавляем.
 */
export const CDN_NETNAMES = ['CLOUDFLARE'];

function matchesCdn(text: string | null | undefined): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return CDN_NETNAMES.some((n) => upper.includes(n));
}

/** Сеть и DNS вынесены в зависимости — иначе проверку не протестировать. */
export type GeoDeps = {
  resolve4(host: string): Promise<string[]>;
  fetchJson(url: string, accept: string): Promise<unknown | null>;
};

async function fetchJson(url: string, accept: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: accept },
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

/**
 * Media type для RDAP по стандарту (RFC 7483) — `application/json` не
 * годится. LACNIC отвечает по нему 406 Not Acceptable: проверено на
 * 190.93.240.1 и 200.7.84.1, с `application/rdap+json` тот же адрес отдаёт
 * 200. ipwho.is — обычный JSON-эндпоинт, ему нужен обычный заголовок.
 */
const RDAP_ACCEPT = 'application/rdap+json';
const JSON_ACCEPT = 'application/json';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

type RdapAnswer = { country?: unknown; name?: unknown };

async function lookupRdap(deps: GeoDeps, ip: string) {
  const rdap = (await deps.fetchJson(`https://rdap.org/ip/${ip}`, RDAP_ACCEPT)) as RdapAnswer | null;
  return {
    responded: Boolean(rdap),
    country: rdap ? str(rdap.country)?.toUpperCase() ?? null : null,
    netname: rdap ? str(rdap.name)?.toUpperCase() ?? null : null,
  };
}

/**
 * Где стоит сайт.
 *
 * Несколько A-записей (гео-балансировка, резерв) — проверяем первые
 * MAX_IPS_CHECKED (§6). Три исхода:
 *  1. Все проверенные адреса RDAP подтвердил как RU — «RU» без второго
 *     источника, RDAP тут и есть первоисточник.
 *  2. Хотя бы один (но не все) проверенный адрес RDAP подтвердил как RU —
 *     это намёк на Россию, и по спеке §4.2 «любой намёк на Россию снимает
 *     обвинение». Дальше не идём и второй источник не спрашиваем: раньше
 *     код либо игнорировал такой намёк, либо (при отсутствии явно
 *     нероссийского адреса) по умолчанию выбирал представителем именно этот
 *     RU-адрес и выносил «ok» — то есть обвинение снималось, но на его место
 *     вставало непроверенное оправдание. Правильный итог — «не знаем», а не
 *     «RU» и не «не RU» (регресс из финального ревью, CRITICAL и IMPORTANT 2).
 *  3. Ни одного намёка на RU — ищем представителя (явно нероссийская страна,
 *     иначе первый проверенный адрес) и подтверждаем вторым источником.
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

  // Дальше и в отчёте, и в решении используются ТОЛЬКО реально проверенные
  // адреса (checked), а не полный список DNS — иначе в отчёт попадают
  // адреса, про которые RDAP вообще не спрашивали (регресс, IMPORTANT 1).
  const checked = ips.slice(0, MAX_IPS_CHECKED);
  const perIp = await Promise.all(checked.map((ip) => lookupRdap(deps, ip)));

  const cdnHit = perIp.find((r) => matchesCdn(r.netname));
  if (cdnHit) {
    // netname взялся из ответа RDAP — значит, RDAP по этому адресу ответил.
    // За CDN спрашивать гео бессмысленно: ответят про узел CDN, а не про сайт.
    return { ips: checked, country: null, netname: cdnHit.netname, geoCountry: null, isCdn: true, confirmedBy: ['rdap'] };
  }

  const allRu = perIp.length > 0 && perIp.every((r) => r.country === 'RU');
  if (allRu) {
    // Имя сети берём у первого адреса, у которого оно вообще есть, а не
    // жёстко у perIp[0] — иначе при пустом name у первого DNS-адреса в отчёт
    // уходит netname: null, хотя сосед по тому же вердикту его назвал.
    const netname = perIp.find((r) => r.netname)?.netname ?? null;
    return { ips: checked, country: 'RU', netname, geoCountry: null, isCdn: false, confirmedBy: ['rdap'] };
  }

  const ruHint = perIp.some((r) => r.country === 'RU');
  if (ruHint) {
    return { ips: checked, country: null, netname: null, geoCountry: null, isCdn: false, confirmedBy: ['rdap'] };
  }

  // Ни одного намёка на RU. Берём представителем для проверки вторым
  // источником: приоритет — явно нероссийской стране (её и нужно подтвердить),
  // иначе первому проверенному адресу (RDAP промолчал или не назвал страну,
  // как у ARIN).
  const flaggedIdx = perIp.findIndex((r) => r.country && r.country !== 'RU');
  const idx = flaggedIdx >= 0 ? flaggedIdx : 0;
  const flagged = perIp[idx];
  const flaggedIp = checked[idx];

  // confirmedBy обязан отражать, ответил ли RDAP именно про ЭТОТ (флагованный,
  // обвиняемый) адрес, а не про любой из проверенных — иначе защита в
  // checks.ts (confirmedBy.includes('rdap')) пропускает вердикт по адресу,
  // о котором RDAP ничего не сказал, лишь потому что RDAP ответил про
  // соседний IP (регресс, CRITICAL).
  const confirmedBy: string[] = [];
  if (flagged.responded) confirmedBy.push('rdap');

  // Правка от 2026-07-16 (спека §4.2, упрощённое правило): если RDAP ответил,
  // но страну не назвал, hostingFactor теперь ВСЕГДА отдаёт unknown — второй
  // источник обвинять в одиночку не вправе (ARIN-случай практически не
  // встречается в целевом сегменте, см. дизайн-документ). Поэтому спрашивать
  // ipwho.is ради страны в этом случае бессмысленно.
  //
  // Исключение — диапазон вовсе БЕЗ имени сети: netname-проверка CDN выше его
  // не увидела, и единственный способ распознать CDN на таком адресе —
  // сигнал connection.org из ЭТОГО ЖЕ ответа ipwho.is (спека §4.2, п.2, живой
  // пример 197.234.240.0/22). Если имя сети есть — CDN по нему уже проверили
  // выше (cdnHit) и не признали, а больше сигналу connection.org взяться
  // неоткуда: сеть с точным именем в RDAP лишним запросом не проверяем.
  const geoUseless = flagged.responded && !flagged.country && Boolean(flagged.netname);

  let geoCountry: string | null = null;
  let isCdn = false;
  if (!geoUseless) {
    const geo = (await deps.fetchJson(`https://ipwho.is/${flaggedIp}`, JSON_ACCEPT)) as
      | { success?: unknown; country_code?: unknown; connection?: { org?: unknown } }
      | null;
    const geoOk = Boolean(geo && geo.success === true);
    geoCountry = geoOk ? str(geo!.country_code)?.toUpperCase() ?? null : null;
    if (geoCountry) confirmedBy.push('ipwho.is');

    // Диапазон без имени сети в RDAP выдаёт себя через connection.org в ipwho.is.
    const org = geoOk ? str((geo as { connection?: { org?: unknown } }).connection?.org) : null;
    isCdn = matchesCdn(org);
  }

  return { ips: checked, country: flagged.country, netname: flagged.netname, geoCountry, isCdn, confirmedBy };
}

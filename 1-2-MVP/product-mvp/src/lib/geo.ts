import { resolve4 as dnsResolve4 } from 'node:dns/promises';
import type { HostingFact } from './types';

const TIMEOUT_MS = 12_000;

/**
 * Имена сетей CDN по данным RDAP. За CDN настоящий хостинг не виден: адрес
 * принадлежит посреднику, а не сайту.
 *
 * Список пополняется ТОЛЬКО по факту встречи, не по памяти: лишняя запись
 * уводит здоровый сайт в «вручную». CLOUDFLARENET проверен на 104.16.132.229.
 */
export const CDN_NETNAMES = ['CLOUDFLARENET'];

/** Сеть и DNS вынесены в зависимости — иначе проверку не протестировать. */
export type GeoDeps = {
  resolve4(host: string): Promise<string[]>;
  fetchJson(url: string): Promise<unknown | null>;
};

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
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

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Где стоит сайт.
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

  const confirmedBy: string[] = [];
  const rdap = (await deps.fetchJson(`https://rdap.org/ip/${ips[0]}`)) as
    | { country?: unknown; name?: unknown }
    | null;
  if (rdap) confirmedBy.push('rdap');

  const country = rdap ? str(rdap.country)?.toUpperCase() ?? null : null;
  const netname = rdap ? str(rdap.name)?.toUpperCase() ?? null : null;
  const isCdn = Boolean(netname && CDN_NETNAMES.includes(netname));

  // За CDN спрашивать гео бессмысленно: ответят про узел CDN, а не про сайт.
  // Российский адрес подтверждать нечем: RDAP тут и есть первоисточник.
  if (isCdn || country === 'RU') {
    return { ips, country, netname, geoCountry: null, isCdn, confirmedBy };
  }

  const geo = (await deps.fetchJson(`https://ipwho.is/${ips[0]}`)) as
    | { success?: unknown; country_code?: unknown }
    | null;
  const geoOk = Boolean(geo && geo.success === true);
  const geoCountry = geoOk ? str(geo!.country_code)?.toUpperCase() ?? null : null;
  if (geoCountry) confirmedBy.push('ipwho.is');

  return { ips, country, netname, geoCountry, isCdn, confirmedBy };
}

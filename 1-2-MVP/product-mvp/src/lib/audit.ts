import { findAnglicisms } from './anglicisms';
import { runChecks } from './checks';
import { crawlSite } from './crawl';
import { resolveHosting } from './geo';
import type { AuditResult } from './types';

/** Вставил ссылку → аудит → перепроверка. PRD §5.1–5.3. */
export async function auditSite(url: string): Promise<AuditResult> {
  const crawled = await crawlSite(url);

  if (!crawled.reachable) {
    return { snapshot: crawled, findings: [], anglicisms: [] };
  }

  // Краул знает про страницы, geo — про сеть. Склеиваем здесь, чтобы ни один
  // из них не знал про другого.
  const snapshot = { ...crawled, hosting: await resolveHosting(crawled.finalUrl) };

  return {
    snapshot,
    findings: runChecks(snapshot),
    anglicisms: findAnglicisms(snapshot),
  };
}

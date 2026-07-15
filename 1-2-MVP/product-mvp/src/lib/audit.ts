import { findAnglicisms } from './anglicisms';
import { runChecks } from './checks';
import { crawlSite } from './crawl';
import type { AuditResult } from './types';

/** Вставил ссылку → аудит → перепроверка. PRD §5.1–5.3. */
export async function auditSite(url: string): Promise<AuditResult> {
  const snapshot = await crawlSite(url);

  if (!snapshot.reachable) {
    return { snapshot, findings: [], anglicisms: [] };
  }

  return {
    snapshot,
    findings: runChecks(snapshot),
    anglicisms: findAnglicisms(snapshot),
  };
}

import { findAnglicisms } from './anglicisms';
import { runChecks } from './checks';
import { crawlSite } from './crawl';
import { failStaleAudits, finishAudit, setAuditStatus } from './db';
import { resolveHosting } from './geo';

/**
 * Очередь аудитов: строго по одному одновременно.
 *
 * Причина жёсткая: на сервере 2 ГБ памяти, а Chromium ест 200–500 МБ на
 * вкладку. Два параллельных аудита кладут сервер вместе с базой.
 */
const waiting: { id: number; url: string }[] = [];
let running = false;

export function enqueueAudit(id: number, url: string): void {
  waiting.push({ id, url });
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  const job = waiting.shift();
  if (!job) return;
  running = true;
  try {
    await runAudit(job.id, job.url);
  } catch (e) {
    await setAuditStatus(job.id, 'failed', {
      error: `Проверка не выполнена: ${e instanceof Error ? e.message : String(e)}`,
    }).catch(() => {});
  } finally {
    running = false;
    void pump();
  }
}

async function runAudit(id: number, url: string): Promise<void> {
  await setAuditStatus(id, 'crawling', { pagesCrawled: 0 });

  const snapshot = await crawlSite(url, (crawled, currentUrl) => {
    void setAuditStatus(id, 'crawling', { pagesCrawled: crawled, currentUrl }).catch(() => {});
  });

  if (!snapshot.reachable || snapshot.blockedByAntibot) {
    await finishAudit(id, { snapshot, findings: [], anglicisms: [] });
    return;
  }

  await setAuditStatus(id, 'checking');
  const withHosting = { ...snapshot, hosting: await resolveHosting(snapshot.finalUrl) };
  await finishAudit(id, {
    snapshot: withHosting,
    findings: runChecks(withHosting),
    anglicisms: findAnglicisms(withHosting),
  });
}

/**
 * Перезапуск pm2 посреди работы оставил бы аудиты висеть в «идёт проверка».
 * Помечаем их прерванными при старте — молчаливо зависших быть не должно.
 */
let recovered = false;
export async function recoverOnce(): Promise<void> {
  if (recovered) return;
  recovered = true;
  await failStaleAudits().catch(() => {});
}

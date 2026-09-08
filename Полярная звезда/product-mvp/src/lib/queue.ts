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

/**
 * Один аудит идёт минуты; двадцать в очереди — это уже около часа ожидания.
 * Больше ставить бессмысленно: пользователь не будет ждать дольше, и это
 * явный признак накрутки (например, сто нажатий «проверить» подряд).
 */
const MAX_WAITING = 20;

export function enqueueAudit(id: number, url: string): void {
  if (waiting.length >= MAX_WAITING) {
    // Запись в базе уже создана (createQueuedAudit) — молча выбросить задачу
    // нельзя, иначе она зависнет в статусе 'queued' навсегда. Честно
    // сообщаем пользователю, что делать: прийти позже.
    void setAuditStatus(id, 'failed', {
      error: `Очередь проверок переполнена: сейчас ожидают ${waiting.length} проверок. Запустите эту проверку позже.`,
    }).catch(() => {});
    return;
  }
  waiting.push({ id, url });
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  // `running` ставим синхронно, ДО первого await. Если бы уборка (await ниже)
  // шла раньше этой строки, два конкурентных вызова pump() (например, из
  // enqueueAudit и из finally предыдущего цикла) оба прошли бы проверку
  // `if (running) return` — running ещё false — и потом оба продолжили бы
  // после await, запустив два аудита разом. Это как раз то, что запрещено
  // (Chromium x2 кладёт сервер на 2 ГБ). Установка флага синхронно исключает
  // такую гонку: вторая копия pump() уже увидит running === true.
  running = true;
  try {
    // Перед взятием новой задачи прибираем зависшие: это ловит аудиты, не
    // добитые падением базы в предыдущем цикле pump() (см. catch ниже), а
    // также любые другие «висяки» старше пяти минут. Раз в pump() это
    // происходит на каждый новый аудит — сборка мусора идёт попутно с обычной
    // работой, без отдельного планирования.
    await cleanupStaleAudits();

    const job = waiting.shift();
    if (!job) return;

    try {
      await runAudit(job.id, job.url);
    } catch (e) {
      await setAuditStatus(job.id, 'failed', {
        error: `Проверка не выполнена: ${e instanceof Error ? e.message : String(e)}`,
      }).catch(() => {});
    }
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
 * Единая точка уборки зависших аудитов — используется в трёх местах, каждое
 * ловит свой сценарий:
 *
 * 1. `recoverOnce()` — один раз при старте процесса: ловит аудиты, убитые
 *    перезапуском (pm2 перезапустил сервер посреди работы, статус остался
 *    висеть).
 * 2. Начало каждого `pump()` — ловит зависшие аудиты в обычной работе:
 *    например, если предыдущий цикл упал в `finishAudit` из-за отвалившейся
 *    базы, и повторная попытка `setAuditStatus(..., 'failed', ...)` в catch
 *    тоже упала в ту же мёртвую базу (её ошибка гасится `.catch(() => {})`).
 *    Тогда запись осталась в `checking` без пометки `failed` — следующий
 *    `pump()` её приберёт.
 * 3. Периодический таймер — ловит случай, когда сайт простаивает и новых
 *    аудитов нет вообще: без таймера уборка происходила бы только по
 *    событию (старт процесса или новая задача), и зависшая запись висела
 *    бы до следующего аудита, который может не случиться часами.
 *
 * Ошибки уборки не должны ронять процесс, но и не должны молча исчезать —
 * поэтому логируем, а не просто глушим.
 */
async function cleanupStaleAudits(): Promise<void> {
  try {
    await failStaleAudits();
  } catch (e) {
    console.error('cleanupStaleAudits: не удалось прибрать зависшие аудиты', e);
  }
}

let recovered = false;
export async function recoverOnce(): Promise<void> {
  if (recovered) return;
  recovered = true;
  await cleanupStaleAudits();
}

/**
 * Периодическая уборка на случай простоя (см. пункт 3 выше). `.unref()`
 * обязателен: иначе живой таймер держал бы event loop и не давал процессу
 * штатно завершиться (например, при `next build`/тестах, которые импортируют
 * этот модуль, но не рассчитывают на фоновые интервалы).
 *
 * Модульный кэш Node.js/ESM гарантирует однократное выполнение тела модуля
 * при повторных `import` — значит и `setInterval` регистрируется ровно один
 * раз за живой процесс, дублирования при повторном импорте не будет.
 */
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;
setInterval(() => {
  void cleanupStaleAudits();
}, CLEANUP_INTERVAL_MS).unref();

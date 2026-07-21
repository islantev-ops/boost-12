import { Pool } from 'pg';
import type { AuditResult, CrawlCoverage, DocRef, Evidence, Factor, Finding, Verdict } from './types';
import type { Method, NormKey } from './legal';
import { buildLetter } from './letter';
import { templateFingerprint } from './fingerprint';

/**
 * PostgreSQL живёт на VPS и слушает только localhost — наружу не открыт.
 * Поэтому DATABASE_URL с localhost корректен: приложение обращается к базе
 * с того же сервера. Локально (npm run dev) базы нет — это ожидаемо,
 * локальный запуск нужен только для проверки вёрстки.
 */

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL не задан');
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  }
  return pool;
}

/** База может быть недоступна (локальная разработка) — UI это переживает. */
export async function dbReady(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Разбирает id из адреса. `Number('abc')` даёт NaN, и Postgres роняет запрос
 * с ошибкой типа — снаружи это выглядело бы как «база недоступна», хотя база
 * жива, а адрес просто битый. Отсекаем такое до запроса.
 */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Значения обязаны точно совпадать с CHECK (status IN (...)) в schema.sql. */
export type AuditStatus = 'queued' | 'crawling' | 'checking' | 'done' | 'failed' | 'blocked';

export type AuditRow = {
  id: number;
  input_url: string;
  final_url: string;
  cms: string | null;
  reachable: boolean;
  error: string | null;
  client_rendered: boolean;
  blocked_by_antibot: boolean;
  demo: boolean;
  created_at: string;
  status: AuditStatus;
  pages_crawled: number;
  current_url: string | null;
  coverage: CrawlCoverage | null;
  /** Отметка живости фонового обхода: обновляется на каждом вызове setAuditStatus. */
  updated_at: string;
};

export type FindingRow = {
  id: number;
  audit_id: number;
  check_id: number;
  title: string;
  what: string;
  verdict: Verdict;
  method: Method;
  summary: string;
  norms: NormKey[];
  factors: Factor[];
  evidence: Evidence[];
  doc: DocRef | null;
  severity: number;
  edited: boolean;
};

export type LetterRow = {
  id: number;
  audit_id: number;
  subject: string;
  body: string;
  edited: boolean;
  updated_at: string;
};

export type AnglicismRow = {
  id: number;
  audit_id: number;
  word: string;
  suggestion: string;
  url: string;
  context: string;
};

export async function listAudits(): Promise<(AuditRow & { violations: number; manual: number })[]> {
  const { rows } = await getPool().query(
    `SELECT a.*,
            COUNT(f.id) FILTER (WHERE f.verdict = 'violation')::int AS violations,
            COUNT(f.id) FILTER (WHERE f.verdict = 'manual')::int    AS manual
     FROM audits a
     LEFT JOIN findings f ON f.audit_id = a.id
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
  );
  return rows;
}

export async function getAudit(id: number) {
  const client = await getPool().connect();
  try {
    const audit = await client.query<AuditRow>('SELECT * FROM audits WHERE id = $1', [id]);
    if (!audit.rows.length) return null;
    const findings = await client.query<FindingRow>(
      'SELECT * FROM findings WHERE audit_id = $1 ORDER BY check_id',
      [id],
    );
    const letter = await client.query<LetterRow>('SELECT * FROM letters WHERE audit_id = $1', [id]);
    const anglicisms = await client.query<AnglicismRow>(
      'SELECT * FROM anglicisms WHERE audit_id = $1 ORDER BY id LIMIT 200',
      [id],
    );
    return {
      audit: audit.rows[0],
      findings: findings.rows,
      letter: letter.rows[0] ?? null,
      anglicisms: anglicisms.rows,
    };
  } finally {
    client.release();
  }
}

/** Заводит запись до начала работы: клиент сразу получает id и следит за прогрессом. */
export async function createQueuedAudit(inputUrl: string): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO audits (input_url, final_url, cms, reachable, client_rendered, status)
     VALUES ($1, $1, NULL, true, false, 'queued') RETURNING id`,
    [inputUrl],
  );
  return rows[0].id;
}

/**
 * Обход дёргает эту функцию на каждой странице — поэтому заодно освежаем
 * `updated_at`: это единственная отметка живости фонового аудита, по которой
 * `failStaleAudits` отличает реально зависший процесс от ещё работающего.
 */
export async function setAuditStatus(
  id: number,
  status: AuditStatus,
  patch: { pagesCrawled?: number; currentUrl?: string | null; error?: string | null } = {},
): Promise<void> {
  await getPool().query(
    `UPDATE audits SET status = $2,
       pages_crawled = COALESCE($3, pages_crawled),
       current_url   = COALESCE($4, current_url),
       error         = COALESCE($5, error),
       updated_at    = NOW()
     WHERE id = $1`,
    [id, status, patch.pagesCrawled ?? null, patch.currentUrl ?? null, patch.error ?? null],
  );
}

export async function getAuditStatus(id: number) {
  const { rows } = await getPool().query<{ status: string; pages_crawled: number; current_url: string | null }>(
    'SELECT status, pages_crawled, current_url FROM audits WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Перезапуск сервера посреди аудита оставил бы задачу висеть в «crawling»
 * навсегда. Помечаем такие честно — «прервано», а не делаем вид, что работа идёт.
 *
 * Статус сам по себе не отличает зависший процесс от работающего: при
 * перезапуске pm2 внахлёст (старый процесс ещё доживает, новый уже стартовал)
 * реально живой аудит тоже имеет один из этих статусов. Поэтому дополнительно
 * проверяем отметку живости `updated_at` — обход обновляет её на каждой
 * странице (пауза между страницами 500 мс плюс загрузка), то есть живой
 * аудит освежает её минимум раз в несколько секунд. Порог в пять минут даёт
 * большой запас и трогает только записи, по которым правда никто не отчитывался.
 */
const STALE_AUDIT_THRESHOLD = '5 minutes';

export async function failStaleAudits(): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE audits SET status = 'failed',
       error = COALESCE(error, 'Проверка прервана перезапуском сервера. Запустите её заново.')
     WHERE status IN ('queued','crawling','checking')
       AND updated_at < NOW() - $1::interval`,
    [STALE_AUDIT_THRESHOLD],
  );
  return rowCount ?? 0;
}

/** Сохраняет результат аудита целиком: аудит + находки + письмо + англицизмы. */
export async function saveAudit(result: AuditResult): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { snapshot, findings, anglicisms } = result;
    const audit = await client.query<{ id: number }>(
      `INSERT INTO audits (input_url, final_url, cms, reachable, error, client_rendered, blocked_by_antibot)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        snapshot.inputUrl,
        snapshot.finalUrl,
        snapshot.cms,
        snapshot.reachable,
        snapshot.error ?? null,
        snapshot.clientRendered,
        snapshot.blockedByAntibot,
      ],
    );
    const auditId = audit.rows[0].id;

    for (const f of findings) {
      await client.query(
        `INSERT INTO findings
           (audit_id, check_id, title, what, verdict, method, summary, norms, factors, evidence, doc, severity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          auditId,
          f.checkId,
          f.title,
          f.what,
          f.verdict,
          f.method,
          f.summary,
          JSON.stringify(f.norms),
          JSON.stringify(f.factors),
          JSON.stringify(f.evidence),
          f.doc ? JSON.stringify(f.doc) : null,
          f.severity,
        ],
      );
    }

    // Нет подтверждённых нарушений — письма нет (PRD §7: не о чем писать).
    const { subject, body } = buildLetter(snapshot, findings);
    if (body) {
      await client.query('INSERT INTO letters (audit_id, subject, body) VALUES ($1, $2, $3)', [
        auditId,
        subject,
        body,
      ]);
    }

    for (const a of anglicisms.slice(0, 200)) {
      await client.query(
        'INSERT INTO anglicisms (audit_id, word, suggestion, url, context) VALUES ($1,$2,$3,$4,$5)',
        [auditId, a.word, a.suggestion, a.url, a.context],
      );
    }

    await client.query('COMMIT');
    return auditId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Дописывает результат в уже заведённую запись (её id клиент получил сразу).
 * Страницы сохраняем целиком: без них аудит невоспроизводим.
 */
export async function finishAudit(id: number, result: AuditResult): Promise<void> {
  const { snapshot, findings, anglicisms } = result;

  // Отпечаток — синхронный разбор HTML через cheerio, до нескольких сотен мс
  // на страницу (см. комментарий в fingerprint.ts). Считаем его ДО открытия
  // транзакции: внутри BEGIN...COMMIT это держало бы соединение занятым и
  // блокировало событийный цикл на весь цикл по 300 страницам.
  const pagesWithHash = snapshot.pages.map((p) => ({ page: p, hash: templateFingerprint(p.html) }));

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE audits SET final_url = $2, cms = $3, reachable = $4, error = $5,
         client_rendered = $6, blocked_by_antibot = $7, coverage = $8,
         pages_crawled = $9, current_url = NULL,
         status = CASE WHEN $7 THEN 'blocked' ELSE 'done' END
       WHERE id = $1`,
      [
        id, snapshot.finalUrl, snapshot.cms, snapshot.reachable, snapshot.error ?? null,
        snapshot.clientRendered, snapshot.blockedByAntibot,
        JSON.stringify(snapshot.coverage), snapshot.coverage.crawled,
      ],
    );

    for (const { page: p, hash } of pagesWithHash) {
      await client.query(
        'INSERT INTO pages (audit_id, url, status, html, text, template_hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, p.url, p.status, p.html, p.text, hash],
      );
    }

    for (const f of findings) {
      await client.query(
        `INSERT INTO findings
           (audit_id, check_id, title, what, verdict, method, summary, norms, factors, evidence, doc, severity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id, f.checkId, f.title, f.what, f.verdict, f.method, f.summary,
          JSON.stringify(f.norms), JSON.stringify(f.factors), JSON.stringify(f.evidence),
          f.doc ? JSON.stringify(f.doc) : null, f.severity,
        ],
      );
    }

    const { subject, body } = buildLetter(snapshot, findings);
    if (body) {
      await client.query('INSERT INTO letters (audit_id, subject, body) VALUES ($1, $2, $3)', [id, subject, body]);
    }

    for (const a of anglicisms.slice(0, 200)) {
      await client.query(
        'INSERT INTO anglicisms (audit_id, word, suggestion, url, context) VALUES ($1,$2,$3,$4,$5)',
        [id, a.word, a.suggestion, a.url, a.context],
      );
    }

    // Копии страниц тяжёлые и нужны недолго. Удаляем только их и только у
    // старых аудитов — сами аудиты, находки и письма не трогаем НИКОГДА.
    //
    // `audit_id <> $1` исключает ТЕКУЩИЙ аудит явно, а не только через
    // ранжирование в подзапросе. Обход идёт минуты, и пока этот аудит
    // работал, через createQueuedAudit могло появиться 20+ новых записей с
    // более высокими id. Тогда по «ORDER BY id DESC OFFSET 20» текущий аудит
    // уже не входит в топ-20 — без явного исключения DELETE вычистил бы
    // страницы, вставленные несколькими строками выше в этой же транзакции,
    // и аудит завершился бы как 'done', но без своих страниц.
    await client.query(
      `DELETE FROM pages WHERE audit_id <> $1 AND audit_id IN (
         SELECT id FROM audits ORDER BY id DESC OFFSET 20
       )`,
      [id],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** PRD §7: ложное срабатывание можно поправить руками перед отправкой. */
export async function updateFinding(id: number, patch: { verdict?: Verdict; summary?: string }) {
  const { rows } = await getPool().query<FindingRow>(
    `UPDATE findings
     SET verdict = COALESCE($2, verdict),
         summary = COALESCE($3, summary),
         edited  = true
     WHERE id = $1 RETURNING *`,
    [id, patch.verdict ?? null, patch.summary ?? null],
  );
  return rows[0] ?? null;
}

export async function updateLetter(auditId: number, patch: { subject?: string; body?: string }) {
  const { rows } = await getPool().query<LetterRow>(
    `UPDATE letters
     SET subject = COALESCE($2, subject),
         body = COALESCE($3, body),
         edited = true,
         updated_at = NOW()
     WHERE audit_id = $1 RETURNING *`,
    [auditId, patch.subject ?? null, patch.body ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteAudit(id: number): Promise<boolean> {
  const { rowCount } = await getPool().query('DELETE FROM audits WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export function rowToFinding(r: FindingRow): Finding {
  return {
    checkId: r.check_id,
    title: r.title,
    what: r.what,
    verdict: r.verdict,
    method: r.method,
    norms: r.norms,
    summary: r.summary,
    factors: r.factors,
    evidence: r.evidence,
    doc: r.doc ?? undefined,
    severity: r.severity,
  };
}

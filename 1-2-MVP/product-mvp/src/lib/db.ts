import { Pool } from 'pg';
import type { AuditResult, DocRef, Evidence, Factor, Finding, Verdict } from './types';
import type { Method, NormKey } from './legal';
import { buildLetter } from './letter';

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

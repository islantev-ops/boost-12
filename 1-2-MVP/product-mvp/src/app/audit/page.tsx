import Link from 'next/link';
import AuditForm from '@/components/AuditForm';
import { listAudits, type AuditRow } from '@/lib/db';
import { CHECKS, FINES, CONSULTANT_NOTE, NORMS } from '@/lib/legal';

export const dynamic = 'force-dynamic';

type Row = AuditRow & { violations: number; manual: number };

/**
 * `?url=` приходит с лендинга: посетитель вставил ссылку там, и проверка
 * должна начаться сама — второй раз просить его вводить то же самое незачем.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const { url } = await searchParams;
  const fromLanding = Array.isArray(url) ? url[0] : url;

  let audits: Row[] = [];
  let dbOffline = false;
  try {
    audits = await listAudits();
  } catch {
    dbOffline = true;
  }

  return (
    <div className="space-y-10">
      <section className="rime frost relative overflow-hidden px-6 py-8 sm:px-9 sm:py-11">
        <p className="text-caption font-semibold uppercase tracking-[0.18em] text-ice">
          Аудит по 10 пунктам чек-листа
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-extrabold leading-[1.12] tracking-tight sm:text-[40px]">
          Вставьте ссылку — получите доказательный аудит и готовое письмо
        </h1>
        <p className="mt-4 max-w-xl text-lead text-muted">
          Каждое нарушение подтверждается фрагментом кода с сайта. Что нельзя подтвердить
          однозначно — уходит в «требует ручной проверки», а не выдаётся за нарушение.
        </p>
        <div className="mt-7 max-w-xl">
          <AuditForm initialUrl={fromLanding} />
        </div>
      </section>

      {dbOffline && (
        <div className="frost frost-line px-5 py-4 text-body text-muted">
          <b className="text-gold">База недоступна.</b> PostgreSQL живёт на VPS и слушает только
          localhost — локально это ожидаемо. Вёрстку смотреть можно, аудиты сохраняются после
          деплоя.
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">История проверок</h2>
          <span className="text-caption text-faint">{audits.length} в базе</span>
        </div>

        {!audits.length && !dbOffline && (
          <div className="frost px-5 py-8 text-center text-body text-muted">
            Пока пусто. Вставьте ссылку выше — первый аудит появится здесь.
          </div>
        )}

        <div className="grid gap-3">
          {audits.map((a) => (
            <AuditCard key={a.id} audit={a} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Что проверяем</h2>
          <span className="text-caption text-faint">10 пунктов, ничего сверх</span>
        </div>
        <div className="frost divide-y divide-line overflow-hidden">
          {CHECKS.map((c) => (
            <div key={c.id} className="flex gap-4 px-5 py-4">
              <span className="mt-0.5 w-6 shrink-0 text-body font-bold tabular-nums text-ice">
                {String(c.id).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <b className="text-card font-semibold">{c.title}</b>
                  {c.method === 'manual' && (
                    <span className="rounded-full border border-line-2 px-2 py-0.5 text-caption uppercase tracking-wider text-faint">
                      только вручную
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-body text-muted">{c.what}</p>
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                  {c.norms.map((k) => (
                    <a
                      key={k}
                      href={NORMS[k].url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-caption text-ice underline decoration-ice/40 underline-offset-2 transition-colors hover:text-ice-strong"
                    >
                      {NORMS[k].label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Цена вопроса</h2>
        <div className="frost overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-body">
              <thead>
                <tr className="border-b border-line text-caption uppercase tracking-wider text-faint">
                  <th className="px-5 py-3.5 font-semibold">Нарушение</th>
                  <th className="px-5 py-3.5 font-semibold">Штраф юрлицу</th>
                  <th className="px-5 py-3.5 font-semibold">Норма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {FINES.map((f) => (
                  <tr key={f.violation}>
                    <td className="px-5 py-3.5 text-muted">{f.violation}</td>
                    <td className="px-5 py-3.5 font-semibold text-gold">{f.fine}</td>
                    <td className="px-5 py-3.5">
                      <a
                        href={NORMS[f.norm].url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ice underline decoration-ice/40 underline-offset-2 hover:text-ice-strong"
                      >
                        {NORMS[f.norm].label}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3.5 text-caption text-faint">{CONSULTANT_NOTE}</p>
        </div>
      </section>
    </div>
  );
}

function AuditCard({ audit }: { audit: Row }) {
  const date = new Date(audit.created_at).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Link
      href={`/audit/${audit.id}`}
      className="frost group flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors hover:border-line-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <b className="truncate text-card font-semibold transition-colors group-hover:text-ice">
            {hostOf(audit.final_url)}
          </b>
          {audit.demo && (
            <span className="shrink-0 rounded-full border border-gold/40 px-2 py-0.5 text-caption uppercase tracking-wider text-gold">
              демо
            </span>
          )}
          {audit.cms && (
            <span className="shrink-0 rounded-full border border-line-2 px-2 py-0.5 text-caption uppercase tracking-wider text-faint">
              {audit.cms}
            </span>
          )}
        </div>
        <span className="text-caption text-faint">{date}</span>
      </div>

      {!audit.reachable ? (
        <span className="text-body text-gold">сайт не открылся</span>
      ) : (
        <div className="flex items-center gap-4">
          <Stat value={audit.violations} label="нарушений" tone="danger" />
          <Stat value={audit.manual} label="вручную" tone="muted" />
        </div>
      )}
    </Link>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: 'danger' | 'muted' }) {
  const color = tone === 'danger' && value > 0 ? 'text-danger' : 'text-faint';
  return (
    <span className="flex items-baseline gap-1.5">
      <b className={`text-xl font-bold tabular-nums ${color}`}>{value}</b>
      <span className="text-caption text-faint">{label}</span>
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

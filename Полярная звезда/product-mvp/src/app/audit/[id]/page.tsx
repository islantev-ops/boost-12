import Link from 'next/link';
import { notFound } from 'next/navigation';
import AuditProgress from '@/components/AuditProgress';
import DeleteAudit from '@/components/DeleteAudit';
import FindingCard from '@/components/FindingCard';
import { getAudit, parseId } from '@/lib/db';
import { NORMS } from '@/lib/legal';

export const dynamic = 'force-dynamic';

/**
 * Почему обход не дошёл до конца. Причину называем ту, что была на самом деле:
 * писать «достигнут потолок страниц», когда обход встал по объёму или времени,
 * — то же враньё, от которого мы избавлялись в текстах проверок.
 */
const STOP_REASON_TEXT: Record<string, string> = {
  pageLimit: 'достигнут потолок страниц',
  timeLimit: 'исчерпан лимит времени',
  sizeLimit: 'сайт слишком тяжёлый, остановились по объёму',
  done: 'обход завершён',
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auditId = parseId(id);
  if (!auditId) notFound();

  let data: Awaited<ReturnType<typeof getAudit>> = null;
  try {
    data = await getAudit(auditId);
  } catch {
    return (
      <div className="frost px-5 py-8 text-body text-muted">
        <b className="text-gold">База недоступна.</b> PostgreSQL живёт на VPS — локально аудиты не
        читаются. <Link href="/" className="text-ice underline">На главную</Link>
      </div>
    );
  }

  if (!data) notFound();

  const { audit, findings, anglicisms } = data;
  // Заблокированный антиботом сайт: reachable=true, но содержимого нет.
  // Показываем как честный статус, а не как чистый проход.
  const noReport = !audit.reachable || audit.blocked_by_antibot;
  const running = ['queued', 'crawling', 'checking'].includes(audit.status);
  const violations = findings.filter((f) => f.verdict === 'violation').sort((a, b) => b.severity - a.severity);
  const manual = findings.filter((f) => f.verdict === 'manual');
  const ok = findings.filter((f) => f.verdict === 'ok');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-body text-muted transition-colors hover:text-ice">
          ← Все проверки
        </Link>
        <DeleteAudit id={audit.id} />
      </div>

      {/* Шапка аудита */}
      <section className="rime frost relative overflow-hidden px-6 py-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <a
              href={audit.final_url}
              target="_blank"
              rel="noreferrer"
              className="text-2xl font-extrabold tracking-tight transition-colors hover:text-ice sm:text-3xl"
            >
              {hostOf(audit.final_url)}
            </a>
            <p className="mt-2 text-caption text-faint">
              {new Date(audit.created_at).toLocaleString('ru-RU')}
              {' · '}
              {audit.cms ? `CMS: ${audit.cms}` : 'CMS не определена'}
              {audit.client_rendered && ' · содержимое рисуется скриптами'}
            </p>
          </div>

          {!noReport && !running && (
            <a
              href={`/api/audits/${audit.id}/docx`}
              className="shrink-0 rounded-xl bg-ice px-5 py-3 text-lead font-bold text-void transition-opacity hover:opacity-90"
            >
              Скачать аудит в Word
            </a>
          )}
        </div>

        {running ? (
          <AuditProgress id={audit.id} />
        ) : noReport ? (
          <p className="mt-5 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-body text-gold">
            {audit.error ??
              (audit.blocked_by_antibot
                ? 'Сайт закрыт антибот-защитой: автоматическая проверка невозможна, нужна ручная проверка в браузере.'
                : 'Сайт не открылся.')}
          </p>
        ) : (
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
            <Metric value={violations.length} label="подтверждённых нарушений" tone="danger" />
            <Metric value={manual.length} label="требуют ручной проверки" tone="gold" />
            <Metric value={ok.length} label="соответствуют" tone="safe" />
            <Metric value={anglicisms.length} label="иностранных слов" tone="muted" />
          </div>
        )}

        {audit.cms && audit.cms !== 'bitrix' && (
          <p className="mt-4 text-body text-muted">
            Сайт работает не на 1С-Битрикс — определили <b className="text-ink">{audit.cms}</b>.
          </p>
        )}

        {!running && !noReport && audit.coverage && (
          <p className="mt-4 text-body text-muted">
            Осмотрено страниц: <b className="text-ink">{audit.coverage.crawled}</b> из{' '}
            {audit.coverage.discovered} найденных на сайте
            {!audit.coverage.complete && (
              <> — обход остановлен: {STOP_REASON_TEXT[audit.coverage.stopReason]}</>
            )}
            {audit.coverage.skippedByTemplate > 0 && (
              <> · пропущено однотипных: {audit.coverage.skippedByTemplate}</>
            )}
          </p>
        )}
      </section>

      {!noReport && !running && (
        <>
          {/*
            Письмо владельцу сайта скрыто на странице аудита — решение продукта от
            2026-07-16: сначала доводим до идеала Word-отчёт, письмо возвращаем позже.
            Это не баг: LetterEditor, src/lib/letter.ts, API-роут письма и его генерация
            в БД остаются нетронутыми — их просто не рендерим здесь.
          */}

          {/* Нарушения */}
          {violations.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Подтверждённые нарушения</h2>
                <span className="text-caption text-faint">подтверждены всеми факторами</span>
              </div>
              <div className="grid gap-3">
                {violations.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            </section>
          )}

          {/* Ручная проверка */}
          {manual.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Требует ручной проверки</h2>
                <p className="mt-1.5 max-w-2xl text-body text-muted">
                  Подтвердить или опровергнуть автоматически нельзя. Не заявляем как нарушение и не
                  выбрасываем — проверяем руками.
                </p>
              </div>
              <div className="grid gap-3">
                {manual.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            </section>
          )}

          {/* Соответствует */}
          {ok.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">Соответствует</h2>
              <div className="grid gap-3">
                {ok.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            </section>
          )}

          {/* Англицизмы */}
          {anglicisms.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Иностранные слова</h2>
                <a
                  href={NORMS.fz168.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-caption text-ice underline decoration-ice/40 underline-offset-2 hover:text-ice-strong"
                >
                  {NORMS.fz168.label} · с 01.03.2026
                </a>
              </div>
              <div className="frost divide-y divide-line overflow-hidden">
                {anglicisms.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5">
                    <b className="text-lead font-semibold text-danger">«{a.word}»</b>
                    <span className="text-faint">→</span>
                    <b className="text-lead font-semibold text-safe">«{a.suggestion}»</b>
                    <span className="w-full truncate text-caption text-faint">{a.context}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'danger' | 'gold' | 'safe' | 'muted';
}) {
  const color =
    value === 0
      ? 'text-faint'
      : { danger: 'text-danger', gold: 'text-gold', safe: 'text-safe', muted: 'text-ice' }[tone];
  return (
    <div>
      <div className={`text-3xl font-extrabold tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-caption text-faint">{label}</div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

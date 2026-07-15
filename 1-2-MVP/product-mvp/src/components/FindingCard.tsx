'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FindingRow } from '@/lib/db';
import { NORMS } from '@/lib/legal';
import type { Verdict } from '@/lib/types';

const VERDICT_STYLE: Record<Verdict, { label: string; dot: string; text: string; ring: string }> = {
  violation: { label: 'Нарушение', dot: 'bg-danger', text: 'text-danger', ring: 'border-danger/30' },
  ok: { label: 'Соответствует', dot: 'bg-safe', text: 'text-safe', ring: 'border-safe/25' },
  manual: { label: 'Требует ручной проверки', dot: 'bg-gold', text: 'text-gold', ring: 'border-gold/25' },
};

const VOTE_STYLE: Record<string, string> = {
  violation: 'text-danger',
  ok: 'text-safe',
  unknown: 'text-gold',
};

const VOTE_LABEL: Record<string, string> = {
  violation: 'за нарушение',
  ok: 'соответствует',
  unknown: 'не определено',
};

export default function FindingCard({ finding }: { finding: FindingRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>(finding.verdict);
  const [summary, setSummary] = useState(finding.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const style = VERDICT_STYLE[finding.verdict];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${finding.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, summary }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Не удалось сохранить.');
      }
    } catch {
      setError('Сервер не ответил — правка не сохранена.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`frost overflow-hidden border ${style.ring}`}>
      <div className="flex items-start gap-4 px-5 py-4">
        <span className="mt-1.5 w-6 shrink-0 text-sm font-bold tabular-nums text-faint">
          {String(finding.check_id).padStart(2, '0')}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <b className="text-[15px] font-semibold">{finding.title}</b>
            <span className={`flex items-center gap-1.5 text-[12px] font-medium ${style.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              {style.label}
            </span>
            {finding.edited && <span className="text-[11px] text-faint">правлено вручную</span>}
          </div>

          {editing ? (
            <div className="mt-3 space-y-2.5">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(VERDICT_STYLE) as Verdict[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVerdict(v)}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                      verdict === v
                        ? `${VERDICT_STYLE[v].ring} ${VERDICT_STYLE[v].text}`
                        : 'border-line-2 text-faint hover:text-ink'
                    }`}
                  >
                    {VERDICT_STYLE[v].label}
                  </button>
                ))}
              </div>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-lg border border-line-2 bg-void-2/80 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-ice/60"
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-ice px-3.5 py-1.5 text-[12px] font-bold text-void disabled:opacity-40"
                >
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                    setVerdict(finding.verdict);
                    setSummary(finding.summary);
                  }}
                  className="rounded-lg border border-line-2 px-3.5 py-1.5 text-[12px] text-faint hover:text-ink"
                >
                  Отмена
                </button>
              </div>
              {error && <p className="text-[12px] text-danger">{error}</p>}
            </div>
          ) : (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{finding.summary}</p>
          )}

          {/* Скриншотов нет — поэтому вывод обязан вести на то, что мы прочитали. */}
          {finding.doc && (
            <a
              href={finding.doc.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 flex items-center gap-1.5 text-[13px] text-ice transition-colors hover:text-ice-strong"
            >
              <span className="text-faint">→</span>
              <span className="underline decoration-ice/30 underline-offset-2">{finding.doc.label}</span>
              <span className="truncate text-[11px] text-faint">{finding.doc.url}</span>
            </a>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {(finding.norms ?? []).map((k) => {
              const norm = NORMS[k];
              if (!norm) return null;
              const fine = 'fine' in norm && norm.fine ? norm.fine : null;
              return (
                <a
                  key={k}
                  href={norm.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-ice/70 underline decoration-ice/25 underline-offset-2 hover:text-ice"
                >
                  {norm.label}
                  {fine && <span className="text-gold"> · {fine}</span>}
                </a>
              );
            })}
          </div>

          <div className="mt-3 flex gap-3 text-[12px]">
            <button onClick={() => setOpen(!open)} className="text-faint transition-colors hover:text-ice">
              {open ? 'Скрыть разбор' : `Разбор и пруф (${finding.factors?.length ?? 0})`}
            </button>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-faint transition-colors hover:text-ice">
                Поправить
              </button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-line bg-void/40 px-5 py-4">
          <div className="space-y-2">
            <span className="text-[11px] uppercase tracking-wider text-faint">Факторы перепроверки</span>
            {(finding.factors ?? []).map((f, i) => (
              <div key={i} className="flex gap-2.5 text-[13px]">
                <span className={`mt-0.5 shrink-0 text-[11px] ${VOTE_STYLE[f.vote]}`}>
                  {VOTE_LABEL[f.vote]}
                </span>
                <div className="min-w-0">
                  <b className="font-medium text-ink">{f.name}</b>
                  <p className="text-muted">{f.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {(finding.evidence ?? []).length > 0 && (
            <div className="space-y-2 pt-1">
              <span className="text-[11px] uppercase tracking-wider text-faint">
                Фрагмент кода сайта — откройте исходник и найдите его поиском
              </span>
              {finding.evidence.map((e, i) => (
                <div key={i} className="space-y-1">
                  <a
                    href={`view-source:${e.url}`}
                    onClick={(ev) => {
                      // Браузер не даёт открыть view-source: по ссылке — ведём на саму
                      // страницу, а как искать, сказано рядом.
                      ev.preventDefault();
                      window.open(e.url, '_blank', 'noreferrer');
                    }}
                    className="block truncate text-[11px] text-ice/60 hover:text-ice"
                  >
                    {e.url}
                    {e.line ? ` · строка ${e.line} в исходнике` : ''}
                  </a>
                  <pre className="overflow-x-auto rounded-lg border border-line bg-void px-3 py-2.5 text-[12px] leading-relaxed text-ice/85">
                    <code>{e.exact ?? e.snippet}</code>
                  </pre>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-faint">
                Это дословный кусок исходного кода страницы. Откройте её, нажмите Ctrl+U и найдите
                этот текст поиском — он там есть.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { LetterRow } from '@/lib/db';

/** PRD §5.4: текст письма можно отредактировать вручную перед отправкой. */
export default function LetterEditor({ letter }: { letter: LetterRow }) {
  const [subject, setSubject] = useState(letter.subject);
  const [body, setBody] = useState(letter.body);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отправленное значение, а не проп: по нему считаем, есть ли несохранённые правки.
  const [baseline, setBaseline] = useState({ subject: letter.subject, body: letter.body });

  const dirty = subject !== baseline.subject || body !== baseline.body;

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${letter.audit_id}/letter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      if (res.ok) {
        setSaved(true);
        setBaseline({ subject, body });
        setTimeout(() => setSaved(false), 2200);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Не удалось сохранить правки.');
      }
    } catch {
      setError('Сервер не ответил — правки не сохранены.');
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(`${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-xs uppercase tracking-wider text-faint">Тема</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full rounded-xl border border-line-2 bg-void-2/80 px-4 py-2.5 text-[14px] outline-none transition-colors focus:border-ice/60"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs uppercase tracking-wider text-faint">Текст письма</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          className="w-full resize-y rounded-xl border border-line-2 bg-void-2/80 px-4 py-3 text-[14px] leading-relaxed outline-none transition-colors focus:border-ice/60"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-ice px-4 py-2 text-[13px] font-bold text-void transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {saving ? 'Сохраняем…' : 'Сохранить правки'}
        </button>
        <button
          onClick={copy}
          className="rounded-lg border border-line-2 px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:border-ice/50"
        >
          {copied ? 'Скопировано' : 'Скопировать письмо'}
        </button>
        {saved && <span className="text-[13px] text-safe">Сохранено</span>}
        {letter.edited && !dirty && !saved && !error && (
          <span className="text-[12px] text-faint">отредактировано вручную</span>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

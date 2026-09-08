'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const STAGES = [
  'Скачиваем страницы сайта…',
  'Ищем счётчики и внешние сервисы…',
  'Читаем формы и чекбоксы согласия…',
  'Проверяем документы: политика, оферта, согласие…',
  'Перепроверяем найденное по факторам…',
];

export default function AuditForm({ initialUrl }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (target: string) => {
      setBusy(true);
      setError(null);
      setStage(0);

      // Аудит идёт до пары минут — показываем, чем инструмент занят.
      const ticker = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2600);

      try {
        const res = await fetch('/api/audits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target }),
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.detail ? `${data.error} ${data.detail}` : (data.error ?? 'Не удалось выполнить проверку.'));
          return;
        }
        router.push(`/audit/${data.id}`);
        router.refresh();
      } catch {
        setError('Сеть недоступна или сервер не ответил.');
      } finally {
        clearInterval(ticker);
        setBusy(false);
      }
    },
    [router],
  );

  // Ссылку уже ввели на лендинге — начинаем сразу, не заставляя повторяться.
  const autoStarted = useRef(false);
  useEffect(() => {
    const target = initialUrl?.trim();
    if (!target || autoStarted.current) return;
    autoStarted.current = true;
    void run(target);
  }, [initialUrl, run]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    void run(url.trim());
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <input
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="example.ru"
          disabled={busy}
          aria-label="Ссылка на сайт"
          className="min-w-0 flex-1 rounded-xl border border-field-line bg-field px-4 py-3.5 text-lead text-ink outline-none transition-colors placeholder:text-faint focus:border-ice disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="relative shrink-0 overflow-hidden rounded-xl bg-ice px-6 py-3.5 text-lead font-bold text-void transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Проверяем…' : 'Проверить сайт'}
        </button>
      </div>

      {busy && (
        <div className="scanning relative overflow-hidden rounded-xl border border-field-line bg-field px-4 py-3.5">
          <span className="pulse-ice text-body text-ice">{STAGES[stage]}</span>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3.5 text-body text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

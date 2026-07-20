'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DeleteAudit({ id }: { id: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Не удалось удалить.');
      }
    } catch {
      setError('Сервер не ответил — аудит не удалён.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-caption text-muted transition-colors hover:text-danger"
      >
        Удалить аудит
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-caption">
      <span className={error ? 'text-danger' : 'text-muted'}>
        {error ?? 'Удалить вместе с письмом?'}
      </span>
      <button onClick={remove} disabled={busy} className="font-semibold text-danger disabled:opacity-40">
        {busy ? 'Удаляем…' : error ? 'Повторить' : 'Да'}
      </button>
      <button
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        className="text-faint hover:text-ink"
      >
        Отмена
      </button>
    </span>
  );
}

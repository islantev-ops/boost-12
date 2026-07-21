'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Пока аудит идёт, страница показывает прогресс и раз в 2 секунды спрашивает
 * статус. WebSocket платформа запрещает — только опрос или SSE.
 */
export default function AuditProgress({ id }: { id: number }) {
  const router = useRouter();
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/audits/${id}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (stop) return;
        setPages(data.pagesCrawled ?? 0);
        setCurrent(data.currentUrl ?? null);
        if (['done', 'failed', 'blocked'].includes(data.status)) {
          stop = true;
          router.refresh();
        }
      } catch {
        /* сеть моргнула — попробуем на следующем тике */
      }
    };
    void tick();
    const timer = setInterval(() => { if (!stop) void tick(); }, 2000);
    return () => { stop = true; clearInterval(timer); };
  }, [id, router]);

  return (
    <div className="frost mt-5 px-5 py-4">
      <b className="text-lead text-ice">Идёт проверка сайта…</b>
      <p className="mt-1 text-body text-muted">
        Обойдено страниц: <b className="tabular-nums text-ink">{pages}</b>
        {current && <> · сейчас: <span className="text-faint">{current}</span></>}
      </p>
      <p className="mt-2 text-caption text-faint">
        Страницы открываются настоящим браузером — это занимает несколько минут. Страница обновится сама.
      </p>
    </div>
  );
}

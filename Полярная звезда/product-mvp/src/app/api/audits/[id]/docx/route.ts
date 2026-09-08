import { buildAuditDocx } from '@/lib/docx';
import { getAudit, parseId } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return new Response('Аудит не найден.', { status: 404 });

  try {
    const data = await getAudit(id);
    if (!data) return new Response('Аудит не найден.', { status: 404 });

    if (data.audit.blocked_by_antibot) {
      return new Response(
        'Сайт закрыт антибот-защитой: автоматическая проверка не выполнялась, отчёт не формируется.',
        { status: 409 },
      );
    }

    // Кнопка скачивания скрыта интерфейсом, пока аудит идёт фоном, но прямой
    // заход по адресу её не спрашивает. Без этой проверки такой запрос отдал
    // бы пустой отчёт по недоделанному аудиту — то же самое ложное
    // впечатление полноты, что и с блокировкой антиботом выше.
    if (['queued', 'crawling', 'checking'].includes(data.audit.status)) {
      return new Response(
        'Проверка ещё не завершена: отчёт по недоделанному аудиту не формируется.',
        { status: 409 },
      );
    }

    const buffer = await buildAuditDocx(data.audit, data.findings, data.anglicisms);
    const host = safeHost(data.audit.final_url);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="audit-${host}.docx"; filename*=UTF-8''${encodeURIComponent(`Аудит ${host}.docx`)}`,
      },
    });
  } catch (e) {
    // Ссылку на скачивание открывают в новой вкладке — отдаём текст, а не JSON.
    return new Response(
      `Не удалось собрать отчёт: ${e instanceof Error ? e.message : String(e)}`,
      { status: 503 },
    );
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/[^a-z0-9.-]/gi, '');
  } catch {
    return 'site';
  }
}

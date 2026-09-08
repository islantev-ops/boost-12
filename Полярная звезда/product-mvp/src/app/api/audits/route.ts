import { NextResponse } from 'next/server';
import { createQueuedAudit, listAudits } from '@/lib/db';
import { enqueueAudit, recoverOnce } from '@/lib/queue';

export const runtime = 'nodejs';
// Аудит идёт фоном: POST ставит задачу в очередь и сразу отдаёт id, потому что
// внешний прокси платформы рвёт HTTP-запрос на 30-й секунде, а обход сайта
// занимает минуты. Прогресс клиент забирает опросом /api/audits/[id]/status.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ audits: await listAudits() });
  } catch {
    return NextResponse.json({ audits: [], dbOffline: true });
  }
}

export async function POST(req: Request) {
  let url: string;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Ожидался JSON с полем url.' }, { status: 400 });
  }

  if (!url || typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'Вставьте ссылку на сайт.' }, { status: 400 });
  }

  try {
    await recoverOnce();
    const id = await createQueuedAudit(url.trim());
    enqueueAudit(id, url.trim());
    // Отвечаем сразу: внешний прокси рвёт соединение на 30-й секунде, а обход
    // сайта идёт минуты. Клиент следит за прогрессом опросом статуса.
    return NextResponse.json({ id, status: 'queued' });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Не удалось поставить проверку в очередь.',
        detail: e instanceof Error ? e.message : String(e),
        dbOffline: true,
      },
      { status: 503 },
    );
  }
}

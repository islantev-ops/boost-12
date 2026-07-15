import { NextResponse } from 'next/server';
import { auditSite } from '@/lib/audit';
import { listAudits, saveAudit } from '@/lib/db';

export const runtime = 'nodejs';
// Аудит скачивает до 12 страниц чужого сайта — это долго и всегда «живое».
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

  const result = await auditSite(url.trim());

  // Сайт не открылся — письмо не генерируем (PRD §7), но запись сохраняем.
  try {
    const id = await saveAudit(result);
    return NextResponse.json({ id, reachable: result.snapshot.reachable, error: result.snapshot.error ?? null });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Аудит выполнен, но сохранить в базу не удалось.',
        detail: e instanceof Error ? e.message : String(e),
        dbOffline: true,
      },
      { status: 503 },
    );
  }
}

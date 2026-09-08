import { NextResponse } from 'next/server';
import { getAuditStatus, parseId } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });
  try {
    const row = await getAuditStatus(id);
    if (!row) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });
    return NextResponse.json({
      status: row.status,
      pagesCrawled: row.pages_crawled,
      currentUrl: row.current_url,
    });
  } catch {
    return NextResponse.json({ error: 'База недоступна.' }, { status: 503 });
  }
}

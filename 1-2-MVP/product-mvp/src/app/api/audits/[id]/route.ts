import { NextResponse } from 'next/server';
import { deleteAudit, getAudit, parseId } from '@/lib/db';
import { dbError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });

  try {
    const data = await getAudit(id);
    if (!data) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return dbError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });

  try {
    const removed = await deleteAudit(id);
    if (!removed) return NextResponse.json({ error: 'Аудит не найден.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return dbError(e);
  }
}

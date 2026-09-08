import { NextResponse } from 'next/server';
import { parseId, updateLetter } from '@/lib/db';
import { dbError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PRD §5.4: текст письма можно отредактировать вручную перед отправкой. */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Письмо не найдено.' }, { status: 404 });

  const patch = await req.json().catch(() => null);
  if (!patch || (patch.subject === undefined && patch.body === undefined)) {
    return NextResponse.json({ error: 'Нечего обновлять.' }, { status: 400 });
  }

  try {
    const letter = await updateLetter(id, patch);
    if (!letter) return NextResponse.json({ error: 'Письмо не найдено.' }, { status: 404 });
    return NextResponse.json({ letter });
  } catch (e) {
    return dbError(e);
  }
}

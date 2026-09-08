import { NextResponse } from 'next/server';
import { parseId, updateFinding } from '@/lib/db';
import { dbError } from '@/lib/api';
import type { Verdict } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const VERDICTS: Verdict[] = ['violation', 'ok', 'manual'];

/**
 * PRD §7: если ложное срабатывание всё же проскочило, пользователь правит
 * вердикт и формулировку руками перед отправкой.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Пункт не найден.' }, { status: 404 });

  const patch = await req.json().catch(() => null);
  if (!patch) return NextResponse.json({ error: 'Ожидался JSON.' }, { status: 400 });

  if (patch.verdict !== undefined && !VERDICTS.includes(patch.verdict)) {
    return NextResponse.json({ error: 'Недопустимый вердикт.' }, { status: 400 });
  }
  if (patch.verdict === undefined && patch.summary === undefined) {
    return NextResponse.json({ error: 'Нечего обновлять.' }, { status: 400 });
  }

  try {
    const finding = await updateFinding(id, patch);
    if (!finding) return NextResponse.json({ error: 'Пункт не найден.' }, { status: 404 });
    return NextResponse.json({ finding });
  } catch (e) {
    return dbError(e);
  }
}

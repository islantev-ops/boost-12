import { NextResponse } from 'next/server';

/**
 * Ошибка базы в едином виде: интерфейс показывает её пользователю, а не гасит
 * молча. Молчаливый провал хуже ошибки — человек думает, что правка сохранена.
 */
export function dbError(e: unknown) {
  return NextResponse.json(
    {
      error: 'База данных недоступна — действие не выполнено.',
      detail: e instanceof Error ? e.message : String(e),
    },
    { status: 503 },
  );
}

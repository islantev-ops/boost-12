'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/**
 * Переключатель темы для продукта. Лендинг живёт отдельным файлом и остаётся
 * тёмным всегда — переключатель на него не влияет.
 *
 * Выбор запоминается в браузере; если человек ничего не выбирал, берём
 * системную настройку.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Тему на <html> уже поставил скрипт в layout — здесь только подхватываем,
  // чтобы кнопка показывала верное состояние.
  useEffect(() => {
    const current = document.documentElement.dataset.theme as Theme | undefined;
    setTheme(current ?? 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Приватный режим — тема просто не переживёт перезагрузку, это не повод падать.
    }
  }

  const isLight = theme === 'light';

  return (
    <button
      onClick={toggle}
      // До гидратации тема неизвестна: рисуем кнопку, но не подписываем её
      // неверным состоянием.
      aria-label={theme ? (isLight ? 'Включить тёмную тему' : 'Включить светлую тему') : 'Сменить тему'}
      title={theme ? (isLight ? 'Тёмная тема' : 'Светлая тема') : 'Сменить тему'}
      className="grid h-8 w-8 place-items-center rounded-lg border border-line-2 text-muted transition-colors hover:border-ice/50 hover:text-ice"
    >
      {isLight ? (
        // Луна — предложение уйти в тёмную
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" strokeLinejoin="round" />
        </svg>
      ) : (
        // Солнце — предложение уйти в светлую
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

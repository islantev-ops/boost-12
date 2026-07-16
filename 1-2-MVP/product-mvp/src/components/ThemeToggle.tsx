'use client';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'warm';

/**
 * Переключатель темы для продукта. Лендинг живёт отдельным файлом и держит
 * свои три темы сам — переключатель на него не влияет.
 *
 * Тем три, поэтому кнопка не переключает, а перебирает по кругу:
 * тёмная → светлая → тёплая → тёмная. Значок показывает, что будет ПОСЛЕ нажатия,
 * а не что сейчас — так понятнее, куда ведёт клик.
 *
 * Выбор запоминается в браузере; если человек ничего не выбирал, берём системную
 * настройку. «Тёплую» система не подсказывает — в неё можно попасть только руками.
 */
const ORDER: Theme[] = ['dark', 'light', 'warm'];

const NEXT_LABEL: Record<Theme, string> = {
  dark: 'Включить тёмную тему',
  light: 'Включить светлую тему',
  warm: 'Включить тёплую тему',
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Тему на <html> уже поставил скрипт в layout — здесь только подхватываем,
  // чтобы кнопка показывала верное состояние.
  useEffect(() => {
    const current = document.documentElement.dataset.theme as Theme | undefined;
    setTheme(current && ORDER.includes(current) ? current : 'dark');
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme ?? 'dark') + 1) % ORDER.length];
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Приватный режим — тема просто не переживёт перезагрузку, это не повод падать.
    }
  }

  const next: Theme | null = theme ? ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] : null;

  return (
    <button
      onClick={cycle}
      // До гидратации тема неизвестна: рисуем кнопку, но не подписываем её неверным состоянием.
      aria-label={next ? NEXT_LABEL[next] : 'Сменить тему'}
      title={next ? NEXT_LABEL[next] : 'Сменить тему'}
      className="grid h-8 w-8 place-items-center rounded-lg border border-line-2 text-muted transition-colors hover:border-ice/50 hover:text-ice"
    >
      {next === 'light' && (
        // Солнце — предложение уйти в светлую
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
      {next === 'warm' && (
        // Солнце у горизонта — предложение уйти в тёплую: светит, но ещё не согрело
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
          <path d="M7 17a5 5 0 0110 0" />
          <path d="M2 17h3M19 17h3M12 5v3M5.6 8.6l1.5 1.5M18.4 8.6l-1.5 1.5" strokeLinecap="round" />
          <path d="M2 21h20" strokeLinecap="round" />
        </svg>
      )}
      {next === 'dark' && (
        // Луна — предложение уйти в тёмную
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

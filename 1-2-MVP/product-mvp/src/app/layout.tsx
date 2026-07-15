import type { Metadata } from 'next';
import { Exo_2 } from 'next/font/google';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import './globals.css';

/**
 * Тему ставим до первой отрисовки, иначе светлая тема моргает тёмным:
 * страница успевает нарисоваться с палитрой по умолчанию, и только потом
 * React меняет атрибут. Поэтому это синхронный скрипт в <head>, а не эффект.
 */
const THEME_INIT = `(function(){try{
  var t=localStorage.getItem('theme');
  if(!t) t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  document.documentElement.dataset.theme=t;
}catch(e){document.documentElement.dataset.theme='dark'}})()`;

// Тот же шрифт, что на лендинге. next/font self-hostит его — внешних запросов нет.
const exo2 = Exo_2({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-exo2',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Полярная звезда — аудит сайтов на требования РКН',
  description:
    'Вставил ссылку — получил доказательный аудит по 10 пунктам и готовое письмо владельцу сайта.',
  // Тот же значок, что у лендинга: одна иконка на весь сайт, лежит в public/.
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={exo2.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <div className="starfield" aria-hidden />
        <div className="relative z-10 flex min-h-dvh flex-col">
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-4">
              <Link href="/" className="group flex items-center gap-2.5">
                <span className="relative grid h-7 w-7 place-items-center">
                  <span className="absolute inset-0 rounded-full bg-ice/15 blur-[6px] transition-opacity group-hover:opacity-70" />
                  <svg viewBox="0 0 24 24" className="relative h-5 w-5 fill-ice">
                    <path d="M12 1.5l1.9 7.1 7.1 1.9-7.1 1.9-1.9 7.1-1.9-7.1L3 10.5l7.1-1.9z" />
                  </svg>
                </span>
                <span className="text-[15px] font-bold tracking-tight">Полярная звезда</span>
              </Link>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-faint sm:inline">Внутренний инструмент аудита</span>
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-8">{children}</main>

          <footer className="border-t border-line">
            <div className="mx-auto max-w-[1180px] px-5 py-5 text-xs leading-relaxed text-faint">
              Нормы и суммы штрафов — по КонсультантПлюс, со ссылкой на конкретную часть статьи.
              Состав проверок задан чек-листом на лендинге и меняется только там.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

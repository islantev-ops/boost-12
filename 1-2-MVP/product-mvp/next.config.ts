import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      /**
       * Главная — это лендинг. Отдаём готовый public/landing.html как есть,
       * без переписывания в React: там свои шрифты, звёзды, игра и попапы,
       * и любая переделка — это шанс что-нибудь незаметно сломать.
       *
       * beforeFiles: правило должно сработать раньше, чем маршрутизатор решит,
       * что для «/» страницы нет, и покажет 404.
       *
       * Адрес остаётся «/» — посетитель не видит .html в строке браузера.
       */
      beforeFiles: [{ source: '/', destination: '/landing.html' }],
      afterFiles: [],
      fallback: [],
    };
  },
};

/**
 * Здесь нет настроек под GitHub Pages — и не должно быть.
 *
 * `output: 'export'`, `basePath`, `assetPrefix` и `images` какое-то время лежали
 * внутри возврата `rewrites()`. Там они не значили ничего: эта функция принимает
 * только `beforeFiles`, `afterFiles` и `fallback`. Хуже того, посторонние ключи
 * ломали сборку целиком — «rewrites must return an array, received object».
 *
 * Переносить их на верхний уровень тоже нельзя. Pages отдаёт статику, а у аудита
 * есть API-роуты, PostgreSQL и запросы к RDAP — всё серверное. При `output: 'export'`
 * Next откажется собирать API-роуты, а `rewrites()` в статическом экспорте не
 * поддерживается вовсе. Инструмент живёт на VPS; на Pages можно опубликовать
 * разве что сам лендинг, и делать это надо отдельно, а не сборкой Next.
 */

export default nextConfig;

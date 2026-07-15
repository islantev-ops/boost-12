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

export default nextConfig;

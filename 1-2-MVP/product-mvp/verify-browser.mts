// Временный интеграционный прогон. Удаляется после проверки (Task 6).
import { BrowserSession } from './src/lib/browser';

const url = process.argv[2] ?? 'https://www.rustehnika.ru/';
const session = await BrowserSession.open();
const t0 = Date.now();
const res = await session.load(url);
await session.close();

console.log('url    :', url);
console.log('time   :', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('status :', res?.status);
console.log('blocked:', res?.blocked);
console.log('title? :', /<title[^>]*>([^<]*)/i.exec(res?.html ?? '')?.[1]?.slice(0, 80));
console.log('gtm    :', (res?.html.match(/googletagmanager\.com/g) || []).length);
console.log('killbot:', (res?.html.match(/window\.kb|kbsmKi/g) || []).length);

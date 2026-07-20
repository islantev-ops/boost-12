import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAntibotChallenge } from './antibot';

// Заглушка KillBot: заголовок-верификация + служебные скрипты kb*.
const KILLBOT_STUB = `<html><head>
  <title id="pageTitle">KillBot user verification [1.2.3.4]</title>
  <script>if (typeof window.kbErrors === 'undefined'){window.kbErrors=[];}
  window.kbleEm=true; document.cookie="kbReloaded=1"; location.reload();</script>
</head><body>Проверка пользователя...</body></html>`;

// Промежуточный экран той же заглушки: заголовок по-русски.
const KILLBOT_WAIT = `<html><head><title>Проверка пользователя...</title></head><body></body></html>`;

// Настоящий сайт: обычный заголовок, никаких kb*.
const REAL_SITE = `<html><head>
  <title>Качественное оборудование для автосервиса | Рустехника</title>
</head><body><nav>Каталог</nav><footer>Контакты</footer></body></html>`;

test('заглушку KillBot по скриптам kb* распознаём (A)', () => {
  assert.equal(isAntibotChallenge({ html: KILLBOT_STUB }), true);
});

test('промежуточный экран «Проверка пользователя» по заголовку распознаём (A)', () => {
  assert.equal(isAntibotChallenge({ html: KILLBOT_WAIT, title: 'Проверка пользователя...' }), true);
});

test('настоящий сайт заглушкой НЕ считаем (A, регресс против ложных срабатываний)', () => {
  assert.equal(isAntibotChallenge({ html: REAL_SITE, title: 'Рустехника' }), false);
});

test('пустой ввод — не заглушка (A, граница)', () => {
  assert.equal(isAntibotChallenge({ html: '' }), false);
});

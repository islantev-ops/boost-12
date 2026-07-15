import type { AnglicismHit, SiteSnapshot } from './types';

/**
 * Блок Б PRD §5.2 — бонусная проверка на иностранные слова
 * (168-ФЗ, требования к сайтам с 01.03.2026).
 *
 * ЧТО МЫ ИЩЕМ И ПОЧЕМУ ТОЛЬКО ЭТО
 *
 * Ищем ровно одно: латиницу в русском тексте — SALE, NEW, DELIVERY. Такая
 * надпись на витрине русского сайта иностранная по написанию, и тут спорить
 * не о чем.
 *
 * Слова, написанные кириллицей, мы НЕ трогаем — никакие. «Эксклюзивный»,
 * «прайс», «бренд», «кейс» — это русские слова: они освоены языком и живут
 * в словарях, пусть и пришли когда-то из других языков. Помечать их как
 * нарушение — не проверка закона, а вкусовщина.
 *
 * Закон запрещает иностранное слово при наличии общеупотребительного русского
 * аналога, а соответствие норме определяется по словарям, утверждённым
 * Правительством. Этих словарей у нас нет (открытый вопрос PRD §9). Значит,
 * решать «освоено слово или нет» мы не вправе: это ровно то выдумывание нормы,
 * которое инструменту запрещено. Появятся словари — появится и проверка
 * кириллических заимствований, по списку, а не по чутью.
 */

/**
 * Латиница на витрине. Только заглавными: так эти слова и пишут на баннерах
 * и кнопках. Регистр здесь работает как защита от чужих имён — «New Balance»
 * и «Sale-Off Group» под шаблон не попадут.
 *
 * Названий брендов, товарных знаков и технических обозначений (Wi-Fi, USB,
 * iPhone) тут нет и быть не должно: 168-ФЗ их прямо не касается.
 */
const LATIN_MARKETING: { word: string; suggestion: string }[] = [
  { word: 'SALE', suggestion: 'Распродажа' },
  { word: 'NEW', suggestion: 'Новинка' },
  { word: 'HIT', suggestion: 'Хит продаж' },
  { word: 'SOLD OUT', suggestion: 'Продано' },
  { word: 'BEST', suggestion: 'Лучшее' },
  { word: 'FREE', suggestion: 'Бесплатно' },
  { word: 'GIFT', suggestion: 'Подарок' },
  { word: 'DELIVERY', suggestion: 'Доставка' },
  { word: 'SHOP', suggestion: 'Магазин' },
  { word: 'MENU', suggestion: 'Меню' },
  { word: 'ABOUT', suggestion: 'О компании' },
  { word: 'CONTACTS', suggestion: 'Контакты' },
  { word: 'PRICE', suggestion: 'Цены' },
  { word: 'ORDER', suggestion: 'Заказать' },
  { word: 'BUY NOW', suggestion: 'Купить' },
];

function contextAround(text: string, index: number, len: number): string {
  const from = Math.max(0, index - 60);
  const to = Math.min(text.length, index + len + 60);
  return `…${text.slice(from, to).replace(/\s+/g, ' ').trim()}…`;
}

/** Рядом кириллица — значит, слово стоит в русском тексте, а не в чужом имени. */
function inRussianContext(text: string, index: number, len: number): boolean {
  const around = text.slice(Math.max(0, index - 120), Math.min(text.length, index + len + 120));
  return /[а-яё]/i.test(around);
}

export function findAnglicisms(snapshot: SiteSnapshot): AnglicismHit[] {
  const hits: AnglicismHit[] = [];
  const seen = new Set<string>();

  for (const page of snapshot.pages) {
    const text = page.text;

    for (const { word, suggestion } of LATIN_MARKETING) {
      const re = new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!inRussianContext(text, m.index, word.length)) continue;
        const key = `${word}|${page.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ word, suggestion, url: page.url, context: contextAround(text, m.index, word.length) });
      }
    }
  }

  return hits;
}

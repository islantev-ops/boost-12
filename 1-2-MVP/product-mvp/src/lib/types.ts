import type { Method, NormKey } from './legal';

/**
 * Ровно три исхода проверки — PRD §8: «"тихого" четвёртого исхода
 * (пропало без следа) быть не должно».
 *
 *  violation — нарушение подтверждено всеми факторами, есть пруф
 *  ok        — соответствует
 *  manual    — однозначно определить нельзя; не заявляем и НЕ отбрасываем
 */
export type Verdict = 'violation' | 'ok' | 'manual';

/**
 * Один фактор перепроверки (PRD §5.3). Нарушение заявляется, только когда
 * ВСЕ факторы сошлись. Любой `unknown` роняет проверку в `manual`.
 */
export type Factor = {
  name: string;
  /** Голос фактора: за нарушение / за соответствие / не смог определить */
  vote: 'violation' | 'ok' | 'unknown';
  detail: string;
  /** Дословный фрагмент кода сайта — доказательство, которое можно перепроверить */
  evidence?: Evidence;
};

/** Пруф: реальный кусок HTML с адресом страницы, где он найден */
export type Evidence = {
  url: string;
  /** Читаемый вид: пробелы схлопнуты, длина обрезана */
  snippet: string;
  /** Номер строки в исходнике страницы, если удалось определить */
  line?: number;
  /**
   * Дословный кусок исходника — ровно те байты, что отдаёт сайт.
   *
   * Нужен, чтобы пруф можно было найти на странице поиском. Читаемый `snippet`
   * для этого не годится: в нём схлопнуты пробелы, а парсер ещё и переписывает
   * разметку по-своему (`async` → `async=""`), и поиск такой строки на сайте
   * ничего не находит.
   */
  exact?: string;
};

export type Finding = {
  checkId: number;
  title: string;
  what: string;
  verdict: Verdict;
  method: Method;
  norms: NormKey[];
  /** Человеческая формулировка вывода — идёт в отчёт и письмо */
  summary: string;
  factors: Factor[];
  evidence: Evidence[];
  /**
   * Документ, на который опирается вывод: найденная Политика, оферта, согласие.
   *
   * Скриншотов у нас нет, поэтому вывод «соответствует» обязан вести на то,
   * что мы прочитали, — иначе это утверждение без доказательства. Работает
   * в обе стороны: «в Политике рассылка не описана» тоже нужно уметь открыть
   * и проверить.
   */
  doc?: DocRef;
  /** Насколько сильное нарушение — для отбора топ-3 в письмо */
  severity: number;
};

/** Ссылка на документ сайта, который мы смотрели. */
export type DocRef = {
  /** Абсолютный адрес — по нему можно открыть и убедиться */
  url: string;
  /** Что это за документ: «Политика конфиденциальности» и т.п. */
  label: string;
};

export type CrawledPage = {
  url: string;
  status: number;
  html: string;
  /** Текст страницы без тегов — для поиска англицизмов и смысловых проверок */
  text: string;
};

export type SiteSnapshot = {
  inputUrl: string;
  finalUrl: string;
  reachable: boolean;
  error?: string;
  /** Определённая CMS: 'bitrix' | 'wordpress' | ... | null */
  cms: string | null;
  /**
   * Похоже, что контент рисуется на клиенте (SPA). Тогда проверки «чего-то нет»
   * недостоверны — они уходят в `manual`, а не выдают ложное нарушение.
   */
  clientRendered: boolean;
  /**
   * Виден ли подвал в серверном HTML. Ссылки на документы живут в подвале;
   * если его дорисовывает скрипт, «ссылки нет» означает лишь «мы не смотрели».
   */
  footerVisible: boolean;
  pages: CrawledPage[];
};

export type AuditResult = {
  snapshot: SiteSnapshot;
  findings: Finding[];
  anglicisms: AnglicismHit[];
};

export type AnglicismHit = {
  word: string;
  suggestion: string;
  url: string;
  context: string;
};

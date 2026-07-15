import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from 'docx';
import { CONSULTANT_NOTE, METHOD_LABEL, NORMS } from './legal';
import type { AnglicismRow, AuditRow, FindingRow } from './db';

/**
 * Аудит-отчёт в Word (PRD §5.4).
 * Каждый штраф идёт со ссылкой на первоисточник — без ссылки штраф в отчёт
 * не попадает. Пункты «требует ручной проверки» вынесены в отдельный раздел,
 * а не выброшены.
 */

const INK = '1B2A44';
const MUTED = '5B6B8A';
const DANGER = 'B3243A';
const SAFE = '0F7A57';

function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({ text, heading: level, spacing: { before: 260, after: 130 } });
}

function p(text: string, opts: { color?: string; bold?: boolean; size?: number; after?: number } = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 90 },
    children: [
      new TextRun({
        text,
        color: opts.color ?? INK,
        bold: opts.bold,
        size: opts.size ?? 22,
        font: 'Calibri',
      }),
    ],
  });
}

/** Фрагмент кода сайта — доказательство, которое клиент может перепроверить. */
function codeBlock(snippet: string, url: string, line?: number) {
  return [
    new Paragraph({
      spacing: { before: 60, after: 20 },
      children: [
        new TextRun({
          text: `${url}${line ? `, строка ${line} в исходном коде` : ''} — откройте страницу, нажмите Ctrl+U и найдите этот текст поиском:`,
          color: MUTED,
          size: 18,
          italics: true,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      shading: { type: ShadingType.CLEAR, fill: 'F2F5FA' },
      children: [new TextRun({ text: snippet, font: 'Consolas', size: 17, color: '243B5E' })],
    }),
  ];
}

function normLines(norms: string[]) {
  return norms.map((key) => {
    const norm = NORMS[key as keyof typeof NORMS];
    if (!norm) return p(`Норма: ${key}`, { color: MUTED, size: 19 });
    const fine = 'fine' in norm && norm.fine ? ` Штраф юрлицу: ${norm.fine}.` : '';
    return new Paragraph({
      spacing: { after: 70 },
      children: [
        new TextRun({ text: `${norm.label} — ${norm.gist}.${fine} `, size: 19, color: MUTED, font: 'Calibri' }),
        new ExternalHyperlink({
          children: [new TextRun({ text: 'Читать первоисточник', style: 'Hyperlink', size: 19, font: 'Calibri' })],
          link: norm.url,
        }),
      ],
    });
  });
}

function findingBlock(f: FindingRow, index: number) {
  const out: Paragraph[] = [];
  const isViolation = f.verdict === 'violation';

  out.push(
    new Paragraph({
      spacing: { before: 220, after: 60 },
      children: [
        new TextRun({
          text: `${index}. ${f.title}`,
          bold: true,
          size: 25,
          color: isViolation ? DANGER : INK,
          font: 'Calibri',
        }),
      ],
    }),
  );

  out.push(p(f.what, { color: MUTED, size: 19 }));
  out.push(p(f.summary));

  if (f.edited) {
    out.push(p('Формулировка отредактирована вручную перед отправкой.', { color: MUTED, size: 18 }));
  }

  // Документ, который мы прочитали: вывод должен вести на источник.
  if (f.doc) {
    out.push(
      new Paragraph({
        spacing: { after: 90 },
        children: [
          new TextRun({ text: `${f.doc.label}: `, size: 20, color: MUTED, font: 'Calibri' }),
          new ExternalHyperlink({
            children: [new TextRun({ text: f.doc.url, style: 'Hyperlink', size: 20, font: 'Calibri' })],
            link: f.doc.url,
          }),
        ],
      }),
    );
  }

  for (const e of f.evidence ?? []) {
    out.push(...codeBlock(e.exact ?? e.snippet, e.url, e.line));
  }

  out.push(...normLines(f.norms ?? []));
  return out;
}

export async function buildAuditDocx(
  audit: AuditRow,
  findings: FindingRow[],
  anglicisms: AnglicismRow[],
): Promise<Buffer> {
  const violations = findings.filter((f) => f.verdict === 'violation');
  const manual = findings.filter((f) => f.verdict === 'manual');
  const ok = findings.filter((f) => f.verdict === 'ok');

  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
      children: [
        new TextRun({ text: 'Аудит сайта на соответствие требованиям РКН', bold: true, size: 34, color: INK, font: 'Calibri' }),
      ],
    }),
  );
  children.push(p(audit.final_url, { color: MUTED, size: 22 }));
  children.push(
    p(
      `Проверено: ${new Date(audit.created_at).toLocaleString('ru-RU')}. ` +
        `CMS: ${audit.cms ?? 'не определена'}.`,
      { color: MUTED, size: 19, after: 200 },
    ),
  );

  if (audit.cms && audit.cms !== 'bitrix') {
    children.push(p(`Сайт работает не на 1С-Битрикс, определённая CMS — ${audit.cms}.`, { color: MUTED, size: 19 }));
  }

  // Итог
  children.push(h('Коротко', HeadingLevel.HEADING_1));
  children.push(
    p(
      `Проверено пунктов: ${findings.length}. Подтверждённых нарушений: ${violations.length}. ` +
        `Соответствует: ${ok.length}. Требует ручной проверки: ${manual.length}.`,
    ),
  );

  if (!violations.length) {
    children.push(p('Подтверждённых нарушений не найдено.', { color: SAFE, bold: true }));
  }

  // Подтверждённые нарушения
  if (violations.length) {
    children.push(h('Подтверждённые нарушения', HeadingLevel.HEADING_1));
    children.push(
      p(
        'Каждый пункт ниже подтверждён фрагментом кода вашего сайта. Фрагмент можно перепроверить: откройте страницу и посмотрите исходный код.',
        { color: MUTED, size: 19, after: 40 },
      ),
    );
    violations
      .sort((a, b) => b.severity - a.severity)
      .forEach((f, i) => children.push(...findingBlock(f, i + 1)));
  }

  // Требует ручной проверки — обязательный раздел, PRD §5.4
  if (manual.length) {
    children.push(h('Требует ручной проверки', HeadingLevel.HEADING_1));
    children.push(
      p(
        'Эти пункты нельзя подтвердить или опровергнуть автоматически. Мы не заявляем их как нарушения и не отбрасываем — их нужно проверить руками.',
        { color: MUTED, size: 19, after: 40 },
      ),
    );
    manual.forEach((f, i) => {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 50 },
          children: [
            new TextRun({ text: `${i + 1}. ${f.title}`, bold: true, size: 23, color: INK, font: 'Calibri' }),
            new TextRun({ text: `  [${METHOD_LABEL[f.method]}]`, size: 18, color: MUTED, font: 'Calibri' }),
          ],
        }),
      );
      children.push(p(f.summary, { size: 21 }));
      children.push(...normLines(f.norms ?? []));
    });
  }

  // Соответствует
  if (ok.length) {
    children.push(h('Соответствует требованиям', HeadingLevel.HEADING_1));
    ok.forEach((f) => children.push(p(`• ${f.title} — ${f.summary}`, { size: 21 })));
  }

  // Англицизмы
  if (anglicisms.length) {
    children.push(h('Иностранные слова (168-ФЗ, с 01.03.2026)', HeadingLevel.HEADING_1));
    children.push(
      p(
        'Бонусная проверка. Закон запрещает иностранные слова при наличии общеупотребительного русского аналога. Требования к сайтам вступают в силу с 01.03.2026.',
        { color: MUTED, size: 19 },
      ),
    );
    anglicisms.slice(0, 60).forEach((a) => {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `«${a.word}»`, bold: true, size: 21, color: INK, font: 'Calibri' }),
            new TextRun({ text: ` → «${a.suggestion}»  `, size: 21, color: SAFE, font: 'Calibri' }),
            new TextRun({ text: a.context, size: 18, color: MUTED, italics: true, font: 'Calibri' }),
          ],
        }),
      );
    });
    children.push(...normLines(['fz168']));
  }

  // Источники
  children.push(h('Источники', HeadingLevel.HEADING_1));
  children.push(p(CONSULTANT_NOTE, { color: MUTED, size: 19 }));
  children.push(
    p('Все нормы и суммы штрафов приведены по КонсультантПлюс. Ссылки в отчёте ведут на конкретную часть статьи.', {
      color: MUTED,
      size: 19,
    }),
  );

  const doc = new Document({
    creator: 'Инструмент аудита сайтов',
    title: `Аудит ${audit.final_url}`,
    description: 'Аудит сайта на соответствие требованиям РКН',
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

// Временный проверочный скрипт. Удаляется после прогона.
import { auditSite } from './src/lib/audit';

const url = process.argv[2];
if (!url) throw new Error('нужен URL');

const t0 = Date.now();
const { snapshot, findings, anglicisms } = await auditSite(url);

console.log(`\n=== ${url} ===`);
console.log(`доступен: ${snapshot.reachable}${snapshot.error ? ` (${snapshot.error})` : ''}`);
console.log(`CMS: ${snapshot.cms ?? '—'} | SPA: ${snapshot.clientRendered} | страниц: ${snapshot.pages.length}`);
console.log(`время: ${((Date.now() - t0) / 1000).toFixed(1)}с\n`);

for (const f of findings) {
  const mark = { violation: 'НАРУШЕНИЕ', ok: 'ок       ', manual: 'вручную  ' }[f.verdict];
  console.log(`${String(f.checkId).padStart(2)}. [${mark}] ${f.title}`);
  if (f.verdict === 'violation') {
    console.log(`     ${f.summary}`);
    for (const e of f.evidence.slice(0, 1)) {
      console.log(`     ПРУФ ${e.url}${e.line ? `:${e.line}` : ''}`);
      console.log(`     ${e.snippet.slice(0, 150)}`);
    }
  }
}

console.log(`\nанглицизмов: ${anglicisms.length}`);
for (const a of anglicisms.slice(0, 8)) console.log(`  «${a.word}» → «${a.suggestion}»`);

const v = findings.filter((f) => f.verdict === 'violation').length;
const m = findings.filter((f) => f.verdict === 'manual').length;
const o = findings.filter((f) => f.verdict === 'ok').length;
console.log(`\nитого: нарушений ${v}, вручную ${m}, ок ${o}, всего ${findings.length}`);

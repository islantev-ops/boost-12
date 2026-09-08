-- Схема базы аудитов. Накатывается на PostgreSQL, живущий на VPS.
-- Запуск:  psql "$DATABASE_URL" -f schema.sql

DROP TABLE IF EXISTS pages CASCADE;
DROP TABLE IF EXISTS anglicisms CASCADE;
DROP TABLE IF EXISTS letters CASCADE;
DROP TABLE IF EXISTS findings CASCADE;
DROP TABLE IF EXISTS audits CASCADE;

CREATE TABLE audits (
  id              SERIAL PRIMARY KEY,
  input_url       TEXT        NOT NULL,
  final_url       TEXT        NOT NULL,
  cms             TEXT,
  reachable       BOOLEAN     NOT NULL DEFAULT true,
  error           TEXT,
  client_rendered BOOLEAN     NOT NULL DEFAULT false,
  -- Сайт закрыт антибот-защитой: даже реальный браузер не прошёл челлендж.
  -- Проверки не запускались, отчёт пустой. Отдельная колонка нужна, чтобы UI
  -- отличал «закрыт защитой» от «чистый сайт» без разбора текста error.
  blocked_by_antibot BOOLEAN     NOT NULL DEFAULT false,
  -- Демо-запись: сайт вымышленный, пруфы придуманы. Без пометки такая строка
  -- выглядит как настоящий результат, и её идут перепроверять на живом сайте.
  demo            BOOLEAN     NOT NULL DEFAULT false,
  -- Аудит идёт фоном: HTTP-запрос не ждёт результата (внешний прокси рвёт
  -- соединение на 30-й секунде), клиент опрашивает статус.
  status          TEXT        NOT NULL DEFAULT 'done'
                  CHECK (status IN ('queued','crawling','checking','done','failed','blocked')),
  pages_crawled   INTEGER     NOT NULL DEFAULT 0,
  current_url     TEXT,
  -- Факты охвата: сколько сайта посмотрели. Нужны отчёту, чтобы не заявлять
  -- «документа нет» после неполного обхода.
  coverage        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Отметка живости фоновой задачи: обход обновляет её на каждой странице
  -- (см. setAuditStatus). failStaleAudits по ней отличает реально зависший
  -- процесс (перезапуск сервера) от ещё работающего, чтобы не помечать
  -- 'failed' живой аудит при перезапуске pm2 внахлёст.
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Копии обойдённых страниц. Нужны, чтобы спорный вывод можно было поднять
-- дословно: раньше аудит был невоспроизводим — HTML жил только в памяти.
CREATE TABLE pages (
  id            SERIAL PRIMARY KEY,
  audit_id      INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url           TEXT    NOT NULL,
  status        INTEGER NOT NULL,
  html          TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  template_hash TEXT    NOT NULL
);

CREATE INDEX idx_pages_audit ON pages(audit_id);

-- Ровно три исхода. Четвёртого — «пропало без следа» — быть не должно (PRD §8).
CREATE TABLE findings (
  id        SERIAL PRIMARY KEY,
  audit_id  INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  check_id  INTEGER NOT NULL CHECK (check_id BETWEEN 1 AND 10),
  title     TEXT    NOT NULL,
  what      TEXT    NOT NULL,
  verdict   TEXT    NOT NULL CHECK (verdict IN ('violation', 'ok', 'manual')),
  method    TEXT    NOT NULL CHECK (method IN ('auto', 'partial', 'manual')),
  summary   TEXT    NOT NULL,
  norms     JSONB   NOT NULL DEFAULT '[]',
  factors   JSONB   NOT NULL DEFAULT '[]',
  evidence  JSONB   NOT NULL DEFAULT '[]',
  -- Документ сайта, на который опирается вывод: Политика, оферта, согласие.
  -- Скриншотов нет, поэтому вывод обязан вести на то, что мы прочитали.
  doc       JSONB,
  severity  INTEGER NOT NULL DEFAULT 0,
  edited    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (audit_id, check_id)
);

CREATE TABLE letters (
  id         SERIAL PRIMARY KEY,
  audit_id   INTEGER NOT NULL UNIQUE REFERENCES audits(id) ON DELETE CASCADE,
  subject    TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  edited     BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE anglicisms (
  id         SERIAL PRIMARY KEY,
  audit_id   INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  word       TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  url        TEXT NOT NULL,
  context    TEXT NOT NULL
);

CREATE INDEX idx_findings_audit ON findings(audit_id);
CREATE INDEX idx_anglicisms_audit ON anglicisms(audit_id);
CREATE INDEX idx_audits_created ON audits(created_at DESC);

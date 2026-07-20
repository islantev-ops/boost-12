-- Схема базы аудитов. Накатывается на PostgreSQL, живущий на VPS.
-- Запуск:  psql "$DATABASE_URL" -f schema.sql

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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Миграция для боевой базы: догоняет продакшн-схему до состояния ветки
-- feature/full-crawl (фоновый аудит: статус, прогресс, охват обхода, копии
-- страниц). Раньше эти изменения были описаны только в отчётах задач 4 и 5
-- (.superpowers/sdd/task-4-report.md, task-5-report.md), единого файла
-- миграции не было — из-за этого при выкате по чек-листу буквально
-- `setAuditStatus` и `failStaleAudits` упали бы на несуществующей колонке
-- `updated_at`, ошибка проглатывается, и КАЖДЫЙ аудит навсегда зависает в
-- статусе «идёт проверка». Этот файл — единственный источник правды для
-- продакшн-миграции этой ветки.
--
-- `schema.sql` на боевую базу НАКАТЫВАТЬ НЕЛЬЗЯ: он начинается с
-- `DROP TABLE ... CASCADE` и пересоздаёт таблицы с нуля, а на боевой базе
-- живут аудиты, которые владелец хранит как историю версий (см. память
-- «Старые аудиты не трогать») — DROP уничтожит их безвозвратно.
--
-- Все команды идемпотентны (IF NOT EXISTS / проверка в DO-блоке) — повторный
-- запуск этого файла безопасен.
--
-- Запуск на сервере:
--   sudo -u postgres psql -d auditdb -f 2026-07-21-background-audit.sql

ALTER TABLE audits ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pages_crawled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS current_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS coverage JSONB;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- CHECK-ограничение для status: Postgres не поддерживает
-- "ADD CONSTRAINT IF NOT EXISTS", поэтому проверяем существование сами.
-- Имя constraint — то, что Postgres сам присвоил бы безымянному CHECK
-- в CREATE TABLE (конвенция <таблица>_<колонка>_check), как в schema.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audits_status_check'
  ) THEN
    ALTER TABLE audits ADD CONSTRAINT audits_status_check
      CHECK (status IN ('queued','crawling','checking','done','failed','blocked'));
  END IF;
END $$;

-- Копии обойдённых страниц. Структура сверена дословно со schema.sql.
CREATE TABLE IF NOT EXISTS pages (
  id            SERIAL PRIMARY KEY,
  audit_id      INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url           TEXT    NOT NULL,
  status        INTEGER NOT NULL,
  html          TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  template_hash TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_audit ON pages(audit_id);

-- Владелец новой таблицы. Миграция запускается от суперпользователя
-- (`sudo -u postgres`), поэтому созданная таблица достаётся ему, а приложение
-- ходит в базу под пользователем `audit` — и получает «permission denied for
-- table pages» на первом же аудите. Проверено на боевом 2026-07-21: аудит
-- честно упал с этим текстом. Остальные таблицы принадлежат `audit`, приводим
-- новую к тому же виду.
ALTER TABLE pages OWNER TO audit;
ALTER SEQUENCE pages_id_seq OWNER TO audit;

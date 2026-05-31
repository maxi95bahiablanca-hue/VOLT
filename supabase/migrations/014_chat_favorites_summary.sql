-- =====================================================
-- VOLT — Migración 014: Chat · Favoritos · Resumen
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- ─── 1. Tabla messages (chat job) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- null = mensaje de sistema
  content     text NOT NULL,
  type        text NOT NULL DEFAULT 'text',   -- 'text' | 'system' | 'quick'
  read_by_other boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_job_id_idx ON messages(job_id, created_at);

-- RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_participants_can_read_messages"
  ON messages FOR SELECT
  USING (
    job_id IN (
      SELECT id FROM jobs WHERE client_id = auth.uid() OR professional_id IN (
        SELECT id FROM professionals WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "job_participants_can_insert_messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND job_id IN (
      SELECT id FROM jobs WHERE client_id = auth.uid() OR professional_id IN (
        SELECT id FROM professionals WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "mark_read_own_messages"
  ON messages FOR UPDATE
  USING (
    job_id IN (
      SELECT id FROM jobs WHERE client_id = auth.uid() OR professional_id IN (
        SELECT id FROM professionals WHERE user_id = auth.uid()
      )
    )
  );

-- Habilitar Realtime para messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ─── 2. Tabla favorite_professionals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_professionals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, professional_id)
);

ALTER TABLE favorite_professionals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_manage_own_favorites"
  ON favorite_professionals FOR ALL
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- ─── 3. Tabla professional_gallery ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professional_gallery (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  image_url       text NOT NULL,
  caption         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE professional_gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gallery_public_read"
  ON professional_gallery FOR SELECT USING (true);

CREATE POLICY "worker_manages_own_gallery"
  ON professional_gallery FOR ALL
  USING (professional_id IN (SELECT id FROM professionals WHERE user_id = auth.uid()))
  WITH CHECK (professional_id IN (SELECT id FROM professionals WHERE user_id = auth.uid()));

-- ─── 4. Nuevas columnas en jobs ──────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_category   text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_note        text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS diagnosis_structured  jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_summary          jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sub_status            text;

-- ─── 5. Nuevas columnas en professionals ────────────────────────────────────
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS avg_arrival_minutes  integer;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS returning_clients     integer NOT NULL DEFAULT 0;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS video_url             text;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS certifications        jsonb;

-- ─── 6. Verificar ────────────────────────────────────────────────────────────
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_name IN ('jobs','professionals')
-- AND column_name IN ('rejection_category','rejection_note','diagnosis_structured',
--                     'work_summary','sub_status','avg_arrival_minutes',
--                     'returning_clients','video_url','certifications');

-- =====================================================
-- VOLT — Migración 026: tapar agujeros restantes en PROD (2026-06-02)
-- Detectados por diagnostico_completo.sql:
--   • messages no estaba en Realtime
--   • faltaba la tabla push_tokens (notificaciones)
--   • faltaban professionals.monotributo_url / recommend_pct / returning_clients
--   • prestador_leads sin columnas (no corrió la 022) + bucket prestador-docs
-- Todo idempotente. Ejecutar en Supabase SQL Editor.
-- =====================================================

-- ─── 1. push_tokens (notificaciones push) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text NOT NULL,
  platform   text NOT NULL DEFAULT 'android',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_tokens_own" ON push_tokens;
CREATE POLICY "push_tokens_own" ON push_tokens FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_tokens_read_any" ON push_tokens;
CREATE POLICY "push_tokens_read_any" ON push_tokens FOR SELECT USING (true);

-- ─── 2. Columnas faltantes en professionals ──────────────────────────────────
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS monotributo_url   text;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS recommend_pct     integer;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS returning_clients integer NOT NULL DEFAULT 0;

-- ─── 3. (de 022) Columnas de prestador_leads ─────────────────────────────────
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS dni              text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS email            text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS fecha_nac        text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS domicilio        text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS matricula        text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS antecedentes     text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS dni_frente_url   text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS dni_dorso_url    text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS antecedentes_url text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS selfie_url       text;

-- ─── 4. (de 022) Bucket prestador-docs + políticas ───────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('prestador-docs', 'prestador-docs', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "prestador_docs_insert" ON storage.objects;
CREATE POLICY "prestador_docs_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'prestador-docs');

DROP POLICY IF EXISTS "prestador_docs_read" ON storage.objects;
CREATE POLICY "prestador_docs_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'prestador-docs');

-- ─── 5. Realtime: messages (chat en vivo) ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

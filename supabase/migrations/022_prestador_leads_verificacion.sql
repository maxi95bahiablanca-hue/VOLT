-- 022 — Prestador leads: campos de verificación (DNI, antecedentes, fotos) + bucket de documentos
-- Seguro de correr varias veces.

-- ── Campos nuevos del formulario ────────────────────────────────────────────
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

-- ── Bucket de documentos (público para lectura, subida anónima permitida) ────
INSERT INTO storage.buckets (id, name, public)
VALUES ('prestador-docs', 'prestador-docs', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage: cualquiera puede subir (formulario público) y leer
DROP POLICY IF EXISTS "prestador_docs_insert" ON storage.objects;
CREATE POLICY "prestador_docs_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'prestador-docs');

DROP POLICY IF EXISTS "prestador_docs_read" ON storage.objects;
CREATE POLICY "prestador_docs_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'prestador-docs');

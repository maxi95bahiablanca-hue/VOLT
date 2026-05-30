-- =====================================================
-- VOLT — Migración 012: Foto del problema en jobs
-- Ejecutar en Supabase SQL Editor DESPUÉS de 011
-- =====================================================

-- ─── Columna problem_photo_url en jobs ──────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS problem_photo_url TEXT;

-- ─── Bucket para fotos de problemas ─────────────────────────────────────────
-- Las fotos se suben al bucket 'avatars' bajo el prefijo problem-photos/
-- (reutilizamos el bucket existente para no crear infraestructura nueva)
-- Si preferís un bucket separado, descomentá lo siguiente:
--
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('job-photos', 'job-photos', true)
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "job_photos_insert" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
-- CREATE POLICY "job_photos_select" ON storage.objects
--   FOR SELECT USING (bucket_id = 'job-photos');

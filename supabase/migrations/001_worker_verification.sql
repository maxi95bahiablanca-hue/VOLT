-- =====================================================
-- VOLT — Migración 001: Verificación de trabajadores
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- Nuevos campos en professionals
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS phone              TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS verification_note  TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url         TEXT,
  ADD COLUMN IF NOT EXISTS selfie_url         TEXT,
  ADD COLUMN IF NOT EXISTS dni_front_url      TEXT,
  ADD COLUMN IF NOT EXISTS dni_back_url       TEXT,
  ADD COLUMN IF NOT EXISTS monotributo_url    TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by        UUID REFERENCES auth.users(id);

-- Índice para búsquedas por estado de verificación
CREATE INDEX IF NOT EXISTS professionals_verification_idx
  ON professionals(verification_status);

-- Actualizar nearby_workers: solo trabaja con workers aprobados
CREATE OR REPLACE FUNCTION nearby_workers(
  p_profession_id INT,
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_limit         INT DEFAULT 20
)
RETURNS TABLE (
  id               UUID,
  user_id          UUID,
  first_name       TEXT,
  last_name        TEXT,
  phone            TEXT,
  avatar_url       TEXT,
  min_price        INT,
  completed_jobs   INT,
  avg_rating       NUMERIC,
  distance_meters  DOUBLE PRECISION,
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pr.id,
    pr.user_id,
    pr.first_name,
    pr.last_name,
    pr.phone,
    pr.avatar_url,
    pp.min_price,
    pr.completed_jobs,
    pr.avg_rating,
    ST_Distance(
      pr.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_meters,
    ST_Y(pr.location::geometry) AS latitude,
    ST_X(pr.location::geometry) AS longitude
  FROM professionals pr
  JOIN professional_professions pp ON pp.professional_id = pr.id
  WHERE
    pp.profession_id       = p_profession_id
    AND pr.available       = TRUE
    AND pr.verification_status = 'approved'
    AND pr.location        IS NOT NULL
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

-- Storage bucket para documentos de trabajadores
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'worker-docs',
  'worker-docs',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
) ON CONFLICT (id) DO NOTHING;

-- RLS en storage: cada profesional accede solo a su carpeta
CREATE POLICY "worker_docs_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'worker-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "worker_docs_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'worker-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Admins pueden leer todos los documentos (agrega los user_id de admins acá)
CREATE POLICY "worker_docs_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'worker-docs'
    AND auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'maxi95.bahiablanca@gmail.com'
    )
  );

-- =====================================================
-- VOLT — Migración 002: Columnas y funciones faltantes
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- ─── PROFESSIONALS: agregar CBU ──────────────────────
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS cbu TEXT;

-- ─── JOBS: columnas para el sistema de presupuestos múltiples ──
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS quote_group_id    UUID,
  ADD COLUMN IF NOT EXISTS pre_diagnosis     TEXT,
  ADD COLUMN IF NOT EXISTS final_diagnosis   TEXT;

CREATE INDEX IF NOT EXISTS jobs_quote_group_idx ON jobs(quote_group_id)
  WHERE quote_group_id IS NOT NULL;

-- ─── FUNCIÓN: penalizar rechazo de trabajador ─────────
-- Resta 0.05 puntos de rating por cada rechazo (con floor en 0)
CREATE OR REPLACE FUNCTION penalize_worker_rejection(p_professional_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE professionals
  SET avg_rating = GREATEST(0, avg_rating - 0.05)
  WHERE id = p_professional_id;
END;
$$;

-- ─── POLÍTICA: admin puede actualizar cualquier profesional ──────────
-- Sin esto el admin no puede aprobar/rechazar solicitudes de registro
CREATE POLICY "professionals_admin_update" ON professionals
FOR UPDATE USING (
  auth.uid() IN (
    SELECT id FROM auth.users WHERE email = 'maxi95.bahiablanca@gmail.com'
  )
);

-- ─── STORAGE: bucket público para avatares ───────────────────────────
-- Los avatares de trabajadores deben ser accesibles públicamente (React Native
-- <Image> no puede enviar headers de auth). Los documentos sensibles
-- (DNI, selfie) quedan en worker-docs (privado).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,            -- público: cualquiera puede ver la imagen con la URL
  5242880,         -- 5 MB máximo
  ARRAY['image/jpeg','image/png','image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Cualquier usuario autenticado puede subir/actualizar su propio avatar
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Lectura pública (sin auth) — permite que <Image> cargue sin headers
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- ─── ÍNDICE: búsquedas de jobs activos por cliente ───
-- Mejora performance de getActiveForClient y getActiveQuoteForClient
CREATE INDEX IF NOT EXISTS jobs_client_status_idx ON jobs(client_id, status);

-- =====================================================
-- VOLT — Migración 010: Campos de registro de trabajador
-- Ejecutar en Supabase SQL Editor DESPUÉS de 009
-- =====================================================

-- ─── Nuevas columnas en professionals ───────────────────────────────────────
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS antecedentes_url TEXT,
  ADD COLUMN IF NOT EXISTS estudios_url     TEXT,
  ADD COLUMN IF NOT EXISTS payment_method   TEXT NOT NULL DEFAULT 'cbu';

-- ─── Actualizar nearby_workers para incluir estudios_url y filtrar aprobados ─
-- También agrega el filtro verification_status = 'approved' que faltaba.
CREATE OR REPLACE FUNCTION nearby_workers(
  p_profession_id INT,
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_limit         INT DEFAULT 10
)
RETURNS TABLE (
  id                  UUID,
  user_id             UUID,
  first_name          TEXT,
  last_name           TEXT,
  phone               TEXT,
  min_price           INT,
  completed_jobs      INT,
  avg_rating          NUMERIC,
  effective_rating    NUMERIC,
  on_time_completions INT,
  distance_meters     DOUBLE PRECISION,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  avatar_url          TEXT,
  estudios_url        TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pr.id,
    pr.user_id,
    pr.first_name,
    pr.last_name,
    pr.phone,
    pp.min_price,
    pr.completed_jobs,
    pr.avg_rating,
    LEAST(5.0, ROUND(pr.avg_rating + LEAST(pr.on_time_completions, 10) * 0.05, 2)) AS effective_rating,
    pr.on_time_completions,
    ST_Distance(
      pr.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_meters,
    ST_Y(pr.location::geometry) AS latitude,
    ST_X(pr.location::geometry) AS longitude,
    pr.avatar_url,
    pr.estudios_url
  FROM professionals pr
  JOIN professional_professions pp ON pp.professional_id = pr.id
  WHERE
    pp.profession_id        = p_profession_id
    AND pr.available        = TRUE
    AND pr.location         IS NOT NULL
    AND pr.verification_status = 'approved'
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

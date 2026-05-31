-- 017: columnas de reputación avanzada en professionals
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS complaints_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommend_pct   integer;

-- Actualizar nearby_workers para incluir los nuevos campos de reputación
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
  avg_arrival_minutes INT,
  returning_clients   INT,
  complaints_count    INT,
  recommend_pct       INT,
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
    pr.avg_arrival_minutes,
    pr.returning_clients,
    pr.complaints_count,
    pr.recommend_pct,
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
    pp.profession_id            = p_profession_id
    AND pr.available            = TRUE
    AND pr.location             IS NOT NULL
    AND pr.verification_status  = 'approved'
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

-- Recalcular recommend_pct cuando se inserta una review
CREATE OR REPLACE FUNCTION update_recommend_pct()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE professionals
  SET recommend_pct = (
    SELECT ROUND(COUNT(*) FILTER (WHERE rating >= 4) * 100.0 / NULLIF(COUNT(*), 0))
    FROM reviews
    WHERE professional_id = NEW.professional_id
  )
  WHERE id = NEW.professional_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_recommend_pct ON reviews;
CREATE TRIGGER trg_update_recommend_pct
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_recommend_pct();

-- 018: función para buscar el trabajador disponible más cercano (modo emergencia)
CREATE OR REPLACE FUNCTION nearest_available_worker(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS TABLE (
  id                  UUID,
  user_id             UUID,
  first_name          TEXT,
  last_name           TEXT,
  phone               TEXT,
  avg_rating          NUMERIC,
  effective_rating    NUMERIC,
  completed_jobs      INT,
  on_time_completions INT,
  avg_arrival_minutes INT,
  avatar_url          TEXT,
  profession_id       INT,
  profession_name     TEXT,
  min_price           INT,
  distance_meters     DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pr.id,
    pr.user_id,
    pr.first_name,
    pr.last_name,
    pr.phone,
    pr.avg_rating,
    LEAST(5.0, ROUND(pr.avg_rating + LEAST(pr.on_time_completions, 10) * 0.05, 2)) AS effective_rating,
    pr.completed_jobs,
    pr.on_time_completions,
    pr.avg_arrival_minutes,
    pr.avatar_url,
    pp.profession_id,
    p.name AS profession_name,
    pp.min_price,
    ST_Distance(
      pr.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_meters
  FROM professionals pr
  JOIN professional_professions pp ON pp.professional_id = pr.id
  JOIN professions p ON p.id = pp.profession_id
  WHERE
    pr.available            = TRUE
    AND pr.location         IS NOT NULL
    AND pr.verification_status = 'approved'
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT 1;
$$;

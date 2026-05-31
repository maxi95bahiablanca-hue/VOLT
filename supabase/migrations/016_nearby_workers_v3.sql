-- 016: nearby_workers v3 — agrega avg_arrival_minutes y returning_clients
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

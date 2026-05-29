-- =====================================================
-- VOLT — Migración 008: Bonus de eficiencia
-- Ejecutar en Supabase SQL Editor DESPUÉS de 007
-- =====================================================

-- ─── Columna on_time_completions en professionals ───────────────────────────
-- Contador de trabajos terminados dentro del tiempo estimado.
-- Cada uno suma +0.05 al rating efectivo que ven los clientes (tope +0.5).
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS on_time_completions INT NOT NULL DEFAULT 0;

-- ─── Función: parsear work_duration_est a minutos ───────────────────────────
CREATE OR REPLACE FUNCTION parse_duration_to_minutes(dur TEXT)
RETURNS INT AS $$
DECLARE
  n INT;
BEGIN
  IF dur IS NULL OR trim(dur) = '' THEN RETURN NULL; END IF;
  dur := lower(regexp_replace(trim(dur), '[~\s]+', ' ', 'g'));
  n   := COALESCE((regexp_match(dur, '(\d+)'))[1]::INT, 0);
  IF n = 0 THEN RETURN NULL; END IF;

  IF    dur LIKE '%semana%'         THEN RETURN n * 5 * 8 * 60;  -- 5 días laborales de 8 h
  ELSIF dur LIKE '%día%' OR dur LIKE '%dia%' THEN RETURN n * 8 * 60;
  ELSIF dur LIKE '%hora%' OR dur LIKE '%hr%' THEN RETURN n * 60;
  ELSIF dur LIKE '%min%'            THEN RETURN n;
  ELSE  RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── Trigger: verificar eficiencia al completar un job ──────────────────────
CREATE OR REPLACE FUNCTION check_efficiency_bonus()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  estimated_mins INT;
  actual_mins    INT;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  estimated_mins := parse_duration_to_minutes(NEW.work_duration_est);
  IF estimated_mins IS NULL OR estimated_mins = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.is_multiday THEN
    -- Multi-día: acumulado de minutos trabajados
    actual_mins := COALESCE(NEW.total_minutes_worked, 0);
  ELSE
    -- Trabajo normal: desde que empezó hasta que marcó completado
    IF NEW.work_started_at IS NULL OR NEW.completed_at IS NULL THEN
      RETURN NEW;
    END IF;
    actual_mins := ROUND(EXTRACT(EPOCH FROM (NEW.completed_at - NEW.work_started_at)) / 60)::INT;
  END IF;

  IF actual_mins <= 0 THEN RETURN NEW; END IF;

  -- En tiempo si terminó dentro del 115% de la estimación (margen generoso)
  IF actual_mins <= (estimated_mins * 1.15) THEN
    UPDATE professionals
      SET on_time_completions = on_time_completions + 1
      WHERE id = NEW.professional_id;
  END IF;

  RETURN NEW;
END;
$$;

-- El trigger se nombra trg_z_ para ejecutar DESPUÉS de trg_update_professional_stats
DROP TRIGGER IF EXISTS trg_z_efficiency_bonus ON jobs;
CREATE TRIGGER trg_z_efficiency_bonus
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION check_efficiency_bonus();

-- ─── Actualizar nearby_workers para incluir avatar_url y rating efectivo ─────
-- El "effective_rating" que ven los clientes = avg_rating + on_time bonus (tope 5.0)
-- Cada trabajo en tiempo suma +0.05, máximo +0.5 (10 trabajos)
CREATE OR REPLACE FUNCTION nearby_workers(
  p_profession_id INT,
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_limit         INT DEFAULT 10
)
RETURNS TABLE (
  id               UUID,
  user_id          UUID,
  first_name       TEXT,
  last_name        TEXT,
  phone            TEXT,
  min_price        INT,
  completed_jobs   INT,
  avg_rating       NUMERIC,
  effective_rating NUMERIC,
  on_time_completions INT,
  distance_meters  DOUBLE PRECISION,
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION,
  avatar_url       TEXT
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
    pr.avatar_url
  FROM professionals pr
  JOIN professional_professions pp ON pp.professional_id = pr.id
  WHERE
    pp.profession_id = p_profession_id
    AND pr.available  = TRUE
    AND pr.location   IS NOT NULL
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

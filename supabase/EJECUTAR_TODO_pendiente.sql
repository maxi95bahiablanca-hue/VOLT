-- ════════════════════════════════════════════════════════════════════
-- VOLT — Migraciones pendientes 014 a 019 (pegar TODO en Supabase SQL Editor)
-- Generado Sun May 31 13:29:57     2026. Ejecutar de una sola vez.
-- ════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 014_chat_favorites_summary.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================
-- VOLT — Migración 014: Chat · Favoritos · Resumen
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- ─── 1. Tabla messages (chat job) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- null = mensaje de sistema
  content     text NOT NULL,
  type        text NOT NULL DEFAULT 'text',   -- 'text' | 'system' | 'quick'
  read_by_other boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_job_id_idx ON messages(job_id, created_at);

-- RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_participants_can_read_messages"
  ON messages FOR SELECT
  USING (
    job_id IN (
      SELECT id FROM jobs WHERE client_id = auth.uid() OR professional_id IN (
        SELECT id FROM professionals WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "job_participants_can_insert_messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND job_id IN (
      SELECT id FROM jobs WHERE client_id = auth.uid() OR professional_id IN (
        SELECT id FROM professionals WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "mark_read_own_messages"
  ON messages FOR UPDATE
  USING (
    job_id IN (
      SELECT id FROM jobs WHERE client_id = auth.uid() OR professional_id IN (
        SELECT id FROM professionals WHERE user_id = auth.uid()
      )
    )
  );

-- Habilitar Realtime para messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ─── 2. Tabla favorite_professionals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_professionals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, professional_id)
);

ALTER TABLE favorite_professionals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_manage_own_favorites"
  ON favorite_professionals FOR ALL
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- ─── 3. Tabla professional_gallery ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professional_gallery (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  image_url       text NOT NULL,
  caption         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE professional_gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gallery_public_read"
  ON professional_gallery FOR SELECT USING (true);

CREATE POLICY "worker_manages_own_gallery"
  ON professional_gallery FOR ALL
  USING (professional_id IN (SELECT id FROM professionals WHERE user_id = auth.uid()))
  WITH CHECK (professional_id IN (SELECT id FROM professionals WHERE user_id = auth.uid()));

-- ─── 4. Nuevas columnas en jobs ──────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_category   text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_note        text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS diagnosis_structured  jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_summary          jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sub_status            text;

-- ─── 5. Nuevas columnas en professionals ────────────────────────────────────
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS avg_arrival_minutes  integer;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS returning_clients     integer NOT NULL DEFAULT 0;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS video_url             text;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS certifications        jsonb;

-- ─── 6. Verificar ────────────────────────────────────────────────────────────
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_name IN ('jobs','professionals')
-- AND column_name IN ('rejection_category','rejection_note','diagnosis_structured',
--                     'work_summary','sub_status','avg_arrival_minutes',
--                     'returning_clients','video_url','certifications');


-- ─────────────────────────────────────────────────────────────────────
-- 015_job_events.sql
-- ─────────────────────────────────────────────────────────────────────
-- 015: job_events — sistema de timeline viva por trabajo
CREATE TABLE IF NOT EXISTS job_events (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id     uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type text        NOT NULL,
  message    text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants can read job events" ON job_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = job_events.job_id
        AND (
          j.client_id = auth.uid()
          OR j.professional_id IN (
            SELECT id FROM professionals WHERE user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "authenticated can insert job events" ON job_events
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

ALTER PUBLICATION supabase_realtime ADD TABLE job_events;


-- ─────────────────────────────────────────────────────────────────────
-- 016_nearby_workers_v3.sql
-- ─────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────
-- 017_professional_reputation.sql
-- ─────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────
-- 018_emergency.sql
-- ─────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────
-- 019_security_hardening.sql
-- ─────────────────────────────────────────────────────────────────────
-- 019: Hardening de seguridad (auditoría)
-- Ejecutar en Supabase SQL Editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CUIT/CBU: mover a tabla protegida (antes cualquier user los leía vía USING(true))
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professional_payout (
  professional_id uuid PRIMARY KEY REFERENCES professionals(id) ON DELETE CASCADE,
  cuit       text,
  cbu        text,
  updated_at timestamptz DEFAULT now()
);

-- Copiar datos existentes desde professionals
INSERT INTO professional_payout (professional_id, cuit, cbu)
SELECT id, cuit, cbu FROM professionals
WHERE (cuit IS NOT NULL OR cbu IS NOT NULL)
ON CONFLICT (professional_id) DO NOTHING;

-- Vaciar las columnas sensibles de professionals (ya no se exponen vía USING(true))
UPDATE professionals SET cuit = NULL, cbu = NULL;

ALTER TABLE professional_payout ENABLE ROW LEVEL SECURITY;

-- Solo el dueño del registro o el admin pueden leer/escribir los datos bancarios
DROP POLICY IF EXISTS "payout_owner_or_admin" ON professional_payout;
CREATE POLICY "payout_owner_or_admin" ON professional_payout
FOR ALL
USING (
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  OR (auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com'
)
WITH CHECK (
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  OR (auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESEÑAS: solo se puede reseñar si existe un trabajo COMPLETADO entre ambos
--    (antes: cualquier cliente podía insertar reseñas falsas / review-bombing)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reviews_insert_own" ON reviews;
CREATE POLICY "reviews_insert_own" ON reviews
FOR INSERT WITH CHECK (
  auth.uid() = client_id
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = job_id
      AND j.client_id = auth.uid()
      AND j.professional_id = reviews.professional_id
      AND j.status = 'completed'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PUSH TOKENS: quitar lectura pública (antes cualquiera leía los tokens de todos)
--    El envío de push ahora se hace server-side con la Edge Function `send-push`
--    (service_role, que bypasea RLS). La app ya no lee tokens de otros usuarios.
--    IMPORTANTE: deployar la Edge Function `send-push` ANTES de correr esto.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "push_tokens_read_any" ON push_tokens;


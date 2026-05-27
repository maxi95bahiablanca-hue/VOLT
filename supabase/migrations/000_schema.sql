-- =====================================================
-- VOLT — Schema completo
-- Ejecutar en el SQL Editor de Supabase (en orden)
-- =====================================================

-- ─── EXTENSIONES ──────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── ENUMS ────────────────────────────────────────────
CREATE TYPE job_status AS ENUM (
  'pending',           -- cliente solicitó, esperando que trabajador acepte
  'accepted',          -- trabajador aceptó, está yendo
  'arrived',           -- trabajador llegó al domicilio
  'in_progress',       -- trabajo en curso
  'awaiting_payment',  -- trabajador cargó el monto final, esperando pago del cliente
  'completed',         -- cliente pagó, trabajo terminado
  'cancelled'          -- cancelado por cualquiera de las partes
);

CREATE TYPE payment_type AS ENUM ('visit', 'work');
CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'failed', 'refunded');
CREATE TYPE media_type AS ENUM ('photo', 'video', 'certificate');

-- ─── TABLA: professions ───────────────────────────────
CREATE TABLE professions (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

INSERT INTO professions (name) VALUES
  ('Electricista'),
  ('Plomero'),
  ('Gasista'),
  ('Pintor'),
  ('Albañil'),
  ('Carpintero'),
  ('Cerrajero'),
  ('Técnico en electrodomésticos'),
  ('Jardinero'),
  ('Limpieza del hogar'),
  ('Mudanzas'),
  ('Fumigador'),
  ('Chapista'),
  ('Mecánico a domicilio'),
  ('Técnico en PC / celulares');

-- ─── TABLA: professionals ─────────────────────────────
CREATE TABLE professionals (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name                TEXT        NOT NULL,
  last_name                 TEXT        NOT NULL,
  phone                     TEXT,
  cuit                      TEXT,
  criminal_record_confirmed BOOLEAN     NOT NULL DEFAULT FALSE,
  available                 BOOLEAN     NOT NULL DEFAULT FALSE,
  location                  geography(Point, 4326),
  -- Estadísticas (se actualizan con triggers)
  completed_jobs            INT         NOT NULL DEFAULT 0,
  avg_rating                NUMERIC(3,2) NOT NULL DEFAULT 0,
  -- Saldo pendiente de cobro a VOLT (por trabajos en efectivo si se habilita en futuro)
  pending_commission        INT         NOT NULL DEFAULT 0,
  -- Verificación
  verified                  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX professionals_user_id_idx   ON professionals(user_id);
CREATE INDEX professionals_available_idx ON professionals(available) WHERE available = TRUE;
CREATE INDEX professionals_location_idx  ON professionals USING GIST(location);

-- ─── TABLA: professional_professions ─────────────────
CREATE TABLE professional_professions (
  id              SERIAL  PRIMARY KEY,
  professional_id UUID    NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  profession_id   INT     NOT NULL REFERENCES professions(id)   ON DELETE CASCADE,
  min_price       INT     NOT NULL CHECK (min_price >= 0),
  UNIQUE(professional_id, profession_id)
);

-- ─── TABLA: worker_media ──────────────────────────────
-- Fotos de trabajos, videos, títulos/certificados
CREATE TABLE worker_media (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  type            media_type  NOT NULL,
  url             TEXT        NOT NULL,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX worker_media_professional_idx ON worker_media(professional_id);

-- ─── TABLA: jobs ──────────────────────────────────────
CREATE TABLE jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        NOT NULL REFERENCES auth.users(id),
  professional_id   UUID        NOT NULL REFERENCES professionals(id),
  profession_id     INT         NOT NULL REFERENCES professions(id),
  status            job_status  NOT NULL DEFAULT 'pending',

  -- Ubicación del trabajo
  client_lat        DOUBLE PRECISION NOT NULL,
  client_lng        DOUBLE PRECISION NOT NULL,
  address           TEXT,
  notes             TEXT,

  -- Montos
  visit_amount      INT         NOT NULL DEFAULT 30000,
  work_amount       INT,        -- trabajador lo carga al finalizar

  -- Comisión aplicada al momento del cobro
  commission_pct    INT         NOT NULL DEFAULT 20,

  -- Timestamps de estados
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  arrived_at        TIMESTAMPTZ,
  work_started_at   TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      UUID        REFERENCES auth.users(id)
);

CREATE INDEX jobs_client_idx       ON jobs(client_id);
CREATE INDEX jobs_professional_idx ON jobs(professional_id);
CREATE INDEX jobs_status_idx       ON jobs(status);

-- ─── TABLA: payments ──────────────────────────────────
CREATE TABLE payments (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID           NOT NULL REFERENCES jobs(id),
  type            payment_type   NOT NULL,
  status          payment_status NOT NULL DEFAULT 'pending',

  -- Montos
  gross_amount    INT            NOT NULL,  -- lo que paga el cliente
  commission_pct  INT            NOT NULL,  -- % de VOLT en este pago
  commission_amt  INT            NOT NULL,  -- monto VOLT
  worker_amt      INT            NOT NULL,  -- monto que recibe el trabajador

  -- Referencia Mercado Pago
  mp_preference_id TEXT,
  mp_payment_id    TEXT,
  mp_status        TEXT,

  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ
);

CREATE INDEX payments_job_idx ON payments(job_id);

-- ─── TABLA: reviews ───────────────────────────────────
CREATE TABLE reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        NOT NULL UNIQUE REFERENCES jobs(id),
  client_id       UUID        NOT NULL REFERENCES auth.users(id),
  professional_id UUID        NOT NULL REFERENCES professionals(id),
  rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reviews_professional_idx ON reviews(professional_id);

-- ─── FUNCIÓN: comisión variable ───────────────────────
-- Retorna el % de comisión según historial del trabajador
CREATE OR REPLACE FUNCTION get_commission_pct(p_completed_jobs INT, p_avg_rating NUMERIC)
RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_completed_jobs >= 100 AND p_avg_rating >= 4.8 THEN 10
    WHEN p_completed_jobs >= 50  AND p_avg_rating >= 4.5 THEN 14
    WHEN p_completed_jobs >= 10  AND p_avg_rating >= 4.0 THEN 17
    ELSE 20
  END;
$$;

-- ─── FUNCIÓN: trabajadores cercanos ───────────────────
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
    pp.profession_id = p_profession_id
    AND pr.available  = TRUE
    AND pr.location   IS NOT NULL
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

-- ─── TRIGGER: actualizar estadísticas al completar ────
CREATE OR REPLACE FUNCTION update_professional_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE professionals SET
      completed_jobs = (
        SELECT COUNT(*) FROM jobs
        WHERE professional_id = NEW.professional_id AND status = 'completed'
      ),
      avg_rating = (
        SELECT COALESCE(AVG(rating), 0) FROM reviews
        WHERE professional_id = NEW.professional_id
      )
    WHERE id = NEW.professional_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_professional_stats
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_professional_stats();

-- ─── TRIGGER: stats al insertar review ────────────────
CREATE OR REPLACE FUNCTION update_stats_on_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE professionals SET
    avg_rating = (
      SELECT COALESCE(AVG(rating), 0) FROM reviews
      WHERE professional_id = NEW.professional_id
    )
  WHERE id = NEW.professional_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_stats_on_review
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_stats_on_review();

-- ─── ROW LEVEL SECURITY ───────────────────────────────
ALTER TABLE professions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_professions ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_media             ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews                  ENABLE ROW LEVEL SECURITY;

-- professions: lectura pública
CREATE POLICY "professions_read" ON professions FOR SELECT USING (true);

-- professionals: lectura pública, escritura solo del dueño
CREATE POLICY "professionals_read"       ON professionals FOR SELECT USING (true);
CREATE POLICY "professionals_insert_own" ON professionals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "professionals_update_own" ON professionals FOR UPDATE USING (auth.uid() = user_id);

-- professional_professions
CREATE POLICY "pp_read"       ON professional_professions FOR SELECT USING (true);
CREATE POLICY "pp_insert_own" ON professional_professions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM professionals WHERE id = professional_id AND user_id = auth.uid())
);
CREATE POLICY "pp_delete_own" ON professional_professions FOR DELETE USING (
  EXISTS (SELECT 1 FROM professionals WHERE id = professional_id AND user_id = auth.uid())
);

-- worker_media
CREATE POLICY "media_read"       ON worker_media FOR SELECT USING (true);
CREATE POLICY "media_insert_own" ON worker_media FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM professionals WHERE id = professional_id AND user_id = auth.uid())
);
CREATE POLICY "media_delete_own" ON worker_media FOR DELETE USING (
  EXISTS (SELECT 1 FROM professionals WHERE id = professional_id AND user_id = auth.uid())
);

-- jobs: cliente ve sus trabajos, trabajador ve los suyos
CREATE POLICY "jobs_read_own" ON jobs FOR SELECT USING (
  auth.uid() = client_id OR
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
);
CREATE POLICY "jobs_insert_client" ON jobs FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "jobs_update_parties" ON jobs FOR UPDATE USING (
  auth.uid() = client_id OR
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
);

-- payments: solo las partes del trabajo
CREATE POLICY "payments_read_own" ON payments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_id AND (
      j.client_id = auth.uid() OR
      j.professional_id = (SELECT id FROM professionals WHERE user_id = auth.uid())
    )
  )
);
CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (true);

-- reviews: lectura pública, escritura solo del cliente del trabajo
CREATE POLICY "reviews_read"        ON reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_own"  ON reviews FOR INSERT WITH CHECK (auth.uid() = client_id);

-- ─── TABLA: push_tokens ───────────────────────────────
CREATE TABLE push_tokens (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'android',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_tokens_own" ON push_tokens FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "push_tokens_read_any" ON push_tokens FOR SELECT USING (true);

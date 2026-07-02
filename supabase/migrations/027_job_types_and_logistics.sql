-- ─────────────────────────────────────────────────────────────────────────────
-- 027 · Fase 0 — Cimientos para planillas por tipo de oficio + flete (logística).
--
-- TODO ES ADITIVO E IDEMPOTENTE (ADD COLUMN IF NOT EXISTS). No modifica ni borra
-- datos. Los jobs existentes quedan como 'reparacion' (el flujo que ya anda) y
-- todo el motor (timeline, chat, pago, etc.) sigue funcionando idéntico.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tipo de molde del trabajo: 'reparacion' (A) | 'obra' (B) | 'logistica' (C).
-- Default 'reparacion' → los trabajos viejos y el flujo actual no cambian.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'reparacion';

-- Datos del formulario estructurado, flexibles por oficio (lo que arma el asistente).
-- Ej reparación: { "desde_cuando": "ayer", "urgencia": "alta" }
-- Ej flete:      { "que_transporta": "heladera", "piso_origen": "PB", "ascensor": false }
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_form_data JSONB;

-- Logística (flete): ORIGEN + DESTINO. NULL en reparacion/obra (que usan client_lat/lng/address).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_lat       DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_lng       DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_address   TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS delivery_lat     DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS delivery_lng     DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS delivery_address TEXT;

-- Varias fotos del problema (obra/flete). La columna vieja problem_photo_url se mantiene intacta.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS problem_photo_urls TEXT[];

-- Índice para filtrar por tipo cuando haga falta (barato, no obligatorio).
CREATE INDEX IF NOT EXISTS jobs_job_type_idx ON jobs (job_type);

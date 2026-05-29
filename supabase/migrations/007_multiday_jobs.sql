-- =====================================================
-- VOLT — Migración 007: Trabajos multi-día
-- Ejecutar en Supabase SQL Editor DESPUÉS de 006
-- =====================================================

-- ─── JOBS: soporte para trabajos de varios días ──────────────────────────────
--
-- Un trabajo multi-día funciona con sesiones: el trabajador hace check-in
-- al empezar el día y check-out al terminar. El sistema acumula horas.
-- El cliente puede ver el progreso diario.
-- El pago sigue siendo único al finalizar todas las sesiones.
--
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS is_multiday           BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimated_sessions    INT,
  ADD COLUMN IF NOT EXISTS estimated_hrs_session TEXT,
  ADD COLUMN IF NOT EXISTS completed_sessions    INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_session_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_minutes_worked  INT         NOT NULL DEFAULT 0;

-- ─── RLS: permitir que el profesional actualice sesiones ─────────────────────
-- La política jobs_update_parties ya cubre estas columnas.
-- Solo verificamos que el trigger de cancelación no bloquee los cambios de
-- sesión. Como no cambiamos el status a 'cancelled', no hay conflicto.

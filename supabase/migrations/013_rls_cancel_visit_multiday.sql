-- =====================================================
-- VOLT — Migración 013: RLS cancel + visita + multi-día
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- ─── 1. Fix trigger de cancelación ──────────────────────────────────────────
-- Antes: bloqueaba TODO cancel desde awaiting_payment (incluido el trabajador)
-- Ahora: el TRABAJADOR puede cancelar desde awaiting_payment ("cliente no paga")
--        el CLIENTE no puede cancelar desde in_progress ni awaiting_payment
CREATE OR REPLACE FUNCTION check_cancellation_allowed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'cancelled' THEN

    -- Nunca cancelar un trabajo ya completado
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'No se puede cancelar un trabajo completado';
    END IF;

    -- El cliente NO puede cancelar si el trabajo ya está en progreso o pendiente de pago
    -- (evita que obtenga trabajo gratis)
    IF OLD.status IN ('in_progress', 'awaiting_payment') THEN
      IF NEW.cancelled_by IS NOT NULL AND NEW.cancelled_by = OLD.client_id THEN
        RAISE EXCEPTION 'El cliente no puede cancelar un trabajo en progreso o pendiente de pago';
      END IF;
    END IF;

    -- El trabajador NO puede cancelar desde in_progress (debe terminarlo)
    -- Sí puede cancelar desde awaiting_payment ("cliente no quiere pagar")
    IF OLD.status = 'in_progress' THEN
      IF NEW.cancelled_by IS NOT NULL AND EXISTS (
        SELECT 1 FROM professionals p
        WHERE p.id = OLD.professional_id AND p.user_id = NEW.cancelled_by
      ) THEN
        RAISE EXCEPTION 'El profesional no puede cancelar un trabajo en progreso';
      END IF;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_cancellation ON jobs;
CREATE TRIGGER trg_check_cancellation
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION check_cancellation_allowed();

-- ─── 2. Columna visit_paid ───────────────────────────────────────────────────
-- true cuando el cliente ya pagó la visita/diagnóstico
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visit_paid boolean NOT NULL DEFAULT false;

-- ─── 3. Columna scheduled_return (multi-día) ─────────────────────────────────
-- timestamp en que el trabajador regresa al día siguiente
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_return timestamptz;

-- ─── 4. Verificar ───────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs'
-- AND column_name IN ('visit_paid', 'scheduled_return');

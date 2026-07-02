-- =====================================================
-- VOLT — Migración 025: tapar agujeros detectados en PROD (2026-06-02)
-- Diagnóstico: faltaba la 013 completa (visit_paid + scheduled_return +
-- trigger de cancelación), la tabla payment_profiles (023), y los ALTER
-- PUBLICATION de job_events y messages (Realtime). Todo idempotente.
-- Ejecutar en Supabase SQL Editor.
-- =====================================================

-- ─── 1. (de 013) Trigger de cancelación ──────────────────────────────────────
CREATE OR REPLACE FUNCTION check_cancellation_allowed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'cancelled' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'No se puede cancelar un trabajo completado';
    END IF;
    IF OLD.status IN ('in_progress', 'awaiting_payment') THEN
      IF NEW.cancelled_by IS NOT NULL AND NEW.cancelled_by = OLD.client_id THEN
        RAISE EXCEPTION 'El cliente no puede cancelar un trabajo en progreso o pendiente de pago';
      END IF;
    END IF;
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

-- ─── 2. (de 013) Columnas faltantes en jobs ──────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visit_paid       boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_return timestamptz;

-- ─── 3. (de 023) Tabla payment_profiles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mp_customer_id text NOT NULL,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE payment_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_profiles_own_select" ON payment_profiles;
CREATE POLICY "payment_profiles_own_select" ON payment_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ─── 4. Realtime: agregar job_events y messages (idempotente) ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'job_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE job_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

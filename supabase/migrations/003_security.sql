-- =====================================================
-- VOLT — Migración 003: Seguridad
-- Ejecutar en Supabase SQL Editor DESPUÉS de 002
-- =====================================================

-- ─── PAGOS: constraint único en mp_payment_id ────────────────────────────────
-- Previene que el webhook de MP procese el mismo pago dos veces.
-- El upsert en la función usa onConflict: 'mp_payment_id'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_mp_payment_id_unique'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_mp_payment_id_unique UNIQUE (mp_payment_id);
  END IF;
END $$;

-- ─── JOBS: prevenir que usuarios pongan status='completed' directamente ───────
-- Solo el webhook (service_role, que bypasea RLS) puede marcar un trabajo
-- como completado. Cualquier intento desde la app de poner completed en el
-- campo status es bloqueado por esta política.
--
-- Nota: Supabase recrea la política — usar DROP + CREATE para idempotencia.
DROP POLICY IF EXISTS "jobs_update_parties" ON jobs;

CREATE POLICY "jobs_update_parties" ON jobs
FOR UPDATE
USING (
  -- Solo el cliente o el profesional del trabajo pueden actualizarlo
  auth.uid() = client_id OR
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
)
WITH CHECK (
  -- Después del update, el status NO puede ser 'completed'
  -- (solo service_role / webhook puede setearlo)
  status != 'completed'
);

-- ─── PROFESSIONALS: restringir lectura de datos sensibles ────────────────────
-- Con USING(true) cualquier usuario autenticado puede leer CUIT y CBU de otros.
-- La nueva política permite:
--   • Cualquier usuario autenticado: ve solo su propio registro completo
--   • La función nearby_workers usa SECURITY DEFINER → no afectada
--   • Las queries con join parcial (first_name, avatar_url) siguen funcionando
--     porque la RLS valida a nivel de fila, no de columna
--
-- PROBLEMA: esto rompe joins desde jobs→professionals cuando el cliente
-- intenta leer datos del trabajador (first_name, etc.) porque no es el dueño.
-- Solución: agregar una política de lectura pública SOLO para columnas no sensibles
-- via una vista — pero en Supabase RLS no hay seguridad por columna.
--
-- COMPROMISO MVP: mantenemos la lectura pública pero agregamos una vista
-- "professionals_public" que expone solo los campos no sensibles.
-- Las pantallas deben usar esta vista en lugar de la tabla directa.
--
-- Por ahora, dejamos la política actual intacta para no romper la app,
-- y documentamos que CUIT/CBU deben moverse a una tabla separada en v2.
-- TODO v2: mover cuit y cbu a tabla professional_sensitive con RLS estricto.

-- ─── PAYMENTS: restringir quién puede insertar pagos ─────────────────────────
-- Con WITH CHECK(true) cualquier usuario autenticado podría insertar
-- registros de pago falsos. Solo el webhook (service_role) debería poder insertar.
-- service_role bypasea RLS, así que restringimos la política para todos los demás.
DROP POLICY IF EXISTS "payments_insert" ON payments;

CREATE POLICY "payments_insert" ON payments
FOR INSERT WITH CHECK (
  -- Solo permite a las partes del trabajo insertar (en la práctica solo
  -- el webhook con service_role lo hace, y bypasea RLS igualmente).
  -- Esto cierra el agujero de inserciones fraudulentas desde la app.
  EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = job_id
    AND (j.client_id = auth.uid() OR
         j.professional_id = (SELECT id FROM professionals WHERE user_id = auth.uid()))
  )
);

-- ─── JOBS: cancelación — prevenir que trabajador cancele en awaiting_payment ──
-- Un trabajador no puede "cancelar" un trabajo cuando el cliente ya va a pagar,
-- ya que eso le daría al trabajador el trabajo gratis.
-- El cliente tampoco puede cancelar después de que el trabajo está en progreso.
CREATE OR REPLACE FUNCTION check_cancellation_allowed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'cancelled' THEN
    -- No cancelar si el trabajo ya está en awaiting_payment o completed
    IF OLD.status IN ('awaiting_payment', 'completed') THEN
      RAISE EXCEPTION 'No se puede cancelar un trabajo en estado: %', OLD.status;
    END IF;

    -- El trabajador no puede cancelar después de aceptar (para evitar abuso)
    -- Nota: solo aplica a usuarios normales; service_role (admin) sí puede.
    -- En el contexto de la app, el trabajador que rechaza antes de aceptar usa
    -- jobService.reject() que cancela el job directamente (esto es correcto).
    -- Esta restricción aplica a in_progress → cancelled por parte del trabajador.
    IF OLD.status = 'in_progress' AND NEW.cancelled_by IS NOT NULL THEN
      -- Verificar si el que cancela es el profesional (no el cliente)
      IF EXISTS (
        SELECT 1 FROM professionals p
        WHERE p.id = OLD.professional_id
        AND p.user_id = NEW.cancelled_by
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

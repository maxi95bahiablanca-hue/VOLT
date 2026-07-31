-- 038 — Destrabar "Finalizar trabajo" en modo gratis
--
-- 🔴 EL BUG (31-jul-2026): un trabajo que llegó a `awaiting_payment` NO SE PUEDE
-- CERRAR NUNCA. El trigger `protect_job_money_fields` (migración 028) hace:
--
--     IF NEW.status = 'completed' AND OLD.status = 'awaiting_payment' THEN
--       RAISE EXCEPTION 'Un trabajo pendiente de pago solo lo completa el sistema de pagos';
--
-- Eso tenía sentido cuando el pago pasaba por Mercado Pago dentro de la app. Pero
-- BOLT está en MONETIZATION_MODE='free' (src/config/monetization.js): el cliente
-- le paga directo al profesional y NO existe ningún sistema de pagos que dispare
-- ese cambio. Resultado: el trabajador toca "Finalizar" y ve
-- "No se pudo finalizar el trabajo. Intentá de nuevo." para siempre.
--
-- Es exactamente el patrón que hay que evitar: un estado sin salida, esperando
-- una acción que nadie va a hacer.
--
-- ⚠️ Esta función se reescribe ENTERA (CREATE OR REPLACE), así que abajo están
-- TODAS las protecciones de la 028 tal cual estaban. Lo único que cambia es la
-- última: ahora exige que haya un pago REAL pendiente para bloquear el cierre.
--
-- Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.protect_job_money_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- El backend (service_role) y los roles internos de Supabase pasan siempre
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.visit_paid IS DISTINCT FROM OLD.visit_paid THEN
    RAISE EXCEPTION 'visit_paid solo lo confirma el sistema de pagos';
  END IF;

  IF NEW.visit_amount IS DISTINCT FROM OLD.visit_amount THEN
    RAISE EXCEPTION 'visit_amount no se puede modificar despues de crear el trabajo';
  END IF;

  IF NEW.commission_pct IS DISTINCT FROM OLD.commission_pct THEN
    RAISE EXCEPTION 'commission_pct no se puede modificar despues de crear el trabajo';
  END IF;

  IF OLD.status IN ('awaiting_payment', 'completed')
     AND (NEW.work_amount IS DISTINCT FROM OLD.work_amount
          OR NEW.materials_cost IS DISTINCT FROM OLD.materials_cost) THEN
    RAISE EXCEPTION 'Los montos no se pueden modificar cuando el trabajo espera pago o termino';
  END IF;

  -- ▼ LO ÚNICO QUE CAMBIA: sólo se bloquea el cierre si hay un pago de verdad
  --   esperando. Sin pagos en juego (modo gratis), cualquiera de las dos partes
  --   puede finalizar el trabajo.
  IF NEW.status = 'completed' AND OLD.status = 'awaiting_payment'
     AND EXISTS (SELECT 1 FROM payments p
                  WHERE p.job_id = OLD.id AND p.status <> 'approved') THEN
    RAISE EXCEPTION 'Un trabajo con un pago pendiente solo lo completa el sistema de pagos';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_job_money ON jobs;
CREATE TRIGGER trg_protect_job_money
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_job_money_fields();

-- Los que ya quedaron trabados (como el pedido de ayer): en modo gratis
-- `awaiting_payment` no es un estado válido — el trabajo está hecho y el pago se
-- arregla afuera. Se los devuelve a in_progress para que se puedan cerrar.
UPDATE jobs
   SET status = 'in_progress'
 WHERE status = 'awaiting_payment'
   AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.job_id = jobs.id AND p.status = 'approved');

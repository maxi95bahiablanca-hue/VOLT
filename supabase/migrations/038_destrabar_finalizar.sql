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
-- Arreglo: la excepción sólo corre si el trabajo tiene un pago REAL pendiente
-- (una fila en `payments` para ese job que todavía no se aprobó). Si no hay
-- ningún pago en juego, cualquiera de las dos partes puede cerrarlo.
--
-- Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.protect_job_money_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nadie toca los montos de un trabajo ya terminado.
  IF OLD.status = 'completed' AND (
       NEW.visit_amount IS DISTINCT FROM OLD.visit_amount OR
       NEW.work_amount  IS DISTINCT FROM OLD.work_amount
     ) THEN
    RAISE EXCEPTION 'No se pueden cambiar los montos de un trabajo terminado';
  END IF;

  -- Sólo se protege el cierre cuando hay plata de por medio de verdad.
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

-- Los que ya quedaron trabados: en modo gratis, `awaiting_payment` no es un
-- estado válido — el trabajo está hecho y el pago se arregla afuera.
UPDATE jobs
   SET status = 'in_progress'
 WHERE status = 'awaiting_payment'
   AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.job_id = jobs.id AND p.status = 'approved');

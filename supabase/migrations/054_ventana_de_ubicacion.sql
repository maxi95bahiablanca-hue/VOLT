-- 054 — La ubicacion se ve SOLO mientras va en camino
--
-- Maxi (5-ago-2026): "no se tiene que ver el GPS hasta que no este yendo el
-- profesional al domicilio, luego se deja de ver hasta la proxima visita...
-- porque hoy lo acepta al presupuesto, va manana a mirar el trabajo o hacerlo
-- y ve igual todo el dia por donde estan ambos".
--
-- LA CAUSA RAIZ: el mapa del cliente no mira NINGUN estado. La unica condicion
-- para dibujarlo es "no soy el trabajador" (JobTrackingScreen.js:1678), y la
-- suscripcion a la ubicacion tampoco filtra (linea 444). Asi que desde que
-- acepta hasta que el trabajo cierra -- y en multi-dia eso son DIAS, ver 037 y
-- 053 -- el cliente lo ve moverse por toda la ciudad.
--
-- LO QUE NO HAY QUE HACER: inventar una columna nueva. El concepto YA EXISTE.
-- La migracion 040 agrego jobs.on_the_way_at ("cuando salio de verdad") y la
-- pantalla de aceptacion ya pregunta "Cuando vas?" con Voy ahora / Hoy mas
-- tarde / Otro dia (WorkerIncomingScreen.js:519-530). O sea que la app YA sabe
-- distinguir "voy saliendo" de "voy manana". Lo que faltaba es que alguien
-- USARA ese dato para prender y apagar el mapa.
--
-- Entonces on_the_way_at pasa a ser el interruptor:
--   NULL     = no esta yendo  -> el cliente NO ve la ubicacion
--   con hora = va en camino   -> el cliente la ve
--
-- Y lo que faltaba: hasta hoy se ponia una sola vez y NUNCA se limpiaba. Ahora
-- se apaga al llegar, y se vuelve a prender en cada viaje.
--
-- Va sobre jobs a proposito: el cliente YA esta suscrito por realtime a su fila
-- (jobService.js:445 y JobTrackingScreen.js:249), asi que el mapa se prende y
-- se apaga solo, sin ninguna suscripcion nueva.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- ── 1. Contador de viajes ───────────────────────────────────────────────────
-- Un trabajo puede tener varios: ir a mirar, volver a hacerlo, volver a
-- terminarlo. Cada uno abre y cierra su propia ventana.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS viajes int NOT NULL DEFAULT 0;

COMMENT ON COLUMN jobs.viajes IS
  'Cuantas veces salio hacia el domicilio. Un trabajo de varios dias tiene varios viajes.';
COMMENT ON COLUMN jobs.on_the_way_at IS
  'INTERRUPTOR DE LA UBICACION. Con hora = va en camino y el cliente lo ve. NULL = no esta yendo y NO lo ve. Se limpia al llegar (054).';

-- Los trabajos que ya estan en curso arrancan con la ventana CERRADA. Si
-- alguno esta yendo de verdad, toca el boton y se abre. Preferimos que se vea
-- de menos y no de mas.
UPDATE jobs
   SET on_the_way_at = NULL
 WHERE on_the_way_at IS NOT NULL
   AND status IN ('arrived', 'in_progress', 'awaiting_payment', 'completed', 'cancelled');

-- ── 2. Salir hacia el domicilio ─────────────────────────────────────────────
-- Una sola accion del profesional hace las tres cosas: abre la ventana, genera
-- un codigo NUEVO y deja el evento para avisarle al cliente.
--
-- El codigo se regenera en CADA viaje a proposito. Antes se generaba una sola
-- vez al aceptar (jobService.js:115) y en un trabajo de varios dias el mismo
-- numero seguia sirviendo semanas: eso ya no es una seguridad de puerta.
CREATE OR REPLACE FUNCTION public.salir_al_domicilio(p_job_id uuid)
RETURNS TABLE (codigo text, viaje int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo text;
  v_viaje  int;
BEGIN
  -- Solo el profesional asignado puede salir hacia el domicilio.
  IF NOT EXISTS (
    SELECT 1 FROM jobs j
      JOIN professionals p ON p.id = j.professional_id
     WHERE j.id = p_job_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Este trabajo no es tuyo';
  END IF;

  -- Codigo de 4 digitos, con ceros a la izquierda si hace falta.
  v_codigo := lpad((floor(random() * 10000))::int::text, 4, '0');

  UPDATE jobs
     SET on_the_way_at     = now(),
         verification_code = v_codigo,
         viajes            = viajes + 1,
         -- Si ya habia llegado y vuelve otro dia, el estado retrocede a
         -- "yendo": es la verdad, y sin esto la linea de tiempo miente.
         status            = CASE WHEN status IN ('arrived', 'in_progress')
                                  THEN 'accepted'::job_status ELSE status END,
         sub_status        = NULL
   WHERE id = p_job_id
   RETURNING viajes INTO v_viaje;

  INSERT INTO job_events (job_id, event_type, message)
  VALUES (p_job_id, 'en_camino', 'El profesional salio hacia tu domicilio');

  RETURN QUERY SELECT v_codigo, v_viaje;
END;
$$;

REVOKE ALL ON FUNCTION public.salir_al_domicilio(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salir_al_domicilio(uuid) TO authenticated;

-- ── 3. Llegar cierra la ventana ─────────────────────────────────────────────
-- A partir de aca el cliente deja de ver donde esta: ya lo tiene en la puerta,
-- no hay nada mas que seguir.
CREATE OR REPLACE FUNCTION public.llegue_al_domicilio(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM jobs j
      JOIN professionals p ON p.id = j.professional_id
     WHERE j.id = p_job_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Este trabajo no es tuyo';
  END IF;

  UPDATE jobs
     SET status        = 'arrived',
         arrived_at    = COALESCE(arrived_at, now()),
         on_the_way_at = NULL,   -- se cierra la ventana
         sub_status    = NULL
   WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.llegue_al_domicilio(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.llegue_al_domicilio(uuid) TO authenticated;

-- ── 4. Nada queda con la ventana abierta ────────────────────────────────────
-- Regla del proyecto: ningun estado espera a que una persona apriete un boton.
-- Si alguien toca "voy en camino" y se olvida, la ventana se cierra sola a las
-- 3 horas. Nadie tarda 3 horas en llegar a un domicilio de la misma ciudad.
CREATE OR REPLACE FUNCTION public.cerrar_ventanas_olvidadas(p_horas int DEFAULT 3)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE jobs
     SET on_the_way_at = NULL
   WHERE on_the_way_at IS NOT NULL
     AND on_the_way_at < now() - make_interval(hours => p_horas);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_ventanas_olvidadas(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_ventanas_olvidadas(int) TO authenticated;

-- Y por las dudas de que nadie llame a la funcion: cualquier trabajo que sale
-- de los estados vivos deja la ventana cerrada, pase lo que pase.
CREATE OR REPLACE FUNCTION public.cerrar_ventana_al_terminar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('arrived', 'in_progress', 'awaiting_payment', 'completed', 'cancelled') THEN
    NEW.on_the_way_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cerrar_ventana ON jobs;
CREATE TRIGGER trg_cerrar_ventana
  BEFORE UPDATE OF status ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.cerrar_ventana_al_terminar();

-- ── 5. Verificacion ─────────────────────────────────────────────────────────
-- SELECT id, status, on_the_way_at, viajes, verification_code FROM jobs
--  WHERE status IN ('accepted','arrived','in_progress') ORDER BY created_at DESC;

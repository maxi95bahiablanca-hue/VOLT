-- 037 — La jornada se cierra sola (obras de varios días)
--
-- POR QUÉ (Maxi, 31-jul-2026): *"el trabajador no va a apretar terminar por
-- hoy, se va a olvidar o le va a dar paja"*. Y tiene razón: el que tiene que
-- registrar la jornada es justamente el que no gana nada con registrarla. A las
-- 7 de la tarde junta las cosas y se va.
--
-- Sin cerrar la jornada, `current_session_start` queda abierto para siempre:
-- las horas trabajadas se inflan solas y `completed_sessions` nunca avanza, así
-- que el trabajo no llega nunca al final.
--
-- Dos redes, no una:
--   1. ESTA función, que cierra sola lo que quedó abierto (camino 1).
--   2. El cliente, que puede decir "ya se fue por hoy" desde su pantalla
--      (camino 3, en web/pedir). El cliente SÍ tiene interés en que quede
--      registrado, porque es lo que va a pagar.
--
-- Seguro de correr varias veces.

-- Cuántas horas puede durar una jornada antes de darla por terminada.
-- 10 h cubre el día más largo de una obra real sin cortar a nadie en el medio.
CREATE OR REPLACE FUNCTION public.cerrar_jornadas_vencidas(p_horas int DEFAULT 10)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cerradas int;
BEGIN
  WITH vencidas AS (
    SELECT id, current_session_start
      FROM jobs
     WHERE is_multiday
       AND current_session_start IS NOT NULL
       AND status <> 'completed'
       AND status <> 'cancelled'
       AND current_session_start < now() - (p_horas || ' hours')::interval
  )
  UPDATE jobs j
     SET completed_sessions   = j.completed_sessions + 1,
         -- Se acreditan las horas del tope, no las que pasaron desde que
         -- arrancó: si nadie cerró, no sabemos hasta qué hora estuvo, y es
         -- preferible quedarse corto que cobrarle de más al cliente.
         total_minutes_worked = COALESCE(j.total_minutes_worked, 0) + (p_horas * 60),
         current_session_start = NULL,
         status               = 'arrived'
    FROM vencidas v
   WHERE j.id = v.id;

  GET DIAGNOSTICS v_cerradas = ROW_COUNT;
  RETURN v_cerradas;
END;
$$;

-- Que corra sola todas las noches. pg_cron no está en todos los proyectos, así
-- que si no existe la extensión esto no rompe la migración: queda la función y
-- el cierre lo dispara igual el cliente desde su pantalla.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cerrar-jornadas')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cerrar-jornadas');
    PERFORM cron.schedule('cerrar-jornadas', '0 3 * * *',
                          $cmd$SELECT public.cerrar_jornadas_vencidas(10);$cmd$);
    RAISE NOTICE 'cierre de jornadas programado a las 3 AM';
  ELSE
    RAISE NOTICE 'pg_cron no está instalado: la funcion queda lista para llamarla a mano o desde el cliente';
  END IF;
END $$;

-- El cliente cierra la jornada del día ("ya se fue por hoy"). Sólo puede
-- hacerlo el dueño del pedido, y sólo si hay una jornada abierta.
CREATE OR REPLACE FUNCTION public.cerrar_jornada_cliente(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_min int;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN 'no existe'; END IF;
  IF v_job.client_id <> auth.uid() THEN RETURN 'no es tu pedido'; END IF;
  IF v_job.current_session_start IS NULL THEN RETURN 'no hay jornada abierta'; END IF;

  v_min := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - v_job.current_session_start)) / 60));
  UPDATE jobs
     SET completed_sessions    = completed_sessions + 1,
         total_minutes_worked  = COALESCE(total_minutes_worked, 0) + v_min,
         current_session_start = NULL,
         status                = 'arrived'
   WHERE id = p_job_id;
  RETURN 'cerrada';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cerrar_jornada_cliente(uuid) TO authenticated;

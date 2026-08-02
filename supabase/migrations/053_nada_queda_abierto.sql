-- 053 — Ningun trabajo puede quedar abierto para siempre
--
-- 1-ago-2026. Maxi entro a bolt.com.ar/pedir desde el celular de Mariana y le
-- aparecio un trabajo "en curso" del 30 de MAYO, con el profesional trabajando
-- y sin ningun boton para salir de ahi: *"aparece el pedido en curso sin poder
-- cancelarlo... eso no debe pasar ni aunque sea nuevo"*.
--
-- Eran tres trabajos suyos en in_progress, del 30/05 y el 11/06, que nadie
-- termino nunca. Nada los cerraba: el estado esperaba que una persona apretara
-- un boton, y si esa persona no lo apretaba, el trabajo quedaba vivo para
-- siempre. Es exactamente lo que la regla de la casa prohibe: todo estado
-- necesita un vencimiento y una salida por defecto.
--
-- Se mide por INACTIVIDAD, no por antiguedad: un trabajo de varias jornadas se
-- estira semanas con toda la razon. Lo que no puede pasar es que no se mueva
-- durante dias y siga figurando como que esta pasando ahora.
--
-- awaiting_payment queda AFUERA a proposito: ahi hay plata de por medio y
-- cerrarlo solo seria decidir por los dos. Esos se revisan a mano.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.cerrar_trabajos_abandonados(
  p_dias  int DEFAULT 7,
  p_tope  int DEFAULT 30
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int := 0;
BEGIN
  WITH viejos AS (
    SELECT j.id
      FROM jobs j
     WHERE j.status IN ('accepted', 'arrived', 'in_progress')
       AND (
         -- (a) Sin movimiento ni conversacion durante p_dias.
         (
           GREATEST(
             j.created_at,
             COALESCE(j.accepted_at,       j.created_at),
             COALESCE(j.arrived_at,        j.created_at),
             COALESCE(j.work_started_at,   j.created_at),
             COALESCE(j.on_the_way_at,     j.created_at),
             COALESCE(j.ultima_jornada_at, j.created_at)
           ) < now() - (p_dias || ' days')::interval
           -- Un mensaje reciente en el chat tambien es movimiento: si se estan
           -- hablando, el trabajo esta vivo aunque no haya cambiado de estado.
           AND NOT EXISTS (
             SELECT 1 FROM messages m
              WHERE m.job_id = j.id
                AND m.created_at > now() - (p_dias || ' days')::interval
           )
         )
         -- (b) O directamente es viejisimo. Sin este tope, un solo mensaje
         --     nuevo revivia para siempre un trabajo de hace meses: al de
         --     Mariana del 11 de junio lo salvaba un mensaje de hoy, mandado
         --     justamente al descubrir el problema. Pasado p_tope no hay
         --     conversacion que lo justifique.
         OR j.created_at < now() - (p_tope || ' days')::interval
       )
  )
  UPDATE jobs
     SET status = 'cancelled',
         cancelled_at = now()
   WHERE id IN (SELECT id FROM viejos);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- La version de un solo argumento ya no existe: si quedara, la llamada del cron
-- podria volverse ambigua.
DROP FUNCTION IF EXISTS public.cerrar_trabajos_abandonados(int);

REVOKE ALL ON FUNCTION public.cerrar_trabajos_abandonados(int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_trabajos_abandonados(int, int) TO authenticated;

COMMENT ON FUNCTION public.cerrar_trabajos_abandonados(int, int) IS
  'Cierra los trabajos sin movimiento ni mensajes por p_dias, y los de mas de p_tope dias pase lo que pase. Corre solo cada hora por cron.';

-- Que corra solo. Si esperara a que alguien lo llame, seria otro estado que
-- depende de que una persona se acuerde: el mismo problema que arregla.
DO $$
BEGIN
  PERFORM cron.unschedule('cerrar-trabajos-abandonados');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cerrar-trabajos-abandonados',
  '23 * * * *',
  $cron$ SELECT public.cerrar_trabajos_abandonados(7) $cron$
);

-- Y los que ya estaban abandonados.
SELECT 'MIG053 cerrados=' || public.cerrar_trabajos_abandonados(7)::text
       || ' | quedan_abiertos=' || (
            SELECT count(*)::text FROM jobs
             WHERE status IN ('accepted', 'arrived', 'in_progress'))
       || ' | cron=' || coalesce((
            SELECT jobname || ' ' || schedule FROM cron.job
             WHERE jobname = 'cerrar-trabajos-abandonados'), 'NO PROGRAMADO') AS r;

-- 065 - Un pedido que no toma nadie tampoco puede quedar vivo para siempre
--
-- La migracion 053 cerro los trabajos abandonados, pero mira solo
-- `accepted / arrived / in_progress`. Los `pending` -- los que NADIE llego a
-- tomar -- quedaron afuera, y no hay nada mas que los cierre:
--
--   · La cascada (048) los va pasando de profesional en profesional, pero
--     cuando se acaba la fila no cancela nada a proposito ("eso lo decide quien
--     llama").
--   · El que llama es la pagina del cliente. Si el cliente cierra la pestania
--     -- que es exactamente lo que hace cuando se cansa de esperar -- no queda
--     nadie corriendo ese reloj.
--
-- 🔴 Consecuencia: el pedido queda `pending` para siempre. Y como
--    getActiveForClient incluye 'pending', la proxima vez que esa persona entra
--    a BOLT le aparece un "pedido en curso" de hace dias que no esta pasando.
--    Es el mismo problema que Maxi encontro el 1-ago con los trabajos de
--    Mariana, pero en el estado anterior.
--
-- LAS TRES PREGUNTAS DE LA REGLA:
--   1. Cuanto puede durar: 2 horas. La ventana de respuesta son 3 minutos y la
--      cascada recorre a todos los disponibles en minutos; a las 2 horas ya no
--      lo va a tomar nadie.
--   2. Que hace solo: lo cancela, con el motivo escrito. Se marca como
--      'timeout' para que el registro del profesional (job_offers, migracion
--      061) lo cuente como vencido y no como un rechazo suyo.
--   3. A quien se le avisa: el vigilante (062) ya escala a una persona el
--      pedido que nadie tomo, a la media hora -- mucho antes de que esto lo
--      cierre. O sea que cuando se cancela, ya hubo un aviso.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.cerrar_pedidos_sin_respuesta(p_horas int DEFAULT 2)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  WITH cerrados AS (
    UPDATE jobs
       SET status = 'cancelled',
           cancelled_at = now(),
           -- 'timeout' y no un motivo nuevo: es el que ya entiende el registro
           -- del profesional. Del lado de el la verdad es esa -- se le vencio
           -- el tiempo -- y no que lo haya rechazado.
           rejection_category = COALESCE(rejection_category, 'timeout'),
           rejection_note = COALESCE(rejection_note, 'Nadie lo tomo a tiempo')
     WHERE status = 'pending'
       AND created_at < now() - (p_horas || ' hours')::interval
    RETURNING 1
  )
  SELECT count(*)::int INTO n FROM cerrados;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_pedidos_sin_respuesta(int) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.cerrar_pedidos_sin_respuesta(int) IS
  'Cancela los pedidos que nadie tomo, para que el cliente no siga viendo un "pedido en curso" que no esta pasando.';

-- ─── Al mismo reloj que ya existe ───────────────────────────────────────────
-- El cron 'cerrar-trabajos-abandonados' ya corre cada hora. Se le suma esta
-- llamada en vez de crear otro: dos relojes para lo mismo se desincronizan y
-- despues nadie sabe cual limpio que.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'cerrar-trabajos-abandonados'),
  command := 'SELECT public.cerrar_trabajos_abandonados(7), public.cerrar_pedidos_sin_respuesta(2)'
);

-- 040 — El turno acordado, y el vigilante de trabajos trabados
--
-- DOS PROBLEMAS QUE SON EL MISMO (Maxi, 31-jul-2026):
--
-- 1. "hoy esta como para que ni bien acepta sale corriendo al domicilio, y eso
--    es algo que el 90% de los casos no va a suceder". El sistema no tiene donde
--    anotar CUANDO va a ir: apenas acepta, la linea de tiempo dice "va en
--    camino" y miente. Se agrega `scheduled_for`.
--
-- 2. "ninguna accion puede quedar trabada... si no se mueve, se busca la forma
--    de moverlo". Hace falta algo que MIRE los trabajos y detecte los que se
--    quedaron: aceptado y nunca fue, llego y nunca empezo, jornada abierta
--    hace medio dia, pedido sin respuesta.
--
-- Van juntos porque el vigilante necesita saber cuando estaba previsto que
-- fuera para poder decir "tenia que ir hace 2 horas y no se movio".
--
-- Sin acentos ni barras invertidas a proposito: este SQL se copia y pega.
-- Seguro de correr varias veces.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS scheduled_for   timestamptz,   -- cuando quedaron en que va
  ADD COLUMN IF NOT EXISTS scheduled_by    uuid,          -- quien lo propuso
  ADD COLUMN IF NOT EXISTS scheduled_ok    boolean NOT NULL DEFAULT false,  -- lo confirmo la otra parte
  ADD COLUMN IF NOT EXISTS on_the_way_at   timestamptz;   -- cuando salio de verdad

CREATE INDEX IF NOT EXISTS jobs_scheduled_for_idx ON jobs(scheduled_for)
  WHERE scheduled_for IS NOT NULL;

-- ─── El vigilante ────────────────────────────────────────────────────────────
-- Devuelve los trabajos que se quedaron, con el motivo y a quien hay que
-- preguntarle. No manda nada: solo dice que esta trabado y por que. Lo consume
-- el panel y, mas adelante, el aviso automatico.
CREATE OR REPLACE FUNCTION public.trabajos_trabados()
RETURNS TABLE (
  job_id      uuid,
  motivo      text,
  detalle     text,
  desde       timestamptz,
  client_id   uuid,
  worker_user uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Nadie lo tomo
  SELECT j.id, 'sin_respuesta',
         'Nadie acepto el pedido',
         j.created_at, j.client_id, NULL::uuid
    FROM jobs j
   WHERE j.status = 'pending'
     AND j.created_at < now() - interval '30 minutes'

  UNION ALL
  -- Acepto y nunca fue (o nunca dijo cuando iba)
  SELECT j.id, 'no_fue',
         CASE WHEN j.scheduled_for IS NULL
              THEN 'Acepto pero no quedo ninguna hora'
              ELSE 'Tenia turno y no se movio' END,
         COALESCE(j.scheduled_for, j.accepted_at), j.client_id, p.user_id
    FROM jobs j JOIN professionals p ON p.id = j.professional_id
   WHERE j.status = 'accepted'
     AND COALESCE(j.scheduled_for, j.accepted_at) < now() - interval '2 hours'

  UNION ALL
  -- Llego y nunca empezo
  SELECT j.id, 'no_empezo',
         'Llego al domicilio y no arranco el trabajo',
         j.arrived_at, j.client_id, p.user_id
    FROM jobs j JOIN professionals p ON p.id = j.professional_id
   WHERE j.status = 'arrived'
     AND j.arrived_at < now() - interval '1 hour'
     AND j.is_multiday IS NOT TRUE

  UNION ALL
  -- Jornada de obra abierta hace medio dia
  SELECT j.id, 'jornada_abierta',
         'Jornada sin cerrar',
         j.current_session_start, j.client_id, p.user_id
    FROM jobs j JOIN professionals p ON p.id = j.professional_id
   WHERE j.is_multiday
     AND j.current_session_start IS NOT NULL
     AND j.current_session_start < now() - interval '12 hours'

  UNION ALL
  -- El cliente escribio y nadie le contesto
  SELECT j.id, 'mensaje_sin_respuesta',
         'El cliente escribio y no le contestaron',
         m.created_at, j.client_id, p.user_id
    FROM jobs j
    JOIN professionals p ON p.id = j.professional_id
    JOIN LATERAL (
      SELECT created_at, sender_id FROM messages
       WHERE job_id = j.id ORDER BY created_at DESC LIMIT 1
    ) m ON true
   WHERE j.status IN ('accepted','arrived','in_progress')
     AND m.sender_id = j.client_id
     AND m.created_at < now() - interval '30 minutes';
$$;

GRANT EXECUTE ON FUNCTION public.trabajos_trabados() TO authenticated;

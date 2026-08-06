-- 062 - El vigilante deja de ser un cartel y pasa a avisar
--
-- La migracion 040 construyo `trabajos_trabados()`, que detecta bien los cinco
-- casos en que un trabajo se queda quieto. Pero decia, textual: "No manda nada:
-- solo dice que esta trabado y por que. Lo consume el panel".
--
-- 🔴 Y ahi esta el problema: el UNICO lugar donde se ve es el panel de admin.
--    O sea que para que un trabajo trabado se destrabe, alguien tiene que
--    acordarse de entrar a mirar una pantalla. Es exactamente el agujero que la
--    regla de la casa prohibe -- un estado que espera para siempre a que una
--    persona apriete un boton -- y ademas es el caso peor: el que tendria que
--    mirar (Maxi) no gana nada mirando, hasta que pierde un cliente.
--
-- Esta migracion agrega lo unico que faltaba: la memoria de a quien ya se le
-- pregunto. Sin eso, cualquier aviso automatico seria spam -- le llegaria el
-- mismo mensaje cada vez que corre el cron.
--
-- LAS TRES PREGUNTAS DE LA REGLA, respondidas:
--   1. Cuanto puede durar: lo define trabajos_trabados() (30 min sin respuesta,
--      2 h aceptado sin ir, 1 h llegado sin empezar, 12 h de jornada abierta,
--      30 min sin contestarle al cliente).
--   2. Que hace el sistema solo: le pregunta a la parte que corresponde. Al
--      profesional en casi todos los casos, porque es quien puede moverlo.
--   3. A quien se escala: si despues de DOS avisos sigue igual, a Maxi. Un
--      pedido que nadie tomo se le escala derecho: ahi no hay a quien
--      preguntarle.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

CREATE TABLE IF NOT EXISTS public.vigilante_avisos (
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  motivo      text NOT NULL,
  veces       int  NOT NULL DEFAULT 0,
  ultimo_at   timestamptz,
  escalado_at timestamptz,          -- cuando se le aviso a una persona
  PRIMARY KEY (job_id, motivo)
);

COMMENT ON TABLE public.vigilante_avisos IS
  'A quien ya se le pregunto por cada trabajo trabado, para no repetir el aviso en cada corrida del cron.';

-- Nadie la toca desde el navegador: la escribe la Edge Function con la clave de
-- servicio. Sin politicas de SELECT, con RLS puesta, queda cerrada a anon y a
-- authenticated -- que es lo que corresponde para una tabla de control interno.
ALTER TABLE public.vigilante_avisos ENABLE ROW LEVEL SECURITY;

-- ─── Quien puede resolver a mano ────────────────────────────────────────────
-- El escalado necesita saber a quien avisarle. Vive en la base y no escrito
-- duro en la Edge Function para poder sumar a alguien sin volver a desplegar.
CREATE TABLE IF NOT EXISTS public.avisos_a_persona (
  email  text PRIMARY KEY,
  activo boolean NOT NULL DEFAULT true
);

ALTER TABLE public.avisos_a_persona ENABLE ROW LEVEL SECURITY;

INSERT INTO public.avisos_a_persona (email)
VALUES ('maxi95.bahiablanca@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- ─── DOS BUGS DEL VIGILANTE, encontrados al ir a encenderlo ─────────────────
--
-- Mientras solo pintaba una lista en el panel, un falso positivo era un renglon
-- de mas. En cuanto empieza a mandar avisos, un falso positivo es un push
-- absurdo -- y con dos de esos, la persona silencia BOLT para siempre. Por eso
-- se revisa ANTES de encender.
--
-- 1. 🔴 `jornada_abierta` NO FILTRABA POR ESTADO. Pedia cualquier trabajo con
--    is_multiday y current_session_start viejo, incluidos los COMPLETADOS: al
--    terminar por otro camino, ese campo queda cargado y nadie lo limpia. En
--    produccion habia uno terminado el 15-JUNIO que el vigilante seguia dando
--    por trabado. Un trabajo terminado no tiene ninguna jornada que cerrar.
--
-- 2. Ningun caso tenia TOPE DE ANTIGUEDAD. Algo de hace dos meses no esta
--    "trabado": es historia, y de eso ya se ocupa cerrar_trabajos_abandonados
--    (053). Preguntarle hoy a alguien por un trabajo de junio no destraba nada
--    y hace quedar mal al sistema. Se limita a 30 dias.
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
     AND j.created_at > now() - interval '30 days'

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
     AND COALESCE(j.scheduled_for, j.accepted_at) > now() - interval '30 days'

  UNION ALL
  -- Llego y nunca empezo
  SELECT j.id, 'no_empezo',
         'Llego al domicilio y no arranco el trabajo',
         j.arrived_at, j.client_id, p.user_id
    FROM jobs j JOIN professionals p ON p.id = j.professional_id
   WHERE j.status = 'arrived'
     AND j.arrived_at < now() - interval '1 hour'
     AND j.arrived_at > now() - interval '30 days'
     AND j.is_multiday IS NOT TRUE

  UNION ALL
  -- Jornada de obra abierta hace medio dia
  SELECT j.id, 'jornada_abierta',
         'Jornada sin cerrar',
         j.current_session_start, j.client_id, p.user_id
    FROM jobs j JOIN professionals p ON p.id = j.professional_id
   WHERE j.is_multiday
     AND j.status IN ('accepted', 'arrived', 'in_progress')   -- 🔴 esto faltaba
     AND j.current_session_start IS NOT NULL
     AND j.current_session_start < now() - interval '12 hours'
     AND j.current_session_start > now() - interval '30 days'

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
     AND m.created_at < now() - interval '30 minutes'
     AND m.created_at > now() - interval '30 days';
$$;

GRANT EXECUTE ON FUNCTION public.trabajos_trabados() TO authenticated;

-- Y el dato que quedo sucio: un trabajo terminado no puede tener una jornada
-- en curso. Se limpia el campo, no el trabajo.
UPDATE jobs SET current_session_start = NULL
 WHERE current_session_start IS NOT NULL
   AND status IN ('completed', 'cancelled');

-- ─── De un mail a su usuario ────────────────────────────────────────────────
-- 🔴 Esta funcion NO puede quedar al alcance de nadie logueado: seria una forma
--    de averiguar si un mail cualquiera tiene cuenta en BOLT, y de sacar su id.
--    Se le revoca a public, anon y authenticated; solo la usa la Edge Function
--    con la clave de servicio.
CREATE OR REPLACE FUNCTION public.user_id_por_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_id_por_email(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_por_email(text) TO service_role;

-- ─── Limpiar lo que ya se destrabo ──────────────────────────────────────────
-- Si el trabajo se movio, el aviso viejo no puede quedar contando: si mas
-- adelante se traba otra vez, tiene que arrancar de cero y volver a
-- preguntarle. Sin esto, un trabajo que se traba dos veces se escala solo la
-- primera y la segunda pasa en silencio.
CREATE OR REPLACE FUNCTION public.vigilante_limpiar()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  WITH vivos AS (SELECT job_id, motivo FROM trabajos_trabados()),
  borrados AS (
    DELETE FROM vigilante_avisos v
     WHERE NOT EXISTS (
       SELECT 1 FROM vivos x WHERE x.job_id = v.job_id AND x.motivo = v.motivo
     )
    RETURNING 1
  )
  SELECT count(*)::int INTO n FROM borrados;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.vigilante_limpiar() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vigilante_limpiar() TO service_role;

COMMENT ON FUNCTION public.vigilante_limpiar() IS
  'Borra los avisos de los trabajos que ya se destrabaron, para que si vuelven a trabarse se les pregunte de nuevo.';

-- ─── El reloj ───────────────────────────────────────────────────────────────
--
-- Cada hora, pero SOLO de 8 a 22 de Argentina. pg_cron corre en UTC y
-- Argentina es UTC-3, asi que 11-23 y 0-1 UTC son las 8 a las 22 de aca.
--
-- 🔴 El horario no es un detalle: un push a las 4 de la manana preguntandole
--    "que terminaste por hoy" es la forma mas rapida de que alguien silencie
--    BOLT, y una vez silenciado ya no se entera de los trabajos tampoco.
--
-- La Edge Function `vigilante` es la que decide a quien preguntarle y cuando
-- escalar. Aca solo se la despierta.
DO $$
BEGIN
  PERFORM cron.unschedule('vigilante-bolt');
EXCEPTION WHEN OTHERS THEN
  NULL;   -- no existia todavia
END $$;

SELECT cron.schedule(
  'vigilante-bolt',
  '7 11-23,0-1 * * *',
  $$ select net.http_post(
       url := 'https://lyeqnvldemcltlbujlnc.supabase.co/functions/v1/vigilante',
       headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_4e50WLUuWTJ0u2DN6HPUNw_FeIdsV-0"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);

-- ═══════════════════════════════════════════════════════════════════════════
--  071 — A todos los aprueba Maxi, y se entera en el momento
--
--  11-ago-2026. Maxi: "a todos los apruebo yo igual desde el panel, no importa
--  qué link use.. yo quiero verlo. y cuando haya un nuevo registro que me avise
--  por notificación".
--
--  Hasta hoy había TRES caminos que dejaban a alguien aprobado y visible para
--  los clientes sin que nadie lo mirara:
--    1. Desde la app / la consola, tocando verification_status  → lo cerró la 069
--    2. activar_prestador() — el link personal del lead          → lo cierra ésta
--    3. armar_ficha_al_aceptar() — al aceptar el lead en el panel→ lo cierra ésta
--  (y un cuarto, el formulario de la calle con ?nuevo=1, que escribe 'approved'
--   desde el navegador: ese es del lado web y se saca junto con esta migración).
--
--  Ahora los tres nacen 'pending' con el radar apagado. Lo que esas funciones
--  SIGUEN haciendo, porque es lo valioso: vincular el lead con la cuenta y
--  cargarle los oficios. Cuando Maxi aprueba desde el panel, la ficha ya está
--  completa y el candado de la 067 (no aprobar sin oficio) se cumple solo.
--
--  ⚠️ EFECTO SECUNDARIO BUENO: esto cierra también el crítico "aceptar a un
--  prestador nuevo revienta" — reventaba porque insertaba la ficha como
--  'approved' ANTES de cargarle el oficio y la 067 lo rechazaba. Insertando
--  'pending' ya no hay conflicto.
--
--  ⚠️ Y CUESTA ALGO, que quede escrito: el que se anota ya no queda operativo
--  solo. Si Maxi no aprueba, no le llega ningún trabajo. Por eso la segunda
--  mitad de esta migración es el aviso.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.activar_prestador(p_user_id uuid, p_email text, p_telefono text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l        RECORD;
  pid      uuid;
  n_ofic   int := 0;
  tel8     text;
  hallado  boolean := false;
BEGIN
  -- 1) Por email, como siempre.
  --    Ojo: no se puede usar FOUND para decidir. Si el email viene vacio no
  --    corre ningun SELECT y FOUND queda con el valor del comando anterior,
  --    que podria ser true por otra cosa. Por eso una variable propia.
  IF p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
    SELECT * INTO l
      FROM prestador_leads
     WHERE lower(TRIM(email)) = lower(TRIM(p_email))
       AND user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1;
    hallado := FOUND;
  END IF;

  -- 2) Si no aparecio, por TELEFONO. El mail se cambia; el telefono no.
  --    Se comparan los ultimos 8 digitos: el mismo numero se escribe de
  --    cuatro formas distintas (con 9, sin 9, sin pais, con el 15 viejo).
  IF NOT hallado AND p_telefono IS NOT NULL THEN
    tel8 := right(regexp_replace(p_telefono, '[^0-9]', '', 'g'), 8);
    IF length(tel8) = 8 THEN
      SELECT * INTO l
        FROM prestador_leads
       WHERE user_id IS NULL
         AND right(regexp_replace(COALESCE(telefono, ''), '[^0-9]', '', 'g'), 8) = tel8
       ORDER BY created_at DESC
       LIMIT 1;
      hallado := FOUND;
    END IF;
  END IF;

  IF NOT hallado THEN
    RETURN 'no es prestador cargado';
  END IF;

  UPDATE prestador_leads SET user_id = p_user_id WHERE id = l.id;

  SELECT id INTO pid FROM professionals WHERE user_id = p_user_id;
  IF pid IS NULL THEN
    INSERT INTO professionals (
      user_id, first_name, last_name, phone,
      criminal_record_confirmed, verification_status, available
    ) VALUES (
      p_user_id,
      COALESCE(NULLIF(TRIM(l.nombre), ''), 'Sin nombre'),
      COALESCE(NULLIF(TRIM(l.apellido), ''), ''),
      COALESCE(REGEXP_REPLACE(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), ''),
      false,
      -- 🔴 11-ago-2026 — NACE PENDIENTE Y CON EL RADAR APAGADO.
      --    Maxi: "a todos los apruebo yo igual desde el panel, no importa qué
      --    link use.. yo quiero verlo". Antes este camino dejaba a alguien
      --    aprobado y visible para los clientes sin que nadie lo mirara, que es
      --    el mismo agujero que la 069 cerró del lado de la app.
      'pending',
      false
    )
    RETURNING id INTO pid;
  ELSE
    -- 🔴 11-ago-2026 — Ya tenía ficha: NO se le toca el estado.
    --    Si estaba pendiente, sigue pendiente hasta que Maxi lo apruebe; si ya
    --    estaba aprobado, no se lo degrada ni se le prende el radar por haber
    --    vuelto a pasar por el link.
    NULL;
  END IF;

  -- 3a) Oficios de la tabla normalizada (el camino nuevo).
  INSERT INTO professional_professions (professional_id, profession_id, min_price)
  SELECT pid, lp.profesion_id, 0
    FROM prestador_lead_profesiones lp
   WHERE lp.lead_id = l.id
     AND lp.profesion_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM professional_professions pp
        WHERE pp.professional_id = pid AND pp.profession_id = lp.profesion_id
     );
  GET DIAGNOSTICS n_ofic = ROW_COUNT;

  -- 3b) 🔴 Y SI NO HABIA NINGUNA, del texto libre. Sin esto la persona queda
  --     aprobada sin oficio y el sistema no la encuentra nunca (caso Macarena).
  IF n_ofic = 0 AND COALESCE(TRIM(l.profesion), '') NOT IN ('', 'A completar') THEN
    INSERT INTO professional_professions (professional_id, profession_id, min_price)
    SELECT DISTINCT pid, pr.id, 0
      FROM professions pr
     WHERE lower(TRIM(pr.name)) = ANY (
             SELECT lower(TRIM(x)) FROM unnest(string_to_array(l.profesion, ',')) AS x
           )
       AND NOT EXISTS (
         SELECT 1 FROM professional_professions pp
          WHERE pp.professional_id = pid AND pp.profession_id = pr.id
       );
    GET DIAGNOSTICS n_ofic = ROW_COUNT;
  END IF;

  RETURN 'ACTIVADO: ' || COALESCE(l.nombre, '') || ' ' || COALESCE(l.apellido, '')
         || ' con ' || n_ofic || ' oficio(s), radar prendido';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.armar_ficha_al_aceptar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
BEGIN
  -- Sin cuenta todavia no hay nada que armar: cuando entre, el trigger de
  -- auth.users lo agarra por email o por telefono.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO pid FROM professionals WHERE user_id = NEW.user_id;

  IF pid IS NULL THEN
    INSERT INTO professionals (
      user_id, first_name, last_name, phone,
      criminal_record_confirmed, verification_status, available
    ) VALUES (
      NEW.user_id,
      COALESCE(NULLIF(TRIM(NEW.nombre), ''), 'Sin nombre'),
      COALESCE(NULLIF(TRIM(NEW.apellido), ''), ''),
      COALESCE(REGEXP_REPLACE(COALESCE(NEW.telefono, ''), '[^0-9]', '', 'g'), ''),
      -- 🔴 11-ago-2026 — pendiente y con el radar apagado: lo aprueba Maxi.
      false, 'pending', false
    )
    RETURNING id INTO pid;
  ELSE
    -- 🔴 11-ago-2026 — sólo se completa el teléfono si falta. El estado y el
    --    radar no se tocan: la aprobación es de Maxi, desde el panel.
    UPDATE professionals
       SET phone = CASE
                     WHEN COALESCE(phone, '') = ''
                     THEN REGEXP_REPLACE(COALESCE(NEW.telefono, ''), '[^0-9]', '', 'g')
                     ELSE phone
                   END
     WHERE id = pid;
  END IF;

  -- Oficios: primero la tabla normalizada.
  INSERT INTO professional_professions (professional_id, profession_id, min_price)
  SELECT pid, lp.profesion_id, 0
    FROM prestador_lead_profesiones lp
   WHERE lp.lead_id = NEW.id
     AND lp.profesion_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM professional_professions pp
        WHERE pp.professional_id = pid AND pp.profession_id = lp.profesion_id
     );

  -- Y si el lead traia el oficio suelto en la columna, tambien.
  IF NEW.profesion_id IS NOT NULL THEN
    INSERT INTO professional_professions (professional_id, profession_id, min_price)
    SELECT pid, NEW.profesion_id, 0
     WHERE NOT EXISTS (
       SELECT 1 FROM professional_professions pp
        WHERE pp.professional_id = pid AND pp.profession_id = NEW.profesion_id
     );
  END IF;

  -- Ultimo recurso: el texto. 'A completar' no es un oficio, se ignora.
  IF COALESCE(TRIM(NEW.profesion), '') NOT IN ('', 'A completar') THEN
    INSERT INTO professional_professions (professional_id, profession_id, min_price)
    SELECT DISTINCT pid, pr.id, 0
      FROM professions pr
     WHERE lower(TRIM(pr.name)) = ANY (
             SELECT lower(TRIM(x)) FROM unnest(string_to_array(NEW.profesion, ',')) AS x
           )
       AND NOT EXISTS (
         SELECT 1 FROM professional_professions pp
          WHERE pp.professional_id = pid AND pp.profession_id = pr.id
       );
  END IF;

  RETURN NEW;
END;
$function$
;

-- ═══════════════════════════════════════════════════════════════════════════
--  El aviso: "se anotó alguien nuevo"
--
--  Va por el mismo camino que el latido de los pedidos (migración 066): pg_net
--  dispara la Edge Function, que sabe quién está de guardia (avisos_a_persona)
--  y le manda el push. Una sola lista para todo, así no hay dos que se
--  desincronizan.
--
--  🔴 pg_net es asíncrono a propósito y todo va adentro de un exception: que
--     un aviso que no sale NUNCA pueda voltear un registro. Perder el aviso es
--     molesto; perder el alta de un profesional es perder un profesional.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.avisar_prestador_nuevo(p_id uuid, p_nombre text, p_como text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://lyeqnvldemcltlbujlnc.supabase.co/functions/v1/latido',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_4e50WLUuWTJ0u2DN6HPUNw_FeIdsV-0'
               ),
    body    := jsonb_build_object(
                 'evento',       'prestador_nuevo',
                 'prestador_id', p_id,
                 'nombre',       p_nombre,
                 'como',         p_como,
                 'ocurrido', to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI')
               )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'aviso de prestador nuevo: no pude avisar de %: %', p_id, sqlerrm;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_avisar_prestador_nuevo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Se anotó alguien.
  IF TG_OP = 'INSERT' THEN
    PERFORM public.avisar_prestador_nuevo(
      NEW.id,
      TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')),
      'se registró'
    );
    RETURN NEW;
  END IF;

  -- O volvió a la cola de revisión (re-alta, o alguien que estaba rechazado).
  IF NEW.verification_status = 'pending'
     AND OLD.verification_status IS DISTINCT FROM 'pending' THEN
    PERFORM public.avisar_prestador_nuevo(
      NEW.id,
      TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')),
      'volvió a quedar pendiente'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER, no BEFORE: sólo se avisa de lo que ya quedó guardado.
DROP TRIGGER IF EXISTS trg_avisar_prestador_nuevo ON public.professionals;
CREATE TRIGGER trg_avisar_prestador_nuevo
  AFTER INSERT OR UPDATE OF verification_status ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.trg_avisar_prestador_nuevo();

COMMENT ON TRIGGER trg_avisar_prestador_nuevo ON public.professionals IS
  'Maxi se entera en el momento de cada registro nuevo, porque ahora los aprueba él (11-ago-2026).';

-- 049 — Que entrar a la app alcance para poder trabajar
--
-- Maxi (1-ago-2026): "mi objetivo es que el dia uno que el mundo entero pueda
-- descargarla en Play Store, ellos ya tengan la app bajada con el radar activo.
-- Se tienen que conectar con la cuenta al entrar con la app y activar el radar,
-- y con eso ya tienen que poder recibir trabajos sin depender de un error".
--
-- El camino tenia tres puntos donde se rompia EN SILENCIO:
--   1. Se reconocia SOLO por email. Quien se anoto con un mail y entra con otro
--      Google —muy comun— quedaba como usuario nuevo, sin ficha de profesional.
--      Le puede pasar a Nestor (hotmail) y a Ricardo (live).
--   2. Los oficios se copiaban solo de la tabla normalizada. Si el lead los
--      tenia como TEXTO (los registros viejos y los del formulario de a pie),
--      la persona quedaba aprobada SIN OFICIO — invisible para el sistema, que
--      busca por oficio. Le paso a Macarena: tres dias asi.
--   3. El radar nacia apagado. Quien se anota para recibir trabajo quiere
--      recibir trabajo: que tenga que descubrir un boton para eso es ponerle
--      una traba al que ya dijo que si. El que no quiera, lo apaga.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- La version vieja se BORRA, no se deja al lado. Si quedaran las dos, la
-- llamada de dos argumentos que hace el trigger seria ambigua y Postgres
-- cortaria con "function is not unique": nadie mas podria crear una cuenta.
DROP FUNCTION IF EXISTS public.activar_prestador(uuid, text);

CREATE OR REPLACE FUNCTION public.activar_prestador(
  p_user_id  uuid,
  p_email    text,
  p_telefono text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      'approved',
      true          -- 🔴 el radar nace PRENDIDO
    )
    RETURNING id INTO pid;
  ELSE
    -- Ya tenia ficha: se aprueba y se pone disponible si estaba esperando.
    UPDATE professionals
       SET verification_status = 'approved',
           available = COALESCE(available, false) OR (verification_status <> 'approved')
     WHERE id = pid;
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
$$;

REVOKE ALL ON FUNCTION public.activar_prestador(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.activar_prestador(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.activar_prestador(uuid, text, text) IS
  'Vincula a quien entra con su registro: por email o por telefono. Deja la ficha aprobada, con oficio y con el radar prendido.';

-- El trigger de auth.users tiene que volver a compilarse: la funcion que
-- llamaba ya no existe con esa firma. Ahora le pasa tambien el telefono, que
-- puede venir del alta por SMS o de lo que la app haya guardado en la ficha.
CREATE OR REPLACE FUNCTION public.activar_prestador_al_registrarse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 🔴 El EXCEPTION no es opcional: si esto falla y no se atrapa, aborta el
  -- INSERT en auth.users y NADIE puede crear una cuenta en BOLT.
  BEGIN
    PERFORM public.activar_prestador(
      NEW.id,
      NEW.email,
      COALESCE(
        NEW.phone,
        NEW.raw_user_meta_data ->> 'phone',
        NEW.raw_user_meta_data ->> 'telefono'
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activar_prestador ON auth.users;
CREATE TRIGGER trg_activar_prestador
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.activar_prestador_al_registrarse();

-- Verificacion: las dos funciones quedan con la firma nueva y el trigger vivo.
SELECT 'MIG049 ' ||
       (SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' // ')
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'activar_prestador') ||
       ' | trigger=' ||
       (SELECT COUNT(*)::text FROM pg_trigger
         WHERE tgname = 'trg_activar_prestador' AND NOT tgisinternal) AS r;

-- ════════════════════════════════════════════════════════════════════════════
-- 083 — Auditoría 23-ago: para que el candado de DNI (082) no trabe el flujo real.
-- Los documentos del prestador se cargan en prestador_leads (dni_frente_url,
-- dni_dorso_url, selfie_url) pero el trigger 082 los exige en professionals
-- (dni_front_url, dni_back_url, selfie_url). Acá se copian: a los ya vinculados de
-- una vez, y en activar_prestador para los que se vinculen de ahora en más.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Copiar los docs de cada lead a la ficha ya vinculada que no los tenga.
UPDATE professionals p
   SET selfie_url    = COALESCE(p.selfie_url,    l.selfie_url),
       dni_front_url = COALESCE(p.dni_front_url, l.dni_frente_url),
       dni_back_url  = COALESCE(p.dni_back_url,  l.dni_dorso_url)
  FROM prestador_leads l
 WHERE l.user_id = p.user_id
   AND (p.selfie_url IS NULL OR p.dni_front_url IS NULL OR p.dni_back_url IS NULL);

-- 2) activar_prestador: al crear/vincular la ficha, traer también los documentos
--    del lead (misma función de la 075, con el candado auth.uid y el RETURN
--    'VINCULADO', más las tres columnas de documentos).
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
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'solo podes activar tu propia cuenta';
  END IF;

  IF p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
    SELECT * INTO l FROM prestador_leads
     WHERE lower(TRIM(email)) = lower(TRIM(p_email)) AND user_id IS NULL
     ORDER BY created_at DESC LIMIT 1;
    hallado := FOUND;
  END IF;

  IF NOT hallado AND p_telefono IS NOT NULL THEN
    tel8 := right(regexp_replace(p_telefono, '[^0-9]', '', 'g'), 8);
    IF length(tel8) = 8 THEN
      SELECT * INTO l FROM prestador_leads
       WHERE user_id IS NULL
         AND right(regexp_replace(COALESCE(telefono, ''), '[^0-9]', '', 'g'), 8) = tel8
       ORDER BY created_at DESC LIMIT 1;
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
      criminal_record_confirmed, verification_status, available,
      selfie_url, dni_front_url, dni_back_url
    ) VALUES (
      p_user_id,
      COALESCE(NULLIF(TRIM(l.nombre), ''), 'Sin nombre'),
      COALESCE(NULLIF(TRIM(l.apellido), ''), ''),
      COALESCE(REGEXP_REPLACE(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), ''),
      false, 'pending', false,
      l.selfie_url, l.dni_frente_url, l.dni_dorso_url
    )
    RETURNING id INTO pid;
  ELSE
    -- Ya tenía ficha: no se toca el estado, pero se completan los docs si faltan.
    UPDATE professionals
       SET selfie_url    = COALESCE(selfie_url,    l.selfie_url),
           dni_front_url = COALESCE(dni_front_url, l.dni_frente_url),
           dni_back_url  = COALESCE(dni_back_url,  l.dni_dorso_url)
     WHERE id = pid;
  END IF;

  INSERT INTO professional_professions (professional_id, profession_id, min_price)
  SELECT pid, lp.profesion_id, 0
    FROM prestador_lead_profesiones lp
   WHERE lp.lead_id = l.id AND lp.profesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM professional_professions pp
        WHERE pp.professional_id = pid AND pp.profession_id = lp.profesion_id);
  GET DIAGNOSTICS n_ofic = ROW_COUNT;

  IF n_ofic = 0 AND COALESCE(TRIM(l.profesion), '') NOT IN ('', 'A completar') THEN
    INSERT INTO professional_professions (professional_id, profession_id, min_price)
    SELECT DISTINCT pid, pr.id, 0 FROM professions pr
     WHERE lower(TRIM(pr.name)) = ANY (
             SELECT lower(TRIM(x)) FROM unnest(string_to_array(l.profesion, ',')) AS x)
       AND NOT EXISTS (SELECT 1 FROM professional_professions pp
          WHERE pp.professional_id = pid AND pp.profession_id = pr.id);
    GET DIAGNOSTICS n_ofic = ROW_COUNT;
  END IF;

  RETURN 'VINCULADO: ' || COALESCE(l.nombre, '') || ' ' || COALESCE(l.apellido, '')
         || ' con ' || n_ofic || ' oficio(s), pendiente de aprobacion';
END;
$function$;

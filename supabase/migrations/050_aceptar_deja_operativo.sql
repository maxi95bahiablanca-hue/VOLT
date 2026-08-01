-- 050 — Aceptar a alguien en el panel tiene que dejarlo trabajando
--
-- Lo que le paso a Macarena: se anoto el 29-jul, la aceptaste, y estuvo tres
-- dias sin existir para el sistema. El motivo es que habia DOS caminos y solo
-- uno terminaba el trabajo:
--
--   camino A (se anota y despues se crea la cuenta)  -> activar_prestador
--            corre al crear la cuenta, encuentra el lead suelto, arma la ficha.
--            Este anda.
--   camino B (ya tiene cuenta y se anota desde la app o la web con Google)
--            -> el lead nace con user_id puesto. activar_prestador solo mira
--            los que tienen user_id NULL, asi que no lo ve nunca. Y ya corrio,
--            cuando la cuenta se creo, cuando el lead todavia no existia.
--            Nadie le armaba la ficha. Nunca.
--
-- El camino B es el que va a usar todo el mundo cuando la app este publicada:
-- primero bajan la app, entran con Google, y recien despues se anotan.
--
-- La red que faltaba: cuando el lead pasa a 'aceptado' —el momento en que
-- apretas Aceptar en el panel— la ficha se arma sola. No importa por que
-- camino haya entrado la persona.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.armar_ficha_al_aceptar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      false, 'approved', true
    )
    RETURNING id INTO pid;
  ELSE
    UPDATE professionals
       SET verification_status = 'approved',
           -- Si venia esperando, queda visible. Si ya estaba aprobado y eligio
           -- pausarse, se le respeta la pausa.
           available = COALESCE(available, false) OR (verification_status <> 'approved'),
           phone = CASE
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
$$;

-- Solo cuando el estado CAMBIA a aceptado. No se dispara con cualquier edicion,
-- y no puede entrar en bucle con activar_prestador, que nunca toca `estado`.
DROP TRIGGER IF EXISTS trg_armar_ficha_al_aceptar ON public.prestador_leads;
CREATE TRIGGER trg_armar_ficha_al_aceptar
AFTER UPDATE OF estado ON public.prestador_leads
FOR EACH ROW
WHEN (NEW.estado = 'aceptado' AND OLD.estado IS DISTINCT FROM NEW.estado)
EXECUTE FUNCTION public.armar_ficha_al_aceptar();

-- Y el caso del lead que nace ya aceptado (alta hecha desde el panel).
DROP TRIGGER IF EXISTS trg_armar_ficha_al_aceptar_ins ON public.prestador_leads;
CREATE TRIGGER trg_armar_ficha_al_aceptar_ins
AFTER INSERT ON public.prestador_leads
FOR EACH ROW
WHEN (NEW.estado = 'aceptado' AND NEW.user_id IS NOT NULL)
EXECUTE FUNCTION public.armar_ficha_al_aceptar();

SELECT 'MIG050 triggers=' ||
       (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
         WHERE NOT tgisinternal AND tgrelid = 'public.prestador_leads'::regclass) AS r;

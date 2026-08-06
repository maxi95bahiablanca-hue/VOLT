-- 064 - El oficio que se carga por el link personal tiene que llegar a la ficha
--
-- Cuando alguien se anota por WhatsApp le mandamos por mail un "link personal"
-- (completar.html) para que complete oficio, DNI y documentacion. Ese link
-- llama a la Edge Function `completar-registro`, que **solo hace UPDATE sobre
-- prestador_leads** y nada mas.
--
-- 🔴 O sea: la persona carga su oficio, la pantalla le dice que quedo todo
--    listo, y ese oficio NUNCA llega a professional_professions -- que es lo
--    unico que mira nearby_workers. Queda aprobada, convencida de que esta
--    lista, y no aparece en ninguna busqueda.
--
-- Es el mismo agujero que ya se cerro dos veces por otros caminos (el alta con
-- Google y el trigger de activacion), pero este quedo abierto. Hoy no esta
-- lastimando a nadie -- todos los que tienen ficha tienen sus oficios -- y por
-- eso conviene cerrarlo ahora, antes de que la primera persona lo pise.
--
-- POR QUE UN TRIGGER Y NO TOCAR LA EDGE FUNCTION: porque el agujero no es de
-- `completar-registro`. Cualquier cosa que escriba prestador_leads.profesion
-- -- el panel, un UPDATE a mano, un formulario nuevo -- tiene el mismo
-- problema. Puesto donde vive el dato, se cierra para todos los caminos, los
-- de hoy y los que vengan.
--
-- 🔴 NUNCA BORRA OFICIOS, solo agrega los que faltan. Si la persona eligio sus
--    oficios en la app y despues completa el lead, se suman: el lead es un dato
--    de registro, no la verdad sobre lo que sabe hacer.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.sincronizar_oficios_del_lead(p_lead_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l      RECORD;
  pid    uuid;
  n      int := 0;
  ya     int;
BEGIN
  SELECT * INTO l FROM prestador_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.user_id IS NULL THEN RETURN 0; END IF;

  SELECT id INTO pid FROM professionals WHERE user_id = l.user_id;
  IF pid IS NULL THEN RETURN 0; END IF;     -- todavia no tiene ficha

  -- El tope de 3 es el mismo del registro (MAX_PROFS). Si ya los tiene, no se
  -- le agrega nada: lo que eligio la persona manda sobre lo que dice el lead.
  SELECT count(*) INTO ya FROM professional_professions WHERE professional_id = pid;
  IF ya >= 3 THEN RETURN 0; END IF;

  -- (a) La tabla normalizada, que mantiene el trigger de la migracion 031.
  INSERT INTO professional_professions (professional_id, profession_id, min_price)
  SELECT pid, lp.profesion_id, 0
    FROM prestador_lead_profesiones lp
   WHERE lp.lead_id = l.id
     AND lp.profesion_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM professional_professions pp
        WHERE pp.professional_id = pid AND pp.profession_id = lp.profesion_id
     );
  GET DIAGNOSTICS n = ROW_COUNT;

  -- (b) Y si de ahi no salio nada, del texto libre separado por comas. Mismo
  --     criterio que activar_prestador: se compara contra el catalogo real, en
  --     minusculas y sin espacios, para no inventar oficios que no existen.
  IF n = 0 AND COALESCE(TRIM(l.profesion), '') NOT IN ('', 'A completar') THEN
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
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_oficios_del_lead(uuid) FROM public, anon;

COMMENT ON FUNCTION public.sincronizar_oficios_del_lead(uuid) IS
  'Copia a la ficha los oficios que el lead tenga y a la ficha le falten. Nunca borra: lo que eligio la persona en la app manda.';

CREATE OR REPLACE FUNCTION public.tg_oficios_del_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Envuelto a proposito: si esto falla, que NO se caiga el guardado del lead.
  -- La persona esta del otro lado completando un formulario y lo suyo se tiene
  -- que guardar igual; el oficio se puede reintentar despues.
  BEGIN
    PERFORM sincronizar_oficios_del_lead(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oficios_del_lead ON public.prestador_leads;
CREATE TRIGGER trg_oficios_del_lead
  AFTER INSERT OR UPDATE OF profesion, user_id ON public.prestador_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_oficios_del_lead();

-- Y los que ya estaban: pasar lo que falte de todos los leads vinculados.
SELECT count(*) FILTER (WHERE sincronizar_oficios_del_lead(id) > 0) AS reparados
  FROM prestador_leads WHERE user_id IS NOT NULL;

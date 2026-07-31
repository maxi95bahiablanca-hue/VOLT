-- 036 — El admin puede cargarle los datos y el oficio a cualquier trabajador
--
-- POR QUÉ (30-jul-2026): dos personas se anotaron por el formulario sin Google
-- y al aceptarlas en el panel saltaba un cartel pidiendo que "entren otra vez
-- por el mismo link". Además del texto —que estaba viejo, ver abajo—, el
-- problema de fondo es que el admin NO PUEDE cargar el oficio de nadie:
-- professional_professions sólo tiene pp_insert_own / pp_delete_own, o sea que
-- únicamente el dueño de la ficha puede tocarlo. Si un tipo te dice por
-- WhatsApp "soy plomero", lo lógico es cargarlo vos en cinco segundos, no
-- mandarle un instructivo.
--
-- Seguro de correr varias veces.

-- ─── 1. Oficios: el admin puede agregar y sacar los de cualquiera ───────────
DROP POLICY IF EXISTS "pp_insert_admin" ON professional_professions;
CREATE POLICY "pp_insert_admin" ON professional_professions
FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "pp_delete_admin" ON professional_professions;
CREATE POLICY "pp_delete_admin" ON professional_professions
FOR DELETE USING (is_admin());

DROP POLICY IF EXISTS "pp_update_admin" ON professional_professions;
CREATE POLICY "pp_update_admin" ON professional_professions
FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ─── 2. professionals: pasar el admin a is_admin() ──────────────────────────
-- La política de la 002 tenía el email escrito a mano y sólo permitía UPDATE.
-- Con is_admin() alcanza con agregar el mail a la tabla admins para sumar a
-- otra persona (Pedro, por ejemplo) sin tocar migraciones.
DROP POLICY IF EXISTS "professionals_admin_update" ON professionals;
CREATE POLICY "professionals_admin_update" ON professionals
FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ─── 3. El trigger de activación automática, versionado ─────────────────────
-- ⚠️ ESTA FUNCIÓN YA EXISTE EN PRODUCCIÓN: se creó a mano en el SQL Editor el
-- 29-jul-2026 y nunca quedó en el repo, así que hoy vive en un solo lado. Lo de
-- abajo es la misma lógica, escrita para que quede versionada.
--
-- 🔴 ANTES DE CORRER ESTA MIGRACIÓN, comparar con la que está viva:
--     SELECT prosrc FROM pg_proc WHERE proname = 'activar_prestador';
-- Si la de producción tiene algo que esta no, NO la pises: copiá la de
-- producción acá y recién ahí corré.
--
-- Qué hace: cuando alguien crea su cuenta (Google/Apple), busca un lead con ese
-- mismo email que todavía no esté vinculado, lo vincula, le crea la ficha de
-- profesional aprobada y le carga los oficios que haya elegido en el registro.
-- Por eso NO hace falta que nadie "vuelva a entrar por el link": con abrir la
-- app y entrar con el mismo mail, queda activo solo.
CREATE OR REPLACE FUNCTION public.activar_prestador(p_user_id uuid, p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead   prestador_leads%ROWTYPE;
  v_prof   uuid;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN 'sin email';
  END IF;

  SELECT * INTO v_lead
    FROM prestador_leads
   WHERE lower(email) = lower(btrim(p_email))
     AND user_id IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'no es prestador cargado';
  END IF;

  UPDATE prestador_leads SET user_id = p_user_id WHERE id = v_lead.id;

  -- La ficha puede existir ya (se registró por la app): en ese caso no se toca.
  SELECT id INTO v_prof FROM professionals WHERE user_id = p_user_id;
  IF v_prof IS NULL THEN
    INSERT INTO professionals (user_id, first_name, last_name, phone, verification_status)
    VALUES (p_user_id,
            COALESCE(NULLIF(btrim(v_lead.nombre), ''), 'Profesional'),
            COALESCE(NULLIF(btrim(v_lead.apellido), ''), ''),
            v_lead.telefono,
            'approved')
    RETURNING id INTO v_prof;
  END IF;

  -- Los oficios que eligió en el registro (tabla N:N de la 031). min_price 0
  -- porque BOLT está en modo gratis y la columna es NOT NULL.
  INSERT INTO professional_professions (professional_id, profession_id, min_price)
  SELECT v_prof, plp.profesion_id, 0
    FROM prestador_lead_profesiones plp
   WHERE plp.lead_id = v_lead.id
     AND plp.profesion_id IS NOT NULL
  ON CONFLICT (professional_id, profession_id) DO NOTHING;

  RETURN 'activado';
END;
$$;

CREATE OR REPLACE FUNCTION public.activar_prestador_al_registrarse()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 🔴 El EXCEPTION no es opcional: si esto falla y no se atrapa, aborta el
  -- INSERT en auth.users y NADIE puede crear una cuenta en BOLT.
  BEGIN
    PERFORM public.activar_prestador(NEW.id, NEW.email);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activar_prestador ON auth.users;
CREATE TRIGGER trg_activar_prestador
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.activar_prestador_al_registrarse();

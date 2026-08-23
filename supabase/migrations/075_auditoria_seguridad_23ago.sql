-- ════════════════════════════════════════════════════════════════════════════
-- 075 — Auditoría 23-ago-2026: seguridad de la base + RPCs que el código espera.
-- Todo verificado contra la definición REAL en producción antes de escribirlo.
-- Cada bloque es idempotente (CREATE OR REPLACE / DROP IF EXISTS).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) nearest_available_worker: emergencia también es privada ───────────────
-- Quedó SECURITY DEFINER sin REVOKE (la 070 revocó a su gemela nearby_workers,
-- no a ésta): cualquiera SIN cuenta, con la publishable key, obtenía teléfono +
-- GPS en vivo de profesionales reales. Único llamador legítimo: la app
-- autenticada (professionalService.js). Mismo molde que la 070.
REVOKE ALL ON FUNCTION public.nearest_available_worker(double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nearest_available_worker(double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.nearest_available_worker(double precision, double precision) TO authenticated, service_role;

-- ── 2) El panel de admin ve la plataforma, no sólo lo propio ─────────────────
-- jobs y payments sólo tenían política SELECT "own": el Resumen/Trabajos/Ingresos
-- del admin mostraba únicamente las filas del que consulta. Políticas aditivas
-- (se suman con OR): a un usuario común no le cambian nada.
DROP POLICY IF EXISTS jobs_admin_read ON public.jobs;
CREATE POLICY jobs_admin_read ON public.jobs FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS payments_admin_read ON public.payments;
CREATE POLICY payments_admin_read ON public.payments FOR SELECT USING (public.is_admin());

-- ── 3) Nadie inserta pagos 'approved' truchos ───────────────────────────────
-- La política vieja dejaba insertar a cualquier parte del job (ensuciaba los
-- ingresos y, en modo comisión, cerraba el trabajo sin pagar). El único
-- insertador real es mp-webhook con service_role, que BYPASA RLS igual. Se deja
-- en false explícito (documentado a propósito), no sólo borrada.
DROP POLICY IF EXISTS payments_insert ON public.payments;
CREATE POLICY payments_insert ON public.payments FOR INSERT WITH CHECK (false);

-- ── 4) El candado de la plata vuelve a frenar de verdad ─────────────────────
-- protect_job_money_fields era SECURITY DEFINER y decidía con current_user, que
-- adentro de un DEFINER es el owner (postgres): la guarda pasaba SIEMPRE. Mismo
-- cuerpo, pero SECURITY INVOKER: current_user pasa a ser el rol real
-- ('authenticated' para la app → las guardas se aplican; 'service_role' para el
-- webhook y 'postgres' para el SQL Editor → los bypass de abajo siguen bien).
CREATE OR REPLACE FUNCTION public.protect_job_money_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.visit_paid IS DISTINCT FROM OLD.visit_paid THEN
    RAISE EXCEPTION 'visit_paid solo lo confirma el sistema de pagos';
  END IF;

  IF NEW.visit_amount IS DISTINCT FROM OLD.visit_amount THEN
    RAISE EXCEPTION 'visit_amount no se puede modificar despues de crear el trabajo';
  END IF;

  IF NEW.commission_pct IS DISTINCT FROM OLD.commission_pct THEN
    RAISE EXCEPTION 'commission_pct no se puede modificar despues de crear el trabajo';
  END IF;

  IF OLD.status IN ('awaiting_payment', 'completed')
     AND (NEW.work_amount IS DISTINCT FROM OLD.work_amount
          OR NEW.materials_cost IS DISTINCT FROM OLD.materials_cost) THEN
    RAISE EXCEPTION 'Los montos no se pueden modificar cuando el trabajo espera pago o termino';
  END IF;

  IF NEW.status = 'completed' AND OLD.status = 'awaiting_payment'
     AND EXISTS (SELECT 1 FROM payments p
                  WHERE p.job_id = OLD.id AND p.status <> 'approved') THEN
    RAISE EXCEPTION 'Un trabajo con un pago pendiente solo lo completa el sistema de pagos';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 5) Un trabajo cancelado no se puede revivir ─────────────────────────────
-- No había candado en la base para cancelled→cualquier-cosa: el accept ciego de
-- la app revivía cancelados. Esto lo cierra venga de donde venga (app, web, SQL).
-- Las herramientas de admin (reasignar_trabajo, definer → corre como postgres)
-- pueden saltearlo si hace falta corregir a mano.
CREATE OR REPLACE FUNCTION public.no_revivir_cancelado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Este trabajo fue cancelado: no se puede revivir';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_no_revivir_cancelado ON public.jobs;
CREATE TRIGGER trg_no_revivir_cancelado
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (OLD.status = 'cancelled')
  EXECUTE FUNCTION public.no_revivir_cancelado();

-- ── 6) pasar_al_siguiente: no pisa un aceptado y sólo la llama quien debe ────
-- (a) El UPDATE final ahora lleva AND status='pending' + chequeo de filas: la
--     carrera con un accept simultáneo la gana el accept.
-- (b) Candado de acceso: sólo el cliente dueño, el profesional actual (para que
--     rechazar_trabajo la pueda invocar) o service_role.
CREATE OR REPLACE FUNCTION public.pasar_al_siguiente(p_job_id uuid)
 RETURNS TABLE(professional_id uuid, user_id uuid, nombre text, quedan integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job     jobs%ROWTYPE;
  v_elegido professionals%ROWTYPE;
  v_quedan  int;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Sólo el dueño del pedido, el profesional actual, o el sistema.
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM v_job.client_id
     AND (v_job.professional_id IS NULL
          OR v_job.professional_id NOT IN (SELECT id FROM professionals WHERE user_id = auth.uid()))
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RETURN;
  END IF;

  IF v_job.status <> 'pending' THEN RETURN; END IF;

  IF v_job.professional_id IS NOT NULL
     AND NOT (v_job.professional_id = ANY(v_job.ofrecido_a)) THEN
    UPDATE jobs SET ofrecido_a = array_append(ofrecido_a, v_job.professional_id)
      WHERE id = p_job_id
      RETURNING * INTO v_job;
  END IF;

  SELECT p.* INTO v_elegido
    FROM professional_professions pp
    JOIN professionals p ON p.id = pp.professional_id
   WHERE pp.profession_id = v_job.profession_id
     AND p.verification_status = 'approved'
     AND p.available IS TRUE
     AND p.location IS NOT NULL
     AND NOT (p.id = ANY(v_job.ofrecido_a))
   ORDER BY (
     CASE WHEN v_job.client_lat IS NULL OR v_job.client_lng IS NULL THEN 0
          ELSE ST_Distance(p.location::geography,
                 ST_SetSRID(ST_MakePoint(v_job.client_lng, v_job.client_lat), 4326)::geography)
     END
   ) ASC
   LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  -- 🔴 El UPDATE final SÓLO si sigue 'pending': si alguien aceptó en el interín,
  --    afecta 0 filas y no reasignamos (el accept gana la carrera).
  UPDATE jobs
     SET professional_id = v_elegido.id,
         ofrecido_a      = array_append(ofrecido_a, v_elegido.id),
         ofrecido_at     = now(),
         created_at      = now()
   WHERE id = p_job_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*)::int INTO v_quedan
    FROM professional_professions pp
    JOIN professionals p ON p.id = pp.professional_id
   WHERE pp.profession_id = v_job.profession_id
     AND p.verification_status = 'approved'
     AND p.available IS TRUE
     AND p.location IS NOT NULL
     AND NOT (p.id = ANY(array_append(v_job.ofrecido_a, v_elegido.id)));

  RETURN QUERY SELECT v_elegido.id, v_elegido.user_id,
    (v_elegido.first_name || ' ' || COALESCE(v_elegido.last_name, '')), v_quedan;
END;
$function$;

-- ── 7) rechazar_trabajo: rechazar NO mata el pedido para todos ──────────────
-- En cascada, pasar al siguiente en la misma transacción; sólo si no queda nadie
-- se cancela. En un pedido paralelo (presupuestos de la app) o directo, cancela
-- únicamente ESA fila. La app la llama desde jobService.reject.
CREATE OR REPLACE FUNCTION public.rechazar_trabajo(p_job_id uuid, p_categoria text DEFAULT NULL, p_nota text DEFAULT NULL)
 RETURNS TABLE(hay_siguiente boolean, nombre text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job  jobs%ROWTYPE;
  v_next RECORD;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::text; RETURN; END IF;

  -- Sólo el profesional actual, y sólo si sigue pending.
  IF v_job.status <> 'pending'
     OR v_job.professional_id IS NULL
     OR v_job.professional_id NOT IN (SELECT id FROM professionals WHERE user_id = auth.uid()) THEN
    RETURN QUERY SELECT false, NULL::text; RETURN;
  END IF;

  IF v_job.ofrecido_at IS NOT NULL THEN
    -- CASCADA: pasarlo al siguiente sin matar el pedido.
    SELECT * INTO v_next FROM public.pasar_al_siguiente(p_job_id);
    IF v_next.user_id IS NOT NULL THEN
      RETURN QUERY SELECT true, v_next.nombre; RETURN;
    END IF;
    -- No queda nadie: recién ahí se cancela.
    UPDATE jobs SET status = 'cancelled', cancelled_at = now(),
      rejection_category = COALESCE(p_categoria, rejection_category),
      rejection_note     = COALESCE(p_nota, rejection_note)
     WHERE id = p_job_id AND status = 'pending';
    RETURN QUERY SELECT false, NULL::text; RETURN;
  END IF;

  -- PARALELO / directo: cancelar SÓLO esta fila (las hermanas siguen ofertando).
  UPDATE jobs SET status = 'cancelled', cancelled_at = now(),
    rejection_category = COALESCE(p_categoria, rejection_category),
    rejection_note     = COALESCE(p_nota, rejection_note)
   WHERE id = p_job_id AND status = 'pending';
  RETURN QUERY SELECT false, NULL::text;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rechazar_trabajo(uuid, text, text) TO authenticated;

-- ── 8) registrar_push_token: el token es de UN dueño a la vez ───────────────
-- El DELETE cross-user desde el cliente lo anulaba RLS (no puede borrar la fila
-- de otro): el token quedaba compartido entre las dos cuentas de un teléfono y
-- se cruzaban los avisos. Acá, como definer, sí se le saca a cualquier otro.
CREATE OR REPLACE FUNCTION public.registrar_push_token(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sin sesion'; END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RAISE EXCEPTION 'token vacio'; END IF;
  DELETE FROM push_tokens WHERE token = p_token AND user_id <> auth.uid();
  INSERT INTO push_tokens (user_id, token, platform, updated_at)
    VALUES (auth.uid(), p_token, 'android', now())
    ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, updated_at = now();
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registrar_push_token(text) TO authenticated;

-- Limpieza única del histórico: por cada token duplicado, dejar sólo la fila más
-- reciente (las cuentas viejas de un mismo teléfono dejan de recibir avisos ajenos).
DELETE FROM push_tokens a USING push_tokens b
 WHERE a.token = b.token AND a.ctid <> b.ctid AND a.updated_at < b.updated_at;

-- ── 9) activar_prestador: dice la verdad y no se lo roban ────────────────────
-- (a) El RETURN decía 'ACTIVADO … radar prendido' aunque inserta 'pending',
--     false → la app le juraba al prestador que ya recibía trabajos. Ahora
--     'VINCULADO … pendiente de aprobación'.
-- (b) Candado auth.uid(): cualquiera logueado podía activar el registro de otro
--     pasando un p_user_id ajeno. El IS NOT NULL es obligatorio: el trigger sobre
--     auth.users (alta por la web) corre sin JWT y NO debe frenarse.
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
  -- 🔴 Candado: sólo podés activar TU propia cuenta (auditoría 23-ago).
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'solo podes activar tu propia cuenta';
  END IF;

  IF p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
    SELECT * INTO l
      FROM prestador_leads
     WHERE lower(TRIM(email)) = lower(TRIM(p_email))
       AND user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1;
    hallado := FOUND;
  END IF;

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
      'pending',
      false
    )
    RETURNING id INTO pid;
  ELSE
    NULL;
  END IF;

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

  RETURN 'VINCULADO: ' || COALESCE(l.nombre, '') || ' ' || COALESCE(l.apellido, '')
         || ' con ' || n_ofic || ' oficio(s), pendiente de aprobacion';
END;
$function$;

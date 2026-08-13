-- ═══════════════════════════════════════════════════════════════════════════
--  069 — Nadie se aprueba solo
--
--  11-ago-2026. Lo encontró la auditoría y es el único hallazgo de su clase:
--  no hace perder plata, hace ENTRAR A UN DESCONOCIDO A LA CASA DE UN CLIENTE
--  con el sello de "verificado" de BOLT.
--
--  El agujero: `professionals_update_own` era FOR UPDATE USING (auth.uid() =
--  user_id) y nada más. Sin WITH CHECK y sin ningún trigger que congelara los
--  campos de control (jobs sí tenía el suyo desde la 028; professionals quedó
--  sin equivalente). Con la publishable key —que está en eas.json, en el repo
--  y en el HTML de bolt.com.ar, o sea que la tiene cualquiera— alcanzaban 4
--  llamadas desde una consola:
--
--    1. insert en professionals con su user_id y verification_status='pending'
--    2. insert en professional_professions con cualquier oficio
--    3. update professionals set verification_status='approved', available=true
--       (pasaba el candado de la 067 porque ya había cargado el oficio)
--    4. update de la ubicación con su GPS
--
--  Resultado: aprobado, con el radar prendido, sin DNI, sin selfie, sin
--  antecedentes y sin que nadie del equipo lo mirara. Y de paso avg_rating=5,00
--  con 300 trabajos, así que salía ANTES que los profesionales de verdad.
--
--  ── Lo que NO se toca ───────────────────────────────────────────────────────
--  El alta legítima sí escribe verification_status='pending' al crearse: el
--  candado va sobre el UPDATE, no sobre el INSERT. Y tienen que seguir pasando:
--    · el admin desde el panel (is_admin(), política professionals_admin_update)
--    · el backend / las Edge Functions (service_role)
--    · activar_prestador() y armar_ficha_al_aceptar() (049 y 050), que son
--      SECURITY DEFINER y corren como el dueño de la función
--    · los triggers de estadísticas (000/008/017): avg_rating, completed_jobs y
--      on_time_completions los escribe un trigger de jobs/reviews disparado por
--      el propio usuario, así que se los reconoce por pg_trigger_depth() > 1.
--
--  ⚠️ ESTA FUNCIÓN NO PUEDE SER "SECURITY DEFINER".
--  Adentro de una función SECURITY DEFINER, current_user pasa a ser el DUEÑO de
--  la función (postgres), así que la primera guarda daría verdadera SIEMPRE y
--  el trigger no frenaría nada. Se declara invoker a propósito: sólo así
--  current_user es de verdad 'authenticated' cuando escribe la app.
--  (Revisar protect_job_money_fields de la 028 con esta lupa — está declarada
--  SECURITY DEFINER y decide con current_user.)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.proteger_control_del_prestador()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new    jsonb := to_jsonb(NEW);
  v_old    jsonb := to_jsonb(OLD);
  v_campo  text;
  -- Lo que decide BOLT, no el prestador. Se comparan por jsonb para que la
  -- lista no dependa de que todas las columnas existan: si alguna no está,
  -- las dos puntas dan NULL y no dispara.
  v_congelados text[] := ARRAY[
    -- quién es y si está habilitado
    'user_id', 'verification_status', 'verified', 'verification_note',
    'reviewed_at', 'reviewed_by',
    -- la reputación: la escriben los triggers, no el interesado
    'avg_rating', 'completed_jobs', 'on_time_completions',
    'returning_clients', 'recommend_pct', 'rejection_count',
    -- plata
    'plan', 'pending_commission'
  ];
BEGIN
  -- 1. El backend y los roles internos pasan siempre.
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- 2. El admin, que es el que aprueba de verdad desde el panel.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- 3. Los triggers de estadísticas (corren adentro de otro trigger).
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  FOREACH v_campo IN ARRAY v_congelados LOOP
    IF (v_new -> v_campo) IS DISTINCT FROM (v_old -> v_campo) THEN
      RAISE EXCEPTION
        'El campo "%" de un profesional lo decide BOLT: no se puede cambiar desde la app.', v_campo
        USING hint   = 'La verificación y la reputación las mueve el equipo de BOLT o el sistema.',
              errcode = '42501';  -- insufficient_privilege
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_control_del_prestador ON public.professionals;
CREATE TRIGGER trg_proteger_control_del_prestador
  BEFORE UPDATE ON public.professionals
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_control_del_prestador();

COMMENT ON TRIGGER trg_proteger_control_del_prestador ON public.professionals IS
  'Nadie se aprueba solo: congela verificación, reputación y plan salvo admin, service_role o triggers (11-ago-2026).';

-- ─── El segundo candado: WITH CHECK en la política ──────────────────────────
-- Sin WITH CHECK, un UPDATE podía dejar la fila con OTRO user_id: el USING se
-- evalúa sobre la fila vieja, así que la de después ya no era asunto de nadie.
-- El trigger igual lo frena, pero un solo candado nunca alcanza (ver la 067).
DROP POLICY IF EXISTS "professionals_update_own" ON public.professionals;
CREATE POLICY "professionals_update_own" ON public.professionals
  FOR UPDATE
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

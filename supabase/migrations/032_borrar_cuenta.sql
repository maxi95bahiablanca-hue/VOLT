-- ─────────────────────────────────────────────────────────────────────────────
-- 032 — Borrar la cuenta desde la app (App Store, guideline 5.1.1(v))
--
-- Apple exige que quien puede crear una cuenta dentro de la app pueda borrarla
-- desde la app, sin mandar un mail ni llamar a nadie. El borrado tiene que ser
-- REAL: no alcanza con desactivar al usuario.
--
-- Se hace con una función SECURITY DEFINER en vez de una Edge Function con la
-- service_role: el borrado necesita tocar `auth.users`, y así la clave de
-- servicio no tiene que viajar a ningún lado. La función sólo puede borrar al
-- usuario de la sesión que la llama (`auth.uid()`), nunca a otro.
--
-- Las tablas se borran a mano y en orden porque `jobs.client_id`,
-- `jobs.professional_id` y `reviews.*` referencian sin ON DELETE CASCADE: sin
-- esto el DELETE de auth.users falla por clave foránea.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.borrar_mi_cuenta()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid      uuid := auth.uid();
  prof_id  uuid;
  jobs_ids uuid[];
  borrados jsonb := '{}'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesión: la cuenta sólo la puede borrar su dueño';
  END IF;

  SELECT id INTO prof_id FROM professionals WHERE user_id = uid;

  -- Trabajos en los que participó, como cliente o como profesional
  SELECT coalesce(array_agg(id), '{}')
    INTO jobs_ids
    FROM jobs
   WHERE client_id = uid
      OR (prof_id IS NOT NULL AND professional_id = prof_id);

  -- 1) Todo lo que cuelga de esos trabajos
  DELETE FROM payments   WHERE job_id = ANY(jobs_ids);
  DELETE FROM reviews    WHERE job_id = ANY(jobs_ids);
  DELETE FROM job_events WHERE job_id = ANY(jobs_ids);
  DELETE FROM messages   WHERE job_id = ANY(jobs_ids);
  DELETE FROM jobs       WHERE id     = ANY(jobs_ids);
  borrados := borrados || jsonb_build_object('trabajos', coalesce(array_length(jobs_ids, 1), 0));

  -- 2) Reseñas sueltas que hubiera escrito o recibido fuera de esos trabajos
  DELETE FROM reviews WHERE client_id = uid;
  IF prof_id IS NOT NULL THEN
    DELETE FROM reviews WHERE professional_id = prof_id;
  END IF;

  -- 3) Datos personales del usuario (las que existan: la base fue creciendo a
  --    parches y no todas las migraciones corrieron en todos los entornos)
  IF to_regclass('public.push_tokens')          IS NOT NULL THEN DELETE FROM push_tokens          WHERE user_id   = uid; END IF;
  IF to_regclass('public.payment_profiles')     IS NOT NULL THEN DELETE FROM payment_profiles     WHERE user_id   = uid; END IF;
  IF to_regclass('public.favorite_professionals') IS NOT NULL THEN DELETE FROM favorite_professionals WHERE client_id = uid; END IF;
  -- `admins` se lleva por email, no por user_id
  IF to_regclass('public.admins') IS NOT NULL THEN
    DELETE FROM admins WHERE email = (SELECT email FROM auth.users WHERE id = uid);
  END IF;

  -- 4) Perfil de profesional y todo lo suyo
  IF prof_id IS NOT NULL THEN
    IF to_regclass('public.favorite_professionals') IS NOT NULL THEN DELETE FROM favorite_professionals WHERE professional_id = prof_id; END IF;
    IF to_regclass('public.professional_professions') IS NOT NULL THEN DELETE FROM professional_professions WHERE professional_id = prof_id; END IF;
    IF to_regclass('public.professional_gallery')     IS NOT NULL THEN DELETE FROM professional_gallery     WHERE professional_id = prof_id; END IF;
    IF to_regclass('public.professional_payout')      IS NOT NULL THEN DELETE FROM professional_payout      WHERE professional_id = prof_id; END IF;
    IF to_regclass('public.worker_media')             IS NOT NULL THEN DELETE FROM worker_media             WHERE professional_id = prof_id; END IF;
    DELETE FROM professionals WHERE id = prof_id;
    borrados := borrados || jsonb_build_object('perfil_profesional', true);
  END IF;

  -- 5) El lead comercial: se borra también, porque tiene nombre y teléfono
  IF to_regclass('public.prestador_leads') IS NOT NULL THEN
    IF to_regclass('public.prestador_lead_profesiones') IS NOT NULL THEN
      DELETE FROM prestador_lead_profesiones
       WHERE lead_id IN (SELECT id FROM prestador_leads WHERE user_id = uid);
    END IF;
    DELETE FROM prestador_leads WHERE user_id = uid;
  END IF;

  -- 6) Referencias sueltas que quedarían apuntando a un usuario inexistente
  UPDATE jobs SET cancelled_by = NULL WHERE cancelled_by = uid;
  UPDATE professionals SET reviewed_by = NULL WHERE reviewed_by = uid;

  -- 7) La cuenta. El resto de `auth` (identities, sessions, refresh_tokens)
  --    se va en cascada.
  DELETE FROM auth.users WHERE id = uid;

  RETURN borrados || jsonb_build_object('cuenta_borrada', true, 'user_id', uid);
END;
$$;

REVOKE ALL ON FUNCTION public.borrar_mi_cuenta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.borrar_mi_cuenta() TO authenticated;

COMMENT ON FUNCTION public.borrar_mi_cuenta() IS
  'Borra la cuenta del usuario de la sesión actual y todos sus datos. La llama ProfileScreen (App Store 5.1.1(v)).';

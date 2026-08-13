-- ═══════════════════════════════════════════════════════════════════════════
--  070 — Lo privado es privado
--
--  11-ago-2026. Cuatro agujeros del mismo tipo: cosas que se leen **sin tener
--  cuenta**, sólo con la clave pública que está en el repo, en `eas.json` y en
--  el código de bolt.com.ar. Los cuatro se comprobaron a mano antes de tocar
--  nada (una llamada HTTP con esa clave, sin login):
--
--    · listar `avatars` → devolvía las carpetas de problem-photos/<user_id>,
--      o sea las fotos que el cliente saca de ADENTRO de su casa. El bucket es
--      público, así que listar es todo lo que hacía falta para bajarlas.
--    · listar `chat-media` → lo mismo con los audios, fotos y PDFs que cliente
--      y profesional se mandan en privado.
--    · GET /rest/v1/professionals → 11 filas, 10 con teléfono, más el GPS que
--      se reescribe solo mientras el radar está prendido. Repitiendo la
--      consulta se sigue a una persona por la ciudad todo el día.
--    · rpc/nearby_workers → idem, con teléfono, sin cuenta.
--
--  ── El criterio ────────────────────────────────────────────────────────────
--  Todo esto pasa a exigir **estar logueado**. No se restringe más que eso a
--  propósito: la app y las dos webs SIEMPRE tienen sesión cuando leen esto
--  (se verificó pantalla por pantalla), así que no se rompe nada, y el agujero
--  —que es el acceso anónimo masivo— se cierra entero.
--
--  Afinar más (que cada uno vea sólo lo suyo, buckets privados con URL firmada)
--  es el paso siguiente y ese sí toca el código de la app: hoy los avatares y
--  los adjuntos se muestran con getPublicUrl.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Storage: se puede ver, no se puede ENUMERAR ─────────────────────────
-- Las políticas viejas no tenían cláusula TO, así que valían también para
-- `anon`, y son las que gobiernan el endpoint de listado.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "chat_media_select" ON storage.objects;
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media');

-- ─── 2. La tabla de profesionales: teléfono y GPS con cuenta ────────────────
-- Era `USING (true)` sin TO. La app siempre está logueada; el mapa del cliente
-- sale por nearby_workers, no por esta tabla.
DROP POLICY IF EXISTS "professionals_read" ON public.professionals;
CREATE POLICY "professionals_read" ON public.professionals
  FOR SELECT TO authenticated
  USING (true);

-- ─── 3. nearby_workers: la función también, no sólo la tabla ────────────────
-- Es SECURITY DEFINER y nunca se le hizo REVOKE, así que conservaba el EXECUTE
-- que Postgres le da a PUBLIC: cerrar la tabla sola no tapaba nada.
REVOKE ALL ON FUNCTION public.nearby_workers(integer, double precision, double precision, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nearby_workers(integer, double precision, double precision, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.nearby_workers(integer, double precision, double precision, integer) TO authenticated, service_role;

-- ─── 4. auth.users: sacarle el SELECT a anon y authenticated ────────────────
-- La 005 lo otorgó "para que las claves foráneas no fallen". Es falso: Postgres
-- valida las FK con los permisos del dueño de la tabla, no con los del que
-- inserta. Lo que quedó es que mail, hash de contraseña, teléfono y tokens de
-- recuperación son legibles por esos roles. Hoy no salen por REST porque
-- PostgREST no expone el esquema `auth`, pero alcanza una vista en `public`
-- sobre auth.users para que salga todo: es una bomba esperando la próxima
-- migración. Las funciones que sí leen auth.users son SECURITY DEFINER y no
-- dependen de este grant (se verificó: no hay ninguna invoker que la lea).
REVOKE SELECT ON auth.users FROM anon, authenticated;

-- ─── 5. Retoque a la 069: volver a la cola de revisión sí se puede ──────────
-- 🔴 El alta web hace `upsert` con verification_status, así que si una persona
-- YA registrada vuelve a pasar por el formulario, eso es un UPDATE. Con la 069
-- tal como quedó, ese re-alta se caía.
--
-- Degradarse a uno mismo a 'pending' no es un ataque: es volver a la cola de
-- revisión, y es lo que el formulario público quiere hacer. Lo que no se puede
-- seguir haciendo desde la app es AUTO-APROBARSE, que es lo que la 069 frena.
CREATE OR REPLACE FUNCTION public.proteger_control_del_prestador()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new    jsonb := to_jsonb(NEW);
  v_old    jsonb := to_jsonb(OLD);
  v_campo  text;
  v_congelados text[] := ARRAY[
    'user_id', 'verification_status', 'verified', 'verification_note',
    'reviewed_at', 'reviewed_by',
    'avg_rating', 'completed_jobs', 'on_time_completions',
    'returning_clients', 'recommend_pct', 'rejection_count',
    'plan', 'pending_commission'
  ];
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- La única transición que el propio interesado puede hacer: volver a la cola.
  IF NEW.verification_status = 'pending'
     AND OLD.verification_status IS DISTINCT FROM 'pending' THEN
    v_congelados := array_remove(v_congelados, 'verification_status');
  END IF;

  FOREACH v_campo IN ARRAY v_congelados LOOP
    IF (v_new -> v_campo) IS DISTINCT FROM (v_old -> v_campo) THEN
      RAISE EXCEPTION
        'El campo "%" de un profesional lo decide BOLT: no se puede cambiar desde la app.', v_campo
        USING hint   = 'La verificación y la reputación las mueve el equipo de BOLT o el sistema.',
              errcode = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

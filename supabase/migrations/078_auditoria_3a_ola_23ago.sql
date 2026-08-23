-- ════════════════════════════════════════════════════════════════════════════
-- 078 — Auditoría 23-ago, tercera ola (triggers de seguridad + cron).
-- Moldes tomados de proteger_control_del_prestador (069) y protect_job_money (038),
-- ambos ya probados en prod. Verificado contra la base real.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Nadie nace con reputación inventada (INSERT) ─────────────────────────
-- proteger_control_del_prestador (069) congela avg_rating/completed_jobs/… pero
-- SÓLO en UPDATE: por INSERT la app todavía podía crear un profesional con ★5,00
-- y 300 trabajos. Este trigger BEFORE INSERT fuerza la reputación a 0 para
-- inserts que no vengan del sistema/admin. Los DEFAULT de la tabla ya son 0, así
-- que esto sólo pisa valores inventados que mande el cliente.
CREATE OR REPLACE FUNCTION public.reputacion_limpia_al_nacer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR public.is_admin()
     OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  NEW.avg_rating          := 0;
  NEW.completed_jobs      := 0;
  NEW.on_time_completions := 0;
  NEW.returning_clients   := 0;
  NEW.complaints_count    := 0;
  NEW.recommend_pct       := NULL;
  NEW.avg_arrival_minutes := NULL;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_reputacion_limpia_al_nacer ON public.professionals;
CREATE TRIGGER trg_reputacion_limpia_al_nacer
  BEFORE INSERT ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.reputacion_limpia_al_nacer();

-- ── 2) La identidad de un trabajo no se puede cambiar desde la app ──────────
-- jobs_update_parties dejaba a un cliente/profesional PATCHear cualquier columna
-- de su trabajo por REST: podía reasignar professional_id a cualquiera. Este
-- trigger congela professional_id/client_id/profession_id para roles no-sistema.
-- Las reasignaciones legítimas (pasar_al_siguiente, reasignar_trabajo) son
-- SECURITY DEFINER → corren como postgres → pasan por el bypass. accept/arrive/
-- start/complete NO tocan estas columnas, así que el flujo normal no se ve.
CREATE OR REPLACE FUNCTION public.proteger_identidad_del_trabajo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR public.is_admin()
     OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.professional_id IS DISTINCT FROM OLD.professional_id THEN
    RAISE EXCEPTION 'No se puede reasignar el profesional de un trabajo desde la app.';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'No se puede cambiar el cliente de un trabajo.';
  END IF;
  IF NEW.profession_id IS DISTINCT FROM OLD.profession_id THEN
    RAISE EXCEPTION 'No se puede cambiar el oficio de un trabajo.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_proteger_identidad_del_trabajo ON public.jobs;
CREATE TRIGGER trg_proteger_identidad_del_trabajo
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.proteger_identidad_del_trabajo();

-- ── 3) 'Disponible a las 15:00' lo repone un cron ───────────────────────────
-- available_at (el "prendé el radar a tal hora") sólo lo restauraba la pantalla
-- Mi Negocio al abrirla: si el profesional no reabría la app, quedaba invisible.
CREATE OR REPLACE FUNCTION public.reponer_disponibles()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  UPDATE professionals
     SET available = true, available_at = NULL
   WHERE available = false
     AND available_at IS NOT NULL
     AND available_at <= now()
     AND location IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
SELECT cron.alter_job(
  job_id  => (SELECT jobid FROM cron.job WHERE jobname = 'cerrar-trabajos-abandonados'),
  command => 'SELECT public.cerrar_trabajos_abandonados(7), public.cerrar_pedidos_sin_respuesta(2), public.liberar_presupuestos_vencidos(30), public.reponer_disponibles()'
);

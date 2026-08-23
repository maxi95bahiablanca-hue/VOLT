-- ════════════════════════════════════════════════════════════════════════════
-- 080 — Auditoría 23-ago: versionar dos RPCs del alta que vivían SÓLO en prod
-- (doble verdad repo/DB). Se commitea su definición REAL, sin cambiarla.
-- Verificado 23-ago: ambas ya están bien en seguridad.
-- ════════════════════════════════════════════════════════════════════════════

-- admin_borrar_lead: sólo Maxi (por email en el JWT). Idempotente.
CREATE OR REPLACE FUNCTION public.admin_borrar_lead(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() <> 'maxi95.bahiablanca@gmail.com' THEN RAISE EXCEPTION 'no autorizado'; END IF;
  DELETE FROM prestador_leads WHERE id = p_id;
END;
$function$;

-- prestador_ya_registrado: chequeo anti-duplicado del alta pública (devuelve sólo
-- un booleano, no expone datos). Definer para poder mirar prestador_leads desde
-- el alta anónima.
CREATE OR REPLACE FUNCTION public.prestador_ya_registrado(p_dni text, p_email text, p_tel text)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM prestador_leads
    WHERE (coalesce(p_dni,'')   <> '' AND regexp_replace(coalesce(dni,''),'\D','','g') = p_dni)
       OR (coalesce(p_email,'') <> '' AND lower(email) = lower(p_email))
       OR (coalesce(p_tel,'')   <> '' AND right(regexp_replace(coalesce(telefono,''),'\D','','g'),8) = right(p_tel,8))
  );
$function$;

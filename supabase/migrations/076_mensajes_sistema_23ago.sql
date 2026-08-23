-- ════════════════════════════════════════════════════════════════════════════
-- 076 — Auditoría 23-ago-2026: mensajes de sistema del chat + documentar la RPC
-- de aprobación que vivía sólo en la base.
-- ════════════════════════════════════════════════════════════════════════════

-- ── mensaje_de_sistema ──────────────────────────────────────────────────────
-- La política de INSERT de `messages` exige sender_id = auth.uid(), y un mensaje
-- de sistema va con sender_id NULL: TODOS rebotaban contra RLS ('ya salió',
-- 'llegó', 'empezó', 'terminó', apertura del chat) y el error moría en un
-- console.warn. Verificado en prod: 0 mensajes de sistema en toda la historia.
-- Esta RPC (definer) valida que quien llama sea parte del trabajo —el MISMO
-- subselect de la política real— e inserta la fila de sistema.
CREATE OR REPLACE FUNCTION public.mensaje_de_sistema(p_job_id uuid, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM jobs j
     WHERE j.id = p_job_id
       AND (j.client_id = auth.uid()
            OR j.professional_id IN (SELECT id FROM professionals WHERE user_id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'no participas de este trabajo';
  END IF;
  INSERT INTO messages (job_id, sender_id, content, type)
    VALUES (p_job_id, NULL, p_content, 'system');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.mensaje_de_sistema(uuid, text) TO authenticated;

-- ── admin_set_verification (documentación: repo = DB) ───────────────────────
-- La app la usa (AdminScreen) pero NINGUNA migración la creaba: repo y base
-- decían cosas distintas. Se commitea su definición REAL de producción, sin
-- cambiarla: ya valida que quien llama sea Maxi (por email en el JWT). Idempotente.
CREATE OR REPLACE FUNCTION public.admin_set_verification(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (auth.jwt() ->> 'email') is distinct from 'maxi95.bahiablanca@gmail.com' then
    raise exception 'no autorizado';
  end if;
  if p_status not in ('approved','rejected','pending') then
    raise exception 'estado invalido';
  end if;
  update professionals
     set verification_status = p_status,
         verification_note   = p_note,
         reviewed_at         = now(),
         reviewed_by         = auth.uid()
   where id = p_id;
end;
$function$;

-- 024 — Comisión por volumen: facturación (mano de obra) de los últimos 30 días.
-- SECURITY DEFINER para poder leer los jobs del trabajador sin exponerlos por RLS.

CREATE OR REPLACE FUNCTION worker_billed_30d(p_professional_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(work_amount), 0)::bigint
  FROM jobs
  WHERE professional_id = p_professional_id
    AND status = 'completed'
    AND completed_at >= now() - interval '30 days';
$$;

GRANT EXECUTE ON FUNCTION worker_billed_30d(uuid) TO anon, authenticated;

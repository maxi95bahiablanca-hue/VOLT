-- 041 — Pasarle el trabajo a otro profesional
--
-- POR QUE (Maxi, 31-jul-2026): cuando un trabajador acepto y no fue, o no
-- contesta, el cliente no tiene por que enterarse ni volver a empezar. Se le
-- saca el trabajo al que estaba, se le da a otro, y el cliente sigue con SU
-- pedido intacto. El aviso al cliente lo da Maxi a mano si hace falta.
--
-- El admin no puede tocar jobs ajenos (jobs_update_parties es solo cliente o
-- profesional), asi que va por una funcion SECURITY DEFINER que valida is_admin().
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.reasignar_trabajo(p_job_id uuid, p_prof_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job  jobs%ROWTYPE;
  v_nuevo professionals%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN RETURN 'solo el admin'; END IF;

  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN 'el trabajo no existe'; END IF;

  SELECT * INTO v_nuevo FROM professionals WHERE id = p_prof_id;
  IF NOT FOUND THEN RETURN 'el profesional no existe'; END IF;
  IF v_nuevo.id = v_job.professional_id THEN RETURN 'ya es el mismo profesional'; END IF;

  -- Al que estaba se le borra todo rastro del trabajo: deja de verlo, deja de
  -- poder escribir en el chat y no le cuenta en sus estadisticas.
  UPDATE jobs
     SET professional_id       = p_prof_id,
         status                = 'accepted',
         accepted_at           = now(),
         arrived_at            = NULL,
         work_started_at       = NULL,
         on_the_way_at         = NULL,
         verification_code     = NULL,
         scheduled_for         = NULL,
         scheduled_ok          = false,
         current_session_start = NULL
   WHERE id = p_job_id;

  -- El historial de lo hablado no se borra (sirve para que el nuevo entienda el
  -- caso), pero se deja una marca de sistema para que quede claro que cambio.
  INSERT INTO messages (job_id, sender_id, content, type)
  VALUES (p_job_id, NULL, 'Este trabajo paso a otro profesional de BOLT.', 'system');

  RETURN 'reasignado';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reasignar_trabajo(uuid, uuid) TO authenticated;

-- Quien puede tomarlo: profesionales aprobados del mismo oficio, con el radar
-- prendido primero. Se usa para el selector del panel.
CREATE OR REPLACE FUNCTION public.candidatos_para_trabajo(p_job_id uuid)
RETURNS TABLE (id uuid, nombre text, disponible boolean, trabajos int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         (p.first_name || ' ' || COALESCE(p.last_name, '')) AS nombre,
         (p.available AND p.location IS NOT NULL) AS disponible,
         p.completed_jobs
    FROM jobs j
    JOIN professional_professions pp ON pp.profession_id = j.profession_id
    JOIN professionals p ON p.id = pp.professional_id
   WHERE j.id = p_job_id
     AND p.verification_status = 'approved'
     AND p.id <> j.professional_id
   ORDER BY (p.available AND p.location IS NOT NULL) DESC, p.completed_jobs DESC
   LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.candidatos_para_trabajo(uuid) TO authenticated;

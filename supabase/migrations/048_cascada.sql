-- 048 — Cascada: el pedido va de a UNO, no a los tres a la vez
--
-- Maxi (1-ago-2026): "para que los hariamos competir a los tres profesionales
-- en vez de darles trabajo... eso era cuando pasaban un presupuesto antes de ir
-- y el cliente elegia. Pero ahora...".
--
-- POR QUE SE CAMBIA:
--   · Con dos profesionales activos, "elegi entre tres" es una ficcion.
--   · En modo gratuito no hay tres precios que comparar: la subasta perdio su
--     razon de ser.
--   · Cada ronda deja dos perdedores. Con esta cantidad de gente, hacerlos
--     aceptar para despues decirles "no te eligieron" es la forma mas rapida de
--     que apaguen el radar — y el radar apagado es HOY el problema numero uno.
--
-- ⚠️ LO QUE SE PIERDE Y HAY QUE CUIDAR: mandandolo a tres a la vez, si uno
-- fallaba otro lo agarraba. En cascada el pedido depende de que el PASE
-- AUTOMATICO funcione siempre: es mas prolijo pero mas fragil. Por eso la
-- funcion de abajo es idempotente y deja registro de a quien se le fue
-- ofreciendo, para que nadie reciba dos veces lo mismo y para poder auditar
-- por que un pedido no se tomo.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- A quienes ya se les ofrecio este trabajo (para no repetir y para auditar).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS ofrecido_a  uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ofrecido_at timestamptz;

COMMENT ON COLUMN jobs.ofrecido_a IS
  'Profesionales a los que ya se les ofrecio este trabajo en la cascada.';

-- ─── Pasar el trabajo al siguiente de la fila ───────────────────────────────
-- Devuelve el user_id del nuevo profesional (para notificarlo) o NULL si ya no
-- queda nadie. NO cancela el pedido cuando se acaban los candidatos: eso lo
-- decide quien llama (hoy, el rescate: "el cliente siempre tiene una solucion").
CREATE OR REPLACE FUNCTION public.pasar_al_siguiente(p_job_id uuid)
RETURNS TABLE (professional_id uuid, user_id uuid, nombre text, quedan int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job    jobs%ROWTYPE;
  v_elegido professionals%ROWTYPE;
  v_quedan int;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Si alguien ya lo acepto, no se toca: la cascada se detiene sola.
  IF v_job.status <> 'pending' THEN RETURN; END IF;

  -- El actual queda registrado como ya ofrecido (aunque no haya contestado).
  IF v_job.professional_id IS NOT NULL
     AND NOT (v_job.professional_id = ANY(v_job.ofrecido_a)) THEN
    UPDATE jobs SET ofrecido_a = array_append(ofrecido_a, v_job.professional_id)
     WHERE id = p_job_id
     RETURNING * INTO v_job;
  END IF;

  -- El siguiente: mismo oficio, aprobado, con el radar prendido y con
  -- ubicacion, que no lo haya recibido todavia. Primero el que mas cerca este.
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

  UPDATE jobs
     SET professional_id = v_elegido.id,
         ofrecido_a      = array_append(ofrecido_a, v_elegido.id),
         ofrecido_at     = now(),
         created_at      = now()   -- reinicia la ventana de respuesta del nuevo
   WHERE id = p_job_id;

  SELECT count(*)::int INTO v_quedan
    FROM professional_professions pp
    JOIN professionals p ON p.id = pp.professional_id
   WHERE pp.profession_id = v_job.profession_id
     AND p.verification_status = 'approved'
     AND p.available IS TRUE
     AND p.location IS NOT NULL
     AND NOT (p.id = ANY(array_append(v_job.ofrecido_a, v_elegido.id)));

  RETURN QUERY SELECT v_elegido.id, v_elegido.user_id,
                      (v_elegido.first_name || ' ' || COALESCE(v_elegido.last_name, '')),
                      v_quedan;
END;
$$;

REVOKE ALL ON FUNCTION public.pasar_al_siguiente(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pasar_al_siguiente(uuid) TO authenticated;

COMMENT ON FUNCTION public.pasar_al_siguiente(uuid) IS
  'Cascada: le pasa el trabajo al siguiente profesional disponible que todavia no lo recibio. Si alguien ya acepto, no hace nada.';

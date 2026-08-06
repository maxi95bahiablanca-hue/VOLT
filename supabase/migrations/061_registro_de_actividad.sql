-- 061 - El registro de TODO lo que le llego al profesional
--
-- Maxi, 6-ago-2026, despues de probar un pedido de pintor desde la web:
--   "entre por el push, ... luego entre de nuevo, fui a MI NEGOCIO y no me
--    aparece nada. Yo necesito como trabajador tener registro de que paso ahi...
--    en todo momento".
--
-- POR QUE HOY NO QUEDA RASTRO. Son dos agujeros distintos:
--
--   1. La pestana Trabajos de Mi negocio lee `jobs` filtrando por
--      professional_id = yo. Pero la cascada (migracion 048) le CAMBIA el
--      professional_id al trabajo cuando se lo pasa al siguiente: en ese
--      instante el pedido deja de ser "mio" y desaparece de mi lista como si
--      nunca hubiera existido.
--   2. Aunque no se lo pasen a nadie, la politica `jobs_read_own` tambien mira
--      professional_id. O sea que el rastro no depende de lo que paso, sino de
--      quien es el duenio AHORA. Un registro que se borra solo no es un
--      registro.
--
-- QUE HACE ESTA MIGRACION. Una tabla `job_offers`: una fila por cada vez que un
-- pedido le llego a un profesional, con su desenlace. La escriben triggers, no
-- la app: si dependiera de que la app avise, el caso que MAS importa registrar
-- -el trabajador que ni abrio la notificacion- seria justo el que no se
-- registra.
--
-- Guarda copia del oficio, la direccion y las notas: el registro tiene que
-- seguir siendo legible aunque el trabajo se borre o el catalogo cambie.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- ─── La tabla ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES jobs(id)          ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,

  -- Copia del pedido en el momento en que llego (el registro no puede depender
  -- de que el job siga existiendo ni de que yo pueda leerlo).
  oficio     text,
  direccion  text,
  notas      text,

  -- recibido | aceptado | completado | rechazado | vencido | paso_a_otro
  -- | no_te_eligieron | cancelado
  estado     text NOT NULL DEFAULT 'recibido',
  motivo     text,

  recibido_at timestamptz NOT NULL DEFAULT now(),
  cerrado_at  timestamptz,

  UNIQUE (job_id, professional_id)
);

CREATE INDEX IF NOT EXISTS job_offers_prof_idx
  ON public.job_offers (professional_id, recibido_at DESC);

COMMENT ON TABLE public.job_offers IS
  'Todo lo que le llego a cada profesional y como termino. Lo escriben triggers: la app no puede omitir un registro.';

ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY;

-- Cada profesional ve SOLO lo suyo. Nadie escribe a mano: las filas las ponen
-- los triggers de abajo, que corren como definer.
DROP POLICY IF EXISTS "job_offers_read_own" ON public.job_offers;
CREATE POLICY "job_offers_read_own" ON public.job_offers
  FOR SELECT USING (
    auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  );

-- ─── Escribir el registro: una sola funcion, para no repetir la regla ───────

CREATE OR REPLACE FUNCTION public.registrar_oferta(
  p_job_id uuid,
  p_professional_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_professional_id IS NULL THEN RETURN; END IF;

  INSERT INTO job_offers (job_id, professional_id, oficio, direccion, notas)
  SELECT j.id, p_professional_id, pr.name, j.address, j.notes
    FROM jobs j
    LEFT JOIN professions pr ON pr.id = j.profession_id
   WHERE j.id = p_job_id
  ON CONFLICT (job_id, professional_id) DO NOTHING;
END;
$$;

-- Cerrar una oferta. Solo pisa las que siguen abiertas: un desenlace ya escrito
-- no se cambia (si acepto y despues el cliente cancelo, la fila cuenta las dos
-- cosas: estado 'cancelado' con el motivo, pero nunca "vencido" encima de un
-- "aceptado").
CREATE OR REPLACE FUNCTION public.cerrar_oferta(
  p_job_id uuid,
  p_professional_id uuid,
  p_estado text,
  p_motivo text DEFAULT NULL,
  p_solo_si_abierta boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_professional_id IS NULL THEN RETURN; END IF;

  UPDATE job_offers
     SET estado     = p_estado,
         motivo     = COALESCE(p_motivo, motivo),
         cerrado_at = now()
   WHERE job_id = p_job_id
     AND professional_id = p_professional_id
     AND (NOT p_solo_si_abierta OR estado = 'recibido');
END;
$$;

-- ─── El trigger: cada cosa que le pasa al trabajo deja su rastro ───────────

CREATE OR REPLACE FUNCTION public.tg_job_offers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM registrar_oferta(NEW.id, NEW.professional_id);
    RETURN NEW;
  END IF;

  -- La cascada le paso el trabajo a otro: el anterior no lo tomo, y eso es
  -- exactamente lo que hay que dejar escrito.
  IF NEW.professional_id IS DISTINCT FROM OLD.professional_id THEN
    PERFORM cerrar_oferta(NEW.id, OLD.professional_id, 'paso_a_otro',
      'No lo tomaste a tiempo y se le paso al siguiente profesional');
    PERFORM registrar_oferta(NEW.id, NEW.professional_id);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'aceptado', NULL);

    ELSIF NEW.status = 'completed' THEN
      -- Pisa el 'aceptado': terminarlo es el desenlace definitivo.
      PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'completado', NULL, false);

    ELSIF NEW.status = 'cancelled' THEN
      IF NEW.rejection_category = 'timeout' THEN
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'vencido',
          'Se te vencio el tiempo para contestar');
      ELSIF NEW.rejection_category IS NOT NULL THEN
        v_motivo := COALESCE(NEW.rejection_note, NEW.rejection_category);
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'rechazado', v_motivo);
      ELSIF NEW.quote_group_id IS NOT NULL THEN
        -- Presupuesto de un grupo que se cancela sin que nadie rechace: el
        -- cliente eligio a otro. Pisa el 'aceptado' porque es su desenlace.
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'no_te_eligieron',
          'El cliente eligio a otro profesional', false);
      ELSE
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'cancelado',
          'El cliente cancelo el pedido', false);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_offers ON public.jobs;
CREATE TRIGGER trg_job_offers
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_offers();

-- ─── Lo que ve el profesional ───────────────────────────────────────────────
--
-- Antes de devolver la lista cierra las que quedaron colgadas: un 'recibido' de
-- hace mas de 10 minutos ya no lo puede tomar nadie (la ventana es de 3), y
-- nadie lo movio porque no habia siguiente en la fila. Sin esto la lista
-- mentiria: mostraria "esperando tu respuesta" para siempre.
--
-- Va con auth.uid() y sin parametro de profesional: asi no hay forma de pedir
-- la actividad de otro.
CREATE OR REPLACE FUNCTION public.mi_actividad(p_limit int DEFAULT 60)
RETURNS TABLE (
  id          uuid,
  job_id      uuid,
  oficio      text,
  direccion   text,
  notas       text,
  estado      text,
  motivo      text,
  recibido_at timestamptz,
  cerrado_at  timestamptz,
  status      text,
  work_amount numeric,
  commission_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof uuid;
BEGIN
  SELECT p.id INTO v_prof
    FROM professionals p WHERE p.user_id = auth.uid()
   LIMIT 1;
  IF v_prof IS NULL THEN RETURN; END IF;

  UPDATE job_offers o
     SET estado = 'vencido',
         motivo = 'No llegaste a contestar',
         cerrado_at = now()
   WHERE o.professional_id = v_prof
     AND o.estado = 'recibido'
     AND o.recibido_at < now() - interval '10 minutes';

  -- 🔴 Los casts NO son decoracion: `jobs.status` es un enum y los montos son
  -- integer. Sin castearlos, RETURN QUERY tira "structure of query does not
  -- match function result type" y la pantalla del trabajador queda vacia.
  RETURN QUERY
    SELECT o.id, o.job_id, o.oficio, o.direccion, o.notas,
           o.estado, o.motivo, o.recibido_at, o.cerrado_at,
           j.status::text, j.work_amount::numeric, j.commission_pct::numeric
      FROM job_offers o
      LEFT JOIN jobs j ON j.id = o.job_id
     WHERE o.professional_id = v_prof
     ORDER BY o.recibido_at DESC
     LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_oferta(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cerrar_oferta(uuid, uuid, text, text, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mi_actividad(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mi_actividad(int) TO authenticated;

COMMENT ON FUNCTION public.mi_actividad(int) IS
  'Todo lo que le llego al profesional logueado y como termino cada cosa.';

-- ─── Recuperar la historia que ya paso ──────────────────────────────────────
--
-- Sin esto el registro arranca vacio y el trabajador entra a ver "que paso" el
-- dia que se publica... y no ve nada, que es exactamente el problema que vino a
-- resolver. `ofrecido_a` (migracion 048) ya venia guardando a quien se le fue
-- ofreciendo cada trabajo: alcanza para reconstruir casi todo.

INSERT INTO public.job_offers (job_id, professional_id, oficio, direccion, notas, recibido_at)
SELECT j.id, p.id, pr.name, j.address, j.notes, j.created_at
  FROM jobs j
  CROSS JOIN LATERAL unnest(
    CASE WHEN j.professional_id IS NULL THEN j.ofrecido_a
         ELSE array_append(j.ofrecido_a, j.professional_id) END
  ) AS ofrecido(pid)
  JOIN professionals p  ON p.id = ofrecido.pid
  LEFT JOIN professions pr ON pr.id = j.profession_id
ON CONFLICT (job_id, professional_id) DO NOTHING;

-- El desenlace de lo recuperado, deducido del estado del trabajo.
UPDATE public.job_offers o
   SET estado = CASE
         WHEN j.professional_id IS DISTINCT FROM o.professional_id THEN 'paso_a_otro'
         WHEN j.status = 'completed'  THEN 'completado'
         WHEN j.status = 'cancelled'  AND j.rejection_category = 'timeout' THEN 'vencido'
         WHEN j.status = 'cancelled'  AND j.rejection_category IS NOT NULL THEN 'rechazado'
         WHEN j.status = 'cancelled'  AND j.quote_group_id IS NOT NULL THEN 'no_te_eligieron'
         WHEN j.status = 'cancelled'  THEN 'cancelado'
         WHEN j.status IN ('accepted','arrived','in_progress','awaiting_payment') THEN 'aceptado'
         WHEN j.created_at < now() - interval '10 minutes' THEN 'vencido'
         ELSE 'recibido'
       END,
       motivo = CASE
         WHEN j.professional_id IS DISTINCT FROM o.professional_id
           THEN 'No lo tomaste a tiempo y se le paso al siguiente profesional'
         WHEN j.status = 'cancelled' AND j.rejection_category = 'timeout'
           THEN 'Se te vencio el tiempo para contestar'
         WHEN j.status = 'cancelled' AND j.rejection_category IS NOT NULL
           THEN COALESCE(j.rejection_note, j.rejection_category)
         WHEN j.status = 'cancelled' AND j.quote_group_id IS NOT NULL
           THEN 'El cliente eligio a otro profesional'
         WHEN j.status = 'cancelled'
           THEN 'El cliente cancelo el pedido'
         -- Quedo en pending y se le paso la hora: nadie lo cancelo porque no
         -- habia siguiente en la fila. Es el caso de Maxi del 6-ago.
         WHEN j.created_at < now() - interval '10 minutes'
           THEN 'No llegaste a contestar'
         ELSE o.motivo
       END,
       cerrado_at = COALESCE(o.cerrado_at, j.completed_at, j.cancelled_at)
  FROM jobs j
 WHERE j.id = o.job_id
   AND o.estado = 'recibido';

-- 044 — "¿Vino? ¿Todo bien?": el seguimiento del dia siguiente
--
-- Maxi (1-ago-2026), hablando del multi-dia: "lo que podemos hacer es al otro
-- dia, si detectamos que fue o no por el GPS, averiguar con notificaciones o
-- bien hablar con el cliente personalmente a ver si va todo ok".
--
-- Se elige PREGUNTAR y no adivinar por GPS. Motivos:
--   1. El GPS en segundo plano lo mata Android, gasta bateria y es informacion
--      sensible (saber donde esta un trabajador todo el dia no es lo mismo que
--      saberlo mientras trabaja).
--   2. Un GPS que dice "no estuvo ahi" se puede equivocar —sin bateria, sin
--      senal, un sotano— y si eso dispara un aviso automatico, quedas mal con
--      alguien que SI fue.
--   3. Preguntar cuesta nada, no falla, y ademas abre la puerta a que el
--      cliente cuente un problema antes de que se haga grande.
--
-- El GPS igual sirve, pero como PISTA para el panel, nunca como acusacion.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

ALTER TABLE jobs
  -- Cuando termino la ultima jornada. Lo escribe la app al cerrar la sesion;
  -- de aca sale "paso un dia y no hubo novedades".
  ADD COLUMN IF NOT EXISTS ultima_jornada_at    timestamptz,
  -- Cuando se le pregunto por ultima vez, para no repreguntar todos los dias.
  ADD COLUMN IF NOT EXISTS seguimiento_at       timestamptz,
  -- Que contesto: 'vino_ok' | 'vino_problema' | 'no_vino' | 'sin_respuesta'
  ADD COLUMN IF NOT EXISTS seguimiento_respuesta text;

CREATE INDEX IF NOT EXISTS jobs_seguimiento_idx ON jobs(ultima_jornada_at)
  WHERE ultima_jornada_at IS NOT NULL;

-- ─── A quien hay que preguntarle hoy ─────────────────────────────────────────
-- Devuelve los trabajos de varios dias donde ya paso una jornada, no hubo
-- movimiento desde ayer, y todavia no se pregunto (o se pregunto hace mas de
-- un dia). NO manda nada: solo dice a quien preguntarle y desde cuando.
CREATE OR REPLACE FUNCTION public.seguimiento_pendiente()
RETURNS TABLE (
  job_id        uuid,
  client_id     uuid,
  professional_id uuid,
  desde         timestamptz,
  dias          int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id,
         j.client_id,
         j.professional_id,
         j.ultima_jornada_at,
         GREATEST(1, (EXTRACT(EPOCH FROM (now() - j.ultima_jornada_at)) / 86400)::int)
    FROM jobs j
   WHERE j.status IN ('accepted', 'arrived', 'in_progress')
     AND j.is_multiday IS TRUE
     AND j.ultima_jornada_at IS NOT NULL
     -- paso al menos un dia desde la ultima jornada
     AND j.ultima_jornada_at < now() - interval '20 hours'
     -- y no esta trabajando en este momento
     AND j.current_session_start IS NULL
     -- no se le pregunto, o se le pregunto hace mas de un dia
     AND (j.seguimiento_at IS NULL OR j.seguimiento_at < now() - interval '20 hours')
$$;

REVOKE ALL ON FUNCTION public.seguimiento_pendiente() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.seguimiento_pendiente() TO authenticated;

COMMENT ON FUNCTION public.seguimiento_pendiente() IS
  'Trabajos de varios dias sin movimiento desde ayer, a los que corresponde preguntarle al cliente si el profesional vino.';
COMMENT ON COLUMN jobs.seguimiento_respuesta IS
  'vino_ok | vino_problema | no_vino | sin_respuesta';

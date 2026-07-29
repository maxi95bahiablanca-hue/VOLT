-- ─────────────────────────────────────────────────────────────────────────────
-- 033 — Varias fotos del problema
--
-- Hasta ahora el trabajo guardaba UNA sola foto (`problem_photo_url`, migración
-- 012). El asistente ahora puede pedir más de una cuando hace falta para cotizar
-- (ej.: "la pieza lo más entera posible" para presupuestar una pintura, o el
-- ambiente completo además del detalle).
--
-- `problem_photo_url` se mantiene y sigue teniendo la PRIMERA foto: hay pantallas
-- viejas que la leen, y los clientes con la app sin actualizar la siguen mandando
-- así. `problem_photos` es la lista completa.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS problem_photos TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN jobs.problem_photos IS
  'Fotos que mandó el cliente al pedir el trabajo. La primera se repite en problem_photo_url por compatibilidad.';

-- Rellenar la lista para los trabajos que ya tenían una foto
UPDATE jobs
   SET problem_photos = ARRAY[problem_photo_url]
 WHERE problem_photo_url IS NOT NULL
   AND (problem_photos IS NULL OR cardinality(problem_photos) = 0);

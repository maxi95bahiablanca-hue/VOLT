-- =====================================================
-- VOLT — Migración 011: Habilitar Realtime en jobs
-- Ejecutar en Supabase SQL Editor DESPUÉS de 010
--
-- SIN ESTO el trabajador NUNCA recibe trabajos nuevos.
-- La suscripción subscribeNewJobsForWorker() no dispara
-- si la tabla no está en la publicación de Realtime.
-- =====================================================

-- Habilitar Realtime para la tabla jobs (INSERT/UPDATE)
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;

-- También agregar professionals para recibir cambios de ubicación en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE professionals;

-- ─── GRANT para que el trigger de nearby_workers funcione con RLS ─────────────
-- Sin esto, el worker no puede leer su propio job recién creado
-- en el callback de la suscripción Realtime.
GRANT SELECT ON jobs TO authenticated;

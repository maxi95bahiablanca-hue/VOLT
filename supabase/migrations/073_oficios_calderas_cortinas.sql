-- ═══════════════════════════════════════════════════════════════════════════
--  073 — SEED DE CALDERAS (20) Y CORTINAS (21)
--
--  Los dos oficios se cargaron A MANO en producción (10 y 11-ago-2026) y no
--  figuraban en ninguna migración: un entorno nuevo levantado desde el repo
--  no los tenía, y las listas espejo del código (FALLBACK_PROFS, TARJETAS,
--  analyze-problem) apuntaban a ids inexistentes.
--
--  Con los ids EXPLÍCITOS, porque todo el código los referencia por número:
--  20 = Calderas (respaldo → Gasista id 3), 21 = Cortinas.
--  Idempotente: si ya existen (producción), no hace nada.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO professions (id, name)
VALUES
  (20, 'Calderas'),
  (21, 'Cortinas')
ON CONFLICT (id) DO NOTHING;

-- Que la secuencia no quede atrás de los ids fijados a mano: sin esto, el
-- próximo INSERT sin id explícito puede chocar con 20 o 21.
SELECT setval(
  pg_get_serial_sequence('professions', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM professions), 21)
);

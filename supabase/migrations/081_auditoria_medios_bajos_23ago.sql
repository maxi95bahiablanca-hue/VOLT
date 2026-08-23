-- ════════════════════════════════════════════════════════════════════════════
-- 081 — Auditoría 23-ago, hallazgos MEDIOS/BAJOS de la base (aditivos y seguros).
-- Cada bloque es idempotente. Verificado contra el repo (oficios.js, el cron ya
-- extendido por 077/078, la definición real de nearby_workers en 017).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Los oficios 16–19 existen en el código pero no en la base ─────────────
-- src/config/oficios.js (la FUENTE ÚNICA) declara 16 Aire acondicionado,
-- 17 Alarmas/Cámaras, 18 Durlock, 19 Herrero por su id REAL. 000_schema.sql sólo
-- siembra 1–15 y 073 sólo 20 y 21: un entorno nuevo levantado del repo no los
-- tiene y todo el código los referencia por número. Ids EXPLÍCITOS, idéntico a 073.
INSERT INTO professions (id, name)
VALUES
  (16, 'Aire acondicionado'),
  (17, 'Alarmas / Cámaras'),
  (18, 'Durlock'),
  (19, 'Herrero')
ON CONFLICT (id) DO NOTHING;

-- ── 2) Un solo nombre por oficio (coherencia repo/DB) ───────────────────────
-- 000_schema.sql sembró tres nombres que oficios.js ya reemplazó hace tiempo, y
-- activar_prestador (075:345-351) empareja el oficio del lead contra
-- professions.name: con el nombre viejo, el alta por nombre no matchea y el
-- prestador queda aprobado SIN oficio → invisible. Se alinea la base al nombre
-- que la app ya muestra. Referencias son por id, así que sólo cambia el rótulo.
UPDATE professions SET name = 'Heladeras y lavarropas' WHERE id = 8;
UPDATE professions SET name = 'Limpieza'               WHERE id = 10;
UPDATE professions SET name = 'Encomiendas / Fletes'   WHERE id = 11;

-- Que la secuencia no quede atrás de los ids fijados a mano (16–21).
SELECT setval(
  pg_get_serial_sequence('professions', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM professions), 21)
);

-- ── 3) La ventana "voy en camino" del presupuesto la cierra el cron ─────────
-- cerrar_ventanas_presupuestos(3) existe (056:145) pero ningún cron la llamaba:
-- si el profesional toca "voy en camino" y se olvida, el cliente ve "va en
-- camino" para siempre. Se suma al reloj horario que ya cierra trabajos, junto a
-- los que 077/078 ya agregaron (una sola verdad, un solo reloj).
SELECT cron.alter_job(
  job_id  => (SELECT jobid FROM cron.job WHERE jobname = 'cerrar-trabajos-abandonados'),
  command => 'SELECT public.cerrar_trabajos_abandonados(7), public.cerrar_pedidos_sin_respuesta(2), public.liberar_presupuestos_vencidos(30), public.reponer_disponibles(), public.cerrar_ventanas_presupuestos(3)'
);

-- ── 4) nearby_workers con radio máximo ──────────────────────────────────────
-- La RPC ordenaba por distancia y cortaba por LIMIT, sin tope de km: un pedido
-- desde cualquier punto del país le sonaba al prestador de Bahía. Se agrega un
-- tope de 60 km (cubre Bahía + Punta Alta y alrededores con margen) dentro de la
-- RPC → una sola verdad para app y web. Mismo cuerpo que 017, misma firma (los
-- GRANT/REVOKE de 070 siguen válidos): sólo se suma el filtro de distancia.
CREATE OR REPLACE FUNCTION nearby_workers(
  p_profession_id INT,
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_limit         INT DEFAULT 10
)
RETURNS TABLE (
  id                  UUID,
  user_id             UUID,
  first_name          TEXT,
  last_name           TEXT,
  phone               TEXT,
  min_price           INT,
  completed_jobs      INT,
  avg_rating          NUMERIC,
  effective_rating    NUMERIC,
  on_time_completions INT,
  avg_arrival_minutes INT,
  returning_clients   INT,
  complaints_count    INT,
  recommend_pct       INT,
  distance_meters     DOUBLE PRECISION,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  avatar_url          TEXT,
  estudios_url        TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pr.id,
    pr.user_id,
    pr.first_name,
    pr.last_name,
    pr.phone,
    pp.min_price,
    pr.completed_jobs,
    pr.avg_rating,
    LEAST(5.0, ROUND(pr.avg_rating + LEAST(pr.on_time_completions, 10) * 0.05, 2)) AS effective_rating,
    pr.on_time_completions,
    pr.avg_arrival_minutes,
    pr.returning_clients,
    pr.complaints_count,
    pr.recommend_pct,
    ST_Distance(
      pr.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_meters,
    ST_Y(pr.location::geometry) AS latitude,
    ST_X(pr.location::geometry) AS longitude,
    pr.avatar_url,
    pr.estudios_url
  FROM professionals pr
  JOIN professional_professions pp ON pp.professional_id = pr.id
  WHERE
    pp.profession_id            = p_profession_id
    AND pr.available            = TRUE
    AND pr.location             IS NOT NULL
    AND pr.verification_status  = 'approved'
    -- 🔴 Radio máximo: nadie fuera de la zona de cobertura.
    AND ST_Distance(
          pr.location,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        ) < 60000
  ORDER BY
    pr.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

-- ── 5) Las columnas del cron de recordatorios, versionadas ──────────────────
-- recordatorios-pendientes/index.ts lee y escribe recordatorios_enviados y
-- ultimo_recordatorio_at en prestador_leads, pero ninguna migración las creaba:
-- un entorno nuevo hace fallar el SELECT de esa función. Aditivo e idempotente.
ALTER TABLE prestador_leads
  ADD COLUMN IF NOT EXISTS recordatorios_enviados int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_recordatorio_at timestamptz;

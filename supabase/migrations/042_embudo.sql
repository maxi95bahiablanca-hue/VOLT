-- 042 — El embudo: de cada 10 pedidos, cuantos terminan en trabajo hecho
--
-- POR QUE: en Big Pizza el embudo mostro que se caia el 47% en un punto
-- concreto, y eso cambio las prioridades. En BOLT no se mide nada: no sabemos
-- cuantos pedidos entran, cuantos se aceptan ni donde se pierden.
--
-- Un "pedido" es un quote_group (el cliente pidio una vez), no cada fila de
-- jobs: al pedir se crea una fila POR PROFESIONAL avisado, y contarlas todas
-- multiplicaria los numeros por diez.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.embudo_bolt(p_dias int DEFAULT 30)
RETURNS TABLE (
  etapa   text,
  orden   int,
  cuantos bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $emb$
  WITH pedidos AS (
    -- Un pedido = un grupo de presupuestos, o un job suelto si no tuvo grupo
    SELECT COALESCE(quote_group_id::text, id::text) AS pedido,
           bool_or(status <> 'pending')                        AS alguien_respondio,
           bool_or(quote_group_id IS NULL AND status <> 'cancelled') AS eligio,
           bool_or(arrived_at IS NOT NULL)                     AS llego,
           bool_or(status = 'completed')                       AS termino,
           max(id::text)                                       AS un_job
      FROM jobs
     WHERE created_at > now() - (p_dias || ' days')::interval
     GROUP BY COALESCE(quote_group_id::text, id::text)
  )
  SELECT 'Pidieron'::text, 1, count(*)::bigint FROM pedidos
  UNION ALL
  SELECT 'Alguien respondio', 2, count(*) FILTER (WHERE alguien_respondio) FROM pedidos
  UNION ALL
  SELECT 'Eligieron profesional', 3, count(*) FILTER (WHERE eligio) FROM pedidos
  UNION ALL
  SELECT 'El profesional llego', 4, count(*) FILTER (WHERE llego) FROM pedidos
  UNION ALL
  SELECT 'TRABAJO HECHO', 5, count(*) FILTER (WHERE termino) FROM pedidos
  UNION ALL
  SELECT 'Calificaron', 6,
         (SELECT count(DISTINCT r.job_id) FROM reviews r
           WHERE r.created_at > now() - (p_dias || ' days')::interval)
  ORDER BY 2;
$emb$;

GRANT EXECUTE ON FUNCTION public.embudo_bolt(int) TO authenticated;

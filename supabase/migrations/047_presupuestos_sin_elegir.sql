-- 047 — Presupuestos que nadie eligio: el otro lado del trabajo trabado
--
-- Maxi (1-ago-2026): "que pasa si aceptan los tres trabajadores pero el cliente
-- sigue sin aceptar?".
--
-- QUE PASABA HASTA HOY: nada. Los tres quedaban en 'accepted' con
-- quote_group_id puesto PARA SIEMPRE. El vigilante de la 040 detecta el caso
-- contrario (nadie acepto un pedido) pero no este. Los profesionales quedaban
-- con un trabajo que nunca avanza y sin saber que paso; el cliente, con tres
-- personas esperandolo sin enterarse.
--
-- Va contra la regla de que ninguna accion puede quedar trabada: si no se
-- mueve, se busca la forma de moverlo.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- ─── Presupuestos esperando que el cliente elija ────────────────────────────
-- El cliente tiene ~4 minutos en pantalla para elegir, pero puede cerrar la app
-- y volver. A los 30 minutos ya no vuelve: hay que liberar a la gente.
CREATE OR REPLACE FUNCTION public.presupuestos_sin_elegir(p_minutos int DEFAULT 30)
RETURNS TABLE (
  job_id          uuid,
  client_id       uuid,
  professional_id uuid,
  worker_user     uuid,
  desde           timestamptz,
  cuantos_esperan int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.client_id, j.professional_id, p.user_id, j.created_at,
         (SELECT count(*)::int FROM jobs o
           WHERE o.quote_group_id = j.quote_group_id AND o.status = 'accepted')
    FROM jobs j
    LEFT JOIN professionals p ON p.id = j.professional_id
   WHERE j.quote_group_id IS NOT NULL
     AND j.status = 'accepted'
     AND j.created_at < now() - make_interval(mins => p_minutos)
$$;

REVOKE ALL ON FUNCTION public.presupuestos_sin_elegir(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presupuestos_sin_elegir(int) TO authenticated;

-- ─── Liberar a los que quedaron esperando ───────────────────────────────────
-- Cancela los presupuestos que el cliente nunca eligio y devuelve cuantos
-- libero. No toca el pedido del cliente: si el quiere, pide de nuevo.
CREATE OR REPLACE FUNCTION public.liberar_presupuestos_vencidos(p_minutos int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE jobs
     SET status = 'cancelled',
         cancelled_at = now(),
         rejection_category = 'sin_eleccion',
         rejection_note = 'El cliente no eligio a nadie y se libero el presupuesto.'
   WHERE quote_group_id IS NOT NULL
     AND status = 'accepted'
     AND created_at < now() - make_interval(mins => p_minutos);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.liberar_presupuestos_vencidos(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_presupuestos_vencidos(int) TO authenticated;

COMMENT ON FUNCTION public.presupuestos_sin_elegir(int) IS
  'Profesionales que aceptaron un presupuesto y el cliente nunca eligio. Para el panel.';
COMMENT ON FUNCTION public.liberar_presupuestos_vencidos(int) IS
  'Cancela los presupuestos que quedaron esperando una eleccion que no llego.';

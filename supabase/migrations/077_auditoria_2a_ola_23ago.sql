-- ════════════════════════════════════════════════════════════════════════════
-- 077 — Auditoría 23-ago, segunda ola (altos de DB seguros y aditivos).
-- Verificado contra prod antes de escribir.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Los presupuestos aceptados SÍ se liberan ─────────────────────────────
-- liberar_presupuestos_vencidos(30) existe (047) pero ningún cron la llamaba: un
-- grupo de presupuestos que el cliente no elige quedaba 'accepted' para siempre y
-- la app revivía grupos viejos. Se agrega al cron horario que ya cierra trabajos.
SELECT cron.alter_job(
  job_id  => (SELECT jobid FROM cron.job WHERE jobname = 'cerrar-trabajos-abandonados'),
  command => 'SELECT public.cerrar_trabajos_abandonados(7), public.cerrar_pedidos_sin_respuesta(2), public.liberar_presupuestos_vencidos(30)'
);

-- ── 2) El realtime de presupuestos deja de estar muerto ─────────────────────
-- La tabla presupuestos nunca entró a la publicación supabase_realtime: la
-- suscripción de MiNegocio (presupuestoService) no recibía nada. Aditivo.
ALTER PUBLICATION supabase_realtime ADD TABLE public.presupuestos;

-- ── 3) Nadie puede reescribir los mensajes del chat ─────────────────────────
-- La política de UPDATE de messages no tenía WITH CHECK ni whitelist de columnas:
-- un participante podía reescribir el contenido de CUALQUIER mensaje del chat
-- (incluidos los del otro). La app sólo marca leído (columna read_by_other), así
-- que a 'authenticated' se le deja UPDATE únicamente sobre esa columna.
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (read_by_other) ON public.messages TO authenticated;

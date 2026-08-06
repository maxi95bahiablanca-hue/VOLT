-- 058 — Perseguir el presupuesto, y que ninguno quede colgado
--
-- Maxi (6-ago-2026), sobre que hacer cuando el cliente no contesta nunca.
-- Se eligieron dos cosas, y ninguna le pide nada al cliente:
--
--   A. RECORDATORIO PARA PERSEGUIR (a los 3 dias de que lo vio y no contesto).
--      Casi ningun oficio persigue un presupuesto: lo manda y espera. El que
--      llama a los tres dias cierra mas, y no es por mejor precio. Esto es lo
--      unico de todo el modulo que genera plata directa.
--
--   B. CIERRE SUAVE (a los 7 dias). Se pregunta UNA vez que paso, y si no hay
--      respuesta el presupuesto se vence solo. Sin esto, en tres meses hay 40
--      presupuestos "enviados" y nadie sabe cuales siguen vivos.
--
-- 🔴 LO QUE SE DESCARTO, y por que: pedirle al cliente que toque "aceptar" para
-- mejorar la valoracion del profesional. Al cliente no le importa la valoracion
-- de nadie, y es ponerle un tramite para un beneficio ajeno. La friccion tiene
-- que estar del lado del que gana algo. El profesional YA SABE si se lo
-- aceptaron: lo marca el, de un toque.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

-- ── 1. Memoria de lo que ya se hizo ─────────────────────────────────────────
ALTER TABLE presupuestos
  ADD COLUMN IF NOT EXISTS perseguido_at    timestamptz,
  ADD COLUMN IF NOT EXISTS postergado_hasta date;

COMMENT ON COLUMN presupuestos.perseguido_at IS
  'Cuando el profesional le escribio para insistir. Sin esto el recordatorio se repetiria todos los dias y lo terminaria apagando.';
COMMENT ON COLUMN presupuestos.postergado_hasta IS
  'El profesional dijo "sigue en veremos": no molestar hasta esta fecha.';

-- ── 2. Los que estan esperando respuesta ────────────────────────────────────
-- Devuelve solo lo que hace falta hacer HOY. La app no tiene que decidir nada:
-- si esta en esta lista, hay que actuar.
CREATE OR REPLACE FUNCTION public.presupuestos_esperando(p_professional_id uuid)
RETURNS TABLE (
  id             uuid,
  numero         int,
  cliente_nombre text,
  cliente_tel    text,
  total          int,
  token          text,
  estado         text,
  dias           int,
  ya_perseguido  boolean,
  toca_cerrar    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.id, pr.numero, pr.cliente_nombre, pr.cliente_tel, pr.total, pr.token, pr.estado,
         EXTRACT(DAY FROM (now() - COALESCE(pr.enviado_at, pr.created_at)))::int AS dias,
         (pr.perseguido_at IS NOT NULL)                                          AS ya_perseguido,
         -- A los 7 dias ya no se persigue mas: se pregunta que paso y se cierra.
         (COALESCE(pr.enviado_at, pr.created_at) < now() - interval '7 days')     AS toca_cerrar
    FROM presupuestos pr
    JOIN professionals p ON p.id = pr.professional_id
   WHERE p.id = p_professional_id
     AND p.user_id = auth.uid()
     AND pr.estado IN ('enviado', 'visto')
     -- Recien a los 3 dias: antes de eso no es silencio, es que todavia lo esta
     -- pensando. Insistir el mismo dia espanta.
     AND COALESCE(pr.enviado_at, pr.created_at) < now() - interval '3 days'
     -- Si dijo "sigue en veremos", no se molesta hasta la fecha que puso.
     AND (pr.postergado_hasta IS NULL OR pr.postergado_hasta <= CURRENT_DATE)
     -- Si ya insistio, no se le vuelve a pedir lo mismo por 4 dias.
     AND (pr.perseguido_at IS NULL OR pr.perseguido_at < now() - interval '4 days')
   ORDER BY COALESCE(pr.enviado_at, pr.created_at) ASC
   LIMIT 20;
$$;

-- ── 3. Ya le escribi ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_perseguido(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM presupuestos pr JOIN professionals p ON p.id = pr.professional_id
     WHERE pr.id = p_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Este presupuesto no es tuyo';
  END IF;

  UPDATE presupuestos SET perseguido_at = now() WHERE id = p_id;
END;
$$;

-- ── 4. Sigue en veremos ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_postergar(p_id uuid, p_dias int DEFAULT 7)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM presupuestos pr JOIN professionals p ON p.id = pr.professional_id
     WHERE pr.id = p_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Este presupuesto no es tuyo';
  END IF;

  UPDATE presupuestos
     SET postergado_hasta = CURRENT_DATE + p_dias,
         perseguido_at    = NULL   -- se reinicia: cuando vuelva, arranca de cero
   WHERE id = p_id;
END;
$$;

-- ── 5. Vencer los que nadie contesto ────────────────────────────────────────
-- Regla del proyecto: nada puede quedar esperando para siempre. A los 21 dias
-- sin respuesta y sin que el profesional lo haya postergado, se vence solo.
--
-- 21 y no 7 a proposito: a los 7 se PREGUNTA (eso lo hace la app), y recien si
-- no contesta nadie en tres semanas se cierra. Vencer algo que el profesional
-- todavia esta laburando seria peor que dejarlo abierto.
CREATE OR REPLACE FUNCTION public.vencer_presupuestos_viejos(p_dias int DEFAULT 21)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE presupuestos pr
     SET estado = 'vencido'
   WHERE pr.estado IN ('enviado', 'visto')
     AND COALESCE(pr.enviado_at, pr.created_at) < now() - make_interval(days => p_dias)
     AND (pr.postergado_hasta IS NULL OR pr.postergado_hasta < CURRENT_DATE)
     AND EXISTS (
       SELECT 1 FROM professionals p
        WHERE p.id = pr.professional_id AND p.user_id = auth.uid()
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.presupuestos_esperando(uuid)        FROM public, anon;
REVOKE ALL ON FUNCTION public.presupuesto_perseguido(uuid)        FROM public, anon;
REVOKE ALL ON FUNCTION public.presupuesto_postergar(uuid, int)    FROM public, anon;
REVOKE ALL ON FUNCTION public.vencer_presupuestos_viejos(int)     FROM public, anon;

GRANT EXECUTE ON FUNCTION public.presupuestos_esperando(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.presupuesto_perseguido(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.presupuesto_postergar(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vencer_presupuestos_viejos(int)  TO authenticated;

-- ── 6. Verificacion ─────────────────────────────────────────────────────────
-- SELECT numero, estado, enviado_at, perseguido_at, postergado_hasta
--   FROM presupuestos WHERE estado IN ('enviado','visto','vencido');

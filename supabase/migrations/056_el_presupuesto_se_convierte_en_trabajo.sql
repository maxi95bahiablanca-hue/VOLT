-- 056 — El presupuesto aceptado se convierte en un trabajo
--
-- Maxi (5-ago-2026): "vamos por la 3" (que el presupuesto aceptado arranque el
-- circuito completo), "pero el tema es quien lo recibe, que no tiene la app...
-- salvo que le ofrezca descargarla pero eso ya es engorroso y ningun trabajador
-- va a querer".
--
-- 🔴 ESA FRASE DEFINE TODO EL DISENO: el cliente NUNCA instala nada, no se
-- registra y no tiene cuenta. Pedirle que baje una app para ver si el plomero
-- esta en camino es la forma mas rapida de que el profesional deje de usar
-- esto. Asi que el trabajo se maneja con las dos partes donde ya estan:
--
--   · el profesional  -> en la app, un boton por paso
--   · el cliente      -> en el MISMO LINK que ya recibio por WhatsApp
--
-- La pagina deja de ser "un presupuesto" y pasa a ser "la pagina del trabajo":
-- muestra otra cosa segun el estado. El cliente no aprende nada nuevo, entra al
-- mismo lado de siempre.
--
-- POR QUE NO SE USA `jobs`: ya se decidio en la 055 y sigue valiendo. jobs exige
-- client_id de un auth.users real y client_lat/lng NOT NULL. El cliente de
-- WhatsApp no tiene ninguna de las tres cosas.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

-- ── 1. Los estados del trabajo ──────────────────────────────────────────────
-- El estado sigue siendo el mismo campo. Se le suman los de despues del si:
--   borrador -> enviado -> visto -> aceptado -> agendado -> en_camino -> hecho
--                                            \-> rechazado
ALTER TABLE presupuestos
  ADD COLUMN IF NOT EXISTS agendado_para   timestamptz,
  ADD COLUMN IF NOT EXISTS en_camino_desde timestamptz,
  ADD COLUMN IF NOT EXISTS hecho_at        timestamptz,
  ADD COLUMN IF NOT EXISTS codigo          text,
  ADD COLUMN IF NOT EXISTS viajes          int NOT NULL DEFAULT 0;

COMMENT ON COLUMN presupuestos.agendado_para IS
  'Cuando quedaron en que va. Lo carga el profesional y el cliente lo ve en su link.';
COMMENT ON COLUMN presupuestos.en_camino_desde IS
  'Mismo interruptor que jobs.on_the_way_at (054): con hora esta yendo, NULL no. Se limpia al llegar.';
COMMENT ON COLUMN presupuestos.codigo IS
  'Codigo de 4 digitos que el profesional muestra en la puerta. Se regenera en CADA viaje.';

-- ── 2. Agendar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_agendar(p_id uuid, p_cuando timestamptz)
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
     SET agendado_para = p_cuando,
         estado        = CASE WHEN estado = 'aceptado' THEN 'agendado' ELSE estado END
   WHERE id = p_id;
END;
$$;

-- ── 3. Voy en camino ────────────────────────────────────────────────────────
-- Igual que en los trabajos de la plataforma (054): abre la ventana y genera un
-- codigo NUEVO. Un trabajo de varios dias tiene varios viajes y cada uno lleva
-- su codigo; el mismo numero sirviendo dos semanas no es una seguridad.
CREATE OR REPLACE FUNCTION public.presupuesto_salir(p_id uuid)
RETURNS TABLE (codigo text, viaje int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo text;
  v_viaje  int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM presupuestos pr JOIN professionals p ON p.id = pr.professional_id
     WHERE pr.id = p_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Este presupuesto no es tuyo';
  END IF;

  v_codigo := lpad((floor(random() * 10000))::int::text, 4, '0');

  UPDATE presupuestos
     SET en_camino_desde = now(),
         codigo          = v_codigo,
         viajes          = viajes + 1,
         estado          = 'en_camino'
   WHERE id = p_id
   RETURNING viajes INTO v_viaje;

  RETURN QUERY SELECT v_codigo, v_viaje;
END;
$$;

-- ── 4. Llegue (cierra la ventana) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_llegue(p_id uuid)
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

  UPDATE presupuestos SET en_camino_desde = NULL WHERE id = p_id;
END;
$$;

-- ── 5. Trabajo hecho ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_hecho(p_id uuid)
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
     SET estado          = 'hecho',
         hecho_at        = COALESCE(hecho_at, now()),
         en_camino_desde = NULL
   WHERE id = p_id;
END;
$$;

-- ── 6. Nada queda con la ventana abierta ────────────────────────────────────
-- Misma regla de siempre: si toca "voy en camino" y se olvida, se cierra sola.
CREATE OR REPLACE FUNCTION public.cerrar_ventanas_presupuestos(p_horas int DEFAULT 3)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE presupuestos
     SET en_camino_desde = NULL
   WHERE en_camino_desde IS NOT NULL
     AND en_camino_desde < now() - make_interval(hours => p_horas);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.presupuesto_agendar(uuid, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.presupuesto_salir(uuid)                FROM public, anon;
REVOKE ALL ON FUNCTION public.presupuesto_llegue(uuid)               FROM public, anon;
REVOKE ALL ON FUNCTION public.presupuesto_hecho(uuid)                FROM public, anon;
REVOKE ALL ON FUNCTION public.cerrar_ventanas_presupuestos(int)      FROM public, anon;

GRANT EXECUTE ON FUNCTION public.presupuesto_agendar(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presupuesto_salir(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.presupuesto_llegue(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.presupuesto_hecho(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_ventanas_presupuestos(int)      TO authenticated;

-- ── 7. La pagina del cliente ahora muestra el trabajo ───────────────────────
-- Mismo link, mismo token: lo que cambia es lo que dice. El cliente no instala
-- nada, no se registra y no aprende ningun lugar nuevo.
CREATE OR REPLACE FUNCTION public.presupuesto_publico(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
           'numero',        pr.numero,
           'descripcion',   pr.descripcion,
           'total',         pr.total,
           'notas',         pr.notas,
           'estado',        pr.estado,
           'validez_dias',  pr.validez_dias,
           'creado',        pr.created_at,
           'cliente',       COALESCE(pr.cliente_nombre, mc.nombre),
           -- El trabajo, para los estados de despues del si
           'agendado_para', pr.agendado_para,
           'en_camino',     (pr.en_camino_desde IS NOT NULL),
           'hecho_at',      pr.hecho_at,
           -- El codigo se muestra SOLO mientras viene en camino: es para
           -- chequearlo en la puerta, no para que ande dando vueltas.
           'codigo',        CASE WHEN pr.en_camino_desde IS NOT NULL THEN pr.codigo END,
           'items',         COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'descripcion', i.descripcion,
                      'cantidad',    i.cantidad,
                      'precio',      i.precio_unitario
                    ) ORDER BY i.orden)
               FROM presupuesto_items i WHERE i.presupuesto_id = pr.id
           ), '[]'::jsonb),
           'empresa', jsonb_build_object(
             'nombre',    COALESCE(NULLIF(p.nombre_comercial, ''),
                                   trim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,''))),
             'telefono',  p.phone,
             'logo',      p.logo_url,
             'color',     p.color_marca,
             'instagram', p.instagram,
             'web',       p.web,
             'fiscales',  p.datos_fiscales,
             'pro',       (p.plan = 'pro')
           )
         )
    INTO v
    FROM presupuestos pr
    JOIN professionals p  ON p.id = pr.professional_id
    LEFT JOIN mis_clientes mc ON mc.id = pr.cliente_id
   WHERE pr.token = p_token;

  IF v IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE presupuestos pr
     SET visto_at = COALESCE(pr.visto_at, now()),
         estado   = CASE WHEN pr.estado = 'enviado' THEN 'visto' ELSE pr.estado END
   WHERE pr.token = p_token
     AND NOT EXISTS (
       SELECT 1 FROM professionals p
        WHERE p.id = pr.professional_id AND p.user_id = auth.uid()
     );

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.presupuesto_publico(text) TO anon, authenticated;

-- ── 8. Verificacion ─────────────────────────────────────────────────────────
-- SELECT numero, estado, agendado_para, en_camino_desde, codigo, viajes
--   FROM presupuestos ORDER BY created_at DESC;

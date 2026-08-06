-- 059 — Separar materiales de mano de obra
--
-- Maxi (6-ago-2026): "en el presupuesto los item deben en el detalle de mano de
-- obra y de presupuesto, hoy están solo del presupuesto entero, no diferencia
-- los materiales de la mano de obra... al llenarlo digo".
--
-- Hasta hoy los items eran una lista plana. Eso alcanza para sumar, pero se
-- pierde lo que el cliente mira primero: cuanto de esto es material y cuanto es
-- el trabajo de la persona. Es la pregunta numero uno frente a un presupuesto
-- de oficio, y no poder contestarla hace que el numero parezca caro.
--
-- Y del otro lado sirve igual: el material es plata que PASA por el profesional
-- (la compra y la entrega), no es lo que gana. Sin separarlos, un presupuesto de
-- 180.000 con 150.000 de termotanque parece un trabajo grande y en realidad son
-- 30.000 de mano de obra.
--
-- `tipo` queda NULL-able a proposito: los presupuestos ya cargados no se
-- inventan una clasificacion que nadie eligio. Se muestran como estaban.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

-- ── 1. Que es cada item ─────────────────────────────────────────────────────
ALTER TABLE presupuesto_items
  ADD COLUMN IF NOT EXISTS tipo text;

COMMENT ON COLUMN presupuesto_items.tipo IS
  'material | obra. NULL = cargado antes de la 059, sin clasificar: se muestra suelto y no se agrupa.';

-- Que no entre cualquier cosa, pero sin romper lo viejo (NULL sigue valiendo).
ALTER TABLE presupuesto_items DROP CONSTRAINT IF EXISTS presupuesto_items_tipo_ok;
ALTER TABLE presupuesto_items
  ADD CONSTRAINT presupuesto_items_tipo_ok
  CHECK (tipo IS NULL OR tipo IN ('material', 'obra'));

-- ── 2. La pagina del cliente, con el desglose ───────────────────────────────
-- Se devuelve el tipo de cada item y los dos subtotales ya calculados. Se
-- calculan aca y no en el navegador para que el documento impreso, la app y la
-- web digan siempre lo mismo.
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
           'agendado_para', pr.agendado_para,
           'en_camino',     (pr.en_camino_desde IS NOT NULL),
           'hecho_at',      pr.hecho_at,
           'codigo',        CASE WHEN pr.en_camino_desde IS NOT NULL THEN pr.codigo END,

           'ubicacion', CASE
             WHEN pr.en_camino_desde IS NOT NULL
              AND p.location IS NOT NULL
              AND p.location_at IS NOT NULL
              AND p.location_at > now() - interval '10 minutes'
             THEN jsonb_build_object(
                    'lat', ST_Y(p.location::geometry),
                    'lng', ST_X(p.location::geometry),
                    'hace_seg', EXTRACT(EPOCH FROM (now() - p.location_at))::int
                  )
           END,

           'items',         COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'descripcion', i.descripcion,
                      'cantidad',    i.cantidad,
                      'precio',      i.precio_unitario,
                      'tipo',        i.tipo
                    ) ORDER BY i.orden)
               FROM presupuesto_items i WHERE i.presupuesto_id = pr.id
           ), '[]'::jsonb),

           -- Los dos subtotales. NULL si no hay items de ese tipo, para que la
           -- pagina no muestre "Mano de obra $0" cuando simplemente no se cargo.
           'subtotales', jsonb_build_object(
             'material', (SELECT SUM(i.cantidad * i.precio_unitario)::int
                            FROM presupuesto_items i
                           WHERE i.presupuesto_id = pr.id AND i.tipo = 'material'),
             'obra',     (SELECT SUM(i.cantidad * i.precio_unitario)::int
                            FROM presupuesto_items i
                           WHERE i.presupuesto_id = pr.id AND i.tipo = 'obra'),
             'sin_tipo', (SELECT SUM(i.cantidad * i.precio_unitario)::int
                            FROM presupuesto_items i
                           WHERE i.presupuesto_id = pr.id AND i.tipo IS NULL)
           ),

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

-- ── 3. Verificacion ─────────────────────────────────────────────────────────
-- SELECT descripcion, tipo, cantidad, precio_unitario FROM presupuesto_items;

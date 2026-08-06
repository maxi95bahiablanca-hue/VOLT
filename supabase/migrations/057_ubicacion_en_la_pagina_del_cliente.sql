-- 057 — El cliente lo ve venir, sin instalar nada
--
-- Maxi (6-ago-2026): "puede en voy en camino, mostrar la ubi al cliente? y que
-- desp se corte una vez que llegue, al otro día o cuando sea que vaya, de nuevo
-- lo mismo".
--
-- Es la misma regla de la 054, pero para el otro lado del negocio: la ubicacion
-- se ve SOLO mientras va en camino y se apaga al llegar. La diferencia es que
-- aca el cliente NO TIENE LA APP: el mapa tiene que salir en la pagina web que
-- ya abrio desde WhatsApp.
--
-- 🔴 DOS CANDADOS, no uno:
--   1. Solo se devuelven coordenadas si `en_camino_desde` no es NULL.
--   2. Solo si la posicion es RECIENTE. Sin esto, la pagina mostraria el ultimo
--      lugar donde el profesional prendio el GPS -- que puede ser de ayer -- y
--      el cliente creeria que lo esta viendo venir. Peor que no mostrar nada es
--      mostrar algo falso.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

-- ── 1. Cuando se escribio la posicion ───────────────────────────────────────
-- professionals.location no tenia forma de saber si era de hace 30 segundos o
-- de hace dos dias.
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS location_at timestamptz;

COMMENT ON COLUMN professionals.location_at IS
  'Cuando se escribio location. Sin esto no se puede distinguir una posicion en vivo de una de ayer (057).';

-- ── 2. La pagina del cliente, ahora con el mapa ─────────────────────────────
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

           -- 🔴 La ubicacion en vivo. Los dos candados juntos: va en camino Y la
           -- posicion es de los ultimos 10 minutos. Si el GPS no viene
           -- actualizando, se devuelve NULL y la pagina muestra el estado sin
           -- mapa, en vez de un pin viejo que miente.
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

-- ── 3. Verificacion ─────────────────────────────────────────────────────────
-- SELECT numero, estado, en_camino_desde, codigo FROM presupuestos
--  WHERE en_camino_desde IS NOT NULL;

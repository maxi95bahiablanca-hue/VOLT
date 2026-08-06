-- 055 — Mi Negocio: presupuestos y clientes propios
--
-- Maxi (5-ago-2026): "BOLT no debe ser solamente una aplicacion para conseguir
-- clientes. Quiero que termine siendo la herramienta principal con la que un
-- trabajador independiente administra su negocio... Muchos trabajos aparecen
-- por WhatsApp, por recomendacion, por un vecino. Esos trabajos tambien tienen
-- que terminar dentro de Bolt."
--
-- POR QUE TABLAS NUEVAS Y NO 'jobs'. Un presupuesto de estos es para alguien
-- que NO esta en BOLT: lo llamo por telefono o le escribio por WhatsApp. Y
-- jobs exige client_id de un auth.users real, mas client_lat y client_lng NOT
-- NULL. No entra, y forzarlo contaminaria la maquina de estados, los vigilantes
-- y el cierre automatico, que hoy funcionan.
--
-- OJO CON LA PALABRA. En BOLT "presupuesto" ya significa otra cosa: la
-- cotizacion que hacen hasta 3 profesionales sobre un pedido que entro POR la
-- plataforma (jobs.quote_group_id, migracion 047). Esto es lo de AFUERA. En la
-- app se llaman distinto para que nadie se confunda.
--
-- LA REGLA QUE ORDENA EL DISENO: no se obliga a crear el cliente antes de
-- trabajar. Primero se hace el presupuesto; despues BOLT pregunta si lo guarda.
-- Por eso cliente_id es NULL-able y el nombre y telefono viven tambien sueltos
-- en el presupuesto.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- ── 1. La libreta de clientes propios ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS mis_clientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  telefono        text,
  direccion       text,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mis_clientes_prof_idx ON mis_clientes(professional_id, nombre);
CREATE INDEX IF NOT EXISTS mis_clientes_tel_idx  ON mis_clientes(professional_id, telefono);

COMMENT ON TABLE mis_clientes IS
  'La libreta del profesional. Gente que NO esta registrada en BOLT: llego por WhatsApp, por un vecino o por recomendacion.';

ALTER TABLE mis_clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mis_clientes_own" ON mis_clientes;
CREATE POLICY "mis_clientes_own" ON mis_clientes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM professionals p
             WHERE p.id = mis_clientes.professional_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM professionals p
             WHERE p.id = mis_clientes.professional_id AND p.user_id = auth.uid())
  );

-- ── 2. Los presupuestos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS presupuestos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,

  -- Numero visible, corrido por profesional. Lo pone el trigger de abajo.
  numero          int,

  -- El cliente puede no estar guardado todavia: por eso los tres campos.
  cliente_id      uuid REFERENCES mis_clientes(id) ON DELETE SET NULL,
  cliente_nombre  text,
  cliente_tel     text,

  -- Lo minimo indispensable para que exista un presupuesto.
  descripcion     text NOT NULL,
  total           int  NOT NULL DEFAULT 0,

  -- Que oficio le pidieron. Va aca y no en el cliente porque la MISMA persona
  -- te llama para electricidad en marzo y para plomeria en agosto: el oficio es
  -- del trabajo, no de la persona. Es lo que despues permite avisar "hace un
  -- ano le hiciste el service de aire" al que corresponde.
  profesion_id    int REFERENCES professions(id),

  -- Todo lo de abajo es opcional y se completa si el profesional quiere.
  notas           text,
  validez_dias    int,

  -- borrador | enviado | visto | aceptado | rechazado
  estado          text NOT NULL DEFAULT 'borrador',

  -- Link publico. Lo que se manda por WhatsApp.
  token           text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(9), 'base64'),

  -- Para volver a buscar a este cliente cuando le toque (service, mantenimiento).
  recordar_en     date,

  created_at      timestamptz NOT NULL DEFAULT now(),
  enviado_at      timestamptz,
  visto_at        timestamptz,
  aceptado_at     timestamptz,
  rechazado_at    timestamptz
);

CREATE INDEX IF NOT EXISTS presu_prof_idx     ON presupuestos(professional_id, created_at DESC);
CREATE INDEX IF NOT EXISTS presu_cliente_idx  ON presupuestos(cliente_id);
CREATE INDEX IF NOT EXISTS presu_profesion_idx ON presupuestos(profesion_id) WHERE profesion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS presu_recordar_idx ON presupuestos(recordar_en) WHERE recordar_en IS NOT NULL;

COMMENT ON TABLE presupuestos IS
  'Presupuestos que el profesional hace por su cuenta, para trabajos que NO llegaron por la plataforma. No confundir con jobs.quote_group_id.';
COMMENT ON COLUMN presupuestos.token IS
  'Va en el link que se manda por WhatsApp. Es lo unico que se necesita para verlo: no expone la tabla.';

-- El token sale de gen_random_bytes y puede traer / y + , que rompen una URL.
-- Se limpian aca y no en la app, para que valga siempre.
CREATE OR REPLACE FUNCTION public.presupuesto_antes_de_guardar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.token IS NOT NULL THEN
    NEW.token := replace(replace(replace(NEW.token, '/', ''), '+', ''), '=', '');
  END IF;

  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM presupuestos WHERE professional_id = NEW.professional_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuesto_antes ON presupuestos;
CREATE TRIGGER trg_presupuesto_antes
  BEFORE INSERT ON presupuestos
  FOR EACH ROW
  EXECUTE FUNCTION public.presupuesto_antes_de_guardar();

ALTER TABLE presupuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presupuestos_own" ON presupuestos;
CREATE POLICY "presupuestos_own" ON presupuestos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM professionals p
             WHERE p.id = presupuestos.professional_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM professionals p
             WHERE p.id = presupuestos.professional_id AND p.user_id = auth.uid())
  );

-- ── 3. El detalle, siempre opcional ─────────────────────────────────────────
-- Un presupuesto puede tener solo descripcion y total. Si el profesional quiere
-- desglosar materiales y mano de obra, van aca. Nunca es obligatorio.
CREATE TABLE IF NOT EXISTS presupuesto_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  descripcion     text NOT NULL,
  cantidad        numeric NOT NULL DEFAULT 1,
  precio_unitario int NOT NULL DEFAULT 0,
  orden           int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS presu_items_idx ON presupuesto_items(presupuesto_id, orden);

ALTER TABLE presupuesto_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presu_items_own" ON presupuesto_items;
CREATE POLICY "presu_items_own" ON presupuesto_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM presupuestos pr
              JOIN professionals p ON p.id = pr.professional_id
             WHERE pr.id = presupuesto_items.presupuesto_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM presupuestos pr
              JOIN professionals p ON p.id = pr.professional_id
             WHERE pr.id = presupuesto_items.presupuesto_id AND p.user_id = auth.uid())
  );

-- ── 4. La identidad de la empresa ───────────────────────────────────────────
-- En el plan gratis el presupuesto lleva una referencia chica a BOLT. En Pro el
-- profesional lo personaliza entero y BOLT no aparece.
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS nombre_comercial text,
  ADD COLUMN IF NOT EXISTS logo_url         text,
  ADD COLUMN IF NOT EXISTS color_marca      text,
  ADD COLUMN IF NOT EXISTS instagram        text,
  ADD COLUMN IF NOT EXISTS web              text,
  ADD COLUMN IF NOT EXISTS datos_fiscales   text,
  ADD COLUMN IF NOT EXISTS plan             text NOT NULL DEFAULT 'free';

COMMENT ON COLUMN professionals.plan IS
  'free | pro. En free el presupuesto lleva la marca BOLT; en pro sale con la identidad del profesional y sin ninguna referencia.';

-- ── 5. Ver el presupuesto desde el link, sin cuenta ─────────────────────────
-- El cliente no tiene BOLT ni tiene por que tenerlo. Abre el link y ve el
-- documento. No se abre ninguna tabla a anon: solo esta funcion, y solo si
-- acierta el token entero.
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

  -- Queda registrado que lo abrio. Para el profesional esto es informacion de
  -- venta: saber que el cliente lo vio y no contesto vale mas que el envio.
  --
  -- OJO: si el que abre el link es el PROPIO profesional (chequeando como le
  -- quedo, que es lo primero que va a hacer), no cuenta como visto. Si no, el
  -- dato mentiria justo en el unico caso en que importa.
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

-- ── 6. El cliente responde desde el link ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.responder_presupuesto(p_token text, p_acepta boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE presupuestos
     SET estado       = CASE WHEN p_acepta THEN 'aceptado' ELSE 'rechazado' END,
         aceptado_at  = CASE WHEN p_acepta THEN now() ELSE aceptado_at END,
         rechazado_at = CASE WHEN p_acepta THEN rechazado_at ELSE now() END
   WHERE token = p_token
     AND estado IN ('enviado', 'visto');   -- un borrador no se puede aceptar
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.responder_presupuesto(text, boolean) TO anon, authenticated;

-- ── 7. Verificacion ─────────────────────────────────────────────────────────
-- SELECT numero, estado, total, cliente_nombre, token FROM presupuestos
--  ORDER BY created_at DESC LIMIT 10;

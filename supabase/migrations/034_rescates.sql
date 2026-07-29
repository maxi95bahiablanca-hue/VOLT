-- ─────────────────────────────────────────────────────────────────────────────
-- 034 — Rescate de pedidos sin profesional
--
-- Si no hay nadie cerca o se venció el tiempo sin que ninguno respondiera, el
-- pedido NO se pierde: queda acá y lo toma una persona a mano. El cliente se
-- entera de que lo van a contactar, y el encargado recibe el problema completo.
--
-- La app además abre el WhatsApp del cliente con el detalle escrito hacia el
-- encargado; esta tabla es la red de seguridad para cuando el cliente no toca
-- ese botón, que es justo el caso en el que se perdería la venta.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rescates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profession_id  int  REFERENCES professions(id),
  oficio         text,                    -- copia del nombre, por si cambia el catálogo
  motivo         text NOT NULL,           -- 'sin_profesionales' | 'sin_respuestas'
  notas          text,                    -- lo que contó el cliente + el cuestionario
  address        text,
  client_lat     double precision,
  client_lng     double precision,
  fotos          text[] NOT NULL DEFAULT '{}',
  quote_group_id uuid,
  estado         text NOT NULL DEFAULT 'pendiente',  -- pendiente | resuelto | perdido
  avisado_wa     boolean NOT NULL DEFAULT false,     -- el cliente abrió el WhatsApp
  nota_interna   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

CREATE INDEX IF NOT EXISTS rescates_estado_idx  ON rescates(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS rescates_cliente_idx ON rescates(client_id);

ALTER TABLE rescates ENABLE ROW LEVEL SECURITY;

-- El cliente puede dejar constancia de SU pedido y ver los suyos.
DROP POLICY IF EXISTS "rescates_insert_own" ON rescates;
CREATE POLICY "rescates_insert_own" ON rescates
  FOR INSERT WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "rescates_select_own" ON rescates;
CREATE POLICY "rescates_select_own" ON rescates
  FOR SELECT USING (auth.uid() = client_id);

-- Marcar que abrió el WhatsApp (único update que puede hacer el cliente).
DROP POLICY IF EXISTS "rescates_update_own" ON rescates;
CREATE POLICY "rescates_update_own" ON rescates
  FOR UPDATE USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);

-- El admin ve y gestiona todos. `is_admin()` ya existe (migración 028).
DROP POLICY IF EXISTS "rescates_admin_all" ON rescates;
CREATE POLICY "rescates_admin_all" ON rescates
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE rescates IS
  'Pedidos que la app no pudo asignar. Los toma una persona para que el cliente siempre tenga una solución.';

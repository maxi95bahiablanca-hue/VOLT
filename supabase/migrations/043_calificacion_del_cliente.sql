-- ─────────────────────────────────────────────────────────────────────────────
-- 043 — El profesional también califica al cliente
--
-- Pedido de Maxi (31-jul-2026): hoy la calificación va en un solo sentido. El
-- profesional se entera de cómo es el cliente recién cuando llegó al domicilio
-- y perdió el viaje. Con esto, antes de aceptar ve las estrellas de quien pide.
--
-- Va en tabla APARTE y no ampliando `reviews` porque esa tabla tiene
-- `job_id UNIQUE`: una segunda fila para el mismo trabajo no entra, y cambiar
-- esa restricción tocaría la calificación que ya está en producción.
--
-- Lo que NO se hace a propósito: el profesional no ve los comentarios sueltos
-- de otros colegas sobre el cliente (evita que un enojo de uno le cierre la
-- puerta a todos). Ve el promedio y cuántas calificaciones tiene, nada más.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  -- Motivo rápido cuando la nota es baja: 'no_estaba' | 'cambio_de_idea' |
  -- 'direccion_mal' | 'trato' | 'otro'. Sirve para ver patrones sin leer texto.
  motivo          text,
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_reviews_cliente_idx ON client_reviews(client_id);
CREATE INDEX IF NOT EXISTS client_reviews_prof_idx    ON client_reviews(professional_id);

ALTER TABLE client_reviews ENABLE ROW LEVEL SECURITY;

-- Escribe sólo el profesional que hizo ESE trabajo. Sin esto, cualquiera con la
-- anon key podría bajarle las estrellas a un cliente que nunca atendió.
DROP POLICY IF EXISTS "client_reviews_insert_own" ON client_reviews;
CREATE POLICY "client_reviews_insert_own" ON client_reviews
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
        FROM jobs j
        JOIN professionals p ON p.id = j.professional_id
       WHERE j.id = client_reviews.job_id
         AND j.professional_id = client_reviews.professional_id
         AND j.client_id       = client_reviews.client_id
         AND p.user_id         = auth.uid()
    )
  );

-- Cada profesional ve lo que él mismo escribió; el cliente ve lo que le
-- pusieron (que se entere es sano: es su reputación).
DROP POLICY IF EXISTS "client_reviews_select_propias" ON client_reviews;
CREATE POLICY "client_reviews_select_propias" ON client_reviews
  FOR SELECT USING (
    auth.uid() = client_id
    OR EXISTS (
      SELECT 1 FROM professionals p
       WHERE p.id = client_reviews.professional_id
         AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "client_reviews_admin_all" ON client_reviews;
CREATE POLICY "client_reviews_admin_all" ON client_reviews
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── La reputación que ve el profesional ANTES de aceptar ────────────────────
-- SECURITY DEFINER porque el que pregunta todavía no tiene ninguna relación con
-- ese cliente y la política de arriba no lo dejaría leer. Devuelve sólo números
-- agregados: ni comentarios, ni quién calificó, ni de qué trabajo.
CREATE OR REPLACE FUNCTION public.client_reputation(p_client_id uuid)
RETURNS TABLE (promedio numeric, cantidad int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(AVG(rating)::numeric, 2), COUNT(*)::int
    FROM client_reviews
   WHERE client_id = p_client_id;
$$;

REVOKE ALL ON FUNCTION public.client_reputation(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.client_reputation(uuid) TO authenticated;

COMMENT ON TABLE client_reviews IS
  'Calificación del CLIENTE hecha por el profesional. La reputación se lee con client_reputation().';
COMMENT ON FUNCTION public.client_reputation(uuid) IS
  'Promedio y cantidad de calificaciones de un cliente. Agregado: no expone comentarios ni autores.';

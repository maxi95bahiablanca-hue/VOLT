-- 045 — El perfil que ve el cliente antes de elegir: fotos y experiencia
--
-- Maxi (1-ago-2026): "en su perfil podrian poner fotos de trabajos... y al
-- llegar las opciones el usuario puede hacer click sobre la tarjeta del
-- trabajador y ver info y fotos".
--
-- 🔴 UNA ACLARACION QUE CAMBIA EL DISEÑO. Maxi: "no pongas que las fotos sean
-- de ellos. yo no tengo fotos porque jamas le di bola a esas cosas.. y te digo
-- que pinte 200 casas". Exigir fotos propias dejaria afuera justo a los que
-- mas saben: el oficio viejo no documenta nada. Por eso:
--   · Las fotos son OPCIONALES y no se pide que sean propias.
--   · Se agrega experiencia ESCRITA (años en el oficio + una descripcion), que
--     es lo que si tiene el que laburo toda la vida sin sacar una foto.
--   · No tener fotos NO penaliza en ningun lado.
--
-- Sin acentos ni barras invertidas: este SQL se copia y pega.
-- Seguro de correr varias veces.

-- ─── Experiencia escrita, para el que no tiene fotos ────────────────────────
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS anios_oficio  int,      -- cuantos años hace que trabaja
  ADD COLUMN IF NOT EXISTS presentacion  text;     -- "Pinto casas hace 20 años..."

COMMENT ON COLUMN professionals.anios_oficio IS
  'Años de experiencia. Vale tanto como las fotos: el oficio viejo no documenta.';

-- ─── Fotos de trabajos ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professional_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  url             text NOT NULL,
  descripcion     text,
  -- pendiente | aprobada | rechazada. Nace pendiente a proposito: estas fotos
  -- se le muestran a los clientes, asi que alguien las mira antes.
  estado          text NOT NULL DEFAULT 'pendiente',
  orden           int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prof_photos_prof_idx ON professional_photos(professional_id, orden);
CREATE INDEX IF NOT EXISTS prof_photos_estado_idx ON professional_photos(estado)
  WHERE estado = 'pendiente';

ALTER TABLE professional_photos ENABLE ROW LEVEL SECURITY;

-- Sube y borra el dueño del perfil, nadie mas.
DROP POLICY IF EXISTS "photos_insert_own" ON professional_photos;
CREATE POLICY "photos_insert_own" ON professional_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM professionals p
             WHERE p.id = professional_photos.professional_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "photos_delete_own" ON professional_photos;
CREATE POLICY "photos_delete_own" ON professional_photos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM professionals p
             WHERE p.id = professional_photos.professional_id AND p.user_id = auth.uid())
  );

-- Las APROBADAS las ve cualquiera que este logueado (el cliente eligiendo).
-- El dueño ve tambien las suyas pendientes, para saber que estan en revision.
DROP POLICY IF EXISTS "photos_read" ON professional_photos;
CREATE POLICY "photos_read" ON professional_photos
  FOR SELECT USING (
    estado = 'aprobada'
    OR EXISTS (SELECT 1 FROM professionals p
                WHERE p.id = professional_photos.professional_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "photos_admin_all" ON professional_photos;
CREATE POLICY "photos_admin_all" ON professional_photos
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE professional_photos IS
  'Fotos de trabajos que el profesional muestra en su perfil. Nacen pendientes: alguien las revisa antes de que las vea un cliente.';

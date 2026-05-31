-- 020: Pre-registro de prestadores (campaña de captación pre-lanzamiento)
-- Captura registros desde la landing pública antes de que el prestador
-- baje la app. El admin los revisa y los va activando a medida que se necesitan.

CREATE TABLE IF NOT EXISTS prestador_leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  apellido      text,
  telefono      text NOT NULL,
  profesion     text NOT NULL,        -- nombre de la profesión (texto libre del form)
  profesion_id  int,                  -- opcional: id si matchea con professions
  zona          text,
  precio_visita int,
  experiencia   text,                 -- años / descripción
  fuente        text DEFAULT 'landing', -- de dónde vino (instagram, facebook, etc.)
  estado        text NOT NULL DEFAULT 'nuevo', -- nuevo | contactado | aceptado | rechazado
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prestador_leads_estado_idx ON prestador_leads(estado, created_at);
CREATE INDEX IF NOT EXISTS prestador_leads_profesion_idx ON prestador_leads(profesion);

ALTER TABLE prestador_leads ENABLE ROW LEVEL SECURITY;

-- Cualquiera (anónimo) puede REGISTRARSE desde la landing pública.
-- Solo inserta: no puede leer ni modificar nada.
DROP POLICY IF EXISTS "anyone_can_register_as_lead" ON prestador_leads;
CREATE POLICY "anyone_can_register_as_lead" ON prestador_leads
  FOR INSERT
  WITH CHECK (true);

-- Solo el admin (por email) puede leer y gestionar los leads.
DROP POLICY IF EXISTS "admin_reads_leads" ON prestador_leads;
CREATE POLICY "admin_reads_leads" ON prestador_leads
  FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com');

DROP POLICY IF EXISTS "admin_updates_leads" ON prestador_leads;
CREATE POLICY "admin_updates_leads" ON prestador_leads
  FOR UPDATE
  USING ((auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com');

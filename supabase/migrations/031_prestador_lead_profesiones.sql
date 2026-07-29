-- 031 — Oficios de prestador_leads normalizados (N:N)
--
-- Problema: el registro deja elegir hasta 3 oficios, pero prestador_leads los
-- guardaba concatenados en un solo texto ('Electricista, Pintor, Durlock') y
-- profesion_id se quedaba SOLO con el primero. El panel de admin los mostraba
-- como una única categoría, y el filtro/estadísticas trataban esa cadena como
-- si fuera un oficio más.
--
-- Solución: una fila por oficio en prestador_lead_profesiones, con el id del
-- catálogo cuando matchea. La tabla se mantiene sola por trigger a partir de
-- prestador_leads.profesion, así los formularios y la Edge Function
-- completar-registro siguen funcionando sin tocarlos.
--
-- Idempotente: se puede correr varias veces.

CREATE TABLE IF NOT EXISTS prestador_lead_profesiones (
  lead_id          uuid NOT NULL REFERENCES prestador_leads(id) ON DELETE CASCADE,
  profesion_nombre text NOT NULL,
  profesion_id     int  REFERENCES professions(id),
  PRIMARY KEY (lead_id, profesion_nombre)
);

CREATE INDEX IF NOT EXISTS plp_profesion_id_idx     ON prestador_lead_profesiones(profesion_id);
CREATE INDEX IF NOT EXISTS plp_profesion_nombre_idx ON prestador_lead_profesiones(profesion_nombre);

-- ─── Sincronización desde el texto ────────────────────────────────
-- Separa por coma, limpia espacios, descarta vacíos y el placeholder
-- 'A completar', y resuelve el id contra el catálogo (sin distinguir
-- mayúsculas). Si un oficio no está en professions, queda con id NULL
-- pero igual se registra el nombre.
CREATE OR REPLACE FUNCTION sync_prestador_lead_profesiones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM prestador_lead_profesiones WHERE lead_id = NEW.id;

  INSERT INTO prestador_lead_profesiones (lead_id, profesion_nombre, profesion_id)
  SELECT DISTINCT ON (lower(t.nombre))
         NEW.id,
         t.nombre,
         p.id
  FROM (
    SELECT btrim(x) AS nombre
    FROM unnest(string_to_array(COALESCE(NEW.profesion, ''), ',')) AS x
  ) t
  LEFT JOIN professions p ON lower(p.name) = lower(t.nombre)
  WHERE t.nombre <> ''
    AND lower(t.nombre) <> 'a completar'
  ORDER BY lower(t.nombre);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_prestador_lead_profesiones ON prestador_leads;
CREATE TRIGGER trg_sync_prestador_lead_profesiones
  AFTER INSERT OR UPDATE OF profesion ON prestador_leads
  FOR EACH ROW
  EXECUTE FUNCTION sync_prestador_lead_profesiones();

-- ─── Backfill de los leads que ya estaban cargados ───────────────
INSERT INTO prestador_lead_profesiones (lead_id, profesion_nombre, profesion_id)
SELECT DISTINCT ON (l.id, lower(t.nombre))
       l.id,
       t.nombre,
       p.id
FROM prestador_leads l
CROSS JOIN LATERAL (
  SELECT btrim(x) AS nombre
  FROM unnest(string_to_array(COALESCE(l.profesion, ''), ',')) AS x
) t
LEFT JOIN professions p ON lower(p.name) = lower(t.nombre)
WHERE t.nombre <> ''
  AND lower(t.nombre) <> 'a completar'
ORDER BY l.id, lower(t.nombre)
ON CONFLICT (lead_id, profesion_nombre) DO NOTHING;

-- ─── RLS ──────────────────────────────────────────────────────────
-- Solo el admin lee. Nadie escribe por API: la tabla la mantiene el
-- trigger (SECURITY DEFINER), igual que se escribía el texto antes.
ALTER TABLE prestador_lead_profesiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_reads_lead_profesiones" ON prestador_lead_profesiones;
CREATE POLICY "admin_reads_lead_profesiones" ON prestador_lead_profesiones
  FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com');

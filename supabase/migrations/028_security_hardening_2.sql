-- =====================================================
-- BOLT — Migración 028: Hardening de seguridad (auditoría 2026-07-02)
-- Idempotente. Ejecutar en Supabase SQL Editor (o via management API).
--
-- Arregla:
--   1. admins + is_admin(): un solo lugar para el mail de admin (antes hardcodeado en 4 políticas)
--   2. push_tokens_read_any: la 026 la había RECREADO (deshizo el hardening de la 019)
--   3. Bucket prestador-docs: era PÚBLICO → DNI/selfies/antecedentes legibles por cualquiera
--   4. Trigger que protege los campos de dinero de jobs (visit_paid, montos, comisión)
--      → antes el cliente podía marcar visit_paid=true o cambiar montos desde la app
--   5. jobs_update_parties: el WITH CHECK de la 003 bloqueaba TODO status='completed',
--      lo que rompe el "Finalizar" del modo gratis → se reemplaza por regla fina en trigger
--   6. Política DELETE de prestador_leads (faltaba: el botón Eliminar del admin no borraba)
-- =====================================================

-- ─── 1. Tabla admins + función is_admin() ────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admins (email) VALUES ('maxi95.bahiablanca@gmail.com') ON CONFLICT DO NOTHING;

-- Sin políticas: solo service_role la lee directo; el resto usa is_admin().
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE email = (auth.jwt() ->> 'email'));
$$;

-- ─── 2. push_tokens: cerrar lectura pública (reabierta por error en la 026) ──
-- El envío de push se hace server-side (edge function send-push con service_role).
DROP POLICY IF EXISTS "push_tokens_read_any" ON push_tokens;

-- ─── 3. Bucket prestador-docs: PRIVADO + límites de tamaño y tipo ────────────
-- Contiene DNI frente/dorso, selfie y antecedentes de los prestadores.
UPDATE storage.buckets
SET public             = false,
    file_size_limit    = 10485760,  -- 10 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
WHERE id = 'prestador-docs';

-- Lectura: SOLO admin (el panel genera signed URLs con su sesión).
DROP POLICY IF EXISTS "prestador_docs_read" ON storage.objects;
CREATE POLICY "prestador_docs_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'prestador-docs' AND is_admin());

-- Subida: sigue abierta (formulario público de registro), pero ahora el bucket
-- limita tamaño y MIME. Se recrea igual por idempotencia.
DROP POLICY IF EXISTS "prestador_docs_insert" ON storage.objects;
CREATE POLICY "prestador_docs_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'prestador-docs');

-- ─── 4. prestador_leads: políticas de admin via is_admin() + DELETE ──────────
DROP POLICY IF EXISTS "admin_reads_leads" ON prestador_leads;
CREATE POLICY "admin_reads_leads" ON prestador_leads
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "admin_updates_leads" ON prestador_leads;
CREATE POLICY "admin_updates_leads" ON prestador_leads
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "admin_deletes_leads" ON prestador_leads;
CREATE POLICY "admin_deletes_leads" ON prestador_leads
  FOR DELETE USING (is_admin());

-- ─── 5. professional_payout: admin via is_admin() (antes email hardcodeado) ──
DROP POLICY IF EXISTS "payout_owner_or_admin" ON professional_payout;
CREATE POLICY "payout_owner_or_admin" ON professional_payout
FOR ALL
USING (
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  OR is_admin()
)
WITH CHECK (
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  OR is_admin()
);

-- ─── 6. jobs: trigger de protección de campos de dinero ──────────────────────
-- Reglas (solo para usuarios normales; el backend con service_role pasa siempre):
--   • visit_paid, visit_amount y commission_pct: NO editables desde la app.
--     (visit_paid lo confirma únicamente el webhook de MP con service_role)
--   • work_amount / materials_cost: congelados cuando el trabajo ya espera pago
--     o terminó (la negociación previa in_progress sigue funcionando igual).
--   • awaiting_payment → completed: SOLO el webhook (pago confirmado).
--     in_progress/arrived → completed sigue permitido (modo gratis: pago directo).
CREATE OR REPLACE FUNCTION protect_job_money_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- El backend (service_role) y los roles internos de Supabase pasan siempre
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.visit_paid IS DISTINCT FROM OLD.visit_paid THEN
    RAISE EXCEPTION 'visit_paid solo lo confirma el sistema de pagos';
  END IF;

  IF NEW.visit_amount IS DISTINCT FROM OLD.visit_amount THEN
    RAISE EXCEPTION 'visit_amount no se puede modificar despues de crear el trabajo';
  END IF;

  IF NEW.commission_pct IS DISTINCT FROM OLD.commission_pct THEN
    RAISE EXCEPTION 'commission_pct no se puede modificar despues de crear el trabajo';
  END IF;

  IF OLD.status IN ('awaiting_payment', 'completed')
     AND (NEW.work_amount IS DISTINCT FROM OLD.work_amount
          OR NEW.materials_cost IS DISTINCT FROM OLD.materials_cost) THEN
    RAISE EXCEPTION 'Los montos no se pueden modificar cuando el trabajo espera pago o termino';
  END IF;

  IF NEW.status = 'completed' AND OLD.status = 'awaiting_payment' THEN
    RAISE EXCEPTION 'Un trabajo pendiente de pago solo lo completa el sistema de pagos';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_job_money ON jobs;
CREATE TRIGGER trg_protect_job_money
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION protect_job_money_fields();

-- ─── 7. jobs_update_parties: reemplaza el WITH CHECK rígido de la 003 ────────
-- La 003 bloqueaba TODO update con status='completed', lo que rompe el
-- "Finalizar trabajo" del modo gratis (el trabajador completa directo).
-- La protección fina ahora la hace el trigger de arriba.
DROP POLICY IF EXISTS "jobs_update_parties" ON jobs;
CREATE POLICY "jobs_update_parties" ON jobs
FOR UPDATE
USING (
  auth.uid() = client_id OR
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
)
WITH CHECK (
  auth.uid() = client_id OR
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
);

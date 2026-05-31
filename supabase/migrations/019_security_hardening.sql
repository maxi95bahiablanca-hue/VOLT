-- 019: Hardening de seguridad (auditoría)
-- Ejecutar en Supabase SQL Editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CUIT/CBU: mover a tabla protegida (antes cualquier user los leía vía USING(true))
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professional_payout (
  professional_id uuid PRIMARY KEY REFERENCES professionals(id) ON DELETE CASCADE,
  cuit       text,
  cbu        text,
  updated_at timestamptz DEFAULT now()
);

-- Copiar datos existentes desde professionals
INSERT INTO professional_payout (professional_id, cuit, cbu)
SELECT id, cuit, cbu FROM professionals
WHERE (cuit IS NOT NULL OR cbu IS NOT NULL)
ON CONFLICT (professional_id) DO NOTHING;

-- Vaciar las columnas sensibles de professionals (ya no se exponen vía USING(true))
UPDATE professionals SET cuit = NULL, cbu = NULL;

ALTER TABLE professional_payout ENABLE ROW LEVEL SECURITY;

-- Solo el dueño del registro o el admin pueden leer/escribir los datos bancarios
DROP POLICY IF EXISTS "payout_owner_or_admin" ON professional_payout;
CREATE POLICY "payout_owner_or_admin" ON professional_payout
FOR ALL
USING (
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  OR (auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com'
)
WITH CHECK (
  auth.uid() = (SELECT user_id FROM professionals WHERE id = professional_id)
  OR (auth.jwt() ->> 'email') = 'maxi95.bahiablanca@gmail.com'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESEÑAS: solo se puede reseñar si existe un trabajo COMPLETADO entre ambos
--    (antes: cualquier cliente podía insertar reseñas falsas / review-bombing)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reviews_insert_own" ON reviews;
CREATE POLICY "reviews_insert_own" ON reviews
FOR INSERT WITH CHECK (
  auth.uid() = client_id
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = job_id
      AND j.client_id = auth.uid()
      AND j.professional_id = reviews.professional_id
      AND j.status = 'completed'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PUSH TOKENS: quitar lectura pública (antes cualquiera leía los tokens de todos)
--    El envío de push ahora se hace server-side con la Edge Function `send-push`
--    (service_role, que bypasea RLS). La app ya no lee tokens de otros usuarios.
--    IMPORTANTE: deployar la Edge Function `send-push` ANTES de correr esto.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "push_tokens_read_any" ON push_tokens;

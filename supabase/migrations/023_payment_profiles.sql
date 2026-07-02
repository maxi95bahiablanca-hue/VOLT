-- 023 — Tarjetas guardadas: cada cliente tiene un "customer" de Mercado Pago.
-- Las tarjetas viven en MP (no guardamos números acá), solo el id del customer.

CREATE TABLE IF NOT EXISTS payment_profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mp_customer_id text NOT NULL,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE payment_profiles ENABLE ROW LEVEL SECURITY;

-- El dueño puede ver su propio perfil de pago (las mutaciones las hace el backend con service_role)
DROP POLICY IF EXISTS "payment_profiles_own_select" ON payment_profiles;
CREATE POLICY "payment_profiles_own_select" ON payment_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

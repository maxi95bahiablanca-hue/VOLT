-- 029 — Registro de prestador desde la APP (login con Google)
-- La app permite registrarse como profesional SOLO con Google: crea el lead
-- con el email/nombre de la cuenta y le manda el mail para completar el resto
-- (WhatsApp, oficio, DNI, docs) por el link, como el flujo web de hoy.
-- Seguro de correr varias veces (idempotente).

-- El WhatsApp ya NO se pide en el alta (viene después, al completar) → nullable.
ALTER TABLE prestador_leads ALTER COLUMN telefono DROP NOT NULL;

-- Vinculamos el lead a la cuenta autenticada (auth.users) que lo originó desde
-- la app. Sirve para, cuando se apruebe, activar al profesional en SU cuenta.
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS user_id uuid;

-- Defensivo: columnas que usa el flujo de completar/mail (por si faltara alguna
-- en algún entorno; si ya existen, no hace nada).
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS completar_token text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS ciudad          text;
ALTER TABLE prestador_leads ADD COLUMN IF NOT EXISTS monotributo_url text;

CREATE INDEX IF NOT EXISTS prestador_leads_user_id_idx ON prestador_leads(user_id);
CREATE INDEX IF NOT EXISTS prestador_leads_token_idx   ON prestador_leads(completar_token);

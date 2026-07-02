-- 021 — VOLT socio: confirmación multi-día del cliente + flujo de materiales con aprobación y comprobante
-- Seguro de correr varias veces (IF NOT EXISTS).

-- ── #2 Confirmación del cliente del plan multi-día ──────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS multiday_confirmed boolean DEFAULT false;

-- ── #3 Materiales: aviso/coordinación (se pagan APARTE, no por la app) ───────
-- materials_status: 'none' | 'proposed' | 'approved' | 'client_provides'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials_status          text    DEFAULT 'none';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials_estimate        integer;         -- estimado informado por el pro
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials_estimate_detail text;            -- ej: "Disyuntor 16A + cable"

-- =====================================================
-- VOLT — Migración 006: Columnas de flujo de trabajo
-- Ejecutar en Supabase SQL Editor DESPUÉS de 005
-- =====================================================

-- ─── JOBS: flujo de compra de materiales ────────────────────────────────────
-- Cuando el profesional llega y necesita comprar materiales, sale del domicilio
-- y vuelve. La app trackea esto para mantener al cliente informado.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS is_buying_materials BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS materials_eta        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_duration_est    TEXT,
  -- Costo de materiales que el trabajador adelantó (sin comisión VOLT).
  -- work_amount = solo mano de obra. materials_cost = repuestos/insumos.
  ADD COLUMN IF NOT EXISTS materials_cost       INT     NOT NULL DEFAULT 0;

-- Índice para buscar jobs activos con compra de materiales en curso
CREATE INDEX IF NOT EXISTS jobs_buying_materials_idx
  ON jobs(is_buying_materials)
  WHERE is_buying_materials = TRUE;

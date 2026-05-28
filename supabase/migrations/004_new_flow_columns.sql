-- =====================================================
-- VOLT — Migración 004: Columnas del nuevo flujo de trabajo
-- Ejecutar en Supabase SQL Editor DESPUÉS de 003
-- =====================================================

-- ─── JOBS: código de verificación (seguridad en la puerta) ───────────────
-- El trabajador muestra este código al cliente antes de que abra.
-- Se genera al aceptar el trabajo (4 dígitos).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS verification_code TEXT;

-- ─── JOBS: estimación de llegada (informar al cliente) ───────────────────
-- Texto libre: '~15 min', '~30 min', '~45 min', '~1 hora', '+1 hora'
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS arrival_estimate TEXT;

-- ─── JOBS: ¿necesita materiales? (pre-diagnóstico del trabajador) ────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS materials_needed BOOLEAN;

-- ─── PROFESSIONALS: disponible a partir de (para volver automáticamente) ─
-- Cuando un trabajador termina un trabajo elige cuándo vuelve a estar
-- disponible. NULL = disponible ahora. Timestamp = disponible a partir de.
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;

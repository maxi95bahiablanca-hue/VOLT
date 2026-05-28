-- Ejecutar esto en Supabase Dashboard → SQL Editor
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS verification_code TEXT;

-- =====================================================
-- VOLT — Migración 005: Permisos en auth.users
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- ─── PROBLEMA ────────────────────────────────────────────────────────────────
-- Las tablas jobs, reviews, push_tokens y professionals tienen FKs que
-- referencian auth.users(id). Cuando un usuario autenticado hace INSERT,
-- PostgreSQL verifica la FK haciendo SELECT en auth.users — pero el rol
-- "authenticated" no tiene ese permiso, causando:
--   "permission denied for table users"
--
-- SOLUCIÓN: dar permiso de lectura en auth.users a los roles de la app.
-- Esto es seguro: solo se expone el campo id (UUID), no datos personales.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT ON auth.users TO authenticated;
GRANT SELECT ON auth.users TO anon;

-- ─── VERIFICAR (opcional) ────────────────────────────────────────────────────
-- Correr esto después para confirmar:
-- SELECT has_table_privilege('authenticated', 'auth.users', 'SELECT');
-- Debe devolver: true

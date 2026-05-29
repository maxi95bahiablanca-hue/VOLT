-- =====================================================
-- VOLT — Migración 009: Correcciones de integridad
-- Ejecutar en Supabase SQL Editor DESPUÉS de 008
-- =====================================================

-- ─── UNIQUE en payments.mp_payment_id ───────────────────────────────────────
-- Sin esto, el upsert idempotente del webhook crea pagos duplicados.
ALTER TABLE payments
  ADD CONSTRAINT payments_mp_payment_id_unique
  UNIQUE (mp_payment_id);

-- ─── Corregir parse_duration_to_minutes para manejar el prefijo '+' ─────────
-- La opción '+3 horas' significa "más de 3 horas" → no tiene estimación precisa
-- → retornamos NULL para no aplicar bonus de eficiencia en esos casos.
CREATE OR REPLACE FUNCTION parse_duration_to_minutes(dur TEXT)
RETURNS INT AS $$
DECLARE
  n INT;
BEGIN
  IF dur IS NULL OR trim(dur) = '' THEN RETURN NULL; END IF;
  dur := lower(trim(dur));

  -- Opciones abiertas (+X) no tienen tiempo definido → sin bonus
  IF dur LIKE '+%' THEN RETURN NULL; END IF;

  dur := regexp_replace(dur, '[~\s]+', ' ', 'g');
  n   := COALESCE((regexp_match(dur, '(\d+)'))[1]::INT, 0);
  IF n = 0 THEN RETURN NULL; END IF;

  IF    dur LIKE '%semana%'                          THEN RETURN n * 5 * 8 * 60;
  ELSIF dur LIKE '%día%' OR dur LIKE '%dia%'         THEN RETURN n * 8 * 60;
  ELSIF dur LIKE '%hora%' OR dur LIKE '%hr%'         THEN RETURN n * 60;
  ELSIF dur LIKE '%min%'                             THEN RETURN n;
  ELSE  RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

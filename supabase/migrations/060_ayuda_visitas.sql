-- 060 — Cuantas veces se abre cada pagina de ayuda
--
-- Maxi (6-ago-2026) preguntó qué mejorar del centro de ayuda. Esto es lo que
-- más le sirve a él: 🔴 LA PAGINA DE AYUDA MAS VISITADA ES EL BUG MAS CARO.
--
-- Si "disponibilidad" se lleva el 80% de las visitas, no significa que la guia
-- este buena: significa que activar el radar esta mal resuelto en la app. La
-- ayuda es un termometro del producto, no un fin en si misma.
--
-- No se guarda NADA de quien entra: ni ip, ni user agent, ni sesion. Solo
-- cuantas veces se abrio cada pagina y cuando fue la ultima. No hace falta mas
-- para lo que se quiere saber, y menos datos es menos que cuidar.

CREATE TABLE IF NOT EXISTS ayuda_visitas (
  pagina     text PRIMARY KEY,
  visitas    bigint NOT NULL DEFAULT 0,
  ultima_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ayuda_visitas IS
  'Cuantas veces se abrio cada pagina de bolt.com.ar/ayuda. Sin datos de quien entra.';

ALTER TABLE ayuda_visitas ENABLE ROW LEVEL SECURITY;
-- Nadie lee la tabla directo (ni siquiera logueado): se mira por SQL o por el
-- panel de Supabase. Escribir solo se puede por la funcion de abajo.

CREATE OR REPLACE FUNCTION public.ayuda_visita(p_pagina text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  -- Se acepta solo un nombre corto y conocido. Sin esto, cualquiera podria
  -- llenar la tabla de basura desde la consola del navegador.
  v := lower(trim(coalesce(p_pagina, '')));
  IF v !~ '^[a-z-]{1,30}$' THEN
    RETURN;
  END IF;

  INSERT INTO ayuda_visitas (pagina, visitas, ultima_at)
       VALUES (v, 1, now())
  ON CONFLICT (pagina)
  DO UPDATE SET visitas = ayuda_visitas.visitas + 1, ultima_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.ayuda_visita(text) TO anon, authenticated;

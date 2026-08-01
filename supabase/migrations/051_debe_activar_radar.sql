-- 051 — Estar "disponible" y no aparecer en el mapa son cosas distintas
--
-- 1-ago-2026. Maxi pidio prenderles el radar a todos los aprobados y probar si
-- figuraban. Prendido quedo, pero **no figura ninguno**: de 10, ocho nunca
-- guardaron una ubicacion. Buscando desde el centro de Bahia Blanca solo
-- aparecen Leonardo y Maxi, los dos unicos que alguna vez tuvieron la app con
-- el radar encendido.
--
-- La ubicacion no se puede poner por SQL: la toma el telefono cuando la persona
-- activa su disponibilidad y da el permiso de GPS. Sin eso, `available = true`
-- es una marca que no sirve para nada — y encima es peor que estar apagado,
-- porque parece que esta todo bien.
--
-- Por eso "le falta algo para trabajar" no se puede decidir mirando solo
-- `available`. Esta funcion lo dice completo, para la persona que la llama.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.debe_activar_radar()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM professionals
     WHERE user_id = auth.uid()
       AND verification_status = 'approved'
       AND (available IS DISTINCT FROM true OR location IS NULL)
  );
$$;

REVOKE ALL ON FUNCTION public.debe_activar_radar() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.debe_activar_radar() TO authenticated;

COMMENT ON FUNCTION public.debe_activar_radar() IS
  'true si a quien llama le falta el ultimo paso para recibir trabajos: el radar apagado o sin ubicacion guardada.';

SELECT 'MIG051 creada=' ||
       (SELECT COUNT(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'debe_activar_radar') AS r;

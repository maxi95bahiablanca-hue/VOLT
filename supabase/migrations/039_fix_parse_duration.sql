-- 039 — EL BUG QUE NO DEJABA FINALIZAR NI CANCELAR NINGÚN TRABAJO
--
-- 🔴 Síntoma (31-jul-2026): "No se pudo finalizar el trabajo. Intentá de nuevo."
-- y tampoco se podía cancelar. El error real, que la app se tragaba en un catch
-- mudo, sale al hacer el UPDATE a mano:
--
--   ERROR 22P02: sintaxis de entrada no valida para el tipo entero: "d"
--   CONTEXTO: parse_duration_to_minutes(text) linea 8
--             check_efficiency_bonus() linea 5
--
-- CAUSA: la función de la migración 008 usa el patrón '(\d+)' para sacar el
-- número de textos como "3 días". En la copia que quedó viva en producción **la
-- barra invertida se perdió** (pegar SQL con \d en un editor que lo interpreta),
-- así que el patrón quedó '(d+)': en "3 días" no captura el 3, captura la "d" —
-- y 'd'::INT revienta.
--
-- Como esto corre dentro de un TRIGGER de UPDATE sobre jobs
-- (trg_z_efficiency_bonus), la excepción tumba el update entero. De ahí que no
-- se pudiera finalizar NI cancelar NI mover un trabajo con duración en días.
--
-- ARREGLO: misma lógica, pero sacando los dígitos con regexp_replace sobre el
-- rango [^0-9], que NO usa barras invertidas y por lo tanto no se puede volver a
-- romper al copiar y pegar. Y un guarda por las dudas: ante cualquier texto raro
-- devuelve NULL en vez de tirar la operación abajo.
--
-- Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.parse_duration_to_minutes(dur TEXT)
RETURNS INT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  txt TEXT;
  solo_numeros TEXT;
  n INT;
BEGIN
  IF dur IS NULL OR trim(dur) = '' THEN RETURN NULL; END IF;
  txt := lower(trim(dur));
  -- Las vocales acentuadas van por su codigo: si el SQL se copia y pega, un
  -- acento mal codificado rompia la funcion entera (paso el 31-jul-2026).
  txt := replace(replace(replace(replace(replace(txt,
         chr(225),'a'), chr(233),'e'), chr(237),'i'), chr(243),'o'), chr(250),'u');

  solo_numeros := regexp_replace(txt, '[^0-9]', '', 'g');
  IF solo_numeros = '' THEN RETURN NULL; END IF;

  BEGIN
    n := left(solo_numeros, 6)::INT;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF n = 0 THEN RETURN NULL; END IF;

  IF    txt LIKE '%semana%' THEN RETURN n * 5 * 8 * 60;
  ELSIF txt LIKE '%dia%'    THEN RETURN n * 8 * 60;
  ELSIF txt LIKE '%hora%'   THEN RETURN n * 60;
  ELSIF txt LIKE '%hr%'     THEN RETURN n * 60;
  ELSIF txt LIKE '%min%'    THEN RETURN n;
  ELSE  RETURN NULL;
  END IF;
END;
$$;

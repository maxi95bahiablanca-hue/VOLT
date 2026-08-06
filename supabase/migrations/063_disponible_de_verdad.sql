-- 063 - "Disponible" tiene que significar disponible
--
-- 6-ago-2026. Estado real de produccion al revisarlo:
--
--   11 profesionales, TODOS aprobados. Solo 3 pueden recibir un trabajo.
--   SIETE tienen available = true y NINGUNA ubicacion guardada.
--
-- La migracion 051 ya habia diagnosticado esto el 1-ago y lo dijo con todas las
-- letras: "available = true es una marca que no sirve para nada -- y encima es
-- peor que estar apagado, porque parece que esta todo bien". Pero solo agrego
-- una funcion para AVISARLE a la persona. Cinco dias despues el dato sigue
-- mintiendo igual, porque nada impide escribirlo.
--
-- 🔴 POR QUE ESTO IMPORTA MAS DE LO QUE PARECE. `nearby_workers` exige
--    approved + available + location. Un profesional con available = true y sin
--    location no aparece en ninguna busqueda, pero:
--      · el panel lo cuenta como disponible,
--      · el profesional cree que esta laburando,
--      · y cuando no le llega nada, la conclusion es "BOLT no funciona".
--    Cuatro de esos siete ni siquiera tienen la app instalada: ese available
--    se lo puso un UPDATE por SQL. La ubicacion NO se puede cargar por SQL --
--    la toma el telefono al activar el radar.
--
-- La app ya se arreglo (el 5-ago dejo de marcar disponible si el GPS falla),
-- pero eso cubre un solo camino. El panel, un UPDATE a mano o cualquier
-- pantalla nueva pueden volver a mentir. Esto lo cierra donde vive el dato.
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

-- ─── 1. Que el dato deje de mentir ──────────────────────────────────────────
-- No se les apaga nada real: ya estaban invisibles. Lo unico que cambia es que
-- ahora el sistema lo dice, y al abrir la app van a ver el radar apagado -- que
-- es justo lo que hay que tocar para que se guarde la ubicacion.
UPDATE professionals
   SET available = false
 WHERE available IS TRUE
   AND location IS NULL;

-- ─── 2. Que no pueda volver a pasar ─────────────────────────────────────────
--
-- Se corrige en silencio en vez de tirar error, a proposito: un error acá
-- rompería el panel y el alta de la calle, y el que se rompe no es el que se
-- equivoca. Bajar la marca es la verdad -- sin ubicacion no hay disponibilidad
-- posible -- y ademas es visible: el profesional ve el radar apagado y lo
-- prende, que es el unico camino que carga la ubicacion.
CREATE OR REPLACE FUNCTION public.tg_disponible_necesita_ubicacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.available IS TRUE AND NEW.location IS NULL THEN
    NEW.available := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_disponible_necesita_ubicacion ON public.professionals;
CREATE TRIGGER trg_disponible_necesita_ubicacion
  BEFORE INSERT OR UPDATE ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.tg_disponible_necesita_ubicacion();

COMMENT ON FUNCTION public.tg_disponible_necesita_ubicacion() IS
  'Sin ubicacion guardada no hay disponibilidad posible: nearby_workers no lo devuelve. Baja la marca en vez de dejar un estado que miente.';

-- ─── 3. Para poder mirarlo de un vistazo ────────────────────────────────────
-- Lo que hoy hay que reconstruir a mano cada vez que alguien pregunta "por que
-- no me llega ningun trabajo". Devuelve el motivo exacto, no un si/no.
CREATE OR REPLACE FUNCTION public.estado_operativo()
RETURNS TABLE (
  professional_id uuid,
  nombre          text,
  puede_recibir   boolean,
  le_falta        text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         (p.first_name || ' ' || COALESCE(p.last_name, '')),
         (p.verification_status = 'approved'
          AND p.available IS TRUE
          AND p.location IS NOT NULL
          AND EXISTS (SELECT 1 FROM professional_professions pp WHERE pp.professional_id = p.id)),
         CASE
           WHEN p.verification_status <> 'approved' THEN 'Falta aprobarlo'
           WHEN NOT EXISTS (SELECT 1 FROM professional_professions pp WHERE pp.professional_id = p.id)
             THEN 'No eligio ningun oficio'
           WHEN NOT EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = p.user_id)
             THEN 'Nunca abrio la app'
           WHEN p.location IS NULL THEN 'Nunca prendio el radar (no hay ubicacion)'
           WHEN p.available IS NOT TRUE THEN 'Tiene el radar apagado'
           ELSE NULL
         END
    FROM professionals p
   ORDER BY 3 DESC, p.created_at;
$$;

-- 🔴 NO se le da a `authenticated`: devuelve la lista COMPLETA de profesionales
--    con nombre y estado, y no filtra por quien pregunta. Con ese grant,
--    cualquier usuario logueado se bajaba el padron entero. La usan el reporte
--    diario y las consultas de mantenimiento, las dos con la clave de servicio.
REVOKE ALL ON FUNCTION public.estado_operativo() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estado_operativo() TO service_role;

COMMENT ON FUNCTION public.estado_operativo() IS
  'Quien puede recibir trabajos hoy y, si no puede, que le falta exactamente.';

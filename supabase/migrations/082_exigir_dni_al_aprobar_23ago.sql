-- ════════════════════════════════════════════════════════════════════════════
-- 082 — Auditoría 23-ago (decisión de Maxi): NO se aprueba a un prestador sin
-- selfie + DNI (frente y dorso). Así la promesa de la app ("profesional
-- verificado") es verdad. Cubre TODOS los caminos de aprobación (panel web,
-- admin_set_verification, cualquier UPDATE) porque es un trigger sobre la tabla.
-- Molde: exigir_oficio_al_aprobar (mismo disparo, sin bypass: ni Maxi aprueba sin
-- papeles). Los ya aprobados NO se tocan (el trigger sólo dispara en la
-- transición a 'approved'). Antecedentes queda opcional.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.exigir_documentos_al_aprobar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF new.verification_status = 'approved'
     AND (tg_op = 'INSERT' OR old.verification_status IS DISTINCT FROM 'approved')
  THEN
    IF new.selfie_url IS NULL OR new.dni_front_url IS NULL OR new.dni_back_url IS NULL THEN
      RAISE EXCEPTION
        'No se puede aprobar a % sin selfie y DNI (frente y dorso) cargados.',
        coalesce(new.first_name || ' ' || coalesce(new.last_name, ''), new.id::text)
        USING hint = 'Pedile los documentos antes de aprobarlo.';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_exigir_documentos_al_aprobar ON public.professionals;
CREATE TRIGGER trg_exigir_documentos_al_aprobar
  BEFORE INSERT OR UPDATE ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.exigir_documentos_al_aprobar();

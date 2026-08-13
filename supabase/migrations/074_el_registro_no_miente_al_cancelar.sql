-- 074 - "El cliente eligio a otro profesional" cuando en realidad NO eligio a nadie
--
-- 13-ago-2026. Maxi le pidio un plomero a Nicolas Intrevado (job 7fa2bc2e,
-- 17:44), espero casi 4 minutos y cancelo la busqueda. En el registro de
-- Nicolas quedo escrito "El cliente eligio a otro profesional" -- MENTIRA:
-- no habia ningun otro. Un profesional que lee eso saca conclusiones sobre
-- si mismo ("elegio a otro, algo hice mal") en vez de la verdad ("el cliente
-- se canso de esperar").
--
-- El trigger de la 061 asumia que un presupuesto de grupo cancelado sin
-- rechazo = "eligieron a otro". Pero hay DOS casos y se distinguen mirando
-- si quedo alguien vivo en el grupo:
--
--   * El cliente ELIGIO a uno -> selectFromQuoteGroup cancela a los hermanos
--     en un UPDATE mientras el elegido sigue accepted y DENTRO del grupo
--     (su quote_group_id se limpia recien despues). El trigger AFTER corre
--     tras el statement: el elegido se ve -> "no te eligieron" es verdad.
--
--   * El cliente CANCELO LA BUSQUEDA entera -> todos los del grupo caen en el
--     mismo UPDATE. Tras el statement no queda nadie pending/accepted ->
--     nadie fue elegido -> la verdad es "el cliente cancelo la busqueda".
--     (El caso de Nico era un grupo de UNO: jamas pudo haber "otro".)
--
-- Sin acentos ni barras invertidas. Seguro de correr varias veces.

CREATE OR REPLACE FUNCTION public.tg_job_offers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM registrar_oferta(NEW.id, NEW.professional_id);
    RETURN NEW;
  END IF;

  -- La cascada le paso el trabajo a otro: el anterior no lo tomo, y eso es
  -- exactamente lo que hay que dejar escrito.
  IF NEW.professional_id IS DISTINCT FROM OLD.professional_id THEN
    PERFORM cerrar_oferta(NEW.id, OLD.professional_id, 'paso_a_otro',
      'No lo tomaste a tiempo y se le paso al siguiente profesional');
    PERFORM registrar_oferta(NEW.id, NEW.professional_id);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'aceptado', NULL);

    ELSIF NEW.status = 'completed' THEN
      -- Pisa el 'aceptado': terminarlo es el desenlace definitivo.
      PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'completado', NULL, false);

    ELSIF NEW.status = 'cancelled' THEN
      IF NEW.rejection_category = 'timeout' THEN
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'vencido',
          'Se te vencio el tiempo para contestar');
      ELSIF NEW.rejection_category IS NOT NULL THEN
        v_motivo := COALESCE(NEW.rejection_note, NEW.rejection_category);
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'rechazado', v_motivo);
      ELSIF NEW.quote_group_id IS NOT NULL THEN
        -- 074: distinguir "eligio a otro" de "cancelo la busqueda" mirando si
        -- quedo alguien vivo en el grupo (ver cabecera de esta migracion).
        IF EXISTS (
          SELECT 1 FROM jobs h
           WHERE h.quote_group_id = NEW.quote_group_id
             AND h.id <> NEW.id
             AND h.status IN ('pending', 'accepted')
        ) THEN
          PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'no_te_eligieron',
            'El cliente eligio a otro profesional', false);
        ELSE
          PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'cancelado',
            'El cliente cancelo la busqueda antes de elegir', false);
        END IF;
      ELSE
        PERFORM cerrar_oferta(NEW.id, NEW.professional_id, 'cancelado',
          'El cliente cancelo el pedido', false);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Corregir lo ya escrito con la mentira -- SOLO donde es demostrable. Un job
-- elegido sale del grupo con quote_group_id = NULL, asi que mirando el pasado
-- no se puede distinguir "hermano de un elegido" de "busqueda cancelada" en
-- grupos de varios. Donde SI es seguro: grupos de UN SOLO trabajo, ahi jamas
-- pudo haber "otro" (el caso de Nico del 13-ago).
UPDATE job_offers o
   SET estado = 'cancelado',
       motivo = 'El cliente cancelo la busqueda antes de elegir'
  FROM jobs j
 WHERE j.id = o.job_id
   AND o.estado = 'no_te_eligieron'
   AND j.status = 'cancelled'
   AND j.quote_group_id IS NOT NULL
   AND (SELECT count(*) FROM jobs h WHERE h.quote_group_id = j.quote_group_id) = 1;

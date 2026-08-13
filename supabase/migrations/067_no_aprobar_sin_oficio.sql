-- ═══════════════════════════════════════════════════════════════════════════
--  067 — Un profesional aprobado SIEMPRE tiene que tener un oficio
--
--  7-ago-2026. Macarena Carrascosa estaba aprobada desde el 29-jul sin ningún
--  oficio cargado. La búsqueda arranca uniendo profesional con oficio
--  (nearby_workers: JOIN professional_professions), así que sin esa fila queda
--  afuera SIEMPRE: no le iba a llegar un trabajo nunca, por más que prendiera
--  el radar. Ni ella ni nosotros nos enterábamos — figuraba aprobada y lista.
--
--  Es el mismo patrón que el de los "disponibles" sin ubicación: alguien que
--  en el papel está adentro y en la práctica es invisible.
--
--  Maxi: "que no vuelva a pasar".
--
--  Dos candados, porque uno solo no alcanza:
--    1. No se puede APROBAR a alguien sin oficio.
--    2. No se puede sacar el último oficio de alguien que ya está aprobado.
--  Sin el segundo, se aprueba con oficio y después se le borra: mismo agujero.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.exigir_oficio_al_aprobar()
returns trigger
language plpgsql
as $$
begin
  -- Sólo cuando pasa a aprobado (o se guarda ya aprobado con un cambio).
  if new.verification_status = 'approved'
     and (tg_op = 'INSERT' or old.verification_status is distinct from 'approved')
  then
    if not exists (
      select 1 from public.professional_professions pp
       where pp.professional_id = new.id
    ) then
      raise exception
        'No se puede aprobar a % sin ningún oficio cargado: no le llegaría ningún trabajo.',
        coalesce(new.first_name || ' ' || coalesce(new.last_name, ''), new.id::text)
        using hint = 'Cargale al menos un oficio antes de aprobarlo.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists exigir_oficio_al_aprobar on public.professionals;
create trigger exigir_oficio_al_aprobar
  before insert or update on public.professionals
  for each row execute function public.exigir_oficio_al_aprobar();


-- El segundo candado: que no se le pueda sacar el último oficio a alguien que
-- ya está aprobado y trabajando.
create or replace function public.exigir_oficio_al_borrar()
returns trigger
language plpgsql
as $$
declare
  v_aprobado boolean;
  v_quedan   int;
begin
  select (verification_status = 'approved') into v_aprobado
    from public.professionals where id = old.professional_id;

  -- Si el profesional se está borrando entero, no hay nada que proteger.
  if v_aprobado is null then return old; end if;

  select count(*) into v_quedan
    from public.professional_professions
   where professional_id = old.professional_id
     and profession_id is distinct from old.profession_id;

  if v_aprobado and v_quedan = 0 then
    raise exception
      'Es el único oficio de un profesional aprobado: sin oficio deja de recibir trabajos.'
      using hint = 'Cargale otro oficio primero, o pasalo a no aprobado.';
  end if;
  return old;
end;
$$;

drop trigger if exists exigir_oficio_al_borrar on public.professional_professions;
create trigger exigir_oficio_al_borrar
  before delete on public.professional_professions
  for each row execute function public.exigir_oficio_al_borrar();

comment on trigger exigir_oficio_al_aprobar on public.professionals is
  'Un aprobado sin oficio es invisible para la búsqueda: no se permite (7-ago-2026).';

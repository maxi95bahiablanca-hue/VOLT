-- ═══════════════════════════════════════════════════════════════════════════
--  072 (antes "066", renumerada el 13-ago-2026: chocaba con 066_reporte_diario
--  y el orden de aplicación quedaba librado al runner. YA APLICADA en
--  producción con el número viejo — no volver a correr entera sin revisar.)
--  EL LATIDO: avisar los cuatro momentos del pedido, en el momento
--
--  Maxi, 7-ago-2026: "me tengo que enterar automáticamente, desde que alguien
--  solicitó un pedido a que alguien contestó el pedido" · "cuando entre el
--  primer pedido real va a ser algo impresionante verlo, así que quiero verlo".
--
--  Hasta hoy: del pedido que sale BIEN no se enteraba nadie hasta el reporte
--  de las 20:10, y del que sale mal se enteraba el vigilante horas después.
--
--  Este trigger dispara la Edge Function `latido` en el mismo instante en que
--  la fila cambia de estado. Cuatro eventos:
--     nuevo · tomado · llego · terminado
--
--  🔴 pg_net es ASÍNCRONO a propósito: encola el pedido HTTP y devuelve. Si la
--     función está caída o Expo no contesta, el INSERT del cliente se guarda
--     igual. Un aviso perdido no puede voltear un pedido — sería cambiar un
--     problema chico por uno grave.
--
--  🔴 El trigger es AFTER, no BEFORE: sólo se avisa de lo que ya quedó
--     guardado. Avisar antes de que la transacción confirme lleva a mandar
--     avisos de pedidos que después no existen.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.avisar_latido(p_job_id uuid, p_evento text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url     := 'https://lyeqnvldemcltlbujlnc.supabase.co/functions/v1/latido',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_4e50WLUuWTJ0u2DN6HPUNw_FeIdsV-0'
               ),
    -- 🔴 La hora la pone la BASE, en el instante del evento, y no la función:
    --    pg_net manda los avisos en paralelo y cada uno tarda distinto, así que
    --    llegan al teléfono en cualquier orden. Con la hora adentro, el mensaje
    --    se entiende igual aunque aparezca fuera de secuencia — que fue justo
    --    lo que pasó en la prueba del 7-ago: "tomó el pedido" salió arriba de
    --    "entró un pedido".
    body    := jsonb_build_object(
                 'job_id', p_job_id,
                 'evento', p_evento,
                 'ocurrido', to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')
               )
  );
exception when others then
  -- Que un aviso no pueda romper NADA de lo que estaba pasando.
  raise warning 'latido: no pude avisar % de %: %', p_evento, p_job_id, sqlerrm;
end;
$$;

create or replace function public.trg_latido_jobs()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Entró un pedido nuevo.
  if (tg_op = 'INSERT') then
    if (new.status = 'pending') then
      perform public.avisar_latido(new.id, 'nuevo');
    end if;
    return new;
  end if;

  -- Lo tomó alguien. Se mira el cambio de estado y no accepted_at, porque
  -- accepted_at se puede tocar después sin que eso sea "recién lo tomaron".
  if (old.status is distinct from new.status) then
    if (new.status = 'accepted') then
      perform public.avisar_latido(new.id, 'tomado');
    elsif (new.status = 'completed') then
      perform public.avisar_latido(new.id, 'terminado');
    end if;
  end if;

  -- Llegó al domicilio. Va por arrived_at y no por el estado porque el
  -- recorrido tiene idas y vueltas (acepta, va, llega, empieza) y el estado
  -- no siempre pasa por 'arrived'.
  if (old.arrived_at is null and new.arrived_at is not null) then
    perform public.avisar_latido(new.id, 'llego');
  end if;

  return new;
end;
$$;

drop trigger if exists latido_jobs on public.jobs;
create trigger latido_jobs
  after insert or update on public.jobs
  for each row execute function public.trg_latido_jobs();

comment on trigger latido_jobs on public.jobs is
  'Avisa por push los 4 momentos del pedido (nuevo/tomado/llego/terminado). Ver Edge Function latido.';

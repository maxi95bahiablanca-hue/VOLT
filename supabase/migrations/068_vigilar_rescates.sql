-- ═══════════════════════════════════════════════════════════════════════════
--  068 — Que un rescate no se quede esperando a que alguien lo mire
--
--  7-ago-2026. Cuando un cliente busca y no hay NADIE disponible, el pedido
--  se guarda en `rescates` y sale un push al admin en el momento (eso ya
--  andaba, migración 034). Pero después no lo miraba nadie: si ese push se
--  perdía entre otras notificaciones, el rescate quedaba en 'pendiente' para
--  siempre — con un cliente del otro lado esperando que lo llamen.
--
--  Maxi lo probó a las 17:03 buscando un carpintero y quedó ahí.
--
--  Es [[regla-nada-queda-trabado]] otra vez: el aviso instantáneo no alcanza,
--  porque depende de que alguien lo vea justo. Ahora, si a la media hora sigue
--  sin resolverse, se insiste UNA vez.
--
--  🔴 Una sola vez, no cada corrida: un vigilante que repite el mismo aviso
--     cada hora se silencia en dos días, y ahí se pierden también los avisos
--     que sí importan.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.rescates
  add column if not exists escalado_at timestamptz;

comment on column public.rescates.escalado_at is
  'Cuándo se insistió por este rescate sin atender. Se avisa UNA sola vez.';

-- Los rescates que llevan rato sin que nadie los toque.
create or replace function public.rescates_sin_atender(p_minutos int default 30)
returns table (
  id uuid,
  oficio text,
  address text,
  minutos int,
  client_id uuid
)
language sql
stable
as $$
  select r.id,
         coalesce(r.oficio, 'sin oficio'),
         coalesce(r.address, 'sin dirección'),
         (extract(epoch from (now() - r.created_at)) / 60)::int,
         r.client_id
    from public.rescates r
   where r.estado = 'pendiente'
     and r.escalado_at is null
     and r.created_at < now() - make_interval(mins => p_minutos)
     -- Más de un día atrás ya no es urgencia, es historia.
     and r.created_at > now() - interval '2 days'
   order by r.created_at;
$$;

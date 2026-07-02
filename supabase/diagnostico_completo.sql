-- =====================================================
-- VOLT — DIAGNÓSTICO COMPLETO DE LA BASE (read-only)
-- Corré esto en Supabase → SQL Editor. NO modifica nada.
-- Devuelve: sector | objeto | estado.  Lo que diga "❌ FALTA"
-- es una migración pendiente que rompe ese sector de la app.
-- =====================================================

with
-- ─── Columnas esperadas (tabla.columna) ──────────────────────────────────────
cols(sector, tabla, col) as (values
  -- Flujo del trabajo
  ('Flujo trabajo','jobs','verification_code'),
  ('Flujo trabajo','jobs','arrival_estimate'),
  ('Flujo trabajo','jobs','materials_needed'),
  ('Flujo trabajo','jobs','visit_paid'),
  ('Flujo trabajo','jobs','scheduled_return'),
  ('Flujo trabajo','jobs','sub_status'),
  ('Flujo trabajo','jobs','work_duration_est'),
  -- Diagnóstico / presupuesto
  ('Diagnóstico','jobs','quote_group_id'),
  ('Diagnóstico','jobs','pre_diagnosis'),
  ('Diagnóstico','jobs','final_diagnosis'),
  ('Diagnóstico','jobs','diagnosis_structured'),
  ('Diagnóstico','jobs','work_summary'),
  ('Diagnóstico','jobs','problem_photo_url'),
  -- Rechazos
  ('Rechazos','jobs','rejection_category'),
  ('Rechazos','jobs','rejection_note'),
  -- Materiales
  ('Materiales','jobs','is_buying_materials'),
  ('Materiales','jobs','materials_eta'),
  ('Materiales','jobs','materials_cost'),
  ('Materiales','jobs','materials_status'),
  ('Materiales','jobs','materials_estimate'),
  ('Materiales','jobs','materials_estimate_detail'),
  -- Multi-día
  ('Multi-día','jobs','is_multiday'),
  ('Multi-día','jobs','estimated_sessions'),
  ('Multi-día','jobs','estimated_hrs_session'),
  ('Multi-día','jobs','completed_sessions'),
  ('Multi-día','jobs','current_session_start'),
  ('Multi-día','jobs','total_minutes_worked'),
  ('Multi-día','jobs','multiday_confirmed'),
  -- Perfil del profesional
  ('Perfil pro','professionals','phone'),
  ('Perfil pro','professionals','verification_status'),
  ('Perfil pro','professionals','verification_note'),
  ('Perfil pro','professionals','avatar_url'),
  ('Perfil pro','professionals','selfie_url'),
  ('Perfil pro','professionals','dni_front_url'),
  ('Perfil pro','professionals','dni_back_url'),
  ('Perfil pro','professionals','monotributo_url'),
  ('Perfil pro','professionals','reviewed_at'),
  ('Perfil pro','professionals','reviewed_by'),
  ('Perfil pro','professionals','cbu'),
  ('Perfil pro','professionals','antecedentes_url'),
  ('Perfil pro','professionals','estudios_url'),
  ('Perfil pro','professionals','payment_method'),
  ('Perfil pro','professionals','available_at'),
  -- Reputación
  ('Reputación','professionals','avg_arrival_minutes'),
  ('Reputación','professionals','returning_clients'),
  ('Reputación','professionals','video_url'),
  ('Reputación','professionals','certifications'),
  ('Reputación','professionals','complaints_count'),
  ('Reputación','professionals','recommend_pct'),
  ('Reputación','professionals','on_time_completions'),
  -- Leads prestadores
  ('Leads pro','prestador_leads','dni'),
  ('Leads pro','prestador_leads','email'),
  ('Leads pro','prestador_leads','fecha_nac'),
  ('Leads pro','prestador_leads','domicilio'),
  ('Leads pro','prestador_leads','matricula'),
  ('Leads pro','prestador_leads','antecedentes'),
  ('Leads pro','prestador_leads','dni_frente_url'),
  ('Leads pro','prestador_leads','dni_dorso_url'),
  ('Leads pro','prestador_leads','antecedentes_url'),
  ('Leads pro','prestador_leads','selfie_url')
),
-- ─── Tablas esperadas ────────────────────────────────────────────────────────
tbls(sector, t) as (values
  ('Base','professions'),('Base','professionals'),('Base','professional_professions'),
  ('Base','worker_media'),('Base','jobs'),('Base','payments'),('Base','reviews'),
  ('Base','push_tokens'),
  ('Chat','messages'),
  ('Favoritos','favorite_professionals'),
  ('Galería','professional_gallery'),
  ('Eventos','job_events'),
  ('Pagos','professional_payout'),('Pagos','payment_profiles'),
  ('Leads pro','prestador_leads')
),
-- ─── Funciones (RPC / triggers) esperadas ────────────────────────────────────
fns(sector, f) as (values
  ('Búsqueda','nearby_workers'),
  ('Emergencia','nearest_available_worker'),
  ('Penalización','penalize_worker_rejection'),
  ('Facturación','worker_billed_30d'),
  ('Comisión/stats','get_commission_pct'),
  ('Comisión/stats','update_professional_stats'),
  ('Comisión/stats','update_stats_on_review'),
  ('Comisión/stats','check_efficiency_bonus'),
  ('Comisión/stats','parse_duration_to_minutes'),
  ('Reputación','update_recommend_pct'),
  ('Cancelación','check_cancellation_allowed')
),
-- ─── Tablas que deben estar en Realtime ──────────────────────────────────────
rt(sector, t) as (values
  ('Realtime','jobs'),('Realtime','professionals'),
  ('Realtime','job_events'),('Realtime','messages')
),
-- ─── Storage buckets esperados ───────────────────────────────────────────────
bkt(sector, b) as (values
  ('Storage','avatars'),('Storage','worker-docs'),('Storage','prestador-docs')
)
select * from (
  select sector, 'columna '||tabla||'.'||col as objeto,
    case when exists (select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=cols.tabla and c.column_name=cols.col)
      then '✅ OK' else '❌ FALTA' end as estado
  from cols
  union all
  select sector, 'tabla '||t,
    case when to_regclass('public.'||t) is not null then '✅ OK' else '❌ FALTA' end
  from tbls
  union all
  select sector, 'función '||f||'()',
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=fns.f) then '✅ OK' else '❌ FALTA' end
  from fns
  union all
  select sector, 'realtime '||t,
    case when exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and tablename=rt.t) then '✅ OK' else '❌ FALTA' end
  from rt
  union all
  select sector, 'bucket '||b,
    case when exists (select 1 from storage.buckets where id=bkt.b) then '✅ OK' else '❌ FALTA' end
  from bkt
) x
order by (estado like '❌%') desc, sector, objeto;

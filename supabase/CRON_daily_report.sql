-- Programa el reporte diario de GOVOLT (9:00 AM Argentina = 12:00 UTC).
-- Corré esto en Supabase → SQL Editor DESPUÉS de deployar la función daily-report.
-- ⚠️ Reemplazá TU_CRON_SECRET por el mismo valor que pusiste en el secret CRON_SECRET.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Si ya existía, lo borramos para reprogramar
SELECT cron.unschedule('govolt-daily-report')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'govolt-daily-report');

SELECT cron.schedule(
  'govolt-daily-report',
  '0 12 * * *',           -- todos los días 12:00 UTC (09:00 en Bahía Blanca)
  $$
  SELECT net.http_post(
    url := 'https://lyeqnvldemcltlbujlnc.supabase.co/functions/v1/daily-report?key=TU_CRON_SECRET',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);

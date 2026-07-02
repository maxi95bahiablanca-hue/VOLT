import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// El texto del reporte lo escribe el usuario → escapar antes de meterlo en el HTML del mail
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { jobId, issue, role } = await req.json().catch(() => ({}));
    if (!issue || typeof issue !== 'string') return json({ error: 'issue requerido' }, 400);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON         = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND       = Deno.env.get('RESEND_API_KEY');
    const TO           = Deno.env.get('REPORTS_EMAIL') ?? 'soporte@bolt.com.ar';

    // Autenticar al usuario que reporta
    const auth = req.headers.get('Authorization') ?? '';
    const anon = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Rate limit: máx 5 reportes por usuario por hora (evita inundar soporte@)
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('problem_reports')
      .select('id', { count: 'exact', head: true })
      .eq('reporter_id', user.id)
      .gte('created_at', haceUnaHora);
    if ((count ?? 0) >= 5) {
      return json({ error: 'Demasiados reportes seguidos. Esperá un rato e intentá de nuevo.' }, 429);
    }

    // Datos del trabajo (para dar contexto en el mail)
    let job: any = null;
    if (jobId) {
      const { data } = await admin
        .from('jobs')
        .select('id, status, profession_id, professions(name), professionals(first_name, phone)')
        .eq('id', jobId)
        .maybeSingle();
      job = data;
    }
    const contacto = user.email ?? user.phone ?? '';

    // Registrar el reporte (queda en la tabla aunque el mail falle)
    await admin.from('problem_reports').insert({
      job_id:        jobId ?? null,
      reporter_id:   user.id,
      reporter_role: role ?? null,
      issue,
      job_status:    job?.status ?? null,
      contacto,
    });

    // Avisar por mail al instante
    if (RESEND) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px">
          <h2 style="color:#0A0A0A">🚨 Nuevo reporte de problema — BOLT</h2>
          <p style="font-size:16px"><b>Problema:</b> ${esc(issue)}</p>
          <table style="font-size:14px;color:#333">
            <tr><td><b>Reporta:</b></td><td>${role === 'worker' ? '🔧 Trabajador' : '👤 Cliente'}</td></tr>
            <tr><td><b>Contacto:</b></td><td>${esc(contacto)}</td></tr>
            <tr><td><b>Trabajo:</b></td><td>${esc(jobId ?? '—')} ${job ? `· ${esc(job.professions?.name ?? '')} · estado: ${esc(job.status)}` : ''}</td></tr>
            ${job?.professionals ? `<tr><td><b>Profesional:</b></td><td>${job.professionals.first_name ?? ''} ${job.professionals.phone ?? ''}</td></tr>` : ''}
          </table>
          <hr><p style="color:#888;font-size:12px">Reporte automático de BOLT · ${new Date().toLocaleString('es-AR')}</p>
        </div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'BOLT Reportes <reportes@bolt.com.ar>',
          to: [TO],
          subject: `🚨 Reporte BOLT: ${issue.slice(0, 60)}`,
          html,
        }),
      }).catch(() => {});
    }

    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'No se pudo registrar el reporte' }, 500);
  }
});

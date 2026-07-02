// GOVOLT — Reporte diario por email.
// Se ejecuta una vez al día (cron) y manda un resumen a la administración.
// Env necesarias (Supabase → Settings → Edge Functions → Secrets):
//   RESEND_API_KEY  → tu API key de resend.com (gratis)
//   REPORT_EMAIL    → a dónde mandar el reporte (ej: maxi95.bahiablanca@gmail.com)
//   CRON_SECRET     → un texto secreto cualquiera (para que solo el cron la pueda llamar)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidas por Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');

Deno.serve(async (req) => {
  // Seguridad: solo se ejecuta con la clave correcta
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || req.headers.get('x-cron-key');
  if (key !== Deno.env.get('CRON_SECRET')) {
    return new Response('No autorizado', { status: 401 });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Inicio del día en horario de Argentina (UTC-3)
  const now = new Date();
  const ar = new Date(now.getTime() - 3 * 3600 * 1000);
  const startAr = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), 3, 0, 0));
  const startMonth = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1, 3, 0, 0));
  const todayISO = startAr.toISOString();
  const monthISO = startMonth.toISOString();
  const fechaTxt = ar.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  // ── Registros (prestador_leads) ───────────────────────────────────────────
  const { data: leads } = await sb.from('prestador_leads').select('estado,profesion,created_at');
  const L = leads || [];
  const leadsHoy = L.filter((l: any) => l.created_at >= todayISO).length;
  const leadsTotal = L.length;
  const aceptados = L.filter((l: any) => l.estado === 'aceptado').length;
  const nuevos = L.filter((l: any) => (l.estado || 'nuevo') === 'nuevo').length;
  const porOficio: Record<string, number> = {};
  L.forEach((l: any) => { porOficio[l.profesion] = (porOficio[l.profesion] || 0) + 1; });
  const topOficios = Object.entries(porOficio).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([p, n]) => `${p}: ${n}`).join(' · ') || '—';

  // ── Trabajos e ingresos (jobs) ──────────────────────────────────────────────
  const { data: jobs } = await sb.from('jobs').select('status,visit_amount,work_amount,commission_pct,completed_at,created_at');
  const J = jobs || [];
  const completados = J.filter((j: any) => j.status === 'completed');
  const enCurso = J.filter((j: any) => ['accepted', 'arrived', 'in_progress', 'awaiting_payment'].includes(j.status)).length;
  const pedidosHoy = J.filter((j: any) => j.created_at >= todayISO).length;
  const rev = (j: any) => (j.visit_amount || 0) + (j.work_amount || 0) * ((j.commission_pct || 20) / 100);
  const ingresosHoy = completados.filter((j: any) => (j.completed_at || '') >= todayISO).reduce((a, j) => a + rev(j), 0);
  const ingresosMes = completados.filter((j: any) => (j.completed_at || '') >= monthISO).reduce((a, j) => a + rev(j), 0);
  const completadosHoy = completados.filter((j: any) => (j.completed_at || '') >= todayISO).length;

  // ── Email HTML ──────────────────────────────────────────────────────────────
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A0A0A;color:#eee;padding:24px;border-radius:14px;max-width:560px;margin:auto">
    <div style="font-size:22px;font-weight:900;letter-spacing:2px">GO<span style="color:#FFD600">VOLT</span> · Reporte diario</div>
    <div style="color:#888;font-size:13px;text-transform:capitalize;margin-bottom:18px">${fechaTxt}</div>

    <div style="background:#111;border:1px solid #FFD60033;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:#FFD600;font-weight:800;text-transform:uppercase;letter-spacing:1px">📋 Registros de prestadores</div>
      <div style="font-size:30px;font-weight:900;margin:6px 0">${leadsHoy} <span style="font-size:14px;color:#888;font-weight:600">hoy</span></div>
      <div style="color:#aaa;font-size:13px">Total: <b style="color:#fff">${leadsTotal}</b> · Sin contactar: <b style="color:#4dabf7">${nuevos}</b> · Aceptados: <b style="color:#00d68f">${aceptados}</b></div>
      <div style="color:#777;font-size:12px;margin-top:6px">Top oficios: ${topOficios}</div>
    </div>

    <div style="background:#111;border:1px solid #1f1f1f;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:#00d68f;font-weight:800;text-transform:uppercase;letter-spacing:1px">💰 Ingresos GOVOLT (comisión + visitas)</div>
      <div style="font-size:30px;font-weight:900;color:#00d68f;margin:6px 0">${money(ingresosHoy)} <span style="font-size:14px;color:#888;font-weight:600">hoy</span></div>
      <div style="color:#aaa;font-size:13px">Este mes: <b style="color:#fff">${money(ingresosMes)}</b></div>
    </div>

    <div style="background:#111;border:1px solid #1f1f1f;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:#4dabf7;font-weight:800;text-transform:uppercase;letter-spacing:1px">💼 Trabajos</div>
      <div style="color:#aaa;font-size:13px;margin-top:6px">
        Pedidos hoy: <b style="color:#fff">${pedidosHoy}</b><br>
        Completados hoy: <b style="color:#fff">${completadosHoy}</b><br>
        En curso ahora: <b style="color:#FFD600">${enCurso}</b>
      </div>
    </div>

    <div style="color:#555;font-size:11px;margin-top:8px">
      Nota: los costos (comisiones de Mercado Pago, etc.) todavía no se trackean en la base.<br>
      Reporte automático de GOVOLT ⚡
    </div>
  </div>`;

  // ── Enviar con Resend ─────────────────────────────────────────────────────
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'GOVOLT <onboarding@resend.dev>',
      to: [Deno.env.get('REPORT_EMAIL')],
      subject: `⚡ GOVOLT — ${leadsHoy} registros hoy · ${money(ingresosHoy)}`,
      html,
    }),
  });

  const ok = resp.ok;
  return new Response(JSON.stringify({ ok, leadsHoy, ingresosHoy }), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
});

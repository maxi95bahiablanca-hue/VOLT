// BOLT — Reporte diario por email.
//
// 🔴 ESTUVO MUERTO DESDE QUE SE ESCRIBIÓ (encontrado el 6-ago-2026). Tres cosas:
//    1. Exigía `CRON_SECRET`, que nunca se cargó en los secretos → devolvía 401
//       siempre, a cualquiera que la llamara.
//    2. Leía `REPORT_EMAIL` y el secreto cargado se llama `REPORTS_EMAIL`, con
//       ese, así que aunque hubiera pasado el 401 no tenía a dónde mandarlo.
//    3. No tenía ningún cron. Nadie la despertaba nunca.
//    Como además hablaba de "GOVOLT" y de ingresos por comisión —que en modo
//    gratuito NO EXISTEN— habría mandado plata inventada. Se arregló entero.
//
// Env (Supabase → Settings → Edge Functions → Secrets):
//   RESEND_API_KEY               → api key de resend.com
//   REPORTS_EMAIL / REPORT_EMAIL → a dónde va el reporte
//   FROM_EMAIL                   → remitente (opcional)
//   CRON_SECRET                  → para que solo el cron la pueda llamar
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidas por Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');

Deno.serve(async (req) => {
  // Seguridad: solo se ejecuta con la clave correcta.
  // 22-ago-2026: se aceptaba también ?key= por query param, que queda escrito
  // en los logs de acceso. Ahora sólo por header, que no se loguea.
  const key = req.headers.get('x-cron-key');
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

  // Consultas que fallaron: si una lectura da error se cae a [] y el reporte
  // mostraría ceros inventados como si fueran reales. Los juntamos para pintar
  // un banner rojo y que el cero no se confunda con "no hubo".
  const fallos: string[] = [];

  // ── Registros (prestador_leads) ───────────────────────────────────────────
  const { data: leads, error: errLeads } = await sb.from('prestador_leads').select('estado,profesion,created_at');
  if (errLeads) fallos.push('registros de prestadores');
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
  const { data: jobs, error: errJobs } = await sb.from('jobs').select('status,visit_amount,work_amount,commission_pct,completed_at,created_at');
  if (errJobs) fallos.push('trabajos e ingresos');
  const J = jobs || [];
  const completados = J.filter((j: any) => j.status === 'completed');
  const enCurso = J.filter((j: any) => ['accepted', 'arrived', 'in_progress', 'awaiting_payment'].includes(j.status)).length;
  const pedidosHoy = J.filter((j: any) => j.created_at >= todayISO).length;
  // 🔴 Acá se calculaba la "comisión de GOVOLT" con un 20% por defecto. BOLT
  //    está en modo GRATUITO: no cobra ni comisión ni visita, así que ese número
  //    era plata que no existe — el mismo error de los precios fantasma. Lo que
  //    sí es real, y lo que de verdad importa, es cuánto facturaron los
  //    profesionales a través de BOLT: esa es la medida de si sirve.
  const facturado = (j: any) => (j.work_amount || 0);
  const facturadoHoy = completados.filter((j: any) => (j.completed_at || '') >= todayISO).reduce((a, j) => a + facturado(j), 0);
  const facturadoMes = completados.filter((j: any) => (j.completed_at || '') >= monthISO).reduce((a, j) => a + facturado(j), 0);
  const completadosHoy = completados.filter((j: any) => (j.completed_at || '') >= todayISO).length;

  // ── Quién puede recibir un trabajo HOY ────────────────────────────────────
  //  Es el dato que decide si el sistema puede responder o no, y hasta ahora
  //  había que ir a preguntarlo a mano. Un aprobado que no puede recibir no
  //  aparece en ninguna búsqueda: ver la migración 063.
  const { data: operativos, error: errOp } = await sb.rpc('estado_operativo');
  if (errOp) fallos.push('estado operativo de prestadores');
  const OP = (operativos || []) as { nombre: string; puede_recibir: boolean; le_falta: string | null }[];
  const listos = OP.filter((p) => p.puede_recibir).length;
  const trabados = OP.filter((p) => !p.puede_recibir);
  const filasFaltan = trabados.slice(0, 8)
    .map((p) => `<div style="color:#aaa;font-size:12.5px;margin-top:3px">${p.nombre} — <span style="color:#FF9800">${p.le_falta ?? 'algo'}</span></div>`)
    .join('') || '<div style="color:#00d68f;font-size:12.5px;margin-top:3px">Están todos listos.</div>';

  // ── Email HTML ──────────────────────────────────────────────────────────────
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A0A0A;color:#eee;padding:24px;border-radius:14px;max-width:560px;margin:auto">
    <div style="font-size:22px;font-weight:900;letter-spacing:2px">BOLT<span style="color:#FFD600">⚡</span> · Reporte diario</div>
    <div style="color:#888;font-size:13px;text-transform:capitalize;margin-bottom:18px">${fechaTxt}</div>
    ${fallos.length ? `<div style="background:#2a0e0e;border:1px solid #ff4444;border-radius:12px;padding:14px 16px;margin-bottom:12px;color:#ff6b6b;font-size:13px;font-weight:700">⚠️ No pude leer: ${fallos.join(' · ')}. Los números de abajo pueden estar incompletos.</div>` : ''}

    <div style="background:#111;border:1px solid ${listos > 0 ? '#00d68f33' : '#ff444455'};border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:${listos > 0 ? '#00d68f' : '#ff4444'};font-weight:800;text-transform:uppercase;letter-spacing:1px">📡 Pueden recibir trabajos ahora</div>
      <div style="font-size:30px;font-weight:900;margin:6px 0">${listos} <span style="font-size:14px;color:#888;font-weight:600">de ${OP.length}</span></div>
      ${trabados.length ? `<div style="color:#777;font-size:12px;margin-top:8px">A estos les falta un paso:</div>${filasFaltan}` : filasFaltan}
    </div>

    <div style="background:#111;border:1px solid #FFD60033;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:#FFD600;font-weight:800;text-transform:uppercase;letter-spacing:1px">📋 Registros de prestadores</div>
      <div style="font-size:30px;font-weight:900;margin:6px 0">${leadsHoy} <span style="font-size:14px;color:#888;font-weight:600">hoy</span></div>
      <div style="color:#aaa;font-size:13px">Total: <b style="color:#fff">${leadsTotal}</b> · Sin contactar: <b style="color:#4dabf7">${nuevos}</b> · Aceptados: <b style="color:#00d68f">${aceptados}</b></div>
      <div style="color:#777;font-size:12px;margin-top:6px">Top oficios: ${topOficios}</div>
    </div>

    <div style="background:#111;border:1px solid #1f1f1f;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;color:#00d68f;font-weight:800;text-transform:uppercase;letter-spacing:1px">💰 Facturado por los profesionales</div>
      <div style="font-size:30px;font-weight:900;color:#00d68f;margin:6px 0">${money(facturadoHoy)} <span style="font-size:14px;color:#888;font-weight:600">hoy</span></div>
      <div style="color:#aaa;font-size:13px">Este mes: <b style="color:#fff">${money(facturadoMes)}</b></div>
      <div style="color:#555;font-size:11px;margin-top:6px">BOLT no cobra nada: esto es lo que se llevaron ellos.</div>
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
      Reporte automático de BOLT ⚡
    </div>
  </div>`;

  // ── Enviar con Resend ─────────────────────────────────────────────────────
  // El secreto cargado se llama REPORTS_EMAIL, con ese. Se aceptan los dos
  // nombres para que no vuelva a fallar en silencio por una letra.
  const destino = Deno.env.get('REPORTS_EMAIL') || Deno.env.get('REPORT_EMAIL');
  if (!destino) {
    return new Response(JSON.stringify({ error: 'falta REPORTS_EMAIL' }), { status: 500 });
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('FROM_EMAIL') || 'BOLT <onboarding@resend.dev>',
      to: [destino],
      // El asunto dice lo único que hay que saber sin abrir el mail.
      subject: `⚡ BOLT — ${listos} listos para trabajar · ${pedidosHoy} pedidos hoy`,
      html,
    }),
  });

  const ok = resp.ok;
  const detalle = ok ? null : await resp.text().catch(() => null);
  return new Response(JSON.stringify({ ok, listos, pedidosHoy, leadsHoy, detalle }), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
});

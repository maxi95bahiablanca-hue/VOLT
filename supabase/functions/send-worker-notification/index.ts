import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { userId, action, workerName, workerEmail, rejectionNote } = await req.json();

    const RESEND_KEY    = Deno.env.get('RESEND_API_KEY');
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FROM_EMAIL    = Deno.env.get('FROM_EMAIL') ?? 'VOLT <noreply@voltapp.ar>';

    const isApproved = action === 'approved';

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 0. Obtener email del trabajador desde auth.users ───────────────────
    let resolvedEmail = workerEmail;
    if (!resolvedEmail) {
      const { data: { user } } = await adminClient.auth.admin.getUserById(userId);
      resolvedEmail = user?.email ?? null;
    }

    // ── 1. Push notification via Expo ──────────────────────────────────────
    const { data: tokenRow } = await adminClient
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .maybeSingle();

    if (tokenRow?.token) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:        tokenRow.token,
          title:     isApproved ? '✅ ¡Solicitud aprobada!' : '❌ Solicitud rechazada',
          body:      isApproved
            ? 'Ya podés activarte en el mapa y empezar a recibir trabajos en VOLT.'
            : `Tu solicitud fue rechazada. Motivo: ${rejectionNote || 'Documentación incompleta'}. Podés volver a enviarla.`,
          sound:     'default',
          channelId: 'govolt-jobs',
          priority:  'high',
          data:      { screen: 'home' },
        }),
      });
    }

    // ── 2. Email via Resend ────────────────────────────────────────────────
    if (RESEND_KEY && resolvedEmail) {
      const emailHtml = isApproved ? `
        <div style="font-family:Arial,sans-serif;background:#0A0A0A;color:#F5F5F5;padding:40px;border-radius:12px;max-width:480px;margin:auto">
          <div style="text-align:center;margin-bottom:32px">
            <span style="font-size:48px">⚡</span>
            <h1 style="color:#FFD600;font-size:28px;margin:8px 0">VOLT</h1>
          </div>
          <h2 style="color:#4CAF50;font-size:22px;margin-bottom:16px">✅ ¡Solicitud aprobada!</h2>
          <p style="color:#ccc;line-height:1.6">Hola <strong>${workerName}</strong>,</p>
          <p style="color:#ccc;line-height:1.6">
            Tu solicitud para trabajar en VOLT fue <strong style="color:#4CAF50">aprobada</strong>.
            Ya podés abrir la app, activarte en el mapa y empezar a recibir trabajos.
          </p>
          <div style="background:#1A1A00;border:1px solid #FFD60040;border-radius:10px;padding:20px;margin:24px 0">
            <p style="color:#FFD600;font-weight:bold;margin:0 0 8px">Próximos pasos:</p>
            <p style="color:#ccc;margin:4px 0">1. Abrí la app VOLT</p>
            <p style="color:#ccc;margin:4px 0">2. Activá tu disponibilidad en el mapa</p>
            <p style="color:#ccc;margin:4px 0">3. Esperá trabajos cerca tuyo</p>
          </div>
          <p style="color:#555;font-size:12px;margin-top:32px">VOLT — Profesionales a domicilio · Bahía Blanca</p>
        </div>` : `
        <div style="font-family:Arial,sans-serif;background:#0A0A0A;color:#F5F5F5;padding:40px;border-radius:12px;max-width:480px;margin:auto">
          <div style="text-align:center;margin-bottom:32px">
            <span style="font-size:48px">⚡</span>
            <h1 style="color:#FFD600;font-size:28px;margin:8px 0">VOLT</h1>
          </div>
          <h2 style="color:#ff4444;font-size:22px;margin-bottom:16px">❌ Solicitud rechazada</h2>
          <p style="color:#ccc;line-height:1.6">Hola <strong>${workerName}</strong>,</p>
          <p style="color:#ccc;line-height:1.6">
            Tu solicitud fue <strong style="color:#ff4444">rechazada</strong> por el siguiente motivo:
          </p>
          <div style="background:#1A0000;border:1px solid #ff444440;border-radius:10px;padding:16px;margin:16px 0">
            <p style="color:#ff8888;margin:0">${rejectionNote || 'Documentación incompleta o incorrecta.'}</p>
          </div>
          <p style="color:#ccc;line-height:1.6">
            Podés corregir tu documentación y volver a enviar la solicitud desde la app.
          </p>
          <p style="color:#555;font-size:12px;margin-top:32px">VOLT — Profesionales a domicilio · Bahía Blanca</p>
        </div>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [resolvedEmail],
          subject: isApproved
            ? '✅ Tu solicitud en VOLT fue aprobada'
            : '❌ Tu solicitud en VOLT fue rechazada',
          html: emailHtml,
        }),
      });
    }

    return json({ ok: true });
  } catch (err) {
    console.error('send-worker-notification error:', err);
    return json({ error: 'Error al enviar notificación' }, 500);
  }
});

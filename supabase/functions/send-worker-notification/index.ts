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
    const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FROM_EMAIL    = Deno.env.get('FROM_EMAIL') ?? 'BOLT <soporte@bolt.com.ar>';

    const isApproved = action === 'approved';

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Solo un admin autenticado puede disparar esto (manda mails desde el
    //    dominio de BOLT y push a cualquier usuario: sin este check era un
    //    relay abierto para cualquiera con la anon key) ──────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller?.email) return json({ error: 'No autorizado' }, 401);
    const { data: adminRow } = await adminClient
      .from('admins').select('email').eq('email', caller.email).maybeSingle();
    if (!adminRow) return json({ error: 'No autorizado' }, 401);

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

    // 🔴 11-ago-2026 — de acá salían dos mentiras y hay que cortar las dos:
    //    el push iba a un canal inexistente y, pasara lo que pasara, la función
    //    contestaba {ok:true} y el panel decía "El trabajador fue notificado".
    //    Ahora cada camino deja dicho si salió y, si no salió, por qué.
    let push = false;
    let pushMotivo = 'sin token: todavía no abrió la app en el teléfono';

    if (tokenRow?.token) {
      try {
        const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to:        tokenRow.token,
            title:     isApproved ? '✅ ¡Solicitud aprobada!' : '❌ Solicitud rechazada',
            body:      isApproved
              ? 'Ya podés activarte en el mapa y empezar a recibir trabajos en BOLT.'
              : `Tu solicitud fue rechazada. Motivo: ${rejectionNote || 'Documentación incompleta'}. Podés volver a enviarla.`,
            sound:     'default',
            // 🔴 11-ago-2026 — decía 'govolt-jobs', el nombre viejo de la app.
            //    Ese canal de Android no lo crea nadie: el único que existe en
            //    el teléfono es 'bolt-urgent-v3'
            //    (src/services/notificationService.js:155, adentro de setup()).
            //    Con un channelId que
            //    no existe, expo-notifications tira el aviso al canal comodín
            //    ('Otros'/Miscellaneous), sin sonido ni prioridad de BOLT —
            //    justo el aviso que le dice al profesional "abrí la app y
            //    activá tu disponibilidad", el paso que ya sabemos que se
            //    saltan 8 de cada 10. Los canales los crea la app, no el que
            //    manda: hasta que haya build nuevo, se usa el que existe.
            channelId: 'bolt-urgent-v3',
            priority:  'high',
            data:      { screen: 'home' },
          }),
          signal: AbortSignal.timeout(6000),
        });

        // Expo contesta 200 igual cuando el envío falló: el veredicto está en
        // el comprobante (status 'error' + details.error). Sin mirarlo, un
        // token muerto se informaba como aviso entregado.
        const cuerpo = await pushRes.json().catch(() => null) as
          { data?: unknown } | null;
        const d = cuerpo?.data;
        const ticket = (Array.isArray(d) ? d[0] : d) as
          { status?: string; message?: string; details?: { error?: string } } | undefined;

        if (!pushRes.ok) {
          pushMotivo = `Expo respondió ${pushRes.status}`;
        } else if (ticket?.status === 'ok') {
          push = true;
          pushMotivo = '';
        } else {
          pushMotivo = ticket?.details?.error || ticket?.message || 'Expo no aceptó el envío';
          // Token de un teléfono que ya no está (reinstaló, cambió de aparato).
          // Si queda guardado, todos los avisos futuros a esta persona van a
          // fallar en silencio y nadie se va a enterar de por qué.
          if (ticket?.details?.error === 'DeviceNotRegistered') {
            await adminClient.from('push_tokens').delete().eq('token', tokenRow.token);
          }
        }
      } catch (e) {
        pushMotivo = 'no se pudo hablar con Expo: ' + String((e as Error).message ?? e);
      }
    }

    // ── 2. Email via Resend ────────────────────────────────────────────────
    let mail = false;
    let mailMotivo = !RESEND_KEY
      ? 'falta RESEND_API_KEY en los secrets de Edge Functions'
      : !resolvedEmail
        ? 'el profesional no tiene mail cargado'
        : '';

    if (RESEND_KEY && resolvedEmail) {
      const emailHtml = isApproved ? `
        <div style="font-family:Arial,sans-serif;background:#0A0A0A;color:#F5F5F5;padding:40px;border-radius:12px;max-width:480px;margin:auto">
          <div style="text-align:center;margin-bottom:32px">
            <span style="font-size:48px">⚡</span>
            <h1 style="color:#FFD600;font-size:28px;margin:8px 0">BOLT</h1>
          </div>
          <h2 style="color:#4CAF50;font-size:22px;margin-bottom:16px">✅ ¡Solicitud aprobada!</h2>
          <p style="color:#ccc;line-height:1.6">Hola <strong>${workerName}</strong>,</p>
          <p style="color:#ccc;line-height:1.6">
            Tu solicitud para trabajar en BOLT fue <strong style="color:#4CAF50">aprobada</strong>.
            Ya podés abrir la app, activarte en el mapa y empezar a recibir trabajos.
          </p>
          <div style="background:#1A1A00;border:1px solid #FFD60040;border-radius:10px;padding:20px;margin:24px 0">
            <p style="color:#FFD600;font-weight:bold;margin:0 0 8px">Próximos pasos:</p>
            <p style="color:#ccc;margin:4px 0">1. Abrí la app BOLT</p>
            <p style="color:#ccc;margin:4px 0">2. Activá tu disponibilidad en el mapa</p>
            <p style="color:#ccc;margin:4px 0">3. Esperá trabajos cerca tuyo</p>
          </div>
          <p style="color:#555;font-size:12px;margin-top:32px">BOLT — Profesionales a domicilio · Bahía Blanca</p>
        </div>` : `
        <div style="font-family:Arial,sans-serif;background:#0A0A0A;color:#F5F5F5;padding:40px;border-radius:12px;max-width:480px;margin:auto">
          <div style="text-align:center;margin-bottom:32px">
            <span style="font-size:48px">⚡</span>
            <h1 style="color:#FFD600;font-size:28px;margin:8px 0">BOLT</h1>
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
          <p style="color:#555;font-size:12px;margin-top:32px">BOLT — Profesionales a domicilio · Bahía Blanca</p>
        </div>`;

      try {
        const mailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    FROM_EMAIL,
            to:      [resolvedEmail],
            subject: isApproved
              ? '✅ Tu solicitud en BOLT fue aprobada'
              : '❌ Tu solicitud en BOLT fue rechazada',
            html: emailHtml,
          }),
          signal: AbortSignal.timeout(10000),
        });

        // 🔴 11-ago-2026 — el mail se disparaba sin mirar la respuesta. Resend
        //    está en plan gratis y limitado (2 mails por hora): cuando rebota
        //    por límite, o el dominio no está verificado, contesta 4xx y acá no
        //    se enteraba nadie. El admin veía "notificado" y el profesional no
        //    se enteró de nada.
        if (mailRes.ok) {
          mail = true;
        } else {
          const detalle = (await mailRes.text().catch(() => '')).slice(0, 200);
          mailMotivo = `Resend respondió ${mailRes.status}${detalle ? ': ' + detalle : ''}`;
        }
      } catch (e) {
        mailMotivo = 'no se pudo hablar con Resend: ' + String((e as Error).message ?? e);
      }
    }

    // ── 3. La verdad, no un ok de compromiso ───────────────────────────────
    // 🔴 11-ago-2026 — antes salía siempre {ok:true}. Caso real: se aprueba a
    //    Macarena, que se anotó en el alta presencial y todavía no abrió la app
    //    (o sea: sin fila en push_tokens, que es lo NORMAL en ese camino). No
    //    salía el push, el mail podía rebotar, y el panel igual cantaba "El
    //    trabajador fue notificado". Ella nunca se entera de que ya puede
    //    activarse, no prende el radar y queda invisible — el mismo agujero de
    //    "aprobado sin enterarse" que ya nos costó profesionales fantasma.
    //    Ahora se devuelve qué salió y qué no; si no salió NINGUNO de los dos
    //    caminos, esto es un fracaso y contesta 502 para que el que llama no lo
    //    pueda confundir con un éxito.
    const ok = push || mail;
    const motivo = [
      push ? null : `push: ${pushMotivo}`,
      mail ? null : `mail: ${mailMotivo}`,
    ].filter(Boolean).join(' · ');

    if (!ok) {
      // Queda en los logs de la función con el userId, que hoy es la única
      // forma de rastrear a quién hay que avisarle a mano.
      // PENDIENTE: dejarlo en una cola para que el vigilante insista al día
      // siguiente — necesita tabla nueva (migración), no se hace desde acá.
      console.error('send-worker-notification: NADIE fue notificado', { userId, action, motivo });
    }

    return json({ ok, push, mail, motivo }, ok ? 200 : 502);
  } catch (err) {
    console.error('send-worker-notification error:', err);
    return json({ error: 'Error al enviar notificación' }, 500);
  }
});

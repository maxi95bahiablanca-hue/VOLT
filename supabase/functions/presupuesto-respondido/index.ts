// presupuesto-respondido — el cliente contestó desde el link, avisarle al profesional.
//
// Maxi (5-ago-2026): "acepto y quedó como presupuesto aceptado pero a mi
// trabajador no me llegó nada".
//
// POR QUE NO ALCANZA CON send-push: esa funcion exige que quien envia este
// logueado y que comparta un `job` con el destinatario. El cliente que acepta un
// presupuesto NO tiene cuenta en BOLT: entra a una pagina, toca un boton y se
// va. No hay sesion ni trabajo en comun. Por eso hace falta esta, aparte.
//
// EL MODELO DE CONFIANZA es el mismo que el de la pagina: el token del
// presupuesto ES la credencial. Quien lo tiene, lo puede ver y contestar.
//
// Y por eso esta funcion hace las DOS cosas —cambiar el estado y avisar— en vez
// de solo avisar: asi no existe forma de disparar notificaciones sin que haya
// pasado algo de verdad. Si el presupuesto ya estaba contestado, no se cambia
// nada y no se manda nada.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const pesos = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { token, acepta } = await req.json().catch(() => ({}));
    if (!token || typeof acepta !== 'boolean') {
      return json({ error: 'token y acepta requeridos' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 1. Cambiar el estado, solo si estaba para contestar ──────────────────
    //    Un borrador no se puede aceptar, y uno ya contestado no se vuelve a
    //    contestar: eso es lo que evita que se pueda spamear el aviso.
    const ahora = new Date().toISOString();
    const { data: filas, error: upErr } = await admin
      .from('presupuestos')
      .update(acepta
        ? { estado: 'aceptado',  aceptado_at:  ahora }
        : { estado: 'rechazado', rechazado_at: ahora })
      .eq('token', token)
      .in('estado', ['enviado', 'visto'])
      .select('id, numero, total, cliente_nombre, professional_id');

    if (upErr) return json({ error: upErr.message }, 500);
    if (!filas || !filas.length) {
      // Ni existe, ni estaba para contestar. No es un error del cliente: puede
      // haber tocado dos veces. Se contesta que si, sin avisar a nadie.
      return json({ ok: true, cambio: false });
    }

    const p = filas[0];

    // ── 2. Quien es el dueño ────────────────────────────────────────────────
    const { data: prof } = await admin
      .from('professionals')
      .select('user_id, first_name')
      .eq('id', p.professional_id)
      .maybeSingle();

    if (!prof?.user_id) return json({ ok: true, cambio: true, sent: false, reason: 'sin dueño' });

    const { data: tok } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', prof.user_id)
      .maybeSingle();

    if (!tok?.token) return json({ ok: true, cambio: true, sent: false, reason: 'sin token' });

    // ── 3. Avisar ───────────────────────────────────────────────────────────
    // 🔴 El aviso va en su PROPIO try (auditoría 23-ago): el cambio de estado (pasos
    //    1-2) ya se hizo. Si el fetch a Expo tira (DNS/timeout/exp.host caído), antes
    //    caía en el catch de afuera y devolvía 500 → la web mostraba "este presupuesto
    //    ya fue respondido" (error) aunque el cambio SÍ se hizo. Ahora devuelve
    //    ok:true, cambio:true, sent:false. Con AbortSignal para no colgarse.
    const quien = (p.cliente_nombre || '').trim() || 'Un cliente';
    try {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        to: tok.token,
        title: acepta ? '✅ Te aceptaron un presupuesto' : 'Presupuesto rechazado',
        body: acepta
          ? `${quien} aceptó el N°${p.numero} por ${pesos(p.total)}. Escribile para arreglar el día.`
          : `${quien} no siguió adelante con el N°${p.numero}.`,
        data: { screen: 'miNegocio', presupuestoId: p.id },
        sound: 'default',
        // 🔴 11-ago-2026 — este emisor se había quedado afuera de la pasada de
        //    canales: no mandaba channelId NINGUNO. En Android eso no es
        //    "el canal por defecto de BOLT", es el canal comodín que arma
        //    expo-notifications ('Otros'/Miscellaneous), sin sonido ni
        //    prioridad. Justo el aviso que le dice al profesional que le
        //    aceptaron un presupuesto — plata arriba de la mesa — llegaba mudo.
        //    El único canal que la app crea de verdad es 'bolt-urgent-v3'
        //    (src/services/notificationService.js:155).
        channelId: 'bolt-urgent-v3',
        priority: acepta ? 'high' : 'normal',
      }),
    });
    const expoData = await expoRes.json().catch(() => ({})) as { data?: unknown };

    // 🔴 11-ago-2026 — antes devolvía `sent: true` sin mirar nada, aunque Expo
    //    hubiera rebotado el envío: exp.host contesta 200 con
    //    {data:{status:'error', details:{error:'DeviceNotRegistered'}}} cuando
    //    el token ya no sirve. Mismo criterio que send-push.
    const d = expoData?.data;
    const ticket = (Array.isArray(d) ? d[0] : d) as
      { status?: string; message?: string; details?: { error?: string } } | undefined;

    if (!expoRes.ok) {
      return json({ ok: true, cambio: true, sent: false, reason: `expo respondió ${expoRes.status}`, expo: expoData });
    }
    if (ticket?.status !== 'ok') {
      const motivo = ticket?.details?.error || ticket?.message || 'respuesta de expo inesperada';
      // Token de un teléfono que ya no existe: si queda guardado, TODOS los
      // avisos futuros de este profesional fallan en silencio.
      if (ticket?.details?.error === 'DeviceNotRegistered') {
        await admin.from('push_tokens').delete().eq('token', tok.token);
      }
      return json({ ok: true, cambio: true, sent: false, reason: motivo, expo: expoData });
    }

    return json({ ok: true, cambio: true, sent: true, expo: expoData });
    } catch (avisoErr) {
      // El estado ya cambió; sólo falló el aviso. No es un 500.
      return json({ ok: true, cambio: true, sent: false, reason: 'no se pudo avisar: ' + (avisoErr instanceof Error ? avisoErr.message : String(avisoErr)) });
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

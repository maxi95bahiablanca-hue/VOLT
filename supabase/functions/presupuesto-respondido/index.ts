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
    const quien = (p.cliente_nombre || '').trim() || 'Un cliente';
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: tok.token,
        title: acepta ? '✅ Te aceptaron un presupuesto' : 'Presupuesto rechazado',
        body: acepta
          ? `${quien} aceptó el N°${p.numero} por ${pesos(p.total)}. Escribile para arreglar el día.`
          : `${quien} no siguió adelante con el N°${p.numero}.`,
        data: { screen: 'miNegocio', presupuestoId: p.id },
        sound: 'default',
        priority: acepta ? 'high' : 'normal',
      }),
    });
    const expoData = await expoRes.json().catch(() => ({}));

    return json({ ok: true, cambio: true, sent: true, expo: expoData });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

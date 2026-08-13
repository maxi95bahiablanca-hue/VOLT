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
    const { userId, title, body, data = {} } = await req.json().catch(() => ({}));
    if (!userId || !title) return json({ error: 'userId y title requeridos' }, 400);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();

    // ── 1. ¿Lo manda el sistema? (crons, vigilante, triggers pg_net) ──────────
    // 11-ago-2026: hasta hoy esta función exigía SIEMPRE que emisor y
    // destinatario compartieran un trabajo, así que TODO aviso del sistema
    // rebotaba con 403 y nadie se enteraba. Quien viene con la service_role ya
    // es el backend: no hay a quién spamear.
    //
    // ⚠️ SER EL SISTEMA ES TENER LA CLAVE, PALABRA POR PALABRA. Nada de mirar
    // lo que el token DICE ser: un JWT con {"role":"service_role"} adentro lo
    // arma cualquiera en dos líneas, y la firma no se puede verificar acá
    // porque el secreto no está en el entorno de la función. Este atajo es la
    // puerta de servicio de todos los avisos: si se le cree a un token por lo
    // que dice, se abre de par en par (cualquiera notificando a cualquiera,
    // sin cuenta siquiera). Comparación exacta y punto — y no es teórico: la
    // primera versión de este arreglo, hoy mismo, se podía falsificar así.
    //
    // OJO al desplegar los llamadores: hoy los crons de las migraciones 062/066
    // mandan `Bearer sb_publishable_…` (la clave PUBLICABLE). Con esa clave NO
    // se es servicio acá — y está bien que así sea. El que quiera avisar desde
    // la base tiene que pegar con SUPABASE_SERVICE_ROLE_KEY.
    const esServicio = !!bearer && !!SERVICE_KEY && bearer === SERVICE_KEY;

    let quien = 'servicio';

    if (!esServicio) {
      // ── 2. Autenticar a quien envía ───────────────────────────────────────
      const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authErr } = await anon.auth.getUser();
      if (authErr || !user) return json({ error: 'No autorizado' }, 401);
      quien = user.id;

      // ── 3. ¿Es el admin? Mismo criterio que is_admin() de la base ─────────
      // (migración 028: el mail del JWT tiene que estar en la tabla `admins`).
      // 11-ago-2026: sin esto, cuando Maxi reasignaba un trabajo trabado desde
      // el panel, el profesional nuevo quedaba con un trabajo aceptado a su
      // nombre y un cliente esperándolo, sin ningún aviso.
      let esAdmin = false;
      if (user.email) {
        const { data: fila } = await admin
          .from('admins').select('email').eq('email', user.email).maybeSingle();
        esAdmin = !!fila;
      }

      // ── 4. Si no es admin: emisor y destinatario tienen que compartir un job ─
      //    (es lo que evita que un usuario cualquiera spamee a otro)
      if (!esAdmin) {
        const [{ data: asClient }, { data: asWorker }] = await Promise.all([
          // caller = cliente, destinatario = profesional del job
          admin.from('jobs').select('id, professionals!inner(user_id)')
            .eq('client_id', user.id).eq('professionals.user_id', userId).limit(1),
          // caller = profesional, destinatario = cliente del job
          admin.from('jobs').select('id, professionals!inner(user_id)')
            .eq('client_id', userId).eq('professionals.user_id', user.id).limit(1),
        ]);
        let allowed = !!((asClient && asClient.length) || (asWorker && asWorker.length));

        // ── 4 bis. El rescate al encargado ────────────────────────────────
        // 11-ago-2026: `rescueService.js` corre en el teléfono del CLIENTE, con
        // su sesión — NO con la service_role. Y un rescate existe justamente
        // porque no apareció ningún profesional, así que no hay trabajo en
        // común con nadie. Abrir el 403 sólo para el sistema y para el admin
        // dejaba ese aviso tan muerto como antes: el cliente seguía esperando a
        // que `rescates_sin_atender` (migración 068) escalara media hora
        // después. Acá se permite el sentido contrario, y sólo ése: cualquiera
        // con sesión puede escribirle AL encargado, que es el buzón de soporte.
        // No abre nada entre usuarios: el destinatario tiene que estar en
        // `admins`.
        if (!allowed) {
          const { data: dest } = await admin.auth.admin.getUserById(userId);
          const mailDest = dest?.user?.email;
          if (mailDest) {
            const { data: filaDest } = await admin
              .from('admins').select('email').eq('email', mailDest).maybeSingle();
            allowed = !!filaDest;
          }
        }

        if (!allowed) return json({ error: 'Sin relación con el destinatario' }, 403);
      }
    }

    // ── 5. Leer el token del destinatario (service_role, nunca se devuelve) ─
    const { data: row } = await admin
      .from('push_tokens').select('token').eq('user_id', userId).maybeSingle();
    if (!row?.token) return json({ ok: true, sent: false, reason: 'sin token' });

    // ── 6. Enviar vía Expo ──────────────────────────────────────────────────
    // ttl 1800 (30 min): iba en 60 y la ventana para responder un pedido es de
    // 180 s. Un profesional en un sótano, en un ascensor o en una obra tardaba
    // más de un minuto en enganchar señal, FCM descartaba el mensaje y el
    // teléfono no sonaba NUNCA: en la app quedaba como 'no respondió a tiempo'.
    // Media hora es lo que tarda el vigilante en escalar: pasado eso el aviso
    // ya no sirve y es mejor que caduque a que suene un pedido viejo.
    let expoRes: Response;
    try {
      expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: row.token, title, body, data,
          sound: 'alarm.wav', channelId: 'bolt-urgent-v3', priority: 'high', ttl: 1800,
        }),
        // 11-ago-2026: sin tope, cuando exp.host aceptaba la conexión y no
        // contestaba, el profesional se quedaba con el botón "Aceptar" clavado
        // (WorkerIncomingScreen espera este invoke) con el trabajo ya aceptado
        // en la base. Mejor perder el aviso que trabar al que está laburando.
        signal: AbortSignal.timeout(6000),
      });
    } catch (e) {
      return json({ ok: true, sent: false, reason: 'expo no contestó', detalle: String(e) });
    }

    const expoData = await expoRes.json().catch(() => ({} as Record<string, unknown>));

    if (!expoRes.ok) {
      return json({ ok: true, sent: false, reason: `expo respondió ${expoRes.status}`, expo: expoData });
    }

    // ── 7. Mirar QUÉ contestó Expo ──────────────────────────────────────────
    // 11-ago-2026: exp.host contesta 200 con
    // {data:{status:'error', details:{error:'DeviceNotRegistered'}}} cuando el
    // token ya no sirve (cambió de teléfono, reinstaló, Expo rotó el token).
    // Acá se devolvía {sent:true} igual: el profesional seguía apareciendo
    // disponible, todos los trabajos se le avisaban a un aparato que no existe
    // y en los reportes figuraba todo enviado. Nunca más: si no salió, se dice.
    const ticket = Array.isArray((expoData as any)?.data)
      ? (expoData as any).data[0]
      : (expoData as any)?.data;
    const errores = (expoData as any)?.errors;

    if (Array.isArray(errores) && errores.length) {
      return json({ ok: true, sent: false, reason: errores[0]?.message ?? 'expo rechazó el envío', expo: expoData });
    }

    if (ticket?.status === 'error') {
      const motivo = ticket?.details?.error ?? ticket?.message ?? 'error de expo';

      // Token muerto: lo sacamos de la tabla para que no siga fantasma. La
      // migración 063 ya sabe detectar "sin dispositivo" y bajarlo del radar.
      if (motivo === 'DeviceNotRegistered') {
        await admin.from('push_tokens').delete().eq('user_id', userId).eq('token', row.token);
        return json({ ok: true, sent: false, reason: 'DeviceNotRegistered', tokenBorrado: true });
      }
      return json({ ok: true, sent: false, reason: motivo, expo: expoData });
    }

    if (ticket?.status !== 'ok') {
      // Ni ok ni error conocido: no lo damos por enviado.
      return json({ ok: true, sent: false, reason: 'respuesta de expo inesperada', expo: expoData });
    }

    return json({ ok: true, sent: true, por: quien, expo: expoData });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

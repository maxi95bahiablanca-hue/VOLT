import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────────
//  EL LATIDO — enterarse de lo que pasa MIENTRAS pasa
//
//  Maxi, 7-ago-2026: "si esto pasa me tengo que enterar automáticamente, desde
//  que alguien solicitó un pedido a que alguien contestó el pedido" y "cuando
//  entre el primer pedido real va a ser algo impresionante verlo, así que
//  quiero verlo".
//
//  Hasta hoy sólo había dos formas de enterarse de algo: el reporte diario
//  (a las 20:10, o sea al otro día para todo lo que pasa de noche) y el
//  vigilante, que avisa SÓLO cuando algo ya salió mal. De lo que sale BIEN no
//  se enteraba nadie, y de lo que salía mal se enteraba tarde.
//
//  Esto avisa los cuatro momentos del recorrido, en el momento:
//     entró · lo tomaron · llegó · terminó
//
//  🔴 Por qué lo dispara un trigger de la base y no un cron: un cron que corre
//     cada minuto llega hasta un minuto tarde y, peor, se lo puede perder si
//     el trabajo cambia dos veces de estado entre corrida y corrida. El
//     trigger se entera en el mismo instante en que cambia la fila.
//
//  🔴 Por qué no falla nunca hacia atrás: el trigger llama por pg_net, que es
//     asíncrono. Si esta función está caída o Expo no responde, el pedido del
//     cliente se guarda igual. Un aviso perdido no puede voltear una venta.
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// 'prestador_nuevo' es el único que no habla de un trabajo: lo dispara el alta
// de un profesional (migración 071), que desde el 11-ago-2026 aprueba Maxi a mano.
type Evento = 'nuevo' | 'tomado' | 'llego' | 'terminado' | 'prestador_nuevo';

const pesos = (n: number | null) =>
  n == null ? null : '$' + Math.round(n).toLocaleString('es-AR');

// Cuánto pasó ENTRE DOS MOMENTOS del trabajo. "Lo tomaron en 2 min" es el
// número que más dice sobre si la app está funcionando.
//
// 🔴 Va entre dos fechas y no contra "ahora": midiendo contra ahora, el mismo
//    aviso dice una cosa si sale al instante y otra si sale más tarde. Ya pasó
//    en la primera prueba: un trabajo tomado en 1 minuto figuraba como
//    "lo tomó en 17 h 53 min", que era el tiempo desde que entró hasta esa
//    prueba, no lo que tardaron en tomarlo.
function entre(desde: string | null, hasta: string | null): string {
  if (!desde || !hasta) return '';
  const min = Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 60000);
  if (min < 0) return '';
  if (min < 1) return 'al toque';
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `en ${h} h${m ? ' ' + m + ' min' : ''}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // 🔴 Sólo el sistema puede disparar el latido (auditoría 23-ago): los emisores
  //    (avisar_latido / avisar_prestador_nuevo y el cron del vigilante) mandan
  //    x-latido-key, cargada como secret LATIDO_KEY. Antes cualquiera de internet
  //    podía disparar push con la dirección del trabajo en el cuerpo.
  if (req.headers.get('x-latido-key') !== Deno.env.get('LATIDO_KEY')) {
    return json({ error: 'No autorizado' }, 401);
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { job_id, evento, ocurrido, nombre, como } = await req.json() as
      { job_id?: string; evento: Evento; ocurrido?: string; nombre?: string; como?: string };
    if (!evento) return json({ error: 'falta evento' }, 400);
    // 🔴 11-ago-2026 — 'prestador_nuevo' no habla de un trabajo, así que es el
    //    único evento que llega sin job_id. Todo lo demás sí lo necesita.
    if (evento !== 'prestador_nuevo' && !job_id) return json({ error: 'falta job_id' }, 400);

    let title = '', body = '';
    let j: Record<string, any> | null = null;

    // 🔴 11-ago-2026 — Se anotó un profesional nuevo.
    //    Desde hoy nadie queda habilitado solo (migración 071): a todos los
    //    aprueba Maxi desde el panel. Eso sólo funciona si se entera en el
    //    momento — si no, el que se anotó espera sin que nadie lo mire, y el
    //    que se cansa de esperar no vuelve. Por eso el aviso va junto con el
    //    candado, no después.
    if (evento === 'prestador_nuevo') {
      const quienEs = (nombre || '').trim() || 'Alguien';
      title = `Se anotó ${quienEs}`;
      body = `${como || 'se registró'} · aprobalo desde el panel para que empiece a recibir trabajos`;
    } else {
      // OJO: se asigna a la `j` de afuera (nada de `const j` acá adentro). El
      // aviso de más abajo lee `j.id` para decirle a la app adónde llevar al
      // tocarlo: con una variable propia, esa de afuera quedaba en null y todos
      // los avisos de pedidos abrían la app en cualquier lado.
      const { data: fila, error } = await admin
        .from('jobs')
        .select('id, status, address, notes, created_at, accepted_at, arrived_at, ' +
                'visit_amount, work_amount, profession_id, professional_id, job_type')
        .eq('id', job_id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!fila) return json({ ok: true, ignorado: 'el trabajo ya no está' });
      j = fila;

      // Oficio y profesional, cada uno por su lado: que falte uno no puede dejar
      // el aviso sin mandar.
      let oficio = 'Un pedido';
      if (j.profession_id) {
        const { data: pr } = await admin
          .from('professions').select('name').eq('id', j.profession_id).maybeSingle();
        if (pr?.name) oficio = pr.name;
      }
      let quien = '';
      if (j.professional_id) {
        const { data: p } = await admin
          .from('professionals').select('first_name, last_name')
          .eq('id', j.professional_id).maybeSingle();
        if (p) quien = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      }

      const donde = (j.address || '').trim();
      const total = (Number(j.visit_amount) || 0) + (Number(j.work_amount) || 0);

      // El texto en segunda persona y sin jerga: esto se lee de un vistazo en la
      // pantalla bloqueada, no en un tablero.
      switch (evento) {
        case 'nuevo':
          title = `Entró un pedido de ${oficio.toLowerCase()}`;
          // El pedido nace ya dirigido a un profesional (professional_id es NOT
          // NULL en jobs): "pending" no significa que no lo tomó nadie, significa
          // que se lo mandamos y todavía no contestó. Decir "no lo tomó nadie"
          // haría pensar que quedó dando vueltas sin dueño.
          body = [
            donde ? `En ${donde}` : null,
            quien ? `Se lo mandamos a ${quien}` : 'Buscando profesional',
          ].filter(Boolean).join(' · ');
          break;
        case 'tomado': {
          title = `${quien || 'Un profesional'} tomó el pedido`;
          const t = entre(j.created_at, j.accepted_at);
          body = `${oficio} en ${donde || 'el domicilio'}` + (t ? ` · lo tomó ${t}` : '');
          break;
        }
        case 'llego': {
          title = `${quien || 'El profesional'} llegó`;
          const t = entre(j.accepted_at, j.arrived_at);
          body = `${oficio} en ${donde || 'el domicilio'}` + (t ? ` · llegó ${t} desde que lo tomó` : '');
          break;
        }
        case 'terminado':
          title = 'Trabajo terminado';
          body = `${oficio} en ${donde || 'el domicilio'}` +
                 (total > 0 ? ` · ${pesos(total)}` : '') +
                 (quien ? ` · ${quien}` : '');
          break;
        default:
          return json({ error: 'evento desconocido: ' + evento }, 400);
      }

    }

    // La hora del evento, adelante de todo. Los avisos pueden llegar fuera de
    // orden (pg_net los manda en paralelo): con la hora, la secuencia se
    // reconstruye leyendo, sin depender de cómo los apiló el teléfono.
    if (ocurrido) body = `${ocurrido} · ${body}`;

    // A quién. Es la MISMA lista que usa el vigilante para escalar: una sola
    // tabla decide quién está de guardia, así no hay dos listas que se
    // desincronizan y alguien deja de recibir la mitad de las cosas.
    const { data: personas } = await admin
      .from('avisos_a_persona').select('email').eq('activo', true);
    const userIds: string[] = [];
    for (const p of personas ?? []) {
      const { data } = await admin.rpc('user_id_por_email', { p_email: p.email });
      if (data) userIds.push(data as string);
    }
    // 🔴 11-ago-2026 — estos dos cortes contestaban `ok: true` con `avisados: 0`.
    //    Es la misma mentira de siempre con otra ropa: nadie se enteró del
    //    pedido, y el que mire `ok` (hoy el log de pg_net, mañana cualquier
    //    tablero) lo va a leer como que el latido salió bien. Que no haya a
    //    quién avisarle no es un éxito, es la lista de guardia vacía o el
    //    teléfono sin registrar: hay que ir a arreglarlo. Se deja HTTP 200
    //    igual, porque reintentar no cambia nada — no es una falla de entrega.
    if (!userIds.length) return json({ ok: false, avisados: 0, motivo: 'nadie de guardia' });

    const { data: filas } = await admin
      .from('push_tokens').select('token').in('user_id', userIds);
    const tokens = (filas ?? []).map((f: { token: string }) => f.token).filter(Boolean);
    if (!tokens.length) return json({ ok: false, avisados: 0, motivo: 'sin dispositivos' });

    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 22-ago-2026: sin tope, si exp.host acepta la conexión y no contesta, el
      // latido queda colgado (lo dispara pg_net por trigger). Cae al catch de
      // afuera (500), que en pg_net queda anotado como que el aviso se perdió.
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify(tokens.map((to) => ({
        to, title, body,
        // El destino va explícito: la app igual lo deduce del jobId, pero un aviso
        // que dice adónde lleva no depende de que nadie lo adivine.
        data: j ? { jobId: j.id, evento, screen: 'tracking' } : { evento, screen: 'admin' },
        sound: 'default',
        // 🔴 11-ago-2026 — acá decía 'bolt-actividad', con la idea de tener un
        //    canal aparte del de los profesionales. El problema: ese canal la app
        //    NUNCA lo crea. El único que existe en el teléfono es
        //    'bolt-urgent-v3' (src/services/notificationService.js:155, dentro
        //    de setup(); el otro canal que existe es 'bolt-incoming-call-v1',
        //    de notifee, y ése es sólo para el pedido entrante estilo llamada
        //    — no sirve para avisarle a Maxi), y los
        //    canales de Android sólo los crea el cliente, no el que manda.
        //    Cuando el channelId no existe, expo-notifications cae al canal
        //    comodín (BaseNotificationBuilder: el que en el teléfono se ve como
        //    'Otros'/Miscellaneous): sin el sonido de BOLT, sin prioridad y
        //    mezclado con el ruido de todas las apps. O sea que el latido
        //    entero — los cuatro momentos del pedido — venía aterrizando donde
        //    nadie mira, y encima si Maxi silencia 'Otros' se queda sin los
        //    avisos de pedidos entrando, que es justo para lo que existe esto.
        //    Va al canal que existe DE VERDAD. Separarlo de nuevo requiere
        //    crear el canal en notificationService.setup() y hacer build nuevo
        //    (OTA no alcanza para eso): hasta entonces, que suene fuerte junto
        //    con los trabajos es mejor que no sonar.
        channelId: 'bolt-urgent-v3',
        priority: 'high',
      }))),
    });

    // 🔴 11-ago-2026 — antes devolvía `avisados: tokens.length` sin mirar qué
    //    contestó Expo: un token muerto ("DeviceNotRegistered", el clásico
    //    después de reinstalar la app o cambiar de teléfono) se informaba como
    //    aviso entregado. Un aviso que no salió no se puede informar como
    //    enviado: se cuentan los comprobantes que Expo devuelve en ok, y los que
    //    fallaron viajan con su motivo para que quede en el log de pg_net.
    let cuerpo: { data?: unknown } | null = null;
    try { cuerpo = await r.json(); } catch { /* Expo contestó algo que no es JSON */ }
    const tickets = Array.isArray(cuerpo?.data)
      ? cuerpo!.data as Array<{ status?: string; message?: string; details?: { error?: string } }>
      : [];

    let entregados = 0;
    const fallas: string[] = [];
    const muertos: string[] = [];
    if (!r.ok) fallas.push(`Expo respondió ${r.status}`);
    // Los comprobantes vienen en el MISMO orden que los mensajes, uno por
    // mensaje: así se sabe de qué token habla cada uno. Si por lo que sea no
    // vienen todos, la correspondencia por índice deja de ser cierta y borrar
    // por índice sacaría el token de OTRO teléfono — o sea, dejaría mudo a
    // alguien que sí estaba recibiendo. Ante la duda no se borra nada.
    const alineados = tickets.length === tokens.length;
    tickets.forEach((t, i) => {
      if (t?.status === 'ok') { entregados++; return; }
      const motivo = t?.details?.error || t?.message || 'error sin detalle';
      fallas.push(motivo);
      // El token ya no existe: si no lo borramos, este mismo token va a fallar
      // en cada uno de los cuatro avisos de cada pedido, para siempre.
      if (alineados && t?.details?.error === 'DeviceNotRegistered' && tokens[i]) muertos.push(tokens[i]);
    });
    if (!tickets.length) {
      if (r.ok) fallas.push('Expo no devolvió comprobantes');
    } else if (!alineados) {
      fallas.push(`Expo devolvió ${tickets.length} comprobantes para ${tokens.length} envíos`);
    }

    if (muertos.length) {
      await admin.from('push_tokens').delete().in('token', muertos);
    }

    // Si no salió NINGUNO, no se puede contestar 200 con cara de éxito: el
    // trigger llama por pg_net y el estado de la respuesta es lo único que
    // queda anotado de que el latido se perdió.
    return json({
      ok: entregados > 0,
      evento,
      avisados: entregados,
      intentados: tokens.length,
      fallas,
      expo: r.status,
      title,
      body,
    }, entregados > 0 ? 200 : 502);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

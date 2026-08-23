import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────────
//  EL VIGILANTE — que ningún trabajo se quede quieto esperando a nadie
//
//  Maxi, 31-jul-2026: "cada cosa que pase en la web o app, durante todo el
//  flujo, no puede depender ni del usuario ni del trabajador, porque si no
//  hacen algo en el medio queda trabado... ninguna acción puede quedar trabada.
//  Si no se mueve, se busca la forma de moverlo."
//
//  `trabajos_trabados()` (migración 040) ya sabía cuáles se habían quedado,
//  pero sólo lo mostraba en el panel de admin: para destrabar algo, alguien
//  tenía que acordarse de entrar a mirar. Esta función es lo que faltaba.
//
//  CÓMO TRABAJA — las tres preguntas de la regla:
//    1. Se le pregunta primero A QUIEN PUEDE MOVERLO, que casi siempre es el
//       profesional. No al cliente: el cliente no puede hacer nada con
//       "el profesional no llegó" salvo enojarse.
//    2. Se insiste UNA sola vez más, a las 3 horas — y ahí se termina. El tope
//       es de verdad desde el 11-ago-2026 (MAX_AVISOS_AL_PROFESIONAL): antes se
//       repetía cada 3 h para siempre.
//    3. La persona de guardia (`avisos_a_persona`) se entera desde la primera
//       detección, y es la que sigue moviendo el trabajo cuando el profesional
//       ya no contesta. Un pedido que NADIE tomó se escala derecho: ahí no hay
//       a quién preguntarle.
//
//  🔴 La memoria de a quién ya se le preguntó está en `vigilante_avisos`. Sin
//     eso, cada corrida del cron mandaría el mismo mensaje otra vez — y un
//     vigilante que spamea se silencia en dos días, que es peor que no tenerlo.
//
//  Corre por pg_cron cada hora. No decide nada por su cuenta: no cancela, no
//  reasigna, no cierra. Sólo pregunta y avisa.
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const HORAS_PARA_INSISTIR = 3;
// (Ya no existe un "avisos antes de escalar": a la persona de guardia se le
//  avisa en la primera detección. Ver el comentario del bucle más abajo.)

// 🔴 11-ago-2026 — EL TOPE QUE FALTABA.
//    La cabecera prometía "se insiste UNA sola vez más, a las 3 horas", pero el
//    único freno era el filtro de las 3 h: `veces` se contaba y no se miraba
//    nunca. Caso real: un profesional acepta y no marca que salió (`no_fue`).
//    `trabajos_trabados()` lo devuelve mientras siga en 'accepted' y
//    `cerrar_trabajos_abandonados` recién lo cancela a los 7 días. El cron
//    corre de 8 a 22 → ~5 pases del filtro por día → unos 35 pushes
//    "¿Fuiste a ese trabajo?" por el MISMO trabajo. El profesional silencia
//    BOLT y a partir de ahí tampoco se entera de los pedidos nuevos: se pierden
//    trabajos de verdad.
//    Dos avisos al profesional (el primero + una insistencia a las 3 h) y se
//    corta. A partir de ahí lo mueve la persona de guardia, que ya está avisada
//    desde la primera detección: se escala en vez de repetir.
const MAX_AVISOS_AL_PROFESIONAL = 2;

type Trabado = {
  job_id: string;
  motivo: string;
  detalle: string;
  desde: string;
  client_id: string | null;
  worker_user: string | null;
};

// Qué se le dice a cada uno. En segunda persona y sin tecnicismos: el que lo
// recibe está trabajando, no leyendo un tablero.
//
// `aPersona: true` significa que no hay a quién preguntarle y va derecho al
// escalado.
const GUION: Record<string, { titulo: string; cuerpo: string; aPersona?: boolean }> = {
  sin_respuesta: {
    titulo: 'Un pedido sin tomar',
    cuerpo: 'Hace media hora que un cliente está esperando y no lo tomó nadie.',
    aPersona: true,
  },
  no_fue: {
    titulo: '¿Fuiste a ese trabajo?',
    cuerpo: 'Aceptaste un trabajo y todavía no marcaste que saliste. Si ya fuiste, marcalo; si no vas a poder, avisale al cliente.',
  },
  no_empezo: {
    titulo: '¿Arrancaste?',
    cuerpo: 'Marcaste que llegaste hace más de una hora y el trabajo sigue sin empezar.',
  },
  jornada_abierta: {
    titulo: '¿Terminaste por hoy?',
    cuerpo: 'Quedó una jornada abierta desde hace medio día. Cerrala así el cliente ve en qué anda el trabajo.',
  },
  mensaje_sin_respuesta: {
    titulo: 'Te escribió el cliente',
    cuerpo: 'Hay un mensaje sin responder desde hace un rato. Contestarle rápido es lo que más define si te recomienda.',
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // 🔴 Sólo el cron puede despertar al vigilante (auditoría 23-ago): manda
  //    x-latido-key (secret LATIDO_KEY). Antes cualquiera de internet podía
  //    dispararlo y generar push a los profesionales.
  if (req.headers.get('x-latido-key') !== Deno.env.get('LATIDO_KEY')) {
    return json({ error: 'No autorizado' }, 401);
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Lo primero: olvidar los que ya se destrabaron. Si no, un trabajo que se
    // traba, se arregla y se vuelve a trabar quedaría con el contador viejo y
    // se escalaría sin haberle preguntado nunca esta vez.
    const { data: limpiados } = await admin.rpc('vigilante_limpiar');

    const { data: trabados, error } = await admin.rpc('trabajos_trabados');
    if (error) return json({ error: String(error.message) }, 500);
    const lista = (trabados ?? []) as Trabado[];

    // A quién se le escala. Se resuelve una vez, no por trabajo.
    //
    // 🔴 11-ago-2026 — antes los errores de acá se ignoraban en silencio. Si
    //    `avisos_a_persona` o `user_id_por_email` fallaban un segundo, la lista
    //    quedaba vacía, no se avisaba a NADIE… y abajo igual se marcaba todo
    //    como escalado. Ahora la falla queda en la respuesta y, sin gente de
    //    guardia, no se marca nada (ver más abajo).
    const errores: string[] = [];
    const { data: personas, error: errPersonas } = await admin
      .from('avisos_a_persona').select('email').eq('activo', true);
    if (errPersonas) errores.push(`avisos_a_persona: ${errPersonas.message}`);
    const usersDeGuardia: string[] = [];
    for (const p of personas ?? []) {
      const { data, error: errMail } = await admin.rpc('user_id_por_email', { p_email: p.email });
      if (errMail) { errores.push(`user_id_por_email(${p.email}): ${errMail.message}`); continue; }
      if (data) usersDeGuardia.push(data as string);
      else errores.push(`user_id_por_email(${p.email}): sin usuario de BOLT con ese mail`);
    }
    if (!usersDeGuardia.length) {
      // No hay a quién escalarle. Se sigue igual —insistirle al profesional
      // sirve— pero NADA se va a marcar como escalado: si se marcara, el
      // trabajo trabado no volvería a aparecer nunca más.
      errores.push('sin nadie de guardia: no se escala nada (revisar avisos_a_persona)');
    }

    const ahora = Date.now();
    let preguntados = 0, escalados = 0;

    for (const t of lista) {
      const guion = GUION[t.motivo];
      if (!guion) continue;

      const { data: aviso } = await admin
        .from('vigilante_avisos')
        .select('veces, ultimo_at, escalado_at')
        .eq('job_id', t.job_id).eq('motivo', t.motivo).maybeSingle();

      const veces     = Number(aviso?.veces ?? 0);
      const ultimo    = aviso?.ultimo_at ? new Date(aviso.ultimo_at).getTime() : 0;
      const yaEscalado = !!aviso?.escalado_at;

      // Todavía no pasó el tiempo para volver a insistir.
      if (ultimo && ahora - ultimo < HORAS_PARA_INSISTIR * 3600 * 1000) continue;

      // ¿Queda algo por decir? Si la persona de guardia ya está avisada y al
      // profesional ya se le preguntó lo que corresponde (o no hay a quién
      // preguntarle), se sale sin tocar la fila: si se tocara `ultimo_at`, este
      // trabajo volvería a entrar acá cada 3 h para no hacer nada.
      const topeAlcanzado  = veces >= MAX_AVISOS_AL_PROFESIONAL;
      const hayQuePreguntar = !guion.aPersona && !!t.worker_user && !topeAlcanzado;
      if (yaEscalado && !hayQuePreguntar) continue;

      // 🔴 A la persona de guardia se le avisa DESDE LA PRIMERA vez, en paralelo
      //    a que se le insiste al profesional.
      //
      //    Antes se esperaba a que el profesional fallara dos veces (3 h cada
      //    ronda) y recién ahí se avisaba. El 7-ago-2026 eso significó que un
      //    trabajo trabado a las 00:41 se avisara a las 16:07: 15 horas y
      //    media. Maxi: "si lo pidió ayer y me avisa hoy no tiene sentido, era
      //    ayer la onda".
      //
      //    Insistirle al profesional sirve —puede destrabarlo él solo— pero eso
      //    no es razón para que el que puede levantar el teléfono se entere al
      //    otro día. Se sigue avisando UNA sola vez por trabajo y motivo, así
      //    que esto no agrega ruido: adelanta el mismo aviso que ya se mandaba.
      try {
        // 🔴 11-ago-2026 — LA MARCA SE ESCRIBE DESPUÉS DE QUE EL AVISO SALIÓ.
        //    Antes se llamaba a `guardar(..., { escalar: true })` pase lo que
        //    pase, y `pushA` se iba en silencio si no había gente de guardia o
        //    si `push_tokens` no devolvía filas. Desde ese momento `yaEscalado`
        //    era true para siempre (la fila sólo se borra cuando el trabajo se
        //    destraba). Caso real: entra un pedido a las 21:00, nadie lo toma,
        //    el vigilante corre a las 21:07 justo cuando Maxi está deslogueado
        //    → el pedido queda "escalado" sin que le llegara a NADIE, y el
        //    cliente espera hasta que lo cancele cerrar_trabajos_abandonados.
        let avisadosPersona = 0;
        let avisadosPro = 0;

        if (!yaEscalado) {
          const cuerpo = guion.aPersona
            ? `${guion.cuerpo} (${t.detalle})`
            : veces === 0
              ? `${t.detalle}. Le estamos avisando al profesional.`
              : `Le preguntamos ${veces} ${veces === 1 ? 'vez' : 'veces'} y sigue igual: ${t.detalle}.`;
          const r = await pushA(admin, usersDeGuardia, 'BOLT necesita una mano', cuerpo,
            // Tocar el aviso tiene que abrir EL trabajo trabado, que es donde
            // están las acciones para destrabarlo.
            { jobId: t.job_id, screen: 'tracking' });
          avisadosPersona = r.enviados;
          if (avisadosPersona > 0) escalados++;
          else errores.push(`escalado ${t.job_id}/${t.motivo} NO salió: ${r.motivo}`);
        }

        // Y en la misma vuelta se le pregunta a quien puede moverlo, mientras
        // no se haya llegado al tope de insistencias.
        if (hayQuePreguntar) {
          const r = await pushA(admin, [t.worker_user], guion.titulo, guion.cuerpo, {
            jobId: t.job_id, screen: 'tracking',
          });
          avisadosPro = r.enviados;
          if (avisadosPro > 0) preguntados++;
          else errores.push(`aviso al profesional ${t.job_id}/${t.motivo} NO salió: ${r.motivo}`);
        }

        // Si no salió ni uno, la fila queda como estaba: en la próxima corrida
        // se vuelve a intentar. Un aviso perdido no puede hacer desaparecer el
        // trabajo trabado.
        if (avisadosPersona > 0 || avisadosPro > 0) {
          await guardar(admin, t, veces, {
            // Sólo se marca escalado si la persona de guardia lo recibió.
            escalar: avisadosPersona > 0,
            // Y `veces` cuenta las insistencias que EFECTIVAMENTE le llegaron
            // al profesional: si no le llegó, no le gastamos una de las dos.
            contar:  avisadosPro > 0,
          });
        }
      } catch (e) {
        errores.push(`${t.job_id}/${t.motivo}: ${String(e)}`);
      }
    }

    // ── Los rescates que nadie atendió ─────────────────────────────────────
    //
    //  Un rescate es un cliente que buscó y no encontró a NADIE: el pedido no
    //  llegó a existir como trabajo, así que `trabajos_trabados()` no lo ve.
    //  Cuando se crea ya sale un push, pero eso depende de que alguien lo mire
    //  justo en ese momento. Si a la media hora sigue en 'pendiente', se
    //  insiste una vez — porque del otro lado hay alguien esperando que lo
    //  llamen, y ese es el cliente que más fácil se pierde: quiso comprar y no
    //  pudo.
    //  🔴 11-ago-2026 — acá el `update({ escalado_at })` iba pegado al push, sin
    //     mirar si el push había salido. `rescates_sin_atender` (migración 068)
    //     filtra `escalado_at is null` y sólo mira 2 días para atrás: una vez
    //     marcado, ese rescate NO vuelve a aparecer nunca. O sea que un push
    //     perdido (sin gente de guardia, sin token, Expo caído) dejaba al
    //     cliente que más fácil se pierde —quiso comprar y no pudo— esperando
    //     un llamado que nadie sabía que tenía que hacer. Ahora la marca se
    //     escribe sólo si alguien lo recibió; si no, vuelve en la corrida
    //     siguiente.
    let rescatesAvisados = 0;
    let rescatesSinAvisar = 0;
    try {
      const { data: rescates, error: errRescates } = await admin.rpc('rescates_sin_atender', { p_minutos: 30 });
      if (errRescates) errores.push(`rescates_sin_atender: ${errRescates.message}`);
      for (const r of (rescates ?? []) as {
        id: string; oficio: string; address: string; minutos: number;
      }[]) {
        const h = Math.floor(r.minutos / 60), m = r.minutos % 60;
        const hace = h ? `${h} h${m ? ' ' + m + ' min' : ''}` : `${m} min`;
        const res = await pushA(
          admin, usersDeGuardia,
          'Un cliente sigue esperando',
          `Pidió ${r.oficio.toLowerCase()} hace ${hace} y no había nadie disponible. En ${r.address}.`,
          { rescateId: r.id },
        );
        if (res.enviados > 0) {
          const { error: errMarca } = await admin.from('rescates')
            .update({ escalado_at: new Date().toISOString() })
            .eq('id', r.id);
          if (errMarca) errores.push(`rescate ${r.id}: avisado pero no se pudo marcar (${errMarca.message})`);
          rescatesAvisados++;
        } else {
          rescatesSinAvisar++;
          errores.push(`rescate ${r.id} NO avisado (queda pendiente): ${res.motivo}`);
        }
      }
    } catch (e) {
      errores.push(`rescates: ${String(e)}`);
    }

    return json({
      ok: true, trabados: lista.length, preguntados, escalados,
      rescatesAvisados, rescatesSinAvisar, limpiados: limpiados ?? 0, errores,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

/**
 * Anota lo que REALMENTE se avisó. Sólo se la llama cuando salió al menos un
 * push (11-ago-2026): si no salió ninguno, la fila no se toca y el trabajo
 * vuelve a entrar en la corrida siguiente.
 *
 *  · `escalar` → true sólo si la persona de guardia recibió el aviso.
 *  · `contar`  → true sólo si el profesional recibió el suyo; es lo que gasta
 *                una de las MAX_AVISOS_AL_PROFESIONAL insistencias.
 */
async function guardar(
  admin: ReturnType<typeof createClient>,
  t: Trabado,
  veces: number,
  { escalar, contar }: { escalar: boolean; contar: boolean },
) {
  const { error } = await admin.from('vigilante_avisos').upsert({
    job_id: t.job_id,
    motivo: t.motivo,
    veces: contar ? veces + 1 : veces,
    ultimo_at: new Date().toISOString(),
    ...(escalar ? { escalado_at: new Date().toISOString() } : {}),
  }, { onConflict: 'job_id,motivo' });
  // Si esto falla, el próximo pase vuelve a avisar: preferimos repetir un aviso
  // antes que perderlo, pero que se sepa.
  if (error) throw new Error(`no se pudo guardar el aviso: ${error.message}`);
}

/**
 * Manda el push directo a Expo. No pasa por `send-push` a propósito: aquella
 * exige que el que manda y el que recibe compartan un trabajo, que es lo
 * correcto entre dos usuarios — pero acá el que manda es el sistema, y en el
 * escalado el destinatario no tiene ninguna relación con ese pedido.
 *
 * Nunca tira: que falle un aviso no puede cortar la corrida y dejar sin revisar
 * a todos los que vienen atrás.
 *
 * 🔴 11-ago-2026 — antes devolvía `undefined` SIEMPRE: sin gente de guardia,
 *    sin tokens, con Expo caído o con un token muerto, el que llamaba no tenía
 *    forma de saberlo y marcaba el trabajo como avisado igual. Ahora devuelve
 *    `{ enviados, motivo }` y quien llama decide si corresponde marcar algo.
 *    `enviados` cuenta los que Expo aceptó de verdad (status 'ok'): un 200 de
 *    exp.host con `{status:'error', details:{error:'DeviceNotRegistered'}}`
 *    NO es un aviso entregado.
 */
async function pushA(
  admin: ReturnType<typeof createClient>,
  userIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<{ enviados: number; motivo: string }> {
  if (!userIds.length) return { enviados: 0, motivo: 'no hay a quién avisarle (lista de destinatarios vacía)' };

  const { data: filas, error: errTokens } = await admin
    .from('push_tokens').select('token').in('user_id', userIds);
  if (errTokens) return { enviados: 0, motivo: `no se pudieron leer los tokens: ${errTokens.message}` };
  const tokens = (filas ?? []).map((f: { token: string }) => f.token).filter(Boolean);
  if (!tokens.length) return { enviados: 0, motivo: 'el destinatario no tiene ningún teléfono registrado' };

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({
        to, title, body, data,
        sound: 'default', channelId: 'bolt-urgent-v3', priority: 'high',
      }))),
      // Si exp.host acepta la conexión y no contesta, sin esto la corrida entera
      // se cuelga hasta que la plataforma mate la función.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { enviados: 0, motivo: `Expo contestó ${res.status}` };

    const cuerpo = await res.json().catch(() => null);
    const items = Array.isArray(cuerpo?.data) ? cuerpo.data : [];
    if (!items.length) {
      const err = cuerpo?.errors?.[0]?.message;
      return { enviados: 0, motivo: err ? `Expo rechazó el envío: ${err}` : 'Expo contestó algo que no se entiende' };
    }

    const enviados = items.filter((i: { status?: string }) => i?.status === 'ok').length;
    if (enviados === items.length) return { enviados, motivo: 'ok' };

    const fallas: string[] = [];
    const muertos: string[] = [];
    // Los comprobantes vuelven en el MISMO orden que los mensajes, uno por
    // mensaje. Si no vienen todos, la correspondencia por índice deja de ser
    // cierta y borrar por índice sacaría el token de OTRO teléfono: ante la duda
    // no se borra nada. (Mismo criterio que `latido`.)
    const alineados = items.length === tokens.length;
    items.forEach((i: { status?: string; message?: string; details?: { error?: string } }, idx: number) => {
      if (i?.status === 'ok') return;
      fallas.push(i?.details?.error || i?.message || 'error sin detalle');
      if (alineados && i?.details?.error === 'DeviceNotRegistered' && tokens[idx]) muertos.push(tokens[idx]);
    });

    // 🔴 11-ago-2026 — acá el comentario decía que los tokens muertos los limpia
    //    `send-push`. No es cierto: esta función le pega a Expo DIRECTO y nunca
    //    pasa por ahí. Con la regla nueva —sólo se marca lo que se entregó— un
    //    token muerto de la persona de guardia (cambió de teléfono, reinstaló)
    //    dejaba al vigilante sin escalar NADA para siempre, reintentando cada
    //    hora contra un aparato que no existe. Se borra igual que en `latido`:
    //    la app registra uno nuevo la próxima vez que se abre.
    if (muertos.length) {
      const { error: errBorrar } = await admin.from('push_tokens').delete().in('token', muertos);
      if (errBorrar) fallas.push(`no se pudo borrar el token muerto: ${errBorrar.message}`);
    }

    return { enviados, motivo: `${enviados}/${items.length} entregados — ${fallas.join(', ')}` };
  } catch (e) {
    // Un aviso perdido no puede frenar al resto, pero tampoco se informa como
    // enviado.
    return { enviados: 0, motivo: `no se pudo hablar con Expo: ${String((e as Error)?.message ?? e)}` };
  }
}

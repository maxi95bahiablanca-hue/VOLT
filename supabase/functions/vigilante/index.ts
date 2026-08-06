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
//    2. Se insiste UNA sola vez más, a las 3 horas.
//    3. Si después de dos avisos sigue igual, se escala a una persona
//       (`avisos_a_persona`). Un pedido que NADIE tomó se escala derecho: ahí
//       no hay a quién preguntarle.
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
const AVISOS_ANTES_DE_ESCALAR = 2;

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
    const { data: personas } = await admin
      .from('avisos_a_persona').select('email').eq('activo', true);
    const usersDeGuardia: string[] = [];
    for (const p of personas ?? []) {
      const { data } = await admin.rpc('user_id_por_email', { p_email: p.email });
      if (data) usersDeGuardia.push(data as string);
    }

    const ahora = Date.now();
    let preguntados = 0, escalados = 0;
    const errores: string[] = [];

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

      const toca_escalar = guion.aPersona || veces >= AVISOS_ANTES_DE_ESCALAR;

      try {
        if (toca_escalar) {
          if (yaEscalado) continue;                    // a una persona se le avisa UNA vez
          const cuerpo = guion.aPersona
            ? `${guion.cuerpo} (${t.detalle})`
            : `Le preguntamos ${veces} veces y sigue igual: ${t.detalle}.`;
          await pushA(admin, usersDeGuardia, 'BOLT necesita una mano', cuerpo, { jobId: t.job_id });
          await guardar(admin, t, veces, { escalar: true });
          escalados++;
        } else {
          if (!t.worker_user) continue;                // sin a quién preguntarle
          await pushA(admin, [t.worker_user], guion.titulo, guion.cuerpo, {
            jobId: t.job_id, screen: 'tracking',
          });
          await guardar(admin, t, veces, { escalar: false });
          preguntados++;
        }
      } catch (e) {
        errores.push(`${t.job_id}/${t.motivo}: ${String(e)}`);
      }
    }

    return json({
      ok: true, trabados: lista.length, preguntados, escalados,
      limpiados: limpiados ?? 0, errores,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function guardar(
  admin: ReturnType<typeof createClient>,
  t: Trabado,
  veces: number,
  { escalar }: { escalar: boolean },
) {
  await admin.from('vigilante_avisos').upsert({
    job_id: t.job_id,
    motivo: t.motivo,
    veces: veces + 1,
    ultimo_at: new Date().toISOString(),
    ...(escalar ? { escalado_at: new Date().toISOString() } : {}),
  }, { onConflict: 'job_id,motivo' });
}

/**
 * Manda el push directo a Expo. No pasa por `send-push` a propósito: aquella
 * exige que el que manda y el que recibe compartan un trabajo, que es lo
 * correcto entre dos usuarios — pero acá el que manda es el sistema, y en el
 * escalado el destinatario no tiene ninguna relación con ese pedido.
 *
 * Nunca tira: que falle un aviso no puede cortar la corrida y dejar sin revisar
 * a todos los que vienen atrás.
 */
async function pushA(
  admin: ReturnType<typeof createClient>,
  userIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
) {
  if (!userIds.length) return;
  const { data: filas } = await admin
    .from('push_tokens').select('token').in('user_id', userIds);
  const tokens = (filas ?? []).map((f: { token: string }) => f.token).filter(Boolean);
  if (!tokens.length) return;

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({
        to, title, body, data,
        sound: 'default', channelId: 'bolt-urgent-v3', priority: 'high',
      }))),
    });
  } catch { /* un aviso perdido no puede frenar al resto */ }
}

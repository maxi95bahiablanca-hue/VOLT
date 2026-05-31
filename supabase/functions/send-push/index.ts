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

    // ── 1. Autenticar a quien envía ─────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await anon.auth.getUser();
    if (authErr || !user) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 2. Verificar que emisor y destinatario comparten un trabajo ─────────
    //    (evita que un usuario cualquiera spamee a otro sin relación)
    const [{ data: asClient }, { data: asWorker }] = await Promise.all([
      // caller = cliente, destinatario = profesional del job
      admin.from('jobs').select('id, professionals!inner(user_id)')
        .eq('client_id', user.id).eq('professionals.user_id', userId).limit(1),
      // caller = profesional, destinatario = cliente del job
      admin.from('jobs').select('id, professionals!inner(user_id)')
        .eq('client_id', userId).eq('professionals.user_id', user.id).limit(1),
    ]);
    const allowed = !!((asClient && asClient.length) || (asWorker && asWorker.length));
    if (!allowed) return json({ error: 'Sin relación con el destinatario' }, 403);

    // ── 3. Leer el token del destinatario (service_role, nunca se devuelve) ─
    const { data: row } = await admin
      .from('push_tokens').select('token').eq('user_id', userId).maybeSingle();
    if (!row?.token) return json({ ok: true, sent: false, reason: 'sin token' });

    // ── 4. Enviar vía Expo ──────────────────────────────────────────────────
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: row.token, title, body, data,
        sound: 'default', channelId: 'govolt-jobs', priority: 'high', ttl: 60,
      }),
    });
    const expoData = await expoRes.json().catch(() => ({}));
    return json({ ok: true, sent: true, expo: expoData });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

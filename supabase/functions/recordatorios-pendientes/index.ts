import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Corre 1 vez por día (pg_cron). Manda recordatorio a leads presenciales con datos
// pendientes: el 1º a los 2 días del registro, el 2º y ÚLTIMO 4 días después del 1º.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Mismo checklist que notify-datos-pendientes / completar-registro.
const KEYS = ['dni', 'fecha_nac', 'profesion', 'zona', 'dni_frente_url', 'dni_dorso_url', 'selfie_url', 'antecedentes_url', 'monotributo_url'];

function esFaltante(lead: Record<string, unknown>, key: string): boolean {
  const v = String(lead[key] ?? '').trim();
  if (!v) return true;
  if (key === 'profesion' && v.toLowerCase() === 'a completar') return true;
  return false;
}

const DIA = 24 * 60 * 60 * 1000;
const MAX_POR_CORRIDA = 30;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: leads, error } = await admin
      .from('prestador_leads')
      .select('id, email, estado, completar_token, created_at, recordatorios_enviados, ultimo_recordatorio_at, ' + KEYS.join(', '))
      .not('completar_token', 'is', null)
      .not('email', 'is', null)
      // 🔴 .lt excluía los leads con recordatorios_enviados NULL (auditoría
      //    23-ago): nunca recibían ni el primer recordatorio. NULL cuenta como 0.
      .or('recordatorios_enviados.is.null,recordatorios_enviados.lt.2')
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) return json({ error: String(error.message) }, 500);

    const ahora = Date.now();
    const candidatos = (leads ?? []).filter((l) => {
      if (['rechazado', 'descartado'].includes(String(l.estado ?? '').toLowerCase())) return false;
      if (!KEYS.some((k) => esFaltante(l as Record<string, unknown>, k))) return false; // ya está completo
      const n = Number(l.recordatorios_enviados ?? 0);
      if (n === 0) return ahora - new Date(l.created_at).getTime() >= 2 * DIA;
      const ultimo = l.ultimo_recordatorio_at ? new Date(l.ultimo_recordatorio_at).getTime() : 0;
      return ahora - ultimo >= 4 * DIA;
    }).slice(0, MAX_POR_CORRIDA);

    let enviados = 0;
    const errores: string[] = [];
    for (const l of candidatos) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-datos-pendientes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE}`, 'apikey': SERVICE },
          body: JSON.stringify({ token: l.completar_token, variante: 'recordatorio' }),
        });
        if (!r.ok) { errores.push(`${l.id}: HTTP ${r.status}`); continue; }
        await admin.from('prestador_leads').update({
          recordatorios_enviados: Number(l.recordatorios_enviados ?? 0) + 1,
          ultimo_recordatorio_at: new Date().toISOString(),
        }).eq('id', l.id);
        enviados++;
      } catch (e) {
        errores.push(`${l.id}: ${String(e)}`);
      }
    }

    return json({ ok: true, candidatos: candidatos.length, enviados, errores });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

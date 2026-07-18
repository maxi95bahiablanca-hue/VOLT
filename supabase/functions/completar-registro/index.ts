import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Mismo checklist que notify-datos-pendientes.
const ITEMS: { key: string; label: string; tipo: 'dato' | 'doc'; hint?: string; link?: string }[] = [
  { key: 'telefono',         label: 'Tu WhatsApp',                         tipo: 'dato', hint: 'Para avisarte cuando se active tu perfil' },
  { key: 'dni',              label: 'Número de DNI',                       tipo: 'dato' },
  { key: 'fecha_nac',        label: 'Fecha de nacimiento',                 tipo: 'dato' },
  { key: 'profesion',        label: 'Tu oficio',                           tipo: 'dato' },
  { key: 'zona',             label: 'Tu zona o barrio',                    tipo: 'dato' },
  { key: 'dni_frente_url',   label: 'Foto del DNI — FRENTE',               tipo: 'doc' },
  { key: 'dni_dorso_url',    label: 'Foto del DNI — DORSO',                tipo: 'doc' },
  { key: 'selfie_url',       label: 'Selfie sosteniendo tu DNI',           tipo: 'doc' },
  { key: 'antecedentes_url', label: 'Certificado de antecedentes penales', tipo: 'doc', hint: 'Se saca gratis online en 5 minutos', link: 'https://www.argentina.gob.ar/justicia/reincidencia/certificado-de-antecedentes-penales-web' },
  { key: 'monotributo_url',  label: 'Constancia de monotributo',           tipo: 'doc', hint: 'La descargás de AFIP', link: 'https://monotributo.afip.gob.ar' },
];

// Campos de texto que el prestador puede completar/corregir con su token.
const CAMPOS_TEXTO = ['telefono', 'dni', 'fecha_nac', 'profesion', 'zona', 'ciudad', 'experiencia', 'matricula', 'antecedentes', 'monotributo', 'domicilio'];
// Paths de documentos subidos al bucket prestador-docs.
const CAMPOS_DOC = ['dni_frente_url', 'dni_dorso_url', 'selfie_url', 'antecedentes_url', 'monotributo_url'];

function esFaltante(lead: Record<string, unknown>, key: string): boolean {
  const v = String(lead[key] ?? '').trim();
  if (!v) return true;
  if (key === 'profesion' && v.toLowerCase() === 'a completar') return true;
  return false;
}

function faltantes(lead: Record<string, unknown>) {
  return ITEMS.filter((it) => esFaltante(lead, it.key));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const { action, token } = body;
    if (!token || typeof token !== 'string' || token.length < 20) return json({ error: 'token requerido' }, 400);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const SELECT = 'id, nombre, apellido, telefono, email, ' + CAMPOS_TEXTO.join(', ') + ', ' + CAMPOS_DOC.join(', ');
    const { data: lead } = await admin
      .from('prestador_leads')
      .select(SELECT)
      .eq('completar_token', token)
      .maybeSingle();

    if (!lead) return json({ error: 'Link inválido o vencido' }, 404);

    if (action === 'get') {
      return json({
        ok: true,
        nombre: lead.nombre || '',
        faltan: faltantes(lead as Record<string, unknown>),
      });
    }

    if (action === 'save') {
      const datos = (body.datos && typeof body.datos === 'object') ? body.datos : {};
      const update: Record<string, string> = {};

      for (const k of CAMPOS_TEXTO) {
        const v = String(datos[k] ?? '').trim();
        if (!v || v.length > 300) continue;
        update[k] = (k === 'dni' || k === 'telefono') ? v.replace(/\D/g, '') : v;
      }
      for (const k of CAMPOS_DOC) {
        const v = String(datos[k] ?? '').trim();
        // Solo paths del bucket (los sube la página con la anon key), nunca URLs externas.
        if (!v || v.length > 300 || v.includes('://') || v.includes('..')) continue;
        update[k] = v;
      }

      if (Object.keys(update).length) {
        const { error } = await admin.from('prestador_leads').update(update).eq('id', lead.id);
        if (error) return json({ error: 'No se pudo guardar' }, 500);
      }

      const nuevo = { ...lead, ...update };
      const faltanAhora = faltantes(nuevo as Record<string, unknown>);

      // Se completó TODO recién ahora → avisar al equipo para que lo apruebe rápido
      const estabaIncompleto = faltantes(lead as Record<string, unknown>).length > 0;
      if (estabaIncompleto && faltanAhora.length === 0) {
        const RESEND = Deno.env.get('RESEND_API_KEY');
        const FROM   = Deno.env.get('FROM_EMAIL') ?? 'BOLT <soporte@bolt.com.ar>';
        if (RESEND) {
          const l = nuevo as Record<string, string>;
          const filas = [
            ['Nombre', `${l.nombre ?? ''} ${l.apellido ?? ''}`],
            ['Oficio', l.profesion ?? '-'],
            ['WhatsApp', l.telefono ?? '-'],
            ['Email', l.email ?? '(no dejó)'],
            ['Ciudad / zona', `${l.ciudad ?? '-'} · ${l.zona ?? '-'}`],
            ['DNI', l.dni ?? '-'],
          ].map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#888;font-size:13px;white-space:nowrap;">${k}</td><td style="padding:6px 0;color:#111;font-size:14px;font-weight:600;">${String(v).replace(/</g, '&lt;')}</td></tr>`).join('');
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM,
              to: ['soporte@bolt.com.ar'],
              subject: `🎉 ${(nuevo as Record<string, string>).nombre ?? 'Un prestador'} completó su registro — listo para aprobar`,
              html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="margin:0 0 4px;color:#111;">⚡ Registro completo</h2>
                <p style="margin:0 0 18px;color:#555;font-size:14px;">Este prestador terminó de cargar todos sus datos y documentos. Entrá al panel para revisarlo y aprobarlo.</p>
                <table cellpadding="0" cellspacing="0" border="0">${filas}</table>
                <p style="margin:22px 0 0;"><a href="https://maxi95bahiablanca-hue.github.io/VOLT/web/prestadores/admin.html" style="background:#FFD600;color:#111;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block;">Abrir panel de prestadores</a></p>
              </div>`,
            }),
          }).catch(() => {});
        }
      }

      return json({
        ok: true,
        nombre: lead.nombre || '',
        faltan: faltanAhora,
      });
    }

    return json({ error: 'action inválida' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

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
const CAMPOS_TEXTO = ['dni', 'fecha_nac', 'profesion', 'zona', 'ciudad', 'experiencia', 'matricula', 'antecedentes', 'monotributo', 'domicilio'];
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

    const SELECT = 'id, nombre, ' + CAMPOS_TEXTO.join(', ') + ', ' + CAMPOS_DOC.join(', ');
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
        update[k] = (k === 'dni') ? v.replace(/\D/g, '') : v;
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
      return json({
        ok: true,
        nombre: lead.nombre || '',
        faltan: faltantes(nuevo as Record<string, unknown>),
      });
    }

    return json({ error: 'action inválida' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

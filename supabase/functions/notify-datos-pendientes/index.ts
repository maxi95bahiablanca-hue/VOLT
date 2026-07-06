import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const LOGO_URL = 'https://lyeqnvldemcltlbujlnc.supabase.co/storage/v1/object/public/assets/logo-bolt-mail.png';

// Checklist de datos del registro. Mismo criterio que completar-registro.
const ITEMS: { key: string; label: string; hint?: string }[] = [
  { key: 'dni',              label: 'Número de DNI' },
  { key: 'fecha_nac',        label: 'Fecha de nacimiento' },
  { key: 'profesion',        label: 'Tu oficio' },
  { key: 'zona',             label: 'Tu zona o barrio' },
  { key: 'dni_frente_url',   label: 'Foto del DNI — FRENTE' },
  { key: 'dni_dorso_url',    label: 'Foto del DNI — DORSO' },
  { key: 'selfie_url',       label: 'Selfie sosteniendo tu DNI' },
  { key: 'antecedentes_url', label: 'Certificado de antecedentes penales', hint: 'Se saca gratis online en 5 minutos' },
  { key: 'monotributo_url',  label: 'Constancia de monotributo', hint: 'Se descarga de monotributo.afip.gob.ar' },
];

function esFaltante(lead: Record<string, unknown>, key: string): boolean {
  const v = String(lead[key] ?? '').trim();
  if (!v) return true;
  if (key === 'profesion' && v.toLowerCase() === 'a completar') return true;
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { token, variante } = await req.json().catch(() => ({}));
    if (!token || typeof token !== 'string' || token.length < 20) return json({ error: 'token requerido' }, 400);
    const esRecordatorio = variante === 'recordatorio';

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND       = Deno.env.get('RESEND_API_KEY');
    const FROM         = Deno.env.get('FROM_EMAIL') ?? 'BOLT <soporte@bolt.com.ar>';

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: lead } = await admin
      .from('prestador_leads')
      .select('nombre, apellido, email, dni, fecha_nac, profesion, zona, ciudad, dni_frente_url, dni_dorso_url, selfie_url, antecedentes_url, monotributo_url')
      .eq('completar_token', token)
      .maybeSingle();

    if (!lead)       return json({ error: 'Registro no encontrado' }, 404);
    if (!lead.email) return json({ ok: false, skipped: 'el prestador no dejó email' });
    if (!RESEND)     return json({ ok: false, skipped: 'falta RESEND_API_KEY' });

    const nombre  = (lead.nombre || '').trim() || 'profesional';
    const faltan  = ITEMS.filter((it) => esFaltante(lead as Record<string, unknown>, it.key));
    const hechos  = ITEMS.filter((it) => !esFaltante(lead as Record<string, unknown>, it.key));
    // ⚠️ Netlify sin créditos (jul-2026): las páginas nuevas se sirven por GitHub Pages.
    //    Cuando se recarguen créditos y se deploye web/ a Netlify, volver a bolt.com.ar/prestadores/completar.html
    const BASE_COMPLETAR = Deno.env.get('COMPLETAR_BASE_URL') ?? 'https://maxi95bahiablanca-hue.github.io/VOLT/web/prestadores/completar.html';
    const urlCompletar = `${BASE_COMPLETAR}?t=${encodeURIComponent(token)}`;

    const basicos = ['Nombre y apellido', 'WhatsApp', 'Email']
      .concat(hechos.map((h) => h.label));

    const filasFaltan = faltan.map((it) => `
      <tr>
        <td style="padding:0 0 10px 0;">
          <a href="${urlCompletar}" target="_blank" style="text-decoration:none;display:block;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#151515;border:1px solid #2b2b2b;border-left:4px solid #FFD600;border-radius:12px;">
              <tr>
                <td style="padding:14px 18px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
                  <span style="display:inline-block;background-color:#FFD600;color:#0A0A0A;font-size:11px;font-weight:900;letter-spacing:1px;border-radius:999px;padding:3px 10px;vertical-align:middle;">TE FALTA</span>
                  <span style="display:inline-block;color:#ffffff;font-size:15px;font-weight:800;vertical-align:middle;padding-left:10px;">${it.label}</span>
                  ${it.hint ? `<div style="color:#8a8a8a;font-size:12px;padding-top:4px;">${it.hint}</div>` : ''}
                </td>
                <td align="right" width="30" style="padding:14px 16px 14px 0;color:#FFD600;font-size:18px;font-weight:900;font-family:'Nunito',Helvetica,Arial,sans-serif;">&#8250;</td>
              </tr>
            </table>
          </a>
        </td>
      </tr>`).join('');

    const badgeTxt = esRecordatorio ? '&#9200;&nbsp;&nbsp;Te falta poco' : '&#9889;&nbsp;&nbsp;Registro iniciado';
    const h1Txt    = esRecordatorio ? `${nombre}, tu lugar en BOLT te espera` : `¡Bienvenido a BOLT, ${nombre}!`;
    const introTxt = esRecordatorio
      ? `Hace unos días iniciamos tu registro como profesional y quedó <strong style="color:#FFD600;">guardado</strong>. Te falta poco: completá estos datos y quedás listo para empezar a recibir trabajos cerca tuyo:`
      : `Ya iniciamos tu registro como profesional junto al equipo de BOLT. Para <strong style="color:#FFD600;">activar tu perfil</strong> y empezar a recibir trabajos cerca tuyo, solo falta que completes esto:`;

    const cuerpoFaltan = `
          <tr>
            <td style="padding:40px 40px 8px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background-color:#FFD600;border-radius:999px;padding:8px 18px;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;color:#0A0A0A;text-transform:uppercase;">
                    ${badgeTxt}
                  </td>
                </tr>
              </table>
              <h1 style="margin:0 0 18px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:28px;line-height:1.25;font-weight:900;color:#FFFFFF;text-align:center;">
                ${h1Txt}
              </h1>
              <p style="margin:0 0 8px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#cfcfcf;text-align:center;">
                ${introTxt}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 4px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${filasFaltan}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 0 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:13px;line-height:1.7;color:#8a8a8a;text-align:center;">
                &#10003; Ya registramos: ${basicos.join(' · ')}
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background-color:#FFD600;">
                    <a href="${urlCompletar}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#0A0A0A;text-decoration:none;border-radius:12px;">
                      Completar mis datos ahora &#9889;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 36px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#9a9a9a;text-align:center;">
                Lo podés hacer desde el celular en 5 minutos, sacando las fotos en el momento.<br>
                Este link es personal tuyo: guardá este mail para completarlo cuando quieras.
              </p>
            </td>
          </tr>`;

    // Presentación de la app: qué es BOLT y qué gana el trabajador
    const seccionApp = `
          <tr>
            <td style="padding:8px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:1px;line-height:1px;font-size:0;background-color:#1c1c1c;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 6px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
              <h2 style="margin:0 0 6px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:20px;font-weight:900;color:#FFFFFF;text-align:center;">
                ¿Qué es <span style="color:#FFD600;">BOLT</span>?
              </h2>
              <p style="margin:0 0 18px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#9a9a9a;text-align:center;">
                La app que te conecta con clientes de tu zona que necesitan tu oficio.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#151515;border:1px solid #262626;border-radius:14px;">
                <tr>
                  <td style="padding:22px 24px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="top" width="38" style="font-size:20px;line-height:1.4;">📲</td>
                        <td style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#d6d6d6;">
                          <strong style="color:#ffffff;">Te llegan trabajos cerca tuyo.</strong> Los clientes piden por la app y vos decidís cuáles tomar y cuándo estar disponible.
                        </td>
                      </tr>
                      <tr><td colspan="2" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
                      <tr>
                        <td valign="top" width="38" style="font-size:20px;line-height:1.4;">💵</td>
                        <td style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#d6d6d6;">
                          <strong style="color:#ffffff;">Cobrás directo del cliente.</strong> Efectivo o transferencia, como arreglen. Tu precio lo ponés vos y BOLT no se mete en tu plata.
                        </td>
                      </tr>
                      <tr><td colspan="2" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
                      <tr>
                        <td valign="top" width="38" style="font-size:20px;line-height:1.4;">🎁</td>
                        <td style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#d6d6d6;">
                          <strong style="color:#ffffff;">Gratis para los primeros.</strong> Sin comisión, sin cuotas, sin costo de alta. Los primeros profesionales de cada zona entran sin pagar nada.
                        </td>
                      </tr>
                      <tr><td colspan="2" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
                      <tr>
                        <td valign="top" width="38" style="font-size:20px;line-height:1.4;">⭐</td>
                        <td style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#d6d6d6;">
                          <strong style="color:#ffffff;">Tu reputación trae más clientes.</strong> Calificaciones y trabajos completados: los vecinos te eligen porque saben quién sos. <em style="color:#FFD600;font-style:normal;">Sabés quién toca tu puerta.</em>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#8a8a8a;text-align:center;">
                Apenas se complete el cupo de tu ciudad te avisamos por mail y WhatsApp para activar la app. 🚀<br>
                Más info en <a href="https://bolt.com.ar" target="_blank" style="color:#FFD600;text-decoration:none;font-weight:800;">bolt.com.ar</a>
              </p>
            </td>
          </tr>`;

    const cuerpoCompleto = `
          <tr>
            <td style="padding:40px 40px 8px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background-color:#FFD600;border-radius:999px;padding:8px 18px;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;color:#0A0A0A;text-transform:uppercase;">
                    &#10003;&nbsp;&nbsp;Registro completo
                  </td>
                </tr>
              </table>
              <h1 style="margin:0 0 18px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:28px;line-height:1.25;font-weight:900;color:#FFFFFF;text-align:center;">
                ¡Bienvenido a BOLT, ${nombre}!
              </h1>
              <p style="margin:0 0 24px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#cfcfcf;text-align:center;">
                Tu registro como profesional está <strong style="color:#FFD600;">completo</strong>. Nuestro equipo verifica tu documentación en 24 a 48 hs hábiles y te avisamos por mail y WhatsApp para activar tu perfil.
              </p>
            </td>
          </tr>`;

    const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Completá tu registro en BOLT</title>
<!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#050505;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#050505;opacity:0;">
    ${faltan.length ? `Te falta${faltan.length > 1 ? 'n' : ''} ${faltan.length} dato${faltan.length > 1 ? 's' : ''} para activar tu perfil de profesional en BOLT.` : 'Tu registro en BOLT está completo.'}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#050505;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#0E0E0E;border-radius:20px;overflow:hidden;border:1px solid #1c1c1c;">

          <tr>
            <td align="center" style="background-color:#000000;padding:40px 32px 28px 32px;">
              <img src="${LOGO_URL}" width="132" height="131" alt="BOLT" style="display:block;border:0;width:132px;height:131px;">
              <div style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#8a8a8a;text-transform:uppercase;margin-top:8px;">Sabés quién toca tu puerta</div>
            </td>
          </tr>

          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background-color:#FFD600;background-image:linear-gradient(90deg,#FFD600 0%,#FF8A00 55%,#FF3D00 100%);">&nbsp;</td>
          </tr>

          ${faltan.length ? cuerpoFaltan : cuerpoCompleto}

          ${esRecordatorio ? '' : seccionApp}

          <tr><td style="height:30px;line-height:30px;font-size:0;">&nbsp;</td></tr>

          <tr>
            <td style="background-color:#000000;padding:26px 40px;border-top:1px solid #1c1c1c;">
              <p style="margin:0 0 4px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:15px;font-weight:900;letter-spacing:1px;color:#ffffff;text-align:center;">BO<span style="color:#FFD600;">LT</span></p>
              <p style="margin:0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#666666;text-align:center;">
                Profesionales a domicilio · Bahía Blanca<br>
                soporte@bolt.com.ar
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

    const subject = faltan.length
      ? (esRecordatorio
          ? `⏰ ${nombre}, te falta poco para activar tu perfil en BOLT`
          : `⚡ ${nombre}, completá tu registro en BOLT — falta${faltan.length > 1 ? 'n' : ''} ${faltan.length} dato${faltan.length > 1 ? 's' : ''}`)
      : 'Tu registro en BOLT está completo ⚡';

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [lead.email], subject, html }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ error: 'Resend falló', detail }, 502);
    }

    return json({ ok: true, to: lead.email, faltan: faltan.map((f) => f.key) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

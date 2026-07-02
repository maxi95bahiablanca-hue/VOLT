import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const LOGO_URL = 'https://lyeqnvldemcltlbujlnc.supabase.co/storage/v1/object/public/assets/logo-bolt-mail.png';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { leadId } = await req.json().catch(() => ({}));
    if (!leadId) return json({ error: 'leadId requerido' }, 400);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON         = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND       = Deno.env.get('RESEND_API_KEY');
    // Sale desde soporte@bolt.com.ar (dominio verificado en Resend). El nombre visible es BOLT.
    const FROM         = Deno.env.get('FROM_EMAIL') ?? 'BOLT <soporte@bolt.com.ar>';

    // ── 1. Solo un admin autenticado puede disparar esto (tabla admins) ────
    const auth = req.headers.get('Authorization') ?? '';
    const anon = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await anon.auth.getUser();
    if (!user?.email) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: adminRow } = await admin
      .from('admins').select('email').eq('email', user.email).maybeSingle();
    if (!adminRow) return json({ error: 'No autorizado' }, 401);

    // ── 2. Traer el lead con service role (no confiamos en datos del cliente) ─
    const { data: lead } = await admin
      .from('prestador_leads')
      .select('nombre, apellido, email, profesion')
      .eq('id', leadId)
      .maybeSingle();

    if (!lead)        return json({ error: 'Lead no encontrado' }, 404);
    if (!lead.email)  return json({ ok: false, skipped: 'el prestador no dejó email' });
    if (!RESEND)      return json({ ok: false, skipped: 'falta RESEND_API_KEY' });

    const nombre = (lead.nombre || '').trim() || 'profesional';

    // ── 3. Mail de bienvenida — identidad BOLT (negro / amarillo / blanco + rayo) ─
    const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Tu registro en BOLT fue aceptado</title>
<!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#050505;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#050505;opacity:0;">
    Ya sos parte del primer grupo de profesionales de BOLT en tu zona.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
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

          <tr>
            <td style="padding:40px 40px 8px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background-color:#FFD600;border-radius:999px;padding:8px 18px;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;color:#0A0A0A;text-transform:uppercase;">
                    &#10003;&nbsp;&nbsp;Registro aceptado
                  </td>
                </tr>
              </table>

              <h1 style="margin:0 0 18px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:28px;line-height:1.25;font-weight:900;color:#FFFFFF;text-align:center;">
                Ya sos parte de BOLT
              </h1>

              <p style="margin:0 0 16px 0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#cfcfcf;text-align:center;">
                Hola <strong style="color:#ffffff;">${nombre}</strong>, te escribimos desde el equipo de BOLT. Tu perfil como profesional fue <strong style="color:#FFD600;">aceptado</strong> y entrás dentro del primer grupo de tu zona.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#151515;border:1px solid #262626;border-radius:14px;">
                <tr>
                  <td style="padding:22px 24px;font-family:'Nunito',Helvetica,Arial,sans-serif;">

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="top" width="34" style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:18px;font-weight:900;color:#FFD600;line-height:1.5;">01</td>
                        <td style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#d6d6d6;">
                          <strong style="color:#ffffff;">Lanzamiento en 30 a 45 días.</strong> Te avisamos por mail y WhatsApp apenas la app esté disponible.
                        </td>
                      </tr>
                      <tr><td colspan="2" style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
                      <tr>
                        <td valign="top" width="34" style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:18px;font-weight:900;color:#FFD600;line-height:1.5;">02</td>
                        <td style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#d6d6d6;">
                          <strong style="color:#ffffff;">Acceso gratuito al inicio.</strong> Vamos a lanzar una campaña de publicidad para que empieces a recibir trabajos.
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:28px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background-color:#FFD600;">
                    <a href="https://bolt.com.ar" target="_blank" style="display:inline-block;padding:15px 38px;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#0A0A0A;text-decoration:none;border-radius:12px;">
                      Conocé más en bolt.com.ar
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 36px 40px;font-family:'Nunito',Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#9a9a9a;text-align:center;">
                Cualquier consulta, estamos para ayudarte.<br>Gracias por sumarte.
              </p>
            </td>
          </tr>

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

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    FROM,
        to:      [lead.email],
        subject: 'Tu registro en BOLT fue aceptado',
        html,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ error: 'Resend falló', detail }, 502);
    }

    return json({ ok: true, to: lead.email });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

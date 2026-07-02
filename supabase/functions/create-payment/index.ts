import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { jobId, visitOnly = false } = body;

    if (!jobId || typeof jobId !== 'string') return json({ error: 'jobId requerido' }, 400);

    const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN');
    const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY        = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!MP_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN no configurado');

    // ── 1. Autenticar al usuario que llama ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: 'No autorizado' }, 401);

    // ── 2. Leer el trabajo con privilegio de admin (sin RLS del user) ───────
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: job, error: jobErr } = await adminClient
      .from('jobs')
      .select('id, work_amount, visit_amount, materials_cost, status, client_id, visit_paid')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) return json({ error: 'Trabajo no encontrado' }, 404);

    // ── 3. Verificar que el usuario autenticado es el cliente del trabajo ───
    if (job.client_id !== user.id) return json({ error: 'No autorizado' }, 403);

    // ── 4. Validar el estado según el tipo de cobro ─────────────────────────
    // visitOnly  = cobro de la VISITA por anticipado (recién se eligió al
    //              profesional). El dinero queda retenido por la plataforma.
    // !visitOnly = cobro FINAL (mano de obra + materiales), al terminar.
    if (visitOnly) {
      if (job.visit_paid) return json({ error: 'La visita ya fue pagada' }, 400);
      if (!['accepted', 'arrived', 'in_progress'].includes(job.status)) {
        return json({ error: 'El trabajo no está en un estado válido para cobrar la visita' }, 400);
      }
    } else {
      if (job.status !== 'awaiting_payment') {
        return json({ error: 'El trabajo no está listo para pagar' }, 400);
      }
    }

    // ── 5. Calcular monto DESDE LA DB — NUNCA confiar en el cliente ─────────
    // materials_cost no lleva comisión BOLT: el trabajador adelantó el dinero.
    // Si la visita ya está pagada, el cobro final NO la vuelve a incluir.
    const visitAmount = visitOnly
      ? (job.visit_amount ?? 30000)
      : (job.visit_paid ? 0 : (job.visit_amount ?? 30000));
    const matsAmount  = visitOnly ? 0 : (job.materials_cost ?? 0);
    const workAmount  = visitOnly ? 0 : (job.work_amount    ?? 0);
    const totalAmount = visitAmount + matsAmount + workAmount;
    if (totalAmount <= 0) return json({ error: 'Monto inválido' }, 400);

    // ── 6. Crear preferencia en Mercado Pago ────────────────────────────────
    // Ítems separados para que el extracto del cliente sea claro
    const preference = {
      items: [
        ...(visitAmount > 0 ? [{
          title:       'BOLT — Visita / diagnóstico',
          quantity:    1,
          unit_price:  visitAmount,
          currency_id: 'ARS',
        }] : []),
        ...(matsAmount > 0 ? [{
          title:       'BOLT — Materiales (sin comisión)',
          quantity:    1,
          unit_price:  matsAmount,
          currency_id: 'ARS',
        }] : []),
        ...(workAmount > 0 ? [{
          title:       'BOLT — Mano de obra',
          quantity:    1,
          unit_price:  workAmount,
          currency_id: 'ARS',
        }] : []),
      ],
      payer: { email: user.email ?? 'cliente@bolt.com.ar' },
      // back_urls con deep link a la app (scheme `bolt`). NO usamos auto_return
      // porque Mercado Pago exige https para auto_return; sin él, MP acepta el
      // deep link y el resultado se confirma además por el webhook (mp-webhook).
      back_urls: {
        success: `bolt://payment-success?jobId=${jobId}`,
        failure: `bolt://payment-failure?jobId=${jobId}`,
        pending: `bolt://payment-pending?jobId=${jobId}`,
      },
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      external_reference: `${jobId}${visitOnly ? ':visit' : ':final'}`,
      statement_descriptor: 'BOLT',
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${jobId}-${visitOnly ? 'visit' : 'final'}`,
      },
      body: JSON.stringify(preference),
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error('MP API error:', errText);
      throw new Error('Error al crear la preferencia de pago');
    }

    const mpData = await mpRes.json();

    return json({
      checkoutUrl:        mpData.init_point,
      sandboxCheckoutUrl: mpData.sandbox_init_point,
      preferenceId:       mpData.id,
    });

  } catch (err) {
    // No exponer detalles de errores internos al cliente
    console.error('create-payment error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Error al procesar el pago. Intentá de nuevo.' }, 500);
  }
});

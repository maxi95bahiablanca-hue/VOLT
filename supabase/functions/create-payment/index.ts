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
    const { jobId } = body;

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
      .select('id, work_amount, visit_amount, status, client_id')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) return json({ error: 'Trabajo no encontrado' }, 404);

    // ── 3. Verificar que el usuario autenticado es el cliente del trabajo ───
    if (job.client_id !== user.id) return json({ error: 'No autorizado' }, 403);

    // ── 4. El trabajo debe estar en awaiting_payment ─────────────────────────
    if (job.status !== 'awaiting_payment') {
      return json({ error: 'El trabajo no está listo para pagar' }, 400);
    }

    // ── 5. Calcular monto DESDE LA DB — NUNCA confiar en el cliente ─────────
    const visitAmount = job.visit_amount ?? 30000;
    const workAmount  = job.work_amount  ?? 0;
    const totalAmount = visitAmount + workAmount;
    if (totalAmount <= 0) return json({ error: 'Monto inválido' }, 400);

    // ── 6. Crear preferencia en Mercado Pago ────────────────────────────────
    const preference = {
      items: [{
        title: 'VOLT — Servicio profesional a domicilio',
        quantity: 1,
        unit_price: totalAmount,
        currency_id: 'ARS',
      }],
      payer: { email: user.email ?? 'cliente@volt.app' },
      back_urls: {
        success: `volt://payment-success?jobId=${jobId}`,
        failure: `volt://payment-failure?jobId=${jobId}`,
        pending: `volt://payment-pending?jobId=${jobId}`,
      },
      auto_return: 'approved',
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      external_reference: jobId,
      statement_descriptor: 'VOLT',
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': jobId,
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

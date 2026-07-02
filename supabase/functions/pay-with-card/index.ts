// GOVOLT — Cobro de un trabajo con una tarjeta guardada (pago en 1 toque).
// Recibe un token fresco generado en la app (desde la tarjeta guardada + CVV).
// El monto se calcula SIEMPRE desde la base (nunca se confía en el cliente).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { jobId, token, paymentMethodId, installments } = await req.json().catch(() => ({}));
    if (!jobId || !token) return json({ error: 'jobId y token requeridos' }, 400);

    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN');
    const URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!MP_TOKEN) throw new Error('MP_ACCESS_TOKEN no configurado');

    const anon = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user }, error: authErr } = await anon.auth.getUser();
    if (authErr || !user) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(URL, SERVICE);
    const { data: job, error: jErr } = await admin
      .from('jobs')
      .select('id, work_amount, visit_amount, materials_cost, status, client_id, visit_paid, commission_pct')
      .eq('id', jobId).single();
    if (jErr || !job) return json({ error: 'Trabajo no encontrado' }, 404);
    if (job.client_id !== user.id) return json({ error: 'No autorizado' }, 403);
    if (job.status !== 'awaiting_payment') return json({ error: 'El trabajo no está listo para pagar' }, 400);

    // Si la visita ya se cobró por anticipado, NO se vuelve a cobrar acá
    const visitAmount = job.visit_paid ? 0 : (job.visit_amount ?? 30000);
    const total = visitAmount + (job.materials_cost ?? 0) + (job.work_amount ?? 0);
    if (total <= 0) return json({ error: 'Monto inválido' }, 400);

    const payRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        'Content-Type': 'application/json',
        // El token de tarjeta es único por intento: mismo token = mismo intento
        // (un reintento de red no duplica el cobro; un intento nuevo genera token nuevo)
        'X-Idempotency-Key': `${jobId}-${String(token).slice(0, 24)}`,
      },
      body: JSON.stringify({
        transaction_amount: total,
        token,
        payment_method_id: paymentMethodId,
        installments: installments || 1,
        description: 'BOLT — Trabajo',
        statement_descriptor: 'BOLT',
        external_reference: `${jobId}:final`,
        notification_url: `${URL}/functions/v1/mp-webhook`,
        payer: { email: user.email ?? `cliente_${user.id}@bolt.com.ar` },
      }),
    });
    const pay = await payRes.json();
    if (!payRes.ok) {
      console.error('MP payment error:', JSON.stringify(pay));
      return json({ error: pay.message || 'No se pudo procesar el pago' }, 400);
    }

    // Si quedó aprobado al instante, marcamos pagado y registramos el pago acá
    // mismo (si no, el webhook encuentra el job ya 'completed' y no lo registra).
    // El upsert por mp_payment_id lo hace idempotente frente al webhook.
    if (pay.status === 'approved') {
      await admin.from('jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('status', 'awaiting_payment');

      const workAmt = job.work_amount ?? 0;
      const matsAmt = job.materials_cost ?? 0;
      const commPct = job.commission_pct ?? 20;
      const commAmt = Math.round(workAmt * commPct / 100);
      await admin.from('payments').upsert({
        job_id:         jobId,
        type:           'work',
        status:         'approved',
        gross_amount:   total,
        commission_pct: commPct,
        commission_amt: visitAmount + commAmt,
        worker_amt:     workAmt - commAmt + matsAmt,
        mp_payment_id:  String(pay.id),
        mp_status:      pay.status,
        paid_at:        new Date().toISOString(),
      }, { onConflict: 'mp_payment_id', ignoreDuplicates: true });
    }

    return json({ status: pay.status, detail: pay.status_detail });
  } catch (err) {
    console.error('pay-with-card error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Error al procesar el pago' }, 500);
  }
});

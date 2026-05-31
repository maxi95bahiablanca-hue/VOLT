import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Valida la firma HMAC de Mercado Pago (defensa extra; el dinero ya está
// protegido porque re-consultamos el pago a la API de MP).
// Solo se exige si MP_WEBHOOK_SECRET está configurado.
async function validarFirma(req: Request, dataId: string): Promise<boolean> {
  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!secret) return true; // sin secret → no se valida (se confía en el re-fetch)
  try {
    const sig = req.headers.get('x-signature') ?? '';
    const reqId = req.headers.get('x-request-id') ?? '';
    const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=').map((s) => s.trim())));
    const ts = parts['ts']; const v1 = parts['v1'];
    if (!ts || !v1) return false;
    const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === v1;
  } catch { return false; }
}

serve(async (req) => {
  try {
    const body = await req.json();

    // MP envía topic=payment cuando hay un evento de pago
    const topic = new URL(req.url).searchParams.get('topic') ?? body.type;
    if (topic !== 'payment') return new Response('ok');

    const paymentId = body.data?.id ?? body.id;
    if (!paymentId) return new Response('ok');

    // Validar firma (si hay secret configurado). Si falla, rechazar.
    if (!(await validarFirma(req, String(paymentId)))) {
      return new Response('invalid signature', { status: 401 });
    }

    const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;

    // ── 1. Verificar el pago directo con MP — nunca confiar en el body del webhook
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) return new Response('error fetching payment', { status: 400 });

    const payment = await mpRes.json();
    const { status, external_reference: jobId } = payment;
    if (!jobId) return new Response('ok');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (status === 'approved') {
      // ── 2. Leer el trabajo actual para verificar estado e importes ──────────
      const { data: job } = await supabase
        .from('jobs')
        .select('status, work_amount, visit_amount, materials_cost, commission_pct')
        .eq('id', jobId)
        .single();

      if (!job) return new Response('job not found');

      // ── 3. Idempotencia — si ya fue procesado, ignorar ──────────────────────
      if (job.status === 'completed') return new Response('ok');
      if (job.status !== 'awaiting_payment') return new Response('ok');

      // ── 4. Marcar completado con condición de estado (evita race conditions) ─
      const { error: updateErr } = await supabase
        .from('jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('status', 'awaiting_payment'); // solo si nadie más lo procesó primero

      if (updateErr) {
        console.error('Error actualizando job:', updateErr.message);
        return new Response('update error', { status: 500 });
      }

      // ── 5. Registrar pago (upsert idempotente por mp_payment_id) ────────────
      const workAmt  = job.work_amount    ?? 0;
      const visitAmt = job.visit_amount   ?? 30000;
      const matsAmt  = job.materials_cost ?? 0;
      const commPct  = job.commission_pct ?? 20;

      // Contabilidad:
      // - Cliente paga: visitAmt + matsAmt + workAmt
      // - VOLT retiene: visitAmt + commAmt (% solo de la mano de obra)
      // - Trabajador recibe: workAmt - commAmt + matsAmt (recupera el costo de materiales)
      const commAmt   = Math.round(workAmt * commPct / 100);
      const grossAmt  = visitAmt + matsAmt + workAmt;
      const voltTotal = visitAmt + commAmt;
      const workerAmt = workAmt - commAmt + matsAmt;

      await supabase.from('payments').upsert({
        job_id:         jobId,
        type:           'work',
        status:         'approved',
        gross_amount:   grossAmt,
        commission_pct: commPct,
        commission_amt: voltTotal,
        worker_amt:     workerAmt,
        mp_payment_id:  String(paymentId),
        mp_status:      status,
        paid_at:        new Date().toISOString(),
      }, { onConflict: 'mp_payment_id', ignoreDuplicates: true });

    } else if (status === 'rejected' || status === 'cancelled') {
      // Dejar el job en awaiting_payment para que el cliente reintente
      await supabase
        .from('jobs')
        .update({ status: 'awaiting_payment' })
        .eq('id', jobId)
        .eq('status', 'awaiting_payment');
    }

    return new Response('ok');
  } catch (err) {
    console.error('mp-webhook error:', err instanceof Error ? err.message : String(err));
    return new Response('error', { status: 500 });
  }
});

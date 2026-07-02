// GOVOLT — Tarjetas guardadas del cliente (Mercado Pago Customers & Cards).
// Una sola función con acciones: 'list' | 'save' | 'delete'.
// No guardamos números de tarjeta: viven en MP. Acá solo el customer_id.
// Env: MP_ACCESS_TOKEN (ya configurado para pagos).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const MP = 'https://api.mercadopago.com';

async function getOrCreateCustomer(admin: any, userId: string, email: string, mpToken: string, createIfMissing = true) {
  const { data: prof } = await admin.from('payment_profiles').select('mp_customer_id').eq('user_id', userId).maybeSingle();
  if (prof?.mp_customer_id) return prof.mp_customer_id;
  if (!createIfMissing) return null;

  // Buscar por email (MP no permite emails duplicados de customer)
  let cid: string | null = null;
  const sRes = await fetch(`${MP}/v1/customers/search?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  });
  if (sRes.ok) { const s = await sRes.json(); cid = s.results?.[0]?.id ?? null; }

  if (!cid) {
    const cRes = await fetch(`${MP}/v1/customers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const c = await cRes.json();
    if (!cRes.ok) throw new Error(c.message || 'No se pudo crear el customer de MP');
    cid = c.id;
  }
  await admin.from('payment_profiles').upsert({ user_id: userId, mp_customer_id: cid });
  return cid;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { action, cardToken, cardId } = await req.json().catch(() => ({}));
    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN');
    const URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!MP_TOKEN) throw new Error('MP_ACCESS_TOKEN no configurado');

    const anon = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user }, error: authErr } = await anon.auth.getUser();
    if (authErr || !user) return json({ error: 'No autorizado' }, 401);
    const admin = createClient(URL, SERVICE);
    const email = user.email ?? `cliente_${user.id}@bolt.com.ar`;

    // ── LISTAR ──────────────────────────────────────────────────────────────
    if (action === 'list') {
      const cid = await getOrCreateCustomer(admin, user.id, email, MP_TOKEN, false);
      if (!cid) return json({ cards: [] });
      const res = await fetch(`${MP}/v1/customers/${cid}/cards`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      const data = await res.json();
      const cards = (Array.isArray(data) ? data : []).map((c: any) => ({
        id: c.id,
        last_four: c.last_four_digits,
        brand: c.payment_method?.name || c.payment_method?.id || 'tarjeta',
        payment_method_id: c.payment_method?.id || '',
        exp: `${String(c.expiration_month).padStart(2, '0')}/${String(c.expiration_year).slice(-2)}`,
      }));
      return json({ cards });
    }

    // ── GUARDAR ─────────────────────────────────────────────────────────────
    if (action === 'save') {
      if (!cardToken) return json({ error: 'cardToken requerido' }, 400);
      const cid = await getOrCreateCustomer(admin, user.id, email, MP_TOKEN, true);
      const res = await fetch(`${MP}/v1/customers/${cid}/cards`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cardToken }),
      });
      const c = await res.json();
      if (!res.ok) return json({ error: c.message || 'No se pudo guardar la tarjeta' }, 400);
      return json({ ok: true, card: { id: c.id, last_four: c.last_four_digits, brand: c.payment_method?.name } });
    }

    // ── BORRAR ──────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!cardId) return json({ error: 'cardId requerido' }, 400);
      const cid = await getOrCreateCustomer(admin, user.id, email, MP_TOKEN, false);
      if (!cid) return json({ error: 'Sin tarjetas' }, 400);
      const res = await fetch(`${MP}/v1/customers/${cid}/cards/${cardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      if (!res.ok) return json({ error: 'No se pudo borrar la tarjeta' }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Acción inválida' }, 400);
  } catch (err) {
    console.error('cards error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Error procesando tarjetas' }, 500);
  }
});

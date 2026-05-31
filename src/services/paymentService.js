import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';

const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;
const TIMEOUT_MS   = 15000;

const fetchWithTimeout = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Verificá tu conexión e intentá de nuevo.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

const paymentService = {
  createPreference: async ({ jobId, visitOnly = false }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      // Intentar refrescar la sesión antes de fallar
      const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null }));
      if (!refreshed?.session?.access_token) throw new Error('Sesión expirada. Cerrá y volvé a abrir la app.');
    }
    const { data: { session: currentSession } } = await supabase.auth.getSession();

    const res = await fetchWithTimeout(`${FUNCTION_URL}/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentSession.access_token}`,
      },
      body: JSON.stringify({ jobId, visitOnly }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error || `Error del servidor (${res.status}). Intentá de nuevo.`;
      throw new Error(msg);
    }
    return res.json();
  },

  openCheckout: async (url) => {
    const result = await WebBrowser.openAuthSessionAsync(url, 'volt://');
    if (result.type === 'success') {
      const returnUrl = result.url ?? '';
      if (returnUrl.includes('payment-success')) return 'success';
      if (returnUrl.includes('payment-failure'))  return 'failure';
      if (returnUrl.includes('payment-pending'))  return 'pending';
    }
    return 'dismissed';
  },
};

export default paymentService;

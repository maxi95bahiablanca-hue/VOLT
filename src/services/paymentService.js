import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';

const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;

const paymentService = {
  createPreference: async ({ jobId }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sesión expirada');
    const res = await fetch(`${FUNCTION_URL}/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ jobId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al crear el pago');
    }
    return res.json(); // { checkoutUrl, sandboxCheckoutUrl, preferenceId }
  },

  // Abre el checkout de MP en el navegador del sistema.
  // Retorna 'success' | 'cancelled' | 'dismissed'
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

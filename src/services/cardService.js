import { supabase } from '../supabase';

// Llama a las Edge Functions de tarjetas con el token del usuario logueado
async function invoke(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

const cardService = {
  list:   ()                                   => invoke('cards', { action: 'list' }).then(d => d.cards || []),
  save:   (cardToken)                          => invoke('cards', { action: 'save', cardToken }),
  remove: (cardId)                             => invoke('cards', { action: 'delete', cardId }),
  payJob: (jobId, token, paymentMethodId, installments = 1) =>
            invoke('pay-with-card', { jobId, token, paymentMethodId, installments }),
};

export default cardService;

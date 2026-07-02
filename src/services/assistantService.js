import { supabase } from '../supabase';

// Llama a la edge function `analyze-problem` (Gemini). El cliente supabase ya
// manda el token del usuario logueado automáticamente.
//
// Devuelve: { ok, reply, ready, oficio, profession_id, tipo, urgencia, resumen, faltan }
// Si algo falla, lanza error → la pantalla muestra el fallback al formulario clásico.
const assistantService = {
  async analyze({ message, imageBase64, imageMime, audioBase64, audioMime, history } = {}) {
    const { data, error } = await supabase.functions.invoke('analyze-problem', {
      body: { message, imageBase64, imageMime, audioBase64, audioMime, history },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

export default assistantService;

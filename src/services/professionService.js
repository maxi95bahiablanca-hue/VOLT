import { supabase } from '../supabase';

const professionService = {
  getProfessions: async () => {
    const { data, error } = await supabase
      .from('professions')
      .select('id, name')
      .order('id');
    if (error) throw error;
    return data;
  },

  // Los oficios que ese profesional eligió (N:N en professional_professions).
  // Devuelve el mismo formato que getProfessions —{ id, name }— para que quien
  // los use pueda caer al catálogo completo sin cambiar nada.
  getForProfessional: async (professionalId) => {
    const { data, error } = await supabase
      .from('professional_professions')
      .select('profession_id, professions(name)')
      .eq('professional_id', professionalId);
    if (error) throw error;
    return (data ?? [])
      .map(r => ({ id: r.profession_id, name: r.professions?.name }))
      .filter(p => p.id && p.name);
  },
};

export default professionService;

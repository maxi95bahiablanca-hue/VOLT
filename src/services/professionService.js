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
};

export default professionService;

import { supabase } from '../supabase';

const dataService = {
  checkConnection: async () => {
    const { error } = await supabase.auth.getSession();
    console.log('Supabase connection check:', error);
    if (error) throw new Error('No se pudo conectar a Supabase');
    return { message: 'Supabase conectado' };
  },
};

export default dataService;

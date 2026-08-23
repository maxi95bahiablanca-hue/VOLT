import { supabase } from '../supabase';

const favoriteService = {
  getFavorites: async (clientId) => {
    const { data, error } = await supabase
      .from('favorite_professionals')
      .select(`
        created_at,
        professionals(
          id, user_id, first_name, last_name, avg_rating, completed_jobs,
          avatar_url, min_price, available, on_time_completions,
          avg_arrival_minutes, complaints_count, recommend_pct
        )
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const profs = (data ?? []).map(row => row.professionals).filter(Boolean);

    // Enriquecer con último trabajo y calificación del cliente (consultas en paralelo)
    const enriched = await Promise.all(profs.map(async (prof) => {
      const [{ data: lastJob }, { data: review }] = await Promise.all([
        supabase
          .from('jobs')
          .select('created_at, profession_id, professions(id, name)')
          .eq('client_id', clientId)
          .eq('professional_id', prof.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('reviews')
          .select('rating')
          .eq('client_id', clientId)
          .eq('professional_id', prof.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        ...prof,
        lastJob:  lastJob  || null,
        myRating: review?.rating ?? null,
      };
    }));

    return enriched;
  },

  isFavorite: async (clientId, professionalId) => {
    const { data } = await supabase
      .from('favorite_professionals')
      .select('id')
      .eq('client_id', clientId)
      .eq('professional_id', professionalId)
      .maybeSingle();
    return !!data;
  },

  toggle: async (clientId, professionalId) => {
    const existing = await favoriteService.isFavorite(clientId, professionalId);
    if (existing) {
      await supabase
        .from('favorite_professionals')
        .delete()
        .eq('client_id', clientId)
        .eq('professional_id', professionalId);
      return false;
    } else {
      await supabase
        .from('favorite_professionals')
        .insert({ client_id: clientId, professional_id: professionalId });
      return true;
    }
  },

  getLastJobWith: async (clientId, professionalId) => {
    const { data } = await supabase
      .from('jobs')
      .select('id, created_at, professions(name), status')
      .eq('client_id', clientId)
      .eq('professional_id', professionalId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  },
};

export default favoriteService;

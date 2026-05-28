import { supabase } from '../supabase';

const professionalService = {
  getByUserId: async (userId) => {
    const { data, error } = await supabase
      .from('professionals')
      .select('*, professional_professions(profession_id, min_price)')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  save: async (userId, form) => {
    const { data: professional, error } = await supabase
      .from('professionals')
      .upsert(
        {
          user_id:                   userId,
          first_name:                form.firstName,
          last_name:                 form.lastName,
          phone:                     form.phone,
          cuit:                      form.cuit,
          cbu:                       form.cbu,
          criminal_record_confirmed: form.criminalRecord,
          avatar_url:                form.avatarUrl   ?? undefined,
          selfie_url:                form.selfieUrl   ?? undefined,
          dni_front_url:             form.dniFrontUrl ?? undefined,
          dni_back_url:              form.dniBackUrl  ?? undefined,
          verification_status:       form.verificationStatus ?? 'pending',
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();
    if (error) throw error;

    await supabase
      .from('professional_professions')
      .delete()
      .eq('professional_id', professional.id);

    const rows = Object.entries(form.selections)
      .filter(([, s]) => s.price && parseInt(s.price, 10) >= 30000)
      .map(([professionId, s]) => ({
        professional_id: professional.id,
        profession_id: parseInt(professionId, 10),
        min_price: parseInt(s.price, 10),
      }));

    if (rows.length > 0) {
      const { error: selError } = await supabase
        .from('professional_professions')
        .insert(rows);
      if (selError) throw selError;
    }

    return professional;
  },

  setAvailability: async (userId, available) => {
    const { error } = await supabase
      .from('professionals')
      .update({ available })
      .eq('user_id', userId);
    if (error) throw error;
  },

  setAvailableAt: async (professionalId, hoursFromNow) => {
    const availAt = hoursFromNow > 0
      ? new Date(Date.now() + hoursFromNow * 3600000).toISOString()
      : null;
    const { error } = await supabase
      .from('professionals')
      .update({ available: hoursFromNow === 0, available_at: availAt })
      .eq('id', professionalId);
    if (error) throw error;
  },

  updateLocation: async (userId, lat, lng) => {
    const { error } = await supabase
      .from('professionals')
      .update({ location: `SRID=4326;POINT(${lng} ${lat})` })
      .eq('user_id', userId);
    if (error) throw error;
  },

  getNearbyWorkers: async (professionId, lat, lng, limit = 20) => {
    const { data, error } = await supabase.rpc('nearby_workers', {
      p_profession_id: professionId,
      p_lat: lat,
      p_lng: lng,
      p_limit: limit,
    });
    if (error) throw error;
    return data ?? [];
  },
};

export default professionalService;

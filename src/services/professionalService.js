import { supabase } from '../supabase';

const professionalService = {
  // ¿Esta persona ya estaba anotada? Se la busca por mail y por teléfono.
  // El teléfono importa porque muchos se anotaron con un correo y después
  // entran con otro Google —Néstor tiene Hotmail, Ricardo Live— y quedaban
  // como usuarios nuevos, teniendo que hacer todo el registro de nuevo.
  // Devuelve el texto de la función: 'ACTIVADO: ...' o 'no es prestador cargado'.
  activarSiYaEstabaAnotado: async (userId, email, telefono) => {
    const { data, error } = await supabase.rpc('activar_prestador', {
      p_user_id:  userId,
      p_email:    email || null,
      p_telefono: telefono || null,
    });
    if (error) return null;                       // nunca frena el registro normal
    return typeof data === 'string' ? data : null;
  },

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
          // cuit/cbu NO van más en professionals (datos sensibles) → professional_payout
          criminal_record_confirmed: form.criminalRecord,
          avatar_url:                form.avatarUrl         ?? undefined,
          selfie_url:                form.selfieUrl         ?? undefined,
          dni_front_url:             form.dniFrontUrl       ?? undefined,
          dni_back_url:              form.dniBackUrl        ?? undefined,
          antecedentes_url:          form.antecedentesUrl   ?? undefined,
          estudios_url:              form.estudiosUrl       ?? undefined,
          payment_method:            form.paymentMethod     ?? undefined,
          verification_status:       form.verificationStatus ?? 'pending',
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();
    if (error) throw error;

    // Datos bancarios → tabla protegida (RLS: solo el dueño o el admin)
    if (form.cuit || form.cbu) {
      const { error: payoutErr } = await supabase
        .from('professional_payout')
        .upsert({
          professional_id: professional.id,
          cuit: form.cuit || null,
          cbu:  form.cbu  || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'professional_id' });
      if (payoutErr) console.warn('professional_payout save error:', payoutErr.message);
    }

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

  getNearestAvailable: async (lat, lng) => {
    const { data, error } = await supabase.rpc('nearest_available_worker', {
      p_lat: lat,
      p_lng: lng,
    });
    if (error) throw error;
    return data?.[0] ?? null;
  },

  // ─── El perfil que ve el cliente antes de elegir (migración 045) ──────────
  // 🔴 Las fotos son OPCIONALES y no se pide que sean propias. Maxi: "no pongas
  // que las fotos sean de ellos. yo no tengo fotos porque jamás le di bola a
  // esas cosas.. y te digo que pinté 200 casas". Exigirlas dejaría afuera justo
  // a los que más saben, así que la experiencia ESCRITA vale igual.

  /** Fotos de un profesional. Para el cliente: sólo las aprobadas. */
  fotosDe: async (professionalId) => {
    if (!professionalId) return [];
    try {
      const { data, error } = await supabase
        .from('professional_photos')
        .select('id,url,descripcion,estado,orden')
        .eq('professional_id', professionalId)
        .order('orden', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch { return []; }   // sin fotos nunca puede romper una pantalla
  },

  /** Sube una foto de trabajo. Queda PENDIENTE hasta que la revisen. */
  subirFoto: async (professionalId, uri, descripcion = null) => {
    const FileSystem = await import('expo-file-system/legacy');
    const ext = (uri.split('.').pop() || 'jpg').toLowerCase();
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const path = `trabajos/${professionalId}/${Date.now()}.${ext}`;
    const { error: e1 } = await supabase.storage.from('avatars')
      .upload(path, bytes, { upsert: true, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
    if (e1) throw e1;
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const { data, error } = await supabase.from('professional_photos')
      .insert({ professional_id: professionalId, url: pub.publicUrl, descripcion })
      .select().single();
    if (error) throw error;
    return data;
  },

  borrarFoto: async (fotoId) => {
    const { error } = await supabase.from('professional_photos').delete().eq('id', fotoId);
    if (error) throw error;
  },

  /** Años de oficio y presentación: lo que muestra el que no tiene fotos. */
  guardarExperiencia: async (professionalId, { aniosOficio, presentacion }) => {
    const campos = {};
    if (aniosOficio !== undefined)  campos.anios_oficio = aniosOficio === null ? null : parseInt(aniosOficio, 10) || null;
    if (presentacion !== undefined) campos.presentacion = (presentacion || '').trim() || null;
    if (!Object.keys(campos).length) return;
    const { error } = await supabase.from('professionals').update(campos).eq('id', professionalId);
    if (error) throw error;
  },
};

export default professionalService;

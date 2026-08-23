import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';

// Topes por tipo. Son generosos para lo que se manda en un trabajo (una foto de
// la etiqueta, un audio explicando, el video de la pérdida) y evitan que alguien
// con datos móviles se quede esperando cinco minutos una subida.
export const LIMITES = {
  image: 10 * 1024 * 1024,   // 10 MB
  video: 25 * 1024 * 1024,   // 25 MB
  audio: 10 * 1024 * 1024,   // 10 MB (unos 10 minutos)
  file:  10 * 1024 * 1024,   // 10 MB
};

export const ETIQUETA = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎤 Audio',
  file:  '📎 Archivo',
};

const chatService = {
  LIMITES,
  getMessages: async (jobId) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  sendMessage: async (jobId, senderId, content) => {
    const { data, error } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: senderId, content, type: 'text' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Manda un adjunto: lo sube al bucket y deja el mensaje.
  //
  // `content` lleva SIEMPRE una descripción corta, aunque haya archivo: es lo
  // que ven las versiones viejas de la app (que no saben de adjuntos) y lo que
  // va en la notificación. Si el mensaje se guardara vacío, del otro lado
  // aparecería un globo en blanco.
  sendAttachment: async (jobId, senderId, { uri, tipo, nombre, mime, duracion }) => {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) throw new Error('No encontramos el archivo.');

    const tope = LIMITES[tipo] ?? LIMITES.file;
    if (info.size > tope) {
      const mb = Math.round(tope / 1024 / 1024);
      throw new Error(`El archivo es muy pesado. El máximo es ${mb} MB.`);
    }

    const ext  = (nombre?.split('.').pop() || uri.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
    const azar = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    // La carpeta arranca con el id del usuario: así la política de borrado sabe
    // de quién es el archivo.
    const path = `${senderId}/${jobId}/${azar}.${ext}`;

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

    const { error: upErr } = await supabase.storage
      .from('chat-media')
      .upload(path, bytes, { contentType: mime || 'application/octet-stream', upsert: false });
    if (upErr) throw new Error('No pudimos subir el archivo. Revisá tu conexión.');

    const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path);

    const descripcion = tipo === 'file'
      ? `${ETIQUETA.file} ${nombre || ''}`.trim()
      : tipo === 'audio' && duracion
        ? `${ETIQUETA.audio} ${Math.floor(duracion / 60)}:${String(duracion % 60).padStart(2, '0')}`
        : ETIQUETA[tipo] || '📎 Adjunto';

    const { data, error } = await supabase
      .from('messages')
      .insert({
        job_id: jobId,
        sender_id: senderId,
        content: descripcion,
        type: 'text',
        attachment_url: pub.publicUrl,
        attachment_type: tipo,
        attachment_name: nombre ?? null,
        attachment_size: info.size ?? null,
        attachment_duration: duracion ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  sendSystemMessage: async (jobId, content) => {
    // 🔴 Por RPC (auditoría 23-ago): la política de INSERT de `messages` exige
    //    sender_id = auth.uid(), y un mensaje de sistema va con sender_id null,
    //    así que TODOS ('ya salió', 'llegó', 'empezó', 'terminó') rebotaban
    //    contra RLS y el error moría en un console.warn que no veía nadie. La RPC
    //    `mensaje_de_sistema` (migración 076) valida que quien llama sea parte del
    //    trabajo e inserta la fila de sistema. Devolvemos el error (que cada
    //    llamador decida su .catch, como ya hacen) en vez de tragarlo.
    const { error } = await supabase.rpc('mensaje_de_sistema', { p_job_id: jobId, p_content: content });
    if (!error) return;
    const faltaLaFuncion = error.code === 'PGRST202' ||
      /could not find the function|does not exist/i.test(error.message || '');
    if (!faltaLaFuncion) throw error;
    // Fallback pre-migración: el insert directo rebota por RLS igual que antes
    // (no rompe a los llamadores, que ya envuelven en .catch).
    const { error: e2 } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: null, content, type: 'system' });
    if (e2) throw e2;
  },

  /** Todas las conversaciones del usuario, para la bandeja.
   *
   *  Un chat en BOLT no existe por sí solo: siempre es el de un trabajo. Así
   *  que la bandeja se arma desde los trabajos donde el usuario está de un lado
   *  o del otro, y a cada uno se le pega su último mensaje y cuántos no leyó.
   *
   *  Se hace en dos consultas y no en una por trabajo: con 30 trabajos, una
   *  consulta por cada uno son 30 viajes al servidor y la pantalla tarda.
   */
  getConversaciones: async (myUserId, professionalId) => {
    // 1) Los trabajos del usuario, de los dos lados.
    let q = supabase
      .from('jobs')
      // 🔴 10-ago-2026 — acá se pedían SÓLO seis campos, y con ese job a medias
      //    se abría la pantalla del trabajo al tocar una conversación. Sin
      //    `client_id` ni `professional_id`, la pantalla no podía saber de qué
      //    lado estabas: el profesional veía la vista del CLIENTE de su propio
      //    trabajo —con la pantalla de calificarse a sí mismo, sin su código de
      //    verificación y sin sus acciones— y las pantallas se mezclaban (Maxi).
      //    El job va entero, como en todos los demás lugares.
      .select('*, professions(name), professionals(user_id, first_name, last_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(40);
    q = professionalId
      ? q.or(`client_id.eq.${myUserId},professional_id.eq.${professionalId}`)
      : q.eq('client_id', myUserId);
    const { data: jobs, error } = await q;
    if (error) throw error;
    if (!jobs?.length) return [];

    // 2) Los mensajes de todos esos trabajos, de una.
    const ids = jobs.map(j => j.id);
    const { data: msgs } = await supabase
      .from('messages')
      .select('job_id, content, type, created_at, sender_id, read_by_other')
      .in('job_id', ids)
      .order('created_at', { ascending: true });

    const porJob = new Map();
    (msgs || []).forEach(m => {
      const acc = porJob.get(m.job_id) || { ultimo: null, sinLeer: 0 };
      acc.ultimo = m;
      // Los del sistema (sender_id null) también cuentan: son avisos que hay que leer.
      if (m.sender_id !== myUserId && !m.read_by_other) acc.sinLeer++;
      porJob.set(m.job_id, acc);
    });

    return jobs
      .map(j => {
        const acc = porJob.get(j.id);
        if (!acc?.ultimo) return null;         // sin mensajes no hay conversación
        return { job: j, ultimo: acc.ultimo, sinLeer: acc.sinLeer };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.ultimo.created_at) - new Date(a.ultimo.created_at));
  },

  markAsRead: async (jobId, myUserId) => {
    await supabase
      .from('messages')
      .update({ read_by_other: true })
      .eq('job_id', jobId)
      // 🔴 10-ago-2026 — `.neq('sender_id', ...)` DEJABA AFUERA los mensajes del
      //    sistema, que tienen `sender_id` en null: en SQL, `null <> 'x'` no da
      //    verdadero, da null. Justo el mensaje automático que le llega al
      //    profesional cuando lo eligen no sumaba al contador, así que no se
      //    enteraba de que tenía algo para leer (Maxi).
      .or(`sender_id.is.null,sender_id.neq.${myUserId}`)
      .eq('read_by_other', false);
  },

  getUnreadCount: async (jobId, myUserId) => {
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .neq('sender_id', myUserId)
      .eq('read_by_other', false);
    if (error) return 0;
    return count ?? 0;
  },

  // Nombre de canal ÚNICO por suscripción: si se reusa el mismo topic después de
  // subscribe() Realtime crashea con "cannot add postgres_changes after subscribe()".
  subscribeToMessages: (jobId, onNew) => {
    const channel = supabase.channel(`chat-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `job_id=eq.${jobId}`,
      }, p => onNew(p.new))
      .subscribe();
    return channel;
  },
  // Limpieza correcta: removeChannel (no solo unsubscribe) para sacarlo del registro.
  unsubscribe: (channel) => {
    if (channel) { try { supabase.removeChannel(channel); } catch {} }
  },
};

export default chatService;

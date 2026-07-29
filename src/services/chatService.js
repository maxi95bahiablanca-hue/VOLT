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
    const { error } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: null, content, type: 'system' });
    if (error) console.warn('system msg failed:', error.message);
  },

  markAsRead: async (jobId, myUserId) => {
    await supabase
      .from('messages')
      .update({ read_by_other: true })
      .eq('job_id', jobId)
      .neq('sender_id', myUserId)
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

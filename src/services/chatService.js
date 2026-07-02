import { supabase } from '../supabase';

const chatService = {
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

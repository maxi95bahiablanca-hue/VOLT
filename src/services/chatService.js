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

  subscribeToMessages: (jobId, onNew) =>
    supabase.channel(`chat-${jobId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `job_id=eq.${jobId}`,
      }, p => onNew(p.new))
      .subscribe(),
};

export default chatService;

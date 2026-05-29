import { supabase } from '../supabase';

const notificationService = {
  // Push token registration disabled — requires Firebase SHA-1 setup.
  // Re-enable once google-services.json has the correct signing fingerprint.
  setup: async (_userId) => {},

  sendToUser: async (userId, { title, body, data = {} }) => {
    if (__DEV__) {
      console.log(`[VOLT NOTIF → ${userId}] ${title}: ${body}`);
      return;
    }
    try {
      const { data: row } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', userId)
        .maybeSingle();
      if (!row?.token) return;
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: row.token, title, body, data,
          sound: 'default', channelId: 'volt-jobs', priority: 'high', ttl: 60,
        }),
      });
    } catch { /* silent */ }
  },
};

export default notificationService;

import { supabase } from '../supabase';

// expo-notifications no funciona en Expo Go desde SDK 53 en Android.
// Este stub mantiene la API idéntica — la app funciona completa.
// Las notificaciones push reales se activan en el build de producción (EAS).

const notificationService = {
  setup: async (_userId) => null,

  sendToUser: async (userId, { title, body, data = {} }) => {
    // En producción: envía push real. En desarrollo: log silencioso.
    if (__DEV__) {
      console.log(`[VOLT NOTIF → ${userId}] ${title}: ${body}`);
      return;
    }
    try {
      const { data: row } = await supabase
        .from('push_tokens').select('token').eq('user_id', userId).maybeSingle();
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

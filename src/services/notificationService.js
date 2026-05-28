import { supabase } from '../supabase';

const EXPO_PROJECT_ID = '196fdfff-0be6-4859-be4e-8f9b28796fe1';

const notificationService = {
  setup: async (userId) => {
    try {
      const Notifications = require('expo-notifications');

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowList: true,
        }),
      });

      // Crear canal de Android (ignorado en iOS)
      await Notifications.setNotificationChannelAsync('volt-jobs', {
        name: 'Trabajos VOLT',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });

      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;

      const { data: token } = await Notifications.getExpoPushTokenAsync({
        projectId: EXPO_PROJECT_ID,
      });

      if (token) {
        await supabase
          .from('push_tokens')
          .upsert({ user_id: userId, token }, { onConflict: 'user_id' });
      }
    } catch {
      // expo-notifications no disponible o Firebase no configurado
    }
  },

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

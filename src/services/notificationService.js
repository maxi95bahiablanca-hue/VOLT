import { supabase } from '../supabase';

// ─── Estado de activación ────────────────────────────────────────────────────
// PUSH_ENABLED = false hasta que google-services.json sea real y
// expo-notifications esté en los plugins de app.json.
//
// Para activar:
//   1. Crear proyecto en Firebase Console → agregar app Android (com.pedroxillovich.volt)
//   2. En Firebase: Configuración → SHA-1 → D6:BB:14:28:09:DB:D1:C4:B1:F4:9F:AA:0E:06:4D:6B:9E:9C:F5:06
//   3. Descargar google-services.json → reemplazar el de la raíz del proyecto
//   4. En app.json plugins agregar:
//        ["expo-notifications", {
//          "icon": "./assets/icon.png",
//          "color": "#FFD600",
//          "sounds": [],
//          "mode": "production"
//        }]
//   5. Cambiar PUSH_ENABLED a true y hacer build nuevo.
const PUSH_ENABLED = false;

let _Notifications = null;
const getNotif = async () => {
  if (_Notifications) return _Notifications;
  if (!PUSH_ENABLED) return null;
  try {
    _Notifications = await import('expo-notifications');
    return _Notifications;
  } catch {
    return null;
  }
};

const notificationService = {
  setup: async (userId) => {
    if (!PUSH_ENABLED || !userId) return;
    const Notif = await getNotif();
    if (!Notif) return;

    try {
      Notif.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge:  false,
        }),
      });

      await Notif.setNotificationChannelAsync('volt-jobs', {
        name:       'Trabajos VOLT',
        importance: Notif.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FFD600',
        sound:      'default',
      });

      const { status: existingStatus } = await Notif.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notif.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      const tokenData = await Notif.getExpoPushTokenAsync({
        projectId: '196fdfff-0be6-4859-be4e-8f9b28796fe1',
      });
      const token = tokenData.data;
      if (!token) return;

      await supabase.from('push_tokens').upsert(
        { user_id: userId, token, platform: 'android', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    } catch { /* silent */ }
  },

  sendToUser: async (userId, { title, body, data = {} }) => {
    if (__DEV__) {
      console.log(`[VOLT NOTIF → ${userId}] ${title}: ${body}`);
      return;
    }
    if (!userId) return;
    try {
      const { data: row } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', userId)
        .maybeSingle();
      if (!row?.token) return;
      await fetch('https://exp.host/--/api/v2/push/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:        row.token,
          title,
          body,
          data,
          sound:     'default',
          channelId: 'volt-jobs',
          priority:  'high',
          ttl:       60,
        }),
      });
    } catch { /* silent */ }
  },
};

export default notificationService;

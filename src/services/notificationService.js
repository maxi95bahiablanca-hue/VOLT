import { supabase } from '../supabase';

// ─── Estado de activación ────────────────────────────────────────────────────
// PUSH_ENABLED = false hasta que google-services.json sea real y
// expo-notifications esté en los plugins de app.json.
//
// Para activar:
//   1. Crear proyecto en Firebase Console → agregar app Android (com.bolt.app)
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
const PUSH_ENABLED = true;

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

      // Canal NUEVO (nombre nuevo) para que Android lo cree fresco con sonido + prioridad
      // MAX. Los canales no se actualizan una vez creados; por eso renombramos.
      await Notif.setNotificationChannelAsync('bolt-urgent-v3', {
        name:       'Trabajos BOLT (urgente)',
        importance: Notif.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400, 200, 400, 200, 500],  // vibración insistente
        lightColor: '#FFD600',
        sound:      'alarm',          // suena el alarm.wav (fuerte, tipo despertador)
        enableVibrate: true,
        enableLights:  true,
        lockscreenVisibility: Notif.AndroidNotificationVisibility.PUBLIC,
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
      console.log(`[BOLT NOTIF → ${userId}] ${title}: ${body}`);
      return;
    }
    if (!userId) return;
    try {
      // El envío se hace server-side (Edge Function): la app ya NO lee tokens
      // de otros usuarios. La función valida auth + relación y envía por Expo.
      await supabase.functions.invoke('send-push', {
        body: { userId, title, body, data },
      });
    } catch (e) {
      console.warn('send-push error:', e?.message || e);
    }
  },
};

export default notificationService;

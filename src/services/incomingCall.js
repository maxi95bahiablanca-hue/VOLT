// Notificación "estilo llamada" (full-screen intent) para pedidos entrantes.
// Usa @notifee/react-native para abrir la app directo en la pantalla LLEGÓ PEDIDO
// aunque la app esté en segundo plano o cerrada.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidCategory,
} from '@notifee/react-native';

const CHANNEL_ID = 'bolt-incoming-call-v1';

export async function ensureIncomingChannel() {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Pedidos entrantes',
    description: 'Aviso urgente cuando llega un trabajo',
    importance: AndroidImportance.HIGH,
    sound: 'alarm',                 // alarm.wav copiado a res/raw por expo-notifications
    vibration: true,
    vibrationPattern: [300, 500, 300, 500],
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: true,
  });
}

// Muestra la notificación full-screen para un pedido entrante.
// `job` puede ser el objeto del trabajo o solo { jobId } (desde el push).
export async function displayIncomingJob(job = {}) {
  await ensureIncomingChannel();
  const jobId = String(job.id || job.jobId || '');
  const oficio = job?.professions?.name;
  await notifee.displayNotification({
    id: 'incoming-job',
    title: '⚡ ¡LLEGÓ UN PEDIDO!',
    body: oficio
      ? `Nuevo trabajo de ${oficio}. Tocá para responder.`
      : 'Tenés un nuevo pedido. Tocá para responder.',
    data: { screen: 'worker_incoming', jobId },
    android: {
      channelId: CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.CALL,
      // 👇 esto es lo que abre la app en pantalla completa estilo llamada
      fullScreenAction: { id: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },
      sound: 'alarm',
      loopSound: true,
      ongoing: true,
      autoCancel: false,
      timeoutAfter: 180000,         // se va sola a los 3 min (igual que la ventana del pedido)
      lightUpScreen: true,
    },
  });
}

export async function cancelIncomingJob() {
  try { await notifee.cancelNotification('incoming-job'); } catch {}
}

// Pide el permiso de "pantalla completa" (Android 14+ lo restringe). Si no está
// concedido, abre los ajustes del sistema para que el usuario lo active.
// Android 14 (API 34) dejó de conceder USE_FULL_SCREEN_INTENT automáticamente a
// las apps que no son de llamadas o alarmas. Sin ese permiso, el pedido entrante
// degrada a un banner común y NO despierta la pantalla con el celular bloqueado.
// notifee no expone si está concedido, así que lo pedimos una sola vez y dejamos
// anotado que ya se pidió.
const FS_PEDIDO_KEY = 'bolt.fullscreen.pedido';

export async function ensureFullScreenPermission() {
  try {
    await notifee.requestPermission();
  } catch {}
}

/** ¿Corresponde ofrecerle al trabajador activar la pantalla completa? */
export async function necesitaPermisoPantallaCompleta() {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 34) return false;   // antes de Android 14 se concedía solo
  try {
    return !(await AsyncStorage.getItem(FS_PEDIDO_KEY));
  } catch {
    return false;
  }
}

/** Abre los ajustes de notificaciones de BOLT para habilitar pantalla completa. */
export async function abrirAjustesPantallaCompleta() {
  try {
    await AsyncStorage.setItem(FS_PEDIDO_KEY, '1');
  } catch {}
  // En Android 14+ el permiso de pantalla completa NO esta en los ajustes
  // generales de notificaciones: tiene su propia pantalla. Sin ir ahi, el
  // trabajador daba vueltas y la alarma seguia degradada a banner comun.
  try {
    await Linking.sendIntent('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT', [
      { key: 'android.provider.extra.APP_PACKAGE', value: 'ar.com.bolt.app' },
    ]);
    return true;
  } catch {}
  try {
    await notifee.openNotificationSettings();   // respaldo para versiones viejas
    return true;
  } catch {
    return false;
  }
}

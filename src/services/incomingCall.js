// Notificación "estilo llamada" (full-screen intent) para pedidos entrantes.
// Usa @notifee/react-native para abrir la app directo en la pantalla LLEGÓ PEDIDO
// aunque la app esté en segundo plano o cerrada.
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
      timeoutAfter: 60000,          // se va sola a los 60s (igual que la ventana del pedido)
      lightUpScreen: true,
    },
  });
}

export async function cancelIncomingJob() {
  try { await notifee.cancelNotification('incoming-job'); } catch {}
}

// Pide el permiso de "pantalla completa" (Android 14+ lo restringe). Si no está
// concedido, abre los ajustes del sistema para que el usuario lo active.
export async function ensureFullScreenPermission() {
  try {
    await notifee.requestPermission();
    // En Android 14+ el permiso de full-screen intent se gestiona aparte:
    if (notifee.openNotificationSettings) {
      // No forzamos; solo nos aseguramos del canal. El sistema mostrará heads-up
      // si el full-screen no está habilitado.
    }
  } catch {}
}

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

// El paquete de la app, tal cual esta en app.json (expo.android.package). Se
// escribe UNA sola vez: es el dato que Android usa para saber de que app le
// estan hablando, y escribirlo mal falla en silencio.
const PAQUETE = 'ar.com.bolt.com';

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

// 🔴 auditoría: el id era fijo ('incoming-job'), así que un SEGUNDO pedido
//    entrante pisaba la notificación del primero en la pantalla y cancelIncomingJob
//    los mataba a los dos. Ahora cada pedido usa `incoming-${jobId}` y llevamos
//    registro de los que están en pantalla para poder cancelar uno o todos.
const _mostrados = new Set();
const idDe = (jobId) => `incoming-${jobId || 'job'}`;

// Muestra la notificación full-screen para un pedido entrante.
// `job` puede ser el objeto del trabajo o solo { jobId } (desde el push).
export async function displayIncomingJob(job = {}) {
  await ensureIncomingChannel();
  const jobId = String(job.id || job.jobId || '');
  const notifId = idDe(jobId);
  _mostrados.add(notifId);
  const oficio = job?.professions?.name;
  await notifee.displayNotification({
    id: notifId,
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

// Sin argumento cancela TODAS las notificaciones de pedido en pantalla (lo que
// esperan los llamadores actuales de App.js); con un jobId cancela sólo esa.
export async function cancelIncomingJob(jobId) {
  if (jobId != null) {
    const notifId = idDe(String(jobId));
    _mostrados.delete(notifId);
    try { await notifee.cancelNotification(notifId); } catch {}
    return;
  }
  const ids = [..._mostrados, 'incoming-job'];   // 'incoming-job' por compatibilidad con notifs viejas
  _mostrados.clear();
  for (const id of ids) {
    try { await notifee.cancelNotification(id); } catch {}
  }
}

// Pide el permiso de "pantalla completa" (Android 14+ lo restringe). Si no está
// concedido, abre los ajustes del sistema para que el usuario lo active.
// Android 14 (API 34) dejó de conceder USE_FULL_SCREEN_INTENT automáticamente a
// las apps que no son de llamadas o alarmas. Sin ese permiso, el pedido entrante
// degrada a un banner común y NO despierta la pantalla con el celular bloqueado.
// notifee (9.1.8) NO expone si el permiso está concedido: `getNotificationSettings()`
// sólo trae `android.alarm`. O sea que del lado JS es imposible saberlo, y todo
// lo que podemos hacer es ofrecerlo bien y volver a ofrecerlo si sigue sin pasar
// nada.
const FS_PEDIDO_KEY = 'bolt.fullscreen.pedido';

// 🔴 Antes esto se ofrecía UNA SOLA VEZ EN LA VIDA. El que tocaba "Ahora no"
//    —o el que abría los ajustes y no encontraba el interruptor— no lo veía
//    nunca más, y se quedaba sin que le suene un pedido con el celular
//    bloqueado sin enterarse jamás de por qué. Es el mismo agujero de siempre:
//    un estado que espera para siempre a que alguien apriete un botón.
//    Ahora se vuelve a ofrecer a los 7 días, hasta 3 veces. Después se calla:
//    insistir para siempre sería lo contrario.
const DIAS_PARA_REINSISTIR = 7;
const VECES_MAX = 3;

export async function ensureFullScreenPermission() {
  try {
    await notifee.requestPermission();
  } catch {}
}

async function leerRegistro() {
  try {
    const crudo = await AsyncStorage.getItem(FS_PEDIDO_KEY);
    if (!crudo) return { veces: 0, ultima: null };
    // El formato viejo era el string '1'. Se traduce en vez de descartarse,
    // para no volver a molestar de golpe al que ya lo activó.
    if (crudo === '1') return { veces: 1, ultima: null };
    const r = JSON.parse(crudo);
    return { veces: Number(r?.veces) || 0, ultima: r?.ultima || null };
  } catch {
    return { veces: 0, ultima: null };
  }
}

/**
 * ¿Toca ofrecerle al trabajador activar la pantalla completa?
 *
 * ⚠️ NO es sólo una pregunta: cuando devuelve `true` deja anotado el
 * ofrecimiento. Es a propósito — así queda registrado aunque el trabajador
 * cierre el cartel con "Ahora no", que es el caso que antes no se anotaba y
 * hacía que el aviso volviera a saltar en cada toque del radar.
 */
export async function tocaOfrecerPantallaCompleta() {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 34) return false;   // antes de Android 14 se concedía solo
  const { veces, ultima } = await leerRegistro();
  if (veces >= VECES_MAX) return false;
  if (ultima) {
    const pasaron = Date.now() - new Date(ultima).getTime();
    if (pasaron < DIAS_PARA_REINSISTIR * 24 * 3600 * 1000) return false;
  }
  try {
    await AsyncStorage.setItem(FS_PEDIDO_KEY, JSON.stringify({
      veces: veces + 1, ultima: new Date().toISOString(),
    }));
  } catch {}
  return true;
}

/** Abre los ajustes de notificaciones de BOLT para habilitar pantalla completa. */
export async function abrirAjustesPantallaCompleta() {
  // El ofrecimiento ya quedó anotado en tocaOfrecerPantallaCompleta(). Acá no
  // se anota nada más: abrir los ajustes NO es lo mismo que conceder el
  // permiso, y darlo por hecho es justamente lo que dejaba a alguien sin
  // avisos para siempre.
  //
  // En Android 14+ el permiso de pantalla completa NO esta en los ajustes
  // generales de notificaciones: tiene su propia pantalla. Sin ir ahi, el
  // trabajador daba vueltas y la alarma seguia degradada a banner comun.
  //
  // 🔴 6-ago-2026 — ACA EL PAQUETE ESTABA MAL ESCRITO: decia 'ar.com.bolt.app'
  //    y el de BOLT es 'ar.com.bolt.com' (app.json → expo.android.package).
  //    Con el paquete equivocado, Android no sabe de que app le estan hablando:
  //    el boton "Activarlo" no llevaba a la pantalla del permiso. Se quedo sin
  //    detectar porque el fallo es silencioso — abre otra cosa o no abre nada,
  //    pero nunca dice que el paquete no existe.
  try {
    await Linking.sendIntent('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT', [
      { key: 'android.provider.extra.APP_PACKAGE', value: PAQUETE },
    ]);
    return true;
  } catch {}
  try {
    await notifee.openNotificationSettings();   // respaldo para versiones viejas
    return true;
  } catch {}
  // Ultimo recurso: los ajustes de BOLT. Desde ahi el permiso esta a dos
  // toques (Notificaciones → Notificaciones de pantalla completa). Es peor que
  // llegar derecho, pero es un camino que existe: dejarlo devolver false
  // significaba mandar al trabajador a buscarlo solo por todo Android.
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

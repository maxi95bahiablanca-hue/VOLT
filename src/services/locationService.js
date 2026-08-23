import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { supabase } from '../supabase';

const BACKGROUND_TASK = 'volt-worker-location';

// ─── Tarea de background ──────────────────────────────────────────────────────
// Debe definirse en el nivel raíz del módulo (fuera de componentes y funciones)
TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    const { latitude, longitude } = data.locations[0].coords;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('professionals')
      // location_at (auditoría 23-ago): sin él, el mapa del cliente considera la
      // ubicación "vieja" y se apaga a los ~10 min aunque el profesional siga en
      // movimiento en segundo plano.
      .update({ location: `SRID=4326;POINT(${longitude} ${latitude})`, location_at: new Date().toISOString() })
      .eq('user_id', user.id);
  } catch { /* silent */ }
});

const DISTANCE_THRESHOLD_M = 80;
const TIME_INTERVAL_MS = 90 * 1000; // 1.5 minutos en foreground

const locationService = {
  requestPermission: async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return false;
    // El permiso de background es opcional (para tracking con app minimizada)
    if (Platform.OS !== 'web') {
      Location.requestBackgroundPermissionsAsync().catch(() => {});
    }
    return true;
  },

  // Obtener la ubicación actual de forma ROBUSTA.
  // En Android "frío" (sin fix de GPS reciente) getCurrentPositionAsync puede
  // tardar muchísimo o nunca resolver, lo que deja al llamador sin ubicación
  // aunque el GPS esté activo. Por eso usamos timeout + fallbacks.
  getCurrentLocation: async () => {
    // 1) Intento principal con timeout de ~8s
    try {
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        ),
      ]);
      if (pos?.coords) return pos;
    } catch { /* seguimos con los fallbacks */ }

    // 2) Última posición conocida (devuelve al instante si existe)
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last?.coords) return last;
    } catch { /* seguimos */ }

    // 3) Último intento con precisión baja (más rápido de fijar)
    //    Si esto también falla, dejamos que el error se propague para que el
    //    llamador decida qué hacer (no devolvemos undefined en silencio).
    //    🔴 Este intento TAMBIÉN lleva tiempo límite. Sin él era el único await
    //    de toda la cadena que podía no volver nunca: en un teléfono que no
    //    logra fijar posición, `getCurrentPositionAsync` se queda esperando sin
    //    fin y el llamador queda colgado — a Esteban se le quedó el botón del
    //    radar en "Actualizando..." para siempre (5-ago-2026). Ojo: el `.catch()`
    //    del llamador atrapa errores, pero no atrapa un colgado; por eso hace
    //    falta el vencimiento acá.
    return Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10000)
      ),
    ]);
  },

  // Tracking en foreground (mientras la app está abierta)
  watchLocation: async (onUpdate) => {
    const watchSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: TIME_INTERVAL_MS,
        distanceInterval: DISTANCE_THRESHOLD_M,
      },
      (pos) => onUpdate(pos.coords.latitude, pos.coords.longitude)
    );

    let iosTimer = null;
    if (Platform.OS === 'ios') {
      iosTimer = setInterval(async () => {
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          onUpdate(pos.coords.latitude, pos.coords.longitude);
        } catch { /* silent */ }
      }, TIME_INTERVAL_MS);
    }

    return {
      remove: () => {
        watchSub.remove();
        if (iosTimer !== null) clearInterval(iosTimer);
      },
    };
  },

  // Tracking en background (funciona con app minimizada o pantalla apagada)
  startBackgroundTracking: async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
      if (isRegistered) return;
      await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: DISTANCE_THRESHOLD_M,
        timeInterval: TIME_INTERVAL_MS,
        // El mismo rastreo lo usan dos cosas: el radar (estar disponible para
        // recibir pedidos) y el viaje hacia un domicilio. Decía "Estás
        // disponible", que es mentira cuando el profesional tiene el radar
        // apagado y sólo está yendo a un trabajo propio. El texto tiene que
        // valer para los dos casos y decir la verdad: se está compartiendo la
        // ubicación, y por qué.
        foregroundService: {
          notificationTitle: 'BOLT está usando tu ubicación',
          notificationBody: 'Para que te lleguen trabajos cerca y el cliente te vea llegar.',
          notificationColor: '#FFD600',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      });
    } catch { /* silent */ }
  },

  stopBackgroundTracking: async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
      if (isRegistered) await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
    } catch { /* silent */ }
  },
};

export default locationService;

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
      .update({ location: `SRID=4326;POINT(${longitude} ${latitude})` })
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
    return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
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
        foregroundService: {
          notificationTitle: 'BOLT — Estás disponible',
          notificationBody: 'Tu ubicación se actualiza en tiempo real.',
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

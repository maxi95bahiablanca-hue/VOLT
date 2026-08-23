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

// ─── Estado del push en ESTE teléfono ────────────────────────────────────────
// 🔴 11-ago-2026 — auditoría: "el profesional con las notificaciones apagadas
//    queda sin token y sin aviso". setup() hacía `return` en seco cuando el
//    permiso venía denegado o cuando fallaba el upsert de push_tokens, todo
//    adentro de un `catch { /* silent */ }`. A partir de ahí el tipo prende el
//    radar, la app le dice "Estás disponible", le entra un pedido, send-push
//    contesta {sent:false, reason:'sin token'} y los 3 minutos se le pasan sin
//    que suene nada. Él cree que no hay trabajo; en realidad no se entera de
//    ninguno. Es el mismo agujero de "disponible pero invisible" (migración
//    063) pero por el lado del aviso.
//    Ahora el resultado queda guardado acá y setup() lo devuelve, así la app
//    puede mostrarlo en vez de callárselo.
export const PUSH_ESTADO = {
  DESCONOCIDO: 'desconocido',   // todavía no corrió setup()
  OK:          'ok',            // hay permiso y el token quedó guardado
  SIN_PERMISO: 'sin-permiso',   // el usuario (o Android) negó las notificaciones
  SIN_TOKEN:   'sin-token',     // hay permiso pero Expo no devolvió token
  NO_GUARDADO: 'no-guardado',   // hay token pero no se pudo escribir push_tokens
  ERROR:       'error',         // se rompió algo antes de llegar a pedir el token
  APAGADO:     'apagado',       // PUSH_ENABLED = false / expo-notifications ausente
};

// Cuál es el mensaje que hay que mostrarle al profesional en cada caso.
const TEXTO_ESTADO = {
  [PUSH_ESTADO.SIN_PERMISO]: 'Tenés las notificaciones apagadas: no te vamos a poder avisar cuando entre un trabajo.',
  [PUSH_ESTADO.SIN_TOKEN]:   'No pudimos registrar este teléfono para los avisos. Cerrá y volvé a abrir la app.',
  [PUSH_ESTADO.NO_GUARDADO]: 'No pudimos guardar este teléfono para los avisos. Probá de nuevo con señal.',
  [PUSH_ESTADO.ERROR]:       'No pudimos activar los avisos en este teléfono.',
  [PUSH_ESTADO.APAGADO]:     'Los avisos no están disponibles en esta versión de la app.',
};

let _estadoPush = {
  estado:   PUSH_ESTADO.DESCONOCIDO,
  puedeRecibir: false,
  mensaje:  null,
  detalle:  null,
  userId:   null,
  ts:       null,
};

// Suscripción simple para que una pantalla se entere sin tener que volver a
// llamar a setup(). Devuelve la función para desuscribirse.
const _oyentes = new Set();
const _avisarEstado = () => {
  _oyentes.forEach((cb) => { try { cb(_estadoPush); } catch { /* un oyente roto no puede tumbar a los otros */ } });
};

const _setEstado = (estado, { detalle = null, userId = null } = {}) => {
  _estadoPush = {
    estado,
    puedeRecibir: estado === PUSH_ESTADO.OK,
    mensaje: TEXTO_ESTADO[estado] ?? null,
    detalle,
    userId,
    ts: Date.now(),
  };
  if (estado !== PUSH_ESTADO.OK) {
    console.warn(`[BOLT push] este teléfono NO va a recibir avisos → ${estado}${detalle ? ` (${detalle})` : ''}`);
  }
  _avisarEstado();
  return _estadoPush;
};

// ─── Registro de avisos que NO salieron ──────────────────────────────────────
// 🔴 11-ago-2026 — hasta hoy un push que fallaba se veía igual que uno que
//    llegó. Guardamos los últimos en memoria para poder mirarlos desde la app
//    (y para que quede algo en el log de la sesión).
//    PENDIENTE: cuando exista la tabla `push_fallidos` (la pidió la auditoría
//    para que el vigilante los liste), acá va el insert. No lo escribimos
//    todavía porque la tabla no está creada y un insert contra una tabla
//    inexistente sería otro fallo silencioso más.
const MAX_FALLOS = 30;
const _fallosPush = [];
const _anotarFallo = (fallo) => {
  _fallosPush.unshift({ ...fallo, ts: Date.now() });
  if (_fallosPush.length > MAX_FALLOS) _fallosPush.length = MAX_FALLOS;
};

// El motivo real viaja en el cuerpo de la respuesta (FunctionsHttpError guarda
// la Response en `context`). Sin esto, un 403 "Sin relación con el
// destinatario" y una caída de Expo se leen igual: "Edge Function returned a
// non-2xx status code".
const _motivoDelError = async (error) => {
  const base = error?.message || String(error);
  try {
    const res = error?.context;
    if (res && typeof res.text === 'function') {
      const cuerpo = await res.text();
      if (cuerpo) {
        let parsed = null;
        try { parsed = JSON.parse(cuerpo); } catch { /* no era JSON */ }
        const msg = parsed?.error || parsed?.message || parsed?.reason || cuerpo;
        return `${base} — ${String(msg).slice(0, 200)}`;
      }
    }
  } catch { /* leer el cuerpo es un extra: si no se puede, va el mensaje pelado */ }
  return base;
};

const notificationService = {
  PUSH_ESTADO,

  // Devuelve { estado, puedeRecibir, mensaje, ... }. NUNCA tira: quien la llama
  // (App.js:212) la invoca sin await y sin catch.
  setup: async (userId) => {
    if (!PUSH_ENABLED) return _setEstado(PUSH_ESTADO.APAGADO, { userId });
    if (!userId) return _estadoPush;

    const Notif = await getNotif();
    if (!Notif) return _setEstado(PUSH_ESTADO.APAGADO, { detalle: 'expo-notifications no cargó', userId });

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
      // 🔴 11-ago-2026 — antes acá había un `return` mudo. Ahora queda asentado:
      //    DÓNDE MOSTRARLO → src/screens/HomeScreen.js, handleToggle() (línea
      //    1048), justo al lado del cartel que ya existe para la ubicación
      //    ("Cómo activarlo" → abrirAyudaUbicacion() de src/utils/ayuda.js,
      //    línea 1105; abre la guía web, NO los ajustes del teléfono — para
      //    mandarlo a apagar/prender los avisos hace falta Linking.openSettings
      //    o una entrada nueva en esa guía). Si
      //    notificationService.getEstadoPush().puedeRecibir === false, el
      //    profesional tiene que ver el mensaje ANTES de creerse disponible.
      if (finalStatus !== 'granted') {
        return _setEstado(PUSH_ESTADO.SIN_PERMISO, { detalle: `permiso: ${finalStatus}`, userId });
      }

      const tokenData = await Notif.getExpoPushTokenAsync({
        projectId: '196fdfff-0be6-4859-be4e-8f9b28796fe1',
      });
      const token = tokenData?.data;
      if (!token) return _setEstado(PUSH_ESTADO.SIN_TOKEN, { userId });

      // 🔴 10-ago-2026 — el upsert es por `user_id`, así que un MISMO teléfono
      //    usado con dos cuentas deja dos filas con el mismo token: una por
      //    usuario. A partir de ahí, todo lo que se le mande a cualquiera de los
      //    dos llega al mismo aparato — el cliente recibe los avisos del
      //    profesional y al revés. Es la explicación de manual para
      //    "me llegan notificaciones que no son mías", y pasa apenas alguien
      //    prueba las dos puntas en un teléfono.
      //    Un token es de UN dispositivo y un dispositivo tiene UN dueño a la
      //    vez: al registrarlo, se lo sacamos a cualquier otro.
      // 🔴 23-ago-2026 — el DELETE de acá abajo NO servía: RLS no deja borrar la
      //    fila de OTRO usuario desde el cliente (política push_tokens_own), así
      //    que el token quedaba compartido entre las dos cuentas del mismo
      //    teléfono y se cruzaban los avisos. El cross-user hay que hacerlo en la
      //    base: la RPC `registrar_push_token` (definer, migración 075) le saca el
      //    token a cualquier otro dueño y lo deja en esta cuenta.
      const { error: errRpc } = await supabase.rpc('registrar_push_token', { p_token: token });
      if (!errRpc) return _setEstado(PUSH_ESTADO.OK, { userId });
      const faltaLaFuncion = errRpc.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(errRpc.message || '');
      if (!faltaLaFuncion) {
        return _setEstado(PUSH_ESTADO.NO_GUARDADO, { detalle: errRpc.message, userId });
      }

      // Fallback pre-migración: el delete cross-user no funciona (RLS), pero el
      // upsert propio sí guarda el token de esta cuenta —igual que antes—, así el
      // OTA puede llegar antes que la migración sin dejar a nadie sin push.
      await supabase.from('push_tokens').delete().eq('token', token).neq('user_id', userId);
      const { error: errGuardar } = await supabase.from('push_tokens').upsert(
        { user_id: userId, token, platform: 'android', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      if (errGuardar) {
        return _setEstado(PUSH_ESTADO.NO_GUARDADO, { detalle: errGuardar.message, userId });
      }

      return _setEstado(PUSH_ESTADO.OK, { userId });
    } catch (e) {
      return _setEstado(PUSH_ESTADO.ERROR, { detalle: e?.message || String(e), userId });
    }
  },

  // Lo último que se supo del push en este teléfono. Sirve para bloquear/avisar
  // al prender el radar (HomeScreen.handleToggle) o para un cartel en el perfil
  // del trabajador. No dispara nada: es sólo consulta.
  getEstadoPush: () => _estadoPush,

  // ¿Este teléfono puede recibir avisos? false también mientras no corrió
  // setup(): preferimos avisar de más antes que dejarlo mudo.
  puedeRecibirAvisos: () => _estadoPush.estado === PUSH_ESTADO.OK,

  // Para que una pantalla se entere del cambio sin volver a pedir permisos.
  // Devuelve la función de baja; llamala en el cleanup del useEffect.
  onEstadoPush: (cb) => {
    if (typeof cb !== 'function') return () => {};
    _oyentes.add(cb);
    try { cb(_estadoPush); } catch { /* ídem */ }
    return () => { _oyentes.delete(cb); };
  },

  // Los últimos avisos que NO salieron (más nuevo primero). Para el panel de
  // soporte / diagnóstico; también sirve al probar en la calle.
  getFallosPush: () => [..._fallosPush],

  // 🔴 11-ago-2026 — auditoría: "sendToUser da por exitoso todo push que falla".
  //    supabase.functions.invoke NO tira excepción cuando la función contesta
  //    403/500: devuelve { data, error }. Acá el resultado se descartaba
  //    entero, así que ni el try/catch ni los `.catch(() => {})` de las
  //    pantallas se enteraban de nada. Un 403 "Sin relación con el
  //    destinatario" (por el que hoy no sale NINGÚN aviso del sistema: rescate
  //    al encargado, panel de admin, vigilante) se veía igual que un envío que
  //    llegó. Por eso estuvo meses roto sin que nadie lo notara.
  //
  //    Ahora devuelve QUÉ pasó y NO tira nunca: las pantallas la llaman con
  //    .catch(() => {}) a propósito, porque el aviso es accesorio y no puede
  //    frenar un flujo. Quien quiera reaccionar, que mire el objeto:
  //      { ok, sent, motivo, status }
  //      · ok:false            → no se pudo ni preguntar (error de la función)
  //      · ok:true, sent:false → la función respondió pero no salió el push
  //                              (sin token, token muerto, Expo caído)
  //    Regla: un aviso que no salió NUNCA se informa como enviado.
  sendToUser: async (userId, { title, body, data = {} } = {}) => {
    if (__DEV__) {
      console.log(`[BOLT NOTIF → ${userId}] ${title}: ${body}`);
      return { ok: true, sent: false, motivo: 'modo desarrollo: no se envía' };
    }
    if (!userId) return { ok: false, sent: false, motivo: 'sin destinatario' };

    try {
      // El envío se hace server-side (Edge Function): la app ya NO lee tokens
      // de otros usuarios. La función valida auth + relación y envía por Expo.
      const { data: resp, error } = await supabase.functions.invoke('send-push', {
        body: { userId, title, body, data },
      });

      if (error) {
        const motivo = await _motivoDelError(error);
        const status = error?.context?.status ?? null;
        console.warn(`[BOLT push] NO se envió a ${userId} ("${title}"): ${motivo}`);
        _anotarFallo({ userId, title, motivo, status });
        return { ok: false, sent: false, motivo, status };
      }

      // La función contestó 200. Eso NO quiere decir que el push haya salido:
      // devuelve { sent:false, reason:'sin token' } cuando el destinatario no
      // tiene token registrado.
      //
      // 🔴 11-ago-2026 — acá había un `resp?.sent !== false`, que es la misma
      //    trampa que veníamos a cerrar: cualquier respuesta SIN la clave `sent`
      //    quedaba como enviada. Y eso pasa de verdad: functions-js sólo parsea
      //    JSON cuando el Content-Type es application/json (FunctionsClient.js
      //    :269) — si un proxy contesta texto plano, `resp` es un string y
      //    `resp?.sent` es undefined; ídem si el send-push desplegado es una
      //    versión vieja que no devolvía `sent` (el repo NO está desplegado).
      //    Se pide la afirmación explícita: sólo `sent === true` es enviado.
      const sent = resp?.sent === true;
      if (!sent) {
        const motivo = resp?.reason || resp?.motivo
          || (resp && typeof resp === 'object'
            ? 'la función no envió el push'
            : 'send-push contestó 200 pero no dijo si envió');
        console.warn(`[BOLT push] NO se envió a ${userId} ("${title}"): ${motivo}`);
        _anotarFallo({ userId, title, motivo, status: 200 });
        return { ok: true, sent: false, motivo, respuesta: resp ?? null };
      }

      return { ok: true, sent: true, respuesta: resp ?? null };
    } catch (e) {
      // Red caída, timeout, JSON roto. Sigue sin tirar hacia afuera.
      const motivo = e?.message || String(e);
      console.warn(`[BOLT push] NO se envió a ${userId} ("${title}"): ${motivo}`);
      _anotarFallo({ userId, title, motivo, status: null });
      return { ok: false, sent: false, motivo };
    }
  },
};

export default notificationService;

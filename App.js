import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, AppState, Linking, Alert, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import ErrorBoundary from './src/components/ErrorBoundary';
import DraggableBubble from './src/components/DraggableBubble';
import { toastConfig, showInfo } from './src/utils/toast';
import { supabase } from './src/supabase';
import notificationService from './src/services/notificationService';
import { conTiempo } from './src/utils/conTiempo';
import jobService from './src/services/jobService';
import professionalService from './src/services/professionalService';
import * as TaskManager from 'expo-task-manager';
import * as Updates from 'expo-updates';
import notifee, { EventType } from '@notifee/react-native';
import { displayIncomingJob, cancelIncomingJob, ensureFullScreenPermission } from './src/services/incomingCall';
import { isDemoMode, getDemoRole, disableDemo } from './src/demo/demoMode';
import { DEMO_PROFESSIONAL } from './src/demo/demoData';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import JobRequestScreen from './src/screens/JobRequestScreen';
import AssistantScreen from './src/screens/AssistantScreen';
import QuoteSelectionScreen from './src/screens/QuoteSelectionScreen';
import WorkerIncomingScreen from './src/screens/WorkerIncomingScreen';
import JobTrackingScreen from './src/screens/JobTrackingScreen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RatingScreen from './src/screens/RatingScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import ChatScreen from './src/screens/ChatScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MiNegocioScreen from './src/screens/MiNegocioScreen';
import TabBar from './src/components/TabBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import chatService from './src/services/chatService';
import {
  useFonts,
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
} from '@expo-google-fonts/inter';
import { applyGlobalFont } from './src/globalFont';

// Aplica la fuente Inter a toda la app. El mapeo peso → archivo vive en
// src/globalFont.js: ahí se cambia la tipografía de toda la app de una vez.
applyGlobalFont();

// Ventana que tiene el cliente esperando propuestas. Los profesionales tienen 3
// minutos para responder (WorkerIncomingScreen), así que le damos uno más para
// que alcance a elegir. Si cambia uno, cambiar el otro.
const QUOTE_WINDOW_MS = 240 * 1000;

// 🔴 Vencimiento del grupo de presupuestos al RESTAURAR la pantalla (auditoría
//    23-ago). Al reabrir la app o entrar por el push "te respondieron", se seteaba
//    quoteGroupId/quoteJobs pero NUNCA la deadline: el contador quedaba clavado en
//    4:00 y nunca vencía, y el cliente podía contratar propuestas de hace días.
//    La deadline real se calcula desde el created_at del primer pedido del grupo.
const deadlineDelGrupo = (jobs) => {
  const creado = jobs?.[0]?.created_at;
  return creado
    ? new Date(creado).getTime() + QUOTE_WINDOW_MS
    : Date.now() + QUOTE_WINDOW_MS; // sin dato: arrancar el reloj ahora, no dejarlo fijo
};

WebBrowser.maybeCompleteAuthSession();

// Mostrar notificaciones aunque la app esté en primer plano
// (API nueva de expo-notifications 0.32: shouldShowBanner / shouldShowList)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

// Tarea en segundo plano: cuando llega un push de pedido con la app atrás/cerrada,
// mostramos una notificación full-screen estilo "llamada entrante" (notifee), que
// abre la app directo en la pantalla LLEGÓ PEDIDO.
const BG_INCOMING_TASK = 'BOLT_BG_INCOMING';
TaskManager.defineTask(BG_INCOMING_TASK, async ({ data }) => {
  try {
    const n = data?.notification;
    const d = n?.data || n?.request?.content?.data || data?.data || {};
    if (d?.screen === 'worker_incoming') {
      await displayIncomingJob({ jobId: d.jobId });
    }
  } catch {}
});
Notifications.registerTaskAsync(BG_INCOMING_TASK).catch(() => {});
// notifee requiere un handler de background registrado (el ruteo real lo hace
// getInitialNotification al abrir la app).
notifee.onBackgroundEvent(async () => {});

export default function App() {
  const [session, setSession]           = useState(null);
  const [loading, setLoading]           = useState(true);
  // Sólo los 4 cortes que usa el mapeo de globalFont.js. Cada uno pesa ~335 kB
  // y viaja en el OTA, así que cargar de más se paga en datos del usuario.
  // 9-ago-2026: se cambiaron ExtraBold y Black por Regular y Medium. Los dos
  // pesos gordos ya no los usa nadie —el sistema visual no pasa de 700— y
  // faltaban los finos, que son los que hacen que el texto respire.
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  const [screen, setScreen]             = useState('home');
  const [professional, setProfessional] = useState(null);

  // ── Accesos directos (deep links) ────────────────────────────────────────
  //  El acceso directo del escritorio y el atajo del ícono son configuración
  //  NATIVA: entran recién en el próximo build. Pero lo único que hacen es
  //  abrir una URL, y eso —recibirla y llevar al usuario a la pantalla que
  //  corresponde— es JavaScript puro. Así que la plomería se deja hecha y
  //  probada ahora, y cuando llegue el build el atajo sólo tiene que disparar
  //  la URL. Se prueba hoy escribiendo bolt://nuevo-presupuesto en el navegador
  //  del celular, o con:
  //    adb shell am start -a android.intent.action.VIEW -d "bolt://nuevo-presupuesto"
  const [atajo, setAtajo] = useState(null);   // 'nuevoPresupuesto' | null
  // La pestaña de abajo. La navegación dejó de vivir en el menú lateral:
  // cuatro pestañas a la vista dicen lo que la app hace sin que nadie tenga
  // que abrir la hamburguesa y adivinar (9-ago-2026).
  const [tab, setTab] = useState('home');
  // La conversación que se está mirando desde la bandeja.
  const [chatJob, setChatJob] = useState(null);
  const [modoTrabajo, setModoTrabajo] = useState(false);
  const [sinLeer, setSinLeer] = useState(0);

  useEffect(() => {
    // El login de Google vuelve por bolt://login-callback y lo maneja
    // LoginScreen: acá sólo miramos los atajos y nos hacemos a un lado.
    const leer = (url) => {
      if (!url || url.includes('login-callback')) return;
      if (/nuevo-presupuesto|nuevo_presupuesto/i.test(url)) setAtajo('nuevoPresupuesto');
    };
    Linking.getInitialURL().then(leer).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => leer(url));
    return () => sub?.remove?.();
  }, []);

  const [jobRequestData, setJobRequestData] = useState(null);
  const [assistantLoc, setAssistantLoc]     = useState(null);
  const [assistantMode, setAssistantMode]   = useState('text');
  const [assistantOficio, setAssistantOficio] = useState(null);
  const [quoteGroupId, setQuoteGroupId]     = useState(null);
  const [quoteJobs, setQuoteJobs]           = useState([]);
  // Espera del presupuesto: el reloj vive acá (no adentro de la pantalla) para
  // que el cliente pueda minimizar, seguir usando la app y volver al mismo
  // contador en vez de a uno que arranca de cero.
  const [quoteDeadline, setQuoteDeadline]   = useState(null);
  const [quoteMinimized, setQuoteMinimized] = useState(false);
  const [activeJob, setActiveJob]           = useState(null);
  const [incomingJob, setIncomingJob]       = useState(null);
  const [completedJob, setCompletedJob]     = useState(null);

  const newJobChannelRef        = useRef(null);
  const professionalRef         = useRef(null);
  // Cuando el usuario minimiza el seguimiento (vuelve al home con el trabajo en
  // segundo plano), evitamos que el polling lo re-abra a la fuerza.
  const minimizedJobRef         = useRef(false);
  const screenRef               = useRef('home');
  const recentlyCancelledJobRef = useRef(null); // evita re-navegar al job recién cancelado
  const updateListoRef          = useRef(false); // hay una actualización OTA descargada esperando

  // ─── Auth ─────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Mantener refs sincronizados para acceso desde closures (AppState / notif handlers)
  useEffect(() => { professionalRef.current = professional; }, [professional]);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // ─── Actualizaciones por aire (OTA) ───────────────────────────
  // El tester no tiene que hacer nada: la actualización se descarga sola y se
  // aplica al abrir la app o al volver a ella. Nunca en el medio de un trabajo
  // (recargar ahí le borraría la pantalla al trabajador o al cliente).
  useEffect(() => {
    if (__DEV__) return;

    const PANTALLAS_CRITICAS = ['jobTracking', 'workerIncoming', 'quoteSelection', 'jobRequest', 'rating'];
    let cancelado = false;

    const aplicarSiSePuede = async () => {
      if (cancelado || !updateListoRef.current) return;
      if (PANTALLAS_CRITICAS.includes(screenRef.current)) return;
      try { await Updates.reloadAsync(); } catch { /* se reintenta al volver */ }
    };

    const buscar = async () => {
      if (cancelado) return;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (!r.isAvailable || cancelado) return;
        await Updates.fetchUpdateAsync();
        if (cancelado) return;
        updateListoRef.current = true;
        aplicarSiSePuede();
      } catch { /* sin conexión o sin update: se reintenta en el próximo ciclo */ }
    };

    buscar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') { buscar(); aplicarSiSePuede(); }
    });

    return () => { cancelado = true; sub.remove(); };
  }, []);

  // ─── Setup notificaciones + profesional + trabajo activo ──
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    notificationService.setup(userId);
    loadProfessionalAndJobs(userId);

    // Adónde lleva una notificación cuando la tocás.
    //
    // 🔴 Antes esto exigía que el push trajera `screen`. Los avisos que le
    //    llegan a la dirección —el vigilante ("BOLT necesita una mano") y los
    //    del recorrido del pedido— mandan `jobId` pero NO mandan `screen`, así
    //    que al tocarlos no pasaba nada y quedabas en la pantalla de inicio sin
    //    saber qué tocar. Maxi, 7-ago-2026: "es como que se pierde la
    //    notificación push porque te lleva a donde no tiene que llevar".
    //
    //    Ahora el destino se DEDUCE del trabajo: alcanza con que el push traiga
    //    `jobId`. `screen` sigue valiendo cuando viene, pero ya no hace falta —
    //    así un aviso nuevo que alguien agregue mañana funciona igual aunque se
    //    olvide de mandarlo.
    const abrirTrabajo = (jobId, screenPedida) => {
      jobService.getById(jobId).then(async job => {
        if (!job) {
          // El trabajo ya no existe (lo cancelaron, lo borraron). Decirlo es
          // mejor que dejar a la persona mirando el inicio sin entender.
          Alert.alert('Ese trabajo ya no está', 'Puede que se haya cancelado o completado.');
          return;
        }
        // Un trabajo que todavía se puede tomar abre la pantalla de aceptar,
        // pero SÓLO para el profesional al que se le ofreció: al resto —la
        // dirección, por ejemplo— mostrarle "Aceptar" sería mentirle.
        const soyElProfesional =
          professionalRef.current && job.professional_id === professionalRef.current.id;
        if (job.status === 'pending' && soyElProfesional && screenPedida !== 'tracking') {
          setIncomingJob(job);
          setScreen('workerIncoming');
          return;
        }
        // 🔴 13-ago-2026 — un presupuesto que el cliente todavía no eligió NO
        //    tiene pantalla de seguimiento: primero se elige. El push de "te
        //    respondieron" (y cualquier aviso con jobId) lo mandaba igual al
        //    tracking con el quote_group_id puesto, donde no existe la hoja del
        //    cliente: mapa pelado y "Tengo un problema" (fotos de Maxi probando
        //    con Esteban). Le pasaba a él y no a Mariana porque a ella nunca la
        //    sacó de la pantalla de elegir: eligió, el grupo se limpió, y recién
        //    ahí el seguimiento tiene algo para mostrar.
        if (job.quote_group_id && !soyElProfesional) {
          const quoteData = await jobService.getActiveQuoteForClient(userId).catch(() => null);
          if (quoteData) {
            setQuoteGroupId(quoteData.quoteGroupId);
            setQuoteJobs(quoteData.jobs);
            setQuoteDeadline(deadlineDelGrupo(quoteData.jobs));
            setQuoteMinimized(false);
            setScreen('quoteSelection');
          } else {
            // El grupo ya no está esperando (venció o se canceló): decirlo es
            // mejor que abrir un seguimiento que no puede mostrar nada.
            Alert.alert('Ese pedido ya no está esperando', 'Puede que haya vencido o se haya cancelado.');
          }
          return;
        }
        // Todo lo demás va al seguimiento: es la pantalla que tiene el estado
        // real del trabajo y las acciones para moverlo, que es lo que se
        // necesita cuando un aviso dice que algo está trabado.
        minimizedJobRef.current = false;
        setActiveJob(job);
        setScreen('jobTracking');
      }).catch(() => {
        Alert.alert('No se pudo abrir el trabajo', 'Fijate que tengas internet y probá de nuevo.');
      });
    };

    const handleNotifData = (data) => {
      if (!data) return;
      disableDemo(); // un job real (desde notificación) nunca debe abrirse en modo demo

      if (data.jobId) { abrirTrabajo(data.jobId, data.screen); return; }

      // 🔴 auditoría 18-ago — el push "te respondieron el presupuesto" trae
      //    screen:'miNegocio' + presupuestoId, pero NO jobId, así que al tocarlo
      //    no pasaba nada. Llevarlo a la pestaña Mi negocio.
      if (data.presupuestoId || data.screen === 'miNegocio') {
        setScreen('home'); setTab('negocio'); return;
      }

      // Un rescate es un cliente que buscó y no encontró a nadie: no hay
      // trabajo que abrir todavía. Al menos se dice qué pasó, en vez de dejar
      // la app en el inicio como si el aviso no hubiera existido.
      if (data.rescateId) {
        Alert.alert(
          'Un cliente quedó esperando',
          'Buscó y no había nadie disponible. Miralo en el panel para asignarle un profesional.',
        );
      }
    };

    // 🔴 LA APP ARRANCÓ PORQUE TOCARON UNA NOTIFICACIÓN.
    // Los listeners de abajo sólo escuchan mientras la app está VIVA. Si estaba
    // cerrada, Android la abre y ese toque se pierde: el profesional entraba a
    // la pantalla de siempre y el trabajo no aparecía por ningún lado —tenía
    // que ir a "Mis trabajos" a buscarlo, y nadie hace eso (Maxi, 1-ago:
    // "la gente si no tiene el trabajo en el medio de la pantalla, la cierra y
    // piensa que no tiene nada"). Esto le pregunta a Android por qué la
    // abrieron y abre el trabajo derecho.
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        const data = res?.notification?.request?.content?.data;
        if (data) handleNotifData(data);
      })
      .catch(() => {});

    // 🔴 Una notificación que LLEGA con la app abierta muestra el banner (arriba)
    //    y NADA MÁS (auditoría 23-ago, informe 09). Antes navegaba con cada push:
    //    al cliente que estaba eligiendo un presupuesto, el push de "te
    //    respondieron" de OTRO profesional lo arrastraba de pantalla. La
    //    navegación ocurre SÓLO cuando el usuario TOCA la notificación (responseSub).
    const receivedSub = Notifications.addNotificationReceivedListener(() => {});
    const responseSub = Notifications.addNotificationResponseReceivedListener(r =>
      handleNotifData(r.notification.request.content.data)
    );

    // Chequeo de trabajos del trabajador (pendientes/activos). Cubre el caso donde
    // el Realtime falla (RLS con subconsulta, red intermitente, etc.): se dispara al
    // volver a primer plano Y por polling mientras está en el home, así el pedido
    // entra aunque el Realtime no emita el INSERT.
    const checkWorkerJobs = async () => {
      const prof = professionalRef.current;
      const sc   = screenRef.current;
      if (!prof || sc !== 'home') return;
      try {
        const [active, pending] = await Promise.all([
          jobService.getActiveForWorker(prof.id),
          jobService.getPendingForWorker(prof.id),
        ]);
        if (active) {
          if (active.id === recentlyCancelledJobRef.current) return; // recién cancelado, ignorar
          disableDemo();
          setActiveJob(active);
          // Si el usuario minimizó el seguimiento, lo dejamos en el home (con el
          // banner de "trabajo en curso") en vez de re-abrirlo a la fuerza.
          if (!minimizedJobRef.current) setScreen('jobTracking');
          return;
        }
        if (pending.length > 0) { disableDemo(); setIncomingJob(pending[0]); setScreen('workerIncoming'); }
      } catch { /* silent */ }
    };

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') checkWorkerJobs();
    });

    // Polling de respaldo: cada 10 s mientras el trabajador está en el home, por si
    // el Realtime no entrega el pedido (la app puede estar abierta todo el tiempo).
    const pollInterval = setInterval(checkWorkerJobs, 10000);

    return () => {
      receivedSub.remove();
      responseSub.remove();
      appStateSub.remove();
      clearInterval(pollInterval);
      newJobChannelRef.current?.unsubscribe?.();
    };
  }, [session?.user?.id]);

  // Ruteo desde la notificación full-screen "estilo llamada" (notifee):
  // al abrir la app (cold start) o al tocarla mientras corre, vamos directo
  // a la pantalla LLEGÓ PEDIDO.
  useEffect(() => {
    const routeIncoming = (jobId) => {
      if (!jobId) return;
      disableDemo();
      jobService.getById(jobId).then(job => {
        cancelIncomingJob(); // descartar la notificación full-screen: ya la tocaron
        // 🔴 Sólo abrir "Aceptar" si el pedido sigue vivo (pending) y es para ESTE
        //    profesional (auditoría 23-ago). Antes abría la pantalla de aceptar con
        //    cualquier job: tocar una notificación vieja "LLEGÓ UN PEDIDO" reabría
        //    Aceptar sobre un trabajo ya aceptado o cancelado, el profesional
        //    aceptaba, y revivía un cancelado (push falso al cliente).
        const soyElProfesional =
          professionalRef.current && job?.professional_id === professionalRef.current.id;
        if (job && job.status === 'pending' && soyElProfesional) {
          setIncomingJob(job);
          setScreen('workerIncoming');
        } else {
          Alert.alert('Ese pedido ya no está', 'Puede que lo haya tomado otro, se haya cancelado o vencido.');
        }
      }).catch(() => {});
    };
    notifee.getInitialNotification().then(initial => {
      const d = initial?.notification?.data;
      if (d?.screen === 'worker_incoming') routeIncoming(d.jobId);
    }).catch(() => {});
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        const d = detail?.notification?.data;
        if (d?.screen === 'worker_incoming') routeIncoming(d.jobId);
      }
    });
    return unsub;
  }, []);

  // Suscripción a trabajos nuevos del trabajador. Un job real (desde la base)
  // nunca debe abrirse en modo demo, así que lo apagamos en el callback.
  const startWorkerJobSubscription = (profId) => {
    newJobChannelRef.current?.unsubscribe?.();
    newJobChannelRef.current = jobService.subscribeNewJobsForWorker(profId, (job) => {
      disableDemo();
      setIncomingJob(job);
      setScreen('workerIncoming');
    });
  };

  const loadProfessionalAndJobs = async (userId) => {
    disableDemo(); // arrancamos siempre una sesión real limpia
    try {
      const prof = await professionalService.getByUserId(userId);
      setProfessional(prof);

      if (prof) {
        ensureFullScreenPermission(); // pedir permiso de pantalla completa (Android 14+)

        // 🔴 La suscripción arranca SIEMPRE, antes de cualquier salida temprana.
        // Estaba al final y los `return` de abajo la salteaban: si el profesional
        // abría la app justo con un trabajo en curso o un pedido pendiente, se
        // quedaba toda esa sesión sin Realtime y sólo se enteraba de los pedidos
        // siguientes por push o por el sondeo (que además sólo corre en el home).
        // Es idempotente: se da de baja el canal anterior antes de crear el nuevo.
        startWorkerJobSubscription(prof.id);

        const [active, pending] = await Promise.all([
          jobService.getActiveForWorker(prof.id),
          jobService.getPendingForWorker(prof.id),
        ]);
        if (active) {
          setActiveJob(active);
          setScreen('jobTracking');
          return;
        }
        if (pending.length > 0) {
          setIncomingJob(pending[0]);
          setScreen('workerIncoming');
          return;
        }
      }

      // 🔴 También un PROFESIONAL puede haber pedido un servicio como cliente
      //    (auditoría 23-ago): esto vivía en el `else` de if(prof), así que un
      //    profesional sin trabajo activo como trabajador nunca veía su propio
      //    pedido al reabrir la app. Ahora la restauración de cliente corre
      //    siempre que la rama del trabajador no haya encontrado nada.
      const quoteData = await jobService.getActiveQuoteForClient(userId);
      if (quoteData) {
        setQuoteGroupId(quoteData.quoteGroupId);
        setQuoteJobs(quoteData.jobs);
        setQuoteDeadline(deadlineDelGrupo(quoteData.jobs));
        setScreen('quoteSelection');
        return;
      }

      const activeCliente = await jobService.getActiveForClient(userId);
      if (activeCliente) {
        setActiveJob(activeCliente);
        setScreen('jobTracking');
      }
    } catch { /* silent */ }
  };

  // ─── Callbacks de HomeScreen ──────────────────────────
  const handleRequestJob = (worker, profession, userLocation) => {
    setJobRequestData({ worker, profession, userLocation });
    setScreen('jobRequest');
  };

  const handleActiveJob   = (job) => { minimizedJobRef.current = false; setActiveJob(job); setScreen('jobTracking'); };
  const handleIncomingJob = (job) => { setIncomingJob(job); setScreen('workerIncoming'); };

  // ─── Asistente IA (entrada conversacional) ────────────
  // El tercer parámetro es el oficio que tocó en el home: el asistente arranca
  // con la frase empezada en vez de con la hoja en blanco.
  const handleOpenAssistant = (userLocation, mode = 'text', oficio = null) => {
    setAssistantLoc(userLocation || null);
    setAssistantMode(mode);
    setAssistantOficio(oficio);
    setScreen('assistant');
  };

  // Cuando el asistente terminó de armar el pedido → vamos a la PLANTILLA clásica
  // (JobRequestScreen) precargada, que sigue el flujo normal (3 presupuestos → tracking).
  // worker:null = modo automático (la plantilla busca los 3 cercanos del oficio detectado).
  const handleAssistantReady = (profession, notes, fotos) => {
    setJobRequestData({ worker: null, profession, userLocation: assistantLoc, initialNotes: notes, initialPhotos: fotos || [] });
    setScreen('jobRequest');
  };

  // ─── Callbacks de JobRequestScreen ───────────────────
  const handleQuoteGroupCreated = (groupId, jobs) => {
    setQuoteGroupId(groupId);
    setQuoteJobs(jobs);
    setQuoteDeadline(Date.now() + QUOTE_WINDOW_MS);
    setQuoteMinimized(false);
    setJobRequestData(null);
    setScreen('quoteSelection');
  };

  const limpiarQuote = () => {
    setQuoteGroupId(null); setQuoteJobs([]); setQuoteDeadline(null); setQuoteMinimized(false);
  };

  // ─── Callbacks de QuoteSelectionScreen ───────────────
  const handleWorkerSelected = (job) => {
    limpiarQuote();
    // 🔴 10-ago-2026 — el job que llega acá viene de la lista de presupuestos y
    //    TODAVÍA trae `quote_group_id`: en la base ya se borró, pero este objeto
    //    es una copia vieja. La pantalla de entrega del contacto pide que no
    //    haya grupo, así que durante un instante mostraba el seguimiento y
    //    recién cuando llegaba el realtime cambiaba: se veía un parpadeo
    //    (Maxi: "se abren y se cierran en un milisegundo").
    //    Se limpia acá, que es donde ya sabemos que fue elegido.
    setActiveJob({ ...job, quote_group_id: null, status: job.status || 'accepted' });
    setScreen('jobTracking');
  };

  const handleQuoteExpired = () => { disableDemo(); limpiarQuote(); setScreen('home'); };

  // "Seguir usando la app": NO cancela nada, solo esconde la pantalla. Las
  // solicitudes siguen vivas y la burbuja del home lo trae de vuelta.
  const handleQuoteMinimize = () => { setQuoteMinimized(true); setScreen('home'); };
  const handleQuoteResume   = () => { setQuoteMinimized(false); setScreen('quoteSelection'); };

  // Con la pantalla de propuestas minimizada nadie escucha las respuestas: la
  // suscripción vive adentro de esa pantalla. Acá seguimos mirando cada 5 s y le
  // avisamos apenas alguien responde, así "seguir usando la app" no significa
  // perderse el presupuesto.
  useEffect(() => {
    if (!quoteMinimized || !quoteGroupId) return;
    let vivo = true;
    let avisados = quoteJobs.filter(j => j.status === 'accepted').length;
    const t = setInterval(async () => {
      try {
        const fresh = await jobService.getQuoteGroup(quoteGroupId);
        if (!vivo || !fresh?.length) return;
        setQuoteJobs(prev => prev.map(j => fresh.find(f => f.id === j.id) ?? j));
        const responden = fresh.filter(j => j.status === 'accepted').length;
        if (responden > avisados) {
          avisados = responden;
          showInfo(
            responden === 1 ? 'Un profesional te respondió. Tocá la burbuja para verlo.'
                            : `${responden} profesionales te respondieron.`,
            'Tenés propuestas'
          );
        }
      } catch { /* silencioso: es un respaldo, no puede molestar */ }
    }, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [quoteMinimized, quoteGroupId]);

  const handleQuoteBack = async () => {
    if (quoteGroupId && quoteJobs.length > 0) {
      const activos = quoteJobs.filter(j => ['pending', 'accepted'].includes(j.status));
      const uid = session?.user?.id;
      // Con tope de tiempo: cancelar no puede dejar al cliente clavado si la
      // red no vuelve (era el único await de este camino sin vencimiento).
      // 🔴 auditoría 18-ago — con centinela: si venció o falló, avisamos y
      //    reintentamos en segundo plano en vez de dar la cancelación por hecha.
      const FALLO = Symbol('fallo');
      const r = await conTiempo(
        Promise.all(activos.map(j => jobService.cancel(j.id, uid))),
        15000,
        FALLO
      );
      if (r === FALLO) {
        Alert.alert('No pudimos confirmar la cancelación', 'La reintentamos solos en un momento.');
        activos.forEach(j => jobService.cancel(j.id, uid).catch(() => {}));
      }
      // Los que ya habían respondido estaban esperando la elección: se les
      // avisa que no siga esperando. Sin await — son avisos.
      activos
        .filter(j => j.status === 'accepted')
        .forEach(j => notificationService.sendToUser(j.professionals?.user_id, {
          title: 'El cliente canceló la búsqueda',
          body:  'No te preocupes, seguirán llegando solicitudes.',
          data:  { jobId: j.id },
        }).catch(() => {}));
    }
    disableDemo();
    limpiarQuote(); setScreen('home');
  };

  // ─── Callbacks de WorkerIncomingScreen ───────────────
  // 🔴 auditoría 18-ago — al aceptar/rechazar desde ADENTRO de la app la alarma
  //    estilo llamada seguía sonando hasta 3 min (sólo se cancelaba al rutear
  //    desde la notificación). Cortarla acá también.
  const handleWorkerAccepted = (job) => { cancelIncomingJob(); setIncomingJob(null); setActiveJob(job); setScreen('jobTracking'); };

  const handleWorkerRejected = () => {
    cancelIncomingJob();
    disableDemo();
    setIncomingJob(null);
    setScreen('home');
    if (professional) startWorkerJobSubscription(professional.id);
  };

  // ─── Callbacks de JobTrackingScreen ──────────────────
  const handleJobComplete = (job) => {
    minimizedJobRef.current = false;
    setActiveJob(null);
    // El rol se define por ESTE trabajo, no por tener perfil de profesional:
    // si el usuario fue el CLIENTE del job → califica; si fue el trabajador →
    // vuelve al home. (Un trabajador también puede ser cliente en otros trabajos.)
    const uid = session?.user?.id;
    if (job?.client_id === uid) { setCompletedJob(job); setScreen('rating'); }
    else                        { disableDemo(); setScreen('home'); }
  };

  const handleJobCancel = () => {
    // Bloquear el AppState listener para que no re-navegue al mismo job durante 10 seg
    recentlyCancelledJobRef.current = activeJob?.id;
    setTimeout(() => { recentlyCancelledJobRef.current = null; }, 10000);
    disableDemo();
    minimizedJobRef.current = false;
    setActiveJob(null);
    setScreen('home');
    // Re-suscribir al trabajador para que reciba nuevos jobs
    if (professional) startWorkerJobSubscription(professional.id);
  };

  // ─── Callbacks de RatingScreen ────────────────────────
  const handleRatingDone = () => { disableDemo(); setCompletedJob(null); setScreen('home'); };

  // El modo lo cambia el usuario desde el Home y queda guardado. Acá se lee
  // para saber qué pestañas mostrar, y se relee cada vez que se vuelve al home.
  useEffect(() => {
    if (screen !== 'home') return;
    AsyncStorage.getItem('bolt.modo')
      .then(v => setModoTrabajo(v === 'trabajo'))
      .catch(() => {});
  }, [screen, tab]);

  // El contador de la pestaña Chats. Cada 20 s alcanza: los mensajes de un
  // trabajo abierto ya llegan por su propio canal.
  useEffect(() => {
    if (!session?.user?.id) return;
    const traer = () => chatService
      .getConversaciones(session.user.id, professional?.id)
      .then(cs => setSinLeer(cs.reduce((a, c) => a + c.sinLeer, 0)))
      .catch(() => {});
    traer();
    const t = setInterval(traer, 20000);
    return () => clearInterval(t);
  }, [session?.user?.id, professional?.id, tab]);

  // 🔴 auditoría 18-ago — al cerrar el chat desde la bandeja no se marcaba nada
  //    como leído: el badge seguía contando mensajes ya vistos. Marcamos leído y
  //    refrescamos el contador al cerrar.
  const closeChatJob = () => {
    const j = chatJob;
    const uid = session?.user?.id;
    if (j?.id && uid) {
      chatService.markAsRead(j.id, uid)
        .then(() => chatService.getConversaciones(uid, professional?.id))
        .then(cs => setSinLeer(cs.reduce((a, c) => a + c.sinLeer, 0)))
        .catch(() => {});
    }
    setChatJob(null);
  };

  // ─── Render ───────────────────────────────────────────
  const renderScreen = () => {
    // En el demo del lado trabajador fingimos un profesional para ver su vista
    const effProfessional = (isDemoMode() && getDemoRole() === 'worker') ? DEMO_PROFESSIONAL : professional;
    if (loading || !fontsLoaded) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A0A' }}>
          <ActivityIndicator size="large" color="#FFD600" />
        </View>
      );
    }
    if (!session) return <LoginScreen />;
    if (screen === 'assistant') {
      return (
        <AssistantScreen
          clientId={session.user.id}
          userLocation={assistantLoc}
          mode={assistantMode}
          oficio={assistantOficio}
          onReady={handleAssistantReady}
          onBack={() => setScreen('home')}
        />
      );
    }
    if (screen === 'jobRequest' && jobRequestData) {
      return (
        <JobRequestScreen
          worker={jobRequestData.worker}
          profession={jobRequestData.profession}
          clientId={session.user.id}
          userLocation={jobRequestData.userLocation}
          initialNotes={jobRequestData.initialNotes}
          initialPhotos={jobRequestData.initialPhotos}
          onQuoteGroupCreated={handleQuoteGroupCreated}
          onBack={() => setScreen('home')}
        />
      );
    }
    if (screen === 'quoteSelection' && quoteGroupId) {
      return (
        <QuoteSelectionScreen
          quoteGroupId={quoteGroupId}
          jobs={quoteJobs}
          clientId={session.user.id}
          deadline={quoteDeadline}
          onSelected={handleWorkerSelected}
          onExpired={handleQuoteExpired}
          onMinimize={handleQuoteMinimize}
          onBack={handleQuoteBack}
        />
      );
    }
    if (screen === 'workerIncoming' && incomingJob) {
      return (
        <WorkerIncomingScreen
          key={incomingJob.id}
          job={incomingJob}
          professional={effProfessional}
          clientUserId={incomingJob.client_id}
          onAccepted={handleWorkerAccepted}
          onRejected={handleWorkerRejected}
        />
      );
    }
    // 🔴 10-ago-2026 — un pedido en `pending` es uno que el profesional TODAVÍA
    //    no contestó: su pantalla es la del contador, no la del seguimiento.
    //    Si llegaba acá —por una notificación, por el pin, por el polling—
    //    quedaba colgado sin poder aceptarlo (Maxi). Se lo manda a donde va.
    if (screen === 'jobTracking' && activeJob?.status === 'pending' &&
        effProfessional && activeJob.professional_id === effProfessional.id) {
      return (
        <WorkerIncomingScreen
          key={activeJob.id}
          job={activeJob}
          professional={effProfessional}
          clientUserId={activeJob.client_id}
          onAccepted={handleWorkerAccepted}
          onRejected={handleWorkerRejected}
        />
      );
    }
    if (screen === 'jobTracking' && activeJob) {
      return (
        <JobTrackingScreen
          job={activeJob}
          session={session}
          professional={effProfessional}
          onComplete={handleJobComplete}
          onCancel={handleJobCancel}
          onBack={() => { minimizedJobRef.current = true; setScreen('home'); }}
        />
      );
    }
    if (screen === 'rating' && completedJob) {
      return (
        <RatingScreen
          job={completedJob}
          session={session}
          professional={professional}
          onDone={handleRatingDone}
        />
      );
    }
    // ── Las pestañas ──────────────────────────────────────────────────────
    if (tab === 'chats') {
      return (
        <ChatsScreen
          session={session}
          professional={effProfessional}
          // 🔴 10-ago-2026 — tocar una conversación abría la pantalla del
          //    TRABAJO, y si ese trabajo ya estaba terminado esa pantalla
          //    dispara sola la calificación: entrabas a leer un mensaje y te
          //    aparecía "¿cómo estuvo el trabajo?" (Maxi). Una conversación se
          //    abre en el chat y nada más.
          onOpenChat={(job) => setChatJob(job)}
        />
      );
    }
    if (tab === 'pedidos') {
      return (
        <HistoryScreen
          session={session}
          professional={effProfessional}
          onOpenJob={(job) => { setActiveJob(job); minimizedJobRef.current = false; setScreen('jobTracking'); }}
          onClose={() => setTab('home')}
        />
      );
    }
    if (tab === 'negocio' && effProfessional) {
      return (
        <MiNegocioScreen
          professional={effProfessional}
          session={session}
          onClose={() => setTab('home')}
        />
      );
    }
    if (tab === 'cuenta') {
      return (
        <ProfileScreen
          session={session}
          professional={effProfessional}
          onClose={() => setTab('home')}
        />
      );
    }
    return (
      <HomeScreen
        session={session}
        professional={professional}
        atajo={atajo}
        onAtajoUsado={() => setAtajo(null)}
        onRequestJob={handleRequestJob}
        onOpenAssistant={handleOpenAssistant}
        onActiveJob={handleActiveJob}
        onIncomingJob={handleIncomingJob}
        activeJob={activeJob}
      />
    );
  };

  // La barra sólo va en las pestañas. En medio de un pedido —eligiendo
  // presupuesto, aceptando un trabajo, calificando— cambiar de pantalla de un
  // toque sería perder lo que estás haciendo.
  const mostrarTabs = !!session && !loading && fontsLoaded &&
    ['home'].includes(screen);

  // ─── El pin del trabajo en curso ───────────────────────────────────────────
  // 🔴 8-ago-2026 — vivía adentro del Home, así que minimizar el seguimiento y
  //    entrar a cualquier otra pantalla te dejaba sin forma de volver: había que
  //    salir al home primero. Ahora vive acá arriba y se ve en TODAS, menos en
  //    la del propio trabajo y en las que no se pueden interrumpir (aceptar un
  //    pedido, elegir presupuesto, calificar): ahí un pin encima sería una
  //    trampa para el dedo.
  //    Recuerda dónde lo dejó el usuario (`storageKey`) y se pega al borde.
  const jobEnCurso = activeJob && ['pending','accepted','arrived','in_progress','awaiting_payment'].includes(activeJob.status);
  const SIN_PIN = ['jobTracking', 'workerIncoming', 'quoteSelection', 'rating'];
  const mostrarPinJob   = !!jobEnCurso && !SIN_PIN.includes(screen);
  const mostrarPinQuote = quoteMinimized && !!quoteGroupId && !SIN_PIN.includes(screen);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <View style={{ flex: 1, backgroundColor: '#0D0D0D' }}>
          {renderScreen()}
          {chatJob && (
          <Modal visible animationType="slide" onRequestClose={closeChatJob}>
            <ChatScreen
              job={chatJob}
              userId={session?.user?.id}
              isWorker={
                !!chatJob.professional_id &&
                session?.user?.id !== chatJob.client_id
              }
              onClose={closeChatJob}
            />
          </Modal>
        )}
        {mostrarTabs && (
            <TabBar
              tab={tab}
              modoTrabajo={modoTrabajo && !!professional}
              sinLeer={sinLeer}
              onChange={setTab}
            />
          )}
        </View>
        {mostrarPinJob && (
          <DraggableBubble
            icon="navigate"
            storageKey="bolt.pin.trabajo"
            dotColor="#FFD600"
            onPress={() => { minimizedJobRef.current = false; setScreen('jobTracking'); }}
          />
        )}
        {/* El de los presupuestos lleva el reloj adentro: si se vence sin que
            vuelva, pierde las respuestas. Por eso va separado y con contador. */}
        {mostrarPinQuote && (
          <DraggableBubble
            icon="hourglass"
            storageKey="bolt.pin.presupuesto"
            deadline={quoteDeadline}
            badgeCount={quoteJobs.filter(j => j.status === 'accepted').length}
            onPress={handleQuoteResume}
          />
        )}
        <StatusBar style="light" />
        <Toast config={toastConfig} />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

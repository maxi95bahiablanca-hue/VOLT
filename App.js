import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, AppState, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import ErrorBoundary from './src/components/ErrorBoundary';
import { toastConfig, showInfo } from './src/utils/toast';
import { supabase } from './src/supabase';
import notificationService from './src/services/notificationService';
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
import {
  useFonts,
  Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black,
} from '@expo-google-fonts/inter';
import { applyGlobalFont } from './src/globalFont';

// Aplica la fuente Inter a toda la app. El mapeo peso → archivo vive en
// src/globalFont.js: ahí se cambia la tipografía de toda la app de una vez.
applyGlobalFont();

// Ventana que tiene el cliente esperando propuestas. Los profesionales tienen 3
// minutos para responder (WorkerIncomingScreen), así que le damos uno más para
// que alcance a elegir. Si cambia uno, cambiar el otro.
const QUOTE_WINDOW_MS = 240 * 1000;

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
  const [fontsLoaded] = useFonts({
    Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black,
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

    const handleNotifData = (data) => {
      if (!data) return;
      disableDemo(); // un job real (desde notificación) nunca debe abrirse en modo demo
      if (data.screen === 'tracking' && data.jobId) {
        jobService.getById(data.jobId).then(job => {
          if (job) { minimizedJobRef.current = false; setActiveJob(job); setScreen('jobTracking'); }
        }).catch(() => {});
      }
      if (data.screen === 'worker_incoming' && data.jobId) {
        jobService.getById(data.jobId).then(job => {
          if (!job) return;
          // Todavía se puede tomar → la pantalla del trabajo entrante.
          if (job.status === 'pending') { setIncomingJob(job); setScreen('workerIncoming'); return; }
          // Ya lo respondió (o lo tomó otro): abrirle la pantalla de aceptar
          // sería mentirle. Se lo lleva al seguimiento, que es donde está la
          // verdad de ese trabajo, en vez de dejarlo en la pantalla de inicio
          // sin entender qué pasó (Maxi, 1-ago).
          if (['accepted', 'arrived', 'in_progress', 'awaiting_payment'].includes(job.status)) {
            minimizedJobRef.current = false;
            setActiveJob(job);
            setScreen('jobTracking');
          }
        }).catch(() => {});
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

    const receivedSub = Notifications.addNotificationReceivedListener(n =>
      handleNotifData(n.request.content.data)
    );
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
        if (job) { setIncomingJob(job); setScreen('workerIncoming'); cancelIncomingJob(); }
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
      } else {
        const quoteData = await jobService.getActiveQuoteForClient(userId);
        if (quoteData) {
          setQuoteGroupId(quoteData.quoteGroupId);
          setQuoteJobs(quoteData.jobs);
          setScreen('quoteSelection');
          return;
        }

        const active = await jobService.getActiveForClient(userId);
        if (active) {
          setActiveJob(active);
          setScreen('jobTracking');
        }
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
  const handleOpenAssistant = (userLocation, mode = 'text') => {
    setAssistantLoc(userLocation || null);
    setAssistantMode(mode);
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
    limpiarQuote(); setActiveJob(job); setScreen('jobTracking');
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
      await Promise.all(
        quoteJobs
          .filter(j => ['pending', 'accepted'].includes(j.status))
          .map(j => jobService.cancel(j.id, session?.user?.id))
      ).catch(() => {});
    }
    disableDemo();
    limpiarQuote(); setScreen('home');
  };

  // ─── Callbacks de WorkerIncomingScreen ───────────────
  const handleWorkerAccepted = (job) => { setIncomingJob(null); setActiveJob(job); setScreen('jobTracking'); };

  const handleWorkerRejected = () => {
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
          job={incomingJob}
          professional={effProfessional}
          clientUserId={incomingJob.client_id}
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
        onResumeJob={() => { minimizedJobRef.current = false; setScreen('jobTracking'); }}
        quoteWaiting={quoteMinimized && !!quoteGroupId}
        quoteDeadline={quoteDeadline}
        quoteResponded={quoteJobs.filter(j => j.status === 'accepted').length}
        onResumeQuote={handleQuoteResume}
      />
    );
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        {renderScreen()}
        <StatusBar style="light" />
        <Toast config={toastConfig} />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

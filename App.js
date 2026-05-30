import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import ErrorBoundary from './src/components/ErrorBoundary';
import { toastConfig } from './src/utils/toast';
import { supabase } from './src/supabase';
import notificationService from './src/services/notificationService';
import jobService from './src/services/jobService';
import professionalService from './src/services/professionalService';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import JobRequestScreen from './src/screens/JobRequestScreen';
import QuoteSelectionScreen from './src/screens/QuoteSelectionScreen';
import WorkerIncomingScreen from './src/screens/WorkerIncomingScreen';
import JobTrackingScreen from './src/screens/JobTrackingScreen';
import RatingScreen from './src/screens/RatingScreen';

WebBrowser.maybeCompleteAuthSession();

// Mostrar notificaciones aunque la app esté en primer plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

export default function App() {
  const [session, setSession]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [screen, setScreen]             = useState('home');
  const [professional, setProfessional] = useState(null);

  const [jobRequestData, setJobRequestData] = useState(null);
  const [quoteGroupId, setQuoteGroupId]     = useState(null);
  const [quoteJobs, setQuoteJobs]           = useState([]);
  const [activeJob, setActiveJob]           = useState(null);
  const [incomingJob, setIncomingJob]       = useState(null);
  const [completedJob, setCompletedJob]     = useState(null);

  const newJobChannelRef  = useRef(null);
  const professionalRef   = useRef(null);  // ref para acceder desde AppState / notif handlers
  const screenRef         = useRef('home');

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

  // ─── Setup notificaciones + profesional + trabajo activo ──
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    notificationService.setup(userId);
    loadProfessionalAndJobs(userId);

    const handleNotifData = (data) => {
      if (!data) return;
      if (data.screen === 'tracking' && data.jobId) {
        jobService.getById(data.jobId).then(job => {
          if (job) { setActiveJob(job); setScreen('jobTracking'); }
        }).catch(() => {});
      }
      if (data.screen === 'worker_incoming' && data.jobId) {
        jobService.getById(data.jobId).then(job => {
          if (job) { setIncomingJob(job); setScreen('workerIncoming'); }
        }).catch(() => {});
      }
    };

    const receivedSub = Notifications.addNotificationReceivedListener(n =>
      handleNotifData(n.request.content.data)
    );
    const responseSub = Notifications.addNotificationResponseReceivedListener(r =>
      handleNotifData(r.notification.request.content.data)
    );

    // Cuando la app vuelve a primer plano, re-chequeamos trabajos pendientes
    // Esto cubre el caso donde el Realtime falló o el teléfono estaba sin red.
    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') return;
      const prof = professionalRef.current;
      const sc   = screenRef.current;
      if (!prof || sc !== 'home') return;
      try {
        const [active, pending] = await Promise.all([
          jobService.getActiveForWorker(prof.id),
          jobService.getPendingForWorker(prof.id),
        ]);
        if (active) { setActiveJob(active); setScreen('jobTracking'); return; }
        if (pending.length > 0) { setIncomingJob(pending[0]); setScreen('workerIncoming'); }
      } catch { /* silent */ }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
      appStateSub.remove();
      newJobChannelRef.current?.unsubscribe?.();
    };
  }, [session?.user?.id]);

  const loadProfessionalAndJobs = async (userId) => {
    try {
      const prof = await professionalService.getByUserId(userId);
      setProfessional(prof);

      if (prof) {
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

        newJobChannelRef.current = jobService.subscribeNewJobsForWorker(prof.id, (job) => {
          setIncomingJob(job);
          setScreen('workerIncoming');
        });
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

  const handleActiveJob   = (job) => { setActiveJob(job);   setScreen('jobTracking');   };
  const handleIncomingJob = (job) => { setIncomingJob(job); setScreen('workerIncoming'); };

  // ─── Callbacks de JobRequestScreen ───────────────────
  const handleQuoteGroupCreated = (groupId, jobs) => {
    setQuoteGroupId(groupId);
    setQuoteJobs(jobs);
    setJobRequestData(null);
    setScreen('quoteSelection');
  };

  // ─── Callbacks de QuoteSelectionScreen ───────────────
  const handleWorkerSelected = (job) => {
    setQuoteGroupId(null); setQuoteJobs([]); setActiveJob(job); setScreen('jobTracking');
  };

  const handleQuoteExpired = () => { setQuoteGroupId(null); setQuoteJobs([]); setScreen('home'); };

  const handleQuoteBack = async () => {
    if (quoteGroupId && quoteJobs.length > 0) {
      await Promise.all(
        quoteJobs
          .filter(j => ['pending', 'accepted'].includes(j.status))
          .map(j => jobService.cancel(j.id, session?.user?.id))
      ).catch(() => {});
    }
    setQuoteGroupId(null); setQuoteJobs([]); setScreen('home');
  };

  // ─── Callbacks de WorkerIncomingScreen ───────────────
  const handleWorkerAccepted = (job) => { setIncomingJob(null); setActiveJob(job); setScreen('jobTracking'); };

  const handleWorkerRejected = () => {
    setIncomingJob(null);
    setScreen('home');
    if (professional) {
      newJobChannelRef.current?.unsubscribe?.();
      newJobChannelRef.current = jobService.subscribeNewJobsForWorker(professional.id, (job) => {
        setIncomingJob(job);
        setScreen('workerIncoming');
      });
    }
  };

  // ─── Callbacks de JobTrackingScreen ──────────────────
  const handleJobComplete = (job) => {
    setActiveJob(null);
    if (!professional) { setCompletedJob(job); setScreen('rating'); }
    else               { setScreen('home'); }
  };

  const handleJobCancel = () => { setActiveJob(null); setScreen('home'); };

  // ─── Callbacks de RatingScreen ────────────────────────
  const handleRatingDone = () => { setCompletedJob(null); setScreen('home'); };

  // ─── Render ───────────────────────────────────────────
  const renderScreen = () => {
    if (loading) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A0A' }}>
          <ActivityIndicator size="large" color="#FFD600" />
        </View>
      );
    }
    if (!session) return <LoginScreen />;
    if (screen === 'jobRequest' && jobRequestData) {
      return (
        <JobRequestScreen
          worker={jobRequestData.worker}
          profession={jobRequestData.profession}
          clientId={session.user.id}
          userLocation={jobRequestData.userLocation}
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
          onSelected={handleWorkerSelected}
          onExpired={handleQuoteExpired}
          onBack={handleQuoteBack}
        />
      );
    }
    if (screen === 'workerIncoming' && incomingJob) {
      return (
        <WorkerIncomingScreen
          job={incomingJob}
          professional={professional}
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
          professional={professional}
          onComplete={handleJobComplete}
          onCancel={handleJobCancel}
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
        onRequestJob={handleRequestJob}
        onActiveJob={handleActiveJob}
        onIncomingJob={handleIncomingJob}
      />
    );
  };

  return (
    <ErrorBoundary>
      {renderScreen()}
      <StatusBar style="light" />
      <Toast config={toastConfig} />
    </ErrorBoundary>
  );
}

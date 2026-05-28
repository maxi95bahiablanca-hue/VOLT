import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import ErrorBoundary from './src/components/ErrorBoundary';
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

// Capturador global — muestra el error antes de que la app crashee
if (!__DEV__) {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    Alert.alert(
      isFatal ? 'CRASH FATAL' : 'Error JS',
      String(error?.stack || error?.message || error).slice(0, 800),
      [{ text: 'OK' }]
    );
    prev?.(error, isFatal);
  });
}

// Screens: 'home' | 'jobRequest' | 'quoteSelection' | 'workerIncoming' | 'jobTracking' | 'rating'

export default function App() {
  const [session, setSession]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [screen, setScreen]             = useState('home');
  const [professional, setProfessional] = useState(null);

  const [jobRequestData, setJobRequestData] = useState(null); // { worker, profession, userLocation }
  const [quoteGroupId, setQuoteGroupId]     = useState(null);
  const [quoteJobs, setQuoteJobs]           = useState([]);
  const [activeJob, setActiveJob]           = useState(null);
  const [incomingJob, setIncomingJob]       = useState(null);
  const [completedJob, setCompletedJob]     = useState(null);

  const newJobChannelRef = useRef(null);

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

  // ─── Setup notificaciones + profesional + trabajo activo ──
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    notificationService.setup(userId);
    loadProfessionalAndJobs(userId);

    return () => {
      newJobChannelRef.current?.unsubscribe?.();
    };
  }, [session?.user?.id]);

  const loadProfessionalAndJobs = async (userId) => {
    try {
      const prof = await professionalService.getByUserId(userId);
      setProfessional(prof);

      if (prof) {
        // Trabajador: buscar trabajo activo o pendiente
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

        // Suscribir a nuevos trabajos
        newJobChannelRef.current = jobService.subscribeNewJobsForWorker(prof.id, (job) => {
          setIncomingJob(job);
          setScreen('workerIncoming');
        });
      } else {
        // Cliente: primero buscar grupo de cotización activo
        const quoteData = await jobService.getActiveQuoteForClient(userId);
        if (quoteData) {
          setQuoteGroupId(quoteData.quoteGroupId);
          setQuoteJobs(quoteData.jobs);
          setScreen('quoteSelection');
          return;
        }

        // Luego buscar trabajo activo (post-selección)
        const active = await jobService.getActiveForClient(userId);
        if (active) {
          setActiveJob(active);
          setScreen('jobTracking');
        }
      }
    } catch { /* silent */ }
  };

  // Listener de notificaciones — activo solo en build de producción (EAS)

  // ─── Callbacks de HomeScreen ──────────────────────────
  const handleRequestJob = (worker, profession, userLocation) => {
    setJobRequestData({ worker, profession, userLocation });
    setScreen('jobRequest');
  };

  const handleActiveJob = (job) => {
    setActiveJob(job);
    setScreen('jobTracking');
  };

  const handleIncomingJob = (job) => {
    setIncomingJob(job);
    setScreen('workerIncoming');
  };

  // ─── Callbacks de JobRequestScreen ───────────────────
  const handleQuoteGroupCreated = (groupId, jobs) => {
    setQuoteGroupId(groupId);
    setQuoteJobs(jobs);
    setJobRequestData(null);
    setScreen('quoteSelection');
  };

  // ─── Callbacks de QuoteSelectionScreen ───────────────
  const handleWorkerSelected = (job) => {
    setQuoteGroupId(null);
    setQuoteJobs([]);
    setActiveJob(job);
    setScreen('jobTracking');
  };

  const handleQuoteExpired = () => {
    setQuoteGroupId(null);
    setQuoteJobs([]);
    setScreen('home');
  };

  const handleQuoteBack = async () => {
    // Cancelar todos los jobs del grupo
    if (quoteGroupId && quoteJobs.length > 0) {
      await Promise.all(
        quoteJobs
          .filter(j => ['pending', 'accepted'].includes(j.status))
          .map(j => jobService.cancel(j.id, session?.user?.id))
      ).catch(() => {});
    }
    setQuoteGroupId(null);
    setQuoteJobs([]);
    setScreen('home');
  };

  // ─── Callbacks de WorkerIncomingScreen ───────────────
  const handleWorkerAccepted = (job) => {
    setIncomingJob(null);
    setActiveJob(job);
    setScreen('jobTracking');
  };

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
    if (!professional) {
      setCompletedJob(job);
      setScreen('rating');
    } else {
      setScreen('home');
    }
  };

  const handleJobCancel = () => {
    setActiveJob(null);
    setScreen('home');
  };

  // ─── Callbacks de RatingScreen ────────────────────────
  const handleRatingDone = () => {
    setCompletedJob(null);
    setScreen('home');
  };

  // ─── Loading ─────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A0A' }}>
        <ActivityIndicator size="large" color="#FFD600" />
      </View>
    );
  }

  if (!session) {
    return (
      <ErrorBoundary>
        <LoginScreen />
        <StatusBar style="light" />
      </ErrorBoundary>
    );
  }

  if (screen === 'jobRequest' && jobRequestData) {
    return (
      <ErrorBoundary>
        <JobRequestScreen
          worker={jobRequestData.worker}
          profession={jobRequestData.profession}
          clientId={session.user.id}
          userLocation={jobRequestData.userLocation}
          onQuoteGroupCreated={handleQuoteGroupCreated}
          onBack={() => setScreen('home')}
        />
        <StatusBar style="light" />
      </ErrorBoundary>
    );
  }

  if (screen === 'quoteSelection' && quoteGroupId) {
    return (
      <ErrorBoundary>
        <QuoteSelectionScreen
          quoteGroupId={quoteGroupId}
          jobs={quoteJobs}
          clientId={session.user.id}
          onSelected={handleWorkerSelected}
          onExpired={handleQuoteExpired}
          onBack={handleQuoteBack}
        />
        <StatusBar style="light" />
      </ErrorBoundary>
    );
  }

  if (screen === 'workerIncoming' && incomingJob) {
    return (
      <ErrorBoundary>
        <WorkerIncomingScreen
          job={incomingJob}
          professional={professional}
          clientUserId={incomingJob.client_id}
          onAccepted={handleWorkerAccepted}
          onRejected={handleWorkerRejected}
        />
        <StatusBar style="light" />
      </ErrorBoundary>
    );
  }

  if (screen === 'jobTracking' && activeJob) {
    return (
      <ErrorBoundary>
        <JobTrackingScreen
          job={activeJob}
          session={session}
          professional={professional}
          onComplete={handleJobComplete}
          onCancel={handleJobCancel}
        />
        <StatusBar style="light" />
      </ErrorBoundary>
    );
  }

  if (screen === 'rating' && completedJob) {
    return (
      <ErrorBoundary>
        <RatingScreen
          job={completedJob}
          session={session}
          professional={professional}
          onDone={handleRatingDone}
        />
        <StatusBar style="light" />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <HomeScreen
        session={session}
        professional={professional}
        onRequestJob={handleRequestJob}
        onActiveJob={handleActiveJob}
        onIncomingJob={handleIncomingJob}
      />
      <StatusBar style="light" />
    </ErrorBoundary>
  );
}

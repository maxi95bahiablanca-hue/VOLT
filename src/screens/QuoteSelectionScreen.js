import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, ActivityIndicator, Alert, Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';

const TIMEOUT_SEC = 45;

const WorkerQuoteCard = ({ job, onSelect, selecting }) => {
  const prof       = job.professionals;
  const responded  = job.status === 'accepted';
  const stars      = Math.round(parseFloat(prof?.avg_rating) || 0);
  const visitFmt   = `$${(job.visit_amount || 30000).toLocaleString('es-AR')}`;

  return (
    <View style={[styles.card, responded && styles.cardActive]}>
      <View style={styles.cardTop}>
        <View style={[styles.avatar, responded && styles.avatarActive]}>
          {responded && prof?.avatar_url
            ? <Image source={{ uri: prof.avatar_url }} style={styles.avatarImg} />
            : <Ionicons name="person" size={26} color={responded ? '#FFD600' : '#2a2a2a'} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.workerName, !responded && styles.workerNameDim]}>
            {responded ? `${prof?.first_name} ${prof?.last_name}` : 'Esperando respuesta...'}
          </Text>
          {responded && (
            <View style={styles.starsRow}>
              {[1,2,3,4,5].map(i => (
                <Ionicons key={i} name={i <= stars ? 'star' : 'star-outline'} size={12} color="#FFD600" />
              ))}
              <Text style={styles.ratingText}>
                {prof?.avg_rating ? Number(prof.avg_rating).toFixed(1) : 'Nuevo'}
                {' · '}{prof?.completed_jobs || 0} trabajos
              </Text>
            </View>
          )}
        </View>
        {responded && (
          <View style={styles.visitWrap}>
            <Text style={styles.visitAmt}>{visitFmt}</Text>
            <Text style={styles.visitLbl}>visita</Text>
          </View>
        )}
      </View>

      {responded && job.pre_diagnosis ? (
        <View style={styles.diagBox}>
          <Ionicons name="bulb-outline" size={14} color="#FFD600" style={{ marginTop: 1 }} />
          <Text style={styles.diagText}>"{job.pre_diagnosis}"</Text>
        </View>
      ) : responded ? (
        <Text style={styles.noDiagText}>Sin diagnóstico previo</Text>
      ) : null}

      {responded ? (
        <TouchableOpacity
          style={[styles.selectBtn, selecting && styles.selectBtnOff]}
          onPress={() => onSelect(job)}
          disabled={selecting}
          activeOpacity={0.85}
        >
          {selecting ? (
            <ActivityIndicator color="#0A0A0A" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#0A0A0A" />
              <Text style={styles.selectBtnText}>Elegir este profesional</Text>
            </>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.waitingRow}>
          <ActivityIndicator size="small" color="#2a2a2a" />
          <Text style={styles.waitingText}>Sin respuesta aún</Text>
        </View>
      )}
    </View>
  );
};

const QuoteSelectionScreen = ({ quoteGroupId, jobs: initialJobs, onSelected, onExpired, onBack }) => {
  const [jobs, setJobs]         = useState(initialJobs || []);
  const [timeLeft, setTimeLeft] = useState(TIMEOUT_SEC);
  const [selecting, setSelecting] = useState(false);
  const [expired, setExpired]   = useState(false);

  const timerRef = useRef(null);
  const subsRef  = useRef(null);

  const respondedJobs = jobs.filter(j => j.status === 'accepted');

  useEffect(() => {
    const jobIds = (initialJobs || []).map(j => j.id);
    subsRef.current = jobService.subscribeQuoteJobs(jobIds, (updated) => {
      setJobs(prev => prev.map(j => j.id === updated.id ? { ...j, ...updated } : j));
    });

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setExpired(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      subsRef.current?.unsubscribe?.();
    };
  }, []);

  const handleSelect = async (job) => {
    if (selecting) return;
    setSelecting(true);
    try {
      const confirmed = await jobService.selectFromQuoteGroup(job.id, quoteGroupId);

      // Notificar a los trabajadores no seleccionados que aceptaron
      const declined = jobs.filter(j => j.id !== job.id && j.status === 'accepted');
      await Promise.all(declined.map(j =>
        notificationService.sendToUser(j.professionals?.user_id, {
          title: 'El cliente eligió otro profesional',
          body: 'No te preocupes, seguirán llegando solicitudes.',
          data: { jobId: j.id },
        })
      ));

      onSelected(confirmed || job);
    } catch {
      Alert.alert('Error', 'No se pudo confirmar la selección. Intentá de nuevo.');
      setSelecting(false);
    }
  };

  const handleBack = () => {
    Alert.alert(
      '¿Cancelar búsqueda?',
      'Se cancelarán todas las solicitudes enviadas a los profesionales.',
      [
        { text: 'Quedarme', style: 'cancel' },
        { text: 'Cancelar búsqueda', style: 'destructive', onPress: onBack },
      ]
    );
  };

  const urgencyColor = timeLeft <= 10 ? '#ff4444' : timeLeft <= 20 ? '#FF9800' : '#FFD600';

  // Sin respuestas y tiempo vencido
  if (expired && respondedJobs.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.expiredWrap}>
          <Ionicons name="time-outline" size={60} color="#2a2a2a" />
          <Text style={styles.expiredTitle}>Sin respuestas</Text>
          <Text style={styles.expiredSub}>
            Ningún profesional respondió esta vez.{'\n'}Podés intentarlo de nuevo.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onExpired} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={handleBack}>
          <Ionicons name="close" size={22} color="#888" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Elegí tu profesional</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Timer o banner de vencimiento */}
        {!expired ? (
          <View style={styles.timerWrap}>
            <View style={[styles.timerRing, { borderColor: urgencyColor }]}>
              <Text style={[styles.timerNum, { color: urgencyColor }]}>{timeLeft}</Text>
              <Text style={styles.timerSec}>seg</Text>
            </View>
            <Text style={styles.timerSub}>
              {respondedJobs.length > 0
                ? `${respondedJobs.length} de ${jobs.length} ${respondedJobs.length === 1 ? 'respondió' : 'respondieron'}`
                : 'Esperando respuestas...'}
            </Text>
          </View>
        ) : (
          <View style={styles.expiredBanner}>
            <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
            <Text style={styles.expiredBannerText}>
              {respondedJobs.length === 1
                ? '1 profesional disponible'
                : `${respondedJobs.length} profesionales disponibles`}
            </Text>
          </View>
        )}

        <View style={styles.badge}>
          <Ionicons name="people" size={14} color="#0A0A0A" />
          <Text style={styles.badgeText}>PRESUPUESTOS</Text>
        </View>

        {jobs.map(job => (
          <WorkerQuoteCard
            key={job.id}
            job={job}
            onSelect={handleSelect}
            selecting={selecting}
          />
        ))}

        <Text style={styles.hint}>
          Comparás diagnóstico inicial, precio de visita y reputación antes de confirmar.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },

  content: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },

  timerWrap: { alignItems: 'center', marginBottom: 24 },
  timerRing: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111',
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 4,
  },
  timerNum: { fontSize: 28, fontWeight: '900' },
  timerSec: { fontSize: 10, color: '#555', marginTop: -2 },
  timerSub: { color: '#555', fontSize: 13, marginTop: 10 },

  expiredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(76,175,80,0.1)',
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    marginBottom: 24,
  },
  expiredBannerText: { color: '#4CAF50', fontSize: 13, fontWeight: '700' },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD600', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginBottom: 20,
  },
  badgeText: { color: '#0A0A0A', fontWeight: '900', fontSize: 11, letterSpacing: 1.2 },

  card: {
    width: '100%', backgroundColor: '#111',
    borderRadius: 18, borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 12,
  },
  cardActive: { borderColor: '#FFD60030' },

  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#161616', borderWidth: 1.5, borderColor: '#222',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarActive: { borderColor: '#FFD60060' },
  workerName: { fontSize: 15, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  workerNameDim: { color: '#333' },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: 11, color: '#555', marginLeft: 4 },

  visitWrap: { alignItems: 'flex-end' },
  visitAmt: { fontSize: 17, fontWeight: '900', color: '#FFD600' },
  visitLbl: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 },

  diagBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#0c0c00', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a10',
    padding: 12, marginBottom: 12,
  },
  diagText: { flex: 1, fontSize: 13, color: '#ccc', lineHeight: 19, fontStyle: 'italic' },
  noDiagText: { fontSize: 12, color: '#333', marginBottom: 12 },

  selectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 14, paddingVertical: 14,
  },
  selectBtnOff: { opacity: 0.5 },
  selectBtnText: { color: '#0A0A0A', fontSize: 15, fontWeight: '900' },

  waitingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 4,
  },
  waitingText: { color: '#2a2a2a', fontSize: 13 },

  hint: { fontSize: 12, color: '#2a2a2a', textAlign: 'center', marginTop: 8, lineHeight: 18 },

  expiredWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40,
  },
  expiredTitle: {
    fontSize: 24, fontWeight: '900', color: '#F5F5F5',
    marginTop: 20, marginBottom: 12,
  },
  expiredSub: {
    fontSize: 14, color: '#555', textAlign: 'center',
    lineHeight: 22, marginBottom: 36,
  },
  retryBtn: {
    backgroundColor: '#FFD600', borderRadius: 16,
    paddingHorizontal: 36, paddingVertical: 16,
  },
  retryBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
});

export default QuoteSelectionScreen;

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  Animated, Easing, Platform, Alert, TextInput, ScrollView, BackHandler, Vibration, ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';

const REJECTION_REASONS = [
  { key: 'too_far',      icon: 'navigate-outline',      label: 'Queda muy lejos',               note: 'La distancia supera mi zona de trabajo.' },
  { key: 'busy',         icon: 'time-outline',           label: 'Estoy ocupado ahora',            note: 'No puedo ir en este momento.' },
  { key: 'out_of_scope', icon: 'build-outline',          label: 'No es mi especialidad',          note: 'El trabajo está fuera de mi área.' },
  { key: 'pricing',      icon: 'cash-outline',           label: 'El precio no me conviene',       note: 'El monto de visita no cubre el trabajo.' },
  { key: 'personal',     icon: 'alert-circle-outline',   label: 'Motivo personal',                note: 'Tengo un inconveniente personal.' },
];

const CONFIDENCE_LEVELS = ['Alta', 'Media', 'Baja'];
const MATERIAL_CHIPS = ['Cable', 'Llave térmica', 'Disyuntor', 'Cañería', 'Sellador', 'Tornillos', 'Pintura', 'Cemento', 'Membrana', 'Otro'];

const TIMEOUT_SEC = 45;
const ARRIVAL_OPTIONS   = ['~15 min', '~30 min', '~45 min', '~1 hora', '+1 hora'];
const DURATION_OPTIONS  = ['~30 min', '~1 hora', '~2 horas', '~3 horas', '+3 horas'];
const SESSION_OPTIONS   = ['2', '3', '4', '5', '6', '7+'];
const HRS_DAY_OPTIONS   = ['~2 hs', '~3 hs', '~4 hs', '~6 hs', '~8 hs'];

const WorkerIncomingScreen = ({ job, professional, clientUserId, onAccepted, onRejected }) => {
  const [timeLeft, setTimeLeft]               = useState(TIMEOUT_SEC);
  const [loading, setLoading]                 = useState(false);
  const [timedOut, setTimedOut]               = useState(false);
  const [diagnosis, setDiagnosis]             = useState('');
  const [showDiag, setShowDiag]               = useState(false);
  const [arrivalEst, setArrivalEst]           = useState('~30 min');
  const [materialsNeeded, setMaterialsNeeded] = useState(false);
  const [workDuration, setWorkDuration]       = useState('~1 hora');
  const [isMultiday, setIsMultiday]           = useState(false);
  const [estimatedSessions, setEstSessions]   = useState('3');
  const [hrsPerSession, setHrsPerSession]     = useState('~4 hs');
  // Motivos de rechazo
  const [rejectModal, setRejectModal]         = useState(false);
  // Diagnóstico avanzado
  const [confidence, setConfidence]           = useState('Media');
  const [probableCause, setProbableCause]     = useState('');
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [costMin, setCostMin]                 = useState('');
  const [costMax, setCostMax]                 = useState('');
  const [timeEst, setTimeEst]                 = useState('');

  const timerRef  = useRef(null);
  const soundRef  = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const visitAmount = job.visit_amount || 30000;

  const stopAlarm = async () => {
    Vibration.cancel();
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  };

  useEffect(() => {
    // Bloquear botón Back — el trabajador debe aceptar o rechazar explícitamente
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);

    // Alarma: vibración + sonido en loop
    const VIBRATE = [0, 400, 200, 400, 200, 400, 600];
    Vibration.vibrate(VIBRATE, true);

    const startSound = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          require('../../assets/job_alert.wav'),
          { shouldPlay: true, isLooping: true, volume: 1.0 }
        );
        soundRef.current = sound;
      } catch { /* si el sonido falla, la vibración sigue */ }
    };
    startSound();

    // Pulso visual
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.06, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    pulse.start();

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setTimedOut(true);
          handleReject(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      backHandler.remove();
      clearInterval(timerRef.current);
      pulse.stop();
      stopAlarm();
    };
  }, []);

  const handleAccept = async () => {
    if (loading) return;
    clearInterval(timerRef.current);
    stopAlarm();
    setLoading(true);
    try {
      const diagText = diagnosis.trim() || null;
      const mats = showDiag ? materialsNeeded : null;
      const dur = isMultiday
        ? `multi-día: ${estimatedSessions} días × ${hrsPerSession}`
        : workDuration;
      await jobService.accept(job.id, diagText, arrivalEst, mats, dur);
      if (isMultiday) {
        await jobService.setMultidayConfig(job.id, estimatedSessions, hrsPerSession);
      }
      // Guardar diagnóstico estructurado si hay info
      if (showDiag && (diagText || probableCause || selectedMaterials.length > 0)) {
        await jobService.setStructuredDiagnosis(job.id, {
          summary:     diagText,
          cause:       probableCause.trim() || null,
          confidence,
          materials:   selectedMaterials,
          cost_min:    costMin ? parseInt(costMin.replace(/\D/g, ''), 10) : null,
          cost_max:    costMax ? parseInt(costMax.replace(/\D/g, ''), 10) : null,
          time_est:    timeEst.trim() || null,
        }).catch(() => {});
      }

      await notificationService.sendToUser(clientUserId, {
        title: `⚡ ESTÁ POR LLEGAR UN VOLT`,
        body:  `POR FAVOR RECORDÁ PEDIRLE EL CÓDIGO PARA ASEGURARTE QUE ES UN TRABAJADOR VERIFICADO. Llega en ${arrivalEst}.`,
        data:  { jobId: job.id, screen: 'tracking' },
      });
      onAccepted(job);
    } catch {
      Alert.alert('Error', 'No se pudo aceptar el trabajo. Intentá de nuevo.');
      setLoading(false);
    }
  };

  const handleRejectWithReason = async (reason) => {
    setRejectModal(false);
    clearInterval(timerRef.current);
    stopAlarm();
    setLoading(true);
    try {
      await jobService.reject(job.id, professional?.id, reason.key, reason.note);
      await notificationService.sendToUser(clientUserId, {
        title: 'El profesional no está disponible',
        body:  'No te preocupes, estamos buscando otro profesional cercano para vos.',
        data:  { jobId: job.id },
      });
      onRejected();
    } catch {
      onRejected();
    }
  };

  const handleReject = async (timeout = false) => {
    if (loading) return;
    if (!timeout) { setRejectModal(true); return; }
    clearInterval(timerRef.current);
    stopAlarm();
    setLoading(true);
    try {
      await jobService.reject(job.id, professional?.id, 'timeout', 'No respondió a tiempo');
      onRejected();
    } catch {
      onRejected();
    }
  };

  const toggleMaterial = (mat) => {
    setSelectedMaterials(prev =>
      prev.includes(mat) ? prev.filter(m => m !== mat) : [...prev, mat]
    );
  };

  const urgencyColor = timeLeft <= 10 ? '#ff4444' : timeLeft <= 20 ? '#FF9800' : '#FFD600';

  return (
    <SafeAreaView style={styles.container}>

      {/* Modal: Motivo de rechazo */}
      <Modal visible={rejectModal} transparent animationType="slide" onRequestClose={() => setRejectModal(false)}>
        <TouchableOpacity style={styles.rejectOverlay} activeOpacity={1} onPress={() => setRejectModal(false)}>
          <TouchableOpacity style={styles.rejectModalBox} activeOpacity={1} onPress={() => {}}>
            <View style={styles.rejectModalHeader}>
              <Ionicons name="close-circle-outline" size={24} color="#ff4444" />
              <Text style={styles.rejectModalTitle}>¿Por qué rechazás?</Text>
            </View>
            <Text style={styles.rejectModalSub}>Ayudanos a mejorar el sistema.</Text>
            {REJECTION_REASONS.map(r => (
              <TouchableOpacity
                key={r.key}
                style={styles.rejectOption}
                onPress={() => handleRejectWithReason(r)}
                activeOpacity={0.8}
              >
                <Ionicons name={r.icon} size={18} color="#555" />
                <Text style={styles.rejectOptionText}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={14} color="#333" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.rejectCancel} onPress={() => setRejectModal(false)}>
              <Text style={styles.rejectCancelText}>Volver — no rechazar</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Contador */}
        <View style={styles.timerWrap}>
          <View style={[styles.timerRing, { borderColor: urgencyColor }]}>
            <Text style={[styles.timerNum, { color: urgencyColor }]}>{timeLeft}</Text>
            <Text style={styles.timerLabel}>seg</Text>
          </View>
          <Text style={styles.timerSub}>para aceptar</Text>
        </View>

        {/* Badge */}
        <View style={styles.alertBadge}>
          <Ionicons name="flash" size={16} color="#0A0A0A" />
          <Text style={styles.alertBadgeText}>NUEVO TRABAJO</Text>
        </View>

        {/* Detalles del trabajo */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="construct-outline" size={20} color="#FFD600" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Servicio</Text>
              <Text style={styles.rowVal}>{job.professions?.name || 'Servicio técnico'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="cash-outline" size={20} color="#FFD600" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Cobro por visita</Text>
              <Text style={styles.rowVal}>${visitAmount.toLocaleString('es-AR')}</Text>
              <Text style={styles.rowHint}>Se cobra al momento del pago final</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="location-outline" size={20} color="#FFD600" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Dirección</Text>
              <Text style={styles.rowVal}>{job.address || 'Ver en mapa'}</Text>
            </View>
          </View>

          {job.notes ? (
            <>
              <View style={styles.divider} />
              <View style={[styles.row, { backgroundColor: '#0D0D00' }]}>
                <View style={styles.rowIcon}>
                  <Ionicons name="chatbubble-outline" size={20} color="#FFD600" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>El cliente dice</Text>
                  <Text style={[styles.rowVal, { color: '#FFD600' }]}>"{job.notes}"</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* ─── Tiempo estimado de llegada ─── */}
        <View style={styles.arrivalCard}>
          <Text style={styles.arrivalTitle}>¿En cuánto llegás?</Text>
          <Text style={styles.arrivalHint}>El cliente lo verá en la app cuando aceptes.</Text>
          <View style={styles.arrivalOptions}>
            {ARRIVAL_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.arrivalOpt, arrivalEst === opt && styles.arrivalOptActive]}
                onPress={() => setArrivalEst(opt)}
                activeOpacity={0.8}
              >
                <Text style={[styles.arrivalOptText, arrivalEst === opt && styles.arrivalOptTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ─── Duración estimada del trabajo ─── */}
        <View style={styles.arrivalCard}>
          <Text style={styles.arrivalTitle}>¿Cuánto va a durar el trabajo?</Text>
          <Text style={styles.arrivalHint}>El cliente lo verá y podrá organizar su día.</Text>
          <View style={styles.arrivalOptions}>
            {DURATION_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.arrivalOpt, workDuration === opt && styles.arrivalOptActive]}
                onPress={() => setWorkDuration(opt)}
                activeOpacity={0.8}
              >
                <Text style={[styles.arrivalOptText, workDuration === opt && styles.arrivalOptTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ─── ¿Trabajo de varios días? ─── */}
        <View style={styles.arrivalCard}>
          <View style={styles.multidayRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.arrivalTitle}>¿Es un trabajo de varios días?</Text>
              <Text style={styles.arrivalHint}>Habilitá esto para trabajos en etapas: pintura, remodelación, instalaciones grandes.</Text>
            </View>
            <TouchableOpacity
              style={[styles.multidayToggle, isMultiday && styles.multidayToggleOn]}
              onPress={() => setIsMultiday(v => !v)}
              activeOpacity={0.8}
            >
              <Text style={[styles.multidayToggleText, isMultiday && styles.multidayToggleTextOn]}>
                {isMultiday ? 'Sí' : 'No'}
              </Text>
            </TouchableOpacity>
          </View>

          {isMultiday && (
            <>
              <Text style={[styles.arrivalTitle, { marginTop: 16 }]}>¿Cuántos días estimás?</Text>
              <View style={styles.arrivalOptions}>
                {SESSION_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.arrivalOpt, estimatedSessions === opt && styles.arrivalOptActive]}
                    onPress={() => setEstSessions(opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.arrivalOptText, estimatedSessions === opt && styles.arrivalOptTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.arrivalTitle, { marginTop: 12 }]}>¿Horas por día?</Text>
              <View style={styles.arrivalOptions}>
                {HRS_DAY_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.arrivalOpt, hrsPerSession === opt && styles.arrivalOptActive]}
                    onPress={() => setHrsPerSession(opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.arrivalOptText, hrsPerSession === opt && styles.arrivalOptTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        {/* ─── Diagnóstico opcional ─── */}
        <TouchableOpacity
          style={styles.diagToggle}
          onPress={() => setShowDiag(v => !v)}
          activeOpacity={0.8}
        >
          <Ionicons name={showDiag ? 'chevron-up' : 'bulb-outline'} size={18} color="#FFD600" />
          <Text style={styles.diagToggleText}>
            {showDiag ? 'Ocultar diagnóstico' : '¿Sabés cuál puede ser el problema?'}
          </Text>
        </TouchableOpacity>

        {showDiag && (
          <View style={styles.diagSection}>
            <Text style={styles.diagHint}>
              El cliente lo verá cuando aceptes. Podés modificarlo cuando llegues al lugar.
            </Text>

            {/* Resumen libre */}
            <TextInput
              style={styles.diagInput}
              placeholder={`Ej: "Probablemente el disyuntor del baño, puede ser un cortocircuito."`}
              placeholderTextColor="#333"
              value={diagnosis}
              onChangeText={setDiagnosis}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={300}
            />
            <Text style={styles.diagCounter}>{diagnosis.length}/300</Text>

            {/* Causa probable */}
            <Text style={styles.materialsLabel}>Causa probable (opcional)</Text>
            <TextInput
              style={[styles.diagInput, { minHeight: 44, marginBottom: 12 }]}
              placeholder="Ej: Cortocircuito por humedad"
              placeholderTextColor="#333"
              value={probableCause}
              onChangeText={setProbableCause}
              maxLength={150}
            />

            {/* Nivel de confianza */}
            <Text style={styles.materialsLabel}>Nivel de confianza en el diagnóstico</Text>
            <View style={styles.materialsRow}>
              {CONFIDENCE_LEVELS.map(lvl => {
                const color = lvl === 'Alta' ? '#4CAF50' : lvl === 'Media' ? '#FF9800' : '#ff4444';
                const active = confidence === lvl;
                return (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.matBtn, active && { borderColor: color + '60', backgroundColor: color + '15' }]}
                    onPress={() => setConfidence(lvl)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.matBtnText, active && { color }]}>{lvl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Materiales probables */}
            <Text style={[styles.materialsLabel, { marginTop: 12 }]}>Materiales que podrías necesitar</Text>
            <View style={styles.chipsWrap}>
              {MATERIAL_CHIPS.map(mat => {
                const sel = selectedMaterials.includes(mat);
                return (
                  <TouchableOpacity
                    key={mat}
                    style={[styles.chip, sel && styles.chipActive]}
                    onPress={() => toggleMaterial(mat)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{mat}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Rango de costo */}
            <Text style={[styles.materialsLabel, { marginTop: 12 }]}>Rango estimado de costo (opcional)</Text>
            <View style={styles.costRangeRow}>
              <TextInput
                style={[styles.diagInput, { flex: 1, minHeight: 44 }]}
                placeholder="$ mín"
                placeholderTextColor="#333"
                value={costMin}
                onChangeText={v => setCostMin(v.replace(/\D/g, ''))}
                keyboardType="numeric"
              />
              <Text style={{ color: '#555', fontSize: 16, marginHorizontal: 8 }}>—</Text>
              <TextInput
                style={[styles.diagInput, { flex: 1, minHeight: 44 }]}
                placeholder="$ máx"
                placeholderTextColor="#333"
                value={costMax}
                onChangeText={v => setCostMax(v.replace(/\D/g, ''))}
                keyboardType="numeric"
              />
            </View>

            {/* Tiempo estimado */}
            <Text style={[styles.materialsLabel, { marginTop: 12 }]}>Tiempo estimado de trabajo</Text>
            <TextInput
              style={[styles.diagInput, { minHeight: 44, marginBottom: 4 }]}
              placeholder="Ej: ~2 horas"
              placeholderTextColor="#333"
              value={timeEst}
              onChangeText={setTimeEst}
              maxLength={50}
            />
          </View>
        )}

        {/* Info penalización */}
        <View style={styles.penaltyNote}>
          <Ionicons name="information-circle-outline" size={14} color="#444" />
          <Text style={styles.penaltyText}>
            Rechazar o ignorar trabajos reduce tu calificación.
          </Text>
        </View>

        {/* Botones */}
        {timedOut ? (
          <TouchableOpacity style={styles.timedOutBtn} onPress={onRejected} disabled={loading}>
            <Ionicons name="home" size={20} color="#F5F5F5" />
            <Text style={styles.timedOutBtnText}>{loading ? 'Liberando...' : 'Volver al inicio'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={() => Alert.alert('¿Rechazar trabajo?', 'Esto reducirá levemente tu calificación.', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Rechazar', style: 'destructive', onPress: () => handleReject(false) },
              ])}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={22} color="#ff4444" />
              <Text style={styles.rejectBtnText}>Rechazar</Text>
            </TouchableOpacity>

            <Animated.View style={[{ flex: 1 }, { transform: [{ scale: pulseAnim }] }]}>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={handleAccept}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#0A0A0A" />
                  : <><Ionicons name="checkmark" size={22} color="#0A0A0A" /><Text style={styles.acceptBtnText}>Aceptar</Text></>
                }
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 48 : 24,
    paddingBottom: 36,
  },

  timerWrap: { alignItems: 'center', marginBottom: 20 },
  timerRing: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111',
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  timerNum:   { fontSize: 32, fontWeight: '900' },
  timerLabel: { fontSize: 10, color: '#555', marginTop: -4 },
  timerSub:   { color: '#444', fontSize: 12, marginTop: 8 },

  alertBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD600', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginBottom: 20,
  },
  alertBadgeText: { color: '#0A0A0A', fontWeight: '900', fontSize: 12, letterSpacing: 1 },

  card: {
    width: '100%', backgroundColor: '#111',
    borderRadius: 20, borderWidth: 1, borderColor: '#1E1E1E',
    marginBottom: 12, overflow: 'hidden',
  },
  row:      { flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 12 },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#1A1A00', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: 11, color: '#555', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  rowVal:   { fontSize: 15, color: '#F5F5F5', fontWeight: '600' },
  rowHint:  { fontSize: 11, color: '#444', marginTop: 2 },
  divider:  { height: 1, backgroundColor: '#1a1a1a', marginHorizontal: 16 },

  /* Llegada */
  arrivalCard: {
    width: '100%', backgroundColor: '#111',
    borderRadius: 18, borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 12,
  },
  arrivalTitle: { fontSize: 14, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  arrivalHint:  { fontSize: 12, color: '#555', marginBottom: 14 },
  arrivalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  arrivalOpt: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1.5, borderColor: '#2a2a2a',
    backgroundColor: '#0A0A0A',
  },
  arrivalOptActive:     { borderColor: '#FFD600', backgroundColor: '#1A1A00' },
  arrivalOptText:       { fontSize: 13, color: '#555', fontWeight: '600' },
  arrivalOptTextActive: { color: '#FFD600' },

  /* Diagnóstico */
  diagToggle: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 4, marginBottom: 4,
  },
  diagToggleText: { color: '#FFD600', fontSize: 13, fontWeight: '600', flex: 1 },

  diagSection: { width: '100%', marginBottom: 12 },
  diagHint:    { fontSize: 12, color: '#555', marginBottom: 8, lineHeight: 17 },
  diagInput: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 14, padding: 14, minHeight: 90,
  },
  diagCounter: { fontSize: 11, color: '#333', textAlign: 'right', marginTop: 4, marginBottom: 14 },

  materialsLabel: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 8 },
  materialsRow:   { flexDirection: 'row', gap: 10 },
  matBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#222', backgroundColor: '#0D0D0D',
  },
  matBtnNo:  { borderColor: '#4CAF5040', backgroundColor: '#0D1A0D' },
  matBtnYes: { borderColor: '#FF980040', backgroundColor: '#1A0D00' },
  matBtnText:     { fontSize: 13, fontWeight: '700', color: '#444' },
  matBtnTextNo:   { color: '#4CAF50' },
  matBtnTextYes:  { color: '#FF9800' },

  multidayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  multidayToggle: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#222', backgroundColor: '#0D0D0D',
    minWidth: 52, alignItems: 'center',
  },
  multidayToggleOn:     { borderColor: '#FFD60060', backgroundColor: '#1A1500' },
  multidayToggleText:   { fontSize: 14, fontWeight: '800', color: '#444' },
  multidayToggleTextOn: { color: '#FFD600' },

  penaltyNote: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 20, paddingHorizontal: 4,
  },
  penaltyText: { fontSize: 12, color: '#444', flex: 1 },

  btnRow:    { flexDirection: 'row', gap: 12, width: '100%' },
  rejectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, width: 120,
    backgroundColor: 'rgba(255,68,68,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(255,68,68,0.3)',
    borderRadius: 16, paddingVertical: 18,
  },
  rejectBtnText: { color: '#ff4444', fontSize: 15, fontWeight: '700' },
  acceptBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600', borderRadius: 16, paddingVertical: 18,
  },
  acceptBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  timedOutBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#1a1a1a',
    borderRadius: 16, paddingVertical: 20,
    borderWidth: 1, borderColor: '#333',
  },
  timedOutBtnText: { color: '#F5F5F5', fontSize: 16, fontWeight: '700' },

  /* Modal rechazo */
  rejectOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  rejectModalBox: {
    backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
  },
  rejectModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  rejectModalTitle:  { fontSize: 16, fontWeight: '800', color: '#F5F5F5' },
  rejectModalSub:    { fontSize: 13, color: '#555', marginBottom: 16 },
  rejectOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  rejectOptionText: { flex: 1, fontSize: 14, color: '#F5F5F5' },
  rejectCancel: {
    marginTop: 16, paddingVertical: 14, borderRadius: 14,
    backgroundColor: '#1a1a1a', alignItems: 'center',
  },
  rejectCancelText: { color: '#555', fontSize: 14, fontWeight: '700' },

  /* Chips de materiales */
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#2a2a2a', backgroundColor: '#0A0A0A',
  },
  chipActive:     { borderColor: '#FF980060', backgroundColor: '#1A0D00' },
  chipText:       { fontSize: 12, color: '#555', fontWeight: '600' },
  chipTextActive: { color: '#FF9800' },

  /* Rango de costo */
  costRangeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
});

export default WorkerIncomingScreen;

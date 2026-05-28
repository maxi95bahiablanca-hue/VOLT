import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  Animated, Easing, Platform, Alert, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';

const TIMEOUT_SEC = 45;
const ARRIVAL_OPTIONS = ['~15 min', '~30 min', '~45 min', '~1 hora', '+1 hora'];

const WorkerIncomingScreen = ({ job, professional, clientUserId, onAccepted, onRejected }) => {
  const [timeLeft, setTimeLeft]               = useState(TIMEOUT_SEC);
  const [loading, setLoading]                 = useState(false);
  const [diagnosis, setDiagnosis]             = useState('');
  const [showDiag, setShowDiag]               = useState(false);
  const [arrivalEst, setArrivalEst]           = useState('~30 min');
  const [materialsNeeded, setMaterialsNeeded] = useState(false);

  const timerRef  = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const visitAmount = job.visit_amount || 30000;

  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.06, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    pulse.start();

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          handleReject(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => { clearInterval(timerRef.current); pulse.stop(); };
  }, []);

  const handleAccept = async () => {
    if (loading) return;
    clearInterval(timerRef.current);
    setLoading(true);
    try {
      const diagText = diagnosis.trim() || null;
      const mats = showDiag ? materialsNeeded : null;
      await jobService.accept(job.id, diagText, arrivalEst, mats);

      let notifBody = `${job.professions?.name || 'Tu profesional'} llega en ${arrivalEst}.`;
      if (diagText) notifBody += ` Posible problema: "${diagText}".`;
      if (showDiag && materialsNeeded) notifBody += ' Necesita comprar materiales para el trabajo.';

      await notificationService.sendToUser(clientUserId, {
        title: `⚡ Profesional en camino — llega en ${arrivalEst}`,
        body:  notifBody,
        data:  { jobId: job.id, screen: 'tracking' },
      });
      onAccepted(job);
    } catch {
      Alert.alert('Error', 'No se pudo aceptar el trabajo. Intentá de nuevo.');
      setLoading(false);
    }
  };

  const handleReject = async (timeout = false) => {
    if (loading) return;
    clearInterval(timerRef.current);
    setLoading(true);
    try {
      await jobService.reject(job.id, professional?.id);
      if (!timeout) {
        await notificationService.sendToUser(clientUserId, {
          title: 'El profesional no está disponible',
          body:  'No te preocupes, estamos buscando otro profesional cercano para vos.',
          data:  { jobId: job.id },
        });
      }
      onRejected();
    } catch {
      onRejected();
    }
  };

  const urgencyColor = timeLeft <= 10 ? '#ff4444' : timeLeft <= 20 ? '#FF9800' : '#FFD600';

  return (
    <SafeAreaView style={styles.container}>
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

            {/* Materiales */}
            <Text style={styles.materialsLabel}>¿Necesitás comprar materiales?</Text>
            <View style={styles.materialsRow}>
              <TouchableOpacity
                style={[styles.matBtn, !materialsNeeded && styles.matBtnNo]}
                onPress={() => setMaterialsNeeded(false)}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-circle" size={16} color={!materialsNeeded ? '#4CAF50' : '#333'} />
                <Text style={[styles.matBtnText, !materialsNeeded && styles.matBtnTextNo]}>No necesito</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.matBtn, materialsNeeded && styles.matBtnYes]}
                onPress={() => setMaterialsNeeded(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="construct" size={16} color={materialsNeeded ? '#FF9800' : '#333'} />
                <Text style={[styles.matBtnText, materialsNeeded && styles.matBtnTextYes]}>Sí, necesito materiales</Text>
              </TouchableOpacity>
            </View>
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
              <Ionicons name="checkmark" size={22} color="#0A0A0A" />
              <Text style={styles.acceptBtnText}>Aceptar</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

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
});

export default WorkerIncomingScreen;

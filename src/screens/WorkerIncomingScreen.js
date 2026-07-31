import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  Animated, Easing, Platform, Alert, TextInput, ScrollView,
  BackHandler, Vibration, ActivityIndicator, Modal, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import chatService from '../services/chatService';
import volt from '../utils/voltVoice';
import { isDemoMode } from '../demo/demoMode';
import { isFreeMode } from '../config/monetization';

const REJECTION_REASONS = [
  { key: 'too_far',      icon: 'navigate-outline',    label: 'Queda muy lejos',         note: 'La distancia supera mi zona de trabajo.' },
  { key: 'busy',         icon: 'time-outline',         label: 'Estoy ocupado ahora',      note: 'No puedo ir en este momento.' },
  { key: 'out_of_scope', icon: 'build-outline',        label: 'No es mi especialidad',    note: 'El trabajo está fuera de mi área.' },
  { key: 'pricing',      icon: 'cash-outline',         label: 'No me conviene',           note: 'No me conviene tomar este trabajo.' },
  { key: 'personal',     icon: 'alert-circle-outline', label: 'Motivo personal',          note: 'Tengo un inconveniente personal.' },
];

const CONFIDENCE_LEVELS = ['Alta', 'Media', 'Baja'];
const MATERIAL_CHIPS = ['Cable', 'Llave térmica', 'Disyuntor', 'Cañería', 'Sellador', 'Tornillos', 'Pintura', 'Cemento', 'Membrana', 'Otro'];

// 3 minutos. Con 45-60 segundos el trabajador no llegaba a agarrar el teléfono:
// si está arriba de una escalera o manejando, perdía el trabajo sin enterarse.
const TIMEOUT_SEC     = 180;

// "2:35" mientras falta más de un minuto; abajo de eso, los segundos pelados.
const fmtTiempo = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s));
const ARRIVAL_OPTIONS  = ['~15 min', '~30 min', '~45 min', '~1 hora', '+1 hora'];
const DURATION_OPTIONS = ['~30 min', '~1 hora', '~2 horas', '~3 horas', '+3 horas'];
const SESSION_OPTIONS  = ['2', '3', '4', '5', '6', '7+'];
const HRS_DAY_OPTIONS  = ['~2 hs', '~3 hs', '~4 hs', '~6 hs', '~8 hs'];

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1: Pantalla de alerta (alarma activa, mínima info)
// ─────────────────────────────────────────────────────────────────────────────
const AlertPhase = ({ job, timeLeft, onView, onAutoReject, onAutoAccept }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.08, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();

    Animated.loop(Animated.sequence([
      Animated.timing(ringAnim, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(ringAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])).start();
  }, []);

  const urgencyColor = timeLeft <= 30 ? '#ff4444' : timeLeft <= 60 ? '#FF9800' : '#FFD600';
  const ringScale  = ringAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const ringOpacity = ringAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.4, 0] });

  return (
    <SafeAreaView style={alertStyles.container}>
      <View style={alertStyles.center}>

        {/* Anillo pulsante de fondo */}
        <View style={alertStyles.ringWrap}>
          <Animated.View style={[alertStyles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity, borderColor: urgencyColor }]} />
          <Animated.View style={[alertStyles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity, borderColor: urgencyColor, width: 160, height: 160, borderRadius: 80 }]} />

          {/* Timer central */}
          <View style={[alertStyles.timerCircle, { borderColor: urgencyColor }]}>
            <Text style={[alertStyles.timerNum, { color: urgencyColor }]}>{fmtTiempo(timeLeft)}</Text>
            <Text style={alertStyles.timerSec}>{timeLeft >= 60 ? 'min' : 'seg'}</Text>
          </View>
        </View>

        {/* Badge */}
        <View style={alertStyles.badge}>
          <Ionicons name="flash" size={18} color="#0A0A0A" />
          <Text style={alertStyles.badgeText}>NUEVO TRABAJO</Text>
        </View>

        {/* Info mínima */}
        <Text style={alertStyles.profession}>{job.professions?.name || 'Trabajo técnico'}</Text>
        <Text style={alertStyles.address} numberOfLines={2}>
          {job.address || 'Ver dirección en la solicitud'}
        </Text>
        {!isFreeMode() && (
          <Text style={alertStyles.visitAmt}>
            Visita: ${(job.visit_amount ?? 30000).toLocaleString('es-AR')}
          </Text>
        )}

        {/* Aceptar rápido — sin completar formulario */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Aceptar el trabajo ahora con valores por defecto"
          style={alertStyles.quickAcceptBtn}
          onPress={() => onAutoAccept({ arrivalEst: '~30 min', workDuration: '~1 hora' })}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={22} color="#0A0A0A" />
          <Text style={alertStyles.quickAcceptBtnText}>ACEPTAR AHORA</Text>
        </TouchableOpacity>

        {/* Ver detalles */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
          <TouchableOpacity style={alertStyles.viewBtn} onPress={onView} activeOpacity={0.85}>
            <Ionicons name="eye-outline" size={20} color="#0A0A0A" />
            <Text style={alertStyles.viewBtnText}>Ver detalles</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text style={alertStyles.hint}>Aceptar ahora usa valores por defecto</Text>
      </View>
    </SafeAreaView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2: Pantalla de detalles (alarma apagada, formulario completo)
// ─────────────────────────────────────────────────────────────────────────────
const DetailsPhase = ({
  job, timeLeft, timedOut, loading,
  onAccept, onRejectWithReason,
}) => {
  const [rejectModal, setRejectModal]     = useState(false);
  const [showDiag, setShowDiag]           = useState(false);
  const [diagnosis, setDiagnosis]         = useState('');
  const [arrivalEst, setArrivalEst]       = useState('~30 min');
  const [workDuration, setWorkDuration]   = useState('~1 hora');
  const [isMultiday, setIsMultiday]       = useState(false);
  const [estimatedSessions, setEstSessions] = useState('3');
  const [hrsPerSession, setHrsPerSession] = useState('~4 hs');
  const [confidence, setConfidence]       = useState('Media');
  const [probableCause, setProbableCause] = useState('');
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [costMin, setCostMin]             = useState('');
  const [costMax, setCostMax]             = useState('');
  const [timeEst, setTimeEst]             = useState('');

  const urgencyColor = timeLeft <= 30 ? '#ff4444' : timeLeft <= 60 ? '#FF9800' : '#4CAF50';

  const toggleMaterial = (mat) =>
    setSelectedMaterials(prev => prev.includes(mat) ? prev.filter(m => m !== mat) : [...prev, mat]);

  // diagData se envía si el trabajador abrió la sección (con o sin materiales)
  const diagData = showDiag && (diagnosis.trim() || probableCause.trim() || selectedMaterials.length > 0) ? {
    summary:    diagnosis.trim() || null,
    cause:      probableCause.trim() || null,
    confidence,
    materials:  selectedMaterials,
    cost_min:   costMin ? parseInt(costMin.replace(/\D/g, ''), 10) : null,
    cost_max:   costMax ? parseInt(costMax.replace(/\D/g, ''), 10) : null,
    time_est:   timeEst.trim() || null,
  } : null;

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
            <Text style={styles.rejectModalSub}>Esto nos ayuda a mejorar el sistema.</Text>
            {REJECTION_REASONS.map(r => (
              <TouchableOpacity
                key={r.key}
                style={styles.rejectOption}
                onPress={() => { setRejectModal(false); onRejectWithReason(r); }}
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

        {/* Timer mudo en la parte superior */}
        <View style={styles.quietTimer}>
          <View style={[styles.quietTimerDot, { backgroundColor: urgencyColor }]} />
          <Text style={[styles.quietTimerText, { color: urgencyColor }]}>
            {timedOut ? 'Tiempo agotado' : `${fmtTiempo(timeLeft)}${timeLeft >= 60 ? ' min' : 's'} para responder`}
          </Text>
        </View>

        {/* Detalles del trabajo */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="construct-outline" size={20} color="#FFD600" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Servicio</Text>
              <Text style={styles.rowVal}>{job.professions?.name || 'Servicio técnico'}</Text>
            </View>
          </View>
          {!isFreeMode() && (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <View style={styles.rowIcon}><Ionicons name="cash-outline" size={20} color="#FFD600" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Cobro por visita</Text>
                  <Text style={styles.rowVal}>${(job.visit_amount ?? 30000).toLocaleString('es-AR')}</Text>
                </View>
              </View>
            </>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="location-outline" size={20} color="#FFD600" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Dirección</Text>
              <Text style={styles.rowVal}>{job.address || 'Ver en mapa'}</Text>
            </View>
          </View>
          {job.notes ? (
            <>
              <View style={styles.divider} />
              <View style={[styles.row, { backgroundColor: '#0D0D00' }]}>
                <View style={styles.rowIcon}><Ionicons name="chatbubble-outline" size={20} color="#FFD600" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>El cliente dice</Text>
                  <Text style={[styles.rowVal, { color: '#FFD600' }]}>"{job.notes}"</Text>
                </View>
              </View>
            </>
          ) : null}
          {/* Fotos del cliente. `problem_photos` puede traer varias (migración
              033); si el cliente tiene la app vieja, viene sólo la de siempre. */}
          {(() => {
            const fotos = job.problem_photos?.length ? job.problem_photos : (job.problem_photo_url ? [job.problem_photo_url] : []);
            if (!fotos.length) return null;
            return (
              <>
                <View style={styles.divider} />
                {fotos.length === 1 ? (
                  <Image source={{ uri: fotos[0] }} style={styles.problemPhoto} resizeMode="cover" />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {fotos.map((u, i) => (
                      <Image key={i} source={{ uri: u }} style={styles.problemPhotoMulti} resizeMode="cover" />
                    ))}
                  </ScrollView>
                )}
              </>
            );
          })()}
        </View>

        {/* Tiempo estimado de llegada */}
        <View style={styles.arrivalCard}>
          <Text style={styles.arrivalTitle}>¿En cuánto llegás?</Text>
          <Text style={styles.arrivalHint}>El cliente lo verá cuando aceptes.</Text>
          <View style={styles.arrivalOptions}>
            {ARRIVAL_OPTIONS.map(opt => (
              <TouchableOpacity key={opt} style={[styles.arrivalOpt, arrivalEst === opt && styles.arrivalOptActive]} onPress={() => setArrivalEst(opt)} activeOpacity={0.8}>
                <Text style={[styles.arrivalOptText, arrivalEst === opt && styles.arrivalOptTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Duración */}
        <View style={styles.arrivalCard}>
          <Text style={styles.arrivalTitle}>¿Cuánto va a durar el trabajo?</Text>
          <Text style={styles.arrivalHint}>El cliente lo verá y podrá organizar su día.</Text>
          <View style={styles.arrivalOptions}>
            {DURATION_OPTIONS.map(opt => (
              <TouchableOpacity key={opt} style={[styles.arrivalOpt, workDuration === opt && styles.arrivalOptActive]} onPress={() => setWorkDuration(opt)} activeOpacity={0.8}>
                <Text style={[styles.arrivalOptText, workDuration === opt && styles.arrivalOptTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Trabajo de varios días */}
        <View style={styles.arrivalCard}>
          <View style={styles.multidayRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.arrivalTitle}>¿Es un trabajo de varios días?</Text>
              <Text style={styles.arrivalHint}>Pintura, remodelación, instalaciones grandes.</Text>
            </View>
            <TouchableOpacity style={[styles.multidayToggle, isMultiday && styles.multidayToggleOn]} onPress={() => setIsMultiday(v => !v)} activeOpacity={0.8}>
              <Text style={[styles.multidayToggleText, isMultiday && styles.multidayToggleTextOn]}>{isMultiday ? 'Sí' : 'No'}</Text>
            </TouchableOpacity>
          </View>
          {isMultiday && (
            <>
              <Text style={[styles.arrivalTitle, { marginTop: 16 }]}>¿Cuántos días estimás?</Text>
              <View style={styles.arrivalOptions}>
                {SESSION_OPTIONS.map(opt => (
                  <TouchableOpacity key={opt} style={[styles.arrivalOpt, estimatedSessions === opt && styles.arrivalOptActive]} onPress={() => setEstSessions(opt)} activeOpacity={0.8}>
                    <Text style={[styles.arrivalOptText, estimatedSessions === opt && styles.arrivalOptTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.arrivalTitle, { marginTop: 12 }]}>¿Horas por día?</Text>
              <View style={styles.arrivalOptions}>
                {HRS_DAY_OPTIONS.map(opt => (
                  <TouchableOpacity key={opt} style={[styles.arrivalOpt, hrsPerSession === opt && styles.arrivalOptActive]} onPress={() => setHrsPerSession(opt)} activeOpacity={0.8}>
                    <Text style={[styles.arrivalOptText, hrsPerSession === opt && styles.arrivalOptTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Diagnóstico opcional (avanzado) */}
        <TouchableOpacity style={styles.diagToggle} onPress={() => setShowDiag(v => !v)} activeOpacity={0.8}>
          <Ionicons name={showDiag ? 'chevron-up' : 'bulb-outline'} size={18} color="#FFD600" />
          <Text style={styles.diagToggleText}>{showDiag ? 'Ocultar diagnóstico' : '¿Sabés cuál puede ser el problema?'}</Text>
        </TouchableOpacity>

        {showDiag && (
          <View style={styles.diagSection}>
            <Text style={styles.diagHint}>El cliente lo verá cuando aceptes. Podés modificarlo al llegar.</Text>
            <TextInput
              style={styles.diagInput}
              placeholder={`Ej: "Probablemente el disyuntor del baño, cortocircuito."`}
              placeholderTextColor="#333"
              value={diagnosis}
              onChangeText={setDiagnosis}
              multiline numberOfLines={3}
              textAlignVertical="top" maxLength={300}
            />
            <Text style={styles.diagCounter}>{diagnosis.length}/300</Text>

            <Text style={styles.materialsLabel}>Causa probable (opcional)</Text>
            <TextInput
              style={[styles.diagInput, { minHeight: 44, marginBottom: 12 }]}
              placeholder="Ej: Cortocircuito por humedad"
              placeholderTextColor="#333"
              value={probableCause} onChangeText={setProbableCause} maxLength={150}
            />

            <Text style={styles.materialsLabel}>Nivel de confianza</Text>
            <View style={styles.materialsRow}>
              {CONFIDENCE_LEVELS.map(lvl => {
                const color = lvl === 'Alta' ? '#4CAF50' : lvl === 'Media' ? '#FF9800' : '#ff4444';
                const active = confidence === lvl;
                return (
                  <TouchableOpacity key={lvl}
                    style={[styles.matBtn, active && { borderColor: color + '60', backgroundColor: color + '15' }]}
                    onPress={() => setConfidence(lvl)} activeOpacity={0.8}>
                    <Text style={[styles.matBtnText, active && { color }]}>{lvl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.materialsLabel, { marginTop: 12 }]}>Materiales que podrías necesitar</Text>
            <View style={styles.chipsWrap}>
              {MATERIAL_CHIPS.map(mat => {
                const sel = selectedMaterials.includes(mat);
                return (
                  <TouchableOpacity key={mat} style={[styles.chip, sel && styles.chipActive]} onPress={() => toggleMaterial(mat)} activeOpacity={0.8}>
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{mat}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.materialsLabel, { marginTop: 12 }]}>Rango estimado de costo (opcional)</Text>
            <View style={styles.costRangeRow}>
              <TextInput style={[styles.diagInput, { flex: 1, minHeight: 44 }]} placeholder="$ mín" placeholderTextColor="#333" value={costMin} onChangeText={v => setCostMin(v.replace(/\D/g, ''))} keyboardType="numeric" />
              <Text style={{ color: '#555', fontSize: 16, marginHorizontal: 8 }}>—</Text>
              <TextInput style={[styles.diagInput, { flex: 1, minHeight: 44 }]} placeholder="$ máx" placeholderTextColor="#333" value={costMax} onChangeText={v => setCostMax(v.replace(/\D/g, ''))} keyboardType="numeric" />
            </View>

            <Text style={[styles.materialsLabel, { marginTop: 12 }]}>Tiempo estimado de trabajo</Text>
            <TextInput
              style={[styles.diagInput, { minHeight: 44, marginBottom: 4 }]}
              placeholder="Ej: ~2 horas"
              placeholderTextColor="#333"
              value={timeEst} onChangeText={setTimeEst} maxLength={50}
            />
          </View>
        )}

        {/* Nota penalización */}
        <View style={styles.penaltyNote}>
          <Ionicons name="information-circle-outline" size={14} color="#444" />
          <Text style={styles.penaltyText}>Rechazar o ignorar trabajos reduce tu calificación.</Text>
        </View>

        {/* Botones */}
        {timedOut ? (
          <TouchableOpacity style={styles.timedOutBtn} onPress={() => onRejectWithReason({ key: 'timeout', note: 'Tiempo agotado' })} disabled={loading}>
            <Ionicons name="home" size={20} color="#F5F5F5" />
            <Text style={styles.timedOutBtnText}>{loading ? 'Liberando...' : 'Volver al inicio'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.rejectBtn}
              accessibilityRole="button"
              accessibilityLabel="Rechazar el trabajo"
              onPress={() => setRejectModal(true)}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={22} color="#ff4444" />
              <Text style={styles.rejectBtnText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.acceptBtn}
              accessibilityRole="button"
              accessibilityLabel="Aceptar el trabajo"
              onPress={() => onAccept({
                diagnosis: diagData?.summary || null,
                arrivalEst,
                materialsNeeded: showDiag && (selectedMaterials.length > 0),
                workDuration: isMultiday ? `multi-día: ${estimatedSessions} días × ${hrsPerSession}` : workDuration,
                isMultiday,
                estimatedSessions,
                hrsPerSession,
                diagData,
              })}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#0A0A0A" />
                : <><Ionicons name="checkmark" size={22} color="#0A0A0A" /><Text style={styles.acceptBtnText}>Aceptar</Text></>
              }
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
/** Aceptar NO quiere decir "salgo ahora": el 90% de las veces se coordina para
 *  otro momento. Sin esta pregunta, jobs.scheduled_for queda vacío, el cliente
 *  ve "va en camino" cuando nadie salió, y el trabajo termina en la lista de
 *  trabados como "aceptó y no fue" (Maxi, 31-jul-2026). */
const preguntarCuandoVoy = (jobId) => {
  const guardar = async (campos, aviso) => {
    try {
      await jobService.setSchedule(jobId, campos);
      if (aviso) chatService.sendSystemMessage(jobId, aviso).catch(() => {});
    } catch (e) { /* que no frene nada: el vigilante lo va a levantar igual */ }
  };
  const enHoras = (h) => new Date(Date.now() + h * 3600000).toISOString();
  const enDiasALas = (dias, hora) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(hora, 0, 0, 0);
    return d.toISOString();
  };

  // Segundo paso: sólo si no va hoy. Va aparte porque en Android Alert.alert
  // muestra COMO MUCHO 3 botones (positive/negative/neutral): el cuarto no se
  // dibuja. Encadenar dos alerts nativos es la única forma de dar las cuatro
  // opciones sin un modal propio — y un modal propio acá no sirve, porque la
  // pantalla se desmonta apenas acepta y se lo llevaría puesto.
  const preguntarQueDia = () => {
    Alert.alert(
      '¿Qué día vas?',
      'Después ajustan la hora exacta por el chat.',
      [
        { text: 'Mañana', onPress: () => guardar(
            { scheduled_for: enDiasALas(1, 10) }, 'Quedó en ir mañana. Coordinen la hora por acá 👇') },
        { text: 'Pasado mañana', onPress: () => guardar(
            { scheduled_for: enDiasALas(2, 10) }, 'Quedó en ir pasado mañana. Coordinen la hora por acá 👇') },
        // Sin fecha elegida: se agenda a 3 días para que el vigilante no lo dé
        // por trabado, y el aviso deja claro que el día se define en el chat.
        { text: 'Lo arreglo por chat', onPress: () => guardar(
            { scheduled_for: enDiasALas(3, 10) }, 'El profesional va a coordinar el día con vos por acá 👇') },
      ],
      { cancelable: false }
    );
  };

  Alert.alert(
    '¿Cuándo vas?',
    'El cliente lo ve en su pantalla. Si vas ahora, decíselo; si es para más tarde, también.',
    [
      { text: 'Voy ahora', onPress: () => guardar(
          { on_the_way_at: new Date().toISOString() }, 'El profesional ya salió para tu domicilio 🚗') },
      { text: 'Hoy más tarde', onPress: () => guardar(
          { scheduled_for: enHoras(4) }, 'Quedó en ir hoy más tarde. Coordinen la hora por acá 👇') },
      { text: 'Otro día…', onPress: preguntarQueDia },
    ],
    { cancelable: false }
  );
};

const WorkerIncomingScreen = ({ job, professional, clientUserId, onAccepted, onRejected }) => {
  const [phase, setPhase]       = useState('alert'); // 'alert' | 'details'
  const [timeLeft, setTimeLeft] = useState(TIMEOUT_SEC);
  const [timedOut, setTimedOut] = useState(false);
  const [loading, setLoading]   = useState(false);

  const timerRef = useRef(null);
  const soundRef = useRef(null);

  const stopAlarm = async () => {
    Vibration.cancel();
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  };

  useEffect(() => {
    // En demo: sin alarma, sin cuenta regresiva ni auto-rechazo (el trabajador decide tranquilo)
    if (isDemoMode()) return;

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);

    // Alarma solo en fase 'alert'
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
      } catch {}
    };
    startSound();

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setTimedOut(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      backHandler.remove();
      clearInterval(timerRef.current);
      stopAlarm();
    };
  }, []);

  // Cuando se agota el tiempo, rechazar automáticamente
  useEffect(() => {
    if (!timedOut) return;
    stopAlarm();
    const doReject = async () => {
      try {
        await jobService.reject(job.id, professional?.id, 'timeout', 'No respondió a tiempo');
      } catch {}
      onRejected();
    };
    doReject();
  }, [timedOut]);

  const handleViewDetails = () => {
    stopAlarm(); // ← PARA LA ALARMA al pasar a la pantalla de detalles
    setPhase('details');
  };

  const handleAccept = async ({
    diagnosis, arrivalEst, materialsNeeded, workDuration,
    isMultiday, estimatedSessions, hrsPerSession, diagData,
  }) => {
    if (loading) return;
    clearInterval(timerRef.current);
    // En demo: aceptamos sin tocar el backend y pasamos directo al seguimiento
    if (isDemoMode()) {
      onAccepted({ ...job, status: 'accepted', arrival_estimate: arrivalEst || '~12 min',
        is_multiday: !!isMultiday, estimated_sessions: estimatedSessions,
        pre_diagnosis: diagnosis || job.pre_diagnosis });
      return;
    }
    setLoading(true);
    try {
      const isQuote = !!job.quote_group_id; // es parte de un grupo de presupuestos
      await jobService.accept(job.id, diagnosis, arrivalEst, materialsNeeded, workDuration);
      if (isMultiday) {
        await jobService.setMultidayConfig(job.id, estimatedSessions, hrsPerSession);
      }
      if (diagData && (diagData.summary || diagData.cause || (diagData.materials?.length > 0))) {
        await jobService.setStructuredDiagnosis(job.id, diagData).catch(() => {});
      }
      const firstName = professional?.first_name || 'El profesional';
      if (isQuote) {
        // PRESUPUESTO: el cliente todavía no eligió. Solo registramos la propuesta.
        // La notificación de "voy en camino" y los eventos de viaje se disparan
        // recién cuando el cliente lo elige (en JobTrackingScreen).
        await jobService.addEvent(job.id, 'quote_sent', `Revisó tu pedido 👀`).catch(() => {});
      } else {
        // TRABAJO DIRECTO: arranca el viaje ya.
        await notificationService.sendToUser(clientUserId, {
          title: '⚡ ESTÁ POR LLEGAR UN BOLT',
          body:  `POR FAVOR PEDILE EL CÓDIGO ANTES DE ABRIR LA PUERTA. Llega en ${arrivalEst}.`,
          data:  { jobId: job.id, screen: 'tracking' },
        }).catch(() => {});
        chatService.sendSystemMessage(job.id, volt.chatAccepted).catch(() => {});
        chatService.sendSystemMessage(job.id, volt.chatInTransit).catch(() => {});
        await jobService.addEvent(job.id, 'accepted',      `Aceptó tu pedido ✅`).catch(() => {});
        await jobService.addEvent(job.id, 'reviewing',     `Revisando los detalles del trabajo.`).catch(() => {});
        if (job.problem_photo_url) {
          await jobService.addEvent(job.id, 'photo_reviewed', `Revisó las fotos que enviaste 📷`).catch(() => {});
        }
        await jobService.addEvent(job.id, 'estimated',    `Llega en aprox. ${arrivalEst}.`).catch(() => {});
        await jobService.addEvent(job.id, 'trip_started', `En camino a tu domicilio 🚗`).catch(() => {});
      }
      preguntarCuandoVoy(job.id);
      onAccepted({ ...job, status: 'accepted' });
    } catch (e) {
      Alert.alert('Error', 'No se pudo aceptar el trabajo: ' + (e?.message || 'probá de nuevo'));
      setLoading(false);
    }
  };

  const handleRejectWithReason = async (reason) => {
    if (loading) return;
    clearInterval(timerRef.current);
    setLoading(true);
    try {
      await jobService.reject(job.id, professional?.id, reason.key, reason.note);
      if (reason.key !== 'timeout') {
        await notificationService.sendToUser(clientUserId, {
          title: 'El profesional no está disponible',
          body:  'No te preocupes, estamos buscando otro profesional cercano.',
          data:  { jobId: job.id },
        }).catch(() => {});
      }
      onRejected();
    } catch {
      onRejected();
    }
  };

  if (phase === 'alert') {
    return (
      <AlertPhase
        job={job}
        timeLeft={timeLeft}
        onView={handleViewDetails}
        onAutoReject={handleRejectWithReason}
        onAutoAccept={(defaults) => handleAccept({
          diagnosis: null,
          arrivalEst: defaults.arrivalEst,
          materialsNeeded: false,
          workDuration: defaults.workDuration,
          isMultiday: false,
          estimatedSessions: '1',
          hrsPerSession: '~1 hs',
          diagData: null,
        })}
      />
    );
  }

  return (
    <DetailsPhase
      job={job}
      timeLeft={timeLeft}
      timedOut={timedOut}
      loading={loading}
      onAccept={handleAccept}
      onRejectWithReason={handleRejectWithReason}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ESTILOS — FASE 1 (alerta)
// ─────────────────────────────────────────────────────────────────────────────
const alertStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 18 },

  ringWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ring: {
    position: 'absolute',
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 2,
  },
  timerCircle: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3,
    backgroundColor: '#0F0F0F',
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 12,
  },
  timerNum: { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  timerSec: { fontSize: 12, color: '#555', fontWeight: '600', marginTop: -4 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  badgeText: { color: '#0A0A0A', fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },

  profession: { fontSize: 22, fontWeight: '900', color: '#F5F5F5', textAlign: 'center' },
  address:    { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20 },
  visitAmt:   { fontSize: 16, color: '#FFD600', fontWeight: '700' },

  viewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, backgroundColor: '#FFD600',
    borderRadius: 20, paddingVertical: 20, width: '100%',
  },
  viewBtnText: { color: '#0A0A0A', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  hint: { fontSize: 12, color: '#444', textAlign: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ESTILOS — FASE 2 (detalles)
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: {
    alignItems: 'center', paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 16,
    paddingBottom: 36, gap: 12,
  },

  quietTimer: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: '#111', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  quietTimerDot:  { width: 8, height: 8, borderRadius: 4 },
  quietTimerText: { fontSize: 13, fontWeight: '700' },

  quickAcceptBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#FFD600',
    borderRadius: 18, paddingVertical: 18, width: '100%',
  },
  quickAcceptBtnText: { color: '#0A0A0A', fontSize: 17, fontWeight: '900', letterSpacing: 0.5 },

  card: {
    width: '100%', backgroundColor: '#111',
    borderRadius: 20, borderWidth: 1, borderColor: '#1E1E1E',
    overflow: 'hidden',
  },
  row:      { flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 12 },
  rowIcon:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#1A1A00', alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 11, color: '#555', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  rowVal:   { fontSize: 15, color: '#F5F5F5', fontWeight: '600' },
  divider:  { height: 1, backgroundColor: '#1a1a1a', marginHorizontal: 16 },
  problemPhoto: { width: '100%', height: 160, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  problemPhotoMulti: { width: 150, height: 150, borderRadius: 12, marginBottom: 10 },

  arrivalCard: {
    width: '100%', backgroundColor: '#111',
    borderRadius: 18, borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16,
  },
  arrivalTitle:       { fontSize: 14, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  arrivalHint:        { fontSize: 12, color: '#555', marginBottom: 14 },
  arrivalOptions:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  arrivalOpt:         { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: '#2a2a2a', backgroundColor: '#0A0A0A' },
  arrivalOptActive:   { borderColor: '#FFD600', backgroundColor: '#1A1A00' },
  arrivalOptText:     { fontSize: 13, color: '#555', fontWeight: '600' },
  arrivalOptTextActive: { color: '#FFD600' },

  multidayRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  multidayToggle:       { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#222', backgroundColor: '#0D0D0D', minWidth: 52, alignItems: 'center' },
  multidayToggleOn:     { borderColor: '#FFD60060', backgroundColor: '#1A1500' },
  multidayToggleText:   { fontSize: 14, fontWeight: '800', color: '#444' },
  multidayToggleTextOn: { color: '#FFD600' },

  diagToggle:     { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 4 },
  diagToggleText: { color: '#FFD600', fontSize: 13, fontWeight: '600', flex: 1 },
  diagSection:    { width: '100%' },
  diagHint:       { fontSize: 12, color: '#555', marginBottom: 8, lineHeight: 17 },
  diagInput: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 14, padding: 14, minHeight: 90,
  },
  diagCounter:    { fontSize: 11, color: '#333', textAlign: 'right', marginTop: 4, marginBottom: 14 },
  materialsLabel: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 8 },
  materialsRow:   { flexDirection: 'row', gap: 10 },
  matBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#222', backgroundColor: '#0D0D0D' },
  matBtnText:     { fontSize: 13, fontWeight: '700', color: '#444' },
  chipsWrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#2a2a2a', backgroundColor: '#0A0A0A' },
  chipActive:     { borderColor: '#FF980060', backgroundColor: '#1A0D00' },
  chipText:       { fontSize: 12, color: '#555', fontWeight: '600' },
  chipTextActive: { color: '#FF9800' },
  costRangeRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },

  penaltyNote: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  penaltyText: { fontSize: 12, color: '#444', flex: 1 },

  btnRow:    { flexDirection: 'row', gap: 12, width: '100%' },
  rejectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, width: 120,
    backgroundColor: 'rgba(255,68,68,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,68,68,0.3)',
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
    gap: 10, backgroundColor: '#1a1a1a', borderRadius: 16, paddingVertical: 20,
    borderWidth: 1, borderColor: '#333',
  },
  timedOutBtnText: { color: '#F5F5F5', fontSize: 16, fontWeight: '700' },

  /* Modal rechazo */
  rejectOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  rejectModalBox:    { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  rejectModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  rejectModalTitle:  { fontSize: 16, fontWeight: '800', color: '#F5F5F5' },
  rejectModalSub:    { fontSize: 13, color: '#555', marginBottom: 16 },
  rejectOption:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  rejectOptionText:  { flex: 1, fontSize: 14, color: '#F5F5F5' },
  rejectCancel:      { marginTop: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: '#1a1a1a', alignItems: 'center' },
  rejectCancelText:  { color: '#555', fontSize: 14, fontWeight: '700' },
});

export default WorkerIncomingScreen;

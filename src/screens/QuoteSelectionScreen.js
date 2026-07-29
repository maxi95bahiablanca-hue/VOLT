import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, ActivityIndicator, Alert, Platform, Image, Modal, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import rescueService from '../services/rescueService';
import paymentService from '../services/paymentService';
import { chargesInApp, isFreeMode } from '../config/monetization';
import ReputationCard from '../components/ReputationCard';
import volt from '../utils/voltVoice';
import { isDemoMode } from '../demo/demoMode';
import demoJobService from '../demo/demoJobService';

// El trabajador tiene 3 minutos para responder (ver WorkerIncomingScreen), así
// que al cliente le damos 4: los 3 de la búsqueda más uno para elegir entre las
// propuestas que hayan llegado.
const TIMEOUT_SEC = 240;

const fmtTiempo = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s));

// ─── Tarjeta de propuesta de un profesional ────────────────────────────────
const ProposalCard = ({ job, onSelect, onCompare, onViewProfile, selecting, inCompare, compareDisabled }) => {
  const prof         = job.professionals;
  const responded    = job.status === 'accepted';
  const rating       = parseFloat(prof?.effective_rating ?? prof?.avg_rating) || 0;
  const completed    = prof?.completed_jobs || 0;
  const profName     = responded ? `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim() : null;

  if (!responded) {
    return (
      <View style={styles.card}>
        <View style={styles.waitingCard}>
          <ActivityIndicator size="small" color="#333" />
          <Text style={styles.waitingName}>Esperando respuesta...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, inCompare && styles.cardCompared]}>
      {inCompare && (
        <View style={styles.compareBadge}>
          <Ionicons name="git-compare-outline" size={11} color="#4285F4" />
          <Text style={styles.compareBadgeText}>Comparando</Text>
        </View>
      )}

      {/* Header: foto + info + precio */}
      <View style={styles.cardHeader}>
        <View style={styles.avatarWrap}>
          {prof?.avatar_url
            ? <Image source={{ uri: prof.avatar_url }} style={styles.avatarImg} />
            : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {(prof?.first_name?.[0] || 'P').toUpperCase()}
                </Text>
              </View>
            )
          }
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.profName}>{profName}</Text>
          <Text style={styles.profRole}>{job.professions?.name || 'Profesional'}</Text>
          <View style={styles.ratingRow}>
            {[1,2,3,4,5].map(i => (
              <Ionicons key={i} name={i <= Math.round(rating) ? 'star' : 'star-outline'} size={12} color="#FFD600" />
            ))}
            <Text style={styles.ratingVal}>{rating ? rating.toFixed(1) : '—'}</Text>
            {completed > 0 && <Text style={styles.ratingJobs}>· {completed} trabajos</Text>}
          </View>
        </View>
        {!isFreeMode() && (
          <View style={styles.priceWrap}>
            <Text style={styles.priceLabel}>Visita</Text>
            <Text style={styles.priceVal}>${(job.visit_amount || 30000).toLocaleString('es-AR')}</Text>
          </View>
        )}
      </View>

      {/* Llegada estimada */}
      {job.arrival_estimate && (
        <View style={styles.arrivalRow}>
          <Ionicons name="navigate-outline" size={14} color="#4285F4" />
          <Text style={styles.arrivalText}>Llega en {job.arrival_estimate}</Text>
        </View>
      )}

      {/* Comentario destacado (diagnóstico del profesional) */}
      {job.pre_diagnosis ? (
        <View style={styles.quoteBox}>
          <Ionicons name="chatbubble-outline" size={13} color="#888" />
          <Text style={styles.quoteText}>"{job.pre_diagnosis}"</Text>
        </View>
      ) : (
        <Text style={styles.noDiag}>Sin diagnóstico previo</Text>
      )}

      {/* Reputación */}
      <ReputationCard prof={prof} />

      {/* Botones secundarios */}
      <View style={styles.secondaryBtns}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => onViewProfile(job)} activeOpacity={0.8}>
          <Ionicons name="person-outline" size={14} color="#888" />
          <Text style={styles.secondaryBtnText}>Ver perfil</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, inCompare && styles.secondaryBtnActive, compareDisabled && !inCompare && styles.secondaryBtnDisabled]}
          onPress={() => onCompare(job)}
          disabled={compareDisabled && !inCompare}
          activeOpacity={0.8}
        >
          <Ionicons name="git-compare-outline" size={14} color={inCompare ? '#4285F4' : '#888'} />
          <Text style={[styles.secondaryBtnText, inCompare && { color: '#4285F4' }]}>
            {inCompare ? 'Quitar' : 'Comparar'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Botón principal */}
      <TouchableOpacity
        style={[styles.selectBtn, selecting && styles.selectBtnOff]}
        onPress={() => onSelect(job)}
        disabled={selecting}
        activeOpacity={0.85}
      >
        {selecting
          ? <ActivityIndicator color="#0A0A0A" size="small" />
          : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#0A0A0A" />
              <Text style={styles.selectBtnText}>Seleccionar</Text>
            </>
          )
        }
      </TouchableOpacity>
    </View>
  );
};

// ─── Modal: perfil completo ────────────────────────────────────────────────
const ProfileModal = ({ job, onClose, onSelect, selecting }) => {
  if (!job) return null;
  const prof     = job.professionals;
  const rating   = parseFloat(prof?.effective_rating ?? prof?.avg_rating) || 0;
  const profName = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim();

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <Ionicons name="arrow-back" size={22} color="#F5F5F5" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Perfil del profesional</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.modalContent}>
          {/* Foto grande */}
          <View style={styles.modalAvatarWrap}>
            {prof?.avatar_url
              ? <Image source={{ uri: prof.avatar_url }} style={styles.modalAvatarImg} />
              : (
                <View style={styles.modalAvatarPlaceholder}>
                  <Text style={styles.modalAvatarInitial}>
                    {(prof?.first_name?.[0] || 'P').toUpperCase()}
                  </Text>
                </View>
              )
            }
          </View>
          <Text style={styles.modalProfName}>{profName}</Text>
          <Text style={styles.modalProfRole}>{job.professions?.name}</Text>
          <View style={styles.modalRatingRow}>
            {[1,2,3,4,5].map(i => (
              <Ionicons key={i} name={i <= Math.round(rating) ? 'star' : 'star-outline'} size={20} color="#FFD600" />
            ))}
            <Text style={styles.modalRatingVal}>{rating ? rating.toFixed(1) : '—'}</Text>
          </View>

          {/* Info del trabajo */}
          <View style={styles.modalJobInfo}>
            {job.arrival_estimate && (
              <View style={styles.modalJobRow}>
                <Ionicons name="navigate-outline" size={16} color="#4285F4" />
                <Text style={styles.modalJobText}>Llega en {job.arrival_estimate}</Text>
              </View>
            )}
            {!isFreeMode() && (
              <View style={styles.modalJobRow}>
                <Ionicons name="card-outline" size={16} color="#FFD600" />
                <Text style={styles.modalJobText}>
                  Visita: ${(job.visit_amount || 30000).toLocaleString('es-AR')}
                </Text>
              </View>
            )}
            {job.work_duration_est && (
              <View style={styles.modalJobRow}>
                <Ionicons name="time-outline" size={16} color="#888" />
                <Text style={styles.modalJobText}>Duración estimada: {job.work_duration_est}</Text>
              </View>
            )}
          </View>

          {/* Diagnóstico */}
          {job.pre_diagnosis && (
            <View style={styles.modalQuoteBox}>
              <Text style={styles.modalQuoteLabel}>Diagnóstico preliminar</Text>
              <Text style={styles.modalQuoteText}>"{job.pre_diagnosis}"</Text>
            </View>
          )}

          {/* Reputación completa */}
          <ReputationCard prof={prof} />

          <TouchableOpacity
            style={[styles.selectBtn, { marginTop: 8 }, selecting && styles.selectBtnOff]}
            onPress={() => onSelect(job)}
            disabled={selecting}
            activeOpacity={0.85}
          >
            {selecting
              ? <ActivityIndicator color="#0A0A0A" size="small" />
              : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#0A0A0A" />
                  <Text style={styles.selectBtnText}>Seleccionar este profesional</Text>
                </>
              )
            }
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── Modal: comparación lado a lado ───────────────────────────────────────
const CompareModal = ({ jobs, onClose, onSelect, selecting }) => {
  const METRICS = [
    { key: 'arrival',   label: 'Llega en',      get: j => j.arrival_estimate || '—' },
    ...(!isFreeMode() ? [{ key: 'price', label: 'Visita', get: j => `$${(j.visit_amount || 30000).toLocaleString('es-AR')}` }] : []),
    { key: 'rating',    label: 'Calificación',   get: j => {
      const r = parseFloat(j.professionals?.effective_rating ?? j.professionals?.avg_rating) || 0;
      return r ? r.toFixed(1) + ' ★' : '—';
    }},
    { key: 'jobs',      label: 'Trabajos',       get: j => `${j.professionals?.completed_jobs || 0}` },
    { key: 'ontime',    label: 'Puntualidad',    get: j => {
      const c = j.professionals?.completed_jobs || 0;
      const o = j.professionals?.on_time_completions || 0;
      return c > 5 ? `${Math.round((o/c)*100)}%` : '—';
    }},
    { key: 'response',  label: 'Respuesta',      get: j => j.professionals?.avg_arrival_minutes ? `${j.professionals.avg_arrival_minutes} min` : '—' },
    { key: 'recommend', label: 'Recomendado',    get: j => j.professionals?.recommend_pct != null ? `${j.professionals.recommend_pct}%` : '—' },
  ];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <Ionicons name="close" size={22} color="#F5F5F5" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Comparar profesionales</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Fotos */}
          <View style={styles.compareHeaderRow}>
            <View style={styles.compareMetricLabel} />
            {jobs.map(j => (
              <View key={j.id} style={styles.compareCol}>
                {j.professionals?.avatar_url
                  ? <Image source={{ uri: j.professionals.avatar_url }} style={styles.compareAvatar} />
                  : (
                    <View style={styles.compareAvatarPlaceholder}>
                      <Text style={styles.compareAvatarInitial}>
                        {(j.professionals?.first_name?.[0] || 'P').toUpperCase()}
                      </Text>
                    </View>
                  )
                }
                <Text style={styles.compareName} numberOfLines={1}>
                  {j.professionals?.first_name || 'Prof.'}
                </Text>
              </View>
            ))}
          </View>

          {/* Tabla de métricas */}
          {METRICS.map((m, mi) => (
            <View key={m.key} style={[styles.compareRow, mi % 2 === 0 && styles.compareRowAlt]}>
              <View style={styles.compareMetricLabel}>
                <Text style={styles.compareMetricText}>{m.label}</Text>
              </View>
              {jobs.map(j => (
                <View key={j.id} style={styles.compareCol}>
                  <Text style={styles.compareVal}>{m.get(j)}</Text>
                </View>
              ))}
            </View>
          ))}

          {/* Botones de selección */}
          <View style={styles.compareSelectRow}>
            <View style={styles.compareMetricLabel} />
            {jobs.map(j => (
              <View key={j.id} style={[styles.compareCol, { paddingVertical: 12 }]}>
                <TouchableOpacity
                  style={[styles.compareSelectBtn, selecting && styles.selectBtnOff]}
                  onPress={() => onSelect(j)}
                  disabled={selecting}
                  activeOpacity={0.85}
                >
                  <Text style={styles.compareSelectBtnText}>Elegir</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── BOLT: genera recomendación basada en datos reales ────────────────────
const getVoltRecommendation = (respondedJobs) => {
  if (!respondedJobs.length) return null;
  if (respondedJobs.length === 1) {
    const name = respondedJobs[0].professionals?.first_name || 'Este profesional';
    return { jobId: respondedJobs[0].id, message: volt.recommendSingle(name) };
  }
  const sorted = [...respondedJobs].sort((a, b) => {
    const rA = parseFloat(a.professionals?.effective_rating ?? a.professionals?.avg_rating) || 0;
    const rB = parseFloat(b.professionals?.effective_rating ?? b.professionals?.avg_rating) || 0;
    return rB - rA;
  });
  const top     = sorted[0];
  const second  = sorted[1];
  const topR    = parseFloat(top.professionals?.effective_rating ?? top.professionals?.avg_rating) || 0;
  const secondR = parseFloat(second.professionals?.effective_rating ?? second.professionals?.avg_rating) || 0;
  const name    = top.professionals?.first_name || 'Este profesional';

  if (topR - secondR >= 0.4)
    return { jobId: top.id, message: volt.recommendByRating(name) };

  const byJobs = [...respondedJobs].sort((a, b) =>
    (b.professionals?.completed_jobs || 0) - (a.professionals?.completed_jobs || 0)
  );
  const topJ = byJobs[0];
  if ((topJ.professionals?.completed_jobs || 0) >= 20 && topJ.id !== sorted[1]?.id)
    return { jobId: topJ.id, message: volt.recommendByExperience(topJ.professionals?.first_name || name) };

  return { jobId: top.id, message: volt.recommendGeneral(name) };
};

// ─── Tarjeta BOLT ─────────────────────────────────────────────────────────
const VoltCard = ({ message }) => (
  <View style={voltCardStyles.wrap}>
    <View style={voltCardStyles.badge}>
      <Text style={voltCardStyles.badgeText}>⚡ BOLT</Text>
    </View>
    <Text style={voltCardStyles.message}>{message}</Text>
  </View>
);

const voltCardStyles = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: '#0A0D15', borderRadius: 14,
    borderWidth: 1, borderColor: '#4285F430',
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginBottom: 4,
  },
  badge: {
    backgroundColor: '#4285F420', borderRadius: 10,
    borderWidth: 1, borderColor: '#4285F440',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  badgeText: { fontSize: 10, fontWeight: '900', color: '#4285F4', letterSpacing: 0.8 },
  message:   { flex: 1, fontSize: 13, color: '#BBBBBB', lineHeight: 19 },
});

// ─── Modal: resumen antes de confirmar ────────────────────────────────────
const ConfirmModal = ({ job, onConfirm, onCancel, selecting }) => {
  if (!job) return null;
  const prof      = job.professionals;
  const rating    = parseFloat(prof?.effective_rating ?? prof?.avg_rating) || 0;
  const profName  = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim();
  const duration  = job.work_duration_est || job.diagnosis_structured?.time_est || null;
  const hasMats   = job.materials_needed || (job.diagnosis_structured?.materials?.length > 0);

  const rows = [
    { icon: 'construct-outline',  label: 'Servicio',           val: job.professions?.name || '—',                       color: '#FFD600' },
    { icon: 'navigate-outline',   label: 'Llegada estimada',   val: job.arrival_estimate || '—',                        color: '#4285F4' },
    ...(!isFreeMode() ? [{ icon: 'card-outline', label: 'Visita', val: `$${(job.visit_amount || 30000).toLocaleString('es-AR')}`, color: '#FFD600' }] : []),
    { icon: 'cart-outline',       label: 'Materiales',         val: hasMats ? 'No incluidos' : 'No necesarios',         color: hasMats ? '#FF9800' : '#4CAF50' },
    { icon: 'time-outline',       label: 'Duración estimada',  val: duration || 'A confirmar al llegar',                color: '#888' },
  ];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancel}>
      <View style={cmStyles.overlay}>
        <View style={cmStyles.sheet}>
          <View style={cmStyles.handle} />

          {/* Profesional seleccionado */}
          <View style={cmStyles.profRow}>
            {prof?.avatar_url
              ? <Image source={{ uri: prof.avatar_url }} style={cmStyles.profAvatar} />
              : (
                <View style={cmStyles.profAvatarPlaceholder}>
                  <Text style={cmStyles.profAvatarInitial}>
                    {(prof?.first_name?.[0] || 'P').toUpperCase()}
                  </Text>
                </View>
              )
            }
            <View style={cmStyles.profInfo}>
              <Text style={cmStyles.profName}>{profName}</Text>
              <Text style={cmStyles.profRole}>{job.professions?.name}</Text>
              <View style={cmStyles.ratingRow}>
                <Ionicons name="star" size={12} color="#FFD600" />
                <Text style={cmStyles.ratingVal}>{rating ? rating.toFixed(1) : '—'}</Text>
                {prof?.completed_jobs > 0 && (
                  <Text style={cmStyles.ratingJobs}>· {prof.completed_jobs} trabajos</Text>
                )}
              </View>
            </View>
          </View>

          {/* Título */}
          <Text style={cmStyles.title}>Tu solicitud</Text>

          {/* Filas de resumen */}
          <View style={cmStyles.rowsWrap}>
            {rows.map(r => (
              <View key={r.label} style={cmStyles.row}>
                <View style={[cmStyles.rowIcon, { backgroundColor: r.color + '18' }]}>
                  <Ionicons name={r.icon} size={15} color={r.color} />
                </View>
                <Text style={cmStyles.rowLabel}>{r.label}</Text>
                <Text style={cmStyles.rowVal}>{r.val}</Text>
              </View>
            ))}
          </View>

          {/* Nota de materiales */}
          {hasMats && (
            <View style={cmStyles.matsNote}>
              <Ionicons name="information-circle-outline" size={14} color="#FF9800" />
              <Text style={cmStyles.matsNoteText}>
                El costo de materiales se agrega al monto final y lo confirmará el profesional al llegar.
              </Text>
            </View>
          )}

          {/* Aviso de pago: escrow (modo comisión) o pago directo (modo gratis) */}
          <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: '#0d1a10', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#33d17a40' }}>
            <Ionicons name={chargesInApp() ? 'lock-closed' : 'information-circle-outline'} size={16} color="#33d17a" />
            <Text style={{ flex: 1, color: '#9fcaa9', fontSize: 12.5, lineHeight: 18 }}>
              {chargesInApp() ? (
                <>Al confirmar abonás la visita de <Text style={{ fontWeight: '800', color: '#fff' }}>${(job.visit_amount || 30000).toLocaleString('es-AR')}</Text>. El dinero queda <Text style={{ fontWeight: '800', color: '#33d17a' }}>retenido por BOLT</Text> y se libera al profesional recién cuando finalizás el trabajo.</>
              ) : (
                <>El precio lo acordás <Text style={{ fontWeight: '800', color: '#fff' }}>directamente con el profesional</Text>. El pago es entre ustedes (efectivo, transferencia, lo que prefieran). BOLT te conecta, sin intermediar el cobro.</>
              )}
            </Text>
          </View>

          {/* Botón confirmar */}
          <TouchableOpacity
            style={[cmStyles.confirmBtn, selecting && { opacity: 0.5 }]}
            onPress={onConfirm}
            disabled={selecting}
            activeOpacity={0.85}
          >
            {selecting
              ? <ActivityIndicator color="#0A0A0A" />
              : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#0A0A0A" />
                  <Text style={cmStyles.confirmBtnText}>Confirmar contratación</Text>
                </>
              )
            }
          </TouchableOpacity>

          <TouchableOpacity style={cmStyles.cancelBtn} onPress={onCancel} disabled={selecting}>
            <Text style={cmStyles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const cmStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: '#1E1E1E',
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 28, gap: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#333', alignSelf: 'center', marginBottom: 4,
  },

  profRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  profAvatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#FFD600' },
  profAvatarPlaceholder: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  profAvatarInitial: { fontSize: 20, fontWeight: '900', color: '#FFD600' },
  profInfo: { flex: 1 },
  profName: { fontSize: 15, fontWeight: '900', color: '#F5F5F5', marginBottom: 2 },
  profRole: { fontSize: 12, color: '#555', marginBottom: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingVal:  { fontSize: 12, fontWeight: '800', color: '#FFD600' },
  ratingJobs: { fontSize: 11, color: '#444' },

  title: {
    fontSize: 11, fontWeight: '800', color: '#444',
    textTransform: 'uppercase', letterSpacing: 1,
  },

  rowsWrap: {
    backgroundColor: '#0A0A0A', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  rowIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 13, color: '#666' },
  rowVal:   { fontSize: 13, fontWeight: '700', color: '#F5F5F5', textAlign: 'right', maxWidth: '45%' },

  matsNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,152,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,152,0,0.2)',
    borderRadius: 12, padding: 12,
  },
  matsNoteText: { flex: 1, fontSize: 12, color: '#FF9800', lineHeight: 17 },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 16, paddingVertical: 18,
  },
  confirmBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontSize: 14, color: '#444' },
});

// ─── SCREEN PRINCIPAL ─────────────────────────────────────────────────────
// `deadline` (ms epoch) lo maneja App.js: así el cliente puede minimizar esta
// pantalla, seguir usando la app y volver al MISMO contador. Si no viene, se
// cuenta desde ahora (por compatibilidad).
const restante = (deadline) =>
  deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : TIMEOUT_SEC;

const QuoteSelectionScreen = ({ quoteGroupId, jobs: initialJobs, deadline, onSelected, onExpired, onMinimize, onBack }) => {
  const [jobs, setJobs]           = useState(initialJobs || []);
  const [timeLeft, setTimeLeft]   = useState(() => restante(deadline));
  const [selecting, setSelecting] = useState(false);
  const [expired, setExpired]     = useState(false);
  const [compareList, setCompareList] = useState([]);
  const [profileJob, setProfileJob]   = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [confirmJob, setConfirmJob]   = useState(null); // job pendiente de confirmación

  const timerRef          = useRef(null);
  const subsRef           = useRef(null);
  const rescateIdRef      = useRef(null);   // se crea una sola vez al vencer sin respuestas
  const scheduledNotifRef = useRef(null);
  const jobsRef           = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const respondedJobs = jobs.filter(j => j.status === 'accepted');
  const compareJobs   = jobs.filter(j => compareList.includes(j.id));

  useEffect(() => {
    const jobIds = (initialJobs || []).map(j => j.id);
    const svc = isDemoMode() ? demoJobService : jobService;
    subsRef.current = svc.subscribeQuoteJobs(jobIds, (updated) => {
      setJobs(prev => prev.map(j => j.id === updated.id ? { ...j, ...updated } : j));
    });

    // Polling de respaldo: el Realtime puede no entregar los UPDATE (RLS con
    // subconsulta, red intermitente). Sin esto, el cliente nunca vería que un
    // profesional aceptó y el flujo queda colgado. Refrescamos cada 4 s.
    const pollQuotes = setInterval(async () => {
      if (isDemoMode()) return;
      try {
        const fresh = await jobService.getQuoteGroup(quoteGroupId);
        if (fresh?.length) {
          setJobs(prev => prev.map(j => {
            const f = fresh.find(x => x.id === j.id);
            return f ? { ...j, ...f } : j;
          }));
        }
      } catch { /* silent */ }
    }, 4000);

    // Se recalcula contra el deadline en vez de restar 1: si el cliente minimiza
    // y vuelve, o el celular suspende la app, el reloj sigue siendo el real.
    if (restante(deadline) <= 0) setExpired(true);
    timerRef.current = setInterval(() => {
      const t = restante(deadline);
      setTimeLeft(t);
      if (t <= 0) { clearInterval(timerRef.current); setExpired(true); }
    }, 1000);
    return () => { clearInterval(timerRef.current); clearInterval(pollQuotes); subsRef.current?.unsubscribe?.(); };
  }, []);

  // ── Se venció sin que nadie respondiera → rescate ─────────────────────────
  // Se registra solo, sin que el cliente tenga que hacer nada: si cierra la app
  // el pedido igual le llega al encargado. El botón de WhatsApp es el atajo.
  useEffect(() => {
    if (!expired || respondedJobs.length > 0 || rescateIdRef.current) return;
    const primero = jobsRef.current[0];
    if (!primero) return;
    rescueService.registrar({
      clientId:      primero.client_id,
      professionId:  primero.profession_id,
      oficio:        primero.professions?.name,
      motivo:        'sin_respuestas',
      notas:         primero.notes,
      address:       primero.address,
      lat:           primero.client_lat,
      lng:           primero.client_lng,
      fotos:         primero.problem_photos?.length ? primero.problem_photos
                     : (primero.problem_photo_url ? [primero.problem_photo_url] : []),
      quoteGroupId:  quoteGroupId,
    }).then(r => { rescateIdRef.current = r?.id ?? null; });
  }, [expired, respondedJobs.length]);

  // ── Detección de abandono ─────────────────────────────────────────────────
  useEffect(() => {
    const cancelScheduledNotif = async () => {
      if (scheduledNotifRef.current) {
        await Notifications.cancelScheduledNotificationAsync(scheduledNotifRef.current).catch(() => {});
        scheduledNotifRef.current = null;
      }
    };

    const scheduleAbandonNotif = async () => {
      await cancelScheduledNotif();
      const responded = jobsRef.current.filter(j => j.status === 'accepted');
      const count = responded.length;
      const title = count > 0 ? 'Propuestas recibidas' : 'Profesionales disponibles';
      const body  = count > 0
        ? `Recibiste ${count} propuesta${count > 1 ? 's' : ''} para tu solicitud.`
        : 'Aún hay profesionales disponibles para ayudarte.';
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: true },
          trigger: { seconds: 90 },
        });
        scheduledNotifRef.current = id;
      } catch {}
    };

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        scheduleAbandonNotif();
      } else if (nextState === 'active') {
        cancelScheduledNotif();
      }
    });

    return () => {
      sub.remove();
      cancelScheduledNotif();
    };
  }, []);

  // Intercepta el tap en "Seleccionar" → muestra el resumen primero
  const handleSelectIntent = (job) => {
    setConfirmJob(job);
    setProfileJob(null);
    setShowCompare(false);
  };

  // Ejecuta la selección real después de que el usuario confirma
  const handleSelect = async (job) => {
    if (selecting) return;
    setSelecting(true);
    setConfirmJob(null);
    if (scheduledNotifRef.current) {
      Notifications.cancelScheduledNotificationAsync(scheduledNotifRef.current).catch(() => {});
      scheduledNotifRef.current = null;
    }
    try {
      const svc = isDemoMode() ? demoJobService : jobService;
      const confirmed = await svc.selectFromQuoteGroup(job.id, quoteGroupId);

      // Cobrar la VISITA del profesional elegido (solo si la app cobra por dentro,
      // modo 'commission'). En modo gratis NO se cobra: el cliente coordina el pago
      // directo con el profesional, así que confirmamos sin pasar por el cobro.
      if (!isDemoMode() && chargesInApp()) {
        try {
          const result = await paymentService.pay({ jobId: job.id, visitOnly: true });
          if (result !== 'success') {
            Alert.alert(
              'Falta abonar la visita',
              'Para confirmar al profesional tenés que abonar la visita. El dinero queda retenido por BOLT y recién se libera cuando finaliza el trabajo.'
            );
            setSelecting(false);
            return;
          }
          await jobService.markVisitPaid(job.id);
        } catch {
          Alert.alert('Error con el pago', 'No se pudo procesar el pago de la visita. Intentá de nuevo.');
          setSelecting(false);
          return;
        }
      }

      const declined  = jobs.filter(j => j.id !== job.id && j.status === 'accepted');
      await Promise.all(declined.map(j =>
        notificationService.sendToUser(j.professionals?.user_id, {
          title: 'El cliente eligió otro profesional',
          body:  'No te preocupes, seguirán llegando solicitudes.',
          data:  { jobId: j.id },
        })
      ));
      onSelected(confirmed || job);
    } catch {
      Alert.alert('Error', 'No se pudo confirmar la selección. Intentá de nuevo.');
      setSelecting(false);
    }
  };

  const handleCompare = (job) => {
    setCompareList(prev => {
      if (prev.includes(job.id)) return prev.filter(id => id !== job.id);
      if (prev.length >= 3) return prev;
      return [...prev, job.id];
    });
  };

  const handleBack = () => {
    Alert.alert('¿Cancelar búsqueda?', 'Se cancelarán todas las solicitudes enviadas.', [
      { text: 'Quedarme',           style: 'cancel' },
      { text: 'Cancelar búsqueda', style: 'destructive', onPress: onBack },
    ]);
  };

  const urgencyColor = timeLeft <= 30 ? '#ff4444' : timeLeft <= 60 ? '#FF9800' : '#FFD600';

  // Nadie respondió: el pedido NO se pierde. Pasa a una persona del equipo.
  if (expired && respondedJobs.length === 0) {
    const primero = jobs[0];
    const datosRescate = {
      oficio:  primero?.professions?.name,
      notas:   primero?.notes,
      address: primero?.address,
      fotos:   primero?.problem_photos?.length ? primero.problem_photos
              : (primero?.problem_photo_url ? [primero.problem_photo_url] : []),
    };
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.expiredWrap}>
          <Ionicons name="person-circle-outline" size={60} color="#FFD600" />
          <Text style={styles.expiredTitle}>Lo tomamos nosotros</Text>
          <Text style={styles.expiredSub}>
            Ningún profesional estaba libre en este momento, así que tu pedido pasó a
            {' '}<Text style={{ color: '#F5F5F5', fontWeight: '700' }}>una persona del equipo</Text>,
            que te va a buscar uno a mano.{'\n\n'}Escribinos por WhatsApp y lo resolvemos ahora.
          </Text>

          <TouchableOpacity
            style={styles.waBtn}
            onPress={() => rescueService.abrirWhatsApp(datosRescate, rescateIdRef.current)}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-whatsapp" size={20} color="#0A0A0A" />
            <Text style={styles.waBtnText}>Hablar con un encargado</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.retryBtn} onPress={onExpired} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Modal: confirmación antes de contratar */}
      <ConfirmModal
        job={confirmJob}
        onConfirm={() => handleSelect(confirmJob)}
        onCancel={() => setConfirmJob(null)}
        selecting={selecting}
      />

      {/* Modal: perfil completo */}
      <ProfileModal
        job={profileJob}
        onClose={() => setProfileJob(null)}
        onSelect={handleSelectIntent}
        selecting={selecting}
      />

      {/* Modal: comparación */}
      {showCompare && compareJobs.length >= 2 && (
        <CompareModal
          jobs={compareJobs}
          onClose={() => setShowCompare(false)}
          onSelect={handleSelectIntent}
          selecting={selecting}
        />
      )}

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={handleBack}>
          <Ionicons name="close" size={22} color="#888" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Elegí tu profesional</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Timer / Banner */}
        {!expired ? (
          <View style={styles.timerWrap}>
            <View style={[styles.timerRing, { borderColor: urgencyColor }]}>
              <Text style={[styles.timerNum, { color: urgencyColor }]}>{fmtTiempo(timeLeft)}</Text>
              <Text style={styles.timerSec}>{timeLeft >= 60 ? 'min' : 'seg'}</Text>
            </View>
            <Text style={styles.timerSub}>
              {respondedJobs.length > 0
                ? `${respondedJobs.length} de ${jobs.length} ${respondedJobs.length === 1 ? 'respondió' : 'respondieron'}`
                : 'En 2 o 3 minutos te encontramos un profesional'}
            </Text>
            {respondedJobs.length === 0 && (
              <Text style={styles.timerHint}>
                Les estamos avisando. Podés seguir usando la app: te avisamos apenas respondan.
              </Text>
            )}

            {/* Minimizar: la búsqueda sigue corriendo, queda una burbuja en el
                inicio para volver acá. No cancela nada. */}
            {onMinimize && (
              <TouchableOpacity style={styles.keepUsingBtn} onPress={onMinimize} activeOpacity={0.85}>
                <Ionicons name="chevron-down" size={16} color="#FFD600" />
                <Text style={styles.keepUsingText}>SEGUIR USANDO LA APP</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.expiredBanner}>
            <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
            <Text style={styles.expiredBannerText}>
              {respondedJobs.length === 1 ? '1 profesional disponible' : `${respondedJobs.length} profesionales disponibles`}
            </Text>
          </View>
        )}

        <View style={styles.sectionBadge}>
          <Ionicons name="people" size={14} color="#0A0A0A" />
          <Text style={styles.sectionBadgeText}>PROPUESTAS</Text>
        </View>

        {/* Recomendación de BOLT */}
        {respondedJobs.length > 0 && (() => {
          const rec = getVoltRecommendation(respondedJobs);
          return rec ? <VoltCard message={rec.message} /> : null;
        })()}

        {jobs.map(job => (
          <ProposalCard
            key={job.id}
            job={job}
            onSelect={handleSelectIntent}
            onCompare={handleCompare}
            onViewProfile={setProfileJob}
            selecting={selecting}
            inCompare={compareList.includes(job.id)}
            compareDisabled={compareList.length >= 3}
          />
        ))}

        <Text style={styles.hint}>
          Compará diagnóstico, precio y reputación antes de confirmar.
        </Text>
      </ScrollView>

      {/* Barra de comparación (fija al fondo) */}
      {compareList.length >= 2 && (
        <View style={styles.compareBar}>
          <View style={styles.compareBarLeft}>
            {compareJobs.map(j => (
              <View key={j.id} style={styles.compareBarAvatar}>
                {j.professionals?.avatar_url
                  ? <Image source={{ uri: j.professionals.avatar_url }} style={styles.compareBarAvatarImg} />
                  : (
                    <View style={styles.compareBarAvatarPlaceholder}>
                      <Text style={styles.compareBarAvatarInitial}>
                        {(j.professionals?.first_name?.[0] || 'P').toUpperCase()}
                      </Text>
                    </View>
                  )
                }
              </View>
            ))}
            <Text style={styles.compareBarText}>
              {compareList.length} seleccionados
            </Text>
          </View>
          <TouchableOpacity style={styles.compareBarBtn} onPress={() => setShowCompare(true)} activeOpacity={0.85}>
            <Ionicons name="git-compare-outline" size={16} color="#0A0A0A" />
            <Text style={styles.compareBarBtnText}>Ver comparación</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  // ── Header ───────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },

  content: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 },

  // ── Timer ────────────────────────────────────────────────────────────────────
  timerWrap: { alignItems: 'center', marginBottom: 20 },
  timerRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#111',
  },
  timerNum: { fontSize: 26, fontWeight: '900' },
  timerSec: { fontSize: 9, color: '#555', marginTop: -2 },
  timerSub: { color: '#555', fontSize: 13, marginTop: 8, textAlign: 'center' },
  timerHint: { color: '#3d3d3d', fontSize: 11, marginTop: 6, textAlign: 'center', lineHeight: 16, paddingHorizontal: 24 },

  keepUsingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,214,0,0.35)',
    backgroundColor: 'rgba(255,214,0,0.07)',
  },
  keepUsingText: { color: '#FFD600', fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },

  expiredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(76,175,80,0.1)',
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 20,
  },
  expiredBannerText: { color: '#4CAF50', fontSize: 13, fontWeight: '700' },

  sectionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD600', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginBottom: 16,
  },
  sectionBadgeText: { color: '#0A0A0A', fontWeight: '900', fontSize: 11, letterSpacing: 1.2 },

  hint: { fontSize: 12, color: '#2a2a2a', textAlign: 'center', marginTop: 8, lineHeight: 18 },

  // ── ProposalCard ──────────────────────────────────────────────────────────────
  card: {
    width: '100%', backgroundColor: '#111',
    borderRadius: 18, borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 14, gap: 12,
  },
  cardCompared: { borderColor: '#4285F460', backgroundColor: '#0A0D15' },

  compareBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(66,133,244,0.12)',
    borderWidth: 1, borderColor: 'rgba(66,133,244,0.3)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  compareBadgeText: { fontSize: 10, fontWeight: '800', color: '#4285F4' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarWrap: { position: 'relative' },
  avatarImg: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#FFD600' },
  avatarPlaceholder: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 20, fontWeight: '900', color: '#FFD600' },

  cardInfo: { flex: 1 },
  profName: { fontSize: 16, fontWeight: '900', color: '#F5F5F5', marginBottom: 2 },
  profRole: { fontSize: 12, color: '#555', marginBottom: 5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingVal:  { fontSize: 12, fontWeight: '800', color: '#FFD600', marginLeft: 4 },
  ratingJobs: { fontSize: 11, color: '#444', marginLeft: 2 },

  priceWrap:  { alignItems: 'flex-end' },
  priceLabel: { fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  priceVal:   { fontSize: 18, fontWeight: '900', color: '#FFD600' },

  arrivalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(66,133,244,0.08)',
    borderWidth: 1, borderColor: 'rgba(66,133,244,0.2)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  arrivalText: { fontSize: 13, fontWeight: '700', color: '#4285F4' },

  quoteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#0c0c00', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a10', padding: 12,
  },
  quoteText: { flex: 1, fontSize: 13, color: '#ccc', lineHeight: 19, fontStyle: 'italic' },
  noDiag: { fontSize: 12, color: '#333' },

  secondaryBtns: { flexDirection: 'row', gap: 8 },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#0A0A0A', borderRadius: 10,
    borderWidth: 1, borderColor: '#1E1E1E', paddingVertical: 10,
  },
  secondaryBtnActive: { borderColor: 'rgba(66,133,244,0.4)', backgroundColor: 'rgba(66,133,244,0.06)' },
  secondaryBtnDisabled: { opacity: 0.35 },
  secondaryBtnText: { fontSize: 13, color: '#888', fontWeight: '600' },

  selectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 14, paddingVertical: 14,
  },
  selectBtnOff: { opacity: 0.5 },
  selectBtnText: { color: '#0A0A0A', fontSize: 15, fontWeight: '900' },

  waitingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 20,
  },
  waitingName: { color: '#333', fontSize: 14 },

  // ── Barra de comparación (fija) ───────────────────────────────────────────────
  compareBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1E1E1E',
    paddingHorizontal: 16, paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    gap: 12,
  },
  compareBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compareBarAvatar: { marginRight: -8 },
  compareBarAvatarImg: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#111' },
  compareBarAvatarPlaceholder: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#111',
    alignItems: 'center', justifyContent: 'center',
  },
  compareBarAvatarInitial: { fontSize: 13, fontWeight: '900', color: '#FFD600' },
  compareBarText: { fontSize: 13, color: '#888', fontWeight: '600', marginLeft: 16 },
  compareBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD600', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  compareBarBtnText: { fontSize: 13, fontWeight: '900', color: '#0A0A0A' },

  // ── Modal: perfil ─────────────────────────────────────────────────────────────
  modalContainer: { flex: 1, backgroundColor: '#0A0A0A' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  modalCloseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#F5F5F5' },
  modalContent: { padding: 20, gap: 16, alignItems: 'center' },

  modalAvatarWrap: { alignItems: 'center' },
  modalAvatarImg: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#FFD600' },
  modalAvatarPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#1A1A00', borderWidth: 3, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  modalAvatarInitial: { fontSize: 38, fontWeight: '900', color: '#FFD600' },
  modalProfName: { fontSize: 22, fontWeight: '900', color: '#F5F5F5' },
  modalProfRole: { fontSize: 14, color: '#555' },
  modalRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  modalRatingVal: { fontSize: 16, fontWeight: '800', color: '#FFD600', marginLeft: 6 },

  modalJobInfo: {
    width: '100%', backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', padding: 14, gap: 10,
  },
  modalJobRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalJobText: { fontSize: 14, color: '#BBBBBB' },

  modalQuoteBox: {
    width: '100%', backgroundColor: '#0c0c00',
    borderRadius: 14, borderWidth: 1, borderColor: '#2a2a10', padding: 14, gap: 6,
  },
  modalQuoteLabel: { fontSize: 10, fontWeight: '800', color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 },
  modalQuoteText: { fontSize: 14, color: '#ccc', lineHeight: 20, fontStyle: 'italic' },

  // ── Modal: comparación ────────────────────────────────────────────────────────
  compareHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  compareCol: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  compareMetricLabel: { width: 100, paddingLeft: 12 },
  compareMetricText: { fontSize: 12, color: '#555' },

  compareAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#FFD600' },
  compareAvatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  compareAvatarInitial: { fontSize: 16, fontWeight: '900', color: '#FFD600' },
  compareName: { fontSize: 11, fontWeight: '700', color: '#888', textAlign: 'center' },

  compareRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14,
  },
  compareRowAlt: { backgroundColor: '#0D0D0D' },
  compareVal: { fontSize: 14, fontWeight: '700', color: '#F5F5F5', textAlign: 'center' },

  compareSelectRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  compareSelectBtn: {
    backgroundColor: '#FFD600', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  compareSelectBtnText: { fontSize: 13, fontWeight: '900', color: '#0A0A0A' },

  // ── Sin respuestas ────────────────────────────────────────────────────────────
  expiredWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  expiredTitle: { fontSize: 24, fontWeight: '900', color: '#F5F5F5', marginTop: 20, marginBottom: 12 },
  expiredSub: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  retryBtn: { backgroundColor: '#1a1a1a', borderRadius: 16, paddingHorizontal: 36, paddingVertical: 15, marginTop: 12 },
  retryBtnText: { color: '#888', fontSize: 15, fontWeight: '800' },

  waBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#25D366', borderRadius: 16, paddingHorizontal: 30, paddingVertical: 17,
    alignSelf: 'stretch',
  },
  waBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
});

export default QuoteSelectionScreen;

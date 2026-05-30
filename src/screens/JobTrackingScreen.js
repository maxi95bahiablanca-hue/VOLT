import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
  Modal, Linking, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../supabase';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import paymentService from '../services/paymentService';
import professionalService from '../services/professionalService';

const STATUS_INFO = {
  pending:          { icon: 'time-outline',            color: '#888',    label: 'Esperando confirmación...' },
  accepted:         { icon: 'navigate-outline',         color: '#4285F4', label: 'El profesional está en camino' },
  arrived:          { icon: 'home-outline',             color: '#FFD600', label: 'El profesional llegó' },
  in_progress:      { icon: 'construct-outline',        color: '#FF9800', label: 'Trabajo en curso' },
  awaiting_payment: { icon: 'card-outline',             color: '#4CAF50', label: 'Listo para pagar' },
  completed:        { icon: 'checkmark-circle-outline', color: '#4CAF50', label: '¡Trabajo completado!' },
  cancelled:        { icon: 'close-circle-outline',     color: '#ff4444', label: 'Cancelado' },
};

const WORKER_TIPS = {
  accepted:         '⚡ Conducí con precaución. El cliente ya fue notificado que vas en camino.',
  arrived:          '🔑 Mostrá tu código al cliente antes de que te abra. Es obligatorio.',
  in_progress:      '🔧 Describí el trabajo al cliente antes de empezar para evitar malentendidos.',
  awaiting_payment: '💳 El cliente pagará por la app. No aceptes efectivo por el trabajo.',
};

const CLIENT_TIPS = {
  pending:          '💡 Estamos buscando al profesional más cercano. Generalmente llega en menos de 30 min.',
  accepted:         '📍 Podés seguir en tiempo real por dónde viene el profesional.',
  arrived:          '🔒 IMPORTANTE: pedile el código de 4 dígitos ANTES de abrir la puerta.',
  in_progress:      '✅ Todos los profesionales VOLT tienen antecedentes verificados.',
  awaiting_payment: '💳 El pago es seguro y solo a través de la app. Nunca pagues en efectivo.',
};

const PROBLEM_ISSUES = [
  { icon: 'time-outline',          text: 'El profesional no llega o no responde' },
  { icon: 'cash-outline',          text: 'Me pidieron pagar en efectivo (prohibido)' },
  { icon: 'construct-outline',     text: 'El trabajo no se realizó correctamente' },
  { icon: 'alert-circle-outline',  text: 'Me siento inseguro/a en este momento' },
  { icon: 'card-outline',          text: 'Problema con el monto a pagar' },
  { icon: 'person-remove-outline', text: 'El profesional actuó de manera inapropiada' },
  { icon: 'help-circle-outline',   text: 'Otro problema' },
];

const JobTrackingScreen = ({ job: initialJob, session, professional, onComplete, onCancel }) => {
  const [job, setJob]               = useState(initialJob);
  const [workAmount, setWorkAmount]     = useState('');
  const [materialsAmount, setMaterialsAmount] = useState('');
  const [loading, setLoading]       = useState(false);
  const [codeModal, setCodeModal]     = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [codeResult, setCodeResult]   = useState(null);
  const [completedModal, setCompletedModal] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [workElapsed, setWorkElapsed]       = useState(0);
  const [problemModal, setProblemModal]     = useState(false);
  const completedShownRef = useRef(false);
  const webRef = useRef(null);

  const isWorker = !!professional;
  const userId   = session?.user?.id;
  const clientId = job.client_id;

  // Suscribir a cambios del job
  useEffect(() => {
    const channel = jobService.subscribeToJob(job.id, (updated) => setJob(prev => ({ ...prev, ...updated })));
    return () => { if (channel) channel.unsubscribe?.(); };
  }, [job.id]);

  // Timer de sesión multi-día
  useEffect(() => {
    if (!job.current_session_start) { setSessionElapsed(0); return; }
    const calc = () => {
      const diff = Math.floor((Date.now() - new Date(job.current_session_start)) / 1000);
      setSessionElapsed(Math.max(0, diff));
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [job.current_session_start]);

  // Timer de trabajo en curso (single-day)
  useEffect(() => {
    if (job.status !== 'in_progress' || job.is_multiday || !job.work_started_at) { setWorkElapsed(0); return; }
    const calc = () => {
      const diff = Math.floor((Date.now() - new Date(job.work_started_at)) / 1000);
      setWorkElapsed(Math.max(0, diff));
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [job.status, job.work_started_at, job.is_multiday]);

  // Cancelación o finalización detectada vía realtime
  useEffect(() => {
    if (job.status === 'cancelled' && isWorker) {
      Alert.alert('Trabajo cancelado', 'El cliente eligió otro profesional.', [{ text: 'Entendido', onPress: onCancel }]);
    }
    if (job.status === 'completed' && isWorker && !completedShownRef.current) {
      completedShownRef.current = true;
      setCompletedModal(true);
    }
    if (job.status === 'completed' && !isWorker) {
      onComplete(job);
    }
  }, [job.status]);

  const handleAvailabilityAndComplete = async (hoursFromNow) => {
    setCompletedModal(false);
    try {
      if (professional?.id) {
        await professionalService.setAvailableAt(professional.id, hoursFromNow);
      }
    } catch {}
    onComplete(job);
  };

  // Suscribir a ubicación del trabajador (solo cliente)
  useEffect(() => {
    if (isWorker || !job.professional_id) return;
    const channel = jobService.subscribeWorkerLocation(job.professional_id, (locationStr) => {
      const match = locationStr.match(/POINT\(([^ ]+) ([^ )]+)\)/);
      if (match) {
        const lng = parseFloat(match[1]);
        const lat = parseFloat(match[2]);
        webRef.current?.postMessage(JSON.stringify({ type: 'WORKER_MOVE', lat, lng }));
      }
    });
    return () => { if (channel) channel.unsubscribe?.(); };
  }, [isWorker, job.professional_id]);

  const handleWorkerAction = async (action) => {
    setLoading(true);
    try {
      let notifTitle = '', notifBody = '';

      if (action === 'arrive') {
        await jobService.arrive(job.id);
        notifTitle = '⚡ ESTÁ POR LLEGAR UN VOLT';
        notifBody  = 'POR FAVOR RECORDÁ PEDIRLE EL CÓDIGO PARA ASEGURARTE QUE ES UN TRABAJADOR VERIFICADO.';
      } else if (action === 'start') {
        await jobService.start(job.id);
        notifTitle = '🔧 Trabajo iniciado';
        notifBody  = 'El profesional comenzó el trabajo.';
      } else if (action === 'set_amount') {
        const labor = parseInt(workAmount.replace(/\D/g, ''), 10);
        if (!labor || labor < 1000) {
          Alert.alert('Revisá el monto', 'Ingresá el costo de la mano de obra (sin visita ni materiales).');
          setLoading(false);
          return;
        }
        const mats  = parseInt(materialsAmount.replace(/\D/g, ''), 10) || 0;
        await jobService.setWorkAmount(job.id, labor, mats);
        const visitAmt = job.visit_amount || 30000;
        const total    = visitAmt + mats + labor;
        notifTitle = '💳 Trabajo listo — hora de pagar';
        notifBody  = (mats > 0
            ? `Visita $${visitAmt.toLocaleString('es-AR')} + Materiales $${mats.toLocaleString('es-AR')} + Trabajo $${labor.toLocaleString('es-AR')} = $${total.toLocaleString('es-AR')}`
            : `Visita $${visitAmt.toLocaleString('es-AR')} + Trabajo $${labor.toLocaleString('es-AR')} = $${total.toLocaleString('es-AR')}`) +
          ' Abrí la app para pagar.';
      }

      if (notifTitle) {
        await notificationService.sendToUser(clientId, { title: notifTitle, body: notifBody, data: { jobId: job.id, screen: 'tracking' } });
      }
    } catch {
      Alert.alert('Error', 'No se pudo actualizar el estado.');
    } finally {
      setLoading(false);
    }
  };

  const handleClientPay = async () => {
    setLoading(true);
    try {
      const { checkoutUrl } = await paymentService.createPreference({ jobId: job.id });
      const result = await paymentService.openCheckout(checkoutUrl);
      if (result === 'success') {
        try {
          const { data: prof } = await supabase
            .from('professionals')
            .select('user_id')
            .eq('id', job.professional_id)
            .maybeSingle();
          if (prof?.user_id) {
            await notificationService.sendToUser(prof.user_id, {
              title: '💰 ¡Pago recibido!',
              body:  'El cliente completó el pago. ¡Excelente trabajo! Ya podés tomar nuevos pedidos.',
              data:  { jobId: job.id },
            });
          }
        } catch {}
        onComplete(job);
      } else if (result === 'failure') {
        Alert.alert('Pago rechazado', 'El pago no fue procesado.\n\nPodés intentar con otra tarjeta de débito, crédito o billetera digital (Naranja X, Ualá, etc.).');
      } else if (result === 'pending') {
        Alert.alert('Procesando pago', 'Tu pago está siendo verificado. Te avisaremos cuando se confirme.');
      } else {
        Alert.alert('Pago cancelado', 'Cerraste el pago sin completarlo. El profesional sigue esperando.\n\nPodés volver a intentarlo cuando quieras.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo iniciar el pago. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    const awaitingPayment = job.status === 'awaiting_payment';
    Alert.alert(
      awaitingPayment ? '¿Cancelar el cobro?' : '¿Cancelar trabajo?',
      awaitingPayment
        ? 'El trabajo ya fue realizado. Al cancelar no habrá cobro por esta visita.'
        : 'Esta acción no se puede deshacer.',
      [
        { text: 'No, volver', style: 'cancel' },
        { text: 'Sí, cancelar', style: 'destructive', onPress: async () => {
          try { await jobService.cancel(job.id, userId); } catch {}
          onCancel();
        }},
      ]
    );
  };

  const handleEmergency = () => {
    Alert.alert('🚨 Emergencia', '¿Querés llamar al 911?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Llamar al 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  const handleVerifyCode = () => {
    if (enteredCode === job.verification_code) {
      setCodeResult('ok');
    } else {
      setCodeResult('error');
    }
  };

  const handleReportIssue = (issueText) => {
    setProblemModal(false);
    Alert.alert(
      'Problema reportado',
      `Registramos tu reporte:\n"${issueText}"\n\nNuestro equipo te contactará pronto. Si estás en peligro, llamá al 911 ahora mismo.`,
      [{ text: 'OK' }]
    );
  };

  const statusInfo = STATUS_INFO[job.status] || STATUS_INFO.pending;
  const tip = isWorker ? WORKER_TIPS[job.status] : CLIENT_TIPS[job.status];

  const fmtTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2,'0')}min`;
    if (m > 0) return `${m}min ${s.toString().padStart(2,'0')}s`;
    return `${s}s`;
  };

  const totalMinutesFormatted = () => {
    const total = (job.total_minutes_worked || 0) + Math.floor(sessionElapsed / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  };

  const isMultiday = !!job.is_multiday;
  const inSession  = !!job.current_session_start;

  const professionalName = job.professionals
    ? `${job.professionals.first_name || ''} ${job.professionals.last_name || ''}`.trim() || 'Profesional'
    : 'Profesional en camino';

  const mapHtml = `
<!DOCTYPE html><html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>*{margin:0;padding:0}#map{width:100vw;height:100vh;background:#0a0a0a}</style>
</head>
<body>
<div id="map"></div>
<script>
const map = L.map('map',{zoomControl:false,attributionControl:false})
  .setView([${job.client_lat || -38.71}, ${job.client_lng || -62.26}], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
const clientIcon = L.divIcon({html:'<div style="width:18px;height:18px;border-radius:50%;background:#FFD600;border:3px solid white;box-shadow:0 0 10px rgba(255,214,0,0.8)"></div>',iconSize:[18,18],iconAnchor:[9,9],className:''});
const workerIcon = L.divIcon({html:'<div style="width:34px;height:34px;border-radius:17px;background:#1a1a1a;border:2.5px solid #4285F4;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 12px rgba(66,133,244,0.6)">⚡</div>',iconSize:[34,34],iconAnchor:[17,17],className:''});
L.marker([${job.client_lat || -38.71}, ${job.client_lng || -62.26}],{icon:clientIcon}).addTo(map).bindPopup('Tu ubicación').openPopup();
let workerMarker = null;
window.addEventListener('message', e => {
  try {
    const msg = JSON.parse(e.data);
    if(msg.type==='WORKER_MOVE'){
      if(workerMarker) workerMarker.setLatLng([msg.lat,msg.lng]);
      else workerMarker = L.marker([msg.lat,msg.lng],{icon:workerIcon}).addTo(map);
    }
  } catch {}
});
</script>
</body></html>`;

  return (
    <SafeAreaView style={styles.container}>

      {/* Modal de disponibilidad post-trabajo (trabajador) */}
      <Modal visible={completedModal} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={styles.completedOverlay}>
          <View style={styles.completedBox}>
            <Ionicons name="checkmark-circle" size={52} color="#4CAF50" />
            <Text style={styles.completedTitle}>¡Pago recibido!</Text>
            <Text style={styles.completedSub}>Buen trabajo. ¿Cuándo volvés a estar disponible para nuevos pedidos?</Text>
            {[
              { label: 'Ahora mismo',  icon: 'flash',        hours: 0 },
              { label: 'En 1 hora',    icon: 'time-outline', hours: 1 },
              { label: 'En 2 horas',   icon: 'time-outline', hours: 2 },
              { label: 'En 3 horas',   icon: 'time-outline', hours: 3 },
            ].map(opt => (
              <TouchableOpacity
                key={opt.label}
                style={styles.completedOpt}
                onPress={() => handleAvailabilityAndComplete(opt.hours)}
                activeOpacity={0.8}
              >
                <Ionicons name={opt.icon} size={18} color="#FFD600" />
                <Text style={styles.completedOptText}>{opt.label}</Text>
                <Ionicons name="chevron-forward" size={16} color="#444" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Modal de verificación de código (cliente) */}
      <Modal visible={codeModal} transparent animationType="slide" onRequestClose={() => { setCodeModal(false); setEnteredCode(''); setCodeResult(null); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Ionicons name="shield-checkmark" size={28} color="#FFD600" />
              <Text style={styles.modalTitle}>Verificar identidad</Text>
            </View>
            <Text style={styles.modalSub}>
              Pedile al profesional el código de 4 dígitos que aparece en su teléfono e ingresalo acá.
            </Text>

            {codeResult === null && (
              <>
                <TextInput
                  style={styles.codeInput}
                  placeholder="1234"
                  placeholderTextColor="#333"
                  value={enteredCode}
                  onChangeText={v => setEnteredCode(v.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="numeric"
                  maxLength={4}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.codeVerifyBtn, enteredCode.length !== 4 && { opacity: 0.4 }]}
                  onPress={handleVerifyCode}
                  disabled={enteredCode.length !== 4}
                >
                  <Text style={styles.codeVerifyBtnText}>Verificar</Text>
                </TouchableOpacity>
              </>
            )}

            {codeResult === 'ok' && (
              <View style={styles.codeOkBox}>
                <Ionicons name="checkmark-circle" size={40} color="#4CAF50" />
                <Text style={styles.codeOkTitle}>¡Código correcto!</Text>
                <Text style={styles.codeOkSub}>Es tu profesional VOLT verificado. Podés abrir la puerta.</Text>
                <TouchableOpacity style={styles.codeCloseBtn} onPress={() => { setCodeModal(false); setEnteredCode(''); setCodeResult(null); }}>
                  <Text style={styles.codeCloseBtnText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            )}

            {codeResult === 'error' && (
              <View style={styles.codeErrorBox}>
                <Ionicons name="close-circle" size={40} color="#ff4444" />
                <Text style={styles.codeErrorTitle}>Código incorrecto</Text>
                <Text style={styles.codeErrorSub}>No abras la puerta. Contactá al soporte de VOLT si el problema continúa.</Text>
                <TouchableOpacity style={styles.codeRetryBtn} onPress={() => { setEnteredCode(''); setCodeResult(null); }}>
                  <Text style={styles.codeRetryBtnText}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal TENGO UN PROBLEMA */}
      <Modal visible={problemModal} transparent animationType="slide" onRequestClose={() => setProblemModal(false)}>
        <TouchableOpacity style={styles.problemOverlay} activeOpacity={1} onPress={() => setProblemModal(false)}>
          <TouchableOpacity style={styles.problemBox} activeOpacity={1} onPress={() => {}}>
            <View style={styles.problemHeader}>
              <Ionicons name="warning" size={22} color="#FF9800" />
              <Text style={styles.problemTitle}>¿Cuál es el problema?</Text>
              <TouchableOpacity onPress={() => setProblemModal(false)}>
                <Ionicons name="close" size={22} color="#555" />
              </TouchableOpacity>
            </View>
            {PROBLEM_ISSUES.map(issue => (
              <TouchableOpacity key={issue.text} style={styles.problemItem} onPress={() => handleReportIssue(issue.text)}>
                <Ionicons name={issue.icon} size={16} color="#888" />
                <Text style={styles.problemItemText}>{issue.text}</Text>
                <Ionicons name="chevron-forward" size={14} color="#333" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.supportBtn} onPress={() => {
              setProblemModal(false);
              Linking.openURL('https://wa.me/5492914000000?text=Hola%2C%20necesito%20soporte%20con%20un%20trabajo%20VOLT');
            }}>
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
              <Text style={styles.supportBtnText}>Contactar soporte VOLT</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
        <Text style={styles.headerStatus}>{statusInfo.label}</Text>
        {['pending', 'awaiting_payment'].includes(job.status) && (
          <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleEmergency} style={styles.emergencyBtn}>
          <Ionicons name="call" size={18} color="#ff4444" />
          <Text style={styles.emergencyBtnText}>911</Text>
        </TouchableOpacity>
      </View>

      {/* Mapa */}
      {!isWorker && (
        <WebView
          ref={webRef}
          style={styles.map}
          source={{ html: mapHtml }}
          javaScriptEnabled
          scrollEnabled={false}
          originWhitelist={['*']}
        />
      )}

      {/* Panel inferior */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Tip contextual */}
          {tip && (
            <View style={styles.tipBar}>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          )}

          {/* Código de verificación — trabajador cuando llegó */}
          {isWorker && job.status === 'arrived' && job.verification_code && (
            <View style={styles.codeDisplay}>
              <Text style={styles.codeDisplayLabel}>Tu código de verificación</Text>
              <Text style={styles.codeDisplayNumber}>{job.verification_code}</Text>
              <Text style={styles.codeDisplayHint}>Mostráselo al cliente antes de que te abra. Es obligatorio.</Text>
            </View>
          )}

          {/* Respuesta del profesional — cliente cuando status = accepted */}
          {!isWorker && job.status === 'accepted' && (job.arrival_estimate || job.pre_diagnosis || job.materials_needed || job.work_duration_est) && (
            <View style={styles.workerResponseCard}>
              <Text style={styles.workerResponseTitle}>Respuesta del profesional</Text>
              {job.arrival_estimate ? (
                <View style={styles.workerResponseRow}>
                  <Ionicons name="time-outline" size={15} color="#4285F4" />
                  <Text style={styles.workerResponseText}>Llega en {job.arrival_estimate}</Text>
                </View>
              ) : null}
              {job.work_duration_est ? (
                <View style={styles.workerResponseRow}>
                  <Ionicons name="calendar-outline" size={15} color="#4CAF50" />
                  <Text style={styles.workerResponseText}>Duración estimada: {job.work_duration_est}</Text>
                </View>
              ) : null}
              {job.pre_diagnosis ? (
                <View style={styles.workerResponseRow}>
                  <Ionicons name="bulb-outline" size={15} color="#FFD600" />
                  <Text style={styles.workerResponseText}>Posible problema: "{job.pre_diagnosis}"</Text>
                </View>
              ) : null}
              {job.materials_needed ? (
                <View style={styles.workerResponseRow}>
                  <Ionicons name="construct-outline" size={15} color="#FF9800" />
                  <Text style={styles.workerResponseText}>Va a necesitar materiales para el trabajo</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Progreso multi-día — visible para ambas partes */}
          {isMultiday && ['accepted','arrived','in_progress'].includes(job.status) && (
            <View style={styles.sessionCard}>
              <View style={styles.sessionCardRow}>
                <Ionicons name="calendar" size={18} color="#FFD600" />
                <Text style={styles.sessionCardTitle}>
                  Sesión {(job.completed_sessions || 0) + (inSession ? 1 : 0)} de {job.estimated_sessions || '?'}
                </Text>
                <Text style={styles.sessionCardHours}>{totalMinutesFormatted()} trabajadas</Text>
              </View>
              {job.estimated_hrs_session && (
                <Text style={styles.sessionCardSub}>
                  Estimado: {job.estimated_hrs_session} por día · {job.estimated_sessions} días total
                </Text>
              )}
              {inSession && (
                <View style={styles.sessionTimerRow}>
                  <View style={styles.sessionTimerDot} />
                  <Text style={styles.sessionTimerText}>Sesión en curso: {fmtTime(sessionElapsed)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Contador de tiempo de trabajo — single-day, visible para ambas partes */}
          {job.status === 'in_progress' && !isMultiday && (
            <View style={styles.workTimerCard}>
              <View style={styles.workTimerDot} />
              <Text style={styles.workTimerLabel}>Trabajo en curso</Text>
              <Text style={styles.workTimerValue}>{fmtTime(workElapsed)}</Text>
            </View>
          )}

          {/* Comprando materiales — info para cliente */}
          {!isWorker && job.status === 'arrived' && job.is_buying_materials && (
            <View style={styles.buyingCard}>
              <Ionicons name="cart-outline" size={20} color="#FF9800" />
              <View style={{ flex: 1 }}>
                <Text style={styles.buyingText}>El profesional está comprando materiales</Text>
                {job.materials_eta && (
                  <Text style={styles.buyingEta}>
                    Vuelve estimado: {new Date(job.materials_eta).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Botón verificar código — cliente cuando llegó el trabajador y NO está comprando */}
          {!isWorker && job.status === 'arrived' && !job.is_buying_materials && (
            <TouchableOpacity style={styles.verifyCodeBtn} onPress={() => { setEnteredCode(''); setCodeResult(null); setCodeModal(true); }}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#FFD600" />
              <Text style={styles.verifyCodeBtnText}>Verificar código del profesional</Text>
              <Ionicons name="chevron-forward" size={16} color="#FFD600" />
            </TouchableOpacity>
          )}

          {/* Info del trabajo */}
          <View style={styles.jobInfo}>
            <Ionicons name={statusInfo.icon} size={22} color={statusInfo.color} />
            <View style={{ flex: 1 }}>
              <Text style={styles.jobInfoTitle}>
                {isWorker ? `Cliente · ${job.address || 'Ver ubicación'}` : professionalName}
              </Text>
              {!isWorker && job.status !== 'pending' && (
                <Text style={styles.jobInfoSub}>{job.address || ''}</Text>
              )}
              {job.work_amount && (
                <Text style={styles.jobAmount}>Total: ${job.work_amount.toLocaleString('es-AR')}</Text>
              )}
            </View>
            <View style={styles.visitBadge}>
              <Text style={styles.visitBadgeText}>Visita ${(job.visit_amount || 30000).toLocaleString('es-AR')}</Text>
            </View>
          </View>

          {/* ─── Acciones del trabajador ─── */}

          {/* Llegué al domicilio (status = accepted) */}
          {isWorker && job.status === 'accepted' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('arrive')} disabled={loading}>
              {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                <><Ionicons name="home" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Llegué al domicilio</Text></>
              )}
            </TouchableOpacity>
          )}

          {/* arrived + single-day: iniciar trabajo o salir a comprar materiales */}
          {isWorker && job.status === 'arrived' && !isMultiday && !job.is_buying_materials && (
            <>
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('start')} disabled={loading}>
                {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <><Ionicons name="construct" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Iniciar trabajo</Text></>
                )}
              </TouchableOpacity>
              {job.materials_needed && (
                <TouchableOpacity
                  style={styles.actionBtnSecondary}
                  onPress={() => Alert.alert('¿Salir a comprar materiales?', '¿Cuánto tardás?', [
                    { text: '15 min',  onPress: () => jobService.startBuyingMaterials(job.id, 15) },
                    { text: '30 min',  onPress: () => jobService.startBuyingMaterials(job.id, 30) },
                    { text: '45 min',  onPress: () => jobService.startBuyingMaterials(job.id, 45) },
                    { text: '1 hora',  onPress: () => jobService.startBuyingMaterials(job.id, 60) },
                    { text: 'Cancelar', style: 'cancel' },
                  ])}
                  disabled={loading}
                >
                  <Ionicons name="cart-outline" size={18} color="#FF9800" />
                  <Text style={styles.actionBtnSecondaryText}>Necesito comprar materiales</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* arrived + comprando materiales */}
          {isWorker && job.status === 'arrived' && job.is_buying_materials && (
            <View style={styles.buyingCard}>
              <Ionicons name="cart" size={22} color="#FF9800" />
              <Text style={styles.buyingText}>Comprando materiales...</Text>
              <TouchableOpacity style={styles.actionBtn} onPress={() => jobService.returnedWithMaterials(job.id)} disabled={loading}>
                <Ionicons name="checkmark-circle" size={18} color="#0A0A0A" />
                <Text style={styles.actionBtnText}>Volví con los materiales</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* arrived + multi-día: iniciar sesión del día */}
          {isWorker && job.status === 'arrived' && isMultiday && !inSession && (
            <>
              <TouchableOpacity style={styles.actionBtn} onPress={async () => {
                setLoading(true);
                try { await jobService.startSession(job.id); } catch { Alert.alert('Error', 'No se pudo iniciar la sesión.'); }
                finally { setLoading(false); }
              }} disabled={loading}>
                {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <><Ionicons name="play" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Iniciar sesión de hoy</Text></>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* in_progress + single-day: cobrar */}
          {isWorker && job.status === 'in_progress' && !isMultiday && (
            <View style={styles.amountRow}>
              {job.materials_needed && (
                <View style={styles.amountInputWrap}>
                  <Ionicons name="cart-outline" size={18} color="#FF9800" />
                  <TextInput
                    style={styles.amountInput}
                    placeholder="Costo materiales (sin comisión)"
                    placeholderTextColor="#444"
                    value={materialsAmount}
                    onChangeText={v => setMaterialsAmount(v.replace(/\D/g, ''))}
                    keyboardType="numeric"
                  />
                </View>
              )}
              <View style={styles.amountInputWrap}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Mano de obra (sin visita)"
                  placeholderTextColor="#444"
                  value={workAmount}
                  onChangeText={v => setWorkAmount(v.replace(/\D/g, ''))}
                  keyboardType="numeric"
                />
              </View>
              {(workAmount || materialsAmount) ? (
                <View style={styles.amountPreview}>
                  {job.materials_needed && materialsAmount ? (
                    <Text style={styles.amountPreviewLine}>
                      Materiales: ${parseInt(materialsAmount || '0').toLocaleString('es-AR')} <Text style={styles.amountPreviewNote}>(sin comisión)</Text>
                    </Text>
                  ) : null}
                  <Text style={styles.amountPreviewLine}>
                    Mano de obra: ${parseInt(workAmount || '0').toLocaleString('es-AR')}
                  </Text>
                  <Text style={styles.amountPreviewTotal}>
                    Total cliente: ${((job.visit_amount || 30000) + (parseInt(materialsAmount || '0')) + (parseInt(workAmount || '0'))).toLocaleString('es-AR')}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('set_amount')} disabled={loading}>
                {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <><Ionicons name="send" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Enviar cobro al cliente</Text></>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* in_progress + multi-día: terminar sesión de hoy o cobrar si es el último día */}
          {isWorker && job.status === 'in_progress' && isMultiday && inSession && (
            <View style={styles.sessionActions}>
              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={async () => {
                  setLoading(true);
                  try {
                    await jobService.endSession(job.id, job.current_session_start, job.completed_sessions || 0, job.total_minutes_worked || 0);
                    await notificationService.sendToUser(clientId, {
                      title: '📋 Jornada terminada',
                      body: `El profesional terminó por hoy. Sesión ${(job.completed_sessions || 0) + 1} de ${job.estimated_sessions || '?'} completada.`,
                      data: { jobId: job.id },
                    });
                  } catch { Alert.alert('Error', 'No se pudo guardar la sesión.'); }
                  finally { setLoading(false); }
                }}
                disabled={loading}
              >
                <Ionicons name="moon-outline" size={18} color="#4285F4" />
                <Text style={styles.actionBtnSecondaryText}>Terminar por hoy · vuelvo mañana</Text>
              </TouchableOpacity>

              <View style={styles.amountRow}>
                {job.materials_needed && (
                  <View style={styles.amountInputWrap}>
                    <Ionicons name="cart-outline" size={18} color="#FF9800" />
                    <TextInput
                      style={styles.amountInput}
                      placeholder="Materiales (sin comisión)"
                      placeholderTextColor="#444"
                      value={materialsAmount}
                      onChangeText={v => setMaterialsAmount(v.replace(/\D/g, ''))}
                      keyboardType="numeric"
                    />
                  </View>
                )}
                <View style={styles.amountInputWrap}>
                  <Text style={styles.currency}>$</Text>
                  <TextInput
                    style={styles.amountInput}
                    placeholder="Mano de obra total"
                    placeholderTextColor="#444"
                    value={workAmount}
                    onChangeText={v => setWorkAmount(v.replace(/\D/g, ''))}
                    keyboardType="numeric"
                  />
                </View>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={async () => {
                    const labor = parseInt(workAmount.replace(/\D/g, ''), 10);
                    if (!labor || labor < 1000) { Alert.alert('Revisá el monto', 'Ingresá el costo de mano de obra.'); return; }
                    const mats = parseInt(materialsAmount.replace(/\D/g, ''), 10) || 0;
                    setLoading(true);
                    try {
                      await jobService.completeMultidayJob(job.id, labor, mats, job.current_session_start, job.completed_sessions || 0, job.total_minutes_worked || 0);
                      const visitAmt = job.visit_amount || 30000;
                      const total = visitAmt + mats + labor;
                      await notificationService.sendToUser(clientId, {
                        title: '💳 Trabajo terminado — hora de pagar',
                        body: mats > 0
                          ? `Visita $${visitAmt.toLocaleString('es-AR')} + Materiales $${mats.toLocaleString('es-AR')} + Mano de obra $${labor.toLocaleString('es-AR')} = $${total.toLocaleString('es-AR')}`
                          : `Visita $${visitAmt.toLocaleString('es-AR')} + Trabajo $${labor.toLocaleString('es-AR')} = $${total.toLocaleString('es-AR')}`,
                        data: { jobId: job.id },
                      });
                    } catch { Alert.alert('Error', 'No se pudo completar el trabajo.'); }
                    finally { setLoading(false); }
                  }}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                    <><Ionicons name="checkmark-done" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Trabajo listo · cobrar</Text></>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Trabajador esperando pago */}
          {isWorker && job.status === 'awaiting_payment' && (
            <View style={styles.waitingPayCard}>
              <View style={styles.waitingPayRow}>
                <ActivityIndicator size="small" color="#4CAF50" />
                <Text style={styles.waitingPayText}>Esperando que el cliente pague...</Text>
              </View>
              <TouchableOpacity style={styles.cancelJobBtn} onPress={handleCancel} disabled={loading}>
                <Ionicons name="close-circle-outline" size={16} color="#ff4444" />
                <Text style={styles.cancelJobBtnText}>El cliente no quiere pagar — cancelar</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Acción del cliente — confirmar pago */}
          {!isWorker && job.status === 'awaiting_payment' && (() => {
            const visitAmt = job.visit_amount    || 30000;
            const matsAmt  = job.materials_cost  || 0;
            const workAmt  = job.work_amount     || 0;
            const total    = visitAmt + matsAmt + workAmt;
            return (
              <View style={styles.paySection}>
                <View style={styles.payBreakdown}>
                  <View style={styles.payRow}>
                    <Text style={styles.payRowLabel}>Visita / diagnóstico</Text>
                    <Text style={styles.payRowVal}>${visitAmt.toLocaleString('es-AR')}</Text>
                  </View>
                  {matsAmt > 0 && (
                    <View style={styles.payRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.payRowLabel}>Materiales</Text>
                        <Text style={styles.payRowNote}>sin comisión VOLT</Text>
                      </View>
                      <Text style={styles.payRowVal}>${matsAmt.toLocaleString('es-AR')}</Text>
                    </View>
                  )}
                  <View style={styles.payRow}>
                    <Text style={styles.payRowLabel}>Mano de obra</Text>
                    <Text style={styles.payRowVal}>${workAmt.toLocaleString('es-AR')}</Text>
                  </View>
                  <View style={styles.payDivider} />
                  <View style={styles.payRow}>
                    <Text style={styles.payTotalLabel}>TOTAL</Text>
                    <Text style={styles.payTotalVal}>${total.toLocaleString('es-AR')}</Text>
                  </View>
                </View>
                <View style={styles.cardOnlyBadge}>
                  <Ionicons name="card-outline" size={14} color="#4285F4" />
                  <Text style={styles.cardOnlyText}>Tarjeta de débito, crédito o billetera digital</Text>
                </View>
                <TouchableOpacity style={styles.payBtn} onPress={handleClientPay} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : (
                    <><Ionicons name="card" size={18} color="#fff" /><Text style={styles.payBtnText}>Pagar ${total.toLocaleString('es-AR')}</Text></>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.payProblemBtn} onPress={() => setProblemModal(true)}>
                  <Ionicons name="warning-outline" size={14} color="#FF9800" />
                  <Text style={styles.payProblemText}>¿Algo salió mal? Reportar un problema</Text>
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* Botón TENGO UN PROBLEMA — siempre visible */}
          <TouchableOpacity style={styles.problemBtn} onPress={() => setProblemModal(true)}>
            <Ionicons name="warning-outline" size={15} color="#FF9800" />
            <Text style={styles.problemBtnText}>TENGO UN PROBLEMA</Text>
            <Ionicons name="chevron-forward" size={14} color="#FF9800" />
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  statusDot:      { width: 10, height: 10, borderRadius: 5 },
  headerStatus:   { flex: 1, fontSize: 15, fontWeight: '700', color: '#F5F5F5' },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#ff444440' },
  cancelBtnText: { color: '#ff4444', fontSize: 13, fontWeight: '600' },
  emergencyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#ff444460',
    backgroundColor: 'rgba(255,68,68,0.08)',
  },
  emergencyBtnText: { color: '#ff4444', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },

  map: { flex: 1 },

  panel: {
    backgroundColor: '#111',
    borderTopWidth: 1, borderTopColor: '#1E1E1E',
    maxHeight: '60%',
  },
  panelContent: {
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 64 : 28,
    gap: 12,
  },

  // Tip contextual
  tipBar: {
    backgroundColor: '#0A0A0A', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
    paddingVertical: 10, paddingHorizontal: 14,
  },
  tipText: { fontSize: 13, color: '#666', lineHeight: 18 },

  // Código para el trabajador
  codeDisplay: {
    backgroundColor: '#1A1A00', borderRadius: 14,
    borderWidth: 2, borderColor: '#FFD600',
    padding: 16, alignItems: 'center',
  },
  codeDisplayLabel: { fontSize: 11, color: '#888', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  codeDisplayNumber: { fontSize: 48, fontWeight: '900', color: '#FFD600', letterSpacing: 10 },
  codeDisplayHint:   { fontSize: 12, color: '#888', marginTop: 8, textAlign: 'center' },

  // Botón verificar código para el cliente
  verifyCodeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1A00', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FFD60060',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  verifyCodeBtnText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#FFD600' },

  jobInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0A0A0A', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', padding: 14,
  },
  jobInfoTitle: { fontSize: 14, color: '#F5F5F5', fontWeight: '700' },
  jobInfoSub:   { fontSize: 12, color: '#555', marginTop: 2 },
  jobAmount:    { fontSize: 13, color: '#888', marginTop: 3 },
  visitBadge: {
    backgroundColor: '#1a1a1a', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  visitBadgeText: { color: '#FFD600', fontSize: 11, fontWeight: '700' },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 14, paddingVertical: 16,
  },
  actionBtnText: { color: '#0A0A0A', fontSize: 15, fontWeight: '900' },

  amountRow: { gap: 10 },
  amountInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0A0A0A', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', padding: 14, gap: 8,
  },
  currency:    { color: '#F5F5F5', fontSize: 20, fontWeight: '700' },
  amountInput: { flex: 1, color: '#F5F5F5', fontSize: 20, fontWeight: '700' },

  amountPreview: {
    backgroundColor: '#0A1500', borderRadius: 12,
    borderWidth: 1, borderColor: '#FFD60020',
    padding: 12, gap: 4,
  },
  amountPreviewLine: { fontSize: 13, color: '#BBBBBB' },
  amountPreviewNote: { fontSize: 11, color: '#555' },
  amountPreviewTotal: { fontSize: 15, fontWeight: '900', color: '#FFD600', marginTop: 4 },

  paySection:    { gap: 10 },
  payBreakdown: {
    backgroundColor: '#0A0A0A', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, gap: 10,
  },
  payRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payRowLabel:   { fontSize: 14, color: '#888' },
  payRowNote:    { fontSize: 11, color: '#555', marginTop: 2 },
  payRowVal:     { fontSize: 14, color: '#F5F5F5', fontWeight: '600' },
  payDivider:    { height: 1, backgroundColor: '#1E1E1E' },
  payTotalLabel: { fontSize: 16, fontWeight: '900', color: '#F5F5F5' },
  payTotalVal:   { fontSize: 20, fontWeight: '900', color: '#FFD600' },

  cardOnlyBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(66,133,244,0.08)',
    borderWidth: 1, borderColor: 'rgba(66,133,244,0.2)',
    borderRadius: 10, paddingVertical: 8,
  },
  cardOnlyText: { color: '#4285F4', fontSize: 12, fontWeight: '600' },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#4CAF50',
    borderRadius: 14, paddingVertical: 18,
  },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  // Modal de disponibilidad post-trabajo
  completedOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
  },
  completedBox: {
    width: '100%', backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: '#1E1E1E',
    padding: 24, alignItems: 'center', gap: 8,
  },
  completedTitle: { fontSize: 22, fontWeight: '900', color: '#F5F5F5', marginTop: 4 },
  completedSub:   { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  completedOpt: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  completedOptText: { flex: 1, fontSize: 16, color: '#F5F5F5', fontWeight: '600' },

  // Respuesta del profesional (cliente)
  workerResponseCard: {
    backgroundColor: '#0A0F1A', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E2A3A',
    padding: 14, gap: 10,
  },
  workerResponseTitle: {
    fontSize: 11, fontWeight: '800', color: '#4285F4',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
  },
  workerResponseRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  workerResponseText: { flex: 1, fontSize: 13, color: '#BBBBBB', lineHeight: 18 },

  // Sesión multi-día
  sessionCard: {
    backgroundColor: '#0A1500', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FFD60030',
    padding: 14, gap: 8,
  },
  sessionCardRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessionCardTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: '#FFD600' },
  sessionCardHours: { fontSize: 13, color: '#888', fontWeight: '600' },
  sessionCardSub:   { fontSize: 12, color: '#555', lineHeight: 17 },
  sessionTimerRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sessionTimerDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  sessionTimerText: { fontSize: 13, color: '#4CAF50', fontWeight: '700' },

  sessionActions: { gap: 10 },
  actionBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, paddingVertical: 15,
    borderWidth: 1.5, borderColor: '#4285F430',
    backgroundColor: 'rgba(66,133,244,0.06)',
  },
  actionBtnSecondaryText: { color: '#4285F4', fontSize: 14, fontWeight: '800' },

  // Comprando materiales
  buyingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#1A0D00', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FF980040', padding: 14,
  },
  buyingText: { fontSize: 13, color: '#FF9800', fontWeight: '700', lineHeight: 18 },
  buyingEta:  { fontSize: 12, color: '#FF980088', marginTop: 4 },

  // Modal de verificación de código
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
  },
  modalBox: {
    width: '100%', backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: '#1E1E1E',
    padding: 24, gap: 16,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalTitle:  { fontSize: 18, fontWeight: '900', color: '#F5F5F5' },
  modalSub:    { fontSize: 14, color: '#666', lineHeight: 20 },

  codeInput: {
    backgroundColor: '#0A0A0A', borderRadius: 14,
    borderWidth: 2, borderColor: '#FFD600',
    color: '#FFD600', fontSize: 40, fontWeight: '900',
    textAlign: 'center', paddingVertical: 18, letterSpacing: 16,
  },
  codeVerifyBtn: {
    backgroundColor: '#FFD600', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  codeVerifyBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  codeOkBox: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  codeOkTitle: { fontSize: 20, fontWeight: '900', color: '#4CAF50' },
  codeOkSub:   { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  codeCloseBtn: { backgroundColor: '#4CAF50', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  codeCloseBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },

  codeErrorBox: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  codeErrorTitle: { fontSize: 20, fontWeight: '900', color: '#ff4444' },
  codeErrorSub:   { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  codeRetryBtn: { backgroundColor: 'rgba(255,68,68,0.12)', borderWidth: 1.5, borderColor: '#ff444450', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  codeRetryBtnText: { color: '#ff4444', fontSize: 15, fontWeight: '900' },

  // Timer de trabajo en curso
  workTimerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0A1500', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#4CAF5040',
    paddingVertical: 12, paddingHorizontal: 14,
  },
  workTimerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  workTimerLabel: { flex: 1, fontSize: 13, color: '#4CAF50', fontWeight: '700' },
  workTimerValue: { fontSize: 20, fontWeight: '900', color: '#4CAF50', letterSpacing: 1 },

  // Botón TENGO UN PROBLEMA
  problemBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: '#FF980030',
    backgroundColor: 'rgba(255,152,0,0.05)',
  },
  problemBtnText: { flex: 1, color: '#FF9800', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  // Modal TENGO UN PROBLEMA
  problemOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
  },
  problemBox: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: '#1E1E1E',
    padding: 20, paddingBottom: Platform.OS === 'android' ? 36 : 20, gap: 2,
  },
  problemHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 14,
  },
  problemTitle: { flex: 1, fontSize: 17, fontWeight: '900', color: '#F5F5F5' },
  problemItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  problemItemText: { flex: 1, fontSize: 14, color: '#BBBBBB', lineHeight: 20 },
  supportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'rgba(37,211,102,0.08)',
    borderWidth: 1, borderColor: 'rgba(37,211,102,0.25)',
    borderRadius: 14, paddingVertical: 16, marginTop: 12,
  },
  supportBtnText: { color: '#25D366', fontSize: 15, fontWeight: '800' },

  // Trabajador esperando pago
  waitingPayCard: {
    backgroundColor: '#0A1200', borderRadius: 14,
    borderWidth: 1, borderColor: '#4CAF5030',
    padding: 14, gap: 12,
  },
  waitingPayRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitingPayText: { flex: 1, fontSize: 14, color: '#4CAF50', fontWeight: '700' },
  cancelJobBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: '#ff444430',
    backgroundColor: 'rgba(255,68,68,0.06)',
  },
  cancelJobBtnText: { color: '#ff4444', fontSize: 13, fontWeight: '700' },

  // Pago — opción de problema
  payProblemBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
  },
  payProblemText: { color: '#FF9800', fontSize: 13, fontWeight: '600' },
});

export default JobTrackingScreen;

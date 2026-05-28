import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
  Modal, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import paymentService from '../services/paymentService';

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

const JobTrackingScreen = ({ job: initialJob, session, professional, onComplete, onCancel }) => {
  const [job, setJob]               = useState(initialJob);
  const [workAmount, setWorkAmount] = useState('');
  const [loading, setLoading]       = useState(false);
  const [codeModal, setCodeModal]   = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [codeResult, setCodeResult] = useState(null); // null | 'ok' | 'error'
  const webRef = useRef(null);

  const isWorker = !!professional;
  const userId   = session?.user?.id;
  const clientId = job.client_id;

  // Suscribir a cambios del job
  useEffect(() => {
    const channel = jobService.subscribeToJob(job.id, (updated) => setJob(updated));
    return () => { if (channel) channel.unsubscribe?.(); };
  }, [job.id]);

  // Cancelación o finalización detectada vía realtime
  useEffect(() => {
    if (job.status === 'cancelled' && isWorker) {
      Alert.alert('Trabajo cancelado', 'El cliente eligió otro profesional.', [{ text: 'Entendido', onPress: onCancel }]);
    }
    if (job.status === 'completed' && isWorker) {
      Alert.alert('¡Pago recibido!', 'El cliente completó el pago. ¡Buen trabajo!', [{ text: 'Volver al inicio', onPress: () => onComplete(job) }]);
    }
    if (job.status === 'completed' && !isWorker) {
      onComplete(job);
    }
  }, [job.status]);

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
        notifTitle = '📍 El profesional llegó';
        notifBody  = '🔒 IMPORTANTE: antes de abrir, pedile el código de 4 dígitos que aparece en su app. Si no te da el código, no abras.';
      } else if (action === 'start') {
        await jobService.start(job.id);
        notifTitle = '🔧 Trabajo iniciado';
        notifBody  = 'El profesional comenzó el trabajo.';
      } else if (action === 'set_amount') {
        const amount = parseInt(workAmount.replace(/\D/g, ''), 10);
        if (!amount || amount < 1000) {
          Alert.alert('Revisá el monto', 'Ingresá el costo del trabajo (sin incluir la visita).');
          setLoading(false);
          return;
        }
        await jobService.setWorkAmount(job.id, amount);
        const visitAmount = job.visit_amount || 30000;
        const total = visitAmount + amount;
        notifTitle = '💳 Pago pendiente';
        notifBody  = `Visita $${visitAmount.toLocaleString('es-AR')} + Trabajo $${amount.toLocaleString('es-AR')} = Total $${total.toLocaleString('es-AR')}. Confirmá para pagar.`;
      }

      if (notifTitle) {
        await notificationService.sendToUser(clientId, { title: notifTitle, body: notifBody, data: { jobId: job.id } });
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
        onComplete(job);
      } else if (result === 'failure') {
        Alert.alert('Pago rechazado', 'El pago no fue procesado. Intentá con otra tarjeta.');
      } else if (result === 'pending') {
        Alert.alert('Procesando pago', 'Tu pago está siendo verificado. Te avisaremos cuando se confirme.');
      } else {
        Alert.alert('Pago cancelado', 'Cerraste el pago sin completarlo. El profesional sigue esperando.\n\nPodés volver a pagar cuando quieras.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo iniciar el pago. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    Alert.alert('¿Cancelar trabajo?', 'Esta acción no se puede deshacer.', [
      { text: 'No', style: 'cancel' },
      { text: 'Sí, cancelar', style: 'destructive', onPress: async () => {
        await jobService.cancel(job.id, userId);
        onCancel();
      }},
    ]);
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

  const statusInfo = STATUS_INFO[job.status] || STATUS_INFO.pending;
  const tip = isWorker ? WORKER_TIPS[job.status] : CLIENT_TIPS[job.status];

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

      {/* Modal de verificación de código (cliente) */}
      <Modal visible={codeModal} transparent animationType="slide" onRequestClose={() => { setCodeModal(false); setEnteredCode(''); setCodeResult(null); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
        <Text style={styles.headerStatus}>{statusInfo.label}</Text>
        {job.status === 'pending' && (
          <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleEmergency} style={styles.emergencyBtn}>
          <Ionicons name="call" size={13} color="#ff4444" />
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.panel}>

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

          {/* Botón verificar código — cliente cuando llegó el trabajador */}
          {!isWorker && job.status === 'arrived' && (
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
                {isWorker ? `Cliente · ${job.address || 'Ver ubicación'}` : 'Profesional en camino'}
              </Text>
              {job.work_amount && (
                <Text style={styles.jobAmount}>Total: ${job.work_amount.toLocaleString('es-AR')}</Text>
              )}
            </View>
            <View style={styles.visitBadge}>
              <Text style={styles.visitBadgeText}>Visita ${(job.visit_amount || 30000).toLocaleString('es-AR')}</Text>
            </View>
          </View>

          {/* Acciones del trabajador */}
          {isWorker && job.status === 'accepted' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('arrive')} disabled={loading}>
              {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                <><Ionicons name="home" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Llegué al domicilio</Text></>
              )}
            </TouchableOpacity>
          )}

          {isWorker && job.status === 'arrived' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('start')} disabled={loading}>
              {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                <><Ionicons name="construct" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Iniciar trabajo</Text></>
              )}
            </TouchableOpacity>
          )}

          {isWorker && job.status === 'in_progress' && (
            <View style={styles.amountRow}>
              <View style={styles.amountInputWrap}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Costo del trabajo (sin visita)"
                  placeholderTextColor="#444"
                  value={workAmount}
                  onChangeText={v => setWorkAmount(v.replace(/\D/g, ''))}
                  keyboardType="numeric"
                />
              </View>
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('set_amount')} disabled={loading}>
                {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <><Ionicons name="send" size={18} color="#0A0A0A" /><Text style={styles.actionBtnText}>Cobrar</Text></>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Acción del cliente — confirmar pago */}
          {!isWorker && job.status === 'awaiting_payment' && (() => {
            const visitAmt = job.visit_amount || 30000;
            const workAmt  = job.work_amount  || 0;
            const total    = visitAmt + workAmt;
            return (
              <View style={styles.paySection}>
                <View style={styles.payBreakdown}>
                  <View style={styles.payRow}>
                    <Text style={styles.payRowLabel}>Visita / diagnóstico</Text>
                    <Text style={styles.payRowVal}>${visitAmt.toLocaleString('es-AR')}</Text>
                  </View>
                  <View style={styles.payRow}>
                    <Text style={styles.payRowLabel}>Trabajo realizado</Text>
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
                  <Text style={styles.cardOnlyText}>Solo tarjeta de débito o crédito</Text>
                </View>
                <TouchableOpacity style={styles.payBtn} onPress={handleClientPay} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : (
                    <><Ionicons name="card" size={18} color="#fff" /><Text style={styles.payBtnText}>Pagar ${total.toLocaleString('es-AR')} con tarjeta</Text></>
                  )}
                </TouchableOpacity>
              </View>
            );
          })()}

        </View>
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
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#ff444460',
    backgroundColor: 'rgba(255,68,68,0.08)',
  },
  emergencyBtnText: { color: '#ff4444', fontSize: 12, fontWeight: '900' },

  map: { flex: 1 },

  panel: {
    backgroundColor: '#111',
    borderTopWidth: 1, borderTopColor: '#1E1E1E',
    padding: 16, paddingBottom: 28,
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
  jobInfoTitle: { fontSize: 14, color: '#F5F5F5', fontWeight: '600' },
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

  paySection:    { gap: 10 },
  payBreakdown: {
    backgroundColor: '#0A0A0A', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, gap: 10,
  },
  payRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payRowLabel:   { fontSize: 14, color: '#888' },
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
});

export default JobTrackingScreen;

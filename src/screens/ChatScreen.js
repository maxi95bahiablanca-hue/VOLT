import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, KeyboardAvoidingView, Platform, SafeAreaView,
  ActivityIndicator, Image, Alert, Dimensions,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import ChatAttachment from '../components/ChatAttachment';
import chatService, { ETIQUETA } from '../services/chatService';
import demoChatService from '../demo/demoChatService';
import { isDemoMode } from '../demo/demoMode';
import volt from '../utils/voltVoice';
import notificationService from '../services/notificationService';
import { isFreeMode } from '../config/monetization';

const STATUS_LABELS = {
  pending:          'Buscando profesional...',
  accepted:         'En camino',
  arrived:          'Llegó al lugar',
  in_progress:      'Trabajando',
  awaiting_payment: isFreeMode() ? 'Por finalizar' : 'Esperando pago',
  completed:        'Completado',
};

const STATUS_COLORS = {
  pending:          '#888',
  accepted:         '#4285F4',
  arrived:          '#FFD600',
  in_progress:      '#FF9800',
  awaiting_payment: '#4CAF50',
  completed:        '#4CAF50',
};

const WORKER_QUICK = [
  'Estoy llegando ⚡',
  'Llego en 10 minutos',
  'Estoy en la puerta',
  'Necesito más información',
  'Necesitaré materiales',
  'Trabajo finalizado ✓',
];

const CLIENT_QUICK = [
  'Perfecto, te espero',
  'Estoy en casa',
  '¿Cuánto tardás?',
  '¿Necesitás algo?',
  '¿Cuánto va a costar?',
  '¡Excelente trabajo!',
];

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const ChatScreen = ({ job, userId, isWorker, onClose }) => {
  const [messages, setMessages] = useState([]);
  const [text, setText]         = useState('');
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [subiendo, setSubiendo] = useState(false);   // hay un adjunto en camino
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const listRef    = useRef(null);
  const channelRef = useRef(null);
  const recRef     = useRef(null);
  const cronoRef   = useRef(null);
  const insets     = useSafeAreaInsets();
  const chat = isDemoMode() ? demoChatService : chatService;

  useEffect(() => {
    let mounted = true;
    chat.getMessages(job.id).then(msgs => {
      if (mounted) { setMessages(msgs); setLoading(false); }
    }).catch(() => { if (mounted) setLoading(false); });

    channelRef.current = chat.subscribeToMessages(job.id, (newMsg) => {
      setMessages(prev => [...prev, newMsg]);
    });
    chat.markAsRead(job.id, userId).catch(() => {});

    return () => {
      mounted = false;
      if (chat.unsubscribe) chat.unsubscribe(channelRef.current);
      else channelRef.current?.unsubscribe?.();
      // Si sale del chat grabando, se corta y se descarta: no dejamos el
      // micrófono tomado ni un archivo colgado.
      clearInterval(cronoRef.current);
      recRef.current?.stopAndUnloadAsync?.().catch(() => {});
      recRef.current = null;
    };
  }, [job.id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const send = async (content) => {
    const txt = content ?? text.trim();
    if (!txt || sending) return;
    setSending(true);
    setText('');
    try {
      await chat.sendMessage(job.id, userId, txt);
      // Notificar a la otra parte (con sonido) — para que se entere aunque tenga la app cerrada
      if (!isDemoMode()) {
        const otherId = isWorker ? job.client_id : job.professionals?.user_id;
        const fromName = isWorker ? (job.professionals?.first_name || 'El profesional') : 'El cliente';
        if (otherId) {
          notificationService.sendToUser(otherId, {
            title: `💬 ${fromName}`,
            body: txt.length > 90 ? txt.slice(0, 90) + '…' : txt,
            data: { jobId: job.id, screen: 'tracking' },
          }).catch(() => {});
        }
      }
    } catch (e) {
      setText(txt);
      Alert.alert('No se pudo enviar', e?.message || 'Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSending(false);
    }
  };

  // ─── Adjuntos ─────────────────────────────────────────────────────────────
  // Se manda uno por vez y con aviso mientras sube: en el medio de un trabajo,
  // nadie se queda mirando una pantalla trabada sin saber si salió o no.
  const enviarAdjunto = async ({ uri, tipo, nombre, mime, duracion }) => {
    if (subiendo) return;
    setSubiendo(true);
    try {
      await chat.sendAttachment(job.id, userId, { uri, tipo, nombre, mime, duracion });
      if (!isDemoMode()) {
        const otherId = isWorker ? job.client_id : job.professionals?.user_id;
        const fromName = isWorker ? (job.professionals?.first_name || 'El profesional') : 'El cliente';
        if (otherId) {
          notificationService.sendToUser(otherId, {
            title: `💬 ${fromName}`,
            body:  ETIQUETA[tipo] || '📎 Adjunto',
            data:  { jobId: job.id, screen: 'tracking' },
          }).catch(() => {});
        }
      }
    } catch (e) {
      Alert.alert('No se pudo enviar', e?.message || 'Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSubiendo(false);
    }
  };

  const elegirDeGaleria = async (soloFotos) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos acceso a tus fotos.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: soloFotos ? ['images'] : ['images', 'videos'],
      quality: 0.7,
      videoMaxDuration: 60,
    });
    if (r.canceled) return;
    const a = r.assets[0];
    const esVideo = a.type === 'video';
    await enviarAdjunto({
      uri: a.uri,
      tipo: esVideo ? 'video' : 'image',
      nombre: a.fileName || undefined,
      mime: a.mimeType || (esVideo ? 'video/mp4' : 'image/jpeg'),
      duracion: a.duration ? Math.round(a.duration / 1000) : undefined,
    });
  };

  const sacarFoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos la cámara.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (r.canceled) return;
    await enviarAdjunto({ uri: r.assets[0].uri, tipo: 'image', mime: 'image/jpeg' });
  };

  const elegirArchivo = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    await enviarAdjunto({ uri: a.uri, tipo: 'file', nombre: a.name, mime: a.mimeType });
  };

  const abrirAdjuntos = () => {
    Alert.alert('Adjuntar', '¿Qué querés mandar?', [
      { text: 'Sacar una foto',        onPress: sacarFoto },
      { text: 'Foto o video',          onPress: () => elegirDeGaleria(false) },
      { text: 'Un archivo',            onPress: elegirArchivo },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  // ─── Audio ────────────────────────────────────────────────────────────────
  const grabarAudio = async () => {
    try {
      const permiso = await Audio.requestPermissionsAsync();
      if (!permiso.granted) { Alert.alert('Permiso requerido', 'Necesitamos el micrófono.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recRef.current = recording;
      setGrabando(true);
      setSegundos(0);
      cronoRef.current = setInterval(() => {
        setSegundos(s => {
          // Tope de 5 minutos: más que eso no es un mensaje, es una llamada.
          if (s >= 300) { detenerAudio(false); return s; }
          return s + 1;
        });
      }, 1000);
    } catch {
      Alert.alert('Ups', 'No pudimos acceder al micrófono.');
    }
  };

  const detenerAudio = async (descartar) => {
    clearInterval(cronoRef.current);
    const rec = recRef.current;
    recRef.current = null;
    const dur = segundos;
    setGrabando(false);
    setSegundos(0);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (descartar || !uri) return;
      if (dur < 1) { Alert.alert('Muy corto', 'Mantené apretado un poquito más para que se escuche.'); return; }
      await enviarAdjunto({ uri, tipo: 'audio', mime: 'audio/m4a', duracion: dur });
    } catch {
      Alert.alert('Ups', 'No pudimos guardar el audio.');
    }
  };

  const renderMsg = ({ item }) => {
    if (item.type === 'system') {
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{item.content}</Text>
        </View>
      );
    }
    const isMine = item.sender_id === userId;
    const time   = new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const conAdjunto = !!item.attachment_url;
    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowMine : styles.msgRowOther]}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther, conAdjunto && styles.bubbleAdjunto]}>
          {conAdjunto && <ChatAttachment msg={item} mine={isMine} />}
          {/* Con adjunto, el texto es sólo la etiqueta ("📷 Foto"): no hace
              falta repetirla debajo de la imagen. En audio y archivo tampoco,
              que ya se explican solos. */}
          {!conAdjunto && (
            <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
              {item.content}
            </Text>
          )}
          <View style={styles.bubbleMeta}>
            <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>{time}</Text>
            {isMine && (
              <Ionicons
                name={item.read_by_other ? 'checkmark-done' : 'checkmark'}
                size={12}
                color={item.read_by_other ? '#4285F4' : '#888'}
                style={{ marginLeft: 3 }}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  const statusColor = STATUS_COLORS[job.status] || '#888';
  const statusLabel = STATUS_LABELS[job.status] || job.status;

  const profName = !isWorker
    ? `${job.professionals?.first_name || ''} ${job.professionals?.last_name || ''}`.trim() || 'Profesional'
    : 'Cliente';

  const profRole = !isWorker
    ? (job.professions?.name || 'Profesional')
    : (job.professions?.name ? `Trabajo de ${job.professions.name}` : 'Servicio');

  // Tarjeta de contexto según estado del trabajo
  const renderContextCard = () => {
    const hasDiag     = job.pre_diagnosis || job.diagnosis_structured?.summary || job.diagnosis_structured?.cause;
    const hasMats     = job.materials_needed || (job.diagnosis_structured?.materials?.length > 0);
    const hasDuration = !!job.work_duration_est;

    if (['pending', 'accepted'].includes(job.status) && (hasDiag || hasMats || hasDuration)) {
      return (
        <View style={styles.contextCard}>
          <Text style={styles.contextCardTitle}>Diagnóstico preliminar</Text>
          {(job.pre_diagnosis || job.diagnosis_structured?.summary) && (
            <View style={styles.contextRow}>
              <Ionicons name="bulb-outline" size={14} color="#FFD600" />
              <Text style={styles.contextText}>
                {job.pre_diagnosis || job.diagnosis_structured?.summary}
              </Text>
            </View>
          )}
          {job.diagnosis_structured?.cause && (
            <View style={styles.contextRow}>
              <Ionicons name="analytics-outline" size={14} color="#888" />
              <Text style={styles.contextText}>Causa probable: {job.diagnosis_structured.cause}</Text>
            </View>
          )}
          {hasMats && (
            <View style={styles.contextRow}>
              <Ionicons name="cart-outline" size={14} color="#FF9800" />
              <Text style={[styles.contextText, { color: '#FF9800' }]}>
                {job.diagnosis_structured?.materials?.length > 0
                  ? `Materiales: ${job.diagnosis_structured.materials.join(', ')}`
                  : 'Podría necesitar materiales'
                }
              </Text>
            </View>
          )}
          {hasDuration && (
            <View style={styles.contextRow}>
              <Ionicons name="time-outline" size={14} color="#4285F4" />
              <Text style={styles.contextText}>Duración estimada: {job.work_duration_est}</Text>
            </View>
          )}
        </View>
      );
    }

    if (job.status === 'arrived') {
      return (
        <View style={[styles.contextCard, { borderColor: '#FFD60025' }]}>
          <Text style={styles.contextCardTitle}>El profesional llegó</Text>
          <View style={styles.contextRow}>
            <Ionicons name="shield-checkmark-outline" size={14} color="#FFD600" />
            <Text style={styles.contextText}>
              Pedile el código de 4 dígitos antes de abrir la puerta.
            </Text>
          </View>
        </View>
      );
    }

    if (job.status === 'in_progress') {
      return (
        <View style={[styles.contextCard, { borderColor: '#FF980025' }]}>
          <Text style={styles.contextCardTitle}>Trabajo en curso</Text>
          <View style={styles.contextRow}>
            <View style={styles.workingDot} />
            <Text style={[styles.contextText, { color: '#FF9800' }]}>
              El profesional está trabajando ahora mismo.
            </Text>
          </View>
          {job.work_summary?.solution && (
            <View style={styles.contextRow}>
              <Ionicons name="checkmark-circle-outline" size={14} color="#4CAF50" />
              <Text style={styles.contextText}>{job.work_summary.solution}</Text>
            </View>
          )}
        </View>
      );
    }

    return null;
  };

  const quickReplies = isWorker ? WORKER_QUICK : CLIENT_QUICK;

  return (
    <SafeAreaView style={styles.container}>

      {/* Header: foto + nombre + profesión + estado + llegada estimada */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#F5F5F5" />
        </TouchableOpacity>

        <View style={styles.headerAvatar}>
          {!isWorker && job.professionals?.avatar_url ? (
            <Image source={{ uri: job.professionals.avatar_url }} style={styles.headerAvatarImg} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarInitial}>
                {(isWorker ? 'C' : (job.professionals?.first_name?.[0] || 'P')).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={[styles.headerStatusDot, { backgroundColor: statusColor }]} />
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{profName}</Text>
          <Text style={styles.headerRole} numberOfLines={1}>
            {profRole} · <Text style={{ color: '#4285F4' }}>BOLT coordina</Text>
          </Text>
          <View style={styles.headerStatusRow}>
            <View style={[styles.statusPill, { borderColor: statusColor + '44' }]}>
              <View style={[styles.statusPillDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {job.arrival_estimate && job.status === 'accepted' && (
              <View style={styles.arrivalPill}>
                <Ionicons name="navigate-outline" size={11} color="#4285F4" />
                <Text style={styles.arrivalPillText}>Llega en {job.arrival_estimate}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#FFD600" />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderMsg}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={renderContextCard()}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.voltEmptyBadge}>
                  <Text style={styles.voltEmptyBadgeText}>⚡ BOLT</Text>
                </View>
                <Text style={styles.emptyText}>{volt.chatEmpty}</Text>
              </View>
            }
          />

          {/* Acciones rápidas */}
          <FlatList
            data={quickReplies}
            style={{ flexGrow: 0, flexShrink: 0 }}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={q => q}
            contentContainerStyle={styles.quickList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.quickChip} onPress={() => send(item)} activeOpacity={0.8}>
                <Text style={styles.quickChipText}>{item}</Text>
              </TouchableOpacity>
            )}
          />

          {/* Barra de grabación: reemplaza al input mientras se graba */}
          {grabando ? (
            <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <TouchableOpacity style={styles.cancelarGrab} onPress={() => detenerAudio(true)} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={20} color="#ff4444" />
              </TouchableOpacity>
              <View style={styles.grabandoWrap}>
                <View style={styles.grabandoDot} />
                <Text style={styles.grabandoTxt}>Grabando {mmss(segundos)}</Text>
              </View>
              <TouchableOpacity style={styles.sendBtn} onPress={() => detenerAudio(false)} activeOpacity={0.8}>
                <Ionicons name="send" size={18} color="#0A0A0A" />
              </TouchableOpacity>
            </View>
          ) : (
            /* Input */
            <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <TouchableOpacity
                style={styles.adjuntarBtn}
                onPress={abrirAdjuntos}
                disabled={subiendo}
                activeOpacity={0.8}
              >
                {subiendo
                  ? <ActivityIndicator size="small" color="#FFD600" />
                  : <Ionicons name="add" size={24} color="#FFD600" />
                }
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                placeholder="Escribí un mensaje..."
                placeholderTextColor="#444"
                value={text}
                onChangeText={setText}
                multiline
                maxLength={500}
              />

              {/* Con texto escrito manda; vacío, graba un audio */}
              <TouchableOpacity
                style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                onPress={() => (text.trim() ? send() : grabarAudio())}
                disabled={sending || subiendo}
                activeOpacity={0.8}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#0A0A0A" />
                  : <Ionicons name={text.trim() ? 'send' : 'mic'} size={18} color="#0A0A0A" />
                }
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    gap: 12,
  },
  backBtn: { padding: 4 },

  headerAvatar: { position: 'relative', width: 46, height: 46 },
  headerAvatarImg: { width: 46, height: 46, borderRadius: 23 },
  headerAvatarPlaceholder: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#1A1A00',
    borderWidth: 1.5, borderColor: '#FFD60040',
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatarInitial: { fontSize: 18, fontWeight: '900', color: '#FFD600' },
  headerStatusDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: '#0A0A0A',
  },

  headerInfo: { flex: 1 },
  headerName: { fontSize: 15, fontWeight: '800', color: '#F5F5F5', marginBottom: 1 },
  headerRole: { fontSize: 12, color: '#555', marginBottom: 5 },

  headerStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statusPillDot:  { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  arrivalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(66,133,244,0.1)',
    borderWidth: 1, borderColor: 'rgba(66,133,244,0.25)',
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  arrivalPillText: { fontSize: 11, fontWeight: '700', color: '#4285F4' },

  // ── Tarjeta de contexto ──────────────────────────────────────────────────────
  contextCard: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: '#0D0D0D',
    borderRadius: 14, borderWidth: 1, borderColor: '#FFD60020',
    padding: 14, gap: 10,
  },
  contextCardTitle: {
    fontSize: 11, fontWeight: '800', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2,
  },
  contextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  contextText: { flex: 1, fontSize: 13, color: '#888', lineHeight: 18 },
  workingDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF9800',
    marginTop: 5,
  },

  // ── Mensajes ─────────────────────────────────────────────────────────────────
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 8, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 12 },
  emptyText: { color: '#444', fontSize: 14, textAlign: 'center', lineHeight: 22, paddingHorizontal: 24 },
  voltEmptyBadge: {
    backgroundColor: 'rgba(66,133,244,0.1)',
    borderWidth: 1, borderColor: 'rgba(66,133,244,0.25)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
  },
  voltEmptyBadgeText: { fontSize: 11, fontWeight: '900', color: '#4285F4', letterSpacing: 1 },

  systemRow: { alignItems: 'center', marginVertical: 8 },
  systemText: {
    fontSize: 12, color: '#555', backgroundColor: '#111',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
  },

  msgRow:      { marginBottom: 6, maxWidth: '80%' },
  msgRowMine:  { alignSelf: 'flex-end' },
  msgRowOther: { alignSelf: 'flex-start' },

  bubble:      { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  // Con adjunto se achica el padding: la imagen o el reproductor mandan la forma
  bubbleAdjunto: { paddingHorizontal: 6, paddingVertical: 6 },
  bubbleMine:  { backgroundColor: '#FFD600', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#2a2a2a', borderBottomLeftRadius: 4 },

  bubbleText:      { fontSize: 14, lineHeight: 20 },
  bubbleTextMine:  { color: '#0A0A0A' },
  bubbleTextOther: { color: '#F5F5F5' },

  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  bubbleTime:     { fontSize: 10, color: '#888' },
  bubbleTimeMine: { color: '#0A0A0A88' },

  // ── Acciones rápidas ─────────────────────────────────────────────────────────
  quickList: { paddingHorizontal: 12, paddingVertical: 7, gap: 7 },
  quickChip: {
    backgroundColor: '#1c1c1c', borderRadius: 13,
    borderWidth: 1, borderColor: '#333',
    paddingHorizontal: 11, paddingVertical: 5,
  },
  quickChipText: { fontSize: 12, color: '#bbb', fontWeight: '600' },

  // ── Input ────────────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingTop: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
    backgroundColor: '#161616',
  },
  input: {
    flex: 1, backgroundColor: '#1f1f1f',
    borderRadius: 22, borderWidth: 1, borderColor: '#333',
    color: '#F5F5F5', fontSize: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },

  adjuntarBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1f1f1f', borderWidth: 1, borderColor: '#2e2e2e',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelarGrab: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  grabandoWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9,
    height: 44, paddingHorizontal: 16,
    backgroundColor: '#1f1f1f', borderRadius: 22,
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.35)',
  },
  grabandoDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#ff4444' },
  grabandoTxt: { color: '#F5F5F5', fontSize: 14, fontWeight: '700' },
  sendBtnDisabled: { opacity: 0.4 },
});

export default ChatScreen;

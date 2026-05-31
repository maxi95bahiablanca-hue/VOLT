import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, KeyboardAvoidingView, Platform, SafeAreaView,
  ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import chatService from '../services/chatService';
import volt from '../utils/voltVoice';

const STATUS_LABELS = {
  pending:          'Buscando profesional...',
  accepted:         'En camino',
  arrived:          'Llegó al lugar',
  in_progress:      'Trabajando',
  awaiting_payment: 'Esperando pago',
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

const ChatScreen = ({ job, userId, isWorker, onClose }) => {
  const [messages, setMessages] = useState([]);
  const [text, setText]         = useState('');
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const listRef    = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    chatService.getMessages(job.id).then(msgs => {
      if (mounted) { setMessages(msgs); setLoading(false); }
    }).catch(() => { if (mounted) setLoading(false); });

    channelRef.current = chatService.subscribeToMessages(job.id, (newMsg) => {
      setMessages(prev => [...prev, newMsg]);
    });
    chatService.markAsRead(job.id, userId).catch(() => {});

    return () => {
      mounted = false;
      channelRef.current?.unsubscribe?.();
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
      await chatService.sendMessage(job.id, userId, txt);
    } catch {
      setText(txt);
    } finally {
      setSending(false);
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
    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowMine : styles.msgRowOther]}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
            {item.content}
          </Text>
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
            {profRole} · <Text style={{ color: '#4285F4' }}>GOVOLT coordina</Text>
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
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderMsg}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={renderContextCard()}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.voltEmptyBadge}>
                  <Text style={styles.voltEmptyBadgeText}>⚡ GOVOLT</Text>
                </View>
                <Text style={styles.emptyText}>{volt.chatEmpty}</Text>
              </View>
            }
          />

          {/* Acciones rápidas */}
          <FlatList
            data={quickReplies}
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

          {/* Input */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Escribí un mensaje..."
              placeholderTextColor="#444"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
              onPress={() => send()}
              disabled={!text.trim() || sending}
              activeOpacity={0.8}
            >
              {sending
                ? <ActivityIndicator size="small" color="#0A0A0A" />
                : <Ionicons name="send" size={18} color="#0A0A0A" />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

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
  bubbleMine:  { backgroundColor: '#FFD600', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#1a1a1a', borderBottomLeftRadius: 4 },

  bubbleText:      { fontSize: 14, lineHeight: 20 },
  bubbleTextMine:  { color: '#0A0A0A' },
  bubbleTextOther: { color: '#F5F5F5' },

  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  bubbleTime:     { fontSize: 10, color: '#888' },
  bubbleTimeMine: { color: '#0A0A0A88' },

  // ── Acciones rápidas ─────────────────────────────────────────────────────────
  quickList: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  quickChip: {
    backgroundColor: '#111', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a2a',
    paddingHorizontal: 14, paddingVertical: 8,
  },
  quickChipText: { fontSize: 13, color: '#888' },

  // ── Input ────────────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    backgroundColor: '#0A0A0A',
  },
  input: {
    flex: 1, backgroundColor: '#111',
    borderRadius: 22, borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});

export default ChatScreen;

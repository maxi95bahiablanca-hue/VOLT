import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, KeyboardAvoidingView, Platform, SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import chatService from '../services/chatService';

const WORKER_QUICK = [
  'Voy en camino ⚡',
  'Llego en 10 minutos',
  'Ya llegué, estoy en la puerta',
  'Necesito que me abras',
  'Voy a necesitar materiales',
  'Listo, trabajo finalizado',
];

const CLIENT_QUICK = [
  'Perfecto, te espero',
  'Ok, ¿tardás mucho?',
  'Estoy en casa',
  'Dale, adelante',
  '¿Cuánto va a costar?',
  '¿Necesitás algo?',
];

const ChatScreen = ({ job, userId, isWorker, onClose }) => {
  const [messages, setMessages]   = useState([]);
  const [text, setText]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const listRef = useRef(null);
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
      if (channelRef.current) channelRef.current.unsubscribe?.();
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

  const quickReplies = isWorker ? WORKER_QUICK : CLIENT_QUICK;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#F5F5F5" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Chat del trabajo</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {job.professions?.name || 'Servicio'} · {isWorker ? 'Cliente' : 'Profesional'}
          </Text>
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
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={40} color="#222" />
                <Text style={styles.emptyText}>Aún no hay mensajes.{'\n'}Usá el chat para coordinar el trabajo.</Text>
              </View>
            }
          />

          {/* Respuestas rápidas */}
          <View>
            <FlatList
              data={quickReplies}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={q => q}
              contentContainerStyle={styles.quickList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.quickChip}
                  onPress={() => send(item)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.quickChipText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>

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
              onSubmitEditing={() => send()}
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 12,
  },
  backBtn:    { padding: 4 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '800', color: '#F5F5F5' },
  headerSub:   { fontSize: 12, color: '#555', marginTop: 1 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { padding: 16, paddingBottom: 8, flexGrow: 1 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: '#333', fontSize: 14, textAlign: 'center', lineHeight: 20 },

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

  quickList: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  quickChip: {
    backgroundColor: '#111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quickChipText: { fontSize: 13, color: '#888' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0A0A0A',
  },
  input: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    color: '#F5F5F5',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
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

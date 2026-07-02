import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, Platform, Image, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import assistantService from '../services/assistantService';

// Asistente IA — VISTA B (cuestionario por tarjetas, NO chat tipo Messenger).
// El cliente cuenta su problema (texto/foto/audio); la IA deduce lo que puede
// ("ya entendí") y arma SOLO las preguntas que faltan, específicas del problema.
// Al completar → vuelve a la plantilla clásica (JobRequestScreen) vía onReady.
const OTRO = '__otro__';

const AssistantScreen = ({ clientId, userLocation, mode, onReady, onBack }) => {
  const insets = useSafeAreaInsets();

  const [phase, setPhase]   = useState('ask');   // ask | analyzing | questions
  const [input, setInput]   = useState('');
  const [recording, setRecording] = useState(false);
  const [lastReply, setLastReply] = useState(null);   // aclaración de la IA si no detectó oficio

  const [analysis, setAnalysis] = useState(null);     // { oficio, profession_id, tipo, ya_entendi[], preguntas[], resumen }
  const [qIndex, setQIndex]     = useState(0);
  const [answers, setAnswers]   = useState({});
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');

  const recRef     = useRef(null);
  const historyRef = useRef([]);   // [{ role:'user'|'model', text }]
  const startedRef = useRef(false);

  // Si entró por el botón de audio o cámara del buscador, lo disparamos directo
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (mode === 'camera') setTimeout(attachPhoto, 350);
    else if (mode === 'audio') setTimeout(toggleRecord, 350);
  }, []);

  // ─── Enviar el problema a la IA ─────────────────────────
  const analyze = async ({ text, imageBase64, imageMime, audioBase64, audioMime }) => {
    if (phase === 'analyzing') return;
    const label = text || (audioBase64 ? '🎤 (audio)' : (imageBase64 ? '📷 (foto)' : ''));
    if (!label) return;
    setPhase('analyzing');
    setInput('');
    historyRef.current.push({ role: 'user', text: label });
    try {
      const res = await assistantService.analyze({
        message: text, imageBase64, imageMime, audioBase64, audioMime,
        history: historyRef.current.slice(0, -1),
      });
      if (res?.reply) historyRef.current.push({ role: 'model', text: res.reply });

      const preguntas = Array.isArray(res?.preguntas) ? res.preguntas.filter(p => p?.id && p?.pregunta) : [];

      if (res?.profession_id) {
        setAnalysis({
          oficio: res.oficio || 'Servicio',
          profession_id: res.profession_id,
          tipo: res.tipo || 'reparacion',
          ya_entendi: Array.isArray(res.ya_entendi) ? res.ya_entendi : [],
          preguntas,
          resumen: res.resumen || text || '',
        });
        if (preguntas.length === 0) {
          // Nada que preguntar → directo a la plantilla
          finalize({ profession_id: res.profession_id, oficio: res.oficio, resumen: res.resumen || text, preguntas: [] }, {});
          return;
        }
        setQIndex(0);
        setAnswers({});
        setPhase('questions');
      } else {
        // No detectó oficio → pedir que aclare
        setLastReply(res?.reply || 'Contame un poco más así te ayudo: ¿qué necesitás resolver?');
        setPhase('ask');
      }
    } catch (e) {
      Alert.alert(
        'No pudimos procesarlo',
        'Tuvimos un problema con el asistente. ¿Querés elegir el oficio a mano?',
        [
          { text: 'Reintentar', onPress: () => setPhase('ask') },
          { text: 'Elegir a mano', onPress: onBack },
        ]
      );
      setPhase('ask');
    }
  };

  const sendText = () => { const t = input.trim(); if (t) analyze({ text: t }); };

  // ─── Responder una pregunta ─────────────────────────────
  const answerCurrent = (value) => {
    const preg = analysis.preguntas[qIndex];
    const merged = { ...answers, [preg.id]: { pregunta: preg.pregunta, valor: value } };
    setAnswers(merged);
    setOtherOpen(false);
    setOtherText('');
    const next = qIndex + 1;
    if (next >= analysis.preguntas.length) finalize(analysis, merged);
    else setQIndex(next);
  };

  const confirmOther = () => {
    const t = otherText.trim();
    if (!t) return;
    answerCurrent(t);
  };

  // ─── Armar las notas y volver a la plantilla ────────────
  const finalize = (an, merged) => {
    const lines = (an.preguntas || [])
      .map(p => { const a = merged[p.id]; return a ? `• ${p.pregunta} ${a.valor}` : null; })
      .filter(Boolean);
    const base = (an.resumen || an.oficio || 'Solicitud').trim();
    const notes = [base, ...lines].join('\n');
    onReady({ id: an.profession_id, name: an.oficio || 'Servicio' }, notes);
  };

  // ─── Foto ───────────────────────────────────────────────
  const attachPhoto = () => {
    if (phase === 'analyzing') return;
    Alert.alert('Mostranos el problema', 'Una foto ayuda a entender mejor.', [
      { text: 'Cámara', onPress: async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos la cámara.'); return; }
        const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true });
        if (!r.canceled) sendImage(r.assets[0].uri);
      }},
      { text: 'Galería', onPress: async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
        const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsEditing: true });
        if (!r.canceled) sendImage(r.assets[0].uri);
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };
  const sendImage = async (uri) => {
    try {
      const ext = (uri.split('.').pop() || 'jpg').toLowerCase();
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      analyze({ text: input.trim() || undefined, imageBase64: base64, imageMime: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
    } catch { Alert.alert('Ups', 'No pudimos adjuntar la foto.'); }
  };

  // ─── Audio ──────────────────────────────────────────────
  const toggleRecord = async () => {
    if (phase === 'analyzing') return;
    if (recording) {
      try {
        const rec = recRef.current;
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI(); recRef.current = null; setRecording(false);
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        analyze({ audioBase64: base64, audioMime: 'audio/mp4' });
      } catch { setRecording(false); Alert.alert('Ups', 'No pudimos grabar. Escribilo nomás.'); }
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permiso requerido', 'Necesitamos el micrófono.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: r } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recRef.current = r; setRecording(true);
    } catch { Alert.alert('Ups', 'No pudimos acceder al micrófono.'); }
  };

  // ─── Render: pregunta actual (vista B) ──────────────────
  const renderQuestions = () => {
    const preg = analysis.preguntas[qIndex];
    const total = analysis.preguntas.length;
    const opciones = Array.isArray(preg.opciones) ? preg.opciones : [];
    return (
      <ScrollView contentContainerStyle={styles.qScroll} keyboardShouldPersistTaps="handled">
        {/* Lo que ya entendió la IA */}
        {analysis.ya_entendi?.length > 0 && (
          <View style={styles.gotBox}>
            <View style={styles.gotHead}>
              <View style={styles.boltMini}><Ionicons name="flash" size={12} color="#10100A" /></View>
              <Text style={styles.gotTitle}>Ya entendí esto</Text>
            </View>
            <View style={styles.gotChips}>
              {analysis.ya_entendi.map((g, i) => (
                <View key={i} style={styles.gotChip}><Text style={styles.gotChipTxt}>{g}</Text></View>
              ))}
            </View>
          </View>
        )}

        {/* Progreso */}
        <View style={styles.progRow}>
          {analysis.preguntas.map((_, i) => (
            <View key={i} style={[styles.progSeg, i <= qIndex && styles.progSegOn]} />
          ))}
        </View>
        <Text style={styles.stepTxt}>Pregunta {qIndex + 1} de {total}</Text>

        {/* Pregunta */}
        <Text style={styles.question}>{preg.pregunta}</Text>

        {/* Opciones */}
        <View style={styles.opts}>
          {opciones.map((op, i) => (
            <TouchableOpacity key={i} style={styles.opt} activeOpacity={0.85} onPress={() => answerCurrent(op)}>
              <Text style={styles.optTxt}>{op}</Text>
              <Ionicons name="chevron-forward" size={18} color="#666" />
            </TouchableOpacity>
          ))}

          {/* Siempre: Otro / lo escribo */}
          {!otherOpen ? (
            <TouchableOpacity style={styles.optOther} activeOpacity={0.85} onPress={() => setOtherOpen(true)}>
              <Ionicons name="create-outline" size={17} color="#FFD600" />
              <Text style={styles.optOtherTxt}>Otro / lo escribo</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.otherBox}>
              <TextInput
                style={styles.otherInput}
                placeholder="Escribí tu respuesta…"
                placeholderTextColor="#666"
                value={otherText}
                onChangeText={setOtherText}
                autoFocus
                multiline
                onSubmitEditing={confirmOther}
              />
              <TouchableOpacity style={[styles.otherBtn, !otherText.trim() && { opacity: 0.5 }]} onPress={confirmOther} disabled={!otherText.trim()}>
                <Ionicons name="checkmark" size={20} color="#10100A" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  // ─── Render: contar el problema (entrada) ───────────────
  const renderAsk = () => (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.askScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.boltBig}><Ionicons name="flash" size={28} color="#10100A" /></View>
        <Text style={styles.askTitle}>Contanos qué necesitás</Text>
        <Text style={styles.askSub}>
          Escribilo como quieras, mandanos un audio o una foto. Nosotros lo entendemos y te buscamos al profesional.
        </Text>

        {!!lastReply && (
          <View style={styles.replyBox}>
            <View style={styles.boltMini}><Ionicons name="flash" size={12} color="#10100A" /></View>
            <Text style={styles.replyTxt}>{lastReply}</Text>
          </View>
        )}

        <View style={styles.askInputWrap}>
          <TextInput
            style={styles.askInput}
            placeholder="Ej: se me pinchó un caño en el baño y pierde agua…"
            placeholderTextColor="#666"
            value={input}
            onChangeText={setInput}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.askActions}>
          <TouchableOpacity style={[styles.askIcon, recording && styles.askIconRec]} onPress={toggleRecord}>
            <Ionicons name={recording ? 'stop' : 'mic-outline'} size={22} color={recording ? '#ff4444' : '#FFD600'} />
            <Text style={styles.askIconTxt}>{recording ? 'Grabando…' : 'Audio'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.askIcon} onPress={attachPhoto}>
            <Ionicons name="camera-outline" size={22} color="#FFD600" />
            <Text style={styles.askIconTxt}>Foto</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.askSend, !input.trim() && styles.askSendOff]}
          onPress={sendText}
          disabled={!input.trim()}
          activeOpacity={0.9}
        >
          <Ionicons name="flash" size={20} color="#10100A" />
          <Text style={styles.askSendTxt}>Continuar</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}><Ionicons name="chevron-back" size={26} color="#E8E8E8" /></TouchableOpacity>
        <View style={styles.avH}><Ionicons name="flash" size={16} color="#10100A" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.hTitle}>Asistente BOLT</Text>
          <Text style={styles.hSub}>te armamos el pedido</Text>
        </View>
      </View>

      {phase === 'analyzing' ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFD600" size="large" />
          <Text style={styles.analyzingTxt}>Entendiendo tu problema…</Text>
        </View>
      ) : phase === 'questions' && analysis ? (
        renderQuestions()
      ) : (
        renderAsk()
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0E' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: '#141418', borderBottomWidth: 1, borderBottomColor: '#23252e' },
  backBtn: { padding: 2 },
  avH: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 15, fontWeight: '800', color: '#F5F5F5' },
  hSub: { fontSize: 11.5, color: '#9a9a9a', marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  analyzingTxt: { color: '#bbb', fontSize: 15, fontWeight: '600' },

  // ── Entrada (contar problema) ──
  askScroll: { padding: 22, paddingBottom: 40 },
  boltBig: { width: 60, height: 60, borderRadius: 18, backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  askTitle: { fontSize: 26, fontWeight: '900', color: '#F5F5F5', letterSpacing: -0.5 },
  askSub: { fontSize: 14.5, color: '#9a9a9a', lineHeight: 21, marginTop: 8, marginBottom: 18 },
  replyBox: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: 'rgba(255,214,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)', borderRadius: 14, padding: 13, marginBottom: 16 },
  replyTxt: { flex: 1, color: '#EDEDED', fontSize: 14, lineHeight: 20 },
  askInputWrap: { backgroundColor: '#16161B', borderWidth: 1, borderColor: '#2a2a33', borderRadius: 16, padding: 4 },
  askInput: { minHeight: 120, color: '#F5F5F5', fontSize: 16, padding: 14, lineHeight: 22 },
  askActions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  askIcon: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#16161B', borderWidth: 1, borderColor: '#2a2a33', borderRadius: 14, paddingVertical: 14 },
  askIconRec: { borderColor: '#ff4444', backgroundColor: 'rgba(255,68,68,0.08)' },
  askIconTxt: { color: '#cfcfcf', fontSize: 14, fontWeight: '700' },
  askSend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: '#FFD600', borderRadius: 16, paddingVertical: 17, marginTop: 20 },
  askSendOff: { opacity: 0.5 },
  askSendTxt: { color: '#10100A', fontSize: 16.5, fontWeight: '900' },

  // ── Cuestionario (vista B) ──
  qScroll: { padding: 20, paddingBottom: 40 },
  gotBox: { backgroundColor: 'rgba(255,214,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)', borderRadius: 14, padding: 13, marginBottom: 20 },
  gotHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  boltMini: { width: 20, height: 20, borderRadius: 6, backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center' },
  gotTitle: { color: '#FFD600', fontSize: 12.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  gotChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  gotChip: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: '#2e2e36', borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
  gotChipTxt: { color: '#EDEDED', fontSize: 13, fontWeight: '700' },

  progRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  progSeg: { flex: 1, height: 4, borderRadius: 3, backgroundColor: '#2c2c34' },
  progSegOn: { backgroundColor: '#FFD600' },
  stepTxt: { color: '#9a9a9a', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  question: { color: '#F5F5F5', fontSize: 23, fontWeight: '900', lineHeight: 30, letterSpacing: -0.5, marginBottom: 20 },

  opts: { gap: 10 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16161B', borderWidth: 1, borderColor: '#2a2a33', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16 },
  optTxt: { flex: 1, color: '#F5F5F5', fontSize: 15.5, fontWeight: '700' },
  optOther: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: 'rgba(255,214,0,0.4)', borderStyle: 'dashed', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, marginTop: 2 },
  optOtherTxt: { color: '#FFD600', fontSize: 15, fontWeight: '800' },
  otherBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 },
  otherInput: { flex: 1, minHeight: 52, maxHeight: 120, backgroundColor: '#16161B', borderWidth: 1, borderColor: '#FFD600', borderRadius: 14, color: '#F5F5F5', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  otherBtn: { width: 50, height: 52, borderRadius: 14, backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center' },
});

export default AssistantScreen;

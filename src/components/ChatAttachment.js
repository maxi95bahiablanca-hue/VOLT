import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Modal, ActivityIndicator, Linking, Dimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video } from 'expo-av';

const { width: W, height: H } = Dimensions.get('window');

const mmss = (seg) => `${Math.floor(seg / 60)}:${String(Math.floor(seg % 60)).padStart(2, '0')}`;
const pesoLegible = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// ─── Audio ───────────────────────────────────────────────────────────────────
// Se carga recién al tocar play: en un chat con varios audios, precargarlos
// todos se come la memoria y los datos del que sólo quería leer.
const Reproductor = ({ url, duracion, mine }) => {
  const sound = useRef(null);
  const [sonando, setSonando] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [pos, setPos] = useState(0);
  const total = duracion || 0;

  useEffect(() => () => { sound.current?.unloadAsync?.().catch(() => {}); }, []);

  const alternar = async () => {
    try {
      if (!sound.current) {
        setCargando(true);
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound: s } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
        sound.current = s;
        s.setOnPlaybackStatusUpdate((st) => {
          if (!st.isLoaded) return;
          setPos(st.positionMillis / 1000);
          setSonando(st.isPlaying);
          if (st.didJustFinish) { setSonando(false); setPos(0); s.setPositionAsync(0).catch(() => {}); }
        });
        setCargando(false);
        setSonando(true);
        return;
      }
      const st = await sound.current.getStatusAsync();
      if (st.isPlaying) { await sound.current.pauseAsync(); setSonando(false); }
      else              { await sound.current.playAsync();  setSonando(true); }
    } catch {
      setCargando(false);
      Alert.alert('Ups', 'No pudimos reproducir el audio.');
    }
  };

  const avance = total > 0 ? Math.min(pos / total, 1) : 0;
  const color = mine ? '#0D0D0D' : '#FFD600';

  return (
    <TouchableOpacity style={est.audioRow} onPress={alternar} activeOpacity={0.8}>
      {cargando
        ? <ActivityIndicator size="small" color={color} />
        : <Ionicons name={sonando ? 'pause' : 'play'} size={22} color={color} />}
      <View style={est.audioBarra}>
        <View style={[est.audioBarraFondo, { backgroundColor: mine ? 'rgba(0,0,0,0.18)' : '#2a2a33' }]} />
        <View style={[est.audioBarraLlena, { width: `${avance * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[est.audioTiempo, { color: mine ? 'rgba(0,0,0,0.6)' : '#8A8A8A' }]}>
        {total ? mmss(sonando || pos > 0 ? pos : total) : '▶'}
      </Text>
    </TouchableOpacity>
  );
};

// ─── Adjunto ─────────────────────────────────────────────────────────────────
const ChatAttachment = ({ msg, mine }) => {
  const [visor, setVisor] = useState(false);
  const url = msg.attachment_url;
  if (!url) return null;

  if (msg.attachment_type === 'audio') {
    return <Reproductor url={url} duracion={msg.attachment_duration} mine={mine} />;
  }

  if (msg.attachment_type === 'image') {
    return (
      <>
        <TouchableOpacity onPress={() => setVisor(true)} activeOpacity={0.9}>
          <Image source={{ uri: url }} style={est.imagen} resizeMode="cover" />
        </TouchableOpacity>
        <Modal visible={visor} transparent animationType="fade" onRequestClose={() => setVisor(false)}>
          <View style={est.visor}>
            <TouchableOpacity style={est.visorCerrar} onPress={() => setVisor(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Image source={{ uri: url }} style={est.visorImg} resizeMode="contain" />
          </View>
        </Modal>
      </>
    );
  }

  if (msg.attachment_type === 'video') {
    return (
      <>
        <TouchableOpacity onPress={() => setVisor(true)} activeOpacity={0.9} style={est.videoTapa}>
          <Video
            source={{ uri: url }}
            style={est.imagen}
            resizeMode="cover"
            shouldPlay={false}
            isMuted
            useNativeControls={false}
          />
          <View style={est.videoPlay}>
            <Ionicons name="play" size={26} color="#0D0D0D" />
          </View>
        </TouchableOpacity>
        <Modal visible={visor} transparent animationType="fade" onRequestClose={() => setVisor(false)}>
          <View style={est.visor}>
            <TouchableOpacity style={est.visorCerrar} onPress={() => setVisor(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Video
              source={{ uri: url }}
              style={est.visorVideo}
              resizeMode="contain"
              useNativeControls
              shouldPlay
            />
          </View>
        </Modal>
      </>
    );
  }

  // Archivo suelto: lo abre la app que corresponda del teléfono
  return (
    <TouchableOpacity
      style={[est.archivo, { borderColor: mine ? 'rgba(0,0,0,0.15)' : '#2a2a33' }]}
      onPress={() => Linking.openURL(url).catch(() => Alert.alert('Ups', 'No pudimos abrir el archivo.'))}
      activeOpacity={0.8}
    >
      <Ionicons name="document-text-outline" size={22} color={mine ? '#0D0D0D' : '#FFD600'} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[est.archivoNombre, { color: mine ? '#0D0D0D' : '#FFFFFF' }]}>
          {msg.attachment_name || 'Archivo'}
        </Text>
        {!!msg.attachment_size && (
          <Text style={[est.archivoPeso, { color: mine ? 'rgba(0,0,0,0.55)' : '#8A8A8A' }]}>
            {pesoLegible(msg.attachment_size)}
          </Text>
        )}
      </View>
      <Ionicons name="download-outline" size={18} color={mine ? 'rgba(0,0,0,0.5)' : '#5C5C5C'} />
    </TouchableOpacity>
  );
};

const est = StyleSheet.create({
  imagen: { width: 200, height: 150, borderRadius: 12, backgroundColor: '#16161B' },

  videoTapa: { position: 'relative' },
  videoPlay: {
    position: 'absolute', top: '50%', left: '50%', marginLeft: -22, marginTop: -22,
    width: 44, height: 44, borderRadius: 999, backgroundColor: 'rgba(255,214,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },

  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 190, paddingVertical: 2 },
  audioBarra: { flex: 1, height: 4, justifyContent: 'center' },
  audioBarraFondo: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  audioBarraLlena: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  audioTiempo: { fontSize: 12, fontWeight: '700', minWidth: 32, textAlign: 'right' },

  archivo: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minWidth: 200,
  },
  archivoNombre: { fontSize: 14, fontWeight: '700' },
  archivoPeso: { fontSize: 12, marginTop: 1 },

  visor: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  visorImg: { width: W, height: H * 0.8 },
  visorVideo: { width: W, height: H * 0.6 },
  visorCerrar: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 },
});

export default ChatAttachment;

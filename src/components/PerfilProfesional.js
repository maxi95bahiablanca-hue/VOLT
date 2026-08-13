import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, Modal, Dimensions, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import professionalService from '../services/professionalService';

const { width: ANCHO_PANTALLA } = Dimensions.get('window');

/** ¿La url es un video? Se decide por la extensión y no por una columna nueva
 *  en la base: la extensión ya viaja en la url y no hay migración que esperar. */
export const esVideo = (url) => /\.(mp4|mov|m4v|webm|3gp)(\?|$)/i.test(String(url || ''));

/** La galería de trabajos + los años de oficio + la presentación.
 *
 *  🔴 10-ago-2026 — el profesional podía subir fotos de sus trabajos y no las
 *  veía nadie: `fotosDe` sólo lo llamaba su propio perfil. Subir fotos que no
 *  mira ningún cliente es pedirle trabajo a cambio de nada.
 *
 *  Va como bloque suelto y no como pantalla entera para poder meterlo adentro
 *  del perfil que ya existe en la elección de presupuesto, sin rehacerlo.
 */
export function GaleriaTrabajos({ prof, compacto = false }) {
  const [media, setMedia]   = useState([]);
  const [cargando, setCarg] = useState(true);
  const [abierta, setAbierta] = useState(null);   // índice en pantalla completa

  useEffect(() => {
    let vivo = true;
    if (!prof?.id) { setCarg(false); return; }
    professionalService.fotosDe(prof.id)
      .then(f => { if (vivo) setMedia((f || []).filter(x => x.estado === 'aprobada')); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarg(false); });
    return () => { vivo = false; };
  }, [prof?.id]);

  const anios    = prof?.anios_oficio;
  const presenta = prof?.presentacion;

  // Tres por fila, con el aire de la pantalla ya descontado.
  const LADO = Math.floor((Math.min(ANCHO_PANTALLA, 560) - 40 - 16) / 3);

  return (
    <View>
      {!!anios && !compacto && (
        <View style={styles.dato}>
          <Ionicons name="ribbon-outline" size={18} color="#FFD600" />
          <Text style={styles.datoTexto}>{anios} años en el oficio</Text>
        </View>
      )}

      {!!presenta && (
        <View style={styles.presenta}>
          <Text style={styles.presentaTexto}>{presenta}</Text>
        </View>
      )}

      <Text style={styles.seccion}>Trabajos que hizo</Text>
      {cargando ? (
        <ActivityIndicator color="#FFD600" style={{ marginVertical: 24 }} />
      ) : media.length === 0 ? (
        <View style={styles.vacio}>
          <Ionicons name="images-outline" size={24} color="#3a3a3a" />
          <Text style={styles.vacioTexto}>
            Todavía no subió fotos de sus trabajos. Eso no dice nada malo de cómo trabaja
            {anios ? `: son ${anios} años de oficio` : ''}.
          </Text>
        </View>
      ) : (
        <View style={styles.grilla}>
          {media.map((m, i) => (
            <TouchableOpacity key={m.id} onPress={() => setAbierta(i)} activeOpacity={0.85}
              accessibilityLabel={esVideo(m.url) ? 'Ver el video' : 'Ver la foto más grande'}>
              <View style={[styles.celda, { width: LADO, height: LADO }]}>
                {esVideo(m.url) ? (
                  <>
                    <Video source={{ uri: m.url }} style={StyleSheet.absoluteFill}
                      resizeMode={ResizeMode.COVER} shouldPlay={false} isMuted />
                    <View style={styles.playChip}>
                      <Ionicons name="play" size={14} color="#0D0D0D" />
                    </View>
                  </>
                ) : (
                  <Image source={{ uri: m.url }} style={StyleSheet.absoluteFill} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {abierta != null && !!media[abierta] && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setAbierta(null)}>
          <View style={styles.fullFondo}>
            <TouchableOpacity style={styles.fullCerrar} onPress={() => setAbierta(null)} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            {esVideo(media[abierta].url) ? (
              <Video source={{ uri: media[abierta].url }} style={styles.fullMedia}
                resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay isLooping />
            ) : (
              <Image source={{ uri: media[abierta].url }} style={styles.fullMedia} resizeMode="contain" />
            )}
            {!!media[abierta].descripcion && (
              <Text style={styles.fullPie}>{media[abierta].descripcion}</Text>
            )}
            {media.length > 1 && (
              <View style={styles.fullNav}>
                <TouchableOpacity onPress={() => setAbierta((abierta - 1 + media.length) % media.length)}
                  style={styles.fullNavBtn} accessibilityLabel="Anterior">
                  <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.fullContador}>{abierta + 1} / {media.length}</Text>
                <TouchableOpacity onPress={() => setAbierta((abierta + 1) % media.length)}
                  style={styles.fullNavBtn} accessibilityLabel="Siguiente">
                  <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

/** El perfil completo, como pantalla. Lo usa quien no tiene ya un perfil
 *  armado alrededor —hoy, la ficha del trabajador desde el Home—. */
export default function PerfilProfesional({ prof, profesion, extra, onCerrar }) {
  const nombre = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim() || 'Profesional';
  const rating = parseFloat(prof?.effective_rating ?? prof?.avg_rating) || 0;
  const hechos = prof?.completed_jobs || 0;

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCerrar} style={styles.iconBtn} accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitulo}>Su trabajo</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.cabeza}>
            <View style={styles.avatar}>
              {prof?.avatar_url
                ? <Image source={{ uri: prof.avatar_url }} style={styles.avatarImg} />
                : <Text style={styles.avatarInicial}>{(prof?.first_name?.[0] || 'P').toUpperCase()}</Text>}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.nombre} numberOfLines={2}>{nombre}</Text>
              {!!profesion && <Text style={styles.oficio}>{profesion}</Text>}
              <View style={styles.estrellas}>
                <Ionicons name="star" size={14} color="#FFD600" />
                <Text style={styles.ratingNum}>{rating ? rating.toFixed(1) : 'Sin calificar'}</Text>
                <Text style={styles.ratingSub}>
                  {hechos > 0 ? `· ${hechos} ${hechos === 1 ? 'trabajo' : 'trabajos'}` : '· recién empieza'}
                </Text>
              </View>
            </View>
          </View>

          <GaleriaTrabajos prof={prof} />

          {/* Lo que el que llama quiera saber además: llega en, precio, etc.
              Lo pasa quien usa el componente, porque depende del contexto. */}
          {!!extra && <View style={{ marginTop: 22 }}>{extra}</View>}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 32 : 10,
    paddingBottom: 14,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitulo: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },

  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  avatar: {
    width: 72, height: 72, borderRadius: 999, overflow: 'hidden',
    backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInicial: { fontSize: 26, fontWeight: '700', color: '#FFD600' },
  nombre: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 3 },
  oficio: { fontSize: 14, color: '#8A8A8A', marginBottom: 6 },
  estrellas: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingNum: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  ratingSub: { fontSize: 14, color: '#5C5C5C' },

  dato: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: 16, padding: 14, marginBottom: 10,
  },
  datoTexto: { fontSize: 15, color: '#FFFFFF' },

  presenta: { backgroundColor: '#161616', borderRadius: 20, padding: 18, marginBottom: 10 },
  presentaTexto: { fontSize: 15, color: '#FFFFFF', lineHeight: 24 },

  seccion: {
    fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase',
    color: '#5C5C5C', fontWeight: '600', marginTop: 22, marginBottom: 12,
  },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  celda: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#161616' },
  playChip: {
    position: 'absolute', bottom: 8, left: 8,
    width: 26, height: 26, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },

  vacio: {
    alignItems: 'center', gap: 12, backgroundColor: '#161616',
    borderRadius: 20, padding: 24,
  },
  vacioTexto: { fontSize: 14, color: '#5C5C5C', textAlign: 'center', lineHeight: 21 },

  fullFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', alignItems: 'center', justifyContent: 'center' },
  fullCerrar: { position: 'absolute', top: 46, right: 20, zIndex: 2, padding: 8 },
  fullMedia: { width: '100%', height: '72%' },
  fullPie: { color: '#8A8A8A', fontSize: 14, paddingHorizontal: 30, textAlign: 'center', marginTop: 14 },
  fullNav: { flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 20 },
  fullNavBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center' },
  fullContador: { color: '#5C5C5C', fontSize: 14, minWidth: 54, textAlign: 'center' },
});

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, Alert, Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../supabase';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import professionalService from '../services/professionalService';

const JobRequestScreen = ({ worker, profession, clientId, userLocation, onQuoteGroupCreated, onBack }) => {
  const [notes, setNotes]     = useState('');
  const [loading, setLoading] = useState(false);
  const [notesTouched, setNotesTouched] = useState(false);

  // Foto opcional del problema
  const [problemPhoto, setProblemPhoto] = useState(null); // { uri, ext }

  // Dirección del servicio — auto-detectada, editable si el usuario no está en el lugar
  const [address, setAddress]         = useState(userLocation?.address || '');
  const [editingAddress, setEditingAddress] = useState(false);

  const pickProblemPhoto = () => {
    Alert.alert('Foto del problema', 'Ayudá al profesional a entender el problema antes de llegar.', [
      { text: 'Cámara', onPress: async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara.'); return; }
        const r = await ImagePicker.launchCameraAsync({ quality: 0.75, allowsEditing: true });
        if (!r.canceled) {
          const uri = r.assets[0].uri;
          setProblemPhoto({ uri, ext: uri.split('.').pop()?.toLowerCase() ?? 'jpg' });
        }
      }},
      { text: 'Galería', onPress: async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
        const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.75, allowsEditing: true });
        if (!r.canceled) {
          const uri = r.assets[0].uri;
          setProblemPhoto({ uri, ext: uri.split('.').pop()?.toLowerCase() ?? 'jpg' });
        }
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const stars      = Math.round(parseFloat(worker?.avg_rating) || 0);
  const visitPrice = worker?.min_price || 30000;

  const handleConfirm = async () => {
    if (notes.trim().length < 10) {
      setNotesTouched(true);
      return;
    }

    // Bloquear si no hay ubicación — los campos client_lat/lng son NOT NULL en la DB
    if (!userLocation?.latitude || !userLocation?.longitude) {
      Alert.alert(
        'Ubicación no disponible',
        'Necesitamos tu ubicación para enviar la solicitud. Activá el GPS y volvé a intentar.'
      );
      return;
    }

    setLoading(true);
    try {
      let workers = worker ? [worker] : [];

      const nearby = await professionalService.getNearbyWorkers(
        profession.id,
        userLocation.latitude,
        userLocation.longitude,
        8
      ).catch(() => []);

      if (worker) {
        const others = nearby.filter(w => w.id !== worker.id && w.user_id !== clientId).slice(0, 2);
        workers = [worker, ...others];
      } else {
        workers = nearby.filter(w => w.user_id !== clientId).slice(0, 3);
      }

      if (workers.length === 0) {
        Alert.alert('Sin profesionales', 'No hay profesionales disponibles cerca ahora. Intentá en unos minutos.');
        setLoading(false);
        return;
      }

      // Subir foto del problema si hay una
      let problemPhotoUrl = null;
      if (problemPhoto?.uri) {
        try {
          const path = `problem-photos/${clientId}/${Date.now()}.${problemPhoto.ext}`;
          const base64 = await FileSystem.readAsStringAsync(problemPhoto.uri, { encoding: FileSystem.EncodingType.Base64 });
          const binary = atob(base64);
          const bytes  = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const { error: upErr } = await supabase.storage
            .from('avatars')
            .upload(path, bytes, { upsert: true, contentType: `image/${problemPhoto.ext}` });
          if (!upErr) {
            const { data } = supabase.storage.from('avatars').getPublicUrl(path);
            problemPhotoUrl = data.publicUrl;
          }
        } catch { /* si falla la foto, seguimos sin ella */ }
      }

      // Crear grupo de cotización (un job por trabajador)
      const { quoteGroupId, jobs } = await jobService.createQuoteGroup({
        clientId,
        workers,
        professionId:    profession.id,
        clientLat:       userLocation?.latitude,
        clientLng:       userLocation?.longitude,
        address:         address.trim() || 'Ubicación GPS',
        notes:           notes.trim(),
        problemPhotoUrl: problemPhotoUrl,
      });

      // Navegar ANTES de las notificaciones — las notifs no deben bloquear el flujo
      onQuoteGroupCreated(quoteGroupId, jobs);

      // Notificar (best-effort, fallo silencioso)
      Promise.all(
        jobs.map(job => {
          const w = workers.find(w => w.id === job.professional_id);
          if (!w?.user_id) return Promise.resolve();
          return notificationService.sendToUser(w.user_id, {
            title: '⚡ Nueva solicitud de trabajo',
            body:  `${profession?.name || 'Servicio'} — $${(w.min_price || 30000).toLocaleString('es-AR')} visita. Tenés 45 seg para responder.`,
            data:  { jobId: job.id, screen: 'worker_incoming' },
          });
        })
      ).catch(() => { /* notificaciones no críticas */ });

    } catch (err) {
      const msg = err?.message || err?.error_description || JSON.stringify(err) || 'Error desconocido';
      Alert.alert('Error al enviar solicitud', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#F5F5F5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirmar solicitud</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Worker Card — específico o modo automático */}
        {worker ? (
          <View style={styles.workerCard}>
            <View style={styles.workerAvatar}>
              {worker.avatar_url
                ? <Image source={{ uri: worker.avatar_url }} style={styles.workerAvatarImg} />
                : <Ionicons name="person" size={32} color="#FFD600" />}
            </View>
            <View style={styles.workerInfo}>
              <Text style={styles.workerName}>{worker.first_name} {worker.last_name}</Text>
              <Text style={styles.workerProfession}>{profession.name}</Text>
              <View style={styles.workerStars}>
                {[1,2,3,4,5].map(i => (
                  <Ionicons key={i} name={i <= stars ? 'star' : 'star-outline'} size={13} color="#FFD600" />
                ))}
                <Text style={styles.workerRating}>
                  {worker.avg_rating ? Number(worker.avg_rating).toFixed(1) : 'Nuevo'}
                  {' · '}{worker.completed_jobs || 0} trabajos
                </Text>
              </View>
            </View>
            <View style={styles.distBadge}>
              <Ionicons name="location-sharp" size={12} color="#FFD600" />
              <Text style={styles.distText}>
                {worker.distance_meters < 1000
                  ? `${Math.round(worker.distance_meters)} m`
                  : `${(worker.distance_meters / 1000).toFixed(1)} km`}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.autoCard}>
            <View style={styles.autoIcon}>
              <Ionicons name="people" size={28} color="#FFD600" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoTitle}>{profession.name}</Text>
              <Text style={styles.autoSub}>
                El sistema enviará tu solicitud a los 3 profesionales más cercanos disponibles.
                Recibís su respuesta y elegís el que más te conviene.
              </Text>
            </View>
          </View>
        )}

        {/* ─── Dirección del servicio ─── */}
        <View style={styles.addressSection}>
          <View style={styles.addressRow}>
            <Ionicons name="location-sharp" size={16} color="#FFD600" />
            <Text style={styles.addressLabel}>Dirección del servicio</Text>
            <TouchableOpacity onPress={() => setEditingAddress(e => !e)} style={styles.addressEditBtn}>
              <Ionicons name={editingAddress ? 'checkmark' : 'pencil-outline'} size={15} color="#888" />
              <Text style={styles.addressEditText}>{editingAddress ? 'Listo' : 'Cambiar'}</Text>
            </TouchableOpacity>
          </View>
          {editingAddress ? (
            <TextInput
              style={styles.addressInput}
              value={address}
              onChangeText={setAddress}
              placeholder="Ej: Av. Colón 1234, Bahía Blanca"
              placeholderTextColor="#444"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => setEditingAddress(false)}
            />
          ) : (
            <Text style={styles.addressText} numberOfLines={2}>
              {address.trim() || 'GPS activo — ubicación automática'}
            </Text>
          )}
          {!address.trim() && !editingAddress && (
            <Text style={styles.addressHint}>
              No estás en el domicilio? Tocá "Cambiar" para ingresar la dirección donde necesitás el servicio.
            </Text>
          )}
        </View>

        {/* ─── Descripción del problema (prominente, requerida) ─── */}
        <View style={styles.notesSection}>
          <View style={styles.notesSectionHeader}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFD600" />
            <Text style={styles.notesSectionTitle}>Describí el problema <Text style={{ color: '#ff4444' }}>*</Text></Text>
          </View>
          <Text style={styles.notesSectionHint}>
            El profesional necesita entender qué falló para llegar preparado y darte un diagnóstico preciso.
          </Text>
          <TextInput
            style={[styles.notesInput, notesTouched && notes.trim().length < 10 && styles.notesInputError]}
            placeholder="Ej: No enciende la luz del baño. Revisé el disyuntor y no hay corte general. Empezó de repente ayer a la noche."
            placeholderTextColor="#444"
            value={notes}
            onChangeText={v => { setNotes(v); setNotesTouched(true); }}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          {notesTouched && notes.trim().length < 10 && (
            <Text style={styles.notesError}>Describí el problema con un poco más de detalle para continuar.</Text>
          )}

          {/* Foto del problema (opcional) */}
          {problemPhoto ? (
            <View style={styles.photoPreview}>
              <Image source={{ uri: problemPhoto.uri }} style={styles.photoPreviewImg} />
              <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => setProblemPhoto(null)}>
                <Ionicons name="close-circle" size={22} color="#ff4444" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoChangeBtn} onPress={pickProblemPhoto}>
                <Ionicons name="camera-outline" size={13} color="#888" />
                <Text style={styles.photoChangeBtnText}>Cambiar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoPickBtn} onPress={pickProblemPhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={18} color="#888" />
              <Text style={styles.photoPickBtnText}>Agregar foto del problema <Text style={{ color: '#555' }}>(opcional)</Text></Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Aviso multi-profesional */}
        <View style={styles.multiNotice}>
          <Ionicons name="people-outline" size={16} color="#FFD600" />
          <Text style={styles.multiNoticeText}>
            Tu solicitud se envía a hasta 3 profesionales cercanos. Recibís su respuesta y elegís el que más te conviene.
          </Text>
        </View>

        {/* Cobro de visita */}
        <View style={styles.visitSection}>
          <View style={styles.visitRow}>
            <View>
              <Text style={styles.visitLabel}>Visita y diagnóstico</Text>
              <Text style={styles.visitSub}>Se cobra solo si va al domicilio</Text>
            </View>
            <Text style={styles.visitVal}>${visitPrice.toLocaleString('es-AR')}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.visitDeductRow}>
            <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
            <Text style={styles.visitDeductText}>
              Si se realiza el trabajo, la visita <Text style={{ color: '#4CAF50', fontWeight: '800' }}>se descuenta del total</Text>. Solo pagás el trabajo.
            </Text>
          </View>
          <View style={styles.visitDeductRow}>
            <Ionicons name="document-text-outline" size={16} color="#888" />
            <Text style={styles.visitDeductText}>
              El profesional te enviará un presupuesto con los materiales necesarios cuando llegue.
            </Text>
          </View>
        </View>

        {/* Info seguridad */}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color="#FFD600" />
          <Text style={styles.infoText}>
            Tu pago está protegido. El profesional no recibe el dinero hasta que confirmes que el trabajo está hecho.
          </Text>
        </View>

        {/* Botón */}
        <TouchableOpacity
          style={[styles.confirmBtn, (loading || notes.trim().length < 10) && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#0A0A0A" />
          ) : (
            <>
              <Ionicons name="flash" size={20} color="#0A0A0A" />
              <Text style={styles.confirmBtnText}>Buscar profesionales</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.cancelNote}>Podés cancelar sin cargo si ningún profesional acepta</Text>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#F5F5F5' },
  scroll: { padding: 20, paddingBottom: 48 },

  workerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 16,
  },
  workerAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1A1A1A', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  workerAvatarImg: { width: '100%', height: '100%' },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 16, fontWeight: '800', color: '#F5F5F5' },
  workerProfession: { fontSize: 13, color: '#888', marginTop: 2, marginBottom: 6 },
  workerStars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  workerRating: { fontSize: 12, color: '#666', marginLeft: 4 },
  distBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#1A1A1A', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  distText: { color: '#FFD600', fontSize: 12, fontWeight: '700' },

  addressSection: {
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, marginBottom: 16,
  },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  addressLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: '#888' },
  addressEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  addressEditText: { fontSize: 12, color: '#888' },
  addressText: { fontSize: 14, color: '#F5F5F5', lineHeight: 20 },
  addressInput: {
    backgroundColor: '#0A0A0A', borderRadius: 10, borderWidth: 1, borderColor: '#FFD600',
    color: '#F5F5F5', fontSize: 14, padding: 12,
  },
  addressHint: { fontSize: 11, color: '#555', marginTop: 6, lineHeight: 16 },

  multiNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a1a',
    padding: 14, marginBottom: 20,
  },
  multiNoticeText: { flex: 1, fontSize: 13, color: '#888', lineHeight: 19 },

  divider: { height: 1, backgroundColor: '#1a1a1a', marginVertical: 10 },

  notesSection: {
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1.5, borderColor: '#2a2a1a',
    padding: 16, marginBottom: 16,
  },
  notesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  notesSectionTitle:  { fontSize: 15, fontWeight: '800', color: '#F5F5F5' },
  notesSectionHint:   { fontSize: 12, color: '#666', lineHeight: 17, marginBottom: 12 },
  notesInput: {
    backgroundColor: '#0A0A0A', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 14, padding: 14,
    minHeight: 100,
  },
  notesInputError: { borderColor: '#ff444460' },
  notesError: { fontSize: 12, color: '#ff4444', marginTop: 6 },

  visitSection: {
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 20, gap: 4,
  },
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  visitLabel: { fontSize: 15, color: '#F5F5F5', fontWeight: '700' },
  visitSub:   { fontSize: 12, color: '#555', marginTop: 2 },
  visitVal:   { fontSize: 22, color: '#FFD600', fontWeight: '900' },
  visitDeductRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  visitDeductText: { flex: 1, fontSize: 13, color: '#666', lineHeight: 18 },

  infoBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a1a',
    padding: 14, marginBottom: 24,
  },
  infoText: { flex: 1, fontSize: 13, color: '#888', lineHeight: 19 },

  // Foto del problema
  photoPickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a',
    borderStyle: 'dashed', backgroundColor: '#0D0D0D',
  },
  photoPickBtnText: { fontSize: 13, color: '#888' },
  photoPreview: {
    marginTop: 12, borderRadius: 12, overflow: 'hidden',
    position: 'relative',
  },
  photoPreviewImg: { width: '100%', height: 160, borderRadius: 12 },
  photoRemoveBtn: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: '#0A0A0A', borderRadius: 12,
  },
  photoChangeBtn: {
    position: 'absolute', bottom: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  photoChangeBtnText: { fontSize: 11, color: '#888' },

  autoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1.5, borderColor: '#2a2a1a',
    padding: 16, marginBottom: 16,
  },
  autoIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  autoTitle: { fontSize: 16, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  autoSub:   { fontSize: 12, color: '#888', lineHeight: 17 },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#FFD600',
    borderRadius: 16, paddingVertical: 18, marginBottom: 12,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: '#0A0A0A', fontSize: 17, fontWeight: '900' },
  cancelNote: { textAlign: 'center', fontSize: 12, color: '#444' },
});

export default JobRequestScreen;

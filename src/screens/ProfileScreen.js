import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, Platform, Image, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../supabase';
import WorkerDashboardScreen from './WorkerDashboardScreen';
import AdminScreen from './AdminScreen';

const ADMIN_EMAILS = ['maxi95.bahiablanca@gmail.com'];

const LEVEL_MAP = (jobs, rating) => {
  if (jobs >= 100 && rating >= 4.8) return { label: 'Elite',     color: '#FFD600' };
  if (jobs >= 50  && rating >= 4.5) return { label: 'Pro',       color: '#4285F4' };
  if (jobs >= 10  && rating >= 4.0) return { label: 'Verificado', color: '#4CAF50' };
  return                                    { label: 'Nuevo',     color: '#888' };
};

const ProfileScreen = ({ session, professional, onClose }) => {
  const [signingOut, setSigningOut]       = useState(false);
  const [showWorkerPanel, setWorkerPanel] = useState(false);
  const [showAdmin, setShowAdmin]         = useState(false);
  const [photoUrl, setPhotoUrl]           = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email);

  if (showWorkerPanel && professional) {
    return <WorkerDashboardScreen professional={professional} session={session} onClose={() => setWorkerPanel(false)} />;
  }
  if (showAdmin) {
    return <AdminScreen session={session} onClose={() => setShowAdmin(false)} />;
  }

  const user      = session?.user;
  const email     = user?.email ?? '';
  const name      = user?.user_metadata?.full_name ?? email.split('@')[0];
  const basePhoto = professional?.avatar_url ?? user?.user_metadata?.avatar_url ?? null;
  const displayPhoto = photoUrl ?? basePhoto;

  const uploadAndSave = async (file) => {
    setUploadingPhoto(true);
    try {
      const ext      = file.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path     = `${user.id}/avatar.${ext}`;
      const base64   = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const binary   = atob(base64);
      const bytes    = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, bytes, { upsert: true, contentType: `image/${ext}` });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = data.publicUrl;

      await supabase.auth.updateUser({ data: { avatar_url: url } });

      if (professional) {
        await supabase.from('professionals').update({ avatar_url: url }).eq('user_id', user.id);
      }

      setPhotoUrl(url);
    } catch {
      Alert.alert('Error', 'No se pudo subir la foto. Intentá de nuevo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!r.canceled) await uploadAndSave(r.assets[0]);
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
    if (!r.canceled) await uploadAndSave(r.assets[0]);
  };

  const handleChangePhoto = () => {
    Alert.alert('Foto de perfil', '', [
      { text: 'Cámara',  onPress: pickFromCamera },
      { text: 'Galería', onPress: pickFromGallery },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const level = professional
    ? LEVEL_MAP(professional.completed_jobs || 0, parseFloat(professional.avg_rating) || 0)
    : null;

  const commission = professional
    ? (professional.completed_jobs >= 100 && professional.avg_rating >= 4.8 ? 10
      : professional.completed_jobs >= 50  && professional.avg_rating >= 4.5 ? 14
      : professional.completed_jobs >= 10  && professional.avg_rating >= 4.0 ? 17 : 20)
    : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color="#888" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mi perfil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Avatar + nombre */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarWrapper} onPress={handleChangePhoto} activeOpacity={0.8} disabled={uploadingPhoto}>
            <View style={styles.avatar}>
              {uploadingPhoto
                ? <ActivityIndicator color="#FFD600" />
                : displayPhoto
                ? <Image source={{ uri: displayPhoto }} style={styles.avatarImg} />
                : <Ionicons name="person" size={44} color="#FFD600" />}
            </View>
            <View style={styles.avatarEditBadge}>
              <Ionicons name="camera" size={13} color="#0A0A0A" />
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>{name}</Text>
          <Text style={styles.userEmail}>{email}</Text>
          {level && (
            <View style={[styles.levelBadge, { borderColor: level.color + '60' }]}>
              <Text style={[styles.levelText, { color: level.color }]}>{level.label}</Text>
            </View>
          )}
        </View>

        {/* Stats del profesional */}
        {professional && (
          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Text style={styles.statVal}>{professional.completed_jobs || 0}</Text>
              <Text style={styles.statLbl}>Trabajos</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statItem}>
              <Text style={styles.statVal}>
                {professional.avg_rating ? Number(professional.avg_rating).toFixed(1) : '—'}
              </Text>
              <Text style={styles.statLbl}>Promedio</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statItem}>
              <Text style={[styles.statVal, { color: '#4CAF50' }]}>{commission}%</Text>
              <Text style={styles.statLbl}>Comisión</Text>
            </View>
          </View>
        )}

        {/* Próximo nivel */}
        {professional && level?.label !== 'Elite' && (
          <View style={styles.nextLevelCard}>
            <Ionicons name="trending-up-outline" size={18} color="#FFD600" />
            <View style={{ flex: 1 }}>
              <Text style={styles.nextLevelTitle}>Próximo nivel</Text>
              <Text style={styles.nextLevelSub}>
                {level.label === 'Nuevo'
                  ? `10 trabajos con ★4.0+ → Verificado (−3% comisión)`
                  : level.label === 'Verificado'
                  ? `50 trabajos con ★4.5+ → Pro (−3% comisión)`
                  : `100 trabajos con ★4.8+ → Elite (comisión mínima 10%)`}
              </Text>
            </View>
          </View>
        )}

        {/* Datos de la cuenta */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cuenta</Text>

          {professional && (
            <>
              <View style={styles.row}>
                <Ionicons name="call-outline" size={18} color="#555" />
                <Text style={styles.rowText}>{professional.phone || 'Sin teléfono'}</Text>
              </View>
              <View style={styles.rowDivider} />
              {professional.cbu && (
                <>
                  <View style={styles.row}>
                    <Ionicons name="card-outline" size={18} color="#555" />
                    <Text style={styles.rowText}>CBU: •••• {professional.cbu.slice(-4)}</Text>
                  </View>
                  <View style={styles.rowDivider} />
                </>
              )}
            </>
          )}

          <View style={styles.row}>
            <Ionicons name="mail-outline" size={18} color="#555" />
            <Text style={styles.rowText}>{email}</Text>
          </View>
        </View>

        {/* Info de la plataforma */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sobre VOLT</Text>
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#FFD600" />
            <Text style={styles.infoText}>Todos los pagos están protegidos por la plataforma.</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="flash-outline" size={16} color="#FFD600" />
            <Text style={styles.infoText}>Cuanto más trabajás, menos comisión pagás.</Text>
          </View>
        </View>

        {/* Panel del trabajador */}
        {professional?.verification_status === 'approved' && (
          <TouchableOpacity style={styles.panelBtn} onPress={() => setWorkerPanel(true)} activeOpacity={0.8}>
            <Ionicons name="briefcase-outline" size={20} color="#FFD600" />
            <Text style={styles.panelBtnText}>Mi panel de trabajador</Text>
            <Ionicons name="chevron-forward" size={18} color="#444" />
          </TouchableOpacity>
        )}

        {/* Panel admin */}
        {isAdmin && (
          <TouchableOpacity style={[styles.panelBtn, styles.adminBtn]} onPress={() => setShowAdmin(true)} activeOpacity={0.8}>
            <Ionicons name="shield-outline" size={20} color="#FFD600" />
            <Text style={styles.panelBtnText}>Panel de administración</Text>
            <Ionicons name="chevron-forward" size={18} color="#444" />
          </TouchableOpacity>
        )}

        {/* Cerrar sesión */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color="#ff4444" />
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>

        <Text style={styles.version}>VOLT v1.0</Text>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },

  scroll: { padding: 20, paddingBottom: 48 },

  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatarWrapper: { marginBottom: 14 },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#1A1A1A',
    borderWidth: 2.5, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  userName: { fontSize: 22, fontWeight: '900', color: '#F5F5F5', marginBottom: 4 },
  userEmail: { fontSize: 14, color: '#555', marginBottom: 12 },
  levelBadge: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 5,
  },
  levelText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  statsCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 20, marginBottom: 12,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '900', color: '#F5F5F5', marginBottom: 4 },
  statLbl: { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  statDiv: { width: 1, height: 36, backgroundColor: '#1E1E1E' },

  nextLevelCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a1a',
    padding: 14, marginBottom: 24,
  },
  nextLevelTitle: { fontSize: 13, fontWeight: '700', color: '#FFD600', marginBottom: 3 },
  nextLevelSub: { fontSize: 12, color: '#666', lineHeight: 17 },

  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', color: '#444',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14,
  },
  rowText: { fontSize: 14, color: '#888', flex: 1 },
  rowDivider: { height: 1, backgroundColor: '#111' },

  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginBottom: 10,
  },
  infoText: { flex: 1, fontSize: 13, color: '#555', lineHeight: 18 },

  panelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 10,
  },
  adminBtn: { borderColor: '#FFD60020' },
  panelBtnText: { flex: 1, fontSize: 15, color: '#F5F5F5', fontWeight: '600' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,68,68,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.25)',
    borderRadius: 16, paddingVertical: 16,
    marginBottom: 20,
  },
  signOutText: { color: '#ff4444', fontSize: 15, fontWeight: '700' },

  version: { textAlign: 'center', fontSize: 12, color: '#2a2a2a' },
});

export default ProfileScreen;

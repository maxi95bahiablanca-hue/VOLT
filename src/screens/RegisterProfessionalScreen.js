import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Image,
  Alert, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import professionService from '../services/professionService';
import professionalService from '../services/professionalService';

const MIN_PRICE = 30000;

// ─── Subir imagen a Supabase Storage ─────────────────────────────────────────
// Avatar va al bucket público 'avatars'; los documentos al privado 'worker-docs'
async function uploadImage(userId, file, path) {
  const response = await fetch(file.uri);
  const blob     = await response.blob();
  const ext      = file.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const isAvatar = path === 'avatar';
  const bucket   = isAvatar ? 'avatars' : 'worker-docs';
  const fullPath = `${userId}/${path}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(fullPath, blob, { upsert: true, contentType: `image/${ext === 'pdf' ? 'pdf' : ext}` });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(fullPath);
  return data.publicUrl;
}

// ─── Componente: botón de foto/archivo ────────────────────────────────────────
const PhotoButton = ({ label, hint, uri, onPress, icon = 'camera-outline' }) => (
  <TouchableOpacity style={[styles.photoBtn, uri && styles.photoBtnDone]} onPress={onPress} activeOpacity={0.8}>
    {uri ? (
      <Image source={{ uri }} style={styles.photoBtnThumb} />
    ) : (
      <View style={styles.photoBtnIcon}>
        <Ionicons name={icon} size={24} color="#FFD600" />
      </View>
    )}
    <View style={{ flex: 1 }}>
      <Text style={[styles.photoBtnLabel, uri && styles.photoBtnLabelDone]}>{label}</Text>
      {hint && !uri && <Text style={styles.photoBtnHint}>{hint}</Text>}
      {uri && <Text style={styles.photoBtnLabelDone}>✓ Cargada</Text>}
    </View>
    <Ionicons name={uri ? 'checkmark-circle' : 'chevron-forward'} size={20}
      color={uri ? '#4CAF50' : '#444'} />
  </TouchableOpacity>
);

// ─── SCREEN ───────────────────────────────────────────────────────────────────
const RegisterProfessionalScreen = ({ userId, onBack }) => {
  const [step, setStep]           = useState(1); // 1: datos, 2: profesiones, 3: docs
  const [initializing, setInit]   = useState(true);
  const [saving, setSaving]       = useState(false);
  const [professions, setProfs]   = useState([]);
  const [existingStatus, setExistingStatus] = useState(null);

  // Paso 1 — Datos personales
  const [nombre, setNombre]     = useState('');
  const [apellido, setApellido] = useState('');
  const [phone, setPhone]       = useState('');
  const [avatar, setAvatar]     = useState(null);

  // Paso 2 — Profesiones
  const [selections, setSelections] = useState({});

  // Paso 3 — Documentos
  const [selfie, setSelfie]         = useState(null);
  const [dniFront, setDniFront]     = useState(null);
  const [dniBack, setDniBack]       = useState(null);
  const [cuit, setCuit]             = useState('');
  const [cbu, setCbu]               = useState('');
  const [criminalRecord, setCriminalRecord] = useState(false);

  // ─── Carga inicial ───────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const [profs, prof] = await Promise.all([
          professionService.getProfessions(),
          professionalService.getByUserId(userId),
        ]);
        setProfs(profs);
        if (prof) {
          setExistingStatus(prof.verification_status);
          setNombre(prof.first_name || '');
          setApellido(prof.last_name || '');
          setPhone(prof.phone || '');
          setCuit(prof.cuit || '');
          setCbu(prof.cbu || '');
          setCriminalRecord(prof.criminal_record_confirmed || false);
          if (prof.professional_professions?.length > 0) {
            const sels = {};
            prof.professional_professions.forEach(pp => {
              sels[pp.profession_id] = {
                name: profs.find(p => p.id === pp.profession_id)?.name || '',
                price: String(pp.min_price),
                priceError: null,
              };
            });
            setSelections(sels);
          }
          if (prof.avatar_url)   setAvatar({ uri: prof.avatar_url });
          if (prof.selfie_url)   setSelfie({ uri: prof.selfie_url });
          if (prof.dni_front_url) setDniFront({ uri: prof.dni_front_url });
          if (prof.dni_back_url)  setDniBack({ uri: prof.dni_back_url });
        }
      } catch { /* silent */ }
      finally { setInit(false); }
    };
    init();
  }, []);

  // ─── Foto de avatar ──────────────────────────────────────────────────────
  const pickAvatar = () => {
    Alert.alert('Foto de perfil', '', [
      { text: 'Cámara', onPress: () => launchCamera(setAvatar, [1,1]) },
      { text: 'Galería', onPress: () => launchGallery(setAvatar, [1,1]) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const pickSelfie = () => {
    Alert.alert('Selfie de verificación', 'Tomá una foto tuya sosteniendo el DNI abierto', [
      { text: 'Abrir cámara', onPress: () => launchCamera(setSelfie, [3,4]) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const pickDniSide = (side) => {
    Alert.alert(`DNI — ${side === 'front' ? 'Frente' : 'Dorso'}`, '', [
      { text: 'Cámara',  onPress: () => launchCamera(side === 'front' ? setDniFront : setDniBack, [16,9]) },
      { text: 'Galería', onPress: () => launchGallery(side === 'front' ? setDniFront : setDniBack, [16,9]) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const launchCamera = async (setter, aspect) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara.'); return; }
    const r = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect, quality: 0.8 });
    if (!r.canceled) setter({ uri: r.assets[0].uri, name: 'photo.jpg' });
  };

  const launchGallery = async (setter, aspect) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const r = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect, quality: 0.8 });
    if (!r.canceled) setter({ uri: r.assets[0].uri, name: 'photo.jpg' });
  };

  // ─── Profesiones ─────────────────────────────────────────────────────────
  const toggleProfession = (p) => {
    setSelections(prev => {
      if (prev[p.id]) { const n = { ...prev }; delete n[p.id]; return n; }
      return { ...prev, [p.id]: { name: p.name, price: '', priceError: null } };
    });
  };

  const updatePrice = (id, raw) => {
    const digits = raw.replace(/\D/g, '');
    const num = parseInt(digits, 10);
    setSelections(prev => ({
      ...prev,
      [id]: { ...prev[id], price: digits, priceError: !digits || num < MIN_PRICE ? 'Mínimo $30.000' : null },
    }));
  };

  // ─── CUIT / CBU ──────────────────────────────────────────────────────────
  const handleCuit = (t) => {
    const n = t.replace(/\D/g, '').slice(0, 11);
    let f = n;
    if (n.length > 2)  f = `${n.slice(0,2)}-${n.slice(2)}`;
    if (n.length > 10) f = `${n.slice(0,2)}-${n.slice(2,10)}-${n.slice(10)}`;
    setCuit(f);
  };

  // ─── Validación por paso ──────────────────────────────────────────────────
  const validateStep1 = () => {
    if (!nombre.trim() || !apellido.trim()) { Alert.alert('Completá nombre y apellido.'); return false; }
    if (!phone.replace(/\D/g,'') || phone.replace(/\D/g,'').length < 8) { Alert.alert('Ingresá un teléfono válido.'); return false; }
    const cuitDigits = cuit.replace(/\D/g,'');
    if (!cuitDigits || cuitDigits.length !== 11) { Alert.alert('CUIT inválido', 'El CUIT debe tener 11 dígitos.'); return false; }
    if (!cbu || cbu.length !== 22) { Alert.alert('CBU inválido', 'El CBU debe tener exactamente 22 dígitos.'); return false; }
    return true;
  };

  const validateStep2 = () => {
    if (Object.keys(selections).length === 0) { Alert.alert('Seleccioná al menos un servicio.'); return false; }
    if (Object.values(selections).some(s => !s.price || parseInt(s.price,10) < MIN_PRICE)) {
      Alert.alert('Revisá los precios', 'Todos deben ser al menos $30.000.');
      return false;
    }
    return true;
  };

  const validateStep3 = () => {
    if (!selfie)   { Alert.alert('Necesitamos tu selfie con DNI para verificar tu identidad.'); return false; }
    if (!dniFront) { Alert.alert('Subí el frente de tu DNI.'); return false; }
    if (!dniBack)  { Alert.alert('Subí el dorso de tu DNI.'); return false; }
    if (!criminalRecord) { Alert.alert('Debés aceptar la declaración jurada para continuar.'); return false; }
    return true;
  };

  // ─── Guardar ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!validateStep3()) return;
    setSaving(true);
    try {
      // Subir imágenes a Storage
      const [avatarUrl, selfieUrl, dniFrontUrl, dniBackUrl] = await Promise.all([
        avatar  && !avatar.uri.startsWith('https') ? uploadImage(userId, avatar,   'avatar')    : Promise.resolve(avatar?.uri),
        selfie  && !selfie.uri.startsWith('https') ? uploadImage(userId, selfie,   'selfie')    : Promise.resolve(selfie?.uri),
        dniFront && !dniFront.uri.startsWith('https') ? uploadImage(userId, dniFront, 'dni_front') : Promise.resolve(dniFront?.uri),
        dniBack  && !dniBack.uri.startsWith('https') ? uploadImage(userId, dniBack,  'dni_back')  : Promise.resolve(dniBack?.uri),
      ]);

      await professionalService.save(userId, {
        firstName: nombre.trim(),
        lastName:  apellido.trim(),
        phone:     phone.replace(/\D/g,''),
        cuit, cbu,
        criminalRecord,
        selections,
        avatarUrl,
        selfieUrl,
        dniFrontUrl,
        dniBackUrl,
        verificationStatus: 'pending',
      });

      Alert.alert(
        '¡Solicitud enviada!',
        'Revisaremos tu documentación y te avisaremos por notificación en 24–48 hs hábiles.',
        [{ text: 'Entendido', onPress: onBack }]
      );
    } catch (err) {
      Alert.alert('Error al enviar', err?.message || 'No se pudo enviar la solicitud. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Estados especiales ───────────────────────────────────────────────────
  if (initializing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator size="large" color="#FFD600" />
        </View>
      </SafeAreaView>
    );
  }

  // Solicitud ya enviada y pendiente
  if (existingStatus === 'pending') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color="#F5F5F5" /></TouchableOpacity>
          <Text style={styles.headerTitle}>Mi solicitud</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.statusWrap}>
          <View style={styles.statusIcon}>
            <Ionicons name="time" size={48} color="#FFD600" />
          </View>
          <Text style={styles.statusTitle}>Solicitud en revisión</Text>
          <Text style={styles.statusSub}>
            Nuestro equipo está verificando tu documentación.{'\n'}
            Te avisaremos por notificación en 24–48 hs hábiles.
          </Text>
          <View style={styles.statusSteps}>
            {['Solicitud enviada ✓', 'Revisión de documentos', 'Aprobación y activación'].map((s,i) => (
              <View key={i} style={styles.statusStep}>
                <View style={[styles.stepDot, i === 0 && styles.stepDotDone, i === 1 && styles.stepDotActive]} />
                <Text style={[styles.stepText, i === 0 && styles.stepTextDone, i === 1 && styles.stepTextActive]}>{s}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={() => setExistingStatus(null)}>
            <Text style={styles.editBtnText}>Editar mi solicitud</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (existingStatus === 'rejected') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color="#F5F5F5" /></TouchableOpacity>
          <Text style={styles.headerTitle}>Mi solicitud</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.statusWrap}>
          <View style={[styles.statusIcon, { borderColor: '#ff444440' }]}>
            <Ionicons name="close-circle" size={48} color="#ff4444" />
          </View>
          <Text style={styles.statusTitle}>Solicitud rechazada</Text>
          <Text style={styles.statusSub}>
            Podés corregir tu documentación y volver a enviar la solicitud.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setExistingStatus(null)}>
            <Ionicons name="refresh" size={18} color="#0A0A0A" />
            <Text style={styles.retryBtnText}>Volver a solicitar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={step > 1 ? () => setStep(s => s - 1) : onBack}>
          <Ionicons name="arrow-back" size={24} color="#F5F5F5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {step === 1 ? 'Tus datos' : step === 2 ? 'Tus servicios' : 'Verificación'}
        </Text>
        <Text style={styles.stepCounter}>{step}/3</Text>
      </View>

      {/* Barra de progreso */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* ─── PASO 1: DATOS PERSONALES ─── */}
        {step === 1 && (
          <>
            <Text style={styles.stepTitle}>¿Quién sos?</Text>
            <Text style={styles.stepSub}>Esta información aparecerá en tu perfil público.</Text>

            {/* Avatar */}
            <TouchableOpacity style={styles.avatarBtn} onPress={pickAvatar} activeOpacity={0.8}>
              {avatar ? (
                <Image source={{ uri: avatar.uri }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="camera" size={32} color="#FFD600" />
                  <Text style={styles.avatarPlaceholderText}>Foto de perfil</Text>
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="pencil" size={12} color="#0A0A0A" />
              </View>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Nombre *</Text>
            <TextInput style={styles.input} placeholder="Tu nombre" placeholderTextColor="#444"
              value={nombre} onChangeText={setNombre} autoCapitalize="words" />

            <Text style={styles.fieldLabel}>Apellido *</Text>
            <TextInput style={styles.input} placeholder="Tu apellido" placeholderTextColor="#444"
              value={apellido} onChangeText={setApellido} autoCapitalize="words" />

            <Text style={styles.fieldLabel}>Teléfono *</Text>
            <TextInput style={styles.input} placeholder="Ej: 2914123456" placeholderTextColor="#444"
              value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

            <Text style={styles.fieldLabel}>CUIT *</Text>
            <TextInput style={styles.input} placeholder="20-12345678-9" placeholderTextColor="#444"
              value={cuit} onChangeText={handleCuit} keyboardType="numeric" />
            {cuit.length > 0 && cuit.replace(/\D/g,'').length < 11 && (
              <Text style={styles.fieldError}>El CUIT debe tener 11 dígitos</Text>
            )}

            <Text style={styles.fieldLabel}>CBU * (para recibir pagos)</Text>
            <TextInput style={styles.input} placeholder="22 dígitos" placeholderTextColor="#444"
              value={cbu} onChangeText={t => setCbu(t.replace(/\D/g,'').slice(0,22))} keyboardType="numeric" />
            {cbu.length > 0 && cbu.length < 22 && (
              <Text style={styles.fieldError}>El CBU debe tener 22 dígitos ({cbu.length}/22)</Text>
            )}

            <TouchableOpacity style={styles.nextBtn} onPress={() => validateStep1() && setStep(2)}>
              <Text style={styles.nextBtnText}>Continuar</Text>
              <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          </>
        )}

        {/* ─── PASO 2: SERVICIOS ─── */}
        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>¿Qué servicios ofrecés?</Text>
            <Text style={styles.stepSub}>Podés seleccionar más de uno. El precio mínimo es el de consulta.</Text>

            {professions.map(p => {
              const sel = selections[p.id];
              return (
                <View key={p.id}>
                  <TouchableOpacity
                    style={[styles.profRow, sel && styles.profRowSelected]}
                    onPress={() => toggleProfession(p)} activeOpacity={0.8}
                  >
                    <View style={[styles.check, sel && styles.checkSelected]}>
                      {sel && <Ionicons name="checkmark" size={14} color="#0A0A0A" />}
                    </View>
                    <Text style={[styles.profName, sel && styles.profNameSelected]}>{p.name}</Text>
                  </TouchableOpacity>

                  {sel && (
                    <View style={styles.priceWrap}>
                      <Text style={styles.priceLabel}>Precio de consulta mínimo</Text>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceCurrency}>$</Text>
                        <TextInput
                          style={styles.priceInput}
                          placeholder="30.000"
                          placeholderTextColor="#333"
                          keyboardType="numeric"
                          value={sel.price ? parseInt(sel.price).toLocaleString('es-AR') : ''}
                          onChangeText={v => updatePrice(p.id, v)}
                        />
                      </View>
                      {sel.priceError && <Text style={styles.fieldError}>{sel.priceError}</Text>}
                    </View>
                  )}
                </View>
              );
            })}

            <TouchableOpacity style={styles.nextBtn} onPress={() => validateStep2() && setStep(3)}>
              <Text style={styles.nextBtnText}>Continuar</Text>
              <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          </>
        )}

        {/* ─── PASO 3: DOCUMENTACIÓN ─── */}
        {step === 3 && (
          <>
            <Text style={styles.stepTitle}>Verificá tu identidad</Text>
            <Text style={styles.stepSub}>
              Tus datos son seguros. Los revisamos únicamente para verificar tu identidad antes de habilitarte.
            </Text>

            <View style={styles.docSection}>
              <Text style={styles.docSectionTitle}>Selfie con DNI</Text>
              <Text style={styles.docSectionHint}>Tomá una foto tuya sosteniendo el DNI abierto en tu cara</Text>
              <PhotoButton label="Selfie + DNI" hint="Usá tu cámara frontal" uri={selfie?.uri} onPress={pickSelfie} icon="person-outline" />
            </View>

            <View style={styles.docSection}>
              <Text style={styles.docSectionTitle}>Fotos del DNI</Text>
              <PhotoButton label="Frente del DNI" hint="Lado con tu foto y nombre" uri={dniFront?.uri} onPress={() => pickDniSide('front')} />
              <PhotoButton label="Dorso del DNI" hint="Lado con el código de barras" uri={dniBack?.uri} onPress={() => pickDniSide('back')} />
            </View>

            {/* Declaración jurada */}
            <TouchableOpacity
              style={[styles.declRow, criminalRecord && styles.declRowChecked]}
              onPress={() => setCriminalRecord(v => !v)} activeOpacity={0.8}
            >
              <View style={[styles.check, criminalRecord && styles.checkSelected]}>
                {criminalRecord && <Ionicons name="checkmark" size={14} color="#0A0A0A" />}
              </View>
              <Text style={styles.declText}>
                Declaro bajo juramento que no tengo antecedentes penales ni procesos judiciales
                en curso por delitos dolosos. Entiendo que la falsedad implica la inhabilitación
                inmediata y permanente de mi cuenta.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#0A0A0A" />
                  <Text style={styles.submitBtnText}>Enviar solicitud</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.submitNote}>
              Revisamos tu solicitud en 24–48 hs hábiles y te avisamos por notificación.
            </Text>
          </>
        )}
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
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },
  stepCounter: { fontSize: 14, color: '#555', fontWeight: '700' },

  progressBar: { height: 3, backgroundColor: '#1a1a1a' },
  progressFill: { height: 3, backgroundColor: '#FFD600' },

  scroll: { padding: 24, paddingBottom: 60 },

  stepTitle: { fontSize: 24, fontWeight: '900', color: '#F5F5F5', marginBottom: 6, marginTop: 8 },
  stepSub:   { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 28 },

  // Avatar
  avatarBtn: {
    alignSelf: 'center', marginBottom: 28,
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 2, borderColor: '#FFD600',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1A1A1A', gap: 6,
  },
  avatarPlaceholderText: { fontSize: 11, color: '#666', textAlign: 'center' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },

  // Campos
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  fieldError: { fontSize: 12, color: '#ff4444', marginTop: 4 },
  input: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 16, padding: 14,
  },

  // Profesiones
  profRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 8,
  },
  profRowSelected: { borderColor: '#FFD600', backgroundColor: '#1A1A00' },
  check: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: '#333',
    alignItems: 'center', justifyContent: 'center',
  },
  checkSelected: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  profName:         { fontSize: 15, color: '#888', fontWeight: '600', flex: 1 },
  profNameSelected: { color: '#FFD600' },

  priceWrap: {
    backgroundColor: '#0D0D00', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a00',
    padding: 14, marginBottom: 8, marginTop: -2,
  },
  priceLabel:    { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  priceRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceCurrency: { fontSize: 22, fontWeight: '700', color: '#F5F5F5' },
  priceInput:    { flex: 1, fontSize: 22, fontWeight: '700', color: '#FFD600', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 4 },

  // Documentos
  docSection: { marginBottom: 24 },
  docSectionTitle: { fontSize: 15, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },
  docSectionHint:  { fontSize: 13, color: '#555', marginBottom: 12 },

  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, marginBottom: 10,
  },
  photoBtnDone: { borderColor: '#4CAF5040' },
  photoBtnIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: '#1A1A00',
    alignItems: 'center', justifyContent: 'center',
  },
  photoBtnThumb: { width: 48, height: 48, borderRadius: 10 },
  photoBtnLabel:     { fontSize: 14, fontWeight: '700', color: '#F5F5F5' },
  photoBtnLabelDone: { fontSize: 13, color: '#4CAF50' },
  photoBtnHint:      { fontSize: 12, color: '#555', marginTop: 2 },

  // Declaración
  declRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 24,
  },
  declRowChecked: { borderColor: '#FFD60040' },
  declText: { flex: 1, fontSize: 13, color: '#666', lineHeight: 20 },

  // Botones
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 16, paddingVertical: 18, marginTop: 28,
  },
  nextBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 16, paddingVertical: 18, marginBottom: 12,
  },
  submitBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
  submitNote: { textAlign: 'center', fontSize: 12, color: '#444', lineHeight: 18 },

  // Estados pendiente / rechazado
  statusWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  statusIcon: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD60040',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  statusTitle: { fontSize: 24, fontWeight: '900', color: '#F5F5F5', textAlign: 'center', marginBottom: 12 },
  statusSub:   { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 32 },

  statusSteps: { width: '100%', gap: 16, marginBottom: 32 },
  statusStep:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#222' },
  stepDotDone:   { backgroundColor: '#4CAF50' },
  stepDotActive: { backgroundColor: '#FFD600' },
  stepText:       { fontSize: 14, color: '#444' },
  stepTextDone:   { color: '#4CAF50', fontWeight: '700' },
  stepTextActive: { color: '#FFD600', fontWeight: '700' },

  editBtn: {
    borderWidth: 1, borderColor: '#333',
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28,
  },
  editBtnText: { color: '#888', fontSize: 14, fontWeight: '600' },

  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 32,
  },
  retryBtnText: { color: '#0A0A0A', fontSize: 15, fontWeight: '900' },
});

export default RegisterProfessionalScreen;

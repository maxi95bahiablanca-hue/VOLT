import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, Platform, Image, ActivityIndicator, Linking,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system 19 (SDK 54): readAsStringAsync y EncodingType se mudaron a
// /legacy. Importados de la raiz TIRAN ERROR en runtime, no avisan en el build.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import authService from '../services/authService';
import { showSuccess, showError } from '../utils/toast';
import cardService from '../services/cardService';
import MPCardForm from '../components/MPCardForm';
import PaymentDataModal from '../components/PaymentDataModal';
import CambiarPasswordModal from '../components/CambiarPasswordModal';
import MiNegocioScreen from './MiNegocioScreen';
import professionalService from '../services/professionalService';
import AdminScreen from './AdminScreen';
import { chargesInApp } from '../config/monetization';

const ADMIN_EMAILS = ['maxi95.bahiablanca@gmail.com'];

const LEVEL_MAP = (jobs, rating) => {
  if (jobs >= 100 && rating >= 4.8) return { label: 'Elite',     color: '#FFD600' };
  if (jobs >= 50  && rating >= 4.5) return { label: 'Pro',       color: '#FFD600' };
  if (jobs >= 10  && rating >= 4.0) return { label: 'Verificado', color: '#4CAF50' };
  return                                    { label: 'Nuevo',     color: '#888' };
};

const ProfileScreen = ({ session, professional, onClose }) => {
  const [signingOut, setSigningOut]       = useState(false);
  const [deleting, setDeleting]           = useState(false);
  // El panel del trabajador es uno solo y se llama "Mi negocio".
  const [showNegocio, setShowNegocio]     = useState(false);
  const [showAdmin, setShowAdmin]         = useState(false);
  const [photoUrl, setPhotoUrl]           = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [paymentVerified, setPaymentVerified]     = useState(false);
  const [loadingPayment, setLoadingPayment]       = useState(false);
  const [localPaymentMethod, setLocalPaymentMethod] = useState(professional?.payment_method || 'cbu');
  const [showPayData, setShowPayData] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [payData, setPayData] = useState({ cuit: professional?.cuit || '', cbu: professional?.cbu || '' });
  // Tarjetas guardadas (solo clientes)
  const [cards, setCards]           = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [showAddCard, setShowAddCard]   = useState(false);

  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email);
  const user    = session?.user;

  // El que entró con Google no tiene contraseña propia: el botón le ofrece
  // ponerle una, no cambiarla. Si no viene la lista de identidades asumimos que
  // sí tiene — pedirle la actual es el camino que no rompe nada.
  const tienePassword = !user?.identities?.length
    || user.identities.some(i => i.provider === 'email');

  const loadCards = async () => {
    setLoadingCards(true);
    try { setCards(await cardService.list()); } catch { /* silent */ }
    finally { setLoadingCards(false); }
  };
  useEffect(() => { if (!professional) loadCards(); }, []);

  // ─── Mi trabajo: fotos y experiencia (migración 045) ──────────────────────
  const [misFotos, setMisFotos]           = useState([]);
  const [subiendoFoto, setSubiendoFoto]   = useState(false);
  const [showExperiencia, setShowExperiencia] = useState(false);
  const [anios, setAnios]                 = useState(String(professional?.anios_oficio || ''));
  const [presentacion, setPresentacion]   = useState(professional?.presentacion || '');

  useEffect(() => {
    if (!professional?.id) return;
    professionalService.fotosDe(professional.id).then(setMisFotos).catch(() => {});
  }, [professional?.id]);

  const agregarFotoTrabajo = async () => {
    if (subiendoFoto) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos acceso a tus fotos.'); return; }
      const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsMultipleSelection: true, selectionLimit: 6 });
      if (r.canceled || !r.assets?.length) return;
      setSubiendoFoto(true);
      const nuevas = [];
      for (const a of r.assets) {
        try { nuevas.push(await professionalService.subirFoto(professional.id, a.uri)); }
        catch (e) { console.log('foto no subida:', e?.message); }
      }
      if (nuevas.length) {
        setMisFotos(prev => [...prev, ...nuevas]);
        Alert.alert('Listo', nuevas.length === 1
          ? 'La foto queda en revisión y en un rato la ven tus clientes.'
          : `${nuevas.length} fotos en revisión. En un rato las ven tus clientes.`);
      } else {
        Alert.alert('Ups', 'No pudimos subir las fotos. Probá de nuevo.');
      }
    } catch { Alert.alert('Ups', 'No pudimos abrir tus fotos.'); }
    finally { setSubiendoFoto(false); }
  };

  const borrarFotoTrabajo = (f) => {
    Alert.alert('Borrar foto', '¿Sacarla de tu perfil?', [
      { text: 'No', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => {
          try {
            await professionalService.borrarFoto(f.id);
            setMisFotos(prev => prev.filter(x => x.id !== f.id));
          } catch { Alert.alert('Ups', 'No se pudo borrar.'); }
        } },
    ]);
  };

  const guardarExperiencia = async () => {
    try {
      await professionalService.guardarExperiencia(professional.id, {
        aniosOficio: anios, presentacion,
      });
      setShowExperiencia(false);
      Alert.alert('Guardado', 'Tus clientes ya lo van a ver.');
    } catch (e) { Alert.alert('Ups', 'No se pudo guardar: ' + (e?.message || '')); }
  };

  const handleCardToken = async ({ token }) => {
    setShowAddCard(false);
    if (!token) return;
    try {
      await cardService.save(token);
      showSuccess('Tarjeta guardada.');
      loadCards();
    } catch (e) {
      showError(e.message || 'No se pudo guardar la tarjeta.');
    }
  };

  const handleDeleteCard = (card) => {
    Alert.alert('Borrar tarjeta', `¿Borrar la tarjeta terminada en ${card.last_four}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => {
        try { await cardService.remove(card.id); setCards(cs => cs.filter(c => c.id !== card.id)); }
        catch { showError('No se pudo borrar.'); }
      } },
    ]);
  };

  // Verificar si el cliente tiene al menos un pago aprobado
  useEffect(() => {
    if (professional || !user?.id) return;
    setLoadingPayment(true);
    supabase
      .from('jobs')
      .select('id')
      .eq('client_id', user.id)
      .eq('status', 'completed')
      .limit(1)
      .then(({ data }) => setPaymentVerified((data?.length ?? 0) > 0))
      .catch(() => {})
      .finally(() => setLoadingPayment(false));
  }, []);

  if (showNegocio && professional) {
    return <MiNegocioScreen professional={professional} session={session} onClose={() => setShowNegocio(false)} />;
  }
  if (showAdmin) {
    return <AdminScreen session={session} onClose={() => setShowAdmin(false)} />;
  }

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
      showSuccess('Foto de perfil actualizada.');
    } catch {
      showError('No se pudo subir la foto. Intentá de nuevo.');
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

  const handleEditPaymentMethod = () => {
    Alert.alert('Método de cobro', '¿Cómo querés recibir los pagos?', [
      { text: localPaymentMethod === 'cbu' ? 'CBU / CVU ✓ (actual)' : 'CBU / CVU',
        onPress: () => applyPaymentMethod('cbu') },
      { text: localPaymentMethod === 'mercadopago' ? 'Mercado Pago ✓ (actual)' : 'Mercado Pago',
        onPress: () => applyPaymentMethod('mercadopago') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const applyPaymentMethod = async (method) => {
    if (method === localPaymentMethod) return;
    try {
      await supabase.from('professionals').update({ payment_method: method }).eq('user_id', user.id);
      setLocalPaymentMethod(method);
      showSuccess(`Ahora cobrás por ${method === 'cbu' ? 'CBU / CVU' : 'Mercado Pago'}.`);
    } catch {
      showError('No se pudo actualizar el método de cobro.');
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut().catch(() => {});
    setSigningOut(false);
  };

  // Borrar la cuenta. Apple lo exige (guideline 5.1.1(v)) y tiene que borrar de
  // verdad: la función de la base se lleva perfil, trabajos, chats y la cuenta.
  // Dos confirmaciones porque no hay vuelta atrás.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Borrar mi cuenta',
      'Se van a borrar tu cuenta y todos tus datos: perfil, trabajos, mensajes y calificaciones.\n\nEsto no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Continuar', style: 'destructive', onPress: () => {
          Alert.alert(
            '¿Seguro?',
            'Última confirmación. Al tocar "Borrar" perdés el acceso y no se puede recuperar.',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Borrar', style: 'destructive', onPress: async () => {
                setDeleting(true);
                try {
                  await authService.deleteAccount();
                  // La sesión ya se cerró: App.js manda al login solo.
                } catch (e) {
                  setDeleting(false);
                  showError(e.message || 'No se pudo borrar la cuenta. Probá de nuevo.');
                }
              } },
            ],
          );
        } },
      ],
    );
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
          <View style={styles.avatarWrapper}>
            <TouchableOpacity style={styles.avatarTap} onPress={handleChangePhoto} activeOpacity={0.8} disabled={uploadingPhoto}>
              <View style={styles.avatar}>
                {uploadingPhoto
                  ? <ActivityIndicator color="#FFD600" />
                  : displayPhoto
                  ? <Image source={{ uri: displayPhoto }} style={styles.avatarImg} />
                  : <Ionicons name="person" size={44} color="#FFD600" />}
              </View>
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={14} color="#0A0A0A" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.changePhotoBtn} onPress={handleChangePhoto} disabled={uploadingPhoto} activeOpacity={0.7}>
              <Ionicons name="camera-outline" size={13} color="#FFD600" />
              <Text style={styles.changePhotoBtnText}>
                {uploadingPhoto ? 'Subiendo...' : 'Cambiar foto'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.userName}>{name}</Text>
          <Text style={styles.userEmail}>{email}</Text>
          {level && (
            <View style={[styles.levelBadge, { borderColor: level.color + '60' }]}>
              <Text style={[styles.levelText, { color: level.color }]}>{level.label}</Text>
            </View>
          )}
          {professional?.estudios_url && (
            <View style={styles.estudiosBadge}>
              <Ionicons name="school" size={13} color="#FFD600" />
              <Text style={styles.estudiosBadgeText}>Certificado verificado</Text>
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
        {/* ─── Mi trabajo: lo que ve el cliente antes de elegir (045) ───────
            🔴 Las fotos son OPCIONALES y no se pide que sean propias. Maxi:
            "no pongas que las fotos sean de ellos. yo no tengo fotos porque
            jamás le di bola a esas cosas.. y te digo que pinté 200 casas".
            Por eso los años de oficio pesan igual que la galería: el que
            trabajó toda la vida sin documentar nada también tiene qué mostrar. */}
        {professional && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mi trabajo</Text>
            <Text style={styles.miTrabajoSub}>
              Esto es lo que ve el cliente cuando decide a quién llamar.
            </Text>

            <TouchableOpacity style={styles.row} onPress={() => setShowExperiencia(true)} activeOpacity={0.7}>
              <Ionicons name="ribbon-outline" size={18} color={professional.anios_oficio ? '#555' : '#FFD600'} />
              <Text style={[styles.rowText, { flex: 1 }]}>
                {professional.anios_oficio
                  ? `${professional.anios_oficio} años en el oficio`
                  : 'Contá tu experiencia'}
              </Text>
              <Text style={{ fontSize: 11, color: '#FFD600' }}>
                {professional.anios_oficio ? 'Editar' : 'Agregar'}
              </Text>
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <View style={{ paddingVertical: 12 }}>
              <View style={styles.fotosHead}>
                <Text style={styles.fotosTitulo}>Fotos de trabajos</Text>
                <TouchableOpacity onPress={agregarFotoTrabajo} disabled={subiendoFoto} activeOpacity={0.8}>
                  <Text style={styles.fotosAgregar}>{subiendoFoto ? 'Subiendo…' : '+ Agregar'}</Text>
                </TouchableOpacity>
              </View>

              {misFotos.length === 0 ? (
                <Text style={styles.fotosVacio}>
                  Si tenés fotos de trabajos, sumalas: al cliente le sirven para decidir.
                  Si no tenés, no pasa nada — con contar tu experiencia alcanza.
                </Text>
              ) : (
                <View style={styles.misFotosRow}>
                  {misFotos.map(f => (
                    <TouchableOpacity key={f.id} style={styles.miFotoWrap}
                      onLongPress={() => borrarFotoTrabajo(f)} activeOpacity={0.85}>
                      <Image source={{ uri: f.url }} style={styles.miFoto} />
                      {f.estado === 'pendiente' && (
                        <View style={styles.miFotoEstado}>
                          <Text style={styles.miFotoEstadoTxt}>en revisión</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {misFotos.length > 0 && (
                <Text style={styles.fotosPie}>Mantené apretada una foto para borrarla.</Text>
              )}
            </View>

            {/* Contar la experiencia: la alternativa a las fotos, no un extra */}
            <Modal visible={showExperiencia} transparent animationType="slide"
                   onRequestClose={() => setShowExperiencia(false)}>
              <KeyboardAvoidingView style={styles.expOverlay}
                                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.expBox}>
                  <Text style={styles.expTitulo}>Tu experiencia</Text>
                  <Text style={styles.expSub}>
                    Esto es lo que lee el cliente antes de elegirte. Vale tanto como las fotos.
                  </Text>

                  <Text style={styles.expLabel}>¿Hace cuántos años trabajás en esto?</Text>
                  <TextInput
                    style={styles.expInput}
                    value={anios}
                    onChangeText={(t) => setAnios(t.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="numeric"
                    placeholder="20"
                    placeholderTextColor="#444"
                  />

                  <Text style={styles.expLabel}>Contá en una línea qué hacés</Text>
                  <TextInput
                    style={[styles.expInput, { minHeight: 76, textAlignVertical: 'top' }]}
                    value={presentacion}
                    onChangeText={setPresentacion}
                    multiline
                    maxLength={240}
                    placeholder="Ej: Pinto casas y departamentos. Trabajo prolijo, dejo todo limpio."
                    placeholderTextColor="#444"
                  />

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    <TouchableOpacity style={styles.expCancel} onPress={() => setShowExperiencia(false)}>
                      <Text style={styles.expCancelTxt}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.expGuardar} onPress={guardarExperiencia}>
                      <Text style={styles.expGuardarTxt}>Guardar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </Modal>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cuenta</Text>

          {professional && (
            <>
              <View style={styles.row}>
                <Ionicons name="call-outline" size={18} color="#555" />
                <Text style={styles.rowText}>{professional.phone || 'Sin teléfono'}</Text>
              </View>
              {chargesInApp() && (
                <>
                  <View style={styles.rowDivider} />
                  <TouchableOpacity style={styles.row} onPress={() => setShowPayData(true)} activeOpacity={0.7}>
                    <Ionicons name="card-outline" size={18} color={payData.cbu ? '#555' : '#FFD600'} />
                    {payData.cbu ? (
                      <Text style={[styles.rowText, { flex: 1 }]}>CBU: •••• {payData.cbu.slice(-4)}</Text>
                    ) : (
                      <Text style={[styles.rowText, { flex: 1, color: '#FFD600' }]}>Completá tus datos para cobrar</Text>
                    )}
                    <Text style={{ fontSize: 11, color: '#FFD600' }}>{payData.cbu ? 'Editar' : 'Completar'}</Text>
                  </TouchableOpacity>
                  <View style={styles.rowDivider} />
                  <TouchableOpacity style={styles.row} onPress={handleEditPaymentMethod} activeOpacity={0.7}>
                    <Text style={{ fontSize: 16 }}>
                      {localPaymentMethod === 'mercadopago' ? '💳' : '🏦'}
                    </Text>
                    <Text style={[styles.rowText, { flex: 1 }]}>
                      Cobra por {localPaymentMethod === 'mercadopago' ? 'Mercado Pago' : 'CBU / CVU'}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#FFD600' }}>Cambiar</Text>
                  </TouchableOpacity>
                  <View style={styles.rowDivider} />

                  <PaymentDataModal
                    visible={showPayData}
                    professional={professional}
                    onClose={() => setShowPayData(false)}
                    onSaved={(f) => { setPayData(f); setShowPayData(false); }}
                  />
                </>
              )}
            </>
          )}

          <View style={styles.row}>
            <Ionicons name="mail-outline" size={18} color="#555" />
            <Text style={styles.rowText}>{email}</Text>
          </View>

          {/* Cambiar la contraseña — vale para las dos puntas (cliente y
              profesional) porque la cuenta es una sola. Antes no existía en
              ningún lado: el único camino era desloguearse y usar "olvidé mi
              contraseña" (Maxi, 6-ago-2026). */}
          <View style={styles.rowDivider} />
          <TouchableOpacity style={styles.row} onPress={() => setShowPassword(true)} activeOpacity={0.7}>
            <Ionicons name="lock-closed-outline" size={18} color="#555" />
            <Text style={[styles.rowText, { flex: 1 }]}>
              {tienePassword ? 'Cambiar mi contraseña' : 'Poner una contraseña'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </TouchableOpacity>

          <CambiarPasswordModal
            visible={showPassword}
            session={session}
            onClose={() => setShowPassword(false)}
          />
        </View>

        {/* Método de pago — solo para clientes (y solo si la app cobra) */}
        {!professional && chargesInApp() && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Método de pago</Text>
            <View style={styles.paymentCard}>
              <View style={styles.paymentRow}>
                <Text style={{ fontSize: 22, marginRight: 4 }}>💳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentLabel}>Mercado Pago</Text>
                  {loadingPayment ? (
                    <ActivityIndicator size="small" color="#555" style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                  ) : (
                    <Text style={[styles.paymentStatus, { color: paymentVerified ? '#4CAF50' : '#FF9800' }]}>
                      {paymentVerified ? '✓ Verificado' : 'Sin pagos registrados aún'}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.paymentBtn}
                  onPress={() => Linking.openURL('https://www.mercadopago.com.ar')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.paymentBtnText}>Gestionar</Text>
                  <Ionicons name="open-outline" size={13} color="#FFD600" />
                </TouchableOpacity>
              </View>
              {!paymentVerified && !loadingPayment && (
                <View style={styles.paymentHint}>
                  <Ionicons name="information-circle-outline" size={14} color="#555" />
                  <Text style={styles.paymentHintText}>
                    Tu método se verifica automáticamente al completar tu primer pago.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Mis tarjetas guardadas — solo clientes (y solo si la app cobra) */}
        {!professional && chargesInApp() && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mis tarjetas</Text>
            {loadingCards ? (
              <ActivityIndicator color="#FFD600" style={{ marginVertical: 10 }} />
            ) : cards.length === 0 ? (
              <Text style={styles.cardEmpty}>Guardá una tarjeta para pagar en 1 toque.</Text>
            ) : cards.map(c => (
              <View key={c.id} style={styles.savedCard}>
                <Ionicons name="card" size={20} color="#FFD600" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.savedCardBrand}>{c.brand} •••• {c.last_four}</Text>
                  {c.exp ? <Text style={styles.savedCardExp}>Vence {c.exp}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => handleDeleteCard(c)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="trash-outline" size={18} color="#ff5577" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addCardBtn} onPress={() => setShowAddCard(true)} activeOpacity={0.85}>
              <Ionicons name="add" size={18} color="#0A0A0A" />
              <Text style={styles.addCardBtnText}>Agregar tarjeta</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Info de la plataforma */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sobre BOLT</Text>
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#FFD600" />
            <Text style={styles.infoText}>Todos los pagos están protegidos por la plataforma.</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="flash-outline" size={16} color="#FFD600" />
            <Text style={styles.infoText}>Cuanto más trabajás, menos comisión pagás.</Text>
          </View>
        </View>

        {/* El panel del trabajador: uno solo, con todo adentro */}
        {professional?.verification_status === 'approved' && (
          <TouchableOpacity style={styles.panelBtn} onPress={() => setShowNegocio(true)} activeOpacity={0.8}>
            <Ionicons name="briefcase-outline" size={20} color="#FFD600" />
            <Text style={styles.panelBtnText}>Mi negocio</Text>
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

        {/* Borrar cuenta */}
        <TouchableOpacity
          style={styles.deleteAccountBtn}
          onPress={handleDeleteAccount}
          disabled={deleting}
          activeOpacity={0.8}
        >
          {deleting ? (
            <ActivityIndicator color="#888" size="small" />
          ) : (
            <>
              <Ionicons name="trash-outline" size={16} color="#888" />
              <Text style={styles.deleteAccountText}>Borrar mi cuenta</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.deleteAccountHint}>
          Se borran tu cuenta y todos tus datos. No se puede deshacer.
        </Text>

        <Text style={styles.version}>BOLT v1.0</Text>

      </ScrollView>

      <MPCardForm
        visible={showAddCard}
        mode="new"
        onClose={() => setShowAddCard(false)}
        onToken={handleCardToken}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // ─── Mi trabajo: fotos y experiencia ──────────────────────────────────────
  miTrabajoSub:   { fontSize: 12, color: '#666', marginTop: -6, marginBottom: 10, lineHeight: 17 },
  fotosHead:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  fotosTitulo:    { fontSize: 13, fontWeight: '700', color: '#F5F5F5' },
  fotosAgregar:   { fontSize: 12, fontWeight: '800', color: '#FFD600' },
  fotosVacio:     { fontSize: 12, color: '#666', lineHeight: 18 },
  misFotosRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miFotoWrap:     { width: 76, height: 76, borderRadius: 10, overflow: 'hidden', backgroundColor: '#111' },
  miFoto:         { width: '100%', height: '100%' },
  miFotoEstado:   { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#000000c0', paddingVertical: 2 },
  miFotoEstadoTxt:{ fontSize: 9, color: '#FFD600', textAlign: 'center', fontWeight: '700' },
  fotosPie:       { fontSize: 11, color: '#555', marginTop: 8 },

  expOverlay:     { flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' },
  expBox:         { backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 32 },
  expTitulo:      { fontSize: 18, fontWeight: '800', color: '#F5F5F5' },
  expSub:         { fontSize: 12.5, color: '#888', marginTop: 4, marginBottom: 16, lineHeight: 18 },
  expLabel:       { fontSize: 12, fontWeight: '700', color: '#999', marginBottom: 6, marginTop: 10 },
  expInput:       { backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#262626', borderRadius: 12,
                    padding: 12, color: '#F5F5F5', fontSize: 15 },
  expCancel:      { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1A1A1A', alignItems: 'center' },
  expCancelTxt:   { color: '#888', fontWeight: '700', fontSize: 14 },
  expGuardar:     { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: '#FFD600', alignItems: 'center' },
  expGuardarTxt:  { color: '#0A0A0A', fontWeight: '800', fontSize: 14 },

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

  // Tarjetas guardadas
  cardEmpty: { color: '#666', fontSize: 13, marginBottom: 10 },
  savedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1f1f1f',
    padding: 14, marginBottom: 8,
  },
  savedCardBrand: { fontSize: 14, fontWeight: '700', color: '#F5F5F5', textTransform: 'capitalize' },
  savedCardExp:   { fontSize: 12, color: '#666', marginTop: 2 },
  addCardBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FFD600', borderRadius: 12, paddingVertical: 13, marginTop: 4,
  },
  addCardBtnText: { color: '#0A0A0A', fontSize: 14, fontWeight: '900' },

  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatarWrapper: { alignItems: 'center', marginBottom: 14 },
  avatarTap: { width: 88, height: 88 },
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
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  changePhotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: '#FFD60030',
    backgroundColor: 'rgba(255,214,0,0.06)',
  },
  changePhotoBtnText: { fontSize: 12, color: '#FFD600', fontWeight: '700' },
  userName: { fontSize: 22, fontWeight: '900', color: '#F5F5F5', marginBottom: 4 },
  userEmail: { fontSize: 14, color: '#555', marginBottom: 12 },
  levelBadge: {
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 5,
  },
  levelText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  estudiosBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, borderWidth: 1, borderColor: '#FFD60040',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4,
    backgroundColor: 'rgba(255,214,0,0.08)',
  },
  estudiosBadgeText: { fontSize: 12, color: '#FFD600', fontWeight: '700' },

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

  paymentCard: {
    backgroundColor: '#111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, gap: 12,
  },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  paymentLabel: { fontSize: 15, fontWeight: '700', color: '#F5F5F5', marginBottom: 3 },
  paymentStatus: { fontSize: 13, fontWeight: '600' },
  paymentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: '#FFD60040',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  paymentBtnText: { fontSize: 13, color: '#FFD600', fontWeight: '700' },
  paymentHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    borderTopWidth: 1, borderTopColor: '#1E1E1E', paddingTop: 10,
  },
  paymentHintText: { flex: 1, fontSize: 12, color: '#555', lineHeight: 17 },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,68,68,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.25)',
    borderRadius: 16, paddingVertical: 16,
    marginBottom: 20,
  },
  signOutText: { color: '#ff4444', fontSize: 15, fontWeight: '700' },

  deleteAccountBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, marginBottom: 6,
  },
  deleteAccountText: { color: '#888', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  deleteAccountHint: { textAlign: 'center', fontSize: 11, color: '#3a3a3a', marginBottom: 20, lineHeight: 16 },

  version: { textAlign: 'center', fontSize: 12, color: '#2a2a2a' },
});

export default ProfileScreen;

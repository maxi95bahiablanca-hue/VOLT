import React, { useState, useEffect, useRef } from 'react';
import volt from '../utils/voltVoice';
import { isDemoMode } from '../demo/demoMode';
import { DEMO_QUOTE_JOBS } from '../demo/demoData';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, Alert, Platform, Image, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system 19 (SDK 54): readAsStringAsync y EncodingType se mudaron a
// /legacy. Importados de la raiz TIRAN ERROR en runtime, no avisan en el build.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import { chargesInApp } from '../config/monetization';
import professionalService from '../services/professionalService';
import rescueService from '../services/rescueService';
import { conTiempo } from '../utils/conTiempo';

// ─── Overlay de búsqueda animado ─────────────────────────────────────────────
const SearchingOverlay = ({ foundCount }) => {
  const [step, setStep] = useState(1);
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animRing = (anim, delay) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0,    useNativeDriver: true }),
        Animated.delay(Math.max(0, 1800 * 2 - delay)),
      ]));
    animRing(ring1, 0).start();
    animRing(ring2, 700).start();
    animRing(ring3, 1400).start();

    const t1 = setTimeout(() => setStep(2), 1800);
    const t2 = setTimeout(() => setStep(s => s < 3 ? 3 : s), 3600);
    const t3 = setTimeout(() => setStep(s => s < 4 ? 4 : s), 5400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Avanzar a paso 3 ni bien llega el count real
  useEffect(() => {
    if (foundCount > 0 && step === 2) setStep(3);
  }, [foundCount, step]);

  // Avanzar a paso 4 un momento después de mostrar el count
  useEffect(() => {
    if (step !== 3) return;
    const t = setTimeout(() => setStep(4), 1600);
    return () => clearTimeout(t);
  }, [step]);

  const count    = foundCount > 0 ? foundCount : '...';
  const rScale   = (r) => r.interpolate({ inputRange: [0, 1], outputRange: [1, 5] });
  const rOpacity = (r) => r.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.28, 0] });

  const TEXTS = [
    '',
    volt.searchStep1,
    volt.searchStep2,
    volt.searchStep3(foundCount > 0 ? foundCount : 0),
    volt.searchStep4,
  ];

  return (
    <View style={searchStyles.overlay}>
      {/* Radar */}
      <View style={searchStyles.radarWrap}>
        {[ring1, ring2, ring3].map((r, i) => (
          <Animated.View key={i} pointerEvents="none" style={[
            searchStyles.ring,
            { transform: [{ scale: rScale(r) }], opacity: rOpacity(r) },
          ]} />
        ))}
        <View style={searchStyles.centerCircle}>
          <Ionicons name="flash" size={38} color="#FFD600" />
        </View>
      </View>

      {/* Indicador de paso */}
      <View style={searchStyles.dotsRow}>
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={[searchStyles.dot, step >= i && searchStyles.dotActive]} />
        ))}
      </View>

      {/* Texto del paso */}
      <Text style={searchStyles.stepText}>{TEXTS[step]}</Text>

      {/* Badge de count (paso 3) */}
      {step === 3 && foundCount > 0 && (
        <View style={searchStyles.countBadge}>
          <Text style={searchStyles.countNum}>{foundCount}</Text>
          <Text style={searchStyles.countLbl}>
            {foundCount === 1 ? 'profesional notificado' : 'profesionales notificados'}
          </Text>
        </View>
      )}

      {/* Waiting indicator (paso 4) */}
      {step === 4 && (
        <View style={searchStyles.waitingRow}>
          <ActivityIndicator color="#FFD600" size="small" />
          <Text style={searchStyles.waitingText}>Red activada · esperando respuesta</Text>
        </View>
      )}

      <Text style={searchStyles.hint}>
        Los primeros en responder son los que llegan antes
      </Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const JobRequestScreen = ({ worker, profession, clientId, userLocation, initialNotes, initialPhotos, onQuoteGroupCreated, onBack }) => {
  const [notes, setNotes]     = useState(initialNotes || '');
  const [loading, setLoading] = useState(false);
  const [notesTouched, setNotesTouched] = useState(false);
  // El WhatsApp del cliente. Se pregunta UNA vez y queda en la cuenta: es por
  // donde le vamos a avisar que el profesional salió y mandarle el código.
  // Hasta hoy la app no lo juntaba de nadie (0 de 29 usuarios lo tenían; los 4
  // que sí venían de la web, que sí lo pedía).
  const [tel, setTel] = useState('');
  const [telGuardado, setTelGuardado] = useState(true);   // hasta saber, no molestamos
  const [foundCount, setFoundCount]     = useState(0);

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => {
        const guardado = data?.user?.user_metadata?.telefono || '';
        setTel(guardado);
        setTelGuardado(!!guardado);
      })
      .catch(() => setTelGuardado(false));
  }, []);

  // Foto opcional del problema
  // La foto que se elige acá. Las que ya vienen del asistente (initialPhotos)
  // se suman aparte: el cliente ya se tomó el trabajo de sacarlas.
  const [problemPhoto, setProblemPhoto] = useState(null); // { uri, ext }
  const fotosAsistente = Array.isArray(initialPhotos) ? initialPhotos : [];

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
  const visitPrice = worker?.min_price ?? 30000;

  // Guarda el WhatsApp en la cuenta. Si falla no frena el pedido: el trabajo
  // vale más que el dato, y el dato se vuelve a pedir la próxima.
  const guardarTelefono = async () => {
    const limpio = (tel || '').replace(/\D/g, '');
    if (limpio.length < 8 || telGuardado) return;
    try {
      await supabase.auth.updateUser({ data: { telefono: limpio } });
      setTelGuardado(true);
    } catch {}
  };

  const handleConfirm = async () => {
    if (notes.trim().length < 10) {
      setNotesTouched(true);
      return;
    }
    guardarTelefono();

    // Bloquear si no hay ubicación — los campos client_lat/lng son NOT NULL en la DB
    if (!userLocation?.latitude || !userLocation?.longitude) {
      Alert.alert(
        'Ubicación no disponible',
        'Necesitamos tu ubicación para enviar la solicitud. Activá el GPS y volvé a intentar.'
      );
      return;
    }

    // ── DEMO MODE ────────────────────────────────────────────────────────────
    if (isDemoMode()) {
      setLoading(true);
      setTimeout(() => setFoundCount(2), 1500);
      setTimeout(() => {
        onQuoteGroupCreated('demo-quote-1', DEMO_QUOTE_JOBS);
      }, 4500);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    setLoading(true);
    try {
      let workers = worker ? [worker] : [];

      // Con tope de tiempo: el `.catch` atrapa errores pero NO un colgado, y
      // ésta es la pantalla que genera la venta — con red mala el cliente
      // quedaba en "Buscando..." para siempre. Si no vuelve en 15 s, sigue como
      // "no encontré a nadie" y entra el circuito de rescate de abajo.
      const nearby = await conTiempo(
        professionalService.getNearbyWorkers(
          profession.id,
          userLocation.latitude,
          userLocation.longitude,
          8
        ).catch(() => []),
        15000, []
      );

      if (worker) {
        const others = nearby.filter(w => w.id !== worker.id && w.user_id !== clientId).slice(0, 2);
        workers = [worker, ...others];
      } else {
        workers = nearby.filter(w => w.user_id !== clientId).slice(0, 3);
      }

      // No hay nadie disponible: en vez de mandarlo de vuelta con las manos
      // vacías, el pedido pasa a una persona del equipo.
      if (workers.length === 0) {
        const datos = {
          oficio:  profession?.name,
          notas:   notes.trim(),
          address: address.trim() || 'Ubicación GPS',
          fotos:   [],   // todavía no se subieron: van en el mensaje del cliente si las mandó
        };
        const rescate = await rescueService.registrar({
          clientId,
          professionId: profession?.id,
          oficio:       profession?.name,
          motivo:       'sin_profesionales',
          notas:        datos.notas,
          address:      datos.address,
          lat:          userLocation?.latitude,
          lng:          userLocation?.longitude,
          fotos:        [],
        });
        setLoading(false);
        Alert.alert(
          'No hay nadie libre ahora',
          'Tu pedido pasó a una persona del equipo, que te va a conseguir un profesional a mano. Si querés, escribinos por WhatsApp y lo resolvemos ahora mismo.',
          [
            { text: 'Ahora no', style: 'cancel' },
            { text: 'Escribir por WhatsApp', onPress: () => rescueService.abrirWhatsApp(datos, rescate?.id) },
          ],
        );
        return;
      }
      setFoundCount(workers.length);

      // Subir las fotos del problema: las que pidió el asistente y la que se
      // haya elegido en esta pantalla. Si alguna falla, seguimos con las demás:
      // una foto nunca puede frenar un pedido.
      const subirFoto = async (f, i) => {
        try {
          const ext  = f.ext || 'jpg';
          const path = `problem-photos/${clientId}/${Date.now()}-${i}.${ext}`;
          const base64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
          const binary = atob(base64);
          const bytes  = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
          const { error: upErr } = await supabase.storage
            .from('avatars')
            .upload(path, bytes, { upsert: true, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
          // 🔴 Este `return null` mudo escondió durante meses que la política
          // del bucket rechazaba TODAS las fotos del problema: pedía que la
          // primera carpeta fuera el id del usuario y acá es "problem-photos"
          // (migración 046). El pedido salía sin fotos y el profesional
          // llegaba a ciegas. La foto sigue sin frenar el pedido, pero ahora
          // por lo menos queda escrito por qué falló.
          if (upErr) { console.error('[foto del problema] no se pudo subir:', upErr.message, path); return null; }
          return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        } catch (e) { console.error('[foto del problema] error inesperado:', e?.message); return null; }
      };

      const aSubir = [...fotosAsistente, ...(problemPhoto?.uri ? [problemPhoto] : [])];
      // 🔴 Una foto nunca puede frenar un pedido (auditoría 23-ago): cada subida
      //    con tope de 20 s; si vence, ese pedido sale sin esa foto en vez de
      //    dejar "Buscando profesionales…" clavado para siempre.
      const problemPhotos = (await Promise.all(aSubir.map(f => conTiempo(subirFoto(f), 20000, null)))).filter(Boolean);
      const problemPhotoUrl = problemPhotos[0] ?? null;

      // Crear grupo de cotización (un job por trabajador), con tope: en Android el
      // fetch de supabase-js no corta solo, así que sin esto el overlay se colgaba.
      const resultado = await conTiempo(jobService.createQuoteGroup({
        clientId,
        workers,
        professionId:    profession.id,
        clientLat:       userLocation?.latitude,
        clientLng:       userLocation?.longitude,
        address:         address.trim() || 'Ubicación GPS',
        notes:           notes.trim(),
        problemPhotoUrl,
        problemPhotos,
      }), 25000, null);
      if (!resultado) throw new Error('La búsqueda tardó demasiado. Fijate tu conexión y probá de nuevo.');
      const { quoteGroupId, jobs } = resultado;

      // Navegar ANTES de las notificaciones — las notifs no deben bloquear el flujo
      onQuoteGroupCreated(quoteGroupId, jobs);

      // Notificar (best-effort, fallo silencioso)
      Promise.all(
        jobs.map(job => {
          const w = workers.find(w => w.id === job.professional_id);
          if (!w?.user_id) return Promise.resolve();
          return notificationService.sendToUser(w.user_id, {
            title: '⚡ Nueva solicitud de trabajo',
            body:  chargesInApp()
              ? `${profession?.name || 'Servicio'} — $${(w.min_price ?? 30000).toLocaleString('es-AR')} visita. Tenés 3 minutos para responder.`
              : `${profession?.name || 'Servicio'} cerca tuyo. Tenés 3 minutos para responder.`,
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <SearchingOverlay foundCount={foundCount} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
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
              <Ionicons name={editingAddress ? 'checkmark' : 'pencil-outline'} size={15} color="#8A8A8A" />
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
            <Text style={styles.notesSectionTitle}>Describí el problema <Text style={{ color: '#E5484D' }}>*</Text></Text>
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

          {/* Sólo la primera vez. Después queda en la cuenta y no se vuelve a
              preguntar: es un dato que se guarda, no un formulario que se
              repite en cada pedido. */}
          {!telGuardado && (
            <View style={styles.telWrap}>
              <Text style={styles.notesSectionTitle}>Tu WhatsApp</Text>
              <Text style={styles.notesSectionHint}>
                Te avisamos por acá cuando el profesional salga para tu casa, y te mandamos el
                código para la puerta. No se lo damos a nadie más.
              </Text>
              <TextInput
                style={styles.notesInput}
                placeholder="291 555 5555"
                placeholderTextColor="#444"
                value={tel}
                onChangeText={setTel}
                keyboardType="phone-pad"
                maxLength={20}
              />
            </View>
          )}

          {/* Fotos que ya mandó en el cuestionario: se muestran para que no las
              vuelva a sacar. No se pueden borrar acá, se manda lo que eligió. */}
          {fotosAsistente.length > 0 && (
            <View style={styles.fotosPrevias}>
              <Text style={styles.fotosPreviasTxt}>
                {fotosAsistente.length === 1 ? 'Ya mandaste 1 foto' : `Ya mandaste ${fotosAsistente.length} fotos`}
              </Text>
              <View style={styles.fotosPreviasRow}>
                {fotosAsistente.map((f, i) => (
                  <Image key={i} source={{ uri: f.uri }} style={styles.fotoPrevia} />
                ))}
              </View>
            </View>
          )}

          {/* Foto del problema (opcional) */}
          {problemPhoto ? (
            <View style={styles.photoPreview}>
              <Image source={{ uri: problemPhoto.uri }} style={styles.photoPreviewImg} />
              <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => setProblemPhoto(null)}>
                <Ionicons name="close-circle" size={22} color="#E5484D" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoChangeBtn} onPress={pickProblemPhoto}>
                <Ionicons name="camera-outline" size={13} color="#8A8A8A" />
                <Text style={styles.photoChangeBtnText}>Cambiar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoPickBtn} onPress={pickProblemPhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={18} color="#8A8A8A" />
              <Text style={styles.photoPickBtnText}>Agregar foto del problema <Text style={{ color: '#5C5C5C' }}>(opcional)</Text></Text>
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

        {/* Cobro de visita — solo en modo comisión */}
        {chargesInApp() && (
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
              <Ionicons name="checkmark-circle" size={16} color="#FFD600" />
              <Text style={styles.visitDeductText}>
                Si se realiza el trabajo, la visita <Text style={{ color: '#FFD600', fontWeight: '600' }}>se descuenta del total</Text>. Solo pagás el trabajo.
              </Text>
            </View>
            <View style={styles.visitDeductRow}>
              <Ionicons name="document-text-outline" size={16} color="#8A8A8A" />
              <Text style={styles.visitDeductText}>
                El profesional te enviará un presupuesto con los materiales necesarios cuando llegue.
              </Text>
            </View>
          </View>
        )}

        {/* Info seguridad / pago */}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color="#FFD600" />
          <Text style={styles.infoText}>
            {chargesInApp()
              ? 'Tu pago está protegido. El profesional no recibe el dinero hasta que confirmes que el trabajo está hecho.'
              : 'Profesionales revisados uno por uno por el equipo de BOLT. El precio lo acordás directo con el profesional y el pago es entre ustedes — BOLT te conecta.'}
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
            <ActivityIndicator color="#0D0D0D" />
          ) : (
            <>
              <Ionicons name="flash" size={20} color="#0D0D0D" />
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
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scroll: { padding: 20, paddingBottom: 48 },

  workerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 16,
  },
  workerAvatar: {
    width: 56, height: 56, borderRadius: 999,
    backgroundColor: '#1A1A1A', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  workerAvatarImg: { width: '100%', height: '100%' },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  workerProfession: { fontSize: 14, color: '#8A8A8A', marginTop: 2, marginBottom: 6 },
  workerStars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  workerRating: { fontSize: 14, color: '#5C5C5C', marginLeft: 4 },
  distBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#1A1A1A', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  distText: { color: '#FFD600', fontSize: 14, fontWeight: '700' },

  addressSection: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14, marginBottom: 16,
  },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  addressLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: '#8A8A8A' },
  addressEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  addressEditText: { fontSize: 14, color: '#8A8A8A' },
  addressText: { fontSize: 16, color: '#FFFFFF', lineHeight: 20 },
  addressInput: {
    backgroundColor: '#161616', borderRadius: 20, borderWidth: 1, borderColor: '#FFD600',
    color: '#FFFFFF', fontSize: 16, padding: 12,
  },
  addressHint: { fontSize: 12, color: '#5C5C5C', marginTop: 6, lineHeight: 16 },

  multiNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#161616', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a1a',
    padding: 14, marginBottom: 20,
  },
  multiNoticeText: { flex: 1, fontSize: 14, color: '#8A8A8A', lineHeight: 19 },

  divider: { height: 1, backgroundColor: '#1a1a1a', marginVertical: 10 },

  notesSection: {
    backgroundColor: '#161616', borderRadius: 20,
    borderWidth: 1.5, borderColor: '#2a2a1a',
    padding: 16, marginBottom: 16,
  },
  notesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  notesSectionTitle:  { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  notesSectionHint:   { fontSize: 14, color: '#5C5C5C', lineHeight: 17, marginBottom: 12 },
  notesInput: {
    backgroundColor: '#161616', borderRadius: 20,
    color: '#FFFFFF', fontSize: 16, padding: 14,
    minHeight: 100,
  },
  // El campo ya no tiene borde (el fondo lo define): para marcar el error hay
  // que ponerle uno, si no el estado de error no se ve por ningún lado.
  notesInputError: { borderWidth: 1.5, borderColor: '#E5484D' },
  telWrap: { marginTop: 24 },
  notesError: { fontSize: 14, color: '#E5484D', marginTop: 6 },

  visitSection: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 20, gap: 4,
  },
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  visitLabel: { fontSize: 16, color: '#FFFFFF', fontWeight: '700' },
  visitSub:   { fontSize: 14, color: '#5C5C5C', marginTop: 2 },
  visitVal:   { fontSize: 22, color: '#FFD600', fontWeight: '700' },
  visitDeductRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  visitDeductText: { flex: 1, fontSize: 14, color: '#5C5C5C', lineHeight: 18 },

  infoBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#161616', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a1a',
    padding: 14, marginBottom: 24,
  },
  infoText: { flex: 1, fontSize: 14, color: '#8A8A8A', lineHeight: 19 },

  // Foto del problema
  photoPickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 999, borderStyle: 'dashed', backgroundColor: '#0D0D0D',
  },
  photoPickBtnText: { fontSize: 14, color: '#8A8A8A' },

  fotosPrevias: { marginTop: 12, marginBottom: 4 },
  fotosPreviasTxt: { fontSize: 14, color: '#FFD600', fontWeight: '700', marginBottom: 8 },
  fotosPreviasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fotoPrevia: { width: 64, height: 64, borderRadius: 20, },
  photoPreview: {
    marginTop: 12, borderRadius: 20, overflow: 'hidden',
    position: 'relative',
  },
  photoPreviewImg: { width: '100%', height: 160, borderRadius: 20 },
  photoRemoveBtn: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: '#161616', borderRadius: 999,
  },
  photoChangeBtn: {
    position: 'absolute', bottom: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  photoChangeBtnText: { fontSize: 12, color: '#8A8A8A' },

  autoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20,
    borderWidth: 1.5, borderColor: '#2a2a1a',
    padding: 16, marginBottom: 16,
  },
  autoIcon: {
    width: 56, height: 56, borderRadius: 999,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  autoTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  autoSub:   { fontSize: 14, color: '#8A8A8A', lineHeight: 17 },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#FFD600',
    borderRadius: 999, paddingVertical: 18, marginBottom: 12,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: '#0D0D0D', fontSize: 17, fontWeight: '700' },
  cancelNote: { textAlign: 'center', fontSize: 14, color: '#444' },
});

// ─── Estilos del overlay de búsqueda ─────────────────────────────────────────
const searchStyles = StyleSheet.create({
  overlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 32, gap: 28,
  },

  radarWrap: {
    width: 160, height: 160,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 100, height: 100, borderRadius: 999,
    borderWidth: 1.5, borderColor: '#FFD600',
  },
  centerCircle: {
    width: 72, height: 72, borderRadius: 999,
    backgroundColor: '#1A1A00',
    borderWidth: 2.5, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 12,
  },

  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: {
    width: 6, height: 6, borderRadius: 999, backgroundColor: '#222',
  },
  dotActive: { backgroundColor: '#FFD600' },

  stepText: {
    fontSize: 18, fontWeight: '700', color: '#FFFFFF',
    textAlign: 'center', lineHeight: 26,
  },

  countBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(255,214,0,0.25)',
    borderRadius: 999, paddingHorizontal: 28, paddingVertical: 16,
  },
  countNum: { fontSize: 48, fontWeight: '700', color: '#FFD600', lineHeight: 52 },
  countLbl: { fontSize: 14, color: '#8A8A8A', fontWeight: '600', marginTop: 4 },

  waitingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,214,0,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.15)',
    borderRadius: 20, paddingHorizontal: 20, paddingVertical: 12,
  },
  waitingText: { fontSize: 16, color: '#8A8A8A', fontWeight: '600' },

  hint: {
    fontSize: 14, color: '#5C5C5C', textAlign: 'center',
    position: 'absolute', bottom: 48, paddingHorizontal: 24,
  },
});

export default JobRequestScreen;

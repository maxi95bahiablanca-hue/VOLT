import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Platform, Image, Linking, Alert, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system 19 (SDK 54): readAsStringAsync y EncodingType se mudaron a
// /legacy. Importados de la raiz TIRAN ERROR en runtime, no avisan en el build.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import { showSuccess, showError } from '../utils/toast';


// ─────────────────────────────────────────────────────────────────────────────
// MI EMPRESA. Acá el profesional carga la identidad con la que sale su
// presupuesto: nombre comercial, logo, color, contacto y datos fiscales.
// Los campos son los de la migración 055 sobre `professionals`.
//
// POR QUÉ HAY UNA VISTA PREVIA. "Tu presupuesto sale con tu logo y tus
// colores" es intangible hasta que se ve. La tarjeta blanca de arriba es el
// encabezado real del documento (web/p/index.html) y se actualiza mientras
// escribe: es lo que hace que valga la pena cargar estos datos.
//
// 🔴 NO HAY PLANES. Maxi (6-ago-2026): "no hagas plan pro, que sea TODO
// GRATIS, y cuando salga la app a cobrar lo vemos, mientras tanto que
// disfruten del potencial de la app gratis". Nada acá está detrás de un pago
// ni insinúa que lo vaya a estar. La columna `professionals.plan` sigue
// existiendo en la base, pero ya no la mira nadie.
// ─────────────────────────────────────────────────────────────────────────────

// Ocho colores que se leen bien impresos sobre papel blanco. No hay picker
// libre a propósito: un color mal elegido arruina el documento y el profesional
// no tiene por qué saber de contraste.
const COLORES = [
  '#1E4E8C', // azul
  '#0F7B5F', // verde
  '#B3402F', // ladrillo
  '#5B3E8E', // violeta
  '#0D0D0D', // negro
  '#C9821A', // mostaza
  '#2C6E7F', // petróleo
  '#8A2846', // bordó
];

// Mismo criterio que la web (textoSobre): sobre un acento claro va tinta
// oscura, sobre uno oscuro va blanco.
const textoSobre = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return '#0D0D0D';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0D0D0D' : '#FFFFFF';
};

const nombreReal = (p) =>
  `${p?.first_name || ''} ${p?.last_name || ''}`.trim();

const MiEmpresaScreen = ({ professional, onClose, onGuardado }) => {
  const [nombre, setNombre]       = useState(professional?.nombre_comercial || '');
  const [logoUrl, setLogoUrl]     = useState(professional?.logo_url || '');
  const [color, setColor]         = useState(professional?.color_marca || '');
  const [telefono, setTelefono]   = useState(professional?.phone || '');
  const [instagram, setInstagram] = useState(professional?.instagram || '');
  const [web, setWeb]             = useState(professional?.web || '');
  const [fiscales, setFiscales]   = useState(professional?.datos_fiscales || '');

  const [saving, setSaving]       = useState(false);
  const [subiendo, setSubiendo]   = useState(false);

  // El teléfono NO bloquea el guardado.
  //
  // Lo tenía como obligatorio y estaba mal: el profesional entra a poner su logo
  // y se encontraba con que no podía guardar nada hasta cargar un número. Si le
  // falta, se le avisa en el momento —el cliente no lo va a poder llamar— pero
  // nunca se le traba lo que vino a hacer.
  const telDigitos = telefono.replace(/\D/g, '');
  const telCargado = telDigitos.length >= 8;
  const valid = true;

  // ─── Vista previa ─────────────────────────────────────────────────────────
  // El color propio pinta siempre: no hay plan que lo condicione.
  const visible = nombre.trim() || nombreReal(professional) || 'Tu empresa';
  const acento  = color || '#FFD600';
  const sub = [
    telefono.trim(),
    instagram.trim() ? `@${instagram.trim().replace(/^@/, '')}` : '',
    web.trim().replace(/^https?:\/\//, ''),
  ].filter(Boolean).join('  ·  ');

  // ─── Logo ─────────────────────────────────────────────────────────────────
  const subirLogo = async (file) => {
    setSubiendo(true);
    try {
      const ext    = file.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      // 🔴 La RLS del bucket avatars (046) sólo permite escribir en una carpeta
      //    cuyo nombre sea el uid (primera carpeta = auth.uid()). El path viejo
      //    'logos/<id>' la violaba y el logo NUNCA subía (auditoría 23-ago).
      const path   = `${professional.user_id}/logo.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(path, bytes, { upsert: true, contentType: `image/${ext}` });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      // El path es siempre el mismo (upsert), así que sin esto el celular y el
      // navegador del cliente seguirían mostrando el logo viejo del caché.
      setLogoUrl(`${data.publicUrl}?v=${Date.now()}`);
      showSuccess('Tocá Guardar para que salga en tus presupuestos.', 'Logo cargado');
    } catch {
      showError('Probá de nuevo en un momento.', 'No se pudo subir el logo');
    } finally {
      setSubiendo(false);
    }
  };

  const elegirLogo = () => {
    Alert.alert('Logo de tu empresa', '', [
      { text: 'Galería', onPress: async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
        const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
        if (!r.canceled) subirLogo(r.assets[0]);
      }},
      { text: 'Cámara', onPress: async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.9 });
        if (!r.canceled) subirLogo(r.assets[0]);
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  // ─── Guardar ──────────────────────────────────────────────────────────────
  const guardar = async () => {
    setSaving(true);
    try {
      const fields = {
        nombre_comercial: nombre.trim() || null,
        logo_url:         logoUrl || null,
        color_marca:      color || null,
        phone:            telefono.trim(),
        instagram:        instagram.trim().replace(/^@/, '') || null,
        web:              web.trim() || null,
        datos_fiscales:   fiscales.trim() || null,
      };
      const { error } = await supabase
        .from('professionals')
        .update(fields)
        .eq('id', professional.id);
      if (error) throw error;
      if (telCargado) {
        showSuccess('Tus presupuestos ya salen con estos datos.', '¡Listo!');
      } else {
        // Se guardó igual. Sólo se avisa lo que se pierde, sin trabar nada.
        showSuccess('Te falta el teléfono: sin él, el cliente no puede llamarte desde el presupuesto.', 'Guardado');
      }
      onGuardado?.(fields);
    } catch (e) {
      showError('Probá de nuevo en un momento.', 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mi empresa</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* ─── Vista previa en vivo ──────────────────────────────────── */}
          <Text style={styles.previewCaption}>Así ve tu presupuesto el cliente</Text>
          <View style={styles.preview}>
            <View style={[styles.previewBar, { backgroundColor: acento }]} />
            <View style={styles.previewBody}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.previewLogo} resizeMode="contain" />
              ) : (
                <View style={[styles.previewIni, { backgroundColor: acento }]}>
                  <Text style={[styles.previewIniText, { color: textoSobre(acento) }]}>
                    {(visible[0] || '·').toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.previewNombre} numberOfLines={2}>{visible}</Text>
                {!!sub && <Text style={styles.previewSub} numberOfLines={2}>{sub}</Text>}
              </View>
              <View>
                <Text style={styles.previewRot}>PRESUPUESTO</Text>
                <Text style={styles.previewNum}>N° 12</Text>
              </View>
            </View>
            {!!fiscales.trim() && (
              <Text style={styles.previewFiscales} numberOfLines={2}>{fiscales.trim()}</Text>
            )}
            {/* La línea de BOLT queda para todos. No es una limitación del plan
                gratis —ya no hay planes—: es lo único que BOLT recibe a cambio,
                y es cómo lo conocen otros profesionales. Cada presupuesto que
                sale es un aviso que ve un cliente real, en el momento en que
                está por gastar plata en un oficio. */}
            <Text style={styles.previewBolt}>Presupuesto hecho con BOLT</Text>
          </View>

          {/* ─── Datos ─────────────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.label}>Nombre comercial</Text>
            <TextInput
              style={styles.input}
              value={nombre}
              onChangeText={setNombre}
              placeholder={nombreReal(professional) || 'Tu nombre'}
              placeholderTextColor="#5C5C5C"
            />
            <Text style={styles.hint}>
              Si lo dejás vacío, firmamos con {nombreReal(professional) || 'tu nombre'}.
            </Text>

            <Text style={styles.label}>Logo</Text>
            <View style={styles.logoRow}>
              <TouchableOpacity
                style={styles.logoBox}
                onPress={elegirLogo}
                disabled={subiendo}
                activeOpacity={0.85}
              >
                {subiendo ? (
                  <ActivityIndicator color="#FFD600" />
                ) : logoUrl ? (
                  <Image source={{ uri: logoUrl }} style={styles.logoImg} resizeMode="contain" />
                ) : (
                  <Ionicons name="image-outline" size={26} color="#5C5C5C" />
                )}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <TouchableOpacity style={styles.ghostBtn} onPress={elegirLogo} disabled={subiendo} activeOpacity={0.8}>
                  <Ionicons name="cloud-upload-outline" size={17} color="#FFD600" />
                  <Text style={styles.ghostBtnText}>{logoUrl ? 'Cambiar logo' : 'Subir logo'}</Text>
                </TouchableOpacity>
                {!!logoUrl && (
                  <TouchableOpacity style={styles.quitarBtn} onPress={() => setLogoUrl('')} activeOpacity={0.7}>
                    <Text style={styles.quitarText}>Sacar logo</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <Text style={styles.label}>Color de tu marca</Text>
            <View style={styles.colores}>
              {COLORES.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.color,
                    { backgroundColor: c },
                    color === c && styles.colorOn,
                  ]}
                  onPress={() => setColor(c)}
                  activeOpacity={0.8}
                />
              ))}
            </View>
            <Text style={styles.hint}>Se usa como color del documento.</Text>

            <Text style={styles.label}>Teléfono de contacto</Text>
            <TextInput
              style={styles.input}
              value={telefono}
              onChangeText={setTelefono}
              placeholder="291 419-9938"
              placeholderTextColor="#5C5C5C"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>Instagram (opcional)</Text>
            <TextInput
              style={styles.input}
              value={instagram}
              onChangeText={setInstagram}
              placeholder="tuempresa"
              placeholderTextColor="#5C5C5C"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Web (opcional)</Text>
            <TextInput
              style={styles.input}
              value={web}
              onChangeText={setWeb}
              placeholder="tuempresa.com.ar"
              placeholderTextColor="#5C5C5C"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={styles.label}>Datos fiscales (opcional)</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={fiscales}
              onChangeText={setFiscales}
              placeholder="CUIT 20-12345678-9 · Monotributo"
              placeholderTextColor="#5C5C5C"
              multiline
            />
            <Text style={styles.hint}>Van al pie del presupuesto, en letra chica.</Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, (!valid || saving) && styles.primaryBtnOff]}
            onPress={guardar}
            disabled={!valid || saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#0D0D0D" />
              : <Text style={styles.primaryBtnText}>Guardar</Text>}
          </TouchableOpacity>

          {/* ─── Todo gratis ───────────────────────────────────────────────
              Maxi (6-ago-2026): "no hagas plan pro, que sea TODO GRATIS, y
              cuando salga la app a cobrar lo vemos, mientras tanto que
              disfruten del potencial de la app gratis".

              Coincide con el momento: con un puñado de profesionales, cobrar
              $3.000 no mueve nada y sí frena la adopción. Acá no queda ninguna
              función escondida detrás de un pago, ni un cartel que insinúe que
              la va a haber. */}
          <View style={styles.gratisCard}>
            <Ionicons name="sparkles" size={18} color="#FFD600" />
            <Text style={styles.gratisText}>
              Todo esto es gratis. Tu presupuesto sale con tu logo, tus colores y tus datos.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },

  content: { padding: 16, paddingBottom: 40 },

  // ── Vista previa (papel blanco) ─────────────────────────────────────────
  previewCaption: { color: '#5C5C5C', fontSize: 12, fontWeight: '600',
                    textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 8 },
  preview: {
    backgroundColor: '#FFFFFF', borderRadius: 20, overflow: 'hidden', marginBottom: 18,
  },
  previewBar:  { height: 6, width: '100%' },
  previewBody: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  previewLogo: { width: 44, height: 44, borderRadius: 20, backgroundColor: '#fff' },
  previewIni:  { width: 44, height: 44, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  previewIniText: { fontSize: 21, fontWeight: '700' },
  previewNombre: { color: '#111417', fontSize: 16, fontWeight: '700' },
  previewSub:    { color: '#6b7280', fontSize: 12, fontWeight: '600', marginTop: 2 },
  previewRot:    { color: '#9aa1ab', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  previewNum:    { color: '#111417', fontSize: 16, fontWeight: '700' },
  previewFiscales: { color: '#6b7280', fontSize: 12, paddingHorizontal: 14, paddingBottom: 10 },
  previewBolt: {
    color: '#9aa1ab', fontSize: 12, fontWeight: '700', textAlign: 'center',
    borderTopWidth: 1, borderTopColor: '#eceff3', paddingVertical: 8,
  },

  // ── Formulario ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 10,
  },
  label: { color: '#ccc', fontSize: 14, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: '#161616', borderRadius: 20, color: '#fff', fontSize: 16, padding: 14, marginBottom: 14,
  },
  inputMulti: { minHeight: 76, textAlignVertical: 'top' },
  hint: { color: '#5C5C5C', fontSize: 12, marginTop: -8, marginBottom: 12, lineHeight: 16 },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  logoBox: {
    width: 74, height: 74, borderRadius: 20, backgroundColor: '#0D0D0D',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 999, paddingVertical: 13,
  },
  ghostBtnText: { color: '#FFD600', fontSize: 16, fontWeight: '600' },
  quitarBtn:  { alignItems: 'center', paddingVertical: 9 },
  quitarText: { color: '#8A8A8A', fontSize: 14, fontWeight: '700' },

  colores: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14, marginTop: 2 },
  color: { width: 38, height: 38, borderRadius: 999, },
  colorOn: { borderColor: '#FFD600', borderWidth: 3 },

  primaryBtn: {
    backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 18,
    alignItems: 'center', marginTop: 12,
  },
  primaryBtnOff:  { opacity: 0.4 },
  primaryBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  // ── Todo gratis (ya no hay planes) ──────────────────────────────────────
  gratisCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: 20, borderWidth: 1, borderColor: '#FFD60033',
    padding: 14, marginTop: 22,
  },
  gratisText: { flex: 1, color: '#999', fontSize: 14, fontWeight: '700', lineHeight: 18 },
});

export default MiEmpresaScreen;

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, ScrollView, Linking, Alert, AppState, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import professionalService from '../services/professionalService';
import { tocaOfrecerPantallaCompleta, abrirAjustesPantallaCompleta } from '../services/incomingCall';
import { showInfo } from '../utils/toast';
import { abrirAyuda } from '../utils/ayuda';

// ─────────────────────────────────────────────────────────────────────────────
//  ALTA DE PROFESIONAL — SOLO CON GOOGLE
//  El profesional ya está logueado (Google). Acá NO se le pide un formulario
//  largo: con su cuenta creamos el "lead" y le mandamos el mail para que
//  complete el resto (WhatsApp, oficio, DNI, documentos) desde el link, igual
//  que el flujo web de hoy. La verificación/activación la hace el equipo.
// ─────────────────────────────────────────────────────────────────────────────

const COMPLETAR_BASE = 'https://maxi95bahiablanca-hue.github.io/VOLT/web/prestadores/completar.html';

function genToken() {
  const rnd = () => Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${rnd()}${rnd()}${rnd()}`; // > 20 chars
}

const WorkerSignupScreen = ({ session, userId, onBack }) => {
  const [status, setStatus] = useState('intro'); // intro | sending | done | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [emailFallo, setEmailFallo] = useState(false);
  // El WhatsApp se pide acá y no después. Sin él el registro nacía sin ningún
  // teléfono: si a la persona le faltaba un dato —el oficio, por ejemplo— no
  // había manera de preguntárselo y quedaba parada para siempre. Le pasó a
  // Macarena. Además es lo que permite reconocer a quien ya estaba anotado con
  // otro correo.
  const [tel, setTel] = useState('');
  const telDigitos = tel.replace(/\D/g, '');
  const telOk = telDigitos.length >= 8;

  const email = session?.user?.email || '';
  const { nombre, apellido } = useMemo(() => {
    const full = (
      session?.user?.user_metadata?.full_name ||
      session?.user?.user_metadata?.name ||
      ''
    ).trim();
    if (!full) return { nombre: '', apellido: '' };
    const parts = full.split(/\s+/);
    return { nombre: parts[0], apellido: parts.slice(1).join(' ') };
  }, [session]);

  // Aceptar los términos es el momento natural para pedir el permiso de pantalla
  // completa: recién ahí sabemos que va a recibir pedidos. En Android 14+ este
  // permiso no se concede solo, y sin él el aviso no despierta la pantalla.
  const volviendoDeAjustes = useRef(false);

  const ofrecerPantallaCompleta = async () => {
    if (!(await tocaOfrecerPantallaCompleta())) return;
    Alert.alert(
      'Que no se te escape ningún trabajo',
      'En la pantalla que sigue activá "Notificaciones de pantalla completa". Es lo que hace que un pedido te suene y aparezca en pantalla aunque tengas el celular bloqueado.',
      [
        { text: 'Ahora no', style: 'cancel' },
        {
          text: 'Activar',
          onPress: async () => {
            const abrio = await abrirAjustesPantallaCompleta();
            if (abrio) volviendoDeAjustes.current = true;
          },
        },
      ]
    );
  };

  // Al volver de los ajustes, un recordatorio suave de para qué era.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && volviendoDeAjustes.current) {
        volviendoDeAjustes.current = false;
        showInfo('Con esto, los pedidos te suenan y aparecen en pantalla aunque el celu esté bloqueado.', 'Avisos de trabajo');
      }
    });
    return () => sub.remove();
  }, []);

  const registrar = async () => {
    if (!email) {
      setErrorMsg('Tu cuenta no tiene un email asociado. Entrá con Google para registrarte como profesional.');
      setStatus('error');
      return;
    }
    if (!telOk) {
      setErrorMsg('Escribí tu WhatsApp para que podamos contactarte.');
      setStatus('error');
      return;
    }

    setStatus('sending');
    setErrorMsg(null);

    // ¿Ya estaba anotado y aceptado, aunque haya entrado con otro correo?
    // Entonces no hay nada que registrar: queda activo en el momento. Esto es
    // lo que rescata a los que se anotaron con un mail y entran con su Google.
    try {
      const res = await professionalService.activarSiYaEstabaAnotado(
        session?.user?.id || userId, email, telDigitos
      );
      // 🔴 Desde la migración 071 el prestador nace PENDIENTE de aprobación (lo
      //    aprueba Maxi), con el radar apagado. La app le juraba "tu perfil quedó
      //    activo, ya podés recibir trabajos" y la persona guardaba el teléfono
      //    esperando trabajos que nunca iban a sonar (auditoría 23-ago). Ahora dice
      //    la verdad. Se acepta también 'VINCULADO' (el RETURN nuevo de la 075)
      //    manteniendo compatibilidad con la función vieja que devolvía 'ACTIVADO'.
      if (res && (res.startsWith('VINCULADO') || res.startsWith('ACTIVADO'))) {
        Alert.alert(
          '¡Te reconocimos!',
          'Te vinculamos por tu WhatsApp. Tu perfil quedó vinculado y lo está revisando el equipo: te avisamos apenas esté activo.',
          [{ text: 'Entendido', onPress: onBack }]
        );
        return;
      }
    } catch (_) { /* si falla, sigue el alta normal */ }

    // Anti-duplicado: si ya hay un registro con este email, no creamos otro.
    try {
      const { data: yaReg } = await supabase.rpc('prestador_ya_registrado', {
        p_dni: '', p_email: email, p_tel: telDigitos,
      });
      if (yaReg === true) {
        setStatus('done'); // ya estaba: igual mostramos la pantalla de "revisá tu mail"
        return;
      }
    } catch (_) { /* si el chequeo falla, seguimos */ }

    const token = genToken();
    try {
      const { error } = await supabase.from('prestador_leads').insert({
        nombre: nombre || (email.split('@')[0] || 'Profesional'),
        apellido: apellido || null,
        email,
        telefono: telDigitos,
        user_id: userId || session?.user?.id || null,
        profesion: 'A completar',
        fuente: 'app',
        completar_token: token,
      });
      if (error) throw error;

      // Mail con el link para completar el resto (misma función que el flujo web).
      try {
        const { error: fnErr } = await supabase.functions.invoke('notify-datos-pendientes', {
          body: { token },
        });
        if (fnErr) setEmailFallo(true);
      } catch (_) {
        setEmailFallo(true);
      }

      setStatus('done');
      ofrecerPantallaCompleta();
    } catch (e) {
      console.warn('registro prestador error', e);
      setErrorMsg('No pudimos registrar tu solicitud. Probá de nuevo en un momento.');
      setStatus('error');
    }
  };

  // ─── PANTALLA DE ÉXITO ─────────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <SafeAreaView style={styles.container}>
        <TopBar onBack={onBack} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.okIconWrap}>
            <Ionicons name="mail-open" size={40} color="#0D0D0D" />
          </View>
          <Text style={styles.okTitle}>¡Ya estás en BOLT!</Text>
          <Text style={styles.okSub}>
            {emailFallo
              ? 'Registramos tu solicitud como profesional. En un momento te llega un mail para completar tus datos.'
              : 'Te mandamos un mail para que completes el resto de tus datos.'}
          </Text>

          {!!email && (
            <View style={styles.mailCard}>
              <Ionicons name="mail" size={20} color="#FFD600" />
              <Text style={styles.mailCardText}>
                Revisá tu casilla <Text style={styles.mailStrong}>{email}</Text>
                {'\n'}(mirá también en spam o promociones).
              </Text>
            </View>
          )}

          <View style={styles.faltaBox}>
            <Text style={styles.faltaTitle}>Para activar tu perfil vas a completar:</Text>
            {['Tu WhatsApp', 'Tu oficio y zona', 'DNI y una selfie', 'Antecedentes y monotributo'].map((t) => (
              <View key={t} style={styles.faltaRow}>
                <View style={styles.faltaBadge}><Text style={styles.faltaBadgeText}>›</Text></View>
                <Text style={styles.faltaText}>{t}</Text>
              </View>
            ))}
            <Text style={styles.faltaHint}>Lo hacés desde el celular en 5 minutos, sacando las fotos en el momento.</Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={onBack} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Listo</Text>
          </TouchableOpacity>

          {/* El momento exacto en que esta guía sirve: recién se anotó y lo que
              sigue es que le entren trabajos. */}
          <TouchableOpacity
            style={styles.ayudaLink}
            onPress={() => abrirAyuda('disponibilidad')}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="help-buoy-outline" size={14} color="#8A8A8A" />
            <Text style={styles.ayudaLinkText}>Cómo hacer que te lleguen trabajos</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── INTRO / CONFIRMAR ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <TopBar onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.logoBadge}>
          <Ionicons name="flash" size={30} color="#0D0D0D" />
        </View>
        <Text style={styles.title}>Trabajá con <Text style={styles.titleY}>BOLT</Text></Text>
        <Text style={styles.subtitle}>
          Sumate como profesional y recibí trabajos de clientes de tu zona. Sin comisión para los primeros de cada ciudad.
        </Text>

        <View style={styles.benefits}>
          {[
            { icon: 'briefcase-outline', text: 'Te llegan trabajos cerca tuyo; elegís cuáles tomar' },
            { icon: 'cash-outline',      text: 'Cobrás directo del cliente. Tu precio lo ponés vos' },
            { icon: 'star-outline',      text: 'Tu reputación te trae más clientes' },
          ].map((b) => (
            <View key={b.icon} style={styles.benefitRow}>
              <View style={styles.benefitIcon}><Ionicons name={b.icon} size={16} color="#FFD600" /></View>
              <Text style={styles.benefitText}>{b.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.acctCard}>
          <View style={styles.googleG}><Text style={styles.googleGText}>G</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.acctLabel}>Te registrás con tu cuenta</Text>
            <Text style={styles.acctEmail} numberOfLines={1}>{email || 'tu cuenta de Google'}</Text>
          </View>
        </View>

        <View style={styles.telCard}>
          <Text style={styles.telLabel}>Tu WhatsApp</Text>
          <View style={styles.telRow}>
            <Ionicons name="logo-whatsapp" size={19} color="#FFD600" />
            <TextInput
              style={styles.telInput}
              value={tel}
              onChangeText={setTel}
              placeholder="291 15 4199938"
              placeholderTextColor="#4A453D"
              keyboardType="phone-pad"
              maxLength={20}
            />
            {telOk && <Ionicons name="checkmark-circle" size={19} color="#FFD600" />}
          </View>
          <Text style={styles.telHint}>Es por donde te avisamos si falta algún dato.</Text>
        </View>

        <Text style={styles.explain}>
          Te registramos ahora con tu cuenta. El resto de los datos (oficio, DNI y documentos) los completás por un link que te mandamos por mail. Te lleva 5 minutos.
        </Text>

        {status === 'error' && !!errorMsg && (
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle-outline" size={16} color="#E5484D" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, (status === 'sending' || !telOk) && { opacity: 0.45 }]}
          onPress={registrar}
          disabled={status === 'sending' || !telOk}
          activeOpacity={0.85}
        >
          {status === 'sending'
            ? <ActivityIndicator color="#0D0D0D" />
            : <Text style={styles.primaryBtnText}>Registrarme como profesional</Text>}
        </TouchableOpacity>

        <Text style={styles.terms}>
          Al registrarte aceptás los{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL('https://bolt.com.ar/privacy.html')}>
            Términos y la Política de privacidad
          </Text>
          {' '}de BOLT.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const TopBar = ({ onBack }) => (
  <View style={styles.topBar}>
    <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Ionicons name="arrow-back" size={22} color="#8A8A8A" />
      <Text style={styles.backText}>Volver</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  topBar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { color: '#5C5C5C', fontSize: 16 },
  content: { paddingHorizontal: 26, paddingBottom: 40, paddingTop: 12 },

  logoBadge: {
    width: 60, height: 60, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  title: { fontSize: 30, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  titleY: { color: '#FFD600' },
  subtitle: { fontSize: 16, color: '#999', lineHeight: 22, marginBottom: 24 },

  benefits: { gap: 12, marginBottom: 24 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: {
    width: 32, height: 32, borderRadius: 20, backgroundColor: '#141400',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a10',
  },
  benefitText: { flex: 1, color: '#bbb', fontSize: 16, lineHeight: 20 },

  acctCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 16,
  },
  googleG: { width: 30, height: 30, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  googleGText: { fontSize: 16, fontWeight: '700', color: '#FFD600' },
  acctLabel: { color: '#8A8A8A', fontSize: 14, marginBottom: 2 },
  acctEmail: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  telCard: {
    backgroundColor: '#161616', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  telLabel: { color: '#8A8A8A', fontSize: 14, marginBottom: 6 },
  telRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  telInput: {
    flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700',
    paddingVertical: 4, letterSpacing: 0.3,
  },
  telHint: { color: '#5C5C5C', fontSize: 12, marginTop: 7 },

  explain: { color: '#8A8A8A', fontSize: 14, lineHeight: 21, marginBottom: 12 },

  primaryBtn: { backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 18, alignItems: 'center', marginTop: 12 },
  primaryBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  terms: { fontSize: 12, color: '#444', textAlign: 'center', lineHeight: 17, marginTop: 16 },

  // Link de ayuda: discreto a propósito, no compite con el botón principal.
  ayudaLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 16,
  },
  ayudaLinkText: { fontSize: 14, color: '#8A8A8A', textDecorationLine: 'underline' },

  termsLink: { color: '#FFD600', textDecorationLine: 'underline' },

  errorWrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(229,72,77,0.08)', borderWidth: 1, borderColor: 'rgba(229,72,77,0.25)',
    borderRadius: 20, padding: 12, marginTop: 4, marginBottom: 4,
  },
  errorText: { color: '#E5484D', fontSize: 14, flex: 1, lineHeight: 18 },

  // Éxito
  okIconWrap: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 20, marginBottom: 18,
  },
  okTitle: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 10 },
  okSub: { fontSize: 16, color: '#8A8A8A', textAlign: 'center', lineHeight: 22, marginBottom: 22 },
  mailCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#151500', borderWidth: 1, borderColor: 'rgba(255,214,0,0.3)',
    borderRadius: 20, padding: 16, marginBottom: 22,
  },
  mailCardText: { flex: 1, color: '#bbb', fontSize: 14, lineHeight: 20 },
  mailStrong: { color: '#FFD600', fontWeight: '600' },
  faltaBox: {
    backgroundColor: '#161616', borderRadius: 20, padding: 18, marginBottom: 8,
  },
  faltaTitle: { color: '#FFFFFF', fontWeight: '600', fontSize: 16, marginBottom: 12 },
  faltaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  faltaBadge: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center' },
  faltaBadgeText: { color: '#0D0D0D', fontWeight: '700', fontSize: 16 },
  faltaText: { color: '#ccc', fontSize: 16, fontWeight: '600' },
  faltaHint: { color: '#5C5C5C', fontSize: 14, lineHeight: 18, marginTop: 8 },
});

export default WorkerSignupScreen;

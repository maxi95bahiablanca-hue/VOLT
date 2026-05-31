import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SECTIONS = [
  {
    title: '1. Información que recopilamos',
    body: 'Recopilamos información que proporcionás al registrarte (nombre, email, teléfono, CUIT, CBU), fotos de documentos de identidad para verificación de trabajadores, tu ubicación GPS cuando usás la app (solo mientras está activa o en segundo plano si sos trabajador con disponibilidad activada), y datos de pago procesados por Mercado Pago (no almacenamos datos de tarjeta).',
  },
  {
    title: '2. Cómo usamos tu información',
    body: 'Usamos tu información para conectarte con profesionales cercanos, procesar pagos de forma segura, verificar la identidad de los trabajadores, mostrarte el historial de servicios, enviarte notificaciones sobre el estado de tus trabajos, y mejorar la plataforma.',
  },
  {
    title: '3. Compartir información',
    body: 'Compartimos tu nombre y ubicación aproximada con el profesional asignado a tu trabajo. Los trabajadores comparten su nombre, foto de perfil, calificación y ubicación en tiempo real con los clientes durante un trabajo activo. No vendemos tu información personal a terceros.',
  },
  {
    title: '4. Pagos',
    body: 'Los pagos son procesados por Mercado Pago. GOVOLT retiene el pago hasta que el cliente confirma que el trabajo fue completado satisfactoriamente. Consultá la política de privacidad de Mercado Pago para más detalles sobre el manejo de datos de pago.',
  },
  {
    title: '5. Ubicación',
    body: 'La app solicita acceso a tu ubicación para mostrar profesionales cercanos (clientes) o para que los clientes puedan seguirte en tiempo real durante un trabajo (trabajadores). Podés desactivar el acceso a la ubicación en la configuración de tu dispositivo, aunque esto limitará funcionalidades de la app.',
  },
  {
    title: '6. Seguridad',
    body: 'Usamos cifrado TLS para todas las comunicaciones. Los documentos de identidad se almacenan de forma segura en Supabase Storage con acceso restringido. Solo el equipo de GOVOLT puede ver los documentos de verificación, y únicamente para el proceso de aprobación de trabajadores.',
  },
  {
    title: '7. Retención de datos',
    body: 'Conservamos tu información mientras tu cuenta esté activa. Podés solicitar la eliminación de tu cuenta y datos enviando un email a soporte@volt.app. Los datos de pagos se conservan por el período requerido por la legislación argentina.',
  },
  {
    title: '8. Tus derechos',
    body: 'Tenés derecho a acceder, corregir o eliminar tu información personal. Para ejercer estos derechos, contactanos en soporte@volt.app. Respondemos todas las solicitudes dentro de los 30 días hábiles.',
  },
  {
    title: '9. Cambios a esta política',
    body: 'Podemos actualizar esta política ocasionalmente. Te notificaremos por email o dentro de la app si hay cambios significativos. El uso continuado de GOVOLT después de los cambios implica aceptación de la nueva política.',
  },
  {
    title: '10. Contacto',
    body: 'Para preguntas sobre esta política de privacidad, contactanos en soporte@volt.app o desde el menú de soporte dentro de la app.',
  },
];

const PrivacyPolicyScreen = ({ onClose }) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onClose} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={24} color="#F5F5F5" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Política de privacidad</Text>
      <View style={{ width: 40 }} />
    </View>

    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.badge}>
        <Ionicons name="shield-checkmark" size={14} color="#0A0A0A" />
        <Text style={styles.badgeText}>GOVOLT — TUS DATOS, SEGUROS</Text>
      </View>

      <Text style={styles.updated}>Última actualización: Mayo 2026</Text>
      <Text style={styles.intro}>
        En GOVOLT nos tomamos muy en serio la privacidad de nuestros usuarios. Esta política explica qué información recopilamos, cómo la usamos y cómo la protegemos.
      </Text>

      {SECTIONS.map((s, i) => (
        <View key={i} style={styles.section}>
          <Text style={styles.sectionTitle}>{s.title}</Text>
          <Text style={styles.sectionBody}>{s.body}</Text>
        </View>
      ))}

      <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
        <Text style={styles.closeBtnText}>Entendido</Text>
      </TouchableOpacity>
    </ScrollView>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },

  content: { padding: 24, paddingBottom: 48 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4CAF50', borderRadius: 20, alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 7, marginBottom: 16,
  },
  badgeText: { color: '#0A0A0A', fontWeight: '900', fontSize: 11, letterSpacing: 1 },

  updated: { fontSize: 12, color: '#444', marginBottom: 12 },
  intro: { fontSize: 14, color: '#888', lineHeight: 22, marginBottom: 28 },

  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#F5F5F5', marginBottom: 8 },
  sectionBody: { fontSize: 13, color: '#666', lineHeight: 21 },

  closeBtn: {
    backgroundColor: '#FFD600', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  closeBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
});

export default PrivacyPolicyScreen;

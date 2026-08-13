import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chargesInApp } from '../config/monetization';

const STEPS = [
  {
    icon: 'search',
    color: '#FFD600',
    title: 'Buscás el servicio',
    desc: 'Escribís qué necesitás (electricista, plomero, etc.) y ves los profesionales verificados disponibles en tu zona en tiempo real.',
  },
  {
    icon: 'people',
    color: '#FFD600',
    title: 'Recibís hasta 3 presupuestos',
    desc: 'Tu solicitud se envía a los 3 profesionales más cercanos. Cada uno puede aceptar y enviarte su diagnóstico inicial. Vos elegís el que más te conviene.',
  },
  {
    icon: 'construct',
    color: '#8A8A8A',
    title: 'El profesional va a tu domicilio',
    desc: 'Podés seguir su ubicación en el mapa en tiempo real. Al llegar, confirma el diagnóstico y empieza el trabajo.',
  },
  {
    icon: 'card',
    color: '#FFD600',
    title: chargesInApp() ? 'Pagás seguro con tarjeta' : 'Coordinás el pago directo',
    desc: chargesInApp()
      ? 'El pago se procesa dentro de la app con tarjeta de débito o crédito. El profesional recibe su pago solo cuando confirmás que el trabajo fue completado.'
      : 'Cuando el trabajo está listo, le pagás directo al profesional como prefieran (efectivo, transferencia, etc.). Por ahora BOLT es gratis: no cobra comisión.',
  },
  {
    icon: 'star',
    color: '#FFD600',
    title: 'Calificás el servicio',
    desc: chargesInApp()
      ? 'Tu opinión mejora la plataforma. Los mejores profesionales tienen menor comisión, lo que también te beneficia a vos.'
      : 'Tu opinión mejora la plataforma y ayuda a que los mejores profesionales se destaquen y reciban más trabajos.',
  },
];

const HowItWorksScreen = ({ onClose }) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onClose} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Cómo funciona</Text>
      <View style={{ width: 40 }} />
    </View>

    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.badge}>
        <Ionicons name="flash" size={14} color="#0D0D0D" />
        <Text style={styles.badgeText}>BOLT — SIMPLE Y SEGURO</Text>
      </View>

      <Text style={styles.intro}>
        Conectamos clientes con profesionales verificados en minutos.
      </Text>

      {STEPS.map((s, i) => (
        <View key={i} style={styles.step}>
          <View style={styles.stepLeft}>
            <View style={[styles.stepIcon, { backgroundColor: s.color + '20', borderColor: s.color + '40' }]}>
              <Ionicons name={s.icon} size={22} color={s.color} />
            </View>
            {i < STEPS.length - 1 && <View style={styles.stepLine} />}
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepNum}>Paso {i + 1}</Text>
            <Text style={styles.stepTitle}>{s.title}</Text>
            <Text style={styles.stepDesc}>{s.desc}</Text>
          </View>
        </View>
      ))}

      <View style={styles.securityBox}>
        <Ionicons name="shield-checkmark" size={20} color="#FFD600" />
        <View style={{ flex: 1 }}>
          <Text style={styles.securityTitle}>{chargesInApp() ? 'Tu dinero siempre protegido' : 'Tu seguridad es lo primero'}</Text>
          <Text style={styles.securityDesc}>
            {chargesInApp()
              ? 'BOLT retiene el pago hasta que confirmás que el trabajo está hecho. Ningún profesional recibe dinero antes.'
              : 'A todos los revisa el equipo de BOLT antes de habilitarlos, y cada uno tiene un código de 4 dígitos que te muestra en la puerta. Seguí su llegada en tiempo real hasta tu domicilio.'}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
        <Text style={styles.closeBtnText}>Entendido</Text>
      </TouchableOpacity>
    </ScrollView>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },

  content: { padding: 24, paddingBottom: 48 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD600', borderRadius: 999, alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 7, marginBottom: 20,
  },
  badgeText: { color: '#0D0D0D', fontWeight: '700', fontSize: 12, letterSpacing: 1 },

  intro: { fontSize: 16, color: '#8A8A8A', lineHeight: 24, marginBottom: 32 },

  step: { flexDirection: 'row', gap: 16, marginBottom: 0 },
  stepLeft: { alignItems: 'center', width: 48 },
  stepIcon: {
    width: 48, height: 48, borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  stepLine: { width: 2, flex: 1, backgroundColor: '#1a1a1a', marginVertical: 8, minHeight: 24 },
  stepContent: { flex: 1, paddingBottom: 28 },
  stepNum:   { fontSize: 12, color: '#444', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 4 },
  stepTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 6 },
  stepDesc:  { fontSize: 14, color: '#5C5C5C', lineHeight: 20 },

  securityBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.2)',
    borderRadius: 20, padding: 16, marginBottom: 28,
  },
  securityTitle: { fontSize: 16, fontWeight: '600', color: '#FFD600', marginBottom: 4 },
  securityDesc:  { fontSize: 14, color: '#5C5C5C', lineHeight: 19 },

  closeBtn: {
    backgroundColor: '#FFD600', borderRadius: 999,
    paddingVertical: 18, alignItems: 'center',
  },
  closeBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },
});

export default HowItWorksScreen;

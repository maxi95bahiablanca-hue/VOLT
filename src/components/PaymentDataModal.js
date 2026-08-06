import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { showSuccess, showError } from '../utils/toast';

/**
 * Modal de "Datos para cobrar" (CUIT + CBU/alias). Transitorio para los
 * trabajadores pioneros: cuando la app salga al público, el registro pedirá
 * todo obligatorio. Reusable en dos lugares:
 *   - WorkerDashboard: aparece en la primera conexión (onboarding=true → muestra
 *     el botón "Seguir en otro momento").
 *   - Perfil: acceso permanente para completarlo cuando quiera (onboarding=false).
 *
 * Props:
 *   visible, professional, onClose, onSaved(updatedFields), onLater?, onboarding?
 */
const PaymentDataModal = ({ visible, professional, onClose, onSaved, onLater, onboarding = false }) => {
  const [cuit, setCuit] = useState(professional?.cuit || '');
  const [cbu, setCbu]   = useState(professional?.cbu || '');
  const [saving, setSaving] = useState(false);

  const cuitDigits = cuit.replace(/\D/g, '');
  const valid = cuitDigits.length >= 11 && cbu.trim().length >= 6;

  const save = async () => {
    if (!valid) {
      showError('CUIT de 11 dígitos y tu CBU o alias.', 'Revisá los datos');
      return;
    }
    setSaving(true);
    try {
      const fields = { cuit: cuit.trim(), cbu: cbu.trim() };
      const { error } = await supabase
        .from('professionals')
        .update(fields)
        .eq('id', professional.id);
      if (error) throw error;
      showSuccess('Ya podés cobrar tus trabajos.', '¡Listo!');
      onSaved?.(fields);
    } catch (e) {
      showError('Probá de nuevo en un momento.', 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.iconWrap}>
              <Ionicons name="card" size={30} color="#FFD600" />
            </View>

            <Text style={styles.title}>
              {onboarding ? '¡Bienvenido a BOLT! 👋' : 'Datos para cobrar'}
            </Text>
            <Text style={styles.subtitle}>
              {onboarding
                ? 'Antes de empezar, cargá tus datos para que podamos pagarte tus trabajos. Te lleva 1 minuto.'
                : 'Estos son los datos donde te transferimos lo que cobrás.'}
            </Text>

            <Text style={styles.label}>CUIT (monotributo)</Text>
            <TextInput
              style={styles.input}
              value={cuit}
              onChangeText={setCuit}
              placeholder="20-12345678-9"
              placeholderTextColor="#555"
              keyboardType="numbers-and-punctuation"
              maxLength={13}
            />

            <Text style={styles.label}>CBU / CVU o alias</Text>
            <TextInput
              style={styles.input}
              value={cbu}
              onChangeText={setCbu}
              placeholder="Tu CBU (22 dígitos) o alias.mp"
              placeholderTextColor="#555"
              autoCapitalize="none"
            />

            <View style={styles.infoBox}>
              <Ionicons name="shield-checkmark-outline" size={16} color="#33d17a" />
              <Text style={styles.infoText}>
                El cliente paga la visita y el trabajo por la app. Te transferimos a tu CBU
                lo que te corresponde, descontando solo la comisión.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, !valid && styles.saveBtnDisabled]}
              onPress={save}
              disabled={!valid || saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#0A0A0A" />
                : <Text style={styles.saveBtnText}>Guardar y empezar</Text>}
            </TouchableOpacity>

            {onboarding ? (
              <TouchableOpacity style={styles.laterBtn} onPress={onLater} disabled={saving}>
                <Text style={styles.laterText}>Seguir en otro momento</Text>
                <Text style={styles.laterSub}>Vas a poder cargarlos desde Mi Perfil</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.laterBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.laterText}>Cancelar</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, maxHeight: '92%' },
  iconWrap: { alignSelf: 'center', width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFD60018', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#999', fontSize: 13.5, textAlign: 'center', lineHeight: 19, marginTop: 8, marginBottom: 18, paddingHorizontal: 6 },
  label: { color: '#ccc', fontSize: 12.5, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#0A0A0A', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a', color: '#fff', fontSize: 15, padding: 14, marginBottom: 14 },
  infoBox: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: '#0d1a10', borderRadius: 12, padding: 12, marginBottom: 18 },
  infoText: { flex: 1, color: '#9fcaa9', fontSize: 12, lineHeight: 17 },
  saveBtn: { backgroundColor: '#FFD600', borderRadius: 14, padding: 16, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#0A0A0A', fontSize: 15.5, fontWeight: '800' },
  laterBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  laterText: { color: '#FFD600', fontSize: 14, fontWeight: '700' },
  laterSub: { color: '#666', fontSize: 11.5, marginTop: 3 },
});

export default PaymentDataModal;

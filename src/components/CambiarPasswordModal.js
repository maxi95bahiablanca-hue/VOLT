import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { showSuccess, showError } from '../utils/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Cambiar la contraseña, desde adentro.
//
// Maxi, 6-ago-2026: "agregá también cambiar mi contraseña y que quede
// actualizado en todos lados, hoy la gente no tiene cómo cambiarla".
//
// Existía "Olvidé mi contraseña" (el mail de recuperación), que sirve cuando NO
// podés entrar. Estando adentro no había nada: el único camino era desloguearse
// y fingir que te la olvidaste.
//
// 🔴 Los que entraron con Google no tienen contraseña. Para ellos el mismo
//    botón no dice "cambiar" sino "poner": si le pidiéramos la actual, no la
//    tienen, y el botón fallaría sin explicar por qué. Al ponerla ganan algo
//    concreto — pueden entrar con el mail y la contraseña desde cualquier lado,
//    sin depender de Google.
//
// La contraseña vive en `auth.users`, que es una sola para la app y para la
// web: cambiarla acá la cambia en los dos lados, que es lo que pidió.
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 6;   // el mínimo que exige Supabase

/**
 * Props:
 *   visible, session, onClose
 */
const CambiarPasswordModal = ({ visible, session, onClose }) => {
  const [actual, setActual]     = useState('');
  const [nueva, setNueva]       = useState('');
  const [repetir, setRepetir]   = useState('');
  const [verla, setVerla]       = useState(false);
  const [guardando, setGuardando] = useState(false);
  const insets = useSafeAreaInsets();

  const email = session?.user?.email || '';

  // ¿Ya tiene una contraseña propia? Sale de las identidades del usuario: si
  // entró sólo con Google, la lista trae 'google' y nada más.
  const identidades = session?.user?.identities || [];
  const tienePassword = identidades.length === 0
    ? true   // sin dato, asumimos que sí: pedir la actual es el camino seguro
    : identidades.some(i => i.provider === 'email');

  const limpiar = () => { setActual(''); setNueva(''); setRepetir(''); setVerla(false); };
  const cerrar  = () => { limpiar(); onClose?.(); };

  const puedeGuardar =
    nueva.length >= MIN && nueva === repetir && (!tienePassword || actual.length > 0);

  const guardar = async () => {
    if (guardando) return;
    // ⚠️ Los toasts de la casa van (CUERPO, TÍTULO), no al revés: el primer
    // argumento es text2. Ver src/utils/toast.js.
    if (nueva.length < MIN) {
      showError(`La contraseña necesita al menos ${MIN} caracteres.`, 'Muy corta');
      return;
    }
    if (nueva !== repetir) {
      showError('Escribiste dos contraseñas distintas.', 'No coinciden');
      return;
    }
    setGuardando(true);
    try {
      // 🔴 Confirmar la actual antes de cambiarla. Sin esto, cualquiera que
      //    agarre el teléfono desbloqueado le cambia la contraseña al dueño y
      //    lo deja afuera de su propia cuenta.
      if (tienePassword) {
        const { error: malPass } = await supabase.auth.signInWithPassword({
          email, password: actual,
        });
        if (malPass) {
          showError('La actual no es esa. Probá de nuevo.', 'Contraseña incorrecta');
          setGuardando(false);
          return;
        }
      }

      const { error } = await supabase.auth.updateUser({ password: nueva });
      if (error) throw error;

      showSuccess(
        tienePassword
          ? 'Usala la próxima vez que entres, acá y en bolt.com.ar.'
          : 'Ahora podés entrar con tu mail y esta contraseña, además de con Google.',
        tienePassword ? 'Contraseña cambiada' : 'Contraseña creada'
      );
      cerrar();
    } catch (e) {
      const msg = String(e?.message || '');
      showError(
        /same.*password|should be different/i.test(msg)
          ? 'Esa ya es tu contraseña actual. Poné una distinta.'
          : 'Probá de nuevo en un momento.',
        'No se pudo cambiar'
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={cerrar}>
      {/* 🔴 11-ago-2026 — la hoja está pegada al borde de abajo y en Android el
          behavior venía en undefined: al tocar "Repetila" el teclado tapaba el
          botón "Cambiar contraseña" y el scroll interno sólo corría los pocos
          dp que sobraban del maxHeight. Escribías la contraseña nueva dos veces
          y no la podías guardar. Con 'height' la hoja se encoge lo que mide el
          teclado y el ScrollView llega hasta el botón. El paddingBottom por
          insets es para que "Cancelar" no quede debajo de la barra del sistema
          (la hoja se dibuja pegada al borde real de la pantalla). */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 22) }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="lock-closed" size={28} color="#FFD600" />
            </View>

            <Text style={styles.title}>
              {tienePassword ? 'Cambiar mi contraseña' : 'Poner una contraseña'}
            </Text>
            <Text style={styles.subtitle}>
              {tienePassword
                ? 'La misma te sirve para la app y para bolt.com.ar.'
                : `Entrás con Google, así que todavía no tenés una. Si ponés una, vas a poder entrar también con ${email}.`}
            </Text>

            {tienePassword && (
              <>
                <Text style={styles.label}>Tu contraseña de ahora</Text>
                <TextInput
                  style={styles.input}
                  value={actual}
                  onChangeText={setActual}
                  placeholder="La que usás hoy"
                  placeholderTextColor="#5C5C5C"
                  secureTextEntry={!verla}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}

            <Text style={styles.label}>Contraseña nueva</Text>
            <TextInput
              style={styles.input}
              value={nueva}
              onChangeText={setNueva}
              placeholder={`Mínimo ${MIN} caracteres`}
              placeholderTextColor="#5C5C5C"
              secureTextEntry={!verla}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Repetila</Text>
            <TextInput
              style={styles.input}
              value={repetir}
              onChangeText={setRepetir}
              placeholder="La misma otra vez"
              placeholderTextColor="#5C5C5C"
              secureTextEntry={!verla}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Escribir una contraseña a ciegas dos veces en un celular es la
                forma más rápida de trabarse solo. */}
            <TouchableOpacity
              style={styles.verla}
              onPress={() => setVerla(v => !v)}
              activeOpacity={0.7}
            >
              <Ionicons name={verla ? 'eye-off-outline' : 'eye-outline'} size={16} color="#8A8A8A" />
              <Text style={styles.verlaText}>{verla ? 'Ocultar' : 'Ver lo que escribo'}</Text>
            </TouchableOpacity>

            {nueva.length > 0 && nueva.length < MIN && (
              <Text style={styles.aviso}>Te faltan {MIN - nueva.length} caracteres.</Text>
            )}
            {repetir.length > 0 && nueva !== repetir && (
              <Text style={styles.aviso}>Las dos no son iguales.</Text>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, !puedeGuardar && styles.saveBtnDisabled]}
              onPress={guardar}
              disabled={!puedeGuardar || guardando}
              activeOpacity={0.85}
            >
              {guardando
                ? <ActivityIndicator color="#0D0D0D" />
                : <Text style={styles.saveBtnText}>
                    {tienePassword ? 'Cambiar contraseña' : 'Guardar contraseña'}
                  </Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.laterBtn} onPress={cerrar} disabled={guardando}>
              <Text style={styles.laterText}>Cancelar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, maxHeight: '92%' },
  iconWrap: { alignSelf: 'center', width: 58, height: 58, borderRadius: 999, backgroundColor: '#FFD60018', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title:    { color: '#fff', fontSize: 20, fontWeight: '600', textAlign: 'center' },
  subtitle: { color: '#999', fontSize: 14, textAlign: 'center', lineHeight: 19, marginTop: 8, marginBottom: 18, paddingHorizontal: 6 },
  label:    { color: '#ccc', fontSize: 14, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input:    { backgroundColor: '#161616', borderRadius: 20, color: '#fff', fontSize: 16, padding: 14, marginBottom: 14 },
  verla:    { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 6 },
  verlaText:{ color: '#8A8A8A', fontSize: 14 },
  aviso:    { color: '#8A8A8A', fontSize: 14, marginBottom: 10 },
  saveBtn:  { backgroundColor: '#FFD600', borderRadius: 999, padding: 16, alignItems: 'center', marginTop: 6 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '600' },
  laterBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  laterText:{ color: '#FFD600', fontSize: 16, fontWeight: '700' },
});

export default CambiarPasswordModal;

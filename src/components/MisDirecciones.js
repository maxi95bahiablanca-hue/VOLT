import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, ScrollView, Platform, Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { supabase } from '../supabase';

const CLAVE = 'bolt.direcciones';

/** Las direcciones del cliente.
 *
 *  🔴 9-ago-2026 — antes "Cambiar" volvía a pedir el GPS y nada más: no había
 *  forma de ESCRIBIR una dirección, y la de un pedido no quedaba para el
 *  siguiente. Si estabas pidiendo para la casa de tu vieja, no se podía (Maxi).
 *
 *  Ahora se pueden tener varias, se eligen con un toque y quedan guardadas —en
 *  el teléfono y en la cuenta, así siguen estando si cambia de dispositivo—.
 *
 *  Geocodificado acotado a Bahía Blanca, igual que en la web: una dirección sin
 *  ciudad cae en cualquier lado del país.
 */
export default function MisDirecciones({ visible, actual, onElegir, onCerrar, onUsarGPS }) {
  const [lista, setLista]       = useState([]);
  const [texto, setTexto]       = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError]       = useState('');
  // Cuando se está corrigiendo la que ya está puesta, en vez de buscar una
  // nueva se cambia SÓLO el nombre y el punto queda donde está.
  const [corrigiendo, setCorrigiendo] = useState(false);
  // 🔴 11-ago-2026 — el alto de la barra de abajo (botones o gestos) lo dice el
  //    sistema, nunca un número fijo. Mismo criterio que TabBar.js.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(CLAVE)
      .then(t => { if (t) setLista(JSON.parse(t) || []); })
      .catch(() => {});
  }, [visible]);

  const guardar = async (nueva) => {
    setLista(nueva);
    AsyncStorage.setItem(CLAVE, JSON.stringify(nueva)).catch(() => {});
    // También en la cuenta: si cambia de teléfono, sus direcciones lo siguen.
    supabase.auth.updateUser({ data: { direcciones: nueva.slice(0, 10) } }).catch(() => {});
  };

  const agregar = async () => {
    const dir = texto.trim();
    setError('');
    if (dir.length < 5) { setError('Escribí la calle y la altura.'); return; }
    setBuscando(true);
    try {
      const r = await Location.geocodeAsync(`${dir}, Bahía Blanca, Argentina`);
      const p = r?.[0];
      if (!p) { setError('No encontramos esa dirección. Probá con calle y número.'); return; }
      const nueva = [
        { id: String(Date.now()), address: dir, latitude: p.latitude, longitude: p.longitude },
        ...lista.filter(d => d.address.toLowerCase() !== dir.toLowerCase()),
      ].slice(0, 10);
      await guardar(nueva);
      setTexto('');
      onElegir?.(nueva[0]);
    } catch {
      setError('No pudimos ubicar la dirección. Probá de nuevo.');
    } finally {
      setBuscando(false);
    }
  };

  /** El GPS te ubica en la esquina de al lado y la app te llama por la calle que
   *  cruza. El punto está bien —es tu casa—, lo que está mal es el nombre. Por
   *  eso corregir NO vuelve a buscar: se queda con las mismas coordenadas y
   *  cambia el texto (Maxi, 9-ago-2026: "estoy en un pasillo al fondo y estoy
   *  más cerca de la calle que cruza"). */
  const guardarCorreccion = async () => {
    const dir = texto.trim();
    setError('');
    if (dir.length < 5) { setError('Escribí la calle y la altura.'); return; }
    if (!actual?.latitude) { setError('Primero tomá una ubicación.'); return; }
    const corregida = {
      id: String(Date.now()),
      address: dir,
      latitude: actual.latitude,
      longitude: actual.longitude,
    };
    await guardar([corregida, ...lista.filter(d =>
      d.address.toLowerCase() !== dir.toLowerCase() &&
      d.address.toLowerCase() !== String(actual.address || '').toLowerCase()
    )].slice(0, 10));
    setTexto('');
    setCorrigiendo(false);
    onElegir?.(corregida);
    onCerrar?.();
  };

  const empezarCorreccion = () => {
    setTexto(String(actual?.address || ''));
    setCorrigiendo(true);
    setError('');
  };

  const borrar = (d) => {
    Alert.alert('Borrar dirección', d.address, [
      { text: 'No', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => guardar(lista.filter(x => x.id !== d.id)) },
    ]);
  };

  const esActual = (d) =>
    !!actual?.address && d.address.toLowerCase() === String(actual.address).toLowerCase();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCerrar}>
      {/* 🔴 11-ago-2026 — al tocar el campo, el teclado tapaba el campo mismo, el
          botón amarillo de agregar y el "Listo": la hoja no se corría y no había
          scroll, así que no se podía guardar ninguna dirección ni salir sin
          apretar Atrás. Ahora la hoja se levanta con el teclado y todo lo de
          adentro scrollea hasta el último botón. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <TouchableOpacity style={styles.fondo} activeOpacity={1} onPress={onCerrar}>
        <TouchableOpacity style={styles.hoja} activeOpacity={1} onPress={() => {}}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 12 }}
          keyboardShouldPersistTaps="handled"
          // Arrastrar para abajo baja el teclado: aunque el sistema no achique
          // la hoja, con un gesto se recupera la pantalla entera. Igual que en
          // CambiarPasswordModal.
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.asa} />
          <Text style={styles.eyebrow}>Dónde hay que ir</Text>
          <Text style={styles.titulo}>Mis direcciones</Text>

          {/* La que está puesta ahora, con el lápiz para arreglarle el nombre.
              Antes no aparecía por ningún lado: sólo se podía tomar el GPS de
              nuevo —que vuelve a equivocarse igual— o agregar otra. */}
          {!!actual?.address && (
            <View style={styles.actualCaja}>
              <View style={styles.actualTop}>
                <Ionicons name="checkmark-circle" size={19} color="#FFD600" />
                <Text style={styles.actualTexto} numberOfLines={2}>{actual.address}</Text>
              </View>
              <Text style={styles.actualPie}>Queda guardada: la app abre siempre acá</Text>
              <TouchableOpacity style={styles.corregirBtn} onPress={empezarCorreccion}>
                <Ionicons name="create-outline" size={16} color="#FFD600" />
                <Text style={styles.corregirTexto}>Corregir el nombre de la calle</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* La lista tiene scroll propio: en Android encadena con el de afuera
              (nestedScrollEnabled), pero en iOS no. Por eso acá también baja el
              teclado al arrastrar: si el dedo cae justo sobre la lista, el que
              está escribiendo no queda encerrado. */}
          <ScrollView
            style={{ maxHeight: 220 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            nestedScrollEnabled
          >
            {/* El GPS sólo se pide si lo pedís vos. La app ya no lo toma sola
                al abrir: antes pisaba la dirección elegida y volvía la mala. */}
            <TouchableOpacity style={styles.fila} onPress={() => { onUsarGPS?.(); onCerrar?.(); }}>
              <Ionicons name="locate" size={19} color="#FFD600" />
              <Text style={styles.filaTexto}>Usar mi ubicación actual</Text>
            </TouchableOpacity>

            {lista.map(d => (
              <TouchableOpacity
                key={d.id}
                style={styles.fila}
                onPress={() => { onElegir?.(d); onCerrar?.(); }}
                onLongPress={() => borrar(d)}
                accessibilityRole="button"
                accessibilityLabel={`Usar ${d.address}${esActual(d) ? ', es la actual' : ''}`}
              >
                <Ionicons
                  name={esActual(d) ? 'checkmark-circle' : 'location-outline'}
                  size={19}
                  color={esActual(d) ? '#FFD600' : '#8A8A8A'}
                />
                <Text style={[styles.filaTexto, esActual(d) && styles.filaTextoOn]} numberOfLines={1}>
                  {d.address}
                </Text>
                <TouchableOpacity onPress={() => borrar(d)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={17} color="#3a3a3a" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[styles.eyebrow, { marginTop: 16 }]}>
            {corrigiendo ? 'Cómo se llama de verdad' : 'Agregar otra'}
          </Text>
          {corrigiendo && (
            <Text style={styles.ayudita}>
              El punto en el mapa queda donde está: sólo cambia el nombre que ve el profesional.
            </Text>
          )}
          <View style={styles.campoRow}>
            <TextInput
              style={styles.campo}
              placeholder="Ej: Garibaldi 653"
              placeholderTextColor="#5C5C5C"
              value={texto}
              onChangeText={setTexto}
              onSubmitEditing={corrigiendo ? guardarCorreccion : agregar}
              returnKeyType="done"
              autoFocus={corrigiendo}
            />
            <TouchableOpacity
              style={styles.agregar}
              onPress={corrigiendo ? guardarCorreccion : agregar}
              disabled={buscando}
              accessibilityLabel={corrigiendo ? 'Guardar la corrección' : 'Agregar la dirección'}
            >
              {buscando
                ? <ActivityIndicator size="small" color="#0D0D0D" />
                : <Ionicons name={corrigiendo ? 'checkmark' : 'add'} size={22} color="#0D0D0D" />}
            </TouchableOpacity>
          </View>
          {corrigiendo && (
            <TouchableOpacity onPress={() => { setCorrigiendo(false); setTexto(''); setError(''); }}>
              <Text style={styles.cancelarCorreccion}>Dejarla como está</Text>
            </TouchableOpacity>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.cerrar} onPress={onCerrar}>
            <Text style={styles.cerrarTexto}>Listo</Text>
          </TouchableOpacity>
        </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  hoja: {
    backgroundColor: '#0D0D0D',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 10,
    // 🔴 11-ago-2026 — el respiro de abajo ahora lo pone el ScrollView (con el
    //    alto real de la barra del sistema). Y la hoja no puede pasarse de la
    //    pantalla: si crece, scrollea adentro en vez de irse arriba del borde.
    maxHeight: '90%',
  },
  asa: { width: 36, height: 4, borderRadius: 999, backgroundColor: '#333', alignSelf: 'center', marginBottom: 20 },
  eyebrow: {
    fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase',
    color: '#5C5C5C', fontWeight: '600', marginBottom: 8,
  },
  titulo: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.8, marginBottom: 20 },

  actualCaja: {
    backgroundColor: '#161616', borderRadius: 20, padding: 16, marginBottom: 16,
    borderLeftWidth: 3, borderLeftColor: '#FFD600',
  },
  actualTop:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  actualTexto:  { flex: 1, fontSize: 16, fontWeight: '600', color: '#FFFFFF', lineHeight: 22 },
  actualPie:    { fontSize: 14, color: '#8A8A8A', marginTop: 4, marginLeft: 31 },
  corregirBtn:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginLeft: 31 },
  corregirTexto:{ fontSize: 14, color: '#FFD600', fontWeight: '600' },
  ayudita:      { fontSize: 14, color: '#8A8A8A', lineHeight: 20, marginBottom: 10, marginTop: -2 },
  cancelarCorreccion: { fontSize: 14, color: '#8A8A8A', paddingVertical: 12 },

  fila: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 8,
  },
  filaTexto:   { flex: 1, fontSize: 16, color: '#FFFFFF' },
  filaTextoOn: { fontWeight: '600' },

  campoRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  campo: {
    flex: 1, backgroundColor: '#161616', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 16,
    color: '#FFFFFF', fontSize: 16,
  },
  agregar: {
    width: 52, height: 52, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  error: { fontSize: 14, color: '#E5484D', marginTop: 8 },

  cerrar: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  cerrarTexto: { fontSize: 16, color: '#8A8A8A' },
});

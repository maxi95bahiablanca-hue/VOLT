import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, TextInput, Image, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FICHAS } from '../utils/asesoramiento';

const FOTO = (nombre) => `https://bolt.com.ar/fotos/oficios/${nombre}.jpg`;

const norm = (t) => String(t || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

/** Asesoramiento: entender el problema antes de llamar a alguien.
 *
 *  Existía sólo en la web y no tenía UN link en toda la app. El contenido es
 *  el mismo archivo (gemelo de bolt-web/asesoramiento/datos.js) para que no se
 *  desfasen las dos versiones.
 */
export default function AsesoramientoScreen({ onClose }) {
  const [busca, setBusca] = useState('');
  const [oficio, setOficio] = useState(null);
  const [abierta, setAbierta] = useState(null);

  const oficios = useMemo(
    () => Array.from(new Set(FICHAS.map(f => f.oficio))).sort((a, b) => a.localeCompare(b, 'es')),
    []
  );

  const lista = useMemo(() => {
    const q = norm(busca).trim();
    return FICHAS.filter(f => {
      if (oficio && f.oficio !== oficio) return false;
      if (!q) return true;
      return norm(`${f.titulo} ${f.resumen} ${f.oficio} ${f.sintomas} ${f.causas}`).includes(q);
    });
  }, [busca, oficio]);

  /* ── Una ficha abierta ────────────────────────────────────────────────── */
  if (abierta) {
    const f = abierta;
    const bloques = [
      { t: 'Cómo darse cuenta', v: f.sintomas, i: 'eye-outline' },
      { t: 'Por qué pasa',      v: f.causas,   i: 'help-circle-outline' },
      { t: 'Qué podés hacer',   v: f.hacer,    i: 'construct-outline' },
    ].filter(b => !!b.v);

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setAbierta(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow} numberOfLines={1}>{f.oficio}</Text>
            <Text style={styles.hTitulo} numberOfLines={1}>Asesoramiento</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Image source={{ uri: FOTO(f.foto) }} style={styles.fichaFoto} />
          <Text style={styles.fichaTitulo}>{f.titulo}</Text>
          <Text style={styles.fichaResumen}>{f.resumen}</Text>

          {bloques.map(b => (
            <View key={b.t} style={styles.bloque}>
              <View style={styles.bloqueTop}>
                <Ionicons name={b.i} size={17} color="#8A8A8A" />
                <Text style={styles.bloqueTitulo}>{b.t}</Text>
              </View>
              <Text style={styles.bloqueTexto}>{b.v}</Text>
            </View>
          ))}

          {!!f.ojo && (
            <View style={styles.ojo}>
              <View style={styles.bloqueTop}>
                <Ionicons name="alert-circle" size={17} color="#E5484D" />
                <Text style={[styles.bloqueTitulo, { color: '#E5484D' }]}>Ojo con esto</Text>
              </View>
              <Text style={styles.bloqueTexto}>{f.ojo}</Text>
            </View>
          )}

          {!!f.costo && (
            <View style={styles.bloque}>
              <View style={styles.bloqueTop}>
                <Ionicons name="pricetag-outline" size={17} color="#8A8A8A" />
                <Text style={styles.bloqueTitulo}>Cuánto suele salir</Text>
              </View>
              <Text style={styles.bloqueTexto}>{f.costo}</Text>
            </View>
          )}

          {!!f.marcas && (
            <View style={styles.bloque}>
              <View style={styles.bloqueTop}>
                <Ionicons name="cart-outline" size={17} color="#8A8A8A" />
                <Text style={styles.bloqueTitulo}>Qué pedir en el corralón</Text>
              </View>
              <Text style={styles.bloqueTexto}>{f.marcas}</Text>
            </View>
          )}

          <View style={styles.cierre}>
            <Text style={styles.cierreTexto}>
              Esto es para entender el problema, no para reemplazar al que sabe. Si hay gas,
              electricidad de la acometida o estructura de por medio, se llama a un profesional.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── El listado ───────────────────────────────────────────────────────── */
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Asesoramiento</Text>
          <Text style={styles.hTitulo}>Antes de llamar</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Qué le pasa a tu casa, por qué pasa y qué podés hacer sin riesgo. Escrito para
          entender el problema, no para reemplazar al que sabe.
        </Text>

        <View style={styles.buscador}>
          <Ionicons name="search" size={18} color="#5C5C5C" />
          <TextInput
            style={styles.buscadorInput}
            placeholder="Humedad, se corta la luz, no calienta…"
            placeholderTextColor="#5C5C5C"
            value={busca}
            onChangeText={setBusca}
            returnKeyType="search"
          />
          {!!busca && (
            <TouchableOpacity onPress={() => setBusca('')} accessibilityLabel="Borrar la búsqueda">
              <Ionicons name="close-circle" size={18} color="#5C5C5C" />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ gap: 8, paddingRight: 20 }}>
          <TouchableOpacity style={[styles.chip, !oficio && styles.chipOn]} onPress={() => setOficio(null)}>
            <Text style={[styles.chipTexto, !oficio && styles.chipTextoOn]}>Todos</Text>
          </TouchableOpacity>
          {oficios.map(o => (
            <TouchableOpacity key={o} style={[styles.chip, oficio === o && styles.chipOn]} onPress={() => setOficio(oficio === o ? null : o)}>
              <Text style={[styles.chipTexto, oficio === o && styles.chipTextoOn]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {lista.length === 0 ? (
          <View style={styles.vacio}>
            <Ionicons name="search-outline" size={26} color="#3a3a3a" />
            <Text style={styles.vacioTexto}>
              No encontramos nada con eso. Probá con menos palabras, o pedí un profesional y
              contale el problema.
            </Text>
          </View>
        ) : lista.map((f, i) => (
          <TouchableOpacity key={f.titulo + i} style={styles.tarjeta} onPress={() => setAbierta(f)} activeOpacity={0.85}>
            <Image source={{ uri: FOTO(f.foto) }} style={styles.tarjetaFoto} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.tarjetaOficio}>{f.oficio}</Text>
              <Text style={styles.tarjetaTitulo} numberOfLines={2}>{f.titulo}</Text>
              <Text style={styles.tarjetaResumen} numberOfLines={2}>{f.resumen}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#5C5C5C" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 32 : 8,
    paddingBottom: 16,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  eyebrow: {
    fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase',
    color: '#5C5C5C', fontWeight: '600', marginBottom: 2,
  },
  hTitulo: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },

  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  intro: { fontSize: 15, color: '#8A8A8A', lineHeight: 22, marginBottom: 20 },

  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: 999,
    paddingHorizontal: 18, height: 54, marginBottom: 14,
  },
  buscadorInput: { flex: 1, color: '#FFFFFF', fontSize: 15, padding: 0 },

  // La fila de chips vive en una columna de alto fijo: sin estos dos flags
  // el ScrollView horizontal colapsa a 0 y los chips no se ven.
  chipsRow: { flexGrow: 0, flexShrink: 0, marginBottom: 18, marginHorizontal: -20, paddingHorizontal: 20 },
  chip: { backgroundColor: '#161616', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  chipOn: { backgroundColor: '#FFD600' },
  chipTexto: { fontSize: 14, color: '#8A8A8A' },
  chipTextoOn: { color: '#0D0D0D', fontWeight: '600' },

  tarjeta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 10,
  },
  tarjetaFoto:    { width: 64, height: 64, borderRadius: 16, backgroundColor: '#1E1E1E' },
  tarjetaOficio:  { fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: '#FFD600', fontWeight: '600', marginBottom: 3 },
  tarjetaTitulo:  { fontSize: 15, fontWeight: '600', color: '#FFFFFF', lineHeight: 20, marginBottom: 3 },
  tarjetaResumen: { fontSize: 13, color: '#8A8A8A', lineHeight: 18 },

  vacio: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 20 },
  vacioTexto: { fontSize: 15, color: '#5C5C5C', textAlign: 'center', lineHeight: 22 },

  fichaFoto:    { width: '100%', height: 180, borderRadius: 20, backgroundColor: '#161616', marginBottom: 20 },
  fichaTitulo:  { fontSize: 24, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.6, lineHeight: 30, marginBottom: 8 },
  fichaResumen: { fontSize: 16, color: '#8A8A8A', lineHeight: 24, marginBottom: 22 },

  bloque:       { backgroundColor: '#161616', borderRadius: 20, padding: 18, marginBottom: 10 },
  bloqueTop:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  bloqueTitulo: { fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: '#8A8A8A', fontWeight: '600' },
  bloqueTexto:  { fontSize: 15, color: '#FFFFFF', lineHeight: 24 },

  ojo: {
    backgroundColor: 'rgba(229,72,77,0.08)', borderRadius: 20,
    padding: 18, marginBottom: 10,
  },

  cierre:      { marginTop: 18, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: '#262626' },
  cierreTexto: { fontSize: 14, color: '#5C5C5C', lineHeight: 21 },
});

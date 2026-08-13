import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, TextInput, Image, Platform, Share, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CALCULADORAS, SIN_CALCULO } from '../utils/calculadora';
import { fotoDeOficio } from '../utils/fotosOficios';

/** La calculadora de materiales.
 *
 *  Misma lógica y mismos coeficientes que bolt.com.ar/calculadora — el archivo
 *  de datos es gemelo. Acá va nativa y no como página embebida porque se usa
 *  adentro de una obra, parado frente a una pared, y ahí puede no haber señal.
 */
export default function CalculadoraScreen({ onClose }) {
  const [abierta, setAbierta] = useState(null);   // índice de la calculadora
  const [valores, setValores] = useState({});

  const calc = abierta != null ? CALCULADORAS[abierta] : null;

  const abrir = (i) => {
    const c = CALCULADORAS[i];
    const v = {};
    c.campos.forEach(f => { v[f.k] = f.def; });
    setValores(v);
    setAbierta(i);
  };

  const setV = (k, valor) => {
    const f = calc.campos.find(x => x.k === k);
    setValores(prev => {
      // Las opciones y el sí/no son valores cerrados: entran tal cual.
      if (f.tipo === 'opciones') return { ...prev, [k]: valor };
      if (f.tipo === 'si-no')    return { ...prev, [k]: valor ? 1 : 0 };

      // Los números se guardan como texto mientras se escriben. Si se
      // convertían en el acto, tipear "4," borraba la coma antes de poder
      // poner el decimal y no se podía escribir 4,5.
      const txt = String(valor).replace(',', '.');
      if (txt !== '' && !/^\d*\.?\d*$/.test(txt)) return prev;
      return { ...prev, [k]: txt };
    });
  };

  // Lo que ve la fórmula: el texto ya convertido, vacío = 0 y dentro de tope.
  const num = (f, crudo) => {
    let n = Number(String(crudo ?? '').replace(',', '.'));
    if (!isFinite(n)) n = 0;
    n = Math.max(0, n);
    if (f.min != null) n = Math.max(f.min, n);
    if (f.max != null) n = Math.min(f.max, n);
    return n;
  };

  // Los pasos de 0,1 arrastran errores de coma flotante: se redondea siempre.
  const paso = (k, dir) => {
    const f = calc.campos.find(x => x.k === k);
    const p = f.paso || 1;
    setV(k, String(Math.round((num(f, valores[k]) + dir * p) * 100) / 100));
  };

  const resultado = useMemo(() => {
    if (!calc) return null;
    const limpios = {};
    calc.campos.forEach(f => {
      limpios[f.k] = (f.tipo === 'opciones') ? valores[f.k] : num(f, valores[f.k]);
    });
    try { return calc.calcular(limpios); } catch { return null; }
  }, [calc, valores]);

  const textoLista = () => {
    if (!calc || !resultado) return '';
    return `${calc.titulo} — ${calc.oficio}\n\n` +
      resultado.partidas.map(p => `• ${p.item}: ${p.cantidad} ${p.unidad}`).join('\n') +
      `\n\nSupuestos:\n${resultado.supuestos.map(s => `– ${s}`).join('\n')}` +
      `\n\nCalculado con BOLT`;
  };

  /* ── La lista de trabajos ─────────────────────────────────────────────── */
  if (!calc) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Materiales</Text>
            <Text style={styles.hTitulo}>Cuánto comprar</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>
            Poné las medidas y te decimos qué lleva el trabajo, con los rendimientos que usa
            cualquier presupuesto de obra.
          </Text>

          {CALCULADORAS.map((c, i) => {
            const foto = fotoDeOficio(c.oficio);
            return (
              <TouchableOpacity key={c.id} style={styles.tarjeta} onPress={() => abrir(i)} activeOpacity={0.85}>
                {foto
                  ? <Image source={{ uri: foto }} style={styles.tarjetaFoto} />
                  : <View style={[styles.tarjetaFoto, styles.tarjetaSinFoto]}>
                      <Ionicons name="construct-outline" size={20} color="#5C5C5C" />
                    </View>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.tarjetaOficio}>{c.oficio}</Text>
                  <Text style={styles.tarjetaTitulo} numberOfLines={2}>{c.titulo}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#5C5C5C" />
              </TouchableOpacity>
            );
          })}

          <Text style={[styles.eyebrow, { marginTop: 24, marginBottom: 8 }]}>Estos no se calculan</Text>
          <Text style={styles.introChico}>
            En estos trabajos el material depende de lo que se encuentra al abrir. Un número
            inventado es peor que ninguno.
          </Text>
          {SIN_CALCULO.map(s => (
            <View key={s.oficio} style={styles.noCalc}>
              <Text style={styles.noCalcOficio}>{s.oficio}</Text>
              <Text style={styles.noCalcMotivo}>{s.motivo}</Text>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── Una calculadora abierta ──────────────────────────────────────────── */
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setAbierta(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver a la lista">
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow} numberOfLines={1}>{calc.oficio}</Text>
          <Text style={styles.hTitulo} numberOfLines={1}>{calc.titulo}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{calc.subtitulo}</Text>

        {/* Las medidas */}
        {calc.campos.map(f => (
          <View key={f.k} style={styles.campo}>
            <Text style={styles.campoLabel}>{f.label}</Text>

            {f.tipo === 'si-no' ? (
              <View style={styles.ops}>
                {[{ v: 1, t: 'Sí' }, { v: 0, t: 'No' }].map(o => (
                  <TouchableOpacity key={o.t}
                    style={[styles.op, valores[f.k] === o.v && styles.opOn]}
                    onPress={() => setV(f.k, o.v)}>
                    <Text style={[styles.opTexto, valores[f.k] === o.v && styles.opTextoOn]}>{o.t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : f.tipo === 'opciones' ? (
              <View style={styles.ops}>
                {f.opciones.map(o => (
                  <TouchableOpacity key={o.v}
                    style={[styles.op, valores[f.k] === o.v && styles.opOn]}
                    onPress={() => setV(f.k, o.v)}>
                    <Text style={[styles.opTexto, valores[f.k] === o.v && styles.opTextoOn]}>{o.t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.num}>
                <TouchableOpacity style={styles.numBtn} onPress={() => paso(f.k, -1)} accessibilityLabel="Menos">
                  <Ionicons name="remove" size={22} color="#8A8A8A" />
                </TouchableOpacity>
                <TextInput
                  style={styles.numInput}
                  value={String(valores[f.k] ?? '')}
                  onChangeText={t => setV(f.k, t)}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
                {!!f.unidad && <Text style={styles.numUnidad}>{f.unidad}</Text>}
                <TouchableOpacity style={styles.numBtn} onPress={() => paso(f.k, 1)} accessibilityLabel="Más">
                  <Ionicons name="add" size={22} color="#8A8A8A" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}

        {/* El resultado */}
        {!!resultado && (
          <View style={styles.resultado}>
            <Text style={styles.eyebrow}>Lo que hay que comprar</Text>

            {resultado.superficie != null && (
              <View style={styles.supFila}>
                <Text style={styles.supNum}>{resultado.superficie.toFixed(1)}</Text>
                <Text style={styles.supTxt}>m² de superficie</Text>
              </View>
            )}

            {resultado.partidas.map((p, i) => (
              <View key={i} style={styles.partida}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.partidaItem}>{p.item}</Text>
                  {!!p.detalle && <Text style={styles.partidaDetalle}>{p.detalle}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.partidaCant}>{p.cantidad}</Text>
                  <Text style={styles.partidaUnidad}>{p.unidad}</Text>
                </View>
              </View>
            ))}

            <View style={styles.supuestos}>
              <Text style={styles.supuestosTitulo}>Con estos supuestos</Text>
              {resultado.supuestos.map((s, i) => (
                <Text key={i} style={styles.supuestoItem}>· {s}</Text>
              ))}
            </View>

            {!!resultado.nota && <Text style={styles.nota}>{resultado.nota}</Text>}

            <TouchableOpacity
              style={styles.btnPrimario}
              onPress={() => Share.share({ message: textoLista() }).catch(() => {})}
            >
              <Ionicons name="share-social-outline" size={19} color="#0D0D0D" />
              <Text style={styles.btnPrimarioTexto}>Compartir la lista</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnSec}
              onPress={() => Linking.openURL('https://wa.me/?text=' + encodeURIComponent(textoLista())).catch(() => {})}
            >
              <Ionicons name="logo-whatsapp" size={19} color="#FFFFFF" />
              <Text style={styles.btnSecTexto}>Mandar por WhatsApp</Text>
            </TouchableOpacity>
          </View>
        )}
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
  intro:      { fontSize: 15, color: '#8A8A8A', lineHeight: 22, marginBottom: 24 },
  introChico: { fontSize: 14, color: '#8A8A8A', lineHeight: 20, marginBottom: 12 },

  tarjeta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 10,
  },
  tarjetaFoto:   { width: 52, height: 52, borderRadius: 14, backgroundColor: '#1E1E1E' },
  tarjetaSinFoto:{ alignItems: 'center', justifyContent: 'center' },
  tarjetaOficio: { fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: '#FFD600', fontWeight: '600', marginBottom: 3 },
  tarjetaTitulo: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', lineHeight: 21 },

  noCalc:       { backgroundColor: '#161616', borderRadius: 16, padding: 14, marginBottom: 8 },
  noCalcOficio: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginBottom: 3 },
  noCalcMotivo: { fontSize: 14, color: '#8A8A8A', lineHeight: 20 },

  campo:      { marginBottom: 20 },
  campoLabel: { fontSize: 15, color: '#8A8A8A', marginBottom: 10 },
  num: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 999, overflow: 'hidden',
  },
  numBtn:    { width: 52, height: 56, alignItems: 'center', justifyContent: 'center' },
  numInput:  { flex: 1, color: '#FFFFFF', fontSize: 20, fontWeight: '700', textAlign: 'center', padding: 0 },
  numUnidad: { color: '#5C5C5C', fontSize: 14, paddingRight: 6 },

  ops:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  op:       { backgroundColor: '#161616', borderRadius: 999, paddingVertical: 13, paddingHorizontal: 20 },
  opOn:     { backgroundColor: '#FFD600' },
  opTexto:  { fontSize: 15, color: '#FFFFFF' },
  opTextoOn:{ color: '#0D0D0D', fontWeight: '600' },

  resultado: { marginTop: 12, backgroundColor: '#161616', borderRadius: 20, padding: 20 },
  supFila:   { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 18,
               paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#262626' },
  supNum:    { fontSize: 34, fontWeight: '700', color: '#FFFFFF', letterSpacing: -1 },
  supTxt:    { fontSize: 14, color: '#5C5C5C' },

  partida:        { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingVertical: 13,
                    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  partidaItem:    { fontSize: 15, color: '#FFFFFF', fontWeight: '500', marginBottom: 2 },
  partidaDetalle: { fontSize: 13, color: '#5C5C5C', lineHeight: 18 },
  partidaCant:    { fontSize: 20, fontWeight: '700', color: '#FFD600', letterSpacing: -0.4 },
  partidaUnidad:  { fontSize: 12, color: '#5C5C5C' },

  supuestos:       { backgroundColor: 'rgba(255,214,0,0.05)', borderRadius: 16, padding: 16, marginTop: 18 },
  supuestosTitulo: { fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: '#FFD600',
                     fontWeight: '600', marginBottom: 10 },
  supuestoItem:    { fontSize: 14, color: '#8A8A8A', lineHeight: 21, marginBottom: 3 },
  nota:            { fontSize: 14, color: '#8A8A8A', lineHeight: 21, marginTop: 14,
                     paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: '#262626' },

  btnPrimario: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 16, marginTop: 20,
  },
  btnPrimarioTexto: { fontSize: 16, fontWeight: '600', color: '#0D0D0D' },
  btnSec: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#1E1E1E', borderRadius: 999, paddingVertical: 16, marginTop: 8,
  },
  btnSecTexto: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});

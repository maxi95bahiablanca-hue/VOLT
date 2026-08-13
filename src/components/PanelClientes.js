import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showSuccess, showError } from '../utils/toast';
import presupuestoService, {
  infoEstado, linkWhatsAppPresupuesto,
} from '../services/presupuestoService';

// ─────────────────────────────────────────────────────────────────────────────
// La pestaña "Clientes" de Mi negocio: la libreta del trabajador.
//
// Maxi (5-ago): "que puedan agregar clientes al sistema y que se los ordene, les
// marque qué oficio pidieron cada uno, una tarjeta de cada trabajo que hiciste a
// esa persona".
//
// Los oficios NO se guardan en el cliente: salen de los presupuestos que le hizo
// (presupuestos.profesion_id). La misma persona te llama para electricidad en
// marzo y para plomería en agosto — el oficio es del trabajo, no de la persona.
//
// Un cliente y sus presupuestos se cruzan por `cliente_id`, y también por los
// últimos 8 dígitos del teléfono: el mismo número se escribe de cinco formas
// distintas (con 0, con 15, con +54, con guiones) y muchos presupuestos se
// hicieron con el nombre suelto, antes de que la persona estuviera en la libreta.
// ─────────────────────────────────────────────────────────────────────────────

const digitos = (s) => String(s ?? '').replace(/\D/g, '');

const fechaCorta = (iso) =>
  new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

// Buscar "jose" tiene que encontrar a "José". Se hace a mano y no con
// normalize('NFD'): no todos los motores de JS de los celulares viejos lo traen.
const ACENTOS = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u' };
const sinAcentos = (s) =>
  String(s ?? '').toLowerCase().replace(/[áéíóúüñàèìòù]/g, (m) => ACENTOS[m] || m);

const PanelClientes = ({
  professionalId,
  clientes = [],
  presupuestos = [],
  empresa = 'BOLT',
  loading = false,
  onCreado,
}) => {
  const [q, setQ]                 = useState('');
  const [ficha, setFicha]         = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [nombre, setNombre]       = useState('');
  const [telefono, setTelefono]   = useState('');
  const [direccion, setDireccion] = useState('');
  const [notas, setNotas]         = useState('');

  // ─── Cruce cliente ↔ presupuestos ────────────────────────────────────────
  const presupuestosDe = (c) => {
    if (!c) return [];
    const cola = digitos(c.telefono).slice(-8);
    return presupuestos.filter(p =>
      p.cliente_id === c.id ||
      (cola.length >= 6 && digitos(p.cliente_tel).endsWith(cola)),
    );
  };

  // Nombre, teléfono, oficios pedidos, cuántos trabajos y cuánto facturó.
  const resumen = (c) => {
    const ps = presupuestosDe(c);
    const oficios = [...new Set(ps.map(p => p.professions?.name).filter(Boolean))];
    const hechos  = ps.filter(p => p.estado === 'aceptado');
    return {
      ps,
      oficios,
      cantidad:  ps.length,
      hechos:    hechos.length,
      facturado: hechos.reduce((a, p) => a + (Number(p.total) || 0), 0),
    };
  };

  // Ordenados alfabéticamente: la libreta se usa para buscar a alguien por el
  // nombre, no para ver quién se cargó último.
  const ordenados = useMemo(
    () => [...clientes].sort((a, b) =>
      String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' })),
    [clientes],
  );

  const conBuscador = clientes.length > 8;

  const visibles = useMemo(() => {
    const t = sinAcentos(q).trim();
    if (!t) return ordenados;
    // Ojo: sin el mínimo de dígitos, buscar "jose" (que no tiene ninguno) haría
    // que `includes('')` diera verdadero para todos y no filtrara nada.
    const d = digitos(q);
    return ordenados.filter(c =>
      sinAcentos(c.nombre).includes(t) || (d.length >= 2 && digitos(c.telefono).includes(d)),
    );
  }, [ordenados, q]);

  // ─── Acciones ─────────────────────────────────────────────────────────────
  const whatsApp = (c) => {
    const hola = `Hola ${(c.nombre || '').split(' ')[0]}! Te escribo de ${empresa}.`;
    Linking.openURL(linkWhatsAppPresupuesto(c.telefono, hola))
      .catch(() => showError('No pudimos abrir WhatsApp. Escribile a mano.'));
  };

  const cerrarForm = () => {
    setShowForm(false);
    setNombre(''); setTelefono(''); setDireccion(''); setNotas('');
  };

  const guardar = async () => {
    if (!nombre.trim()) {
      showError('Con el nombre alcanza, pero hace falta.', 'Falta el nombre');
      return;
    }
    setSaving(true);
    try {
      const c = await presupuestoService.guardarCliente({
        professionalId, nombre, telefono, direccion, notas,
      });
      onCreado?.(c);
      showSuccess(`${nombre.trim().split(' ')[0]} quedó en tus clientes.`);
      cerrarForm();
    } catch {
      showError('No se pudo guardar. Probá de nuevo en un momento.');
    } finally {
      setSaving(false);
    }
  };

  const fichaResumen = ficha ? resumen(ficha) : null;

  return (
    <View>
      <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)} activeOpacity={0.85}>
        <Ionicons name="person-add" size={18} color="#0D0D0D" />
        <Text style={styles.addBtnText}>Agregar cliente</Text>
      </TouchableOpacity>

      {conBuscador && (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color="#5C5C5C" />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Buscar por nombre o teléfono"
            placeholderTextColor="#444"
          />
          {!!q && (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color="#5C5C5C" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color="#FFD600" style={{ marginTop: 40 }} />
      ) : clientes.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="people-outline" size={48} color="#222" />
          <Text style={styles.emptyTitle}>Tu libreta está vacía</Text>
          <Text style={styles.emptyText}>
            Cargá al primero: el vecino, el del kiosco, la señora del aire. Después vas a ver acá
            qué oficio te pidió cada uno y todo lo que le hiciste.
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowForm(true)} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Agregar mi primer cliente</Text>
          </TouchableOpacity>
        </View>
      ) : visibles.length === 0 ? (
        <Text style={styles.sinResultados}>No encontramos a nadie con eso.</Text>
      ) : visibles.map(c => {
        const r = resumen(c);
        return (
          <TouchableOpacity key={c.id} style={styles.card} onPress={() => setFicha(c)} activeOpacity={0.85}>
            <View style={styles.cardTop}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={16} color="#FFD600" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre} numberOfLines={1}>{c.nombre}</Text>
                <Text style={styles.sub}>{c.telefono || 'Sin teléfono'}</Text>
              </View>
              {!!c.telefono && (
                <TouchableOpacity
                  style={styles.waMini}
                  onPress={() => whatsApp(c)}
                  activeOpacity={0.85}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="logo-whatsapp" size={19} color="#0D0D0D" />
                </TouchableOpacity>
              )}
            </View>

            {r.oficios.length > 0 && (
              <View style={styles.oficiosRow}>
                {r.oficios.map(o => (
                  <View key={o} style={styles.oficioChip}>
                    <Text style={styles.oficioChipText}>{o}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.cardBottom}>
              <Text style={styles.meta}>
                {r.cantidad} presupuesto{r.cantidad === 1 ? '' : 's'}
                {r.hechos > 0 ? ` · ${r.hechos} hecho${r.hechos === 1 ? '' : 's'}` : ''}
              </Text>
              {r.facturado > 0 && (
                <Text style={styles.facturado}>${r.facturado.toLocaleString('es-AR')}</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}

      {/* ─── Ficha del cliente ──────────────────────────────────────────── */}
      <Modal visible={!!ficha} transparent animationType="slide" onRequestClose={() => setFicha(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {!!ficha && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.sheetTop}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>{ficha.nombre}</Text>
                  <TouchableOpacity onPress={() => setFicha(null)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={22} color="#5C5C5C" />
                  </TouchableOpacity>
                </View>

                {!!ficha.telefono  && <Text style={styles.dato}>📞 {ficha.telefono}</Text>}
                {!!ficha.direccion && <Text style={styles.dato}>📍 {ficha.direccion}</Text>}
                {!!ficha.notas     && <Text style={styles.notas}>{ficha.notas}</Text>}

                <View style={styles.fichaStats}>
                  <View style={styles.fichaStat}>
                    <Text style={styles.fichaStatVal}>{fichaResumen.hechos}</Text>
                    <Text style={styles.fichaStatLbl}>Trabajos hechos</Text>
                  </View>
                  <View style={styles.fichaDiv} />
                  <View style={styles.fichaStat}>
                    <Text style={[styles.fichaStatVal, { color: '#FFD600', fontSize: 16 }]}>
                      ${fichaResumen.facturado.toLocaleString('es-AR')}
                    </Text>
                    <Text style={styles.fichaStatLbl}>Facturado</Text>
                  </View>
                </View>

                {!!ficha.telefono && (
                  <TouchableOpacity style={styles.waBtn} onPress={() => whatsApp(ficha)} activeOpacity={0.85}>
                    <Ionicons name="logo-whatsapp" size={20} color="#0D0D0D" />
                    <Text style={styles.waBtnText}>Escribirle por WhatsApp</Text>
                  </TouchableOpacity>
                )}

                <Text style={styles.histTitle}>Lo que le hiciste</Text>

                {fichaResumen.ps.length === 0 ? (
                  <Text style={styles.histVacio}>
                    Todavía no le hiciste ningún presupuesto. Cuando le hagas uno, va a aparecer acá.
                  </Text>
                ) : (
                  [...fichaResumen.ps]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .map(p => {
                      const s     = infoEstado(p.estado);
                      const hecho = p.estado === 'aceptado';
                      return (
                        <View key={p.id} style={[styles.trabajoCard, hecho && styles.trabajoCardHecho]}>
                          <View style={styles.trabajoTop}>
                            <Text style={styles.trabajoFecha}>{fechaCorta(p.created_at)}</Text>
                            <View style={[styles.chip, { backgroundColor: s.color + '18', borderColor: s.color + '40' }]}>
                              <Text style={[styles.chipText, { color: s.color }]}>{s.label}</Text>
                            </View>
                          </View>

                          {!!p.professions?.name && (
                            <View style={styles.oficioChipSolo}>
                              <Text style={styles.oficioChipText}>{p.professions.name}</Text>
                            </View>
                          )}

                          <Text style={styles.trabajoDesc}>{p.descripcion}</Text>

                          <View style={styles.trabajoBottom}>
                            <Text style={styles.trabajoNumero}>N°{p.numero}</Text>
                            <Text style={[styles.trabajoTotal, hecho && { color: '#FFD600' }]}>
                              ${Number(p.total || 0).toLocaleString('es-AR')}
                            </Text>
                          </View>
                        </View>
                      );
                    })
                )}

                <View style={{ height: 16 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ─── Alta de cliente ────────────────────────────────────────────── */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={cerrarForm}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.sheetTop}>
                <Text style={styles.sheetTitle}>Nuevo cliente</Text>
                <TouchableOpacity onPress={cerrarForm} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color="#5C5C5C" />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Nombre</Text>
              <TextInput
                style={styles.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="María González"
                placeholderTextColor="#444"
                autoFocus
              />

              <Text style={styles.label}>WhatsApp <Text style={styles.opcional}>· opcional</Text></Text>
              <TextInput
                style={styles.input}
                value={telefono}
                onChangeText={setTelefono}
                placeholder="291 419-9938"
                placeholderTextColor="#444"
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Dirección <Text style={styles.opcional}>· opcional</Text></Text>
              <TextInput
                style={styles.input}
                value={direccion}
                onChangeText={setDireccion}
                placeholder="Alsina 250, 2° B"
                placeholderTextColor="#444"
              />

              <Text style={styles.label}>Notas <Text style={styles.opcional}>· opcional</Text></Text>
              <TextInput
                style={[styles.input, { height: 84 }]}
                value={notas}
                onChangeText={setNotas}
                placeholder="Tiene termotanque Rheem. Atiende después de las 14."
                placeholderTextColor="#444"
                multiline
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.guardarBtn, (!nombre.trim() || saving) && { opacity: 0.35 }]}
                onPress={guardar}
                disabled={!nombre.trim() || saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#0D0D0D" />
                  : <Text style={styles.guardarBtnText}>Guardar cliente</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelarBtn} onPress={cerrarForm} disabled={saving}>
                <Text style={styles.cancelarText}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 16, marginBottom: 12,
  },
  addBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#161616', borderRadius: 20, paddingHorizontal: 12, marginBottom: 12,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 11 },

  card: {
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center',
  },
  nombre: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  sub:    { color: '#5C5C5C', fontSize: 14, marginTop: 2 },
  waMini: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: '#8A8A8A',
    alignItems: 'center', justifyContent: 'center',
  },

  oficiosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  oficioChip: {
    backgroundColor: '#FFD60014', borderWidth: 1, borderColor: '#FFD60033',
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  oficioChipSolo: {
    alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: '#FFD60014', borderWidth: 1, borderColor: '#FFD60033',
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  oficioChipText: { color: '#FFD600', fontSize: 12, fontWeight: '600' },

  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  meta:      { color: '#5C5C5C', fontSize: 14 },
  facturado: { color: '#FFD600', fontSize: 16, fontWeight: '600' },

  emptyWrap:  { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#333' },
  emptyText:  { fontSize: 16, color: '#444', textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  emptyBtn: {
    borderWidth: 1, borderColor: '#FFD60055', borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 13, marginTop: 6,
  },
  emptyBtnText: { color: '#FFD600', fontSize: 16, fontWeight: '600' },
  sinResultados: { color: '#5C5C5C', fontSize: 14, textAlign: 'center', paddingVertical: 32 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 22, maxHeight: '90%',
  },
  sheetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 },
  sheetTitle: { flex: 1, color: '#FFFFFF', fontSize: 19, fontWeight: '700' },

  dato:  { color: '#ccc', fontSize: 16, marginBottom: 6 },
  notas: { color: '#8A8A8A', fontSize: 14, lineHeight: 19, marginTop: 4 },

  fichaStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 20, padding: 16, marginTop: 16,
  },
  fichaStat: { flex: 1, alignItems: 'center' },
  fichaStatVal: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  fichaStatLbl: { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8 },
  fichaDiv: { width: 1, height: 32, backgroundColor: '#1E1E1E' },

  waBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: '#8A8A8A', borderRadius: 999, paddingVertical: 16, marginTop: 14,
  },
  waBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  histTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginTop: 22, marginBottom: 10 },
  histVacio: { color: '#5C5C5C', fontSize: 14, lineHeight: 19, paddingBottom: 8 },

  trabajoCard: {
    backgroundColor: '#161616', borderRadius: 20, padding: 13, marginBottom: 9,
  },
  // Los aceptados son los trabajos que realmente hizo: se ven distinto.
  trabajoCardHecho: { borderColor: '#FFD60040', backgroundColor: '#0D140D' },
  trabajoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trabajoFecha: { color: '#5C5C5C', fontSize: 14, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: '700' },
  trabajoDesc: { color: '#999', fontSize: 14, lineHeight: 18, marginTop: 8 },
  trabajoBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  trabajoNumero: { color: '#444', fontSize: 14, fontWeight: '700' },
  trabajoTotal: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  label: { color: '#ccc', fontSize: 14, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  opcional: { color: '#5C5C5C', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#161616', borderRadius: 20, color: '#fff', fontSize: 16, padding: 14, marginBottom: 14,
  },

  guardarBtn: { backgroundColor: '#FFD600', borderRadius: 999, padding: 16, alignItems: 'center', marginTop: 4 },
  guardarBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },
  cancelarBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelarText: { color: '#5C5C5C', fontSize: 16, fontWeight: '700' },
});

export default PanelClientes;

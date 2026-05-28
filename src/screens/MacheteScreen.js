import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import MACHETE from '../data/machete';

const MacheteScreen = ({ professional }) => {
  const [professions, setProfessions]   = useState([]);
  const [selectedProf, setSelectedProf] = useState(null);
  const [expandedIdx, setExpandedIdx]   = useState(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => { fetchProfessions(); }, []);

  const fetchProfessions = async () => {
    try {
      const { data } = await supabase
        .from('professional_professions')
        .select('professions(name)')
        .eq('professional_id', professional.id);
      const names = (data || []).map(r => r.professions?.name).filter(Boolean);
      setProfessions(names);
      if (names.length > 0) setSelectedProf(names[0]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const problems = selectedProf && MACHETE ? (MACHETE[selectedProf] || []) : [];

  if (loading) return <ActivityIndicator color="#FFD600" style={{ marginTop: 40 }} />;

  return (
    <View style={styles.wrap}>
      {/* Intro */}
      <View style={styles.introCard}>
        <Ionicons name="flash" size={16} color="#FFD600" />
        <Text style={styles.introText}>
          Guía rápida de problemas frecuentes, causas y materiales con precios de referencia en Argentina.
        </Text>
      </View>

      {/* Selector de profesión (si tiene más de una) */}
      {professions.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.profScroll}
          contentContainerStyle={styles.profScrollContent}
        >
          {professions.map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.profChip, selectedProf === p && styles.profChipActive]}
              onPress={() => { setSelectedProf(p); setExpandedIdx(null); }}
            >
              <Text style={[styles.profChipText, selectedProf === p && styles.profChipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Profesión seleccionada */}
      {selectedProf && (
        <Text style={styles.profTitle}>{selectedProf}</Text>
      )}

      {/* Problemas */}
      {problems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="construct-outline" size={40} color="#222" />
          <Text style={styles.emptyText}>
            {professions.length === 0
              ? 'No tenés profesiones registradas'
              : 'No hay guía para esta profesión todavía'}
          </Text>
        </View>
      ) : problems.map((item, idx) => {
        const open = expandedIdx === idx;
        return (
          <TouchableOpacity
            key={idx}
            style={[styles.problemCard, open && styles.problemCardOpen]}
            onPress={() => setExpandedIdx(open ? null : idx)}
            activeOpacity={0.8}
          >
            {/* Header del problema */}
            <View style={styles.problemHeader}>
              <Ionicons
                name={open ? 'chevron-up-circle' : 'chevron-down-circle-outline'}
                size={20}
                color={open ? '#FFD600' : '#444'}
              />
              <Text style={[styles.problemTitle, open && styles.problemTitleOpen]}>
                {item.problema}
              </Text>
            </View>

            {/* Cuerpo expandido */}
            {open && (
              <View style={styles.problemBody}>
                {/* Causa */}
                <View style={styles.causaBox}>
                  <Text style={styles.causaLabel}>Causa probable</Text>
                  <Text style={styles.causaText}>{item.causa}</Text>
                </View>

                {/* Pasos */}
                <Text style={styles.sectionLabel}>Pasos a seguir</Text>
                {item.solucion.map((paso, i) => (
                  <View key={i} style={styles.stepRow}>
                    <View style={styles.stepBubble}>
                      <Text style={styles.stepNum}>{i + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{paso}</Text>
                  </View>
                ))}

                {/* Materiales */}
                <Text style={styles.sectionLabel}>Materiales necesarios</Text>
                {item.materiales.map((mat, i) => (
                  <View key={i} style={styles.matRow}>
                    <Ionicons name="checkmark-circle" size={14} color="#4CAF50" style={{ marginTop: 2, flexShrink: 0 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matText}>{typeof mat === 'string' ? mat : mat.item}</Text>
                      {typeof mat === 'object' && mat.marca && (
                        <Text style={styles.matSub}>{mat.marca} · {mat.precio}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        );
      })}

      <View style={{ height: 16 }} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16 },

  introCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#0D0D00', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a00',
    padding: 12, marginBottom: 14,
  },
  introText: { flex: 1, fontSize: 12, color: '#888', lineHeight: 18 },

  profScroll: { marginBottom: 6 },
  profScrollContent: { gap: 8, paddingRight: 4 },
  profChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: '#111', borderRadius: 20,
    borderWidth: 1, borderColor: '#222',
  },
  profChipActive: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  profChipText:       { fontSize: 13, color: '#555', fontWeight: '600' },
  profChipTextActive: { color: '#0A0A0A' },

  profTitle: {
    fontSize: 16, fontWeight: '800', color: '#FFD600',
    marginBottom: 10, marginTop: 4,
  },

  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { color: '#333', fontSize: 14, textAlign: 'center' },

  problemCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    marginBottom: 8, overflow: 'hidden',
  },
  problemCardOpen: { borderColor: '#FFD60040' },

  problemHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14,
  },
  problemTitle:     { flex: 1, fontSize: 14, fontWeight: '600', color: '#CCC', lineHeight: 20 },
  problemTitleOpen: { color: '#F5F5F5', fontWeight: '700' },

  problemBody: {
    paddingHorizontal: 14, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: '#1E1E1E',
    paddingTop: 12,
  },

  causaBox: {
    backgroundColor: '#0A0A0A', borderRadius: 10, padding: 12, marginBottom: 14,
    borderLeftWidth: 3, borderLeftColor: '#FF9800',
  },
  causaLabel: { fontSize: 10, color: '#FF9800', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  causaText:  { fontSize: 13, color: '#AAA', lineHeight: 19 },

  sectionLabel: {
    fontSize: 10, color: '#555', fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 14,
  },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  stepBubble: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNum:  { fontSize: 11, fontWeight: '900', color: '#0A0A0A' },
  stepText: { flex: 1, fontSize: 13, color: '#CCC', lineHeight: 19 },

  matRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  matText: { fontSize: 13, color: '#CCC', lineHeight: 18, fontWeight: '500' },
  matSub:  { fontSize: 11, color: '#555', marginTop: 1 },
});

export default MacheteScreen;

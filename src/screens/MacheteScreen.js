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
                    <Ionicons name="checkmark-circle" size={14} color="#FFD600" style={{ marginTop: 2, flexShrink: 0 }} />
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
    backgroundColor: '#0D0D00', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a00',
    padding: 12, marginBottom: 14,
  },
  introText: { flex: 1, fontSize: 14, color: '#8A8A8A', lineHeight: 18 },

  profScroll: { marginBottom: 6 },
  profScrollContent: { gap: 8, paddingRight: 4 },
  profChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: '#161616', borderRadius: 999,
    },
  profChipActive: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  profChipText:       { fontSize: 14, color: '#5C5C5C', fontWeight: '600' },
  profChipTextActive: { color: '#0D0D0D' },

  profTitle: {
    fontSize: 16, fontWeight: '600', color: '#FFD600',
    marginBottom: 10, marginTop: 4,
  },

  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { color: '#5C5C5C', fontSize: 16, textAlign: 'center' },

  problemCard: {
    backgroundColor: '#161616', borderRadius: 20,
    marginBottom: 8, overflow: 'hidden',
  },
  problemCardOpen: { borderColor: '#FFD60040' },

  problemHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14,
  },
  problemTitle:     { flex: 1, fontSize: 16, fontWeight: '600', color: '#CCC', lineHeight: 20 },
  problemTitleOpen: { color: '#FFFFFF', fontWeight: '700' },

  problemBody: {
    paddingHorizontal: 14, paddingBottom: 14,
    paddingTop: 12,
  },

  causaBox: {
    backgroundColor: '#161616', borderRadius: 20, padding: 12, marginBottom: 14,
    borderLeftWidth: 3, borderLeftColor: '#8A8A8A',
  },
  causaLabel: { fontSize: 12, color: '#8A8A8A', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 5 },
  causaText:  { fontSize: 14, color: '#AAA', lineHeight: 19 },

  sectionLabel: {
    fontSize: 12, color: '#5C5C5C', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1.8,
    marginBottom: 8, marginTop: 14,
  },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  stepBubble: {
    width: 22, height: 22, borderRadius: 20,
    backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNum:  { fontSize: 12, fontWeight: '700', color: '#0D0D0D' },
  stepText: { flex: 1, fontSize: 14, color: '#CCC', lineHeight: 19 },

  matRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  matText: { fontSize: 14, color: '#CCC', lineHeight: 18, fontWeight: '500' },
  matSub:  { fontSize: 12, color: '#5C5C5C', marginTop: 1 },
});

export default MacheteScreen;

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const Bar = ({ value, color }) => (
  <View style={styles.barTrack}>
    <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }]} />
  </View>
);

const ReputationCard = ({ prof, compact = false }) => {
  const completed  = prof?.completed_jobs   || 0;
  const onTimePct  = completed > 5 && prof?.on_time_completions != null
    ? Math.round((prof.on_time_completions / completed) * 100)
    : null;
  const avgArrival    = prof?.avg_arrival_minutes ?? null;
  const complaints    = prof?.complaints_count    ?? null;
  const recommendPct  = prof?.recommend_pct       ?? null;

  // Nada que mostrar
  if (onTimePct === null && avgArrival === null && complaints === null && recommendPct === null && completed === 0) {
    return null;
  }

  if (compact) {
    // Versión compacta para WorkerCard (HomeScreen)
    return (
      <View style={styles.compactWrap}>
        {onTimePct !== null && (
          <View style={styles.compactRow}>
            <Text style={styles.compactLabel}>Puntualidad</Text>
            <Bar value={onTimePct} color="#4CAF50" />
            <Text style={[styles.compactVal, { color: '#4CAF50' }]}>{onTimePct}%</Text>
          </View>
        )}
        {recommendPct !== null && (
          <View style={styles.compactRow}>
            <Text style={styles.compactLabel}>Recomendado</Text>
            <Bar value={recommendPct} color="#FFD600" />
            <Text style={[styles.compactVal, { color: '#FFD600' }]}>{recommendPct}%</Text>
          </View>
        )}
      </View>
    );
  }

  // Versión completa para QuoteSelectionScreen
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Reputación</Text>

      {/* Puntualidad — barra */}
      {onTimePct !== null && (
        <View style={styles.metricWrap}>
          <View style={styles.metricHeader}>
            <Ionicons name="timer-outline" size={14} color="#4CAF50" />
            <Text style={styles.metricLabel}>Puntualidad</Text>
            <Text style={[styles.metricVal, { color: '#4CAF50' }]}>{onTimePct}%</Text>
          </View>
          <Bar value={onTimePct} color="#4CAF50" />
        </View>
      )}

      {/* Trabajos completados */}
      {completed > 0 && (
        <View style={styles.inlineRow}>
          <Ionicons name="briefcase-outline" size={14} color="#888" />
          <Text style={styles.inlineLabel}>Trabajos completados</Text>
          <Text style={styles.inlineVal}>{completed}</Text>
        </View>
      )}

      {/* Reclamos */}
      {complaints !== null && (
        <View style={styles.inlineRow}>
          <Ionicons
            name="warning-outline"
            size={14}
            color={complaints === 0 ? '#4CAF50' : complaints <= 3 ? '#FF9800' : '#ff4444'}
          />
          <Text style={styles.inlineLabel}>Reclamos</Text>
          <Text style={[
            styles.inlineVal,
            { color: complaints === 0 ? '#4CAF50' : complaints <= 3 ? '#FF9800' : '#ff4444' },
          ]}>
            {complaints === 0 ? '0 ✓' : complaints}
          </Text>
        </View>
      )}

      {/* Respuesta promedio */}
      {avgArrival !== null && (
        <View style={styles.inlineRow}>
          <Ionicons name="flash-outline" size={14} color="#888" />
          <Text style={styles.inlineLabel}>Respuesta promedio</Text>
          <Text style={styles.inlineVal}>{avgArrival} min</Text>
        </View>
      )}

      {/* Recomendado por clientes — barra */}
      {recommendPct !== null && (
        <View style={styles.metricWrap}>
          <View style={styles.metricHeader}>
            <Ionicons name="heart-outline" size={14} color="#FFD600" />
            <Text style={styles.metricLabel}>Recomendado por clientes</Text>
            <Text style={[styles.metricVal, { color: '#FFD600' }]}>{recommendPct}%</Text>
          </View>
          <Bar value={recommendPct} color="#FFD600" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // ── Versión completa ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#0D0D0D', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, gap: 12,
  },
  title: {
    fontSize: 10, fontWeight: '800', color: '#333',
    textTransform: 'uppercase', letterSpacing: 1,
  },

  metricWrap: { gap: 6 },
  metricHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricLabel: { flex: 1, fontSize: 13, color: '#888' },
  metricVal:   { fontSize: 13, fontWeight: '800' },

  barTrack: {
    height: 5, borderRadius: 3,
    backgroundColor: '#1E1E1E', overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineLabel: { flex: 1, fontSize: 13, color: '#666' },
  inlineVal:   { fontSize: 13, fontWeight: '700', color: '#F5F5F5' },

  // ── Versión compacta ──────────────────────────────────────────────────────────
  compactWrap: { gap: 8 },
  compactRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactLabel: { width: 80, fontSize: 10, color: '#555', fontWeight: '600' },
  compactVal:   { fontSize: 11, fontWeight: '800', width: 32, textAlign: 'right' },
});

export default ReputationCard;

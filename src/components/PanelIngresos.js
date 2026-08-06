import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { chargesInApp } from '../config/monetization';

// ─────────────────────────────────────────────────────────────────────────────
// La pestaña "Ingresos" de Mi negocio. Es el mismo bloque que tenía el viejo
// WorkerDashboardScreen: total acumulado, cómo se reparte la comisión y el
// detalle de los últimos 20 trabajos cobrados.
//
// En modo gratis (hoy) no hay comisión: se muestra la actividad, no la plata que
// se queda BOLT, porque BOLT no se queda con nada.
// ─────────────────────────────────────────────────────────────────────────────

const PanelIngresos = ({ jobs = [], professional, commission = 20, level = '', levelColor = '#888' }) => {
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const earningBase   = j => j.work_amount || j.visit_amount || 0;
  const commFactor    = j => 1 - (chargesInApp() ? (j.commission_pct || 20) : 0) / 100;
  const totalEarned   = completedJobs.reduce((acc, j) => acc + Math.round(earningBase(j) * commFactor(j)), 0);

  return (
    <View>
      <View style={styles.earningsSummary}>
        {chargesInApp() ? (
          <>
            <Text style={styles.earningsTotalLabel}>Total acumulado</Text>
            <Text style={styles.earningsTotalVal}>${Math.round(totalEarned).toLocaleString('es-AR')}</Text>
          </>
        ) : (
          <Text style={styles.earningsTotalLabel}>Tu actividad</Text>
        )}
        <Text style={styles.earningsSub}>{completedJobs.length} trabajos completados</Text>
      </View>

      {chargesInApp() && (
        <View style={styles.earningsBreakdown}>
          <Text style={styles.breakdownTitle}>Cómo funciona tu comisión</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Nivel actual</Text>
            <Text style={[styles.breakdownVal, { color: levelColor }]}>{level}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>BOLT retiene</Text>
            <Text style={styles.breakdownVal}>{commission}% del trabajo</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Vos recibís</Text>
            <Text style={[styles.breakdownVal, { color: '#4CAF50' }]}>{100 - commission}% del trabajo</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Visita (${(professional?.min_price ?? 30000).toLocaleString('es-AR')})</Text>
            <Text style={styles.breakdownVal}>La retiene BOLT</Text>
          </View>
        </View>
      )}

      {completedJobs.length === 0 ? (
        <Text style={styles.vacio}>
          Cuando termines tu primer trabajo por BOLT, acá vas a ver lo que te quedó.
        </Text>
      ) : completedJobs.slice(0, 20).map(j => {
        const earned = Math.round(earningBase(j) * commFactor(j));
        return (
          <View key={j.id} style={styles.earningRow}>
            <View>
              <Text style={styles.earningProfession}>{j.professions?.name || 'Trabajo'}</Text>
              <Text style={styles.earningDate}>
                {new Date(j.completed_at || j.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
              </Text>
            </View>
            {chargesInApp() && <Text style={styles.earningAmount}>+${earned.toLocaleString('es-AR')}</Text>}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  earningsSummary: {
    alignItems: 'center', paddingVertical: 28,
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
    marginBottom: 12,
  },
  earningsTotalLabel: { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  earningsTotalVal:   { fontSize: 36, fontWeight: '900', color: '#4CAF50', marginBottom: 4 },
  earningsSub:        { fontSize: 13, color: '#555' },

  earningsBreakdown: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 16, marginBottom: 12, gap: 12,
  },
  breakdownTitle: { fontSize: 13, fontWeight: '800', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 14, color: '#666' },
  breakdownVal:   { fontSize: 14, fontWeight: '700', color: '#F5F5F5' },

  earningRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111',
  },
  earningProfession: { fontSize: 14, color: '#F5F5F5', fontWeight: '600', marginBottom: 2 },
  earningDate:       { fontSize: 12, color: '#444' },
  earningAmount:     { fontSize: 16, fontWeight: '800', color: '#4CAF50' },

  vacio: { color: '#444', fontSize: 13.5, textAlign: 'center', lineHeight: 19, paddingVertical: 24 },
});

export default PanelIngresos;

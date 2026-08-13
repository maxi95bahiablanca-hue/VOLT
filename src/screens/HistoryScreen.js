import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { chargesInApp, isFreeMode } from '../config/monetization';

const STATUS_INFO = {
  pending:          { label: 'Pendiente',       color: '#8A8A8A',    icon: 'time-outline' },
  accepted:         { label: 'En camino',        color: '#FFD600', icon: 'navigate-outline' },
  arrived:          { label: 'En domicilio',     color: '#FFD600', icon: 'home-outline' },
  in_progress:      { label: 'En progreso',      color: '#8A8A8A', icon: 'construct-outline' },
  awaiting_payment: { label: isFreeMode() ? 'Por finalizar' : 'Pago pendiente', color: '#FFD600', icon: isFreeMode() ? 'checkmark-done-outline' : 'card-outline' },
  completed:        { label: 'Completado',        color: '#FFD600', icon: 'checkmark-circle-outline' },
  cancelled:        { label: 'Cancelado',         color: '#E5484D', icon: 'close-circle-outline' },
};

const HistoryScreen = ({ session, professional, onClose, onOpenJob }) => {
  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);

  const isWorker = !!professional;

  useEffect(() => { fetchJobs(); }, []);

  const fetchJobs = async () => {
    try {
      let query = supabase
        .from('jobs')
        .select('*, professions(name), professionals(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (isWorker) {
        query = query.eq('professional_id', professional.id);
      } else {
        query = query.eq('client_id', session.user.id);
      }

      const { data } = await query;
      setJobs(data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); setRefresh(false); }
  };

  const completedJobs = jobs.filter(j => j.status === 'completed');
  // Total que pagó el cliente = visita + materiales + mano de obra
  const totalSpent = completedJobs.reduce((acc, j) => {
    const visit = j.visit_amount    || 0;
    const mats  = j.materials_cost  || 0;
    const work  = j.work_amount     || 0;
    return acc + (work > 0 ? visit + mats + work : visit);
  }, 0);
  // Trabajador recibe = mano de obra × (1 − comisión%) + materiales (sin comisión)
  const totalEarned = completedJobs.reduce((acc, j) => {
    const work  = j.work_amount    || 0;
    const mats  = j.materials_cost || 0;
    const comm  = chargesInApp() ? (j.commission_pct || 20) : 0;
    return acc + Math.round(work * (1 - comm / 100)) + mats;
  }, 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mis trabajos</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); fetchJobs(); }} tintColor="#FFD600" />}
        contentContainerStyle={styles.content}
      >
        {/* Resumen */}
        {completedJobs.length > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryVal}>{completedJobs.length}</Text>
              <Text style={styles.summaryLbl}>Completados</Text>
            </View>
            {chargesInApp() && (
              <>
                <View style={styles.summaryDiv} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryVal, { color: isWorker ? '#FFD600' : '#FFD600', fontSize: 16 }]}>
                    ${(isWorker ? totalEarned : totalSpent).toLocaleString('es-AR')}
                  </Text>
                  <Text style={styles.summaryLbl}>{isWorker ? 'Ganado' : 'Gastado'}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {loading ? (
          <ActivityIndicator color="#FFD600" style={{ marginTop: 48 }} />
        ) : jobs.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="briefcase-outline" size={48} color="#222" />
            <Text style={styles.emptyTitle}>Sin trabajos todavía</Text>
            <Text style={styles.emptyText}>
              {isWorker ? 'Activá tu disponibilidad para empezar a recibir solicitudes.' : 'Buscá un profesional en el mapa para hacer tu primera solicitud.'}
            </Text>
          </View>
        ) : jobs.map(j => {
          // 🔴 Un presupuesto ACEPTADO por el profesional pero que el cliente
          // todavía no eligió sigue en 'accepted' con quote_group_id puesto, y
          // la lista lo mostraba como "En camino" — dando a entender que ya
          // salió cuando en realidad está esperando que lo elijan (Maxi,
          // 1-ago). Nadie tiene que salir a un domicilio por esto.
          const esperandoEleccion = j.quote_group_id && ['pending', 'accepted'].includes(j.status);
          const s = esperandoEleccion
            ? { label: 'Esperando que te elijan', color: '#8A8A8A', icon: 'hourglass-outline' }
            : (STATUS_INFO[j.status] || STATUS_INFO.cancelled);
          const totalAmt = (j.visit_amount || 0) + (j.work_amount || 0);
          const earned   = isWorker && j.status === 'completed'
            ? Math.round((j.work_amount || 0) * (1 - (chargesInApp() ? (j.commission_pct || 20) : 0) / 100))
            : null;

          const isActiveJob = ['pending','accepted','arrived','in_progress','awaiting_payment'].includes(j.status);
          const CardWrap = isActiveJob ? TouchableOpacity : View;
          return (
            <CardWrap key={j.id} style={[styles.jobCard, isActiveJob && { borderColor: s.color + '55' }]} {...(isActiveJob ? { onPress: () => onOpenJob?.(j), activeOpacity: 0.85 } : {})}>
              <View style={styles.jobCardTop}>
                <View style={[styles.jobIconWrap, { backgroundColor: s.color + '15' }]}>
                  <Ionicons name={s.icon} size={18} color={s.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobProfession}>{j.professions?.name || 'Trabajo'}</Text>
                  {isWorker ? null : (
                    j.professionals ? (
                      <Text style={styles.jobPerson}>
                        {j.professionals.first_name} {j.professionals.last_name}
                      </Text>
                    ) : null
                  )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: s.color + '18', borderColor: s.color + '40' }]}>
                  <Text style={[styles.statusText, { color: s.color }]}>{s.label}</Text>
                </View>
              </View>

              {j.address ? (
                <Text style={styles.jobAddress} numberOfLines={1}>
                  <Ionicons name="location-outline" size={12} color="#444" /> {j.address}
                </Text>
              ) : null}

              <View style={styles.jobCardBottom}>
                <Text style={styles.jobDate}>
                  {new Date(j.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                {earned != null && chargesInApp() && (
                  <Text style={styles.earnedAmt}>+${earned.toLocaleString('es-AR')}</Text>
                )}
                {!isWorker && chargesInApp() && totalAmt > 0 && j.status === 'completed' && (
                  <Text style={styles.paidAmt}>-${totalAmt.toLocaleString('es-AR')}</Text>
                )}
                {isActiveJob && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                    <Text style={{ color: s.color, fontSize: 14, fontWeight: '600' }}>Ver seguimiento</Text>
                    <Ionicons name="chevron-forward" size={13} color={s.color} />
                  </View>
                )}
              </View>
            </CardWrap>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },

  content: { padding: 16, paddingBottom: 40 },

  summaryCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 20,
    padding: 20, marginBottom: 16,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryVal:  { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  summaryLbl:  { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8 },
  summaryDiv:  { width: 1, height: 36, backgroundColor: '#1E1E1E' },

  emptyWrap: { alignItems: 'center', paddingVertical: 64, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#5C5C5C' },
  emptyText:  { fontSize: 16, color: '#444', textAlign: 'center', lineHeight: 20, maxWidth: 280 },

  jobCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14, marginBottom: 10,
  },
  jobCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  jobIconWrap: {
    width: 38, height: 38, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  jobProfession: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  jobPerson:     { fontSize: 14, color: '#5C5C5C' },

  statusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 12, fontWeight: '700' },

  jobAddress:    { fontSize: 14, color: '#444', marginBottom: 8 },

  jobCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobDate:    { fontSize: 14, color: '#444' },
  earnedAmt:  { fontSize: 16, fontWeight: '600', color: '#FFD600' },
  paidAmt:    { fontSize: 16, fontWeight: '600', color: '#8A8A8A' },
});

export default HistoryScreen;

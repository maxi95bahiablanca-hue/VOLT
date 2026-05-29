import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, Platform, RefreshControl, Image, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import MacheteScreen from './MacheteScreen';

const STATUS_LABEL = {
  pending:          { label: 'Pendiente',    color: '#888' },
  accepted:         { label: 'En camino',    color: '#4285F4' },
  arrived:          { label: 'En domicilio', color: '#FFD600' },
  in_progress:      { label: 'Trabajando',   color: '#FF9800' },
  awaiting_payment: { label: 'Cobrando',     color: '#4CAF50' },
  completed:        { label: 'Completado',   color: '#4CAF50' },
  cancelled:        { label: 'Cancelado',    color: '#ff4444' },
};

const formatHour = (isoStr) => {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const WorkerDashboardScreen = ({ professional, session, onClose }) => {
  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [tab, setTab]           = useState('jobs'); // 'jobs' | 'earnings' | 'guide'

  const [available, setAvailable]     = useState(professional.available ?? true);
  const [availableAt, setAvailableAt] = useState(professional.available_at ?? null);
  const [availModal, setAvailModal]   = useState(false);
  const [savingAvail, setSavingAvail] = useState(false);

  const commission = professional.completed_jobs >= 100 && professional.avg_rating >= 4.8 ? 10
    : professional.completed_jobs >= 50  && professional.avg_rating >= 4.5 ? 14
    : professional.completed_jobs >= 10  && professional.avg_rating >= 4.0 ? 17 : 20;

  const level = professional.completed_jobs >= 100 && professional.avg_rating >= 4.8 ? 'Elite'
    : professional.completed_jobs >= 50  && professional.avg_rating >= 4.5 ? 'Pro'
    : professional.completed_jobs >= 10  && professional.avg_rating >= 4.0 ? 'Verificado' : 'Nuevo';

  const levelColor = level === 'Elite' ? '#FFD600' : level === 'Pro' ? '#4285F4'
    : level === 'Verificado' ? '#4CAF50' : '#888';

  useEffect(() => {
    fetchJobs();
    // Auto-restaurar disponibilidad si ya pasó la hora programada
    if (availableAt && new Date(availableAt) <= new Date()) {
      handleSetAvailable();
    }
  }, []);

  const handleSetAvailable = async () => {
    setSavingAvail(true);
    try {
      const { error } = await supabase.from('professionals')
        .update({ available: true, available_at: null })
        .eq('id', professional.id);
      if (!error) { setAvailable(true); setAvailableAt(null); }
    } catch {}
    setSavingAvail(false);
  };

  const handleSetUnavailable = async (hours) => {
    setAvailModal(false);
    setSavingAvail(true);
    try {
      const availAt = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
      const { error } = await supabase.from('professionals')
        .update({ available: false, available_at: availAt })
        .eq('id', professional.id);
      if (!error) { setAvailable(false); setAvailableAt(availAt); }
    } catch {}
    setSavingAvail(false);
  };

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*, professions(name)')
        .eq('professional_id', professional.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) setJobs(data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); setRefresh(false); }
  };

  // Calcular ingresos
  const completedJobs  = jobs.filter(j => j.status === 'completed');
  const earningBase    = j => j.work_amount || j.visit_amount || 0;
  const totalEarned    = completedJobs.reduce((acc, j) => acc + Math.round(earningBase(j) * (1 - (j.commission_pct || 20) / 100)), 0);
  const totalVisits    = completedJobs.length;
  const thisMonthJobs  = completedJobs.filter(j => {
    const d = new Date(j.completed_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonthEarned = thisMonthJobs.reduce((acc, j) => acc + Math.round(earningBase(j) * (1 - (j.commission_pct || 20) / 100)), 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#F5F5F5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mi panel</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); fetchJobs(); }} tintColor="#FFD600" />}
      >
        {/* Perfil del trabajador */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            {professional.avatar_url
              ? <Image source={{ uri: professional.avatar_url }} style={styles.profileAvatarImg} />
              : <Ionicons name="person" size={32} color="#FFD600" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{professional.first_name} {professional.last_name}</Text>
            <View style={[styles.levelBadge, { borderColor: levelColor + '60' }]}>
              <Text style={[styles.levelText, { color: levelColor }]}>{level}</Text>
            </View>
          </View>
          <View style={styles.commBox}>
            <Text style={[styles.commPct, { color: '#4CAF50' }]}>{commission}%</Text>
            <Text style={styles.commLabel}>comisión</Text>
          </View>
        </View>

        {/* Toggle disponibilidad */}
        <TouchableOpacity
          style={[styles.availCard, available ? styles.availCardOn : styles.availCardOff]}
          onPress={() => available ? setAvailModal(true) : handleSetAvailable()}
          disabled={savingAvail}
          activeOpacity={0.85}
        >
          <View style={[styles.availDot, { backgroundColor: available ? '#4CAF50' : '#ff4444' }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.availText, { color: available ? '#4CAF50' : '#ff4444' }]}>
              {available ? 'Disponible para trabajos' : availableAt ? `Disponible a las ${formatHour(availableAt)}` : 'No disponible'}
            </Text>
            <Text style={styles.availSub}>
              {available ? 'Tocá para pausar la recepción de trabajos' : 'Tocá para volver a estar disponible'}
            </Text>
          </View>
          {savingAvail
            ? <ActivityIndicator size="small" color={available ? '#4CAF50' : '#ff4444'} />
            : <Ionicons name={available ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={available ? '#4CAF50' : '#ff4444'} />
          }
        </TouchableOpacity>

        {/* Modal: tiempo de no disponibilidad */}
        <Modal visible={availModal} transparent animationType="fade" onRequestClose={() => setAvailModal(false)}>
          <View style={styles.availOverlay}>
            <View style={styles.availModalBox}>
              <Text style={styles.availModalTitle}>Pausar trabajos</Text>
              <Text style={styles.availModalSub}>No voy a recibir nuevos pedidos por:</Text>
              {[
                { label: 'Sin tiempo definido', icon: 'infinite-outline', hours: 0 },
                { label: '1 hora',              icon: 'time-outline',     hours: 1 },
                { label: '2 horas',             icon: 'time-outline',     hours: 2 },
                { label: '3 horas',             icon: 'time-outline',     hours: 3 },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.label}
                  style={styles.availModalOpt}
                  onPress={() => handleSetUnavailable(opt.hours)}
                  activeOpacity={0.8}
                >
                  <Ionicons name={opt.icon} size={18} color="#888" />
                  <Text style={styles.availModalOptText}>{opt.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#333" />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.availModalCancel} onPress={() => setAvailModal(false)}>
                <Text style={styles.availModalCancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Stats rápidas */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{professional.completed_jobs || 0}</Text>
            <Text style={styles.statLbl}>Trabajos{'\n'}completados</Text>
          </View>
          <View style={styles.statDiv} />
          <View style={styles.statBox}>
            <Text style={styles.statVal}>
              {professional.avg_rating ? Number(professional.avg_rating).toFixed(1) : '—'}
            </Text>
            <Text style={styles.statLbl}>Promedio{'\n'}de estrellas</Text>
            {(professional.on_time_completions || 0) > 0 && (
              <Text style={styles.statOnTime}>+{professional.on_time_completions} en tiempo ⚡</Text>
            )}
          </View>
          <View style={styles.statDiv} />
          <View style={styles.statBox}>
            <Text style={[styles.statVal, { color: '#4CAF50', fontSize: 16 }]}>
              ${Math.round(thisMonthEarned).toLocaleString('es-AR')}
            </Text>
            <Text style={styles.statLbl}>Este{'\n'}mes</Text>
          </View>
        </View>

        {/* Próximo nivel */}
        {level !== 'Elite' && (
          <View style={styles.nextLevelCard}>
            <Ionicons name="trending-up" size={18} color="#FFD600" />
            <View style={{ flex: 1 }}>
              <Text style={styles.nextLevelTitle}>Próximo nivel → −{level === 'Nuevo' ? 3 : level === 'Verificado' ? 3 : 4}% comisión</Text>
              <Text style={styles.nextLevelSub}>
                {level === 'Nuevo'
                  ? `Necesitás ${10 - (professional.completed_jobs || 0)} trabajos más con ★ 4.0+`
                  : level === 'Verificado'
                  ? `Necesitás ${50 - (professional.completed_jobs || 0)} trabajos más con ★ 4.5+`
                  : `Necesitás ${100 - (professional.completed_jobs || 0)} trabajos más con ★ 4.8+`}
              </Text>
            </View>
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'jobs' && styles.tabActive]} onPress={() => setTab('jobs')}>
            <Text style={[styles.tabText, tab === 'jobs' && styles.tabTextActive]}>Historial</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'earnings' && styles.tabActive]} onPress={() => setTab('earnings')}>
            <Text style={[styles.tabText, tab === 'earnings' && styles.tabTextActive]}>Ingresos</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'guide' && styles.tabActive]} onPress={() => setTab('guide')}>
            <Text style={[styles.tabText, tab === 'guide' && styles.tabTextActive]}>⚡ Guía</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#FFD600" style={{ marginTop: 32 }} />
        ) : tab === 'guide' ? null : tab === 'jobs' ? (
          /* ─── Lista de trabajos ─── */
          <View style={styles.listWrap}>
            {jobs.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="briefcase-outline" size={40} color="#222" />
                <Text style={styles.emptyText}>Todavía no tenés trabajos</Text>
              </View>
            ) : jobs.map(j => {
              const s = STATUS_LABEL[j.status] || STATUS_LABEL.cancelled;
              const earned = j.status === 'completed' && j.work_amount
                ? Math.round(j.work_amount * (1 - (j.commission_pct || 20) / 100))
                : null;
              return (
                <View key={j.id} style={styles.jobCard}>
                  <View style={styles.jobCardTop}>
                    <Text style={styles.jobProfession}>{j.professions?.name || 'Trabajo'}</Text>
                    <View style={[styles.jobStatusBadge, { backgroundColor: s.color + '20', borderColor: s.color + '40' }]}>
                      <Text style={[styles.jobStatusText, { color: s.color }]}>{s.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.jobAddress} numberOfLines={1}>{j.address || 'Sin dirección'}</Text>
                  <View style={styles.jobCardBottom}>
                    <Text style={styles.jobDate}>
                      {new Date(j.created_at).toLocaleDateString('es-AR', { day:'numeric', month:'short', year:'numeric' })}
                    </Text>
                    {earned != null && (
                      <Text style={styles.jobEarned}>+${earned.toLocaleString('es-AR')}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          /* ─── Ingresos ─── */
          <View style={styles.listWrap}>
            <View style={styles.earningsSummary}>
              <Text style={styles.earningsTotalLabel}>Total acumulado</Text>
              <Text style={styles.earningsTotalVal}>${Math.round(totalEarned).toLocaleString('es-AR')}</Text>
              <Text style={styles.earningsSub}>{totalVisits} trabajos completados</Text>
            </View>

            <View style={styles.earningsBreakdown}>
              <Text style={styles.breakdownTitle}>Cómo funciona tu comisión</Text>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Nivel actual</Text>
                <Text style={[styles.breakdownVal, { color: levelColor }]}>{level}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>VOLT retiene</Text>
                <Text style={styles.breakdownVal}>{commission}% del trabajo</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Vos recibís</Text>
                <Text style={[styles.breakdownVal, { color: '#4CAF50' }]}>{100 - commission}% del trabajo</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Visita (${(professional.min_price || 30000).toLocaleString('es-AR')})</Text>
                <Text style={styles.breakdownVal}>La retiene VOLT</Text>
              </View>
            </View>

            {completedJobs.slice(0, 20).map(j => {
              const earned = Math.round(earningBase(j) * (1 - (j.commission_pct || 20) / 100));
              return (
                <View key={j.id} style={styles.earningRow}>
                  <View>
                    <Text style={styles.earningProfession}>{j.professions?.name || 'Trabajo'}</Text>
                    <Text style={styles.earningDate}>
                      {new Date(j.completed_at || j.created_at).toLocaleDateString('es-AR', { day:'numeric', month:'short' })}
                    </Text>
                  </View>
                  <Text style={styles.earningAmount}>+${earned.toLocaleString('es-AR')}</Text>
                </View>
              );
            })}
          </View>
        )}

        {tab === 'guide' && (
          <MacheteScreen professional={professional} />
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    margin: 16, padding: 16,
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  profileAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1A1A1A', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImg: { width: '100%', height: '100%' },
  profileName: { fontSize: 16, fontWeight: '800', color: '#F5F5F5', marginBottom: 6 },
  levelBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  levelText: { fontSize: 11, fontWeight: '800' },
  commBox: { alignItems: 'center' },
  commPct: { fontSize: 22, fontWeight: '900' },
  commLabel: { fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },

  availCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    borderRadius: 16, borderWidth: 1.5,
  },
  availCardOn:  { backgroundColor: '#0A1A0A', borderColor: '#4CAF5040' },
  availCardOff: { backgroundColor: '#1A0A0A', borderColor: '#ff444440' },
  availDot: { width: 10, height: 10, borderRadius: 5 },
  availText: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  availSub:  { fontSize: 11, color: '#444' },

  availOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
  },
  availModalBox: {
    width: '100%', backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: '#1E1E1E',
    padding: 24, gap: 4,
  },
  availModalTitle: { fontSize: 18, fontWeight: '900', color: '#F5F5F5', marginBottom: 4 },
  availModalSub:   { fontSize: 13, color: '#555', marginBottom: 12 },
  availModalOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  availModalOptText: { flex: 1, fontSize: 15, color: '#F5F5F5', fontWeight: '600' },
  availModalCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  availModalCancelText: { fontSize: 15, color: '#555', fontWeight: '700' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#111', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 20,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '900', color: '#F5F5F5', marginBottom: 6 },
  statLbl: { fontSize: 11, color: '#555', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 15 },
  statOnTime: { fontSize: 10, color: '#4CAF50', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  statDiv: { width: 1, height: 36, backgroundColor: '#1E1E1E' },

  nextLevelCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    backgroundColor: '#0D0D00', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a00',
  },
  nextLevelTitle: { fontSize: 13, fontWeight: '700', color: '#FFD600', marginBottom: 3 },
  nextLevelSub:   { fontSize: 12, color: '#666' },

  tabs: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', padding: 4,
  },
  tab:           { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive:     { backgroundColor: '#FFD600' },
  tabText:       { fontSize: 14, fontWeight: '700', color: '#555' },
  tabTextActive: { color: '#0A0A0A' },

  listWrap: { paddingHorizontal: 16 },

  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { color: '#333', fontSize: 14 },

  jobCard: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, marginBottom: 10,
  },
  jobCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  jobProfession: { fontSize: 15, fontWeight: '700', color: '#F5F5F5' },
  jobStatusBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  jobStatusText: { fontSize: 11, fontWeight: '700' },
  jobAddress: { fontSize: 13, color: '#555', marginBottom: 8 },
  jobCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobDate: { fontSize: 12, color: '#444' },
  jobEarned: { fontSize: 15, fontWeight: '800', color: '#4CAF50' },

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
});

export default WorkerDashboardScreen;

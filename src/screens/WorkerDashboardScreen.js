import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator, Platform, RefreshControl, Image, Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system 19 (SDK 54): readAsStringAsync y EncodingType se mudaron a
// /legacy. Importados de la raiz TIRAN ERROR en runtime, no avisan en el build.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import locationService from '../services/locationService';
import professionalService from '../services/professionalService';
import { conTiempo } from '../utils/conTiempo';
import { showSuccess, showError } from '../utils/toast';
import volt from '../utils/voltVoice';
import { commissionForBilled, nextCommissionStep, levelLabel } from '../utils/commission';
import MacheteScreen from './MacheteScreen';
import PaymentDataModal from '../components/PaymentDataModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chargesInApp, isFreeMode } from '../config/monetization';

const STATUS_LABEL = {
  pending:          { label: 'Pendiente',    color: '#8A8A8A' },
  accepted:         { label: 'En camino',    color: '#FFD600' },
  arrived:          { label: 'En domicilio', color: '#FFD600' },
  in_progress:      { label: 'Trabajando',   color: '#8A8A8A' },
  awaiting_payment: { label: isFreeMode() ? 'Finalizando' : 'Cobrando', color: '#FFD600' },
  completed:        { label: 'Completado',   color: '#FFD600' },
  cancelled:        { label: 'Cancelado',    color: '#E5484D' },
};

const formatHour = (isoStr) => {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const WorkerDashboardScreen = ({ professional, session, onClose, onAvailabilityChange }) => {
  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [tab, setTab]           = useState('jobs'); // 'jobs' | 'earnings' | 'guide'

  const [available, setAvailable]     = useState(professional.available ?? true);
  const [availableAt, setAvailableAt] = useState(professional.available_at ?? null);
  const [availModal, setAvailModal]   = useState(false);
  const [savingAvail, setSavingAvail] = useState(false);
  const [localAvatar, setLocalAvatar]       = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Datos de pago (CUIT/CBU) — onboarding transitorio para trabajadores pioneros.
  // Si está aprobado y le faltan, mostramos el formulario en la primera conexión.
  // Si elige "seguir en otro momento", guardamos una marca y no lo molestamos más
  // (queda el acceso en Mi Perfil).
  const [payDone, setPayDone] = useState(!!(professional.cuit && professional.cbu));
  const [showPay, setShowPay] = useState(false);

  useEffect(() => {
    // En modo gratis no pedimos datos de cobro (el cliente le paga directo al pro).
    if (!chargesInApp()) return;
    if (payDone || professional.verification_status !== 'approved') return;
    AsyncStorage.getItem(`pay_later_${professional.id}`).then(flag => {
      if (!flag) setShowPay(true);
    });
  }, []);

  const dismissPayLater = () => {
    AsyncStorage.setItem(`pay_later_${professional.id}`, '1').catch(() => {});
    setShowPay(false);
  };

  // Facturación (mano de obra) de los últimos 30 días → comisión vigente (ventana móvil)
  const _now = Date.now();
  const billed30 = (jobs || [])
    .filter(j => j.status === 'completed' && j.completed_at && (_now - new Date(j.completed_at).getTime()) <= 30 * 864e5)
    .reduce((acc, j) => acc + (j.work_amount || 0), 0);

  const commission = commissionForBilled(billed30, professional.avg_rating);
  const level      = levelLabel(commission);
  const levelColor = level === 'Elite' ? '#FFD600' : level === 'Pro' ? '#FFD600'
    : level === 'Activo' ? '#FFD600' : '#8A8A8A';
  const step       = nextCommissionStep(billed30);

  // ── VOLT socio: mensaje según el momento del trabajador ──────────────────
  const doneJobs    = professional.completed_jobs || 0;
  const isNewWorker = doneJobs === 0 && billed30 === 0;
  const coachMsg  = !chargesInApp()
    ? (isNewWorker ? volt.coachWelcomeFree(professional.first_name) : volt.coachActiveFree)
    : isNewWorker
    ? volt.coachWelcome(professional.first_name)
    : !step
    ? volt.coachElite
    : volt.coachVolumeProgress(step.falta, step.pct);

  useEffect(() => {
    fetchJobs();
    // Leer la disponibilidad REAL desde la base. El prop `professional` viene
    // cacheado del login y puede estar viejo → sin esto, al volver al panel se
    // reinicia siempre a "disponible" aunque lo hayas pausado.
    supabase.from('professionals')
      .select('available, available_at')
      .eq('id', professional.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        // Auto-restaurar si ya pasó la hora programada de pausa
        if (!data.available && data.available_at && new Date(data.available_at) <= new Date()) {
          handleSetAvailable();
          return;
        }
        setAvailable(!!data.available);
        setAvailableAt(data.available_at);
        onAvailabilityChange?.(!!data.available);
      })
      .catch(() => {});
  }, []);

  const handleSetAvailable = async () => {
    setSavingAvail(true);
    try {
      // 🔴 Disponible SIN ubicación no existe: el trigger de la base
      // (063_disponible_de_verdad) revierte el available a false EN SILENCIO si
      // no hay ubicación fresca — la pantalla mostraba "Disponible", la base
      // decía que no, y el prestador quedaba invisible sin enterarse (el mismo
      // estado que dejó a 8 de 11 aprobados sin trabajos). Mismo camino que el
      // handleToggle de HomeScreen: primero la ubicación, después el available.
      const granted = await conTiempo(locationService.requestPermission(), 60000, false);
      const pos = granted
        ? await conTiempo(locationService.getCurrentLocation(), 15000, null)
        : null;
      if (!pos) {
        Alert.alert(
          'No pudimos tomar tu ubicación',
          granted
            ? 'La necesitamos para volver a mostrarte a los clientes. Fijate que el GPS esté encendido y probá de nuevo.'
            : 'Activá el permiso de ubicación para BOLT en los ajustes del teléfono y probá de nuevo.',
        );
        return; // el finally libera el botón
      }
      await conTiempo(
        professionalService.updateLocation(professional.user_id, pos.coords.latitude, pos.coords.longitude),
        15000, 'timeout'
      );
      const { error } = await supabase.from('professionals')
        .update({ available: true, available_at: null })
        .eq('id', professional.id);
      if (error) throw error;
      setAvailable(true); setAvailableAt(null); onAvailabilityChange?.(true);
    } catch {
      Alert.alert('No pudimos activarte', 'Puede ser la señal. Probá de nuevo en un momento.');
    } finally {
      setSavingAvail(false);
    }
  };

  const handleSetUnavailable = async (hours) => {
    setAvailModal(false);
    setSavingAvail(true);
    try {
      const availAt = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
      const { error } = await supabase.from('professionals')
        .update({ available: false, available_at: availAt })
        .eq('id', professional.id);
      if (!error) { setAvailable(false); setAvailableAt(availAt); onAvailabilityChange?.(false); }
    } catch {}
    setSavingAvail(false);
  };

  const uploadAndSaveAvatar = async (file) => {
    setUploadingAvatar(true);
    try {
      const ext    = file.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path   = `${professional.user_id}/avatar.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(path, bytes, { upsert: true, contentType: `image/${ext}` });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = data.publicUrl;
      await Promise.all([
        supabase.auth.updateUser({ data: { avatar_url: url } }),
        supabase.from('professionals').update({ avatar_url: url }).eq('id', professional.id),
      ]);
      setLocalAvatar(url);
      showSuccess('Foto de perfil actualizada.');
    } catch {
      showError('No se pudo subir la foto. Intentá de nuevo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleChangeAvatar = () => {
    Alert.alert('Foto de perfil', '', [
      { text: 'Cámara', onPress: async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
        if (!r.canceled) uploadAndSaveAvatar(r.assets[0]);
      }},
      { text: 'Galería', onPress: async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
        const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
        if (!r.canceled) uploadAndSaveAvatar(r.assets[0]);
      }},
      { text: 'Cancelar', style: 'cancel' },
    ]);
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
  // En modo gratis el profesional se queda con el 100% (no hay comisión).
  const commFactor     = j => 1 - (chargesInApp() ? (j.commission_pct || 20) : 0) / 100;
  const totalEarned    = completedJobs.reduce((acc, j) => acc + Math.round(earningBase(j) * commFactor(j)), 0);
  const totalVisits    = completedJobs.length;
  const thisMonthJobs  = completedJobs.filter(j => {
    const d = new Date(j.completed_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonthEarned = thisMonthJobs.reduce((acc, j) => acc + Math.round(earningBase(j) * commFactor(j)), 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mi panel</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); fetchJobs(); }} tintColor="#FFD600" />}
      >
        {/* Datos de pago: si está aprobado y le faltan, un acceso discreto para abrir
            el formulario cuando quiera (el de primera conexión se abre solo, abajo). */}
        {chargesInApp() && !payDone && professional.verification_status === 'approved' && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setShowPay(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFD600', margin: 16, marginBottom: 0, padding: 14, borderRadius: 20 }}
          >
            <Ionicons name="card-outline" size={24} color="#0D0D0D" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#0D0D0D', fontWeight: '600', fontSize: 16 }}>Completá tus datos para cobrar</Text>
              <Text style={{ color: '#0D0D0D', fontSize: 14, opacity: 0.8, marginTop: 2 }}>Cargá tu CUIT y CBU. Tocá para hacerlo ahora.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#0D0D0D" />
          </TouchableOpacity>
        )}

        <PaymentDataModal
          visible={showPay}
          professional={professional}
          onboarding
          onClose={() => setShowPay(false)}
          onLater={dismissPayLater}
          onSaved={() => { setPayDone(true); setShowPay(false); }}
        />

        {/* Perfil del trabajador */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatarWrap}>
            <TouchableOpacity style={{ width: 56, height: 56 }} onPress={handleChangeAvatar} activeOpacity={0.8} disabled={uploadingAvatar}>
              <View style={styles.profileAvatar}>
                {uploadingAvatar
                  ? <ActivityIndicator color="#FFD600" />
                  : (localAvatar ?? professional.avatar_url)
                  ? <Image source={{ uri: localAvatar ?? professional.avatar_url }} style={styles.profileAvatarImg} />
                  : <Ionicons name="person" size={32} color="#FFD600" />}
              </View>
              <View style={styles.profileAvatarBadge}>
                <Ionicons name="camera" size={10} color="#0D0D0D" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleChangeAvatar} disabled={uploadingAvatar} activeOpacity={0.7} style={styles.profileChangePhotoBtn}>
              <Text style={styles.profileChangePhotoText}>
                {uploadingAvatar ? 'Subiendo...' : 'Cambiar'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{professional.first_name} {professional.last_name}</Text>
            <View style={[styles.levelBadge, { borderColor: levelColor + '60' }]}>
              <Text style={[styles.levelText, { color: levelColor }]}>{level}</Text>
            </View>
          </View>
          <View style={styles.commBox}>
            {chargesInApp() ? (
              <>
                <Text style={[styles.commPct, { color: '#FFD600' }]}>{commission}%</Text>
                <Text style={styles.commLabel}>comisión</Text>
              </>
            ) : (
              <>
                <Text style={[styles.commPct, { color: '#FFD600' }]}>100%</Text>
                <Text style={styles.commLabel}>para vos</Text>
              </>
            )}
          </View>
        </View>

        {/* VOLT socio — bienvenida / progreso */}
        <View style={styles.voltCard}>
          <View style={styles.voltAvatar}>
            <Text style={styles.voltBolt}>⚡</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.voltName}>BOLT</Text>
            <Text style={styles.voltMsg}>{coachMsg}</Text>
            {isNewWorker && (
              <>
                {chargesInApp() && <Text style={styles.voltMsgSub}>{volt.coachCommission}</Text>}
                <Text style={styles.voltMsgSub}>{volt.coachFirstStep}</Text>
              </>
            )}
          </View>
        </View>

        {/* Guía: próximo paso (acompaña al trabajador) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,214,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)', borderRadius: 20, padding: 14, marginBottom: 12 }}>
          <Ionicons name={available ? 'checkmark-circle' : 'arrow-forward-circle'} size={20} color="#FFD600" />
          <Text style={{ flex: 1, color: '#e8e8e8', fontSize: 14, lineHeight: 18 }}>
            {available
              ? 'Listo, estás activo. Te avisamos apenas entre un trabajo cerca tuyo — mantené la app abierta.'
              : 'Próximo paso: tocá “Disponible” acá abajo para empezar a recibir trabajos.'}
          </Text>
        </View>

        {/* Toggle disponibilidad */}
        <TouchableOpacity
          style={[styles.availCard, available ? styles.availCardOn : styles.availCardOff]}
          onPress={() => available ? setAvailModal(true) : handleSetAvailable()}
          disabled={savingAvail}
          activeOpacity={0.85}
        >
          <View style={[styles.availDot, { backgroundColor: available ? '#FFD600' : '#E5484D' }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.availText, { color: available ? '#FFD600' : '#E5484D' }]}>
              {available ? 'Disponible para trabajos' : availableAt ? `Disponible a las ${formatHour(availableAt)}` : 'No disponible'}
            </Text>
            <Text style={styles.availSub}>
              {available ? 'Tocá para pausar la recepción de trabajos' : 'Tocá para volver a estar disponible'}
            </Text>
          </View>
          {savingAvail
            ? <ActivityIndicator size="small" color={available ? '#FFD600' : '#E5484D'} />
            : <Ionicons name={available ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={available ? '#FFD600' : '#E5484D'} />
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
                  <Ionicons name={opt.icon} size={18} color="#8A8A8A" />
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
            <Text style={[styles.statVal, { color: '#FFD600', fontSize: 16 }]}>
              ${Math.round(thisMonthEarned).toLocaleString('es-AR')}
            </Text>
            <Text style={styles.statLbl}>Este{'\n'}mes</Text>
          </View>
        </View>

        {/* Próximo nivel — por facturación (solo en modo comisión) */}
        {chargesInApp() && step && (
          <View style={styles.nextLevelCard}>
            <Ionicons name="trending-up" size={18} color="#FFD600" />
            <View style={{ flex: 1 }}>
              <Text style={styles.nextLevelTitle}>Próximo nivel → {step.pct}% de comisión</Text>
              <Text style={styles.nextLevelSub}>
                Te faltan ${step.falta.toLocaleString('es-AR')} de facturación en los últimos 30 días
              </Text>
            </View>
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'jobs' && styles.tabActive]} onPress={() => setTab('jobs')}>
            <Text style={[styles.tabText, tab === 'jobs' && styles.tabTextActive]}>Historial</Text>
          </TouchableOpacity>
          {chargesInApp() && (
            <TouchableOpacity style={[styles.tab, tab === 'earnings' && styles.tabActive]} onPress={() => setTab('earnings')}>
              <Text style={[styles.tabText, tab === 'earnings' && styles.tabTextActive]}>Ingresos</Text>
            </TouchableOpacity>
          )}
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
              // Mismo caso que en el historial: un presupuesto que el cliente
              // todavía no eligió sigue en 'accepted' y decía "En camino".
              const esperandoEleccion = j.quote_group_id && ['pending', 'accepted'].includes(j.status);
              const s = esperandoEleccion
                ? { label: 'Esperando que te elijan', color: '#8A8A8A' }
                : (STATUS_LABEL[j.status] || STATUS_LABEL.cancelled);
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
              {chargesInApp() ? (
                <>
                  <Text style={styles.earningsTotalLabel}>Total acumulado</Text>
                  <Text style={styles.earningsTotalVal}>${Math.round(totalEarned).toLocaleString('es-AR')}</Text>
                </>
              ) : (
                <Text style={styles.earningsTotalLabel}>Tu actividad</Text>
              )}
              <Text style={styles.earningsSub}>{totalVisits} trabajos completados</Text>
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
                  <Text style={[styles.breakdownVal, { color: '#FFD600' }]}>{100 - commission}% del trabajo</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Visita (${(professional.min_price ?? 30000).toLocaleString('es-AR')})</Text>
                  <Text style={styles.breakdownVal}>La retiene BOLT</Text>
                </View>
              </View>
            )}

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
                  {chargesInApp() && <Text style={styles.earningAmount}>+${earned.toLocaleString('es-AR')}</Text>}
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
  container: { flex: 1, backgroundColor: '#0D0D0D' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    margin: 16, padding: 16,
    backgroundColor: '#161616', borderRadius: 20,
    },
  profileAvatarWrap: { alignItems: 'center', gap: 4 },
  profileAvatar: {
    width: 56, height: 56, borderRadius: 999,
    backgroundColor: '#1A1A1A', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 20, height: 20, borderRadius: 999,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  profileChangePhotoBtn: { paddingVertical: 2, paddingHorizontal: 4 },
  profileChangePhotoText: { fontSize: 12, color: '#FFD600', fontWeight: '700' },
  profileAvatarImg: { width: '100%', height: '100%' },
  profileName: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 6 },
  levelBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  levelText: { fontSize: 12, fontWeight: '600' },
  commBox: { alignItems: 'center' },
  commPct: { fontSize: 22, fontWeight: '700' },
  commLabel: { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8 },

  // VOLT socio
  voltCard: {
    flexDirection: 'row', gap: 12,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    backgroundColor: '#0D0D00', borderRadius: 20,
    borderWidth: 1, borderColor: '#FFD60030',
  },
  voltAvatar: {
    width: 36, height: 36, borderRadius: 999,
    backgroundColor: '#FFD60018', borderWidth: 1, borderColor: '#FFD60050',
    alignItems: 'center', justifyContent: 'center',
  },
  voltBolt: { fontSize: 18 },
  voltName: { fontSize: 14, fontWeight: '700', color: '#FFD600', letterSpacing: 1, marginBottom: 3 },
  voltMsg:  { fontSize: 14, color: '#cfcfcf', lineHeight: 19 },
  voltMsgSub: { fontSize: 14, color: '#8A8A8A', lineHeight: 18, marginTop: 6 },

  availCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    borderRadius: 20, borderWidth: 1.5,
  },
  availCardOn:  { backgroundColor: '#0A1A0A', borderColor: '#FFD60040' },
  availCardOff: { backgroundColor: '#1A0A0A', borderColor: '#E5484D40' },
  availDot: { width: 10, height: 10, borderRadius: 999 },
  availText: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  availSub:  { fontSize: 12, color: '#444' },

  availOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
  },
  availModalBox: {
    width: '100%', backgroundColor: '#161616',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 4,
  },
  availModalTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  availModalSub:   { fontSize: 14, color: '#5C5C5C', marginBottom: 12 },
  availModalOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  availModalOptText: { flex: 1, fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  availModalCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  availModalCancelText: { fontSize: 16, color: '#5C5C5C', fontWeight: '700' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 20,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 },
  statLbl: { fontSize: 12, color: '#5C5C5C', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1.8, lineHeight: 15 },
  statOnTime: { fontSize: 12, color: '#FFD600', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  statDiv: { width: 1, height: 36, backgroundColor: '#1E1E1E' },

  nextLevelCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    backgroundColor: '#0D0D00', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a00',
  },
  nextLevelTitle: { fontSize: 14, fontWeight: '700', color: '#FFD600', marginBottom: 3 },
  nextLevelSub:   { fontSize: 14, color: '#5C5C5C' },

  tabs: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#161616', borderRadius: 999,
    padding: 4,
  },
  tab:           { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 999 },
  tabActive:     { backgroundColor: '#FFD600' },
  tabText:       { fontSize: 16, fontWeight: '700', color: '#5C5C5C' },
  tabTextActive: { color: '#0D0D0D' },

  listWrap: { paddingHorizontal: 16 },

  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { color: '#333', fontSize: 16 },

  jobCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14, marginBottom: 10,
  },
  jobCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  jobProfession: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  jobStatusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  jobStatusText: { fontSize: 12, fontWeight: '700' },
  jobAddress: { fontSize: 14, color: '#5C5C5C', marginBottom: 8 },
  jobCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobDate: { fontSize: 14, color: '#444' },
  jobEarned: { fontSize: 16, fontWeight: '600', color: '#FFD600' },

  earningsSummary: {
    alignItems: 'center', paddingVertical: 28,
    backgroundColor: '#161616', borderRadius: 20,
    marginBottom: 12,
  },
  earningsTotalLabel: { fontSize: 14, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 8 },
  earningsTotalVal:   { fontSize: 36, fontWeight: '700', color: '#FFD600', marginBottom: 4 },
  earningsSub:        { fontSize: 14, color: '#5C5C5C' },

  earningsBreakdown: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 12, gap: 12,
  },
  breakdownTitle: { fontSize: 14, fontWeight: '600', color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 16, color: '#5C5C5C' },
  breakdownVal:   { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  earningRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#161616',
  },
  earningProfession: { fontSize: 16, color: '#FFFFFF', fontWeight: '600', marginBottom: 2 },
  earningDate:       { fontSize: 14, color: '#444' },
  earningAmount:     { fontSize: 16, fontWeight: '600', color: '#FFD600' },
});

export default WorkerDashboardScreen;

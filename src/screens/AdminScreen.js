import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Linking,
  ScrollView, ActivityIndicator, Image, Alert, Platform, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Image as RNImage,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import notificationService from '../services/notificationService';
import { showSuccess, showError } from '../utils/toast';

const ADMIN_EMAILS = ['maxi95.bahiablanca@gmail.com'];

const TAB = { summary: 'Resumen', pending: 'Pendientes', workers: 'Trabajadores', jobs: 'Trabajos', revenue: 'Ingresos' };

const AdminScreen = ({ session, onClose }) => {
  const [tab, setTab]           = useState('summary');
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [loadError, setLoadError] = useState(false); // distinguir "vacío real" de "no cargó"

  const [pending, setPending]   = useState([]);
  const [workers, setWorkers]   = useState([]);
  const [jobs, setJobs]         = useState([]);
  const [revenue, setRevenue]   = useState({ total: 0, thisMonth: 0, byWorker: [] });
  const [summary, setSummary]   = useState(null);

  // Modal de rechazo
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectNote, setRejectNote]   = useState('');
  const rejectTargetRef               = useRef(null);
  const rejectResolveRef              = useRef(null);

  // Viewer de imagen
  const [imageViewer, setImageViewer] = useState(null); // { uri, label }

  // Verificar acceso
  if (!ADMIN_EMAILS.includes(session?.user?.email)) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <Ionicons name="lock-closed" size={48} color="#333" />
          <Text style={{ color:'#444', marginTop:16 }}>Acceso restringido</Text>
        </View>
      </SafeAreaView>
    );
  }

  useEffect(() => { loadAll(); }, [tab]);

  const loadAll = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      if (tab === 'summary') {
        const [
          { count: totalWorkers },
          { count: activeWorkers },
          { count: pendingCount },
          { count: totalJobs },
          { count: completedJobs },
          { data: payments },
        ] = await Promise.all([
          supabase.from('professionals').select('id', { count: 'exact', head: true }).eq('verification_status', 'approved'),
          supabase.from('professionals').select('id', { count: 'exact', head: true }).eq('verification_status', 'approved').eq('available', true),
          supabase.from('professionals').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending'),
          supabase.from('jobs').select('id', { count: 'exact', head: true }),
          supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
          supabase.from('payments').select('commission_amt').eq('status', 'approved'),
        ]);
        const totalRevenue = (payments ?? []).reduce((s, p) => s + (p.commission_amt || 0), 0);
        const now = new Date();
        setSummary({ totalWorkers, activeWorkers, pendingCount, totalJobs, completedJobs, totalRevenue });
        // También actualizar el badge de pendientes en el tab
        setSummary(s => ({ ...s, pendingCount: pendingCount ?? 0 }));
      } else if (tab === 'pending') {
        const { data } = await supabase
          .from('professionals')
          .select('*, professional_professions(profession_id, min_price, professions(name)), professional_payout(cuit, cbu)')
          .eq('verification_status', 'pending')
          .order('created_at', { ascending: false });
        setPending(data ?? []);
      } else if (tab === 'workers') {
        const { data } = await supabase
          .from('professionals')
          .select('*, professional_professions(profession_id, min_price, professions(name)), professional_payout(cuit, cbu)')
          .in('verification_status', ['approved', 'rejected'])
          .order('created_at', { ascending: false });
        setWorkers(data ?? []);
      } else if (tab === 'jobs') {
        const { data } = await supabase
          .from('jobs')
          .select('*, professions(name), professionals(first_name, last_name)')
          .order('created_at', { ascending: false })
          .limit(100);
        setJobs(data ?? []);
      } else if (tab === 'revenue') {
        const { data: payments } = await supabase
          .from('payments')
          .select('*, jobs(professional_id, professionals(first_name, last_name))')
          .eq('status', 'approved')
          .order('paid_at', { ascending: false });
        const all = payments ?? [];
        const now = new Date();
        const thisMonth = all.filter(p => {
          const d = new Date(p.paid_at);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        const byWorkerMap = {};
        all.forEach(p => {
          const prof = p.jobs?.professionals;
          if (!prof) return;
          const key = p.jobs.professional_id;
          if (!byWorkerMap[key]) byWorkerMap[key] = { name: `${prof.first_name} ${prof.last_name}`, commission: 0, count: 0 };
          byWorkerMap[key].commission += p.commission_amt || 0;
          byWorkerMap[key].count++;
        });
        setRevenue({
          total:      all.reduce((s,p)      => s + (p.commission_amt || 0), 0),
          thisMonth:  thisMonth.reduce((s,p) => s + (p.commission_amt || 0), 0),
          byWorker:   Object.values(byWorkerMap).sort((a,b) => b.commission - a.commission),
        });
      }
    } catch { setLoadError(true); }
    finally { setLoading(false); setRefresh(false); }
  };

  const handleVerify = async (professional, action) => {
    let note = null;
    if (action === 'rejected') {
      note = await promptRejectionReason();
      if (note === null) return; // se canceló el rechazo: no rechazar, no notificar, sin cartel
    }

    // 🔴 Antes de aprobar, avisar si faltan documentos (auditoría 23-ago). La app
    //    le dice al cliente "es tu profesional de BOLT" y le da a abrir la puerta;
    //    aprobar a ciegas sin selfie ni DNI vacía esa promesa. No se BLOQUEA (Maxi
    //    aprueba gente de confianza sin papeles y nada debe quedar trabado): se
    //    pide confirmación explícita.
    if (action === 'approved') {
      const faltan = [];
      if (!professional.selfie_url)    faltan.push('selfie');
      if (!professional.dni_front_url) faltan.push('DNI frente');
      if (!professional.dni_back_url)  faltan.push('DNI dorso');
      if (faltan.length) {
        const seguir = await new Promise((resolve) => {
          Alert.alert(
            'Faltan documentos',
            `${professional.first_name || 'Este prestador'} no cargó: ${faltan.join(', ')}.\n\n` +
            'La app le dice al cliente que es un profesional verificado. ¿Aprobar igual?',
            [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Aprobar igual', style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!seguir) return;
      }
    }

    try {
      const { error: vErr } = await supabase.rpc('admin_set_verification', {
        p_id:     professional.id,
        p_status: action,
        p_note:   note,
      });
      if (vErr) {
        showError('No se pudo actualizar: ' + (vErr.message || 'error de permisos'));
        return;
      }

      // Push + Email al trabajador via Edge Function
      const { data: { session: s } } = await supabase.auth.getSession();
      const { data: aviso, error: aErr } = await supabase.functions.invoke('send-worker-notification', {
        body: {
          userId:        professional.user_id,
          action,
          workerName:    `${professional.first_name} ${professional.last_name}`,
          rejectionNote: note,
        },
        headers: { Authorization: `Bearer ${s?.access_token}` },
      });

      // 🔴 11-ago-2026 — acá estaba la mentira que quedaba a la vista: el
      //    resultado del invoke se tiraba a la basura y el cartel decía "El
      //    trabajador fue notificado" pasara lo que pasara. Arreglar la Edge
      //    Function para que conteste { ok, push, mail, motivo } no sirve de
      //    nada si el panel no lo lee. Y no es un detalle de prolijidad: si
      //    Macarena no se entera de que la aprobaron, no prende el radar y
      //    queda invisible (el agujero de "aprobado pero fantasma"). Cuando el
      //    aviso no sale, lo único que lo salva es que Maxi la llame — y para
      //    eso tiene que saber que no salió.
      //
      //    OJO con el contrato: la función contesta 502 cuando no salió ni el
      //    push ni el mail, y supabase-js convierte todo lo que no sea 2xx en
      //    `error` con `data` en null. Por eso el motivo se busca primero en
      //    data y, si vino por el camino del error, en el cuerpo de la
      //    respuesta que queda colgado en error.context.
      let motivo = aviso?.motivo || '';
      if (aErr && !motivo) {
        try { motivo = (await aErr.context?.json())?.motivo || ''; } catch { /* no vino cuerpo */ }
      }

      const titulo = action === 'approved' ? '¡Aprobado! ✅' : 'Rechazado';
      if (!aErr && aviso?.ok) {
        const por = [aviso.push ? 'push' : null, aviso.mail ? 'mail' : null].filter(Boolean).join(' + ');
        showSuccess(`Avisado por ${por}.`, titulo);
      } else {
        // El estado ya quedó guardado en la base: esto NO se deshace, se avisa.
        showError(
          `Quedó ${action === 'approved' ? 'aprobado' : 'rechazado'}, pero NO se le pudo avisar: llamalo. ` +
          (motivo || aErr?.message || 'sin detalle'),
          'Sin aviso ⚠️',
        );
      }
      loadAll();
    } catch {
      showError('No se pudo actualizar el estado.');
    }
  };

  const promptRejectionReason = () =>
    new Promise(resolve => {
      setRejectNote('');
      rejectResolveRef.current = resolve;
      setRejectModal(true);
    });

  const STATUS_JOB = {
    pending:'#8A8A8A', accepted:'#FFD600', arrived:'#FFD600',
    in_progress:'#8A8A8A', awaiting_payment:'#FFD600', completed:'#FFD600', cancelled:'#E5484D',
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* Viewer de imágenes de documentos */}
      <Modal visible={!!imageViewer} transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
        <View style={styles.imgViewerOverlay}>
          <TouchableOpacity style={styles.imgViewerClose} onPress={() => setImageViewer(null)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </TouchableOpacity>
          {imageViewer?.uri && (
            <RNImage source={{ uri: imageViewer.uri }} style={styles.imgViewerImg} resizeMode="contain" />
          )}
          {imageViewer?.label && (
            <Text style={styles.imgViewerLabel}>{imageViewer.label}</Text>
          )}
        </View>
      </Modal>

      {/* Modal motivo de rechazo — cross-platform (Alert.prompt no existe en Android) */}
      <Modal visible={rejectModal} transparent animationType="fade" onRequestClose={() => { setRejectModal(false); rejectResolveRef.current?.(null); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Motivo del rechazo</Text>
            <Text style={styles.modalSub}>El trabajador lo verá en su notificación.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ej: Foto del DNI ilegible"
              placeholderTextColor="#444"
              value={rejectNote}
              onChangeText={setRejectNote}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setRejectModal(false); rejectResolveRef.current?.(null); }}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={() => { setRejectModal(false); rejectResolveRef.current?.(rejectNote || 'Documentación incompleta'); }}>
                <Text style={styles.modalConfirmText}>Enviar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Panel BOLT</Text>
          <Text style={styles.headerSub}>Administración</Text>
        </View>
        <View style={styles.adminBadge}>
          <Text style={styles.adminBadgeText}>ADMIN</Text>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
        {Object.entries(TAB).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            {key === 'pending' && (summary?.pendingCount ?? pending.length) > 0 && (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{summary?.pendingCount ?? pending.length}</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); loadAll(); }} tintColor="#FFD600" />}
        contentContainerStyle={styles.content}
      >
        {loading ? (
          <ActivityIndicator color="#FFD600" style={{ marginTop: 48 }} />
        ) : loadError ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="cloud-offline" size={48} color="#8A8A8A" />
            <Text style={styles.emptyText}>No se pudo cargar</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setRefresh(true); loadAll(); }}>
              <Text style={styles.retryBtnText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (

          /* ─── RESUMEN ─── */
          tab === 'summary' ? (
            summary ? (
              <>
                <View style={styles.kpiGrid}>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiVal}>{summary.totalWorkers ?? 0}</Text>
                    <Text style={styles.kpiLabel}>Trabajadores aprobados</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={[styles.kpiVal, { color: '#FFD600' }]}>{summary.activeWorkers ?? 0}</Text>
                    <Text style={styles.kpiLabel}>En línea ahora</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={[styles.kpiVal, { color: summary.pendingCount > 0 ? '#8A8A8A' : '#5C5C5C' }]}>{summary.pendingCount ?? 0}</Text>
                    <Text style={styles.kpiLabel}>Pendientes</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiVal}>{summary.totalJobs ?? 0}</Text>
                    <Text style={styles.kpiLabel}>Trabajos totales</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={[styles.kpiVal, { color: '#FFD600' }]}>{summary.completedJobs ?? 0}</Text>
                    <Text style={styles.kpiLabel}>Completados</Text>
                  </View>
                  <View style={[styles.kpiCard, { borderColor: '#FFD60030' }]}>
                    <Text style={[styles.kpiVal, { color: '#FFD600' }]}>${Math.round(summary.totalRevenue ?? 0).toLocaleString('es-AR')}</Text>
                    <Text style={styles.kpiLabel}>Ingresos BOLT</Text>
                  </View>
                </View>
                {(summary.pendingCount ?? 0) > 0 && (
                  <TouchableOpacity style={styles.pendingAlert} onPress={() => setTab('pending')}>
                    <Ionicons name="alert-circle" size={18} color="#8A8A8A" />
                    <Text style={styles.pendingAlertText}>Tenés {summary.pendingCount} solicitud{summary.pendingCount > 1 ? 'es' : ''} pendiente{summary.pendingCount > 1 ? 's' : ''} de revisión</Text>
                    <Ionicons name="chevron-forward" size={16} color="#8A8A8A" />
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <ActivityIndicator color="#FFD600" style={{ marginTop: 48 }} />
            )

          /* ─── PENDIENTES ─── */
          ) : tab === 'pending' ? (
            pending.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-circle" size={48} color="#FFD600" />
                <Text style={styles.emptyText}>No hay solicitudes pendientes</Text>
              </View>
            ) : pending.map(p => (
              <View key={p.id} style={styles.workerCard}>
                <View style={styles.workerCardHeader}>
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.workerAvatar} />
                  ) : (
                    <View style={styles.workerAvatarPlaceholder}>
                      <Ionicons name="person" size={24} color="#FFD600" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.workerName}>{p.first_name} {p.last_name}</Text>
                    <Text style={styles.workerPhone}>{p.phone || 'Sin teléfono'}</Text>
                    <Text style={styles.workerDate}>
                      {new Date(p.created_at).toLocaleDateString('es-AR', { day:'numeric', month:'long', year:'numeric' })}
                    </Text>
                  </View>
                </View>

                {/* Servicios */}
                <View style={styles.workerServices}>
                  {(p.professional_professions || []).map(pp => (
                    <View key={pp.profession_id} style={styles.servicePill}>
                      <Text style={styles.servicePillText}>{pp.professions?.name}</Text>
                    </View>
                  ))}
                </View>

                {/* Documentos */}
                <View style={[styles.docsRow, { flexWrap: 'wrap' }]}>
                  {[
                    { label: 'Selfie',  uri: p.selfie_url },
                    { label: 'DNI F',   uri: p.dni_front_url },
                    { label: 'DNI D',   uri: p.dni_back_url },
                    { label: 'Antec.',  uri: p.antecedentes_url },
                  ].map(doc => {
                    const esPdf = !!doc.uri && doc.uri.toLowerCase().includes('.pdf');
                    return (
                    <TouchableOpacity
                      key={doc.label}
                      style={[styles.docThumb, !doc.uri && styles.docThumbMissing]}
                      onPress={() => {
                        if (!doc.uri) return;
                        if (esPdf) Linking.openURL(doc.uri);
                        else setImageViewer({ uri: doc.uri, label: doc.label });
                      }}
                    >
                      {doc.uri ? (
                        esPdf ? (
                          <Ionicons name="document-text" size={22} color="#FFD600" />
                        ) : (
                          <Image source={{ uri: doc.uri }} style={{ width:'100%', height:'100%', borderRadius:8 }} />
                        )
                      ) : (
                        <Ionicons name="image-outline" size={20} color="#333" />
                      )}
                      <Text style={styles.docLabel}>{doc.label}</Text>
                    </TouchableOpacity>
                    );
                  })}
                  <View style={styles.docInfoCol}>
                    {(() => {
                      const payout = Array.isArray(p.professional_payout) ? p.professional_payout[0] : p.professional_payout;
                      const cuit = payout?.cuit || p.cuit;
                      const cbu  = payout?.cbu  || p.cbu;
                      return (
                        <>
                          <Text style={styles.docInfoRow}>CUIT: {cuit || '—'}</Text>
                          <Text style={styles.docInfoRow}>CBU: {cbu ? `•••• ${cbu.slice(-4)}` : '—'}</Text>
                        </>
                      );
                    })()}
                    <Text style={[styles.docInfoRow, { color: p.criminal_record_confirmed ? '#FFD600' : '#E5484D' }]}>
                      {p.criminal_record_confirmed ? '✓ Dec. jurada' : '✗ Sin declaración'}
                    </Text>
                  </View>
                </View>

                {/* Acciones */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => handleVerify(p, 'rejected')}
                  >
                    <Ionicons name="close" size={18} color="#E5484D" />
                    <Text style={styles.rejectBtnText}>Rechazar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => Alert.alert('¿Aprobar?', `${p.first_name} ${p.last_name} podrá recibir trabajos.`, [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Aprobar', onPress: () => handleVerify(p, 'approved') },
                    ])}
                  >
                    <Ionicons name="checkmark" size={18} color="#0D0D0D" />
                    <Text style={styles.approveBtnText}>Aprobar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))

          /* ─── TRABAJADORES ─── */
          ) : tab === 'workers' ? (
            workers.map(p => (
              <View key={p.id} style={styles.workerCard}>
                <View style={styles.workerCardHeader}>
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.workerAvatar} />
                  ) : (
                    <View style={styles.workerAvatarPlaceholder}>
                      <Ionicons name="person" size={24} color="#FFD600" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.workerName}>{p.first_name} {p.last_name}</Text>
                    <Text style={styles.workerPhone}>{p.phone || '—'}</Text>
                    <View style={styles.workerStatsRow}>
                      <Text style={styles.workerStat}>{p.completed_jobs} trabajos</Text>
                      <Text style={styles.workerStat}>★ {p.avg_rating || '0'}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusPill, {
                    backgroundColor: p.verification_status === 'approved' ? '#FFD60020' : '#E5484D20',
                    borderColor: p.verification_status === 'approved' ? '#FFD60050' : '#E5484D50',
                  }]}>
                    <Text style={{ color: p.verification_status === 'approved' ? '#FFD600' : '#E5484D', fontSize: 12, fontWeight: '600' }}>
                      {p.verification_status === 'approved' ? 'ACTIVO' : 'RECHAZADO'}
                    </Text>
                  </View>
                </View>
                {p.verification_status === 'rejected' && (
                  <TouchableOpacity style={styles.reactivateBtn} onPress={() => handleVerify(p, 'approved')}>
                    <Text style={styles.reactivateBtnText}>Reactivar</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))

          /* ─── TRABAJOS ─── */
          ) : tab === 'jobs' ? (
            jobs.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="briefcase-outline" size={48} color="#333" />
                <Text style={styles.emptyText}>No hay trabajos aún</Text>
              </View>
            ) : jobs.map(j => (
              <View key={j.id} style={styles.jobCard}>
                <View style={styles.jobCardTop}>
                  <Text style={styles.jobProfession}>{j.professions?.name || 'Trabajo'}</Text>
                  <View style={[styles.jobStatusPill, { backgroundColor: (STATUS_JOB[j.status] || '#8A8A8A') + '20', borderColor: (STATUS_JOB[j.status] || '#8A8A8A') + '40' }]}>
                    <Text style={[styles.jobStatusText, { color: STATUS_JOB[j.status] || '#8A8A8A' }]}>{j.status}</Text>
                  </View>
                </View>
                {j.professionals && (
                  <Text style={styles.jobWorker}>
                    <Ionicons name="construct-outline" size={11} color="#5C5C5C" /> Trabajador: {j.professionals.first_name} {j.professionals.last_name}
                  </Text>
                )}
                <Text style={styles.jobAddress}>{j.address || 'Sin dirección'}</Text>
                <View style={styles.jobCardBottom}>
                  <Text style={styles.jobDate}>
                    {new Date(j.created_at).toLocaleDateString('es-AR', { day:'numeric', month:'short', year:'numeric' })}
                  </Text>
                  {j.work_amount && <Text style={styles.jobAmount}>${j.work_amount.toLocaleString('es-AR')}</Text>}
                </View>
              </View>
            ))

          /* ─── INGRESOS ─── */
          ) : (
            <>
              <View style={styles.revenueCard}>
                <Text style={styles.revenueTotalLabel}>Ingresos totales BOLT</Text>
                <Text style={styles.revenueTotalVal}>${Math.round(revenue.total).toLocaleString('es-AR')}</Text>
                <Text style={styles.revenueMonthLabel}>Este mes: ${Math.round(revenue.thisMonth).toLocaleString('es-AR')}</Text>
              </View>
              <Text style={styles.sectionTitle}>Top trabajadores</Text>
              {revenue.byWorker.map((w, i) => (
                <View key={i} style={styles.revenueRow}>
                  <Text style={styles.revenueRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.revenueName}>{w.name}</Text>
                    <Text style={styles.revenueCount}>{w.count} trabajos</Text>
                  </View>
                  <Text style={styles.revenueComm}>${Math.round(w.commission).toLocaleString('es-AR')}</Text>
                </View>
              ))}
            </>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  headerSub:   { fontSize: 12, color: '#5C5C5C' },
  adminBadge:  { backgroundColor: '#FFD600', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 'auto' },
  adminBadgeText: { color: '#0D0D0D', fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  tabsScroll: { borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  tabsContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabActive: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  tabText: { fontSize: 14, fontWeight: '700', color: '#5C5C5C' },
  tabTextActive: { color: '#0D0D0D' },
  tabBadge: { backgroundColor: '#E5484D', borderRadius: 999, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  content: { padding: 16, gap: 12 },

  emptyWrap: { alignItems: 'center', paddingVertical: 64, gap: 12 },
  emptyText: { color: '#444', fontSize: 16 },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#FFD60050' },
  retryBtnText: { color: '#FFD600', fontSize: 15, fontWeight: '600' },

  workerCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16,
  },
  workerCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  workerAvatar: { width: 52, height: 52, borderRadius: 999 },
  workerAvatarPlaceholder: {
    width: 52, height: 52, borderRadius: 999,
    backgroundColor: '#1A1A1A', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  workerName:  { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 2 },
  workerPhone: { fontSize: 14, color: '#5C5C5C', marginBottom: 2 },
  workerDate:  { fontSize: 12, color: '#444' },
  workerStatsRow: { flexDirection: 'row', gap: 12 },
  workerStat: { fontSize: 14, color: '#5C5C5C' },

  workerServices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  servicePill: { backgroundColor: '#1A1A00', borderWidth: 1, borderColor: '#FFD60030', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  servicePillText: { color: '#FFD600', fontSize: 14, fontWeight: '600' },

  docsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  docThumb: { width: 64, height: 64, borderRadius: 20, overflow: 'hidden', backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center' },
  docThumbMissing: { borderColor: '#E5484D30' },
  docLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#00000088', fontSize: 12, color: '#fff', textAlign: 'center', paddingVertical: 2 },
  docInfoCol: { flex: 1, justifyContent: 'center', gap: 4 },
  docInfoRow: { fontSize: 12, color: '#5C5C5C' },

  actionRow: { flexDirection: 'row', gap: 10 },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 999,
    backgroundColor: 'rgba(229,72,77,0.08)', borderWidth: 1, borderColor: 'rgba(229,72,77,0.25)',
  },
  rejectBtnText: { color: '#E5484D', fontWeight: '700', fontSize: 16 },
  approveBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 999, backgroundColor: '#FFD600',
  },
  approveBtnText: { color: '#0D0D0D', fontWeight: '700', fontSize: 16 },

  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  reactivateBtn: { marginTop: 8, paddingVertical: 10, alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: '#FFD60040' },
  reactivateBtnText: { color: '#FFD600', fontSize: 14, fontWeight: '700' },

  // KPI summary
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: {
    flex: 1, minWidth: '45%',
    backgroundColor: '#161616', borderRadius: 20,
    padding: 18, alignItems: 'center',
  },
  kpiVal:   { fontSize: 30, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  kpiLabel: { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8, textAlign: 'center' },
  pendingAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#8A8A8A15', borderWidth: 1, borderColor: '#8A8A8A40',
    borderRadius: 20, padding: 14, marginTop: 4,
  },
  pendingAlertText: { flex: 1, color: '#8A8A8A', fontSize: 16, fontWeight: '600' },

  jobCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14,
  },
  jobCardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  jobProfession: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  jobStatusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  jobStatusText: { fontSize: 12, fontWeight: '700' },
  jobWorker:     { fontSize: 14, color: '#5C5C5C', marginBottom: 2 },
  jobAddress:    { fontSize: 14, color: '#444', marginBottom: 8 },
  jobCardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  jobDate:   { fontSize: 14, color: '#444' },
  jobAmount: { fontSize: 16, fontWeight: '700', color: '#FFD600' },

  revenueCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 24, alignItems: 'center', marginBottom: 8,
  },
  revenueTotalLabel: { fontSize: 14, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 8 },
  revenueTotalVal:   { fontSize: 40, fontWeight: '700', color: '#FFD600', marginBottom: 4 },
  revenueMonthLabel: { fontSize: 16, color: '#5C5C5C' },

  sectionTitle: { fontSize: 14, color: '#444', textTransform: 'uppercase', letterSpacing: 1.8, marginTop: 8, marginBottom: 4 },
  revenueRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14,
  },
  revenueRank: { fontSize: 18, fontWeight: '700', color: '#5C5C5C', width: 24, textAlign: 'center' },
  revenueName:  { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  revenueCount: { fontSize: 14, color: '#5C5C5C' },
  revenueComm:  { fontSize: 16, fontWeight: '700', color: '#FFD600' },

  // Image viewer
  imgViewerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  imgViewerClose: {
    position: 'absolute', top: Platform.OS === 'android' ? 44 : 56, right: 20, zIndex: 10,
  },
  imgViewerImg: { width: '90%', height: '70%' },
  imgViewerLabel: {
    marginTop: 16, fontSize: 16, color: '#8A8A8A', fontWeight: '600',
  },

  // Modal rechazo
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modalBox: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 24, width: '100%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 },
  modalSub:   { fontSize: 14, color: '#5C5C5C', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#161616', borderRadius: 20,
    color: '#FFFFFF', fontSize: 16, padding: 14,
    minHeight: 80, textAlignVertical: 'top', marginBottom: 16,
  },
  modalActions:    { flexDirection: 'row', gap: 10 },
  modalCancelBtn:  { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 999, },
  modalCancelText: { color: '#8A8A8A', fontWeight: '700' },
  modalConfirmBtn: { flex: 2, paddingVertical: 13, alignItems: 'center', borderRadius: 999, backgroundColor: '#E5484D' },
  modalConfirmText:{ color: '#fff', fontWeight: '700' },
});

export default AdminScreen;

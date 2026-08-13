import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chargesInApp, isFreeMode } from '../config/monetization';

// ─────────────────────────────────────────────────────────────────────────────
// La pestaña "Trabajos" de Mi negocio: los trabajos que entraron POR BOLT.
// Salió tal cual del viejo WorkerDashboardScreen (historial + stats + próximo
// nivel). Vive en su propio archivo para no pelearse por los nombres de estilos
// con el resto del panel, que ahora es una sola pantalla con cinco pestañas.
//
// 🔴 6-ago-2026 — DEJÓ DE SER "los trabajos que hiciste" para ser EL REGISTRO.
//
//  Maxi probó un pedido de pintor, no llegó a contestarlo, entró a Mi negocio y
//  no había nada: "yo necesito como trabajador tener registro de qué pasó ahí...
//  en todo momento".
//
//  Y tenía razón por partida doble: la lista salía de `jobs` filtrando por
//  professional_id, pero la cascada le cambia ese campo al pasarle el trabajo al
//  siguiente. O sea que el pedido que NO tomaste no es que se mostraba mal:
//  desaparecía. Lo único que quedaba registrado era lo que salía bien.
//
//  Ahora la lista sale de `mi_actividad` (migración 061): una fila por cada vez
//  que un pedido le llegó, con su desenlace. Los que tomó se siguen viendo
//  igual — con el monto y todo —; los que no, dicen por qué.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  pending:          { label: 'Pendiente',    color: '#8A8A8A' },
  accepted:         { label: 'En camino',    color: '#FFD600' },
  arrived:          { label: 'En domicilio', color: '#FFD600' },
  in_progress:      { label: 'Trabajando',   color: '#8A8A8A' },
  awaiting_payment: { label: isFreeMode() ? 'Finalizando' : 'Cobrando', color: '#FFD600' },
  completed:        { label: 'Completado',   color: '#FFD600' },
  cancelled:        { label: 'Cancelado',    color: '#E5484D' },
};

// El desenlace, dicho como se lo diría un compañero: en segunda persona y sin
// tecnicismos. "expired" no le explica nada a nadie.
const DESENLACE = {
  recibido:        { label: 'Esperando tu respuesta', color: '#FFD600' },
  aceptado:        { label: 'Lo tomaste',             color: '#FFD600' },
  completado:      { label: 'Terminado',              color: '#FFD600' },
  rechazado:       { label: 'Lo rechazaste',          color: '#E5484D' },
  vencido:         { label: 'No contestaste',         color: '#8A8A8A' },
  paso_a_otro:     { label: 'Se le pasó a otro',      color: '#8A8A8A' },
  no_te_eligieron: { label: 'Eligieron a otro',       color: '#8A8A8A'    },
  cancelado:       { label: 'Lo canceló el cliente',  color: '#8A8A8A'    },
};

// "6 ago, 19:42" — la hora importa: sin ella no se puede reconstruir si el push
// llegó cuando estaba trabajando o cuando estaba durmiendo.
const cuando = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}, ` +
         `${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
};

const PanelTrabajos = ({ jobs = [], actividad = null, professional, loading = false, step = null }) => {
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const earningBase   = j => j.work_amount || j.visit_amount || 0;
  // En modo gratis el profesional se queda con el 100% (no hay comisión).
  const commFactor    = j => 1 - (chargesInApp() ? (j.commission_pct || 20) : 0) / 100;
  const ahora         = new Date();
  const thisMonthEarned = completedJobs
    .filter(j => {
      const d = new Date(j.completed_at);
      return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
    })
    .reduce((acc, j) => acc + Math.round(earningBase(j) * commFactor(j)), 0);

  return (
    <View>
      {/* Stats rápidas */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{professional?.completed_jobs || 0}</Text>
          <Text style={styles.statLbl}>Trabajos{'\n'}completados</Text>
        </View>
        <View style={styles.statDiv} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>
            {professional?.avg_rating ? Number(professional.avg_rating).toFixed(1) : '—'}
          </Text>
          <Text style={styles.statLbl}>Promedio{'\n'}de estrellas</Text>
          {(professional?.on_time_completions || 0) > 0 && (
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

      {/* ─── El registro: todo lo que te llegó ─────────────────────────────
          `actividad` es null sólo si la migración 061 todavía no corrió en la
          base. En ese caso se cae a la lista vieja (los que tomó) en vez de
          mostrar una pantalla vacía que diría, mintiendo, que nunca le llegó
          nada. */}
      {loading ? (
        <ActivityIndicator color="#FFD600" style={{ marginTop: 32 }} />
      ) : Array.isArray(actividad) ? (
        actividad.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="briefcase-outline" size={44} color="#222" />
            <Text style={styles.emptyTitle}>Todavía no te llegó ningún pedido</Text>
            <Text style={styles.emptyText}>
              Acá va a quedar registrado todo lo que entre por BOLT: el que tomaste, el que
              rechazaste y el que no llegaste a contestar, con el día y la hora. Mientras tanto,
              los trabajos que te llegan por WhatsApp los podés presupuestar desde la pestaña
              Presupuestos.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.listaTitulo}>
              Todo lo que te llegó ({actividad.length})
            </Text>
            {actividad.map(a => {
              const d = DESENLACE[a.estado] || DESENLACE.recibido;
              const cobrado = a.estado === 'completado' && a.work_amount
                ? Math.round(a.work_amount * (1 - (chargesInApp() ? (a.commission_pct || 20) : 0) / 100))
                : null;
              return (
                <View key={a.id} style={[styles.jobCard, { borderLeftWidth: 3, borderLeftColor: d.color + '99' }]}>
                  <View style={styles.jobCardTop}>
                    <Text style={styles.jobProfession}>{a.oficio || 'Trabajo'}</Text>
                    <View style={[styles.jobStatusBadge, { backgroundColor: d.color + '20', borderColor: d.color + '40' }]}>
                      <Text style={[styles.jobStatusText, { color: d.color }]}>{d.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.jobAddress} numberOfLines={1}>{a.direccion || 'Sin dirección'}</Text>
                  {/* El por qué. Es lo que hace que esto sea un registro y no una
                      lista: sin el motivo, "no contestaste" no le dice si fue
                      culpa suya o del sistema. */}
                  {!!a.motivo && (
                    <Text style={styles.jobMotivo} numberOfLines={2}>{a.motivo}</Text>
                  )}
                  <View style={styles.jobCardBottom}>
                    <Text style={styles.jobDate}>{cuando(a.recibido_at)}</Text>
                    {cobrado != null && (
                      <Text style={styles.jobEarned}>+${cobrado.toLocaleString('es-AR')}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )
      ) : jobs.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="briefcase-outline" size={44} color="#222" />
          <Text style={styles.emptyTitle}>Todavía no tenés trabajos</Text>
          <Text style={styles.emptyText}>
            Acá van a aparecer los que entren por BOLT. Mientras tanto, los que te llegan por
            WhatsApp los podés presupuestar desde la pestaña Presupuestos.
          </Text>
        </View>
      ) : jobs.map(j => {
        // Un presupuesto que el cliente todavía no eligió sigue en 'accepted' y
        // decía "En camino": no es cierto y confunde.
        const esperandoEleccion = j.quote_group_id && ['pending', 'accepted'].includes(j.status);
        const s = esperandoEleccion
          ? { label: 'Esperando que te elijan', color: '#8A8A8A' }
          : (STATUS_LABEL[j.status] || STATUS_LABEL.cancelled);
        const earned = j.status === 'completed' && j.work_amount
          ? Math.round(j.work_amount * (1 - (chargesInApp() ? (j.commission_pct || 20) : 0) / 100))
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
                {new Date(j.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              {earned != null && (
                <Text style={styles.jobEarned}>+${earned.toLocaleString('es-AR')}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 12,
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
    marginBottom: 12, padding: 14,
    backgroundColor: '#0D0D00', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a00',
  },
  nextLevelTitle: { fontSize: 14, fontWeight: '700', color: '#FFD600', marginBottom: 3 },
  nextLevelSub:   { fontSize: 14, color: '#5C5C5C' },

  emptyWrap:  { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  emptyText:  { fontSize: 14, color: '#444', textAlign: 'center', lineHeight: 19, maxWidth: 300 },

  jobCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14, marginBottom: 10,
  },
  jobCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  jobProfession: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  jobStatusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  jobStatusText: { fontSize: 12, fontWeight: '700' },
  jobAddress: { fontSize: 14, color: '#5C5C5C', marginBottom: 8 },
  jobMotivo:  { fontSize: 14, color: '#8A8A8A', lineHeight: 17, marginBottom: 8, marginTop: -4 },
  listaTitulo: {
    fontSize: 14, color: '#5C5C5C', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 10, marginTop: 4,
  },
  jobCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobDate: { fontSize: 14, color: '#444' },
  jobEarned: { fontSize: 16, fontWeight: '600', color: '#FFD600' },
});

export default PanelTrabajos;

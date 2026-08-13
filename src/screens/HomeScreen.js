import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Animated, Easing, Dimensions, ScrollView, FlatList,
  ActivityIndicator, Platform, Image, Linking, Alert, PanResponder, Modal,
} from 'react-native';
import VoltMap from '../components/VoltMap';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import locationService from '../services/locationService';
import { tocaOfrecerPantallaCompleta, abrirAjustesPantallaCompleta } from '../services/incomingCall';
import * as Location from 'expo-location';
import favoriteService from '../services/favoriteService';
import ReputationCard from '../components/ReputationCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MisDirecciones from '../components/MisDirecciones';
import { fotoDeOficio } from '../utils/fotosOficios';
import { conTiempo } from '../utils/conTiempo';
import DemoToggle from '../components/DemoToggle';
import { isDemoMode, toggleDemo, setDemoRole } from '../demo/demoMode';
import { DEMO_PROFESSIONAL, DEMO_QUOTE_JOBS, DEMO_JOB } from '../demo/demoData';
import professionService from '../services/professionService';
import professionalService from '../services/professionalService';
import RegisterProfessionalScreen from './RegisterProfessionalScreen';
import ListoParaTrabajar from '../components/ListoParaTrabajar';
import WorkerSignupScreen from './WorkerSignupScreen';
import ProfileScreen from './ProfileScreen';
import { chargesInApp } from '../config/monetization';
import AdminScreen from './AdminScreen';
import HowItWorksScreen from './HowItWorksScreen';
import HistoryScreen from './HistoryScreen';
import MiNegocioScreen from './MiNegocioScreen';
import PrivacyPolicyScreen from './PrivacyPolicyScreen';
import CalculadoraScreen from './CalculadoraScreen';
import AsesoramientoScreen from './AsesoramientoScreen';
import DrawerMenu from '../components/DrawerMenu';
import { abrirAyudaUbicacion } from '../utils/ayuda';

const { height: SCREEN_H } = Dimensions.get('window');

// El minimapa del domicilio no muestra profesionales: sólo tu punto.
const SIN_TRABAJADORES = [];
const BUTTON_SIZE = 64;
const CARD_H = 400;


// Centro de Bahía Blanca (fallback hasta tener ubicación del usuario)
const BAHIA_CENTER = { latitude: -38.7183, longitude: -62.2663 };

// Lista de respaldo de oficios: si la base no responde, igual mostramos chips
// Los 15 oficios REALES, con el id que tienen en la base (6-ago-2026).
//
// 🔴 ACÁ HABÍA UN BUG QUE MANDABA PEDIDOS AL OFICIO EQUIVOCADO.
//
//    La lista anterior tenía oficios inventados que no existen en `professions`
//    (Fumigador, Chapista, Mecánico a domicilio, Mudanzas, Técnico en
//    electrodomésticos) y le faltaban cinco que sí existen (Carpintero,
//    Herrero, Jardinero, Heladeras y lavarropas, Encomiendas / Fletes).
//
//    Pero lo grave era el `.map((name, i) => ({ id: i + 1 }))`: **los ids se
//    fabricaban por el orden de esta lista**. "Cerrajero" quedaba con id 6, que
//    en la base es CARPINTERO. O sea que si esta lista llegaba a usarse —pasa
//    cuando falla getProfessions()— el cliente pedía un cerrajero y el pedido se
//    creaba como carpintero, sin error y sin que nadie se enterara.
//
//    Ahora los ids son los de la base. Si se agrega un oficio allá, hay que
//    agregarlo acá: es una copia de respaldo, no una fuente de verdad.
const FALLBACK_PROFS = [
  { id: 1,  name: 'Electricista' },
  { id: 2,  name: 'Plomero' },
  { id: 3,  name: 'Gasista' },
  { id: 4,  name: 'Pintor' },
  { id: 5,  name: 'Albañil' },
  { id: 6,  name: 'Carpintero' },
  { id: 7,  name: 'Cerrajero' },
  { id: 8,  name: 'Heladeras y lavarropas' },
  { id: 9,  name: 'Jardinero' },
  { id: 10, name: 'Limpieza' },
  { id: 11, name: 'Encomiendas / Fletes' },
  { id: 16, name: 'Aire acondicionado' },
  { id: 17, name: 'Alarmas / Cámaras' },
  { id: 18, name: 'Durlock' },
  { id: 19, name: 'Herrero' },
  { id: 20, name: 'Calderas' },
  { id: 21, name: 'Cortinas' },
];


// ─── Helper: fecha relativa ────────────────────────────────────────────────
const formatRelativeDate = (isoDate) => {
  if (!isoDate) return null;
  const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'ayer';
  if (diff < 7) return `hace ${diff} días`;
  if (diff < 30) return `hace ${Math.floor(diff / 7)} semanas`;
  if (diff < 365) return `hace ${Math.floor(diff / 30)} meses`;
  return 'hace más de un año';
};

// ─── Tarjeta de "Mis profesionales" ────────────────────────────────────────
const MisProfesionalesCard = ({ w, onHire, selectedProfession, userLocation }) => {
  const rating       = parseFloat(w.effective_rating ?? w.avg_rating) || 0;
  const lastJobDate  = formatRelativeDate(w.lastJob?.created_at);
  const profName     = `${w.first_name || ''} ${w.last_name || ''}`.trim();
  const specialty    = w.lastJob?.professions?.name || null;
  const professionObj = w.lastJob
    ? { id: w.lastJob.profession_id, name: w.lastJob.professions?.name }
    : selectedProfession;

  return (
    <View style={styles.misProCard}>
      <View style={styles.misProHeader}>
        {w.avatar_url
          ? <Image source={{ uri: w.avatar_url }} style={styles.misProAvatar} />
          : (
            <View style={styles.misProAvatarPlaceholder}>
              <Text style={styles.misProAvatarInitial}>
                {(w.first_name?.[0] || 'P').toUpperCase()}
              </Text>
            </View>
          )
        }
        <View style={styles.misProInfo}>
          <Text style={styles.misProName}>{profName}</Text>
          {specialty && <Text style={styles.misProRole}>{specialty}</Text>}
          <View style={styles.misProRatingRow}>
            <Ionicons name="star" size={13} color="#FFD600" />
            <Text style={styles.misProRatingVal}>{rating ? rating.toFixed(1) : '—'}</Text>
            {w.completed_jobs > 0 && (
              <Text style={styles.misProRatingJobs}>· {w.completed_jobs} trabajos</Text>
            )}
          </View>
        </View>
        {!w.available && (
          <View style={styles.misProBusyBadge}>
            <Text style={styles.misProBusyText}>Ocupado</Text>
          </View>
        )}
      </View>

      {/* Último trabajo */}
      {(specialty || lastJobDate) && (
        <View style={styles.misProLastJob}>
          <Ionicons name="briefcase-outline" size={12} color="#444" />
          <Text style={styles.misProLastJobText}>
            {specialty || 'Servicio'}{lastJobDate ? ` · ${lastJobDate}` : ''}
          </Text>
        </View>
      )}

      {/* Mi calificación */}
      {w.myRating && (
        <View style={styles.misProMyRating}>
          <Text style={styles.misProMyRatingLabel}>Mi calificación</Text>
          <View style={styles.misProMyRatingStars}>
            {[1,2,3,4,5].map(i => (
              <Ionicons key={i} name={i <= w.myRating ? 'star' : 'star-outline'} size={14} color="#FFD600" />
            ))}
          </View>
        </View>
      )}

      {/* Botón solicitar */}
      <TouchableOpacity
        style={[styles.misProBtn, !w.available && styles.misProBtnOff]}
        onPress={() => {
          if (!w.available) {
            Alert.alert('No disponible ahora', `${w.first_name} no está disponible en este momento. Intentá más tarde.`);
            return;
          }
          if (!professionObj?.id) {
            Alert.alert('Seleccioná un servicio', 'Primero seleccioná qué servicio necesitás para contactar a este profesional.');
            return;
          }
          onHire?.(w, professionObj, userLocation);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="flash" size={16} color={w.available ? '#0D0D0D' : '#444'} />
        <Text style={[styles.misProBtnText, !w.available && styles.misProBtnTextOff]}>
          {w.available ? 'Solicitar nuevamente' : 'No disponible ahora'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ─── Modal de emergencia ───────────────────────────────────────────────────
const EmergencyModal = ({ worker, onConfirm, onClose, loading }) => {
  if (!worker && !loading) return null;

  const dist   = worker?.distance_meters;
  const distFmt = dist != null
    ? dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`
    : '—';
  const estMinutes = dist != null ? Math.max(3, Math.ceil(dist / 40000 * 60)) : null;
  const rating = parseFloat(worker?.effective_rating ?? worker?.avg_rating) || 0;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={emStyles.overlay}>
        <View style={emStyles.sheet}>
          <View style={emStyles.handle} />

          {/* Header */}
          <View style={emStyles.header}>
            <View style={emStyles.headerBadge}>
              <Text style={emStyles.headerBadgeText}>🚨 EMERGENCIA</Text>
            </View>
          </View>
          <Text style={emStyles.headline}>
            Buscaremos el profesional disponible más cercano.
          </Text>

          {loading ? (
            <View style={emStyles.loadingWrap}>
              <ActivityIndicator color="#ff4444" size="large" />
              <Text style={emStyles.loadingText}>Buscando profesionales...</Text>
            </View>
          ) : worker ? (
            <>
              {/* Profesional encontrado */}
              <View style={emStyles.workerCard}>
                <View style={emStyles.workerAvatar}>
                  {worker.avatar_url
                    ? <Image source={{ uri: worker.avatar_url }} style={emStyles.workerAvatarImg} />
                    : (
                      <View style={emStyles.workerAvatarPlaceholder}>
                        <Text style={emStyles.workerAvatarInitial}>
                          {(worker.first_name?.[0] || 'P').toUpperCase()}
                        </Text>
                      </View>
                    )
                  }
                  <View style={emStyles.availableDot} />
                </View>
                <View style={emStyles.workerInfo}>
                  <Text style={emStyles.workerName}>
                    {worker.first_name} {worker.last_name}
                  </Text>
                  <Text style={emStyles.workerRole}>{worker.profession_name}</Text>
                  {rating > 0 && (
                    <View style={emStyles.ratingRow}>
                      <Ionicons name="star" size={12} color="#FFD600" />
                      <Text style={emStyles.ratingVal}>{rating.toFixed(1)}</Text>
                      {worker.completed_jobs > 0 && (
                        <Text style={emStyles.ratingJobs}>· {worker.completed_jobs} trabajos</Text>
                      )}
                    </View>
                  )}
                </View>
              </View>

              {/* Métricas de emergencia */}
              <View style={emStyles.metricsRow}>
                <View style={emStyles.metric}>
                  <Ionicons name="time-outline" size={20} color="#ff4444" />
                  <Text style={emStyles.metricVal}>
                    {estMinutes ? `~${estMinutes} min` : '—'}
                  </Text>
                  <Text style={emStyles.metricLabel}>Tiempo estimado</Text>
                </View>
                <View style={emStyles.metricDiv} />
                <View style={emStyles.metric}>
                  <Ionicons name="location-outline" size={20} color="#ff4444" />
                  <Text style={emStyles.metricVal}>{distFmt}</Text>
                  <Text style={emStyles.metricLabel}>Distancia</Text>
                </View>
                <View style={emStyles.metricDiv} />
                <View style={emStyles.metric}>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#4CAF50" />
                  <Text style={[emStyles.metricVal, { color: '#4CAF50', fontSize: 14 }]}>
                    Disponible
                  </Text>
                  <Text style={emStyles.metricLabel}>Ahora mismo</Text>
                </View>
              </View>

              <Text style={emStyles.priceNote}>
                {chargesInApp()
                  ? `Visita desde $${(worker.min_price ?? 30000).toLocaleString('es-AR')} · Precio mínimo para urgencias`
                  : 'Profesional disponible más cercano · El precio lo acordás directo con él'}
              </Text>
            </>
          ) : null}

          {/* Botones */}
          <TouchableOpacity
            style={[emStyles.confirmBtn, (!worker || loading) && { opacity: 0.4 }]}
            onPress={() => onConfirm(worker)}
            disabled={!worker || loading}
            activeOpacity={0.85}
          >
            <Ionicons name="flash" size={20} color="#fff" />
            <Text style={emStyles.confirmBtnText}>Solicitar emergencia</Text>
          </TouchableOpacity>

          <TouchableOpacity style={emStyles.cancelBtn} onPress={onClose}>
            <Text style={emStyles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const emStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0D0505',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1.5, borderColor: '#ff444430',
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 28, gap: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#ff444440', alignSelf: 'center', marginBottom: 4,
  },

  header:       { alignItems: 'center' },
  headerBadge:  {
    backgroundColor: '#ff4444',
    borderRadius: 20, paddingHorizontal: 20, paddingVertical: 9,
  },
  headerBadgeText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 1.5 },

  headline: {
    fontSize: 16, color: '#BBBBBB', textAlign: 'center', lineHeight: 22,
  },

  loadingWrap: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  loadingText: { fontSize: 16, color: '#555' },

  workerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#1a0808', borderRadius: 14,
    borderWidth: 1, borderColor: '#ff444425', padding: 14,
  },
  workerAvatar: { position: 'relative' },
  workerAvatarImg: { width: 56, height: 56, borderRadius: 999 },
  workerAvatarPlaceholder: {
    width: 56, height: 56, borderRadius: 999,
    backgroundColor: '#2a0a0a', borderWidth: 2, borderColor: '#ff4444',
    alignItems: 'center', justifyContent: 'center',
  },
  workerAvatarInitial: { fontSize: 22, fontWeight: '700', color: '#ff4444' },
  availableDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 14, height: 14, borderRadius: 999,
    backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#0D0505',
  },
  workerInfo:  { flex: 1 },
  workerName:  { fontSize: 16, fontWeight: '700', color: '#F5F5F5', marginBottom: 2 },
  workerRole:  { fontSize: 14, color: '#666', marginBottom: 5 },
  ratingRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingVal:   { fontSize: 14, fontWeight: '600', color: '#FFD600' },
  ratingJobs:  { fontSize: 12, color: '#444' },

  metricsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a0808', borderRadius: 14,
    borderWidth: 1, borderColor: '#ff444420', padding: 14,
  },
  metric:      { flex: 1, alignItems: 'center', gap: 6 },
  metricDiv:   { width: 1, height: 44, backgroundColor: '#2a1010' },
  metricVal:   { fontSize: 16, fontWeight: '700', color: '#ff4444' },
  metricLabel: { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1.8, textAlign: 'center' },

  priceNote: { fontSize: 14, color: '#444', textAlign: 'center' },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#ff4444',
    borderRadius: 16, paddingVertical: 18,
  },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontSize: 16, color: '#444' },
});

// ─── Tarjeta del trabajador seleccionado (sube desde abajo) ───────────────
const WorkerCard = ({ worker, slideAnim, onContact, onClose, isFavorite }) => {
  const displayRating = worker.effective_rating ?? worker.avg_rating ?? 0;
  const completed     = worker.completed_jobs || 0;
  const onTimePct     = completed > 5 ? Math.round((worker.on_time_completions / completed) * 100) : null;
  const dist          = worker.distance_meters < 1000
    ? `${Math.round(worker.distance_meters)} m`
    : `${(worker.distance_meters / 1000).toFixed(1)} km`;
  const initial = (worker.first_name?.[0] || '?').toUpperCase();

  const badges = [];
  if (worker.avg_arrival_minutes && worker.avg_arrival_minutes <= 15) badges.push('⚡ Responde rápido');
  if (displayRating >= 4.8 && completed >= 20)                        badges.push('🏆 Top valorado');
  if (completed >= 50)                                                  badges.push('🔧 Especialista');
  if (isFavorite)                                                       badges.push('⭐ Tu favorito');
  if (worker.estudios_url)                                              badges.push('🛡️ Perfil verificado');

  return (
    <Animated.View style={[styles.card, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.cardHandle} />
      <TouchableOpacity style={styles.cardClose} onPress={onClose}>
        <Ionicons name="close" size={20} color="#888" />
      </TouchableOpacity>

      {/* Foto grande + info */}
      <View style={styles.cardHeader}>
        <View style={styles.cardAvatarWrap}>
          {worker.avatar_url
            ? <Image source={{ uri: worker.avatar_url }} style={styles.cardAvatarImg} />
            : (
              <View style={styles.cardAvatarPlaceholder}>
                <Text style={styles.cardAvatarInitial}>{initial}</Text>
              </View>
            )
          }
          <View style={styles.cardOnlineDot} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>
            {worker.first_name} {worker.last_name}
          </Text>
          <Text style={styles.cardProfession}>{worker.profession_name}</Text>
          <View style={styles.cardRatingRow}>
            <Ionicons name="star" size={14} color="#FFD600" />
            <Text style={styles.cardRatingVal}>
              {displayRating ? Number(displayRating).toFixed(1) : '—'}
            </Text>
            {completed > 0 && (
              <Text style={styles.cardRatingJobs}>· {completed} trabajos</Text>
            )}
          </View>
        </View>
        <View style={styles.cardDistBadge}>
          <Ionicons name="location-sharp" size={12} color="#FFD600" />
          <Text style={styles.cardDistText}>{dist}</Text>
        </View>
      </View>

      {/* Stats: trabajos · puntualidad · respuesta */}
      <View style={styles.cardStats}>
        <View style={styles.cardStat}>
          <Text style={styles.cardStatVal}>{completed}</Text>
          <Text style={styles.cardStatLbl}>trabajos</Text>
        </View>
        {onTimePct !== null && (
          <>
            <View style={styles.cardStatDiv} />
            <View style={styles.cardStat}>
              <Text style={styles.cardStatVal}>{onTimePct}%</Text>
              <Text style={styles.cardStatLbl}>puntualidad</Text>
            </View>
          </>
        )}
        <View style={styles.cardStatDiv} />
        {worker.avg_arrival_minutes ? (
          <View style={styles.cardStat}>
            <Text style={styles.cardStatVal}>{worker.avg_arrival_minutes} min</Text>
            <Text style={styles.cardStatLbl}>respuesta</Text>
          </View>
        ) : chargesInApp() ? (
          <View style={styles.cardStat}>
            <Text style={styles.cardStatVal}>${(worker.min_price ?? 30000).toLocaleString('es-AR')}</Text>
            <Text style={styles.cardStatLbl}>visita</Text>
          </View>
        ) : null}
      </View>

      {/* Badges */}
      {badges.length > 0 && (
        <View style={styles.cardBadgesRow}>
          {badges.map(b => (
            <View key={b} style={styles.cardBadge}>
              <Text style={styles.cardBadgeText}>{b}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Barras de reputación (compactas) */}
      <ReputationCard prof={worker} compact />

      <TouchableOpacity style={styles.requestBtn} onPress={() => onContact(worker)} activeOpacity={0.85}>
        <Ionicons name="flash" size={20} color="#0D0D0D" />
        <Text style={styles.requestBtnText}>
          {chargesInApp() ? `Solicitar — $${(worker.min_price ?? 30000).toLocaleString('es-AR')} visita` : 'Solicitar'}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Radar para trabajadores
const RadarButton = ({ available, toggling, onPress, pulse1, pulse2, pulse3 }) => (
  <View style={styles.radarWrap}>
    <View style={styles.radarContainer}>
      {[pulse1, pulse2, pulse3].map((p, i) => {
        const scale  = p.interpolate({ inputRange: [0,1], outputRange: [1, 3.5] });
        const opacity = p.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.35, 0] });
        return (
          <Animated.View key={i} pointerEvents="none"
            style={[styles.radarRing, { transform: [{ scale }], opacity }]} />
        );
      })}
      <TouchableOpacity
        style={[styles.radarBtn, available && styles.radarBtnOn]}
        onPress={onPress} disabled={toggling} activeOpacity={0.8}
      >
        {toggling
          ? <ActivityIndicator size="small" color={available ? '#0D0D0D' : '#FFD600'} />
          : <Ionicons name={available ? 'radio' : 'radio-outline'} size={26}
              color={available ? '#0D0D0D' : '#888'} />
        }
      </TouchableOpacity>
    </View>
    <Text style={[styles.radarLabel, available && styles.radarLabelOn]}>
      {available ? 'Visible · Tocá para pausar' : 'Activar disponibilidad'}
    </Text>
  </View>
);

// ─── SCREEN PRINCIPAL ─────────────────────────────────
// Palabras del PROBLEMA → rubro (id de profession). Permite que el cliente escriba
// lo que le pasa ("se cortó la luz", "pierde agua") y la app detecte a quién buscar.
// Un mismo síntoma puede sugerir más de un rubro (ej. "humedad" → plomero y albañil).
const PROBLEM_KEYWORDS = {
  1:  ['luz', 'electric', 'enchufe', 'corto', 'cortocircuito', 'tablero', 'termica', 'térmica', 'disyuntor', 'foco', 'lampara', 'lámpara', 'cable', 'toma', 'chispa', 'instalacion electrica', 'sin luz', 'se corto la luz'],
  2:  ['agua', 'caño', 'cano', 'perdida', 'pérdida', 'pierde', 'canilla', 'grifo', 'inodoro', 'baño', 'baño', 'cloaca', 'destap', 'filtracion', 'filtración', 'gotera', 'tanque', 'bomba de agua', 'cañeria', 'cañería', 'desagote', 'pinchadura'],
  3:  ['gas', 'estufa', 'calefon', 'calefón', 'termotanque', 'cocina a gas', 'garrafa', 'olor a gas'],
  4:  ['pintar', 'pintura', 'pintor', 'latex', 'látex', 'esmalte', 'blanquear', 'empapelar', 'repintar'],
  5:  ['revoque', 'ladrillo', 'cemento', 'contrapiso', 'construccion', 'construcción', 'mamposteria', 'mampostería', 'grieta', 'pared rota', 'techo', 'mojinete', 'albañil', 'albanil', 'humedad'],
  7:  ['cerradura', 'llave', 'traba', 'candado', 'puerta trabada', 'me quede afuera', 'quedé afuera', 'bombin', 'bombín', 'cerrajer', 'no abre la puerta'],
  8:  ['heladera', 'lavarropas', 'microondas', 'secarropas', 'electrodomestico', 'electrodoméstico', 'no enfria', 'no enfría', 'freezer', 'horno', 'lavavajilla', 'cocina electrica'],
  10: ['limpieza', 'limpiar', 'mucama', 'ordenar', 'casa sucia', 'limpieza profunda', 'sucio'],
  11: ['mudanza', 'mudar', 'flete', 'transportar', 'trasladar', 'cargar muebles', 'camion', 'camión', 'acarreo'],
  12: ['fumig', 'plaga', 'cucaracha', 'insecto', 'hormiga', 'rata', 'raton', 'ratón', 'mosquito', 'control de plagas', 'bicho'],
  13: ['chapa', 'abolladura', 'auto golpeado', 'granizo', 'carroceria', 'carrocería', 'pintura de auto', 'choque'],
  14: ['auto', 'no arranca', 'motor', 'bateria', 'batería', 'mecanico', 'mecánico', 'coche', 'vehiculo', 'vehículo', 'no enciende', 'auxilio mecanico'],
  16: ['aire', 'aire acondicionado', 'split', 'climatizacion', 'climatización', 'carga de gas', 'frio', 'frío', 'instalacion de aire', 'instalación de aire', 'limpieza de aire', 'aire no anda', 'aire no enfria', 'ventilacion', 'ventilación'],
  17: ['alarma', 'camara', 'cámara', 'camaras', 'cámaras', 'seguridad', 'cctv', 'monitoreo', 'sensor', 'vigilancia', 'dvr', 'instalacion de camaras', 'instalación de cámaras', 'porton automatico', 'portón automático', 'cerco electrico'],
  18: ['durlock', 'placa de yeso', 'placas de yeso', 'tabique', 'cielorraso', 'cielo raso', 'yeso', 'pladur', 'steel framing', 'construccion en seco', 'construcción en seco', 'pared de durlock', 'division', 'división'],
  // Calderas y calefacción salieron de Gasista (id 3) el 10-ago-2026: el que
  // arregla una caldera no necesariamente destapa una garrafa. Si no hay ningún
  // especialista cerca, `getNearbyWorkers` cae igual a Gasista.
  // 'termografia' vive acá porque la hace el mismo: nadie la busca por su
  // nombre, pero el que la escribe tiene que llegar a alguien.
  20: ['caldera', 'calderas', 'calefaccion', 'calefacción', 'calefactor', 'calefactores', 'radiador', 'radiadores', 'piso radiante', 'losa radiante', 'termografia', 'termografía', 'no calienta la casa', 'no calienta el agua'],
};

// (Acá vivía una segunda burbuja arrastrable, copia de DraggableBubble y ya sin
//  uso. El pin del trabajo en curso ahora es uno solo y vive en App.js, para que
//  se vea en todas las pantallas.)

const HomeScreen = ({
  session, professional, onRequestJob, onOpenAssistant, onActiveJob, onIncomingJob,
  activeJob,
  atajo, onAtajoUsado,
}) => {
  const userId = session?.user?.id;

  // Estado del profesional (si el user está registrado como trabajador)
  const [available, setAvailable]         = useState(professional?.available ?? false);
  const [toggling, setToggling]           = useState(false);

  // Mapa
  const [userLocation, setUserLocation]   = useState(null);
  const [workers, setWorkers]             = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);

  // Búsqueda
  const [professions, setProfessions]     = useState([]);
  const [query, setQuery]                 = useState('');
  const [results, setResults]             = useState([]);
  const [selectedProfession, setSelectedProfession] = useState(null);

  // Navegación
  const [showDrawer, setShowDrawer]         = useState(false);
  const [showRegister, setShowRegister]     = useState(false);
  const [showProfile, setShowProfile]       = useState(false);
  const [showHistory, setShowHistory]       = useState(false);
  // Un solo panel: "Mi negocio" absorbió al viejo panel de trabajador
  // (WorkerDashboardScreen), que ya no lo abre nadie.
  const [showNegocio, setShowNegocio]       = useState(false);
  const [visibleEnBusquedas, setVisibleEnBusquedas] = useState(null);
  const [verDirecciones, setVerDirecciones] = useState(false);
  // El modo lo elige el usuario y se recuerda. Un profesional puede pedir un
  // servicio sin dejar de ser profesional: son dos lados de la misma app.
  const [modoTrabajo, setModoTrabajo]       = useState(false);
  const [puertaModo, setPuertaModo]         = useState(false);
  // El acceso directo entra derecho a cargar el presupuesto, sin pasar por la
  // lista. Es todo el punto del atajo: sacar el celular y escribir.
  const [negocioEnNuevo, setNegocioEnNuevo] = useState(false);
  const [showAdmin, setShowAdmin]           = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showPrivacy, setShowPrivacy]       = useState(false);
  const [showCalculadora, setShowCalculadora]     = useState(false);
  const [showAsesoramiento, setShowAsesoramiento] = useState(false);
  const newJobChannelRef = useRef(null);

  // "Estás listo para recibir trabajos" — se decide una sola vez por apertura de
  // la app, no en cada render: si dependiera de `available` en vivo, volvería a
  // saltar apenas alguien pausa su disponibilidad a propósito.
  const [avisoDisponible, setAvisoDisponible] = useState(false);
  const avisoYaEvaluado = useRef(false);

  // Tips rotativos

  // Banner de pago para clientes sin pago verificado
  const [paymentVerified, setPaymentVerified] = useState(true);

  // Favoritos (solo clientes)
  const [favorites, setFavorites] = useState([]);

  const [demoOn, setDemoOn] = useState(false);

  // Emergencia
  const [showEmergency, setShowEmergency]       = useState(false);
  const [emergencyWorker, setEmergencyWorker]   = useState(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);

  // Radar animation
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);
  const locationSub = useRef(null);

  // Card animation
  const slideAnim = useRef(new Animated.Value(CARD_H)).current;


  // ── El modo (cliente / trabajo) ──────────────────────
  const aprobado   = professional?.verification_status === 'approved';
  const estadoAlta = aprobado ? 'aprobado' : (professional ? 'revision' : 'sin-alta');

  useEffect(() => {
    AsyncStorage.getItem('bolt.modo')
      .then(v => { if (v === 'trabajo' && aprobado) setModoTrabajo(true); })
      .catch(() => {});
  }, [aprobado]);

  // Si dejó de estar aprobado (o nunca lo estuvo), no puede quedar del lado del
  // trabajo mirando una pantalla que no le corresponde.
  useEffect(() => { if (!aprobado && modoTrabajo) setModoTrabajo(false); }, [aprobado, modoTrabajo]);

  const cambiarModo = () => {
    if (!aprobado) { setPuertaModo(true); return; }
    const nuevo = !modoTrabajo;
    setModoTrabajo(nuevo);
    AsyncStorage.setItem('bolt.modo', nuevo ? 'trabajo' : 'cliente').catch(() => {});
  };

  const primerNombre = (
    session?.user?.user_metadata?.full_name ||
    session?.user?.email?.split('@')[0] ||
    ''
  ).split(' ')[0];

  const hoyLargo = () => {
    const d = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    return d.charAt(0).toUpperCase() + d.slice(1);
  };

  // Invisible en las búsquedas = no hay ubicación guardada en la base.
  // Mientras no sabemos vale `null`, y no se avisa nada: un aviso que aparece
  // porque el dato todavía no llegó es peor que no avisar.
  const sinUbicacion = visibleEnBusquedas === false;

  // ─── Carga inicial ───────────────────────────────────
  useEffect(() => {
    professionService.getProfessions()
      .then(list => setProfessions(list && list.length ? list : FALLBACK_PROFS))
      .catch(() => setProfessions(FALLBACK_PROFS));
    initLocation();
    // Releer la disponibilidad real desde la base: el objeto `professional` se
    // carga una sola vez al login y queda viejo, así que al volver al home no
    // debe quedar "no disponible" si en la base sigue activo.
    if (professional?.id && userId) {
      supabase
        .from('professionals')
        .select('available, verification_status, first_name, location')
        .eq('user_id', userId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setAvailable(!!data.available);
          // 🔴 9-ago-2026 — el aviso "estás disponible pero no te ve nadie"
          //    miraba el GPS de ESTA pantalla (userLocation), que al abrir la
          //    app tarda en llegar y arranca en null. Resultado: el aviso salía
          //    aunque en la base la ubicación estuviera guardada y el
          //    profesional fuera perfectamente visible; desactivar y volver a
          //    activar lo "arreglaba" porque forzaba el GPS (Maxi).
          //    Lo que decide si te ven es la función nearby_workers, y pide
          //    tres cosas: aprobado, disponible y **location no nula**. La
          //    antigüedad no la mira. Así que el aviso se basa en eso y nada más.
          setVisibleEnBusquedas(!!data.location);
        })
        .catch(() => {});
    }
    // Verificar si el cliente (no trabajador) tiene pagos completados
    if (!professional && userId) {
      supabase
        .from('jobs')
        .select('id')
        .eq('client_id', userId)
        .eq('status', 'completed')
        .limit(1)
        .then(({ data }) => setPaymentVerified((data?.length ?? 0) > 0))
        .catch(() => {});
      favoriteService.getFavorites(userId).then(setFavorites).catch(() => {});
    }
  }, []);

  // Sincronizar available cuando llega professional desde App.js
  useEffect(() => {
    setAvailable(professional?.available ?? false);
  }, [professional?.id]);

  // Aprobado pero invisible en el mapa: el alta quedaba a un botón de terminar
  // y ese botón nadie lo encontraba —8 de 10 profesionales estaban así—.
  //
  // Lo decide `debe_activar_radar()` y no una consulta de acá, porque no alcanza
  // con mirar el radar: hay quien figura disponible y tampoco aparece, porque
  // nunca guardó una ubicación. Esa ubicación sólo la puede tomar el teléfono.
  //
  // Va en su propio efecto y no en el de montaje porque `professional` llega
  // desde App.js después de una consulta: al montar todavía es null.
  useEffect(() => {
    if (avisoYaEvaluado.current) return;          // una vez por apertura, no por render
    if (!professional?.id || !userId) return;
    avisoYaEvaluado.current = true;
    if (isDemoMode()) return;

    supabase
      .rpc('debe_activar_radar')
      .then(({ data }) => { if (data === true) setAvisoDisponible(true); })
      .catch(() => {});
  }, [professional?.id, userId]);

  // ─── La dirección fija ───────────────────────────────
  //
  // 🔴 10-ago-2026 — elegías tu dirección, la app la guardaba… y al volver a
  // abrirla estaba de nuevo la que el GPS eligió mal. La causa: `initLocation()`
  // corría siempre al arrancar y pisaba lo elegido, y lo que se guardaba en la
  // cuenta no lo leía nadie al iniciar.
  //
  // Ahora la dirección elegida MANDA: se guarda en el teléfono (instantánea, sin
  // esperar la red), se lee antes que nada, y el GPS sólo se pide si no hay
  // ninguna guardada o si la pedís vos con "Usar mi ubicación actual".
  const CLAVE_DIR = 'bolt.direccion.fija';

  const guardarDireccionFija = (loc) => {
    AsyncStorage.setItem(CLAVE_DIR, JSON.stringify({
      latitude: loc.latitude, longitude: loc.longitude, address: loc.address || null,
    })).catch(() => {});
    supabase.auth.updateUser({
      data: { direccion: loc.address, lat: loc.latitude, lng: loc.longitude },
    }).catch(() => {});
  };

  const usarDireccionFija = (d) => {
    const loc = {
      latitude: d.latitude, longitude: d.longitude,
      latitudeDelta: 0.04, longitudeDelta: 0.04,
      address: d.address || null,
    };
    setUserLocation(loc);
    return loc;
  };

  // ─── Ubicación inicial y workers ─────────────────────
  // `forzar` = te pidió el GPS a propósito. Sin eso, una dirección fija guardada
  // gana siempre: es una decisión que ya tomó el usuario.
  const initLocation = async (forzar = false) => {
    try {
      if (!forzar) {
        const guardada = await AsyncStorage.getItem(CLAVE_DIR).catch(() => null);
        if (guardada) {
          const d = JSON.parse(guardada);
          if (d?.latitude && d?.longitude) {
            const loc = usarDireccionFija(d);
            if (selectedProfession) fetchWorkers(selectedProfession.id, loc.latitude, loc.longitude);
            return;
          }
        }
      }

      const granted = await locationService.requestPermission();
      if (!granted) return;

      // Pedir la posición con UN reintento: en Android "frío" el primer fix
      // puede fallar/expirar aunque el GPS esté encendido.
      let pos = await locationService.getCurrentLocation().catch(() => null);
      if (!pos?.coords) {
        await new Promise(r => setTimeout(r, 1500)); // pequeño respiro y reintento
        pos = await locationService.getCurrentLocation().catch(() => null);
      }
      if (!pos?.coords) return; // sin spamear alerts: lo resolvemos al buscar (ensureLocation)
      const { latitude, longitude } = pos.coords;

      // Reverse geocode para obtener la dirección legible
      let address = null;
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          const parts = [place.street, place.streetNumber, place.city || place.subregion].filter(Boolean);
          address = parts.join(', ') || null;
        }
      } catch { /* sin dirección, el usuario puede ingresarla manualmente */ }

      const loc = {
        latitude,
        longitude,
        latitudeDelta:  0.04,
        longitudeDelta: 0.04,
        address,
      };
      setUserLocation(loc);
      // Si lo pediste vos, esa pasa a ser tu dirección fija: la próxima vez que
      // abras la app te espera ahí y no hay que volver a pedir el GPS.
      if (forzar) guardarDireccionFija(loc);
      buildAmbientOnStreets({ latitude, longitude })                   // y, si hay red, sobre calles reales
        .catch(() => {});
      if (selectedProfession) fetchWorkers(selectedProfession.id, latitude, longitude);
    } catch { /* silent */ }
  };

  // ─── Asegurar ubicación bajo demanda ─────────────────
  // Si ya tenemos userLocation la devolvemos; si no, pedimos permiso e
  // intentamos obtener la posición ahí mismo. Devuelve null SOLO si el permiso
  // fue denegado o no se pudo obtener la posición de ninguna forma.
  const ensureLocation = async () => {
    if (userLocation?.latitude) return userLocation;

    const granted = await locationService.requestPermission();
    if (!granted) return null; // permiso DENEGADO

    const pos = await locationService.getCurrentLocation().catch(() => null);
    if (!pos?.coords) return null; // permiso OK pero no se pudo fijar la posición
    const { latitude, longitude } = pos.coords;

    // Reverse geocode (best-effort, no bloquea si falla)
    let address = null;
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (place) {
        const parts = [place.street, place.streetNumber, place.city || place.subregion].filter(Boolean);
        address = parts.join(', ') || null;
      }
    } catch { /* sin dirección */ }

    const loc = {
      latitude,
      longitude,
      latitudeDelta:  0.04,
      longitudeDelta: 0.04,
      address,
    };
    setUserLocation(loc);
    return loc;
  };

  // ─── Buscar trabajadores en el mapa ──────────────────
  const fetchWorkers = async (professionId, lat, lng) => {
    try {
      const data = await professionalService.getNearbyWorkers(professionId, lat, lng, 20);
      const JITTER = 0.004;
      const mapped = data
        .filter(w => !professional || w.user_id !== userId)  // no mostrar el propio perfil como cliente
        .map(w => ({
          ...w,
          lat: (w.latitude  ?? userLocation?.latitude)  + (Math.random() - 0.5) * JITTER,
          lng: (w.longitude ?? userLocation?.longitude) + (Math.random() - 0.5) * JITTER,
          profession_name: selectedProfession?.name || '',
        }));
      setWorkers(mapped);
    } catch { /* silent */ }
  };

  // ─── Supabase Realtime: ubicaciones en vivo ───────────
  useEffect(() => {
    if (!selectedProfession || !userLocation) return;

    fetchWorkers(selectedProfession.id, userLocation.latitude, userLocation.longitude);

    const channel = supabase
      .channel('professionals-location')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'professionals',
        filter: `available=eq.true`,
      }, (payload) => {
        if (!payload.new.location) return;
        setWorkers(prev => prev.map(w =>
          w.id === payload.new.id
            ? { ...w, available: payload.new.available }
            : w
        ).filter(w => w.available));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [selectedProfession, userLocation]);

  // ─── Búsqueda por PROBLEMA → detecta el rubro ─────────
  // Matchea por nombre del oficio o por las palabras del problema descrito.
  useEffect(() => {
    const q = query.toLowerCase().trim();
    if (q.length < 3) { setResults([]); return; }
    setResults(
      professions
        .filter(p => {
          if (p.name.toLowerCase().includes(q)) return true;
          const kws = PROBLEM_KEYWORDS[p.id] || [];
          return kws.some(kw => q.includes(kw) || (q.length >= 4 && kw.includes(q)));
        })
        .slice(0, 5)
    );
  }, [query, professions]);

  const selectProfession = (prof) => {
    setSelectedProfession(prof);
    setQuery(prof.name);
    setResults([]);
    setSelectedWorker(null);
    closeCard();
    if (userLocation) fetchWorkers(prof.id, userLocation.latitude, userLocation.longitude);
  };

  const clearProfession = () => {
    setSelectedProfession(null);
    setQuery('');
    setWorkers([]);
    setSelectedWorker(null);
    closeCard();
  };

  // ─── Seleccionar trabajador (abrir card) ─────────────
  const selectWorker = (worker) => {
    setSelectedWorker(worker);
    Animated.spring(slideAnim, {
      toValue: 0, useNativeDriver: true,
      tension: 65, friction: 11,
    }).start();
  };

  const closeCard = () => {
    Animated.timing(slideAnim, {
      toValue: CARD_H, duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => setSelectedWorker(null));
  };

  const handleContact = (worker) => {
    closeCard();
    onRequestJob?.(worker, selectedProfession, userLocation);
  };


  // Inicia el demo del lado CLIENTE (sin datos reales)
  const startDemo = () => {
    setDemoRole('client');
    const prof = DEMO_PROFESSIONAL;
    const fakeProfession = { id: 1, name: 'Electricidad' };
    onRequestJob?.(prof, fakeProfession, userLocation || { latitude: -38.7196, longitude: -62.2724, address: 'Demo — Bahía Blanca' });
  };

  // Inicia el demo del lado TRABAJADOR (le entra un pedido de ejemplo)
  const startWorkerDemo = () => {
    setDemoRole('worker');
    onIncomingJob?.({ ...DEMO_JOB, status: 'pending' });
  };


  // ─── Radar del trabajador ─────────────────────────────
  useEffect(() => {
    if (!professional?.id || !userId) return;

    if (available) {
      locationService.requestPermission().then(granted => {
        if (!granted) return;
        locationService.getCurrentLocation().then(pos => {
          professionalService.updateLocation(userId, pos.coords.latitude, pos.coords.longitude);
        });
        locationService.watchLocation(async (lat, lng) => {
          await professionalService.updateLocation(userId, lat, lng);
        }).then(sub => { locationSub.current = sub; });
      });

      const makePulse = (val, delay) =>
        Animated.loop(Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]));
      animRef.current = Animated.parallel([makePulse(pulse1, 0), makePulse(pulse2, 600), makePulse(pulse3, 1200)]);
      animRef.current.start();
    } else {
      locationSub.current?.remove();
      locationSub.current = null;
      animRef.current?.stop();
      [pulse1, pulse2, pulse3].forEach(p => p.setValue(0));
    }

    return () => {
      locationSub.current?.remove();
      locationSub.current = null;
    };
  }, [available, professional?.id]);

  // Divulgación prominente de ubicación en segundo plano (requisito de Google Play):
  // se muestra ANTES de pedir el permiso del sistema operativo.
  const pedirConsentimientoUbicacion = () => new Promise((resolve) => {
    // `onDismiss` + una sola pasada: en Android el cartel se puede cerrar con el
    // botón de atrás sin tocar ninguna opción, y ahí la promesa quedaba colgada
    // para siempre — con el botón clavado en "Activando…".
    let listo = false;
    const contestar = (v) => { if (!listo) { listo = true; resolve(v); } };
    Alert.alert(
      '📍 Ubicación mientras trabajás',
      'BOLT usa tu ubicación —incluso en segundo plano y con la app minimizada— ' +
      'únicamente mientras tenés tu disponibilidad activada, para que los clientes ' +
      'vean tu recorrido en tiempo real durante un trabajo en curso.\n\n' +
      'No se rastrea tu ubicación cuando estás fuera de servicio. Podés desactivarla ' +
      'cuando quieras apagando tu disponibilidad.',
      [
        { text: 'No, ahora no', style: 'cancel', onPress: () => contestar(false) },
        { text: 'Entiendo, continuar', onPress: () => contestar(true) },
      ],
      { cancelable: false, onDismiss: () => contestar(false) }
    );
  });

  // `conTiempo` (el que salvó a "Activando…") ahora vive en src/utils/conTiempo.js:
  // lo usa también la pantalla de aceptar un trabajo, y dos copias del mismo
  // helper es exactamente cómo se arregla un lado y se olvida el otro.

  // `forzarEncendido` existe porque la pantalla de "ponete disponible" también
  // le sale a quien YA figura disponible pero nunca guardó su ubicación: para
  // ése, alternar lo apagaría, que es exactamente lo contrario de lo que pide
  // el botón que tocó. Ojo al llamarla desde un onPress: hay que envolverla,
  // porque el evento del toque llegaría como primer argumento y sería truthy.
  const handleToggle = async (forzarEncendido = false) => {
    if (toggling) return;
    setToggling(true);
    const next = forzarEncendido ? true : !available;

    // Antes de activarse: pedir consentimiento informado de ubicación en background
    if (next) {
      const consiente = await pedirConsentimientoUbicacion();
      if (!consiente) { setToggling(false); return; }
    }

    setAvailable(next);
    // Al prender el radar es CUANDO importa que la alarma suene con el telefono
    // bloqueado. Antes solo se ofrecia al registrarse, asi que los que ya
    // estaban registrados nunca lo vieron y no se enteraban de los trabajos
    // (Android 14+ degrada la notificacion a banner comun). 31-jul-2026.
    if (next) {
      tocaOfrecerPantallaCompleta().then((hace_falta) => {
        if (!hace_falta) return;
        Alert.alert(
          'Que te suene aunque tengas el celu bloqueado',
          'Para que los trabajos te entren como una llamada —con sonido y pantalla completa— falta un permiso de Android. Es una vez sola.',
          [
            { text: 'Ahora no', style: 'cancel' },
            { text: 'Activarlo', onPress: () => abrirAjustesPantallaCompleta() },
          ]
        );
      }).catch(() => {});
    }
    try {
      if (next) {
        // Guardar ubicación ANTES de aparecer como disponible.
        //
        // 🔴 Si NO se pudo guardar, no nos marcamos disponibles. Antes se
        // salteaba la ubicación y se seguía igual, y quedaba `available = true`
        // sin punto en el mapa: el prestador lee "Estás disponible" y
        // `nearby_workers` no lo devuelve NUNCA, así que es invisible y no se
        // entera. Como quedó escrito en la migración 051 (1-ago-2026), ese
        // estado "es peor que estar apagado, porque parece que está todo bien"
        // — y es el motivo por el que 8 de 11 aprobados no le llegaban a nadie.
        // Cada paso con su tiempo máximo: el diálogo de permisos del sistema y
        // el GPS pueden no volver nunca, y eso dejaba el botón clavado.
        const granted = await conTiempo(locationService.requestPermission(), 60000, false);
        const pos = granted
          ? await conTiempo(locationService.getCurrentLocation(), 15000, null)
          : null;
        if (!pos) {
          setAvailable(false);
          // Acá es donde más se traba la gente: sin ubicación no aparece en el
          // mapa y no se entera. El botón a la guía sale del paso sin depender
          // de que haya alguien del otro lado para explicárselo.
          Alert.alert(
            'No pudimos tomar tu ubicación',
            granted
              ? 'La necesitamos para mostrarte a los clientes de tu zona. Fijate que el GPS esté encendido y probá de nuevo.'
              : 'Activá el permiso de ubicación para BOLT en los ajustes del teléfono y probá de nuevo.',
            [
              { text: 'Cómo activarlo', onPress: () => abrirAyudaUbicacion() },
              { text: 'Entendido', style: 'cancel' },
            ]
          );
          return; // el finally libera el botón igual
        }
        await conTiempo(
          professionalService.updateLocation(userId, pos.coords.latitude, pos.coords.longitude),
          15000, 'timeout'
        );
      }

      // Ésta es LA que importa: si no se marca disponible, no le entra ningún
      // trabajo. Por eso es la única cuyo resultado se comprueba.
      const guardado = await conTiempo(
        professionalService.setAvailability(userId, next).then(() => 'ok'),
        15000, null
      );
      if (guardado !== 'ok') throw new Error('no se pudo guardar la disponibilidad');

      // El seguimiento en segundo plano es un extra: si tarda o falla, ya estás
      // disponible igual. No puede frenar el encendido.
      if (next) {
        conTiempo(locationService.startBackgroundTracking(), 10000).catch(() => {});
      } else {
        conTiempo(locationService.stopBackgroundTracking(), 10000).catch(() => {});
      }
    } catch {
      setAvailable(!next);
      Alert.alert(
        next ? 'No pudimos activarte' : 'No pudimos apagar tu disponibilidad',
        'Puede ser la señal. Probá de nuevo en un momento — si sigue igual, escribinos y lo vemos.',
      );
    } finally {
      setToggling(false);
    }
  };

  const handleEmergencyPress = async () => {
    // Intentamos asegurar la ubicación en el momento (con permiso + fix robusto)
    const loc = await ensureLocation();
    if (!loc) {
      // Distinguimos el motivo real para no mentirle al usuario
      const permGranted = await locationService.requestPermission();
      if (!permGranted) {
        Alert.alert('Ubicación requerida', 'Activá el permiso de ubicación para BOLT en los ajustes del teléfono.');
      } else {
        Alert.alert('No pudimos obtener tu ubicación', 'Asegurate de tener el GPS encendido y probá de nuevo.');
      }
      return;
    }
    setEmergencyWorker(null);
    setShowEmergency(true);
    setEmergencyLoading(true);
    try {
      const nearest = await professionalService.getNearestAvailable(
        loc.latitude, loc.longitude
      );
      setEmergencyWorker(nearest || null);
      if (!nearest) {
        Alert.alert('Sin disponibilidad', 'No hay profesionales disponibles en este momento. Intentá en unos minutos.');
        setShowEmergency(false);
      }
    } catch {
      Alert.alert('Error', 'No se pudo buscar profesionales. Verificá tu conexión.');
      setShowEmergency(false);
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleEmergencyConfirm = (worker) => {
    if (!worker) return;
    setShowEmergency(false);
    const profession = { id: worker.profession_id, name: worker.profession_name };
    onRequestJob?.(worker, profession, userLocation);
  };

  // Abre el asistente asegurando la ubicación primero (mismo patrón que la
  // búsqueda de emergencia): así no llega null al asistente cuando el fix de
  // GPS todavía no se obtuvo. Si no se puede, abre igual (sin ubicación) para
  // no bloquear al usuario; el asistente permite ingresar la dirección a mano.
  const openAssistantWithLocation = async (mode) => {
    const loc = await ensureLocation();
    onOpenAssistant?.(loc || userLocation, mode);
  };

  // Tocar un oficio abre el asistente con la frase empezada. Antes seleccionaba
  // el oficio y pintaba el mapa, que no lleva a ningún lado: los profesionales
  // NO se eligen desde el mapa. El camino real siempre fue contar el problema.
  const abrirAsistenteConOficio = async (p) => {
    const loc = await ensureLocation();
    onOpenAssistant?.(loc || userLocation, 'text', p);
  };

  // ─── Acceso directo: bolt://nuevo-presupuesto ────────
  //  Llega desde App.js. Sólo tiene sentido para un profesional aprobado: si
  //  lo toca cualquier otro, la app abre normal y no pasa nada raro.
  useEffect(() => {
    if (atajo !== 'nuevoPresupuesto') return;
    if (professional?.verification_status === 'approved') {
      setShowNegocio(true);
      setNegocioEnNuevo(true);
    }
    onAtajoUsado?.();
  }, [atajo, professional?.verification_status]);

  // ─── Drawer navigation ───────────────────────────────
  const handleDrawerNavigate = (dest) => {
    switch (dest) {
      case 'profile':     setShowProfile(true);     break;
      case 'history':     setShowHistory(true);     break;
      case 'register':    setShowRegister(true);    break;
      case 'miNegocio':   setShowNegocio(true);     break;
      case 'admin':       setShowAdmin(true);       break;
      case 'howItWorks':  setShowHowItWorks(true);  break;
      case 'privacy':     setShowPrivacy(true);     break;
      case 'calculadora':   setShowCalculadora(true);   break;
      case 'asesoramiento': setShowAsesoramiento(true); break;
    }
  };

  // ─── Navegación interna ──────────────────────────────
  if (showRegister) {
    return <WorkerSignupScreen userId={userId} session={session} onBack={() => setShowRegister(false)} />;
  }
  if (showProfile) {
    return <ProfileScreen session={session} professional={professional} onClose={() => setShowProfile(false)} />;
  }
  if (showHistory) {
    return <HistoryScreen session={session} professional={professional} onClose={() => setShowHistory(false)} onOpenJob={(job) => { setShowHistory(false); onActiveJob?.(job); }} />;
  }
  if (showNegocio && professional) {
    return (
      <MiNegocioScreen
        professional={professional}
        session={session}
        abrirNuevo={negocioEnNuevo}
        onClose={() => { setShowNegocio(false); setNegocioEnNuevo(false); }}
        onAvailabilityChange={setAvailable}
      />
    );
  }
  if (showAdmin) {
    return <AdminScreen session={session} onClose={() => setShowAdmin(false)} />;
  }
  if (showHowItWorks) {
    return <HowItWorksScreen onClose={() => setShowHowItWorks(false)} />;
  }
  if (showPrivacy) {
    return <PrivacyPolicyScreen onClose={() => setShowPrivacy(false)} />;
  }
  if (showCalculadora) {
    return <CalculadoraScreen onClose={() => setShowCalculadora(false)} />;
  }
  if (showAsesoramiento) {
    return <AsesoramientoScreen onClose={() => setShowAsesoramiento(false)} />;
  }

  // ─── RENDER ──────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Modal de emergencia */}
      {showEmergency && (
        <EmergencyModal
          worker={emergencyWorker}
          loading={emergencyLoading}
          onConfirm={handleEmergencyConfirm}
          onClose={() => { setShowEmergency(false); setEmergencyWorker(null); }}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────────
          🔴 9-ago-2026 — EL HOME SIN MAPA DE FONDO.
          Antes el mapa ocupaba la pantalla entera y arriba flotaba todo. Se
          veía cargado y, peor, mentía: los pines eran `buildAmbientWorkers`,
          once puntos calculados con seno y coseno alrededor tuyo, y el cartel
          decía "11 profesionales activos" —siempre 11, invenatdo—. En el
          teléfono de un tester quedaban todos amontonados encima del nombre de
          la ciudad, con los halos pisándose (Maxi, 9-ago).

          Ahora el mapa aparece donde aporta y dice la verdad: chico, mostrando
          TU domicilio, que es donde va a ir el que venga. Y el contenido va en
          un scroll normal, así no queda el bloque negro vacío que dejaba el
          panel de altura fija.
          ───────────────────────────────────────────────────────────────── */}

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowDrawer(true)}
          accessibilityRole="button" accessibilityLabel="Abrir el menú">
          <Ionicons name="menu" size={24} color="#FFD600" />
        </TouchableOpacity>

        {/* Mantené apretado el logo 1,5 s para el modo demo */}
        <TouchableOpacity
          style={{ flex: 1, alignItems: 'center' }}
          onLongPress={() => {
            if (!isDemoMode()) toggleDemo();
            setDemoOn(true);
            Alert.alert(
              '⚡ Modo demo',
              'Mirá la app de punta a punta, sin datos reales. ¿Desde qué lado querés verla?',
              [
                { text: 'Salir', style: 'cancel', onPress: () => { if (isDemoMode()) toggleDemo(); setDemoOn(false); } },
                { text: '🔧 Trabajador', onPress: startWorkerDemo },
                { text: '👤 Cliente', onPress: startDemo },
              ],
            );
          }}
          delayLongPress={1500}
          activeOpacity={1}
        >
          <Text style={[styles.logoText, demoOn && { opacity: 0.7 }]}>BOLT</Text>
        </TouchableOpacity>

        {/* El botón de modo. Al que no es profesional le abre la puerta del alta
            en vez de no hacer nada: un botón que no lleva a ningún lado es peor
            que no tenerlo. */}
        <TouchableOpacity
          style={[styles.modeBtn, modoTrabajo && styles.modeBtnOn]}
          onPress={cambiarModo}
          accessibilityRole="button"
          accessibilityLabel={modoTrabajo ? 'Volver al modo cliente' : 'Pasar al modo trabajo'}
        >
          <Ionicons
            name={modoTrabajo ? 'flash' : 'briefcase-outline'}
            size={15}
            color={modoTrabajo ? '#0D0D0D' : '#FFFFFF'}
          />
          <Text style={[styles.modeBtnText, modoTrabajo && styles.modeBtnTextOn]}>
            {modoTrabajo ? 'Modo trabajo' : 'Trabajar'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView
        style={styles.homeScroll}
        contentContainerStyle={styles.homeContent}
        showsVerticalScrollIndicator={false}
      >
        {!modoTrabajo ? (
          /* ─────────────── LADO CLIENTE ─────────────── */
          <>
            <Text style={styles.eyebrow}>Hola {primerNombre}</Text>
            <Text style={styles.display}>¿Qué se rompió <Text style={styles.displayEm}>hoy</Text>?</Text>

            <TouchableOpacity style={styles.buscador} activeOpacity={0.85}
              onPress={() => openAssistantWithLocation('text')}>
              <Ionicons name="search" size={19} color="#8A8A8A" />
              <Text style={styles.buscadorTexto}>Ej: se me tapó el baño</Text>
            </TouchableOpacity>

            <View style={styles.modosRow}>
              {[
                { icon: 'create-outline', txt: 'Escribir', mode: 'text' },
                { icon: 'mic-outline',    txt: 'Audio',    mode: 'audio' },
                { icon: 'camera-outline', txt: 'Foto',     mode: 'camera' },
              ].map(m => (
                <TouchableOpacity key={m.mode} style={styles.modoBtn}
                  onPress={() => openAssistantWithLocation(m.mode)} activeOpacity={0.85}>
                  <Ionicons name={m.icon} size={17} color="#8A8A8A" />
                  <Text style={styles.modoBtnText}>{m.txt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* El mapa, chico y honesto: tu domicilio. Se toca para cambiarlo. */}
            <TouchableOpacity style={styles.miniMapa} activeOpacity={0.9} onPress={() => setVerDirecciones(true)}>
              <VoltMap
                userLocation={userLocation}
                workers={SIN_TRABAJADORES}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.miniMapaVelo} pointerEvents="none" />
              <View style={styles.miniMapaPie} pointerEvents="none">
                <Ionicons name="location" size={14} color="#8A8A8A" />
                <Text style={styles.miniMapaDir} numberOfLines={1}>
                  {userLocation?.address || 'Buscando tu ubicación…'}
                </Text>
                <Text style={styles.miniMapaCambiar}>Cambiar</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.confianza}>
              <View style={styles.confianzaFila}>
                <Ionicons name="shield-checkmark-outline" size={17} color="#8A8A8A" />
                <Text style={styles.confianzaTexto}>
                  <Text style={styles.confianzaFuerte}>Revisados</Text> uno por uno por BOLT
                </Text>
              </View>
              <View style={styles.confianzaFila}>
                <Ionicons name="key-outline" size={17} color="#8A8A8A" />
                <Text style={styles.confianzaTexto}>
                  Código en la puerta <Text style={styles.confianzaFuerte}>antes de abrirle</Text>
                </Text>
              </View>
            </View>

            <Text style={styles.eyebrow}>Los oficios</Text>
            <View style={styles.oficiosGrilla}>
              {professions.map(pr => {
                const foto = fotoDeOficio(pr.name);
                return (
                  <TouchableOpacity
                    key={pr.id}
                    style={styles.oficio}
                    onPress={() => abrirAsistenteConOficio(pr)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Pedir ${pr.name}: contale el problema al asistente`}
                  >
                    {foto
                      ? <Image source={{ uri: foto }} style={styles.oficioFoto} />
                      : <View style={[styles.oficioFoto, styles.oficioSinFoto]}>
                          <Ionicons name="flash" size={22} color="#5C5C5C" />
                        </View>}
                    <View style={styles.oficioVelo} pointerEvents="none" />
                    <Text style={styles.oficioNombre} numberOfLines={2}>{pr.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {favorites.length > 0 && (
              <>
                <Text style={[styles.eyebrow, { marginTop: 24 }]}>Mis profesionales</Text>
                {favorites.map(w => (
                  <MisProfesionalesCard
                    key={w.id}
                    w={w}
                    onHire={onRequestJob}
                    selectedProfession={selectedProfession}
                    userLocation={userLocation}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          /* ─────────────── LADO TRABAJO ─────────────── */
          <>
            <Text style={styles.eyebrow}>{hoyLargo()}</Text>
            <Text style={styles.display}>
              Hola, <Text style={styles.displayEm}>{professional?.first_name || 'che'}</Text>
            </Text>

            <View style={styles.dispCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dispTitulo}>
                  {available ? 'Estás disponible' : 'Estás en pausa'}
                </Text>
                <Text style={styles.dispSub}>
                  {available
                    ? (sinUbicacion ? 'Falta un paso para que te lleguen pedidos' : 'Recibís los pedidos de tu zona')
                    : 'No te van a llegar pedidos'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.switch, available && styles.switchOn]}
                onPress={() => handleToggle()}
                disabled={toggling}
                accessibilityRole="switch"
                accessibilityState={{ checked: !!available }}
                accessibilityLabel={available ? 'Pausar disponibilidad' : 'Activar disponibilidad'}
              >
                {toggling
                  ? <ActivityIndicator size="small" color={available ? '#0D0D0D' : '#8A8A8A'} />
                  : <View style={[styles.switchBola, available && styles.switchBolaOn]} />}
              </TouchableOpacity>
            </View>

            {/* Disponible pero sin ubicación = invisible. Ya nos costó trabajos
                que nadie vio; el interruptor solo no lo puede contar. */}
            {available && sinUbicacion && (
              <View style={styles.avisoUbic}>
                <Ionicons name="warning-outline" size={17} color="#FFD600" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.avisoUbicTitulo}>Estás disponible, pero no te ve nadie</Text>
                  <Text style={styles.avisoUbicTexto}>
                    Falta el permiso de ubicación: sin eso no aparecés en las búsquedas.
                  </Text>
                  <TouchableOpacity onPress={() => abrirAyudaUbicacion()}>
                    <Text style={styles.avisoUbicLink}>Cómo activarla</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{professional?.completed_jobs ?? 0}</Text>
                <Text style={styles.statTxt}>Trabajos</Text>
              </View>
              <View style={styles.statSep} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>
                  {professional?.avg_rating ? Number(professional.avg_rating).toFixed(1).replace('.', ',') : '—'}
                </Text>
                <Text style={styles.statTxt}>Puntaje</Text>
              </View>
              <View style={styles.statSep} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{professional?.on_time_completions ?? 0}</Text>
                <Text style={styles.statTxt}>A tiempo</Text>
              </View>
            </View>

            <Text style={styles.eyebrow}>Tu negocio</Text>
            {[
              { icon: 'briefcase-outline', t: 'Mi negocio', s: 'Trabajos, presupuestos y cobros', go: () => setShowNegocio(true) },
              { icon: 'document-text-outline', t: 'Nuevo presupuesto', s: 'Para un cliente que te llegó por afuera',
                go: () => { setShowNegocio(true); setNegocioEnNuevo(true); } },
              { icon: 'help-buoy-outline', t: '¿No te llega ningún trabajo?', s: 'Revisá qué puede estar faltando',
                go: () => abrirAyudaUbicacion() },
            ].map(it => (
              <TouchableOpacity key={it.t} style={styles.accesoCard} onPress={it.go} activeOpacity={0.85}>
                <Ionicons name={it.icon} size={19} color="#8A8A8A" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.accesoTitulo}>{it.t}</Text>
                  <Text style={styles.accesoSub}>{it.s}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#5C5C5C" />
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {/* La puerta del modo trabajo: sin alta, en revisión o aprobado. */}
      <Modal visible={puertaModo} transparent animationType="slide"
        onRequestClose={() => setPuertaModo(false)}>
        <TouchableOpacity style={styles.puertaFondo} activeOpacity={1} onPress={() => setPuertaModo(false)}>
          <TouchableOpacity style={styles.puertaHoja} activeOpacity={1} onPress={() => {}}>
            <View style={styles.puertaAsa} />
            <View style={styles.puertaEmblema}>
              <Ionicons name={estadoAlta === 'revision' ? 'time-outline' : 'briefcase-outline'}
                size={24} color={estadoAlta === 'revision' ? '#8A8A8A' : '#FFD600'} />
            </View>
            <Text style={styles.eyebrow}>Modo trabajo</Text>

            {estadoAlta === 'revision' ? (
              <>
                <Text style={styles.puertaTitulo}>
                  Estamos revisando <Text style={styles.displayEm}>tu alta</Text>
                </Text>
                <Text style={styles.puertaTexto}>
                  Ya recibimos tus datos. Cuando terminemos de verificarlos te avisamos por
                  notificación y se te habilita el modo.
                </Text>
                <TouchableOpacity style={styles.puertaBtn} onPress={() => { setPuertaModo(false); setShowRegister(true); }}>
                  <Text style={styles.puertaBtnText}>Ver qué falta</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.puertaTitulo}>
                  Este lado es para los <Text style={styles.displayEm}>oficios</Text>
                </Text>
                <Text style={styles.puertaTexto}>
                  Es donde llegan los pedidos. Si tenés un oficio, te das de alta y empezás a
                  recibir trabajos de tu zona.
                </Text>
                {[
                  ['briefcase-outline', 'Los trabajos y tu negocio: presupuestos, agenda y cobros'],
                  ['time-outline',      'Elegís cuándo estás disponible'],
                  ['shield-checkmark-outline', 'Te revisamos antes de habilitarte — para eso te eligen'],
                ].map(([ic, tx]) => (
                  <View key={tx} style={styles.puertaPunto}>
                    <Ionicons name={ic} size={17} color="#8A8A8A" />
                    <Text style={styles.puertaPuntoTexto}>{tx}</Text>
                  </View>
                ))}
                <TouchableOpacity style={styles.puertaBtn} onPress={() => { setPuertaModo(false); setShowRegister(true); }}>
                  <Text style={styles.puertaBtnText}>Quiero trabajar en BOLT</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.puertaVolver} onPress={() => setPuertaModo(false)}>
              <Text style={styles.puertaVolverText}>Volver</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* CARD del trabajador seleccionado */}
      {selectedWorker && (
        <WorkerCard
          worker={selectedWorker}
          slideAnim={slideAnim}
          onContact={handleContact}
          onClose={closeCard}
          isFavorite={favorites.some(f => f.id === selectedWorker.id)}
        />
      )}

      {/* Último paso del alta: ponerse disponible */}
      <ListoParaTrabajar
        visible={avisoDisponible}
        nombre={professional?.first_name}
        activando={toggling}
        onActivar={async () => {
          await handleToggle(true);   // siempre encender, nunca alternar
          setAvisoDisponible(false);
        }}
        onAhoraNo={() => setAvisoDisponible(false)}
      />

      {/* Mis direcciones: escribir una, guardarla y elegir entre varias. */}
      <MisDirecciones
        visible={verDirecciones}
        actual={userLocation}
        onCerrar={() => setVerDirecciones(false)}
        onUsarGPS={() => initLocation(true)}
        onElegir={(d) => guardarDireccionFija(usarDireccionFija(d))}
      />

      {/* DRAWER LATERAL */}
      <DrawerMenu
        visible={showDrawer}
        session={session}
        professional={professional}
        onClose={() => setShowDrawer(false)}
        onNavigate={handleDrawerNavigate}
      />
    </View>
  );
};

// ─── ESTILOS ──────────────────────────────────────────
const styles = StyleSheet.create({
  // ─── Home nuevo (9-ago-2026) ────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 32 : 8,
    paddingBottom: 14,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: '#1E1E1E',
    alignItems: 'center', justifyContent: 'center',
  },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#1E1E1E', borderRadius: 999,
    paddingHorizontal: 15, paddingVertical: 10,
  },
  modeBtnOn:      { backgroundColor: '#FFD600' },
  modeBtnText:    { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  modeBtnTextOn:  { color: '#0D0D0D' },

  homeScroll:  { flex: 1 },
  homeContent: { paddingHorizontal: 20, paddingBottom: 48 },

  eyebrow: {
    fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase',
    color: '#5C5C5C', fontWeight: '600', marginBottom: 8,
  },
  display:   { fontSize: 28, lineHeight: 32, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.8, marginBottom: 24 },
  displayEm: { color: '#FFD600' },

  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#161616', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 18, marginBottom: 10,
  },
  buscadorTexto: { flex: 1, fontSize: 16, color: '#8A8A8A' },

  modosRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  modoBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: '#161616', borderRadius: 20, paddingVertical: 14,
  },
  modoBtnText: { fontSize: 12, color: '#FFFFFF', fontWeight: '500' },

  miniMapa: {
    height: 104, borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#161616', marginBottom: 24,
  },
  miniMapaVelo: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,13,13,0.25)' },
  miniMapaPie: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: 'rgba(13,13,13,0.92)',
  },
  miniMapaDir:     { flex: 1, fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  miniMapaCambiar: { fontSize: 14, fontWeight: '600', color: '#FFD600' },

  confianza:      { gap: 12, marginBottom: 24 },
  confianzaFila:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  confianzaTexto: { flex: 1, fontSize: 14, color: '#8A8A8A', lineHeight: 20 },
  confianzaFuerte:{ color: '#FFFFFF', fontWeight: '600' },

  oficiosGrilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  oficio: {
    width: '48%', height: 112, borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#1A1A1A', justifyContent: 'flex-end', padding: 14,
  },
  oficioFoto:   { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  oficioSinFoto:{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E1E1E' },
  oficioVelo:   { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  oficioNombre: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', lineHeight: 19 },

  // Lado trabajo
  dispCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20, padding: 18, marginBottom: 12,
  },
  dispTitulo: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', marginBottom: 3 },
  dispSub:    { fontSize: 14, color: '#8A8A8A', lineHeight: 20 },
  switch: {
    width: 52, height: 31, borderRadius: 999, backgroundColor: '#1E1E1E',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  switchOn:     { backgroundColor: '#FFD600' },
  switchBola:   { width: 25, height: 25, borderRadius: 999, backgroundColor: '#5C5C5C' },
  switchBolaOn: { backgroundColor: '#0D0D0D', alignSelf: 'flex-end' },

  avisoUbic: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#161616', borderRadius: 20, padding: 16, marginBottom: 12,
    borderLeftWidth: 3, borderLeftColor: '#FFD600',
  },
  avisoUbicTitulo: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  avisoUbicTexto:  { fontSize: 14, color: '#8A8A8A', lineHeight: 20 },
  avisoUbicLink:   { fontSize: 14, color: '#FFD600', fontWeight: '600', marginTop: 8 },

  stats: {
    flexDirection: 'row', backgroundColor: '#161616', borderRadius: 20,
    padding: 18, marginTop: 12, marginBottom: 24,
  },
  stat:    { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 4, letterSpacing: -0.4 },
  statTxt: { fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase', color: '#5C5C5C', fontWeight: '600' },
  statSep: { width: 1, backgroundColor: '#262626' },

  accesoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20, padding: 16, marginBottom: 10,
  },
  accesoTitulo: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  accesoSub:    { fontSize: 14, color: '#8A8A8A', marginTop: 3 },

  // La puerta del modo trabajo
  puertaFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  puertaHoja: {
    backgroundColor: '#0D0D0D',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 22, paddingTop: 10,
    paddingBottom: Platform.OS === 'android' ? 32 : 26,
  },
  puertaAsa: { width: 36, height: 4, borderRadius: 999, backgroundColor: '#333', alignSelf: 'center', marginBottom: 22 },
  puertaEmblema: {
    width: 52, height: 52, borderRadius: 999, backgroundColor: '#161616',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  puertaTitulo: { fontSize: 26, lineHeight: 30, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.8, marginBottom: 10 },
  puertaTexto:  { fontSize: 14, color: '#8A8A8A', lineHeight: 21, marginBottom: 24 },
  puertaPunto:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  puertaPuntoTexto: { flex: 1, fontSize: 14, color: '#8A8A8A', lineHeight: 20 },
  puertaBtn: {
    backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 16,
    alignItems: 'center', marginTop: 10,
  },
  puertaBtnText:   { fontSize: 16, fontWeight: '600', color: '#0D0D0D' },
  puertaVolver:    { paddingVertical: 16, alignItems: 'center' },
  puertaVolverText:{ fontSize: 16, color: '#8A8A8A' },

  container: { flex: 1, backgroundColor: '#0D0D0D' },
  map: { ...StyleSheet.absoluteFillObject },

  // Barra superior
  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 36 : 8,
    paddingBottom: 4,
  },
  searchBlock: {
    paddingHorizontal: 16, paddingTop: 6,
  },
  logoText: {
    fontWeight: '700', fontSize: 20, color: '#FFD600', letterSpacing: 4,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(22,22,22,0.96)',
    borderRadius: 999, height: 60,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  searchInput: {
    flex: 1, color: '#F5F5F5', fontSize: 16, fontWeight: '600',
    paddingHorizontal: 10,
  },
  searchPlaceholder: {
    flex: 1, color: '#8A8A8A', fontSize: 16,
    paddingHorizontal: 10,
  },
  searchTools: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8,
  },
  searchTool: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: '#1E1E1E',
    alignItems: 'center', justifyContent: 'center',
  },
  searchHint: {
    fontSize: 16, color: '#5C5C5C',
    marginTop: 8, marginLeft: 20,
  },
  addBtn: {
    width: 46, height: 46, borderRadius: 999,
    backgroundColor: 'rgba(22,22,22,0.96)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Resultados búsqueda
  searchResults: {
    marginHorizontal: 16, marginTop: 8,
    backgroundColor: 'rgba(22,22,22,0.97)',
    borderRadius: 20, overflow: 'hidden',
  },
  searchItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#262626',
  },
  searchItemText: { color: '#FFFFFF', fontSize: 16 },

  // Chips
  emptyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', marginTop: 10,
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    },
  emptyChipText: { color: '#888', fontSize: 14 },
  countChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'center', marginTop: 16,
    backgroundColor: 'rgba(22,22,22,0.92)',
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8,
  },
  countDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: '#FFD600' },
  countChipText: { color: '#8A8A8A', fontSize: 16 },

  // Markers
  markerWrap: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  markerWrapSelected: {},
  markerDot: {
    width: 34, height: 34, borderRadius: 999,
    backgroundColor: '#1A1A1A',
    borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 6,
  },
  markerRing: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 999,
    borderWidth: 2, borderColor: '#FFD600',
    opacity: 0.4,
  },


  dashboardLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dashboardLinkText: { fontSize: 16, color: '#FFD600', fontWeight: '600' },

  // Link a la ayuda: gris y chico, se lee sólo si lo estás buscando.
  ayudaLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 2,
  },
  ayudaLinkText: { fontSize: 16, color: '#5C5C5C' },

  // Banner pago
  paymentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1200', borderRadius: 12,
    borderWidth: 1, borderColor: '#FFD60030',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  paymentBannerTitle: { fontSize: 14, fontWeight: '700', color: '#FFD600' },
  paymentBannerSub:   { fontSize: 12, color: '#888', marginTop: 1 },


  // Título + emergencias
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: {
    fontSize: 14, fontWeight: '600', color: '#5C5C5C',
    textTransform: 'uppercase', letterSpacing: 1.8,
  },
  call911Btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#ff444460',
    backgroundColor: 'rgba(229,72,77,0.09)',
  },
  call911Text: { color: '#ff4444', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

  // 50 = 34 de la foto + 8 de padding arriba y abajo. Fijo a propósito.
  // Sin este velo el nombre se pierde en las fotos claras.
  profChipVelo: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  profChipText: { fontSize: 14, color: '#FFFFFF', fontWeight: '600', lineHeight: 18 },

  // Radar
  radarWrap: { alignItems: 'center' },
  radarContainer: {
    width: 120, height: 120,
    alignItems: 'center', justifyContent: 'center',
  },
  radarRing: {
    position: 'absolute',
    width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: BUTTON_SIZE / 2,
    borderWidth: 1.5, borderColor: '#FFD600',
  },
  radarBtn: {
    width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: BUTTON_SIZE / 2,
    backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 6,
  },
  radarBtnOn: {
    backgroundColor: '#FFD600',
    borderColor: '#FFD600',
    shadowColor: '#FFD600', shadowOpacity: 0.5,
  },
  radarLabel: {
    color: '#555', fontSize: 12, fontWeight: '600',
    marginTop: 6, textAlign: 'center', maxWidth: 120,
  },
  radarLabelOn: { color: '#FFD600' },

  // Card trabajador
  card: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    zIndex: 20,
    backgroundColor: '#161616',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 34,
  },
  cardHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#333', alignSelf: 'center', marginBottom: 14,
  },
  cardClose: { position: 'absolute', top: 16, right: 16, padding: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },

  cardAvatarWrap: {
    position: 'relative',
    width: 72, height: 72,
  },
  cardAvatarImg: {
    width: 72, height: 72, borderRadius: 999,
    borderWidth: 2.5, borderColor: '#FFD600',
  },
  cardAvatarPlaceholder: {
    width: 72, height: 72, borderRadius: 999,
    backgroundColor: '#1A1A00',
    borderWidth: 2.5, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  cardAvatarInitial: { fontSize: 28, fontWeight: '700', color: '#FFD600' },
  cardOnlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 14, height: 14, borderRadius: 999,
    backgroundColor: '#FFD600', borderWidth: 2, borderColor: '#0D0D0D',
  },

  cardInfo: { flex: 1 },
  cardName: { fontSize: 18, fontWeight: '700', color: '#F5F5F5', marginBottom: 2 },
  cardProfession: { fontSize: 14, color: '#888', marginBottom: 6 },
  cardRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardRatingVal: { fontSize: 16, fontWeight: '600', color: '#FFD600' },
  cardRatingJobs: { fontSize: 14, color: '#555' },

  cardDistBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#1A1A1A', alignSelf: 'flex-start',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  cardDistText: { color: '#FFD600', fontSize: 14, fontWeight: '700' },

  cardStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141414', borderRadius: 14,
    padding: 14, marginBottom: 12,
  },
  cardStat: { flex: 1, alignItems: 'center' },
  cardStatVal: { fontSize: 16, fontWeight: '700', color: '#F5F5F5', marginBottom: 2 },
  cardStatLbl: { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1.8 },
  cardStatDiv: { width: 1, height: 32, backgroundColor: '#222' },

  cardBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  cardBadge: {
    backgroundColor: '#1A1A1A', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6,
    },
  cardBadgeText: { fontSize: 14, color: '#BBBBBB', fontWeight: '600' },

  requestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#FFD600',
    borderRadius: 14, paddingVertical: 16,
  },
  requestBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  // ── Demo Mode ─────────────────────────────────────────────────────────────────
  demoWrap:      { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  demoStartBtn:  {
    backgroundColor: '#FFD60015', borderRadius: 20,
    borderWidth: 1, borderColor: '#FFD60040',
    paddingHorizontal: 14, paddingVertical: 7,
  },
  demoStartBtnText: { fontSize: 14, fontWeight: '600', color: '#FFD600' },

  // ── Emergencia ────────────────────────────────────────────────────────────────
  emergencyBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(229,72,77,0.07)',
    borderWidth: 1, borderColor: 'rgba(229,72,77,0.22)',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  emergencyBtnLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  emergencyBtnEmoji: { fontSize: 20 },
  emergencyBtnTitle: { fontSize: 14, fontWeight: '600', color: '#ff4444', marginBottom: 1 },
  emergencyBtnSub:   { fontSize: 12, color: '#884444' },

  // ── Mis profesionales ────────────────────────────────────────────────────────
  misSectionWrap: { gap: 10 },
  misSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  misSectionTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#F5F5F5' },
  misSectionCount: {
    fontSize: 12, fontWeight: '600', color: '#ff444488',
    backgroundColor: 'rgba(229,72,77,0.1)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(229,72,77,0.2)',
  },

  misProCard: {
    backgroundColor: '#0D0D0D', borderRadius: 16,
    padding: 14, gap: 10,
  },
  misProHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  misProAvatar: { width: 52, height: 52, borderRadius: 999 },
  misProAvatarPlaceholder: {
    width: 52, height: 52, borderRadius: 999,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  misProAvatarInitial: { fontSize: 20, fontWeight: '700', color: '#FFD600' },
  misProInfo: { flex: 1 },
  misProName: { fontSize: 16, fontWeight: '700', color: '#F5F5F5', marginBottom: 2 },
  misProRole: { fontSize: 14, color: '#555', marginBottom: 4 },
  misProRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  misProRatingVal:  { fontSize: 14, fontWeight: '600', color: '#FFD600' },
  misProRatingJobs: { fontSize: 12, color: '#444' },
  misProBusyBadge: {
    backgroundColor: 'rgba(229,72,77,0.08)',
    borderWidth: 1, borderColor: 'rgba(229,72,77,0.2)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  misProBusyText: { fontSize: 14, fontWeight: '600', color: '#8A8A8A' },

  misProLastJob: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#161616', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  misProLastJobText: { fontSize: 14, color: '#555', flex: 1 },

  misProMyRating: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  misProMyRatingLabel: { fontSize: 14, color: '#444' },
  misProMyRatingStars: { flexDirection: 'row', gap: 2 },

  misProBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 12, paddingVertical: 13,
  },
  misProBtnOff: { backgroundColor: '#1a1a1a' },
  misProBtnText: { fontSize: 16, fontWeight: '700', color: '#0D0D0D' },
  misProBtnTextOff: { color: '#444' },

  // Favoritos (legacy — se pueden eliminar si no hay otros usos)
  favSectionTitle: {
    fontSize: 12, fontWeight: '600', color: '#555',
    textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 10,
  },
  favCard: {
    width: 90, alignItems: 'center', gap: 4,
    backgroundColor: '#161616', borderRadius: 16,
    padding: 10,
  },
  favAvatar: {
    width: 44, height: 44, borderRadius: 999,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5, borderColor: '#FFD60060',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  favAvatarImg: { width: '100%', height: '100%' },
  favName:       { fontSize: 14, fontWeight: '700', color: '#F5F5F5', textAlign: 'center' },
  favRatingRow:  { flexDirection: 'row', alignItems: 'center', gap: 2 },
  favRating:     { fontSize: 12, color: '#888' },
  favRequestBtn: {
    backgroundColor: '#FFD600', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5, marginTop: 2,
  },
  favRequestBtnOff:     { backgroundColor: '#1a1a1a' },
  favRequestBtnText:    { fontSize: 12, fontWeight: '700', color: '#0D0D0D' },
  favRequestBtnTextOff: { color: '#444' },
});


export default HomeScreen;

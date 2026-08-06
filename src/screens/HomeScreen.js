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
import DrawerMenu from '../components/DrawerMenu';
import DraggableBubble from '../components/DraggableBubble';
import { abrirAyudaUbicacion } from '../utils/ayuda';

const { height: SCREEN_H } = Dimensions.get('window');
const BUTTON_SIZE = 64;
const CARD_H = 400;

const PANEL_FULL   = 330;
const PANEL_PEEK   = 155;
const PANEL_HIDDEN = PANEL_FULL - PANEL_PEEK;

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
];

// Oficios para los pines ambientales del mapa (percepción de actividad)
const AMBIENT_PROFS = [
  { emoji: '🔧', name: 'Electricista' },
  { emoji: '🚰', name: 'Plomero' },
  { emoji: '🔥', name: 'Gasista' },
  { emoji: '❄️', name: 'Aire acondicionado' },
  { emoji: '🎨', name: 'Pintor' },
  { emoji: '🔒', name: 'Cerrajero' },
  { emoji: '📹', name: 'Alarmas / Cámaras' },
  { emoji: '🧱', name: 'Albañil' },
  { emoji: '🔨', name: 'Durlock' },
];

// Genera pines representativos alrededor de un centro, repartidos en anillos.
// Son decorativos (no abren ficha): comunican cobertura/actividad sin inventar identidades.
const buildAmbientWorkers = (center) => {
  const base = center || BAHIA_CENTER;
  const N = 11;
  return Array.from({ length: N }).map((_, i) => {
    const angle  = (i / N) * Math.PI * 2 + i * 0.6;
    const radius = 0.0025 + (i % 3) * 0.002;           // ~0.25–0.65 km (pegado al usuario)
    const state  = i % 6 === 0 ? 'busy' : (i % 6 === 3 ? 'oncoming' : 'available');
    const prof   = AMBIENT_PROFS[i % AMBIENT_PROFS.length];
    return {
      id: `ambient-${i}`,
      ambient: true,
      emoji: prof.emoji,
      profession_name: prof.name,
      state,
      lat: base.latitude  + Math.cos(angle) * radius,
      lng: base.longitude + Math.sin(angle) * radius * 1.3,
    };
  });
};

// Ubica los pines ambientales sobre CALLES reales cercanas (vía OpenStreetMap),
// para que NUNCA caigan en el agua/mar. Si no hay internet o falla, devuelve null
// y se usa buildAmbientWorkers como fallback.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const buildAmbientOnStreets = async (center) => {
  if (!center?.latitude) return null;
  const { latitude: lat, longitude: lng } = center;
  const query =
    `[out:json][timeout:8];` +
    `way(around:1500,${lat},${lng})[highway~"^(residential|living_street|tertiary|secondary|unclassified|primary)$"];` +
    `out geom 80;`;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) continue;
      const json = await res.json();
      const pts = [];
      for (const el of json.elements || []) {
        if (el.geometry) for (const g of el.geometry) pts.push({ lat: g.lat, lng: g.lon });
      }
      if (pts.length < 6) continue;
      const N = 11;
      const step = Math.max(1, Math.floor(pts.length / N));
      const chosen = [];
      for (let i = 0; i < pts.length && chosen.length < N; i += step) chosen.push(pts[i]);
      return chosen.map((p, i) => {
        const prof  = AMBIENT_PROFS[i % AMBIENT_PROFS.length];
        const state = i % 6 === 0 ? 'busy' : (i % 6 === 3 ? 'oncoming' : 'available');
        return {
          id: `ambient-${i}`, ambient: true, emoji: prof.emoji,
          profession_name: prof.name, state, lat: p.lat, lng: p.lng,
        };
      });
    } catch { /* probar el siguiente endpoint */ }
  }
  return null;
};

const CLIENT_TIPS = [
  { icon: 'shield-checkmark-outline', color: '#4CAF50', text: 'Siempre pedí el código de verificación antes de abrir la puerta' },
  { icon: 'star-outline',             color: '#FFD600', text: 'Calificá al profesional para ayudar a la comunidad BOLT' },
  { icon: 'cash-outline',             color: '#FFD600', text: 'El pago lo coordinás directo con el profesional, como prefieran' },
  { icon: 'people-outline',           color: '#FF9800', text: 'Todos los trabajadores tienen antecedentes verificados' },
  { icon: 'pricetag-outline',         color: '#888',    text: 'Acordá el precio con el profesional antes de que empiece el trabajo' },
];

const WORKER_TIPS = [
  { icon: 'trending-up-outline', color: '#4CAF50', text: '¡Más calificación = menor comisión! Apuntá al nivel Elite' },
  { icon: 'id-card-outline',     color: '#FFD600', text: 'Mostrá siempre tu código de verificación al llegar al domicilio' },
  { icon: 'flash-outline',       color: '#FFD600', text: 'Respondé rápido — los clientes eligen al primer disponible' },
  { icon: 'thumbs-up-outline',   color: '#FF9800', text: 'Un buen pre-diagnóstico genera más confianza y mejores calificaciones' },
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
        <Ionicons name="flash" size={16} color={w.available ? '#0A0A0A' : '#444'} />
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
                  <Text style={[emStyles.metricVal, { color: '#4CAF50', fontSize: 12 }]}>
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
  headerBadgeText: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },

  headline: {
    fontSize: 15, color: '#BBBBBB', textAlign: 'center', lineHeight: 22,
  },

  loadingWrap: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  loadingText: { fontSize: 14, color: '#555' },

  workerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#1a0808', borderRadius: 14,
    borderWidth: 1, borderColor: '#ff444425', padding: 14,
  },
  workerAvatar: { position: 'relative' },
  workerAvatarImg: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#ff4444' },
  workerAvatarPlaceholder: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#2a0a0a', borderWidth: 2, borderColor: '#ff4444',
    alignItems: 'center', justifyContent: 'center',
  },
  workerAvatarInitial: { fontSize: 22, fontWeight: '900', color: '#ff4444' },
  availableDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#0D0505',
  },
  workerInfo:  { flex: 1 },
  workerName:  { fontSize: 16, fontWeight: '900', color: '#F5F5F5', marginBottom: 2 },
  workerRole:  { fontSize: 12, color: '#666', marginBottom: 5 },
  ratingRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingVal:   { fontSize: 13, fontWeight: '800', color: '#FFD600' },
  ratingJobs:  { fontSize: 11, color: '#444' },

  metricsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a0808', borderRadius: 14,
    borderWidth: 1, borderColor: '#ff444420', padding: 14,
  },
  metric:      { flex: 1, alignItems: 'center', gap: 6 },
  metricDiv:   { width: 1, height: 44, backgroundColor: '#2a1010' },
  metricVal:   { fontSize: 16, fontWeight: '900', color: '#ff4444' },
  metricLabel: { fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

  priceNote: { fontSize: 12, color: '#444', textAlign: 'center' },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#ff4444',
    borderRadius: 16, paddingVertical: 18,
  },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontSize: 14, color: '#444' },
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
              <Text style={[styles.cardStatVal, { color: '#4CAF50' }]}>{onTimePct}%</Text>
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
        <Ionicons name="flash" size={20} color="#0A0A0A" />
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
          ? <ActivityIndicator size="small" color={available ? '#0A0A0A' : '#FFD600'} />
          : <Ionicons name={available ? 'radio' : 'radio-outline'} size={26}
              color={available ? '#0A0A0A' : '#888'} />
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
  3:  ['gas', 'estufa', 'calefon', 'calefón', 'termotanque', 'cocina a gas', 'garrafa', 'olor a gas', 'caldera', 'calefaccion', 'calefacción'],
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
};

// Burbuja flotante arrastrable (estilo Messenger) para volver al trabajo en curso.
// Se arrastra a cualquier lado; un toque (sin arrastrar) abre el seguimiento.
function ActiveJobBubble({ onPress }) {
  const { width: W, height: H } = Dimensions.get('window');
  const pos = useRef(new Animated.ValueXY({ x: W - 78, y: H - 260 })).current;
  const moved = useRef(false);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
    onPanResponderGrant: () => { moved.current = false; pos.extractOffset(); },
    onPanResponderMove: (e, g) => {
      if (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5) moved.current = true;
      pos.setValue({ x: g.dx, y: g.dy });
    },
    onPanResponderRelease: () => {
      pos.flattenOffset();
      if (!moved.current) onPress?.();
    },
  })).current;

  return (
    <Animated.View style={[bubbleStyles.bubble, { transform: pos.getTranslateTransform() }]} {...responder.panHandlers}>
      <Ionicons name="navigate" size={24} color="#0A0A0A" />
      <View style={bubbleStyles.pulse} />
    </Animated.View>
  );
}

const bubbleStyles = StyleSheet.create({
  bubble: {
    position: 'absolute', top: 0, left: 0, zIndex: 500,
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  pulse: {
    position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#FFD600',
  },
});

const HomeScreen = ({
  session, professional, onRequestJob, onOpenAssistant, onActiveJob, onIncomingJob,
  activeJob, onResumeJob,
  quoteWaiting, quoteDeadline, quoteResponded = 0, onResumeQuote,
  atajo, onAtajoUsado,
}) => {
  const userId = session?.user?.id;

  // Estado del profesional (si el user está registrado como trabajador)
  const [available, setAvailable]         = useState(professional?.available ?? false);
  const [toggling, setToggling]           = useState(false);

  // Mapa
  const [userLocation, setUserLocation]   = useState(null);
  const [workers, setWorkers]             = useState([]);
  const [ambientWorkers, setAmbientWorkers] = useState(() => buildAmbientWorkers(null));
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
  // El acceso directo entra derecho a cargar el presupuesto, sin pasar por la
  // lista. Es todo el punto del atajo: sacar el celular y escribir.
  const [negocioEnNuevo, setNegocioEnNuevo] = useState(false);
  const [showAdmin, setShowAdmin]           = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showPrivacy, setShowPrivacy]       = useState(false);
  const newJobChannelRef = useRef(null);

  // "Estás listo para recibir trabajos" — se decide una sola vez por apertura de
  // la app, no en cada render: si dependiera de `available` en vivo, volvería a
  // saltar apenas alguien pausa su disponibilidad a propósito.
  const [avisoDisponible, setAvisoDisponible] = useState(false);
  const avisoYaEvaluado = useRef(false);

  // Tips rotativos
  const [tipIndex, setTipIndex] = useState(0);

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

  // Panel deslizante
  const panelY    = useRef(new Animated.Value(0)).current; // arranca EXPANDIDO (visible)
  const panelBase = useRef(0);
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => {
      panelY.setOffset(panelBase.current);
      panelY.setValue(0);
    },
    onPanResponderMove: (_, g) => {
      panelY.setValue(Math.min(PANEL_HIDDEN, Math.max(-20, g.dy)));
    },
    onPanResponderRelease: (_, g) => {
      panelY.flattenOffset();
      const approxPos = panelBase.current + g.dy;
      const expand = g.vy < -0.5 || approxPos < PANEL_HIDDEN / 2;
      const toValue = expand ? 0 : PANEL_HIDDEN;
      panelBase.current = toValue;
      Animated.spring(panelY, { toValue, useNativeDriver: true, tension: 60, friction: 12 }).start();
    },
  })).current;

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
        .select('available, verification_status, first_name')
        .eq('user_id', userId)
        .maybeSingle()
        .then(({ data }) => { if (data) setAvailable(!!data.available); })
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

  // Rotación de tips cada 7 segundos
  useEffect(() => {
    const tips = professional ? WORKER_TIPS : CLIENT_TIPS;
    const t = setInterval(() => setTipIndex(i => (i + 1) % tips.length), 7000);
    return () => clearInterval(t);
  }, [professional]);

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

  // ─── Ubicación inicial y workers ─────────────────────
  const initLocation = async () => {
    try {
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
      setAmbientWorkers(buildAmbientWorkers({ latitude, longitude })); // fallback inmediato
      buildAmbientOnStreets({ latitude, longitude })                   // y, si hay red, sobre calles reales
        .then(streets => { if (streets?.length) setAmbientWorkers(streets); })
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

  // Toca un pin ambiental (decorativo): muestra actividad de la zona
  const handleAmbientPress = () => {
    Alert.alert(
      'Profesionales en tu zona',
      'Hay profesionales activos cerca tuyo. Elegí un oficio y pedí tu presupuesto desde el panel de abajo.',
    );
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

  // El mapa es SOLO visual/decorativo: muestra el "pulso" de la ciudad (pines
  // ambientales) para dar sensación de actividad, pero NUNCA expone trabajadores
  // reales. La selección del trabajador NO se hace por el mapa: al pedir el
  // presupuesto se ofrecen 3 profesionales en el panel (JobRequestScreen), y la
  // ubicación real recién se ve en el seguimiento del trabajo (tipo Uber).
  const mapWorkers = ambientWorkers;

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
    Alert.alert(
      '📍 Ubicación mientras trabajás',
      'BOLT usa tu ubicación —incluso en segundo plano y con la app minimizada— ' +
      'únicamente mientras tenés tu disponibilidad activada, para que los clientes ' +
      'vean tu recorrido en tiempo real durante un trabajo en curso.\n\n' +
      'No se rastrea tu ubicación cuando estás fuera de servicio. Podés desactivarla ' +
      'cuando quieras apagando tu disponibilidad.',
      [
        { text: 'No, ahora no', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Entiendo, continuar', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });

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
        const granted = await locationService.requestPermission();
        const pos = granted
          ? await locationService.getCurrentLocation().catch(() => null)
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
        await professionalService.updateLocation(userId, pos.coords.latitude, pos.coords.longitude);
      }
      await professionalService.setAvailability(userId, next);
      if (next) {
        await locationService.startBackgroundTracking();
      } else {
        await locationService.stopBackgroundTracking();
      }
    } catch {
      setAvailable(!next);
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

  // ─── RENDER ──────────────────────────────────────────
  const hasActiveJob = activeJob && ['pending','accepted','arrived','in_progress','awaiting_payment'].includes(activeJob.status);

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

      {/* MAPA */}
      <VoltMap
        userLocation={userLocation}
        workers={mapWorkers}
        onWorkerPress={handleAmbientPress}
        onAmbientPress={handleAmbientPress}
        style={StyleSheet.absoluteFill}
      />

      {/* Burbuja arrastrable de trabajo en curso (volver al seguimiento) */}
      {hasActiveJob && <DraggableBubble icon="navigate" onPress={onResumeJob} dotColor="#4CAF50" />}

      {/* Burbuja de "esperando presupuesto": aparece cuando el cliente toca
          SEGUIR USANDO LA APP. Muestra cuánto falta y cuántos respondieron, y
          lo devuelve a las propuestas. Va más arriba para no taparse con la de
          trabajo en curso. */}
      {quoteWaiting && (
        <DraggableBubble
          icon="hourglass"
          onPress={onResumeQuote}
          deadline={quoteDeadline}
          badgeCount={quoteResponded}
          startY={SCREEN_H - 330}
        />
      )}

      {/* BARRA SUPERIOR */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        {/* Fila 1 — marca (menú + logo) */}
        <View style={styles.brandRow}>
          {/* Hamburguesa */}
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowDrawer(true)}>
            <Ionicons name="menu" size={24} color="#FFD600" />
          </TouchableOpacity>

          {/* Logo — mantené apretado 1.5s para el modo demo */}
          <TouchableOpacity
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
            <Text style={[styles.logoText, demoOn && { color: '#FFD600', opacity: 0.7 }]}>BOLT</Text>
          </TouchableOpacity>

          {/* Espaciador para centrar el logo (mismo ancho que la hamburguesa) */}
          <View style={{ width: 46 }} />
        </View>

        {/* Fila 2 — BUSCADOR protagonista: es la PUERTA al asistente conversacional */}
        <View style={styles.searchBlock}>
          <TouchableOpacity style={styles.searchWrap} activeOpacity={0.85} onPress={() => openAssistantWithLocation('text')}>
            <Ionicons name="search" size={20} color="#FFD600" style={{ marginLeft: 14 }} />
            <Text style={styles.searchPlaceholder}>¿Qué necesitás resolver?</Text>
            <View style={styles.searchTools}>
              <TouchableOpacity style={styles.searchTool} onPress={() => openAssistantWithLocation('audio')}>
                <Ionicons name="mic-outline" size={19} color="#FFD600" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.searchTool} onPress={() => openAssistantWithLocation('camera')}>
                <Ionicons name="camera-outline" size={19} color="#FFD600" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
          <Text style={styles.searchHint}>Escribí · mandá un audio · o una foto</Text>
        </View>

        {/* Resultados del buscador */}
        {results.length > 0 && (
          <View style={styles.searchResults}>
            {results.map(p => (
              <TouchableOpacity key={p.id} style={styles.searchItem} onPress={() => { setQuery(''); onRequestJob?.(null, p, userLocation); }}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#FFD600" />
                <Text style={styles.searchItemText}>Contar mi problema y pedir {p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Chip de actividad de la ciudad — pantalla inicial (sin oficio elegido) */}
        {!selectedProfession && ambientWorkers.length > 0 && (
          <View style={styles.countChip}>
            <View style={styles.countDot} />
            <Text style={styles.countChipText}>
              ⚡ {ambientWorkers.length} profesionales activos cerca tuyo
            </Text>
          </View>
        )}

        {/* Chip de profesión seleccionada — invita a describir el problema
            (NO expone el conteo real de trabajadores: el mapa es solo visual) */}
        {selectedProfession && (
          <View style={styles.countChip}>
            <View style={styles.countDot} />
            <Text style={styles.countChipText}>
              Contá tu problema y te ofrecemos {selectedProfession.name.toLowerCase()}s de la zona
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* PANEL INFERIOR DESLIZANTE */}
      {!selectedWorker && (
        <Animated.View
          style={[styles.bottomPanel, { transform: [{ translateY: panelY }] }]}
          {...panResponder.panHandlers}
        >
          {/* Handle de arrastre */}
          <View style={styles.panelHandle} />

          {/* Título del panel */}
          <View style={styles.panelTitleRow}>
            <Text style={styles.panelTitle}>¿Qué necesitás?</Text>
          </View>

          {/* Chips de profesiones — siempre visibles */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {professions.map(p => {
              const active = selectedProfession?.id === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.profChip, active && styles.profChipActive]}
                  onPress={() => active ? clearProfession() : selectProfession(p)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="flash" size={15} color="#0A0A0A" />
                  <Text style={[styles.profChipText, active && styles.profChipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Botón solicitud directa — SIEMPRE que haya oficio elegido. Lleva a describir
              el problema; los profesionales (hasta 3) se ofrecen dentro de JobRequestScreen,
              NO se eligen acá ni por el mapa. */}
          {selectedProfession && (
            <TouchableOpacity
              style={styles.directRequestBtn}
              onPress={() => onRequestJob?.(null, selectedProfession, userLocation)}
              activeOpacity={0.85}
            >
              <Ionicons name="chatbubble-ellipses" size={18} color="#0A0A0A" />
              <Text style={styles.directRequestBtnText}>
                Contar mi problema y pedir {selectedProfession.name}
              </Text>
              <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          )}

          {/* (El método de pago del cliente se configura en Mi Perfil; antes había un
              banner acá que tapaba los chips en el panel de altura fija. Removido.) */}

          {/* Demo Mode — visible solo cuando está activo (se activa desde DemoToggle oculto por long-press) */}
          {!professional && demoOn && (
            <View style={styles.demoWrap}>
              <DemoToggle onToggle={setDemoOn} />
              <TouchableOpacity
                style={styles.demoStartBtn}
                onPress={() => {
                  const prof = DEMO_PROFESSIONAL;
                  const fakeProfession = { id: 1, name: 'Electricidad' };
                  onRequestJob?.(prof, fakeProfession, userLocation || { latitude: -38.7196, longitude: -62.2724, address: 'Demo — Bahía Blanca' });
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.demoStartBtnText}>▶ Iniciar demo completo</Text>
              </TouchableOpacity>
            </View>
          )}


          {/* (Botón de Emergencia removido del inicio. La emergencia/pánico va durante
              el trabajo, cuando el profesional está en el domicilio — JobTrackingScreen.) */}

          {/* Mis profesionales — red personal de confianza */}
          {!professional && favorites.length > 0 && (
            <View style={styles.misSectionWrap}>
              <View style={styles.misSectionHeader}>
                <Ionicons name="heart" size={16} color="#ff4444" />
                <Text style={styles.misSectionTitle}>Mis profesionales</Text>
                <Text style={styles.misSectionCount}>{favorites.length}</Text>
              </View>
              {favorites.map(w => (
                <MisProfesionalesCard
                  key={w.id}
                  w={w}
                  onHire={onRequestJob}
                  selectedProfession={selectedProfession}
                  userLocation={userLocation}
                />
              ))}
            </View>
          )}

          {/* Tip rotativo — visible al expandir */}
          {(() => {
            const tips = professional ? WORKER_TIPS : CLIENT_TIPS;
            const tip = tips[tipIndex % tips.length];
            return (
              <TouchableOpacity
                style={styles.tipCard}
                onPress={() => setTipIndex(i => (i + 1) % tips.length)}
                activeOpacity={0.8}
              >
                <Ionicons name={tip.icon} size={16} color={tip.color} />
                <Text style={styles.tipText}>{tip.text}</Text>
                <Ionicons name="chevron-forward" size={14} color="#333" />
              </TouchableOpacity>
            );
          })()}

          {/* Botón disponibilidad trabajador — visible al expandir */}
          {professional && (
            <TouchableOpacity
              style={[styles.workerToggleBtn, available && styles.workerToggleBtnOn]}
              onPress={() => handleToggle()}
              disabled={toggling}
              activeOpacity={0.8}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={available ? '#0A0A0A' : '#FFD600'} />
              ) : (
                <Ionicons name={available ? 'radio' : 'radio-outline'} size={20} color={available ? '#0A0A0A' : '#FFD600'} />
              )}
              <Text style={[styles.workerToggleText, available && styles.workerToggleTextOn]}>
                {toggling ? 'Actualizando...' : available ? 'Estás disponible · Tocá para pausar' : 'Activar disponibilidad'}
              </Text>
              {/* 🔴 Acá había un CRASH. Este botón llamaba a `setShowWorkerPanel`,
                  que dejó de existir cuando se fusionaron los dos paneles en
                  "Mi negocio" (6-ago-2026): tocarlo tiraba un ReferenceError y
                  se caía la app. No lo agarró ningún chequeo porque los dos
                  archivos parsean bien por separado — el que se rompe es el
                  contrato entre ellos. */}
              <TouchableOpacity onPress={() => setShowNegocio(true)} style={styles.dashboardLink} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
                <Text style={styles.dashboardLinkText}>Mi negocio</Text>
                <Ionicons name="chevron-forward" size={13} color={available ? '#0A0A0A' : '#FFD600'} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}

          {/* La duda número uno del profesional, justo al lado del control que la
              causa. Discreto: informa sin competir con el botón de arriba. */}
          {professional && (
            <TouchableOpacity
              style={styles.ayudaLink}
              onPress={() => abrirAyudaUbicacion()}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            >
              <Ionicons name="help-buoy-outline" size={13} color="#888" />
              <Text style={styles.ayudaLinkText}>¿No te llega ningún trabajo?</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

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
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  activeJobBanner: {
    marginHorizontal: 14, marginTop: 6, marginBottom: 4,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFD600', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16,
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  activeJobPulse: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#0A0A0A' },
  activeJobTitle: { fontSize: 14, fontWeight: '900', color: '#0A0A0A' },
  activeJobSub:   { fontSize: 12, fontWeight: '700', color: '#0A0A0A', opacity: 0.7 },
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
    fontWeight: '900', fontSize: 20, color: '#FFD600', letterSpacing: 4,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(18,18,18,0.96)',
    borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,214,0,0.45)',
    height: 58,
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  searchInput: {
    flex: 1, color: '#F5F5F5', fontSize: 15, fontWeight: '600',
    paddingHorizontal: 10,
  },
  searchPlaceholder: {
    flex: 1, color: '#777', fontSize: 15, fontWeight: '600',
    paddingHorizontal: 10,
  },
  searchTools: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8,
  },
  searchTool: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,214,0,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  searchHint: {
    fontSize: 11.5, color: '#666', fontWeight: '600',
    marginTop: 9, marginLeft: 6,
  },
  addBtn: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: 'rgba(15,15,15,0.95)',
    borderWidth: 1, borderColor: '#222',
    alignItems: 'center', justifyContent: 'center',
  },

  // Resultados búsqueda
  searchResults: {
    marginHorizontal: 16, marginTop: 4,
    backgroundColor: 'rgba(15,15,15,0.97)',
    borderRadius: 14, borderWidth: 1, borderColor: '#222',
    overflow: 'hidden',
  },
  searchItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  searchItemText: { color: '#F5F5F5', fontSize: 15, fontWeight: '500' },

  // Chips
  emptyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', marginTop: 10,
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#222',
  },
  emptyChipText: { color: '#888', fontSize: 13 },
  countChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    alignSelf: 'center', marginTop: 10,
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1f2c1a',
  },
  countDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  countChipText: { color: '#aaa', fontSize: 13 },

  // Markers
  markerWrap: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  markerWrapSelected: {},
  markerDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#1A1A1A',
    borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 6,
  },
  markerRing: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: '#FFD600',
    opacity: 0.4,
  },

  // Panel inferior deslizante
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: PANEL_FULL,
    backgroundColor: 'rgba(10,10,10,0.97)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 52 : 28,
    paddingHorizontal: 16,
    gap: 10, zIndex: 10,
  },
  panelHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: '#2a2a2a', alignSelf: 'center',
    marginBottom: 4,
  },

  // Botón principal de disponibilidad trabajador
  workerToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#222',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  workerToggleBtnOn: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  workerToggleText: { flex: 1, fontSize: 14, color: '#FFD600', fontWeight: '700' },
  workerToggleTextOn: { color: '#0A0A0A' },
  dashboardLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dashboardLinkText: { fontSize: 12, color: '#FFD600', fontWeight: '700' },

  // Link a la ayuda: gris y chico, se lee sólo si lo estás buscando.
  ayudaLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 2,
  },
  ayudaLinkText: { fontSize: 12.5, color: '#888', textDecorationLine: 'underline' },

  // Botón solicitud directa
  directRequestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFD600', borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  directRequestBtnText: {
    flex: 1, fontSize: 15, fontWeight: '900', color: '#0A0A0A',
  },
  directRequestCount: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  directRequestDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#0A0A0A' },
  directRequestCountText: { fontSize: 11, color: '#0A0A0A', fontWeight: '700' },

  // Banner pago
  paymentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1200', borderRadius: 12,
    borderWidth: 1, borderColor: '#FFD60030',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  paymentBannerTitle: { fontSize: 13, fontWeight: '700', color: '#FFD600' },
  paymentBannerSub:   { fontSize: 11, color: '#888', marginTop: 1 },

  // Tip rotativo
  tipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0D0D0D', borderRadius: 12,
    borderWidth: 1, borderColor: '#1a1a1a',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  tipText: { flex: 1, fontSize: 12, color: '#666', lineHeight: 17 },

  // Título + emergencias
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: {
    fontSize: 13, fontWeight: '700', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  call911Btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#ff444460',
    backgroundColor: 'rgba(255,68,68,0.09)',
  },
  call911Text: { color: '#ff4444', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },

  chipsContent: { gap: 8, paddingRight: 8 },
  profChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 14,
    borderWidth: 2, borderColor: '#FFD600',
    paddingVertical: 14, paddingHorizontal: 20,
  },
  profChipActive: { backgroundColor: '#FFD600', borderColor: '#0A0A0A' },
  profChipText: { fontSize: 16, color: '#0A0A0A', fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' },
  profChipTextActive: { color: '#0A0A0A' },

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
    borderWidth: 2, borderColor: '#333',
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
    color: '#555', fontSize: 11, fontWeight: '600',
    marginTop: 6, textAlign: 'center', maxWidth: 120,
  },
  radarLabelOn: { color: '#FFD600' },

  // Card trabajador
  card: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    zIndex: 20,
    backgroundColor: '#0F0F0F',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: '#1E1E1E',
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
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2.5, borderColor: '#FFD600',
  },
  cardAvatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#1A1A00',
    borderWidth: 2.5, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  cardAvatarInitial: { fontSize: 28, fontWeight: '900', color: '#FFD600' },
  cardOnlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#111',
  },

  cardInfo: { flex: 1 },
  cardName: { fontSize: 18, fontWeight: '900', color: '#F5F5F5', marginBottom: 2 },
  cardProfession: { fontSize: 13, color: '#888', marginBottom: 6 },
  cardRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardRatingVal: { fontSize: 15, fontWeight: '800', color: '#FFD600' },
  cardRatingJobs: { fontSize: 12, color: '#555' },

  cardDistBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#1A1A1A', alignSelf: 'flex-start',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  cardDistText: { color: '#FFD600', fontSize: 13, fontWeight: '700' },

  cardStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141414', borderRadius: 14,
    padding: 14, marginBottom: 12,
  },
  cardStat: { flex: 1, alignItems: 'center' },
  cardStatVal: { fontSize: 15, fontWeight: '900', color: '#F5F5F5', marginBottom: 2 },
  cardStatLbl: { fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardStatDiv: { width: 1, height: 32, backgroundColor: '#222' },

  cardBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  cardBadge: {
    backgroundColor: '#1A1A1A', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  cardBadgeText: { fontSize: 12, color: '#BBBBBB', fontWeight: '600' },

  requestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#FFD600',
    borderRadius: 14, paddingVertical: 16,
  },
  requestBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },

  // ── Demo Mode ─────────────────────────────────────────────────────────────────
  demoWrap:      { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  demoStartBtn:  {
    backgroundColor: '#FFD60015', borderRadius: 20,
    borderWidth: 1, borderColor: '#FFD60040',
    paddingHorizontal: 14, paddingVertical: 7,
  },
  demoStartBtnText: { fontSize: 12, fontWeight: '800', color: '#FFD600' },

  // ── Emergencia ────────────────────────────────────────────────────────────────
  emergencyBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,68,68,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.22)',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  emergencyBtnLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  emergencyBtnEmoji: { fontSize: 20 },
  emergencyBtnTitle: { fontSize: 13.5, fontWeight: '800', color: '#ff4444', marginBottom: 1 },
  emergencyBtnSub:   { fontSize: 11, color: '#884444' },

  // ── Mis profesionales ────────────────────────────────────────────────────────
  misSectionWrap: { gap: 10 },
  misSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  misSectionTitle: { flex: 1, fontSize: 14, fontWeight: '900', color: '#F5F5F5' },
  misSectionCount: {
    fontSize: 11, fontWeight: '800', color: '#ff444488',
    backgroundColor: 'rgba(255,68,68,0.1)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.2)',
  },

  misProCard: {
    backgroundColor: '#0D0D0D', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, gap: 10,
  },
  misProHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  misProAvatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#FFD600' },
  misProAvatarPlaceholder: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#1A1A00', borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  misProAvatarInitial: { fontSize: 20, fontWeight: '900', color: '#FFD600' },
  misProInfo: { flex: 1 },
  misProName: { fontSize: 15, fontWeight: '900', color: '#F5F5F5', marginBottom: 2 },
  misProRole: { fontSize: 12, color: '#555', marginBottom: 4 },
  misProRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  misProRatingVal:  { fontSize: 13, fontWeight: '800', color: '#FFD600' },
  misProRatingJobs: { fontSize: 11, color: '#444' },
  misProBusyBadge: {
    backgroundColor: 'rgba(255,68,68,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.2)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  misProBusyText: { fontSize: 10, fontWeight: '800', color: '#ff4444' },

  misProLastJob: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#111', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  misProLastJobText: { fontSize: 12, color: '#555', flex: 1 },

  misProMyRating: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  misProMyRatingLabel: { fontSize: 12, color: '#444' },
  misProMyRatingStars: { flexDirection: 'row', gap: 2 },

  misProBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 12, paddingVertical: 13,
  },
  misProBtnOff: { backgroundColor: '#1a1a1a' },
  misProBtnText: { fontSize: 14, fontWeight: '900', color: '#0A0A0A' },
  misProBtnTextOff: { color: '#444' },

  // Favoritos (legacy — se pueden eliminar si no hay otros usos)
  favSectionTitle: {
    fontSize: 11, fontWeight: '800', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },
  favCard: {
    width: 90, alignItems: 'center', gap: 4,
    backgroundColor: '#111', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E1E1E',
    padding: 10,
  },
  favAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5, borderColor: '#FFD60060',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  favAvatarImg: { width: '100%', height: '100%' },
  favName:       { fontSize: 12, fontWeight: '700', color: '#F5F5F5', textAlign: 'center' },
  favRatingRow:  { flexDirection: 'row', alignItems: 'center', gap: 2 },
  favRating:     { fontSize: 11, color: '#888' },
  favRequestBtn: {
    backgroundColor: '#FFD600', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5, marginTop: 2,
  },
  favRequestBtnOff:     { backgroundColor: '#1a1a1a' },
  favRequestBtnText:    { fontSize: 11, fontWeight: '900', color: '#0A0A0A' },
  favRequestBtnTextOff: { color: '#444' },
});


export default HomeScreen;

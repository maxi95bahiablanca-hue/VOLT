import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Animated, Easing, Dimensions, ScrollView,
  ActivityIndicator, Platform, Image, Linking, Alert, PanResponder,
} from 'react-native';
import VoltMap from '../components/VoltMap';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import locationService from '../services/locationService';
import * as Location from 'expo-location';
import professionService from '../services/professionService';
import professionalService from '../services/professionalService';
import RegisterProfessionalScreen from './RegisterProfessionalScreen';
import ProfileScreen from './ProfileScreen';
import WorkerDashboardScreen from './WorkerDashboardScreen';
import AdminScreen from './AdminScreen';
import HowItWorksScreen from './HowItWorksScreen';
import HistoryScreen from './HistoryScreen';
import PrivacyPolicyScreen from './PrivacyPolicyScreen';
import DrawerMenu from '../components/DrawerMenu';

const { height: SCREEN_H } = Dimensions.get('window');
const BUTTON_SIZE = 64;
const CARD_H = 260;

const PANEL_FULL   = 330;
const PANEL_PEEK   = 155;
const PANEL_HIDDEN = PANEL_FULL - PANEL_PEEK;

const CLIENT_TIPS = [
  { icon: 'shield-checkmark-outline', color: '#4CAF50', text: 'Siempre pedí el código de verificación antes de abrir la puerta' },
  { icon: 'star-outline',             color: '#FFD600', text: 'Calificá al profesional para ayudar a la comunidad VOLT' },
  { icon: 'card-outline',             color: '#4285F4', text: 'El pago es 100% digital. Nunca pagues en efectivo' },
  { icon: 'people-outline',           color: '#FF9800', text: 'Todos los trabajadores tienen antecedentes verificados' },
  { icon: 'time-outline',             color: '#888',    text: 'El costo de visita se cobra aunque no se realice el trabajo' },
];

const WORKER_TIPS = [
  { icon: 'trending-up-outline', color: '#4CAF50', text: '¡Más calificación = menor comisión! Apuntá al nivel Elite' },
  { icon: 'id-card-outline',     color: '#FFD600', text: 'Mostrá siempre tu código de verificación al llegar al domicilio' },
  { icon: 'flash-outline',       color: '#4285F4', text: 'Respondé rápido — los clientes eligen al primer disponible' },
  { icon: 'thumbs-up-outline',   color: '#FF9800', text: 'Un buen pre-diagnóstico genera más confianza y mejores calificaciones' },
];

// Tarjeta del trabajador seleccionado (sube desde abajo)
const WorkerCard = ({ worker, slideAnim, onContact, onClose }) => {
  const displayRating = worker.effective_rating ?? worker.avg_rating ?? 0;
  const stars = Math.round(displayRating);
  const onTime = worker.on_time_completions || 0;
  return (
    <Animated.View style={[styles.card, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.cardHandle} />
      <TouchableOpacity style={styles.cardClose} onPress={onClose}>
        <Ionicons name="close" size={20} color="#888" />
      </TouchableOpacity>

      <View style={styles.cardHeader}>
        <View style={styles.cardAvatar}>
          {worker.avatar_url
            ? <Image source={{ uri: worker.avatar_url }} style={styles.cardAvatarImg} />
            : <Ionicons name="person" size={28} color="#FFD600" />}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{worker.first_name} {worker.last_name}</Text>
          <Text style={styles.cardProfession}>{worker.profession_name}</Text>
          <View style={styles.cardStars}>
            {[1,2,3,4,5].map(i => (
              <Ionicons key={i} name={i <= stars ? 'star' : 'star-outline'} size={14} color="#FFD600" />
            ))}
            <Text style={styles.cardRatingNum}>
              {displayRating ? Number(displayRating).toFixed(1) : 'Nuevo'}
            </Text>
            {onTime > 0 && (
              <View style={styles.onTimeBadge}>
                <Ionicons name="timer-outline" size={10} color="#4CAF50" />
                <Text style={styles.onTimeBadgeText}>{onTime} en tiempo</Text>
              </View>
            )}
          </View>
          {worker.estudios_url && (
            <View style={styles.cardEstudiosBadge}>
              <Ionicons name="school" size={10} color="#4285F4" />
              <Text style={styles.cardEstudiosBadgeText}>Certificado</Text>
            </View>
          )}
        </View>
        <View style={styles.cardDistBadge}>
          <Ionicons name="location-sharp" size={12} color="#FFD600" />
          <Text style={styles.cardDistText}>
            {worker.distance_meters < 1000
              ? `${Math.round(worker.distance_meters)} m`
              : `${(worker.distance_meters / 1000).toFixed(1)} km`}
          </Text>
        </View>
      </View>

      <View style={styles.cardStats}>
        <View style={styles.cardStat}>
          <Text style={styles.cardStatVal}>{worker.completed_jobs || 0}</Text>
          <Text style={styles.cardStatLbl}>Trabajos</Text>
        </View>
        <View style={styles.cardStatDiv} />
        <View style={styles.cardStat}>
          <Text style={styles.cardStatVal}>${(worker.min_price || 0).toLocaleString('es-AR')}</Text>
          <Text style={styles.cardStatLbl}>Precio mín.</Text>
        </View>
        <View style={styles.cardStatDiv} />
        <View style={styles.cardStat}>
          <Text style={styles.cardStatVal}>
            {worker.completed_jobs >= 100 && displayRating >= 4.8 ? 'Elite'
              : worker.completed_jobs >= 50 && displayRating >= 4.5 ? 'Pro'
              : worker.completed_jobs >= 10 && displayRating >= 4.0 ? 'Verificado'
              : 'Nuevo'}
          </Text>
          <Text style={styles.cardStatLbl}>Nivel</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.requestBtn} onPress={() => onContact(worker)} activeOpacity={0.85}>
        <Ionicons name="flash" size={20} color="#0A0A0A" />
        <Text style={styles.requestBtnText}>
          Solicitar — ${(worker.min_price || 30000).toLocaleString('es-AR')} visita
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
const HomeScreen = ({ session, professional, onRequestJob, onActiveJob, onIncomingJob }) => {
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
  const [showWorkerPanel, setShowWorkerPanel] = useState(false);
  const [showAdmin, setShowAdmin]           = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showPrivacy, setShowPrivacy]       = useState(false);
  const newJobChannelRef = useRef(null);

  // Tips rotativos
  const [tipIndex, setTipIndex] = useState(0);

  // Banner de pago para clientes sin pago verificado
  const [paymentVerified, setPaymentVerified] = useState(true); // default true para no mostrar banner innecesariamente

  // Radar animation
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);
  const locationSub = useRef(null);

  // Card animation
  const slideAnim = useRef(new Animated.Value(CARD_H)).current;

  // Panel deslizante
  const panelY    = useRef(new Animated.Value(PANEL_HIDDEN)).current;
  const panelBase = useRef(PANEL_HIDDEN);
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
    professionService.getProfessions().then(setProfessions).catch(() => {});
    initLocation();
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

  // ─── Ubicación inicial y workers ─────────────────────
  const initLocation = async () => {
    try {
      const granted = await locationService.requestPermission();
      if (!granted) return;
      const pos = await locationService.getCurrentLocation();
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
      if (selectedProfession) fetchWorkers(selectedProfession.id, latitude, longitude);
    } catch { /* silent */ }
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

  // ─── Búsqueda de profesiones ─────────────────────────
  useEffect(() => {
    if (query.length < 3) { setResults([]); return; }
    setResults(
      professions
        .filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 4)
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

  const handleToggle = async () => {
    if (toggling) return;
    setToggling(true);
    const next = !available;
    setAvailable(next);
    try {
      if (next) {
        // Guardar ubicación ANTES de aparecer como disponible
        const granted = await locationService.requestPermission();
        if (granted) {
          const pos = await locationService.getCurrentLocation().catch(() => null);
          if (pos) {
            await professionalService.updateLocation(userId, pos.coords.latitude, pos.coords.longitude);
          }
        }
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

  const handleEmergency = () => {
    Alert.alert('🚨 Emergencia', '¿Querés llamar al 911?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Llamar al 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  // ─── Drawer navigation ───────────────────────────────
  const handleDrawerNavigate = (dest) => {
    switch (dest) {
      case 'profile':     setShowProfile(true);     break;
      case 'history':     setShowHistory(true);     break;
      case 'register':    setShowRegister(true);    break;
      case 'workerPanel': setShowWorkerPanel(true); break;
      case 'admin':       setShowAdmin(true);       break;
      case 'howItWorks':  setShowHowItWorks(true);  break;
      case 'privacy':     setShowPrivacy(true);     break;
    }
  };

  // ─── Navegación interna ──────────────────────────────
  if (showRegister) {
    return <RegisterProfessionalScreen userId={userId} session={session} onBack={() => setShowRegister(false)} />;
  }
  if (showProfile) {
    return <ProfileScreen session={session} professional={professional} onClose={() => setShowProfile(false)} />;
  }
  if (showHistory) {
    return <HistoryScreen session={session} professional={professional} onClose={() => setShowHistory(false)} />;
  }
  if (showWorkerPanel && professional) {
    return <WorkerDashboardScreen professional={professional} session={session} onClose={() => setShowWorkerPanel(false)} />;
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
  return (
    <View style={styles.container}>

      {/* MAPA */}
      <VoltMap
        userLocation={userLocation}
        workers={workers}
        onWorkerPress={selectWorker}
        style={StyleSheet.absoluteFill}
      />

      {/* BARRA SUPERIOR */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          {/* Hamburguesa */}
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowDrawer(true)}>
            <Ionicons name="menu" size={24} color="#FFD600" />
          </TouchableOpacity>

          {/* Buscador */}
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color="#888" style={{ marginLeft: 12 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="¿Qué profesional buscás?"
              placeholderTextColor="#555"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={clearProfession} style={{ paddingHorizontal: 12 }}>
                <Ionicons name="close-circle" size={18} color="#555" />
              </TouchableOpacity>
            )}
          </View>

          {/* Logo */}
          <Text style={styles.logoText}>VOLT</Text>
        </View>

        {/* Resultados del buscador */}
        {results.length > 0 && (
          <View style={styles.searchResults}>
            {results.map(p => (
              <TouchableOpacity key={p.id} style={styles.searchItem} onPress={() => selectProfession(p)}>
                <Ionicons name="flash-outline" size={16} color="#FFD600" />
                <Text style={styles.searchItemText}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Chip de profesión seleccionada */}
        {selectedProfession && workers.length === 0 && (
          <View style={styles.emptyChip}>
            <Ionicons name="people-outline" size={16} color="#888" />
            <Text style={styles.emptyChipText}>No hay {selectedProfession.name.toLowerCase()}s disponibles cerca</Text>
          </View>
        )}
        {selectedProfession && workers.length > 0 && (
          <View style={styles.countChip}>
            <View style={styles.countDot} />
            <Text style={styles.countChipText}>{workers.length} disponible{workers.length > 1 ? 's' : ''} cerca</Text>
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

          {/* Título + 911 — siempre visible al abrir el panel */}
          <View style={styles.panelTitleRow}>
            <Text style={styles.panelTitle}>¿Qué necesitás?</Text>
            <TouchableOpacity style={styles.emergencyBtn} onPress={handleEmergency}>
              <Ionicons name="call" size={18} color="#ff4444" />
              <Text style={styles.emergencyBtnText}>911</Text>
            </TouchableOpacity>
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
                  <Ionicons name="flash" size={14} color={active ? '#0A0A0A' : '#FFD600'} />
                  <Text style={[styles.profChipText, active && styles.profChipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Botón solicitud directa — visible cuando hay profesionales disponibles */}
          {selectedProfession && workers.length > 0 && (
            <TouchableOpacity
              style={styles.directRequestBtn}
              onPress={() => onRequestJob?.(null, selectedProfession, userLocation)}
              activeOpacity={0.85}
            >
              <Ionicons name="flash" size={18} color="#0A0A0A" />
              <Text style={styles.directRequestBtnText}>
                Solicitar {selectedProfession.name}
              </Text>
              <View style={styles.directRequestCount}>
                <View style={styles.directRequestDot} />
                <Text style={styles.directRequestCountText}>
                  {workers.length} disponible{workers.length > 1 ? 's' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Banner método de pago — solo para clientes sin pago verificado */}
          {!professional && !paymentVerified && (
            <TouchableOpacity
              style={styles.paymentBanner}
              onPress={() => setShowProfile(true)}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 18 }}>💳</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentBannerTitle}>Configurá tu método de pago</Text>
                <Text style={styles.paymentBannerSub}>Mercado Pago · Tocá para ver tu perfil</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#FFD600" />
            </TouchableOpacity>
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
              onPress={handleToggle}
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
              <TouchableOpacity onPress={() => setShowWorkerPanel(true)} style={styles.dashboardLink} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
                <Text style={styles.dashboardLinkText}>Panel</Text>
                <Ionicons name="chevron-forward" size={13} color={available ? '#0A0A0A' : '#FFD600'} />
              </TouchableOpacity>
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
        />
      )}

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
  map: { ...StyleSheet.absoluteFillObject },

  // Barra superior
  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 36 : 8,
    paddingBottom: 8, gap: 10,
  },
  logoText: {
    fontWeight: '900', fontSize: 20, color: '#FFD600', letterSpacing: 4,
  },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(15,15,15,0.95)',
    borderRadius: 14, borderWidth: 1, borderColor: '#222',
    height: 46,
  },
  searchInput: {
    flex: 1, color: '#F5F5F5', fontSize: 14,
    paddingHorizontal: 8,
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
  emergencyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#ff444460',
    backgroundColor: 'rgba(255,68,68,0.09)',
  },
  emergencyBtnText: { color: '#ff4444', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },

  chipsContent: { gap: 8, paddingRight: 8 },
  profChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#111', borderRadius: 22,
    borderWidth: 1, borderColor: '#222',
    paddingVertical: 11, paddingHorizontal: 16,
  },
  profChipActive: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  profChipText: { fontSize: 15, color: '#aaa', fontWeight: '600' },
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
    backgroundColor: '#333', alignSelf: 'center', marginBottom: 12,
  },
  cardClose: {
    position: 'absolute', top: 16, right: 16,
    padding: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  cardAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1A1A1A',
    borderWidth: 2, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  cardAvatarImg: { width: '100%', height: '100%' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 18, fontWeight: '800', color: '#F5F5F5', marginBottom: 2 },
  cardProfession: { fontSize: 13, color: '#888', marginBottom: 6 },
  cardStars: { flexDirection: 'row', alignItems: 'center', gap: 2, flexWrap: 'wrap' },
  cardRatingNum: { color: '#888', fontSize: 12, marginLeft: 4 },
  onTimeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)',
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2, marginLeft: 4,
  },
  onTimeBadgeText: { color: '#4CAF50', fontSize: 10, fontWeight: '700' },
  cardEstudiosBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6, borderWidth: 1, borderColor: 'rgba(66,133,244,0.35)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: 'rgba(66,133,244,0.08)', alignSelf: 'flex-start',
  },
  cardEstudiosBadgeText: { fontSize: 10, color: '#4285F4', fontWeight: '700' },
  cardDistBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#1A1A1A',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  cardDistText: { color: '#FFD600', fontSize: 13, fontWeight: '700' },

  cardStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141414', borderRadius: 14,
    padding: 16, marginBottom: 16,
  },
  cardStat: { flex: 1, alignItems: 'center' },
  cardStatVal: { fontSize: 16, fontWeight: '800', color: '#F5F5F5', marginBottom: 2 },
  cardStatLbl: { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardStatDiv: { width: 1, height: 32, backgroundColor: '#222' },

  requestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#FFD600',
    borderRadius: 14, paddingVertical: 16,
  },
  requestBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
});


export default HomeScreen;

import React, { useEffect, useRef, useState } from 'react';
import volt from '../utils/voltVoice';
import { isDemoMode } from '../demo/demoMode';
import demoJobService from '../demo/demoJobService';
import demoChatService from '../demo/demoChatService';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  TextInput, Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
  Modal, Linking, ScrollView, Animated, Image, Dimensions, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../supabase';
import jobService from '../services/jobService';
import notificationService from '../services/notificationService';
import paymentService from '../services/paymentService';
import { chargesInApp, isFreeMode } from '../config/monetization';
import cardService from '../services/cardService';
import MPCardForm from '../components/MPCardForm';
import professionalService from '../services/professionalService';
import locationService from '../services/locationService';
import chatService from '../services/chatService';
import favoriteService from '../services/favoriteService';
import ChatScreen from './ChatScreen';
import { preguntarCuandoVoy } from '../utils/cuandoVoy';
import { conTiempo } from '../utils/conTiempo';

// El mapa se lleva casi la mitad de la pantalla: es lo que BOLT tiene y nadie
// más. La hoja arranca justo debajo y se sube con el dedo hasta dejar apenas un
// asomo de mapa, que mantiene el sentido de dónde estás parado.
const { height: SCREEN_H } = Dimensions.get('window');
const HOJA_ABAJO  = Math.round(SCREEN_H * 0.42);                    // reposo: el mapa manda
const HOJA_ARRIBA = Math.max(104, Math.round(SCREEN_H * 0.13));      // subida: no pisa el header

// Un solo acento. El verde, el naranja y el azul se fueron: cinco colores
// compitiendo hacen que ninguno signifique nada (Maxi, 8-ago-2026). El amarillo
// es "esto está pasando ahora"; lo demás, gris. El rojo queda reservado para la
// emergencia real, que vive adentro de "Tengo un problema".
const EVENT_ICONS = {
  received:       { icon: 'search-outline',           color: '#5C5C5C' },
  accepted:       { icon: 'checkmark-circle-outline', color: '#8A8A8A' },
  reviewing:      { icon: 'eye-outline',              color: '#5C5C5C' },
  photo_reviewed: { icon: 'image-outline',            color: '#5C5C5C' },
  estimated:      { icon: 'time-outline',             color: '#5C5C5C' },
  trip_started:   { icon: 'navigate-outline',         color: '#FFD600' },
  halfway:        { icon: 'locate-outline',           color: '#8A8A8A' },
  nearby:         { icon: 'radio-outline',            color: '#FFD600' },
  arrived:        { icon: 'home-outline',             color: '#FFD600' },
  work_started:   { icon: 'construct-outline',        color: '#FFD600' },
  work_done:      { icon: 'checkmark-done-outline',   color: '#8A8A8A' },
};

// Lo que significa cada estrella cuando el profesional califica al cliente.
// Hablan de lo que al profesional le importa: si estaba, si pagó, cómo trató.
const CLIENT_STAR_LABELS = [
  '',
  'Muy malo — no lo volvería a atender',
  'Malo — hubo problemas serios',
  'Normal — nada para destacar',
  'Bueno — todo en orden',
  'Excelente — ojalá todos así',
];

// Cuatro. Con siete pasos ninguno se leía y la barra parecía un tren.
// "Cerca", "Llegó" e "Iniciado" son matices que ya cuenta el dato grande de
// arriba, que es donde el cliente mira.
const PROGRESS_STEPS = [
  { label: 'Aceptado',   step: 1 },
  { label: 'En camino',  step: 2 },
  { label: 'Trabajando', step: 3 },
  { label: 'Listo',      step: 4 },
];

/** "hoy a las 18:00", "mañana a las 10:00", "el jueves a las 10:00".
 *  Un ISO crudo no le dice nada a nadie; la fecha larga tampoco cuando es hoy. */
const cuandoVa = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const hoy  = new Date(); hoy.setHours(0, 0, 0, 0);
  const dia  = new Date(d); dia.setHours(0, 0, 0, 0);
  const dif  = Math.round((dia - hoy) / 86400000);
  if (dif <= 0) return `hoy a las ${hora}`;
  if (dif === 1) return `mañana a las ${hora}`;
  if (dif < 7)  return `el ${d.toLocaleDateString('es-AR', { weekday: 'long' })} a las ${hora}`;
  return `el ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} a las ${hora}`;
};

const STATUS_INFO = {
  pending:          { icon: 'time-outline',            color: '#8A8A8A', label: 'Esperando confirmación...' },
  accepted:         { icon: 'navigate-outline',         color: '#FFD600', label: 'El profesional está en camino' },
  arrived:          { icon: 'home-outline',             color: '#FFD600', label: 'El profesional llegó' },
  in_progress:      { icon: 'construct-outline',        color: '#FFD600', label: 'Trabajo en curso' },
  awaiting_payment: { icon: isFreeMode() ? 'checkmark-done-outline' : 'card-outline', color: '#FFD600', label: isFreeMode() ? 'Por finalizar' : 'Listo para pagar' },
  completed:        { icon: 'checkmark-circle-outline', color: '#8A8A8A', label: '¡Trabajo completado!' },
  cancelled:        { icon: 'close-circle-outline',     color: '#8A8A8A', label: 'Cancelado' },
};

const WORKER_TIPS = {
  accepted:         volt.tipWorkerAccepted,
  arrived:          volt.tipWorkerArrived,
  in_progress:      volt.tipWorkerInProgress,
  awaiting_payment: isFreeMode() ? volt.tipWorkerAwaitingPaymentFree : volt.tipWorkerAwaitingPayment,
};

const CLIENT_TIPS = {
  pending:          volt.tipPending,
  accepted:         volt.tipAccepted,
  arrived:          volt.tipArrived,
  in_progress:      volt.tipInProgress,
  awaiting_payment: isFreeMode() ? volt.tipAwaitingPaymentFree : volt.tipAwaitingPayment,
};

const getProblemIssues = (isWorker, status) => {
  if (isWorker) {
    switch (status) {
      case 'accepted':
        return [
          { icon: 'navigate-outline',      text: 'No encuentro el domicilio / dirección incorrecta' },
          { icon: 'car-outline',           text: 'Tuve un inconveniente en el camino' },
          { icon: 'alert-circle-outline',  text: 'Me siento inseguro/a en esta zona' },
          { icon: 'close-circle-outline',  text: 'No voy a poder llegar — necesito cancelar' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'arrived':
        return [
          { icon: 'person-outline',        text: 'El cliente no abre la puerta / no responde' },
          { icon: 'alert-circle-outline',  text: 'Me siento inseguro/a en este domicilio' },
          { icon: 'clipboard-outline',     text: 'El trabajo es diferente al descripto' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'in_progress':
        return [
          { icon: 'time-outline',          text: 'El trabajo es más complejo — necesito más tiempo' },
          { icon: 'cart-outline',          text: 'Necesito materiales no disponibles' },
          { icon: 'person-remove-outline', text: 'El cliente interfiere con el trabajo' },
          { icon: 'warning-outline',       text: 'Encontré un problema estructural o peligroso' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'awaiting_payment':
        return [
          { icon: 'cash-outline',          text: 'El cliente se niega a pagar' },
          { icon: 'card-outline',          text: 'El cliente quiere pagar en efectivo (no permitido)' },
          { icon: 'calculator-outline',    text: 'No hay acuerdo en el monto' },
          { icon: 'alert-circle-outline',  text: 'El cliente actúa de forma intimidatoria' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      default:
        return [{ icon: 'help-circle-outline', text: 'Tengo un problema general' }];
    }
  } else {
    switch (status) {
      case 'pending':
        return [
          { icon: 'time-outline',          text: 'Tardó más de 30 min sin confirmación' },
          { icon: 'close-circle-outline',  text: 'Quiero cancelar y buscar otro profesional' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'accepted':
        return [
          { icon: 'navigate-outline',      text: 'El profesional tarda demasiado o no llega' },
          { icon: 'chatbubble-outline',    text: 'No puedo contactar al profesional' },
          { icon: 'alert-circle-outline',  text: 'El profesional me pidió cancelar por fuera de la app' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'arrived':
        return [
          { icon: 'shield-outline',        text: '⚠️ El código NO coincide — no abrir la puerta' },
          { icon: 'alert-circle-outline',  text: 'Me siento inseguro/a con el profesional' },
          { icon: 'person-remove-outline', text: 'El profesional actuó de forma inapropiada' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'in_progress':
        return [
          { icon: 'construct-outline',     text: 'El trabajo no se está realizando correctamente' },
          { icon: 'warning-outline',       text: 'El profesional rompió algo o causó daños' },
          { icon: 'cash-outline',          text: 'El profesional me pidió pagar extra en efectivo' },
          { icon: 'alert-circle-outline',  text: 'Me siento en peligro' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      case 'awaiting_payment':
        return [
          { icon: 'calculator-outline',    text: 'El monto no es el acordado' },
          { icon: 'construct-outline',     text: 'El trabajo quedó incompleto' },
          { icon: 'alert-circle-outline',  text: 'Me están presionando para pagar' },
          { icon: 'time-outline',          text: 'Quiero una segunda opinión antes de pagar' },
          { icon: 'help-circle-outline',   text: 'Otro problema' },
        ];
      default:
        return [{ icon: 'help-circle-outline', text: 'Tengo un problema general' }];
    }
  }
};

// Centinela para saber si una llamada volvió o no volvió: conTiempo devuelve
// `siFalla` tanto cuando revienta como cuando vence, así que hay que comparar
// por identidad contra algo que ningún servicio pueda devolver.
const NO_VOLVIO = Symbol('no_volvio');

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const JobTrackingScreen = ({ job: initialJob, session, professional, onComplete, onCancel, onBack }) => {
  // 🔴 11-ago-2026 — las hojas de abajo (modal de cierre, código, "tengo un
  // problema") cerraban con paddingBottom 0 en Android: la última fila caía
  // arriba de la barra de 3 botones y el dedo tocaba Home o Atrás en vez del
  // botón. El alto real lo da el sistema, nunca un número fijo.
  const insets      = useSafeAreaInsets();
  const padBarra    = { paddingBottom: Math.max(insets.bottom, 16) };
  const [job, setJob]               = useState(initialJob);
  const [workAmount, setWorkAmount]     = useState('');
  const [pricePropModal, setPricePropModal] = useState(false); // trabajador propone precio
  const [loading, setLoading]       = useState(false);
  const [codeModal, setCodeModal]     = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [codeResult, setCodeResult]   = useState(null);
  const [completedModal, setCompletedModal] = useState(false);
  const [completing, setCompleting]         = useState(null); // opción de horas que se está cerrando
  const [clientStars, setClientStars]       = useState(0);   // el profesional califica al cliente
  const [seguimientoHecho, setSeguimientoHecho] = useState(false);  // ya contestó el "¿vino?"
  const [problemModal, setProblemModal]     = useState(false);
  const [menuOpen, setMenuOpen]             = useState(false);
  const [hojaArriba, setHojaArriba]         = useState(false);
  const [visitPayModal, setVisitPayModal]   = useState(false);
  // Materiales (estimación → aprobación)
  const [materialsEstModal, setMaterialsEstModal] = useState(false);
  const [materialsEst, setMaterialsEst]     = useState('');
  const [materialsDetail, setMaterialsDetail] = useState('');
  // Tarjetas guardadas (pago en 1 toque)
  const [savedCards, setSavedCards] = useState([]);
  const [payCard, setPayCard]       = useState(null);
  // Chat
  const [showChat, setShowChat]             = useState(false);
  const [unreadCount, setUnreadCount]       = useState(0);
  // Favorito
  const [isFav, setIsFav]                   = useState(false);
  const [favLoading, setFavLoading]         = useState(false);
  // Resumen del trabajo (trabajador)
  const [summaryModal, setSummaryModal]     = useState(false);
  const [summaryObs, setSummaryObs]         = useState('');
  const [summarySolution, setSummarySolution] = useState('');
  const [summaryMats, setSummaryMats]       = useState('');
  const [summaryWarranty, setSummaryWarranty] = useState('');
  // Alertas
  const [nearbyAlert, setNearbyAlert]       = useState(false);
  const [events, setEvents]                 = useState([]);
  const [timeSinceUpdate, setTimeSinceUpdate] = useState(0);
  const [inactivityAlert, setInactivityAlert] = useState(false);
  const [workerDistKm, setWorkerDistKm]       = useState(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ─── La hoja deslizable del cliente ─────────────────────────────────────────
  // Dos posiciones, no libre: soltar en cualquier lado deja la pantalla a medio
  // camino y se siente rota. El gesto decide con la dirección, no con la
  // distancia, así un empujón corto ya la mueve.
  const sheetY        = useRef(new Animated.Value(HOJA_ABAJO)).current;
  const sheetBaseRef  = useRef(HOJA_ABAJO);
  const panelScrollRef = useRef(null);
  const scrollYRef     = useRef(0);

  const moverHoja = (arriba) => {
    const destino = arriba ? HOJA_ARRIBA : HOJA_ABAJO;
    sheetBaseRef.current = destino;
    setHojaArriba(arriba);
    if (!arriba) panelScrollRef.current?.scrollTo({ y: 0, animated: true });
    Animated.spring(sheetY, {
      toValue: destino,
      useNativeDriver: true,
      bounciness: 2,
      speed: 14,
    }).start();
  };

  const sheetPan = useRef(
    PanResponder.create({
      // Sólo si el movimiento es claramente vertical: si no, se come el toque de
      // los botones que están adentro.
      onMoveShouldSetPanResponder: (_, g) => {
        if (Math.abs(g.dy) < 8 || Math.abs(g.dy) < Math.abs(g.dx)) return false;
        // Con la hoja arriba, el contenido scrollea: sólo tomamos el gesto para
        // bajarla, y únicamente si el scroll ya está en el tope.
        if (sheetBaseRef.current === HOJA_ARRIBA) return g.dy > 0 && scrollYRef.current <= 0;
        return true;
      },
      onPanResponderMove: (_, g) => {
        const y = Math.min(HOJA_ABAJO, Math.max(HOJA_ARRIBA, sheetBaseRef.current + g.dy));
        sheetY.setValue(y);
      },
      onPanResponderRelease: (_, g) => {
        const rapido = Math.abs(g.vy) > 0.5;
        const sube = rapido ? g.vy < 0 : g.dy < -(HOJA_ABAJO - HOJA_ARRIBA) / 3;
        const baja = rapido ? g.vy > 0 : g.dy > (HOJA_ABAJO - HOJA_ARRIBA) / 3;
        if (sube) moverHoja(true);
        else if (baja) moverHoja(false);
        else moverHoja(sheetBaseRef.current === HOJA_ARRIBA);
      },
    })
  ).current;
  const completedShownRef  = useRef(false);
  const selfCancelledRef   = useRef(false);
  const visitPayShownRef   = useRef(false);
  const nearbyShownRef     = useRef(false);
  const halfwayShownRef    = useRef(false);
  const initialDistRef     = useRef(null);
  const eventsChannelRef   = useRef(null);
  const lastActivityRef    = useRef(Date.now());
  const chatChannelRef     = useRef(null);
  const webRef = useRef(null);
  const wasQuoteRef    = useRef(!!job.quote_group_id); // nació como presupuesto (grupo)
  // ¿El trabajo YA estaba terminado cuando se abrió esta pantalla? Si sí, se
  // está mirando un trabajo viejo y no hay que mandarlo a calificar: la
  // calificación es para el trabajo que termina MIENTRAS lo estás siguiendo.
  const yaEstabaCerradoRef = useRef(['completed', 'cancelled'].includes(job.status));
  const tripStartedRef = useRef(false);                // ya disparó el viaje al ser elegido

  const userId   = session?.user?.id;
  const clientId = job.client_id;
  // El rol se determina por ESTE trabajo, NO por tener perfil de profesional.
  // Un usuario registrado como trabajador también puede PEDIR trabajos (ser
  // cliente). Soy "trabajador" en este job solo si soy el profesional asignado
  // y no su cliente. Así, si pido un servicio, veo las pantallas de cliente.
  // 🔴 9-ago-2026 — ACÁ SE PERDÍA EL BOTÓN "VOY EN CAMINO".
  //    Esto dependía SÓLO de `professional`, que llega por prop desde App.js y
  //    se carga de forma asincrónica: si la pantalla se abre antes de que el
  //    perfil esté cargado —entrando por una notificación, por el pin, o
  //    volviendo a la app— `professional` es null, `isWorker` da false y el
  //    profesional ve la pantalla del CLIENTE de su propio trabajo: con
  //    "Llamar" y "Mensaje", y sin ninguna de sus acciones. Desde afuera se ve
  //    exactamente como lo describió Maxi: "desapareció el VOY EN CAMINO".
  //
  //    ⚠️ El primer intento de arreglo (mirar `job.professionals.user_id`) NO
  //    servía: `getActiveForWorker` trae el job con `select('*, professions(name)')`,
  //    o sea SIN los datos del profesional. Justo por el camino que usa el
  //    trabajador, ese respaldo llegaba vacío y el bug seguía igual.
  //
  //    Y el segundo intento —"si no sos el cliente, sos el profesional"— tenía
  //    un agujero que se come justo el caso de las pruebas: **cuando el mismo
  //    usuario es las dos cosas**. Probando el circuito con una sola cuenta
  //    (pedís desde la web y aceptás desde la app), `userId === clientId`, la
  //    app te trata de cliente y NADIE puede tocar "Voy en camino": el trabajo
  //    queda trabado. No es sólo cosa de la prueba — un profesional que se
  //    pide un trabajo a sí mismo por error queda igual de trabado.
  //
  //    Ahora se pregunta lo que importa de verdad: ¿soy el profesional de este
  //    trabajo? Y se responde por dos vías, para no depender de ninguna sola:
  //    el perfil que llega por prop (puede tardar) o el user_id que viaja
  //    dentro del job (`professionals(user_id)`, agregado a los tres selects
  //    del servicio justo para esto). Ser el cliente NO quita ser el
  //    profesional: si sos los dos, ganan las acciones, que son las únicas que
  //    hacen avanzar el trabajo.
  const proUserId = job.professionals?.user_id;
  const soyElProfesional =
    (!!professional && professional.id === job.professional_id) ||
    (!!proUserId && proUserId === userId);
  const isWorker = soyElProfesional || (!!job.professional_id && userId !== clientId);
  // 🔴 13-ago-2026 — el nombre es el del profesional DEL TRABAJO. Antes ganaba
  //    `professional` (el perfil propio de quien mira): a Mariana, clienta con
  //    ficha de prestadora, la pantalla le decía "Ahora hablás con Mariana" —
  //    su propio nombre— con la tarjeta de Maximiliano abajo. El perfil propio
  //    sólo vale cuando el que mira ES el profesional del trabajo.
  const nombreCrudo = (job.professionals?.first_name || '') ||
    (soyElProfesional ? (professional?.first_name || '') : '') ||
    'El profesional';
  // Se anotan en minúscula y así se leía en toda la pantalla ("maximiliano").
  const workerFirstName = nombreCrudo.charAt(0).toUpperCase() + nombreCrudo.slice(1);

  // ── La ventana de ubicación ──────────────────────────────────────────────
  //  Maxi (5-ago-2026): "no se tiene que ver el GPS hasta que no esté yendo el
  //  profesional al domicilio, luego se deja de ver hasta la próxima visita".
  //
  //  El interruptor es job.on_the_way_at (migración 054), que ya existía desde
  //  la 040 pero nadie apagaba: se ponía al aceptar y quedaba encendido para
  //  siempre. Ahora se limpia al llegar y se vuelve a encender en cada viaje.
  //
  //  El profesional nunca vio un mapa acá, así que esto sólo afecta al cliente.
  const enCamino = !!job.on_the_way_at;

  // Suscribir a cambios del job (Realtime) + polling de respaldo.
  // Sin el polling, si el Realtime no entrega el UPDATE, el trabajador que envió
  // su presupuesto nunca se entera de que el cliente lo eligió (queda "enviado/
  // cargando"), y el cliente no ve los cambios de estado del trabajo.
  useEffect(() => {
    const svc = isDemoMode() ? demoJobService : jobService;
    const channel = svc.subscribeToJob(job.id, (updated) => setJob(prev => ({ ...prev, ...updated })));
    let poll = null;
    if (!isDemoMode()) {
      poll = setInterval(async () => {
        try {
          const fresh = await jobService.getById(job.id);
          if (fresh) setJob(prev => ({ ...prev, ...fresh }));
        } catch { /* silent */ }
      }, 4000);
    }
    return () => { if (channel) channel.unsubscribe?.(); if (poll) clearInterval(poll); };
  }, [job.id]);

  // Mezclar sin repetir y en orden: el mismo evento puede llegar por el canal
  // en vivo y por la recarga de respaldo.
  const sumarEventos = (nuevos) => {
    setEvents(prev => {
      const porId = new Map();
      [...prev, ...(nuevos || [])].forEach(e => { if (e?.id) porId.set(e.id, e); });
      return [...porId.values()].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
    });
  };

  // Cargar eventos históricos del timeline
  useEffect(() => {
    jobService.getEvents(job.id).then(sumarEventos).catch(() => {});
  }, [job.id]);

  // Suscribir a nuevos eventos del timeline en tiempo real
  useEffect(() => {
    eventsChannelRef.current = jobService.subscribeToEvents(job.id, (ev) => {
      sumarEventos([ev]);
      lastActivityRef.current = Date.now();
    });
    return () => { eventsChannelRef.current?.unsubscribe?.(); };
  }, [job.id]);

  // 🔴 9-ago-2026 — LA LÍNEA DE TIEMPO NO SE MOVÍA.
  //    Los eventos se cargaban UNA sola vez (dependencia `[job.id]`) y de ahí
  //    en adelante dependían **sólo** del canal en vivo. Si ese canal no
  //    entregaba —y el de `job_events` es el más frágil de los tres— el cliente
  //    veía la línea congelada en el primer evento; después, al volver a montar
  //    la pantalla, aparecían todos juntos de golpe. Justo lo que reportó Maxi:
  //    "se pusieron todos juntos al iniciar el trabajo".
  //
  //    El job ya tenía polling de respaldo desde hace rato; los eventos no.
  //    Ahora se recargan cada 10 s y, además, en cuanto cambia algo del trabajo
  //    —cada cambio de estado trae eventos nuevos con él—.
  //    Sólo para el cliente: es el único que ve la línea de tiempo.
  useEffect(() => {
    if (isWorker || isDemoMode()) return;
    const traer = () => jobService.getEvents(job.id).then(sumarEventos).catch(() => {});
    traer();
    const t = setInterval(traer, 10000);
    return () => clearInterval(t);
  }, [job.id, job.status, job.on_the_way_at, job.sub_status, isWorker]);

  // Actualizar actividad cuando el job cambia
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [job.updated_at, job.status]);

  // Timer: calcula tiempo desde última actividad y detecta inactividad > 10 min
  useEffect(() => {
    const compute = () => {
      const mins = Math.floor((Date.now() - lastActivityRef.current) / 60000);
      setTimeSinceUpdate(mins);
      const isInactive = ['accepted', 'arrived'].includes(job.status) && mins >= 10 && !isWorker;
      setInactivityAlert(isInactive);
    };
    compute();
    const t = setInterval(compute, 30000);
    return () => clearInterval(t);
  }, [job.status, isWorker]);

  // Pulso animado del statusDot
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.5, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Unread count del chat
  useEffect(() => {
    const cs = isDemoMode() ? demoChatService : chatService;
    cs.getUnreadCount(job.id, userId).then(setUnreadCount).catch(() => {});
    chatChannelRef.current = cs.subscribeToMessages(job.id, (msg) => {
      if (msg.sender_id !== userId && !showChat) {
        setUnreadCount(c => c + 1);
      }
    });
    return () => { if (chatChannelRef.current) chatChannelRef.current.unsubscribe?.(); };
  }, [job.id]);

  // Favorito inicial (solo cliente, cuando hay profesional asignado)
  useEffect(() => {
    if (isWorker || !job.professional_id) return;
    favoriteService.isFavorite(userId, job.professional_id)
      .then(setIsFav).catch(() => {});
  }, [job.professional_id]);

  // Auto-mostrar pago de visita al cliente cuando el trabajador llega
  useEffect(() => {
    if (chargesInApp() && !isWorker && job.status === 'arrived' && !job.visit_paid && !visitPayShownRef.current) {
      visitPayShownRef.current = true;
      setVisitPayModal(true);
    }
  }, [job.status, job.visit_paid]);

  // Presupuesto elegido por el cliente (se borró quote_group_id) → recién ACÁ
  // el presupuesto se vuelve un trabajo: aviso al cliente + eventos del timeline.
  useEffect(() => {
    if (!isWorker || !wasQuoteRef.current || tripStartedRef.current) return;
    if (job.quote_group_id || job.status !== 'accepted') return;
    tripStartedRef.current = true;
    const arrivalEst = job.arrival_estimate || '~30 min';
    notificationService.sendToUser(clientId, {
      title: '✅ Tu profesional quedó confirmado',
      body:  `${workerFirstName} tomó el trabajo. Te avisamos cuando salga: pedile el código antes de abrir la puerta.`,
      data:  { jobId: job.id, screen: 'tracking' },
    }).catch(() => {});
    chatService.sendSystemMessage(job.id, volt.chatAccepted).catch(() => {});
    jobService.addEvent(job.id, 'accepted',      `Profesional confirmado para el trabajo ✅`).catch(() => {});
    jobService.addEvent(job.id, 'estimated',     `Llega en aprox. ${arrivalEst}.`).catch(() => {});
    // 🔴 Ya no se anota `trip_started` acá: que lo elijan no es que haya salido.
    //    Ese evento lo escribe handleWorkerAction('on_the_way'), cuando el
    //    profesional toca "Voy en camino" de verdad.
    // La pregunta "¿cuándo vas?" es ACÁ para el presupuesto: recién ahora hay
    // trabajo. Antes se hacía al enviarlo y podía dejar `on_the_way_at` puesto
    // sin que nadie hubiera salido.
    preguntarCuandoVoy(job.id);
  }, [job.quote_group_id, job.status]);

  // Cancelación o finalización detectada vía realtime
  useEffect(() => {
    if (job.status === 'cancelled' && isWorker && !selfCancelledRef.current) {
      const msg = wasQuoteRef.current
        ? 'El cliente eligió a otro profesional. ¡Seguí atento, van a llegar más pedidos!'
        : 'El cliente canceló el trabajo.';
      Alert.alert(wasQuoteRef.current ? 'No fuiste elegido esta vez' : 'Trabajo cancelado', msg, [{ text: 'Entendido', onPress: onCancel }]);
    }
    if (job.status === 'completed' && isWorker && !completedShownRef.current && !yaEstabaCerradoRef.current) {
      completedShownRef.current = true;
      setCompletedModal(true);
    }
    if (job.status === 'completed' && !isWorker && !yaEstabaCerradoRef.current) {
      onComplete(job);
    }
  }, [job.status]);

  // Qué pasa con cada respuesta del seguimiento del día siguiente:
  //  - todo bien  → se agradece y no se molesta más
  //  - vino pero… → se abre la puerta a que cuente qué pasó, por el chat
  //  - no vino    → 🔴 esto es lo que hay que cazar: queda anotado y se le
  //                 avisa al profesional, que puede haber tenido un problema
  //                 real y el cliente estar esperando sin saber nada.
  const responderSeguimiento = async (respuesta) => {
    setSeguimientoHecho(true);       // se va de pantalla al toque, sin esperar
    try {
      await jobService.responderSeguimiento(job.id, respuesta);
      if (respuesta === 'no_vino') {
        await chatService.sendSystemMessage(job.id,
          `El cliente avisó que hoy no hubo novedades del trabajo. ${workerFirstName}, ¿pudiste ir? Si te surgió algo, avisale por acá así se organiza.`).catch(() => {});
        await notificationService.sendToUser(job.professionals?.user_id, {
          title: '📋 Te están esperando',
          body: `${job.address || 'El cliente'} avisó que hoy no hubo novedades. Si no vas a poder ir, avisale.`,
          data: { jobId: job.id, screen: 'tracking' },
        }).catch(() => {});
      } else if (respuesta === 'vino_problema') {
        await chatService.sendSystemMessage(job.id,
          'El cliente marcó que hubo algo para mejorar. Contale por acá qué pasó así lo resuelven.').catch(() => {});
      }
    } catch (e) {
      // Que no se trabe: si falla el guardado, la tarjeta ya se fue y el
      // cliente no queda en un limbo. Vuelve a preguntar mañana.
      console.log('seguimiento no guardado:', e?.message);
    }
  };

  // 🔴 11-ago-2026 — antes esto cerraba el modal de entrada y recién después
  // esperaba rateClient y setAvailableAt, los dos sin tope. Con mala señal el
  // fetch no vuelve nunca, el `onComplete` no corría y el profesional quedaba
  // parado en la pantalla de un trabajo que ya estaba en 'completed': sin
  // modal, sin botones y sin entender qué pasó. Y encima con la disponibilidad
  // sin programar, que es el agujero que dejó 8 de 10 aprobados invisibles.
  // Ahora: el modal se queda con el spinner mientras trabaja, cada llamada
  // tiene 5 s y la salida se ejecuta sí o sí desde el finally.
  const handleAvailabilityAndComplete = async (hoursFromNow) => {
    if (completing !== null) return;
    setCompleting(hoursFromNow);
    // El id del profesional puede venir por prop (el perfil tarda en cargar) o
    // dentro del job: en un trabajo aceptado professional_id SIEMPRE está (ya se
    // usa así para decidir el rol). Si se entra por la notificación antes de que
    // cargue el perfil, `professional` es null y el radar quedaba sin programar
    // SIN avisar. Con el fallback se programa igual; si no hay ninguno, se avisa.
    const profId = professional?.id || job.professional_id;
    let dispoProgramada = true;
    try {
      // La calificación del cliente va primero pero NUNCA frena el cierre: si
      // falla (o si no puntuó), el trabajo se termina igual.
      if (clientStars > 0 && profId && job.client_id) {
        await conTiempo(jobService.rateClient({
          jobId:          job.id,
          clientId:       job.client_id,
          professionalId: profId,
          rating:         clientStars,
        }), 5000);
      }
      if (profId) {
        // Centinela propio: conTiempo devuelve lo mismo si falla que si vence,
        // y acá sí importa distinguirlo para poder avisarle.
        const r = await conTiempo(
          professionalService.setAvailableAt(profId, hoursFromNow), 5000, NO_VOLVIO);
        dispoProgramada = r !== NO_VOLVIO;
      } else {
        // Sin id del profesional no se pudo programar el radar: hay que avisar,
        // no callarse con el radar apagado (era el agujero del cierre con perfil null).
        dispoProgramada = false;
      }
    } catch (e) {
      // `conTiempo` sólo atrapa la promesa: si algo revienta ANTES de que la
      // llamada arranque (un servicio que no está, un dato que falta), el error
      // salía crudo del async y encima quedaba `dispoProgramada` en true, o sea
      // que nos callábamos con el radar sin programar. Si llegamos acá, la
      // disponibilidad seguro no se guardó.
      dispoProgramada = false;
      console.log('cierre del trabajo:', e?.message);
    } finally {
      setCompleting(null);
      setCompletedModal(false);
      onComplete(job);
      // No se puede quedar creyendo que su radar quedó programado si no quedó:
      // callarse acá es dejarlo apagado sin que se entere.
      if (!dispoProgramada) {
        Alert.alert(
          'Trabajo cerrado',
          'No pudimos programar tu disponibilidad. Revisá el radar en Mi negocio para volver a recibir pedidos.'
        );
      }
    }
  };

  // Se dejó de ir en camino (llegó, o el viaje se cerró): borrar su marcador.
  // El mapa ahora queda montado siempre, así que hay que limpiarlo a mano.
  useEffect(() => {
    if (isWorker || enCamino) return;
    setWorkerDistKm(null);
    webRef.current?.postMessage(JSON.stringify({ type: 'WORKER_CLEAR' }));
  }, [enCamino, isWorker]);

  // Suscribir a ubicación del trabajador (solo cliente)
  useEffect(() => {
    if (isWorker || !job.professional_id) return;
    // 🔴 La ubicación se recibe SOLO mientras va en camino (migración 054).
    //    Antes no había ninguna condición: el cliente lo veía moverse por toda
    //    la ciudad desde que aceptaba hasta que el trabajo cerraba — y en
    //    multi-día eso son días. Al llegar, on_the_way_at vuelve a NULL y esta
    //    suscripción se corta sola (está en las dependencias del efecto).
    if (!job.on_the_way_at) return;
    const svc = isDemoMode() ? demoJobService : jobService;
    const channel = svc.subscribeWorkerLocation(job.professional_id, (locationStr) => {
      const match = locationStr.match(/POINT\(([^ ]+) ([^ )]+)\)/);
      if (match) {
        const wLng = parseFloat(match[1]);
        const wLat = parseFloat(match[2]);
        webRef.current?.postMessage(JSON.stringify({ type: 'WORKER_MOVE', lat: wLat, lng: wLng }));
        lastActivityRef.current = Date.now();
        // Detección de proximidad del trabajador
        if (job.client_lat && job.client_lng && job.status === 'accepted') {
          const dist = haversineMeters(wLat, wLng, job.client_lat, job.client_lng);
          setWorkerDistKm(dist / 1000);
          if (!initialDistRef.current) initialDistRef.current = dist;
          const halfwayThreshold = initialDistRef.current / 2;
          if (!halfwayShownRef.current && !nearbyShownRef.current && dist < halfwayThreshold && dist > 500) {
            halfwayShownRef.current = true;
            jobService.addEvent(job.id, 'halfway', `Va por más de la mitad del camino.`).catch(() => {});
          }
          if (!nearbyShownRef.current && dist < 500) {
            nearbyShownRef.current = true;
            setNearbyAlert(true);
            jobService.setSubStatus(job.id, 'nearby').catch(() => {});
            jobService.addEvent(job.id, 'nearby', `Está muy cerca, ¡ya llega!`).catch(() => {});
            chatService.sendSystemMessage(job.id, volt.chatNearby).catch(() => {});
            setTimeout(() => setNearbyAlert(false), 8000);
          }
        }
      }
    });
    return () => { if (channel) channel.unsubscribe?.(); };
  }, [isWorker, job.professional_id, job.status, job.on_the_way_at]);

  // Publicar ubicación del trabajador — SOLO mientras va en camino.
  //
  // 🔴 Distinción que hay que entender para no romper el cierre de jornada:
  //    LEER el GPS y PUBLICARLO son dos cosas distintas.
  //    · Se PUBLICA (updateLocation) sólo si va en camino → es lo único que el
  //      cliente puede ver. Antes se publicaba también en 'arrived' e
  //      'in_progress', o sea mientras trabajaba dentro de la casa.
  //    · Se LEE igual mientras está en la obra, sin publicar nada, porque
  //      detectarQueSeFue() necesita el GPS para cerrar la jornada sola cuando
  //      el profesional se va y no aprieta ningún botón (regla del proyecto).
  useEffect(() => {
    if (!isWorker || isDemoMode()) return;
    const enObra = ['arrived', 'in_progress'].includes(job.status);
    if (!enCamino && !enObra) return;

    let sub = null;
    let cancelled = false;
    (async () => {
      const granted = await locationService.requestPermission().catch(() => false);
      if (!granted || cancelled) return;
      // Empujar la posición actual de entrada, sólo si el cliente lo está viendo
      if (enCamino) {
        locationService.getCurrentLocation()
          .then(pos => professionalService.updateLocation(userId, pos.coords.latitude, pos.coords.longitude))
          .catch(() => {});
      }
      const s = await locationService.watchLocation(async (lat, lng) => {
        if (enCamino) await professionalService.updateLocation(userId, lat, lng).catch(() => {});
        detectarQueSeFue(lat, lng);
      }).catch(() => null);
      if (cancelled) { s?.remove?.(); return; }
      sub = s;
    })();

    return () => { cancelled = true; sub?.remove?.(); };
  }, [isWorker, job.status, job.on_the_way_at, userId]);

  // ── "¿Te fuiste?" ────────────────────────────────────────────────────────
  //  Regla de Maxi: nada puede quedar esperando a que alguien se acuerde de
  //  apretar un botón. El trabajador no va a cerrar la jornada al irse, pero el
  //  GPS ya sabe que se fue: si se aleja más de 150 m del domicilio y no vuelve
  //  en 15 minutos, se le pregunta. Si contesta, la jornada se cierra con la
  //  hora REAL (mucho mejor que el tope de 10 h del cierre automático).
  const lejosDesde = useRef(null);
  const yaPregunto = useRef(false);

  const detectarQueSeFue = (lat, lng) => {
    if (!isWorker || yaPregunto.current) return;
    const enObra = false;
    if (!enObra && job.status !== 'in_progress') return;

    const R = 6371000;
    const dLat = (lat - job.client_lat) * Math.PI / 180;
    const dLng = (lng - job.client_lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(job.client_lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const metros = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (metros < 150) { lejosDesde.current = null; return; }   // volvió: falsa alarma
    if (!lejosDesde.current) { lejosDesde.current = Date.now(); return; }
    if (Date.now() - lejosDesde.current < 15 * 60 * 1000) return;

    yaPregunto.current = true;
    Alert.alert(
      '¿Terminaste por hoy?',
      'Vimos que ya no estás en el domicilio. Si terminaste, cerramos la jornada con la hora de ahora.',
      [
        { text: 'No, sigo', onPress: () => { yaPregunto.current = false; lejosDesde.current = null; } },
        { text: 'Sí, terminé', onPress: () => cerrarJornadaAhora() },
      ],
      { cancelable: false }
    );
  };

  const cerrarJornadaAhora = async () => {
    // Solo corre cuando el profesional tocó "Sí, terminé" en el diálogo: acá se
    // ejecuta lo que la persona ya confirmó. (Estuvo dentro de un `if (false)`
    // y el botón no hacía NADA: la app preguntaba y después mentía por omisión.)
    try {
      await jobService.endSession(job.id, job.current_session_start,
                                  job.completed_sessions || 0, job.total_minutes_worked || 0);
      setJob(j => ({ ...j, current_session_start: null,
                     completed_sessions: (j.completed_sessions || 0) + 1, status: 'arrived' }));
      // El cliente tiene que enterarse SIN abrir la app: si ve al profesional
      // irse y nadie le dice nada, piensa que le dejaron el trabajo tirado.
      const faltan = Math.max(0, (job.estimated_sessions || 0) - ((job.completed_sessions || 0) + 1));
      const texto = faltan > 0
        ? `${workerFirstName} terminó por hoy y vuelve para seguir. Falta${faltan > 1 ? 'n' : ''} ${faltan} jornada${faltan > 1 ? 's' : ''}.`
        : `${workerFirstName} terminó la jornada de hoy.`;
      chatService.sendSystemMessage(job.id, texto).catch(() => {});
      notificationService.sendToUser(clientId, {
        title: 'Jornada terminada',
        body: texto,
        data: { jobId: job.id, screen: 'tracking' },
      }).catch(() => {});
    } catch (e) {
      Alert.alert('No se pudo cerrar', e?.message || 'Probá desde el botón de la pantalla.');
    }
  };

  const handleWorkerAction = async (action) => {
    setLoading(true);
    if (isDemoMode()) {
      setTimeout(() => {
        setLoading(false);
        if (action === 'on_the_way') {
          setJob(j => ({ ...j, on_the_way_at: new Date().toISOString(),
                         verification_code: String(Math.floor(Math.random() * 10000)).padStart(4, '0'),
                         viajes: (j.viajes || 0) + 1, status: 'accepted' }));
        } else if (action === 'llegue_y_empiezo') {
          setJob(j => ({ ...j, status: 'in_progress', on_the_way_at: null,
                         arrived_at: new Date().toISOString(),
                         work_started_at: new Date().toISOString() }));
        } else if (action === 'arrive') {
          setJob(j => ({ ...j, status: 'arrived', arrived_at: new Date().toISOString(), on_the_way_at: null }));
        } else if (action === 'start') {
          setJob(j => ({ ...j, status: 'in_progress', work_started_at: new Date().toISOString() }));
        } else if (action === 'set_amount') {
          const labor = parseInt((workAmount || '').replace(/\D/g, ''), 10) || 22000;
          if (!chargesInApp()) {
            // MODO GRATIS: el trabajo se finaliza directo, el pago lo coordinan ellos.
            setJob(j => ({ ...j, status: 'completed', work_amount: labor, completed_at: new Date().toISOString() }));
          } else {
            setJob(j => ({ ...j, status: 'awaiting_payment', work_amount: labor }));
            // Simulamos que el cliente paga a los pocos segundos
            setTimeout(() => setJob(j => ({ ...j, status: 'completed', completed_at: new Date().toISOString() })), 2800);
          }
        } else if (action === 'finish') {
          setJob(j => ({ ...j, status: 'completed', completed_at: new Date().toISOString() }));
        }
      }, 500);
      return;
    }
    try {
      let notifTitle = '', notifBody = '';

      if (action === 'on_the_way') {
        // Una sola acción hace las tres cosas: abre la ventana de ubicación,
        // genera un código NUEVO y le avisa al cliente. El evento en job_events
        // lo escribe la propia función de la base (migración 054).
        const { codigo, viaje } = await jobService.salirAlDomicilio(job.id);
        setJob(j => ({ ...j, on_the_way_at: new Date().toISOString(),
                       verification_code: codigo, viajes: viaje,
                       status: 'accepted', sub_status: null }));
        chatService.sendSystemMessage(job.id,
          `${workerFirstName} salió para tu domicilio 🚗`).catch(() => {});
        notifTitle = '🚗 Va en camino';
        notifBody  = viaje > 1
          ? `${workerFirstName} volvió a salir para tu domicilio. Pedile el código nuevo cuando llegue.`
          : `${workerFirstName} salió para tu domicilio. Cuando llegue, pedile el código.`;
      } else if (action === 'llegue_y_empiezo') {
        // Las dos cosas de una. `arrive` cierra la ventana de ubicación —deja
        // de compartir dónde está— y `start` arranca el reloj del trabajo.
        await jobService.arrive(job.id);
        await jobService.start(job.id);
        setJob(j => ({ ...j, status: 'in_progress', on_the_way_at: null,
                       arrived_at: new Date().toISOString(),
                       work_started_at: new Date().toISOString() }));
        jobService.addEvent(job.id, 'arrived', `Llegó a tu domicilio 🔑`).catch(() => {});
        jobService.addEvent(job.id, 'work_started', `Comenzó el trabajo 🔧`).catch(() => {});
        chatService.sendSystemMessage(job.id, volt.chatArrived(workerFirstName)).catch(() => {});
        notifTitle = '⚡ Llegó y arrancó';
        notifBody  = `${workerFirstName} está en tu domicilio y empezó el trabajo.`;
      } else if (action === 'arrive') {
        await jobService.arrive(job.id);
        jobService.addEvent(job.id, 'arrived', `Llegó a tu domicilio. Pedile el código 🔑`).catch(() => {});
        chatService.sendSystemMessage(job.id, volt.chatArrived(workerFirstName)).catch(() => {});
        notifTitle = '⚡ ESTÁ POR LLEGAR UN BOLT';
        notifBody  = 'POR FAVOR RECORDÁ PEDIRLE EL CÓDIGO PARA ASEGURARTE QUE ES UN TRABAJADOR VERIFICADO.';
      } else if (action === 'start') {
        await jobService.start(job.id);
        jobService.addEvent(job.id, 'work_started', `Comenzó el trabajo 🔧`).catch(() => {});
        chatService.sendSystemMessage(job.id, volt.chatStarted).catch(() => {});
        notifTitle = '🔧 Trabajo iniciado';
        notifBody  = 'El profesional comenzó el trabajo.';
      } else if (action === 'set_amount') {
        // Si el precio ya fue acordado al llegar (work_price_status accepted), usamos
        // ese monto; si no, el que el trabajador escriba en el input.
        const labor = parseInt((workAmount || String(job.work_amount || '')).replace(/\D/g, ''), 10);
        if (!labor || labor < 1000) {
          Alert.alert('Revisá el monto', 'Ingresá el costo de la mano de obra (sin visita ni materiales).');
          setLoading(false);
          return;
        }
        const mats      = 0; // materiales se pagan aparte, fuera del cobro de la app
        chatService.sendSystemMessage(job.id, volt.chatDone).catch(() => {});

        if (!chargesInApp()) {
          // MODO GRATIS: el pago es directo cliente↔profesional. Se registra el
          // monto SIN pasar por awaiting_payment (esa transición a completed la
          // bloquea el trigger de la base: es exclusiva del webhook de pagos) y
          // el trabajo se completa directo.
          await jobService.recordWorkAmount(job.id, labor, mats);
          await jobService.complete(job.id);
          jobService.addEvent(job.id, 'work_done', `Trabajo finalizado ✅`).catch(() => {});
          notifTitle = '✅ Trabajo finalizado';
          notifBody  = `${workerFirstName} terminó el trabajo. Coordiná el pago directamente con el profesional. ¡No te olvides de calificarlo! ⭐`;
        } else {
          // MODO COMISIÓN: se cobra por la app → awaiting_payment
          await jobService.setWorkAmount(job.id, labor, mats);
          const visitPaid = !!job.visit_paid;
          const visitAmt  = job.visit_amount ?? 30000;
          jobService.addEvent(job.id, 'work_done', `Trabajo completado ✅`).catch(() => {});
          const totalAPagar = (visitPaid ? 0 : visitAmt) + mats + labor;
          notifTitle = '💳 Trabajo listo — hora de pagar';
          if (visitPaid) {
            notifBody = `Mano de obra $${labor.toLocaleString('es-AR')} (visita ya pagada). Abrí la app para pagar.`;
          } else {
            notifBody = `Visita $${visitAmt.toLocaleString('es-AR')} + Trabajo $${labor.toLocaleString('es-AR')} = $${totalAPagar.toLocaleString('es-AR')}. Abrí la app para pagar.`;
          }
        }
      } else if (action === 'finish') {
        // MODO GRATIS: finalizar el trabajo directo, el pago lo coordinan ellos.
        const rf = await conTiempo(jobService.complete(job.id), 10000, null);
        if (!rf) throw new Error('La conexión no respondió a tiempo. Fijate tu señal y probá de nuevo.');
        jobService.addEvent(job.id, 'work_done', `El profesional finalizó el trabajo.`).catch(() => {});
        notifTitle = '✅ Trabajo finalizado';
        notifBody  = `${workerFirstName} terminó el trabajo. Coordiná el pago directamente con él. ¡No te olvides de calificarlo! ⭐`;
      }

      if (notifTitle) {
        await notificationService.sendToUser(clientId, { title: notifTitle, body: notifBody, data: { jobId: job.id, screen: 'tracking' } });
      }
    } catch (e) {
      Alert.alert('Error', 'No se pudo actualizar el estado: ' + (e?.message || JSON.stringify(e)));
    } finally {
      setLoading(false);
    }
  };

  // Finalizar el trabajo — disponible para AMBOS (cliente o trabajador), así si uno
  // no lo cierra, el otro puede. El pago/precio lo coordinan aparte.
  //
  // 🔴 Confirmación obligatoria (auditoría 23-ago): la fila "Ya terminé este
  //    trabajo" está pegada a "Tengo un problema"; un roce mandaba "Trabajo
  //    finalizado" al cliente por algo que ni empezó, y no hay vuelta atrás (el
  //    trigger de la 025 prohíbe cancelar un completed). Ahora se pregunta antes.
  const handleFinishJob = () => {
    Alert.alert(
      '¿Terminaste el trabajo?',
      'Se le avisa a la otra parte que quedó finalizado. No se puede deshacer.',
      [
        { text: 'No, todavía no', style: 'cancel' },
        { text: 'Sí, terminé', style: 'default', onPress: finalizarTrabajo },
      ]
    );
  };

  const finalizarTrabajo = async () => {
    setLoading(true);
    try {
      if (!isDemoMode()) {
        // 🔴 Con tope de tiempo (auditoría 23-ago): en Android un fetch colgado
        //    dejaba "Finalizar" cargando para siempre en la pantalla que cierra
        //    el trabajo. conTiempo devuelve null al vencer.
        const r = await conTiempo(jobService.complete(job.id), 10000, null);
        if (!r) throw new Error('La conexión no respondió a tiempo. Fijate tu señal y probá de nuevo.');
        jobService.addEvent(job.id, 'work_done', 'Trabajo finalizado ✅').catch(() => {});
        const otherUserId = isWorker ? clientId : job.professionals?.user_id;
        if (otherUserId) {
          notificationService.sendToUser(otherUserId, {
            title: '✅ Trabajo finalizado',
            body: 'El trabajo se marcó como finalizado. ¡No te olvides de calificar! ⭐',
            data: { jobId: job.id, screen: 'tracking' },
          }).catch(() => {});
        }
      }
      setJob(j => ({ ...j, status: 'completed', completed_at: new Date().toISOString() }));
    } catch (e) {
      // El catch mudo escondía la causa: sin el mensaje real no hay forma de
      // saber si fue RLS, un trigger o la red (31-jul-2026).
      Alert.alert('Error', 'No se pudo finalizar el trabajo: ' + (e?.message || e?.error_description || JSON.stringify(e)));
    } finally {
      setLoading(false);
    }
  };

  const handleClientPay = async () => {
    // En demo no hay cobro real: simulamos el pago aprobado y cerramos el flujo.
    if (isDemoMode()) {
      setLoading(true);
      setTimeout(() => { setLoading(false); onComplete?.(job); }, 700);
      return;
    }
    setLoading(true);
    try {
      const result = await paymentService.pay({ jobId: job.id });
      if (result === 'success') {
        // Marcar el trabajo como pagado/completado en la base. Con pago real el
        // webhook de MP también lo hace; con el bypass de testing es la única vía.
        // Sin esto, el trabajador (que mira la base por polling) queda colgado en
        // "esperando que el cliente pague".
        await jobService.complete(job.id).catch(() => {});
        try {
          const { data: prof } = await supabase
            .from('professionals')
            .select('user_id')
            .eq('id', job.professional_id)
            .maybeSingle();
          if (prof?.user_id) {
            await notificationService.sendToUser(prof.user_id, {
              title: '💰 ¡Pago recibido!',
              body:  'El cliente completó el pago. ¡Excelente trabajo! Ya podés tomar nuevos pedidos.',
              data:  { jobId: job.id },
            });
          }
        } catch {}
        onComplete(job);
      } else if (result === 'failure') {
        Alert.alert('Pago rechazado', 'El pago no fue procesado.\n\nPodés intentar con otra tarjeta de débito, crédito o billetera digital (Naranja X, Ualá, etc.).');
      } else if (result === 'pending') {
        Alert.alert('Procesando pago', 'Tu pago está siendo verificado. Te avisaremos cuando se confirme.');
      } else {
        Alert.alert('Pago cancelado', 'Cerraste el pago sin completarlo. El profesional sigue esperando.\n\nPodés volver a intentarlo cuando quieras.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo iniciar el pago. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    const awaitingPayment = job.status === 'awaiting_payment';
    // Cancelar antes de que arranque no es lo mismo que cortar algo que ya está
    // pasando. Se avisa lo que corresponde en vez de un texto único.
    const enMarcha = ['arrived', 'in_progress'].includes(job.status);
    Alert.alert(
      awaitingPayment ? '¿Cancelar el cobro?' : '¿Cancelar trabajo?',
      awaitingPayment
        ? 'El trabajo ya fue realizado. Al cancelar no habrá cobro por esta visita.'
        : enMarcha
          ? (isWorker
              ? 'El trabajo ya está en marcha. Al cancelarlo se le avisa al cliente y no vas a poder cobrar por la app.'
              : 'El trabajo ya está en marcha. Al cancelarlo se le avisa al profesional.\n\nSi ya terminó, arreglá el pago con él directamente.')
          : 'Esta acción no se puede deshacer.',
      [
        { text: 'No, volver', style: 'cancel' },
        { text: 'Sí, cancelar', style: 'destructive', onPress: async () => {
          selfCancelledRef.current = true;
          setLoading(true);
          try {
            await jobService.cancel(job.id, userId);
            // 🔴 El diálogo PROMETE "se le avisa" — y no se avisaba a nadie:
            // la otra punta se enteraba solo si tenía la app abierta. Sin
            // await: un push colgado no puede frenar la salida.
            const otro = isWorker ? job.client_id : job.professionals?.user_id;
            // 🔴 Retirar un presupuesto (el job sigue en un quote_group) NO es
            //    cancelar el trabajo: al cliente le siguen esperando otras
            //    propuestas. Antes le llegaba "El profesional canceló el trabajo"
            //    y sonaba a que se quedó sin nada (auditoría 23-ago).
            const esRetiroPresupuesto = isWorker && !!job.quote_group_id;
            notificationService.sendToUser(otro, {
              title: esRetiroPresupuesto
                ? 'Un profesional retiró su propuesta'
                : (isWorker ? 'El profesional canceló el trabajo' : 'El cliente canceló el trabajo'),
              body:  esRetiroPresupuesto
                ? 'Todavía tenés otras propuestas para elegir en la app.'
                : (isWorker
                    ? 'Podés pedir otro profesional desde la app cuando quieras.'
                    : 'Quedaste libre para nuevos trabajos.'),
              data:  { jobId: job.id },
            }).catch(() => {});
            onCancel();
          } catch (e) {
            // 🔴 Antes salía al home IGUAL aunque el servidor rechazara el cancel
            //    (trigger, red): te mostraba "cancelado" con el trabajo todavía
            //    vivo, y el profesional podía seguir viajando (auditoría 23-ago).
            //    Ahora se dice la verdad y NO se sale: el trabajo sigue activo.
            selfCancelledRef.current = false;
            setLoading(false);
            Alert.alert(
              'No se pudo cancelar',
              `${e?.message || 'Probá de nuevo'}.\n\nEl trabajo sigue activo — fijate tu conexión e intentá otra vez.`
            );
          }
        }},
      ]
    );
  };

  // El profesional propone el precio de la mano de obra (al llegar, antes de empezar)
  const handleProposePrice = async () => {
    const amount = parseInt((workAmount || '').replace(/\D/g, ''), 10);
    if (!amount || amount < 1000) {
      Alert.alert('Revisá el monto', 'Ingresá el precio de la mano de obra (sin contar la visita ni los materiales).');
      return;
    }
    setLoading(true);
    try {
      await jobService.proposeWorkPrice(job.id, amount);
      setJob(j => ({ ...j, work_amount: amount, work_price_status: 'proposed' }));
      setPricePropModal(false);
      jobService.addEvent(job.id, 'price_proposed', `${workerFirstName} propuso $${amount.toLocaleString('es-AR')} por la mano de obra.`).catch(() => {});
      notificationService.sendToUser(job.client_id, {
        title: '💰 Precio del trabajo',
        body:  `El profesional propone $${amount.toLocaleString('es-AR')} por la mano de obra. Aceptalo en la app para que empiece.`,
        data:  { jobId: job.id, screen: 'tracking' },
      }).catch(() => {});
    } catch {
      Alert.alert('Error', 'No se pudo enviar el precio. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // El cliente acepta o rechaza el precio propuesto. Al aceptar, arranca el trabajo.
  const handleRespondPrice = async (accepted) => {
    setLoading(true);
    try {
      await jobService.respondWorkPrice(job.id, accepted);
      setJob(j => ({
        ...j,
        work_price_status: accepted ? 'accepted' : 'rejected',
        ...(accepted ? { status: 'in_progress', work_started_at: new Date().toISOString() } : {}),
      }));
      jobService.addEvent(
        job.id,
        accepted ? 'price_accepted' : 'price_rejected',
        accepted ? `Aceptaste el precio. ${workerFirstName} comenzó el trabajo.` : 'El cliente rechazó el precio propuesto.'
      ).catch(() => {});
      notificationService.sendToUser(job.professionals?.user_id, {
        title: accepted ? '✅ Precio aceptado' : '❌ Precio rechazado',
        body:  accepted ? 'El cliente aceptó. Comenzá el trabajo.' : 'El cliente rechazó el precio. Proponé otro o conversalo.',
        data:  { jobId: job.id, screen: 'tracking' },
      }).catch(() => {});
    } catch {
      Alert.alert('Error', 'No se pudo registrar tu respuesta. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleVisitPay = async () => {
    // En demo, simulamos el pago de la visita (sin MP real).
    if (isDemoMode()) {
      setVisitPayModal(false);
      setJob(j => ({ ...j, visit_paid: true }));
      return;
    }
    setLoading(true);
    try {
      const result = await paymentService.pay({ jobId: job.id, visitOnly: true });
      if (result === 'success') {
        // visit_paid lo confirma el webhook de MP server-side (la app no puede
        // escribirlo). Acá solo actualizamos la UI; el realtime trae el dato real.
        setJob(j => ({ ...j, visit_paid: true }));
        setVisitPayModal(false);
        setTimeout(() => jobService.getById(job.id).then(j => j && setJob(j)).catch(() => {}), 5000);
      } else if (result === 'failure') {
        Alert.alert('Pago rechazado', 'No se pudo cobrar la visita. Intentá con otra tarjeta.');
      } else {
        Alert.alert('Pago pendiente', 'El profesional te está esperando. Pagá la visita para que pueda comenzar.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo iniciar el pago. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // ── #2 Cliente confirma el plan multi-día ──────────────────────────────────
  // ── #3 Materiales: el profesional propone estimación ───────────────────────
  const handleProposeMaterials = async () => {
    const est = parseInt(materialsEst.replace(/\D/g, ''), 10);
    if (!est || est < 100) { Alert.alert('Revisá el monto', 'Ingresá un costo estimado de los materiales.'); return; }
    setLoading(true);
    try {
      const detail = materialsDetail.trim() || 'materiales';
      await jobService.proposeMaterials(job.id, est, detail);
      chatService.sendSystemMessage(job.id, volt.chatMaterialsEstimate(workerFirstName, detail, est)).catch(() => {});
      await notificationService.sendToUser(clientId, {
        title: '🧰 Materiales para tu trabajo',
        body: `El profesional necesita materiales (~$${est.toLocaleString('es-AR')}). Aprobá en la app.`,
        data: { jobId: job.id, screen: 'tracking' },
      }).catch(() => {});
      setMaterialsEstModal(false); setMaterialsEst(''); setMaterialsDetail('');
    } catch { Alert.alert('Error', 'No se pudo enviar la propuesta de materiales.'); }
    finally { setLoading(false); }
  };

  // ── #3 Cliente aprueba: 'pro' (lo compra el profesional) | 'client' (lo consigue el cliente) ──
  const handleApproveMaterials = async (mode) => {
    setLoading(true);
    try {
      await jobService.approveMaterials(job.id, mode);
      const msg = mode === 'client'
        ? volt.chatMaterialsClientBuys
        : volt.chatMaterialsProBuys(workerFirstName);
      chatService.sendSystemMessage(job.id, msg).catch(() => {});
      if (proUserId) {
        notificationService.sendToUser(proUserId, {
          title: '🧰 Materiales',
          body: msg,
          data: { jobId: job.id, screen: 'tracking' },
        }).catch(() => {});
      }
    } catch { Alert.alert('Error', 'No se pudo registrar tu respuesta.'); }
    finally { setLoading(false); }
  };

  // Cargar tarjetas guardadas del cliente cuando el trabajo está por pagarse
  useEffect(() => {
    if (isWorker || isDemoMode() || job.status !== 'awaiting_payment') return;
    cardService.list().then(setSavedCards).catch(() => {});
  }, [job.status]);

  // Cobro con tarjeta guardada (el token se generó con el CVV en el WebView de MP)
  const handleCardPayToken = async ({ token }) => {
    const card = payCard;
    setPayCard(null);
    if (!token || !card) return;
    setLoading(true);
    try {
      const r = await cardService.payJob(job.id, token, card.payment_method_id);
      if (r.status === 'approved') Alert.alert('✅ Pago aprobado', 'Listo, el pago se acreditó.');
      else Alert.alert('Pago no aprobado', 'No se pudo aprobar el pago con esa tarjeta. Probá con otra.');
    } catch {
      Alert.alert('Error', 'No se pudo procesar el pago.');
    } finally { setLoading(false); }
  };

  const handleFavoriteToggle = async () => {
    if (favLoading || !job.professional_id) return;
    setFavLoading(true);
    try {
      const nowFav = await favoriteService.toggle(userId, job.professional_id);
      setIsFav(nowFav);
    } catch {}
    finally { setFavLoading(false); }
  };

  const handleSaveSummary = async () => {
    if (!summaryObs.trim() && !summarySolution.trim()) {
      Alert.alert('Completá el resumen', 'Describí al menos qué fue el problema y cómo lo resolviste.');
      return;
    }
    if (isDemoMode()) { setSummaryModal(false); return; } // en demo no se guarda en el backend
    try {
      await jobService.setWorkSummary(job.id, {
        observations: summaryObs.trim() || null,
        solution:     summarySolution.trim() || null,
        materials:    summaryMats.trim() || null,
        warranty:     summaryWarranty.trim() || null,
        saved_at:     new Date().toISOString(),
      });
      setSummaryModal(false);
    } catch {
      Alert.alert('Error', 'No se pudo guardar el resumen.');
    }
  };

  const handleEmergency = () => {
    Alert.alert('🚨 Emergencia', '¿Querés llamar al 911?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Llamar al 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  const handleVerifyCode = () => {
    if (enteredCode === job.verification_code) {
      setCodeResult('ok');
    } else {
      setCodeResult('error');
    }
  };

  const handleReportIssue = async (issueText) => {
    setProblemModal(false);
    const okMsg = () => Alert.alert(
      'Problema reportado',
      `Registramos tu reporte:\n"${issueText}"\n\nNuestro equipo te contactará pronto. Si estás en peligro, llamá al 911 ahora mismo.`,
      [{ text: 'OK' }]
    );
    if (isDemoMode()) { okMsg(); return; }
    // 🔴 Esperar la respuesta antes de afirmar "registramos" (auditoría 23-ago):
    //    antes se mostraba el cartel de éxito pase lo que pase, aunque el reporte
    //    no hubiera entrado.
    const { error } = await supabase.functions.invoke('report-problem', {
      body: { jobId: job.id, issue: issueText, role: isWorker ? 'worker' : 'client' },
    }).catch((e) => ({ error: e }));
    if (error) {
      Alert.alert(
        'No pudimos registrar el reporte',
        'Probá de nuevo en un momento. Si es urgente, escribinos a soporte@bolt.com.ar. Si estás en peligro, llamá al 911 ahora mismo.',
        [{ text: 'OK' }]
      );
      return;
    }
    okMsg();
  };

  // 🔴 'accepted' NO quiere decir "va en camino": el 90% de las veces se acepta
  //    y se coordina para más tarde u otro día. Mientras `on_the_way_at` esté
  //    vacío nadie salió, y decir "El profesional está en camino" es mentirle al
  //    cliente — que además ve justo abajo "vas a poder seguirlo cuando salga"
  //    (Maxi, 8-ago-2026). El mismo arreglo ya estaba hecho en PanelTrabajos y
  //    en el panel del trabajador; faltaba acá.
  const statusInfo = (() => {
    const base = STATUS_INFO[job.status] || STATUS_INFO.pending;
    if (job.status !== 'accepted' || enCamino) return base;
    if (job.quote_group_id) {
      return { icon: 'hourglass-outline', color: '#888', label: 'Esperando que elijas' };
    }
    return {
      icon:  'checkmark-circle-outline',
      color: '#FFD600',
      label: job.scheduled_for ? `Confirmado · va ${cuandoVa(job.scheduled_for)}` : 'Confirmado — todavía no salió',
    };
  })();
  const tip = isWorker ? WORKER_TIPS[job.status] : CLIENT_TIPS[job.status];

  // Cuánto ganó el trabajador. En modo gratis no hay comisión → se queda con el 100%.
  const jobCommission = chargesInApp() ? (job.commission_pct || 20) : 0;
  const jobEarned = Math.round((job.work_amount || 0) * (1 - jobCommission / 100)) + (job.materials_cost || 0);
  // (proUserId ya está declarado arriba, junto al cálculo del rol.)

  // Dos números, no uno: hasta dónde está cumplido y cuál está pasando AHORA.
  // Cuando llegó, "En camino" ya se cumplió pero "Trabajando" todavía no empezó:
  // con un solo número había que mentir en alguno de los dos (y era justo la
  // contradicción que se veía en pantalla).
  const { doneUpTo, activeStep } = (() => {
    switch (job.status) {
      // El paso "En camino" se enciende cuando alguien salió de verdad
      // (on_the_way_at), no al aceptar.
      case 'accepted':    return enCamino ? { doneUpTo: 1, activeStep: 2 } : { doneUpTo: 0, activeStep: 1 };
      case 'arrived':     return { doneUpTo: 2, activeStep: null };
      case 'in_progress': return { doneUpTo: 2, activeStep: 3 };
      case 'awaiting_payment': return { doneUpTo: 3, activeStep: 4 };
      case 'completed':   return { doneUpTo: 4, activeStep: null };
      default:            return { doneUpTo: 0, activeStep: 1 };
    }
  })();

  const fmtAgo = (minutes) => {
    if (minutes < 1) return 'Ahora mismo';
    if (minutes === 1) return 'Hace 1 minuto';
    if (minutes < 60) return `Hace ${minutes} min`;
    const h = Math.floor(minutes / 60);
    return h === 1 ? 'Hace 1 hora' : `Hace ${h} hs`;
  };

  const fmtTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2,'0')}min`;
    if (m > 0) return `${m}min ${s.toString().padStart(2,'0')}s`;
    return `${s}s`;
  };

  // 🔴 9-ago-2026 — se fue el multi-día. Había sesiones por jornada, "terminar
  //    por hoy · vuelvo mañana", contador de días y minutos trabajados: un reloj
  //    de fichaje para gente que no es empleada de nadie. Un trabajo se toma una
  //    vez y se cierra una vez, dure una hora o cinco días.
  //    Las banderas quedan en false para los trabajos viejos que se marcaron
  //    multi-día: se comportan como cualquier otro y se pueden finalizar.
  const isMultiday = false;
  const inSession  = false;

  // La gente se anota como "maximiliano fraggetta" y así se veía en pantalla.
  // Capitalizar es la diferencia entre una ficha y un campo de base de datos.
  const capitalizar = (s) => (s || '')
    .split(' ')
    .filter(Boolean)
    .map(p => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');

  const professionalName = job.professionals
    ? capitalizar(`${job.professionals.first_name || ''} ${job.professionals.last_name || ''}`.trim()) || 'Profesional'
    : 'Profesional asignado';

  // Abre el domicilio en la app de mapas del teléfono. En Android el esquema
  // `geo:` deja elegir entre Maps, Waze o la que tenga puesta; en iOS no existe,
  // así que se cae a la URL de Google Maps, que abre la app si está instalada.
  const abrirEnMapas = () => {
    const lat = job.client_lat, lng = job.client_lng;
    if (!lat || !lng) return;
    const etiqueta = encodeURIComponent(job.address || 'Domicilio del cliente');
    const url = Platform.OS === 'android'
      ? `geo:${lat},${lng}?q=${lat},${lng}(${etiqueta})`
      : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => {});
    });
  };

  // Los id son uuid: los últimos 4 caracteres alcanzan para que el cliente y
  // soporte hablen del mismo pedido sin leer 36 caracteres por teléfono.
  const nroPedido = String(job.id || '').replace(/-/g, '').slice(-4).toUpperCase() || '—';

  const proInitials = (job.professionals
    ? `${job.professionals.first_name?.[0] || ''}${job.professionals.last_name?.[0] || ''}`
    : '').toUpperCase() || '⚡';

  // El bloque grande de la hoja. Una sola pregunta contestada en grande, y abajo
  // el detalle. Cambia con el estado real, no con el nominal: mientras nadie
  // salió NO dice "llega en", dice cuándo va.
  //
  // Cliente y trabajador miran cosas distintas: uno quiere saber cuánto falta,
  // el otro adónde tiene que ir y qué le toca hacer ahora.
  const heroInfo = (() => {
    const destino = job.address ? `a ${job.address}` : 'a tu domicilio';

    if (isWorker) {
      const dir = job.address || 'Ver ubicación en el mapa';
      if (job.status === 'pending')  return { label: 'Sin confirmar', value: dir, sub: 'El cliente todavía no confirmó el trabajo.' };
      if (job.status === 'arrived')  return { label: 'Estás en', value: dir, sub: 'Mostrale el código antes de que te abra. Es obligatorio.' };
      if (job.status === 'in_progress') {
        return { label: 'Trabajo en curso', value: dir, sub: 'Cuando termines, tocá "Finalizar trabajo".' };
      }
      if (job.status === 'awaiting_payment') {
        return { label: 'Esperando el pago', value: `$${(job.work_amount || 0).toLocaleString('es-AR')}`, sub: 'Te avisamos apenas entre.' };
      }
      if (job.quote_group_id) {
        // "Esperando que elijas" es lo que lee el CLIENTE. Al profesional le
        // toca la otra mitad de la frase (Maxi, 9-ago-2026).
        return {
          label: 'Presupuesto enviado',
          value: 'Esperando que te elijan',
          sub: `${dir} · el cliente está comparando. Te avisamos si te elige.`,
        };
      }
      if (enCamino) return { label: 'Vas camino a', value: dir, sub: 'El cliente te está viendo en el mapa. Al llegar, tocá "Llegué".' };
      return {
        label: 'Tenés que ir a',
        value: dir,
        sub: job.scheduled_for
          ? `Quedaron ${cuandoVa(job.scheduled_for)}. Cuando salgas, tocá "Voy en camino".`
          : 'Cuando salgas, tocá "Voy en camino" y el cliente te sigue en el mapa.',
      };
    }

    if (job.status === 'arrived') {
      return { label: 'Ya llegó', value: `${workerFirstName} está en la puerta`, sub: 'Pedile el código antes de abrirle. Es obligatorio.' };
    }
    if (job.status === 'in_progress') {
      return { label: 'Trabajo en curso', value: `${workerFirstName} está trabajando`, sub: job.address || 'En tu domicilio' };
    }
    if (job.status === 'awaiting_payment') {
      return { label: 'Trabajo terminado', value: isFreeMode() ? 'Falta confirmar' : 'Listo para pagar', sub: 'Revisá el detalle acá abajo.' };
    }
    if (enCamino) {
      return {
        label: 'Llega en',
        value: job.arrival_estimate || 'unos minutos',
        tail:  job.arrival_estimate ? 'aprox.' : '',
        sub:   `Va camino ${destino} · ${fmtAgo(timeSinceUpdate).toLowerCase()}`,
      };
    }
    if (job.quote_group_id) {
      return { label: 'Presupuesto enviado', value: 'Esperando que elijas', sub: 'Cuando lo elijas, coordinan el día por el chat.' };
    }
    return {
      label: 'Cuándo va',
      value: job.scheduled_for ? cuandoVa(job.scheduled_for) : 'A coordinar',
      sub:   job.scheduled_for
        ? `${workerFirstName} confirmó el trabajo. Te avisamos apenas salga y lo seguís en el mapa.`
        : `${workerFirstName} confirmó el trabajo. Coordinen el día por el chat 👇`,
    };
  })();

  const mapHtml = `
<!DOCTYPE html><html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>*{margin:0;padding:0}#map{width:100vw;height:100vh;background:#1a1a1a}</style>
</head>
<body>
<div id="map"></div>
<script>
const map = L.map('map',{zoomControl:false,attributionControl:false})
  .setView([${job.client_lat || -38.71}, ${job.client_lng || -62.26}], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
const clientIcon = L.divIcon({html:'<div style="width:16px;height:16px;border-radius:50%;background:#FFD600;border:3px solid #0D0D0D;box-shadow:0 0 0 4px rgba(255,214,0,0.18)"></div>',iconSize:[16,16],iconAnchor:[8,8],className:''});
const workerIcon = L.divIcon({html:'<div style="width:36px;height:36px;border-radius:18px;background:#FFD600;border:3px solid #0D0D0D;display:flex;align-items:center;justify-content:center;font-size:17px">⚡</div>',iconSize:[36,36],iconAnchor:[18,18],className:''});
${(job.client_lat && job.client_lng)
  ? `L.marker([${job.client_lat}, ${job.client_lng}],{icon:clientIcon}).addTo(map);`
  : '/* sin coordenadas del domicilio: mapa sin pin, mejor que un pin mentiroso */'}
let workerMarker = null;
// En Android react-native-webview entrega los mensajes en document, no en
// window: escuchando sólo window, el marcador ⚡ del profesional nunca se movía.
// Mismo doble listener que VoltMap.js (auditoría 23-ago).
document.addEventListener('message', onMsg);
window.addEventListener('message', onMsg);
function onMsg(e){
  try {
    const msg = JSON.parse(e.data);
    if(msg.type==='WORKER_MOVE'){
      if(workerMarker) workerMarker.setLatLng([msg.lat,msg.lng]);
      else workerMarker = L.marker([msg.lat,msg.lng],{icon:workerIcon}).addTo(map);
      map.fitBounds(L.latLngBounds([msg.lat,msg.lng],[${job.client_lat || -38.71}, ${job.client_lng || -62.26}]),{padding:[60,60],maxZoom:16});
    }
    // El mapa ya no se desmonta al llegar (antes se iba entero y con él el
    // marcador). Sin esto quedaría un punto fantasma en la última posición.
    if(msg.type==='WORKER_CLEAR' && workerMarker){
      map.removeLayer(workerMarker); workerMarker = null;
      map.setView([${job.client_lat || -38.71}, ${job.client_lng || -62.26}], 15);
    }
  } catch {}
}
</script>
</body></html>`;

  // ─────────────────────────────────────────────────────────────────────────
  //  EL PROFESIONAL TOMÓ EL TRABAJO: mismo criterio que del lado del cliente.
  //
  //  🔴 10-ago-2026 — le quedaban "Iniciar trabajo", el mapa y "Finalizar":
  //  los mismos botones que nadie toca. Si BOLT no controla a nadie, tampoco
  //  puede pedirle al profesional que fiche. Ve lo que necesita para ir a
  //  trabajar —a quién, dónde, cómo llegar, su código— y nada más.
  //
  //  Queda UN botón para cerrar, y es opcional a propósito: el que quiera
  //  ordenarse lo usa, y el que no, el trabajo se cierra igual cuando el
  //  cliente conteste el mensaje o por el cierre automático.
  // ─────────────────────────────────────────────────────────────────────────
  if (isWorker && ['accepted', 'arrived', 'in_progress'].includes(job.status) && !job.quote_group_id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver al inicio">
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerEyebrow} numberOfLines={1}>Pedido #{nroPedido}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>{job.professions?.name || 'Trabajo'}</Text>
          </View>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Más opciones">
            <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.entregaScroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.headerEyebrow, { marginTop: 8 }]}>Tenés que ir a</Text>
          <Text style={styles.entregaTitulo}>{job.address || 'Ver ubicación'}</Text>
          <Text style={styles.entregaSub}>
            Arreglá con el cliente el día y la hora que les quede bien a los dos.
          </Text>

          {!!(job.client_lat && job.client_lng) && (
            <TouchableOpacity style={[styles.entregaBtn, styles.entregaBtnPrimario]} onPress={abrirEnMapas}
              accessibilityRole="button" accessibilityLabel="Cómo llegar al domicilio">
              <Ionicons name="navigate" size={19} color="#0D0D0D" />
              <Text style={styles.entregaBtnPrimarioText}>Cómo llegar</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.entregaBtn, styles.entregaBtnSec]} onPress={() => setShowChat(true)}
            accessibilityRole="button" accessibilityLabel="Escribirle al cliente">
            <Ionicons name="chatbubble-ellipses-outline" size={19} color="#FFFFFF" />
            <Text style={styles.entregaBtnSecText}>
              {unreadCount > 0 ? `Leer los mensajes (${unreadCount})` : 'Escribirle al cliente'}
            </Text>
          </TouchableOpacity>

          {!!job.verification_code && (
            <View style={styles.entregaCodigo}>
              <Text style={styles.entregaCodigoLabel}>Tu código de verificación</Text>
              <Text style={styles.entregaCodigoNum}>{job.verification_code}</Text>
              <Text style={styles.entregaCodigoHint}>
                Mostráselo al cliente antes de que te abra. Es lo que prueba que sos vos.
              </Text>
            </View>
          )}

          {!!job.notes && (
            <View style={styles.entregaAviso}>
              <Ionicons name="chatbubble-outline" size={19} color="#8A8A8A" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.entregaAvisoTitulo}>Lo que pidió</Text>
                <Text style={styles.entregaAvisoTexto}>{job.notes}</Text>
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.entregaFila} onPress={handleFinishJob} disabled={loading}>
            <Ionicons name="checkmark-done" size={19} color="#8A8A8A" />
            <Text style={styles.entregaFilaText}>
              {loading ? 'Cerrando…' : 'Ya terminé este trabajo'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#5C5C5C" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.entregaFila} onPress={() => setProblemModal(true)}>
            <Ionicons name="help-circle-outline" size={19} color="#8A8A8A" />
            <Text style={styles.entregaFilaText}>Tengo un problema</Text>
            <Ionicons name="chevron-forward" size={16} color="#5C5C5C" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
            <TouchableOpacity style={styles.menuBox} activeOpacity={1} onPress={() => {}}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setProblemModal(true); }}>
                <Ionicons name="alert-circle-outline" size={19} color="#FFFFFF" />
                <Text style={styles.menuItemText}>Tengo un problema</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleCancel(); }}>
                <Ionicons name="close-circle-outline" size={19} color="#FFFFFF" />
                <Text style={styles.menuItemText}>Cancelar este trabajo</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleEmergency(); }}>
                <Ionicons name="call" size={19} color="#E5484D" />
                <Text style={[styles.menuItemText, { color: '#E5484D' }]}>Emergencia · llamar al 911</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <Modal visible={problemModal} transparent animationType="slide" onRequestClose={() => setProblemModal(false)}>
          <TouchableOpacity style={[styles.problemOverlay, padBarra]} activeOpacity={1} onPress={() => setProblemModal(false)}>
            <TouchableOpacity style={styles.problemBox} activeOpacity={1} onPress={() => {}}>
              <View style={styles.problemHeader}>
                <Text style={styles.problemTitle}>¿Cuál es el problema?</Text>
                <TouchableOpacity onPress={() => setProblemModal(false)}>
                  <Ionicons name="close" size={22} color="#5C5C5C" />
                </TouchableOpacity>
              </View>
              {getProblemIssues(true, job.status).map(issue => (
                <TouchableOpacity key={issue.text} style={styles.problemItem} onPress={() => handleReportIssue(issue.text)}>
                  <Ionicons name={issue.icon} size={17} color="#8A8A8A" />
                  <Text style={styles.problemItemText}>{issue.text}</Text>
                  <Ionicons name="chevron-forward" size={15} color="#3a3a3a" />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.emergencyRow} onPress={() => { setProblemModal(false); handleEmergency(); }}>
                <Ionicons name="call" size={18} color="#E5484D" />
                <Text style={styles.emergencyRowText}>Estoy en peligro · llamar al 911</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {showChat && (
          <Modal visible animationType="slide" onRequestClose={() => setShowChat(false)}>
            <ChatScreen
              job={job}
              userId={userId}
              isWorker
              onClose={() => { setShowChat(false); setUnreadCount(0); if (!isDemoMode()) chatService.markAsRead(job.id, userId).catch(() => {}); }}
            />
          </Modal>
        )}
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  EL CLIENTE YA ELIGIÓ: se entrega el contacto y la app se corre al costado.
  //
  //  🔴 10-ago-2026 — el cambio más grande del producto. Antes de acá el cliente
  //  entraba a una pantalla de seguimiento que dependía de que el profesional
  //  marcara "salí", "llegué", "empecé", "terminé". Los números de las pruebas
  //  fueron claros: el botón que hay que tocar ANTES de llegar se usó 3 veces
  //  sobre 87. Y el motivo de fondo no es que se olviden: a un electricista
  //  matriculado no lo seguís por GPS, y a un pintor que va cinco días a una
  //  casa no le pedís que fiche entrada y salida. No son empleados de nadie
  //  (Maxi, 9-ago-2026).
  //
  //  Entonces BOLT hace lo que sabe hacer —pasarle un cliente a un profesional
  //  verificado— y se corre. Lo que queda es lo que no se puede delegar: el
  //  código de la puerta, y que después preguntamos cómo fue.
  // ─────────────────────────────────────────────────────────────────────────
  if (!isWorker && job.status === 'accepted' && !job.quote_group_id) {
    const tel = (job.professionals?.phone || '').replace(/\D/g, '');
    const abrirWhatsApp = () => {
      if (!tel) return;
      const texto = encodeURIComponent(
        `Hola ${workerFirstName}! Te escribo por BOLT, por el pedido de ${job.professions?.name?.toLowerCase() || 'trabajo'} en ${job.address || 'mi domicilio'}.`
      );
      // wa.me toma el número con característica y sin signos. Si el teléfono
      // vino sin el 549 de Argentina, se lo agregamos: sin eso no abre el chat.
      const numero = tel.startsWith('54') ? tel : `549${tel.replace(/^0/, '')}`;
      Linking.openURL(`https://wa.me/${numero}?text=${texto}`).catch(() => {});
    };

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver al inicio">
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerEyebrow} numberOfLines={1}>Pedido #{nroPedido}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>{job.professions?.name || 'Servicio a domicilio'}</Text>
          </View>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Más opciones">
            <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.entregaScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.entregaTick}>
            <Ionicons name="checkmark" size={28} color="#FFD600" />
          </View>

          <Text style={styles.entregaTitulo}>
            Listo. Ahora hablás{'\n'}con <Text style={styles.displayEm}>{workerFirstName}</Text>
          </Text>
          <Text style={styles.entregaSub}>
            Le avisamos que lo elegiste. Escribile y arreglen el día y la hora que a vos te queden bien.
          </Text>

          <View style={styles.proCard}>
            {job.professionals?.avatar_url
              ? <Image source={{ uri: job.professionals.avatar_url }} style={styles.proAvatarImg} />
              : <View style={styles.proAvatar}><Text style={styles.proAvatarText}>{proInitials}</Text></View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.proName} numberOfLines={1}>{professionalName}</Text>
              <View style={styles.proMetaRow}>
                {job.professionals?.avg_rating ? (
                  <>
                    <Ionicons name="star" size={13} color="#FFD600" />
                    <Text style={styles.proMeta}>
                      {Number(job.professionals.avg_rating).toFixed(1).replace('.', ',')}
                    </Text>
                  </>
                ) : <Text style={styles.proMeta}>Nuevo en BOLT</Text>}
                {job.professionals?.completed_jobs > 0 && (
                  <Text style={styles.proMeta}>· {job.professionals.completed_jobs} trabajos</Text>
                )}
                <Text style={styles.proMeta}>· Verificado</Text>
              </View>
            </View>
          </View>

          {!!tel && (
            <TouchableOpacity style={[styles.entregaBtn, styles.entregaBtnPrimario]} onPress={abrirWhatsApp}
              accessibilityRole="button" accessibilityLabel={`Escribirle a ${workerFirstName} por WhatsApp`}>
              <Ionicons name="logo-whatsapp" size={20} color="#0D0D0D" />
              <Text style={styles.entregaBtnPrimarioText}>Escribirle por WhatsApp</Text>
            </TouchableOpacity>
          )}

          {!!tel && (
            <TouchableOpacity style={[styles.entregaBtn, styles.entregaBtnSec]} onPress={() => Linking.openURL(`tel:${tel}`)}
              accessibilityRole="button" accessibilityLabel={`Llamar a ${workerFirstName}`}>
              <Ionicons name="call" size={19} color="#FFFFFF" />
              <Text style={styles.entregaBtnSecText}>Llamarlo</Text>
            </TouchableOpacity>
          )}

          {/* Sin teléfono cargado no hay a dónde mandarlo: queda el chat. */}
          <TouchableOpacity style={[styles.entregaBtn, styles.entregaBtnSec]} onPress={() => setShowChat(true)}
            accessibilityRole="button" accessibilityLabel="Escribirle por el chat de BOLT">
            <Ionicons name="chatbubble-ellipses-outline" size={19} color="#FFFFFF" />
            <Text style={styles.entregaBtnSecText}>
              {unreadCount > 0 ? `Leer (${unreadCount})` : 'Escribirle por acá'}
            </Text>
          </TouchableOpacity>

          {!!job.verification_code && (
            <View style={styles.entregaCodigo}>
              <Text style={styles.entregaCodigoLabel}>Tu código de seguridad</Text>
              <Text style={styles.entregaCodigoNum}>{job.verification_code}</Text>
              <Text style={styles.entregaCodigoHint}>
                Pediselo cuando toque el timbre. Si el que te dice no coincide, no es de BOLT.
              </Text>
            </View>
          )}

          <View style={styles.entregaAviso}>
            <Ionicons name="logo-whatsapp" size={19} color="#FFD600" style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.entregaAvisoTitulo}>Te escribimos para saber cómo te fue</Text>
              <Text style={styles.entregaAvisoTexto}>
                En un par de días te mandamos un mensaje por WhatsApp. Con eso cuidamos que los
                profesionales de BOLT sean los que tienen que estar.
              </Text>
            </View>
          </View>

          <TouchableOpacity style={styles.entregaFila} onPress={() => setProblemModal(true)}>
            <Ionicons name="help-circle-outline" size={19} color="#8A8A8A" />
            <Text style={styles.entregaFilaText}>Tengo un problema</Text>
            <Ionicons name="chevron-forward" size={16} color="#5C5C5C" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.entregaFila} onPress={onBack}>
            <Ionicons name="add" size={19} color="#8A8A8A" />
            <Text style={styles.entregaFilaText}>Pedir otro oficio</Text>
            <Ionicons name="chevron-forward" size={16} color="#5C5C5C" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </ScrollView>

        {/* El menú y los modales que esta pantalla usa. */}
        <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
            <TouchableOpacity style={styles.menuBox} activeOpacity={1} onPress={() => {}}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setProblemModal(true); }}>
                <Ionicons name="alert-circle-outline" size={19} color="#FFFFFF" />
                <Text style={styles.menuItemText}>Tengo un problema</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleCancel(); }}>
                <Ionicons name="close-circle-outline" size={19} color="#FFFFFF" />
                <Text style={styles.menuItemText}>Cancelar el pedido</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleEmergency(); }}>
                <Ionicons name="call" size={19} color="#E5484D" />
                <Text style={[styles.menuItemText, { color: '#E5484D' }]}>Emergencia · llamar al 911</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <Modal visible={problemModal} transparent animationType="slide" onRequestClose={() => setProblemModal(false)}>
          <TouchableOpacity style={[styles.problemOverlay, padBarra]} activeOpacity={1} onPress={() => setProblemModal(false)}>
            <TouchableOpacity style={styles.problemBox} activeOpacity={1} onPress={() => {}}>
              <View style={styles.problemHeader}>
                <Text style={styles.problemTitle}>¿Cuál es el problema?</Text>
                <TouchableOpacity onPress={() => setProblemModal(false)}>
                  <Ionicons name="close" size={22} color="#5C5C5C" />
                </TouchableOpacity>
              </View>
              {getProblemIssues(false, job.status).map(issue => (
                <TouchableOpacity key={issue.text} style={styles.problemItem} onPress={() => handleReportIssue(issue.text)}>
                  <Ionicons name={issue.icon} size={17} color="#8A8A8A" />
                  <Text style={styles.problemItemText}>{issue.text}</Text>
                  <Ionicons name="chevron-forward" size={15} color="#3a3a3a" />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.emergencyRow} onPress={() => { setProblemModal(false); handleEmergency(); }}>
                <Ionicons name="call" size={18} color="#E5484D" />
                <Text style={styles.emergencyRowText}>Estoy en peligro · llamar al 911</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {showChat && (
          <Modal visible animationType="slide" onRequestClose={() => setShowChat(false)}>
            <ChatScreen
              job={job}
              userId={userId}
              isWorker={false}
              onClose={() => { setShowChat(false); setUnreadCount(0); if (!isDemoMode()) chatService.markAsRead(job.id, userId).catch(() => {}); }}
            />
          </Modal>
        )}
      </SafeAreaView>
    );
  }

  // Trabajador que envió presupuesto y el cliente todavía no lo eligió:
  // queda en espera (sin controles ni "viaje") hasta ser confirmado o descartado.
  //
  // 🔴 10-ago-2026 — acá decía `['pending', 'accepted']`, y un pedido en
  //    `pending` NO es un presupuesto enviado: es uno que todavía no contestó.
  //    Si por cualquier camino caía en esta pantalla con un pedido sin
  //    responder, leía "Presupuesto enviado · el cliente está comparando" por un
  //    presupuesto que nunca mandó, y quedaba colgado ahí: el pedido seguía
  //    vivo pero desde acá no se podía aceptar (Maxi, le pasó cuatro veces
  //    seguidas). Sólo `accepted`.
  if (isWorker && job.quote_group_id && job.status === 'accepted') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <ActivityIndicator size="large" color="#FFD600" />
        <Text style={{ color: '#F5F5F5', fontSize: 22, fontWeight: '700', marginTop: 24, textAlign: 'center' }}>
          Presupuesto enviado
        </Text>
        <Text style={{ color: '#888', fontSize: 16, textAlign: 'center', marginTop: 12, lineHeight: 22 }}>
          El cliente está comparando propuestas. Si te elige, te avisamos al instante y ahí arrancás el viaje.
          {'\n\n'}Todavía no salgas hacia la dirección.
        </Text>
        <TouchableOpacity
          onPress={onBack}
          style={{ marginTop: 34, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 14, backgroundColor: '#FFD600' }}
          activeOpacity={0.85}
        >
          <Text style={{ color: '#0D0D0D', fontWeight: '600', fontSize: 16 }}>Seguir usando la app</Text>
        </TouchableOpacity>
        <Text style={{ color: '#666', fontSize: 14, textAlign: 'center', marginTop: 12, paddingHorizontal: 20 }}>
          Podés cerrar esta pantalla tranquilo. Te avisamos por notificación cuando el cliente responda.
        </Text>
        <TouchableOpacity
          onPress={handleCancel}
          style={{ marginTop: 20, paddingVertical: 10, paddingHorizontal: 28 }}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#E5484D', fontWeight: '700', fontSize: 14 }}>Retirar mi presupuesto</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Modal: Pago de visita (cliente, auto al llegar el trabajador) */}
      <Modal visible={visitPayModal} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={[styles.modalOverlay, padBarra]}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Ionicons name="home-outline" size={28} color="#FFD600" />
              <Text style={styles.modalTitle}>El profesional llegó</Text>
            </View>
            <Text style={styles.modalSub}>
              Para que pueda comenzar el trabajo, necesitás abonar la visita. Este monto se descuenta del total al finalizar.
            </Text>
            <View style={styles.visitModalAmount}>
              <Text style={styles.visitModalAmountLabel}>Visita / diagnóstico</Text>
              <Text style={styles.visitModalAmountValue}>${(job.visit_amount ?? 30000).toLocaleString('es-AR')}</Text>
            </View>
            <View style={styles.cardOnlyBadge}>
              <Ionicons name="card-outline" size={14} color="#FFD600" />
              <Text style={styles.cardOnlyText}>Tarjeta de débito, crédito o billetera digital</Text>
            </View>
            <TouchableOpacity style={styles.payBtn} onPress={handleVisitPay} disabled={loading} accessibilityRole="button" accessibilityLabel="Pagar la visita">
              {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                <><Ionicons name="card" size={18} color="#0D0D0D" /><Text style={styles.payBtnText}>Pagar visita ${(job.visit_amount ?? 30000).toLocaleString('es-AR')}</Text></>
              )}
            </TouchableOpacity>
            {isDemoMode() && (
              <TouchableOpacity style={styles.testPayBtn} disabled={loading} onPress={() => {
                setJob(j => ({ ...j, visit_paid: true }));
                setVisitPayModal(false);
              }}>
                <Ionicons name="flask-outline" size={14} color="#888" />
                <Text style={styles.testPayBtnText}>Simular pago de visita (demo)</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal: proponer materiales (#3 — trabajador) */}
      <Modal visible={materialsEstModal} transparent animationType="slide" onRequestClose={() => setMaterialsEstModal(false)}>
        <KeyboardAvoidingView style={[styles.modalOverlay, padBarra]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Ionicons name="cart-outline" size={26} color="#8A8A8A" />
              <Text style={styles.modalTitle}>Materiales necesarios</Text>
            </View>
            <Text style={styles.modalSub}>
              Indicá qué necesitás y cuánto estimás. El cliente lo aprueba antes de que compres, y después subís el comprobante.
            </Text>
            <View style={{ width: '100%', gap: 10, marginVertical: 8 }}>
              <View style={styles.amountInputWrap}>
                <Ionicons name="construct-outline" size={18} color="#8A8A8A" />
                <TextInput
                  style={styles.amountInput}
                  placeholder="Qué materiales (ej: disyuntor 16A)"
                  placeholderTextColor="#444"
                  value={materialsDetail}
                  onChangeText={setMaterialsDetail}
                />
              </View>
              <View style={styles.amountInputWrap}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Costo estimado"
                  placeholderTextColor="#444"
                  value={materialsEst}
                  onChangeText={v => setMaterialsEst(v.replace(/\D/g, ''))}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <TouchableOpacity style={styles.actionBtn} onPress={handleProposeMaterials} disabled={loading}>
              {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                <><Ionicons name="send" size={18} color="#0D0D0D" /><Text style={styles.actionBtnText}>Enviar al cliente</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setMaterialsEstModal(false)}>
              <Text style={{ color: '#555', fontSize: 16, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pago con tarjeta guardada — pide CVV y tokeniza en el WebView de MP */}
      {payCard && (
        <MPCardForm
          visible
          mode="cvv"
          cardId={payCard.id}
          brand={`${payCard.brand} •••• ${payCard.last_four}`}
          onClose={() => setPayCard(null)}
          onToken={handleCardPayToken}
        />
      )}

      {/* Modal de disponibilidad post-trabajo (trabajador) */}
      {/* El Atrás del sistema cierra igual que "Ahora mismo": antes no hacía
          nada y las 4 filas eran la única salida, con el trabajo colgado hasta
          que tocara una. Salir dejándolo disponible es el lado seguro — el
          otro deja el radar apagado sin que se entere. */}
      <Modal visible={completedModal} transparent animationType="slide" onRequestClose={() => handleAvailabilityAndComplete(0)}>
        <View style={[styles.completedOverlay, padBarra]}>
          {/* La hoja entera scrollea: con el recuadro de VOLT y la frase de la
              calificación en dos líneas, en un celular chico las 4 filas de
              horario se iban abajo del borde. */}
          <View style={styles.completedBox}>
           <ScrollView
             style={styles.completedScroll}
             contentContainerStyle={styles.completedScrollBody}
             showsVerticalScrollIndicator={false}
             bounces={false}
             keyboardShouldPersistTaps="handled"
           >
            <Ionicons name="checkmark-circle" size={52} color="#FFD600" />
            {/* En modo gratuito no hay ningún pago por la app: decir "pago
                recibido" es prometer algo que no pasó. */}
            <Text style={styles.completedTitle}>
              {chargesInApp() ? '¡Pago recibido!' : '¡Trabajo terminado!'}
            </Text>
            {jobEarned > 0 && (
              <View style={styles.completedVolt}>
                <Text style={styles.completedVoltText}>⚡ {volt.coachPostJob(jobEarned, jobCommission)}</Text>
              </View>
            )}
            {/* Calificación del CLIENTE (migración 043). Es opcional a
                propósito: si no toca ninguna estrella, sigue de largo y no
                se guarda nada. Nada puede quedar trabado esperando esto. */}
            <Text style={styles.completedSub}>¿Cómo fue el cliente?</Text>
            <View style={styles.clientStarsRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setClientStars(n)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Calificar al cliente con ${n} estrella${n > 1 ? 's' : ''}`}
                >
                  <Ionicons
                    name={n <= clientStars ? 'star' : 'star-outline'}
                    size={30}
                    color={n <= clientStars ? '#FFD600' : '#444'}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.clientStarsHint}>
              {clientStars === 0
                ? 'Opcional. Lo ven los otros profesionales antes de aceptarle un trabajo.'
                : CLIENT_STAR_LABELS[clientStars]}
            </Text>

            <Text style={styles.completedSub}>¿Cuándo volvés a estar disponible para nuevos pedidos?</Text>
            {[
              { label: 'Ahora mismo',  icon: 'flash',        hours: 0 },
              { label: 'En 1 hora',    icon: 'time-outline', hours: 1 },
              { label: 'En 2 horas',   icon: 'time-outline', hours: 2 },
              { label: 'En 3 horas',   icon: 'time-outline', hours: 3 },
            ].map(opt => (
              <TouchableOpacity
                key={opt.label}
                style={styles.completedOpt}
                onPress={() => handleAvailabilityAndComplete(opt.hours)}
                activeOpacity={0.8}
                disabled={completing !== null}
              >
                <Ionicons name={opt.icon} size={18} color="#FFD600" />
                <Text style={styles.completedOptText}>{opt.label}</Text>
                {completing === opt.hours
                  ? <ActivityIndicator size="small" color="#FFD600" />
                  : <Ionicons name="chevron-forward" size={16} color="#444" />}
              </TouchableOpacity>
            ))}
           </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal de verificación de código (cliente) */}
      {/* Modal: el profesional propone el precio del trabajo */}
      <Modal visible={pricePropModal} transparent animationType="slide" onRequestClose={() => setPricePropModal(false)}>
        <KeyboardAvoidingView style={[styles.modalOverlay, padBarra]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Ionicons name="pricetag" size={26} color="#FFD600" />
              <Text style={styles.modalTitle}>Precio del trabajo</Text>
            </View>
            <Text style={styles.modalSub}>
              Ya viste el trabajo de cerca. Poné el precio de la mano de obra. El cliente lo acepta antes de que empieces. La visita ya está paga aparte; los materiales se acuerdan por separado.
            </Text>
            <View style={[styles.amountInputWrap, { marginTop: 16 }]}>
              <Text style={styles.currency}>$</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="Mano de obra"
                placeholderTextColor="#444"
                value={workAmount}
                onChangeText={v => setWorkAmount(v.replace(/\D/g, ''))}
                keyboardType="numeric"
              />
            </View>
            <TouchableOpacity style={[styles.actionBtn, { marginTop: 16 }]} onPress={handleProposePrice} disabled={loading}>
              {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                <><Ionicons name="send" size={18} color="#0D0D0D" /><Text style={styles.actionBtnText}>Enviar precio al cliente</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 14, alignItems: 'center' }} onPress={() => setPricePropModal(false)} disabled={loading}>
              <Text style={{ color: '#888', fontSize: 16 }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={codeModal} transparent animationType="slide" onRequestClose={() => { setCodeModal(false); setEnteredCode(''); setCodeResult(null); }}>
        <KeyboardAvoidingView style={[styles.modalOverlay, padBarra]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Ionicons name="shield-checkmark" size={28} color="#FFD600" />
              <Text style={styles.modalTitle}>Verificar identidad</Text>
            </View>
            <Text style={styles.modalSub}>
              Pedile al profesional el código de 4 dígitos que aparece en su teléfono e ingresalo acá.
            </Text>

            {codeResult === null && (
              <>
                <TextInput
                  style={styles.codeInput}
                  placeholder="1234"
                  placeholderTextColor="#333"
                  value={enteredCode}
                  onChangeText={v => setEnteredCode(v.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="numeric"
                  maxLength={4}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.codeVerifyBtn, enteredCode.length !== 4 && { opacity: 0.4 }]}
                  onPress={handleVerifyCode}
                  disabled={enteredCode.length !== 4}
                >
                  <Text style={styles.codeVerifyBtnText}>Verificar</Text>
                </TouchableOpacity>
              </>
            )}

            {codeResult === 'ok' && (
              <View style={styles.codeOkBox}>
                <Ionicons name="checkmark-circle" size={40} color="#FFD600" />
                <Text style={styles.codeOkTitle}>¡Código correcto!</Text>
                <Text style={styles.codeOkSub}>Es tu profesional de BOLT: el código coincide. Ya podés abrir la puerta.</Text>
                <TouchableOpacity style={styles.codeCloseBtn} onPress={() => { setCodeModal(false); setEnteredCode(''); setCodeResult(null); }}>
                  <Text style={styles.codeCloseBtnText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            )}

            {codeResult === 'error' && (
              <View style={styles.codeErrorBox}>
                <Ionicons name="close-circle" size={40} color="#E5484D" />
                <Text style={styles.codeErrorTitle}>Código incorrecto</Text>
                <Text style={styles.codeErrorSub}>No abras la puerta. Contactá al soporte de BOLT si el problema continúa.</Text>
                <TouchableOpacity style={styles.codeRetryBtn} onPress={() => { setEnteredCode(''); setCodeResult(null); }}>
                  <Text style={styles.codeRetryBtnText}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal TENGO UN PROBLEMA */}
      <Modal visible={problemModal} transparent animationType="slide" onRequestClose={() => setProblemModal(false)}>
        <TouchableOpacity style={[styles.problemOverlay, padBarra]} activeOpacity={1} onPress={() => setProblemModal(false)}>
          <TouchableOpacity style={styles.problemBox} activeOpacity={1} onPress={() => {}}>
            <View style={styles.problemHeader}>
              <Text style={styles.problemTitle}>¿Cuál es el problema?</Text>
              <TouchableOpacity onPress={() => setProblemModal(false)}>
                <Ionicons name="close" size={22} color="#5C5C5C" />
              </TouchableOpacity>
            </View>
            {getProblemIssues(isWorker, job.status).map(issue => (
              <TouchableOpacity key={issue.text} style={styles.problemItem} onPress={() => handleReportIssue(issue.text)}>
                <Ionicons name={issue.icon} size={17} color="#8A8A8A" />
                <Text style={styles.problemItemText}>{issue.text}</Text>
                <Ionicons name="chevron-forward" size={15} color="#3a3a3a" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.supportBtn} onPress={() => {
              setProblemModal(false);
              Linking.openURL('https://wa.me/5492914199938?text=Hola%2C%20necesito%20soporte%20con%20un%20trabajo%20BOLT');
            }}>
              <Ionicons name="logo-whatsapp" size={18} color="#8A8A8A" />
              <Text style={styles.supportBtnText}>Contactar soporte BOLT</Text>
            </TouchableOpacity>
            {/* Lo urgente vive acá, al final y en rojo — el único rojo de toda
                la pantalla. Antes era un botón permanente en el header, más
                grande que el nombre del profesional. */}
            <TouchableOpacity style={styles.emergencyRow} onPress={() => { setProblemModal(false); handleEmergency(); }}>
              <Ionicons name="call" size={18} color="#E5484D" />
              <Text style={styles.emergencyRowText}>Estoy en peligro · llamar al 911</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Chat overlay */}
      {showChat && (
        <Modal visible animationType="slide" onRequestClose={() => setShowChat(false)}>
          <ChatScreen
            job={job}
            userId={userId}
            isWorker={isWorker}
            onClose={() => { setShowChat(false); setUnreadCount(0); if (!isDemoMode()) chatService.markAsRead(job.id, userId).catch(() => {}); }}
          />
        </Modal>
      )}

      {/* Modal: Resumen del trabajo (trabajador antes de cobrar) */}
      <Modal visible={summaryModal} transparent animationType="slide" onRequestClose={() => setSummaryModal(false)}>
        <KeyboardAvoidingView style={[styles.modalOverlay, padBarra]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={[styles.modalBox, { maxHeight: '90%' }]} contentContainerStyle={{ gap: 14, paddingBottom: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Ionicons name="clipboard" size={26} color="#FFD600" />
              <Text style={styles.modalTitle}>Resumen del trabajo</Text>
              <TouchableOpacity onPress={() => setSummaryModal(false)}>
                <Ionicons name="close" size={22} color="#555" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>El cliente lo verá junto al recibo del pago.</Text>
            {[
              { label: 'Descripción del problema', ph: 'Ej: Disyuntor quemado por sobrecarga...', val: summaryObs, set: setSummaryObs },
              { label: 'Solución aplicada', ph: 'Ej: Reemplacé el disyuntor, rearmé el tablero...', val: summarySolution, set: setSummarySolution },
              { label: 'Materiales usados (opcional)', ph: 'Ej: 1 disyuntor 16A, cable 2.5mm...', val: summaryMats, set: setSummaryMats },
              { label: 'Garantía (opcional)', ph: 'Ej: 30 días por mano de obra', val: summaryWarranty, set: setSummaryWarranty },
            ].map(f => (
              <View key={f.label}>
                <Text style={styles.summaryFieldLabel}>{f.label}</Text>
                <TextInput
                  style={[styles.amountInput, { minHeight: 60, paddingTop: 10, textAlignVertical: 'top', backgroundColor: '#0D0D0D', borderRadius: 14, color: '#F5F5F5', padding: 14, fontSize: 16 }]}
                  placeholder={f.ph}
                  placeholderTextColor="#333"
                  value={f.val}
                  onChangeText={f.set}
                  multiline
                  maxLength={400}
                />
              </View>
            ))}
            {/* 🔴 Este botón era verde y con letra blanca; el barrido de color lo
                dejó amarillo pero la letra siguió en blanco: amarillo con blanco
                encima no se lee (Maxi). Sobre amarillo va negro, como todos los
                botones principales de la app. */}
            <TouchableOpacity style={styles.actionBtn} onPress={handleSaveSummary}>
              <Ionicons name="checkmark" size={18} color="#0D0D0D" />
              <Text style={styles.actionBtnText}>Guardar resumen</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* El mapa es el diferencial: va arriba de todo, a sangre, y el header se
          apoya encima. Está SIEMPRE — antes desaparecía cuando el profesional no
          iba en camino y en su lugar quedaba un cuadro con un candado que se
          comía media pantalla para no mostrar nada (Maxi, 8-ago-2026). Si
          todavía no hay a quién seguir se ve igual, con el pin del domicilio:
          que su ubicación sólo se comparta yendo en camino (migración 054) no
          cambia — lo que no se dibuja es su marcador, no el mapa.

          El trabajador también lo tiene: es el domicilio al que va, y hasta ahora
          no había ninguna forma de ver dónde queda ni de arrancar el GPS.

          El WebView va en absoluteFill dentro de un View con altura fija: si no,
          a veces no se expande y queda un bloque negro. */}
      <View style={styles.mapWrap}>
        <WebView
          ref={webRef}
          style={StyleSheet.absoluteFill}
          source={{ html: mapHtml }}
          javaScriptEnabled
          scrollEnabled={false}
          originWhitelist={['*']}
        />
        {/* Sombra arriba para que el header se lea sobre cualquier calle. */}
        <View style={styles.mapTopShade} pointerEvents="none" />
        {/* Una línea, no una tarjeta: por qué todavía no hay a quién seguir. */}
        {!isWorker && !enCamino && ['accepted','arrived','in_progress'].includes(job.status) && (
          <View style={styles.mapNote} pointerEvents="none">
            <Ionicons name="lock-closed" size={11} color="#8A8A8A" />
            <Text style={styles.mapNoteText} numberOfLines={1}>
              {job.status === 'accepted'
                ? 'Lo vas a ver acá cuando salga'
                : `${workerFirstName} ya está en tu domicilio`}
            </Text>
          </View>
        )}
        {/* Abrir el domicilio en la app de mapas del teléfono. Es lo primero que
            hace cualquiera al aceptar un trabajo, y hasta ahora lo tenía que
            copiar a mano. */}
        {isWorker && !!(job.client_lat && job.client_lng) && (
          <TouchableOpacity
            style={styles.comoLlegar}
            onPress={() => abrirEnMapas()}
            accessibilityRole="button"
            accessibilityLabel="Abrir el domicilio en la aplicación de mapas"
          >
            <Ionicons name="navigate" size={15} color="#0D0D0D" />
            <Text style={styles.comoLlegarText}>Cómo llegar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Header.
          🔴 8-ago-2026 — el título salía partido letra por letra ("El p / rofes
          / ional"). El Text tenía flex:1, pero en React Native los hermanos NO
          se encogen solos (flexShrink por defecto es 0): entre Cancelar, ♥, chat
          y el 911 se comían la fila entera y al texto le quedaban 40 px, que
          rellenaba rompiendo palabras. Ahora arriba va el pedido y el oficio —el
          estado se dice UNA vez, en el dato grande de la hoja— y lo que gritaba
          (911, cancelar) está en el menú de tres puntos. */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Volver al inicio (el trabajo sigue activo)">
            <Ionicons name="arrow-back" size={22} color="#F5F5F5" />
          </TouchableOpacity>
        )}
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerEyebrow} numberOfLines={1}>Pedido #{nroPedido}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {job.professions?.name || 'Servicio a domicilio'}
          </Text>
        </View>
        {/* Favorito (solo cliente cuando hay profesional asignado) */}
        {!isWorker && job.professional_id && ['accepted','arrived','in_progress','awaiting_payment'].includes(job.status) && (
          <TouchableOpacity onPress={handleFavoriteToggle} style={styles.iconBtn} disabled={favLoading} accessibilityLabel="Guardar como favorito">
            <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={21} color={isFav ? '#F5F5F5' : '#5C5C5C'} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Más opciones">
          <Ionicons name="ellipsis-vertical" size={20} color="#F5F5F5" />
        </TouchableOpacity>
      </View>

      {/* Menú de opciones. Acá adentro va todo lo que antes gritaba desde el
          header: cancelar, reportar un problema y la emergencia. El 911 era lo
          más grande de la pantalla — le gritaba EMERGENCIA a alguien que espera
          un pintor (Maxi, 8-ago-2026). Sigue a dos toques, que para una urgencia
          real alcanza y sobra. */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <TouchableOpacity style={styles.menuBox} activeOpacity={1} onPress={() => {}}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setProblemModal(true); }}>
              <Ionicons name="alert-circle-outline" size={19} color="#F5F5F5" />
              <Text style={styles.menuItemText}>Tengo un problema</Text>
            </TouchableOpacity>
            {['pending', 'accepted', 'arrived', 'in_progress', 'awaiting_payment'].includes(job.status) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleCancel(); }}>
                <Ionicons name="close-circle-outline" size={19} color="#F5F5F5" />
                <Text style={styles.menuItemText}>
                  {isWorker ? 'Cancelar este trabajo' : 'Cancelar el pedido'}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleEmergency(); }}>
              <Ionicons name="call" size={19} color="#E5484D" />
              <Text style={[styles.menuItemText, { color: '#E5484D' }]}>Emergencia · llamar al 911</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Alerta de proximidad */}
      {nearbyAlert && !isWorker && (
        <View style={styles.nearbyAlert}>
          <Ionicons name="locate" size={16} color="#FFD600" />
          <Text style={styles.nearbyAlertText}>Está muy cerca — ya llega</Text>
        </View>
      )}

      {/* Barra de estado. Para el cliente la reemplaza el bloque grande del
          panel (abajo): decía lo mismo en letra de 11 px y repetido dos veces. */}
      {(isWorker || job.status === 'pending') && ['pending','accepted','arrived','in_progress','awaiting_payment'].includes(job.status) && (
        <View style={styles.infoStrip}>
          <View style={styles.infoStripItem}>
            <Text style={styles.infoStripLabel}>ESTADO</Text>
            <View style={styles.infoStripValueRow}>
              <View style={[styles.infoStripDot, { backgroundColor: statusInfo.color }]} />
              <Text style={[styles.infoStripValue, { color: statusInfo.color }]} numberOfLines={1}>
                {statusInfo.label}
              </Text>
            </View>
          </View>
          <View style={styles.infoStripSep} />
          <View style={styles.infoStripItem}>
            <Text style={styles.infoStripLabel}>ACTUALIZACIÓN</Text>
            <Text style={styles.infoStripValue}>{fmtAgo(timeSinceUpdate)}</Text>
          </View>
          {job.status === 'accepted' && job.arrival_estimate && (
            <>
              <View style={styles.infoStripSep} />
              <View style={styles.infoStripItem}>
                <Text style={styles.infoStripLabel}>LLEGA EN</Text>
                <Text style={[styles.infoStripValue, { color: '#FFD600' }]}>{job.arrival_estimate}</Text>
              </View>
            </>
          )}
          {!isWorker && workerDistKm !== null && job.status === 'accepted' && (
            <>
              <View style={styles.infoStripSep} />
              <View style={styles.infoStripItem}>
                <Text style={styles.infoStripLabel}>DISTANCIA</Text>
                <Text style={styles.infoStripValue}>
                  {workerDistKm < 1
                    ? `${Math.round(workerDistKm * 1000)} m`
                    : `${workerDistKm.toFixed(1)} km`}
                </Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* Alerta de inactividad */}
      {inactivityAlert && (
        <View style={styles.inactivityAlert}>
          <Ionicons name="warning-outline" size={14} color="#8A8A8A" />
          <Text style={styles.inactivityAlertText}>
            Sin novedades del profesional. Estamos verificando.
          </Text>
        </View>
      )}

      {/* Panel inferior — la misma hoja para los dos. Arranca tapando la mitad
          de abajo y se sube con el dedo (o tocando el asa). Colapsada muestra lo
          único que importa: al cliente, cuánto falta y a quién llamar; al
          trabajador, adónde va y qué le toca hacer ahora. Subiéndola aparecen
          los pasos y el detalle. */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}
        {...sheetPan.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => moverHoja(!hojaArriba)}
          style={styles.gripZone}
          accessibilityRole="button"
          accessibilityLabel={hojaArriba ? 'Bajar el detalle y ver el mapa' : 'Subir para ver los pasos y el detalle'}
        >
          <View style={styles.grip} />
        </TouchableOpacity>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
        <ScrollView
          ref={panelScrollRef}
          style={[styles.panel, styles.panelClient]}
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={hojaArriba}
          onScroll={e => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
        >

          {/* Cuando el mismo usuario es el cliente Y el profesional (probando el
              circuito con una cuenta sola, o un pedido a uno mismo por error),
              se muestran las acciones del profesional —son las únicas que hacen
              avanzar el trabajo— pero hay que decir por qué se ve así. */}
          {isWorker && userId === clientId && (
            <View style={styles.mismaCuenta}>
              <Ionicons name="information-circle-outline" size={17} color="#8A8A8A" />
              <Text style={styles.mismaCuentaTexto}>
                Este trabajo lo pediste y lo tomaste con la misma cuenta. Te mostramos el lado del
                profesional, que es el que puede avanzarlo.
              </Text>
            </View>
          )}

          {/* ─── Cabecera de la hoja, cliente esperando confirmación ────────
              🔴 13-ago-2026 — la hoja del pending quedó VACÍA en el rediseño:
              sólo "Tengo un problema" y un agujero negro (foto de Maxi probando
              con Esteban). El cliente no veía a quién le llegó el pedido, qué
              estaba pasando ni cómo cancelarlo — el cancelar existía pero
              escondido en el menú de tres puntos. */}
          {!isWorker && job.status === 'pending' && (
            <>
              <View style={styles.proCard}>
                {job.professionals?.avatar_url
                  ? <Image source={{ uri: job.professionals.avatar_url }} style={styles.proAvatarImg} />
                  : <View style={styles.proAvatar}><Text style={styles.proAvatarText}>{proInitials}</Text></View>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.proName} numberOfLines={1}>{professionalName}</Text>
                  <View style={styles.proMetaRow}>
                    <Text style={styles.proMeta} numberOfLines={1}>
                      {job.professions?.name || 'Trabajo a domicilio'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.hero}>
                <Text style={styles.heroLabel}>Tu pedido le llegó a</Text>
                <Text style={styles.heroValue}>{workerFirstName}</Text>
                <Text style={styles.heroSub}>
                  Estás esperando que lo confirme. Te avisamos apenas responda; si no
                  lo puede tomar, buscamos a otro profesional disponible y el pedido
                  nunca te queda colgado.
                </Text>
              </View>

              <TouchableOpacity style={styles.entregaFila} onPress={handleCancel}
                accessibilityRole="button" accessibilityLabel="Cancelar el pedido">
                <Ionicons name="close-circle-outline" size={19} color="#8A8A8A" />
                <Text style={styles.entregaFilaText}>Cancelar el pedido</Text>
                <Ionicons name="chevron-forward" size={16} color="#5C5C5C" style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            </>
          )}

          {/* ─── Cabecera de la hoja, lado trabajador ───────────────────────
              Mismo esqueleto que el del cliente: quién está del otro lado, el
              dato protagonista en 32 px y dos botones. Cambia el contenido, no
              la forma — el cliente quiere saber cuánto falta; el trabajador,
              adónde va. */}
          {isWorker && ['pending','accepted','arrived','in_progress','awaiting_payment'].includes(job.status) && (
            <>
              <View style={styles.proCard}>
                <View style={styles.proAvatar}>
                  <Ionicons name="person" size={22} color="#8A8A8A" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.proName} numberOfLines={1}>Cliente</Text>
                  <View style={styles.proMetaRow}>
                    <Text style={styles.proMeta} numberOfLines={1}>
                      {job.professions?.name || 'Trabajo a domicilio'}
                      {chargesInApp() ? ` · visita $${(job.visit_amount ?? 30000).toLocaleString('es-AR')}` : ''}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.hero}>
                <Text style={styles.heroLabel}>{heroInfo.label}</Text>
                <Text style={styles.heroValue}>{heroInfo.value}</Text>
                <Text style={styles.heroSub}>{heroInfo.sub}</Text>
              </View>

              <View style={styles.proActions}>
                {!!(job.client_lat && job.client_lng) && (
                  <TouchableOpacity
                    style={[styles.proActionBtn, styles.proActionGhost]}
                    onPress={abrirEnMapas}
                    accessibilityRole="button"
                    accessibilityLabel="Cómo llegar al domicilio"
                  >
                    <Ionicons name="navigate-outline" size={17} color="#FFFFFF" />
                    <Text style={styles.proActionGhostText}>Cómo llegar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.proActionBtn, unreadCount > 0 ? styles.proActionNuevo : styles.proActionGhost]}
                  onPress={() => setShowChat(true)}
                  accessibilityRole="button"
                  accessibilityLabel={unreadCount > 0
                    ? `Leer los ${unreadCount} mensajes nuevos del cliente`
                    : 'Escribirle al cliente'}
                >
                  <Ionicons
                    name={unreadCount > 0 ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
                    size={17}
                    color={unreadCount > 0 ? '#FFD600' : '#FFFFFF'}
                  />
                  <Text style={[styles.proActionGhostText, unreadCount > 0 && { color: '#FFD600' }]}>
                    {unreadCount > 0 ? 'Leer' : 'Mensaje'}
                  </Text>
                  {unreadCount > 0 && (
                    <View style={styles.msgBadge}>
                      <Text style={styles.msgBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* 🔴 10-ago-2026 — EL CÓDIGO DEL TRABAJADOR HABÍA DESAPARECIDO.
              Se mostraba sólo con `status === 'arrived'`, y ese estado dejó de
              existir en la práctica cuando "llegué" se fusionó con "empecé": el
              trabajo salta de `accepted` a `in_progress` y el bloque no se
              dibujaba nunca (Maxi: "ahora no aparece el código de verificación").
              Ahora está desde que sale y mientras dura el trabajo, que es
              cuando se necesita: al tocar el timbre. */}
          {isWorker && !!job.verification_code &&
           ['accepted', 'arrived', 'in_progress'].includes(job.status) && (
            <View style={styles.codeDisplay}>
              <Text style={styles.codeDisplayLabel}>Tu código de verificación</Text>
              <Text style={styles.codeDisplayNumber}>{job.verification_code}</Text>
              <Text style={styles.codeDisplayHint}>
                Mostráselo al cliente antes de que te abra. Es lo que prueba que sos vos.
              </Text>
            </View>
          )}

          {/* ─── Acciones del trabajador ─── */}

          {/* 🔴 9-ago-2026 — DE CUATRO BOTONES A TRES, Y UNO MENOS PARA VOLVER.
              Estaba: "voy en camino" → "llegué" → "iniciar" → "finalizar", y si
              ya había ido una vez el primero cambiaba a "vuelvo al domicilio",
              que además de no entenderse estaba mal armado (Maxi). Nadie va a
              tocar cuatro botones para hacer un trabajo: cada toque de más es
              un estado que va a quedar sin marcar y una pantalla que le va a
              mentir al cliente.

              Ahora: salgo → empiezo → termino. "Llegué" se fusionó con
              "empecé", porque si empezaste obviamente llegaste; y el segundo
              viaje ya no pide nada. */}
          {isWorker && job.status === 'accepted' && !enCamino && (job.viajes || 0) === 0 && (
            <>
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('on_the_way')} disabled={loading}>
                {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                  <><Ionicons name="navigate" size={18} color="#0D0D0D" />
                    <Text style={styles.actionBtnText}>Voy en camino</Text></>
                )}
              </TouchableOpacity>
              <Text style={styles.ventanaHint}>
                Al tocarlo le avisamos al cliente y va a poder seguirte en el mapa hasta que llegues.
                Recién ahí ve tu ubicación.
              </Text>
            </>
          )}

          {/* Un solo botón para llegar y arrancar. Por dentro hace las dos
              cosas: cierra la ventana de ubicación y pone el trabajo en curso. */}
          {isWorker && ['accepted', 'arrived'].includes(job.status) && !isMultiday && !job.is_buying_materials && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleWorkerAction('llegue_y_empiezo')} disabled={loading}>
              {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                <><Ionicons name="play" size={18} color="#0D0D0D" />
                  <Text style={styles.actionBtnText}>Llegué, empiezo el trabajo</Text></>
              )}
            </TouchableOpacity>
          )}

          {/* arrived + comprando materiales */}
          {isWorker && job.status === 'arrived' && job.is_buying_materials && (
            <View style={styles.buyingCard}>
              <Ionicons name="cart" size={22} color="#8A8A8A" />
              <Text style={styles.buyingText}>Comprando materiales...</Text>
              <TouchableOpacity style={styles.actionBtn} onPress={() => jobService.returnedWithMaterials(job.id)} disabled={loading}>
                <Ionicons name="checkmark-circle" size={18} color="#0D0D0D" />
                <Text style={styles.actionBtnText}>Volví con los materiales</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* in_progress + single-day: cobrar */}
          {isWorker && job.status === 'in_progress' && !isMultiday && (
            <TouchableOpacity style={styles.summaryBtn} onPress={() => setSummaryModal(true)}>
              <Ionicons name="clipboard-outline" size={16} color="#FFD600" />
              <Text style={styles.summaryBtnText}>Completar resumen del trabajo (opcional)</Text>
              <Ionicons name="chevron-forward" size={14} color="#FFD600" />
            </TouchableOpacity>
          )}
          {job.status === 'in_progress' && !isMultiday && (
            <TouchableOpacity style={styles.actionBtn} onPress={handleFinishJob} disabled={loading}>
              {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                <><Ionicons name="checkmark-done" size={18} color="#0D0D0D" /><Text style={styles.actionBtnText}>Finalizar trabajo</Text></>
              )}
            </TouchableOpacity>
          )}

          {/* Salida para trabajos trabados (estado viejo "esperando pago") — ambos pueden cerrarlo */}
          {!chargesInApp() && job.status === 'awaiting_payment' && (
            <TouchableOpacity style={styles.actionBtn} onPress={handleFinishJob} disabled={loading}>
              {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                <><Ionicons name="checkmark-done" size={18} color="#0D0D0D" /><Text style={styles.actionBtnText}>Finalizar trabajo</Text></>
              )}
            </TouchableOpacity>
          )}

          {/* Trabajador esperando pago (solo en modo comisión) */}
          {isWorker && chargesInApp() && job.status === 'awaiting_payment' && (
            <View style={styles.waitingPayCard}>
              <View style={styles.waitingPayRow}>
                <ActivityIndicator size="small" color="#FFD600" />
                <Text style={styles.waitingPayText}>Esperando que el cliente pague...</Text>
              </View>
              <TouchableOpacity style={styles.cancelJobBtn} onPress={handleCancel} disabled={loading}>
                <Ionicons name="close-circle-outline" size={16} color="#E5484D" />
                <Text style={styles.cancelJobBtnText}>El cliente no quiere pagar — cancelar</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Acción del cliente — confirmar pago final (solo en modo comisión) */}
          {!isWorker && chargesInApp() && job.status === 'awaiting_payment' && (() => {
            const visitAmt  = job.visit_amount   ?? 30000;
            const matsAmt   = job.materials_cost || 0;
            const workAmt   = job.work_amount    || 0;
            const visitPaid = !!job.visit_paid;
            const total     = (visitPaid ? 0 : visitAmt) + matsAmt + workAmt;
            return (
              <View style={styles.paySection}>
                <View style={styles.payBreakdown}>
                  <View style={styles.payRow}>
                    <Text style={styles.payRowLabel}>Visita / diagnóstico</Text>
                    {visitPaid ? (
                      <View style={styles.visitPaidBadge}>
                        <Ionicons name="checkmark-circle" size={13} color="#FFD600" />
                        <Text style={styles.visitPaidText}>Ya pagada</Text>
                      </View>
                    ) : (
                      <Text style={styles.payRowVal}>${visitAmt.toLocaleString('es-AR')}</Text>
                    )}
                  </View>
                  {job.materials_estimate > 0 && job.materials_status !== 'client_provides' && (
                    <View style={styles.payRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.payRowLabel}>Materiales (~${job.materials_estimate.toLocaleString('es-AR')})</Text>
                        <Text style={styles.payRowNote}>se abonan aparte, directo al profesional</Text>
                      </View>
                      <Text style={styles.payRowNote}>aparte</Text>
                    </View>
                  )}
                  <View style={styles.payRow}>
                    <Text style={styles.payRowLabel}>Mano de obra</Text>
                    <Text style={styles.payRowVal}>${workAmt.toLocaleString('es-AR')}</Text>
                  </View>
                  <View style={styles.payDivider} />
                  <View style={styles.payRow}>
                    <Text style={styles.payTotalLabel}>TOTAL A PAGAR</Text>
                    <Text style={styles.payTotalVal}>${total.toLocaleString('es-AR')}</Text>
                  </View>
                </View>
                <View style={styles.cardOnlyBadge}>
                  <Ionicons name="card-outline" size={14} color="#FFD600" />
                  <Text style={styles.cardOnlyText}>Tarjeta de débito, crédito o billetera digital</Text>
                </View>
                {/* Pago en 1 toque con tarjetas guardadas */}
                {savedCards.map(c => (
                  <TouchableOpacity key={c.id} style={styles.savedPayBtn} onPress={() => setPayCard(c)} disabled={loading} activeOpacity={0.85}>
                    <Ionicons name="card" size={18} color="#0D0D0D" />
                    <Text style={styles.savedPayText}>Pagar con {c.brand} •••• {c.last_four}</Text>
                    <Ionicons name="flash" size={15} color="#0D0D0D" />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.payBtn} onPress={handleClientPay} disabled={loading} accessibilityRole="button" accessibilityLabel="Pagar el trabajo completo">
                  {loading ? <ActivityIndicator color="#0D0D0D" /> : (
                    <><Ionicons name="card" size={18} color="#0D0D0D" /><Text style={styles.payBtnText}>{savedCards.length ? 'Pagar con otra tarjeta' : `Pagar $${total.toLocaleString('es-AR')}`}</Text></>
                  )}
                </TouchableOpacity>
                {isDemoMode() && (
                  <TouchableOpacity style={styles.testPayBtn} disabled={loading} onPress={async () => {
                    setLoading(true);
                    try {
                      await jobService.complete(job.id);
                      onComplete(job);
                    } catch { setLoading(false); }
                  }}>
                    <Ionicons name="flask-outline" size={14} color="#888" />
                    <Text style={styles.testPayBtnText}>Simular pago aprobado (demo)</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.payProblemBtn} onPress={() => setProblemModal(true)}>
                  <Ionicons name="warning-outline" size={14} color="#8A8A8A" />
                  <Text style={styles.payProblemText}>¿Algo salió mal? Reportar un problema</Text>
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* Ayuda. Ya no grita: es una línea al pie, del mismo peso que el
              resto. Lo urgente (911) está en el menú del header, a dos toques. */}
          <TouchableOpacity style={styles.problemBtn} onPress={() => setProblemModal(true)}>
            <Ionicons name="help-circle-outline" size={17} color="#8A8A8A" />
            <Text style={styles.problemBtnText}>Tengo un problema</Text>
            <Ionicons name="chevron-forward" size={15} color="#5C5C5C" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>

        </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>

      {/* La burbuja de chat flotante se sacó: los dos tienen el botón "Mensaje"
          a la vista en la hoja, con el contador de no leídos. Dos caminos al
          mismo chat es un camino de más, y la burbuja tapaba contenido. */}
    </SafeAreaView>
  );
};

// ─── Sistema ──────────────────────────────────────────────────────────────────
// Fondo #0D0D0D, superficies #161616, y un solo acento: el amarillo. El rojo
// existe únicamente para la emergencia. Espaciado 8/16/24/32, radio 20 en las
// tarjetas y 999 en pills y botones. Nada de bordes salvo que hagan falta.
const styles = StyleSheet.create({
  // ─── Entrega del contacto (10-ago-2026) ─────────────────────────────────────
  entregaScroll: { paddingHorizontal: 20, paddingBottom: 40 },
  entregaTick: {
    width: 56, height: 56, borderRadius: 999, backgroundColor: 'rgba(255,214,0,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20, marginTop: 8,
  },
  entregaTitulo: { fontSize: 30, lineHeight: 34, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.9, marginBottom: 10 },
  displayEm:     { color: '#FFD600' },
  entregaSub:    { fontSize: 15, color: '#8A8A8A', lineHeight: 22, marginBottom: 24 },

  entregaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 999, paddingVertical: 18, marginBottom: 10,
  },
  entregaBtnPrimario:     { backgroundColor: '#FFD600' },
  entregaBtnPrimarioText: { fontSize: 16, fontWeight: '600', color: '#0D0D0D' },
  entregaBtnSec:          { backgroundColor: '#161616' },
  entregaBtnSecText:      { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },

  entregaCodigo: {
    backgroundColor: '#161616', borderRadius: 20, padding: 20, alignItems: 'center',
    marginTop: 8, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: '#FFD600',
  },
  entregaCodigoLabel: { fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase', color: '#5C5C5C', fontWeight: '600', marginBottom: 8 },
  entregaCodigoNum:   { fontSize: 44, fontWeight: '700', color: '#FFD600', letterSpacing: 10 },
  entregaCodigoHint:  { fontSize: 14, color: '#8A8A8A', textAlign: 'center', marginTop: 10, lineHeight: 20 },

  entregaAviso: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#161616', borderRadius: 20, padding: 16, marginBottom: 12,
  },
  entregaAvisoTitulo: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  entregaAvisoTexto:  { fontSize: 14, color: '#8A8A8A', lineHeight: 20 },

  entregaFila: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 18, borderTopWidth: 1, borderTopColor: '#262626',
  },
  entregaFilaText: { fontSize: 16, color: '#8A8A8A' },

  container: { flex: 1, backgroundColor: '#0D0D0D' },

  // El header se apoya sobre el mapa (que va a sangre, detrás): sin fondo, sin
  // borde y por encima en la pila.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 32 : 8,
    paddingBottom: 16,
    // Por encima de la hoja: aunque esté subida del todo, el header se ve.
    zIndex: 30, elevation: 30,
  },
  iconBtn: { width: 36, height: 36, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  // minWidth:0 + flexShrink:1: sin eso, un texto largo empuja la fila en vez de
  // recortarse, y los botones lo aplastan hasta partirlo por la mitad.
  headerTitleCol: { flex: 1, minWidth: 0, flexShrink: 1, marginLeft: 4 },
  headerEyebrow:  { fontSize: 14, letterSpacing: 1.8, textTransform: 'uppercase', color: '#5C5C5C', fontWeight: '600', marginBottom: 2 },
  headerTitle:    { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  statusDot:      { width: 8, height: 8, borderRadius: 999 },

  // Menú de tres puntos
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', paddingTop: Platform.OS === 'android' ? 72 : 56, paddingRight: 16, alignItems: 'flex-end' },
  menuBox:     { backgroundColor: '#161616', borderRadius: 20, paddingVertical: 8, minWidth: 248 },
  menuItem:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuItemText:{ fontSize: 16, color: '#FFFFFF' },
  menuDivider: { height: 1, backgroundColor: '#262626', marginVertical: 8, marginHorizontal: 16 },

  // ─── Mapa ───────────────────────────────────────────────────────────────────
  // Absoluto y a sangre: arranca en el borde de la pantalla y el header le queda
  // encima. Se dibuja hasta un poco más abajo de donde apoya la hoja, así al
  // arrastrarla no aparece un vacío negro detrás.
  mapWrap: {
    position: 'absolute', left: 0, right: 0, top: 0,
    height: HOJA_ABAJO + 40, backgroundColor: '#0D0D0D',
  },
  mapTopShade: {
    position: 'absolute', left: 0, right: 0, top: 0, height: 120,
    backgroundColor: 'rgba(13,13,13,0.55)',
  },
  mapNote: {
    position: 'absolute', left: 16, bottom: 56,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(13,13,13,0.88)', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, maxWidth: '86%',
  },
  mapNoteText: { fontSize: 14, color: '#8A8A8A', flexShrink: 1 },
  comoLlegar: {
    position: 'absolute', right: 16, bottom: 56,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  comoLlegarText: { fontSize: 16, color: '#0D0D0D', fontWeight: '600' },

  // ─── La hoja ────────────────────────────────────────────────────────────────
  sheet: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: '#0D0D0D',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  gripZone: { paddingTop: 10, paddingBottom: 8, alignItems: 'center' },
  grip:     { width: 36, height: 4, borderRadius: 999, backgroundColor: '#333' },

  hero:           { marginBottom: 24 },
  heroLabel:      { fontSize: 14, letterSpacing: 1.8, textTransform: 'uppercase', color: '#5C5C5C', fontWeight: '600', marginBottom: 8 },
  heroValue:      { fontSize: 32, lineHeight: 37, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.6 },
  heroValueTail:  { fontSize: 32, fontWeight: '700', color: '#FFD600' },
  heroSub:        { fontSize: 16, color: '#8A8A8A', marginTop: 8, lineHeight: 20 },

  proCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    marginBottom: 24,
  },
  proAvatar: {
    width: 56, height: 56, borderRadius: 999, flexShrink: 0,
    backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center',
  },
  proAvatarImg:  { width: 56, height: 56, borderRadius: 999, flexShrink: 0, backgroundColor: '#161616' },
  proAvatarText: { fontSize: 18, fontWeight: '700', color: '#8A8A8A' },
  proName:       { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  proMetaRow:    { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  proMeta:       { fontSize: 16, color: '#8A8A8A' },

  proActions:   { flexDirection: 'row', gap: 8, marginBottom: 24 },
  proActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 999, paddingVertical: 16,
  },
  proActionPrimary:     { backgroundColor: '#FFD600' },
  proActionPrimaryText: { color: '#0D0D0D', fontSize: 16, fontWeight: '600' },
  proActionGhost:       { backgroundColor: '#161616' },
  // Con mensajes sin leer el botón no se disfraza de botón cualquiera: se
  // enciende. El badge solo se pierde entre el resto (Maxi, 9-ago-2026).
  proActionNuevo:       { backgroundColor: 'rgba(255,214,0,0.12)' },
  proActionGhostText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  msgBadge: {
    minWidth: 20, height: 20, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  msgBadgeText: { color: '#0D0D0D', fontSize: 14, fontWeight: '700' },

  dataRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 20,
    paddingVertical: 16, paddingHorizontal: 16, marginBottom: 16,
  },
  dataCell:    { flex: 1, minWidth: 0 },
  dataValue:   { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  dataLabel:   { fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5C5C5C' },
  dataDivider: { width: 1, alignSelf: 'stretch', backgroundColor: '#262626', marginHorizontal: 16 },

  panel: {
    backgroundColor: '#111',
    },
  // La hoja ya es la superficie: adentro no va ni fondo distinto ni línea.
  panelClient: { flex: 1, backgroundColor: 'transparent', borderTopWidth: 0 },
  panelContent: {
    padding: 16,
    paddingBottom: HOJA_ABAJO + 40,
    gap: 0,
  },

  // Tip contextual
  tipBar: {
    backgroundColor: '#161616', borderRadius: 20,
    paddingVertical: 16, paddingHorizontal: 16, marginBottom: 16,
  },
  tipText: { fontSize: 16, color: '#8A8A8A', lineHeight: 20 },

  // Código para el trabajador
  codeDisplay: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 24, alignItems: 'center', marginBottom: 16,
  },
  codeDisplayLabel: { fontSize: 14, color: '#5C5C5C', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 8 },
  codeDisplayNumber: { fontSize: 44, fontWeight: '700', color: '#FFD600', letterSpacing: 10 },
  codeDisplayHint:   { fontSize: 14, color: '#888', marginTop: 8, textAlign: 'center' },

  // Botón verificar código para el cliente
  verifyCodeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1A00', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FFD60060',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  verifyCodeBtnText: { flex: 1, fontSize: 16, fontWeight: '700', color: '#FFD600' },

  jobInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 16,
  },
  jobInfoTitle: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  jobInfoSub:   { fontSize: 14, color: '#555', marginTop: 2 },
  jobAmount:    { fontSize: 14, color: '#888', marginTop: 3 },
  visitBadge: {
    backgroundColor: '#1a1a1a', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#2a2a1a',
  },
  visitBadgeText: { color: '#FFD600', fontSize: 12, fontWeight: '700' },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 999, paddingVertical: 16, marginBottom: 8,
  },
  actionBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '600' },
  // Aclara qué pasa al tocar "Voy en camino": que su ubicación se comparte
  // recién ahí, y sólo hasta que llegue.
  ventanaHint: { color: '#5C5C5C', fontSize: 16, lineHeight: 20, textAlign: 'center',
                 marginTop: 8, marginBottom: 16, paddingHorizontal: 8 },
  amountRow: { gap: 10 },
  amountInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D0D0D', borderRadius: 14,
    padding: 14, gap: 8,
  },
  currency:    { color: '#F5F5F5', fontSize: 20, fontWeight: '700' },
  amountInput: { flex: 1, color: '#F5F5F5', fontSize: 20, fontWeight: '700' },

  amountPreview: {
    backgroundColor: '#0A1500', borderRadius: 12,
    borderWidth: 1, borderColor: '#FFD60020',
    padding: 12, gap: 4,
  },
  amountPreviewLine: { fontSize: 14, color: '#BBBBBB' },
  amountPreviewNote: { fontSize: 12, color: '#555' },
  amountPreviewTotal: { fontSize: 16, fontWeight: '700', color: '#FFD600', marginTop: 4 },

  paySection:    { gap: 10 },
  payBreakdown: {
    backgroundColor: '#0D0D0D', borderRadius: 14,
    padding: 16, gap: 10,
  },
  payRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payRowLabel:   { fontSize: 16, color: '#888' },
  payRowNote:    { fontSize: 12, color: '#555', marginTop: 2 },
  payRowVal:     { fontSize: 16, color: '#F5F5F5', fontWeight: '600' },
  payDivider:    { height: 1, backgroundColor: '#1E1E1E' },
  payTotalLabel: { fontSize: 16, fontWeight: '700', color: '#F5F5F5' },
  payTotalVal:   { fontSize: 20, fontWeight: '700', color: '#FFD600' },

  cardOnlyBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.2)',
    borderRadius: 10, paddingVertical: 8,
  },
  cardOnlyText: { color: '#FFD600', fontSize: 14, fontWeight: '600' },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 999, paddingVertical: 18,
  },
  payBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '600' },
  savedPayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 14, paddingVertical: 15, marginBottom: 8,
  },
  savedPayText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  // Modal de disponibilidad post-trabajo
  completedOverlay: {
    // el paddingBottom lo pone `padBarra` en cada uso: el alto de la barra de
    // abajo lo dice el sistema, acá quedaba en 0 para Android.
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'flex-end',
  },
  completedBox: {
    width: '100%', maxHeight: '88%', backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  completedScroll:     { width: '100%' },
  completedScrollBody: { padding: 24, alignItems: 'center', gap: 8 },
  completedTitle: { fontSize: 22, fontWeight: '700', color: '#F5F5F5', marginTop: 4 },
  completedSub:   { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  completedVolt:  { backgroundColor: '#0D0D00', borderRadius: 12, borderWidth: 1, borderColor: '#FFD60030', padding: 12, marginVertical: 4 },
  completedVoltText: { fontSize: 14, color: '#cfcfcf', textAlign: 'center', lineHeight: 19 },
  // Estrellas con las que el profesional califica al cliente
  clientStarsRow:  { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 6 },
  clientStarsHint: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 14, paddingHorizontal: 8 },
  completedOpt: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  completedOptText: { flex: 1, fontSize: 16, color: '#F5F5F5', fontWeight: '600' },

  mismaCuenta: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14, marginBottom: 16,
  },
  mismaCuentaTexto: { flex: 1, fontSize: 14, color: '#8A8A8A', lineHeight: 20 },

  // Aviso de seguridad cuando el profesional salió
  avisoCodigo: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 16,
    borderLeftWidth: 3, borderLeftColor: '#FFD600',
  },
  avisoCodigoTitulo: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  avisoCodigoTexto:  { fontSize: 14, color: '#8A8A8A', lineHeight: 20 },
  avisoCodigoNumero: {
    fontSize: 40, fontWeight: '700', color: '#FFD600',
    letterSpacing: 8, marginTop: 12,
  },

  // Respuesta del profesional (cliente)
  workerResponseCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, gap: 12, marginBottom: 16,
  },
  workerResponseTitle: {
    fontSize: 14, fontWeight: '600', color: '#5C5C5C',
    textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 4,
  },
  workerResponseRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  workerResponseText: { flex: 1, fontSize: 16, color: '#FFFFFF', lineHeight: 20 },

  // Sesión multi-día
  sessionCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, gap: 8, marginBottom: 16,
  },
  sessionCardRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessionCardTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#FFD600' },
  sessionCardHours: { fontSize: 14, color: '#888', fontWeight: '600' },
  sessionCardSub:   { fontSize: 14, color: '#555', lineHeight: 17 },
  sessionTimerRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sessionTimerDot:  { width: 8, height: 8, borderRadius: 999, backgroundColor: '#FFD600' },
  sessionTimerText: { fontSize: 14, color: '#FFD600', fontWeight: '700' },

  sessionActions: { gap: 10 },
  actionBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 999, paddingVertical: 16, marginBottom: 8,
    backgroundColor: '#161616',
  },
  actionBtnSecondaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  // #2 Confirmación multi-día (cliente)
  confirmCard: {
    flexDirection: 'row', gap: 16, alignItems: 'flex-start',
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 16,
  },
  confirmCardTitle: { fontSize: 16, fontWeight: '700', color: '#FFD600', marginBottom: 4 },
  confirmCardSub:   { fontSize: 14, color: '#aaa', lineHeight: 19, marginBottom: 10 },
  confirmCardBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'flex-start', backgroundColor: '#FFD600',
    borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10,
  },
  confirmCardBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // #3 Materiales (cliente aprueba)
  matCard: {
    backgroundColor: '#1A1200', borderRadius: 14,
    borderWidth: 1, borderColor: '#8A8A8A40', padding: 14, marginBottom: 12,
  },
  matCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  matCardTitle:  { fontSize: 16, fontWeight: '700', color: '#8A8A8A' },
  matCardDetail: { fontSize: 16, color: '#F5F5F5', fontWeight: '700', marginBottom: 2 },
  matCardEst:    { fontSize: 16, color: '#FFD600', fontWeight: '600', marginBottom: 8 },
  matCardNote:   { fontSize: 14, color: '#888', lineHeight: 17, marginBottom: 12 },
  matCardBtns:   { flexDirection: 'row', gap: 10 },
  matBtn:        { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12 },
  matBtnPrimary: { backgroundColor: '#8A8A8A' },
  matBtnPrimaryText: { color: '#0D0D0D', fontSize: 14, fontWeight: '700' },
  matBtnSecondary: { backgroundColor: '#111', },
  matBtnSecondaryText: { color: '#aaa', fontSize: 14, fontWeight: '600' },

  // #3 Materiales (trabajador esperando / info)
  matWaitCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#111', borderRadius: 10,
    padding: 12,
  },
  matWaitText: { flex: 1, fontSize: 14, color: '#888', lineHeight: 18 },

  // Comprando materiales
  buyingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 16,
  },
  buyingText: { fontSize: 14, color: '#8A8A8A', fontWeight: '700', lineHeight: 18 },
  buyingEta:  { fontSize: 14, color: '#8A8A8A88', marginTop: 4 },

  // Modal de verificación de código
  modalOverlay: {
    // Igual que `completedOverlay`: el paddingBottom lo pone `padBarra` en cada
    // uso. Dejar acá el `ios ? 34 : 0` era letra muerta —el del array siempre
    // gana— y el próximo que lo tocara no vería ningún cambio en pantalla.
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'flex-end',
  },
  modalBox: {
    width: '100%', backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 16,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalTitle:  { fontSize: 18, fontWeight: '700', color: '#F5F5F5' },
  modalSub:    { fontSize: 16, color: '#666', lineHeight: 20 },

  codeInput: {
    backgroundColor: '#0D0D0D', borderRadius: 14,
    borderWidth: 2, borderColor: '#FFD600',
    color: '#FFD600', fontSize: 40, fontWeight: '700',
    textAlign: 'center', paddingVertical: 18, letterSpacing: 16,
  },
  codeVerifyBtn: {
    backgroundColor: '#FFD600', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  codeVerifyBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  codeOkBox: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  codeOkTitle: { fontSize: 20, fontWeight: '700', color: '#FFD600' },
  codeOkSub:   { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 20 },
  codeCloseBtn: { backgroundColor: '#FFD600', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  codeCloseBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  codeErrorBox: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  codeErrorTitle: { fontSize: 20, fontWeight: '700', color: '#E5484D' },
  codeErrorSub:   { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 20 },
  codeRetryBtn: { backgroundColor: 'rgba(229,72,77,0.12)', borderWidth: 1.5, borderColor: '#E5484D50', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  codeRetryBtnText: { color: '#E5484D', fontSize: 16, fontWeight: '700' },

  // Timer de trabajo en curso
  workTimerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0A1500', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#FFD60040',
    paddingVertical: 12, paddingHorizontal: 14,
  },
  workTimerDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#FFD600' },
  workTimerLabel: { flex: 1, fontSize: 14, color: '#FFD600', fontWeight: '700' },
  workTimerValue: { fontSize: 20, fontWeight: '700', color: '#FFD600', letterSpacing: 1 },

  // Ayuda al pie
  problemBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 16, paddingHorizontal: 16,
    borderRadius: 20, backgroundColor: '#161616',
  },
  problemBtnText: { color: '#8A8A8A', fontSize: 16 },

  // Modal TENGO UN PROBLEMA
  problemOverlay: {
    // El paddingBottom lo pone `padBarra` en cada uso (ver `modalOverlay`).
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  problemBox: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: Platform.OS === 'android' ? 32 : 24,
  },
  problemHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    marginBottom: 8,
  },
  problemTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  problemItem: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#262626',
  },
  problemItemText: { flex: 1, fontSize: 16, color: '#FFFFFF', lineHeight: 22 },
  supportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1E1E1E', borderRadius: 999,
    paddingVertical: 16, marginTop: 24,
  },
  supportBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  emergencyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, marginTop: 8,
  },
  emergencyRowText: { color: '#E5484D', fontSize: 16, fontWeight: '600' },

  // Trabajador esperando pago
  waitingPayCard: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, gap: 12, marginBottom: 16,
  },
  waitingPayRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitingPayText: { flex: 1, fontSize: 16, color: '#FFD600', fontWeight: '700' },
  cancelJobBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: '#E5484D30',
    backgroundColor: 'rgba(229,72,77,0.06)',
  },
  cancelJobBtnText: { color: '#E5484D', fontSize: 14, fontWeight: '700' },

  testPayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
    borderStyle: 'dashed',
  },
  testPayBtnText: { color: '#555', fontSize: 14, fontWeight: '600' },

  // Visita ya pagada badge (en breakdown de pago final)
  visitPaidBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,214,0,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  visitPaidText: { color: '#FFD600', fontSize: 14, fontWeight: '700' },

  // Modal de pago de visita
  visitModalAmount: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0A1500', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FFD60030',
    paddingVertical: 16, paddingHorizontal: 18,
  },
  visitModalAmountLabel: { fontSize: 16, color: '#888', fontWeight: '600' },
  visitModalAmountValue: { fontSize: 22, fontWeight: '700', color: '#FFD600' },

  // Fecha de regreso del trabajador (cliente, multi-día)
  returnCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#0A0F1A', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FFD60040',
    padding: 14,
  },
  returnCardTitle: { fontSize: 12, fontWeight: '600', color: '#FFD600', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 4 },
  returnCardDate:  { fontSize: 16, fontWeight: '700', color: '#F5F5F5', marginBottom: 2 },
  returnCardSub:   { fontSize: 14, color: '#555' },

  // Pago — opción de problema
  payProblemBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
  },
  payProblemText: { color: '#8A8A8A', fontSize: 14, fontWeight: '600' },

  // Chat header button
  chatHeaderBtn: {
    width: 34, height: 34, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
  },
  chatBadge: {
    position: 'absolute', top: -2, right: -4,
    backgroundColor: '#FFD600', borderRadius: 999,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  chatBadgeText: { color: '#0D0D0D', fontSize: 12, fontWeight: '600' },

  // Favorito
  favBtn: { padding: 6, flexShrink: 0 },

  // Alertas: van sobre el mapa, así que necesitan fondo propio y quedar por
  // encima del WebView.
  nearbyAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5,
    backgroundColor: 'rgba(13,13,13,0.88)', marginHorizontal: 16, borderRadius: 999,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  nearbyAlertText: { flex: 1, fontSize: 16, color: '#FFD600', fontWeight: '600' },

  // Resumen del trabajo
  summaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, borderColor: '#FFD60030',
    backgroundColor: 'rgba(255,214,0,0.05)',
  },
  summaryBtnText: { flex: 1, fontSize: 14, color: '#FFD600', fontWeight: '700' },
  summaryFieldLabel: { fontSize: 14, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 6 },

  // Chips de materiales del diagnóstico (vista cliente)
  diagMatChip: {
    backgroundColor: '#161616', borderRadius: 12,
    borderWidth: 1, borderColor: '#8A8A8A40',
    paddingHorizontal: 10, paddingVertical: 4,
  },
  diagMatChipText: { fontSize: 12, color: '#8A8A8A', fontWeight: '600' },

  // Los pasos. Cuatro, dentro de la hoja, en gris salvo el que está pasando.
  progressWrap: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#161616', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 16, marginBottom: 16,
  },
  progressNode: { alignItems: 'center', flex: 1, minWidth: 0, gap: 8 },
  progressCircle: {
    width: 20, height: 20, borderRadius: 999,
    borderWidth: 1.5, borderColor: '#2B2B2B',
    backgroundColor: '#0D0D0D',
    alignItems: 'center', justifyContent: 'center',
  },
  progressCircleDone:    { backgroundColor: '#4F4F4F', borderColor: '#4F4F4F' },
  progressCircleCurrent: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  progressInnerDot:      { width: 7, height: 7, borderRadius: 999, backgroundColor: '#0D0D0D' },
  progressLabel: {
    fontSize: 12, color: '#5C5C5C', textAlign: 'center', fontWeight: '500',
  },
  progressLabelDone:    { color: '#8A8A8A' },
  progressLabelCurrent: { color: '#FFD600', fontWeight: '600' },
  progressLine: {
    width: 14, height: 1.5, backgroundColor: '#2B2B2B', marginTop: 9,
  },
  progressLineDone:    { backgroundColor: '#4F4F4F' },

  // Barra de estado (trabajador, y cliente mientras el pedido está pendiente)
  infoStrip: {
    flexDirection: 'row', alignItems: 'center', zIndex: 5,
    backgroundColor: 'rgba(13,13,13,0.92)',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    paddingVertical: 10, paddingHorizontal: 4,
  },
  infoStripItem: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  infoStripLabel: {
    fontSize: 12, fontWeight: '600', color: '#5C5C5C',
    textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 4,
  },
  infoStripValue:    { fontSize: 12, fontWeight: '700', color: '#888' },
  infoStripValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoStripDot:      { width: 6, height: 6, borderRadius: 999 },
  infoStripSep:      { width: 1, height: 28, backgroundColor: '#1E1E1E' },

  // Alerta de inactividad
  inactivityAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5,
    backgroundColor: 'rgba(13,13,13,0.88)', marginHorizontal: 16, borderRadius: 999,
    paddingVertical: 8, paddingHorizontal: 16, marginTop: 8,
  },
  inactivityAlertText: {
    flex: 1, fontSize: 16, color: '#8A8A8A',
  },

  // Timeline viva — minimalista
  timeline: {
    marginBottom: 16,
  },
  timelineTitle: {
    fontSize: 14, fontWeight: '600', color: '#5C5C5C',
    textTransform: 'uppercase', letterSpacing: 1.8, marginBottom: 16,
  },
  timelineItem: { flexDirection: 'row', gap: 16 },
  timelineIconCol: { width: 12, alignItems: 'center' },
  timelineLineTop: { width: 1.5, height: 8, backgroundColor: '#262626' },
  timelineLineBot: { flex: 1, width: 1.5, minHeight: 12, backgroundColor: '#262626' },
  timelineDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#3a3a3a' },
  timelineDotActive: {
    width: 11, height: 11, borderRadius: 999, backgroundColor: '#FFD600',
  },
  timelineTextCol: { flex: 1, paddingBottom: 16, marginTop: -3 },
  timelineMsg:       { fontSize: 16, color: '#8A8A8A', lineHeight: 20 },
  timelineMsgActive: { color: '#FFFFFF', fontWeight: '600' },
  timelineTime:      { fontSize: 14, color: '#5C5C5C', marginTop: 4 },
});

export default JobTrackingScreen;

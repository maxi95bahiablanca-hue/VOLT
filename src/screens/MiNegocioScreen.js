import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Platform, RefreshControl, Modal, Linking, Alert, Clipboard, Image,
  TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system 19 (SDK 54): readAsStringAsync y EncodingType se mudaron a
// /legacy. Importados de la raiz TIRAN ERROR en runtime, no avisan en el build.
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { showSuccess, showError, showInfo } from '../utils/toast';
import { abrirAyuda, abrirAyudaUbicacion } from '../utils/ayuda';
import volt from '../utils/voltVoice';
import { commissionForBilled, nextCommissionStep, levelLabel } from '../utils/commission';
import { chargesInApp } from '../config/monetization';
import NuevoPresupuestoScreen from './NuevoPresupuestoScreen';
import MiEmpresaScreen from './MiEmpresaScreen';
import MacheteScreen from './MacheteScreen';
import PaymentDataModal from '../components/PaymentDataModal';
import PanelTrabajos from '../components/PanelTrabajos';
import PanelIngresos from '../components/PanelIngresos';
import PanelClientes from '../components/PanelClientes';
import locationService from '../services/locationService';
import professionalService from '../services/professionalService';
import jobService from '../services/jobService';
import presupuestoService, {
  infoEstado, linkPresupuesto, nombreEmpresa, mensajePresupuesto, linkWhatsAppPresupuesto,
  mensajeAgendado, mensajeEnCamino, mensajeHecho, mensajeInsistir,
} from '../services/presupuestoService';

// ─────────────────────────────────────────────────────────────────────────────
// MI NEGOCIO — el único panel del trabajador.
//
// Maxi (5-ago): "todo esto debería ser en ese MI PANEL TRABAJADOR, que podríamos
// cambiarle el nombre y agregar todo esto ahí, ¿para qué hacer otro perfil? ahí
// mismo panel de clientes y demás".
//
// Tenía razón: eran dos pantallas para la misma persona, colgando las dos del
// menú, y la app se sentía pesada. Acá se fusionaron el viejo
// WorkerDashboardScreen (trabajos que entran POR BOLT, ingresos, guía) con Mi
// Negocio (presupuestos y clientes propios, los trabajos que llegan por
// WhatsApp o por un vecino).
//
// Lo que NO se toca al fusionar: el control de disponibilidad sigue siendo el
// mismo y sigue avisando hacia afuera por `onAvailabilityChange` — es lo que
// mantiene sincronizado el radar del HomeScreen.
//
// WorkerDashboardScreen.js queda en el repo por si hay que volver atrás, pero ya
// no lo importa nadie.
// ─────────────────────────────────────────────────────────────────────────────

const fecha = (iso) =>
  new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

const formatHour = (isoStr) =>
  new Date(isoStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

// ── El día de la visita, escrito como lo diría una persona ──────────────────
/** "jueves 7 de agosto" — en minúscula, para meterlo en medio de una frase. */
const diaLargo = (iso) =>
  new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

/** "Jueves 7 de agosto, 10:00" — para mostrarlo suelto en la pantalla. */
const cuandoLargo = (iso) => {
  const d = diaLargo(iso);
  return `${d.charAt(0).toUpperCase()}${d.slice(1)}, ${formatHour(iso)}`;
};

/** "jueves 10:00" — el renglón chico de la tarjeta, que no puede ocupar dos líneas. */
const cuandoCorto = (iso) =>
  `${new Date(iso).toLocaleDateString('es-AR', { weekday: 'long' })} ${formatHour(iso)}`;

/** "hace 4 días" / "hace 1 día" — cómo lo diría una persona, no "4d". */
const haceDias = (n) => {
  const d = Number(n) || 0;
  return d <= 1 ? 'hace 1 día' : `hace ${d} días`;
};

/** "Marcela Gómez" → "Marcela". Para hablarle al cliente por el nombre, nada más. */
const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// Las tres opciones del selector de día. No hay date picker: se instalaría una
// dependencia para elegir entre hoy, mañana y pasado, que es el 95% de los casos.
const DIAS_RAPIDOS = [
  { k: 0, l: 'Hoy' },
  { k: 1, l: 'Mañana' },
  { k: 2, l: 'Pasado' },
];

const MiNegocioScreen = ({ professional, session, onClose, abrirNuevo = false, onAvailabilityChange }) => {
  // 🔴 11-ago-2026 — las dos hojas de abajo (el detalle del presupuesto y el
  // "Pausar trabajos") terminaban debajo de la barra de gestos de Android: el
  // último botón quedaba tapado. Alto real de la barra, nunca un número fijo.
  const insets = useSafeAreaInsets();
  const [tab, setTab]            = useState('presupuestos');
  const [presupuestos, setPresu] = useState([]);
  // Los que hay que perseguir o cerrar HOY (migración 058). Es una lista aparte
  // y no un filtro de `presupuestos`: la regla de a quién le toca vive en la
  // base, y si la copiáramos acá tarde o temprano diría otra cosa.
  const [esperando, setEsperando] = useState([]);
  const [clientes, setClientes]  = useState([]);
  const [jobs, setJobs]          = useState([]);
  // El registro de todo lo que le llegó (migración 061). Arranca en null a
  // propósito: null = "todavía no sé", y es lo que distingue "no me llegó nada"
  // de "la base todavía no tiene la migración". La pestaña muestra una cosa
  // distinta en cada caso.
  const [actividad, setActividad] = useState(null);
  const [loading, setLoading]    = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [refreshing, setRefresh] = useState(false);
  // Con el acceso directo se entra derecho al formulario. Al cerrarlo queda la
  // lista, que es donde el profesional quiere estar después de mandar uno.
  const [showNuevo, setShowNuevo]     = useState(abrirNuevo);
  const [showEmpresa, setShowEmpresa] = useState(false);
  const [detalle, setDetalle]         = useState(null);   // estado local, sin librería

  // ─── El trabajo, después del sí ───────────────────────────────────────────
  // El cliente no instala nada: todo esto son botones de ESTE lado, y lo que ve
  // el cliente le llega por el mismo WhatsApp de siempre.
  const [agendando, setAgendando] = useState(false);  // el selector de día abierto
  const [dias, setDias]           = useState(0);      // 0 hoy · 1 mañana · 2 pasado
  const [hora, setHora]           = useState('10:00');
  const [pasoBusy, setPasoBusy]   = useState(false);

  // ── Ir publicando la posición mientras va en camino ──────────────────────
  // El cliente lo ve venir en el mapa de su página (la base sólo devuelve las
  // coordenadas si va en camino Y la posición es de los últimos 10 minutos, así
  // que si dejamos de publicar el mapa se apaga solo).
  //
  // Todo esto va en refs y no en estado: el cleanup del desmontaje se arma una
  // sola vez y tiene que ver los valores de ahora, no los del primer render.
  const watchRef     = useRef(null);    // el watcher de foreground
  const latidoRef    = useRef(null);    // refresco cada 60 s aunque no se mueva
  const siguiendoRef = useRef(false);   // ¿ya estamos publicando?
  const bgPropioRef  = useRef(false);   // ¿el background lo prendimos NOSOTROS?
  const enCaminoRef  = useRef(false);   // ¿hay un trabajo con la ventana abierta?

  // Copia en memoria del profesional: si edita su identidad (nombre comercial,
  // logo, plan) el mensaje de WhatsApp y los presupuestos nuevos tienen que
  // usar los datos de recién, no los que trajo el login.
  const [prof, setProf] = useState(professional);

  // ─── Disponibilidad (el radar) ────────────────────────────────────────────
  const [available, setAvailable]     = useState(professional.available ?? true);
  const [availableAt, setAvailableAt] = useState(professional.available_at ?? null);
  const [availModal, setAvailModal]   = useState(false);
  const [savingAvail, setSavingAvail] = useState(false);

  const [localAvatar, setLocalAvatar]         = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Datos de pago (CUIT/CBU) — onboarding transitorio para trabajadores pioneros.
  const [payDone, setPayDone] = useState(!!(professional.cuit && professional.cbu));
  const [showPay, setShowPay] = useState(false);

  const empresa = nombreEmpresa(prof);

  useEffect(() => { cargar(); fetchJobs(); fetchActividad(); }, []);

  // ── Que la lista no mienta, sin necesitar un cron ────────────────────────
  //
  // Al abrir la pantalla se vencen los de más de 21 días y recién después se
  // pide la lista de los que esperan respuesta. Sin este orden, un presupuesto
  // de hace dos meses seguiría apareciendo como "para perseguir hoy".
  //
  // Es lo único que mantiene el módulo honesto: no hay servidor corriendo
  // nada de noche, lo dispara el profesional cada vez que entra.
  useEffect(() => {
    (async () => {
      const vencidos = await presupuestoService.vencerViejos().catch(() => 0);
      // Si alguno se venció, la lista de arriba quedó con el estado viejo.
      if (vencidos > 0) cargar();
      cargarEsperando();
    })();
  }, []);

  // ── Enterarse cuando el cliente contesta ─────────────────────────────────
  //  Maxi (5-ago): "acepto y quedó como presupuesto aceptado pero a mi
  //  trabajador no me llegó nada".
  //
  //  El que acepta no tiene cuenta en BOLT, así que no puede dispararle un push
  //  a nadie. Hasta que exista una función del servidor que lo haga, el aviso
  //  lo da la propia app: en vivo mientras esté abierta, y un cartel al entrar
  //  con lo que pasó mientras no estaba. Un "sí" del cliente no puede quedar
  //  esperando a que alguien se acuerde de mirar la lista.
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    const canal = presupuestoService.suscribirse(professional.id, (nuevo, viejo) => {
      if (nuevo.estado === viejo?.estado) return;
      setPresu(prev => prev.map(x => (x.id === nuevo.id ? { ...x, ...nuevo } : x)));
      if (nuevo.estado === 'aceptado') {
        setAvisos(prev => (prev.some(a => a.id === nuevo.id) ? prev : [nuevo, ...prev]));
        // (cuerpo, título) — es el orden de src/utils/toast.js; estaban al revés
        // y el renglón grande mostraba el detalle en vez del titular.
        showSuccess(`${nuevo.cliente_nombre || 'El cliente'} aceptó el N°${nuevo.numero}.`,
          '¡Te aceptaron un presupuesto!');
      } else if (nuevo.estado === 'visto') {
        showInfo(`Abrieron el presupuesto N°${nuevo.numero}.`, 'Lo están mirando');
      }
    });
    return () => { try { canal?.unsubscribe?.(); } catch {} };
  }, [professional.id]);

  // Lo que pasó mientras la app estaba cerrada.
  useEffect(() => {
    (async () => {
      try {
        const visto = await AsyncStorage.getItem(`presu_visto_${professional.id}`);
        const nuevos = await presupuestoService.sinAvisar(professional.id, visto);
        if (nuevos.length) setAvisos(nuevos);
      } catch { /* el cartel es un extra: si falla, la lista igual los muestra */ }
    })();
  }, [professional.id]);

  const cerrarAvisos = () => {
    AsyncStorage.setItem(`presu_visto_${professional.id}`, new Date().toISOString()).catch(() => {});
    setAvisos([]);
  };

  useEffect(() => {
    // En modo gratis no pedimos datos de cobro (el cliente le paga directo al pro).
    if (!chargesInApp()) return;
    if (payDone || professional.verification_status !== 'approved') return;
    AsyncStorage.getItem(`pay_later_${professional.id}`).then(flag => {
      if (!flag) setShowPay(true);
    });
  }, []);

  useEffect(() => {
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

  const dismissPayLater = () => {
    AsyncStorage.setItem(`pay_later_${professional.id}`, '1').catch(() => {});
    setShowPay(false);
  };

  const cargar = async () => {
    try {
      const [ps, cs] = await Promise.all([
        presupuestoService.listar(professional.id),
        presupuestoService.listarClientes(professional.id),
      ]);
      setPresu(ps);
      setClientes(cs);
    } catch {
      showError('No pudimos traer tus presupuestos. Deslizá para reintentar.');
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  };

  // Silencioso a propósito: si esto falla, la lista de presupuestos igual está.
  // Un error acá no puede tapar la pantalla entera por un bloque de más.
  const cargarEsperando = async () => {
    try {
      setEsperando(await presupuestoService.esperando(professional.id));
    } catch { /* el recordatorio es un extra, no puede romper el panel */ }
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
    finally { setLoadingJobs(false); }
  };

  // Silencioso y aparte de fetchJobs: si la RPC no está (migración 061 sin
  // correr) devuelve null y la pestaña cae a la lista vieja sola.
  const fetchActividad = async () => {
    setActividad(await jobService.getActividad(60));
  };

  const refrescar = () => {
    setRefresh(true); cargar(); fetchJobs(); fetchActividad(); cargarEsperando();
  };

  // ─── Disponibilidad ───────────────────────────────────────────────────────
  const handleSetAvailable = async () => {
    setSavingAvail(true);
    try {
      // 🔴 Se lee de vuelta el valor que QUEDÓ, no el que mandamos.
      //
      //    Desde la migración 063 la base baja `available` sola si no hay
      //    ubicación guardada, porque sin ubicación `nearby_workers` no lo
      //    devuelve y estar "disponible" es mentira. Este botón no toca el GPS
      //    —el que lo carga es el radar del home—, así que es justo el camino
      //    por el que alguien podía quedar convencido de que estaba trabajando
      //    y no aparecer en ninguna búsqueda.
      const { data, error } = await supabase.from('professionals')
        .update({ available: true, available_at: null })
        .eq('id', professional.id)
        .select('available')
        .single();
      if (error) throw error;

      const quedo = data?.available === true;
      setAvailable(quedo);
      setAvailableAt(null);
      onAvailabilityChange?.(quedo);
      if (!quedo) {
        showError(
          'Volvé a la pantalla principal y prendé el radar: ahí se guarda tu ubicación, que es lo que hace que los clientes te encuentren.',
          'Falta tu ubicación'
        );
      }
    } catch {
      showError('No se pudo cambiar. Probá de nuevo en un momento.');
    }
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
      if (!error) { setAvailable(false); setAvailableAt(availAt); onAvailabilityChange?.(false); }
    } catch {}
    setSavingAvail(false);
  };

  // ─── Foto de perfil ───────────────────────────────────────────────────────
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

  // ─── Comisión y nivel (facturación móvil de 30 días) ──────────────────────
  const billed30 = useMemo(() => {
    const ahora = Date.now();
    return jobs
      .filter(j => j.status === 'completed' && j.completed_at && (ahora - new Date(j.completed_at).getTime()) <= 30 * 864e5)
      .reduce((acc, j) => acc + (j.work_amount || 0), 0);
  }, [jobs]);

  const commission = commissionForBilled(billed30, professional.avg_rating);
  const level      = levelLabel(commission);
  const levelColor = level === 'Elite' ? '#FFD600' : level === 'Pro' ? '#FFD600'
    : level === 'Activo' ? '#FFD600' : '#8A8A8A';
  const step       = nextCommissionStep(billed30);

  // ── BOLT socio: mensaje según el momento del trabajador ──────────────────
  const doneJobs    = professional.completed_jobs || 0;
  const isNewWorker = doneJobs === 0 && billed30 === 0;
  const coachMsg  = !chargesInApp()
    ? (isNewWorker ? volt.coachWelcomeFree(professional.first_name) : volt.coachActiveFree)
    : isNewWorker
    ? volt.coachWelcome(professional.first_name)
    : !step
    ? volt.coachElite
    : volt.coachVolumeProgress(step.falta, step.pct);

  // ─── Los tres números del mes (presupuestos) ──────────────────────────────
  const stats = useMemo(() => {
    const ahora = new Date();
    const delMes = presupuestos.filter(p => {
      const d = new Date(p.created_at);
      return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
    });
    return {
      cantidad:  delMes.length,
      aceptados: delMes.filter(p => p.estado === 'aceptado').length,
      total:     delMes.reduce((a, p) => a + (Number(p.total) || 0), 0),
    };
  }, [presupuestos]);

  const textoDe = (p) => mensajePresupuesto({
    numero: p.numero, empresa, descripcion: p.descripcion, total: p.total, token: p.token,
  });

  const enviarWhatsApp = async (p) => {
    try { await presupuestoService.marcarEnviado(p.id); } catch { /* que el envío no dependa de esto */ }
    Linking.openURL(linkWhatsAppPresupuesto(p.cliente_tel, textoDe(p)))
      .catch(() => showError('No pudimos abrir WhatsApp. Copiá el link y mandalo a mano.'));
    setPresu(prev => prev.map(x => (x.id === p.id && x.estado === 'borrador' ? { ...x, estado: 'enviado' } : x)));
  };

  const copiarLink = (p) => {
    Clipboard.setString(linkPresupuesto(p.token));
    showSuccess('Link copiado. Pegalo donde quieras mandarlo.');
  };

  // Cerrar el presupuesto a mano. Regla del proyecto: nada puede quedar
  // esperando para siempre a que alguien toque un botón del otro lado.
  const responder = async (p, acepta) => {
    try {
      const actualizado = await presupuestoService.responderAMano(p.id, acepta);
      // El update no devuelve el join de `professions`: si lo pisáramos entero,
      // la ficha del cliente perdería el chip del oficio hasta recargar.
      setPresu(prev => prev.map(x => (x.id === p.id ? { ...x, ...actualizado, professions: x.professions } : x)));
      quitarDeEsperando(p.id);   // ya se sabe qué pasó: no hay nada que perseguir
      setDetalle(null);
      showSuccess(acepta ? '¡Buenísimo! Quedó como aceptado.' : 'Quedó marcado como rechazado.');
    } catch {
      showError('No se pudo guardar. Probá de nuevo.');
    }
  };

  // ─── Perseguir y cerrar ───────────────────────────────────────────────────
  //
  // Dos cosas distintas que viven en el mismo bloque:
  //
  //   A los 3 días se PERSIGUE: se le escribe. Es lo único de todo el módulo
  //   que genera plata directa — casi ningún oficio lo hace, y el que pregunta
  //   a los tres días cierra más.
  //
  //   A los 7 ya no: se PREGUNTA qué pasó y se cierra. Insistir una segunda vez
  //   no vende nada; lo que vende es no tener 40 presupuestos abiertos sin saber
  //   cuáles siguen vivos.
  //
  // 🔴 Nada de esto le pide nada al cliente. La fricción va del lado del que
  // gana algo. El profesional YA SABE si se lo aceptaron: lo marca él.

  /** Sale de la lista de hoy. La base tampoco la va a devolver por unos días. */
  const quitarDeEsperando = (id) => setEsperando(prev => prev.filter(x => x.id !== id));

  const insistir = (f) => {
    const texto = mensajeInsistir({
      empresa, nombre: primerNombre(f.cliente_nombre), numero: f.numero,
    });
    Linking.openURL(linkWhatsAppPresupuesto(f.cliente_tel, texto))
      .catch(() => showError('No pudimos abrir WhatsApp. Escribile a mano.'));
    // Que el mensaje no dependa de que la marca se guarde: si esto falla, en el
    // peor de los casos mañana se lo vuelve a ofrecer.
    presupuestoService.perseguido(f.id).catch(() => {});
    quitarDeEsperando(f.id);
  };

  /** Cerrarlo desde el bloque, sin abrir el detalle: es un toque, parado en la obra. */
  const cerrarEsperando = async (f, acepta) => {
    try {
      const actualizado = await presupuestoService.responderAMano(f.id, acepta);
      setPresu(prev => prev.map(x => (x.id === f.id ? { ...x, ...actualizado, professions: x.professions } : x)));
      quitarDeEsperando(f.id);
      showSuccess(acepta
        ? '¡Buenísimo! Quedó como aceptado.'
        : 'Listo, lo cerramos. Ya no te lo pregunto más.');
    } catch {
      showError('No se pudo guardar. Probá de nuevo.');
    }
  };

  const posponerEsperando = async (f, dias = 7) => {
    try {
      await presupuestoService.postergar(f.id, dias);
      quitarDeEsperando(f.id);
      showInfo(`Dale, te lo recuerdo en ${dias} días.`);
    } catch {
      showError('No se pudo guardar. Probá de nuevo.');
    }
  };

  const menuEsperando = (f) => {
    Alert.alert(
      `N°${f.numero} · ${f.cliente_nombre || 'Sin nombre'}`,
      '¿Qué pasó con este presupuesto?',
      [
        { text: 'Lo aceptó',          onPress: () => cerrarEsperando(f, true) },
        { text: 'No va',              onPress: () => cerrarEsperando(f, false), style: 'destructive' },
        { text: 'Sigue en veremos',   onPress: () => posponerEsperando(f, 7) },
        { text: 'Cancelar',           style: 'cancel' },
      ],
    );
  };

  // ─── El mapa del cliente: publicar la posición mientras va ────────────────
  //
  // 🔴 EL CUIDADO QUE IMPORTA: si el radar está prendido, el seguimiento en
  // background ya lo prendió el Home y NO es nuestro. Apagarlo al llegar le
  // sacaría el radar sin que él lo pida — se quedaría sin recibir trabajos y
  // sin enterarse. Por eso apagamos el background sólo si lo prendimos nosotros
  // (`bgPropioRef`). El watcher de foreground sí es siempre nuestro y se corta
  // siempre.
  const arrancarSeguimiento = async () => {
    if (siguiendoRef.current) return;
    siguiendoRef.current = true;
    try {
      const uid = session?.user?.id || professional.user_id;
      if (!uid) { siguiendoRef.current = false; return; }

      const granted = await locationService.requestPermission().catch(() => false);
      if (!granted) {
        siguiendoRef.current = false;
        // Antes era un toast que se iba solo y no dejaba nada que hacer. El
        // permiso denegado no se arregla mirándolo: hay que ir a los ajustes, y
        // la guía es lo único que explica dónde (en iPhone está en otro lado).
        Alert.alert(
          'Sin permiso de ubicación',
          'Así el cliente no te va a poder seguir en el mapa mientras vas.',
          [
            { text: 'Cómo activarlo', onPress: () => abrirAyudaUbicacion() },
            { text: 'Seguir igual', style: 'cancel' },
          ]
        );
        return;
      }

      // La primera posición, ya: el mapa del cliente tiene que prender ahora,
      // no dentro de un minuto y medio cuando llegue el primer update.
      locationService.getCurrentLocation()
        .then(pos => professionalService.updateLocation(uid, pos.coords.latitude, pos.coords.longitude))
        .catch(() => {});

      // 🔴 El latido, y no es de más.
      //    watchLocation avisa cada 90 s O cada 80 m, lo que pase primero — pero
      //    si NO se mueve, no avisa nunca. La página del cliente sólo muestra el
      //    mapa si la posición es de los últimos 10 minutos (migración 057), así
      //    que un semáforo largo, un embotellamiento o parar a cargar nafta lo
      //    borraban del mapa justo cuando el cliente más lo mira.
      //    Refrescar cada 60 s mientras va en camino lo resuelve, y no es un
      //    gasto: la ventana dura lo que dura el viaje, no todo el día.
      if (!latidoRef.current) {
        latidoRef.current = setInterval(() => {
          locationService.getCurrentLocation()
            .then(pos => professionalService.updateLocation(uid, pos.coords.latitude, pos.coords.longitude))
            .catch(() => {});
        }, 60000);
      }

      if (!watchRef.current) {
        watchRef.current = await locationService.watchLocation((lat, lng) =>
          professionalService.updateLocation(uid, lat, lng).catch(() => {})
        ).catch(() => null);
      }

      // Sin el background deja de publicar apenas bloquea la pantalla, que es
      // exactamente lo que va a hacer mientras maneja.
      if (!available) {
        bgPropioRef.current = true;
        locationService.startBackgroundTracking().catch(() => {});
      }
    } catch {
      siguiendoRef.current = false;   // que el viaje no dependa del GPS
    }
  };

  const cortarSeguimiento = ({ soloForeground = false } = {}) => {
    try { watchRef.current?.remove?.(); } catch {}
    watchRef.current = null;
    // El latido vive en el JS de la pantalla: si se desmonta, se va igual. Se
    // limpia acá para no dejar un intervalo suelto pidiendo GPS de gusto.
    if (latidoRef.current) { clearInterval(latidoRef.current); latidoRef.current = null; }
    // El watcher de foreground muere con la pantalla; el background, no
    // siempre: si todavía va manejando, es lo único que mantiene prendido el
    // mapa del cliente.
    if (soloForeground) return;
    siguiendoRef.current = false;
    if (bgPropioRef.current) {
      bgPropioRef.current = false;
      locationService.stopBackgroundTracking().catch(() => {});
    }
  };

  // Si cerró la app arriba del auto y volvió a abrirla, tiene que seguir
  // publicando: nadie va a tocar de nuevo "voy en camino" a mitad de camino.
  useEffect(() => {
    const yendo = presupuestos.some(p => p.estado === 'en_camino' && p.en_camino_desde);
    enCaminoRef.current = yendo;
    if (loading || siguiendoRef.current) return;
    if (yendo) arrancarSeguimiento();
  }, [loading, presupuestos]);

  // Al salir de la pantalla: el watcher se corta siempre. El background sólo si
  // ya no va en camino — volver al mapa del Home no puede dejar al cliente sin
  // verlo llegar. Al reabrir la pantalla se retoma solo, y ahí se corta con
  // "Llegué".
  useEffect(() => () => cortarSeguimiento({ soloForeground: enCaminoRef.current }), []);

  // ─── El circuito del trabajo ──────────────────────────────────────────────
  // Todo lo que pasa acá tiene que verse SIN recargar: el profesional está
  // parado en la puerta del cliente, no va a hacer pull-to-refresh.
  const aplicar = (id, cambios) => {
    setPresu(prev => prev.map(x => (x.id === id ? { ...x, ...cambios } : x)));
    setDetalle(d => (d && d.id === id ? { ...d, ...cambios } : d));
  };

  // Los dos puntos los pone la app: con teclado numérico en Android el ":" no
  // está, y no vamos a instalar un date picker para elegir entre hoy y mañana.
  const escribirHora = (t) => {
    const d = String(t).replace(/\D/g, '').slice(0, 4);
    setHora(d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`);
  };

  /** Arma el timestamptz con el día elegido y la hora tipeada. null si la hora no sirve. */
  const armarCuando = () => {
    const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(hora).trim());
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2] || '0', 10);
    if (h > 23 || mi > 59) return null;
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(h, mi, 0, 0);
    return d;
  };

  const abrirAgenda   = () => { setDias(0); setHora('10:00'); setAgendando(true); };
  const cerrarDetalle = () => { setAgendando(false); setDetalle(null); };

  const confirmarAgenda = async (p) => {
    const cuando = armarCuando();
    if (!cuando) { showError('Escribí la hora así: 10:00'); return; }
    setPasoBusy(true);
    try {
      const iso = cuando.toISOString();
      await presupuestoService.agendar(p.id, iso);
      aplicar(p.id, { estado: 'agendado', agendado_para: iso });
      setAgendando(false);
      showSuccess(`Quedó para el ${diaLargo(iso)} a las ${formatHour(iso)}. Avisale por WhatsApp.`, 'Agendado');
    } catch {
      showError('No se pudo agendar. Probá de nuevo.');
    } finally { setPasoBusy(false); }
  };

  const salir = async (p) => {
    setPasoBusy(true);
    try {
      const { codigo } = await presupuestoService.salir(p.id);
      aplicar(p.id, { estado: 'en_camino', en_camino_desde: new Date().toISOString(), codigo });
      arrancarSeguimiento();   // desde acá el cliente lo ve venir en su mapa
      showSuccess(`Mostrale el código ${codigo} al llegar. Avisale por WhatsApp que ya salís.`, 'Vas en camino');
    } catch {
      showError('No se pudo avisar que salís. Probá de nuevo.');
    } finally { setPasoBusy(false); }
  };

  const llegue = async (p) => {
    setPasoBusy(true);
    try {
      await presupuestoService.llegue(p.id);
      aplicar(p.id, { en_camino_desde: null });
      cortarSeguimiento();   // llegó: se apaga el mapa y deja de gastar batería
      showSuccess('Llegaste. Cuando termines, tocá "Trabajo terminado".');
    } catch {
      showError('No se pudo guardar. Probá de nuevo.');
    } finally { setPasoBusy(false); }
  };

  const terminar = async (p) => {
    setPasoBusy(true);
    try {
      await presupuestoService.hecho(p.id);
      aplicar(p.id, { estado: 'hecho', hecho_at: new Date().toISOString(), en_camino_desde: null });
      cortarSeguimiento();
      showSuccess('Trabajo terminado. Pedile que te recomiende, es lo que te trae el próximo.');
    } catch {
      showError('No se pudo guardar. Probá de nuevo.');
    } finally { setPasoBusy(false); }
  };

  /** El aviso al cliente: mismo WhatsApp de siempre, mensaje ya escrito. */
  const avisar = (p, texto) => {
    Linking.openURL(linkWhatsAppPresupuesto(p.cliente_tel, texto))
      .catch(() => showError('No pudimos abrir WhatsApp. Escribile a mano.'));
  };

  const borrar = (p) => {
    Alert.alert(`¿Borrar el presupuesto N°${p.numero}?`, 'El link deja de funcionar para el cliente.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => {
          try {
            await presupuestoService.borrar(p.id);
            setPresu(prev => prev.filter(x => x.id !== p.id));
            quitarDeEsperando(p.id);
            setDetalle(null);
            showSuccess('Presupuesto borrado.');
          } catch { showError('No se pudo borrar. Probá de nuevo.'); }
        },
      },
    ]);
  };

  // ─── Pantalla de crear ────────────────────────────────────────────────────
  if (showNuevo) {
    return (
      <NuevoPresupuestoScreen
        professional={prof}
        onClose={() => { setShowNuevo(false); cargar(); }}
        onCreado={() => { /* la lista se refresca al volver */ }}
      />
    );
  }

  // ─── Identidad de la empresa ──────────────────────────────────────────────
  if (showEmpresa) {
    return (
      <MiEmpresaScreen
        professional={prof}
        onClose={() => setShowEmpresa(false)}
        onGuardado={(campos) => setProf(p => ({ ...p, ...campos }))}
      />
    );
  }

  // Cinco pestañas no entran en una fila: la fila scrollea.
  const TABS = [
    { k: 'presupuestos', l: 'Presupuestos' },
    { k: 'clientes',     l: `Clientes${clientes.length ? ` (${clientes.length})` : ''}` },
    { k: 'trabajos',     l: 'Trabajos' },
    { k: 'ingresos',     l: 'Ingresos' },
    { k: 'guia',         l: '⚡ Guía' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mi negocio</Text>
        <TouchableOpacity onPress={() => setShowEmpresa(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="settings-outline" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refrescar} tintColor="#FFD600" />
        }
      >
        {/* Lo que contestaron mientras no estabas. Va arriba de todo porque es
            plata que ya está cerrada esperando que la vayas a buscar. */}
        {avisos.length > 0 && (
          <View style={styles.avisoBox}>
            <View style={styles.avisoTop}>
              <Ionicons name="checkmark-circle" size={22} color="#FFD600" />
              <Text style={styles.avisoTitulo}>
                {avisos.length === 1 ? 'Te aceptaron un presupuesto' : `Te aceptaron ${avisos.length} presupuestos`}
              </Text>
              <TouchableOpacity onPress={cerrarAvisos} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={19} color="#5C5C5C" />
              </TouchableOpacity>
            </View>
            {avisos.slice(0, 3).map(a => (
              <TouchableOpacity
                key={a.id}
                style={styles.avisoFila}
                onPress={() => { const p = presupuestos.find(x => x.id === a.id); if (p) setDetalle(p); }}
                activeOpacity={0.8}
              >
                <Text style={styles.avisoTexto} numberOfLines={1}>
                  N°{a.numero} · {a.cliente_nombre || 'Sin nombre'}
                </Text>
                <Text style={styles.avisoMonto}>${Number(a.total || 0).toLocaleString('es-AR')}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.avisoPie}>Tocalo y agendá la visita.</Text>
          </View>
        )}

        {/* ─── Los que están esperando respuesta ───────────────────────────
            Naranja tenue, no verde ni rojo: es atención, no urgencia ni éxito.
            Va acá arriba porque es lo único de la pantalla que genera plata
            directa — el que pregunta a los tres días cierra más.

            La base ya decidió quién entra: cada fila es algo para hacer HOY. */}
        {esperando.length > 0 && (
          <View style={styles.espBox}>
            <View style={styles.espTop}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#8A8A8A" />
              <Text style={styles.espTitulo}>
                {esperando.length === 1
                  ? '1 presupuesto esperando respuesta'
                  : `${esperando.length} presupuestos esperando respuesta`}
              </Text>
            </View>

            {esperando.map(f => {
              const nombre = (f.cliente_nombre || '').trim();
              const quien  = primerNombre(nombre) || 'El cliente';
              const monto  = `$${Number(f.total || 0).toLocaleString('es-AR')}`;

              // 🔴 Pasados los 7 días ya no se persigue. Insistir de nuevo no
              // vende: lo que sirve es saber si sigue vivo o no. Por eso los
              // tres botones quedan a la vista, sin menú de por medio.
              if (f.toca_cerrar) {
                return (
                  <View key={f.id} style={styles.espFila}>
                    <View style={styles.espFilaTop}>
                      <Text style={styles.espCerrar} numberOfLines={1}>
                        ¿Qué pasó con el N°{f.numero}?
                      </Text>
                      <Text style={styles.espDias}>{haceDias(f.dias)}</Text>
                    </View>
                    <Text style={styles.espSub} numberOfLines={1}>
                      {nombre || 'Sin nombre'} · {monto}
                    </Text>
                    <View style={styles.espBotones}>
                      <TouchableOpacity
                        style={[styles.espChip, { borderColor: '#FFD60055' }]}
                        onPress={() => cerrarEsperando(f, true)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.espChipText, { color: '#FFD600' }]}>Lo tomé</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.espChip, { borderColor: '#E5484D55' }]}
                        onPress={() => cerrarEsperando(f, false)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.espChipText, { color: '#E5484D' }]}>No va</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.espChip, { borderColor: '#2a2a2a' }]}
                        onPress={() => posponerEsperando(f, 7)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.espChipText, { color: '#999' }]}>En veremos</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={f.id}
                  style={styles.espFila}
                  onLongPress={() => menuEsperando(f)}
                  activeOpacity={0.9}
                >
                  <View style={styles.espFilaTop}>
                    <Text style={styles.espTexto} numberOfLines={1}>
                      N°{f.numero} · {nombre || 'Sin nombre'} · {monto}
                    </Text>
                    <Text style={styles.espDias}>{haceDias(f.dias)}</Text>
                  </View>
                  <View style={styles.espAcciones}>
                    <Text style={styles.espSub} numberOfLines={1}>
                      {f.estado === 'visto'
                        ? `${quien} lo vio y no contestó`
                        : `${quien} todavía no lo abrió`}
                    </Text>
                    <TouchableOpacity
                      style={styles.espWa}
                      onPress={() => insistir(f)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="logo-whatsapp" size={15} color="#0D0D0D" />
                      <Text style={styles.espWaText}>Escribirle</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.espMas}
                      onPress={() => menuEsperando(f)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="ellipsis-horizontal" size={18} color="#8A8A8A" />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}

            <Text style={styles.espPie}>
              Un mensaje corto a los tres días cierra más trabajos que bajar el precio.
            </Text>
          </View>
        )}

        {/* Datos de pago: si está aprobado y le faltan, un acceso discreto para
            abrir el formulario cuando quiera. */}
        {chargesInApp() && !payDone && professional.verification_status === 'approved' && (
          <TouchableOpacity style={styles.payBanner} onPress={() => setShowPay(true)} activeOpacity={0.85}>
            <Ionicons name="card-outline" size={24} color="#0D0D0D" />
            <View style={{ flex: 1 }}>
              <Text style={styles.payBannerTitle}>Completá tus datos para cobrar</Text>
              <Text style={styles.payBannerSub}>Cargá tu CUIT y CBU. Tocá para hacerlo ahora.</Text>
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

        {/* Quién sos: foto, nombre, nivel y comisión */}
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
            <Text style={styles.profileName} numberOfLines={1}>
              {professional.first_name} {professional.last_name}
            </Text>
            {/* Si cargó un nombre comercial, es con el que firma sus presupuestos. */}
            {!!prof?.nombre_comercial && (
              <Text style={styles.profileEmpresa} numberOfLines={1}>{prof.nombre_comercial}</Text>
            )}
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

        {/* BOLT socio — bienvenida / progreso */}
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

        {/* Próximo paso: sólo cuando hay algo que hacer. Con el radar prendido
            la tarjeta verde de abajo ya lo dice. */}
        {!available && (
          <View style={styles.pasoCard}>
            <Ionicons name="arrow-forward-circle" size={20} color="#FFD600" />
            <Text style={styles.pasoText}>
              Próximo paso: tocá “Disponible” acá abajo para empezar a recibir trabajos.
            </Text>
          </View>
        )}

        {/* Toggle disponibilidad — el radar */}
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
          <View style={[styles.availOverlay, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 34 : 0) }]}>
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

        {/* ─── Las cinco pestañas ─────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map(t => (
            <TouchableOpacity
              key={t.k}
              style={[styles.tab, tab === t.k && styles.tabActive]}
              onPress={() => setTab(t.k)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, tab === t.k && styles.tabTextActive]}>{t.l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ─── Presupuestos ───────────────────────────────────────────────── */}
        {tab === 'presupuestos' && (
          <>
            {/* Lo primero, siempre: hacer un presupuesto */}
            <TouchableOpacity style={styles.nuevoBtn} onPress={() => setShowNuevo(true)} activeOpacity={0.85}>
              <Ionicons name="document-text" size={22} color="#0D0D0D" />
              <Text style={styles.nuevoBtnText}>Nuevo presupuesto</Text>
            </TouchableOpacity>
            <Text style={styles.nuevoHint}>Te lleva menos de un minuto</Text>

            <View style={styles.statsCard}>
              <View style={styles.statItem}>
                <Text style={styles.statVal}>{stats.cantidad}</Text>
                <Text style={styles.statLbl}>Este mes</Text>
              </View>
              <View style={styles.statDiv} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: '#FFD600' }]}>{stats.aceptados}</Text>
                <Text style={styles.statLbl}>Aceptados</Text>
              </View>
              <View style={styles.statDiv} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: '#FFD600', fontSize: 16 }]}>
                  ${stats.total.toLocaleString('es-AR')}
                </Text>
                <Text style={styles.statLbl}>Presupuestado</Text>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator color="#FFD600" style={{ marginTop: 40 }} />
            ) : presupuestos.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="document-text-outline" size={48} color="#222" />
                <Text style={styles.emptyTitle}>Todavía no hiciste ninguno</Text>
                <Text style={styles.emptyText}>
                  El próximo trabajo que te pidan por WhatsApp, presupuestalo desde acá: te queda el
                  historial, el cliente y el aviso de cuando lo abre.
                </Text>
                {/* Nunca hizo uno: es exactamente acá donde la guía sirve. */}
                <TouchableOpacity
                  style={styles.ayudaLink}
                  onPress={() => abrirAyuda('presupuesto')}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="help-buoy-outline" size={13} color="#8A8A8A" />
                  <Text style={styles.ayudaLinkText}>¿Cómo hago un presupuesto?</Text>
                </TouchableOpacity>
              </View>
            ) : presupuestos.map(p => {
              const s = infoEstado(p.estado);
              const loVio = p.estado === 'visto';
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.card, loVio && { borderColor: '#8A8A8A55' }]}
                  onPress={() => setDetalle(p)}
                  activeOpacity={0.85}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.numero}>N°{p.numero}</Text>
                    <Text style={styles.cliente} numberOfLines={1}>
                      {p.cliente_nombre || 'Sin cliente'}
                    </Text>
                    <View style={[styles.chip, { backgroundColor: s.color + '18', borderColor: s.color + '40' }]}>
                      <Text style={[styles.chipText, { color: s.color }]}>{s.label}</Text>
                    </View>
                  </View>

                  <Text style={styles.desc} numberOfLines={2}>{p.descripcion}</Text>

                  {/* Que lo haya abierto y no haya contestado es información de
                      venta: es el momento exacto de levantar el teléfono. */}
                  {loVio && (
                    <View style={styles.vioBox}>
                      <Text style={styles.vioText}>👀 Lo vio y no contestó</Text>
                    </View>
                  )}

                  {/* En qué anda el trabajo, sin tener que abrirlo. */}
                  {p.estado === 'agendado' && !!p.agendado_para && (
                    <View style={styles.cardPaso}>
                      <Ionicons name="calendar-outline" size={13} color="#8A8A8A" />
                      <Text style={[styles.cardPasoText, { color: '#8A8A8A' }]} numberOfLines={1}>
                        Vas el {cuandoCorto(p.agendado_para)}
                      </Text>
                    </View>
                  )}
                  {p.estado === 'en_camino' && (
                    <View style={styles.cardPaso}>
                      <Ionicons name={p.en_camino_desde ? 'car' : 'construct-outline'} size={13} color="#FFD600" />
                      <Text style={[styles.cardPasoText, { color: '#FFD600' }]} numberOfLines={1}>
                        {p.en_camino_desde
                          ? `Estás yendo${p.codigo ? ` · código ${p.codigo}` : ''}`
                          : 'Estás en el trabajo'}
                      </Text>
                    </View>
                  )}
                  {p.estado === 'hecho' && !!p.hecho_at && (
                    <View style={styles.cardPaso}>
                      <Ionicons name="checkmark-circle-outline" size={13} color="#FFD600" />
                      <Text style={[styles.cardPasoText, { color: '#FFD600' }]} numberOfLines={1}>
                        Terminado el {fecha(p.hecho_at)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.cardBottom}>
                    <Text style={styles.fecha}>
                      {fecha(p.created_at)}{p.professions?.name ? ` · ${p.professions.name}` : ''}
                    </Text>
                    <Text style={styles.total}>${Number(p.total || 0).toLocaleString('es-AR')}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ─── Clientes ───────────────────────────────────────────────────── */}
        {tab === 'clientes' && (
          <PanelClientes
            professionalId={professional.id}
            clientes={clientes}
            presupuestos={presupuestos}
            empresa={empresa}
            loading={loading}
            onCreado={(c) => setClientes(prev => [c, ...prev])}
          />
        )}

        {/* ─── Trabajos (los que entran POR BOLT) ─────────────────────────── */}
        {tab === 'trabajos' && (
          <PanelTrabajos
            jobs={jobs}
            actividad={actividad}
            professional={professional}
            loading={loadingJobs}
            step={step}
          />
        )}

        {/* ─── Ingresos ───────────────────────────────────────────────────── */}
        {tab === 'ingresos' && (
          <PanelIngresos
            jobs={jobs}
            professional={professional}
            commission={commission}
            level={level}
            levelColor={levelColor}
          />
        )}

        {/* ─── Guía ───────────────────────────────────────────────────────── */}
        {tab === 'guia' && <MacheteScreen professional={professional} />}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ─── Detalle del presupuesto ─────────────────────────────────────── */}
      <Modal visible={!!detalle} transparent animationType="slide" onRequestClose={cerrarDetalle}>
        {/* 🔴 11-ago-2026 — al agendar la visita, el teclado numérico de "A qué
            hora" tapaba el campo y el botón "Confirmar el día", y la hoja no se
            movía: el presupuesto quedaba aceptado pero sin fecha, y el cliente
            nunca recibía el día ni el código de la puerta. */}
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 22) }]}>
            {!!detalle && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <View style={styles.sheetTop}>
                  <Text style={styles.sheetTitle}>Presupuesto N°{detalle.numero}</Text>
                  <TouchableOpacity onPress={cerrarDetalle} style={{ padding: 4 }}>
                    <Ionicons name="close" size={22} color="#5C5C5C" />
                  </TouchableOpacity>
                </View>

                <View style={[styles.chip, {
                  alignSelf: 'flex-start',
                  backgroundColor: infoEstado(detalle.estado).color + '18',
                  borderColor: infoEstado(detalle.estado).color + '40',
                  marginBottom: 14,
                }]}>
                  <Text style={[styles.chipText, { color: infoEstado(detalle.estado).color }]}>
                    {infoEstado(detalle.estado).label}
                  </Text>
                </View>

                {!!detalle.cliente_nombre && (
                  <>
                    <Text style={styles.label}>Cliente</Text>
                    <Text style={styles.valor}>
                      {detalle.cliente_nombre}{detalle.cliente_tel ? ` · ${detalle.cliente_tel}` : ''}
                    </Text>
                  </>
                )}

                {!!detalle.professions?.name && (
                  <>
                    <Text style={styles.label}>Oficio</Text>
                    <Text style={styles.valor}>{detalle.professions.name}</Text>
                  </>
                )}

                <Text style={styles.label}>Trabajo</Text>
                <Text style={styles.valor}>{detalle.descripcion}</Text>

                <Text style={styles.label}>Total</Text>
                <Text style={styles.valorTotal}>${Number(detalle.total || 0).toLocaleString('es-AR')}</Text>

                {!!detalle.notas && (
                  <>
                    <Text style={styles.label}>Notas</Text>
                    <Text style={styles.valor}>{detalle.notas}</Text>
                  </>
                )}

                {!!detalle.validez_dias && (
                  <>
                    <Text style={styles.label}>Validez</Text>
                    <Text style={styles.valor}>{detalle.validez_dias} días</Text>
                  </>
                )}

                {!!detalle.visto_at && (
                  <Text style={styles.vistoAt}>
                    Lo abrió el {new Date(detalle.visto_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}
                  </Text>
                )}

                {/* ─── El paso siguiente ───────────────────────────────────
                    Un solo botón por vez: el profesional tiene que saber qué
                    toca sin pensarlo. El cliente ve todo esto en el link que ya
                    tiene — no instala nada, no se registra. */}
                {['aceptado', 'agendado', 'en_camino', 'hecho'].includes(detalle.estado) && (
                  <View style={styles.pasoBox}>
                    {agendando ? (
                      <>
                        <Text style={styles.pasoTitulo}>¿Cuándo vas?</Text>
                        <View style={styles.diasRow}>
                          {DIAS_RAPIDOS.map(d => (
                            <TouchableOpacity
                              key={d.k}
                              style={[styles.diaChip, dias === d.k && styles.diaChipOn]}
                              onPress={() => setDias(d.k)}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.diaChipText, dias === d.k && styles.diaChipTextOn]}>{d.l}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={styles.pasoLabel}>A qué hora</Text>
                        <TextInput
                          style={styles.horaInput}
                          value={hora}
                          onChangeText={escribirHora}
                          keyboardType="numeric"
                          placeholder="10:00"
                          placeholderTextColor="#5C5C5C"
                          maxLength={5}
                        />
                        <TouchableOpacity
                          style={[styles.pasoBtn, { backgroundColor: '#8A8A8A' }]}
                          onPress={() => confirmarAgenda(detalle)}
                          disabled={pasoBusy}
                          activeOpacity={0.85}
                        >
                          {pasoBusy
                            ? <ActivityIndicator color="#0D0D0D" />
                            : <>
                                <Ionicons name="calendar" size={20} color="#0D0D0D" />
                                <Text style={styles.pasoBtnText}>Confirmar el día</Text>
                              </>}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.pasoGhost} onPress={() => setAgendando(false)} activeOpacity={0.8}>
                          <Text style={styles.pasoGhostText}>Cancelar</Text>
                        </TouchableOpacity>
                      </>
                    ) : detalle.estado === 'aceptado' ? (
                      <>
                        <Text style={styles.pasoTitulo}>Te dijeron que sí</Text>
                        <Text style={styles.pasoSub}>
                          Poné el día y la hora: el cliente lo ve en el mismo link que ya tiene.
                        </Text>
                        <TouchableOpacity
                          style={[styles.pasoBtn, { backgroundColor: '#8A8A8A' }]}
                          onPress={abrirAgenda}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="calendar" size={20} color="#0D0D0D" />
                          <Text style={styles.pasoBtnText}>Agendar la visita</Text>
                        </TouchableOpacity>
                      </>
                    ) : detalle.estado === 'agendado' ? (
                      <>
                        <Text style={styles.pasoTitulo}>
                          {detalle.agendado_para ? cuandoLargo(detalle.agendado_para) : 'Sin día todavía'}
                        </Text>
                        <Text style={styles.pasoSub}>
                          Cuando salgas, tocá el botón: le llega el código para la puerta y te va a
                          poder seguir en el mapa hasta que llegues.
                        </Text>
                        <TouchableOpacity
                          style={[styles.pasoBtn, { backgroundColor: '#FFD600' }]}
                          onPress={() => salir(detalle)}
                          disabled={pasoBusy}
                          activeOpacity={0.85}
                        >
                          {pasoBusy
                            ? <ActivityIndicator color="#0D0D0D" />
                            : <>
                                <Ionicons name="car" size={20} color="#0D0D0D" />
                                <Text style={styles.pasoBtnText}>Voy en camino</Text>
                              </>}
                        </TouchableOpacity>
                        {!!detalle.agendado_para && (
                          <TouchableOpacity
                            style={[styles.pasoBtn, { backgroundColor: '#8A8A8A' }]}
                            onPress={() => avisar(detalle, mensajeAgendado({
                              empresa,
                              dia:  diaLargo(detalle.agendado_para),
                              hora: formatHour(detalle.agendado_para),
                            }))}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="logo-whatsapp" size={20} color="#0D0D0D" />
                            <Text style={styles.pasoBtnText}>Avisarle el día</Text>
                          </TouchableOpacity>
                        )}
                        <View style={styles.pasoGhostRow}>
                          <TouchableOpacity style={[styles.pasoGhost, { flex: 1 }]} onPress={abrirAgenda} activeOpacity={0.8}>
                            <Text style={styles.pasoGhostText}>Cambiar el día</Text>
                          </TouchableOpacity>
                          {/* Muchos van, lo hacen y nunca tocan "voy en camino".
                              Sin esta salida el trabajo queda agendado para siempre. */}
                          <TouchableOpacity
                            style={[styles.pasoGhost, { flex: 1 }]}
                            onPress={() => terminar(detalle)}
                            disabled={pasoBusy}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.pasoGhostText, { color: '#FFD600' }]}>Ya lo hice</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : detalle.estado === 'en_camino' ? (
                      <>
                        {/* Con la ventana abierta está yendo. Cuando toca
                            "Llegué" se limpia `en_camino_desde` y lo que queda
                            es terminar el trabajo. */}
                        {detalle.en_camino_desde ? (
                          <>
                            <Text style={styles.pasoTitulo}>Estás yendo</Text>
                            <Text style={styles.pasoSub}>
                              El cliente te está viendo venir en su mapa. Se corta cuando toques “Llegué”.
                            </Text>
                            {!!detalle.codigo && (
                              <View style={styles.codigoBox}>
                                <Text style={styles.codigoLbl}>Tu código</Text>
                                <Text style={styles.codigoNum}>{detalle.codigo}</Text>
                                <Text style={styles.codigoPie}>Mostráselo al cliente en la puerta</Text>
                              </View>
                            )}
                            <TouchableOpacity
                              style={[styles.pasoBtn, { backgroundColor: '#FFD600' }]}
                              onPress={() => llegue(detalle)}
                              disabled={pasoBusy}
                              activeOpacity={0.85}
                            >
                              {pasoBusy
                                ? <ActivityIndicator color="#0D0D0D" />
                                : <>
                                    <Ionicons name="location" size={20} color="#0D0D0D" />
                                    <Text style={styles.pasoBtnText}>Llegué</Text>
                                  </>}
                            </TouchableOpacity>
                            {!!detalle.codigo && (
                              <TouchableOpacity
                                style={[styles.pasoBtn, { backgroundColor: '#8A8A8A' }]}
                                onPress={() => avisar(detalle, mensajeEnCamino({ empresa, codigo: detalle.codigo }))}
                                activeOpacity={0.85}
                              >
                                <Ionicons name="logo-whatsapp" size={20} color="#0D0D0D" />
                                <Text style={styles.pasoBtnText}>Avisarle que salís</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        ) : (
                          <>
                            <Text style={styles.pasoTitulo}>Estás en el trabajo</Text>
                            <Text style={styles.pasoSub}>Cuando termines, tocá acá y el cliente lo ve al toque.</Text>
                            <TouchableOpacity
                              style={[styles.pasoBtn, { backgroundColor: '#FFD600' }]}
                              onPress={() => terminar(detalle)}
                              disabled={pasoBusy}
                              activeOpacity={0.85}
                            >
                              {pasoBusy
                                ? <ActivityIndicator color="#0D0D0D" />
                                : <>
                                    <Ionicons name="checkmark-circle" size={20} color="#0D0D0D" />
                                    <Text style={styles.pasoBtnText}>Trabajo terminado</Text>
                                  </>}
                            </TouchableOpacity>
                            {/* Un trabajo de varios días son varios viajes, y
                                cada uno lleva su propio código. */}
                            <TouchableOpacity
                              style={styles.pasoGhost}
                              onPress={() => salir(detalle)}
                              disabled={pasoBusy}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.pasoGhostText}>Vuelvo otro día · nuevo código</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <Text style={styles.pasoTitulo}>
                          Terminado{detalle.hecho_at ? ` el ${fecha(detalle.hecho_at)}` : ''}
                        </Text>
                        <Text style={styles.pasoSub}>
                          Una recomendación de este cliente te trae el próximo trabajo.
                        </Text>
                        <TouchableOpacity
                          style={[styles.pasoBtn, { backgroundColor: '#8A8A8A' }]}
                          onPress={() => avisar(detalle, mensajeHecho({ empresa }))}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="logo-whatsapp" size={20} color="#0D0D0D" />
                          <Text style={styles.pasoBtnText}>Pedirle que te recomiende</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.pasoGhost}
                          onPress={() => { setDetalle(null); setShowNuevo(true); }}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="document-text-outline" size={17} color="#FFD600" />
                          <Text style={[styles.pasoGhostText, { color: '#FFD600' }]}>Hacerle otro presupuesto</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}

                <TouchableOpacity style={styles.waBtn} onPress={() => { enviarWhatsApp(detalle); setDetalle(null); }} activeOpacity={0.85}>
                  <Ionicons name="logo-whatsapp" size={20} color="#0D0D0D" />
                  <Text style={styles.waBtnText}>
                    {detalle.estado === 'borrador' ? 'Enviar por WhatsApp' : 'Volver a enviar'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.ghostBtn} onPress={() => copiarLink(detalle)} activeOpacity={0.8}>
                  <Ionicons name="link-outline" size={17} color="#FFD600" />
                  <Text style={styles.ghostBtnText}>Copiar link</Text>
                </TouchableOpacity>

                {/* La mayoría de los clientes contestan por teléfono o por
                    WhatsApp, no tocando el botón del link. Sin esto el
                    presupuesto quedaba en "visto" para siempre, y un trabajo
                    cerrado figuraba como perdido. */}
                {/* `vencido` va incluido a propósito: que la app lo haya dado
                    por muerto a los 21 días no puede dejar al profesional sin
                    poder marcarlo si el cliente aparece al mes. Nada queda
                    trabado, tampoco para el otro lado. */}
                {['enviado', 'visto', 'vencido'].includes(detalle.estado) && (
                  <>
                    <Text style={styles.respuestaHint}>
                      {detalle.estado === 'vencido' ? '¿Al final apareció?' : '¿Te contestó por otro lado?'}
                    </Text>
                    <View style={styles.respuestaRow}>
                      <TouchableOpacity
                        style={[styles.respuestaBtn, { borderColor: '#FFD60055' }]}
                        onPress={() => responder(detalle, true)}
                        activeOpacity={0.8}>
                        <Ionicons name="checkmark-circle" size={17} color="#FFD600" />
                        <Text style={[styles.respuestaBtnText, { color: '#FFD600' }]}>Lo aceptó</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.respuestaBtn, { borderColor: '#E5484D55' }]}
                        onPress={() => responder(detalle, false)}
                        activeOpacity={0.8}>
                        <Ionicons name="close-circle" size={17} color="#E5484D" />
                        <Text style={[styles.respuestaBtnText, { color: '#E5484D' }]}>No va</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                <TouchableOpacity style={styles.borrarBtn} onPress={() => borrar(detalle)} activeOpacity={0.7}>
                  <Text style={styles.borrarText}>Borrar presupuesto</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

  payBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFD600', padding: 14, borderRadius: 20, marginBottom: 12,
  },
  payBannerTitle: { color: '#0D0D0D', fontWeight: '600', fontSize: 16 },

  // "Te aceptaron un presupuesto" — lo que pasó mientras la app estaba cerrada.
  avisoBox:    { backgroundColor: '#0d1a11', borderWidth: 1, borderColor: '#FFD60055',
                 borderRadius: 20, padding: 14, marginBottom: 12, gap: 9 },
  avisoTop:    { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avisoTitulo: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  avisoFila:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 gap: 10, backgroundColor: '#161616', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 12 },
  avisoTexto:  { flex: 1, color: '#ccc', fontSize: 14, fontWeight: '700' },
  avisoMonto:  { color: '#FFD600', fontSize: 14, fontWeight: '700' },
  avisoPie:    { color: '#8A8A8A', fontSize: 14, textAlign: 'center' },

  // "Esperando respuesta" — perseguir a los 3 días, cerrar a los 7.
  // Naranja tenue y no verde: no es una buena noticia todavía, es algo por
  // hacer. Y no rojo: nadie se murió porque un cliente tarde en contestar.
  espBox:    { backgroundColor: '#1a1206', borderWidth: 1, borderColor: '#8A8A8A55',
               borderRadius: 20, padding: 14, marginBottom: 12, gap: 9 },
  espTop:    { flexDirection: 'row', alignItems: 'center', gap: 9 },
  espTitulo: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  espFila:    { backgroundColor: '#161616', borderRadius: 20, padding: 11, gap: 8 },
  espFilaTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  espTexto:   { flex: 1, color: '#ccc', fontSize: 14, fontWeight: '700' },
  espCerrar:  { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  espDias:    { color: '#5C5C5C', fontSize: 12 },
  espSub:     { flex: 1, color: '#8A8A8A', fontSize: 14 },

  espAcciones: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  espWa:       { flexDirection: 'row', alignItems: 'center', gap: 6,
                 backgroundColor: '#8A8A8A', borderRadius: 20,
                 paddingVertical: 8, paddingHorizontal: 12 },
  espWaText:   { color: '#0D0D0D', fontSize: 14, fontWeight: '700' },
  espMas:      { paddingHorizontal: 4, paddingVertical: 6 },

  // Los tres del cierre: entran los tres en una línea, así que el texto es
  // corto a propósito.
  espBotones:  { flexDirection: 'row', gap: 7 },
  espChip:     { flex: 1, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: '#0D0D0D', borderWidth: 1, borderRadius: 999,
                 paddingVertical: 10, paddingHorizontal: 4 },
  espChipText: { fontSize: 14, fontWeight: '600' },

  espPie: { color: '#8A8A8A', fontSize: 14, textAlign: 'center', lineHeight: 17 },
  payBannerSub:   { color: '#0D0D0D', fontSize: 14, opacity: 0.8, marginTop: 2 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, marginBottom: 12,
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
  profileName: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  profileEmpresa: { fontSize: 14, color: '#8A8A8A', marginBottom: 6 },
  levelBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  levelText: { fontSize: 12, fontWeight: '600' },
  commBox: { alignItems: 'center' },
  commPct: { fontSize: 22, fontWeight: '700' },
  commLabel: { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8 },

  voltCard: {
    flexDirection: 'row', gap: 12,
    marginBottom: 12, padding: 14,
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

  pasoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,214,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)',
    borderRadius: 20, padding: 14, marginBottom: 12,
  },
  pasoText: { flex: 1, color: '#e8e8e8', fontSize: 14, lineHeight: 18 },

  availCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 14, padding: 14,
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
    // El paddingBottom NO va acá: se calcula en el uso con el alto real de la
    // barra del sistema (Math.max(insets.bottom, iOS 34)). Si lo dejamos
    // también acá quedan dos valores que se contradicen y el próximo que toque
    // esto va a cambiar el que no manda (gana el inline).
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

  // Cinco pestañas: la fila scrollea en horizontal.
  tabsScroll: { marginBottom: 14 },
  tabs: {
    flexDirection: 'row', gap: 6,
    backgroundColor: '#161616', borderRadius: 999,
    padding: 4,
  },
  tab:           { paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', borderRadius: 999 },
  tabActive:     { backgroundColor: '#FFD600' },
  tabText:       { fontSize: 16, fontWeight: '700', color: '#5C5C5C' },
  tabTextActive: { color: '#0D0D0D' },

  nuevoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 22,
  },
  nuevoBtnText: { color: '#0D0D0D', fontSize: 17.5, fontWeight: '700' },
  nuevoHint: { color: '#5C5C5C', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 16 },

  statsCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 20, padding: 18, marginBottom: 16,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statVal:  { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  statLbl:  { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8 },
  statDiv:  { width: 1, height: 36, backgroundColor: '#1E1E1E' },

  card: {
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  numero:  { color: '#5C5C5C', fontSize: 14, fontWeight: '600' },
  cliente: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: '700' },

  desc: { color: '#999', fontSize: 14, lineHeight: 18 },

  vioBox: { backgroundColor: '#8A8A8A14', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, marginTop: 9 },
  vioText: { color: '#8A8A8A', fontSize: 14, fontWeight: '600' },

  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  fecha: { color: '#444', fontSize: 14, flex: 1 },
  total: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  emptyWrap: { alignItems: 'center', paddingVertical: 56, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#5C5C5C' },
  emptyText:  { fontSize: 16, color: '#444', textAlign: 'center', lineHeight: 20, maxWidth: 300 },

  // Link a la ayuda: chico y gris, no compite con nada de la pantalla.
  ayudaLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 4,
  },
  ayudaLinkText: { fontSize: 14, color: '#8A8A8A', textDecorationLine: 'underline' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 22, maxHeight: '90%',
  },
  sheetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  label: { color: '#ccc', fontSize: 14, fontWeight: '700', marginBottom: 6, marginTop: 12 },
  valor: { color: '#999', fontSize: 16, lineHeight: 20 },
  valorTotal: { color: '#FFD600', fontSize: 24, fontWeight: '700' },
  vistoAt: { color: '#8A8A8A', fontSize: 14, fontWeight: '700', marginTop: 14 },

  waBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: '#8A8A8A', borderRadius: 999, paddingVertical: 17, marginTop: 20,
  },
  waBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 999, paddingVertical: 15, marginTop: 10,
  },
  ghostBtnText: { color: '#FFD600', fontSize: 16, fontWeight: '600' },

  // ── El trabajo después del sí: un solo botón grande por vez ───────────────
  cardPaso:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 },
  cardPasoText: { flex: 1, fontSize: 14, fontWeight: '600' },

  pasoBox: {
    marginTop: 20, padding: 16, gap: 10,
    backgroundColor: '#161616', borderRadius: 20,
    },
  pasoTitulo: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  pasoSub:    { color: '#8A8A8A', fontSize: 14, lineHeight: 18 },
  pasoLabel:  { color: '#ccc', fontSize: 14, fontWeight: '700', marginTop: 2 },

  pasoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    borderRadius: 999, paddingVertical: 17,
  },
  pasoBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  pasoGhostRow: { flexDirection: 'row', gap: 10 },
  pasoGhost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 20, paddingVertical: 13,
  },
  pasoGhostText: { color: '#ccc', fontSize: 14, fontWeight: '600' },

  diasRow:        { flexDirection: 'row', gap: 8 },
  diaChip: {
    flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 999,
    backgroundColor: '#0D0D0D', },
  diaChipOn:      { backgroundColor: '#8A8A8A', borderColor: '#8A8A8A' },
  diaChipText:    { color: '#999', fontSize: 14, fontWeight: '600' },
  diaChipTextOn:  { color: '#0D0D0D' },
  horaInput: {
    backgroundColor: '#0D0D0D', borderRadius: 20,
    paddingVertical: 13, paddingHorizontal: 14,
    color: '#FFFFFF', fontSize: 19, fontWeight: '600', letterSpacing: 1, textAlign: 'center',
  },

  // El código de la puerta: se tiene que leer de un metro, con el celular en la
  // mano y el cliente mirando.
  codigoBox: {
    backgroundColor: '#151500', borderWidth: 1, borderColor: '#FFD60040',
    borderRadius: 20, paddingVertical: 16, alignItems: 'center', gap: 2,
  },
  codigoLbl: { color: '#5C5C5C', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.8 },
  codigoNum: { color: '#FFD600', fontSize: 40, fontWeight: '700', letterSpacing: 6, textAlign: 'center' },
  codigoPie: { color: '#8A8A8A', fontSize: 14, textAlign: 'center' },

  // Cerrar el presupuesto a mano cuando el cliente contestó por otro lado.
  respuestaHint: { color: '#8A8A8A', fontSize: 14, fontWeight: '700',
                   textAlign: 'center', marginTop: 18, marginBottom: 8 },
  respuestaRow:  { flexDirection: 'row', gap: 10 },
  respuestaBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 7, backgroundColor: '#0D0D0D', borderWidth: 1, borderRadius: 999,
                   paddingVertical: 13 },
  respuestaBtnText: { fontSize: 16, fontWeight: '600' },
  borrarBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  borrarText: { color: '#E5484D', fontSize: 14, fontWeight: '700' },
});

export default MiNegocioScreen;

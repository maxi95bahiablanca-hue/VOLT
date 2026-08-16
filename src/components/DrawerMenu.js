import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Animated, Alert, Linking, Platform, Image, Modal, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabase';
import { abrirAyuda } from '../utils/ayuda';

const ADMIN_EMAILS = ['maxi95.bahiablanca@gmail.com'];

// Antes eran 280 px fijos y el texto largo ("Editar mis oficios y datos")
// llegaba al borde. Ahora acompaña la pantalla, con tope para que en una
// tablet no quede una columna gigante.
const ANCHO = Math.min(340, Math.round(Dimensions.get('window').width * 0.86));

/** Una fila del menú.
 *
 *  🔴 10-ago-2026 — cada ícono venía adentro de un círculo gris de 36 px, que
 *  es el gesto del diseño viejo. Ninguna otra pantalla de la app mete íconos en
 *  círculos: van sueltos, apagados, y el que manda es el texto. */
const Item = ({ icon, label, onPress, badge, dim }) => (
  <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.6}>
    <Ionicons name={icon} size={20} color={dim ? '#3a3a3a' : '#5C5C5C'} />
    <Text style={[styles.itemLabel, dim && styles.itemLabelDim]} numberOfLines={1}>{label}</Text>
    {!!badge && (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge}</Text>
      </View>
    )}
  </TouchableOpacity>
);

const Seccion = ({ children }) => <Text style={styles.seccion}>{children}</Text>;

const DrawerMenu = ({ visible, session, professional, onClose, onNavigate }) => {
  const insets   = useSafeAreaInsets();
  const slideX   = useRef(new Animated.Value(-ANCHO)).current;
  const overlayO = useRef(new Animated.Value(0)).current;
  // El Modal tiene que seguir montado mientras el panel se va deslizando: si
  // se desmonta con `visible`, la animación de salida no se ve nunca.
  const [montado, setMontado] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMontado(true);
      Animated.parallel([
        Animated.spring(slideX,   { toValue: 0, useNativeDriver: true, tension: 70, friction: 12 }),
        Animated.timing(overlayO, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (montado) {
      Animated.parallel([
        Animated.timing(slideX,   { toValue: -ANCHO, duration: 220, useNativeDriver: true }),
        Animated.timing(overlayO, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setMontado(false); });
    }
  }, [visible]);

  if (!montado) return null;

  const isAdmin    = ADMIN_EMAILS.includes(session?.user?.email);
  const email      = session?.user?.email ?? '';
  const name       = session?.user?.user_metadata?.full_name ?? email.split('@')[0];
  const userPhoto  = professional?.avatar_url ?? session?.user?.user_metadata?.avatar_url ?? null;
  const isWorker   = !!professional;
  const isApproved = professional?.verification_status === 'approved';
  const isPending  = professional?.verification_status === 'pending';
  const isRejected = professional?.verification_status === 'rejected';

  const go = (dest) => { onClose(); setTimeout(() => onNavigate(dest), 260); };

  const handleSignOut = () => {
    Alert.alert('¿Cerrar sesión?', '', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  };

  return (
    // Va adentro de un Modal porque el menú se dibuja desde el Home, y la barra
    // de pestañas vive un nivel más arriba: sin esto la tapaba a medias y el
    // panel quedaba cortado abajo, con "Cerrar sesión" fuera de la pantalla.
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: overlayO }]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.drawer, { transform: [{ translateX: slideX }] }]}>
        <View style={{ flex: 1, paddingTop: insets.top + 14, paddingBottom: insets.bottom }}>

          <View style={styles.top}>
            <Text style={styles.logo}>BOLT</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Cerrar el menú">
              <Ionicons name="close" size={22} color="#5C5C5C" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

            {/* La tarjeta del usuario es la puerta al perfil: antes era un
                bloque muerto y "Mi perfil" era una fila más de la lista. */}
            <TouchableOpacity style={styles.usuario} onPress={() => go('profile')} activeOpacity={0.8}>
              <View style={styles.avatar}>
                {userPhoto
                  ? <Image source={{ uri: userPhoto }} style={styles.avatarImg} />
                  : <Ionicons name="person" size={20} color="#5C5C5C" />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.usuarioNombre} numberOfLines={1}>{name}</Text>
                <Text style={styles.usuarioMail} numberOfLines={1}>{email}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#3a3a3a" />
            </TouchableOpacity>

            {/* Alta como trabajador: es la única acción del menú, y por eso es
                la única que se ve como botón. */}
            {!isWorker && (
              <TouchableOpacity style={styles.cta} onPress={() => go('register')} activeOpacity={0.85}>
                <Ionicons name="flash" size={18} color="#0D0D0D" />
                <Text style={styles.ctaTexto}>Trabajar con BOLT</Text>
              </TouchableOpacity>
            )}
            {isPending && (
              <View style={styles.estado}>
                <Ionicons name="time-outline" size={18} color="#FFD600" />
                <Text style={styles.estadoTexto}>Tu solicitud está en revisión</Text>
              </View>
            )}
            {isRejected && (
              <TouchableOpacity style={styles.cta} onPress={() => go('register')} activeOpacity={0.85}>
                <Ionicons name="refresh" size={18} color="#0D0D0D" />
                <Text style={styles.ctaTexto}>Reintentar mi solicitud</Text>
              </TouchableOpacity>
            )}

            {/* "Mis trabajos" es del CLIENTE. El profesional aprobado tiene lo
                mismo —y mejor— en la pestaña Trabajos de Mi negocio. */}
            <Seccion>Lo mío</Seccion>
            {!isApproved && (
              <Item icon="time-outline" label="Mis trabajos" onPress={() => go('history')} />
            )}
            {isApproved && (
              <>
                <Item icon="briefcase-outline" label="Mi negocio" onPress={() => go('miNegocio')} />
                <Item icon="construct-outline" label="Mis oficios y datos" onPress={() => go('register')} />
              </>
            )}
            {isAdmin && (
              <Item icon="shield-checkmark-outline" label="Panel de administración" onPress={() => go('admin')} />
            )}

            {/* Las dos herramientas que sirven aunque hoy no pidas nada. */}
            <Seccion>Herramientas</Seccion>
            <Item icon="calculator-outline" label="Calculadora de materiales" onPress={() => go('calculadora')} />
            <Item icon="bulb-outline" label="Asesoramiento" onPress={() => go('asesoramiento')} />
            {/* 🤝 Pampacryl × BOLT (16-ago-2026): la carta de colores, el probador y el
                pedido con 30% de descuento viven en la web; se abre en el navegador. */}
            <Item icon="color-palette-outline" label="Pinturas con 30% de descuento" onPress={() => go('pinturas')} />

            <Seccion>BOLT</Seccion>
            <Item icon="help-circle-outline" label="Cómo funciona" onPress={() => go('howItWorks')} />
            <Item icon="help-buoy-outline" label="Ayuda" onPress={() => abrirAyuda()} />
            <Item icon="chatbubble-ellipses-outline" label="Soporte"
              onPress={() => Linking.openURL('mailto:soporte@bolt.com.ar')} />
            <Item icon="document-text-outline" label="Política de privacidad" onPress={() => go('privacy')} />

            <TouchableOpacity style={styles.salir} onPress={handleSignOut} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={19} color="#E5484D" />
              <Text style={styles.salirTexto}>Cerrar sesión</Text>
            </TouchableOpacity>

            <Text style={styles.version}>BOLT v1.0 · Bahía Blanca</Text>
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  drawer: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    width: ANCHO,
    backgroundColor: '#0D0D0D',
    borderRightWidth: 1, borderRightColor: '#1a1a1a',
  },

  top: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 18,
  },
  logo: { fontSize: 17, fontWeight: '700', color: '#FFD600', letterSpacing: 4 },
  closeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 14, paddingBottom: 24 },

  usuario: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#161616', borderRadius: 20, padding: 14, marginBottom: 12,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 999, overflow: 'hidden',
    backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  usuarioNombre: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginBottom: 2 },
  usuarioMail:   { fontSize: 13, color: '#5C5C5C' },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: '#FFD600', borderRadius: 999, paddingVertical: 14, marginBottom: 4,
  },
  ctaTexto: { fontSize: 15, fontWeight: '600', color: '#0D0D0D' },

  estado: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,214,0,0.06)', borderRadius: 16,
    paddingVertical: 13, paddingHorizontal: 14, marginBottom: 4,
  },
  estadoTexto: { flex: 1, fontSize: 14, color: '#8A8A8A' },

  seccion: {
    fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase',
    color: '#3a3a3a', fontWeight: '600',
    paddingHorizontal: 6, marginTop: 22, marginBottom: 6,
  },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 13, paddingHorizontal: 6, borderRadius: 14,
  },
  itemLabel:    { flex: 1, fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  itemLabelDim: { color: '#3a3a3a' },

  badge: { backgroundColor: '#1E1E1E', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 12, color: '#8A8A8A', fontWeight: '600' },

  salir: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 15, paddingHorizontal: 6, marginTop: 26,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  salirTexto: { color: '#E5484D', fontSize: 15, fontWeight: '600' },

  version: { fontSize: 12, color: '#242424', paddingHorizontal: 6, marginTop: 14 },
});

export default DrawerMenu;

import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, SafeAreaView, Alert, Linking, Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const ADMIN_EMAILS = ['maxi95.bahiablanca@gmail.com'];
const DRAWER_W = 280;

const Item = ({ icon, label, onPress, highlight, badge, dim }) => (
  <TouchableOpacity
    style={[styles.item, highlight && styles.itemHighlight]}
    onPress={onPress}
    activeOpacity={0.75}
  >
    <View style={[styles.itemIcon, highlight && styles.itemIconHL]}>
      <Ionicons name={icon} size={20} color={highlight ? '#0A0A0A' : dim ? '#333' : '#888'} />
    </View>
    <Text style={[styles.itemLabel, highlight && styles.itemLabelHL, dim && styles.itemLabelDim]}>
      {label}
    </Text>
    {badge && (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge}</Text>
      </View>
    )}
  </TouchableOpacity>
);

const DrawerMenu = ({ visible, session, professional, onClose, onNavigate }) => {
  const slideX   = useRef(new Animated.Value(-DRAWER_W)).current;
  const overlayO = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideX,   { toValue: 0, useNativeDriver: true, tension: 70, friction: 12 }),
        Animated.timing(overlayO, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideX,   { toValue: -DRAWER_W, duration: 220, useNativeDriver: true }),
        Animated.timing(overlayO, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible && slideX._value === -DRAWER_W) return null;

  const isAdmin   = ADMIN_EMAILS.includes(session?.user?.email);
  const email     = session?.user?.email ?? '';
  const name      = session?.user?.user_metadata?.full_name ?? email.split('@')[0];
  const userPhoto = professional?.avatar_url ?? session?.user?.user_metadata?.avatar_url ?? null;
  const isWorker = !!professional;
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
    <>
      {/* Overlay oscuro */}
      <Animated.View
        style={[styles.overlay, { opacity: overlayO }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      {/* Panel */}
      <Animated.View style={[styles.drawer, { transform: [{ translateX: slideX }] }]}>
        <SafeAreaView style={{ flex: 1 }}>

          {/* Header */}
          <View style={styles.drawerHeader}>
            <Text style={styles.logo}>BOLT</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#555" />
            </TouchableOpacity>
          </View>

          {/* Usuario */}
          <View style={styles.userRow}>
            <View style={styles.userAvatar}>
              {userPhoto
                ? <Image source={{ uri: userPhoto }} style={styles.userAvatarImg} />
                : <Ionicons name="person" size={22} color="#FFD600" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{name}</Text>
              <Text style={styles.userEmail} numberOfLines={1}>{email}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Items principales */}
          <Item icon="person-outline"   label="Mi perfil"    onPress={() => go('profile')} />
          <Item icon="time-outline"     label="Mis trabajos" onPress={() => go('history')} />

          {/* Solo para no-trabajadores */}
          {!isWorker && (
            <Item icon="flash" label="Trabajar con BOLT" highlight onPress={() => go('register')} />
          )}

          {/* Estado solicitud pendiente */}
          {isPending && (
            <Item icon="time" label="Mi solicitud" badge="En revisión" dim onPress={() => go('register')} />
          )}

          {/* Solicitud rechazada */}
          {isRejected && (
            <Item icon="refresh-outline" label="Reintentar solicitud" badge="Rechazada" onPress={() => go('register')} />
          )}

          {/* Panel trabajador aprobado */}
          {isApproved && (
            <Item icon="briefcase-outline" label="Mi panel de trabajador" onPress={() => go('workerPanel')} />
          )}

          {/* Ya aprobado: única entrada para cambiar oficios/datos, porque
              "Trabajar con BOLT" se oculta apenas sos trabajador. */}
          {isApproved && (
            <Item icon="construct-outline" label="Editar mis oficios y datos" onPress={() => go('register')} />
          )}

          {/* Admin */}
          {isAdmin && (
            <Item icon="shield-outline" label="Panel de administración" onPress={() => go('admin')} />
          )}

          <View style={styles.divider} />

          <Item icon="help-circle-outline" label="Cómo funciona BOLT" onPress={() => go('howItWorks')} />
          <Item icon="shield-outline" label="Política de privacidad" onPress={() => go('privacy')} />
          <Item icon="chatbubble-ellipses-outline" label="Soporte"
            onPress={() => Linking.openURL('mailto:soporte@bolt.com.ar')} />

          {/* Spacer */}
          <View style={{ flex: 1 }} />

          {/* Sign out */}
          <TouchableOpacity style={styles.signOut} onPress={handleSignOut} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={18} color="#ff4444" />
            <Text style={styles.signOutText}>Cerrar sesión</Text>
          </TouchableOpacity>

          <Text style={styles.version}>BOLT v1.0</Text>

        </SafeAreaView>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 30,
  },
  drawer: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    width: DRAWER_W,
    backgroundColor: '#0D0D0D',
    borderRightWidth: 1, borderRightColor: '#1a1a1a',
    zIndex: 40,
    paddingTop: Platform.OS === 'android' ? 24 : 0,
  },

  drawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  logo: { fontSize: 22, fontWeight: '900', color: '#FFD600', letterSpacing: 4 },
  closeBtn: { padding: 4 },

  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingBottom: 16,
  },
  userAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1A1A1A', borderWidth: 1.5, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatarImg: { width: '100%', height: '100%' },
  userName:  { fontSize: 14, fontWeight: '800', color: '#F5F5F5', marginBottom: 2 },
  userEmail: { fontSize: 11, color: '#555' },

  divider: { height: 1, backgroundColor: '#1a1a1a', marginVertical: 8, marginHorizontal: 20 },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 13, paddingHorizontal: 20,
  },
  itemHighlight: {
    marginHorizontal: 12, marginVertical: 4,
    backgroundColor: '#FFD600', borderRadius: 14,
    paddingHorizontal: 16,
  },
  itemIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#161616',
    alignItems: 'center', justifyContent: 'center',
  },
  itemIconHL: { backgroundColor: 'rgba(0,0,0,0.15)' },
  itemLabel:    { flex: 1, fontSize: 14, color: '#ccc', fontWeight: '600' },
  itemLabelHL:  { color: '#0A0A0A', fontWeight: '900' },
  itemLabelDim: { color: '#444' },

  badge: {
    backgroundColor: '#222', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText: { fontSize: 10, color: '#888', fontWeight: '700' },

  signOut: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  signOutText: { color: '#ff4444', fontSize: 14, fontWeight: '700' },

  version: { textAlign: 'center', fontSize: 11, color: '#1f1f1f', paddingBottom: 8 },
});

export default DrawerMenu;

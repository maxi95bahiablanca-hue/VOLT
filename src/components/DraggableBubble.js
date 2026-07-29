import React, { useRef, useState, useEffect } from 'react';
import { Animated, PanResponder, Dimensions, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: W, height: H } = Dimensions.get('window');
const CLOSE_Y = H - 140; // si soltás la burbuja debajo de esta línea, se cierra

// Burbuja flotante estilo Messenger: se arrastra a cualquier lado, un toque ejecuta
// onPress, y si la soltás abajo se cierra (queda una pestañita para reabrirla).
export default function DraggableBubble({
  icon = 'navigate',
  onPress,
  badgeCount = 0,
  dotColor,                 // puntito de estado (opcional)
  deadline,                 // ms epoch: si viene, la burbuja muestra el tiempo que falta
  startX = W - 78,
  startY = H - 230,
}) {
  const pos = useRef(new Animated.ValueXY({ x: startX, y: startY })).current;
  const moved = useRef(false);
  // El reloj corre acá adentro para que el tick de cada segundo no vuelva a
  // dibujar la pantalla entera (el home tiene el mapa).
  const [left, setLeft] = useState(() => (deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : 0));
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  const reloj = left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}s`;
  const [closed, setClosed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overClose, setOverClose] = useState(false);

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
    onPanResponderGrant: () => { moved.current = false; setDragging(true); pos.extractOffset(); },
    onPanResponderMove: (e, g) => {
      if (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5) moved.current = true;
      pos.setValue({ x: g.dx, y: g.dy });
      const near = g.moveY > CLOSE_Y;
      setOverClose(prev => (prev !== near ? near : prev));
    },
    onPanResponderRelease: (e, g) => {
      pos.flattenOffset();
      setDragging(false);
      setOverClose(false);
      if (!moved.current) { onPress?.(); return; }   // fue un toque → abrir
      if (g.moveY > CLOSE_Y) setClosed(true);          // se soltó abajo → cerrar
    },
  })).current;

  // Cerrada → pestañita en el borde derecho para reabrir fácil
  if (closed) {
    return (
      <TouchableOpacity style={styles.reopenTab} onPress={() => setClosed(false)} activeOpacity={0.85}>
        <Ionicons name={icon} size={20} color="#0A0A0A" />
        {badgeCount > 0 && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text></View>}
      </TouchableOpacity>
    );
  }

  return (
    <>
      {/* Zona de "soltar para cerrar" (solo mientras arrastrás) */}
      {dragging && (
        <View style={[styles.closeZone, overClose && styles.closeZoneActive]} pointerEvents="none">
          <Ionicons name="close" size={overClose ? 30 : 24} color={overClose ? '#0A0A0A' : '#FFD600'} />
        </View>
      )}
      <Animated.View
        style={[styles.bubble, overClose && styles.bubbleOverClose, { transform: pos.getTranslateTransform() }]}
        {...responder.panHandlers}
      >
        <Ionicons name={icon} size={deadline ? 18 : 24} color="#0A0A0A" />
        {deadline > 0 && (
          <Text style={styles.clock}>{left > 0 ? reloj : 'ver'}</Text>
        )}
        {dotColor && <View style={[styles.dot, { backgroundColor: dotColor }]} />}
        {badgeCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text></View>}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute', top: 0, left: 0, zIndex: 600,
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  bubbleOverClose: { opacity: 0.5, transform: [{ scale: 0.9 }] },
  clock: { color: '#0A0A0A', fontSize: 11, fontWeight: '900', marginTop: 1 },
  dot: {
    position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: 7,
    borderWidth: 2, borderColor: '#FFD600',
  },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 21, height: 21, borderRadius: 11,
    backgroundColor: '#ff4444', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5, borderWidth: 2, borderColor: '#0A0A0A',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  closeZone: {
    position: 'absolute', bottom: 40, alignSelf: 'center', left: W / 2 - 32, zIndex: 590,
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,214,0,0.18)',
    borderWidth: 1.5, borderColor: 'rgba(255,214,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeZoneActive: { backgroundColor: '#FFD600', borderColor: '#FFD600', width: 74, height: 74, borderRadius: 37, bottom: 35, left: W / 2 - 37 },
  reopenTab: {
    position: 'absolute', right: 0, top: H * 0.55, zIndex: 600,
    width: 38, height: 46, borderTopLeftRadius: 14, borderBottomLeftRadius: 14,
    backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center',
    elevation: 10, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: -2, height: 2 },
  },
  tabBadge: {
    position: 'absolute', top: -4, left: -6, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#ff4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: '#0A0A0A',
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
});

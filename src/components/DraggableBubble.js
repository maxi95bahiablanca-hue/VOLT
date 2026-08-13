import React, { useRef, useState, useEffect } from 'react';
import { Animated, PanResponder, Dimensions, StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const { width: W, height: H } = Dimensions.get('window');
const TAM      = 60;
const MARGEN   = 12;
const CLOSE_Y  = H - 140;                 // soltarla acá abajo la guarda en la pestañita
const TOPE_ARRIBA = Platform.OS === 'android' ? 88 : 64;   // no tapar el header
const TOPE_ABAJO  = H - 120;              // no tapar la barra de navegación del sistema

const dentro = (x, y) => ({
  x: Math.min(W - TAM - MARGEN, Math.max(MARGEN, x)),
  y: Math.min(TOPE_ABAJO, Math.max(TOPE_ARRIBA, y)),
});

/** Pin flotante estilo Messenger: se arrastra a donde el usuario quiera, un
 *  toque abre lo que sea que esté en curso, y si lo soltás abajo se guarda en
 *  una pestañita del borde.
 *
 *  🔴 8-ago-2026 — dos cosas que le faltaban y Maxi pidió: **que se acuerde de
 *  dónde lo dejaste** (antes volvía a la esquina en cada pantalla y en cada
 *  arranque) y **que no moleste**: al soltarlo se pega al borde más cercano y
 *  nunca queda encima del header ni de la barra del sistema.
 */
export default function DraggableBubble({
  icon = 'navigate',
  onPress,
  badgeCount = 0,
  dotColor,                 // puntito de estado (opcional)
  deadline,                 // ms epoch: si viene, el pin muestra el tiempo que falta
  storageKey,               // dónde recordar la posición; sin esto no se guarda
  startX = W - TAM - MARGEN,
  // 🔴 Arrancaba en H-230 y con el panel del home (372) quedaba justo encima de
  //    la fila de oficios, tapando un chip entero (Maxi, 9-ago-2026). A media
  //    pantalla no pisa ni el header ni el panel; igual el usuario lo mueve.
  startY = Math.round(H * 0.46),
}) {
  const inicial = dentro(startX, startY);
  const pos = useRef(new Animated.ValueXY(inicial)).current;
  const posRef = useRef(inicial);
  const moved = useRef(false);

  // Volver a donde lo dejó el usuario. Se hace en un efecto (no en el estado
  // inicial) porque AsyncStorage es asincrónico; hasta que responde se ve en el
  // lugar por defecto, que es el mismo en el 99% de los casos.
  useEffect(() => {
    if (!storageKey) return;
    let vivo = true;
    AsyncStorage.getItem(storageKey)
      .then(txt => {
        if (!vivo || !txt) return;
        const g = JSON.parse(txt);
        if (typeof g?.x !== 'number' || typeof g?.y !== 'number') return;
        const p = dentro(g.x, g.y);          // por si cambió el tamaño de pantalla
        posRef.current = p;
        pos.setValue(p);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [storageKey]);

  const guardar = (p) => {
    if (!storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(p)).catch(() => {});
  };

  // El reloj corre acá adentro para que el tick de cada segundo no vuelva a
  // dibujar la pantalla entera (el home tiene el mapa).
  const [left, setLeft] = useState(() => (deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : 0));
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  const reloj = left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}s`;

  const [closed, setClosed]     = useState(false);
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
      if (g.moveY > CLOSE_Y) { setClosed(true); return; }

      // Se pega al borde más cercano: suelto en el medio tapa contenido, y
      // apoyado contra un costado casi no estorba.
      const x = posRef.current.x + g.dx;
      const y = posRef.current.y + g.dy;
      const destino = dentro(
        (x + TAM / 2) < W / 2 ? MARGEN : W - TAM - MARGEN,
        y
      );
      posRef.current = destino;
      guardar(destino);
      Animated.spring(pos, {
        toValue: destino,
        useNativeDriver: false,
        bounciness: 6,
        speed: 16,
      }).start();
    },
  })).current;

  // Guardada → pestañita en el borde derecho para volver a sacarla
  if (closed) {
    return (
      <TouchableOpacity style={styles.reopenTab} onPress={() => setClosed(false)} activeOpacity={0.85}>
        <Ionicons name={icon} size={20} color="#0D0D0D" />
        {badgeCount > 0 && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text></View>}
      </TouchableOpacity>
    );
  }

  return (
    <>
      {/* Zona de "soltar para guardar" (solo mientras arrastrás) */}
      {dragging && (
        <View style={[styles.closeZone, overClose && styles.closeZoneActive]} pointerEvents="none">
          <Ionicons name="chevron-down" size={overClose ? 30 : 24} color={overClose ? '#0D0D0D' : '#FFD600'} />
        </View>
      )}
      <Animated.View
        style={[styles.bubble, overClose && styles.bubbleOverClose, { transform: pos.getTranslateTransform() }]}
        accessibilityRole="button"
        accessibilityLabel="Volver al trabajo en curso"
        {...responder.panHandlers}
      >
        <Ionicons name={icon} size={deadline ? 18 : 24} color="#0D0D0D" />
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
    width: TAM, height: TAM, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  bubbleOverClose: { opacity: 0.5, transform: [{ scale: 0.9 }] },
  clock: { color: '#0D0D0D', fontSize: 12, fontWeight: '700', marginTop: 1 },
  dot: {
    position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: 999,
    borderWidth: 2, borderColor: '#FFD600',
  },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 21, height: 21, borderRadius: 999,
    backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#FFD600', fontSize: 12, fontWeight: '700' },
  closeZone: {
    position: 'absolute', bottom: 40, alignSelf: 'center', left: W / 2 - 32, zIndex: 590,
    width: 64, height: 64, borderRadius: 999, backgroundColor: 'rgba(255,214,0,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeZoneActive: { backgroundColor: '#FFD600', width: 74, height: 74, borderRadius: 999, bottom: 35, left: W / 2 - 37 },
  reopenTab: {
    position: 'absolute', right: 0, top: H * 0.55, zIndex: 600,
    width: 38, height: 46, borderTopLeftRadius: 999, borderBottomLeftRadius: 999,
    backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center',
    elevation: 10, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: -2, height: 2 },
  },
  tabBadge: {
    position: 'absolute', top: -4, left: -6, minWidth: 18, height: 18, borderRadius: 999,
    backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeText: { color: '#FFD600', fontSize: 12, fontWeight: '700' },
});

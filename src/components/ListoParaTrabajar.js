import React, { useEffect, useRef } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, Animated, Easing, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

/**
 * "Estás listo para recibir trabajos"
 *
 * De 10 profesionales aprobados, 8 tenían el radar apagado (1-ago-2026). No es
 * que no quisieran trabajar: el botón para prenderlo vive dentro de un panel que
 * hay que desplegar, y nadie lo encontró. Quedaban invisibles para los clientes
 * sin enterarse.
 *
 * Por eso esto aparece SOLO y ocupa la pantalla. No es un cartelito más: es el
 * último paso del alta, puesto donde no se puede pasar de largo.
 *
 * Se puede cerrar —el que quiera estar en pausa tiene derecho a estarlo— pero
 * vuelve a aparecer la próxima vez que abra la app mientras siga apagado.
 */
const ListoParaTrabajar = ({ visible, nombre, onActivar, onAhoraNo, activando }) => {
  const pulso  = useRef(new Animated.Value(0)).current;
  const entrar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { entrar.setValue(0); return; }

    Animated.timing(entrar, {
      toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulso, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible]);

  const primero = nombre ? String(nombre).trim().split(/\s+/)[0] : '';

  return (
    <Modal visible={!!visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onAhoraNo}>
      <View style={s.fondo}>
        <Animated.View
          style={[
            s.tarjeta,
            {
              opacity: entrar,
              transform: [{ translateY: entrar.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            },
          ]}
        >
          {/* El rayo con las ondas del radar */}
          <View style={s.iconoWrap}>
            {[0, 1].map((i) => (
              <Animated.View
                key={i}
                style={[
                  s.onda,
                  {
                    opacity: pulso.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                    transform: [{ scale: pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1 + i * 0.4] }) }],
                  },
                ]}
              />
            ))}
            <View style={s.iconoCirculo}>
              <Ionicons name="flash" size={34} color="#0A0908" />
            </View>
          </View>

          <Text style={s.titulo}>
            {primero ? `${primero}, ya estás aprobado` : 'Ya estás aprobado'}
          </Text>
          <Text style={s.bajada}>
            Falta una sola cosa para que te lleguen trabajos:{'\n'}
            <Text style={s.bajadaFuerte}>ponerte disponible.</Text>
          </Text>

          <View style={s.explica}>
            <View style={s.fila}>
              <Ionicons name="eye-off-outline" size={17} color="#8A8377" />
              <Text style={s.filaTexto}>Ahora los clientes no te ven en el mapa</Text>
            </View>
            <View style={s.divisor} />
            <View style={s.fila}>
              <Ionicons name="notifications" size={17} color="#FFD600" />
              <Text style={[s.filaTexto, s.filaTextoOn]}>Con esto activado, te suenan los pedidos de tu zona</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[s.btn, activando && s.btnOff]}
            onPress={onActivar}
            disabled={activando}
            activeOpacity={0.85}
          >
            <Ionicons name="radio" size={20} color="#0A0908" />
            <Text style={s.btnTexto}>{activando ? 'Activando...' : 'Ponerme disponible'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onAhoraNo} style={s.secundario} hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}>
            <Text style={s.secundarioTexto}>Ahora no</Text>
          </TouchableOpacity>

          <Text style={s.pie}>Lo apagás cuando quieras desde la pantalla principal.</Text>
        </Animated.View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  fondo: {
    flex: 1, backgroundColor: 'rgba(6,5,4,0.92)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  tarjeta: {
    width: Math.min(width - 40, 380),
    backgroundColor: '#151310',
    borderRadius: 26, paddingVertical: 32, paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.16)',
    shadowColor: '#FFD600', shadowOpacity: 0.14, shadowRadius: 26, shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  iconoWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  onda: {
    position: 'absolute', width: 68, height: 68, borderRadius: 999,
    borderWidth: 1.5, borderColor: '#FFD600',
  },
  iconoCirculo: {
    width: 68, height: 68, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  titulo: {
    color: '#F7F5F0', fontSize: 22, fontWeight: '700',
    textAlign: 'center', letterSpacing: -0.4,
  },
  bajada: {
    color: '#A8A196', fontSize: 16, lineHeight: 22,
    textAlign: 'center', marginTop: 10,
  },
  bajadaFuerte: { color: '#FFD600', fontWeight: '600' },

  explica: {
    width: '100%', backgroundColor: '#1C1917', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 14, marginTop: 22,
  },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 },
  filaTexto: { flex: 1, color: '#8A8377', fontSize: 14, lineHeight: 19 },
  filaTextoOn: { color: '#D6D0C4' },
  divisor: { height: 1, backgroundColor: '#242019' },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    width: '100%', backgroundColor: '#FFD600', borderRadius: 999,
    paddingVertical: 17, marginTop: 22,
  },
  btnOff: { opacity: 0.55 },
  btnTexto: { color: '#0A0908', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  secundario: { marginTop: 16, paddingVertical: 4 },
  secundarioTexto: { color: '#6E685E', fontSize: 16, fontWeight: '600' },

  pie: { color: '#544F47', fontSize: 12, textAlign: 'center', marginTop: 14 },
});

export default ListoParaTrabajar;

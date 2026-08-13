import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** La barra de abajo.
 *
 *  Hasta hoy toda la navegación vivía en el menú lateral: para ver tus pedidos
 *  o tus chats había que abrir la hamburguesa y acordarse de que estaban ahí.
 *  Cuatro pestañas a la vista dicen lo que la app hace sin que nadie tenga que
 *  buscarlo.
 *
 *  Las pestañas cambian con el modo, porque el trabajo no es el mismo: el
 *  cliente tiene "Pedidos" (lo que pidió) y el profesional "Trabajos" (lo que
 *  tomó). Las otras tres son iguales para los dos.
 */
const TABS_CLIENTE = [
  { key: 'home',   icon: 'home-outline',              activo: 'home',              label: 'Inicio'  },
  { key: 'pedidos',icon: 'calendar-outline',          activo: 'calendar',          label: 'Pedidos' },
  { key: 'chats',  icon: 'chatbubble-outline',        activo: 'chatbubble',        label: 'Chats'   },
  { key: 'cuenta', icon: 'person-outline',            activo: 'person',            label: 'Cuenta'  },
];

const TABS_TRABAJO = [
  { key: 'home',    icon: 'home-outline',             activo: 'home',              label: 'Inicio'   },
  { key: 'negocio', icon: 'briefcase-outline',        activo: 'briefcase',         label: 'Trabajos' },
  { key: 'chats',   icon: 'chatbubble-outline',       activo: 'chatbubble',        label: 'Chats'    },
  { key: 'cuenta',  icon: 'person-outline',           activo: 'person',            label: 'Cuenta'   },
];

export default function TabBar({ tab, modoTrabajo, sinLeer = 0, onChange }) {
  const tabs = modoTrabajo ? TABS_TRABAJO : TABS_CLIENTE;
  // 🔴 9-ago-2026 — la barra quedaba DEBAJO de los tres botones de Android: se
  //    veían los iconos y los nombres tapados por la barra del sistema (Maxi).
  //    El alto de esa barra cambia con el teléfono y con si usa botones o
  //    gestos, así que no se puede poner un número fijo: lo dice el sistema.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.barra, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
      {tabs.map(t => {
        const on = tab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => onChange?.(t.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.key === 'chats' && sinLeer > 0
              ? `${t.label}, ${sinLeer} sin leer`
              : t.label}
          >
            <View>
              <Ionicons name={on ? t.activo : t.icon} size={22} color={on ? '#FFD600' : '#5C5C5C'} />
              {t.key === 'chats' && sinLeer > 0 && (
                <View style={styles.punto}>
                  <Text style={styles.puntoTxt}>{sinLeer > 9 ? '9' : sinLeer}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    paddingTop: 12,
    paddingHorizontal: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 6 },
  label:   { fontSize: 12, color: '#5C5C5C', fontWeight: '500' },
  labelOn: { color: '#FFD600', fontWeight: '600' },
  punto: {
    position: 'absolute', top: -4, right: -8,
    minWidth: 16, height: 16, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  puntoTxt: { fontSize: 10, fontWeight: '700', color: '#0D0D0D' },
});

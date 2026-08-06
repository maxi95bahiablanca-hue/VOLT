// Aplica Inter a TODA la app. Inter es la tipografía de Linear: geométrica,
// angosta y muy limpia en pantalla. Reemplaza a Nunito (que era redondeada).
//
// POR QUÉ EL MAPEO SUBE UN ESCALÓN: React Native pide un peso ('400', '700')
// y acá se traduce a un archivo concreto de Inter. Inter dibuja más FINO y más
// ANGOSTO que Nunito al mismo número, así que si mapeáramos '400'→Regular el
// texto se vería lavado al lado de lo que había. Por eso cada peso sube un
// escalón: '400' cae en SemiBold, '700' en ExtraBold, etc. La jerarquía entre
// títulos y cuerpo se mantiene igual que antes; lo único que cambia es la
// familia.
//
// IMPORTANTE: respeta cualquier texto que YA tenga fontFamily propia (los
// íconos de @expo/vector-icons son <Text> con fontFamily 'Ionicons' → no se
// tocan). Si algún día un estilo define su propia fontFamily, este parche lo
// deja pasar tal cual.
import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';

const WEIGHT_TO_INTER = {
  // 100/200/300: hoy NINGÚN estilo de la app los usa (están los pesos 400 a
  // 900 y nada más). Van a SemiBold, igual que el 400, para no tener que
  // cargar un archivo entero de 335 kB —que cada usuario se baja en el OTA—
  // por un peso que no aparece. Si algún día hace falta texto fino de verdad:
  // sumar Inter_500Medium acá y al useFonts de App.js, en ese orden.
  '100': 'Inter_600SemiBold',
  '200': 'Inter_600SemiBold',
  '300': 'Inter_600SemiBold',
  '400': 'Inter_600SemiBold',
  'normal': 'Inter_600SemiBold',
  '500': 'Inter_700Bold',
  '600': 'Inter_700Bold',
  '700': 'Inter_800ExtraBold',
  'bold': 'Inter_800ExtraBold',
  '800': 'Inter_900Black',
  '900': 'Inter_900Black',
};

function pickFamily(style) {
  const flat = StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return null; // ya tiene fuente propia (íconos, etc.) → no tocar
  const w = flat.fontWeight != null ? String(flat.fontWeight) : '400';
  return WEIGHT_TO_INTER[w] || 'Inter_700Bold';
}

let patched = false;
export function applyGlobalFont() {
  if (patched) return;
  patched = true;
  [Text, TextInput].forEach((Comp) => {
    const orig = Comp.render;
    if (!orig) return;
    Comp.render = function (...args) {
      const el = orig.apply(this, args);
      const fam = pickFamily(el.props.style);
      if (!fam) return el; // respetar fuentes existentes
      return React.cloneElement(el, {
        style: [{ fontFamily: fam }, el.props.style, { fontWeight: 'normal' }],
      });
    };
  });
}

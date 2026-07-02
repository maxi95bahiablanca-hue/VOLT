// Aplica Nunito (redondeada, estilo del logo) a TODA la app, subiendo un escalón
// el peso de cada texto para que se vea más "gordito", manteniendo la jerarquía.
// IMPORTANTE: respeta cualquier texto que YA tenga fontFamily propia (los íconos
// de @expo/vector-icons son <Text> con fontFamily 'Ionicons' → no se tocan).
import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';

const WEIGHT_TO_NUNITO = {
  '100': 'Nunito_500Medium',
  '200': 'Nunito_500Medium',
  '300': 'Nunito_500Medium',
  '400': 'Nunito_600SemiBold',
  'normal': 'Nunito_600SemiBold',
  '500': 'Nunito_700Bold',
  '600': 'Nunito_700Bold',
  '700': 'Nunito_800ExtraBold',
  'bold': 'Nunito_800ExtraBold',
  '800': 'Nunito_900Black',
  '900': 'Nunito_900Black',
};

function pickFamily(style) {
  const flat = StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return null; // ya tiene fuente propia (íconos, etc.) → no tocar
  const w = flat.fontWeight != null ? String(flat.fontWeight) : '400';
  return WEIGHT_TO_NUNITO[w] || 'Nunito_700Bold';
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

// Aplica Inter a TODA la app. Inter es la tipografía de Linear: geométrica,
// angosta y muy limpia en pantalla.
//
// 🔴 9-ago-2026 — EL MAPEO SUBÍA UN ESCALÓN Y HABÍA QUE SACARLO.
// Estaba así porque la app venía de Nunito, que dibuja más gordo: para que el
// cambio no se sintiera "lavado", cada peso caía un escalón más arriba ('400'
// → SemiBold, '700' → ExtraBold, '900' → Black). Con el sistema visual nuevo
// eso pasó a jugar en contra: los estilos ya se bajaron a 500/600/700 a
// propósito —"la jerarquía la hacen el tamaño y el aire, no la negrita"— y el
// mapeo los volvía a engordar por atrás. Un título en '700' terminaba dibujado
// en ExtraBold: exactamente lo que se quería evitar.
//
// Ahora el mapeo es DIRECTO: el número que dice el estilo es el archivo que se
// usa. Lo que se ve en el código es lo que se ve en pantalla.
//
// IMPORTANTE: respeta cualquier texto que YA tenga fontFamily propia (los
// íconos de @expo/vector-icons son <Text> con fontFamily 'Ionicons' → no se
// tocan). Si algún día un estilo define su propia fontFamily, este parche lo
// deja pasar tal cual.
import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';

const WEIGHT_TO_INTER = {
  // Cuatro cortes, los mismos que carga App.js. Cada archivo pesa ~335 kB y
  // viaja en el OTA, así que sumar uno se paga en datos del usuario.
  // Los pesos finos (100-300) no los usa ningún estilo: caen en Regular.
  '100': 'Inter_400Regular',
  '200': 'Inter_400Regular',
  '300': 'Inter_400Regular',
  '400': 'Inter_400Regular',
  'normal': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  'bold': 'Inter_700Bold',
  // 800 y 900 ya no deberían existir en la app (se bajaron todos), pero si
  // vuelve a aparecer alguno, que no se caiga: tope en Bold.
  '800': 'Inter_700Bold',
  '900': 'Inter_700Bold',
};

function pickFamily(style) {
  const flat = StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return null; // ya tiene fuente propia (íconos, etc.) → no tocar
  const w = flat.fontWeight != null ? String(flat.fontWeight) : '400';
  return WEIGHT_TO_INTER[w] || 'Inter_400Regular';
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

// ─────────────────────────────────────────────────────────────────────────────
//  AYUDA — una sola puerta a bolt.com.ar/ayuda desde adentro de la app.
//
//  El problema que resuelve: las 9 guías existían pero no había UN solo link a
//  ellas en toda la app. Si alguien se trababa un sábado a la noche, el único
//  camino era escribirle a Maxi — o sea que la ayuda sólo funcionaba si Maxi
//  estaba despierto.
//
//  Reglas de este archivo:
//   · La URL vive ACÁ y en ningún otro lado (antes de esto se iba a repetir en
//     cinco pantallas y a la tercera mudanza de la web quedaban rotas).
//   · La medición NUNCA bloquea: la RPC se dispara sin await y con .catch()
//     vacío. Si la base está caída, el link se abre igual — la ayuda no puede
//     depender de que la telemetría ande.
// ─────────────────────────────────────────────────────────────────────────────
import { Linking, Platform } from 'react-native';
import { supabase } from '../supabase';

const BASE = 'https://bolt.com.ar/ayuda/';

// `ayuda_visita` sólo acepta minúsculas y guiones, hasta 30 caracteres. Filtramos
// acá para no mandar nunca algo que la RPC vaya a rechazar.
const PAGINA_VALIDA = /^[a-z-]{1,30}$/;

/**
 * Abre una guía de ayuda y cuenta la visita.
 *
 * @param {string} pagina  slug de la guía ('disponibilidad', 'presupuesto', …).
 *                         Vacío = el índice de la ayuda.
 * @param {object} [opts]
 * @param {string} [opts.ancla]  ancla dentro de la página, sin '#'.
 */
export const abrirAyuda = (pagina = '', opts = {}) => {
  const slug  = String(pagina || '').trim().toLowerCase();
  const valida = PAGINA_VALIDA.test(slug);

  // Contar SIEMPRE antes de abrir, y sin await: si esto tarda o falla, el
  // usuario igual llega a la guía.
  //
  // 🔴 Va con .then(ok, error) y NO con .catch(): lo que devuelve supabase.rpc()
  // es un builder perezoso que sólo tiene `then` — `.catch` es undefined, así
  // que escribirlo tira "catch is not a function" Y, peor, sin `then` la
  // consulta ni siquiera sale. Verificado contra @supabase/postgrest-js de este
  // repo.
  try {
    supabase
      .rpc('ayuda_visita', { p_pagina: valida ? slug : 'indice' })
      .then(() => {}, () => {});
  } catch { /* la medición jamás rompe la ayuda */ }

  const ancla = opts.ancla ? `#${opts.ancla}` : '';
  const url   = `${BASE}${valida ? `${slug}/` : ''}${ancla}`;
  Linking.openURL(url).catch(() => {});
};

/**
 * La guía de "no me llegan trabajos" / permisos de ubicación.
 * En iPhone entra derecho a la sección de iPhone, que es la que necesita.
 */
export const abrirAyudaUbicacion = () =>
  abrirAyuda('disponibilidad', Platform.OS === 'ios' ? { ancla: 'iphone' } : {});

export default abrirAyuda;

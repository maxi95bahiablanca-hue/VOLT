// ─────────────────────────────────────────────────────────────────────────────
// FUENTE ÚNICA de oficios de BOLT.
//
// Antes había 3 listas sueltas y desincronizadas (HomeScreen, registro web,
// machete). Esta es la única que vale: el resto de la app debería leer de acá.
//
// Cada oficio tiene:
//   - id     → profession_id REAL en la base (tabla professions). NO inventar.
//   - name   → nombre exacto como está en la base.
//   - emoji  → ícono para los chips.
//   - tipo   → MOLDE de flujo (cómo se pide y qué timeline tiene):
//        'reparacion' (A) → algo se rompió, el profesional va y lo arregla. 1 dirección.
//        'obra'       (B) → proyecto/servicio programado (pintar, instalar, jardín). 1 dirección, puede ser multidía.
//        'logistica'  (C) → transporte (flete/encomienda). ORIGEN + DESTINO (2 direcciones).
//
// La clasificación de abajo es un DEFAULT editable: cambiá el `tipo` de un oficio
// acá y toda la app se adapta. No es lo que ve el usuario (es interno).
// ─────────────────────────────────────────────────────────────────────────────

export const TIPO = {
  REPARACION: 'reparacion', // A
  OBRA:       'obra',       // B
  LOGISTICA:  'logistica',  // C
};

export const OFICIOS = [
  // ── A · Reparación a domicilio (reactivo) ──────────────────────────────────
  { id: 1,  name: 'Electricista',           emoji: '🔧', tipo: TIPO.REPARACION },
  { id: 2,  name: 'Plomero',                emoji: '🚰', tipo: TIPO.REPARACION },
  { id: 3,  name: 'Gasista',                emoji: '🔥', tipo: TIPO.REPARACION },
  { id: 7,  name: 'Cerrajero',              emoji: '🔒', tipo: TIPO.REPARACION },
  { id: 8,  name: 'Heladeras y lavarropas', emoji: '🧊', tipo: TIPO.REPARACION },
  { id: 16, name: 'Aire acondicionado',     emoji: '❄️', tipo: TIPO.REPARACION },
  { id: 19, name: 'Herrero',                emoji: '⚒️', tipo: TIPO.REPARACION },

  // ── B · Obra / proyecto (programado) ───────────────────────────────────────
  { id: 4,  name: 'Pintor',                 emoji: '🎨', tipo: TIPO.OBRA },
  { id: 5,  name: 'Albañil',                emoji: '🧱', tipo: TIPO.OBRA },
  // Faltaba desde siempre, aunque existe en la base (professions.id = 6), el alta
  // de prestadores lo ofrece y la landing lo publicita. Como el espejo de esta
  // lista se le pasa a la IA en analyze-problem, "armar un mueble bajo mesada"
  // no matcheaba con nada y el cliente veía "No pudimos identificar el oficio"
  // (5-ago-2026, con Esteban ya anotado como carpintero).
  { id: 6,  name: 'Carpintero',              emoji: '🪚', tipo: TIPO.OBRA },
  { id: 9,  name: 'Jardinero',              emoji: '🌿', tipo: TIPO.OBRA },
  { id: 10, name: 'Limpieza',               emoji: '🧹', tipo: TIPO.OBRA },
  { id: 17, name: 'Alarmas / Cámaras',      emoji: '📹', tipo: TIPO.OBRA },
  { id: 18, name: 'Durlock',                emoji: '🔨', tipo: TIPO.OBRA },

  // ── C · Logística / transporte ─────────────────────────────────────────────
  { id: 11, name: 'Encomiendas / Fletes',   emoji: '📦', tipo: TIPO.LOGISTICA },
];

// Qué necesita juntar el pedido según el TIPO (el "contrato" del formulario).
// Lo usan el asistente IA y los formularios para saber qué pedir.
export const CONTRATO_POR_TIPO = {
  [TIPO.REPARACION]: { direcciones: 1, pideDescripcion: true,  multiFoto: false },
  [TIPO.OBRA]:       { direcciones: 1, pideDescripcion: true,  multiFoto: true  },
  [TIPO.LOGISTICA]:  { direcciones: 2, pideDescripcion: false, multiFoto: true  }, // origen + destino
};

// ── Helpers ──────────────────────────────────────────────────────────────────
export const getOficioById   = (id)   => OFICIOS.find(o => o.id === Number(id)) || null;
export const getOficioByName = (name) => OFICIOS.find(o => o.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

export const getTipoDeOficio = (idOrName) => {
  const o = typeof idOrName === 'number' || /^\d+$/.test(String(idOrName))
    ? getOficioById(idOrName)
    : getOficioByName(idOrName);
  return o ? o.tipo : TIPO.REPARACION; // default seguro
};

export const oficiosPorTipo = (tipo) => OFICIOS.filter(o => o.tipo === tipo);
export const contratoDe      = (tipo) => CONTRATO_POR_TIPO[tipo] || CONTRATO_POR_TIPO[TIPO.REPARACION];

export default OFICIOS;

/* ⚠️ ESTE ARCHIVO ES GEMELO DE bolt-web/calculadora/datos.js
   ────────────────────────────────────────────────────────────────────────────
   Los dos tienen que decir lo mismo: si cambia un rendimiento acá, cambia allá.
   Se mantiene duplicado a propósito —y no cargado por red— porque el cálculo
   tiene que andar sin señal, que es justo donde se usa: adentro de una obra.
   Al tocar uno, buscar el otro por el nombre de la constante.
   ──────────────────────────────────────────────────────────────────────────── */

/* ───────────────────────────────────────────────────────────────────────────
   CALCULADORA DE MATERIALES · BOLT
   ───────────────────────────────────────────────────────────────────────────

   Los coeficientes de acá abajo son los que usa cualquier presupuesto de obra
   en Argentina. Están puestos con la fuente al lado para que se puedan
   discutir uno por uno: un calculador sirve si el que sabe puede mirarlo y
   decir "ese número está bien".

   Dos reglas que ordenan todo:

   1) SÓLO se calcula lo que se puede calcular. Los trabajos de superficie
      (pintura, revoque, durlock, pisos) salen de una cuenta estable y el
      resultado da ±10%. Los de diagnóstico —una térmica que salta, una pérdida
      de agua, una heladera que no enfría— NO se calculan: no sabés qué hace
      falta hasta abrir, y una lista inventada quema la confianza en todo lo
      demás. Esos oficios están en la lista, pero con lista de materiales sin
      cantidades.

   2) EL SUPUESTO SIEMPRE A LA VISTA. El error no viene de la fórmula, viene de
      las medidas. Un número con el supuesto escrito al lado es una estimación
      honesta; el mismo número solo es una promesa.
   ─────────────────────────────────────────────────────────────────────────── */

const R = {
  // ── Pintura ──────────────────────────────────────────────────────────────
  // 🔴 10-ago-2026 — acá estaban los rendimientos de FICHA TÉCNICA (10–12 m²/L
  // por mano) y daban la mitad del material que se usa de verdad. Lo marcó un
  // pintor: con esos números te quedás a mitad del ambiente.
  //
  // La ficha se mide en laboratorio, con película fina, rodillo nuevo y pared
  // sellada. En una casa real el rodillo carga de más, la pared tiene textura,
  // la primera mano chupa, y siempre queda pintura en la bandeja y el tarro.
  // El rendimiento de obra es la mitad del de ficha, y esa es la cuenta que
  // sirve para ir a comprar. Contraste: un balde de 20 L hace un ambiente de
  // 40 m² a dos manos → 4 m²/L por mano. Estos números dan justo eso.
  latexInterior:  5.5,  // m² por litro y por mano  (ficha: 10–12, obra: 5–6)
  latexExterior:  4.5,  // m² por litro y por mano  (ficha:  8–10, obra: 4–5)
  fijador:         9,   // m² por litro — este SÍ va diluido 1:1, rinde lo que dice
  esmalte:        6.5,  // m² por litro y por mano  (ficha: 12–14, obra: 6–7)
  // 🔴 10-ago-2026 — acá había un solo número por m² y una pregunta de sí o no
  // ("¿tenés grietas?") que multiplicaba 2,5 kg por CADA m² del ambiente. Un
  // dormitorio daba 143 kg de enduido: seis baldes, con eso se plancha un
  // departamento entero. El error no era el coeficiente, era suponer que el
  // enduido es proporcional a la superficie SIEMPRE. Tapar agujeros de clavo
  // es un pote; enduir la pared entera es otra cosa y es otra pregunta.
  // Ficha técnica (Alba, Sinteplast, Tersuave coinciden): 1 kg rinde 1,5 a
  // 2 m² POR MANO. Emparejar son dos manos → 1,1–1,3 kg/m².
  enduidoEmparejar: 1.2,   // kg por m², dos manos sobre toda la pared
  enduidoPlanchado: 2.0,   // kg por m², sobre revoque a la vista (tres manos)
  enduidoMarcas:    0.1,   // kg por m², sólo para tapar marcas y agujeros

  // ── Albañilería ──────────────────────────────────────────────────────────
  ladrilloHueco18: 16.5,  // unidades por m² de pared (18×18×33)
  ladrilloComun:     58,  // unidades por m² de muro de 15 (5×12×25)
  mezclaAsiento:  0.03,   // m³ de mortero por m² de pared
  // Por m³ de mortero de asiento 1:1:6 (tablas de cómputo de obra).
  // 🔴 10-ago-2026 — estaban puestos 300 y 200 kg/m³ a ojo, sueltos adentro
  // de la fórmula. Se sobrecomprava ~40% de cemento y ~70% de cal.
  cementoPorM3:    210,   // kg de cemento por m³ de mortero 1:1:6
  calPorM3:        120,   // kg de cal hidratada por m³ de mortero 1:1:6
  // Revoque grueso de 2 cm, dosificación 1:1:5 (cemento, cal, arena).
  // 🔴 10-ago-2026 — la cal estaba en 8 kg/m², casi el triple de lo que va.
  // La cuenta: 2 cm de espesor son 0,02 m³ de mortero por m², y un m³ de
  // mortero 1:1:5 lleva ~230 kg de cemento y ~150 kg de cal hidratada.
  cementoGrueso:   4.5,   // kg por m²  (0,02 m³ × 230 kg/m³)
  calGrueso:       3.0,   // kg por m²  (0,02 m³ × 150 kg/m³)
  arenaGrueso:   0.025,   // m³ por m²  (0,021 de mortero + desperdicio)
  finoPorM2:         3,   // kg de revoque fino listo por m²
  contrapiso:      0.1,   // m³ por m² (espesor 10 cm)
  carpeta:        0.025,  // m³ por m² (espesor 2,5 cm)
  pegamentoPiso:     5,   // kg por m² (llana dentada de 8 mm)
  pastina:         0.5,   // kg por m²

  // ── Durlock ──────────────────────────────────────────────────────────────
  placaM2:        2.88,   // m² que cubre una placa de 1,20 × 2,40
  montantePorM2:   2.7,   // metros lineales de montante por m² (cada 40 cm)
  tornillosPorM2:   30,   // T2 de 25 mm
  masillaPorM2:      1,   // kg (tres manos de junta)
  cintaPorM2:      2.2,   // metros de cinta de papel

  // ── Electricidad (instalación nueva, por boca) ───────────────────────────
  cablePorBoca:      8,   // metros de cable por boca (ida y vuelta al tablero)
  canoPorBoca:       3,   // metros de caño corrugado

  // ── Aire acondicionado ───────────────────────────────────────────────────
  cobreIncluido:     3,   // metros que trae el equipo de fábrica

  // ── Jardín ───────────────────────────────────────────────────────────────
  semillaPorM2:   0.035,  // kg por m² (35 g)
  tierraPorM2:    0.05,   // m³ por m² para 5 cm de espesor

  // ── Descuentos ───────────────────────────────────────────────────────────
  puertaM2:        1.9,   // m² que ocupa una puerta estándar (0,80 × 2,40)
  ventanaM2:       1.8,   // m² de una ventana común (1,50 × 1,20)
};

/** Redondea para arriba: nadie compra medio balde de pintura. */
const ceil = (n) => Math.ceil(n);
/** Un decimal, para metros y metros cúbicos. */
const d1 = (n) => Math.round(n * 10) / 10;
/** Dos decimales, para m³ chicos. */
const d2 = (n) => Math.round(n * 100) / 100;

/** Superficie de las paredes de un ambiente, descontando aberturas. */
function paredes(largo, ancho, alto, puertas, ventanas) {
  const bruta = 2 * (largo + ancho) * alto;
  return Math.max(0, bruta - (puertas * R.puertaM2) - (ventanas * R.ventanaM2));
}

/** Los cuatro estados en los que puede estar una pared antes de pintarla.
 *
 *  Cada uno es un trabajo distinto, no el mismo trabajo con más material. La
 *  pared pintada y sana NO lleva enduido ni fijador: se lava, se lija apenas y
 *  se pinta. Poner igual una partida de 50 kg es mandar a alguien a comprar
 *  dos baldes que va a devolver.
 *
 *  Lo usan las dos calculadoras de interior (por ambiente y por pared), así
 *  que vive acá: si cambia el criterio, cambia en las dos a la vez. */
const ESTADO_PARED = {
  pintada:   { porM2: 0,                   minimo: 1, fijador: false, techo: false,
               etiqueta: 'Pintada y lisa',
               detalle: 'para tapar algún agujero suelto' },
  marcas:    { porM2: R.enduidoMarcas,     minimo: 2, fijador: false, techo: false,
               etiqueta: 'Pintada, con marcas y agujeros',
               detalle: 'sólo en las marcas y los agujeros de clavos' },
  emparejar: { porM2: R.enduidoEmparejar,  minimo: 4, fijador: true,  techo: true,
               etiqueta: 'Hay que emparejarla entera',
               detalle: 'dos manos sobre toda la superficie' },
  nueva:     { porM2: R.enduidoPlanchado,  minimo: 6, fijador: true,  techo: true,
               etiqueta: 'Revoque a la vista o pared nueva',
               detalle: 'planchado completo sobre el revoque' },
};

/** La nota de cierre, según si el trabajo es repintar o rehacer. */
const NOTA_PARED = (estado) =>
  (estado === 'pintada' || estado === 'marcas')
    ? 'Si aparece una grieta, se abre en V, se rellena y se enduye ahí nomás. La grieta que vuelve al año no es pintura: es movimiento, y eso lo mira un albañil.'
    : 'Si cambiás de un color oscuro a uno claro, contá una mano más.';

/* ───────────────────────────────────────────────────────────────────────────
   LAS CALCULADORAS
   Cada una devuelve { partidas, supuestos, nota }.
   ─────────────────────────────────────────────────────────────────────────── */

const CALCULADORAS = [
  /* ── PINTOR ───────────────────────────────────────────────────────────── */
  {
    id: 'pintura-interior',
    oficio: 'Pintor',
    titulo: 'Pintar un ambiente por dentro',
    subtitulo: 'Paredes y techo, con látex al agua',
    campos: [
      { k: 'largo',    label: 'Largo del ambiente',  unidad: 'm', def: 4,  paso: 0.1 },
      { k: 'ancho',    label: 'Ancho del ambiente',  unidad: 'm', def: 3,  paso: 0.1 },
      { k: 'alto',     label: 'Altura hasta el techo', unidad: 'm', def: 2.6, paso: 0.1 },
      { k: 'puertas',  label: 'Puertas',             unidad: '',  def: 1,  paso: 1 },
      { k: 'ventanas', label: 'Ventanas',            unidad: '',  def: 1,  paso: 1 },
      { k: 'manos',    label: 'Manos de pintura',    unidad: '',  def: 2,  paso: 1, min: 1, max: 3 },
      { k: 'techo',    label: '¿Pintás el techo?',   tipo: 'si-no', def: 1 },
      { k: 'estado',   label: 'Cómo están las paredes hoy', tipo: 'opciones', def: 'pintada',
        opciones: [
          { v: 'pintada',   t: 'Pintadas y lisas' },
          { v: 'marcas',    t: 'Pintadas, con marcas y agujeros' },
          { v: 'emparejar', t: 'Hay que emparejarlas enteras' },
          { v: 'nueva',     t: 'Revoque a la vista o pared nueva' },
        ] },
    ],
    calcular(v) {
      const supAred  = paredes(v.largo, v.ancho, v.alto, v.puertas, v.ventanas);
      const supTecho = v.techo ? v.largo * v.ancho : 0;
      const sup      = supAred + supTecho;
      const litros   = sup * v.manos / R.latexInterior;

      const t = ESTADO_PARED[v.estado] || ESTADO_PARED.pintada;

      // El enduido va sobre las paredes. El techo entra sólo cuando hay que
      // emparejar de verdad: nadie plancha un techo para repintarlo.
      const supEnduido = supAred + (t.techo ? supTecho : 0);
      const end = Math.max(t.minimo, supEnduido * t.porM2);
      // Se lija lo que se enduye, no todo el ambiente.
      const lija = t.porM2 > 0 ? ceil(supEnduido / 12) : 1;

      const partidas = [
        { item: 'Látex interior', cantidad: ceil(litros), unidad: 'litros',
          detalle: `${v.manos} ${v.manos === 1 ? 'mano' : 'manos'} · rinde ${R.latexInterior} m²/L en obra` },
      ];
      if (t.fijador) {
        partidas.push({ item: 'Fijador al agua', cantidad: ceil(sup / R.fijador), unidad: 'litros',
          detalle: 'una mano, para que el látex agarre' });
      }
      partidas.push(
        { item: 'Enduido plástico', cantidad: ceil(end), unidad: 'kg', detalle: t.detalle },
        { item: 'Lija al agua (grano 120)', cantidad: lija, unidad: 'pliegos' },
        { item: 'Cinta de papel', cantidad: ceil((v.puertas + v.ventanas) * 6 / 45) || 1, unidad: 'rollos de 45 m' },
        { item: 'Rodillo de lana + bandeja', cantidad: 1, unidad: 'juego' },
        { item: 'Pincel para bordes', cantidad: 1, unidad: 'unidad' },
      );

      const supuestos = [
        `Ambiente de ${v.largo} × ${v.ancho} m con ${v.alto} m de altura`,
        `${supAred.toFixed(1)} m² de pared${v.techo ? ` + ${supTecho.toFixed(1)} m² de techo` : ''} (ya descontadas ${v.puertas} puerta/s y ${v.ventanas} ventana/s)`,
        'Látex al agua de calidad media, con rendimiento de obra (no el de la ficha)',
      ];
      if (!t.fijador) {
        supuestos.push('Sobre pintura vieja sana: no lleva fijador ni enduido general');
      } else if (t.techo && v.techo) {
        supuestos.push('El enduido incluye el techo porque hay que emparejarlo');
      }

      return {
        superficie: sup,
        partidas,
        supuestos,
        nota: NOTA_PARED(v.estado),
      };
    },
  },

  {
    id: 'pintura-pared-interior',
    oficio: 'Pintor',
    titulo: 'Pintar una sola pared por dentro',
    subtitulo: 'Una pared, sin el resto del ambiente',
    campos: [
      { k: 'largo',     label: 'Largo de la pared',  unidad: 'm', def: 4,   paso: 0.1 },
      { k: 'alto',      label: 'Altura',             unidad: 'm', def: 2.6, paso: 0.1 },
      { k: 'puertas',   label: 'Puertas en esa pared',  unidad: '', def: 0, paso: 1 },
      { k: 'ventanas',  label: 'Ventanas en esa pared', unidad: '', def: 1, paso: 1 },
      { k: 'manos',     label: 'Manos de pintura',   unidad: '',  def: 2,   paso: 1, min: 1, max: 3 },
      { k: 'estado',    label: 'Cómo está la pared hoy', tipo: 'opciones', def: 'pintada',
        opciones: [
          { v: 'pintada',   t: 'Pintada y lisa' },
          { v: 'marcas',    t: 'Pintada, con marcas y agujeros' },
          { v: 'emparejar', t: 'Hay que emparejarla entera' },
          { v: 'nueva',     t: 'Revoque a la vista o pared nueva' },
        ] },
    ],
    calcular(v) {
      // Una pared sola: la pared de acento, la que quedó manchada, la que da
      // al patio. Es el caso más común y no entraba en la de ambiente, que
      // obliga a cargar los cuatro lados.
      const sup = Math.max(0, v.largo * v.alto - v.puertas * R.puertaM2 - v.ventanas * R.ventanaM2);
      const t = ESTADO_PARED[v.estado] || ESTADO_PARED.pintada;
      const end = Math.max(t.minimo, sup * t.porM2);

      const partidas = [
        { item: 'Látex interior', cantidad: ceil(sup * v.manos / R.latexInterior), unidad: 'litros',
          detalle: `${v.manos} ${v.manos === 1 ? 'mano' : 'manos'} · rinde ${R.latexInterior} m²/L en obra` },
      ];
      if (t.fijador) {
        partidas.push({ item: 'Fijador al agua', cantidad: ceil(sup / R.fijador), unidad: 'litros',
          detalle: 'una mano, para que el látex agarre' });
      }
      partidas.push(
        { item: 'Enduido plástico', cantidad: ceil(end), unidad: 'kg', detalle: t.detalle },
        { item: 'Lija al agua (grano 120)', cantidad: t.porM2 > 0 ? ceil(sup / 12) : 1, unidad: 'pliegos' },
        { item: 'Cinta de papel', cantidad: 1, unidad: 'rollo de 45 m',
          detalle: 'para el zócalo, el techo y las paredes de al lado' },
        { item: 'Rodillo de lana + bandeja', cantidad: 1, unidad: 'juego' },
      );

      const supuestos = [
        `Una pared de ${v.largo} × ${v.alto} m = ${sup.toFixed(1)} m² netos`,
        v.puertas || v.ventanas
          ? `Ya descontadas ${v.puertas} puerta/s y ${v.ventanas} ventana/s`
          : 'Sin puertas ni ventanas en esa pared',
        'Rendimiento de obra, no de ficha técnica',
      ];
      if (!t.fijador) supuestos.push('Sobre pintura vieja sana: no lleva fijador ni enduido general');

      return {
        superficie: sup,
        partidas,
        supuestos,
        nota: v.estado === 'pintada' || v.estado === 'marcas'
          ? 'Si es una pared de acento en un color fuerte, contá tres manos: los rojos y los azules tapan mal.'
          : NOTA_PARED(v.estado),
      };
    },
  },

  {
    id: 'pintura-exterior',
    oficio: 'Pintor',
    titulo: 'Pintar un frente o una medianera',
    subtitulo: 'Látex para exterior',
    campos: [
      { k: 'largo',    label: 'Largo de la pared',  unidad: 'm', def: 8,   paso: 0.1 },
      { k: 'alto',     label: 'Altura',             unidad: 'm', def: 2.6, paso: 0.1 },
      { k: 'aberturas',label: 'Puertas y ventanas', unidad: '',  def: 2,   paso: 1 },
      { k: 'manos',    label: 'Manos de pintura',   unidad: '',  def: 2,   paso: 1, min: 1, max: 3 },
    ],
    calcular(v) {
      const sup = Math.max(0, v.largo * v.alto - v.aberturas * R.ventanaM2);
      return {
        superficie: sup,
        partidas: [
          { item: 'Látex para exterior', cantidad: ceil(sup * v.manos / R.latexExterior), unidad: 'litros',
            detalle: `${v.manos} manos · rinde ${R.latexExterior} m²/L en obra` },
          { item: 'Fijador para exterior', cantidad: ceil(sup / R.fijador), unidad: 'litros' },
          { item: 'Sellador de grietas', cantidad: ceil(sup / 25), unidad: 'cartuchos',
            detalle: 'para fisuras finas antes de pintar' },
          { item: 'Rodillo de lana larga + bandeja', cantidad: 1, unidad: 'juego' },
        ],
        supuestos: [
          `Pared de ${v.largo} × ${v.alto} m = ${sup.toFixed(1)} m² netos`,
          'Superficie ya limpia, sin revoque flojo',
        ],
        nota: 'Con humedad o revoque flojo hay que reparar antes: eso se presupuesta aparte.',
      };
    },
  },

  /* ── ALBAÑIL ──────────────────────────────────────────────────────────── */
  {
    id: 'pared-ladrillos',
    oficio: 'Albañil',
    titulo: 'Levantar una pared',
    subtitulo: 'Ladrillo hueco o común, con mezcla de asiento',
    campos: [
      { k: 'largo', label: 'Largo de la pared', unidad: 'm', def: 4,   paso: 0.1 },
      { k: 'alto',  label: 'Altura',            unidad: 'm', def: 2.6, paso: 0.1 },
      { k: 'tipo',  label: 'Tipo de ladrillo',  tipo: 'opciones', def: 'hueco',
        opciones: [
          { v: 'hueco', t: 'Hueco 18×18×33' },
          { v: 'comun', t: 'Común 5×12×25' },
        ] },
    ],
    calcular(v) {
      const sup = v.largo * v.alto;
      const porM2 = v.tipo === 'hueco' ? R.ladrilloHueco18 : R.ladrilloComun;
      const mezcla = sup * R.mezclaAsiento;
      return {
        superficie: sup,
        partidas: [
          { item: v.tipo === 'hueco' ? 'Ladrillo hueco 18×18×33' : 'Ladrillo común',
            cantidad: ceil(sup * porM2 * 1.05), unidad: 'unidades',
            detalle: `${porM2} por m² + 5% de roturas` },
          { item: 'Cemento', cantidad: ceil(mezcla * R.cementoPorM3), unidad: 'kg',
            detalle: `mezcla de asiento 1:1:6 · ${ceil(mezcla * R.cementoPorM3 / 50)} bolsa/s de 50 kg` },
          { item: 'Cal hidratada', cantidad: ceil(mezcla * R.calPorM3), unidad: 'kg' },
          { item: 'Arena', cantidad: d2(mezcla * 1.1), unidad: 'm³' },
        ],
        supuestos: [
          `Pared de ${v.largo} × ${v.alto} m = ${sup.toFixed(1)} m²`,
          'Mezcla de asiento 1:1:6 (cemento, cal, arena)',
          'No incluye encadenado, columnas ni fundación',
        ],
      };
    },
  },

  {
    id: 'revoque',
    oficio: 'Albañil',
    titulo: 'Revocar una pared',
    subtitulo: 'Grueso y fino',
    campos: [
      { k: 'largo', label: 'Largo',  unidad: 'm', def: 4,   paso: 0.1 },
      { k: 'alto',  label: 'Altura', unidad: 'm', def: 2.6, paso: 0.1 },
      { k: 'caras', label: '¿Las dos caras?', tipo: 'si-no', def: 0 },
      { k: 'fino',  label: '¿Lleva fino?',    tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const sup = v.largo * v.alto * (v.caras ? 2 : 1);
      const p = [
        { item: 'Cemento', cantidad: ceil(sup * R.cementoGrueso), unidad: 'kg', detalle: 'revoque grueso, 2 cm' },
        { item: 'Cal hidratada', cantidad: ceil(sup * R.calGrueso), unidad: 'kg' },
        { item: 'Arena', cantidad: d2(sup * R.arenaGrueso), unidad: 'm³' },
      ];
      if (v.fino) p.push({ item: 'Revoque fino listo', cantidad: ceil(sup * R.finoPorM2), unidad: 'kg',
        detalle: 'bolsas de 30 kg → ' + ceil(sup * R.finoPorM2 / 30) + ' bolsas' });
      return {
        superficie: sup,
        partidas: p,
        supuestos: [
          `${sup.toFixed(1)} m² de revoque${v.caras ? ' (las dos caras)' : ''}`,
          'Grueso de 2 cm de espesor',
        ],
      };
    },
  },

  {
    id: 'contrapiso',
    oficio: 'Albañil',
    titulo: 'Contrapiso y carpeta',
    subtitulo: 'La base antes del piso',
    campos: [
      { k: 'largo',   label: 'Largo',  unidad: 'm', def: 4, paso: 0.1 },
      { k: 'ancho',   label: 'Ancho',  unidad: 'm', def: 3, paso: 0.1 },
      { k: 'espesor', label: 'Espesor del contrapiso', unidad: 'cm', def: 10, paso: 1 },
    ],
    calcular(v) {
      const sup = v.largo * v.ancho;
      const vol = sup * (v.espesor / 100);
      return {
        superficie: sup,
        partidas: [
          { item: 'Cascote o piedra', cantidad: d2(vol * 0.9), unidad: 'm³' },
          { item: 'Cemento (contrapiso)', cantidad: ceil(vol * 150), unidad: 'kg' },
          { item: 'Cal (contrapiso)', cantidad: ceil(vol * 100), unidad: 'kg' },
          { item: 'Cemento (carpeta)', cantidad: ceil(sup * R.carpeta * 400), unidad: 'kg',
            detalle: 'carpeta de 2,5 cm' },
          { item: 'Arena (carpeta)', cantidad: d2(sup * R.carpeta * 1.1), unidad: 'm³' },
        ],
        supuestos: [
          `${sup.toFixed(1)} m² de superficie`,
          `Contrapiso de ${v.espesor} cm + carpeta de 2,5 cm`,
        ],
      };
    },
  },

  {
    id: 'piso-ceramico',
    oficio: 'Albañil',
    titulo: 'Colocar piso o revestimiento',
    subtitulo: 'Cerámico o porcelanato',
    campos: [
      { k: 'largo',  label: 'Largo',  unidad: 'm', def: 4, paso: 0.1 },
      { k: 'ancho',  label: 'Ancho',  unidad: 'm', def: 3, paso: 0.1 },
      { k: 'diagonal', label: '¿Se coloca en diagonal?', tipo: 'si-no', def: 0 },
      { k: 'zocalo', label: '¿Lleva zócalo?', tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const sup = v.largo * v.ancho;
      const desperdicio = v.diagonal ? 0.15 : 0.10;
      const p = [
        { item: 'Cerámico o porcelanato', cantidad: d1(sup * (1 + desperdicio)), unidad: 'm²',
          detalle: `${sup.toFixed(1)} m² + ${desperdicio * 100}% de desperdicio${v.diagonal ? ' (diagonal)' : ''}` },
        { item: 'Pegamento para pisos', cantidad: ceil(sup * R.pegamentoPiso), unidad: 'kg',
          detalle: 'bolsas de 30 kg → ' + ceil(sup * R.pegamentoPiso / 30) + ' bolsas' },
        { item: 'Pastina', cantidad: ceil(sup * R.pastina), unidad: 'kg' },
        { item: 'Crucetas', cantidad: ceil(sup * 12), unidad: 'unidades' },
      ];
      if (v.zocalo) p.push({ item: 'Zócalo', cantidad: d1(2 * (v.largo + v.ancho) * 1.1), unidad: 'metros' });
      return {
        superficie: sup,
        partidas: p,
        supuestos: [
          `${sup.toFixed(1)} m² de piso`,
          'Contrapiso ya hecho y nivelado',
          'Llana dentada de 8 mm',
        ],
        nota: 'Comprá todo del mismo lote: entre lotes distintos cambia el tono.',
      };
    },
  },

  /* ── DURLOCK ──────────────────────────────────────────────────────────── */
  {
    id: 'durlock-tabique',
    oficio: 'Durlock',
    titulo: 'Tabique de durlock',
    subtitulo: 'Pared divisoria, con estructura',
    campos: [
      { k: 'largo', label: 'Largo',  unidad: 'm', def: 3,   paso: 0.1 },
      { k: 'alto',  label: 'Altura', unidad: 'm', def: 2.6, paso: 0.1 },
      { k: 'doble', label: '¿Placas de los dos lados?', tipo: 'si-no', def: 1 },
      { k: 'lana',  label: '¿Lleva lana de vidrio?',    tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const sup   = v.largo * v.alto;
      const caras = v.doble ? 2 : 1;
      const supPlacas = sup * caras;
      const p = [
        { item: 'Placa de yeso 1,20 × 2,40', cantidad: ceil(supPlacas / R.placaM2 * 1.1), unidad: 'placas',
          detalle: `${supPlacas.toFixed(1)} m² a cubrir + 10% de recortes` },
        { item: 'Montante 70 mm', cantidad: ceil(sup * R.montantePorM2 / 2.6), unidad: 'tiras de 2,60 m' },
        { item: 'Solera 70 mm', cantidad: ceil(v.largo * 2 / 2.6), unidad: 'tiras de 2,60 m',
          detalle: 'piso y techo' },
        { item: 'Tornillos T2 25 mm', cantidad: ceil(supPlacas * R.tornillosPorM2), unidad: 'unidades' },
        { item: 'Masilla lista', cantidad: ceil(supPlacas * R.masillaPorM2), unidad: 'kg' },
        { item: 'Cinta de papel', cantidad: ceil(supPlacas * R.cintaPorM2), unidad: 'metros' },
      ];
      if (v.lana) p.push({ item: 'Lana de vidrio 50 mm', cantidad: d1(sup * 1.05), unidad: 'm²',
        detalle: 'aislación acústica' });
      return {
        superficie: sup,
        partidas: p,
        supuestos: [
          `Tabique de ${v.largo} × ${v.alto} m = ${sup.toFixed(1)} m²`,
          v.doble ? 'Placas de los dos lados' : 'Placas de un solo lado',
          'Montantes cada 40 cm',
        ],
      };
    },
  },

  {
    id: 'durlock-cielorraso',
    oficio: 'Durlock',
    titulo: 'Cielorraso de durlock',
    subtitulo: 'Suspendido, con perfilería',
    campos: [
      { k: 'largo', label: 'Largo', unidad: 'm', def: 4, paso: 0.1 },
      { k: 'ancho', label: 'Ancho', unidad: 'm', def: 3, paso: 0.1 },
    ],
    calcular(v) {
      const sup = v.largo * v.ancho;
      return {
        superficie: sup,
        partidas: [
          { item: 'Placa de yeso 1,20 × 2,40', cantidad: ceil(sup / R.placaM2 * 1.1), unidad: 'placas' },
          { item: 'Perfil omega o montante', cantidad: ceil(sup * R.montantePorM2 / 2.6), unidad: 'tiras de 2,60 m' },
          { item: 'Solera perimetral', cantidad: ceil(2 * (v.largo + v.ancho) / 2.6), unidad: 'tiras de 2,60 m' },
          { item: 'Velas rígidas / tensores', cantidad: ceil(sup * 1.2), unidad: 'unidades' },
          { item: 'Tornillos T2 25 mm', cantidad: ceil(sup * R.tornillosPorM2), unidad: 'unidades' },
          { item: 'Masilla lista', cantidad: ceil(sup * R.masillaPorM2), unidad: 'kg' },
          { item: 'Cinta de papel', cantidad: ceil(sup * R.cintaPorM2), unidad: 'metros' },
        ],
        supuestos: [
          `${sup.toFixed(1)} m² de cielorraso`,
          'Suspendido, con estructura cada 40 cm',
        ],
      };
    },
  },

  /* ── ELECTRICISTA ─────────────────────────────────────────────────────── */
  {
    id: 'instalacion-electrica',
    oficio: 'Electricista',
    titulo: 'Instalación eléctrica nueva',
    subtitulo: 'Bocas de luz y tomacorrientes',
    campos: [
      { k: 'bocasLuz',  label: 'Bocas de luz',       unidad: '', def: 4, paso: 1 },
      { k: 'tomas',     label: 'Tomacorrientes',     unidad: '', def: 6, paso: 1 },
      { k: 'distancia', label: 'Distancia al tablero', unidad: 'm', def: 8, paso: 1 },
      { k: 'tablero',   label: '¿Tablero nuevo?',    tipo: 'si-no', def: 0 },
    ],
    calcular(v) {
      const bocas = v.bocasLuz + v.tomas;
      const factor = v.distancia / 8;   // el coeficiente base asume 8 m al tablero
      const p = [
        { item: 'Cable 1,5 mm² (iluminación)', cantidad: ceil(v.bocasLuz * R.cablePorBoca * factor * 1.1), unidad: 'metros',
          detalle: 'tres colores: vivo, neutro y tierra' },
        { item: 'Cable 2,5 mm² (tomas)', cantidad: ceil(v.tomas * R.cablePorBoca * factor * 1.1), unidad: 'metros' },
        { item: 'Caño corrugado', cantidad: ceil(bocas * R.canoPorBoca * factor), unidad: 'metros' },
        { item: 'Cajas rectangulares', cantidad: bocas, unidad: 'unidades' },
        { item: 'Cajas de paso octogonales', cantidad: v.bocasLuz, unidad: 'unidades' },
        { item: 'Llaves y tomas (módulos)', cantidad: bocas, unidad: 'juegos' },
      ];
      if (v.tablero) p.push(
        { item: 'Tablero con puerta', cantidad: 1, unidad: 'unidad' },
        { item: 'Disyuntor diferencial', cantidad: 1, unidad: 'unidad' },
        { item: 'Térmicas', cantidad: Math.max(2, Math.ceil(bocas / 6)), unidad: 'unidades' },
      );
      return {
        superficie: null,
        partidas: p,
        supuestos: [
          `${v.bocasLuz} bocas de luz y ${v.tomas} tomacorrientes`,
          `Unos ${v.distancia} m hasta el tablero`,
          'Instalación embutida, con caño corrugado',
        ],
        nota: 'La instalación eléctrica la firma un matriculado. Esto es para comprar, no para reemplazar el cálculo del profesional.',
      };
    },
  },

  /* ── AIRE ACONDICIONADO ───────────────────────────────────────────────── */
  {
    id: 'split',
    oficio: 'Aire acondicionado',
    titulo: 'Instalar un split',
    subtitulo: 'Cañería, soportes y desagüe',
    campos: [
      { k: 'distancia', label: 'Distancia entre las dos unidades', unidad: 'm', def: 3, paso: 0.5 },
      { k: 'frigorias', label: 'Frigorías del equipo', tipo: 'opciones', def: '3000',
        opciones: [
          { v: '2200', t: '2200 fg' },
          { v: '3000', t: '3000 fg' },
          { v: '4500', t: '4500 fg' },
          { v: '6000', t: '6000 fg' },
        ] },
      { k: 'ménsulas', label: '¿Necesita ménsulas?', tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const extra = Math.max(0, v.distancia - R.cobreIncluido);
      const grueso = Number(v.frigorias) >= 4500 ? '3×2,5 mm²' : '3×1,5 mm²';
      const p = [];
      if (extra > 0) {
        p.push({ item: 'Caño de cobre 1/4"', cantidad: ceil(extra * 1.1), unidad: 'metros' });
        p.push({ item: 'Caño de cobre 3/8" o 1/2"', cantidad: ceil(extra * 1.1), unidad: 'metros' });
        p.push({ item: 'Aislación para cañería', cantidad: ceil(extra * 2.2), unidad: 'metros' });
        p.push({ item: 'Carga extra de gas', cantidad: 1, unidad: 'servicio',
          detalle: 'los equipos vienen cargados para 3 m' });
      }
      p.push({ item: 'Cable de interconexión ' + grueso, cantidad: ceil(v.distancia * 1.2), unidad: 'metros' });
      p.push({ item: 'Manguera de desagüe', cantidad: ceil(v.distancia * 1.5), unidad: 'metros' });
      p.push({ item: 'Cinta de embalar cañería', cantidad: 1, unidad: 'rollo' });
      if (v.ménsulas) p.push({ item: 'Ménsulas para la unidad exterior', cantidad: 1, unidad: 'juego' });
      return {
        superficie: null,
        partidas: p,
        supuestos: [
          `${v.distancia} m entre la unidad interior y la exterior`,
          `Equipo de ${v.frigorias} frigorías`,
          extra > 0
            ? `El equipo trae ${R.cobreIncluido} m de fábrica: se agregan ${extra.toFixed(1)} m`
            : `Entra en los ${R.cobreIncluido} m que trae el equipo`,
        ],
        nota: 'Sobre los 3 metros de fábrica hay que sumar gas. Es el error más común al presupuestar un split.',
      };
    },
  },

  /* ── JARDINERO ────────────────────────────────────────────────────────── */
  {
    id: 'cesped',
    oficio: 'Jardinero',
    titulo: 'Hacer césped nuevo',
    subtitulo: 'En rollo o por semilla',
    campos: [
      { k: 'largo', label: 'Largo', unidad: 'm', def: 8, paso: 0.5 },
      { k: 'ancho', label: 'Ancho', unidad: 'm', def: 5, paso: 0.5 },
      { k: 'tipo',  label: '¿Cómo?', tipo: 'opciones', def: 'rollo',
        opciones: [
          { v: 'rollo',   t: 'Césped en rollo' },
          { v: 'semilla', t: 'Por semilla' },
        ] },
      { k: 'tierra', label: '¿Agregás tierra?', tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const sup = v.largo * v.ancho;
      const p = v.tipo === 'rollo'
        ? [{ item: 'Césped en rollo', cantidad: d1(sup * 1.05), unidad: 'm²', detalle: '+5% de recortes' }]
        : [{ item: 'Semilla', cantidad: d1(sup * R.semillaPorM2), unidad: 'kg', detalle: '35 g por m²' }];
      if (v.tierra) p.push({ item: 'Tierra negra', cantidad: d2(sup * R.tierraPorM2), unidad: 'm³',
        detalle: '5 cm de espesor' });
      p.push({ item: 'Fertilizante de arranque', cantidad: ceil(sup / 40), unidad: 'kg' });
      return {
        superficie: sup,
        partidas: p,
        supuestos: [
          `${sup.toFixed(1)} m² de superficie`,
          v.tipo === 'rollo' ? 'Césped en panes, colocado sobre tierra nivelada' : 'Siembra sobre tierra preparada',
        ],
        nota: v.tipo === 'rollo'
          ? 'El rollo se coloca el mismo día que llega: si espera, se quema.'
          : 'La semilla necesita riego diario las primeras tres semanas.',
      };
    },
  },

  /* ── ALARMAS / CÁMARAS ────────────────────────────────────────────────── */
  {
    id: 'camaras',
    oficio: 'Alarmas / Cámaras',
    titulo: 'Instalar cámaras',
    subtitulo: 'Cableado y grabador',
    campos: [
      { k: 'camaras',   label: 'Cámaras',              unidad: '', def: 4,  paso: 1 },
      { k: 'distancia', label: 'Distancia promedio al grabador', unidad: 'm', def: 15, paso: 1 },
      { k: 'grabador',  label: '¿Incluye grabador?',   tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const metros = v.camaras * v.distancia * 1.15;
      const p = [
        { item: 'Cable UTP o coaxil', cantidad: ceil(metros), unidad: 'metros',
          detalle: '+15% por recorridos y curvas' },
        { item: 'Fichas / conectores', cantidad: v.camaras * 2, unidad: 'unidades' },
        { item: 'Fuente de alimentación', cantidad: Math.max(1, Math.ceil(v.camaras / 4)), unidad: 'unidades' },
        { item: 'Canaleta o caño', cantidad: ceil(metros * 0.6), unidad: 'metros' },
        { item: 'Tarugos y tornillos', cantidad: v.camaras * 4, unidad: 'unidades' },
      ];
      if (v.grabador) p.push(
        { item: 'Grabador (DVR/NVR)', cantidad: 1, unidad: 'unidad',
          detalle: `de ${v.camaras <= 4 ? 4 : v.camaras <= 8 ? 8 : 16} canales` },
        { item: 'Disco rígido', cantidad: 1, unidad: 'unidad',
          detalle: `${v.camaras <= 4 ? '1' : '2'} TB para unos 15 días de grabación` },
      );
      return {
        superficie: null,
        partidas: p,
        supuestos: [
          `${v.camaras} cámaras a unos ${v.distancia} m del grabador`,
          'Cableado por canaleta o caño a la vista',
        ],
      };
    },
  },

  /* ── HERRERO ──────────────────────────────────────────────────────────── */
  {
    id: 'reja',
    oficio: 'Herrero',
    titulo: 'Reja para ventana o puerta',
    subtitulo: 'Marco y barrotes',
    campos: [
      { k: 'ancho', label: 'Ancho', unidad: 'm', def: 1.5, paso: 0.1 },
      { k: 'alto',  label: 'Alto',  unidad: 'm', def: 1.2, paso: 0.1 },
      // El tope de 20 cm no es capricho: mas separado que eso deja pasar
      // una cabeza de chico y la reja deja de ser reja. El piso de 5 evita
      // ademas que una separacion en cero rompa la division de abajo.
      { k: 'separacion', label: 'Separación entre barrotes', unidad: 'cm', def: 12, paso: 1, min: 5, max: 20 },
    ],
    calcular(v) {
      const sep = Math.max(5, v.separacion || 12);
      const barrotes = Math.max(2, Math.floor(v.ancho * 100 / sep) - 1);
      const marco = 2 * (v.ancho + v.alto);
      const metrosBarrote = barrotes * v.alto;
      const sup = v.ancho * v.alto;
      return {
        superficie: sup,
        partidas: [
          { item: 'Caño estructural 30×30 (marco)', cantidad: d1(marco * 1.1), unidad: 'metros' },
          { item: 'Barrote macizo 12 mm', cantidad: d1(metrosBarrote * 1.1), unidad: 'metros',
            detalle: `${barrotes} barrotes cada ${sep} cm` },
          { item: 'Electrodos para soldar', cantidad: ceil((marco + metrosBarrote) / 8), unidad: 'kg' },
          { item: 'Antióxido', cantidad: ceil(sup * 2 / 10) || 1, unidad: 'litros' },
          { item: 'Esmalte sintético', cantidad: ceil(sup * 2 / R.esmalte) || 1, unidad: 'litros' },
          { item: 'Amures / brocas', cantidad: 6, unidad: 'unidades' },
        ],
        supuestos: [
          `Reja de ${v.ancho} × ${v.alto} m`,
          `Barrotes verticales cada ${sep} cm`,
          '+10% de material por cortes',
        ],
      };
    },
  },

  /* ── PLOMERO ──────────────────────────────────────────────────────────── */
  {
    id: 'agua-nueva',
    oficio: 'Plomero',
    titulo: 'Cañería de agua nueva',
    subtitulo: 'Termofusión, agua fría y caliente',
    campos: [
      { k: 'metros',   label: 'Metros de cañería', unidad: 'm', def: 12, paso: 1 },
      { k: 'bocas',    label: 'Bocas (canillas, duchas, inodoro)', unidad: '', def: 4, paso: 1 },
      { k: 'caliente', label: '¿Lleva agua caliente?', tipo: 'si-no', def: 1 },
    ],
    calcular(v) {
      const p = [
        { item: 'Caño de termofusión 20 mm (fría)', cantidad: ceil(v.metros * 1.15), unidad: 'metros',
          detalle: '+15% por recorridos' },
        { item: 'Codos 90°', cantidad: v.bocas * 3, unidad: 'unidades' },
        { item: 'Tes', cantidad: v.bocas * 2, unidad: 'unidades' },
        { item: 'Llaves de paso', cantidad: v.bocas, unidad: 'unidades' },
        { item: 'Adaptadores con rosca', cantidad: v.bocas * 2, unidad: 'unidades' },
        { item: 'Cinta de teflón', cantidad: ceil(v.bocas / 2), unidad: 'rollos' },
      ];
      if (v.caliente) p.unshift({ item: 'Caño de termofusión 20 mm (caliente)', cantidad: ceil(v.metros * 0.7 * 1.15), unidad: 'metros' });
      return {
        superficie: null,
        partidas: p,
        supuestos: [
          `${v.metros} m de recorrido y ${v.bocas} bocas`,
          v.caliente ? 'Agua fría y caliente' : 'Sólo agua fría',
          'Termofusión de 20 mm, que es lo estándar en vivienda',
        ],
        nota: 'Esto es para una instalación NUEVA. Una pérdida o una reparación no se puede calcular sin ver.',
      };
    },
  },

  /* ── GASISTA ──────────────────────────────────────────────────────────── */
  {
    id: 'gas-nueva',
    oficio: 'Gasista',
    titulo: 'Cañería de gas nueva',
    subtitulo: 'Para un artefacto más',
    campos: [
      { k: 'metros',     label: 'Metros de cañería', unidad: 'm', def: 6, paso: 1 },
      { k: 'artefactos', label: 'Artefactos a conectar', unidad: '', def: 1, paso: 1 },
    ],
    calcular(v) {
      return {
        superficie: null,
        partidas: [
          { item: 'Caño epoxi o hierro galvanizado', cantidad: ceil(v.metros * 1.15), unidad: 'metros' },
          { item: 'Codos y accesorios', cantidad: v.artefactos * 4, unidad: 'unidades' },
          { item: 'Llave de paso por artefacto', cantidad: v.artefactos, unidad: 'unidades' },
          { item: 'Conexión flexible aprobada', cantidad: v.artefactos, unidad: 'unidades' },
          { item: 'Sellador para gas', cantidad: 1, unidad: 'unidad' },
        ],
        supuestos: [
          `${v.metros} m de cañería para ${v.artefactos} artefacto/s`,
          'Materiales aprobados para gas',
        ],
        nota: 'El gas lo instala y lo habilita un gasista matriculado, sin excepción. Esta lista es sólo para tener idea de lo que lleva.',
      };
    },
  },
];

/** Los oficios donde NO se puede calcular, y por qué. Se dicen igual: es mejor
 *  explicar por qué no hay número que dejar al usuario buscándolo. */
const SIN_CALCULO = [
  { oficio: 'Cerrajero', motivo: 'El material es la cerradura, y depende de la puerta que tengas. Se define en el momento.' },
  { oficio: 'Heladeras y lavarropas', motivo: 'Hasta no abrir y medir no se sabe qué pieza falla. Cualquier lista sería inventada.' },
  { oficio: 'Encomiendas / Fletes', motivo: 'No lleva materiales: se cotiza por distancia y volumen.' },
  { oficio: 'Limpieza', motivo: 'Los productos los pone el que limpia y varían con el tipo de superficie.' },
  { oficio: 'Carpintero', motivo: 'Cada mueble es un diseño distinto. El corte se calcula sobre el plano, no sobre una fórmula.' },
];

export { CALCULADORAS, SIN_CALCULO, R };
export default CALCULADORAS;

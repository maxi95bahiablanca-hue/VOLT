// BOLT — coordinador invisible. Nunca robótico, siempre profesional.

const volt = {
  // ── Búsqueda ──────────────────────────────────────────────────────────────
  searchStep1: 'Encontramos profesionales disponibles.',
  searchStep2: 'Analizando distancia y disponibilidad en tu zona.',
  searchStep3: (count) =>
    count === 1
      ? '1 profesional recibió tu solicitud.'
      : `${count} profesionales recibieron tu solicitud.`,
  searchStep4: 'Esperando propuestas. Te avisaremos enseguida.',

  // ── Recomendaciones ───────────────────────────────────────────────────────
  recommendByArrival: (name) =>
    `Detectamos que ${name} llegará antes que los otros candidatos.`,
  recommendByRating: (name) =>
    `${name} destaca por sus calificaciones. Podría ser tu mejor opción.`,
  recommendByExperience: (name) =>
    `${name} tiene amplia experiencia en este tipo de trabajo.`,
  recommendGeneral: (name) =>
    `${name} parece ser una buena opción según tu solicitud.`,
  recommendSingle: (name) =>
    `${name} respondió tu solicitud y está disponible ahora.`,

  // ── Mensajes del chat (sistema) ───────────────────────────────────────────
  chatCreated:    'Estamos verificando disponibilidad en tu zona.',
  chatAccepted:   'Tu profesional confirmó el horario.',
  chatInTransit:  'Tu profesional se encuentra en camino.',
  chatNearby:     'Seguimos monitoreando tu solicitud. El profesional está muy cerca.',
  chatArrived:    (name) =>
    `${name} llegó al lugar. Verificá el código antes de abrir.`,
  chatStarted:    'Trabajo iniciado. Estaremos atentos por si necesitás algo.',
  chatDone:       'El trabajo fue completado. Podés proceder con el pago.',
  chatMonitoring: 'Trabajo monitoreado por BOLT.',

  // ── Tracking tips ─────────────────────────────────────────────────────────
  tipPending:         'Encontramos profesionales disponibles. Generalmente llegan en menos de 30 min.',
  tipAccepted:        'Te avisaremos si hay cambios. Podés seguir en tiempo real su recorrido.',
  tipArrived:         'Verificá el código antes de abrir. Es tu garantía de que es un profesional BOLT.',
  tipInProgress:      'El trabajo está en curso. Todos nuestros profesionales tienen antecedentes verificados.',
  tipAwaitingPayment: 'El pago es seguro y procesado por BOLT. Nunca pagues en efectivo.',
  tipAwaitingPaymentFree: 'El trabajo está terminado. Confirmá que quedó todo bien y finalizalo para calificar al profesional.',

  tipWorkerAccepted:         '⚡ Conducí con precaución. Avisamos al cliente que ya vas en camino.',
  tipWorkerArrived:          '🔑 Mostrá tu código antes de que el cliente abra. Es obligatorio.',
  tipWorkerInProgress:       '🔧 Describí el trabajo al cliente antes de empezar para evitar malentendidos.',
  tipWorkerAwaitingPayment:  '💳 El cliente pagará por la app. BOLT registra todo.',
  tipWorkerAwaitingPaymentFree:  '✅ Marcá el trabajo como finalizado al terminar. El pago lo coordinás directamente con el cliente.',

  // ── Despedida ─────────────────────────────────────────────────────────────
  farewell: (name) =>
    `Esperamos que el servicio haya salido bien. ${name} queda guardado en Mis profesionales para futuros trabajos.`,
  farewellGeneric:
    'Esperamos que el servicio haya salido bien. Tu valoración ayuda a toda la comunidad BOLT.',

  // ── Emergencia ────────────────────────────────────────────────────────────
  emergencyHeadline:
    'Buscaremos el profesional disponible más cercano. Priorizamos velocidad sobre precio.',

  // ── Estados vacíos ────────────────────────────────────────────────────────
  chatEmpty:
    'BOLT coordina este trabajo.\nUsá el chat para comunicarte con el profesional.',

  // ── VOLT socio (acompaña al trabajador) ────────────────────────────────────
  // Tono más cercano y motivador: VOLT es el socio del trabajador, no un sistema.
  coachWelcome: (name) =>
    `¡Bienvenido a BOLT, ${name}! 👋 Soy BOLT, tu socio en cada trabajo. Acá tu esfuerzo se premia: cuanto más activo estás y mejor te califican, menos comisión te descuenta la app.`,
  // Modo gratis (sin comisión): el pago lo coordinan directo cliente↔profesional
  coachWelcomeFree: (name) =>
    `¡Bienvenido a BOLT, ${name}! 👋 Soy BOLT, tu socio en cada trabajo. Por ahora la app es 100% gratis: recibís pedidos de tu zona y cobrás directo al cliente, sin comisión. Mantené buenas calificaciones para que más clientes te elijan.`,
  coachActiveFree:
    'Seguí sumando trabajos y buenas calificaciones: cuantos más clientes atendés y mejor te valoran, más te eligen. La app es gratis y cobrás el 100% directo. 💪',
  coachCommission:
    'Arrancás con 20% de comisión. A medida que sumás trabajo (y mantenés tus buenas calificaciones), baja: 18% → 16% → hasta 14%. Se mide tu actividad de los últimos 30 días, así que mantené el ritmo.',
  coachFirstStep:
    'Activá tu disponibilidad para recibir tu primer pedido. Un consejo: respondé rápido, los clientes eligen al primero que contesta. 💪',
  coachVolumeProgress: (falta, nextPct) =>
    `Vas muy bien. Te faltan $${Number(falta).toLocaleString('es-AR')} de facturación (últimos 30 días) para bajar tu comisión a ${nextPct}%. 💪`,
  coachElite:
    '¡Estás en la comisión más baja (14%)! ⚡ Sos de los profesionales más activos y mejor valorados de BOLT. Mantené el ritmo del mes para conservarla.',
  coachPostJob: (earned, pct) =>
    pct > 0
      ? `¡Buen trabajo! Cobraste $${Number(earned).toLocaleString('es-AR')} (comisión ${pct}%). Cada trabajo te mantiene en tu nivel.`
      : `¡Buen trabajo! Ganaste $${Number(earned).toLocaleString('es-AR')}. ¡Seguí sumando trabajos! ⚡`,

  // ── Multi-día (VOLT acompaña la pausa entre jornadas) ───────────────────────
  chatMultidayPlan: (days) =>
    `Este trabajo se realizará en ${days} días. Te avisaremos cada vez que se cierre una jornada y cuándo regresa el profesional.`,
  chatSessionEnded: (name, label) =>
    `Jornada cerrada. ${name} vuelve ${label} para continuar. Tu trabajo está en marcha y monitoreado por BOLT.`,
  chatMultidayConfirm: (name, label) =>
    `${name} propone continuar ${label}. ¿Te queda bien ese horario?`,

  // ── Materiales (VOLT media la compra y el comprobante) ──────────────────────
  chatMaterialsEstimate: (name, detail, amount) =>
    `${name} avisa que el trabajo necesita materiales: ${detail} (~$${Number(amount).toLocaleString('es-AR')}). Los materiales se pagan aparte, directo al profesional. ¿Preferís que los compre él o los conseguís vos?`,
  chatMaterialsClientBuys:
    'Perfecto, vos conseguís los materiales. Coordinalo con el profesional por el chat.',
  chatMaterialsProBuys: (name) =>
    `${name} se encarga de comprar los materiales. Recordá que se abonan aparte, no van dentro del pago de la app.`,
};

export default volt;

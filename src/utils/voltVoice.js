// GOVOLT — coordinador invisible. Nunca robótico, siempre profesional.

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
  chatMonitoring: 'Trabajo monitoreado por GOVOLT.',

  // ── Tracking tips ─────────────────────────────────────────────────────────
  tipPending:         'Encontramos profesionales disponibles. Generalmente llegan en menos de 30 min.',
  tipAccepted:        'Te avisaremos si hay cambios. Podés seguir en tiempo real su recorrido.',
  tipArrived:         'Verificá el código antes de abrir. Es tu garantía de que es un profesional GOVOLT.',
  tipInProgress:      'El trabajo está en curso. Todos nuestros profesionales tienen antecedentes verificados.',
  tipAwaitingPayment: 'El pago es seguro y procesado por GOVOLT. Nunca pagues en efectivo.',

  tipWorkerAccepted:         '⚡ Conducí con precaución. Avisamos al cliente que ya vas en camino.',
  tipWorkerArrived:          '🔑 Mostrá tu código antes de que el cliente abra. Es obligatorio.',
  tipWorkerInProgress:       '🔧 Describí el trabajo al cliente antes de empezar para evitar malentendidos.',
  tipWorkerAwaitingPayment:  '💳 El cliente pagará por la app. GOVOLT registra todo.',

  // ── Despedida ─────────────────────────────────────────────────────────────
  farewell: (name) =>
    `Esperamos que el servicio haya salido bien. ${name} queda guardado en Mis profesionales para futuros trabajos.`,
  farewellGeneric:
    'Esperamos que el servicio haya salido bien. Tu valoración ayuda a toda la comunidad GOVOLT.',

  // ── Emergencia ────────────────────────────────────────────────────────────
  emergencyHeadline:
    'Buscaremos el profesional disponible más cercano. Priorizamos velocidad sobre precio.',

  // ── Estados vacíos ────────────────────────────────────────────────────────
  chatEmpty:
    'GOVOLT coordina este trabajo.\nUsá el chat para comunicarte con el profesional.',
};

export default volt;

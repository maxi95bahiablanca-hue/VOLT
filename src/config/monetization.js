// ─── Modo de monetización de BOLT ───────────────────────────────────────────
// Controla si la app cobra por adentro y qué pasos de pago se muestran.
//
//  'free'         → FASE DE LANZAMIENTO. La app NO cobra nada: el cliente le paga
//                   DIRECTO al profesional (efectivo/transferencia/lo que arreglen).
//                   Se OCULTAN todos los pasos de pago (visita, escrow, cobro final,
//                   CUIT/CBU). El flujo queda limpio: pedido → match → trabajo → rating.
//  'commission'   → Se cobra cada trabajo por la app (visita + mano de obra) con
//                   comisión BOLT. (Modelo a futuro.)
//  'subscription' → Los profesionales pagan una suscripción mensual; el trabajo
//                   se paga directo. (Modelo a futuro.)
//
// Para cambiar de modelo, se cambia SOLO esta constante.
export const MONETIZATION_MODE = 'free';

// La app maneja el dinero del trabajo (visita + cobro por la app)
export const chargesInApp = () => MONETIZATION_MODE === 'commission';

// Fase gratuita: nada se cobra por la app, pago directo cliente↔profesional
export const isFreeMode = () => MONETIZATION_MODE === 'free';

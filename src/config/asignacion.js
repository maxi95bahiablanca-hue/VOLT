// ─── Cómo se le reparte un pedido a los profesionales ───────────────────────
//
//  'cascada'  → EL PEDIDO VA DE A UNO. Se le ofrece al mejor candidato; si no
//               contesta en SEGUNDOS_POR_TURNO, pasa solo al siguiente. Nadie
//               compite y nadie pierde.
//  'subasta'  → Se le manda a varios a la vez y el cliente elige entre los que
//               respondieron. Es lo que había hasta el 1-ago-2026.
//
// POR QUÉ SE PASÓ A CASCADA (decisión de Maxi, 1-ago-2026): "¿para qué los
// haríamos competir a los tres en vez de darles trabajo?". Con dos
// profesionales activos, elegir entre tres es una ficción; en modo gratuito no
// hay tres precios que comparar; y cada ronda deja dos perdedores, que es la
// forma más rápida de que apaguen el radar — y el radar apagado es hoy el
// problema número uno.
//
// CUÁNDO CONVIENE VOLVER A 'subasta': cuando haya varios profesionales del
// mismo oficio con el radar prendido Y se vuelva a cobrar por la app, donde el
// precio hace que comparar valga la pena. Por eso queda como interruptor y no
// se borró el otro camino.
//
// ⚠️ LO QUE HAY QUE CUIDAR DE LA CASCADA: mandándolo a varios a la vez, si uno
// fallaba otro lo agarraba. Acá el pedido depende de que el pase automático
// funcione siempre. Si el turno vence y nadie pasó el trabajo, se cae en
// silencio — por eso el rescate (rescueService) sigue siendo la red de abajo.
export const MODO_ASIGNACION = 'cascada';

export const esCascada = () => MODO_ASIGNACION === 'cascada';
export const esSubasta = () => MODO_ASIGNACION === 'subasta';

// Cuánto se le da a cada profesional para contestar antes de pasar al siguiente.
// 🔴 180 s (decisión de Maxi, 23-ago): coincide con lo que la app y el push YA le
//    prometen al profesional ("3 minutos"). Antes eran 90 s y el que contestaba
//    entre el segundo 91 y el 180 —dentro del plazo prometido— ya había perdido el
//    turno. Ahora el turno real y el contador visible (TIMEOUT_SEC) son lo mismo.
export const SEGUNDOS_POR_TURNO = 180;

// A cuántos se les ofrece como máximo antes de mandarlo a rescate.
export const MAX_INTENTOS = 5;

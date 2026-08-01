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
// 90 s: alcanza para sacar el teléfono del bolsillo y decidir, sin que el
// cliente sienta que no pasa nada. La ventana visible en la app sigue siendo de
// 3 minutos (TIMEOUT_SEC) para el que ya lo tiene abierto.
export const SEGUNDOS_POR_TURNO = 90;

// A cuántos se les ofrece como máximo antes de mandarlo a rescate.
export const MAX_INTENTOS = 5;

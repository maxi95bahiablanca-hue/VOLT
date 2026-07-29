// Datos del encargado que atiende cuando la app no puede resolver sola.
//
// La regla es que el cliente NUNCA se quede sin salida: si no hay ningún
// profesional disponible, el pedido no se pierde, pasa a una persona.
export const SOPORTE = {
  // WhatsApp del encargado (el mismo que ya usa el botón de soporte del
  // seguimiento). Sin "+" ni espacios: formato de wa.me.
  whatsapp: '5492914199938',
  // Usuario de BOLT del encargado, para mandarle la notificación adentro de la app.
  adminUserId: '185bf657-22e3-44a5-94a9-4ff9a29ae211',
  nombre: 'el equipo de BOLT',
};

// Link de WhatsApp con el mensaje ya escrito. Al abrirlo desde el celular del
// cliente, el mensaje le llega al encargado DESDE el número del cliente: no hay
// que pedirle el teléfono, ya viene con la conversación.
export const linkWhatsApp = (texto) =>
  `https://wa.me/${SOPORTE.whatsapp}?text=${encodeURIComponent(texto)}`;

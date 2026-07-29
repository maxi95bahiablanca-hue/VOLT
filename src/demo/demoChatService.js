// Chat simulado para el modo demo — el "profesional" responde a lo que escribís.
import { DEMO_CHAT_MESSAGES } from './demoData';
import volt from '../utils/voltVoice';

// Mensajes automáticos de VOLT/sistema que aparecen solos durante el demo
const AUTO_MESSAGES = [
  { delay: 4000,  content: volt.chatAccepted },
  { delay: 9000,  content: volt.chatInTransit },
  { delay: 15000, content: volt.chatNearby },
  { delay: 21000, content: 'Carlos llegó al lugar. Verificá el código antes de abrir.' },
  { delay: 30000, content: volt.chatStarted },
];

let _msgId = 100;
const newId = () => `demo-msg-${_msgId++}`;

// Referencia viva a la suscripción activa (para empujar respuestas del "profesional")
let _onNew = null;

// Genera la respuesta del profesional demo según lo que escribió el cliente
function workerReply(text) {
  const t = (text || '').toLowerCase();
  if (/(hola|buenas|buen d|qué tal|que tal)/.test(t))
    return '¡Hola! ¿Cómo estás? Ya estoy viendo tu pedido 👍';
  if (/(hora|cuándo|cuando|tardas|tardás|llegas|llegás|demora|cuánto falta|cuanto falta)/.test(t))
    return 'Estoy a unos 10 minutos, ya voy en camino 🚗';
  if (/(precio|cuánto|cuanto|sale|cuesta|cobrás|cobras|valor|presupuesto)/.test(t))
    return 'La visita son $30.000. Apenas vea el problema te paso el presupuesto del trabajo.';
  if (/(código|codigo|verific)/.test(t))
    return 'Cuando llegue te muestro mi código de 4 dígitos así verificás que soy yo 👌';
  if (/(material|repuesto|comprar|disyuntor|cable)/.test(t))
    return 'Si hace falta algún material te aviso el costo antes. Eso se paga aparte, directo a mí.';
  if (/(gracias|genial|perfecto|dale|buenísimo|buenisimo|barbaro|bárbaro)/.test(t))
    return '¡De nada! Cualquier cosa avisame 🙌';
  if (/(dónde|donde|dirección|direccion|ubicación|ubicacion)/.test(t))
    return 'Tengo tu dirección, ya la cargué. Voy para allá.';
  if (/(problema|no anda|no funciona|roto|pérdida|perdida|fuga|corto)/.test(t))
    return 'Entiendo, lo reviso apenas llegue. Por lo que me contás no parece grave.';
  const generic = [
    'Perfecto, anotado 👍',
    'Dale, lo vemos apenas llegue.',
    'Sin problema, lo resolvemos.',
    'Buenísimo, gracias por avisar.',
  ];
  return generic[Math.floor(Math.random() * generic.length)];
}

const demoChatService = {
  getMessages: async (_jobId) => [...DEMO_CHAT_MESSAGES],

  // El cliente manda un mensaje → el profesional demo responde solo, poco después
  sendMessage: async (_jobId, senderId, content) => {
    const mine = {
      id: newId(), type: 'text', sender_id: senderId,
      content, created_at: new Date().toISOString(), read_by_other: true,
    };
    if (_onNew) {
      const reply = workerReply(content);
      const delay = 1200 + Math.random() * 1200;
      setTimeout(() => {
        _onNew && _onNew({
          id: newId(), type: 'text', sender_id: 'demo-prof-1',
          content: reply, created_at: new Date().toISOString(), read_by_other: false,
        });
      }, delay);
    }
    return mine;
  },

  // En el demo no hay servidor donde subir nada: se muestra el adjunto local y
  // el profesional contesta como si lo hubiera visto.
  sendAttachment: async (_jobId, senderId, { uri, tipo, nombre, duracion }) => {
    const etiquetas = { image: '📷 Foto', video: '🎥 Video', audio: '🎤 Audio', file: '📎 Archivo' };
    const mine = {
      id: newId(), type: 'text', sender_id: senderId,
      content: etiquetas[tipo] || '📎 Adjunto',
      attachment_url: uri, attachment_type: tipo,
      attachment_name: nombre ?? null, attachment_duration: duracion ?? null,
      created_at: new Date().toISOString(), read_by_other: true,
    };
    if (_onNew) {
      _onNew(mine);
      setTimeout(() => {
        _onNew && _onNew({
          id: newId(), type: 'text', sender_id: 'demo-prof-1',
          content: tipo === 'audio' ? 'Escuché el audio, ya entiendo el problema 👌' : 'Vi lo que me mandaste, gracias 👍',
          created_at: new Date().toISOString(), read_by_other: false,
        });
      }, 1600);
    }
    return mine;
  },

  sendSystemMessage: async () => {},
  markAsRead: async () => {},
  getUnreadCount: async () => 0,

  subscribeToMessages: (_jobId, onNew) => {
    _onNew = onNew;
    const timers = AUTO_MESSAGES.map(({ delay, content }) =>
      setTimeout(() => onNew({
        id: newId(), type: 'system', sender_id: null,
        content, created_at: new Date().toISOString(), read_by_other: true,
      }), delay)
    );
    // Saludo inicial del profesional (persona real simulada)
    const profTimer = setTimeout(() => onNew({
      id: newId(), type: 'text', sender_id: 'demo-prof-1',
      content: 'Hola, soy Carlos 👋 Ya salí para tu domicilio. Escribime lo que necesites.',
      created_at: new Date().toISOString(), read_by_other: false,
    }), 6500);

    return {
      unsubscribe: () => {
        timers.forEach(clearTimeout);
        clearTimeout(profTimer);
        _onNew = null;
      },
    };
  },
};

export default demoChatService;

// Chat simulado para el modo demo
import { DEMO_CHAT_MESSAGES } from './demoData';
import volt from '../utils/voltVoice';

const AUTO_MESSAGES = [
  { delay: 4000,  content: volt.chatAccepted },
  { delay: 8000,  content: volt.chatInTransit },
  { delay: 13000, content: volt.chatNearby },
  { delay: 18000, content: 'Carlos llegó al lugar. Verificá el código antes de abrir.' },
  { delay: 27000, content: volt.chatStarted },
  { delay: 40000, content: volt.chatDone },
];

let _msgId = 100;
const newId = () => `demo-msg-${_msgId++}`;

const demoChatService = {
  getMessages: async (_jobId) => [...DEMO_CHAT_MESSAGES],

  sendMessage: async (_jobId, _senderId, content) => ({
    id: newId(), type: 'text', sender_id: _senderId,
    content, created_at: new Date().toISOString(), read_by_other: false,
  }),

  sendSystemMessage: async () => {},

  markAsRead: async () => {},

  getUnreadCount: async () => 0,

  subscribeToMessages: (_jobId, onNew) => {
    const timers = AUTO_MESSAGES.map(({ delay, content }) =>
      setTimeout(() => onNew({
        id: newId(), type: 'system', sender_id: null,
        content, created_at: new Date().toISOString(), read_by_other: true,
      }), delay)
    );
    // Mensaje del profesional en el chat (persona real simulada)
    const profTimer = setTimeout(() => onNew({
      id: newId(), type: 'text', sender_id: 'demo-prof-1',
      content: 'Hola, ya salí. Llego en unos minutos.',
      created_at: new Date().toISOString(), read_by_other: false,
    }), 6000);

    return { unsubscribe: () => { timers.forEach(clearTimeout); clearTimeout(profTimer); } };
  },
};

export default demoChatService;

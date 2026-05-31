// Reemplaza subscripciones reales en modo demo
import { DEMO_JOB, DEMO_GPS_PATH } from './demoData';

// Secuencia de estados que el job atraviesa automáticamente
const JOB_TIMELINE = [
  { delay: 3000,  patch: { status: 'accepted', arrival_estimate: '~12 min', pre_diagnosis: 'Probablemente un disyuntor desgastado o sobrecarga. Lo reviso al llegar.' } },
  { delay: 10000, patch: { sub_status: 'nearby' } },
  { delay: 16000, patch: { status: 'arrived', arrived_at: new Date().toISOString() } },
  { delay: 25000, patch: { status: 'in_progress', work_started_at: new Date().toISOString() } },
  { delay: 38000, patch: { status: 'awaiting_payment', work_amount: 22000, materials_cost: 0 } },
];

const demoJobService = {
  subscribeToJob: (jobId, onUpdate) => {
    const timers = JOB_TIMELINE.map(({ delay, patch }) =>
      setTimeout(() => onUpdate({ ...DEMO_JOB, ...patch }), delay)
    );
    return { unsubscribe: () => timers.forEach(clearTimeout) };
  },

  subscribeWorkerLocation: (_profId, onUpdate) => {
    let step = 0;
    const timer = setInterval(() => {
      if (step < DEMO_GPS_PATH.length) {
        const { lat, lng } = DEMO_GPS_PATH[step];
        onUpdate(`POINT(${lng} ${lat})`);
        step++;
      } else {
        clearInterval(timer);
      }
    }, 2200);
    return { unsubscribe: () => clearInterval(timer) };
  },

  // Quote: auto-acepta el primer job después de 3s
  subscribeQuoteJobs: (jobIds, onChange) => {
    const [firstId] = jobIds;
    const timer = setTimeout(() => {
      onChange({ ...DEMO_JOB, id: firstId, status: 'accepted' });
    }, 3000);
    return { unsubscribe: () => clearTimeout(timer) };
  },

  // Stubs de mutaciones — no hacen nada real
  arrive:              async () => {},
  start:               async () => {},
  setWorkAmount:       async () => {},
  complete:            async () => {},
  cancel:              async () => {},
  markVisitPaid:       async () => {},
  addEvent:            async () => {},
  setSubStatus:        async () => {},
  selectFromQuoteGroup: async (_jobId, _groupId) => ({ ...DEMO_JOB, status: 'accepted' }),
};

export default demoJobService;

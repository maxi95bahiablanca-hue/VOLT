// Datos falsos para el Demo Mode — no conecta con Supabase

export const DEMO_PROFESSIONAL = {
  id: 'demo-prof-1',
  user_id: 'demo-user-1',
  first_name: 'Carlos',
  last_name: 'Rodríguez',
  avg_rating: 4.9,
  effective_rating: 4.9,
  completed_jobs: 247,
  on_time_completions: 238,
  avg_arrival_minutes: 8,
  complaints_count: 1,
  recommend_pct: 97,
  avatar_url: null,
  min_price: 25000,
  available: true,
  estudios_url: 'demo',
  distance_meters: 850,
  profession_name: 'Electricidad',
  profession_id: 1,
};

export const DEMO_JOB = {
  id: 'demo-job-1',
  status: 'pending',
  client_id: 'demo-client-1',
  professional_id: 'demo-prof-1',
  profession_id: 1,
  address: 'Av. Colón 80, Bahía Blanca',
  notes: 'El disyuntor del baño se dispara seguido.',
  visit_amount: 25000,
  commission_pct: 20,
  verification_code: '4872',
  client_lat: -38.7196,
  client_lng: -62.2724,
  work_started_at: null,
  work_amount: null,
  materials_cost: 0,
  visit_paid: false,
  is_multiday: false,
  arrival_estimate: '~12 min',
  pre_diagnosis: 'Probablemente un disyuntor desgastado o sobrecarga. Lo reviso al llegar.',
  sub_status: null,
  diagnosis_structured: {
    summary: 'Posible disyuntor desgastado',
    cause: 'Sobrecarga eléctrica en el circuito del baño',
    confidence: 'Alta',
    materials: ['Disyuntor 16A'],
    cost_min: 8000,
    cost_max: 15000,
    time_est: '~45 min',
  },
  professionals: {
    id: 'demo-prof-1',
    user_id: 'demo-user-1',
    first_name: 'Carlos',
    last_name: 'Rodríguez',
    avg_rating: 4.9,
    effective_rating: 4.9,
    completed_jobs: 247,
    on_time_completions: 238,
    avg_arrival_minutes: 8,
    complaints_count: 1,
    recommend_pct: 97,
    avatar_url: null,
  },
  professions: { id: 1, name: 'Electricidad' },
};

// Segundo profesional (no responde, para simular competencia)
export const DEMO_JOB_2 = {
  id: 'demo-job-2',
  status: 'pending',
  client_id: 'demo-client-1',
  professional_id: 'demo-prof-2',
  profession_id: 1,
  address: 'Av. Colón 80, Bahía Blanca',
  notes: 'El disyuntor del baño se dispara seguido.',
  visit_amount: 32000,
  professionals: {
    id: 'demo-prof-2',
    first_name: 'Martín',
    last_name: 'González',
    avg_rating: 4.5,
    effective_rating: 4.5,
    completed_jobs: 89,
    on_time_completions: 78,
    avg_arrival_minutes: 20,
    complaints_count: 3,
    recommend_pct: 82,
    avatar_url: null,
  },
  professions: { id: 1, name: 'Electricidad' },
};

export const DEMO_QUOTE_JOBS = [DEMO_JOB, DEMO_JOB_2];

// Path GPS: el trabajador se acerca desde el sur
export const DEMO_GPS_PATH = [
  { lat: -38.7310, lng: -62.2700 },
  { lat: -38.7280, lng: -62.2708 },
  { lat: -38.7250, lng: -62.2714 },
  { lat: -38.7230, lng: -62.2718 },
  { lat: -38.7215, lng: -62.2720 },
  { lat: -38.7203, lng: -62.2722 },
  { lat: -38.7198, lng: -62.2723 },
];

export const DEMO_CHAT_MESSAGES = [
  { id: 'dm-1', type: 'system', content: 'Estamos verificando disponibilidad en tu zona.', sender_id: null, created_at: new Date().toISOString(), read_by_other: true },
];

export const DEMO_COMPLETED_JOB = {
  ...DEMO_JOB,
  status: 'completed',
  work_amount: 22000,
  materials_cost: 0,
  visit_paid: false,
  work_started_at: new Date(Date.now() - 20 * 60000).toISOString(),
  completed_at: new Date().toISOString(),
};

import { supabase } from '../supabase';
import volt from '../utils/voltVoice';
import { commissionForBilled } from '../utils/commission';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Facturación (mano de obra) de un trabajador en los últimos 30 días (RPC con service-side).
async function billed30Of(professionalId) {
  try {
    const { data } = await supabase.rpc('worker_billed_30d', { p_professional_id: professionalId });
    return Number(data) || 0;
  } catch { return 0; }
}

const jobService = {
  getById: async (jobId) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professions(name), professionals(id, user_id, first_name, last_name, phone, avatar_url)')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  create: async ({ clientId, professionalId, professionId, professionName, clientLat, clientLng, address, notes, commissionPct, visitAmount }) => {
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        client_id:       clientId,
        professional_id: professionalId,
        profession_id:   professionId,
        client_lat:      clientLat,
        client_lng:      clientLng,
        address,
        notes,
        visit_amount:    visitAmount ?? 30000,   // precio que fijó el trabajador
        commission_pct:  commissionPct ?? 20,
      })
      .select()
      .single();
    if (error) throw error;
    supabase.from('job_events').insert({
      job_id: data.id,
      event_type: 'received',
      message: 'Estamos buscando profesionales disponibles cerca tuyo.',
    }).catch(() => {});
    supabase.from('messages').insert({
      job_id: data.id, sender_id: null, type: 'system',
      content: volt.chatCreated,
    }).catch(() => {});
    return data;
  },

  getActiveForClient: async (clientId) => {
    const { data, error } = await supabase
      .from('jobs')
      .select(`*, professionals(id, first_name, last_name, phone, location, completed_jobs, avg_rating, avatar_url)`)
      .eq('client_id', clientId)
      .in('status', ['pending','accepted','arrived','in_progress','awaiting_payment'])
      .is('quote_group_id', null)
      .order('created_at', { ascending: false })
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  getPendingForWorker: async (professionalId) => {
    // Solo pedidos recientes: una solicitud tiene ~45 s de ventana, así que un
    // "pending" de hace horas ya expiró y no debe reaparecer como entrante.
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professions(name)')
      .eq('professional_id', professionalId)
      .eq('status', 'pending')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  getActiveForWorker: async (professionalId) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professions(name)')
      .eq('professional_id', professionalId)
      .in('status', ['accepted','arrived','in_progress','awaiting_payment'])
      // Excluir presupuestos aún no elegidos por el cliente (tienen quote_group_id):
      // mientras esperan selección NO son un trabajo "activo", así el profesional
      // puede minimizar y seguir usando la app sin que el polling lo re-atrape.
      .is('quote_group_id', null)
      .order('created_at', { ascending: false })
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  accept: async (jobId, preDiagnosis, arrivalEstimate, materialsNeeded, workDuration) => {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    return update(jobId, {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      verification_code: code,
      ...(preDiagnosis    ? { pre_diagnosis:      preDiagnosis    } : {}),
      ...(arrivalEstimate ? { arrival_estimate:    arrivalEstimate } : {}),
      ...(materialsNeeded != null ? { materials_needed: materialsNeeded } : {}),
      ...(workDuration    ? { work_duration_est:   workDuration    } : {}),
    });
  },

  reject: async (jobId, professionalId, category, note) => {
    await update(jobId, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      ...(category ? { rejection_category: category } : {}),
      ...(note     ? { rejection_note: note }         : {}),
    });
    if (professionalId) {
      await supabase.rpc('penalize_worker_rejection', { p_professional_id: professionalId });
    }
  },

  arrive:  async (jobId) => update(jobId, { status: 'arrived',     arrived_at:      new Date().toISOString() }),
  start:   async (jobId) => update(jobId, { status: 'in_progress', work_started_at: new Date().toISOString() }),
  // Cuando el profesional dice cuando va (o que ya salio). Campos de la
  // migracion 040: scheduled_for / scheduled_ok / on_the_way_at.
  setSchedule: async (jobId, campos) => update(jobId, campos),

  complete: async (jobId) => update(jobId, { status: 'completed',  completed_at:    new Date().toISOString() }),
  cancel:  async (jobId, userId) => update(jobId, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId }),

  startBuyingMaterials: async (jobId, minutesAway) => {
    const eta = new Date(Date.now() + minutesAway * 60000).toISOString();
    return update(jobId, { is_buying_materials: true, materials_eta: eta });
  },

  returnedWithMaterials: async (jobId) =>
    update(jobId, { is_buying_materials: false, materials_eta: null }),

  // ─── Materiales: estimación → aprobación → comprobante → tope ──────────────
  proposeMaterials: async (jobId, estimate, detail) =>
    update(jobId, {
      materials_needed:          true,
      materials_status:          'proposed',
      materials_estimate:        parseInt(estimate, 10) || 0,
      materials_estimate_detail: detail || null,
    }),

  // mode: 'pro' (lo compra el profesional) | 'client' (lo consigue el cliente). Materiales se pagan APARTE, no por la app.
  approveMaterials: async (jobId, mode) =>
    update(jobId, { materials_status: mode === 'client' ? 'client_provides' : 'approved' }),

  // ─── Confirmación del cliente del plan multi-día ──────────────────────────
  confirmMultiday: async (jobId) => update(jobId, { multiday_confirmed: true }),

  // ─── Sesiones multi-día ──────────────────────────────────────────────────
  // El multi-día es SOLO una marca: los días y las horas se acordaron por chat
  // (Maxi, 1-ago-2026). Los parámetros quedan por compatibilidad, pero si no
  // vienen no se escribe nada — ojo que `parseInt(null)` da NaN y el update
  // fallaría entero, dejando el trabajo sin marcar.
  setMultidayConfig: async (jobId, sessions = null, hrsPerSession = null) => {
    const n = parseInt(sessions, 10);
    return update(jobId, {
      is_multiday: true,
      ...(Number.isFinite(n)  ? { estimated_sessions: n }              : {}),
      ...(hrsPerSession       ? { estimated_hrs_session: hrsPerSession } : {}),
    });
  },

  startSession: async (jobId) =>
    update(jobId, {
      status: 'in_progress',
      work_started_at:       new Date().toISOString(),
      current_session_start: new Date().toISOString(),
    }),

  endSession: async (jobId, sessionStartIso, completedSessions, totalMinutesBefore) => {
    const started  = new Date(sessionStartIso);
    const now      = new Date();
    const minutes  = Math.round((now - started) / 60000);
    return update(jobId, {
      status:                'arrived',
      current_session_start: null,
      completed_sessions:    completedSessions + 1,
      total_minutes_worked:  totalMinutesBefore + minutes,
      scheduled_return:      null,
      // De acá sale el "pasó un día y no hubo novedades" (migración 044).
      ultima_jornada_at:     now.toISOString(),
    });
  },

  // ─── Seguimiento del día siguiente (migración 044) ────────────────────────
  // "¿Vino? ¿Todo bien?" — se le pregunta al cliente en vez de adivinar por
  // GPS: el GPS en segundo plano lo mata Android, gasta batería, y si se
  // equivoca (sin señal, un sótano) acusás a alguien que sí fue.
  /** ¿Corresponde preguntarle hoy por este trabajo? */
  tocaPreguntar: (job) => {
    if (!job?.is_multiday || !job?.ultima_jornada_at) return false;
    if (job.current_session_start) return false;              // está trabajando ahora
    if (!['accepted', 'arrived', 'in_progress'].includes(job.status)) return false;
    const HS20 = 20 * 60 * 60 * 1000;
    const pasoUnDia = Date.now() - new Date(job.ultima_jornada_at).getTime() > HS20;
    const yaPregunte = job.seguimiento_at && (Date.now() - new Date(job.seguimiento_at).getTime() < HS20);
    return pasoUnDia && !yaPregunte;
  },

  /** Lo que contestó: 'vino_ok' | 'vino_problema' | 'no_vino' */
  responderSeguimiento: async (jobId, respuesta) =>
    update(jobId, { seguimiento_at: new Date().toISOString(), seguimiento_respuesta: respuesta }),

  endSessionWithReturn: async (jobId, sessionStartIso, completedSessions, totalMinutesBefore, returnIso) => {
    const started  = new Date(sessionStartIso);
    const now      = new Date();
    const minutes  = Math.round((now - started) / 60000);
    return update(jobId, {
      status:                'arrived',
      current_session_start: null,
      completed_sessions:    completedSessions + 1,
      total_minutes_worked:  totalMinutesBefore + minutes,
      scheduled_return:      returnIso,
    });
  },

  // visit_paid lo marca ÚNICAMENTE el webhook de MP (service_role): un trigger
  // en la base rechaza el cambio desde la app (antes cualquier cliente podía
  // marcarse la visita como pagada sin pagar).

  // Precio del trabajo (mano de obra): el profesional lo propone al llegar y el
  // cliente lo acepta/rechaza ANTES de empezar. Al aceptar, el trabajo arranca
  // (queda registrado el monto acordado → cubre reclamos posteriores).
  proposeWorkPrice: async (jobId, amount) =>
    update(jobId, { work_amount: amount, work_price_status: 'proposed' }),

  respondWorkPrice: async (jobId, accepted) =>
    update(jobId, accepted
      ? { work_price_status: 'accepted', status: 'in_progress', work_started_at: new Date().toISOString() }
      : { work_price_status: 'rejected' }),

  convertToMultiday: async (jobId, sessions, hrsPerSession) =>
    update(jobId, {
      is_multiday:           true,
      estimated_sessions:    parseInt(sessions, 10),
      estimated_hrs_session: hrsPerSession,
      // Arranca la sesión del día ya en curso, así aparece el botón "Terminar por
      // hoy · vuelvo mañana" (sin esto el trabajador queda sin ningún botón).
      current_session_start: new Date().toISOString(),
    }),

  setStructuredDiagnosis: async (jobId, diagnosis) =>
    update(jobId, { diagnosis_structured: diagnosis }),

  setWorkSummary: async (jobId, summary) =>
    update(jobId, { work_summary: summary }),

  setSubStatus: async (jobId, subStatus) =>
    update(jobId, { sub_status: subStatus }),

  completeMultidayJob: async (jobId, laborAmount, materialsCost = 0, sessionStartIso, completedSessions, totalMinutesBefore) => {
    const extraMinutes = sessionStartIso
      ? Math.round((Date.now() - new Date(sessionStartIso)) / 60000)
      : 0;
    return update(jobId, {
      status:                'awaiting_payment',
      work_amount:           laborAmount,
      materials_cost:        materialsCost,
      current_session_start: null,
      completed_sessions:    completedSessions + (sessionStartIso ? 1 : 0),
      total_minutes_worked:  totalMinutesBefore + extraMinutes,
    });
  },

  updateDiagnosis: async (jobId, diagnosis, isFinal = false) =>
    update(jobId, isFinal ? { final_diagnosis: diagnosis } : { pre_diagnosis: diagnosis }),

  setWorkAmount: async (jobId, laborAmount, materialsCost = 0) =>
    update(jobId, {
      status:         'awaiting_payment',
      work_amount:    laborAmount,
      materials_cost: materialsCost,
    }),

  // Modo gratis: registra los montos SIN cambiar el estado (el trabajo se
  // completa directo, sin pasar por awaiting_payment).
  recordWorkAmount: async (jobId, laborAmount, materialsCost = 0) =>
    update(jobId, {
      work_amount:    laborAmount,
      materials_cost: materialsCost,
    }),

  submitReview: async ({ jobId, clientId, professionalId, rating, comment }) => {
    const { error } = await supabase.from('reviews').insert({
      job_id: jobId, client_id: clientId,
      professional_id: professionalId, rating, comment,
    });
    if (error) throw error;
  },

  // ─── Calificación DEL CLIENTE, la escribe el profesional (migración 043) ───
  // Tabla aparte de `reviews` porque aquella tiene job_id UNIQUE.
  rateClient: async ({ jobId, clientId, professionalId, rating, motivo, comment }) => {
    const { error } = await supabase.from('client_reviews').insert({
      job_id: jobId, client_id: clientId, professional_id: professionalId,
      rating,
      ...(motivo  ? { motivo }  : {}),
      ...(comment ? { comment } : {}),
    });
    if (error) throw error;
  },

  // Lo que ve el profesional ANTES de aceptar: promedio y cantidad, nada más.
  // Nunca tira: un cliente sin calificaciones es lo normal al principio y no
  // puede frenar la pantalla del trabajo entrante.
  getClientReputation: async (clientId) => {
    if (!clientId) return { promedio: null, cantidad: 0 };
    try {
      const { data, error } = await supabase.rpc('client_reputation', { p_client_id: clientId });
      if (error) throw error;
      const fila = Array.isArray(data) ? data[0] : data;
      const cantidad = Number(fila?.cantidad) || 0;
      return { promedio: cantidad > 0 ? Number(fila.promedio) : null, cantidad };
    } catch {
      return { promedio: null, cantidad: 0 };
    }
  },

  // `problemPhotos` es la lista completa (migración 033). `problemPhotoUrl` se
  // sigue mandando con la primera para las pantallas viejas.
  createQuoteGroup: async ({ clientId, workers, professionId, clientLat, clientLng, address, notes, problemPhotoUrl, problemPhotos }) => {
    const quoteGroupId = uuidv4();
    const rows = await Promise.all(workers.map(async w => {
      const billed30 = await billed30Of(w.id);
      return {
        client_id:         clientId,
        professional_id:   w.id,
        profession_id:     professionId,
        client_lat:        clientLat,
        client_lng:        clientLng,
        address,
        notes,
        // `??` y no `||`: en modo gratuito min_price es 0 y con `||` se grababa
        // $30.000 en la base, un costo que no existe (quedó afuera del fix de
        // las pantallas del 31-jul y este es el que ESCRIBE el dato).
        visit_amount:      w.min_price ?? 30000,
        commission_pct:    commissionForBilled(billed30, w.avg_rating),
        quote_group_id:    quoteGroupId,
        ...(problemPhotoUrl ? { problem_photo_url: problemPhotoUrl } : {}),
        ...(problemPhotos?.length ? { problem_photos: problemPhotos } : {}),
      };
    }));
    const { data, error } = await supabase
      .from('jobs')
      .insert(rows)
      .select('*, professions(name), professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs, on_time_completions, avg_arrival_minutes, complaints_count, recommend_pct, avatar_url)');
    if (error) throw error;
    return { quoteGroupId, jobs: data };
  },

  getQuoteGroup: async (quoteGroupId) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs, on_time_completions, avg_arrival_minutes, complaints_count, recommend_pct, avatar_url), professions(name)')
      .eq('quote_group_id', quoteGroupId);
    if (error) throw error;
    return data ?? [];
  },

  getActiveQuoteForClient: async (clientId) => {
    const { data: job } = await supabase
      .from('jobs')
      .select('quote_group_id')
      .eq('client_id', clientId)
      .not('quote_group_id', 'is', null)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!job?.quote_group_id) return null;
    const { data: groupJobs, error } = await supabase
      .from('jobs')
      .select('*, professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs, on_time_completions, avg_arrival_minutes, complaints_count, recommend_pct, avatar_url), professions(name)')
      .eq('quote_group_id', job.quote_group_id)
      .not('status', 'eq', 'cancelled');
    if (error) throw error;
    return { quoteGroupId: job.quote_group_id, jobs: groupJobs ?? [] };
  },

  selectFromQuoteGroup: async (selectedJobId, quoteGroupId) => {
    await supabase
      .from('jobs')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('quote_group_id', quoteGroupId)
      .neq('id', selectedJobId)
      .in('status', ['pending', 'accepted']);
    // Limpiar quote_group_id del job seleccionado → queda como job normal
    await supabase.from('jobs').update({ quote_group_id: null }).eq('id', selectedJobId);
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs, on_time_completions, avg_arrival_minutes, complaints_count, recommend_pct), professions(name)')
      .eq('id', selectedJobId)
      .single();
    if (error) throw error;
    return data;
  },

  subscribeQuoteJobs: (jobIds, onChange) => {
    const channels = jobIds.map(id =>
      supabase.channel(`qjob-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${id}` },
          p => onChange(p.new))
        .subscribe()
    );
    return { unsubscribe: () => channels.forEach(c => supabase.removeChannel(c)) };
  },

  subscribeToJob: (jobId, onUpdate) =>
    supabase.channel(`job-${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        p => onUpdate(p.new))
      .subscribe(),

  subscribeNewJobsForWorker: (professionalId, onNew) =>
    supabase.channel(`new-jobs-${professionalId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs', filter: `professional_id=eq.${professionalId}` },
        async (p) => {
          // El payload de INSERT no incluye joins — hacer fetch completo
          const { data } = await supabase
            .from('jobs')
            .select('*, professions(name)')
            .eq('id', p.new.id)
            .maybeSingle();
          onNew(data || p.new);
        })
      .subscribe(),

  subscribeWorkerLocation: (professionalId, onUpdate) =>
    supabase.channel(`worker-loc-${professionalId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'professionals', filter: `id=eq.${professionalId}` },
        p => { if (p.new.location) onUpdate(p.new.location); })
      .subscribe(),

  addEvent: async (jobId, eventType, message) => {
    const { error } = await supabase
      .from('job_events')
      .insert({ job_id: jobId, event_type: eventType, message });
    if (error) throw error;
  },

  getEvents: async (jobId) => {
    const { data, error } = await supabase
      .from('job_events')
      .select('id, event_type, message, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  subscribeToEvents: (jobId, onNew) =>
    supabase.channel(`events-${jobId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'job_events', filter: `job_id=eq.${jobId}`,
      }, p => onNew(p.new))
      .subscribe(),
};

async function update(jobId, fields) {
  const { error } = await supabase.from('jobs').update(fields).eq('id', jobId);
  if (error) throw error;
}

export default jobService;

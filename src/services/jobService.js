import { supabase } from '../supabase';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function commissionFor(worker) {
  if (worker?.completed_jobs >= 100 && worker?.avg_rating >= 4.8) return 10;
  if (worker?.completed_jobs >= 50  && worker?.avg_rating >= 4.5) return 14;
  if (worker?.completed_jobs >= 10  && worker?.avg_rating >= 4.0) return 17;
  return 20;
}

const jobService = {
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
        visit_amount:    visitAmount || 30000,   // precio que fijó el trabajador
        commission_pct:  commissionPct ?? 20,
      })
      .select()
      .single();
    if (error) throw error;
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
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professions(name)')
      .eq('professional_id', professionalId)
      .eq('status', 'pending')
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
      .order('created_at', { ascending: false })
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  accept: async (jobId, preDiagnosis) => {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    return update(jobId, {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      verification_code: code,
      ...(preDiagnosis ? { pre_diagnosis: preDiagnosis } : {}),
    });
  },

  reject: async (jobId, professionalId) => {
    await update(jobId, { status: 'cancelled', cancelled_at: new Date().toISOString() });
    // Penalizar calificación del trabajador
    if (professionalId) {
      await supabase.rpc('penalize_worker_rejection', { p_professional_id: professionalId });
    }
  },

  arrive:  async (jobId) => update(jobId, { status: 'arrived',     arrived_at:      new Date().toISOString() }),
  start:   async (jobId) => update(jobId, { status: 'in_progress', work_started_at: new Date().toISOString() }),
  complete: async (jobId) => update(jobId, { status: 'completed',  completed_at:    new Date().toISOString() }),
  cancel:  async (jobId, userId) => update(jobId, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId }),

  updateDiagnosis: async (jobId, diagnosis, isFinal = false) =>
    update(jobId, isFinal ? { final_diagnosis: diagnosis } : { pre_diagnosis: diagnosis }),

  setWorkAmount: async (jobId, amount) =>
    update(jobId, { status: 'awaiting_payment', work_amount: amount }),

  submitReview: async ({ jobId, clientId, professionalId, rating, comment }) => {
    const { error } = await supabase.from('reviews').insert({
      job_id: jobId, client_id: clientId,
      professional_id: professionalId, rating, comment,
    });
    if (error) throw error;
  },

  createQuoteGroup: async ({ clientId, workers, professionId, clientLat, clientLng, address, notes }) => {
    const quoteGroupId = uuidv4();
    const rows = workers.map(w => ({
      client_id:       clientId,
      professional_id: w.id,
      profession_id:   professionId,
      client_lat:      clientLat,
      client_lng:      clientLng,
      address,
      notes,
      visit_amount:    w.min_price || 30000,
      commission_pct:  commissionFor(w),
      quote_group_id:  quoteGroupId,
    }));
    const { data, error } = await supabase.from('jobs').insert(rows).select('*, professions(name)');
    if (error) throw error;
    return { quoteGroupId, jobs: data };
  },

  getQuoteGroup: async (quoteGroupId) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs, avatar_url), professions(name)')
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
      .select('*, professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs, avatar_url), professions(name)')
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
      .select('*, professionals(id, user_id, first_name, last_name, avg_rating, completed_jobs), professions(name)')
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
};

async function update(jobId, fields) {
  const { error } = await supabase.from('jobs').update(fields).eq('id', jobId);
  if (error) throw error;
}

export default jobService;

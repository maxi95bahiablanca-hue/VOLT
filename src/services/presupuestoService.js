import { supabase } from '../supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Mi Negocio — presupuestos propios y libreta de clientes (migración 055).
//
// Lo que se maneja acá NO son los `jobs` de la plataforma: son los trabajos que
// le llegan al profesional por WhatsApp, por un vecino o por recomendación, y
// que igual tienen que terminar adentro de BOLT.
//
// LA REGLA QUE ORDENA TODO: primero el presupuesto, después el cliente. Nunca
// al revés. Por eso `crear` acepta un nombre y un teléfono sueltos, sin exigir
// que exista una fila en `mis_clientes`.
//
// `numero` y `token` NO se mandan nunca: los pone el trigger de la base
// (trg_presupuesto_antes). Por eso todos los INSERT usan .select().single(),
// para devolver la fila ya completa — sin el token no hay link que mandar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los estados de un presupuesto, con el color y el texto que se muestran.
 * Viven acá y no en una pantalla porque los usan la lista, la ficha del cliente
 * y el detalle: si estuvieran duplicados, tarde o temprano dirían cosas
 * distintas del mismo presupuesto.
 */
export const ESTADOS_PRESUPUESTO = {
  borrador:  { label: 'Borrador',  color: '#666' },
  enviado:   { label: 'Enviado',   color: '#FFD600' },
  visto:     { label: 'Lo vio',    color: '#FF9800' },
  aceptado:  { label: 'Aceptado',  color: '#4CAF50' },
  // Después del sí empieza el trabajo (migración 056). El presupuesto no se
  // muere cuando lo aceptan: recién ahí arranca lo que el cliente quiere ver.
  agendado:  { label: 'Agendado',  color: '#7EA6FF' },
  en_camino: { label: 'En camino', color: '#FFD600' },
  hecho:     { label: 'Hecho',     color: '#4CAF50' },
  rechazado: { label: 'Rechazado', color: '#ff4444' },
  // Nadie contestó nunca (migración 058). No es un fracaso ni un rechazo: es un
  // presupuesto que dejó de estar vivo. Gris a propósito — no tiene que llamar
  // la atención, tiene que dejar de ocupar lugar.
  vencido:   { label: 'Vencido',   color: '#555' },
};

export const infoEstado = (e) => ESTADOS_PRESUPUESTO[e] || ESTADOS_PRESUPUESTO.borrador;

/**
 * De qué es cada ítem (migración 059). Lo primero que mira el cliente no es el
 * total: es cuánto es material y cuánto es el trabajo.
 *
 * `tipo` es nullable a propósito — los ítems ya cargados no se clasifican solos,
 * así que todo lo que consuma esto tiene que bancarse un ítem sin tipo.
 */
export const TIPOS_ITEM = {
  material: { label: 'Material',     color: '#7EA6FF' },
  obra:     { label: 'Mano de obra', color: '#FFD600' },
};

/** El link que ve el cliente. No necesita tener BOLT ni cuenta de nada. */
export const linkPresupuesto = (token) =>
  `https://bolt.com.ar/p/?t=${encodeURIComponent(token || '')}`;

/** Con qué nombre firma el presupuesto: el comercial si lo cargó, si no el suyo. */
export const nombreEmpresa = (p) =>
  (p?.nombre_comercial || '').trim() ||
  `${p?.first_name || ''} ${p?.last_name || ''}`.trim() ||
  'BOLT';

/** El texto que se manda por WhatsApp. `*asteriscos*` = negrita en WhatsApp. */
export const mensajePresupuesto = ({ numero, empresa, descripcion, total, token }) =>
  `*Presupuesto N°${numero} — ${empresa}*\n\n` +
  `${(descripcion || '').trim()}\n\n` +
  `*TOTAL: $${Number(total || 0).toLocaleString('es-AR')}*\n\n` +
  `Verlo completo: ${linkPresupuesto(token)}`;

/**
 * Los avisos del trabajo, para el MISMO WhatsApp donde ya está la conversación.
 *
 * El cliente NUNCA instala la app ni se registra: sigue el trabajo desde el link
 * que ya tiene. Estos tres mensajes son todo lo que necesita recibir.
 */
export const mensajeAgendado = ({ empresa, dia, hora }) =>
  `*${empresa}*\n\n` +
  `Quedamos para el ${dia} a las ${hora}. Cualquier cosa escribime por acá.`;

export const mensajeEnCamino = ({ empresa, codigo }) =>
  `*${empresa}*\n\n` +
  `Ya salgo para tu casa 🚗\n` +
  `Cuando llegue pedime el código *${codigo}* para confirmar que soy yo.`;

export const mensajeHecho = ({ empresa }) =>
  `*${empresa}*\n\n` +
  `Trabajo terminado. Gracias! Si quedaste conforme me ayuda muchísimo que me recomiendes.`;

/**
 * Insistir a los 3 días (migración 058).
 *
 * Corto y sin presión: no reclama una respuesta ni repite el precio. La mitad de
 * los que no contestan es porque se les pasó, no porque dijeron que no — y el
 * que pregunta a los tres días cierra más. Un mensaje largo o exigente logra lo
 * contrario: que lo dejen en visto para siempre.
 */
export const mensajeInsistir = ({ empresa, nombre, numero }) =>
  `Hola${nombre ? ' ' + nombre : ''}! Te escribo de *${empresa}*.\n\n` +
  `¿Pudiste ver el presupuesto N°${numero}? Cualquier duda me decís y lo vemos.`;

/**
 * Link de WhatsApp. Si hay teléfono, abre la conversación con esa persona; si
 * no, abre el selector de contactos con el mensaje ya escrito (no se pierde el
 * presupuesto por no tener el número cargado).
 *
 * Los números se guardan como los escribe el profesional: "0291 15 419-9938",
 * "+5492914199938", "2914199938". Se normalizan todos al formato de wa.me.
 */
export const linkWhatsAppPresupuesto = (tel, texto) => {
  const msg = encodeURIComponent(texto || '');
  let n = String(tel || '').replace(/\D/g, '');
  if (n.startsWith('54')) {
    n = n.slice(2);
    if (n.startsWith('9')) n = n.slice(1);   // el 9 de celular ya lo agregamos abajo
  }
  if (n.startsWith('0')) n = n.slice(1);     // 0291 → 291
  if (n.length < 8) return `https://api.whatsapp.com/send?text=${msg}`;
  return `https://wa.me/549${n}?text=${msg}`;
};

const presupuestoService = {
  // ─── Presupuestos ────────────────────────────────────────────────────────
  // Trae el nombre del oficio junto al presupuesto (mismo patrón que
  // jobService.getById). Sin esto la ficha del cliente no puede mostrar qué le
  // pidió cada vez, que es todo el sentido de guardar `profesion_id`.
  listar: async (professionalId) => {
    const { data, error } = await supabase
      .from('presupuestos')
      .select('*, professions(name)')
      .eq('professional_id', professionalId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  },

  // Devuelve la fila COMPLETA: sin `token` y `numero` (que los pone el trigger)
  // no se puede armar el mensaje de WhatsApp, que es el punto de todo esto.
  crear: async ({ professionalId, clienteId, clienteNombre, clienteTel, descripcion, total, notas, validezDias, profesionId }) => {
    const { data, error } = await supabase
      .from('presupuestos')
      .insert({
        professional_id: professionalId,
        descripcion:     (descripcion || '').trim(),
        total:           Math.round(Number(total) || 0),
        // El oficio es del trabajo, no de la persona: la misma clienta te llama
        // para electricidad en marzo y para plomería en agosto.
        ...(profesionId                ? { profesion_id:   profesionId }              : {}),
        ...(clienteId                  ? { cliente_id:     clienteId }                : {}),
        ...(clienteNombre?.trim()      ? { cliente_nombre: clienteNombre.trim() }     : {}),
        ...(clienteTel?.trim()         ? { cliente_tel:    clienteTel.trim() }        : {}),
        ...(notas?.trim()              ? { notas:          notas.trim() }             : {}),
        ...(validezDias                ? { validez_dias:   parseInt(validezDias, 10) }: {}),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // El detalle es siempre opcional: si no hay ítems, no se llama.
  agregarItems: async (presupuestoId, items) => {
    const filas = (items ?? [])
      .filter(i => (i?.descripcion || '').trim())
      .map((i, idx) => ({
        presupuesto_id:  presupuestoId,
        descripcion:     i.descripcion.trim(),
        cantidad:        Number(i.cantidad) || 1,
        precio_unitario: Math.round(Number(i.precio_unitario ?? i.precio) || 0),
        orden:           idx,
        // Material o mano de obra. Se omite si no vino: la columna es nullable y
        // un CHECK rechaza cualquier otra cosa — mandar '' rompería el insert
        // entero y con él el presupuesto.
        ...(i.tipo === 'material' || i.tipo === 'obra' ? { tipo: i.tipo } : {}),
      }));
    if (!filas.length) return [];
    const { data, error } = await supabase
      .from('presupuesto_items')
      .insert(filas)
      .select();
    if (error) throw error;
    return data ?? [];
  },

  // Ojo con reenviar: si el cliente YA lo vio, volver a mandarlo no puede
  // hacerlo retroceder a "enviado" — se perdería el único dato de venta que
  // importa ("lo vio y no contestó"). Por eso son dos updates condicionados y
  // no uno solo.
  marcarEnviado: async (id) => {
    const ahora = new Date().toISOString();
    const { error: e1 } = await supabase
      .from('presupuestos')
      .update({ enviado_at: ahora })
      .eq('id', id)
      .is('enviado_at', null);
    if (e1) throw e1;
    const { error: e2 } = await supabase
      .from('presupuestos')
      .update({ estado: 'enviado' })
      .eq('id', id)
      .eq('estado', 'borrador');
    if (e2) throw e2;
  },

  // El cliente casi siempre contesta por teléfono o por WhatsApp, no tocando el
  // botón del link. Sin esto, un trabajo cerrado quedaba figurando como perdido
  // para siempre. Va por update directo (el dueño tiene RLS sobre su fila) y no
  // por la RPC pública, que es sólo para quien abre el link.
  responderAMano: async (id, acepta) => {
    const ahora   = new Date().toISOString();
    const cambios = acepta
      ? { estado: 'aceptado',  aceptado_at:  ahora }
      : { estado: 'rechazado', rechazado_at: ahora };
    const { data, error } = await supabase
      .from('presupuestos')
      .update(cambios)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ─── El trabajo, después del sí (migración 056) ──────────────────────────
  // Van por RPC y no por update directo porque son las que el cliente ve desde
  // su link: el estado y el código los tiene que poner el servidor, no la app.

  /** `cuando` puede ser un Date o un ISO. La base lo guarda como timestamptz. */
  agendar: async (id, cuando) => {
    const { error } = await supabase.rpc('presupuesto_agendar', {
      p_id:     id,
      p_cuando: cuando instanceof Date ? cuando.toISOString() : cuando,
    });
    if (error) throw error;
  },

  // Devuelve `{ codigo, viaje }`. La RPC es RETURNS TABLE, así que del lado del
  // cliente llega un ARRAY de una fila: sin el [0] el código sale undefined y el
  // profesional se queda parado en la puerta sin nada que mostrar.
  salir: async (id) => {
    const { data, error } = await supabase.rpc('presupuesto_salir', { p_id: id });
    if (error) throw error;
    const fila = Array.isArray(data) ? data[0] : data;
    return { codigo: fila?.codigo ?? null, viaje: fila?.viaje ?? null };
  },

  /** Llegó: cierra la ventana de "en camino" (el código deja de mostrarse). */
  llegue: async (id) => {
    const { error } = await supabase.rpc('presupuesto_llegue', { p_id: id });
    if (error) throw error;
  },

  hecho: async (id) => {
    const { error } = await supabase.rpc('presupuesto_hecho', { p_id: id });
    if (error) throw error;
  },

  borrar: async (id) => {
    const { error } = await supabase.from('presupuestos').delete().eq('id', id);
    if (error) throw error;
  },

  // Enterarse cuando el cliente contesta desde el link.
  //
  // El cliente que acepta NO tiene cuenta en BOLT: entra a una página, toca un
  // botón y se va. No hay forma de que su navegador le mande un push a nadie
  // (send-push exige sesión y un trabajo en común, y acá no hay ninguna de las
  // dos). Así que el aviso lo hace la propia app del profesional escuchando su
  // tabla: mientras la tenga abierta, se entera en el momento.
  suscribirse: (professionalId, onCambio) =>
    supabase.channel(`presu-${professionalId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'presupuestos',
        filter: `professional_id=eq.${professionalId}`,
      }, p => onCambio(p.new, p.old))
      .subscribe(),

  // Los que contestaron y el profesional todavía no vio. Es lo que se le muestra
  // al abrir la app: sin esto, un "sí" del cliente podía quedar días esperando.
  sinAvisar: async (professionalId, desde) => {
    const { data, error } = await supabase
      .from('presupuestos')
      .select('id, numero, estado, cliente_nombre, total, aceptado_at')
      .eq('professional_id', professionalId)
      .eq('estado', 'aceptado')
      .gt('aceptado_at', desde || '1970-01-01')
      .order('aceptado_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data ?? [];
  },

  // ─── Perseguir y cerrar (migración 058) ──────────────────────────────────
  //
  // Casi ningún oficio persigue un presupuesto: lo manda y espera. El que
  // pregunta a los tres días cierra más, y no es por mejor precio.
  //
  // 🔴 LA RPC YA FILTRA TODO: más de 3 días sin respuesta, no postergado y no
  // perseguido en los últimos 4 días. Si una fila está acá, hay que actuar hoy.
  // No filtrar de nuevo del lado de la app — duplicar la regla es garantizar
  // que en seis meses digan cosas distintas.
  //
  // Cada fila trae `dias`, `ya_perseguido` y `toca_cerrar` (más de 7 días: ahí
  // ya no se persigue, se pregunta qué pasó y se cierra).
  esperando: async (professionalId) => {
    const { data, error } = await supabase.rpc('presupuestos_esperando', {
      p_professional_id: professionalId,
    });
    if (error) throw error;
    return data ?? [];
  },

  /** Ya le escribí: no me lo vuelvas a pedir por 4 días. */
  perseguido: async (id) => {
    const { error } = await supabase.rpc('presupuesto_perseguido', { p_id: id });
    if (error) throw error;
  },

  /** "Sigue en veremos": no molestar por N días. Reinicia el contador de insistencias. */
  postergar: async (id, dias = 7) => {
    const { error } = await supabase.rpc('presupuesto_postergar', { p_id: id, p_dias: dias });
    if (error) throw error;
  },

  // Nada puede quedar esperando para siempre. A los 21 días sin respuesta se
  // vencen solos. Devuelve cuántos: no hay cron, lo dispara la app al abrirse.
  vencerViejos: async (dias = 21) => {
    const { data, error } = await supabase.rpc('vencer_presupuestos_viejos', { p_dias: dias });
    if (error) throw error;
    return Number(data) || 0;
  },

  // ─── La libreta ──────────────────────────────────────────────────────────
  listarClientes: async (professionalId) => {
    const { data, error } = await supabase
      .from('mis_clientes')
      .select('*')
      .eq('professional_id', professionalId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  guardarCliente: async ({ professionalId, nombre, telefono, direccion, notas }) => {
    const { data, error } = await supabase
      .from('mis_clientes')
      .insert({
        professional_id: professionalId,
        nombre:          (nombre || '').trim(),
        ...(telefono?.trim()  ? { telefono:  telefono.trim() }  : {}),
        ...(direccion?.trim() ? { direccion: direccion.trim() } : {}),
        ...(notas?.trim()     ? { notas:     notas.trim() }     : {}),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Para no duplicar a la misma persona. Se compara por los últimos 8 dígitos
  // porque el mismo número se escribe de cinco formas distintas (con 0, con 15,
  // con +54, con guiones) y una comparación exacta no encontraría nada.
  buscarClientePorTel: async (professionalId, tel) => {
    const d = String(tel || '').replace(/\D/g, '');
    if (d.length < 6) return null;
    const cola = d.slice(-8);
    const { data, error } = await supabase
      .from('mis_clientes')
      .select('*')
      .eq('professional_id', professionalId)
      .not('telefono', 'is', null)
      .limit(200);
    if (error) throw error;
    return (data ?? []).find(c => String(c.telefono || '').replace(/\D/g, '').endsWith(cola)) ?? null;
  },
};

export default presupuestoService;

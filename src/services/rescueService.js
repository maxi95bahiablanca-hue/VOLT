import { Linking } from 'react-native';
import { supabase } from '../supabase';
import notificationService from './notificationService';
import { SOPORTE, linkWhatsApp } from '../config/soporte';

// Rescate del pedido: cuando la app no consigue profesional, el pedido pasa a
// una persona. Nunca dejamos al cliente sin salida.
//
// Van tres caminos en paralelo a propósito, porque cada uno falla distinto:
//   1. Queda registrado en `rescates` (aunque el cliente cierre la app).
//   2. Le llega una notificación al encargado adentro de BOLT.
//   3. El cliente abre WhatsApp con el problema ya escrito → el encargado lo
//      recibe DESDE el número del cliente, así lo puede contestar directo.

const armarTexto = ({ oficio, notas, address, fotos }) => {
  const partes = [
    '*Pedido sin profesional disponible — BOLT*',
    oficio ? `\n*Oficio:* ${oficio}` : '',
    address ? `*Dirección:* ${address}` : '',
    notas ? `\n*El cliente cuenta:*\n${notas}` : '',
  ];
  if (fotos?.length) {
    partes.push(`\n*Fotos del problema:*\n${fotos.join('\n')}`);
  }
  partes.push('\n_Nadie tomó el pedido en la app. ¿Me pueden conseguir a alguien?_');
  return partes.filter(Boolean).join('\n');
};

// Tope para esperar el aviso al encargado. El cliente está mirando un spinner:
// si Expo o la Edge Function no contestan, NO puede quedarse esperando ahí
// (11-ago-2026: es el mismo molde del "Activando…" para siempre). Pasado el
// tope seguimos, y cuando la respuesta llegue tarde queda en el log igual.
const TOPE_AVISO_MS = 3000;

const conTope = (promesa, ms, motivoTope) =>
  new Promise((resolve) => {
    let listo = false;
    const t = setTimeout(() => { listo = true; resolve({ ok: false, sent: false, motivo: motivoTope }); }, ms);
    Promise.resolve(promesa).then(
      (r) => { clearTimeout(t); if (!listo) resolve(r); else console.warn(`[BOLT rescate] el aviso al encargado contestó tarde: ${JSON.stringify(r)}`); },
      (e) => { clearTimeout(t); const err = { ok: false, sent: false, motivo: e?.message || String(e) }; if (!listo) resolve(err); },
    );
  });

const rescueService = {
  armarTexto,

  // Deja el pedido asentado y avisa al encargado.
  //
  // Devuelve SIEMPRE un objeto con `id` (null si no se pudo registrar) y
  // `aviso: { ok, sent, motivo }` — 11-ago-2026, auditoría: acá el resultado del
  // push se tiraba a la basura con un `.catch(() => {})`, y como
  // `functions.invoke` NO tira excepción con un 403, el aviso al encargado
  // estaba muerto desde siempre (send-push exige que emisor y destinatario
  // compartan un trabajo, y un rescate existe justamente porque no hay trabajo).
  // De los tres caminos que promete el comentario de arriba, el del medio no
  // salía nunca y nadie se enteraba. Ahora el que llama puede saberlo.
  registrar: async ({ clientId, professionId, oficio, motivo, notas, address, lat, lng, fotos, quoteGroupId }) => {
    let rescate = null;
    let errorAlta = null;
    try {
      const { data, error } = await supabase
        .from('rescates')
        .insert({
          client_id:      clientId,
          profession_id:  professionId ?? null,
          oficio:         oficio ?? null,
          motivo,
          notas:          notas ?? null,
          address:        address ?? null,
          client_lat:     lat ?? null,
          client_lng:     lng ?? null,
          fotos:          fotos ?? [],
          quote_group_id: quoteGroupId ?? null,
        })
        .select()
        .single();
      // El insert tampoco tira: devuelve { error }. Si no queda la fila, el
      // rescate no lo levanta después ni el panel ni el vigilante.
      if (error) errorAlta = error.message || String(error);
      rescate = data ?? null;
    } catch (e) { errorAlta = e?.message || String(e); }
    if (errorAlta) console.warn(`[BOLT rescate] NO quedó registrado (${oficio || 'sin oficio'}): ${errorAlta}`);

    const aviso = await conTope(
      notificationService.sendToUser(SOPORTE.adminUserId, {
        title: '🔴 Pedido sin profesional',
        body:  `${oficio || 'Un pedido'} en ${address || 'Bahía Blanca'} quedó sin nadie que lo tome. Hay que resolverlo a mano.`,
        data:  { screen: 'admin', rescateId: rescate?.id },
      }),
      TOPE_AVISO_MS,
      `el aviso al encargado no contestó en ${TOPE_AVISO_MS / 1000} s`,
    );

    if (!aviso?.sent) {
      // No se marca nada como avisado: la fila queda en 'pendiente' con
      // `escalado_at` en null, que es justo lo que levanta
      // `rescates_sin_atender` (migración 068) a la media hora. Ese camino pasa
      // a ser el único que queda, así que tiene que quedar constancia de que
      // este falló.
      console.warn(`[BOLT rescate] el encargado NO recibió el aviso (rescate ${rescate?.id ?? 'sin id'}): ${aviso?.motivo || 'sin motivo'}`);
    }

    return rescate ? { ...rescate, aviso } : { id: null, aviso, error: errorAlta };
  },

  // Abre el WhatsApp del cliente con el problema escrito hacia el encargado.
  //
  // 🔴 11-ago-2026 — antes se marcaba `avisado_wa: true` ANTES de abrir nada.
  //    Si WhatsApp no estaba instalado, o el link no se podía abrir,
  //    `openURL` tiraba, la función devolvía false… y el rescate quedaba en el
  //    panel como "el cliente ya escribió por WhatsApp". Un mensaje que nunca
  //    se mandó, un cliente al que nadie llama. La marca se escribe DESPUÉS de
  //    que el sistema aceptó abrir el chat, y nunca si falló.
  abrirWhatsApp: async (datos, rescateId) => {
    const url = linkWhatsApp(armarTexto(datos));
    let abrio = false;
    try {
      await Linking.openURL(url);
      abrio = true;
    } catch (e) {
      console.warn(`[BOLT rescate] no se pudo abrir WhatsApp: ${e?.message || String(e)}`);
    }

    if (abrio && rescateId) {
      // Sin await: la app ya se está yendo a WhatsApp. El pedido sale igual.
      supabase.from('rescates').update({ avisado_wa: true }).eq('id', rescateId).then(
        ({ error } = {}) => { if (error) console.warn(`[BOLT rescate] no se pudo marcar avisado_wa: ${error.message}`); },
        (e) => console.warn(`[BOLT rescate] no se pudo marcar avisado_wa: ${e?.message || String(e)}`),
      );
    }
    return abrio;
  },
};

export default rescueService;

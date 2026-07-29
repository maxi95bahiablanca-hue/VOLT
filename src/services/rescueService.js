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

const rescueService = {
  armarTexto,

  // Deja el pedido asentado y avisa al encargado. Devuelve el rescate (o null:
  // si esto falla, el botón de WhatsApp tiene que seguir funcionando igual).
  registrar: async ({ clientId, professionId, oficio, motivo, notas, address, lat, lng, fotos, quoteGroupId }) => {
    let rescate = null;
    try {
      const { data } = await supabase
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
      rescate = data ?? null;
    } catch { /* seguimos: avisar es más importante que registrar */ }

    notificationService.sendToUser(SOPORTE.adminUserId, {
      title: '🔴 Pedido sin profesional',
      body:  `${oficio || 'Un pedido'} en ${address || 'Bahía Blanca'} quedó sin nadie que lo tome. Hay que resolverlo a mano.`,
      data:  { screen: 'admin', rescateId: rescate?.id },
    }).catch(() => {});

    return rescate;
  },

  // Abre el WhatsApp del cliente con el problema escrito hacia el encargado.
  abrirWhatsApp: async (datos, rescateId) => {
    if (rescateId) {
      supabase.from('rescates').update({ avisado_wa: true }).eq('id', rescateId).then(() => {}, () => {});
    }
    const url = linkWhatsApp(armarTexto(datos));
    try { await Linking.openURL(url); return true; } catch { return false; }
  },
};

export default rescueService;

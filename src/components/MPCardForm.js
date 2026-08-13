import React, { useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';

// Captura segura de tarjeta con el SDK de Mercado Pago (tokenización en el WebView).
// La app NUNCA ve el número de tarjeta: MP devuelve solo un token.
//
// Props:
//   visible, onClose
//   mode: 'new'  → alta de tarjeta (devuelve token para guardarla)
//         'cvv'  → pago con tarjeta guardada (pide solo el CVV) → necesita cardId + brand
//   cardId, brand (solo en modo 'cvv')
//   onToken({ token, paymentMethodId, lastFour })

const PUBLIC_KEY = process.env.EXPO_PUBLIC_MP_PUBLIC_KEY || '';

const MPCardForm = ({ visible, onClose, mode = 'new', cardId = '', brand = '', onToken }) => {
  const webRef = useRef(null);

  const handleMessage = (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'TOKEN') onToken?.(msg.payload);
      if (msg.type === 'CLOSE') onClose?.();
    } catch { /* ignore */ }
  };

  const html = `
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<script src="https://sdk.mercadopago.com/js/v2"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
  body{background:#0D0D0D;color:#F5F5F5;padding:18px}
  h2{font-size:18px;font-weight:900;margin-bottom:4px}
  .sub{color:#888;font-size:13px;margin-bottom:18px}
  label{display:block;font-size:12px;color:#888;font-weight:700;margin:12px 0 5px}
  input{width:100%;background:#161616;border:1px solid #222;border-radius:11px;padding:13px;color:#fff;font-size:15px;outline:none}
  input:focus{border-color:#FFD60080}
  .row{display:flex;gap:10px}.row>div{flex:1}
  .btn{width:100%;background:#FFD600;color:#0D0D0D;border:0;border-radius:13px;padding:15px;font-weight:900;font-size:16px;margin-top:20px}
  .btn:disabled{opacity:.5}
  .err{color:#ff5577;font-size:13px;margin-top:12px;min-height:18px;text-align:center}
  .cancel{text-align:center;color:#666;font-size:14px;margin-top:14px;font-weight:700}
  .nokey{color:#ff5577;text-align:center;padding:30px 0;line-height:1.6}
</style></head><body>
${PUBLIC_KEY ? `
  <h2>${mode === 'cvv' ? 'Confirmá tu pago' : 'Agregar tarjeta'}</h2>
  <div class="sub">${mode === 'cvv' ? ('Ingresá el código de seguridad de tu tarjeta ' + brand) : 'Tus datos viajan cifrados a Mercado Pago.'}</div>
  ${mode === 'new' ? `
    <label>Número de tarjeta</label><input id="num" inputmode="numeric" placeholder="1234 5678 9012 3456" maxlength="19">
    <label>Nombre como figura en la tarjeta</label><input id="name" placeholder="JUAN PEREZ">
    <div class="row">
      <div><label>Vencimiento</label><input id="exp" placeholder="MM/AA" maxlength="5"></div>
      <div><label>CVV</label><input id="cvv" inputmode="numeric" placeholder="123" maxlength="4"></div>
    </div>
    <label>DNI del titular</label><input id="doc" inputmode="numeric" placeholder="30123456">
  ` : `
    <label>Código de seguridad (CVV)</label><input id="cvv" inputmode="numeric" placeholder="123" maxlength="4" autofocus>
  `}
  <button class="btn" id="go">${mode === 'cvv' ? 'Pagar ahora' : 'Guardar tarjeta'}</button>
  <div class="err" id="err"></div>
  <div class="cancel" id="cancel">Cancelar</div>
  <script>
    const mp = new MercadoPago('${PUBLIC_KEY}');
    const send = (o) => window.ReactNativeWebView.postMessage(JSON.stringify(o));
    document.getElementById('cancel').onclick = () => send({type:'CLOSE'});
    const err = (m) => { document.getElementById('err').textContent = m; document.getElementById('go').disabled = false; document.getElementById('go').textContent = '${mode === 'cvv' ? 'Pagar ahora' : 'Guardar tarjeta'}'; };

    document.getElementById('go').onclick = async () => {
      const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Procesando...';
      document.getElementById('err').textContent = '';
      try {
        const cvv = (document.getElementById('cvv').value || '').trim();
        if (${mode === 'cvv' ? 'true' : 'false'}) {
          // Pago con tarjeta guardada: token desde cardId + CVV
          const tok = await mp.createCardToken({ cardId: ${JSON.stringify(cardId)}, securityCode: cvv });
          send({ type:'TOKEN', payload:{ token: tok.id, paymentMethodId: '', lastFour: tok.last_four_digits } });
          return;
        }
        const num  = (document.getElementById('num').value || '').replace(/\\s/g,'');
        const name = (document.getElementById('name').value || '').trim();
        const exp  = (document.getElementById('exp').value || '').trim();
        const doc  = (document.getElementById('doc').value || '').trim();
        if (num.length < 13 || !exp.includes('/') || cvv.length < 3 || !doc) { err('Revisá los datos de la tarjeta.'); return; }
        const [mm, yy] = exp.split('/');
        // Método de pago según los primeros dígitos
        let pmId = '';
        try { const pm = await mp.getPaymentMethods({ bin: num.slice(0,6) }); pmId = pm.results?.[0]?.id || ''; } catch(e){}
        const tok = await mp.createCardToken({
          cardNumber: num, cardholderName: name,
          cardExpirationMonth: mm, cardExpirationYear: ('20'+yy).slice(-4),
          securityCode: cvv, identificationType: 'DNI', identificationNumber: doc,
        });
        send({ type:'TOKEN', payload:{ token: tok.id, paymentMethodId: pmId, lastFour: tok.last_four_digits } });
      } catch (e) { err('No se pudo validar la tarjeta. Revisá los datos.'); }
    };
  </script>
` : `<div class="nokey">⚠️ Falta configurar la clave pública de Mercado Pago (EXPO_PUBLIC_MP_PUBLIC_KEY) para habilitar el pago con tarjeta.</div><div class="cancel" id="cancel" onclick="window.ReactNativeWebView.postMessage(JSON.stringify({type:'CLOSE'}))">Cerrar</div>`}
</body></html>`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.bar}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#FFFFFF" /></TouchableOpacity>
          <Text style={styles.barTitle}>Mercado Pago</Text>
          <View style={{ width: 24 }} />
        </View>
        <WebView
          ref={webRef}
          source={{ html }}
          onMessage={handleMessage}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          style={{ flex: 1, backgroundColor: '#0D0D0D' }}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0D0D0D' },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 34 : 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  barTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});

export default MPCardForm;

/* ──────────────────────────────────────────────────────────────
   BOLT — cuántas veces se abre cada página de ayuda.

   Para qué: la página más visitada del centro de ayuda no es la
   guía mejor escrita, es el bug más caro de la app. Si el 80% de
   las visitas se las lleva "disponibilidad", el problema no es la
   guía: es que activar el radar está mal resuelto adentro.

   Qué manda: el nombre de la página y nada más. Ni quién entra,
   ni de dónde viene, ni cuándo. Sin cookies, sin identificadores.

   Cómo se usa, en cada página:
     <script src="../visita.js" data-pagina="disponibilidad"></script>
     (en el índice: src="visita.js" data-pagina="indice")

   Si esto falla —sin internet, la base caída, el navegador viejo—
   la página funciona exactamente igual. Nada de acá bloquea nada.
   ────────────────────────────────────────────────────────────── */
(function () {
  try {
    var etiqueta = document.currentScript;
    if (!etiqueta || typeof fetch !== 'function') return;

    /* El nombre lo declara cada página. Lo limpiamos igual acá para no
       mandar nunca algo que la base vaya a rechazar: sólo minúsculas y
       guiones, hasta 30 caracteres. */
    var pagina = (etiqueta.getAttribute('data-pagina') || '')
      .toLowerCase()
      .replace(/[^a-z-]/g, '')
      .slice(0, 30);
    if (!pagina) return;

    var CLAVE = 'sb_publishable_4e50WLUuWTJ0u2DN6HPUNw_FeIdsV-0';

    /* keepalive: si el visitante toca un link antes de que termine, el
       navegador manda el pedido igual en vez de cancelarlo. */
    fetch('https://lyeqnvldemcltlbujlnc.supabase.co/rest/v1/rpc/ayuda_visita', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'apikey': CLAVE,
        'Authorization': 'Bearer ' + CLAVE
      },
      body: JSON.stringify({ p_pagina: pagina })
    })['catch'](function () { /* si no se pudo contar, no pasa nada */ });
  } catch (e) { /* idem */ }
})();

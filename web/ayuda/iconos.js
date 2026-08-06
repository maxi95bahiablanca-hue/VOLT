/* ──────────────────────────────────────────────────────────────
   Cambia los emojis del centro de ayuda por dibujos propios.

   Por qué: un emoji lo dibuja el sistema operativo. Es rojo en un
   Android, gris en un iPhone, y no es de la marca. Estos son de
   BOLT: trazo grueso, relleno amarillo y adentro de un círculo.

   Se hace por JS y no a mano en las diez páginas porque el emoji
   está en el marcado de cada una: así hay un solo lugar donde
   agregar o cambiar un dibujo. Si el archivo no carga, queda el
   emoji, que es feo pero no rompe nada.
   ────────────────────────────────────────────────────────────── */
(function(){
  'use strict';

  var A = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var Y = '#FFD600';

  var ICO = {
    // el radar: la disponibilidad prendida
    radar:   A + '<circle cx="12" cy="12" r="2.6" fill="' + Y + '" stroke="none"/>' +
                 '<path d="M12 12c0-2.2 1.8-4 4-4"/><path d="M12 12c0-4.4 3.6-8 8-8"/>' +
                 '<path d="M12 12c-2.2 0-4 1.8-4 4"/><path d="M12 12c-4.4 0-8 3.6-8 8"/></svg>',
    rayo:    A + '<path d="M13.5 2L4 13.5h5.5L8 22l10-11.5h-5.5z" fill="' + Y + '"/></svg>',
    alta:    A + '<path d="M5 2.8h9l5 5V21H5z" fill="' + Y + '"/><path d="M14 2.8v5h5"/>' +
                 '<path d="M8.5 13.5l2 2 4-4.4" stroke="#08090A" stroke-width="2"/></svg>',
    campana: A + '<path d="M18 15V10a6 6 0 1 0-12 0v5l-1.8 2.6h15.6z" fill="' + Y + '"/>' +
                 '<path d="M9.6 20a2.5 2.5 0 0 0 4.8 0"/></svg>',
    camion:  A + '<path d="M2 6.5h11v10H2z" fill="' + Y + '"/><path d="M13 9.5h4l4 4v3h-8z" fill="' + Y + '"/>' +
                 '<circle cx="7" cy="18.5" r="2.2" fill="currentColor" stroke="none"/>' +
                 '<circle cx="17.5" cy="18.5" r="2.2" fill="currentColor" stroke="none"/></svg>',
    papel:   A + '<path d="M5 2.8h9l5 5V21H5z" fill="' + Y + '"/><path d="M14 2.8v5h5"/>' +
                 '<path d="M8.5 12.5h7M8.5 16.5h4" stroke="#08090A" stroke-width="1.7"/></svg>',
    panel:   A + '<rect x="3" y="3.5" width="18" height="17" rx="4"/>' +
                 '<path d="M8 16v-4M12 16V8M16 16v-6" stroke="' + Y + '" stroke-width="2.4"/></svg>',
    paleta:  A + '<path d="M12 3.2c-5 0-8.8 3.6-8.8 8.4 0 3.4 2.6 5.6 5.6 5.6h1.6c1 0 1.6.7 1.6 1.5 0 .5-.2.8-.2 1.2 0 .7.5 1.3 1.4 1.3 4.4 0 8-3.9 8-9 0-5-3.8-9-9.2-9z" fill="' + Y + '"/>' +
                 '<circle cx="8" cy="10" r="1.1" fill="#08090A" stroke="none"/>' +
                 '<circle cx="12" cy="7.6" r="1.1" fill="#08090A" stroke="none"/>' +
                 '<circle cx="16" cy="10" r="1.1" fill="#08090A" stroke="none"/></svg>',
    duda:    A + '<circle cx="12" cy="12" r="9" fill="' + Y + '"/>' +
                 '<path d="M9.4 9.4a2.7 2.7 0 1 1 3.6 2.5v1.5" stroke="#08090A" stroke-width="2"/>' +
                 '<path d="M12.9 17v0" stroke="#08090A" stroke-width="2.4"/></svg>',
    llave:   A + '<circle cx="8" cy="15.5" r="4.2" fill="' + Y + '"/><path d="M11 12.5L20 3.5"/>' +
                 '<path d="M16.5 7l2.5 2.5M18.5 5l2.5 2.5"/></svg>',
    reloj:   A + '<circle cx="12" cy="12" r="9" fill="' + Y + '"/>' +
                 '<path d="M12 7v5.2l3.2 2" stroke="#08090A" stroke-width="2.1"/></svg>'
  };

  // Qué emoji corresponde a qué dibujo. Se comparan por el texto del
  // elemento, así que alcanza con agregar la fila para uno nuevo.
  var MAPA = {
    '📡':'radar', '📶':'radar', '🛰':'radar',
    '⚡':'rayo',  '🔌':'rayo',
    '📝':'alta',  '✍️':'alta', '✍':'alta',
    '🔔':'campana',
    '🚗':'camion','🚙':'camion','🚚':'camion',
    '📋':'papel', '🧾':'papel', '📄':'papel',
    '📊':'panel', '📈':'panel',
    '🎨':'paleta',
    '❓':'duda',  '❔':'duda', '🤔':'duda',
    '🔑':'llave', '🗝':'llave',
    '⏱':'reloj', '⏰':'reloj', '🕐':'reloj'
  };

  function cambiar(el){
    var t = (el.textContent || '').trim();
    // El emoji puede venir con el selector de variante (️): se saca.
    var limpio = t.replace(/️/g, '');
    var nombre = MAPA[t] || MAPA[limpio];
    if (!nombre) return;
    el.innerHTML = ICO[nombre];
    el.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('.tarjeta .ico, .tema-icono').forEach(cambiar);
})();

import React, { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Mapa BOLT (Leaflet dentro de WebView).
 *
 * Props:
 *  - userLocation: { latitude, longitude } → centra el mapa + dibuja el pin del cliente con halo de alcance.
 *  - workers: [{ id, lat, lng, emoji?, state?, ambient?, effective_rating?, avg_rating?, profession_name? }]
 *      · state: 'available' | 'oncoming' | 'busy'  (default 'available')
 *      · ambient: true  → pin decorativo (no abre ficha; emite onAmbientPress)
 *  - onWorkerPress(worker): toca un profesional real
 *  - onAmbientPress(): toca un pin ambiental (sugerimos elegir un oficio)
 */
const VoltMap = ({ userLocation, workers, onWorkerPress, onAmbientPress, style }) => {
  const webRef = useRef(null);
  const mapReadyRef = useRef(false);
  const pendingLocationRef = useRef(null);
  const pendingWorkersRef = useRef([]);

  const sendToMap = (msg) => {
    webRef.current?.postMessage(JSON.stringify(msg));
  };

  // Cuando Leaflet termina de inicializarse, enviamos lo que llegó antes
  const handleLoad = () => {
    mapReadyRef.current = true;
    if (pendingLocationRef.current) {
      sendToMap({ type: 'SET_LOCATION', ...pendingLocationRef.current });
    }
    if (pendingWorkersRef.current.length > 0) {
      sendToMap({ type: 'SET_WORKERS', workers: pendingWorkersRef.current });
    }
  };

  // Actualizar workers cuando cambian
  React.useEffect(() => {
    pendingWorkersRef.current = workers ?? [];
    if (!mapReadyRef.current) return;
    sendToMap({ type: 'SET_WORKERS', workers: workers ?? [] });
  }, [workers]);

  // Centrar en ubicación del usuario
  React.useEffect(() => {
    pendingLocationRef.current = userLocation;
    if (!mapReadyRef.current || !userLocation) return;
    sendToMap({ type: 'SET_LOCATION', ...userLocation });
  }, [userLocation]);

  const handleMessage = (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'WORKER_PRESS' && onWorkerPress) onWorkerPress(msg.worker);
      if (msg.type === 'AMBIENT_PRESS' && onAmbientPress) onAmbientPress();
    } catch { /* silent */ }
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0a; }
  #map { width:100vw; height:100vh; }

  /* ─── Pin de profesional ─────────────────────────────── */
  .pin { position:relative; width:42px; height:42px;
         display:flex; align-items:center; justify-content:center;
         animation: pop .38s cubic-bezier(.2,1.25,.4,1) backwards; }
  .pin .dot { position:relative; z-index:2;
              width:34px; height:34px; border-radius:50%;
              background:#15150f; border:2.5px solid #FFD600;
              display:flex; align-items:center; justify-content:center;
              font-size:16px; box-shadow:0 2px 8px rgba(0,0,0,.55);
              transition: transform .15s; }
  .pin:active .dot { transform: scale(1.15); }
  .pin .halo { position:absolute; z-index:1; left:50%; top:50%;
               width:34px; height:34px; margin:-17px 0 0 -17px;
               border-radius:50%; border:2px solid #33d17a; opacity:0; }
  .pin .rating { position:absolute; z-index:3; top:-5px; right:-7px;
                 background:#FFD600; color:#0a0a0a; font:800 9px/1 sans-serif;
                 border-radius:8px; padding:2px 4px; white-space:nowrap;
                 box-shadow:0 1px 3px rgba(0,0,0,.6); }

  /* Todos los pines iguales: relleno oscuro, borde amarillo, halo de actividad */
  .pin .dot { border-color:#FFD600; box-shadow:0 0 13px rgba(255,214,0,.45); animation: float 3.4s ease-in-out infinite; }
  .pin .halo { animation: halo 2.4s ease-out infinite; border-color:#FFD600; }
  .pin.selected .dot { background:#FFD600; transform:scale(1.12); }
  .pin.selected .dot .ic { filter:brightness(0); }

  @keyframes halo { 0%{ transform:scale(1); opacity:.5; } 100%{ transform:scale(2.7); opacity:0; } }
  @keyframes pop  { 0%{ transform:scale(0); } 100%{ transform:scale(1); } }
  @keyframes float { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-4px); } }

  /* ─── Pin del cliente + alcance ──────────────────────── */
  .user { position:relative; width:18px; height:18px; }
  .user .udot { position:relative; z-index:3;
                width:16px; height:16px; border-radius:50%;
                background:#FFD600; border:3px solid #fff;
                box-shadow:0 0 8px rgba(255,214,0,.85); }
  .user .uring { position:absolute; z-index:1; left:50%; top:50%;
                 width:16px; height:16px; margin:-8px 0 0 -8px;
                 border-radius:50%; border:2px solid #FFD600;
                 animation: reach 3s ease-out infinite; }
  .user .uring.b { animation-delay: 1.5s; }
  @keyframes reach { 0%{ transform:scale(1); opacity:.55; } 100%{ transform:scale(7.5); opacity:0; } }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const map = L.map('map', { zoomControl:false, attributionControl:false })
    .setView([-38.7183, -62.2663], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);

  let userMarker = null;
  let workerMarkers = {};   // id -> { marker, sig }

  const userIcon = L.divIcon({
    html: '<div class="user"><span class="uring"></span><span class="uring b"></span><span class="udot"></span></div>',
    iconSize:[18,18], iconAnchor:[9,9], className:''
  });

  function esc(s){ return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  function ratingOf(w){
    const r = w.effective_rating != null ? w.effective_rating : w.avg_rating;
    const n = parseFloat(r);
    return (n && n > 0) ? n.toFixed(1) : null;
  }
  function stateOf(w){
    if (w.state) return w.state;
    if (w.available === false) return 'busy';
    return 'available';
  }
  // Firma para saber si hay que recrear el ícono (todos los pines son iguales)
  function sigOf(w, selected){
    return [ratingOf(w)||'', selected?1:0, w.ambient?1:0].join('|');
  }

  function makeIcon(w, selected){
    const rating = (!w.ambient) ? ratingOf(w) : null;
    const ratingHtml = rating ? '<span class="rating">★'+esc(rating)+'</span>' : '';
    // Cada onda arranca desfasada (delay y duración propios) para que no parezcan a compás
    const delay = (Math.random() * 2.4).toFixed(2);
    const dur   = (2 + Math.random() * 1.8).toFixed(2);
    const haloStyle = 'animation-delay:' + delay + 's;animation-duration:' + dur + 's';
    // Pin uniforme: una llave inglesa en el medio (solo indica "profesional", no el oficio)
    return L.divIcon({
      html: '<div class="pin'+(selected?' selected':'')+'">'
          +   '<span class="halo" style="'+haloStyle+'"></span>'
          +   '<span class="dot"><span class="ic">🔧</span></span>'
          +   ratingHtml
          + '</div>',
      iconSize:[42,42], iconAnchor:[21,21], className:''
    });
  }

  function setWorkers(workers){
    const newIds = new Set(workers.map(w => String(w.id)));
    Object.keys(workerMarkers).forEach(id => {
      if (!newIds.has(id)) { map.removeLayer(workerMarkers[id].marker); delete workerMarkers[id]; }
    });

    workers.forEach(w => {
      if (w.lat == null || w.lng == null) return;
      const id = String(w.id);
      const sig = sigOf(w, false);
      const existing = workerMarkers[id];
      if (existing) {
        existing.marker.setLatLng([w.lat, w.lng]);
        if (existing.sig !== sig) { existing.marker.setIcon(makeIcon(w, false)); existing.sig = sig; }
      } else {
        const marker = L.marker([w.lat, w.lng], { icon: makeIcon(w, false) })
          .addTo(map)
          .on('click', () => {
            const type = w.ambient ? 'AMBIENT_PRESS' : 'WORKER_PRESS';
            window.ReactNativeWebView.postMessage(JSON.stringify({ type, worker: w }));
          });
        workerMarkers[id] = { marker, sig };
      }
    });
  }

  function setLocation(lat, lng){
    if (userMarker) { userMarker.setLatLng([lat, lng]); }
    else { userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map); }
    map.setView([lat, lng], 14, { animate:true });
  }

  document.addEventListener('message', handle);
  window.addEventListener('message', handle);
  function handle(e){
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'SET_WORKERS') setWorkers(msg.workers || []);
      if (msg.type === 'SET_LOCATION') setLocation(msg.latitude, msg.longitude);
    } catch {}
  }
</script>
</body>
</html>
  `;

  return (
    <WebView
      ref={webRef}
      style={[styles.map, style]}
      source={{ html }}
      onMessage={handleMessage}
      onLoad={handleLoad}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
      scrollEnabled={false}
    />
  );
};

const styles = StyleSheet.create({
  map: { flex: 1 },
});

export default VoltMap;

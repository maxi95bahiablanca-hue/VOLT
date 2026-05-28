import React, { useRef, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const VoltMap = ({ userLocation, workers, onWorkerPress, style }) => {
  const webRef = useRef(null);
  const mapReadyRef = useRef(false);
  const pendingLocationRef = useRef(null);
  const pendingWorkersRef = useRef([]);

  const sendToMap = (msg) => {
    webRef.current?.postMessage(JSON.stringify(msg));
  };

  // Cuando Leaflet termina de inicializarse, enviamos los mensajes que llegaron antes
  const handleLoad = () => {
    mapReadyRef.current = true;
    if (pendingLocationRef.current) {
      sendToMap({ type: 'SET_LOCATION', ...pendingLocationRef.current });
    }
    if (pendingWorkersRef.current.length > 0) {
      sendToMap({ type: 'SET_WORKERS', workers: pendingWorkersRef.current });
    }
  };

  // Actualizar workers en el mapa cuando cambian
  useEffect(() => {
    pendingWorkersRef.current = workers ?? [];
    if (!mapReadyRef.current) return;
    sendToMap({ type: 'SET_WORKERS', workers: workers ?? [] });
  }, [workers]);

  // Centrar en ubicación del usuario
  useEffect(() => {
    pendingLocationRef.current = userLocation;
    if (!mapReadyRef.current || !userLocation) return;
    sendToMap({ type: 'SET_LOCATION', ...userLocation });
  }, [userLocation]);

  const handleMessage = (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'WORKER_PRESS' && onWorkerPress) {
        onWorkerPress(msg.worker);
      }
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
  .worker-icon {
    display:flex; align-items:center; justify-content:center;
    width:36px; height:36px; border-radius:18px;
    background:#1a1a1a; border:2.5px solid #FFD600;
    box-shadow:0 0 12px rgba(255,214,0,0.5);
    font-size:16px; cursor:pointer;
    transition: transform 0.15s;
  }
  .worker-icon:hover { transform: scale(1.15); }
  .worker-icon.selected { background:#FFD600; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const map = L.map('map', { zoomControl:false, attributionControl:false })
    .setView([-38.7183, -62.2663], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom:19,
    attribution:'&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);

  let userMarker = null;
  let workerMarkers = {};

  // Ícono de usuario
  const userIcon = L.divIcon({
    html: '<div style="width:16px;height:16px;border-radius:50%;background:#4285F4;border:3px solid white;box-shadow:0 0 8px rgba(66,133,244,0.8)"></div>',
    iconSize:[16,16], iconAnchor:[8,8], className:''
  });

  function makeWorkerIcon(worker, selected) {
    return L.divIcon({
      html: '<div class="worker-icon' + (selected?' selected':'') + '">⚡</div>',
      iconSize:[36,36], iconAnchor:[18,18], className:''
    });
  }

  function setWorkers(workers) {
    // Limpiar markers viejos que ya no están
    const newIds = new Set(workers.map(w => w.id));
    Object.keys(workerMarkers).forEach(id => {
      if (!newIds.has(id)) { map.removeLayer(workerMarkers[id]); delete workerMarkers[id]; }
    });

    workers.forEach(w => {
      if (!w.lat || !w.lng) return;
      if (workerMarkers[w.id]) {
        workerMarkers[w.id].setLatLng([w.lat, w.lng]);
      } else {
        const marker = L.marker([w.lat, w.lng], { icon: makeWorkerIcon(w, false) })
          .addTo(map)
          .on('click', () => {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type:'WORKER_PRESS', worker: w }));
          });
        workerMarkers[w.id] = marker;
      }
    });
  }

  function setLocation(lat, lng) {
    if (userMarker) { userMarker.setLatLng([lat, lng]); }
    else { userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map); }
    map.setView([lat, lng], 14, { animate:true });
  }

  // Mensajes desde React Native
  document.addEventListener('message', handle);
  window.addEventListener('message', handle);

  function handle(e) {
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

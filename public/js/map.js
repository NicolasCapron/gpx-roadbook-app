/* map.js — Leaflet map, trace rendering, waypoint markers */

const MapManager = (() => {

  let map, traceLayer, wpLayer;
  let onMapClick = null;   // callback(lat, lon) when in placing mode
  let placing = false;

  // ── Marker colors by type ─────────────────────────────────────────────────
  const TYPE_COLOR = {
    commune:  '#1e5fa8',
    montee:   '#c43000',
    pave:     '#7a5c2e',
    ravito:   '#2d7d46',
    ruban:    '#8a1f6e',
    danger:   '#b5000e',
    controle: '#444',
    depart:   '#1d6b30',
    arrivee:  '#9b0000',
    custom:   '#4a22a0',
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    map = L.map('map', { zoomControl: true }).setView([46.5, 2.5], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    traceLayer = L.layerGroup().addTo(map);
    wpLayer    = L.layerGroup().addTo(map);

    map.on('click', (e) => {
      if (placing && onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    });
  }

  // ── Draw GPX trace (blue) with climb segments (red) ────────────────────────
  function drawTrace(points, climbs) {
    traceLayer.clearLayers();
    if (!points.length) return;

    const latlngs = points.map(p => [p.lat, p.lon]);

    // Shadow line
    L.polyline(latlngs, { color: 'white', weight: 6, opacity: .5 }).addTo(traceLayer);
    // Main line — blue
    L.polyline(latlngs, { color: '#2563eb', weight: 3.5, opacity: .85 }).addTo(traceLayer);

    // Climb segments — red overlay
    if (climbs && climbs.length) {
      climbs.forEach(c => {
        const climbLatLngs = [];
        for (let i = c.startIdx; i <= c.endIdx; i++) {
          climbLatLngs.push([points[i].lat, points[i].lon]);
        }
        // Intensity based on gradient
        const intensity = Math.min(c.gradient / 12, 1);
        const red = Math.round(180 + intensity * 75);   // 180–255
        const green = Math.round(40 - intensity * 40);   // 40–0
        const color = `rgb(${red}, ${green}, 0)`;

        // Red shadow
        L.polyline(climbLatLngs, { color: 'white', weight: 7, opacity: .5 }).addTo(traceLayer);
        // Red line
        L.polyline(climbLatLngs, { color, weight: 4, opacity: .95 }).addTo(traceLayer);
      });
    }

    // Start / end circles
    L.circleMarker(latlngs[0], {
      radius: 7, color: 'white', weight: 2, fillColor: '#2d7d46', fillOpacity: 1,
    }).addTo(traceLayer).bindPopup('<strong>Départ</strong>');

    L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 7, color: 'white', weight: 2, fillColor: '#b5000e', fillOpacity: 1,
    }).addTo(traceLayer).bindPopup('<strong>Arrivée</strong>');

    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  }

  // ── Waypoint marker ───────────────────────────────────────────────────────
  function createWPMarker(wp) {
    const color  = TYPE_COLOR[wp.type] || '#444';
    const icon   = GPX.iconFor(wp.type);
    const fromKm = (wp.distFromStart / 1000).toFixed(1);
    const remKm  = (wp.distRemaining / 1000).toFixed(1);

    const divIcon = L.divIcon({
      className: '',
      html: `<div style="
        background:${color};
        color:white;
        width:30px;height:30px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid white;
        box-shadow:0 2px 6px rgba(0,0,0,.35);
        display:flex;align-items:center;justify-content:center;
        font-size:13px;
      "><span style="transform:rotate(45deg)">${icon}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -32],
    });

    const marker = L.marker([wp.lat, wp.lon], { icon: divIcon });

    marker.bindPopup(`
      <div style="font-size:13px;min-width:160px;">
        <strong>${icon} ${wp.name}</strong><br>
        <span style="color:#888;font-size:11px;">${wp.type}</span><br>
        <span style="font-family:monospace;font-size:12px;">
          +${fromKm} km · -${remKm} km
        </span>
        ${wp.note ? `<br><em style="color:#555;font-size:11px;">${wp.note}</em>` : ''}
      </div>
    `);

    marker._wpId = wp.id;
    wpLayer.addLayer(marker);
    return marker;
  }

  // ── Remove marker by wp id ────────────────────────────────────────────────
  function removeWPMarker(id) {
    wpLayer.eachLayer(layer => {
      if (layer._wpId === id) wpLayer.removeLayer(layer);
    });
  }

  // ── Clear all waypoint markers ────────────────────────────────────────────
  function clearWPMarkers() { wpLayer.clearLayers(); }

  // ── Placing mode ──────────────────────────────────────────────────────────
  function startPlacing(callback) {
    placing = true;
    onMapClick = callback;
    document.getElementById('map').classList.add('placing-wp');
    document.getElementById('map-overlay-hint').classList.remove('hidden');
  }

  function stopPlacing() {
    placing = false;
    onMapClick = null;
    document.getElementById('map').classList.remove('placing-wp');
    document.getElementById('map-overlay-hint').classList.add('hidden');
  }

  // ── Snap to nearest trace point ───────────────────────────────────────────
  function snapToTrace(lat, lon, tracePoints) {
    if (!tracePoints?.length) return { lat, lon };
    let best = tracePoints[0], bestD = Infinity;
    for (const pt of tracePoints) {
      const d = GPX.haversine(lat, lon, pt.lat, pt.lon);
      if (d < bestD) { bestD = d; best = pt; }
    }
    return best;
  }

  // ── Pan to coords ──────────────────────────────────────────────────────────
  function panTo(lat, lon) { map.panTo([lat, lon]); }

  // ── Recalculate map size after layout change ──────────────────────────────
  function invalidateSize() { setTimeout(() => map.invalidateSize(), 100); }

  return {
    init, drawTrace, createWPMarker, removeWPMarker,
    clearWPMarkers, startPlacing, stopPlacing, snapToTrace, panTo, invalidateSize,
  };
})();

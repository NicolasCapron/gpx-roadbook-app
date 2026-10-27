(function () {
  const map = L.map('map', { zoomControl: true }).setView([46.6, 2.4], 6);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  }).addTo(map);

  const connectBox = document.getElementById('connectBox');
  const connectedBox = document.getElementById('connectedBox');
  const athleteInfo = document.getElementById('athleteInfo');
  const statusEl = document.getElementById('status');
  const btnConnect = document.getElementById('btnConnect');
  const btnLoad = document.getElementById('btnLoad');
  const btnLogout = document.getElementById('btnLogout');

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  // Google encoded polyline (precision 5) → [[lat, lng], ...]
  function decodePolyline(str) {
    let index = 0, lat = 0, lng = 0;
    const coords = [];
    while (index < str.length) {
      let b, shift = 0, result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      shift = 0; result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);

      coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
  }

  async function refreshStatus() {
    const res = await fetch('/api/stat-hunter/status');
    const data = await res.json();
    connectBox.classList.toggle('hidden', data.connected);
    connectedBox.classList.toggle('hidden', !data.connected);
    if (data.connected && data.athlete) {
      athleteInfo.textContent = `Connecté : ${data.athlete.firstname || ''} ${data.athlete.lastname || ''}`.trim();
    }
    return data.connected;
  }

  async function loadTraces() {
    btnLoad.disabled = true;
    setStatus('Chargement des activités Strava…');
    try {
      const res = await fetch('/api/stat-hunter/activities');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const activities = await res.json();
      setStatus(`${activities.length} traces reçues, affichage…`);

      const group = L.featureGroup().addTo(map);
      for (const a of activities) {
        const coords = decodePolyline(a.polyline);
        if (coords.length < 2) continue;
        L.polyline(coords, {
          color: '#fc4c02',
          weight: 1.5,
          opacity: 0.55,
        }).bindPopup(`${a.name}<br>${(a.distance / 1000).toFixed(1)} km`).addTo(group);
      }

      if (group.getLayers().length) {
        map.fitBounds(group.getBounds(), { padding: [20, 20] });
      }
      setStatus(`${group.getLayers().length} traces affichées.`);
    } catch (err) {
      setStatus(`Erreur : ${err.message}`);
    } finally {
      btnLoad.disabled = false;
    }
  }

  btnConnect.addEventListener('click', () => {
    window.location.href = '/stat-hunter/auth/strava';
  });

  btnLoad.addEventListener('click', loadTraces);

  btnLogout.addEventListener('click', async () => {
    await fetch('/api/stat-hunter/logout', { method: 'POST' });
    window.location.reload();
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) {
    setStatus(`Erreur de connexion Strava : ${params.get('error')}`);
    history.replaceState({}, '', window.location.pathname);
  }

  refreshStatus();
})();

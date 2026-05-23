/* app.js — contrôleur principal, gestion des événements */

(async function App() {

  // ── State ─────────────────────────────────────────────────────────────────
  let rawGPX        = null;   // original GPX text
  let tracePoints   = [];     // parsed points
  let activeTool    = null;   // current waypoint type being placed
  let currentRouteId = null;  // ID of loaded saved route (null = new)
  let currentFileName = '';   // original file name

  // ── Init ──────────────────────────────────────────────────────────────────
  MapManager.init();

  // ── File drop / select ────────────────────────────────────────────────────
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) loadGPXFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadGPXFile(fileInput.files[0]);
  });

  function loadGPXFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        rawGPX = e.target.result;
        tracePoints = GPX.parse(rawGPX);
        const { totalDist, eleGain } = GPX.stats(tracePoints);

        currentRouteId = null;
        currentFileName = file.name;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-stats').textContent =
          `${tracePoints.length.toLocaleString('fr')} pts · ${(totalDist / 1000).toFixed(1)} km` +
          (eleGain > 0 ? ` · D+${eleGain.toLocaleString('fr')} m` : '');

        document.getElementById('drop-zone').classList.add('hidden');
        document.getElementById('file-info').classList.remove('hidden');

        Roadbook.clear();
        Roadbook.setup(totalDist, () => Roadbook.render());
        MapManager.clearWPMarkers();
        MapManager.drawTrace(tracePoints);

        // Auto-add depart & arrivee
        const first = tracePoints[0];
        const last  = tracePoints[tracePoints.length - 1];
        Roadbook.add({ type: 'depart', lat: first.lat, lon: first.lon, distFromStart: 0,
          name: 'Départ', note: '', auto: true });
        Roadbook.add({ type: 'arrivee', lat: last.lat, lon: last.lon, distFromStart: totalDist,
          name: 'Arrivée', note: '', auto: true });

        // Auto-detect climbs
        const climbs = GPX.detectClimbs(tracePoints);
        climbs.forEach(c => {
          const lengthKm = (c.length / 1000).toFixed(1);
          Roadbook.add({
            type: 'montee', lat: c.lat, lon: c.lon, distFromStart: c.dist,
            name: `${c.gain}m D+ (${c.gradient}%)`,
            note: `${lengthKm} km · ${c.eleStart}→${c.eleEnd} m`,
            auto: true,
          });
        });

        Roadbook.getAll().filter(w => w.auto).forEach(w => MapManager.createWPMarker(w));
        Roadbook.render();

        toast('✅ GPX chargé — ' + (totalDist / 1000).toFixed(1) + ' km');
      } catch (err) {
        toast('❌ ' + err.message, 4000);
      }
    };
    reader.readAsText(file);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  document.getElementById('btn-reset').addEventListener('click', () => {
    rawGPX = null;
    tracePoints = [];
    Roadbook.clear();
    MapManager.clearWPMarkers();
    MapManager.drawTrace([]);
    cancelActiveTool();
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('geocode-progress').classList.add('hidden');
    fileInput.value = '';
    Roadbook.render();
  });

  // ── Geocode communes ──────────────────────────────────────────────────────
  document.getElementById('btn-geocode').addEventListener('click', async () => {
    if (!tracePoints.length) return;

    const btn       = document.getElementById('btn-geocode');
    const progDiv   = document.getElementById('geocode-progress');
    const progFill  = document.getElementById('progress-fill');
    const progLabel = document.getElementById('progress-label');

    btn.disabled = true;
    progDiv.classList.remove('hidden');

    const sampled = GPX.sample(tracePoints, 1000);

    progLabel.textContent = `Géocodage de ${sampled.length} points via Nominatim…`;
    progFill.style.width = '5%';

    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: sampled }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const names = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = JSON.parse(line.slice(5));
          if (payload.name !== undefined) {
            names.push(payload.name);
            const pct = 5 + Math.round((names.length / sampled.length) * 90);
            progFill.style.width = pct + '%';
            progLabel.textContent = `Géocodage… ${names.length}/${sampled.length}`;
          }
          if (payload.error) {
            console.warn('[geocode]', payload.error);
          }
        }
      }

      progFill.style.width = '95%';
      progLabel.textContent = 'Construction du roadbook…';

      // Clear communes & auto depart/arrivee, keep everything else (montées, custom, etc.)
      const keep = Roadbook.getAll().filter(w => w.type !== 'commune' && !(w.auto && (w.type === 'depart' || w.type === 'arrivee')));
      Roadbook.clear();
      const totalDist = GPX.stats(tracePoints).totalDist;
      Roadbook.setup(totalDist, () => Roadbook.render());
      MapManager.clearWPMarkers();

      // Re-add kept waypoints (montées auto, custom points, etc.)
      keep.forEach(w => { Roadbook.add(w); MapManager.createWPMarker(w); });

      // Add new communes
      Roadbook.buildFromGeocodeNames(sampled, names, totalDist);

      // Re-create depart/arrivee with commune names
      const first = tracePoints[0];
      const last  = tracePoints[tracePoints.length - 1];
      const firstName = names[0] || '';
      const lastName  = names[names.length - 1] || '';

      Roadbook.add({ type: 'depart', lat: first.lat, lon: first.lon, distFromStart: 0,
        name: firstName ? `Départ — ${firstName}` : 'Départ', note: '', auto: true });
      Roadbook.add({ type: 'arrivee', lat: last.lat, lon: last.lon, distFromStart: totalDist,
        name: lastName ? `Arrivée — ${lastName}` : 'Arrivée', note: '', auto: true });

      Roadbook.getAll().forEach(w => MapManager.createWPMarker(w));

      const nbCommunes = Roadbook.getAll().filter(w => w.type === 'commune').length;
      progFill.style.width = '100%';
      progLabel.textContent = `✓ ${nbCommunes} communes + départ/arrivée`;
      toast('🏘 Communes + départ/arrivée ajoutés !');
    } catch (err) {
      progLabel.textContent = '❌ Erreur : ' + err.message;
      toast('❌ ' + err.message, 5000);
    } finally {
      btn.disabled = false;
    }
  });

  // ── Waypoint tool selection ───────────────────────────────────────────────
  document.querySelectorAll('.wp-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!tracePoints.length) { toast('⚠️ Chargez d\'abord un fichier GPX'); return; }

      const type = btn.dataset.type;

      if (activeTool === type) {
        cancelActiveTool();
        return;
      }

      document.querySelectorAll('.wp-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTool = type;

      document.getElementById('active-tool-name').textContent = btn.textContent;
      document.getElementById('active-tool').classList.remove('hidden');

      MapManager.startPlacing((lat, lon) => {
        // Snap to nearest trace point
        const snapped = MapManager.snapToTrace(lat, lon, tracePoints);
        openModal(type, snapped.lat, snapped.lon, snapped.dist);
      });
    });
  });

  document.getElementById('btn-cancel-tool').addEventListener('click', cancelActiveTool);

  function cancelActiveTool() {
    activeTool = null;
    document.querySelectorAll('.wp-type-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('active-tool').classList.add('hidden');
    MapManager.stopPlacing();
  }

  // ── Modal for waypoint name/note ──────────────────────────────────────────
  let pendingWP = null;

  function openModal(type, lat, lon, distFromStart) {
    const icons = {
      commune:'🏘', pave:'🪨', ravito:'🍌', ruban:'🎗',
      danger:'⚠️', controle:'🏁', depart:'🟢', arrivee:'🔴', custom:'📍',
    };
    pendingWP = { type, lat, lon, distFromStart };

    document.getElementById('modal-title').textContent =
      `${icons[type] || '📍'} Nouveau point — ${type}`;
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-note').value = '';
    document.getElementById('modal-backdrop').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-name').focus(), 50);
  }

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-backdrop')) closeModal();
  });

  document.getElementById('modal-save').addEventListener('click', saveWP);
  document.getElementById('modal-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveWP();
    if (e.key === 'Escape') closeModal();
  });

  function closeModal() {
    pendingWP = null;
    document.getElementById('modal-backdrop').classList.add('hidden');
  }

  function saveWP() {
    if (!pendingWP) return;
    const name = document.getElementById('modal-name').value.trim();
    const note = document.getElementById('modal-note').value.trim();
    if (!name) { document.getElementById('modal-name').focus(); return; }

    const wp = { ...pendingWP, name, note };
    const id = Roadbook.add(wp);
    const added = Roadbook.getAll().find(w => w.id === id);
    if (added) MapManager.createWPMarker(added);

    closeModal();
    toast(`✓ "${name}" ajouté`);
  }

  // ── Export GPX ────────────────────────────────────────────────────────────
  document.getElementById('btn-export-gpx').addEventListener('click', () => {
    if (!rawGPX) { toast('⚠️ Aucun GPX chargé'); return; }
    const all = Roadbook.getAll();
    if (!all.length) { toast('⚠️ Aucun point dans le roadbook'); return; }

    const enriched = GPX.exportGPX(rawGPX, all);
    const blob = new Blob([enriched], { type: 'application/gpx+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: (document.getElementById('file-name').textContent || 'trace').replace(/\.gpx$/i, '') + '_roadbook.gpx',
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('⬇ GPX exporté !');
  });

  // ── Print ─────────────────────────────────────────────────────────────────
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  // ── Save route ────────────────────────────────────────────────────────────
  document.getElementById('btn-save-route').addEventListener('click', () => {
    if (!rawGPX) { toast('⚠️ Aucun GPX chargé'); return; }

    const defaultName = currentFileName.replace(/\.gpx$/i, '') || 'Mon parcours';
    const name = prompt('Nom du parcours :', defaultName);
    if (!name) return;

    const { totalDist, eleGain } = GPX.stats(tracePoints);
    const id = Routes.save({
      id: currentRouteId,
      name,
      fileName: currentFileName,
      rawGPX,
      totalDist,
      eleGain,
      waypoints: Roadbook.getAll(),
    });

    if (id) {
      currentRouteId = id;
      toast('💾 Parcours sauvegardé !');
    } else {
      toast('❌ Espace de stockage insuffisant', 4000);
    }
  });

  // ── Load saved route into editor ─────────────────────────────────────────
  function loadSavedRoute(route) {
    try {
      rawGPX = route.rawGPX;
      tracePoints = GPX.parse(rawGPX);
      const { totalDist, eleGain } = GPX.stats(tracePoints);

      currentRouteId = route.id;
      currentFileName = route.fileName || '';

      document.getElementById('file-name').textContent = route.name;
      document.getElementById('file-stats').textContent =
        `${tracePoints.length.toLocaleString('fr')} pts · ${(totalDist / 1000).toFixed(1)} km` +
        (eleGain > 0 ? ` · D+${eleGain.toLocaleString('fr')} m` : '');

      document.getElementById('drop-zone').classList.add('hidden');
      document.getElementById('file-info').classList.remove('hidden');
      document.getElementById('geocode-progress').classList.add('hidden');

      MapManager.clearWPMarkers();
      MapManager.drawTrace(tracePoints);

      Roadbook.clear();
      Roadbook.setup(totalDist, () => Roadbook.render());
      Roadbook.restore(route.waypoints, totalDist);
      Roadbook.getAll().forEach(w => MapManager.createWPMarker(w));
      Roadbook.render();

      toast('✅ Parcours chargé — ' + route.name);
    } catch (err) {
      toast('❌ ' + err.message, 4000);
    }
  }

  // ── Export GPX from saved route (no need to load in editor) ──────────────
  function exportSavedRoute(route) {
    const enriched = GPX.exportGPX(route.rawGPX, route.waypoints);
    const blob = new Blob([enriched], { type: 'application/gpx+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: (route.fileName || route.name || 'trace').replace(/\.gpx$/i, '') + '_roadbook.gpx',
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('⬇ GPX exporté !');
  }

  // ── View toggle: editor ↔ routes list ────────────────────────────────────
  function showRoutesList() {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('map-container').classList.add('hidden');
    document.getElementById('view-routes').classList.remove('hidden');

    Routes.renderList(document.getElementById('routes-list'), {
      onEdit: (route) => {
        loadSavedRoute(route);
        showEditor();
      },
      onExport: (route) => {
        exportSavedRoute(route);
      },
      onDelete: (id) => {
        Routes.remove(id);
        if (currentRouteId === id) currentRouteId = null;
        showRoutesList(); // refresh
        toast('🗑 Parcours supprimé');
      },
    });
  }

  function showEditor() {
    document.getElementById('view-routes').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('map-container').classList.remove('hidden');
    MapManager.invalidateSize();
  }

  document.getElementById('btn-my-routes').addEventListener('click', showRoutesList);
  document.getElementById('btn-back-editor').addEventListener('click', showEditor);

  // ── Toast helper ──────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  window.toast = toast; // expose for modules

})();

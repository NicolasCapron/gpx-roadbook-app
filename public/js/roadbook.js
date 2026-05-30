/* roadbook.js — waypoint store + table rendering */

const Roadbook = (() => {

  let waypoints  = [];   // { id, type, name, note, lat, lon, distFromStart, distRemaining, distToNext }
  let totalDist  = 0;
  let onChanged  = null; // callback()
  let _onEditCb  = null; // callback(id)

  // ── Type config ───────────────────────────────────────────────────────────
  const TYPE_LABEL = {
    commune:  'Commune',
    montee:   'Montée',
    pave:     'Pavés',
    ravito:   'Ravito',
    ruban:    'Ruban',
    danger:   'Danger',
    controle: 'Contrôle',
    depart:   'Départ',
    arrivee:  'Arrivée',
    custom:   'Point',
  };

  // ── Setup ─────────────────────────────────────────────────────────────────
  function setup(total, changedCb) {
    totalDist = total;
    onChanged = changedCb;
  }

  function onEdit(cb) { _onEditCb = cb; }

  // ── Add waypoint ──────────────────────────────────────────────────────────
  function add(wp) {
    const id = Date.now() + Math.random();
    waypoints.push({ ...wp, id, distRemaining: totalDist - wp.distFromStart });
    _recalc();
    return id;
  }

  // ── Remove waypoint ───────────────────────────────────────────────────────
  function remove(id) {
    waypoints = waypoints.filter(w => w.id !== id);
    _recalc();
  }

  // ── Update waypoint name/note ─────────────────────────────────────────────
  function update(id, fields) {
    const wp = waypoints.find(w => w.id === id);
    if (wp) {
      Object.assign(wp, fields);
      _recalc();
    }
  }

  // ── Get single waypoint by id ─────────────────────────────────────────────
  function getById(id) {
    return waypoints.find(w => w.id === id) || null;
  }

  // ── Clear all ─────────────────────────────────────────────────────────────
  function clear() {
    waypoints = [];
    totalDist = 0;
  }

  // ── Get all sorted by distance ────────────────────────────────────────────
  function getAll() {
    return [...waypoints].sort((a, b) => a.distFromStart - b.distFromStart);
  }

  // ── Recalculate distToNext after sort ─────────────────────────────────────
  function _recalc() {
    const sorted = getAll();
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[i + 1];
      sorted[i].distToNext = next
        ? next.distFromStart - sorted[i].distFromStart
        : totalDist - sorted[i].distFromStart;
      sorted[i].distRemaining = totalDist - sorted[i].distFromStart;
    }
    // Update in original array too
    const map = Object.fromEntries(sorted.map(w => [w.id, w]));
    waypoints = waypoints.map(w => map[w.id] || w);
    if (onChanged) onChanged();
  }

  // ── Render roadbook table ─────────────────────────────────────────────────
  function render() {
    const sorted = getAll();
    const empty  = document.getElementById('roadbook-empty');
    const table  = document.getElementById('roadbook-table');
    const tbody  = document.getElementById('roadbook-body');

    if (!sorted.length) {
      empty.classList.remove('hidden');
      table.classList.add('hidden');
      return;
    }

    empty.classList.add('hidden');
    table.classList.remove('hidden');
    tbody.innerHTML = '';

    // Build print strip
    _renderStrip(sorted);

    sorted.forEach((wp, i) => {
      const tr = document.createElement('tr');
      tr.dataset.id = wp.id;

      const label    = TYPE_LABEL[wp.type] || 'Point';
      const fromKm   = (wp.distFromStart / 1000).toFixed(1);
      const remKm    = (wp.distRemaining / 1000).toFixed(1);
      const nextKm   = wp.distToNext != null ? (wp.distToNext / 1000).toFixed(1) : '—';
      const icon     = GPX.iconFor(wp.type);

      tr.innerHTML = `
        <td class="rb-num">${i + 1}</td>
        <td class="rb-name">
          <span class="rb-badge badge-${wp.type}">${label}</span>
          <span>${icon} ${_esc(wp.name)}</span>
          ${wp.note ? `<small>${_esc(wp.note)}</small>` : ''}
        </td>
        <td class="rb-dist">${fromKm}</td>
        <td class="rb-dist">${remKm}</td>
        <td class="rb-next">${nextKm}</td>
        <td class="rb-actions">
          <button class="btn-edit-wp" data-id="${wp.id}" title="Modifier">✎</button>
          <button class="btn-del" data-id="${wp.id}" title="Supprimer">✕</button>
        </td>
      `;

      // Click row → pan map
      tr.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-del')) return;
        MapManager.panTo(wp.lat, wp.lon);
      });

      tbody.appendChild(tr);
    });

    // Edit buttons
    tbody.querySelectorAll('.btn-edit-wp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseFloat(btn.dataset.id);
        if (_onEditCb) _onEditCb(id);
      });
    });

    // Delete buttons
    tbody.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseFloat(btn.dataset.id);
        MapManager.removeWPMarker(id);
        remove(id);
      });
    });
  }

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Render print strip (2cm-wide sticker) ─────────────────────────────────
  function _renderStrip(sorted) {
    let strip = document.getElementById('print-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'print-strip';
      document.body.appendChild(strip);
    }
    strip.innerHTML = '';

    sorted.forEach((wp, i) => {
      const icon   = GPX.iconFor(wp.type);
      const num    = i + 1;
      const fromKm = (wp.distFromStart / 1000).toFixed(1);
      const remKm  = (wp.distRemaining / 1000).toFixed(1);
      const nextKm = wp.distToNext != null ? (wp.distToNext / 1000).toFixed(1) : '';

      const cell = document.createElement('div');
      cell.className = `strip-cell strip-${wp.type}`;
      cell.innerHTML =
        `<div class="strip-num">#${num}</div>` +
        `<div class="strip-km">${fromKm} <span class="strip-rem">-${remKm}</span></div>` +
        `<div class="strip-icon">${icon}</div>` +
        `<div class="strip-name">${_esc(wp.name)}</div>` +
        (wp.note ? `<div class="strip-note">${_esc(wp.note)}</div>` : '') +
        (nextKm ? `<div class="strip-next">↓ ${nextKm} km</div>` : '');

      strip.appendChild(cell);
    });
  }

  // ── Build communes from geocode results ───────────────────────────────────
  function buildFromGeocodeNames(sampledPts, names, total) {
    totalDist = total;
    let lastName = null;
    const communes = [];

    sampledPts.forEach((pt, i) => {
      const name = (names[i] || '').trim() || '—';
      if (name !== lastName) {
        communes.push({ type: 'commune', name, lat: pt.lat, lon: pt.lon, distFromStart: pt.dist, note: '' });
        lastName = name;
      }
    });

    // Skip first commune (duplicate with auto depart), keep last (entry into arrival town)
    if (communes.length > 1) communes.shift();
    communes.forEach(c => add(c));
  }

  // ── Restore waypoints from saved data ──────────────────────────────────────
  function restore(savedWaypoints, total) {
    waypoints = [];
    totalDist = total;
    savedWaypoints.forEach(wp => {
      waypoints.push({ ...wp, id: Date.now() + Math.random(), distRemaining: total - wp.distFromStart });
    });
    _recalc();
  }

  return {
    setup, add, remove, update, getById, clear, getAll, render, buildFromGeocodeNames, restore, onEdit,
  };
})();

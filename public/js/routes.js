/* routes.js — localStorage CRUD + routes list rendering */

const Routes = (() => {
  const STORAGE_KEY = 'gpx-roadbook-routes';

  function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }

  function _persist(routes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
      return true;
    } catch (e) {
      console.error('[Routes] localStorage quota exceeded', e);
      return false;
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function save({ id, name, fileName, rawGPX, totalDist, eleGain, waypoints }) {
    const routes = _load();
    const now = new Date().toISOString();

    if (id) {
      // Update existing
      const idx = routes.findIndex(r => r.id === id);
      if (idx >= 0) {
        routes[idx] = { ...routes[idx], name, fileName, rawGPX, totalDist, eleGain, waypoints, updatedAt: now };
        _persist(routes);
        return routes[idx].id;
      }
    }

    // Create new
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    routes.unshift({ id: newId, name, fileName, rawGPX, totalDist, eleGain, waypoints, savedAt: now, updatedAt: now });
    if (!_persist(routes)) {
      return null; // quota exceeded
    }
    return newId;
  }

  function getAll() {
    return _load().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function get(id) {
    return _load().find(r => r.id === id) || null;
  }

  function remove(id) {
    const routes = _load().filter(r => r.id !== id);
    _persist(routes);
  }

  // ── List UI rendering ─────────────────────────────────────────────────────

  function renderList(container, { onEdit, onExport, onDelete }) {
    const routes = getAll();
    container.innerHTML = '';

    if (!routes.length) {
      container.innerHTML = `
        <div class="routes-empty">
          <p>Aucun parcours sauvegardé</p>
          <p class="muted">Importez un GPX, créez votre roadbook puis cliquez sur 💾 Sauvegarder</p>
        </div>`;
      return;
    }

    routes.forEach(route => {
      const card = document.createElement('div');
      card.className = 'route-card';

      const distKm = (route.totalDist / 1000).toFixed(1);
      const date = new Date(route.updatedAt).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const wpCount = route.waypoints ? route.waypoints.length : 0;

      card.innerHTML = `
        <div class="route-info">
          <div class="route-name">${_esc(route.name)}</div>
          <div class="route-meta">
            ${distKm} km
            ${route.eleGain > 0 ? ` · D+${route.eleGain.toLocaleString('fr')} m` : ''}
            · ${wpCount} points
          </div>
          <div class="route-date">${date} · ${_esc(route.fileName || '')}</div>
        </div>
        <div class="route-actions">
          <button class="btn-route btn-edit" title="Modifier le roadbook">✏️ Modifier</button>
          <button class="btn-route btn-export" title="Télécharger le GPX enrichi">⬇ GPX</button>
          <button class="btn-route btn-delete" title="Supprimer">🗑</button>
        </div>`;

      card.querySelector('.btn-edit').addEventListener('click', () => onEdit(route));
      card.querySelector('.btn-export').addEventListener('click', () => onExport(route));
      card.querySelector('.btn-delete').addEventListener('click', () => {
        if (confirm(`Supprimer « ${route.name} » ?`)) {
          onDelete(route.id);
        }
      });

      container.appendChild(card);
    });
  }

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  return { save, getAll, get, remove, renderList };
})();

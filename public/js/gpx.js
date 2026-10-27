/* gpx.js — parsing GPX → points, export GPX enrichi */

const GPX = (() => {

  // ── Haversine distance (metres) ──────────────────────────────────────────
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, p = Math.PI / 180;
    const df = (lat2 - lat1) * p;
    const dl = (lon2 - lon1) * p;
    const a = Math.sin(df / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Parse GPX text → array of {lat, lon, ele?, time?, dist} ─────────────
  function parse(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');

    // Support track points and route points
    let pts = [...doc.querySelectorAll('trkpt')];
    if (!pts.length) pts = [...doc.querySelectorAll('rtept')];

    if (!pts.length) throw new Error('Aucun point de trace (trkpt/rtept) trouvé dans ce fichier.');

    const points = [];
    let cumDist = 0;

    pts.forEach((pt, i) => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) return;

      const eleEl = pt.querySelector('ele');
      const timeEl = pt.querySelector('time');

      if (i > 0 && points.length > 0) {
        const prev = points[points.length - 1];
        cumDist += haversine(prev.lat, prev.lon, lat, lon);
      }

      points.push({
        lat,
        lon,
        ele: eleEl ? parseFloat(eleEl.textContent) : null,
        time: timeEl ? timeEl.textContent : null,
        dist: cumDist,
      });
    });

    if (!points.length) throw new Error('Aucune coordonnée valide trouvée.');

    return points;
  }

  // ── Sample points every `stepMetres` ─────────────────────────────────────
  function sample(points, stepMetres = 1500) {
    if (!points.length) return [];
    const result = [points[0]];
    let lastDist = 0;

    for (const pt of points) {
      if (pt.dist - lastDist >= stepMetres) {
        result.push(pt);
        lastDist = pt.dist;
      }
    }

    const last = points[points.length - 1];
    if (result[result.length - 1] !== last) result.push(last);

    return result;
  }

  // ── Compute total distance, elevation gain ────────────────────────────────
  function stats(points) {
    const totalDist = points[points.length - 1]?.dist ?? 0;
    let eleGain = 0;
    for (let i = 1; i < points.length; i++) {
      const diff = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
      if (diff > 0) eleGain += diff;
    }
    return { totalDist, eleGain: Math.round(eleGain) };
  }

  // ── XML escape ────────────────────────────────────────────────────────────
  function escapeXML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Icon for waypoint type ────────────────────────────────────────────────
  function iconFor(type) {
    const icons = {
      commune:  '🏘',
      montee:   '⛰️',
      pave:     '🪨',
      ravito:   '🍌',
      ruban:    '🎗',
      danger:   '⚠️',
      controle: '🏁',
      depart:   '🟢',
      arrivee:  '🔴',
      custom:   '📍',
    };
    return icons[type] || '📍';
  }

  // ── Garmin symbol for waypoint type ──────────────────────────────────────
  function garminSym(type) {
    const syms = {
      commune:  'City (Small)',
      montee:   'Summit',
      pave:     'Residence',
      ravito:   'Food Source',
      ruban:    'Flag, Blue',
      danger:   'Danger Area',
      controle: 'Crossing',
      depart:   'Flag, Green',
      arrivee:  'Flag, Red',
      custom:   'Waypoint',
    };
    return syms[type] || 'Waypoint';
  }

  // ── Export enriched GPX ──────────────────────────────────────────────────
  function exportGPX(originalText, waypoints) {
    // Build <wpt> elements for all waypoints
    const wptBlocks = waypoints
      .slice()
      .sort((a, b) => a.distFromStart - b.distFromStart)
      .map((wp, i) => {
        const km     = (wp.distRemaining / 1000).toFixed(1);
        const fromKm = (wp.distFromStart / 1000).toFixed(1);
        const typeLabel = { commune:'COM', montee:'MON', pave:'PAV', ravito:'RAV', ruban:'SPR', danger:'DGR', controle:'CTL', depart:'DEP', arrivee:'ARR', custom:'WPT' };
        const tag  = typeLabel[wp.type] || 'WPT';
        const name = `#${i + 1} [${tag}] ${escapeXML(wp.name)} (-${km}km)`;
        const desc   = `Type: ${wp.type} | #${i + 1} | Depuis: ${fromKm}km | Restant: ${km}km${wp.note ? ' | ' + escapeXML(wp.note) : ''}`;
        return [
          `<wpt lat="${wp.lat.toFixed(6)}" lon="${wp.lon.toFixed(6)}">`,
          `  <name>${name}</name>`,
          `  <desc>${desc}</desc>`,
          `  <sym>${garminSym(wp.type)}</sym>`,
          `  <type>${wp.type}</type>`,
          `</wpt>`,
        ].join('\n');
      })
      .join('\n');

    // Insert before </gpx>
    return originalText.replace('</gpx>', wptBlocks + '\n</gpx>');
  }

  // ── Detect climbs from elevation data ─────────────────────────────────────
  // Approach: smooth → find significant local min/max → each min→max = a climb
  function detectClimbs(points, opts = {}) {
    const MIN_GRADIENT  = opts.minGradient  || 2;    // pente moyenne minimum (%) — Garmin utilise ~2%
    const MIN_GAIN      = opts.minGain      || 20;   // D+ minimum (metres) — Garmin utilise ~20m
    const MIN_LENGTH    = opts.minLength    || 100;  // longueur minimum (metres) — comme Garmin
    const STEEP_PCT     = opts.steepPct     || 6;    // % local considéré comme raide (pas de min longueur)
    const SMOOTH_WINDOW = opts.smoothWindow || 12;   // fenêtre de lissage (réduite pour garder les montées courtes)
    const NOISE         = opts.noise        || 5;    // seuil de bruit (réduit pour ne pas fusionner les montées proches)

    if (!points.length || points[0].ele == null) return [];

    // 1. Smooth elevation — moving average
    const smoothed = points.map((pt, i) => {
      const half = Math.floor(SMOOTH_WINDOW / 2);
      const from = Math.max(0, i - half);
      const to   = Math.min(points.length - 1, i + half);
      let sum = 0, count = 0;
      for (let j = from; j <= to; j++) {
        if (points[j].ele != null) { sum += points[j].ele; count++; }
      }
      return count ? sum / count : pt.ele;
    });

    // 2. Find all local extrema (min/max turning points)
    //    A turning point is where direction changes from up→down or down→up
    const extrema = []; // { idx, ele, type: 'min'|'max' }
    extrema.push({ idx: 0, ele: smoothed[0], type: 'min' });

    let dir = 0; // 0=unknown, 1=up, -1=down
    for (let i = 1; i < smoothed.length; i++) {
      const diff = smoothed[i] - smoothed[i - 1];
      if (Math.abs(diff) < 0.01) continue; // flat, skip

      const newDir = diff > 0 ? 1 : -1;
      if (dir !== 0 && newDir !== dir) {
        // Direction changed — previous point is an extremum
        extrema.push({
          idx: i - 1,
          ele: smoothed[i - 1],
          type: dir > 0 ? 'max' : 'min',
        });
      }
      dir = newDir;
    }
    extrema.push({ idx: smoothed.length - 1, ele: smoothed[smoothed.length - 1], type: dir > 0 ? 'max' : 'min' });

    // 3. Filter out noise — remove extrema where the difference to neighbors < NOISE
    //    Classic "Ramer–Douglas–Peucker"-style pruning on elevation
    let filtered = [...extrema];
    let changed = true;
    while (changed) {
      changed = false;
      const next = [];
      for (let i = 0; i < filtered.length; i++) {
        if (i > 0 && i < filtered.length - 1) {
          const diffPrev = Math.abs(filtered[i].ele - filtered[i - 1].ele);
          const diffNext = Math.abs(filtered[i].ele - filtered[i + 1].ele);
          if (diffPrev < NOISE && diffNext < NOISE) {
            changed = true;
            continue; // remove this extremum — too small
          }
        }
        next.push(filtered[i]);
      }
      filtered = next;
    }

    // 4. Extract climbs from min→max pairs
    const climbs = [];
    for (let i = 0; i < filtered.length - 1; i++) {
      const a = filtered[i];
      const b = filtered[i + 1];

      // We want min → max (ascending)
      if (a.type !== 'min' || b.type !== 'max') continue;

      const gain   = b.ele - a.ele;
      const length = points[b.idx].dist - points[a.idx].dist;

      const gradient = length > 0 ? (gain / length) * 100 : 0;
      // Côte si : ≥2% moyenne + ≥20m D+ + ≥150m de long, OU ≥6% quelle que soit la longueur
      if ((gradient >= MIN_GRADIENT && gain >= MIN_GAIN && length >= MIN_LENGTH) || gradient >= STEEP_PCT) {
        climbs.push({
          startIdx: a.idx,
          endIdx:   b.idx,
          lat:      points[a.idx].lat,
          lon:      points[a.idx].lon,
          dist:     points[a.idx].dist,
          eleStart: Math.round(a.ele),
          eleEnd:   Math.round(b.ele),
          gain:     Math.round(gain),
          length:   Math.round(length),
          gradient: Math.round(gradient * 10) / 10,
        });
      }
    }

    return climbs;
  }

  return { parse, sample, stats, exportGPX, haversine, escapeXML, iconFor, detectClimbs };
})();

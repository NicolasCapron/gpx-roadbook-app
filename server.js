const express = require('express');
const path = require('path');
const fs = require('fs');

// ── Minimal zero-dependency .env loader ─────────────────────────────────────
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m || m[1].startsWith('#')) continue;
    const key = m[1];
    let val = (m[2] || '').trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Nominatim reverse-geocoding helper ───────────────────────────────────────
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'GPX-Roadbook-App/1.0 (nicolas.capron@gmail.com)';
const DELAY_MS = 1100;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&accept-language=fr&zoom=17&addressdetails=1`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (res.status === 429) {
      const backoff = 2000 * (attempt + 1);
      console.warn(`[geocode] 429 — retry in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      continue;
    }

    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();
    const addr = data.address || {};
    const commune = addr.village || addr.town || addr.city || addr.municipality || addr.hamlet || addr.suburb || data.name || 'Inconnu';
    return {
      name: commune,
      commune,
      road: addr.road || addr.pedestrian || addr.cycleway || addr.footway || addr.path || addr.residential || addr.living_street || addr.track || '',
      region: addr.state || addr.region || '',
      department: addr.county || addr.state_district || addr.province || '',
      cc: (addr.country_code || '').toUpperCase(),
    };
  }

  throw new Error(`Nominatim: 429 après ${MAX_RETRIES} tentatives`);
}

// ── Geocode endpoint (SSE stream) ────────────────────────────────────────────
// Accepts: { points: [{lat, lon}, ...] }
// Streams: data:{"name":"..."} per point, then closes
app.post('/api/geocode', async (req, res) => {
  const { points } = req.body;
  if (!Array.isArray(points) || !points.length) {
    return res.status(400).json({ error: 'points array required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  for (let i = 0; i < points.length; i++) {
    const { lat, lon } = points[i];
    let addr;
    try {
      addr = await reverseGeocode(Number(lat), Number(lon));
    } catch (err) {
      console.warn(`[geocode] point ${i}: ${err.message}`);
      addr = { name: 'Inconnu', commune: 'Inconnu', road: '', region: '', department: '', cc: '' };
      res.write(`data:${JSON.stringify({ error: err.message })}\n\n`);
    }
    res.write(`data:${JSON.stringify(addr)}\n\n`);
    if (i < points.length - 1) await sleep(DELAY_MS);
  }

  res.end();
});

// ── Strava OAuth + activities proxy (for public/stat-hunter/) ───────────────
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const TOKENS_PATH = path.join(__dirname, '.data', 'strava-tokens.json');

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) return null;

  if (tokens.expires_at > Math.floor(Date.now() / 1000) + 60) {
    return tokens.access_token;
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Strava refresh HTTP ${res.status}`);
  const refreshed = await res.json();
  refreshed.athlete = tokens.athlete; // preserved: refresh grant doesn't return it
  saveTokens(refreshed);
  return refreshed.access_token;
}

app.get('/stat-hunter/auth/strava', (req, res) => {
  if (!STRAVA_CLIENT_ID) return res.status(500).send('STRAVA_CLIENT_ID manquant côté serveur (.env)');
  const redirectUri = `${req.protocol}://${req.get('host')}/stat-hunter/auth/strava/callback`;
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', STRAVA_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'activity:read_all');
  res.redirect(url.toString());
});

app.get('/stat-hunter/auth/strava/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/stat-hunter/?error=${encodeURIComponent(error)}`);
  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`Strava token exchange HTTP ${tokenRes.status}`);
    const tokens = await tokenRes.json();
    saveTokens(tokens);
    res.redirect('/stat-hunter/');
  } catch (err) {
    console.error('[strava] auth callback failed:', err.message);
    res.redirect(`/stat-hunter/?error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/api/stat-hunter/status', (req, res) => {
  const tokens = loadTokens();
  res.json({ connected: !!tokens, athlete: tokens?.athlete || null });
});

app.post('/api/stat-hunter/logout', (req, res) => {
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
  res.json({ ok: true });
});

app.get('/api/stat-hunter/activities', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) return res.status(401).json({ error: 'not_connected' });

    const activities = [];
    const MAX_PAGES = 10; // 10 × 200 = 2000 activités max pour ce POC
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`Strava activities HTTP ${r.status}`);
      const batch = await r.json();
      if (!batch.length) break;
      for (const a of batch) {
        if (!a.map?.summary_polyline) continue;
        activities.push({
          id: a.id,
          name: a.name,
          type: a.type,
          distance: a.distance,
          start_date: a.start_date,
          polyline: a.map.summary_polyline,
        });
      }
      if (batch.length < 200) break;
    }
    res.json(activities);
  } catch (err) {
    console.error('[strava] activities fetch failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback → SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🗺️  GPX Roadbook App → http://localhost:${PORT}\n`);
});

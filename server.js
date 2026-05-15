const express = require('express');
const path = require('path');

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
  const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&accept-language=fr&zoom=14`;

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
    return addr.village || addr.town || addr.city || addr.municipality || addr.hamlet || data.name || 'Inconnu';
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
    let name;
    try {
      name = await reverseGeocode(Number(lat), Number(lon));
    } catch (err) {
      console.warn(`[geocode] point ${i}: ${err.message}`);
      name = 'Inconnu';
      res.write(`data:${JSON.stringify({ error: err.message })}\n\n`);
    }
    res.write(`data:${JSON.stringify({ name })}\n\n`);
    if (i < points.length - 1) await sleep(DELAY_MS);
  }

  res.end();
});

// ── Fallback → SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🗺️  GPX Roadbook App → http://localhost:${PORT}\n`);
});

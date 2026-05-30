# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server with watch (kills existing, http://localhost:3000)
npm start            # production start (no watch)
```

The project is hosted on OneDrive. The dev script uses `--watch-path=server.js --watch-path=public` (not `--watch`) to avoid restart loops from OneDrive sync. It also kills any existing node process on startup to prevent EADDRINUSE errors.

No test framework, no linter, no build step. All JS is vanilla browser globals loaded via `<script>` tags.

## Architecture

**SPA with Express backend.** The only server endpoint is `POST /api/geocode` which streams SSE responses from Nominatim (OpenStreetMap reverse geocoding). Everything else is client-side.

### Client modules (public/js/) — load order matters

1. **GPX** (`gpx.js`) — Pure data: parses GPX XML → point arrays, computes stats, detects climbs (ClimbPro-style), exports enriched GPX with `<wpt>` elements. No DOM access.
2. **MapManager** (`map.js`) — Leaflet wrapper: trace polyline (blue) with red climb overlays, waypoint markers with popups, click-to-place with snap-to-trace. `drawTrace(points, climbs)` accepts optional climbs array to color segments.
3. **Profile** (`profile.js`) — Canvas elevation profile with red gradient overlays on climb zones. Intensity proportional to gradient %.
4. **Roadbook** (`roadbook.js`) — Waypoint store (CRUD + `update`/`getById`/`restore`) + table rendering with edit (✎) and delete (✕) buttons + 20mm print strip. `onEdit(cb)` registers callback for edit button clicks. `buildFromGeocodeNames()` deduplicates consecutive communes, skips first (=depart), keeps last (=arrivee entry).
5. **Routes** (`routes.js`) — localStorage CRUD for saved routes. Stores `{rawGPX, waypoints, stats}` per route. Renders "Mes Parcours" list view with edit/export/delete actions.
6. **App** (`app.js`) — Main controller. Key state: `rawGPX`, `tracePoints`, `currentRouteId`, `currentFileName`. Core function `loadFromGPX(gpxText, fileName)` handles all GPX loading (file import + reset). View toggling between editor ↔ routes list. Modal supports both add (new waypoint) and edit (existing) modes via `editingId`/`pendingWP` state.

### Key data flow

- **Import GPX** → `loadFromGPX()` → `GPX.parse()` → auto-add depart/arrivee → `GPX.detectClimbs()` → add montee start + sommet for each climb → `MapManager.drawTrace(points, climbs)` + `Profile.draw(points, climbs)`
- **Reset** → calls `loadFromGPX(rawGPX, currentFileName)` to reload the original GPX fresh (depart, arrivee, climbs only). **New** → blank state, back to file import screen.
- **Geocode** → samples every 1km → streams SSE from `/api/geocode` → rebuilds communes + depart/arrivee with commune names. Preserves montees and custom points (`keep` filter excludes only `commune` type and auto `depart`/`arrivee`).
- **Export GPX** → `GPX.exportGPX(rawGPX, waypoints)` injects `<wpt>` before `</gpx>`. Names use text tags `#N [COM]`, `[MON]`, `[PAV]` etc. (no emojis) for Garmin compatibility.
- **Save/Load** → `Routes.save()` stores in localStorage. `Roadbook.restore()` rebuilds. `loadSavedRoute()` re-parses GPX, redetects climbs for profile/trace coloring, restores saved waypoints.

### Waypoint types

`commune`, `montee`, `pave`, `ravito`, `ruban`, `danger`, `controle`, `depart`, `arrivee`, `custom`. Each has: emoji icon (UI), Garmin `<sym>` symbol, GPX text tag (`[COM]`, `[MON]`...), CSS badge class (`.badge-montee`), map marker color, print strip background color.

Auto-generated waypoints have `auto: true`. Each detected climb produces two waypoints: start (`⛰️ Xm D+ (Y%)`) and end (`🏔️ Sommet (Z m)`).

### Climb detection (GPX.detectClimbs)

1. Smooth elevation with moving average (window=12)
2. Find all local min/max turning points
3. Iteratively prune extrema where amplitude < NOISE (5m)
4. Each min→max pair with gradient ≥2% + gain ≥20m + length ≥100m = climb. Also: ≥6% gradient regardless of length.

### Map trace coloring

`drawTrace(points, climbs)` draws trace in blue (#2563eb). Each climb segment is overlaid in red with intensity proportional to gradient (3%→orange-red, 12%→bright red). Start/end circles remain green/red.

### Print layout

`@media print` with `@page { size: 24mm 297mm }` shows only `#print-strip` — a 20mm vertical strip for bike frame stickers. Each cell: #num, km + remaining km, icon, name, note, distance to next. Type-specific background colors preserved via `print-color-adjust`.

### Static pages

- `tuto.html` — Garmin alerts tutorial (transfer methods, settings, FAQ, device compatibility)
- `guide-830.html` — Edge 830 roadbook screen setup guide with Garmin UI mockups

### Server: Nominatim rate limiting

Geocode processes points sequentially with 1.1s delay. On 429, retries with backoff (2s/4s/6s). On failure after 3 retries, returns "Inconnu" and continues streaming.

## Conventions

- French UI text throughout (toasts, labels, modal titles)
- Distances stored in metres, displayed as km (÷1000, 1 decimal)
- CSS custom properties in `:root` (colors, spacing, fonts)
- `.hidden` class (`display: none !important`) toggles visibility
- GPX export uses no emojis — text tags only (`[DEP]`, `[MON]`...) for Garmin device compatibility

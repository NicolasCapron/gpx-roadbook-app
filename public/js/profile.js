/* profile.js — elevation profile with climb highlighting + hover sync */

const Profile = (() => {

  let canvas, ctx;
  let overlay, octx;      // overlay canvas for cursor (avoids full redraw)
  let cachedPoints = [];
  let cachedClimbs = [];
  let totalDist = 0;

  // Coordinate mapping (set during draw, reused for hover)
  let _padding, _chartW, _chartH, _eleMin, _eleRange, _w, _h;
  let _hoverCb = null;      // callback(point | null)

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Create overlay canvas for cursor
    overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(overlay);
    octx = overlay.getContext('2d');

    window.addEventListener('resize', () => { if (cachedPoints.length) draw(cachedPoints, cachedClimbs); });

    // ── Mouse hover on profile ──
    canvas.addEventListener('mousemove', _onMouseMove);
    canvas.addEventListener('mouseleave', _onMouseLeave);
  }

  function onHover(cb) { _hoverCb = cb; }

  function _onMouseMove(e) {
    if (!cachedPoints.length || !_chartW) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    // Convert pixel → distance
    const dist = ((mx - _padding.left) / _chartW) * totalDist;
    if (dist < 0 || dist > totalDist) { _onMouseLeave(); return; }

    const pt = _findClosestPoint(dist);
    if (!pt) return;

    _drawCursor(pt);
    if (_hoverCb) _hoverCb(pt);
  }

  function _onMouseLeave() {
    if (!cachedPoints.length) return;
    _clearOverlay();
    if (_hoverCb) _hoverCb(null);
  }

  // Called from outside (map hover) to show cursor at given distance
  function showCursor(dist) {
    if (!cachedPoints.length || dist == null) { hideCursor(); return; }
    const pt = _findClosestPoint(dist);
    if (pt) _drawCursor(pt);
  }

  function hideCursor() {
    _clearOverlay();
  }

  function _findClosestPoint(dist) {
    if (!cachedPoints.length) return null;
    // Binary search for closest point by distance
    let lo = 0, hi = cachedPoints.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cachedPoints[mid].dist < dist) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    if (idx > 0 && Math.abs(cachedPoints[idx - 1].dist - dist) < Math.abs(cachedPoints[idx].dist - dist)) {
      return cachedPoints[idx - 1];
    }
    return cachedPoints[idx];
  }

  function _clearOverlay() {
    if (octx && overlay) octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function _drawCursor(pt) {
    if (!pt || pt.ele == null || !octx) return;

    // Sync overlay size
    const dpr = window.devicePixelRatio || 1;
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      overlay.style.width = _w + 'px';
      overlay.style.height = _h + 'px';
    }

    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const px = _padding.left + (pt.dist / totalDist) * _chartW;
    const py = _padding.top + _chartH - ((pt.ele - _eleMin) / _eleRange) * _chartH;

    // Vertical line
    octx.save();
    octx.setLineDash([4, 3]);
    octx.strokeStyle = '#e65100';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(px, _padding.top);
    octx.lineTo(px, _padding.top + _chartH);
    octx.stroke();
    octx.setLineDash([]);

    // Dot
    octx.beginPath();
    octx.arc(px, py, 4.5, 0, Math.PI * 2);
    octx.fillStyle = '#e65100';
    octx.fill();
    octx.strokeStyle = 'white';
    octx.lineWidth = 1.5;
    octx.stroke();

    // Tooltip
    const km = (pt.dist / 1000).toFixed(1);
    const ele = Math.round(pt.ele);
    const text = `${km} km · ${ele} m`;
    octx.font = 'bold 10px system-ui';
    const tw = octx.measureText(text).width + 10;
    let tx = px - tw / 2;
    if (tx < _padding.left) tx = _padding.left;
    if (tx + tw > _w - _padding.right) tx = _w - _padding.right - tw;
    let ty = py - 16;
    if (ty < _padding.top + 2) ty = py + 18; // flip below if too high

    octx.fillStyle = 'rgba(30, 30, 30, 0.88)';
    octx.beginPath();
    octx.roundRect(tx, ty - 11, tw, 16, 3);
    octx.fill();

    octx.fillStyle = 'white';
    octx.textAlign = 'left';
    octx.fillText(text, tx + 5, ty + 1);
    octx.restore();
  }

  function draw(points, climbs) {
    if (!canvas || !ctx || !points.length) return;
    cachedPoints = points;
    cachedClimbs = climbs || [];

    // Resize canvas to container
    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute bounds — store for hover reuse
    _padding = { top: 14, bottom: 20, left: 40, right: 10 };
    const padding = _padding;
    _w = w; _h = h;
    _chartW = w - padding.left - padding.right;
    _chartH = h - padding.top - padding.bottom;
    const chartW = _chartW;
    const chartH = _chartH;

    const elevations = points.filter(p => p.ele != null).map(p => p.ele);
    if (!elevations.length) return;

    _eleMin = Math.floor(Math.min(...elevations) / 10) * 10;
    const eleMax = Math.ceil(Math.max(...elevations) / 10) * 10;
    _eleRange = Math.max(eleMax - _eleMin, 10);
    const eleMin = _eleMin;
    const eleRange = _eleRange;
    totalDist = points[points.length - 1].dist;

    function x(dist) { return padding.left + (dist / totalDist) * chartW; }
    function y(ele) { return padding.top + chartH - ((ele - eleMin) / eleRange) * chartH; }

    // Clear
    ctx.clearRect(0, 0, w, h);
    _clearOverlay();

    // ── Grid lines & labels ──
    ctx.strokeStyle = '#e4e1dd';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#9e9a96';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'right';

    const eleStep = eleRange <= 100 ? 20 : eleRange <= 300 ? 50 : 100;
    for (let e = eleMin; e <= eleMax; e += eleStep) {
      const yy = y(e);
      ctx.beginPath();
      ctx.moveTo(padding.left, yy);
      ctx.lineTo(w - padding.right, yy);
      ctx.stroke();
      ctx.fillText(e + 'm', padding.left - 4, yy + 3);
    }

    // Distance labels
    ctx.textAlign = 'center';
    const distStep = totalDist <= 50000 ? 10000 : totalDist <= 150000 ? 20000 : 50000;
    for (let d = 0; d <= totalDist; d += distStep) {
      const xx = x(d);
      ctx.fillText((d / 1000).toFixed(0) + 'km', xx, h - 4);
    }

    // ── Climb zones (red gradient fills) ──
    cachedClimbs.forEach(climb => {
      const x1 = x(points[climb.startIdx].dist);
      const x2 = x(points[climb.endIdx].dist);

      // Gradient intensity based on gradient %
      const intensity = Math.min(climb.gradient / 12, 1); // 12% = max red
      const alpha = 0.15 + intensity * 0.4;

      // Draw filled area for climb zone
      ctx.beginPath();
      ctx.moveTo(x1, y(0) > padding.top + chartH ? padding.top + chartH : y(eleMin));

      for (let i = climb.startIdx; i <= climb.endIdx; i++) {
        if (points[i].ele != null) {
          ctx.lineTo(x(points[i].dist), y(points[i].ele));
        }
      }

      ctx.lineTo(x2, padding.top + chartH);
      ctx.lineTo(x1, padding.top + chartH);
      ctx.closePath();

      // Red gradient fill
      const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
      grad.addColorStop(0, `rgba(220, 38, 38, ${alpha})`);
      grad.addColorStop(1, `rgba(220, 38, 38, ${alpha * 0.3})`);
      ctx.fillStyle = grad;
      ctx.fill();

      // Climb label
      if (x2 - x1 > 30) {
        ctx.fillStyle = `rgba(180, 20, 20, ${0.5 + intensity * 0.5})`;
        ctx.font = 'bold 8px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(climb.gradient + '%', (x1 + x2) / 2, y(points[climb.endIdx].ele) - 4);
      }
    });

    // ── Elevation line ──
    ctx.beginPath();
    ctx.strokeStyle = '#6b6763';
    ctx.lineWidth = 1.2;
    let started = false;
    for (const pt of points) {
      if (pt.ele == null) continue;
      const px = x(pt.dist);
      const py = y(pt.ele);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // ── Filled area under curve ──
    ctx.lineTo(x(points[points.length - 1].dist), padding.top + chartH);
    ctx.lineTo(x(points[0].dist), padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(107, 103, 99, 0.08)';
    ctx.fill();
  }

  function clear() {
    cachedPoints = [];
    cachedClimbs = [];
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    _clearOverlay();
  }

  return { init, draw, clear, onHover, showCursor, hideCursor };
})();

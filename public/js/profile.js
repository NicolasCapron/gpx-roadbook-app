/* profile.js — elevation profile with climb highlighting */

const Profile = (() => {

  let canvas, ctx;
  let cachedPoints = [];
  let cachedClimbs = [];
  let totalDist = 0;

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', () => { if (cachedPoints.length) draw(cachedPoints, cachedClimbs); });
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

    // Compute bounds
    const padding = { top: 14, bottom: 20, left: 40, right: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const elevations = points.filter(p => p.ele != null).map(p => p.ele);
    if (!elevations.length) return;

    const eleMin = Math.floor(Math.min(...elevations) / 10) * 10;
    const eleMax = Math.ceil(Math.max(...elevations) / 10) * 10;
    const eleRange = Math.max(eleMax - eleMin, 10);
    totalDist = points[points.length - 1].dist;

    function x(dist) { return padding.left + (dist / totalDist) * chartW; }
    function y(ele) { return padding.top + chartH - ((ele - eleMin) / eleRange) * chartH; }

    // Clear
    ctx.clearRect(0, 0, w, h);

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
  }

  return { init, draw, clear };
})();

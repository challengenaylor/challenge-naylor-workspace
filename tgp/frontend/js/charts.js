/* ==========================================================================
   TGP.charts — small canvas-based chart primitives. Deliberately dependency-
   free: a CDN chart library would silently fail if this file is opened
   without an internet connection, which defeats "must run locally".
   ========================================================================== */
(function (global) {
  'use strict';

  function sizeCanvasToContainer(canvas, cssHeight) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.max(1, global.devicePixelRatio || 1);
    const cssWidth = Math.max(240, rect.width);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: cssWidth, height: cssHeight };
  }

  function niceStep(range, targetTicks) {
    const raw = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return step * mag;
  }

  /**
   * LineChart — one or more named series sharing a common set of x labels.
   * A null value at an index means "no data at that point"; the line breaks
   * there rather than interpolating across a gap (a gap is real information —
   * e.g. Gull has no Wiri history — and must not be drawn as a smooth line).
   */
  function LineChart(canvas) {
    this.canvas = canvas;
    this.labels = [];
    this.series = [];
    this.yFormat = (v) => v.toFixed(0);
    this.height = 260;
    this._onResize = this.render.bind(this);
    global.addEventListener('resize', this._onResize);
  }

  LineChart.prototype.setData = function (labels, series, opts) {
    this.labels = labels;
    this.series = series;
    if (opts && opts.yFormat) this.yFormat = opts.yFormat;
    if (opts && opts.height) this.height = opts.height;
    return this;
  };

  LineChart.prototype.destroy = function () {
    global.removeEventListener('resize', this._onResize);
  };

  LineChart.prototype.render = function () {
    const { ctx, width, height } = sizeCanvasToContainer(this.canvas, this.height);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--ink').trim() || '#16211c';
    const line = style.getPropertyValue('--line').trim() || '#c9d1c7';
    const muted = style.getPropertyValue('--muted').trim() || '#5b6b61';

    const padL = 54, padR = 16, padT = 16, padB = 44;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, height - padT - padB);

    const allVals = [];
    this.series.forEach((s) => s.data.forEach((v) => { if (v !== null && v !== undefined) allVals.push(v); }));
    if (!allVals.length) {
      ctx.fillStyle = muted;
      ctx.font = '13px "IBM Plex Mono", monospace';
      ctx.fillText('No data for this selection.', padL, padT + plotH / 2);
      this._legend([]);
      return;
    }

    let min = Math.min(...allVals), max = Math.max(...allVals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    min -= pad; max += pad;
    const step = niceStep(max - min, 5);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;

    const xFor = (i) => padL + (this.labels.length <= 1 ? plotW / 2 : (i / (this.labels.length - 1)) * plotW);
    const yFor = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

    // gridlines + y labels
    ctx.strokeStyle = line; ctx.fillStyle = muted;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = min; v <= max + 1e-9; v += step) {
      const y = yFor(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillText(this.yFormat(v), padL - 8, y);
    }

    // x labels (thin out to avoid clutter)
    const maxLabels = Math.max(3, Math.floor(plotW / 78));
    const strideX = Math.max(1, Math.ceil(this.labels.length / maxLabels));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    this.labels.forEach((lab, i) => {
      if (i % strideX !== 0 && i !== this.labels.length - 1) return;
      ctx.fillText(lab, xFor(i), padT + plotH + 10);
    });

    // axis baseline
    ctx.strokeStyle = ink;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.lineWidth = 1.2; ctx.stroke();

    // series lines
    this.series.forEach((s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      let started = false;
      ctx.beginPath();
      s.data.forEach((v, i) => {
        if (v === null || v === undefined) { started = false; return; }
        const x = xFor(i), y = yFor(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      });
      ctx.stroke();
    });

    this._legend(this.series);
  };

  LineChart.prototype._legend = function (series) {
    let el = this.canvas.parentElement.querySelector('.tgp-legend');
    if (!el) {
      el = document.createElement('div');
      el.className = 'tgp-legend';
      this.canvas.parentElement.appendChild(el);
    }
    el.innerHTML = series.map((s) =>
      `<span class="tgp-legend-item"><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('');
  };

  /**
   * Gauge — semicircular pressure indicator, score in [-1, 1].
   * -1 = full downward pressure (left, green zone), 0 = neutral (top),
   * +1 = full upward pressure (right, amber/red zone). This is the page's
   * signature element: it reads like an instrument on a terminal gate
   * control panel, which is literally the subject of the dashboard.
   */
  function Gauge(canvas) {
    this.canvas = canvas;
    this.score = 0;
    this.label = 'INSUFFICIENT DATA';
    this._onResize = this.render.bind(this);
    global.addEventListener('resize', this._onResize);
  }

  Gauge.prototype.setValue = function (score, label) {
    this.score = Math.max(-1, Math.min(1, score));
    this.label = label;
    return this;
  };

  Gauge.prototype.destroy = function () { global.removeEventListener('resize', this._onResize); };

  Gauge.prototype.render = function () {
    const cssHeight = 190;
    const { ctx, width, height } = sizeCanvasToContainer(this.canvas, cssHeight);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--ink').trim() || '#16211c';
    const line = style.getPropertyValue('--line').trim() || '#c9d1c7';
    const down = style.getPropertyValue('--success').trim() || '#1c7a4c';
    const up = style.getPropertyValue('--danger').trim() || '#a1311f';
    const muted = style.getPropertyValue('--muted').trim() || '#5b6b61';

    const cx = width / 2, cy = height - 34, r = Math.min(width / 2 - 24, 118);

    // arc track: left(down,green,PI) -> right(up,red,0)
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, down); grad.addColorStop(0.5, muted); grad.addColorStop(1, up);
    ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.strokeStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke();

    // ticks
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      const x1 = cx + Math.cos(a) * (r - 10), y1 = cy + Math.sin(a) * (r - 10);
      const x2 = cx + Math.cos(a) * (r + 10), y2 = cy + Math.sin(a) * (r + 10);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // needle
    const angle = Math.PI + ((this.score + 1) / 2) * Math.PI;
    const nx = cx + Math.cos(angle) * (r - 22), ny = cy + Math.sin(angle) * (r - 22);
    ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nx, ny); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();

    // end labels
    ctx.fillStyle = muted; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText('DOWNWARD', cx - r - 4, cy + 20);
    ctx.textAlign = 'right'; ctx.fillText('UPWARD', cx + r + 4, cy + 20);
    ctx.textAlign = 'center'; ctx.fillText('NEUTRAL', cx, cy - r - 6);

    // state label
    ctx.fillStyle = ink; ctx.font = '600 15px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(this.label, cx, cy + 34);
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  global.TGP = global.TGP || {};
  global.TGP.charts = { LineChart, Gauge };
}(window));

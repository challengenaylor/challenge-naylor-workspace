/* ==========================================================================
   TGP app — wires config/data/calc/storage/charts into the DOM.
   Nothing here talks to localStorage or does math directly; it calls into
   TGP.storage and TGP.calc so those stay swappable later.
   ========================================================================== */
(function () {
  'use strict';

  const { config, data, lookup } = window.TGP;
  const calc = window.TGP.calc;
  const storage = window.TGP.storage;
  const charts = window.TGP.charts;

  const activeRegions = config.regions.filter((r) => r.active);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-NZ', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short' });
  }
  function cpl(v) { return typeof v === 'number' ? v.toFixed(2) : '—'; }
  // Dollars-per-litre display — what you asked for: $2.9310 instead of
  // 293.10. Converts the underlying cents-per-litre value; nothing about
  // how prices are stored or calculated changes, only how they're shown.
  function dpl(v) {
    if (typeof v !== 'number') return '—';
    const dollars = v / 100;
    return (dollars < 0 ? '-$' : '$') + Math.abs(dollars).toFixed(4);
  }
  function pct(v) { return typeof v === 'number' ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—'; }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function fillOptions(select, items, { value, label, includeAll, allLabel } = {}) {
    const cur = select.value;
    select.innerHTML = (includeAll ? `<option value="">${esc(allLabel || 'All')}</option>` : '')
      + items.map((it) => `<option value="${esc(value(it))}">${esc(label(it))}</option>`).join('');
    if ([...select.options].some((o) => o.value === cur)) select.value = cur;
  }

  // ---------------------------------------------------------------- tabs
  els('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      els('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      els('.panel').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.panel; });
      // Charts need a real layout width to size against — render on reveal.
      if (tab.dataset.panel === 'history') historyChart && historyChart.render();
      if (tab.dataset.panel === 'market') { gauge && gauge.render(); aipChart && aipChart.render(); }
    });
  });

  // ============================================================== OVERVIEW
  function populateOverviewFilters() {
    const select = el('#f-region');
    const inactiveRegions = config.regions.filter((r) => !r.active);
    select.innerHTML = `<option value="">Active terminals (Wiri, Mount Maunganui)</option>`
      + `<option value="__ALL__">All terminals</option>`
      + `<optgroup label="Active">` + activeRegions.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('') + `</optgroup>`
      + `<optgroup label="Other terminals suppliers publish">` + inactiveRegions.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('') + `</optgroup>`;
    fillOptions(el('#f-product'), config.products, { value: (p) => p.id, label: (p) => p.label, includeAll: true, allLabel: 'All products' });
    fillOptions(el('#f-supplier'), config.suppliers, { value: (s) => s.id, label: (s) => s.name, includeAll: true, allLabel: 'All suppliers' });
  }

  function overviewFilters() {
    return {
      regionId: el('#f-region').value, productId: el('#f-product').value,
      supplierId: el('#f-supplier').value, direction: el('#f-direction').value,
      search: el('#f-search').value.trim(),
    };
  }

  function renderOverview() {
    const f = overviewFilters();
    // "" (the default) means active-terminals-only; "__ALL__" means no
    // region restriction at all; anything else is one specific terminal.
    let base = data.currentPrices;
    if (f.regionId === '') {
      const activeIds = new Set(activeRegions.map((r) => r.id));
      base = base.filter((r) => activeIds.has(r.regionId));
    } else if (f.regionId !== '__ALL__') {
      base = base.filter((r) => r.regionId === f.regionId);
    }

    const rows = calc.filterRecords(base, Object.assign({}, f, { regionId: '' }))
      .sort((a, b) => a.regionLabel.localeCompare(b.regionLabel) || a.productName.localeCompare(b.productName) || a.supplierName.localeCompare(b.supplierName));

    el('#overview-count').textContent = `${rows.length} of ${data.currentPrices.length} prices shown`;

    const tbody = el('#overview-rows');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">No prices match these filters.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((r) => {
      const dirClass = 'dir-' + r.direction.toLowerCase();
      const arrow = calc.directionArrow(r.direction);
      const changeTxt = r.direction === 'NEW' ? 'first capture' : (typeof r.change === 'number' ? `${arrow} ${dpl(Math.abs(r.change))}` : '—');
      const gstTxt = r.gstStatus === 'included' ? 'Incl. GST' : r.gstStatus === 'excluded' ? 'Excl. GST' : `<span class="pill warn">${esc(r.gstStatus)}</span>`;
      const extractionPill = r.extractionMethod === 'PDF_COORDINATE'
        ? '<span class="pill info" title="Resolved via x/y coordinate extraction, not left-to-right text order">coordinate</span>'
        : r.extractionMethod === 'HTML_TABLE'
          ? '<span class="pill">html table</span>'
          : '<span class="pill">text</span>';

      return `<tr>
        <td>${esc(r.supplierName)}</td>
        <td>${esc(r.regionLabel)}<div class="sub-cell">${esc(r.terminalName)}</div></td>
        <td>${esc(r.productName)}</td>
        <td class="num">${dpl(r.currentValue)}</td>
        <td class="num" style="color:var(--muted)">${dpl(r.previousValue)}</td>
        <td class="num ${dirClass}">${changeTxt}</td>
        <td class="num ${dirClass}">${pct(r.changePct)}</td>
        <td>${fmtDate(r.effectiveDate)}</td>
        <td>${gstTxt}</td>
        <td>${extractionPill}</td>
        <td><a class="src-link" href="${esc(r.sourceDocumentUrl)}" target="_blank" rel="noopener">Source ↗</a></td>
      </tr>`;
    }).join('');
  }

  ['f-region', 'f-product', 'f-supplier', 'f-direction'].forEach((id) => el('#' + id).addEventListener('change', renderOverview));
  el('#f-search').addEventListener('input', debounce(renderOverview, 120));
  el('#f-clear').addEventListener('click', () => {
    ['f-region', 'f-product', 'f-supplier', 'f-direction'].forEach((id) => { el('#' + id).value = ''; });
    el('#f-search').value = '';
    renderOverview();
  });

  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ---------------------------------------------------------------- KPI strip
  function renderKpis() {
    const strip = el('#kpi-strip');
    const cards = [];

    activeRegions.forEach((region) => {
      const dieselRows = data.currentPrices.filter((r) => r.regionId === region.id && r.productId === 'DIESEL');
      if (!dieselRows.length) return;
      const lowest = dieselRows.reduce((a, b) => (a.currentValue < b.currentValue ? a : b));
      cards.push(`<div class="kpi">
        <div class="lbl">${esc(region.label)} · lowest diesel</div>
        <div class="val">${dpl(lowest.currentValue)}/L</div>
        <div class="meta">${esc(lowest.supplierName)} · ${fmtDate(lowest.effectiveDate)}</div>
      </div>`);
    });

    const md = calc.marketDirection(data.aipPrices, data.currentPrices);
    cards.push(`<div class="kpi">
      <div class="lbl">NZ market direction</div>
      <div class="val" style="font-size:1.1rem">${esc(md.state.replace('_', ' '))}</div>
      <div class="meta">See Market direction tab for methodology</div>
    </div>`);

    const reviewCount = data.errors.filter((e) => e.status === 'Needs Review').length;
    cards.push(`<div class="kpi">
      <div class="lbl">Needing review</div>
      <div class="val" style="color:${reviewCount ? 'var(--warn)' : 'var(--success)'}">${reviewCount}</div>
      <div class="meta">Open items in Automation &amp; errors</div>
    </div>`);

    strip.innerHTML = cards.join('');
  }

  function renderReviewBanner() {
    const banner = el('#review-banner');
    const needsReview = data.errors.filter((e) => e.status === 'Needs Review');
    if (!needsReview.length) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = `<span>⚠</span><span><strong>${needsReview.length} item${needsReview.length > 1 ? 's' : ''} need review.</strong> `
      + needsReview.map((e) => esc(e.message)).join(' ') + ' See Automation &amp; errors.</span>';
  }

  // ============================================================== HISTORY
  let historyChart;

  function populateHistoryFilters() {
    fillOptions(el('#h-region'), activeRegions, { value: (r) => r.id, label: (r) => r.label });
    fillOptions(el('#h-product'), config.products, { value: (p) => p.id, label: (p) => p.label });
    el('#h-suppliers').innerHTML = config.suppliers.map((s) => `
      <label style="flex-direction:row;align-items:center;gap:5px;text-transform:none;font-size:.82rem;color:var(--ink)">
        <input type="checkbox" class="h-supplier-cb" value="${esc(s.id)}" checked> ${esc(s.name)}
      </label>`).join('');
  }

  function historyRangeDays() {
    const v = el('#h-range').value;
    return v === 'all' ? Infinity : Number(v);
  }

  function renderHistory() {
    const regionId = el('#h-region').value;
    const productId = el('#h-product').value;
    const supplierIds = els('.h-supplier-cb').filter((cb) => cb.checked).map((cb) => cb.value);
    const days = historyRangeDays();

    const region = lookup.regionById[regionId];
    const product = lookup.productById[productId];
    el('#history-title').textContent = `${product ? product.label : 'Product'} — ${region ? region.label : 'Terminal'}`;

    const points = data.priceHistory.filter((p) => p.regionId === regionId && p.productId === productId && supplierIds.includes(p.supplierId));
    const allDates = [...new Set(points.map((p) => p.effectiveDate))].sort();
    const cutoff = Number.isFinite(days) ? allDates[allDates.length - 1] : null;
    const cutoffDate = cutoff ? new Date(new Date(cutoff).getTime() - days * 86400000) : null;
    const labels = cutoffDate ? allDates.filter((d) => new Date(d) >= cutoffDate) : allDates;

    const series = supplierIds
      .filter((sid) => !config.availability || (config.availability[sid] && config.availability[sid][regionId] && config.availability[sid][regionId].includes(productId)))
      .map((sid) => {
        const s = lookup.supplierById[sid];
        const bySeriesDate = {};
        points.filter((p) => p.supplierId === sid).forEach((p) => { bySeriesDate[p.effectiveDate] = p.value; });
        return { name: s.name, color: s.color, data: labels.map((d) => (bySeriesDate[d] !== undefined ? bySeriesDate[d] : null)) };
      });

    if (!historyChart) historyChart = new charts.LineChart(el('#history-canvas'));
    historyChart.setData(labels.map((d) => fmtDate(d)), series, { yFormat: (v) => v.toFixed(0) }).render();
  }

  ['h-range', 'h-region', 'h-product'].forEach((id) => el('#' + id).addEventListener('change', renderHistory));
  document.addEventListener('change', (e) => { if (e.target.classList.contains('h-supplier-cb')) renderHistory(); });

  // ============================================================== MARKET
  let gauge, aipChart;

  function renderMarket() {
    const md = calc.marketDirection(data.aipPrices, data.currentPrices);

    if (!gauge) gauge = new charts.Gauge(el('#gauge-canvas'));
    gauge.setValue(md.score, md.state.replace('_', ' ')).render();

    el('#market-confidence').textContent = md.state === 'INSUFFICIENT_DATA'
      ? 'Not enough AIP history yet to report a direction.'
      : md.confidence;
    el('#market-methodology').textContent = md.methodology;

    if (md.signals) {
      el('#sig-aip5').textContent = pct(md.signals.aip5pct);
      el('#sig-aip10').textContent = pct(md.signals.aip10pct);
      el('#sig-nz').textContent = md.signals.nzAvgPct === null ? 'no data' : pct(md.signals.nzAvgPct);
    } else {
      ['#sig-aip5', '#sig-aip10', '#sig-nz'].forEach((s) => { el(s).textContent = '—'; });
    }

    const labels = data.aipPrices.map((p) => fmtDate(p.date));
    if (!aipChart) aipChart = new charts.LineChart(el('#aip-canvas'));
    aipChart.setData(labels, [
      { name: 'AIP — ULP (91-equiv)', color: '#0f6659', data: data.aipPrices.map((p) => p.ulp) },
      { name: 'AIP — Diesel', color: '#a1311f', data: data.aipPrices.map((p) => p.diesel) },
    ], { yFormat: (v) => v.toFixed(0) }).render();

    const kpiBox = el('#aip-kpis');
    if (!data.aipPrices.length) {
      kpiBox.innerHTML = `<p class="empty">No AIP data collected yet — this connector isn't finished. See the note below.</p>`;
    } else {
      const last = data.aipPrices[data.aipPrices.length - 1];
      const first = data.aipPrices[0];
      kpiBox.innerHTML = `
        <div class="compare-chip"><div class="lbl">Latest ULP</div><div class="val">${cpl(last.ulp)} AUc/L</div></div>
        <div class="compare-chip"><div class="lbl">Latest Diesel</div><div class="val">${cpl(last.diesel)} AUc/L</div></div>
        <div class="compare-chip"><div class="lbl">As at</div><div class="val" style="font-size:.95rem">${fmtDate(last.date)}</div></div>
        <div class="compare-chip"><div class="lbl">Series start</div><div class="val" style="font-size:.95rem">${fmtDate(first.date)}</div></div>`;
    }
  }

  // ============================================================== CHALLENGE
  // NZ GST rate — used to compute the GST-inclusive Challenge price from
  // what you actually pay before tax, so it's directly comparable to
  // competitor prices (which are always shown GST-inclusive, as published).
  const GST_RATE = 0.15;
  // Levies (ETS, PEFML, ACC, NLTF, LAFT, RFT) already sitting inside the
  // price you pay — shown as a separate reference line, not derived from
  // anywhere; it's the figure you gave me, and it'll need updating by hand
  // if government levy rates change.
  const LEVIES_PER_LITRE_DOLLARS = 0.0687;

  function populateChallengeFilters() {
    fillOptions(el('#cf-region'), activeRegions, { value: (r) => r.id, label: (r) => r.label });
    fillOptions(el('#cf-product'), config.products, { value: (p) => p.id, label: (p) => p.label });
  }

  function resetChallengeForm() {
    el('#challenge-form').reset();
    el('#cf-preview').hidden = true;
  }

  function updateChallengePreview() {
    const preGst = Number(el('#cf-price').value);
    const box = el('#cf-preview');
    if (!Number.isFinite(preGst) || preGst <= 0) { box.hidden = true; return; }
    const final = preGst * (1 + GST_RATE);
    box.hidden = false;
    el('#cf-preview-pre').textContent = '$' + preGst.toFixed(4);
    el('#cf-preview-final').textContent = '$' + final.toFixed(4);
    el('#cf-preview-levy').textContent = '$' + LEVIES_PER_LITRE_DOLLARS.toFixed(4);
  }
  el('#cf-price').addEventListener('input', updateChallengePreview);

  // Corrections are keyed by the id they correct, so both the original row
  // and its correction render together instead of the correction looking
  // like an unrelated new entry.
  async function renderChallenge() {
    const list = await storage.getChallengePrices();
    const byCorrectionOf = {};
    list.forEach((c) => { if (c.correctionOf) (byCorrectionOf[c.correctionOf] = byCorrectionOf[c.correctionOf] || []).push(c); });
    const originals = list.filter((c) => !c.correctionOf);

    // Resolve each original entry to its DISPLAYED value — the latest
    // correction if one exists, otherwise the entry itself.
    const effective = originals.map((c) => {
      const corrections = byCorrectionOf[c.id] || [];
      const latestCorrection = corrections.length ? corrections[corrections.length - 1] : null;
      return {
        id: c.id, regionId: c.regionId, productId: c.productId,
        effectiveDate: c.effectiveDate, enteredAt: c.enteredAt, notes: c.notes,
        finalPrice: latestCorrection ? latestCorrection.finalPrice : c.finalPrice,
        preGstPrice: latestCorrection ? latestCorrection.preGstPrice : c.preGstPrice,
        wasCorrected: !!latestCorrection,
        correctionReason: latestCorrection ? latestCorrection.correctionReason : null,
        originalFinalPrice: c.finalPrice,
      };
    });

    // Group by terminal+product — this is the comparison unit: "how has
    // Mount Maunganui Diesel moved from one entry to the next", not a flat
    // list of every entry ever made.
    const groups = {};
    effective.forEach((e) => {
      const key = e.regionId + '::' + e.productId;
      (groups[key] = groups[key] || []).push(e);
    });
    Object.values(groups).forEach((g) => g.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.enteredAt.localeCompare(a.enteredAt)));

    const tbody = el('#challenge-rows');
    const groupList = Object.entries(groups).sort(([, a], [, b]) => b[0].effectiveDate.localeCompare(a[0].effectiveDate));

    // Levies are stored on the entry itself in cents (LEVIES_PER_LITRE_DOLLARS
    // * 100), subtracted from the pre-GST price you entered — this is the
    // one place that math needs to happen for display, not stored per-entry,
    // since the levy figure itself is a single known constant, not something
    // extracted per price.
    const beforeLevies = (e) => (typeof e.preGstPrice === 'number' ? e.preGstPrice - LEVIES_PER_LITRE_DOLLARS * 100 : null);

    if (!groupList.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty">No Challenge prices entered yet. Use the form above.</td></tr>';
    } else {
      tbody.innerHTML = groupList.map(([key, entries]) => {
        const latest = entries[0];
        const previous = entries[1] || null;
        const region = lookup.regionById[latest.regionId], product = lookup.productById[latest.productId];

        const change = previous ? +(latest.finalPrice - previous.finalPrice).toFixed(4) : null;
        const dirClass = change === null ? 'dir-flat' : change > 0 ? 'dir-up' : change < 0 ? 'dir-down' : 'dir-flat';
        const arrow = change === null ? '' : change > 0 ? '▲' : change < 0 ? '▼' : '→';
        const changeText = change === null ? 'first entry' : `${arrow} ${dpl(Math.abs(change))}`;
        const correctionNote = latest.wasCorrected
          ? `<div class="sub-cell">Corrected from ${dpl(latest.originalFinalPrice)} — "${esc(latest.correctionReason)}"</div>` : '';
        const historyCount = entries.length - 1;
        const latestBeforeLevies = beforeLevies(latest);

        return `<tr data-id="${esc(latest.id)}" data-key="${esc(key)}">
          <td>${esc(region ? region.label : latest.regionId)}</td>
          <td>${esc(product ? product.label : latest.productId)}</td>
          <td class="num-center">${latestBeforeLevies !== null ? dpl(latestBeforeLevies) : '—'}</td>
          <td class="num-center">${typeof latest.preGstPrice === 'number' ? dpl(latest.preGstPrice) : '—'}</td>
          <td class="num-center">${dpl(latest.finalPrice)}${correctionNote}</td>
          <td class="num ${dirClass}">${changeText}</td>
          <td>${fmtDate(latest.effectiveDate)}</td>
          <td>${fmtDateTime(latest.enteredAt)}</td>
          <td class="sub-cell">${esc(latest.notes || '—')}</td>
          <td style="white-space:nowrap">
            <button class="btn ghost cp-correct" style="padding:4px 8px;font-size:.72rem">Correct…</button>
            ${historyCount > 0 ? `<button class="btn ghost cp-history-toggle" style="padding:4px 8px;font-size:.72rem" data-key="${esc(key)}">History (${historyCount})</button>` : ''}
          </td>
        </tr>
        <tr class="cp-history-row" data-key="${esc(key)}" hidden>
          <td colspan="10" style="background:var(--surface-2);padding:10px 12px 14px 30px">
            <table class="t" style="font-size:.82rem">
              <thead><tr>
                <th class="num-center">Before levies</th><th class="num-center">After levies</th><th class="num-center">Final (incl. GST)</th>
                <th>Effective</th><th>Entered</th><th>Notes</th>
              </tr></thead>
              <tbody>
                ${entries.slice(1).map((e) => { const bl = beforeLevies(e); return `<tr>
                  <td class="num-center">${bl !== null ? dpl(bl) : '—'}</td>
                  <td class="num-center">${typeof e.preGstPrice === 'number' ? dpl(e.preGstPrice) : '—'}</td>
                  <td class="num-center">${dpl(e.finalPrice)}${e.wasCorrected ? `<div class="sub-cell">was ${dpl(e.originalFinalPrice)}, corrected</div>` : ''}</td>
                  <td>${fmtDate(e.effectiveDate)}</td>
                  <td>${fmtDateTime(e.enteredAt)}</td>
                  <td class="sub-cell">${esc(e.notes || '—')}</td>
                </tr>`; }).join('')}
              </tbody>
            </table>
          </td>
        </tr>`;
      }).join('');
    }
    renderChallengeCompare(list, byCorrectionOf, originals);
  }

  function renderChallengeCompare(list, byCorrectionOf, originals) {
    // Most recent Challenge entry per region+product, applying any correction.
    const effective = originals.map((c) => {
      const corrections = byCorrectionOf[c.id] || [];
      return corrections.length ? Object.assign({}, c, { finalPrice: corrections[corrections.length - 1].finalPrice }) : c;
    });
    const latest = {};
    effective.forEach((c) => {
      const key = c.regionId + '::' + c.productId;
      if (!latest[key] || c.effectiveDate > latest[key].effectiveDate) latest[key] = c;
    });
    const entries = Object.values(latest);
    const box = el('#challenge-compare');
    if (!entries.length) {
      box.innerHTML = '<p class="empty">Enter a Challenge price above to see how it compares against current competitor prices.</p>';
      return;
    }
    box.innerHTML = entries.map((c) => {
      const cmp = calc.challengeComparison(c, data.currentPrices);
      const region = lookup.regionById[c.regionId], product = lookup.productById[c.productId];
      if (!cmp.competitors.length) {
        return `<div style="margin-bottom:14px"><strong>${esc(region.label)} — ${esc(product.label)}</strong>
          <p class="empty">No competitor prices published for this terminal/product to compare against.</p></div>`;
      }
      const posClass = cmp.vsAverage > 0 ? 'dir-up' : cmp.vsAverage < 0 ? 'dir-down' : 'dir-flat';
      const cheapest = calc.cheapestAnywhere(c.productId, data.currentPrices);
      const cheapestIsSameAsLocal = cheapest && cmp.lowestRecord && cheapest.recordId === cmp.lowestRecord.recordId;

      return `<div style="margin-bottom:16px">
        <strong>${esc(region.label)} — ${esc(product.label)}</strong>
        <div class="compare-strip">
          <div class="compare-chip"><div class="lbl">Challenge</div><div class="val">${dpl(cmp.challenge)}</div></div>
          <div class="compare-chip">
            <div class="lbl">Lowest here</div>
            <div class="val">${dpl(cmp.lowest)}</div>
            <div class="sub-cell">${esc(cmp.lowestRecord.supplierName)} — ${esc(cmp.lowestRecord.terminalName)}</div>
          </div>
          <div class="compare-chip">
            <div class="lbl">Highest here</div>
            <div class="val">${dpl(cmp.highest)}</div>
            <div class="sub-cell">${esc(cmp.highestRecord.supplierName)} — ${esc(cmp.highestRecord.terminalName)}</div>
          </div>
          <div class="compare-chip"><div class="lbl">Market average</div><div class="val">${dpl(cmp.average)}</div></div>
          <div class="compare-chip"><div class="lbl">Vs average</div><div class="val ${posClass}">${cmp.vsAverage > 0 ? '+' : ''}${dpl(cmp.vsAverage)}</div></div>
          <div class="compare-chip"><div class="lbl">Vs lowest here</div><div class="val ${cmp.vsLowest > 0 ? 'dir-up' : 'dir-down'}">${cmp.vsLowest > 0 ? '+' : ''}${dpl(cmp.vsLowest)}</div></div>
        </div>
        ${cheapest ? `
        <div class="compare-strip" style="margin-top:8px">
          <div class="compare-chip" style="background:var(--warn-bg);border-color:var(--warn)">
            <div class="lbl">Cheapest anywhere (any terminal)</div>
            <div class="val">${dpl(cheapest.currentValue)}</div>
            <div class="sub-cell">${esc(cheapest.supplierName)} — ${esc(cheapest.regionLabel)} (${esc(cheapest.terminalName)})${cheapestIsSameAsLocal ? ' — same as lowest here' : ''}</div>
          </div>
        </div>` : `
        <div class="compare-strip" style="margin-top:8px">
          <p class="empty" style="padding:8px 0">No price for this product found at any terminal to compare nationally.</p>
        </div>`}
      </div>`;
    }).join('');
  }

  el('#challenge-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const preGstDollars = Number(el('#cf-price').value);
    if (!Number.isFinite(preGstDollars) || preGstDollars <= 0) {
      alert('Enter a positive price before GST, e.g. 2.5490.');
      return;
    }
    const preGstCents = preGstDollars * 100;
    const finalCents = preGstCents * (1 + GST_RATE);
    const entry = {
      regionId: el('#cf-region').value,
      productId: el('#cf-product').value,
      preGstPrice: preGstCents,      // reference — what you told me, before tax
      finalPrice: finalCents,         // GST-inclusive — this is what competitor comparisons use
      effectiveDate: el('#cf-date').value,
      notes: el('#cf-notes').value.trim(),
    };
    if (!entry.regionId || !entry.productId || !entry.effectiveDate) {
      alert('Fill in terminal, product, and an effective date.');
      return;
    }
    const submitBtn = el('#cf-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    try {
      await storage.addChallengePrice(entry);
      resetChallengeForm();
      await renderChallenge();
    } catch (err) {
      alert('Could not save: ' + err.message);
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Save Challenge price';
    }
  });

  // A correction is create-only: it prompts for the new value and a reason,
  // then adds a NEW record referencing the original. There is no edit-in-place
  // and no delete — matching the real backend's ChallengePriceRepository,
  // which has no update() or delete() method at all.
  el('#challenge-rows').addEventListener('click', async (e) => {
    if (e.target.classList.contains('cp-history-toggle')) {
      const key = e.target.dataset.key;
      const historyRow = document.querySelector(`.cp-history-row[data-key="${CSS.escape(key)}"]`);
      if (historyRow) {
        historyRow.hidden = !historyRow.hidden;
        e.target.textContent = e.target.textContent.replace(/^History/, historyRow.hidden ? 'History' : 'Hide history');
      }
      return;
    }
    if (!e.target.classList.contains('cp-correct')) return;
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const list = await storage.getChallengePrices();
    const original = list.find((c) => c.id === id);
    if (!original) return;

    const currentPreGst = typeof original.preGstPrice === 'number' ? (original.preGstPrice / 100).toFixed(4) : '';
    const newValueRaw = prompt(`Corrected price BEFORE GST for ${fmtDate(original.effectiveDate)} (was $${currentPreGst}):`, currentPreGst);
    if (newValueRaw === null) return;
    const newPreGstDollars = Number(newValueRaw);
    if (!Number.isFinite(newPreGstDollars) || newPreGstDollars <= 0) { alert('Enter a valid positive number.'); return; }
    const reason = prompt('Reason for this correction:');
    if (!reason || !reason.trim()) { alert('A correction requires a reason.'); return; }

    try {
      const newFinalCents = newPreGstDollars * 100 * (1 + GST_RATE);
      await storage.correctChallengePrice(id, newFinalCents, reason, newPreGstDollars * 100);
      await renderChallenge();
    } catch (err) {
      alert(err.message);
    }
  });

  // ============================================================== AUTOMATION
  function renderAutomation() {
    el('#automation-grid').innerHTML = data.automationRuns.map((r) => {
      const pillClass = r.status === 'OK' ? 'ok' : r.status === 'WARNING' ? 'warn' : 'err';
      return `<div class="status-card">
        <div class="row1"><h3>${esc(r.supplierName)}</h3><span class="pill ${pillClass}">${esc(r.status)}</span></div>
        <dl>
          <div><span>Connector</span><b>${esc(r.connector)}</b></div>
          <div><span>Last check</span><b>${fmtDateTime(r.lastCheck)}</b></div>
          <div><span>Last successful</span><b>${fmtDateTime(r.lastSuccess)}</b></div>
          <div><span>Next scheduled</span><b>${fmtDateTime(r.nextCheck)}</b></div>
          <div><span>Products found</span><b>${r.productsFound}</b></div>
          <div><span>Terminals found</span><b>${r.terminalsFound}</b></div>
        </dl>
        ${r.lastError ? `<p style="font-size:.78rem;color:var(--warn);margin:8px 0 0">${esc(r.lastError)}</p>` : ''}
      </div>`;
    }).join('');
  }

  function renderErrors() {
    const sev = el('#e-severity').value, status = el('#e-status').value;
    const rows = data.errors.filter((e) => (!sev || e.severity === sev) && (!status || e.status === status));
    const tbody = el('#error-rows');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No errors match these filters.</td></tr>'; return; }
    const sevPill = { ERROR: 'err', WARNING: 'warn', INFO: 'info', RESOLVED: 'ok' };
    tbody.innerHTML = rows.map((e) => `<tr>
      <td><span class="pill ${sevPill[e.severity] || ''}">${esc(e.severity)}</span></td>
      <td>${esc(lookup.supplierById[e.supplierId] ? lookup.supplierById[e.supplierId].name : e.supplierId)}</td>
      <td>${fmtDate(e.date)}</td>
      <td style="max-width:480px">${esc(e.message)}${e.resolution ? `<div class="sub-cell">${esc(e.resolution)}</div>` : ''}</td>
      <td>${esc(e.status)}</td>
    </tr>`).join('');
  }

  el('#e-severity').addEventListener('change', renderErrors);
  el('#e-status').addEventListener('change', renderErrors);

  // ============================================================== DOCUMENTS
  function renderDocuments() {
    el('#document-rows').innerHTML = data.documents.map((d) => `<tr>
      <td>${esc(lookup.supplierById[d.supplierId] ? lookup.supplierById[d.supplierId].name : d.supplierId)}</td>
      <td><a class="src-link" href="${esc(d.documentUrl)}" target="_blank" rel="noopener">Open document ↗</a></td>
      <td>${fmtDate(d.effectiveDate)}</td>
      <td>${fmtDateTime(d.retrievedAt)}</td>
      <td class="mono" title="${esc(d.hash)}">${esc(d.hash.slice(0, 12))}…</td>
      <td>${d.productsFound.map(esc).join(', ')}</td>
      <td class="sub-cell">${d.terminalsFound.map(esc).join(', ')}</td>
      <td><span class="pill ok">${esc(d.status)}</span></td>
    </tr>`).join('');
  }

  // ============================================================== boot
  async function init() {
    populateOverviewFilters();
    populateHistoryFilters();
    populateChallengeFilters();

    el('#h-region').value = 'AUCKLAND_WIRI';
    el('#h-product').value = 'DIESEL';
    el('#cf-date').value = new Date().toISOString().slice(0, 10);

    // Show a loading state immediately — the real Firestore data can take
    // a moment to arrive over the network, and an empty-looking page with
    // no explanation reads as broken rather than loading.
    el('#overview-rows').innerHTML = '<tr><td colspan="11" class="empty">Loading live prices…</td></tr>';
    el('#kpi-strip').innerHTML = '<div class="kpi"><div class="lbl">Status</div><div class="val" style="font-size:1rem">Loading…</div></div>';

    try {
      await window.TGP.dataReady;
    } catch (err) {
      el('#overview-rows').innerHTML = `<tr><td colspan="11" class="empty">Could not load live data: ${esc(err.message)}. Check your internet connection and reload.</td></tr>`;
      el('#kpi-strip').innerHTML = '';
      return;
    }

    renderKpis();
    renderReviewBanner();
    renderOverview();
    renderHistory();
    renderMarket();
    await renderChallenge();
    renderAutomation();
    renderErrors();
    renderDocuments();
  }

  document.addEventListener('DOMContentLoaded', init);
}());

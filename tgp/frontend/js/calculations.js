/* ==========================================================================
   TGP.calc — pure functions, no DOM. Kept separate so the eventual backend
   phase can reuse the identical market-direction and comparison logic
   server-side without dragging in any rendering code.
   ========================================================================== */
(function (global) {
  'use strict';

  function change(current, previous) {
    if (typeof current !== 'number') return { abs: null, pct: null, direction: 'UNKNOWN' };
    if (typeof previous !== 'number') return { abs: null, pct: null, direction: 'NEW' };
    const abs = +(current - previous).toFixed(2);
    const pct = previous !== 0 ? +((abs / previous) * 100).toFixed(2) : null;
    return { abs, pct, direction: abs > 0 ? 'UP' : abs < 0 ? 'DOWN' : 'FLAT' };
  }

  function directionArrow(direction) {
    switch (direction) {
      case 'UP': return '▲';
      case 'DOWN': return '▼';
      case 'FLAT': return '→';
      case 'NEW': return '•';
      default: return '—';
    }
  }

  function directionWord(direction) {
    switch (direction) {
      case 'UP': return 'Increase';
      case 'DOWN': return 'Decrease';
      case 'FLAT': return 'No change';
      case 'NEW': return 'First observation';
      default: return 'Unknown';
    }
  }

  /** Filter a list of price-like records against a filter set. Unset filters pass everything. */
  function filterRecords(records, f) {
    f = f || {};
    return records.filter((r) =>
      (!f.supplierId || r.supplierId === f.supplierId) &&
      (!f.regionId || r.regionId === f.regionId) &&
      (!f.productId || r.productId === f.productId) &&
      (!f.direction || r.direction === f.direction) &&
      (!f.status || r.validationStatus === f.status) &&
      (!f.search || matchesSearch(r, f.search)));
  }

  function matchesSearch(r, term) {
    const s = term.toLowerCase();
    return [r.supplierName, r.regionLabel, r.terminalName, r.productName]
      .filter(Boolean).some((v) => v.toLowerCase().includes(s));
  }

  /** Movement of a time series between the two most recent points N steps apart. */
  function seriesMovement(points, stepsBack) {
    if (points.length <= stepsBack) return null;
    const last = points[points.length - 1];
    const prior = points[points.length - 1 - stepsBack];
    const abs = +(last.value - prior.value).toFixed(2);
    const pct = prior.value !== 0 ? +((abs / prior.value) * 100).toFixed(2) : null;
    return { abs, pct, fromDate: prior.date, toDate: last.date };
  }

  function sign(x, epsilon) {
    epsilon = epsilon || 0.15; // percent — ignore noise below this as "flat"
    if (x === null || x === undefined) return null;
    if (x > epsilon) return 1;
    if (x < -epsilon) return -1;
    return 0;
  }

  /**
   * Market direction indicator.
   *
   * METHODOLOGY (shown verbatim in the UI so the number is never a black box):
   *   1. Require at least 15 AIP weekday observations. Below that, report
   *      INSUFFICIENT_DATA rather than a guess.
   *   2. Compute AIP's 5-session and 10-session percentage movement (average
   *      of the ULP and Diesel series).
   *   3. Compute NZ's own most recent published movement: the average
   *      percentage change of the last real price update across active
   *      suppliers/regions/products (only records with a known previous
   *      value are included).
   *   4. Three signals — AIP 5-session, AIP 10-session, NZ recent movement —
   *      are reduced to -1 / 0 / +1. All three agreeing gives a confident
   *      reading; two of three agreeing gives a qualified reading; anything
   *      more split is NEUTRAL.
   * This is a directional indicator, not a forecast, and is presented as such.
   */
  function marketDirection(aipSeries, nzCurrentPrices) {
    if (!aipSeries || aipSeries.length < 15) {
      return { state: 'INSUFFICIENT_DATA', score: 0, methodology: methodologyText(), signals: null };
    }

    const ulpPoints = aipSeries.map((p) => ({ date: p.date, value: p.ulp }));
    const dieselPoints = aipSeries.map((p) => ({ date: p.date, value: p.diesel }));

    const ulp5 = seriesMovement(ulpPoints, 5);
    const ulp10 = seriesMovement(ulpPoints, 10);
    const d5 = seriesMovement(dieselPoints, 5);
    const d10 = seriesMovement(dieselPoints, 10);

    const aip5pct = +(((ulp5.pct + d5.pct) / 2)).toFixed(2);
    const aip10pct = +(((ulp10.pct + d10.pct) / 2)).toFixed(2);

    const nzChanges = nzCurrentPrices
      .filter((r) => typeof r.changePct === 'number')
      .map((r) => r.changePct);
    const nzAvgPct = nzChanges.length
      ? +(nzChanges.reduce((a, b) => a + b, 0) / nzChanges.length).toFixed(2)
      : null;

    const s5 = sign(aip5pct);
    const s10 = sign(aip10pct);
    const sNz = nzAvgPct === null ? null : sign(nzAvgPct);

    const signals = [s5, s10, sNz].filter((x) => x !== null);
    const agree = signals.length && signals.every((x) => x === signals[0]) ? signals[0] : null;

    let state = 'NEUTRAL';
    let score = 0;
    let confidence = 'Signals mixed — no consistent direction across AIP and NZ movement.';

    if (agree === 1) { state = 'UPWARD'; score = signals.length === 3 ? 1 : 0.6; confidence = signals.length === 3 ? 'AIP 5-session, AIP 10-session and recent NZ movement all point the same way.' : 'AIP\u2019s 5- and 10-session movement agree; NZ has not yet confirmed.'; }
    else if (agree === -1) { state = 'DOWNWARD'; score = signals.length === 3 ? -1 : -0.6; confidence = signals.length === 3 ? 'AIP 5-session, AIP 10-session and recent NZ movement all point the same way.' : 'AIP\u2019s 5- and 10-session movement agree; NZ has not yet confirmed.'; }
    else if (s5 !== null && s10 !== null && s5 === s10) { state = s5 > 0 ? 'UPWARD' : s5 < 0 ? 'DOWNWARD' : 'NEUTRAL'; score = s5 * 0.6; confidence = 'AIP 5- and 10-session movement agree; NZ movement not counted (unavailable or mixed).'; }

    return {
      state, score, confidence, methodology: methodologyText(),
      signals: { aip5pct, aip10pct, nzAvgPct, ulp5, ulp10, d5, d10 },
    };
  }

  function methodologyText() {
    return 'Combines AIP\u2019s 5- and 10-trading-session movement (average of ULP and diesel) with the most '
      + 'recent published NZ TGP movement across active suppliers and terminals. Reported only when at least '
      + '15 AIP observations exist; otherwise shown as insufficient data. This is a directional indicator, '
      + 'not a forecast, and never carries an invented confidence percentage.';
  }

  /** Challenge vs competitor comparison for one region/product/date. */
  function challengeComparison(challengeEntry, currentPrices) {
    if (!challengeEntry) return null;
    const competitors = currentPrices.filter((r) =>
      r.regionId === challengeEntry.regionId && r.productId === challengeEntry.productId);
    if (!competitors.length) {
      return { challenge: challengeEntry.finalPrice, competitors: [], lowest: null, highest: null, average: null, vsAverage: null, vsLowest: null, lowestRecord: null, highestRecord: null };
    }
    const lowestRecord = competitors.reduce((a, b) => (b.currentValue < a.currentValue ? b : a));
    const highestRecord = competitors.reduce((a, b) => (b.currentValue > a.currentValue ? b : a));
    const values = competitors.map((c) => c.currentValue);
    const average = +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
    return {
      challenge: challengeEntry.finalPrice,
      competitors,
      lowest: lowestRecord.currentValue, highest: highestRecord.currentValue, average,
      lowestRecord, highestRecord,
      vsAverage: +(challengeEntry.finalPrice - average).toFixed(2),
      vsLowest: +(challengeEntry.finalPrice - lowestRecord.currentValue).toFixed(2),
    };
  }

  /**
   * The single cheapest published price for a product ANYWHERE across every
   * terminal/region a supplier reports — not scoped to one Challenge
   * terminal. Gives a "where do we sit against the whole market" reference
   * point alongside the same-terminal comparison above.
   */
  function cheapestAnywhere(productId, currentPrices) {
    const matches = currentPrices.filter((r) => r.productId === productId);
    if (!matches.length) return null;
    return matches.reduce((a, b) => (b.currentValue < a.currentValue ? b : a));
  }

  global.TGP = global.TGP || {};
  global.TGP.calc = {
    change, directionArrow, directionWord, filterRecords, seriesMovement,
    marketDirection, challengeComparison, cheapestAnywhere, methodologyText,
  };
}(window));

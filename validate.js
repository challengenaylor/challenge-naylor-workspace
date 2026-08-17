'use strict';

/**
 * Validation gate. Nothing reaches currentPrices without passing this.
 *
 * Plausibility bounds are deliberately wide: they exist to catch decimal-point
 * slips, column misreads and unit confusion, not to second-guess the market.
 * A price outside the band is not discarded, it is held as NEEDS_REVIEW.
 */

const BOUNDS_NZ_CPL = { min: 80, max: 500 };

function validatePriceRecord(rec, { previous } = {}) {
  const errors = [];
  const warnings = [];

  if (!rec.supplierId) errors.push('MISSING_SUPPLIER');
  if (!rec.terminalId) errors.push('MISSING_TERMINAL');
  if (!rec.productId) errors.push('MISSING_PRODUCT');
  if (!rec.effectiveDate) errors.push('MISSING_EFFECTIVE_DATE');

  const v = rec.normalisedValue;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push('PRICE_NOT_NUMERIC');
  } else {
    if (v < BOUNDS_NZ_CPL.min || v > BOUNDS_NZ_CPL.max) {
      errors.push(`PRICE_OUT_OF_BOUNDS(${v} c/L)`);
    }
    if (Math.round(v * 1000) % 10 !== 0 && String(v).split('.')[1]?.length > 2) {
      warnings.push('UNUSUAL_PRECISION');
    }
  }

  if (!['included', 'excluded', 'not_stated', 'unknown'].includes(rec.gstStatus)) {
    errors.push('INVALID_GST_STATUS');
  }
  if (rec.gstStatus === 'unknown' || rec.gstStatus === 'not_stated') {
    warnings.push('GST_TREATMENT_NOT_ESTABLISHED');
  }

  if (rec.effectiveDate) {
    const eff = new Date(`${rec.effectiveDate}T00:00:00Z`);
    const now = new Date();
    const daysAhead = (eff - now) / 86400000;
    if (daysAhead > 14) warnings.push('EFFECTIVE_DATE_FAR_FUTURE');
    if (daysAhead < -400) warnings.push('EFFECTIVE_DATE_VERY_OLD');
  }

  // A very large jump is usually a parse error, occasionally a real market move.
  // Either way a human should look before it becomes the headline number.
  if (previous && typeof previous.normalisedValue === 'number' && typeof v === 'number') {
    const delta = v - previous.normalisedValue;
    const pct = Math.abs(delta) / previous.normalisedValue * 100;
    if (pct > 25) {
      warnings.push(`LARGE_MOVEMENT(${delta.toFixed(2)} c/L, ${pct.toFixed(1)}%)`);
    }
  }

  const status = errors.length ? 'NEEDS_REVIEW' : warnings.length ? 'PUBLISHED_WITH_WARNINGS' : 'PUBLISHED';
  return { validationStatus: status, errors, warnings, publishable: errors.length === 0 };
}

module.exports = { validatePriceRecord, BOUNDS_NZ_CPL };

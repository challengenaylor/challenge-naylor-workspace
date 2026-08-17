'use strict';

/**
 * Validation engine. Upgrades core/validate.js's single-record check into
 * the batch {validPrices, reviewPrices} shape the product architecture needs.
 *
 * PRINCIPLE: a missing price is acceptable (NO_PUBLISHED_PRICE, never
 * fabricated). A wrong price is not. Anything the engine cannot confidently
 * accept goes to reviewPrices with the ORIGINAL extracted values intact and
 * an explicit list of validationErrors — never silently dropped, never
 * silently corrected.
 */

const PRICE_RANGE = { min: 100, max: 400 }; // NZ cents/litre, per this phase's spec
const STALE_DAYS = 14;

const KNOWN_GST_STATUSES = ['GST_INCLUDED', 'GST_EXCLUDED'];
const KNOWN_TERMINAL_IDS = null; // supplied by caller per-run (terminal registry), see validateBatch

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

function validateOne(record, ctx) {
  ctx = ctx || {};
  const errors = [];

  if (!record.supplierId) errors.push('MISSING_SUPPLIER');
  if (!record.terminalId) errors.push('TERMINAL_NOT_FOUND');
  if (!record.productId) errors.push('PRODUCT_NOT_FOUND');

  if (!isFiniteNumber(record.priceCentsPerLitre)) {
    errors.push('INVALID_PRICE');
  } else if (record.priceCentsPerLitre < PRICE_RANGE.min || record.priceCentsPerLitre > PRICE_RANGE.max) {
    errors.push(`INVALID_PRICE:OUT_OF_RANGE(${record.priceCentsPerLitre}c/L, expected ${PRICE_RANGE.min}-${PRICE_RANGE.max})`);
  }

  if (!record.gstStatus || !KNOWN_GST_STATUSES.includes(record.gstStatus)) {
    errors.push('GST_UNKNOWN');
  }

  if (!record.effectiveDate) {
    errors.push('STALE_DATE:MISSING');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveDate)) {
    errors.push('STALE_DATE:MALFORMED');
  } else {
    // Compare CALENDAR DATES in Pacific/Auckland, not raw UTC instants.
    // The bug this replaces: comparing "now" (a UTC instant) against
    // "effectiveDate + T00:00:00Z" (UTC midnight) ignores that NZ is
    // 12-13 hours ahead of UTC — a price that has genuinely just taken
    // effect in NZ can still read as "the future" for most of the NZ day,
    // since UTC hasn't reached that calendar date yet. Converting both
    // sides to their NZ-local calendar date first removes the ambiguity
    // entirely; there's no time-of-day component left to get wrong.
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const nzToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(now); // YYYY-MM-DD
    const ageDays = (Date.parse(nzToday + 'T00:00:00Z') - Date.parse(record.effectiveDate + 'T00:00:00Z')) / 86400000;
    if (ageDays > STALE_DAYS) errors.push(`STALE_DATE:${Math.floor(ageDays)}_DAYS_OLD`);
    if (ageDays < -1) errors.push('STALE_DATE:FUTURE'); // more than a day ahead is suspicious for a same-day publication
  }

  if (!record.sourceDocumentHash) errors.push('MISSING_SOURCE_DOCUMENT_HASH');

  // Duplicate price check is the caller's job (it needs repository access to
  // compare against what's already stored) — see orchestrator.js. This
  // function only validates the record on its own merits.

  return { errors, ok: errors.length === 0 };
}

/**
 * @param {object[]} records  raw extracted records (pre-validation)
 * @param {object} ctx        { now?: ISO string, for deterministic tests }
 * @returns {{validPrices: object[], reviewPrices: object[]}}
 */
function validateBatch(records, ctx) {
  const validPrices = [];
  const reviewPrices = [];

  for (const record of records) {
    const { errors, ok } = validateOne(record, ctx);
    if (ok) {
      validPrices.push(Object.assign({}, record, { validationStatus: 'VALID', validationErrors: [] }));
    } else {
      reviewPrices.push(Object.assign({}, record, { validationStatus: 'NEEDS_REVIEW', validationErrors: errors }));
    }
  }

  return { validPrices, reviewPrices };
}

module.exports = { validateOne, validateBatch, PRICE_RANGE, STALE_DAYS };

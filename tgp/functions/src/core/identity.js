'use strict';

const crypto = require('crypto');

/**
 * Idempotency. Re-reading the same document must never create a second record.
 *
 * The natural key deliberately EXCLUDES the document hash: a supplier that
 * re-issues a PDF with identical prices (new footer, re-export, whitespace
 * change) must not create a duplicate price row. The hash is stored alongside
 * for audit, and a changed hash with unchanged prices is recorded as a new
 * source document only.
 */
function priceRecordId({ supplierId, terminalId, productId, effectiveDate }) {
  return [supplierId, terminalId, productId, effectiveDate].join('|');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Decide whether an incoming record is a genuine revision. */
function isMeaningfulChange(incoming, existing) {
  if (!existing) return { changed: true, reason: 'FIRST_OBSERVATION' };
  if (existing.effectiveDate !== incoming.effectiveDate) {
    return { changed: true, reason: 'NEW_EFFECTIVE_DATE' };
  }
  if (existing.publishedValue !== incoming.publishedValue) {
    return { changed: true, reason: 'PRICE_REVISED_FOR_SAME_EFFECTIVE_DATE' };
  }
  if (existing.gstStatus !== incoming.gstStatus) {
    return { changed: true, reason: 'GST_TREATMENT_CHANGED' };
  }
  return { changed: false, reason: 'NO_CHANGE' };
}

module.exports = { priceRecordId, sha256, isMeaningfulChange };

'use strict';

const { ReviewRepository } = require('../base');
const { LocalJsonStore } = require('./LocalJsonStore');

/**
 * Admin review queue. Distinct from ErrorRepository:
 *   ErrorRepository  = connector/extraction-STAGE failures (source unreachable,
 *                       PDF wouldn't parse at all — nothing extracted).
 *   ReviewRepository = something WAS extracted, but validation could not
 *                       confidently accept it (out-of-range price, unknown
 *                       GST wording, unmatched terminal, etc).
 * Corrections reference the original record by id; the original is never
 * mutated, matching the same rule applied to Challenge pricing.
 */
class LocalReviewRepository extends ReviewRepository {
  constructor(dir) {
    super();
    this.queue = new LocalJsonStore('tgp_review_queue.json', dir);
    this.corrections = new LocalJsonStore('tgp_corrections.json', dir);
  }

  async enqueue(reviewRecord) {
    // Avoid re-queuing the exact same unresolved extraction on every run.
    const dupeKey = JSON.stringify([reviewRecord.supplierId, reviewRecord.terminalRaw, reviewRecord.productRaw,
      reviewRecord.effectiveDate, reviewRecord.priceRaw, reviewRecord.validationErrors]);
    const existing = this.queue.find((r) => r._dupeKey === dupeKey && r.status === 'NEEDS_REVIEW');
    if (existing) return { stored: existing, isNew: false };

    const stored = Object.assign({
      id: 'rev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      status: 'NEEDS_REVIEW',
      queuedAt: new Date().toISOString(),
      _dupeKey: dupeKey,
    }, reviewRecord);
    this.queue.append(stored);
    return { stored, isNew: true };
  }

  async listPending() {
    return this.queue.filter((r) => r.status === 'NEEDS_REVIEW');
  }

  async resolveSuperseded(supplierId, terminalRaw, productRaw) {
    const all = this.queue.readAll();
    let count = 0;
    const updated = all.map((r) => {
      if (r.status === 'NEEDS_REVIEW' && r.supplierId === supplierId && r.terminalRaw === terminalRaw && r.productRaw === productRaw) {
        count++;
        return Object.assign({}, r, { status: 'SUPERSEDED', resolvedAt: new Date().toISOString(), resolvedReason: 'A later run validated this successfully.' });
      }
      return r;
    });
    if (count) this.queue.writeAll(updated);
    return { resolvedCount: count };
  }

  async recordCorrection(correction) {
    const required = ['reviewId', 'originalValue', 'correctedValue', 'reason', 'adminId'];
    const missing = required.filter((k) => correction[k] === undefined || correction[k] === null || correction[k] === '');
    if (missing.length) throw new Error('recordCorrection missing required fields: ' + missing.join(', '));

    const stored = Object.assign({
      id: 'corr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      correctedAt: new Date().toISOString(),
    }, correction);
    this.corrections.append(stored);

    // Mark the queue entry resolved WITHOUT touching the original extracted
    // values already stored on it.
    this.queue.replaceOne((r) => r.id === correction.reviewId, (r) => Object.assign({}, r, { status: 'RESOLVED', resolvedAt: stored.correctedAt }));

    return stored;
  }

  async listCorrections(filter) {
    filter = filter || {};
    return this.corrections.filter((c) => !filter.reviewId || c.reviewId === filter.reviewId);
  }
}

module.exports = { LocalReviewRepository };

'use strict';

const { ChallengePriceRepository } = require('../base');
const { LocalJsonStore } = require('./LocalJsonStore');

/**
 * Challenge pricing: create-only. There is deliberately NO update() and NO
 * delete() method — not "not implemented", not present at all, so a caller
 * cannot accidentally rewrite history even by mistake. A correction is a new
 * record that references the original by id; the original is untouched.
 * This is the fix for the Phase 2 demo, which allowed free in-place edits —
 * that was flagged then as a deliberate demo-only shortcut, and this
 * repository is what replaces it for the real product.
 */
class LocalChallengePriceRepository extends ChallengePriceRepository {
  constructor(dir) {
    super();
    this.store = new LocalJsonStore('tgp_challenge_prices.json', dir);
  }

  async create(entry) {
    const required = ['terminalId', 'productId', 'priceCentsPerLitre', 'effectiveDate', 'adminId'];
    const missing = required.filter((k) => entry[k] === undefined || entry[k] === null || entry[k] === '');
    if (missing.length) throw new Error('ChallengePriceRepository.create missing required fields: ' + missing.join(', '));
    if (typeof entry.priceCentsPerLitre !== 'number' || !Number.isFinite(entry.priceCentsPerLitre) || entry.priceCentsPerLitre <= 0 || entry.priceCentsPerLitre >= 1000) {
      throw new Error('ChallengePriceRepository.create: priceCentsPerLitre must be a plausible positive number under 1000');
    }
    const stored = Object.assign({
      id: 'chg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      source: 'MANUAL_ADMIN_ENTRY',
      createdAt: new Date().toISOString(),
    }, entry);
    this.store.append(stored);
    return stored;
  }

  async list(filter) {
    filter = filter || {};
    return this.store.filter((c) =>
      (!filter.terminalId || c.terminalId === filter.terminalId) &&
      (!filter.productId || c.productId === filter.productId))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }

  /** A correction is itself a new create()'d record, with correction metadata attached. */
  async correct(correction) {
    const required = ['originalId', 'correctedValue', 'reason', 'adminId', 'terminalId', 'productId', 'effectiveDate'];
    const missing = required.filter((k) => correction[k] === undefined || correction[k] === null || correction[k] === '');
    if (missing.length) throw new Error('ChallengePriceRepository.correct missing required fields: ' + missing.join(', '));
    const original = this.store.find((c) => c.id === correction.originalId);
    if (!original) throw new Error('ChallengePriceRepository.correct: originalId not found — cannot correct a record that does not exist');

    return this.create({
      terminalId: correction.terminalId,
      productId: correction.productId,
      priceCentsPerLitre: correction.correctedValue,
      effectiveDate: correction.effectiveDate,
      adminId: correction.adminId,
      correctionOf: original.id,
      correctionReason: correction.reason,
      originalValue: original.priceCentsPerLitre,
    });
  }
}

module.exports = { LocalChallengePriceRepository };

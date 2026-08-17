'use strict';

const { PriceRepository } = require('../base');
const { LocalJsonStore } = require('./LocalJsonStore');

/**
 * File-backed PriceRepository.
 *
 * tgp_current_prices.json  — one row per (supplierId, terminalId, productId):
 *                             the latest VALID price only.
 * tgp_historical_prices.json — append-only. putCurrent() NEVER deletes or
 *                             edits an existing historical row; it only adds
 *                             the outgoing "current" to history before
 *                             replacing it, mirroring the immutability rule
 *                             that will carry over to Firestore.
 */
class LocalPriceRepository extends PriceRepository {
  constructor(dir) {
    super();
    this.current = new LocalJsonStore('tgp_current_prices.json', dir);
    this.history = new LocalJsonStore('tgp_historical_prices.json', dir);
  }

  _key(supplierId, terminalId, productId) {
    return `${supplierId}|${terminalId}|${productId}`;
  }

  async getCurrent(supplierId, terminalId, productId) {
    const key = this._key(supplierId, terminalId, productId);
    return this.current.find((r) => r._key === key);
  }

  async putCurrent(priceRecord) {
    if (priceRecord.validationStatus !== 'VALID') {
      throw new Error('putCurrent() refuses a record whose validationStatus is not VALID — NEEDS_REVIEW records belong in ReviewRepository, not in current prices.');
    }
    const key = this._key(priceRecord.supplierId, priceRecord.terminalId, priceRecord.productId);
    const existing = this.current.find((r) => r._key === key);

    // Idempotency: an identical re-observation (same effective date, same
    // value, same source document hash) is not a new event.
    if (existing
      && existing.effectiveDate === priceRecord.effectiveDate
      && existing.priceCentsPerLitre === priceRecord.priceCentsPerLitre
      && existing.sourceDocumentHash === priceRecord.sourceDocumentHash) {
      return { stored: existing, changed: false, reason: 'DUPLICATE_NO_CHANGE' };
    }

    // ORDERING GUARD: a document can legitimately contain more than one
    // effective-date block (e.g. this week's AND last week's price both
    // published in the same PDF). Processing order is not date order, so
    // "the record I happen to be handling right now" must never blindly
    // become "current" — only a record whose effectiveDate is on or after
    // the existing current's may. An older block goes straight to history
    // as a backfilled record instead.
    if (existing && priceRecord.effectiveDate < existing.effectiveDate) {
      const alreadyInHistory = this.history.find((r) =>
        r._key === key && r.effectiveDate === priceRecord.effectiveDate && r.priceCentsPerLitre === priceRecord.priceCentsPerLitre);
      if (!alreadyInHistory) {
        this.history.append(Object.assign({ _key: key }, priceRecord, { archivedAt: new Date().toISOString(), backfilled: true }));
      }
      return { stored: existing, changed: false, reason: 'OLDER_THAN_CURRENT_ARCHIVED_TO_HISTORY' };
    }

    if (existing) {
      // Move the outgoing current record to history verbatim before replacing it.
      this.history.append(Object.assign({}, existing, { archivedAt: new Date().toISOString() }));
    }

    const all = this.current.readAll().filter((r) => r._key !== key);
    const stored = Object.assign({ _key: key }, priceRecord);
    all.push(stored);
    this.current.writeAll(all);

    return { stored, changed: true, reason: existing ? 'PRICE_REVISED' : 'FIRST_OBSERVATION' };
  }

  async getHistory(supplierId, terminalId, productId) {
    const key = this._key(supplierId, terminalId, productId);
    return this.history.filter((r) => r._key === key).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  async listCurrent(filter) {
    filter = filter || {};
    return this.current.filter((r) =>
      (!filter.supplierId || r.supplierId === filter.supplierId) &&
      (!filter.terminalId || r.terminalId === filter.terminalId) &&
      (!filter.productId || r.productId === filter.productId));
  }
}

module.exports = { LocalPriceRepository };

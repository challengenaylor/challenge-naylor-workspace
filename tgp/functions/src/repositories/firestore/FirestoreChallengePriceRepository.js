'use strict';

const { ChallengePriceRepository } = require('../base');

/** Create-only, same as LocalChallengePriceRepository — no update(), no delete() method exists at all. */
class FirestoreChallengePriceRepository extends ChallengePriceRepository {
  constructor(db) {
    super();
    this.col = db.collection('tgpApp').collection('challengePricing');
  }

  async create(entry) {
    const required = ['terminalId', 'productId', 'priceCentsPerLitre', 'effectiveDate', 'adminId'];
    const missing = required.filter((k) => entry[k] === undefined || entry[k] === null || entry[k] === '');
    if (missing.length) throw new Error('ChallengePriceRepository.create missing required fields: ' + missing.join(', '));
    if (typeof entry.priceCentsPerLitre !== 'number' || entry.priceCentsPerLitre <= 0 || entry.priceCentsPerLitre >= 1000) {
      throw new Error('priceCentsPerLitre must be a plausible positive number under 1000');
    }
    const id = this.col.doc().id;
    const stored = Object.assign({ id, source: 'MANUAL_ADMIN_ENTRY', createdAt: new Date().toISOString() }, entry);
    await this.col.doc(id).set(stored);
    return stored;
  }

  async list(filter) {
    filter = filter || {};
    let q = this.col;
    if (filter.terminalId) q = q.where('terminalId', '==', filter.terminalId);
    if (filter.productId) q = q.where('productId', '==', filter.productId);
    const snap = await q.orderBy('effectiveDate', 'desc').get();
    return snap.docs.map((d) => d.data());
  }

  async correct(correction) {
    const required = ['originalId', 'correctedValue', 'reason', 'adminId', 'terminalId', 'productId', 'effectiveDate'];
    const missing = required.filter((k) => correction[k] === undefined || correction[k] === null || correction[k] === '');
    if (missing.length) throw new Error('correct() missing required fields: ' + missing.join(', '));
    const originalDoc = await this.col.doc(correction.originalId).get();
    if (!originalDoc.exists) throw new Error('correct(): originalId not found');
    const original = originalDoc.data();

    return this.create({
      terminalId: correction.terminalId, productId: correction.productId,
      priceCentsPerLitre: correction.correctedValue, effectiveDate: correction.effectiveDate,
      adminId: correction.adminId, correctionOf: original.id,
      correctionReason: correction.reason, originalValue: original.priceCentsPerLitre,
    });
  }
}

module.exports = { FirestoreChallengePriceRepository };

'use strict';

const { ReviewRepository } = require('../base');

class FirestoreReviewRepository extends ReviewRepository {
  constructor(db) {
    super();
    this.db = db;
    this.queueCol = db.collection('tgpApp').doc('_').collection('reviewQueue');
    this.correctionsCol = db.collection('tgpApp').doc('corrections').collection('items');
  }

  async enqueue(reviewRecord) {
    const dupeKey = [reviewRecord.supplierId, reviewRecord.terminalRaw, reviewRecord.productRaw,
      reviewRecord.effectiveDate, reviewRecord.priceRaw, JSON.stringify(reviewRecord.validationErrors)].join('::');

    const existingSnap = await this.queueCol.where('_dupeKey', '==', dupeKey).where('status', '==', 'NEEDS_REVIEW').limit(1).get();
    if (!existingSnap.empty) {
      return { stored: existingSnap.docs[0].data(), isNew: false };
    }

    const id = this.queueCol.doc().id;
    const stored = Object.assign({
      id, status: 'NEEDS_REVIEW', queuedAt: new Date().toISOString(), _dupeKey: dupeKey,
    }, reviewRecord);
    await this.queueCol.doc(id).set(stored);
    return { stored, isNew: true };
  }

  async listPending() {
    const snap = await this.queueCol.where('status', '==', 'NEEDS_REVIEW').get();
    return snap.docs.map((d) => d.data());
  }

  async recordCorrection(correction) {
    const required = ['reviewId', 'originalValue', 'correctedValue', 'reason', 'adminId'];
    const missing = required.filter((k) => correction[k] === undefined || correction[k] === null || correction[k] === '');
    if (missing.length) throw new Error('recordCorrection missing required fields: ' + missing.join(', '));

    const id = this.correctionsCol.doc().id;
    const stored = Object.assign({ id, correctedAt: new Date().toISOString() }, correction);
    await this.correctionsCol.doc(id).set(stored);
    await this.queueCol.doc(correction.reviewId).set({ status: 'RESOLVED', resolvedAt: stored.correctedAt }, { merge: true });
    return stored;
  }

  async listCorrections(filter) {
    filter = filter || {};
    let q = this.correctionsCol;
    if (filter.reviewId) q = q.where('reviewId', '==', filter.reviewId);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }
}

module.exports = { FirestoreReviewRepository };

'use strict';

const { PriceRepository } = require('../base');

/**
 * Firestore-backed PriceRepository. Same interface, same behaviour, as
 * LocalPriceRepository (see repositories/local/LocalPriceRepository.js) —
 * this is the file that actually gets used once deployed; the Local version
 * remains for local testing without a real Firestore connection.
 *
 * Collections (matching the schema in DELIVERABLE-REPORT.md / the Firestore
 * rules added to your project):
 *   tgpApp/prices/current/{recordId}
 *   tgpApp/prices/history/{recordId}   (auto-generated doc IDs — append-only)
 *
 * @param {FirebaseFirestore.Firestore} db  an initialized Admin SDK Firestore instance
 */
class FirestorePriceRepository extends PriceRepository {
  constructor(db) {
    super();
    this.db = db;
    this.currentCol = db.collection('tgpApp').doc('prices').collection('current');
    this.historyCol = db.collection('tgpApp').doc('prices').collection('history');
  }

  _key(supplierId, terminalId, productId) {
    return `${supplierId}|${terminalId}|${productId}`;
  }

  async getCurrent(supplierId, terminalId, productId) {
    const doc = await this.currentCol.doc(this._key(supplierId, terminalId, productId)).get();
    return doc.exists ? doc.data() : null;
  }

  async putCurrent(priceRecord) {
    if (priceRecord.validationStatus !== 'VALID') {
      throw new Error('putCurrent() refuses a record whose validationStatus is not VALID.');
    }
    const key = this._key(priceRecord.supplierId, priceRecord.terminalId, priceRecord.productId);
    const ref = this.currentCol.doc(key);

    // Firestore transaction: read-then-write must be atomic, otherwise two
    // overlapping function invocations could both read "no existing record"
    // and both write, silently losing one of them.
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? snap.data() : null;

      if (existing
        && existing.effectiveDate === priceRecord.effectiveDate
        && existing.priceCentsPerLitre === priceRecord.priceCentsPerLitre
        && existing.sourceDocumentHash === priceRecord.sourceDocumentHash) {
        return { stored: existing, changed: false, reason: 'DUPLICATE_NO_CHANGE' };
      }

      // Same ordering guard as LocalPriceRepository: a document can contain
      // more than one effective-date block, and processing order is not
      // date order.
      if (existing && priceRecord.effectiveDate < existing.effectiveDate) {
        const histId = `${key}|${priceRecord.effectiveDate}`;
        tx.set(this.historyCol.doc(histId), Object.assign({ _key: key }, priceRecord, {
          archivedAt: new Date().toISOString(), backfilled: true,
        }), { merge: true });
        return { stored: existing, changed: false, reason: 'OLDER_THAN_CURRENT_ARCHIVED_TO_HISTORY' };
      }

      if (existing) {
        const histId = `${key}|${existing.effectiveDate}`;
        tx.set(this.historyCol.doc(histId), Object.assign({}, existing, { archivedAt: new Date().toISOString() }));
      }

      const stored = Object.assign({ _key: key }, priceRecord);
      tx.set(ref, stored);
      return { stored, changed: true, reason: existing ? 'PRICE_REVISED' : 'FIRST_OBSERVATION' };
    });
  }

  async getHistory(supplierId, terminalId, productId) {
    const key = this._key(supplierId, terminalId, productId);
    const snap = await this.historyCol.where('_key', '==', key).orderBy('effectiveDate').get();
    return snap.docs.map((d) => d.data());
  }

  async listCurrent(filter) {
    filter = filter || {};
    let q = this.currentCol;
    if (filter.supplierId) q = q.where('supplierId', '==', filter.supplierId);
    if (filter.terminalId) q = q.where('terminalId', '==', filter.terminalId);
    if (filter.productId) q = q.where('productId', '==', filter.productId);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }
}

module.exports = { FirestorePriceRepository };

'use strict';

const { ErrorRepository } = require('../base');

class FirestoreErrorRepository extends ErrorRepository {
  constructor(db) {
    super();
    this.col = db.collection('tgpApp').doc('_').collection('extractionErrors');
  }

  async record(errorRecord) {
    const required = ['supplierId', 'stage', 'error'];
    const missing = required.filter((k) => !errorRecord[k]);
    if (missing.length) throw new Error('ErrorRepository.record missing required fields: ' + missing.join(', '));
    const id = this.col.doc().id;
    const stored = Object.assign({ id, timestamp: new Date().toISOString() }, errorRecord);
    await this.col.doc(id).set(stored);
    return stored;
  }

  async list(filter) {
    filter = filter || {};
    let q = this.col;
    if (filter.supplierId) q = q.where('supplierId', '==', filter.supplierId);
    const snap = await q.orderBy('timestamp', 'desc').limit(200).get();
    return snap.docs.map((d) => d.data());
  }
}

module.exports = { FirestoreErrorRepository };

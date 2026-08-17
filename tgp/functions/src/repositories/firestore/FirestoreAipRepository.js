'use strict';

const { AipRepository } = require('../base');

class FirestoreAipRepository extends AipRepository {
  constructor(db) {
    super();
    this.col = db.collection('tgpApp').doc('_').collection('aip');
  }

  async recordObservation(observation) {
    const required = ['date', 'source'];
    const missing = required.filter((k) => !observation[k]);
    if (missing.length) throw new Error('recordObservation missing required fields: ' + missing.join(', '));
    if (observation.origin !== 'LIVE_FETCH') {
      throw new Error('AipRepository refuses any observation not explicitly marked origin: "LIVE_FETCH".');
    }
    const ref = this.col.doc(observation.date); // date as doc ID = automatic de-dupe
    const existing = await ref.get();
    if (existing.exists) return { stored: existing.data(), isNew: false, reason: 'DUPLICATE_DATE' };
    const stored = Object.assign({ recordedAt: new Date().toISOString() }, observation);
    await ref.set(stored);
    return { stored, isNew: true, reason: 'NEW_OBSERVATION' };
  }

  async listObservations(filter) {
    filter = filter || {};
    let q = this.col.orderBy('date');
    if (filter.from) q = q.where('date', '>=', filter.from);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }
}

module.exports = { FirestoreAipRepository };

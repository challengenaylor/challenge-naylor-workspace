'use strict';

const { AipRepository } = require('../base');
const { LocalJsonStore } = require('./LocalJsonStore');

/** Append-only, deduped by observation date. Never accepts a generated/random value. */
class LocalAipRepository extends AipRepository {
  constructor(dir) {
    super();
    this.store = new LocalJsonStore('tgp_aip_observations.json', dir);
  }

  async recordObservation(observation) {
    const required = ['date', 'source'];
    const missing = required.filter((k) => !observation[k]);
    if (missing.length) throw new Error('AipRepository.recordObservation missing required fields: ' + missing.join(', '));
    if (observation.origin !== 'LIVE_FETCH') {
      throw new Error('AipRepository refuses any observation not explicitly marked origin: "LIVE_FETCH" — this is the guard against synthetic data re-entering the production path.');
    }
    const existing = this.store.find((o) => o.date === observation.date);
    if (existing) return { stored: existing, isNew: false, reason: 'DUPLICATE_DATE' };
    const stored = Object.assign({ recordedAt: new Date().toISOString() }, observation);
    this.store.append(stored);
    return { stored, isNew: true, reason: 'NEW_OBSERVATION' };
  }

  async listObservations(filter) {
    filter = filter || {};
    return this.store.filter((o) => !filter.from || o.date >= filter.from).sort((a, b) => a.date.localeCompare(b.date));
  }
}

module.exports = { LocalAipRepository };

'use strict';

const { ErrorRepository } = require('../base');
const { LocalJsonStore } = require('./LocalJsonStore');

class LocalErrorRepository extends ErrorRepository {
  constructor(dir) {
    super();
    this.store = new LocalJsonStore('tgp_extraction_errors.json', dir);
  }

  async record(errorRecord) {
    const required = ['supplierId', 'stage', 'error'];
    const missing = required.filter((k) => !errorRecord[k]);
    if (missing.length) throw new Error('ErrorRepository.record missing required fields: ' + missing.join(', '));
    const stored = Object.assign({
      id: 'err_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
    }, errorRecord);
    this.store.append(stored);
    return stored;
  }

  async list(filter) {
    filter = filter || {};
    return this.store.filter((e) => !filter.supplierId || e.supplierId === filter.supplierId);
  }
}

module.exports = { LocalErrorRepository };

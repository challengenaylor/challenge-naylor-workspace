'use strict';

const crypto = require('crypto');
const { DocumentRepository } = require('../base');
const { LocalJsonStore } = require('./LocalJsonStore');

/** SHA-256 of a string or Buffer. */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * File-backed document audit trail. Real duplicate-document detection: the
 * SAME hash under a DIFFERENT filename is recognised as the same document;
 * a DIFFERENT hash under the SAME filename (a supplier re-publishing under
 * an unchanged name) is recognised as a genuinely new document.
 */
class LocalDocumentRepository extends DocumentRepository {
  constructor(dir) {
    super();
    this.store = new LocalJsonStore('tgp_source_documents.json', dir);
  }

  async findByHash(sha256Hash) {
    return this.store.find((d) => d.sha256 === sha256Hash);
  }

  async record(documentMeta) {
    if (!documentMeta.sha256) throw new Error('DocumentRepository.record requires sha256');
    const existing = await this.findByHash(documentMeta.sha256);
    if (existing) {
      return { stored: existing, isNewDocument: false, reason: 'DUPLICATE_DOCUMENT_HASH' };
    }
    const stored = Object.assign({ recordedAt: new Date().toISOString() }, documentMeta);
    this.store.append(stored);
    return { stored, isNewDocument: true, reason: 'NEW_DOCUMENT' };
  }

  async list(filter) {
    filter = filter || {};
    return this.store.filter((d) => !filter.supplierId || d.supplierId === filter.supplierId);
  }
}

module.exports = { LocalDocumentRepository, sha256 };

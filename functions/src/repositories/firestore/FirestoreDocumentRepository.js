'use strict';

const crypto = require('crypto');
const { DocumentRepository } = require('../base');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** tgpApp/sourceDocuments/{sha256} — doc ID IS the hash, so duplicate detection is a single doc read. */
class FirestoreDocumentRepository extends DocumentRepository {
  constructor(db) {
    super();
    this.col = db.collection('tgpApp').doc('_').collection('sourceDocuments');
  }

  async findByHash(sha256Hash) {
    const doc = await this.col.doc(sha256Hash).get();
    return doc.exists ? doc.data() : null;
  }

  async record(documentMeta) {
    if (!documentMeta.sha256) throw new Error('DocumentRepository.record requires sha256');
    const ref = this.col.doc(documentMeta.sha256);
    const existing = await ref.get();
    if (existing.exists) {
      return { stored: existing.data(), isNewDocument: false, reason: 'DUPLICATE_DOCUMENT_HASH' };
    }
    const stored = Object.assign({ recordedAt: new Date().toISOString() }, documentMeta);
    await ref.set(stored);
    return { stored, isNewDocument: true, reason: 'NEW_DOCUMENT' };
  }

  async list(filter) {
    filter = filter || {};
    let q = this.col;
    if (filter.supplierId) q = q.where('supplierId', '==', filter.supplierId);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }
}

module.exports = { FirestoreDocumentRepository, sha256 };

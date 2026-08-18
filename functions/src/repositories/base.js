'use strict';

/**
 * Repository interfaces. Every method throws "not implemented" — a concrete
 * adapter (Local* now, Firestore* later) must override every one of them.
 *
 * THE POINT OF THIS FILE: the extraction and validation engines (connectors/,
 * validation/, orchestrator.js) depend ONLY on these interfaces, never on a
 * concrete adapter or on Firestore. Swapping Local* for Firestore* later means
 * writing new files in repositories/firestore/, not touching business logic.
 */

class PriceRepository {
  /** @returns {Promise<object|null>} the current valid price for this identity, or null */
  async getCurrent(_supplierId, _terminalId, _productId) { throw new Error('PriceRepository.getCurrent not implemented'); }
  /** Store a newly VALID price. Must move the prior current price to history, never overwrite it. */
  async putCurrent(_priceRecord) { throw new Error('PriceRepository.putCurrent not implemented'); }
  /** @returns {Promise<object[]>} immutable historical records for this identity */
  async getHistory(_supplierId, _terminalId, _productId) { throw new Error('PriceRepository.getHistory not implemented'); }
  async listCurrent(_filter) { throw new Error('PriceRepository.listCurrent not implemented'); }
}

class DocumentRepository {
  /** @returns {Promise<object|null>} existing document metadata by hash, or null if never seen */
  async findByHash(_sha256) { throw new Error('DocumentRepository.findByHash not implemented'); }
  async record(_documentMeta) { throw new Error('DocumentRepository.record not implemented'); }
  async list(_filter) { throw new Error('DocumentRepository.list not implemented'); }
}

class ReviewRepository {
  /** Queue a NEEDS_REVIEW extraction result for admin attention. */
  async enqueue(_reviewRecord) { throw new Error('ReviewRepository.enqueue not implemented'); }
  async listPending() { throw new Error('ReviewRepository.listPending not implemented'); }
  /**
   * Auto-resolve any pending entries for this exact supplier+terminal+product
   * — called after a later run successfully validates a price for that same
   * identity, so a fixed problem doesn't sit in the queue forever looking
   * like it's still happening. Distinct from recordCorrection(), which is an
   * admin manually fixing one specific record.
   */
  async resolveSuperseded(_supplierId, _terminalRaw, _productRaw) { throw new Error('ReviewRepository.resolveSuperseded not implemented'); }
  /** Record an admin correction. The original extracted record is never mutated. */
  async recordCorrection(_correction) { throw new Error('ReviewRepository.recordCorrection not implemented'); }
  async listCorrections(_filter) { throw new Error('ReviewRepository.listCorrections not implemented'); }
}

class ErrorRepository {
  async record(_errorRecord) { throw new Error('ErrorRepository.record not implemented'); }
  async list(_filter) { throw new Error('ErrorRepository.list not implemented'); }
}

class ChallengePriceRepository {
  /** Create-only. There is deliberately no update() or delete() on this interface. */
  async create(_entry) { throw new Error('ChallengePriceRepository.create not implemented'); }
  async list(_filter) { throw new Error('ChallengePriceRepository.list not implemented'); }
  /** A correction is a new record referencing the original; the original is untouched. */
  async correct(_correction) { throw new Error('ChallengePriceRepository.correct not implemented'); }
}

class AipRepository {
  /** Append-only. Implementations must dedupe by observation date. */
  async recordObservation(_observation) { throw new Error('AipRepository.recordObservation not implemented'); }
  async listObservations(_filter) { throw new Error('AipRepository.listObservations not implemented'); }
}

module.exports = { PriceRepository, DocumentRepository, ReviewRepository, ErrorRepository, ChallengePriceRepository, AipRepository };

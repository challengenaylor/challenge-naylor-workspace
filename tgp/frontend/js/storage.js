/* ==========================================================================
   TGP.storage — Challenge pricing, now written to real Firestore instead of
   localStorage. Same create-only + correction contract as before: there is
   still no update() or delete() — a correction is a new document
   referencing the original, the original is never touched.
   ========================================================================== */
(function (global) {
  'use strict';

  function col() {
    return global.TGP.db.collection('tgpApp').doc('_').collection('challengePricing');
  }

  async function getChallengePrices() {
    const snap = await col().orderBy('effectiveDate', 'desc').get();
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  }

  async function addChallengePrice(entry) {
    const record = {
      regionId: entry.regionId,
      productId: entry.productId,
      preGstPrice: entry.preGstPrice,  // reference — the figure you actually entered, before GST
      finalPrice: entry.finalPrice,     // GST-inclusive — used for competitor comparisons
      effectiveDate: entry.effectiveDate,
      notes: entry.notes || '',
      source: 'MANUAL_ADMIN_ENTRY',
      enteredAt: new Date().toISOString(),
    };
    const ref = await col().add(record);
    return Object.assign({ id: ref.id }, record);
  }

  /**
   * Replaces correctChallengePrice() — now edits ANY field (terminal,
   * product, effective date, price), not just price. Still fully
   * create-only: this writes a NEW record referencing the original via
   * correctionOf, never mutates the original document. If the terminal or
   * product changed, the entry correctly "moves" to its new group when the
   * dashboard re-groups by the LATEST (corrected) region/product rather
   * than the original's.
   */
  async function editChallengePrice(originalId, edits, reason) {
    if (!reason || !reason.trim()) throw new Error('An edit requires a reason.');
    const originalDoc = await col().doc(originalId).get();
    if (!originalDoc.exists) throw new Error('Cannot edit a Challenge price that does not exist.');
    const original = originalDoc.data();

    const record = {
      regionId: edits.regionId,
      productId: edits.productId,
      preGstPrice: edits.preGstPrice,
      finalPrice: edits.finalPrice,
      effectiveDate: edits.effectiveDate,
      notes: edits.notes || '',
      source: 'MANUAL_ADMIN_ENTRY',
      enteredAt: new Date().toISOString(),
      correctionOf: originalId,
      originalValue: original.finalPrice,
      correctionReason: reason.trim(),
    };
    const ref = await col().add(record);
    return Object.assign({ id: ref.id }, record);
  }

  /**
   * Soft-delete: writes a new record referencing the original, flagged
   * isDeletion:true — the original is never removed or touched, matching
   * the create-only contract (your Firestore rules have no delete
   * permission at all, by design, and this doesn't need one). The
   * dashboard hides any entry whose LATEST record is a deletion; recovering
   * is just a matter of the entry still being there in Firestore if you
   * ever need it restored.
   */
  async function deleteChallengePrice(originalId, reason) {
    if (!reason || !reason.trim()) throw new Error('Deleting an entry requires a reason.');
    const originalDoc = await col().doc(originalId).get();
    if (!originalDoc.exists) throw new Error('Cannot delete a Challenge price that does not exist.');
    const original = originalDoc.data();

    const record = {
      regionId: original.regionId,
      productId: original.productId,
      preGstPrice: original.preGstPrice,
      finalPrice: original.finalPrice,
      effectiveDate: original.effectiveDate,
      notes: original.notes,
      source: 'MANUAL_ADMIN_ENTRY',
      enteredAt: new Date().toISOString(),
      correctionOf: originalId,
      originalValue: original.finalPrice,
      correctionReason: reason.trim(),
      isDeletion: true,
    };
    const ref = await col().add(record);
    return Object.assign({ id: ref.id }, record);
  }

  global.TGP = global.TGP || {};
  global.TGP.storage = { getChallengePrices, addChallengePrice, editChallengePrice, deleteChallengePrice };
}(window));

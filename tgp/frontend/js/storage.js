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
      finalPrice: entry.finalPrice,
      effectiveDate: entry.effectiveDate,
      notes: entry.notes || '',
      source: 'MANUAL_ADMIN_ENTRY',
      enteredAt: new Date().toISOString(),
    };
    const ref = await col().add(record);
    return Object.assign({ id: ref.id }, record);
  }

  async function correctChallengePrice(originalId, correctedValue, reason) {
    if (!reason || !reason.trim()) throw new Error('A correction requires a reason.');
    const originalDoc = await col().doc(originalId).get();
    if (!originalDoc.exists) throw new Error('Cannot correct a Challenge price that does not exist.');
    const original = originalDoc.data();

    const record = {
      regionId: original.regionId,
      productId: original.productId,
      finalPrice: correctedValue,
      effectiveDate: original.effectiveDate,
      notes: original.notes,
      source: 'MANUAL_ADMIN_ENTRY',
      enteredAt: new Date().toISOString(),
      correctionOf: originalId,
      originalValue: original.finalPrice,
      correctionReason: reason.trim(),
    };
    const ref = await col().add(record);
    return Object.assign({ id: ref.id }, record);
  }

  global.TGP = global.TGP || {};
  global.TGP.storage = { getChallengePrices, addChallengePrice, correctChallengePrice };
}(window));

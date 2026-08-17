/* ==========================================================================
   TGP.storage — Challenge pricing persistence for this standalone phase.

   UPDATED this phase: Challenge pricing is now create-only, matching the
   real backend's LocalChallengePriceRepository (see
   tgp/functions/src/repositories/local/LocalChallengePriceRepository.js).
   There is deliberately no update() and no delete() — a correction is a
   NEW record referencing the original by id; the original is never
   mutated. The previous version of this file allowed free in-place editing,
   which was flagged as a demo-only shortcut and has now been removed to
   match production behaviour, exactly as instructed.
   ========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'tgp_challenge_prices_v2';

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('TGP.storage: localStorage unavailable or corrupt, starting empty.', e);
      return [];
    }
  }

  function writeAll(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('TGP.storage: could not save to localStorage.', e);
      return false;
    }
  }

  function makeId() {
    return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getChallengePrices() {
    return readAll().sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }

  /** Create-only. This is the ONLY way a fresh Challenge price enters storage. */
  function addChallengePrice(entry) {
    const list = readAll();
    const record = {
      id: makeId(),
      source: 'MANUAL_ADMIN_ENTRY',
      regionId: entry.regionId,
      productId: entry.productId,
      finalPrice: entry.finalPrice,
      effectiveDate: entry.effectiveDate,
      notes: entry.notes || '',
      enteredAt: new Date().toISOString(),
    };
    list.push(record);
    writeAll(list);
    return record;
  }

  /**
   * A correction is a NEW record. The original is looked up for its prior
   * value (recorded on the correction for audit) but is never rewritten.
   */
  function correctChallengePrice(originalId, correctedValue, reason) {
    const list = readAll();
    const original = list.find((r) => r.id === originalId);
    if (!original) throw new Error('Cannot correct a Challenge price that does not exist.');
    if (!reason || !reason.trim()) throw new Error('A correction requires a reason.');

    const record = {
      id: makeId(),
      source: 'MANUAL_ADMIN_ENTRY',
      regionId: original.regionId,
      productId: original.productId,
      finalPrice: correctedValue,
      effectiveDate: original.effectiveDate,
      notes: original.notes,
      enteredAt: new Date().toISOString(),
      correctionOf: original.id,
      originalValue: original.finalPrice,
      correctionReason: reason.trim(),
    };
    list.push(record);
    writeAll(list);
    return record;
  }

  function seedIfEmpty(defaults) {
    if (readAll().length === 0 && Array.isArray(defaults) && defaults.length) {
      writeAll(defaults.map((d) => Object.assign({ id: makeId(), source: 'MANUAL_ADMIN_ENTRY', enteredAt: new Date().toISOString() }, d)));
    }
  }

  global.TGP = global.TGP || {};
  global.TGP.storage = { getChallengePrices, addChallengePrice, correctChallengePrice, seedIfEmpty };
}(window));

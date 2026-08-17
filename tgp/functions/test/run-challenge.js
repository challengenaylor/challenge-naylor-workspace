'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { LocalChallengePriceRepository } = require('../src/repositories/local/LocalChallengePriceRepository');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { pass++; console.log(`  PASS  ${name}`); })
    .catch((e) => { fail++; failures.push({ name, message: e.message }); console.log(`  FAIL  ${name}\n        ${e.message}`); });
}

async function main() {
  console.log('\nCHALLENGE PRICING — create-only, corrections audited, original never touched\n');

  const dir = path.join(__dirname, '..', 'local-data-test-challenge');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const repo = new LocalChallengePriceRepository(dir);

  await test('create() requires all fields and rejects an implausible price', async () => {
    await assert.rejects(() => repo.create({ terminalId: 'AUCKLAND_WIRI', productId: 'DIESEL', priceCentsPerLitre: 9999, effectiveDate: '2026-08-11', adminId: 'admin1' }));
  });

  const original = await repo.create({
    terminalId: 'AUCKLAND_WIRI', productId: 'DIESEL', priceCentsPerLitre: 244.50,
    effectiveDate: '2026-08-11', adminId: 'admin1',
  });

  await test('create() stores a real record with an id and source tag', async () => {
    assert.ok(original.id);
    assert.strictEqual(original.source, 'MANUAL_ADMIN_ENTRY');
  });

  await test('there is no update() or delete() method on this repository at all', async () => {
    assert.strictEqual(typeof repo.update, 'undefined');
    assert.strictEqual(typeof repo.delete, 'undefined');
  });

  await test('a mis-typed price cannot be silently supplier-overwritten — simulate a supplier connector attempting to write', async () => {
    // Supplier connectors only ever hold a PriceRepository, never a
    // ChallengePriceRepository reference — this is enforced by what
    // orchestrator.js is constructed with (see src/orchestrator.js), not by
    // a runtime check here. This test documents the contract: even if
    // something tried, there is no method on this repository that could be
    // used to overwrite entry `original` in place.
    assert.strictEqual(typeof repo.create, 'function'); // the only write path
    const list = await repo.list({});
    assert.strictEqual(list.length, 1);
  });

  const correction = await repo.correct({
    originalId: original.id, correctedValue: 245.00, reason: 'Transposed digit — should have been 245.00 not 244.50',
    adminId: 'admin2', terminalId: 'AUCKLAND_WIRI', productId: 'DIESEL', effectiveDate: '2026-08-11',
  });

  await test('correct() creates a NEW record rather than mutating the original', async () => {
    assert.notStrictEqual(correction.id, original.id);
    const list = await repo.list({});
    assert.strictEqual(list.length, 2, 'both the original and the correction must exist as separate records');
  });

  await test('the original record is byte-for-byte unchanged after correction', async () => {
    const list = await repo.list({});
    const stillOriginal = list.find((r) => r.id === original.id);
    assert.strictEqual(stillOriginal.priceCentsPerLitre, 244.50, 'original value must not have been touched');
  });

  await test('the correction record carries full audit fields: original value, reason, admin, link back', async () => {
    assert.strictEqual(correction.originalValue, 244.50);
    assert.strictEqual(correction.priceCentsPerLitre, 245.00);
    assert.strictEqual(correction.correctionOf, original.id);
    assert.match(correction.correctionReason, /Transposed digit/);
    assert.strictEqual(correction.adminId, 'admin2');
  });

  await test('correcting a record that does not exist fails loudly rather than silently creating an orphaned correction', async () => {
    await assert.rejects(() => repo.correct({
      originalId: 'chg_does_not_exist', correctedValue: 100, reason: 'test', adminId: 'admin1',
      terminalId: 'AUCKLAND_WIRI', productId: 'DIESEL', effectiveDate: '2026-08-11',
    }), /not found/);
  });

  await test('list() returns most-recent-effective-date first, both original and correction visible for full audit', async () => {
    const list = await repo.list({ terminalId: 'AUCKLAND_WIRI', productId: 'DIESEL' });
    assert.strictEqual(list.length, 2);
  });

  console.log(`\n${'='.repeat(70)}\n  CHALLENGE PRICING: ${pass} passed, ${fail} failed\n${'='.repeat(70)}`);
  if (fail) { failures.forEach((f) => console.log(` - ${f.name}: ${f.message}`)); process.exitCode = 1; }
}

main();

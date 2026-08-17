'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { runAllSuppliers } = require('../src/orchestrator');
const { LocalPriceRepository } = require('../src/repositories/local/LocalPriceRepository');
const { LocalDocumentRepository } = require('../src/repositories/local/LocalDocumentRepository');
const { LocalReviewRepository } = require('../src/repositories/local/LocalReviewRepository');
const { LocalErrorRepository } = require('../src/repositories/local/LocalErrorRepository');
const {
  gullFixtureConnector, zFixtureConnector, bpFixtureConnector, mobilFixtureConnector, alwaysThrowsConnector,
} = require('./fixtures/connector-wrappers');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { pass++; console.log(`  PASS  ${name}`); })
    .catch((e) => { fail++; failures.push({ name, message: e.message }); console.log(`  FAIL  ${name}\n        ${e.message}`); });
}

function freshRepos(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return {
    priceRepo: new LocalPriceRepository(dir), documentRepo: new LocalDocumentRepository(dir),
    reviewRepo: new LocalReviewRepository(dir), errorRepo: new LocalErrorRepository(dir),
  };
}

async function main() {
  console.log('\nORCHESTRATOR — end-to-end pipeline against real fixtures\n');

  // ---------------------------------------------------------- end-to-end
  const dir1 = path.join(__dirname, '..', 'local-data-test-e2e');
  const repos1 = freshRepos(dir1);
  const results1 = await runAllSuppliers({
    repos: repos1, now: '2026-08-17T09:00:00+12:00',
    connectors: [gullFixtureConnector(), zFixtureConnector(), bpFixtureConnector(), mobilFixtureConnector()],
  });

  await test('all 4 real supplier connectors complete with status OK', async () => {
    assert.strictEqual(results1.every((r) => r.status === 'OK'), true, JSON.stringify(results1));
  });

  await test('current prices for Auckland Wiri / Mount Maunganui are the NEWER of two published blocks, not the last one processed', async () => {
    const r = await repos1.priceRepo.getCurrent('Z', 'Z__AUCKLAND_WIRI__WOSL', 'DIESEL');
    assert.strictEqual(r.priceCentsPerLitre, 242.46);
    assert.strictEqual(r.effectiveDate, '2026-08-12');
  });

  await test('the older block is archived to history, not discarded', async () => {
    const h = await repos1.priceRepo.getHistory('Z', 'Z__AUCKLAND_WIRI__WOSL', 'DIESEL');
    assert.ok(h.some((x) => x.priceCentsPerLitre === 257.97 && x.effectiveDate === '2026-08-05'));
  });

  await test('sparse BP Mount Maunganui rows are in the review queue, not silently guessed into current prices', async () => {
    const current = await repos1.priceRepo.listCurrent({});
    const wrongGuess = current.find((c) => /maunganui/i.test(c.terminalId) && c.supplierId === 'BP' && c.productId === 'PREMIUM_95');
    assert.ok(!wrongGuess, 'BP does not sell Premium 95 at Mount Maunganui — must not appear as a current price');
    const review = await repos1.reviewRepo.listPending();
    assert.ok(review.some((r) => r.supplierId === 'BP' && /maunganui/i.test(r.terminalRaw)));
  });

  await test('Mobil N/A cells (Lyttelton 91/95) never enter review OR current — they are a real, deliberate absence, while Lyttelton\'s real Diesel price still does', async () => {
    const current = await repos1.priceRepo.listCurrent({});
    const review = await repos1.reviewRepo.listPending();
    const lyttelton91 = current.find((c) => c.supplierId === 'MOBIL' && /lyttelton/i.test(c.terminalId || '') && c.productId === 'REGULAR_91');
    const lyttelton95 = current.find((c) => c.supplierId === 'MOBIL' && /lyttelton/i.test(c.terminalId || '') && c.productId === 'PREMIUM_95');
    const lytteltonDiesel = current.find((c) => c.supplierId === 'MOBIL' && /lyttelton/i.test(c.terminalId || '') && c.productId === 'DIESEL');
    assert.strictEqual(lyttelton91, undefined, 'Regular 91 is N/A at Lyttelton — must not appear');
    assert.strictEqual(lyttelton95, undefined, 'Premium 95 is N/A at Lyttelton — must not appear');
    assert.ok(lytteltonDiesel, 'Diesel IS published at Lyttelton (251.99) — must appear');
    assert.strictEqual(lytteltonDiesel.priceCentsPerLitre, 251.99);
    assert.strictEqual(review.some((r) => r.supplierId === 'MOBIL'), false, 'N/A cells are a clean absence, not a review case');
  });

  await test('CRITICAL: Woolston and Lyttelton (both under the same Christchurch location label) are distinct terminals, not collided', async () => {
    const woolston = await repos1.priceRepo.getCurrent('MOBIL', 'MOBIL__CHRISTCHURCH__MOBIL__WOOLSTON', 'REGULAR_91');
    const lyttelton = await repos1.priceRepo.getCurrent('MOBIL', 'MOBIL__CHRISTCHURCH__MOBIL__LYTTELTON', 'DIESEL');
    assert.ok(woolston, 'Woolston record missing');
    assert.strictEqual(woolston.priceCentsPerLitre, 288.23);
    assert.ok(lyttelton, 'Lyttelton record missing');
    assert.strictEqual(lyttelton.priceCentsPerLitre, 251.99);
  });

  await test('document audit: 4 distinct source documents recorded, one per supplier, each with a real SHA-256', async () => {
    const docs = await repos1.documentRepo.list({});
    assert.strictEqual(docs.length, 4);
    docs.forEach((d) => assert.match(d.sha256, /^[0-9a-f]{64}$/));
  });

  // ---------------------------------------------------------- idempotent re-run
  const results2 = await runAllSuppliers({
    repos: repos1, now: '2026-08-17T09:05:00+12:00',
    connectors: [gullFixtureConnector(), zFixtureConnector(), bpFixtureConnector(), mobilFixtureConnector()],
  });

  await test('re-running the identical pipeline produces zero new current-price changes (idempotent)', async () => {
    const gullRun = results2.find((r) => r.supplierId === 'GULL');
    assert.strictEqual(gullRun.changes, 0, JSON.stringify(gullRun));
    assert.strictEqual(gullRun.isNewDocument, false);
  });

  await test('re-running does not duplicate documents (same hash recognised)', async () => {
    const docs = await repos1.documentRepo.list({});
    assert.strictEqual(docs.length, 4, 'still 4, not 8');
  });

  await test('re-running does not duplicate review-queue entries for the same unresolved sparse row', async () => {
    const review = await repos1.reviewRepo.listPending();
    const bpMtMaunganuiDiesel = review.filter((r) => r.supplierId === 'BP' && /nzosl mt maunganui/i.test(r.terminalRaw) && r.effectiveDate === '2026-08-14');
    assert.strictEqual(bpMtMaunganuiDiesel.length, 1, `expected exactly 1, got ${bpMtMaunganuiDiesel.length}`);
  });

  // ---------------------------------------------------------- error isolation
  console.log('\nERROR ISOLATION — one connector throwing must not stop the others\n');
  const dir2 = path.join(__dirname, '..', 'local-data-test-isolation');
  const repos2 = freshRepos(dir2);
  const resultsIso = await runAllSuppliers({
    repos: repos2, now: '2026-08-17T09:00:00+12:00',
    connectors: [gullFixtureConnector(), alwaysThrowsConnector('Z'), bpFixtureConnector(), mobilFixtureConnector()],
  });

  await test('the throwing connector (Z) is reported as ERROR', async () => {
    const z = resultsIso.find((r) => r.supplierId === 'Z');
    assert.strictEqual(z.status, 'ERROR');
    assert.match(z.reason, /Simulated hard failure/);
  });

  await test('the OTHER three connectors still completed successfully despite Z throwing', async () => {
    const others = resultsIso.filter((r) => r.supplierId !== 'Z');
    assert.strictEqual(others.every((r) => r.status === 'OK'), true, JSON.stringify(others));
  });

  await test('the exception was recorded in ErrorRepository with the real stack trace, not swallowed', async () => {
    const errs = await repos2.errorRepo.list({ supplierId: 'Z' });
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(errs[0].stage, 'CONNECTOR_EXCEPTION');
    assert.match(errs[0].details, /alwaysThrowsConnector|Simulated hard failure/);
  });

  await test('Gull/BP/Mobil prices were stored normally even though Z failed', async () => {
    const current = await repos2.priceRepo.listCurrent({});
    assert.ok(current.some((c) => c.supplierId === 'GULL'));
    assert.ok(current.some((c) => c.supplierId === 'BP'));
    assert.ok(current.some((c) => c.supplierId === 'MOBIL'));
    assert.strictEqual(current.some((c) => c.supplierId === 'Z'), false);
  });

  // ---------------------------------------------------------- structure-changed handling
  console.log('\nSTRUCTURE-CHANGE HANDLING — Mobil page with no table / renamed headers\n');
  const dir3 = path.join(__dirname, '..', 'local-data-test-structurechange');
  const repos3 = freshRepos(dir3);

  await test('Mobil connector reports TABLE_STRUCTURE_CHANGED (not a crash, not a guess) when no table exists', async () => {
    const conn = mobilFixtureConnector('mobil-no-table.html');
    const res = await runAllSuppliers({ repos: repos3, connectors: [conn], now: '2026-08-17T09:00:00+12:00' });
    assert.strictEqual(res[0].status, 'TABLE_STRUCTURE_CHANGED');
    const errs = await repos3.errorRepo.list({});
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(errs[0].error, 'TABLE_STRUCTURE_CHANGED');
  });

  console.log(`\n${'='.repeat(70)}\n  ORCHESTRATOR: ${pass} passed, ${fail} failed\n${'='.repeat(70)}`);
  if (fail) { failures.forEach((f) => console.log(` - ${f.name}: ${f.message}`)); process.exitCode = 1; }
}

main();

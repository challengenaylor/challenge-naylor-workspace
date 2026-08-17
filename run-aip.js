'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { sma, direction } = require('../src/analytics/aip-sma');
const { LocalAipRepository } = require('../src/repositories/local/LocalAipRepository');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { pass++; console.log(`  PASS  ${name}`); })
    .catch((e) => { fail++; failures.push({ name, message: e.message }); console.log(`  FAIL  ${name}\n        ${e.message}`); });
}

/**
 * FIXTURE data only — illustrative numbers to exercise the SMA math, never
 * real AIP prices (the real AIP workbook's bytes were never obtained; see
 * connectors/aip.js). This array is never passed anywhere near
 * AipRepository.recordObservation(), which enforces that separation at
 * runtime (see test below).
 */
const FIXTURE_UPWARD = [
  { date: '2026-08-03', ulp: 170.0 }, { date: '2026-08-04', ulp: 170.5 }, { date: '2026-08-05', ulp: 171.0 },
  { date: '2026-08-06', ulp: 171.8 }, { date: '2026-08-07', ulp: 172.5 }, { date: '2026-08-10', ulp: 173.2 },
  { date: '2026-08-11', ulp: 174.0 }, { date: '2026-08-12', ulp: 174.9 }, { date: '2026-08-13', ulp: 175.8 },
  { date: '2026-08-14', ulp: 176.9 },
];
const FIXTURE_DOWNWARD = [
  { date: '2026-08-03', ulp: 176.9 }, { date: '2026-08-04', ulp: 176.2 }, { date: '2026-08-05', ulp: 175.5 },
  { date: '2026-08-06', ulp: 174.6 }, { date: '2026-08-07', ulp: 173.8 }, { date: '2026-08-10', ulp: 173.0 },
  { date: '2026-08-11', ulp: 172.1 }, { date: '2026-08-12', ulp: 171.2 }, { date: '2026-08-13', ulp: 170.2 },
  { date: '2026-08-14', ulp: 169.1 },
];
const FIXTURE_FLAT = FIXTURE_UPWARD.map((o) => ({ date: o.date, ulp: 172.0 + (o.date.charCodeAt(9) % 2 === 0 ? 0.02 : -0.02) }));

async function main() {
  console.log('\nAIP ANALYTICS — SMA/direction against clearly-labeled fixture data ONLY\n');

  await test('sma() reports INSUFFICIENT_DATA below the window size, never a partial guess', async () => {
    const r = sma(FIXTURE_UPWARD.slice(0, 2), 3, 'ulp');
    assert.strictEqual(r.status, 'INSUFFICIENT_DATA');
  });

  await test('sma(3) computes correctly over a real window of the fixture', async () => {
    const r = sma(FIXTURE_UPWARD, 3, 'ulp');
    assert.strictEqual(r.status, 'OK');
    const expected = +((174.9 + 175.8 + 176.9) / 3).toFixed(2);
    assert.strictEqual(r.value, expected);
  });

  await test('direction() with fewer than 10 observations is INSUFFICIENT_DATA even if 3-obs SMA is available', async () => {
    const d = direction(FIXTURE_UPWARD.slice(0, 5), 'ulp');
    assert.strictEqual(d.state, 'INSUFFICIENT_DATA');
  });

  await test('direction() correctly reports UPWARD on a genuinely rising fixture series', async () => {
    const d = direction(FIXTURE_UPWARD, 'ulp');
    assert.strictEqual(d.state, 'UPWARD', JSON.stringify(d));
  });

  await test('direction() correctly reports DOWNWARD on a genuinely falling fixture series', async () => {
    const d = direction(FIXTURE_DOWNWARD, 'ulp');
    assert.strictEqual(d.state, 'DOWNWARD', JSON.stringify(d));
  });

  await test('direction() correctly reports NEUTRAL on a flat/noisy fixture series', async () => {
    const d = direction(FIXTURE_FLAT, 'ulp');
    assert.strictEqual(d.state, 'NEUTRAL', JSON.stringify(d));
  });

  await test('direction() never returns a numeric confidence percentage — only a state and the real SMA values behind it', async () => {
    const d = direction(FIXTURE_UPWARD, 'ulp');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'confidencePercent'), false);
  });

  // ---------------------------------------------------------------- repository guard
  console.log('\nAIP REPOSITORY — refuses anything not explicitly marked as a live fetch\n');
  const dir = path.join(__dirname, '..', 'local-data-test-aip');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const repo = new LocalAipRepository(dir);

  await test('CRITICAL: recordObservation() rejects a fixture/demo-looking observation with no origin tag', async () => {
    await assert.rejects(() => repo.recordObservation({ date: '2026-08-17', ulp: 170.0, source: 'test' }), /LIVE_FETCH/);
  });

  await test('CRITICAL: recordObservation() rejects an observation explicitly marked as synthetic', async () => {
    await assert.rejects(() => repo.recordObservation({ date: '2026-08-17', ulp: 170.0, source: 'test', origin: 'SYNTHETIC_RANDOM_WALK' }), /LIVE_FETCH/);
  });

  await test('recordObservation() accepts a properly tagged live observation', async () => {
    const r = await repo.recordObservation({ date: '2026-08-17', ulp: 174.66, diesel: 180.43, source: 'https://www.aip.com.au/pricing/terminal-gate-prices', origin: 'LIVE_FETCH' });
    assert.strictEqual(r.isNew, true);
  });

  await test('duplicate date is recognised, not double-recorded', async () => {
    const r = await repo.recordObservation({ date: '2026-08-17', ulp: 999, diesel: 999, source: 'x', origin: 'LIVE_FETCH' });
    assert.strictEqual(r.isNew, false);
    assert.strictEqual(r.reason, 'DUPLICATE_DATE');
  });

  await test('only 1 real observation exists after this test run — correctly INSUFFICIENT_DATA for direction()', async () => {
    const obs = await repo.listObservations({});
    assert.strictEqual(obs.length, 1);
    const d = direction(obs, 'ulp');
    assert.strictEqual(d.state, 'INSUFFICIENT_DATA');
  });

  console.log(`\n${'='.repeat(70)}\n  AIP ANALYTICS: ${pass} passed, ${fail} failed\n${'='.repeat(70)}`);
  console.log('\nNOTE: production has exactly ONE real AIP observation on file (today\'s),');
  console.log('because the workbook parser is NOT_IMPLEMENTED (see connectors/aip.js).');
  console.log('INSUFFICIENT_DATA is therefore the correct, honest current state of the');
  console.log('real system — not a bug and not something to work around with fixtures.');

  if (fail) { failures.forEach((f) => console.log(` - ${f.name}: ${f.message}`)); process.exitCode = 1; }
}

main();

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { GullConnector } = require('../src/connectors/gull');
const { ZConnector } = require('../src/connectors/z');
const { BPConnector } = require('../src/connectors/bp');
const { normaliseTerminal } = require('../src/core/terminals');
const { normaliseProduct } = require('../src/core/products');
const { detectGst, comparable } = require('../src/core/gst');
const { parseEffectiveDate } = require('../src/core/dates');
const { validatePriceRecord } = require('../src/core/validate');
const { isMeaningfulChange, priceRecordId } = require('../src/core/identity');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, message: e.message });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function section(t) { console.log(`\n${t}`); }

const find = (recs, terminalMatch, productId, effectiveDate) =>
  recs.find((r) =>
    r.terminalName.toLowerCase().includes(terminalMatch.toLowerCase()) &&
    r.productId === productId &&
    (!effectiveDate || r.effectiveDate === effectiveDate));

// ---------------------------------------------------------------- GULL
section('GULL — PDF, single terminal, date embedded in row');
{
  const c = new GullConnector();
  const text = fixture('gull-2026-08-14.txt');
  const { blocks } = c.extract(text);
  const { records, issues } = c.buildRecords({
    blocks, documentText: text,
    sourceUrl: c.sourceUrl,
    documentUrl: 'https://gull.nz/assets/Uploads/250e5ad555/TGP-effective-14AUG26.pdf',
    documentHash: 'fixture', extractionMethod: 'PDF_TEXT',
  });

  test('extracts both weekly blocks', () => assert.strictEqual(blocks.length, 2));

  test('leading date/time is not misread as a price', () => {
    const bad = records.filter((r) => r.publishedValue < 100);
    assert.strictEqual(bad.length, 0, `date fragments leaked as prices: ${JSON.stringify(bad.map(b => b.publishedValue))}`);
  });

  test('14 Aug Diesel = 238.86 c/L', () => {
    const r = find(records, 'Mt Maunganui', 'DIESEL', '2026-08-14');
    assert.ok(r, 'record not found');
    assert.strictEqual(r.publishedValue, 238.86);
  });

  test('14 Aug Regular 91 = 280.79 (column order R91,P95,Diesel respected)', () => {
    const r = find(records, 'Mt Maunganui', 'REGULAR_91', '2026-08-14');
    assert.strictEqual(r.publishedValue, 280.79);
  });

  test('14 Aug Premium 95 = 291.37', () => {
    const r = find(records, 'Mt Maunganui', 'PREMIUM_95', '2026-08-14');
    assert.strictEqual(r.publishedValue, 291.37);
  });

  test('maps to MOUNT_MAUNGANUI region', () => {
    const r = find(records, 'Mt Maunganui', 'DIESEL', '2026-08-14');
    assert.strictEqual(r.regionId, 'MOUNT_MAUNGANUI');
  });

  test('GST detected as included from Gull wording', () => {
    const r = records[0];
    assert.strictEqual(r.gstStatus, 'included');
  });

  test('no extraction issues raised', () => assert.strictEqual(issues.length, 0, JSON.stringify(issues)));
}

// ---------------------------------------------------------------- Z
section('Z ENERGY — PDF, multi-terminal, sparse rows present');
{
  const c = new ZConnector();
  const text = fixture('z-2026-08-12.txt');
  const { blocks } = c.extract(text);
  const { records, issues } = c.buildRecords({
    blocks, documentText: text,
    sourceUrl: c.sourceUrl,
    documentUrl: 'https://znz-webbackendassets-s3bucket-prod.s3.ap-southeast-2.amazonaws.com/public/zenergy/for-businesses/documents/TGP-Price-20260812.pdf',
    documentHash: 'fixture', extractionMethod: 'PDF_TEXT',
  });

  test('finds both effective-date blocks', () => assert.strictEqual(blocks.length, 2));

  test('Wiri Diesel 12 Aug = 242.46 c/L', () => {
    const r = find(records, 'Wiri', 'DIESEL', '2026-08-12');
    assert.ok(r, 'Wiri diesel missing');
    assert.strictEqual(r.publishedValue, 242.46);
  });

  test('Wiri Premium 95 = 292.76 (P95 is FIRST column for Z)', () => {
    const r = find(records, 'Wiri', 'PREMIUM_95', '2026-08-12');
    assert.strictEqual(r.publishedValue, 292.76);
  });

  test('Wiri Regular 91 = 274.04', () => {
    const r = find(records, 'Wiri', 'REGULAR_91', '2026-08-12');
    assert.strictEqual(r.publishedValue, 274.04);
  });

  test('Mount Maunganui North and South are SEPARATE terminals', () => {
    const north = find(records, 'North', 'DIESEL', '2026-08-12');
    const south = find(records, 'South', 'DIESEL', '2026-08-12');
    assert.ok(north && south, 'both Mt Maunganui terminals should exist');
    assert.notStrictEqual(north.terminalId, south.terminalId);
    assert.strictEqual(north.regionId, 'MOUNT_MAUNGANUI');
    assert.strictEqual(south.regionId, 'MOUNT_MAUNGANUI');
  });

  test('CRITICAL: sparse Lyttelton row is NOT positionally guessed', () => {
    const lyttelton = records.filter((r) => /lyttelton/i.test(r.terminalName));
    const wrong = lyttelton.find((r) => r.productId === 'PREMIUM_95' && r.publishedValue === 271.99);
    assert.ok(!wrong, 'Regular 91 price was published as Premium 95 — the exact failure this guards against');
  });

  test('sparse rows are raised as AMBIGUOUS_ROW issues instead', () => {
    const amb = issues.filter((i) => i.type === 'AMBIGUOUS_ROW');
    assert.ok(amb.length >= 2, `expected Lyttelton + Timaru South flagged, got ${amb.length}`);
  });

  test('ambiguous rows carry an explanatory reason', () => {
    const amb = issues.find((i) => i.type === 'AMBIGUOUS_ROW');
    assert.ok(/withheld|guess/i.test(amb.detail), amb.detail);
  });

  test('location column carried through for audit', () => {
    const r = find(records, 'Wiri', 'DIESEL', '2026-08-12');
    assert.strictEqual(r.originalLocationName, 'Auckland');
  });

  test('prior-week block also parsed (5 Aug Wiri diesel 257.97)', () => {
    const r = find(records, 'Wiri', 'DIESEL', '2026-08-05');
    assert.strictEqual(r.publishedValue, 257.97);
  });

  test('GST included; levies captured', () => {
    const r = records[0];
    assert.strictEqual(r.gstStatus, 'included');
    assert.ok(r.levies.includes('ETS'));
    assert.ok(r.levies.includes('ACC'));
  });
}

// ---------------------------------------------------------------- BP
section('BP — stable PDF URL, two terminals at one location');
{
  const c = new BPConnector();
  const text = fixture('bp-2026-08-14.txt');
  const { blocks } = c.extract(text);
  const { records, issues } = c.buildRecords({
    blocks, documentText: text, sourceUrl: c.sourceUrl,
    documentUrl: c.sourceUrl, documentHash: 'fixture', extractionMethod: 'PDF_TEXT',
  });

  test('Wiri Diesel 14 Aug = 250.25 c/L', () => {
    const r = find(records, 'Wiri', 'DIESEL', '2026-08-14');
    assert.ok(r, 'Wiri record missing');
    assert.strictEqual(r.publishedValue, 250.25);
  });

  test('Wiri M95 = 296.38 mapped to PREMIUM_95', () => {
    const r = find(records, 'Wiri', 'PREMIUM_95', '2026-08-14');
    assert.strictEqual(r.publishedValue, 296.38);
  });

  test('CRITICAL: single-value Mt Maunganui rows not misassigned', () => {
    const wrong = records.find((r) =>
      /maunganui/i.test(r.terminalName) && r.productId === 'PREMIUM_95' &&
      (r.publishedValue === 250.66 || r.publishedValue === 282.85));
    assert.ok(!wrong, 'a lone value was published under the wrong grade');
  });

  test('both Mt Maunganui rows flagged for review', () => {
    const amb = issues.filter((i) => i.type === 'AMBIGUOUS_ROW' && /maunganui/i.test(i.terminal));
    assert.ok(amb.length >= 2, `expected 2+, got ${amb.length}`);
  });

  test('BP terminal ids distinguish NZOSL from TNZ operator', () => {
    const a = normaliseTerminal('Mt Maunganui BP', { operatorColumn: 'NZOSL', supplierId: 'BP' });
    const b = normaliseTerminal('Mt Maunganui TNZ', { operatorColumn: 'TNZ', supplierId: 'BP' });
    assert.notStrictEqual(a.terminalId, b.terminalId);
  });
}

// ---------------------------------------------------------------- units
section('NORMALISATION');
{
  test('terminal aliases converge on AUCKLAND_WIRI', () => {
    const names = ['Wiri', 'Auckland (Wiri)', 'Wiri Oil Service Limited (WOSL)', 'Auckland Wiri Terminal'];
    for (const n of names) {
      assert.strictEqual(normaliseTerminal(n, { supplierId: 'X' }).regionId, 'AUCKLAND_WIRI', n);
    }
  });

  test('Mt / Mount Maunganui spellings converge', () => {
    for (const n of ['Mount Maunganui', 'Mt Maunganui', 'Mt. Maunganui', 'Z Mount Maunganui North']) {
      assert.strictEqual(normaliseTerminal(n, { supplierId: 'X' }).regionId, 'MOUNT_MAUNGANUI', n);
    }
  });

  test('unknown terminal flagged, not silently dropped', () => {
    const t = normaliseTerminal('Somewhere Unlisted Depot', { supplierId: 'X' });
    assert.strictEqual(t.status, 'UNKNOWN_TERMINAL');
  });

  test('product aliases across suppliers', () => {
    const cases = [
      ['M91', 'REGULAR_91'], ['Regular 91', 'REGULAR_91'], ['Unadditised Regular 91', 'REGULAR_91'],
      ['M95', 'PREMIUM_95'], ['Premium 95', 'PREMIUM_95'], ['Unadditised Premium 95', 'PREMIUM_95'],
      ['ADF', 'DIESEL'], ['Diesel', 'DIESEL'], ['Unadditised ULS Diesel', 'DIESEL'], ['ULSD 10PPM', 'DIESEL'],
    ];
    for (const [input, expected] of cases) {
      assert.strictEqual(normaliseProduct(input).productId, expected, input);
    }
  });

  test('Premium 95 never mis-caught as Regular 91', () => {
    assert.strictEqual(normaliseProduct('Premium 95 motor spirit').productId, 'PREMIUM_95');
  });

  test('unknown product flagged', () => {
    assert.strictEqual(normaliseProduct('Jet A-1').status, 'UNKNOWN_PRODUCT');
  });
}

// ---------------------------------------------------------------- dates
section('DATES');
{
  test('NZ day-first: 12/08/2026 is 12 August', () => {
    assert.strictEqual(parseEffectiveDate('Effective Date: 12/08/2026 0:01').effectiveDate, '2026-08-12');
  });
  test('single-digit day 7/08/2026', () => {
    assert.strictEqual(parseEffectiveDate('7/08/2026 12:00 AM').effectiveDate, '2026-08-07');
  });
  test('long form "Saturday 15 August 2026"', () => {
    assert.strictEqual(parseEffectiveDate('effective 12:01am Saturday 15 August 2026').effectiveDate, '2026-08-15');
  });
  test('Gull compact filename 14AUG26', () => {
    assert.strictEqual(parseEffectiveDate('TGP-effective-14AUG26.pdf').effectiveDate, '2026-08-14');
  });
  test('rejects impossible month rather than coercing', () => {
    assert.strictEqual(parseEffectiveDate('15/13/2026').status, 'DATE_PARSE_FAILED');
  });
  test('effective instant is 00:01 Pacific/Auckland', () => {
    const d = parseEffectiveDate('12/08/2026');
    assert.strictEqual(d.effectiveFromLocal, '2026-08-12T00:01:00');
    assert.strictEqual(d.timezone, 'Pacific/Auckland');
  });
}

// ---------------------------------------------------------------- GST
section('GST');
{
  test('Gull inclusive wording', () => {
    assert.strictEqual(detectGst('Prices quoted are inclusive of GST').gstStatus, 'included');
  });
  test('Z inclusive-with-levies wording', () => {
    const g = detectGst('Are NZ cents per litre including ETS and all applicable taxes (NLTF, PEFML, ACC, LAFT, RFT and GST)');
    assert.strictEqual(g.gstStatus, 'included');
    assert.ok(g.levies.includes('RFT'));
  });
  test('exclusive wording detected', () => {
    assert.strictEqual(detectGst('All prices are exclusive of GST').gstStatus, 'excluded');
  });
  test('silence yields not_stated, never a guess', () => {
    assert.strictEqual(detectGst('Prices in cents per litre').gstStatus, 'not_stated');
  });
  test('inclusive vs exclusive comparison is blocked', () => {
    assert.strictEqual(comparable({ gstStatus: 'included' }, { gstStatus: 'excluded' }).ok, false);
  });
  test('unknown GST blocks comparison even when both sides match', () => {
    assert.strictEqual(comparable({ gstStatus: 'not_stated' }, { gstStatus: 'not_stated' }).ok, false);
  });
}

// ---------------------------------------------------------------- validation
section('VALIDATION');
{
  const base = {
    supplierId: 'Z', terminalId: 'Z__AUCKLAND_WIRI', productId: 'DIESEL',
    effectiveDate: '2026-08-12', normalisedValue: 242.46, gstStatus: 'included',
  };
  test('good record publishes', () => {
    assert.strictEqual(validatePriceRecord(base).publishable, true);
  });
  test('decimal slip (24.246) rejected', () => {
    const v = validatePriceRecord({ ...base, normalisedValue: 24.246 });
    assert.strictEqual(v.publishable, false);
    assert.strictEqual(v.validationStatus, 'NEEDS_REVIEW');
  });
  test('dollars-per-litre confusion (2.42) rejected', () => {
    assert.strictEqual(validatePriceRecord({ ...base, normalisedValue: 2.4246 }).publishable, false);
  });
  test('non-numeric rejected', () => {
    assert.strictEqual(validatePriceRecord({ ...base, normalisedValue: 'n/a' }).publishable, false);
  });
  test('missing terminal rejected', () => {
    assert.strictEqual(validatePriceRecord({ ...base, terminalId: null }).publishable, false);
  });
  test('large jump warns but does not silently publish clean', () => {
    const v = validatePriceRecord({ ...base, normalisedValue: 340 }, { previous: { normalisedValue: 242.46 } });
    assert.ok(v.warnings.some((w) => w.startsWith('LARGE_MOVEMENT')));
  });
}

// ---------------------------------------------------------------- idempotency
section('IDEMPOTENCY');
{
  const rec = {
    supplierId: 'Z', terminalId: 'Z__AUCKLAND_WIRI', productId: 'DIESEL',
    effectiveDate: '2026-08-12', publishedValue: 242.46, gstStatus: 'included',
  };
  test('same document five times yields one id', () => {
    const ids = new Set(Array.from({ length: 5 }, () => priceRecordId(rec)));
    assert.strictEqual(ids.size, 1);
  });
  test('unchanged re-check is not a change', () => {
    assert.strictEqual(isMeaningfulChange(rec, { ...rec }).changed, false);
  });
  test('new effective date is a change', () => {
    assert.strictEqual(isMeaningfulChange({ ...rec, effectiveDate: '2026-08-19' }, rec).changed, true);
  });
  test('revised price for same date is a change', () => {
    const r = isMeaningfulChange({ ...rec, publishedValue: 243.0 }, rec);
    assert.strictEqual(r.reason, 'PRICE_REVISED_FOR_SAME_EFFECTIVE_DATE');
  });
  test('GST treatment change is a change', () => {
    assert.strictEqual(isMeaningfulChange({ ...rec, gstStatus: 'excluded' }, rec).changed, true);
  });
}

console.log(`\n${'='.repeat(58)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(58)}`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(` - ${f.name}: ${f.message}`));
  process.exit(1);
}

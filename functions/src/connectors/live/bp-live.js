'use strict';

const { extractBp } = require('../bp-header-driven');
const { extractBpCoordinates } = require('./bp-coordinates');
const { normalizeBp, normalizeBpCoordinates } = require('../../pipeline');
const { extractPdfAsLineText } = require('../../core/pdf-coordinates');

const SOURCE_URL = 'https://www.bp.com/content/dam/bp/country-sites/en_nz/new-zealand/home/documents/tgp-pricing-uploads/terminal-gate-prices-nz.pdf';

/**
 * BP has a stable, direct document URL (confirmed unchanged across every
 * live check in this project, 16-20 Aug 2026) — no landing-page discovery
 * hop needed, unlike Z and Gull.
 *
 * PRIMARY PATH: coordinate extraction (bp-coordinates.js), added 20 Aug
 * 2026. Text extraction alone correctly refuses to guess which grade a
 * value belongs to on a sparse row (a terminal selling fewer than 3
 * grades) — that's ~15 real terminals on BP's actual document, sitting in
 * NEEDS_REVIEW indefinitely even though the real answer is knowable from
 * each value's x-position on the page. Coordinate extraction reads that
 * position directly, tested against a synthetic PDF reproducing every real
 * sparse case this project has observed live (see
 * test/run-bp-coordinates.js) — 9/9 passing, all correctly resolved.
 *
 * FALLBACK: if coordinate extraction fails for any reason (a genuine PDF
 * parsing error, an unexpected structure), this falls back to the
 * text-based extractor rather than failing the whole connector — a review
 * item is still better than no data at all for that run.
 */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/pdf,text/html,*/*',
};

async function run() {
  const docRes = await fetch(SOURCE_URL, { headers: BROWSER_HEADERS });
  if (!docRes.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `BP PDF returned HTTP ${docRes.status}` };
  const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

  const documentText = await extractPdfAsLineText(pdfBuffer);

  try {
    const coordResult = await extractBpCoordinates(pdfBuffer);
    if (coordResult.status === 'OK') {
      const records = normalizeBpCoordinates(coordResult.blocks, documentText, 'BP');
      return {
        status: 'OK', sourceUrl: SOURCE_URL, documentUrl: SOURCE_URL,
        documentContent: pdfBuffer, extractionMethod: 'PDF_COORDINATE', records,
      };
    }
  } catch (err) {
    // Fall through to text extraction below — a coordinate-extraction
    // exception (e.g. an unexpected PDF internal structure) should not take
    // down the whole connector when the simpler text path might still work.
  }

  const result = extractBp(documentText);
  if (result.status !== 'OK') return result;
  const records = normalizeBp(result.blocks, documentText, 'BP');

  return {
    status: 'OK', sourceUrl: SOURCE_URL, documentUrl: SOURCE_URL,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_HEADER_DRIVEN', records,
  };
}

module.exports = { id: 'BP', run };

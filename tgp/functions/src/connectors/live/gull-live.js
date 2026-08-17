'use strict';

const { GullConnector } = require('../gull');
const { findGullDocument } = require('../discovery');
const { normalizeGull } = require('../../pipeline');

/**
 * Real, network-backed Gull connector. Wraps the already-tested discovery
 * (discovery.js) and extraction (gull.js) logic with an actual fetch() call
 * — this is the part that could NOT be tested in the sandbox this project
 * was built in (network egress there didn't reach gull.nz). This is the
 * "LIVE VERIFICATION REQUIRED" item finally getting a real network path;
 * whether it behaves exactly as expected against the live site is what the
 * first real scheduled run will tell us.
 */
/** Turn positioned PDF text items into row-per-line text, matching what a
 * normal PDF-to-text extraction produces — required because gull.js/z.js's
 * extract() methods split on newlines to find each row. */
const { extractPdfAsLineText } = require('../../core/pdf-coordinates');

async function run() {
  const c = new GullConnector();

  const landingRes = await fetch(c.sourceUrl);
  if (!landingRes.ok) {
    return { status: 'SOURCE_UNAVAILABLE', reason: `Gull landing page returned HTTP ${landingRes.status}` };
  }
  const landingHtml = await landingRes.text();

  const discovery = findGullDocument(landingHtml);
  if (discovery.status !== 'OK') return discovery;

  const docRes = await fetch(discovery.documentUrl);
  if (!docRes.ok) {
    return { status: 'SOURCE_UNAVAILABLE', reason: `Gull PDF returned HTTP ${docRes.status} at ${discovery.documentUrl}` };
  }
  const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

  // Text extraction is the tested, reliable path for Gull's simple
  // single-terminal layout (see connectors/gull.js). Coordinate extraction
  // (core/pdf-coordinates.js) is available if Gull's layout ever grows a
  // sparse-row/wrapped-label problem, but isn't needed for its current shape.
  const documentText = await extractPdfAsLineText(pdfBuffer);

  const { blocks } = c.extract(documentText);
  const records = normalizeGull(blocks, documentText, 'GULL');

  return {
    status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_EXACT_ARITY', records,
  };
}

module.exports = { id: 'GULL', run };

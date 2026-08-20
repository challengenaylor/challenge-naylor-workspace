'use strict';

const { ZConnector } = require('../z');
const { findZDocument } = require('../discovery');
const { extractZCoordinates } = require('./z-coordinates');
const { normalizeZ, normalizeZCoordinates } = require('../../pipeline');
const { extractPdfAsLineText } = require('../../core/pdf-coordinates');

/**
 * PRIMARY PATH: coordinate extraction (z-coordinates.js), added 20 Aug
 * 2026 — same proven approach as bp-coordinates.js (which took BP's
 * sparse-row review count from 15 down to 0 on the first live attempt).
 * Resolves Z's remaining review items (Christchurch/Lyttelton, Timaru
 * South) the same way: reading each value's real x-position instead of
 * refusing when a row has fewer numbers than columns.
 *
 * FALLBACK: text extraction (connectors/z.js), if coordinate extraction
 * fails for any reason — a review item is still better than no data.
 */
async function run() {
  const c = new ZConnector();

  const landingRes = await fetch(c.sourceUrl);
  if (!landingRes.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `Z landing page returned HTTP ${landingRes.status}` };
  const landingHtml = await landingRes.text();

  const discovery = findZDocument(landingHtml);
  if (discovery.status !== 'OK') return discovery;

  const docRes = await fetch(discovery.documentUrl);
  if (!docRes.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `Z PDF returned HTTP ${docRes.status}` };
  const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

  const documentText = await extractPdfAsLineText(pdfBuffer);

  let coordinateDiagnostics = null;
  try {
    const coordResult = await extractZCoordinates(pdfBuffer);
    coordinateDiagnostics = coordResult.diagnostics || null;
    if (coordResult.status === 'OK') {
      const records = normalizeZCoordinates(coordResult.blocks, documentText, 'Z');
      // SAFETY NET: coordinate extraction can return status:'OK' with zero
      // usable rows if something about the real PDF's structure doesn't
      // match what was assumed (confirmed happened live 20 Aug 2026 — Z
      // dropped from 60 valid prices to 0). A silent empty result is worse
      // than falling back, so only trust the coordinate path if it actually
      // produced records.
      if (records.length > 0) {
        return {
          status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
          documentContent: pdfBuffer, extractionMethod: 'PDF_COORDINATE', records,
        };
      }
    }
  } catch (err) {
    coordinateDiagnostics = { exception: err.message };
  }

  const { blocks } = c.extract(documentText);
  const records = normalizeZ(blocks, documentText, 'Z');

  return {
    status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_EXACT_ARITY', records,
    // Picked up by the orchestrator and logged as a warning — this is what
    // turns the next coordinate-extraction failure into something with a
    // real, specific reason attached, instead of a silent fallback nobody
    // can diagnose.
    _fallbackDiagnostics: coordinateDiagnostics,
  };
}

module.exports = { id: 'Z', run };

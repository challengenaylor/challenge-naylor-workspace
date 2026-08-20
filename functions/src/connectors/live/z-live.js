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

  try {
    const coordResult = await extractZCoordinates(pdfBuffer);
    if (coordResult.status === 'OK') {
      const records = normalizeZCoordinates(coordResult.blocks, documentText, 'Z');
      return {
        status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
        documentContent: pdfBuffer, extractionMethod: 'PDF_COORDINATE', records,
      };
    }
  } catch (err) {
    // fall through to text extraction
  }

  const { blocks } = c.extract(documentText);
  const records = normalizeZ(blocks, documentText, 'Z');

  return {
    status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_EXACT_ARITY', records,
  };
}

module.exports = { id: 'Z', run };

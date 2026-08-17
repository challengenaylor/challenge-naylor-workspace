'use strict';

const { extractBp } = require('../bp-header-driven');
const { normalizeBp } = require('../../pipeline');
const { extractPdfAsLineText, extractPositionedText, detectColumnAnchors, extractRows } = require('../../core/pdf-coordinates');

const SOURCE_URL = 'https://www.bp.com/content/dam/bp/country-sites/en_nz/new-zealand/home/documents/tgp-pricing-uploads/terminal-gate-prices-nz.pdf';

/**
 * BP has a stable, direct document URL (confirmed unchanged across two live
 * checks in this project, 16 and 17 Aug 2026) — no landing-page discovery
 * hop needed, unlike Z and Gull.
 *
 * Primary path: header-driven text extraction (bp-header-driven.js),
 * confirmed against the real live document's actual text shape. If BP's
 * layout ever wraps a terminal name across lines the way the synthetic test
 * fixture does, extractBp() will simply see fewer/malformed rows — the
 * coordinate module (core/pdf-coordinates.js) is available as an upgrade
 * path but isn't wired in automatically here, since doing so without ever
 * having seen it needed against a real BP document would be guessing at a
 * problem that may not exist.
 */
async function run() {
  const docRes = await fetch(SOURCE_URL);
  if (!docRes.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `BP PDF returned HTTP ${docRes.status}` };
  const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

  const documentText = await extractPdfAsLineText(pdfBuffer);
  const result = extractBp(documentText);
  if (result.status !== 'OK') return result;

  const records = normalizeBp(result.blocks, documentText, 'BP');

  return {
    status: 'OK', sourceUrl: SOURCE_URL, documentUrl: SOURCE_URL,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_HEADER_DRIVEN', records,
  };
}

module.exports = { id: 'BP', run };

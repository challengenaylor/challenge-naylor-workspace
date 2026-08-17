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
/**
 * Browser-identifying headers. Confirmed live on 18 Aug 2026: BP's server
 * returns HTTP 403 to a plain fetch() with no headers (likely basic
 * bot-filtering on User-Agent), but accepts a normal browser-shaped request.
 * This is the one difference between "works in a browser" and "works from a
 * server" that this project's earlier sandbox testing had no way to catch —
 * only a real deployed run against the real live server could surface it.
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
  const result = extractBp(documentText);
  if (result.status !== 'OK') return result;

  const records = normalizeBp(result.blocks, documentText, 'BP');

  return {
    status: 'OK', sourceUrl: SOURCE_URL, documentUrl: SOURCE_URL,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_HEADER_DRIVEN', records,
  };
}

module.exports = { id: 'BP', run };

'use strict';

const { extractTable, findEffectiveDate, detectGst } = require('../mobil');
const { normalizeMobil } = require('../../pipeline');

const SOURCE_URL = 'https://www.mobil.co.nz/en-nz/commercial-fuels/terminal-gate';

/**
 * Same fix as BP (connectors/live/bp-live.js) for the same reason — confirmed
 * live on 18 Aug 2026: Mobil's server also returns HTTP 403 to a plain
 * fetch() with no browser-identifying headers.
 */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*',
};

async function run() {
  const res = await fetch(SOURCE_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `Mobil page returned HTTP ${res.status}` };
  const html = await res.text();

  const table = extractTable(html);
  if (table.status !== 'OK') return table;

  const eff = findEffectiveDate(html);
  if (eff.status !== 'OK') return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Effective date not found: ' + eff.reason };

  const gst = detectGst(html);
  const records = normalizeMobil(table.rows, eff.effectiveDate, gst.gstStatus === 'GST_INCLUDED' ? 'included' : 'not_stated', 'MOBIL');

  return {
    status: 'OK', sourceUrl: SOURCE_URL, documentUrl: SOURCE_URL,
    documentContent: html, extractionMethod: 'HTML_TABLE_HEADER_DRIVEN', records,
  };
}

module.exports = { id: 'MOBIL', run };

'use strict';

const cheerio = require('cheerio');

/**
 * Tasman Fuels — the 5th supplier, added 19 Aug 2026. Confirmed real and
 * publishing TGP via live web research (tasmanfuels.co.nz/terminal-gate-
 * pricing/), one week after the original four suppliers were built —
 * the research phase for this project was never actually exhaustive
 * against every possible NZ importer, just the ones investigated at the
 * time.
 *
 * Single terminal (Timaru — confirmed via tasmanfuels.co.nz/our-terminal/,
 * "37-71 Fraser Street, Timaru"), single row per publication, weekly. This
 * is the simplest connector in the project — no sparse rows, no wrapped
 * labels, no multi-terminal ambiguity.
 */

const HEADER_MATCHERS = [
  { key: 'DIESEL', patterns: [/^diesel$/i] },
  { key: 'REGULAR_91', patterns: [/ulp\s*91/i, /^91$/i] },
  { key: 'PREMIUM_95', patterns: [/pulp\s*95/i, /^95$/i] },
  { key: 'FROM', patterns: [/^from$/i] },
];

function mapColumns($, table) {
  const headerCells = $(table).find('thead th');
  const columnMap = {};
  const unmapped = [];
  headerCells.each((i, el) => {
    const text = $(el).text().trim();
    const match = HEADER_MATCHERS.find((h) => h.patterns.some((re) => re.test(text)));
    if (match) columnMap[i] = match.key; else unmapped.push({ index: i, text });
  });
  return { columnMap, unmapped };
}

/** "15/08/2026" (day-first, as every other NZ TGP source in this project uses) -> "2026-08-15". */
function parseDayFirstDate(text) {
  const m = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * @returns {{status:'OK', effectiveDate, values:{DIESEL,REGULAR_91,PREMIUM_95}} | {status:'TABLE_STRUCTURE_CHANGED', reason}}
 */
function extractTasman(html) {
  const $ = cheerio.load(html);
  const table = $('table').first();
  if (!table.length) {
    return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'No table found on the Tasman Fuels TGP page.' };
  }

  const { columnMap, unmapped } = mapColumns($, table);
  const required = ['DIESEL', 'REGULAR_91', 'PREMIUM_95', 'FROM'];
  const found = new Set(Object.values(columnMap));
  const missing = required.filter((k) => !found.has(k));
  if (missing.length) {
    return {
      status: 'TABLE_STRUCTURE_CHANGED',
      reason: `Could not confidently map required column(s): ${missing.join(', ')}. `
        + `Header cells seen: ${unmapped.map((u) => `"${u.text}"`).join(', ') || '(none)'}. Refusing to guess a fixed index.`,
    };
  }

  const row = $(table).find('tbody tr').first();
  if (!row.length) return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Table has a header but no data row.' };

  const cells = row.find('td');
  const byKey = {};
  cells.each((i, td) => { if (columnMap[i]) byKey[columnMap[i]] = $(td).text().trim(); });

  const effectiveDate = parseDayFirstDate(byKey.FROM);
  if (!effectiveDate) return { status: 'TABLE_STRUCTURE_CHANGED', reason: `Could not parse effective date from "${byKey.FROM}".` };

  const values = {};
  for (const key of ['DIESEL', 'REGULAR_91', 'PREMIUM_95']) {
    const n = Number(byKey[key]);
    if (Number.isFinite(n)) values[key] = n;
  }

  return { status: 'OK', effectiveDate, values };
}

const { normaliseTerminal } = require('../../core/terminals');

const SOURCE_URL = 'https://tasmanfuels.co.nz/terminal-gate-pricing/';

async function run() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  if (!res.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `Tasman Fuels page returned HTTP ${res.status}` };
  const html = await res.text();
  const result = extractTasman(html);
  if (result.status !== 'OK') return result;

  const term = normaliseTerminal('Tasman Fuels Timaru Terminal', { supplierId: 'TASMAN' });
  const records = Object.entries(result.values).map(([productId, value]) => ({
    supplierId: 'TASMAN', terminalId: term.terminalId, terminalRaw: 'Tasman Fuels Timaru Terminal',
    productId, productRaw: productId, priceCentsPerLitre: value,
    gstStatus: 'GST_INCLUDED', effectiveDate: result.effectiveDate,
  }));

  return {
    status: 'OK', sourceUrl: SOURCE_URL, documentUrl: SOURCE_URL,
    documentContent: html, extractionMethod: 'HTML_TABLE_HEADER_DRIVEN', records,
  };
}

module.exports = { id: 'TASMAN', run, extractTasman, parseDayFirstDate, SOURCE_URL };

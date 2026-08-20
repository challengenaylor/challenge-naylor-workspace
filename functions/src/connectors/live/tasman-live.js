'use strict';

const cheerio = require('cheerio');
const { normaliseTerminal } = require('../../core/terminals');

/**
 * Tasman Fuels — the 5th supplier, added 19 Aug 2026. Confirmed real and
 * publishing TGP via live web research (tasmanfuels.co.nz/terminal-gate-
 * pricing/), one week after the original four suppliers were built.
 *
 * Single terminal (Timaru, confirmed via tasmanfuels.co.nz/our-terminal/),
 * single row per publication, weekly. Simple data, but the real table
 * markup (confirmed by screenshot 20 Aug 2026) uses rowspan="2" on "Week"
 * and "From" so they visually span two header rows without being repeated
 * in the DOM — every earlier version of this connector assumed raw DOM
 * cell index equalled visual column position, which is only true once
 * colspan/rowspan are accounted for. This version resolves TRUE effective
 * column positions from the actual grid geometry instead.
 */

const HEADER_MATCHERS = [
  { key: 'DIESEL', patterns: [/^diesel$/i] },
  { key: 'REGULAR_91', patterns: [/ulp\s*91/i, /^91$/i, /regular\s*91/i, /unleaded\s*91/i] },
  { key: 'PREMIUM_95', patterns: [/pulp\s*95/i, /^95$/i, /premium\s*95/i, /unleaded\s*95/i] },
  { key: 'FROM', patterns: [/^from$/i] },
];

/** "15/08/2026" (day-first, as every other NZ TGP source in this project uses) -> "2026-08-15". */
function parseDayFirstDate(text) {
  const m = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Resolves every cell in a table to its TRUE effective column position,
 * accounting for colspan and rowspan. Returns one array per row, each
 * entry {text, col}. This is what makes "From" (row 1, rowspan=2) and
 * "ULP 91" (row 2) correctly land at DIFFERENT effective columns instead
 * of colliding at the same raw DOM index.
 */
function computeEffectiveGrid($, table) {
  const rows = $(table).find('tr').toArray();
  const occupied = {};
  const grid = [];

  rows.forEach((tr, rowIdx) => {
    occupied[rowIdx] = occupied[rowIdx] || {};
    let col = 0;
    const rowCells = [];
    $(tr).find('th,td').each((_, cellEl) => {
      while (occupied[rowIdx][col]) col++;
      const $cell = $(cellEl);
      const colspan = parseInt($cell.attr('colspan'), 10) || 1;
      const rowspan = parseInt($cell.attr('rowspan'), 10) || 1;
      rowCells.push({ text: $cell.text().trim(), col });
      for (let c = col; c < col + colspan; c++) {
        for (let r = rowIdx; r < rowIdx + rowspan; r++) {
          occupied[r] = occupied[r] || {};
          occupied[r][c] = true;
        }
      }
      col += colspan;
    });
    grid.push(rowCells);
  });

  return grid;
}

/**
 * Identifies the data row's index in the grid by CONTENT (a real date plus
 * at least 2 plausible price values, 100-400 c/L) rather than position —
 * more robust than assuming "the last row", which broke once real
 * structure had more rows than expected.
 */
function findDataRowIndex(grid) {
  let best = -1;
  grid.forEach((row, i) => {
    const texts = row.map((c) => c.text);
    const hasDate = texts.some((t) => parseDayFirstDate(t));
    const plausiblePrices = texts.filter((t) => { const n = Number(t); return Number.isFinite(n) && n >= 100 && n <= 400; });
    if (hasDate && plausiblePrices.length >= 2) best = i;
  });
  return best;
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

  const grid = computeEffectiveGrid($, table);
  if (!grid.length) return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Table has no rows at all.' };

  const dataRowIdx = findDataRowIndex(grid);
  if (dataRowIdx === -1) {
    return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Could not find a row containing both a date and plausible prices.' };
  }

  // Merge header matches from every OTHER row, keyed by TRUE effective
  // column — this is what correctly separates "From" (col 1) from
  // "ULP 91" (col 3) even though they were colliding at raw index 1 before.
  const columnMap = {}; // effectiveCol -> key
  const unmapped = [];
  grid.forEach((row, i) => {
    if (i === dataRowIdx) return;
    row.forEach(({ text, col }) => {
      if (columnMap[col] || !text) return;
      const match = HEADER_MATCHERS.find((h) => h.patterns.some((re) => re.test(text)));
      if (match) columnMap[col] = match.key; else unmapped.push({ col, text });
    });
  });

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

  const dataRow = grid[dataRowIdx];
  const byKey = {};
  dataRow.forEach(({ text, col }) => { if (columnMap[col]) byKey[columnMap[col]] = text; });

  const effectiveDate = parseDayFirstDate(byKey.FROM);
  if (!effectiveDate) return { status: 'TABLE_STRUCTURE_CHANGED', reason: `Could not parse effective date from "${byKey.FROM}".` };

  const values = {};
  for (const key of ['DIESEL', 'REGULAR_91', 'PREMIUM_95']) {
    const n = Number(byKey[key]);
    if (Number.isFinite(n)) values[key] = n;
  }

  return { status: 'OK', effectiveDate, values };
}

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

module.exports = { id: 'TASMAN', run, extractTasman, parseDayFirstDate, computeEffectiveGrid, SOURCE_URL };

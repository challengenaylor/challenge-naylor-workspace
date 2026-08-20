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
  { key: 'REGULAR_91', patterns: [/ulp\s*91/i, /^91$/i, /regular\s*91/i, /unleaded\s*91/i] },
  { key: 'PREMIUM_95', patterns: [/pulp\s*95/i, /^95$/i, /premium\s*95/i, /unleaded\s*95/i] },
  { key: 'FROM', patterns: [/^from$/i] },
];

/**
 * Identifies the actual data row by CONTENT rather than position — a real
 * date plus at least 2 plausible price values (100-400 c/L). More robust
 * than assuming "the last row" or "the row after the header", both of
 * which turned out wrong against the real page at different points
 * (confirmed 19-20 Aug 2026): a numbers-only row was being mistaken for a
 * header candidate, corrupting the header merge.
 */
function findDataRow($, table) {
  let best = null;
  $(table).find('tr').each((_, tr) => {
    const row = $(tr);
    const texts = row.find('th,td').map((_, el) => $(el).text().trim()).get();
    const hasDate = texts.some((t) => parseDayFirstDate(t));
    const plausiblePrices = texts.filter((t) => { const n = Number(t); return Number.isFinite(n) && n >= 100 && n <= 400; });
    if (hasDate && plausiblePrices.length >= 2) best = row; // last matching row wins if more than one
  });
  return best;
}

/**
 * Finds header information for a table, tolerant of both non-semantic
 * markup (no <thead>) and a two-row header where labels are split across
 * rows (e.g. "Week"/"From" in row 1, "Diesel"/"ULP 91"/"PULP 95" in row 2)
 * — both confirmed live on 19 Aug 2026 as Tasman's real structure.
 *
 * Merges matches from every candidate row (every row except the identified
 * data row) by column index — a later row's match for an index does not
 * override an earlier one, but different rows can each contribute
 * different columns. This deliberately does NOT require every candidate
 * row to have the same cell count as the data row (a strict requirement
 * broke the real "From" column, which lives in a 3-cell row while the
 * value columns live in a different 5-cell row). The real safety net
 * against misalignment is downstream: parseDayFirstDate() rejects anything
 * that isn't a real date, and the shared price-range validation rejects
 * anything outside 100-400 c/L — a genuinely misaligned column produces
 * content that fails one of those checks rather than a silently wrong
 * price.
 */
function mapColumns($, table, dataRow) {
  const required = ['DIESEL', 'REGULAR_91', 'PREMIUM_95', 'FROM'];
  const candidates = $(table).find('tr').not(dataRow);

  const columnMap = {};
  const unmapped = [];
  candidates.each((_, tr) => {
    $(tr).find('th,td').each((i, el) => {
      if (columnMap[i]) return; // first match for a given index wins
      const text = $(el).text().trim();
      const match = HEADER_MATCHERS.find((h) => h.patterns.some((re) => re.test(text)));
      if (match) columnMap[i] = match.key;
      else if (text) unmapped.push({ index: i, text });
    });
  });

  const found = new Set(Object.values(columnMap));
  const missing = required.filter((k) => !found.has(k));
  return { columnMap, unmapped, missing };
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

  // Tasman publishes exactly one data row (single terminal, current week
  // only) — it's reliably the LAST row in the table, whatever the header
  // Tasman publishes exactly one data row (single terminal, current week
  // only) — identified by CONTENT (a real date plus plausible price
  // values), not by position, since neither "last row" nor "row after
  // header" held up against the real page structure.
  const allRows = $(table).find('tr');
  if (!allRows.length) return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Table has no rows at all.' };
  const dataRow = findDataRow($, table);
  if (!dataRow) return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Could not find a row containing both a date and plausible prices.' };

  const { columnMap, unmapped, missing } = mapColumns($, table, dataRow);
  if (missing.length) {
    return {
      status: 'TABLE_STRUCTURE_CHANGED',
      reason: `Could not confidently map required column(s): ${missing.join(', ')}. `
        + `Header cells seen: ${unmapped.map((u) => `"${u.text}"`).join(', ') || '(none)'}. Refusing to guess a fixed index.`,
    };
  }

  const cells = dataRow.find('td,th');
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

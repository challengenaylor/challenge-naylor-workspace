'use strict';

const cheerio = require('cheerio');

/**
 * Mobil — HTML table connector.
 *
 * Column identity comes from matching header TEXT, never a fixed index —
 * if Mobil reorders or renames a column, this either finds it under its new
 * position or correctly reports it as unmapped, rather than silently
 * reading the wrong grade from the wrong cell.
 *
 * "Location" and "Terminal" are genuinely separate columns for Mobil, and
 * Location is blank on continuation rows (Lyttelton is a second row under
 * the same Christchurch location as Woolston) — the connector must inherit
 * the last non-blank Location rather than treat the blank as a new,
 * unnamed terminal.
 *
 * "N/A" is a real, meaningful value: Mobil does not sell that grade at that
 * terminal. It becomes NO_PUBLISHED_PRICE, never zero, never skipped
 * silently — it still appears in the output so a reviewer can see the gap
 * was recognised, not missed.
 */

const HEADER_MATCHERS = [
  { key: 'REGULAR_91', patterns: [/regular\s*91/i, /\b91\b/i] },
  { key: 'PREMIUM_95', patterns: [/premium\s*95/i, /\b95\b/i] },
  { key: 'DIESEL', patterns: [/diesel/i] },
  { key: 'LOCATION', patterns: [/^location$/i] },
  { key: 'TERMINAL', patterns: [/^terminal$/i] },
  { key: 'OPERATOR', patterns: [/^operator$/i] },
];

const EFFECTIVE_DATE_RE = /effective\s+12:01\s*am\s+([A-Za-z]+\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function parseLongDate(text) {
  // "Saturday 15 August 2026" -> "2026-08-15". Day-of-week word is ignored;
  // NZ long-form dates are day-month-year regardless of the leading weekday.
  const m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/**
 * @param {string} html  the fetched page HTML (or, in this project, the
 *   reconstructed fixture standing in for it — see fixtures/mobil-2026-08-15.html)
 */
function findEffectiveDate(html) {
  const m = html.match(EFFECTIVE_DATE_RE);
  if (!m) return { status: 'NOT_FOUND', reason: 'No "effective 12:01am <date>" sentence found on the page.' };
  const iso = parseLongDate(m[1]);
  if (!iso) return { status: 'PARSE_FAILED', reason: `Found date phrase "${m[1]}" but could not parse it.` };
  return { status: 'OK', effectiveDate: iso, rawText: m[0] };
}

/** Locate the TGP table and map its header cells to known column keys. */
function mapColumns($, table) {
  const headerCells = $(table).find('thead th');
  const columnMap = {}; // index -> key
  const unmapped = [];

  headerCells.each((i, el) => {
    const text = $(el).text().trim();
    const match = HEADER_MATCHERS.find((h) => h.patterns.some((re) => re.test(text)));
    if (match) columnMap[i] = match.key;
    else unmapped.push({ index: i, text });
  });

  return { columnMap, unmapped, columnCount: headerCells.length };
}

/**
 * @returns {{status:'OK', rows: Array} | {status:'TABLE_STRUCTURE_CHANGED', reason:string}}
 */
function extractTable(html) {
  const $ = cheerio.load(html);
  const allTables = $('table');
  if (!allTables.length) {
    return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'No <table> element found on the page at all.' };
  }

  // The live page has more than one table (confirmed 18 Aug 2026 — an
  // unrelated "SSHE requirements" access table appears before the actual
  // pricing table). Blindly taking the first table on the page is exactly
  // the kind of positional assumption this project exists to avoid, so
  // every table is checked and the first one whose headers actually match
  // our required columns is used — not just whichever happens to come first.
  const required = ['REGULAR_91', 'PREMIUM_95', 'DIESEL', 'TERMINAL'];
  let best = null;

  for (let i = 0; i < allTables.length; i++) {
    const candidate = allTables.eq(i);
    const { columnMap, unmapped } = mapColumns($, candidate);
    const found = new Set(Object.values(columnMap));
    const missing = required.filter((k) => !found.has(k));
    if (missing.length === 0) { best = { table: candidate, columnMap }; break; }
    if (!best) best = { table: candidate, columnMap, unmapped, missing }; // remember the first as a fallback for the error message
  }

  if (!best || !best.columnMap || required.some((k) => !new Set(Object.values(best.columnMap)).has(k))) {
    return {
      status: 'TABLE_STRUCTURE_CHANGED',
      reason: `Checked ${allTables.length} table(s) on the page; none had all required columns `
        + `(${required.join(', ')}). First table's headers: ${(best && best.unmapped || []).map((u) => `"${u.text}"`).join(', ') || '(none)'}. `
        + `Refusing to guess a fixed index.`,
    };
  }

  const table = best.table;
  const { columnMap, unmapped, columnCount } = mapColumns($, table);

  let lastLocation = null;
  const rows = [];

  $(table).find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < columnCount) return; // malformed row, skip rather than misalign

    const byKey = {};
    cells.each((i, td) => {
      const key = columnMap[i];
      if (key) byKey[key] = $(td).text().trim();
    });

    const location = byKey.LOCATION || lastLocation;
    if (byKey.LOCATION) lastLocation = byKey.LOCATION;

    rows.push({
      locationRaw: location,
      terminalRaw: byKey.TERMINAL || null,
      operatorRaw: byKey.OPERATOR || null,
      cells: {
        REGULAR_91: parseCell(byKey.REGULAR_91),
        PREMIUM_95: parseCell(byKey.PREMIUM_95),
        DIESEL: parseCell(byKey.DIESEL),
      },
    });
  });

  return { status: 'OK', rows };
}

function parseCell(raw) {
  if (raw === undefined || raw === null) return { status: 'MISSING_CELL' };
  const t = raw.trim();
  if (t === '' ) return { status: 'MISSING_CELL' };
  if (/^n\/?a$/i.test(t)) return { status: 'NO_PUBLISHED_PRICE', reason: 'Cell explicitly says N/A — supplier does not sell this grade at this terminal.' };
  const n = Number(t);
  if (!Number.isFinite(n)) return { status: 'INVALID_PRICE', raw: t };
  return { status: 'OK', value: n };
}

const GST_WORDING_RE = /all quoted tgps include:[^.]*gst[^.]*\./i;

function detectGst(html) {
  const m = html.match(GST_WORDING_RE);
  if (!m) return { gstStatus: 'GST_UNKNOWN', gstSourceWording: null };
  return { gstStatus: 'GST_INCLUDED', gstSourceWording: m[0].trim() };
}

module.exports = { extractTable, findEffectiveDate, detectGst, parseCell, HEADER_MATCHERS };

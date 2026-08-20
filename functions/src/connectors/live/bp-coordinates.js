'use strict';

const {
  extractPositionedText, groupIntoRows, mergeWrappedLabelRows,
  detectColumnAnchors, assignByXAnchor,
} = require('../../core/pdf-coordinates');
const { normaliseTerminal } = require('../../core/terminals');
const { parseEffectiveDate } = require('../../core/dates');
const { detectGst } = require('../../core/gst');

/**
 * BP — coordinate-based extraction. Resolves the sparse-row problem that
 * text-based extraction (connectors/bp-header-driven.js) correctly refuses
 * to guess at: a terminal that only sells one or two of the three grades
 * has a row with fewer numeric tokens than columns, which text extraction
 * can't safely assign without guessing which grade each value belongs to.
 * Coordinate extraction resolves this properly by reading each value's
 * actual x-position against the real column headers — this was built and
 * tested against a synthetic PDF back when this project's sandbox couldn't
 * reach bp.com, and is being wired into the real live connector now that a
 * real Cloud Function with real network access exists to prove it against
 * the actual document.
 */

const OPERATOR_TOKENS = ['WOSL', 'NZOSL', 'TNZ'];
const COLUMN_DEFS = [
  { key: 'PREMIUM_95', patterns: [/^M95\*?$/i] },
  { key: 'REGULAR_91', patterns: [/^M91\*?$/i] },
  { key: 'DIESEL', patterns: [/^ADF\*?$/i] },
];

/** Splits a row's label into {operator, terminal} — e.g. "NZOSL Mt Maunganui BP" -> {operator:'NZOSL', terminal:'Mt Maunganui BP'}. */
function splitOperatorAndTerminal(label) {
  const op = OPERATOR_TOKENS.find((o) => label.toUpperCase().startsWith(o + ' '));
  if (!op) return null;
  return { operator: op, terminal: label.slice(op.length).trim() };
}

/**
 * @param {Buffer} pdfBuffer
 * @returns {{status:'OK', blocks: Array} | {status:'TABLE_STRUCTURE_CHANGED', reason}}
 */
async function extractBpCoordinates(pdfBuffer) {
  const pages = await extractPositionedText(pdfBuffer);
  const blocks = [];

  for (const page of pages) {
    const rows = groupIntoRows(page.items);

    // Find each "Price effective ..." row — these mark the start of a new
    // weekly block within the same document (BP's real PDF contains both
    // the current and prior week in one file).
    const blockStarts = [];
    rows.forEach((row, i) => {
      const text = row.items.map((it) => it.str).join(' ');
      if (/price effective/i.test(text)) blockStarts.push({ index: i, text });
    });

    for (let b = 0; b < blockStarts.length; b++) {
      const startIdx = blockStarts[b].index;
      const endIdx = b + 1 < blockStarts.length ? blockStarts[b + 1].index : rows.length;
      const blockRows = rows.slice(startIdx, endIdx);

      const dateInfo = parseEffectiveDate(blockStarts[b].text);
      if (dateInfo.status !== 'OK') continue;

      // Header row: the one containing "Operator" — gives us real x-anchors
      // for M95/M91/ADF, read from the actual document, not assumed.
      const headerRowIdx = blockRows.findIndex((r) => r.items.some((it) => /^operator$/i.test(it.str.trim())));
      if (headerRowIdx === -1) continue;
      const anchors = detectColumnAnchors(blockRows[headerRowIdx].items, COLUMN_DEFS);
      if (anchors.length < 3) continue; // couldn't find all 3 columns — skip this block rather than guess

      const dataRows = mergeWrappedLabelRows(blockRows.slice(headerRowIdx + 1));
      const resolvedRows = [];

      for (const row of dataRows) {
        const fullText = row.items.map((it) => it.str).join(' ').trim();
        if (!fullText || /^\*?notes?:/i.test(fullText) || /all prices/i.test(fullText)) continue;

        const labelItems = row.items.filter((it) => !/^-?\d{1,4}(\.\d+)?$/.test(it.str.trim()));
        const valueItems = row.items.filter((it) => /^-?\d{1,4}(\.\d+)?$/.test(it.str.trim()));
        const label = labelItems.map((it) => it.str).join(' ').trim();
        const parsed = splitOperatorAndTerminal(label);
        if (!parsed) continue; // not a data row (e.g. a footer line) — skip, don't guess

        const { values } = assignByXAnchor(valueItems, anchors);
        if (!Object.keys(values).length) continue;

        resolvedRows.push({ operator: parsed.operator, terminal: parsed.terminal, values });
      }

      blocks.push({ effectiveDate: dateInfo.effectiveDate, rows: resolvedRows });
    }
  }

  if (!blocks.length) return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'No "Price effective" blocks with a resolvable header found in the PDF.' };
  return { status: 'OK', blocks };
}

module.exports = { extractBpCoordinates, splitOperatorAndTerminal, OPERATOR_TOKENS, COLUMN_DEFS };

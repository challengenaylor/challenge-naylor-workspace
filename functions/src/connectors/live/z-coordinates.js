'use strict';

const {
  extractPositionedText, groupIntoRows, mergeWrappedLabelRows,
  detectColumnAnchors, assignByXAnchor,
} = require('../../core/pdf-coordinates');
const { normaliseTerminal } = require('../../core/terminals');
const { parseEffectiveDate } = require('../../core/dates');
const { detectGst } = require('../../core/gst');

/**
 * Z Energy — coordinate-based extraction, same proven approach as
 * bp-coordinates.js (see that file's comments — resolved BP's sparse rows
 * from 15 review items down to 0 on the first live attempt, 20 Aug 2026).
 * Z's remaining review items (Christchurch/Lyttelton, Timaru South) are the
 * identical class of problem: real terminals selling fewer than 3 grades.
 *
 * Z has one extra wrinkle BP doesn't: a separate "Location" column that's
 * blank on continuation rows (e.g. "Z Mount Maunganui South" has no
 * Location — it inherits "Tauranga" from the row above). Location
 * identification is a text-matching problem, not a coordinate one, so it
 * reuses the same KNOWN_LOCATIONS list as the text-based connector
 * (connectors/z.js) rather than duplicating a different approach.
 */

const KNOWN_LOCATIONS = [
  'Marsden Point', 'Auckland', 'Tauranga', 'Napier', 'Wellington', 'Hutt City',
  'Nelson', 'Christchurch', 'Timaru', 'Dunedin',
];

const COLUMN_DEFS = [
  { key: 'PREMIUM_95', patterns: [/^premium\s*95$/i] },
  { key: 'REGULAR_91', patterns: [/^regular\s*91$/i] },
  { key: 'DIESEL', patterns: [/^diesel$/i] },
];

/**
 * @param {Buffer} pdfBuffer
 * @returns {{status:'OK', blocks: Array} | {status:'TABLE_STRUCTURE_CHANGED', reason, diagnostics}}
 */
async function extractZCoordinates(pdfBuffer) {
  const pages = await extractPositionedText(pdfBuffer);
  const blocks = [];
  // Real, concrete detail about what was actually seen — surfaced through
  // to the error log when this fails, instead of a silent empty fallback.
  // Every previous attempt at Z's coordinate extraction failed without any
  // trace of WHY; this is what turns the next failure into something
  // diagnosable instead of another guess.
  const diagnostics = { pagesScanned: pages.length, totalItems: pages.reduce((n, p) => n + p.items.length, 0), blockAttempts: [] };

  for (const page of pages) {
    const rows = groupIntoRows(page.items);

    const blockStarts = [];
    rows.forEach((row, i) => {
      const text = row.items.map((it) => it.str).join(' ');
      if (/effective date/i.test(text)) blockStarts.push({ index: i, text });
    });
    diagnostics.blockAttempts.push({ page: page.page, rowsFound: rows.length, effectiveDateRowsFound: blockStarts.length });

    for (let b = 0; b < blockStarts.length; b++) {
      const startIdx = blockStarts[b].index;
      const endIdx = b + 1 < blockStarts.length ? blockStarts[b + 1].index : rows.length;
      const blockRows = rows.slice(startIdx, endIdx);

      const dateInfo = parseEffectiveDate(blockStarts[b].text);
      if (dateInfo.status !== 'OK') {
        diagnostics.blockAttempts.push({ block: blockStarts[b].text, outcome: 'DATE_PARSE_FAILED', reason: dateInfo.reason });
        continue;
      }

      const headerRowIdx = blockRows.findIndex((r) => r.items.some((it) => /^location$/i.test(it.str.trim())));
      if (headerRowIdx === -1) {
        diagnostics.blockAttempts.push({
          block: dateInfo.effectiveDate, outcome: 'NO_HEADER_ROW_FOUND',
          rowsInBlock: blockRows.length,
          sampleRowTexts: blockRows.slice(0, 5).map((r) => r.items.map((it) => it.str).join(' | ')),
        });
        continue;
      }
      const anchors = detectColumnAnchors(blockRows[headerRowIdx].items, COLUMN_DEFS);
      if (anchors.length < 3) {
        diagnostics.blockAttempts.push({
          block: dateInfo.effectiveDate, outcome: 'INSUFFICIENT_ANCHORS',
          anchorsFound: anchors.map((a) => a.key),
          headerRowRawItems: blockRows[headerRowIdx].items.map((it) => it.str),
        });
        continue;
      }

      const dataRows = mergeWrappedLabelRows(blockRows.slice(headerRowIdx + 1));
      const resolvedRows = [];
      let lastLocation = null;

      for (const row of dataRows) {
        const fullText = row.items.map((it) => it.str).join(' ').trim();
        if (!fullText || /^all terminal gate prices/i.test(fullText) || /^are /i.test(fullText)) break; // footer reached

        const labelItems = row.items.filter((it) => !/^-?\d{1,4}(\.\d+)?$/.test(it.str.trim()));
        const valueItems = row.items.filter((it) => /^-?\d{1,4}(\.\d+)?$/.test(it.str.trim()));
        let label = labelItems.map((it) => it.str).join(' ').trim();
        if (!label && !valueItems.length) continue;

        let location = null;
        const loc = KNOWN_LOCATIONS.find((l) => label.toLowerCase().startsWith(l.toLowerCase()));
        if (loc) {
          location = loc;
          label = label.slice(loc.length).trim();
          lastLocation = loc;
        } else {
          location = lastLocation;
        }
        if (!label) continue; // a location-only row with no terminal name — skip, don't guess

        const { values } = assignByXAnchor(valueItems, anchors);
        if (!Object.keys(values).length) continue;

        resolvedRows.push({ terminal: label, location, values });
      }

      blocks.push({ effectiveDate: dateInfo.effectiveDate, rows: resolvedRows });
      diagnostics.blockAttempts.push({ block: dateInfo.effectiveDate, outcome: 'OK', rowsResolved: resolvedRows.length, anchorsFound: anchors.map((a) => a.key) });
    }
  }

  if (!blocks.length) return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'No "Effective Date" blocks with a resolvable header found in the PDF.', diagnostics };
  return { status: 'OK', blocks, diagnostics };
}

module.exports = { extractZCoordinates, KNOWN_LOCATIONS, COLUMN_DEFS };

'use strict';

/**
 * BP — header-driven text extraction.
 *
 * Upgrade over the Phase-1 version: column identity is read from the
 * document's OWN header line ("Operator Terminal M95* M91* ADF*") at parse
 * time, not assumed from a hardcoded array. If BP ever reorders these
 * columns, this still gets it right; a fixed-order assumption would not.
 *
 * Tested against the REAL text fetched from BP's live PDF on 16 Aug 2026
 * (test/fixtures/bp-2026-08-14.txt) — this part is genuinely live-verified,
 * unlike the coordinate module (which needed a synthetic PDF because raw
 * bytes weren't obtainable in this sandbox).
 */

const HEADER_PATTERNS = [
  { key: 'PREMIUM_95', re: /^M95\*?$/i },
  { key: 'REGULAR_91', re: /^M91\*?$/i },
  { key: 'DIESEL', re: /^ADF\*?$/i },
];

const OPERATOR_TOKENS = ['WOSL', 'NZOSL', 'TNZ'];
const NUMBER_RE = /-?\d{1,4}(?:\.\d{1,4})?/g;

/** Read "Operator Terminal M95* M91* ADF*" and return column order as an array of keys. */
function parseHeaderLine(line) {
  const tokens = line.trim().split(/\s+/);
  const columns = [];
  for (const tok of tokens) {
    const match = HEADER_PATTERNS.find((h) => h.re.test(tok));
    if (match) columns.push(match.key);
  }
  return columns;
}

function numericTokens(line) {
  const out = [];
  let m;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(line)) !== null) out.push(Number(m[0]));
  return out;
}

/**
 * @param {string} documentText  full extracted text of the BP PDF
 * @returns {{status:'OK', blocks: Array} | {status:'TABLE_STRUCTURE_CHANGED', reason: string}}
 */
function extractBp(documentText) {
  const lines = String(documentText).split(/\r?\n/);
  let columns = null;
  const blocks = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^price effective/i.test(line)) {
      current = { effectiveDateLine: line, rows: [] };
      blocks.push(current);
      continue;
    }

    if (/^operator\b/i.test(line)) {
      columns = parseHeaderLine(line);
      const required = ['PREMIUM_95', 'REGULAR_91', 'DIESEL'];
      const missing = required.filter((k) => !columns.includes(k));
      if (missing.length) {
        return {
          status: 'TABLE_STRUCTURE_CHANGED',
          reason: `Header line "${line}" did not contain recognisable column(s): ${missing.join(', ')}. Refusing to assume a fixed column order.`,
        };
      }
      continue;
    }

    if (!current || !columns) continue;
    if (/^\*?notes?:/i.test(line)) { current = null; continue; }

    const op = OPERATOR_TOKENS.find((o) => line.toUpperCase().startsWith(o + ' '));
    if (!op) continue;

    // Was /\d{2,3}\.\d/ — required a decimal point to recognise a number,
    // which silently failed on whole-number prices like BP's real
    // "NZOSL Dunedin BP 305 290.72 259.06" (confirmed live 20 Aug 2026 from
    // the actual PDF): "305" has no decimal, so the old regex skipped past
    // it entirely and swallowed it into the terminal name, making a
    // genuinely complete 3-value row look falsely sparse. No terminal or
    // operator name in this document contains digits, so matching any
    // 2-4 digit run (decimal or not) is a safe, correct boundary.
    const firstNumIdx = line.search(/\d{2,4}/);
    if (firstNumIdx < 1) continue;

    const terminal = line.slice(op.length, firstNumIdx).trim();
    const values = numericTokens(line.slice(firstNumIdx));

    current.rows.push({ operator: op, terminal, columns, valueTokenCount: values.length, values });
  }

  return { status: 'OK', blocks, columnsDetected: columns };
}

module.exports = { extractBp, parseHeaderLine };

'use strict';
const { SupplierConnector } = require('./base');
const { assignByTextStrict } = require('../core/rows');
const { parseEffectiveDate } = require('../core/dates');

/**
 * BP — single stable PDF URL (no link-following needed), two effective-date
 * blocks per document. Column order: M95, M91, ADF.
 *
 * Sparse rows confirmed live:
 *   "NZOSL Mt Maunganui BP 250.66"   <- ADF only
 *   "TNZ Mt Maunganui TNZ 282.85"    <- M91 only
 *
 * BP is also the clearest case of two distinct terminals at one location, which
 * is why terminal identity carries the operator (NZOSL vs TNZ).
 */
const COLUMNS = ['PREMIUM_95', 'REGULAR_91', 'DIESEL'];
const LABELS = { PREMIUM_95: 'M95', REGULAR_91: 'M91', DIESEL: 'ADF' };
const OPERATORS = ['WOSL', 'NZOSL', 'TNZ'];

class BPConnector extends SupplierConnector {
  constructor() {
    super({
      id: 'BP',
      name: 'BP New Zealand',
      sourceUrl: 'https://www.bp.com/content/dam/bp/country-sites/en_nz/new-zealand/home/documents/tgp-pricing-uploads/terminal-gate-prices-nz.pdf',
    });
  }

  findDocumentUrl() {
    return { status: 'OK', documentUrl: this.sourceUrl, note: 'Stable URL; no link discovery required.' };
  }

  extract(documentText) {
    const blocks = [];
    let current = null;

    for (const raw of String(documentText).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      if (/^price effective/i.test(line)) {
        current = { effectiveDate: parseEffectiveDate(line), rows: [] };
        blocks.push(current);
        continue;
      }
      if (!current) continue;
      if (/^operator\b/i.test(line)) continue;
      if (/^\*?notes?:/i.test(line)) { current = null; continue; }

      const op = OPERATORS.find((o) => line.toUpperCase().startsWith(o + ' '));
      if (!op) continue;

      const firstNum = line.search(/\d{2,3}\.\d/);
      if (firstNum < 1) continue;

      const terminal = line.slice(op.length, firstNum).trim();
      const assigned = assignByTextStrict(line.slice(firstNum), COLUMNS);

      current.rows.push({
        originalTerminalName: terminal,
        originalOperatorName: op,
        columnLabels: LABELS,
        ...assigned,
      });
    }
    return { blocks, documentText };
  }
}
module.exports = { BPConnector, COLUMNS };

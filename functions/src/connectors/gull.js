'use strict';
const { SupplierConnector } = require('./base');
const { assignByTextStrict } = require('../core/rows');
const { parseEffectiveDate } = require('../core/dates');

/**
 * Gull — https://gull.nz/fuelcategorylatest/tgp/
 *
 * HTML landing page carrying a PDF link whose filename AND hashed asset folder
 * both change each week (.../assets/Uploads/<hash>/TGP-effective-14AUG26.pdf).
 * The link must be followed from the page; the URL cannot be constructed.
 *
 * Row shape (one row per effective date, date sits INSIDE the row):
 *   "7/08/2026 12:00 AM TNZ TNZ Mt Maunganui 294.82 306.03 256.78"
 *                                            R91    P95    Diesel
 *
 * The leading date/time is stripped before numeric extraction, otherwise
 * 7, 08, 2026, 12 and 00 are all read as prices.
 */
const COLUMNS = ['REGULAR_91', 'PREMIUM_95', 'DIESEL'];
const LABELS = { REGULAR_91: 'Regular 91', PREMIUM_95: 'Premium 95', DIESEL: 'Diesel' };

const ROW_RE = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s+(.+)$/i;

class GullConnector extends SupplierConnector {
  constructor() {
    super({ id: 'GULL', name: 'Gull New Zealand', sourceUrl: 'https://gull.nz/fuelcategorylatest/tgp/' });
  }

  /** @param {string} html landing page markup */
  findDocumentUrl(html) {
    const m = String(html).match(/href="([^"]*TGP[^"]*\.pdf)"/i);
    if (!m) {
      return { status: 'SOURCE_UNAVAILABLE', reason: 'No TGP PDF link found on Gull TGP page.' };
    }
    const href = m[1];
    const url = href.startsWith('http') ? href : `https://gull.nz${href.startsWith('/') ? '' : '/'}${href}`;
    return { status: 'OK', documentUrl: url };
  }

  extract(documentText) {
    const blocks = [];
    for (const line of String(documentText).split(/\r?\n/)) {
      const m = line.trim().match(ROW_RE);
      if (!m) continue;

      const date = parseEffectiveDate(m[1]);
      const remainder = m[2];

      // Terminal wording is everything before the first price token.
      const firstNum = remainder.search(/\d{2,3}\.\d/);
      const terminalText = firstNum > 0 ? remainder.slice(0, firstNum).trim() : remainder.trim();
      const valuesText = firstNum > 0 ? remainder.slice(firstNum) : '';

      const assigned = assignByTextStrict(valuesText, COLUMNS);
      blocks.push({
        effectiveDate: date,
        rows: [{
          originalTerminalName: terminalText,
          columnLabels: LABELS,
          ...assigned,
        }],
      });
    }
    return { blocks, documentText };
  }
}
module.exports = { GullConnector, COLUMNS };

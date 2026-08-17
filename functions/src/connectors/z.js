'use strict';
const { SupplierConnector } = require('./base');
const { assignByTextStrict } = require('../core/rows');
const { parseEffectiveDate } = require('../core/dates');

/**
 * Z Energy — PDF linked from the TGP page, S3-hosted, filename carries the date
 * (TGP-Price-YYYYMMDD.pdf). The link is read from the page rather than guessed,
 * because a missed publication would otherwise 404 into a false "unavailable".
 *
 * Column order: Premium 95, Regular 91, Diesel.
 * Document contains TWO effective-date blocks (current and prior week).
 *
 * SPARSE ROWS ARE PRESENT AND DANGEROUS:
 *   "Christchurch Z Lyttelton 271.99 239.28"   <- no Premium 95
 *   "Z Timaru South 241.54"                    <- Diesel only
 */
const COLUMNS = ['PREMIUM_95', 'REGULAR_91', 'DIESEL'];
const LABELS = { PREMIUM_95: 'Premium 95', REGULAR_91: 'Regular 91', DIESEL: 'Diesel' };

const KNOWN_LOCATIONS = [
  'Marsden Point', 'Auckland', 'Tauranga', 'Napier', 'Wellington', 'Hutt City',
  'Nelson', 'Christchurch', 'Timaru', 'Dunedin',
];

class ZConnector extends SupplierConnector {
  constructor() {
    super({
      id: 'Z',
      name: 'Z Energy',
      sourceUrl: 'https://www.z.co.nz/for-businesses/fuels-and-services/terminal-gate-pricing',
    });
  }

  findDocumentUrl(html) {
    const m = String(html).match(/href="([^"]*TGP-Price-\d{8}\.pdf)"/i);
    if (!m) return { status: 'SOURCE_UNAVAILABLE', reason: 'No Z TGP price list link found.' };
    return { status: 'OK', documentUrl: m[1] };
  }

  extract(documentText) {
    const lines = String(documentText).split(/\r?\n/);
    const blocks = [];
    let current = null;
    let lastLocation = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (/^effective date/i.test(line)) {
        const date = parseEffectiveDate(line);
        current = { effectiveDate: date, rows: [] };
        blocks.push(current);
        lastLocation = null;
        continue;
      }
      if (!current) continue;
      if (/^location\b/i.test(line)) continue;
      if (/^all terminal gate prices/i.test(line)) { current = null; continue; }

      const firstNum = line.search(/\d{2,3}\.\d{2}/);
      if (firstNum < 1) continue;

      let head = line.slice(0, firstNum).trim();
      const valuesText = line.slice(firstNum);

      // Split the optional leading Location column from the Terminal column.
      let location = null;
      const loc = KNOWN_LOCATIONS.find((l) => head.toLowerCase().startsWith(l.toLowerCase()));
      if (loc) {
        location = loc;
        head = head.slice(loc.length).trim();
        lastLocation = loc;
      } else {
        location = lastLocation;
      }

      const assigned = assignByTextStrict(valuesText, COLUMNS);
      current.rows.push({
        originalTerminalName: head,
        originalLocationName: location,
        columnLabels: LABELS,
        ...assigned,
      });
    }
    return { blocks, documentText };
  }
}
module.exports = { ZConnector, COLUMNS };

'use strict';

/**
 * Row extraction primitives.
 *
 * THE CENTRAL SAFETY RULE OF THIS MODULE
 * --------------------------------------
 * Real NZ TGP documents contain SPARSE rows: a terminal that does not offer a
 * grade simply has no number in that column. Observed live examples:
 *
 *   Z:   "Christchurch Z Lyttelton 271.99 239.28"      <- no Premium 95
 *   Z:   "Z Timaru South 241.54"                       <- Diesel only
 *   BP:  "NZOSL Mt Maunganui BP 250.66"                <- ADF only
 *   BP:  "TNZ Mt Maunganui TNZ 282.85"                 <- M91 only
 *
 * A parser that reads numeric tokens left-to-right and assigns them to columns
 * positionally will silently record Lyttelton's Regular 91 price (271.99) as
 * its Premium 95 price. That is a plausible-looking, wrong commercial number:
 * exactly the failure mode this system exists to prevent.
 *
 * Therefore:
 *   - Primary extraction is by X-COORDINATE against detected column anchors.
 *     PDF text layers expose per-item x positions; a value belongs to the column
 *     whose anchor it sits under, not to its ordinal position in the line.
 *   - Text-only extraction (no coordinates) is permitted ONLY when the token
 *     count matches the column count exactly. Otherwise the row is returned as
 *     ambiguous and must never be published.
 */

const NUMBER_RE = /-?\d{1,4}(?:\.\d{1,4})?/g;

/** Pull numeric tokens with their offsets from a line of text. */
function numericTokens(line) {
  const out = [];
  let m;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(line)) !== null) {
    out.push({ raw: m[0], value: Number(m[0]), index: m.index });
  }
  return out;
}

/**
 * Assign values to columns using x-coordinates.
 *
 * @param {Array<{str:string,x:number}>} items  text items on one visual row
 * @param {Array<{key:string,x:number}>} anchors column header centres
 * @param {number} tolerance  max horizontal distance to claim a column
 * @returns {{values:Object, unassigned:Array, method:string}}
 */
function assignByX(items, anchors, tolerance = 40) {
  const values = {};
  const unassigned = [];

  for (const item of items) {
    const tokens = numericTokens(item.str);
    if (tokens.length !== 1) continue;

    let best = null;
    let bestDist = Infinity;
    for (const a of anchors) {
      const d = Math.abs(a.x - item.x);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }

    if (best && bestDist <= tolerance) {
      // Two values claiming one column means our anchors are wrong.
      if (values[best.key] !== undefined) {
        unassigned.push({ ...tokens[0], reason: 'COLUMN_COLLISION', column: best.key });
        continue;
      }
      values[best.key] = tokens[0].value;
    } else {
      unassigned.push({ ...tokens[0], reason: 'NO_COLUMN_WITHIN_TOLERANCE' });
    }
  }

  return { values, unassigned, method: 'X_COORDINATE' };
}

/**
 * Text-only fallback. Refuses to guess on sparse rows.
 *
 * @param {string} line
 * @param {string[]} columnKeys  in published left-to-right order
 */
function assignByTextStrict(line, columnKeys) {
  const tokens = numericTokens(line);

  if (tokens.length === columnKeys.length) {
    const values = {};
    columnKeys.forEach((k, i) => {
      values[k] = tokens[i].value;
    });
    return { values, ambiguous: false, method: 'TEXT_EXACT_ARITY' };
  }

  if (tokens.length === 0) {
    return { values: {}, ambiguous: false, method: 'TEXT_NO_VALUES', empty: true };
  }

  return {
    values: {},
    ambiguous: true,
    method: 'TEXT_SPARSE_ROW',
    reason:
      `Row carries ${tokens.length} value(s) for ${columnKeys.length} product column(s). ` +
      `Positional assignment would be a guess. Row withheld pending coordinate-based ` +
      `extraction or manual review.`,
    tokens: tokens.map((t) => t.raw),
  };
}

/** Group PDF text items into visual rows by y-coordinate. */
function groupIntoRows(items, yTolerance = 3) {
  const rows = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance);
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

module.exports = { numericTokens, assignByX, assignByTextStrict, groupIntoRows };

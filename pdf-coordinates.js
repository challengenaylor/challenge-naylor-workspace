'use strict';

/**
 * Coordinate-aware PDF extraction, built on pdfjs-dist (not a mock).
 *
 * pdfjs-dist is ESM-only in this version, so it's loaded via dynamic
 * import() from this CommonJS module — that's a packaging detail, not a
 * shortcut in the extraction logic itself.
 *
 * WHAT THIS SOLVES THAT TEXT EXTRACTION CANNOT:
 *
 * 1. Sparse columns (already solved in Phase 1's core/rows.js by refusing to
 *    guess when token count != column count). This module supersedes that
 *    text-based fallback by assigning values to columns using their actual
 *    x-position against detected column-header anchors, so a sparse row no
 *    longer needs to be withheld — it can be correctly resolved.
 *
 * 2. Wrapped labels. A terminal name that PDF layout wraps across two lines
 *    — e.g. "Mount" / "Maunganui" as two separate text items at different
 *    y-coordinates — reads as two unrelated rows to naive line-based
 *    extraction. This module merges a text-only row into the row below it
 *    when: (a) the row has no numeric content, (b) it sits within one
 *    line-height of the next row, and (c) its x-position roughly aligns
 *    with the start of the next row's label region. That merge condition is
 *    deliberately narrow — it must not accidentally swallow a genuine
 *    standalone label row.
 *
 * LIVE-DATA LIMITATION (stated plainly, not glossed over):
 * This module is tested against a synthetic PDF built with pdf-lib that
 * reproduces the known wrapped-line/sparse-column pattern, because this
 * sandbox's network egress does not reach gull.nz / bp.com / z.co.nz, so the
 * real supplier PDF bytes could not be downloaded here. The web_fetch tool
 * used earlier in this project returns pre-extracted text, not raw PDF
 * bytes, so it cannot feed this module either. Running this exact code
 * against the live BP PDF is LIVE VERIFICATION REQUIRED.
 */

async function loadPdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Array<{page:number, items:Array<{str:string,x:number,y:number,width:number,height:number}>}>>}
 */
async function extractPositionedText(pdfBuffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer), useWorkerFetch: false, isEvalSupported: false,
    // Suppresses a benign warning: without a standard-fonts data URL, pdfjs
    // can't substitute missing glyph metrics for non-embedded standard fonts.
    // It doesn't affect text/coordinate extraction, only glyph rendering.
    disableFontFace: true, standardFontDataUrl: undefined, stopAtErrors: false,
  }).promise;

  const pages = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str && it.str.trim().length)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width,
        height: it.height,
      }));
    pages.push({ page: pageNum, items });
  }
  return pages;
}

/** Group text items into visual rows by y-coordinate (descending y = top to bottom). */
function groupIntoRows(items, yTolerance) {
  yTolerance = yTolerance || 2.5;
  const rows = [];
  for (const item of items) {
    let row = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance);
    if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

const NUMERIC_RE = /^-?\d{1,4}(?:\.\d{1,4})?$/;

/**
 * Merge a text-only row into the row immediately below it when the row has
 * no numeric content and sits within ~1.4 line-heights of the next row.
 * This is the wrapped-label fix ("Mount" + "Maunganui" -> "Mount Maunganui").
 */
function mergeWrappedLabelRows(rows) {
  const merged = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hasNumber = row.items.some((it) => NUMERIC_RE.test(it.str.trim()));
    const next = rows[i + 1];

    if (!hasNumber && next) {
      const lineHeight = Math.max(1, Math.abs(row.y - next.y));
      const nextHasNumber = next.items.some((it) => NUMERIC_RE.test(it.str.trim()));
      // Align on whichever item in the row-above sits in the same column as
      // the continuation word below it — NOT the row's leftmost item, which
      // is usually an unrelated earlier column (e.g. Operator).
      const xAligned = row.items.some((it) => Math.abs(it.x - next.items[0].x) < 15);
      const plausibleWrap = lineHeight < 16 && xAligned;

      if (plausibleWrap && (nextHasNumber || i + 2 >= rows.length)) {
        // Prepend this row's text to the next row's leading label items,
        // then skip emitting this row on its own.
        rows[i + 1] = {
          y: next.y,
          items: [...row.items.map((it) => Object.assign({}, it, { _wrapped: true })), ...next.items],
        };
        continue;
      }
    }
    merged.push(row);
  }
  return merged;
}

/**
 * Split a merged row into a leading label (contiguous non-numeric text from
 * the left) and the remaining items (label continuation + numeric cells),
 * joining the label's own possibly-multi-word text with single spaces.
 */
function splitLabelAndValues(rowItems) {
  let i = 0;
  const labelParts = [];
  while (i < rowItems.length && !NUMERIC_RE.test(rowItems[i].str.trim())) {
    labelParts.push(rowItems[i].str.trim());
    i++;
  }
  return { label: labelParts.join(' ').replace(/\s+/g, ' ').trim(), valueItems: rowItems.slice(i) };
}

/**
 * Assign numeric value items to columns by nearest x-anchor. Returns
 * { values: {columnKey: number}, unassigned: [] } — never guesses when a
 * value doesn't clearly belong to one column.
 */
function assignByXAnchor(valueItems, anchors, tolerance) {
  tolerance = tolerance || 45;
  const values = {};
  const unassigned = [];
  for (const item of valueItems) {
    if (!NUMERIC_RE.test(item.str.trim())) continue;
    let best = null, bestDist = Infinity;
    for (const a of anchors) {
      const d = Math.abs(a.x - item.x);
      if (d < bestDist) { bestDist = d; best = a; }
    }
    if (best && bestDist <= tolerance) {
      if (values[best.key] !== undefined) {
        unassigned.push({ value: Number(item.str), reason: 'COLUMN_COLLISION', column: best.key });
      } else {
        values[best.key] = Number(item.str);
      }
    } else {
      unassigned.push({ value: Number(item.str), reason: 'NO_COLUMN_WITHIN_TOLERANCE', x: item.x });
    }
  }
  return { values, unassigned };
}

/**
 * Full pipeline: positioned rows -> wrapped-label merge -> label/value split
 * -> column assignment by x-anchor.
 *
 * @param {Array} items  positioned text items for one page (from extractPositionedText)
 * @param {Array<{key:string,label:string,x:number}>} columnAnchors
 * @returns {Array<{label:string, values:object, unassigned:Array}>}
 */
function extractRows(items, columnAnchors, opts) {
  opts = opts || {};
  const rows = mergeWrappedLabelRows(groupIntoRows(items, opts.yTolerance));
  return rows
    .map((row) => {
      const { label, valueItems } = splitLabelAndValues(row.items);
      if (!label && !valueItems.length) return null;
      const { values, unassigned } = assignByXAnchor(valueItems, columnAnchors, opts.xTolerance);
      return { label, values, unassigned };
    })
    .filter(Boolean)
    .filter((r) => r.label); // drop pure-header/footer text rows with no label captured
}

/**
 * Detect column anchors from a header row: match known header labels to
 * their x-position, so column order is read from the document, not assumed.
 * @param {Array} headerRowItems
 * @param {Array<{key:string, patterns:RegExp[]}>} columnDefs
 */
function detectColumnAnchors(headerRowItems, columnDefs) {
  const anchors = [];
  for (const item of headerRowItems) {
    const text = item.str.trim();
    for (const def of columnDefs) {
      if (def.patterns.some((re) => re.test(text)) && !anchors.some((a) => a.key === def.key)) {
        anchors.push({ key: def.key, label: text, x: item.x });
      }
    }
  }
  return anchors;
}

module.exports = {
  extractPositionedText, groupIntoRows, mergeWrappedLabelRows,
  splitLabelAndValues, assignByXAnchor, extractRows, detectColumnAnchors,
};

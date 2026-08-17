'use strict';

/**
 * Normalization layer: turns each supplier's raw extraction output into the
 * unified record shape validateBatch()/orchestrator.js expect. Reuses the
 * Phase-1 core/ normalizers (terminals, products, GST, dates) rather than
 * duplicating that logic.
 */

const { normaliseTerminal } = require('./core/terminals');
const { normaliseProduct } = require('./core/products');
const { detectGst } = require('./core/gst');
const { parseEffectiveDate } = require('./core/dates');

function mapGstStatus(coreGstStatus) {
  if (coreGstStatus === 'included') return 'GST_INCLUDED';
  if (coreGstStatus === 'excluded') return 'GST_EXCLUDED';
  return 'GST_UNKNOWN'; // covers 'not_stated' and 'unknown'
}

/**
 * Gull: rows already come out of connectors/gull.js as
 * { originalTerminalName, values: {REGULAR_91,PREMIUM_95,DIESEL}, ambiguous? }
 * grouped by effectiveDate block. This flattens + normalizes them.
 */
function normalizeGull(blocks, documentText, supplierId) {
  const gst = detectGst(documentText);
  const records = [];
  for (const block of blocks) {
    const dateInfo = typeof block.effectiveDate === 'string' ? parseEffectiveDate(block.effectiveDate) : block.effectiveDate;
    if (!dateInfo || dateInfo.status !== 'OK') continue;
    for (const row of block.rows) {
      if (row.ambiguous) {
        records.push(reviewStub(supplierId, row.originalTerminalName, 'MULTIPLE_GRADES', null, dateInfo.effectiveDate, 'SPARSE_ROW_TEXT_EXTRACTION'));
        continue;
      }
      const term = normaliseTerminal(row.originalTerminalName, { locationColumn: row.originalLocationName, supplierId });
      for (const [productId, value] of Object.entries(row.values || {})) {
        if (value === undefined || value === null) continue;
        records.push({
          supplierId, terminalId: term.terminalId, terminalRaw: row.originalTerminalName,
          productId, productRaw: productId, priceCentsPerLitre: value,
          gstStatus: mapGstStatus(gst.gstStatus), effectiveDate: dateInfo.effectiveDate,
        });
      }
    }
  }
  return records;
}

/** Z shares the same block/row shape as Gull. */
const normalizeZ = normalizeGull;

/**
 * BP: rows come from bp-header-driven.js as
 * { operator, terminal, columns:[...], values:[...] } — values.length may be
 * less than columns.length for sparse rows, which MUST go to review, not be
 * positionally guessed.
 */
function normalizeBp(blocks, documentText, supplierId) {
  const gst = detectGst(documentText);
  const records = [];
  for (const block of blocks) {
    const dateInfo = parseEffectiveDate(block.effectiveDateLine);
    if (dateInfo.status !== 'OK') continue;
    for (const row of block.rows) {
      const fullLabel = `${row.operator} ${row.terminal}`;
      if (row.values.length !== row.columns.length) {
        // Sparse row: text extraction alone cannot safely say which grade(s)
        // the value(s) belong to. Coordinate extraction (core/pdf-coordinates.js)
        // is the production-capable resolution path for this case; text-only
        // fixtures in this test suite correctly withhold it instead of guessing.
        records.push(reviewStub(supplierId, fullLabel, 'MULTIPLE_GRADES', row.values.join(','), dateInfo.effectiveDate, 'SPARSE_ROW_TEXT_EXTRACTION'));
        continue;
      }
      const term = normaliseTerminal(fullLabel, { operatorColumn: row.operator, supplierId });
      row.columns.forEach((productId, i) => {
        records.push({
          supplierId, terminalId: term.terminalId, terminalRaw: fullLabel,
          productId, productRaw: productId, priceCentsPerLitre: row.values[i],
          gstStatus: mapGstStatus(gst.gstStatus), effectiveDate: dateInfo.effectiveDate,
        });
      });
    }
  }
  return records;
}

/**
 * Mobil: rows come from connectors/mobil.js extractTable() as
 * { locationRaw, terminalRaw, operatorRaw, cells: {REGULAR_91,PREMIUM_95,DIESEL} }
 * where each cell is {status:'OK',value} | {status:'NO_PUBLISHED_PRICE',...} | {status:'INVALID_PRICE',...}
 */
function normalizeMobil(rows, effectiveDate, gstStatus, supplierId) {
  const records = [];
  for (const row of rows) {
    const term = normaliseTerminal(row.terminalRaw, { locationColumn: row.locationRaw, operatorColumn: row.operatorRaw, supplierId });
    for (const [productId, cell] of Object.entries(row.cells)) {
      if (cell.status === 'NO_PUBLISHED_PRICE') continue; // real, deliberate absence — not an error, not a price
      if (cell.status === 'OK') {
        records.push({
          supplierId, terminalId: term.terminalId, terminalRaw: row.terminalRaw,
          productId, productRaw: productId, priceCentsPerLitre: cell.value,
          gstStatus: mapGstStatus(gstStatus), effectiveDate,
        });
      } else {
        records.push(reviewStub(supplierId, row.terminalRaw, productId, cell.raw, effectiveDate, cell.status));
      }
    }
  }
  return records;
}

function reviewStub(supplierId, terminalRaw, productRaw, priceRaw, effectiveDate, reasonTag) {
  // Deliberately fails validation on arrival (missing terminalId/productId),
  // which routes it to reviewPrices with a clear, honest reason rather than
  // a fabricated value.
  return {
    supplierId, terminalId: null, terminalRaw, productId: null, productRaw,
    priceCentsPerLitre: null, gstStatus: null, effectiveDate,
    _extractionNote: reasonTag, priceRaw,
  };
}

module.exports = { normalizeGull, normalizeZ, normalizeBp, normalizeMobil, mapGstStatus };

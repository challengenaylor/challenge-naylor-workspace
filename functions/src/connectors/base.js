'use strict';

const { detectGst } = require('../core/gst');
const { parseEffectiveDate } = require('../core/dates');
const { normaliseTerminal } = require('../core/terminals');
const { normaliseProduct } = require('../core/products');
const { validatePriceRecord } = require('../core/validate');
const { priceRecordId } = require('../core/identity');

/**
 * Every connector implements:
 *   findLatestSource() -> { sourceUrl, documentUrl, contentType }
 *   extract(payload)   -> { blocks: [{ effectiveDate, rows: [...] }], documentText }
 *
 * The base class does everything downstream of extraction, so adding a supplier
 * means describing only how to find and read that supplier's own document.
 */
class SupplierConnector {
  constructor({ id, name, sourceUrl, unit = 'NZ_CENTS_PER_LITRE' }) {
    this.id = id;
    this.name = name;
    this.sourceUrl = sourceUrl;
    this.unit = unit;
  }

  async findLatestSource() { throw new Error(`${this.id}: findLatestSource not implemented`); }
  async extract() { throw new Error(`${this.id}: extract not implemented`); }

  buildRecords({ blocks, documentText, sourceUrl, documentUrl, documentHash, extractionMethod }) {
    const gst = detectGst(documentText);
    const records = [];
    const issues = [];

    for (const block of blocks) {
      const dateInfo = typeof block.effectiveDate === 'string'
        ? parseEffectiveDate(block.effectiveDate)
        : block.effectiveDate;

      if (!dateInfo || dateInfo.status !== 'OK') {
        issues.push({ type: 'DATE_PARSE_FAILED', detail: dateInfo && dateInfo.reason });
        continue;
      }

      for (const row of block.rows) {
        if (row.ambiguous) {
          issues.push({
            type: 'AMBIGUOUS_ROW',
            terminal: row.originalTerminalName,
            detail: row.reason,
            tokens: row.tokens,
          });
          continue;
        }

        const term = normaliseTerminal(row.originalTerminalName, {
          locationColumn: row.originalLocationName,
          operatorColumn: row.originalOperatorName,
          supplierId: this.id,
        });

        if (term.status !== 'OK') {
          issues.push({ type: 'UNKNOWN_TERMINAL', terminal: row.originalTerminalName });
          continue;
        }

        for (const columnKey of Object.keys(row.values)) {
          const publishedValue = row.values[columnKey];
          if (publishedValue === null || publishedValue === undefined) continue;

          const label = (row.columnLabels && row.columnLabels[columnKey]) || columnKey;
          const prod = normaliseProduct(label);
          if (prod.status !== 'OK') {
            issues.push({ type: 'UNKNOWN_PRODUCT', column: columnKey, label });
            continue;
          }

          const rec = {
            supplierId: this.id,
            supplierName: this.name,
            regionId: term.regionId,
            regionLabel: term.regionLabel,
            terminalId: term.terminalId,
            terminalName: term.originalTerminalName,
            originalLocationName: term.originalLocationName,
            operator: term.operator,
            productId: prod.productId,
            productName: prod.productLabel,
            originalProductName: prod.originalProductName,
            publishedValue,
            publishedUnit: this.unit,
            normalisedValue: publishedValue,
            normalisedUnit: 'NZ_CENTS_PER_LITRE',
            gstStatus: gst.gstStatus,
            gstSourceWording: gst.gstSourceWording,
            levies: gst.levies,
            effectiveDate: dateInfo.effectiveDate,
            effectiveFromLocal: dateInfo.effectiveFromLocal,
            timezone: 'Pacific/Auckland',
            retrievedAt: new Date().toISOString(),
            sourceUrl,
            sourceDocumentUrl: documentUrl,
            sourceDocumentHash: documentHash,
            extractionMethod,
          };

          rec.recordId = priceRecordId(rec);
          const v = validatePriceRecord(rec);
          rec.validationStatus = v.validationStatus;
          rec.validationErrors = v.errors;
          rec.validationWarnings = v.warnings;
          records.push(rec);
        }
      }
    }

    return { records, issues, gst };
  }
}

module.exports = { SupplierConnector };

'use strict';

/**
 * Orchestrator — the thing a scheduled job actually calls.
 *
 * Each supplier connector is given an injected `fetchText`/`fetchBuffer`
 * function rather than calling a real network client directly. In
 * production that injection point is `fetch()`; in tests (see
 * test/run-orchestrator.js) it's a function that returns fixture content.
 * This is what lets the whole pipeline — discovery, download, hash,
 * dedupe, extract, validate, store — be tested end-to-end without any
 * network access, and lets the exact same orchestrator code run for real
 * once it's wired to a real fetcher.
 *
 * ERROR ISOLATION: one supplier throwing anywhere in its pipeline must not
 * stop the others. Every supplier's run is wrapped individually.
 */

const { sha256 } = require('./repositories/local/LocalDocumentRepository');
const { validateBatch } = require('./validation/validateExtractedPrice');

/**
 * @param {object} deps
 * @param {object} deps.repos  { priceRepo, documentRepo, reviewRepo, errorRepo }
 * @param {Array<{id:string, run: (fetchers:object) => Promise<{documentUrl:string, documentText:string|Buffer, records:object[]}>}>} deps.connectors
 */
async function runAllSuppliers({ repos, connectors, now }) {
  const results = [];

  for (const connector of connectors) {
    const startedAt = new Date().toISOString();
    try {
      const outcome = await connector.run();

      if (outcome.status === 'SOURCE_UNAVAILABLE' || outcome.status === 'TABLE_STRUCTURE_CHANGED') {
        await repos.errorRepo.record({
          supplierId: connector.id, stage: 'DISCOVERY_OR_STRUCTURE', error: outcome.status, details: outcome.reason,
        });
        results.push({ supplierId: connector.id, status: outcome.status, reason: outcome.reason });
        continue;
      }

      // A connector can succeed via a fallback path while still wanting to
      // report WHY its preferred path failed — logged as a warning (not an
      // error, since the run genuinely succeeded) so the reason is visible
      // instead of a silent, undiagnosable fallback.
      if (outcome._fallbackDiagnostics) {
        await repos.errorRepo.record({
          supplierId: connector.id, stage: 'COORDINATE_EXTRACTION_FALLBACK', error: 'FELL_BACK_TO_TEXT_EXTRACTION',
          details: JSON.stringify(outcome._fallbackDiagnostics),
        });
      }

      const docHash = sha256(outcome.documentContent);
      const docResult = await repos.documentRepo.record({
        supplierId: connector.id,
        sourceUrl: outcome.sourceUrl,
        documentUrl: outcome.documentUrl,
        sha256: docHash,
        retrievedAt: startedAt,
        extractionMethod: outcome.extractionMethod,
      });

      const { validPrices, reviewPrices } = validateBatch(
        outcome.records.map((r) => Object.assign({ sourceDocumentHash: docHash }, r)),
        { now },
      );

      const putResults = [];
      for (const price of validPrices) {
        putResults.push(await repos.priceRepo.putCurrent(price));
        if (repos.reviewRepo.resolveSuperseded) {
          // A price that validates cleanly now may have previously failed —
          // e.g. today's timezone bug flagged genuinely-valid Z prices as
          // STALE_DATE:FUTURE before the fix. Without this, that old review
          // entry sits in the queue forever looking like an unresolved
          // problem even after the underlying bug is fixed and re-deployed.
          await repos.reviewRepo.resolveSuperseded(price.supplierId, price.terminalRaw, price.productRaw);
          // ALSO resolve any "MULTIPLE_GRADES" stub for this terminal — a
          // sparse row is logged generically (not tied to one product,
          // since text extraction couldn't say which grade the value(s)
          // belonged to). Coordinate extraction resolving it produces
          // separate per-grade records, none of which match "MULTIPLE_
          // GRADES" by exact productRaw — without this second call, a
          // sparse row that's now correctly resolved for EVERY grade it
          // publishes still leaves its old generic review entry stuck
          // pending forever. Confirmed live 20 Aug 2026: this is exactly
          // why BP's already-fixed sparse rows kept reappearing in the
          // error banner even after the fix deployed successfully.
          await repos.reviewRepo.resolveSuperseded(price.supplierId, price.terminalRaw, 'MULTIPLE_GRADES');
        }
      }
      for (const review of reviewPrices) {
        const errors = review._extractionNote ? [review._extractionNote, ...review.validationErrors] : review.validationErrors;
        await repos.reviewRepo.enqueue({
          supplierId: connector.id,
          terminalRaw: review.terminalRaw || review.terminalId,
          productRaw: review.productRaw || review.productId,
          priceRaw: review.priceRaw !== undefined ? review.priceRaw : review.priceCentsPerLitre,
          effectiveDate: review.effectiveDate,
          validationErrors: errors,
          sourceDocumentHash: docHash,
          sourceUrl: outcome.sourceUrl,
          documentUrl: outcome.documentUrl,
          extractionMethod: outcome.extractionMethod,
        });
      }

      results.push({
        supplierId: connector.id, status: 'OK',
        isNewDocument: docResult.isNewDocument,
        validCount: validPrices.length, reviewCount: reviewPrices.length,
        changes: putResults.filter((p) => p.changed).length,
      });
    } catch (err) {
      await repos.errorRepo.record({
        supplierId: connector.id, stage: 'CONNECTOR_EXCEPTION', error: err.message, details: err.stack,
      });
      results.push({ supplierId: connector.id, status: 'ERROR', reason: err.message });
    }
  }

  return results;
}

module.exports = { runAllSuppliers };

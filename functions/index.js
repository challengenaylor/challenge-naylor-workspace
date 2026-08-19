'use strict';

/**
 * Cloud Function entry point. This is what Firebase actually deploys and
 * runs on a schedule — everything it calls (orchestrator, connectors,
 * validation, repositories) was built and tested earlier in this project;
 * this file is the thin layer that wires real Firestore + real network
 * fetch() into that already-tested logic.
 *
 * DEPLOY NOTE: this file expects to live at the ROOT of what `firebase init
 * functions` generates (i.e. package.json sitting next to it must list
 * firebase-functions and firebase-admin as dependencies — `firebase init`
 * adds those automatically). The actual business logic it calls lives under
 * ./src/, copied in from tgp/functions/src — see the deploy instructions
 * for exactly what to copy where.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// A secret password only you know — set via:
//   firebase functions:secrets:set TGP_MANUAL_KEY
// Never hard-code an actual secret value in this file, since this file lives
// in your public GitHub repository.
const manualRunKey = defineSecret('TGP_MANUAL_KEY');

const { runAllSuppliers } = require('./src/orchestrator');
const { FirestorePriceRepository } = require('./src/repositories/firestore/FirestorePriceRepository');
const { FirestoreDocumentRepository } = require('./src/repositories/firestore/FirestoreDocumentRepository');
const { FirestoreReviewRepository } = require('./src/repositories/firestore/FirestoreReviewRepository');
const { FirestoreErrorRepository } = require('./src/repositories/firestore/FirestoreErrorRepository');
const { FirestoreAipRepository } = require('./src/repositories/firestore/FirestoreAipRepository');

const gull = require('./src/connectors/live/gull-live');
const z = require('./src/connectors/live/z-live');
const bp = require('./src/connectors/live/bp-live');
const mobil = require('./src/connectors/live/mobil-live');
const tasman = require('./src/connectors/live/tasman-live');
const aip = require('./src/connectors/live/aip-live');

async function runOnce() {
  const repos = {
    priceRepo: new FirestorePriceRepository(db),
    documentRepo: new FirestoreDocumentRepository(db),
    reviewRepo: new FirestoreReviewRepository(db),
    errorRepo: new FirestoreErrorRepository(db),
  };

  const results = await runAllSuppliers({
    repos, connectors: [gull, z, bp, mobil, tasman], now: new Date().toISOString(),
  });

  results.forEach((r) => {
    if (r.status === 'OK') {
      logger.info(`${r.supplierId}: OK — ${r.validCount} valid, ${r.reviewCount} needing review, ${r.changes} changed`);
    } else {
      logger.warn(`${r.supplierId}: ${r.status} — ${r.reason}`);
    }
  });

  // AIP runs separately from the price-repository pipeline above — it
  // writes real observations (one per weekday visible on the page, so a
  // single run can backfill several days at once) rather than TGP price
  // records. Any single day's write failing (e.g. a malformed row) doesn't
  // stop the others, matching the same per-supplier isolation as above.
  const aipRepo = new FirestoreAipRepository(db);
  let aipResult;
  try {
    const outcome = await aip.run();
    if (outcome.status === 'OK') {
      let written = 0;
      for (const obs of outcome.observations) {
        if (obs.ulp === null && obs.diesel === null) continue;
        const r = await aipRepo.recordObservation({
          date: obs.date, ulp: obs.ulp, diesel: obs.diesel,
          source: aip.SOURCE_URL, origin: 'LIVE_FETCH',
        });
        if (r.isNew) written++;
      }
      aipResult = { supplierId: 'AIP', status: 'OK', newObservations: written, totalSeen: outcome.observations.length };
      logger.info(`AIP: OK — ${written} new observation(s) of ${outcome.observations.length} seen`);
    } else {
      aipResult = { supplierId: 'AIP', status: outcome.status, reason: outcome.reason };
      logger.warn(`AIP: ${outcome.status} — ${outcome.reason}`);
    }
  } catch (err) {
    aipResult = { supplierId: 'AIP', status: 'ERROR', reason: err.message };
    logger.error('AIP run failed', err);
  }

  return [...results, aipResult];
}

/**
 * Scheduled run — daily at 06:00 Pacific/Auckland. Prices update at most
 * weekly per supplier, but checking daily costs almost nothing and means a
 * new price is never more than a day stale, matching the original brief
 * ("if a new price appears, the system must detect it").
 */
exports.tgpDailyAutomation = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'Pacific/Auckland', region: 'australia-southeast1' },
  async () => { await runOnce(); },
);

/**
 * Manual trigger — an HTTPS endpoint so you can run the automation on
 * demand (e.g. right after deploying, to check it works, without waiting
 * for 6am) instead of only via the schedule.
 *
 * LOCKED DOWN: requires ?key=<your secret> in the URL, matching the secret
 * set via `firebase functions:secrets:set TGP_MANUAL_KEY`. Without this,
 * this address would be runnable by anyone on the internet who found it —
 * harmless in terms of data exposure, but it could rack up unexpected usage
 * if hit repeatedly by an automated scanner, which is the one real cost
 * risk on an otherwise free-tier workload.
 */
exports.tgpManualRun = onRequest(
  { region: 'australia-southeast1', secrets: [manualRunKey] },
  async (req, res) => {
    if (req.query.key !== manualRunKey.value()) {
      res.status(403).json({ ok: false, error: 'Missing or incorrect key.' });
      return;
    }
    try {
      const results = await runOnce();
      res.status(200).json({ ok: true, results });
    } catch (err) {
      logger.error('Manual run failed', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  },
);

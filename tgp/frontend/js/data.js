/* ==========================================================================
   TGP.data — now backed by real Firestore data instead of mock/demo arrays.

   IMPORTANT SHAPE NOTE: everything downstream (calculations.js, charts.js,
   app.js) reads TGP.config and TGP.data.* exactly as before — this file's
   whole job is to populate those same shapes from real Firestore documents
   instead of hard-coded arrays, so nothing else in the app needed to change.

   Because reading from Firestore is asynchronous (it takes a moment to
   arrive over the network), this file exposes TGP.dataReady — a Promise
   that resolves once real data has loaded. app.js awaits this before its
   first render, and shows a loading state until then.
   ========================================================================== */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- Firebase init
  // This config is PUBLIC by design — it identifies which project to talk
  // to, it is not a secret credential. Real access control lives entirely
  // in the Firestore security rules, not in hiding this snippet.
  const firebaseConfig = {
    apiKey: "AIzaSyAPwS1GFwqj6KR4dQgxifykh9HS5km6OX4",
    authDomain: "alpha-7fce5.firebaseapp.com",
    projectId: "alpha-7fce5",
    storageBucket: "alpha-7fce5.firebasestorage.app",
    messagingSenderId: "10647816245",
    appId: "1:10647816245:web:fbfb982260cf2eef97097c",
    measurementId: "G-68RH7V8XL2",
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // ---------------------------------------------------------------- static config
  // Suppliers/regions/products change rarely if ever, so these stay as
  // simple static config rather than an extra round-trip to Firestore —
  // consistent with how the tested backend (tgp/functions) defines them.
  const PRODUCTS = [
    { id: 'REGULAR_91', label: 'Regular 91', shortLabel: '91' },
    { id: 'PREMIUM_95', label: 'Premium 95', shortLabel: '95' },
    { id: 'DIESEL', label: 'Diesel', shortLabel: 'Diesel' },
  ];
  const REGIONS = [
    { id: 'AUCKLAND_WIRI', label: 'Auckland — Wiri', active: true },
    { id: 'MOUNT_MAUNGANUI', label: 'Mount Maunganui', active: true },
    // Real terminals your suppliers publish but that aren't part of the
    // day-to-day view — selectable from the Terminal dropdown, just not
    // shown by default.
    { id: 'MARSDEN_POINT', label: 'Marsden Point', active: false },
    { id: 'WELLINGTON', label: 'Wellington', active: false },
    { id: 'CHRISTCHURCH', label: 'Christchurch', active: false },
    { id: 'DUNEDIN', label: 'Dunedin', active: false },
    { id: 'NAPIER', label: 'Napier', active: false },
    { id: 'NEW_PLYMOUTH', label: 'New Plymouth', active: false },
    { id: 'TIMARU', label: 'Timaru', active: false },
    { id: 'NELSON', label: 'Nelson', active: false },
    { id: 'BLUFF', label: 'Bluff', active: false },
  ];
  const SUPPLIERS = [
    { id: 'GULL', name: 'Gull New Zealand', sourceType: 'PDF', color: '#0f6659' },
    { id: 'Z', name: 'Z Energy', sourceType: 'PDF', color: '#1c7a4c' },
    { id: 'BP', name: 'BP New Zealand', sourceType: 'PDF', color: '#a1311f' },
    { id: 'MOBIL', name: 'Mobil', sourceType: 'HTML', color: '#3a5a9b' },
    { id: 'TASMAN', name: 'Tasman Fuels', sourceType: 'HTML', color: '#8a5a1c' },
  ];

  const supplierById = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));
  const regionById = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
  const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

  // ---------------------------------------------------------------- helpers
  /** Backend field names (priceCentsPerLitre, terminalId, etc.) mapped to
   * the field names the existing UI code expects (currentValue, regionId,
   * etc.) — this is the one translation layer between "what the tested
   * backend produces" and "what the already-built UI reads". */
  function mapPriceRecord(doc, previous) {
    const terminalId = doc.terminalId || '';
    const regionId = terminalId.split('__')[1] || null; // e.g. "Z__AUCKLAND_WIRI__WOSL" -> "AUCKLAND_WIRI"
    const region = regionById[regionId];
    const supplier = supplierById[doc.supplierId];
    const product = productById[doc.productId];

    const previousValue = previous ? previous.priceCentsPerLitre : null;
    const change = typeof previousValue === 'number' ? +(doc.priceCentsPerLitre - previousValue).toFixed(2) : null;
    const changePct = (typeof change === 'number' && previousValue) ? +((change / previousValue) * 100).toFixed(2) : null;
    const direction = change === null ? 'NEW' : change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT';

    return {
      recordId: terminalId + '|' + doc.productId,
      supplierId: doc.supplierId,
      supplierName: supplier ? supplier.name : doc.supplierId,
      regionId: regionId,
      regionLabel: region ? region.label : (regionId || 'Unknown region'),
      terminalName: doc.terminalRaw || doc.terminalId,
      productId: doc.productId,
      productName: product ? product.label : doc.productId,
      productShort: product ? product.shortLabel : doc.productId,
      currentValue: doc.priceCentsPerLitre,
      previousValue: previousValue,
      previousEffectiveDate: previous ? previous.effectiveDate : null,
      change: change,
      changePct: changePct,
      direction: direction,
      gstStatus: (doc.gstStatus || '').toLowerCase().includes('included') ? 'included'
        : (doc.gstStatus || '').toLowerCase().includes('excluded') ? 'excluded' : 'not_stated',
      effectiveDate: doc.effectiveDate,
      retrievedAt: doc.retrievedAt,
      sourceUrl: doc.sourceUrl,
      sourceDocumentUrl: doc.sourceDocumentUrl,
      extractionMethod: doc.extractionMethod,
      validationStatus: doc.validationStatus || 'PUBLISHED',
    };
  }

  async function loadCurrentPrices() {
    const [currentSnap, historySnap] = await Promise.all([
      db.collection('tgpApp').doc('prices').collection('current').get(),
      db.collection('tgpApp').doc('prices').collection('history').get(),
    ]);

    // Group history by the same _key current records use, keep only the
    // most recent prior observation per key — that's "last week" (or
    // whichever the previous captured price was).
    const latestPriorByKey = {};
    historySnap.docs.forEach((d) => {
      const h = d.data();
      const existing = latestPriorByKey[h._key];
      if (!existing || h.effectiveDate > existing.effectiveDate) latestPriorByKey[h._key] = h;
    });

    return currentSnap.docs.map((d) => mapPriceRecord(d.data(), latestPriorByKey[d.data()._key]));
  }

  async function loadDocuments() {
    const snap = await db.collection('tgpApp').doc('_').collection('sourceDocuments').get();
    return snap.docs.map((d) => {
      const doc = d.data();
      return {
        supplierId: doc.supplierId,
        supplierName: supplierById[doc.supplierId] ? supplierById[doc.supplierId].name : doc.supplierId,
        documentUrl: doc.documentUrl,
        effectiveDate: doc.retrievedAt ? doc.retrievedAt.slice(0, 10) : '',
        retrievedAt: doc.retrievedAt,
        hash: doc.sha256 || '',
        productsFound: [],
        terminalsFound: [],
        status: 'PROCESSED',
      };
    });
  }

  async function loadErrors() {
    const snap = await db.collection('tgpApp').doc('_').collection('extractionErrors')
      .orderBy('timestamp', 'desc').limit(100).get();
    return snap.docs.map((d) => {
      const e = d.data();
      return {
        id: e.id, severity: e.stage === 'CONNECTOR_EXCEPTION' ? 'ERROR' : 'WARNING',
        supplierId: e.supplierId, date: (e.timestamp || '').slice(0, 10), timestamp: e.timestamp || null,
        message: e.details || e.error, status: 'Needs Review', resolution: null,
      };
    });
  }

  async function loadReviewQueue() {
    const snap = await db.collection('tgpApp').doc('_').collection('reviewQueue')
      .where('status', '==', 'NEEDS_REVIEW').get();
    return snap.docs.map((d) => {
      const r = d.data();
      return {
        id: r.id, severity: 'WARNING', supplierId: r.supplierId,
        date: (r.effectiveDate || r.queuedAt || '').slice(0, 10),
        message: `${r.terminalRaw || '?'} / ${r.productRaw || '?'}: ${(r.validationErrors || []).join(', ')}`,
        status: 'Needs Review', resolution: null,
      };
    });
  }

  async function loadAip() {
    const snap = await db.collection('tgpApp').doc('_').collection('aip').orderBy('date').get();
    return snap.docs.map((d) => d.data());
  }

  // ---------------------------------------------------------------- assemble
  global.TGP = global.TGP || {};
  global.TGP.config = { suppliers: SUPPLIERS, regions: REGIONS, products: PRODUCTS,
    availability: null }; // no longer needed by the UI directly; history chart falls back gracefully
  global.TGP.lookup = { supplierById, regionById, productById };
  global.TGP.db = db; // exposed so storage.js can write Challenge pricing to the same database

  global.TGP.data = { currentPrices: [], priceHistory: [], aipPrices: [], documents: [], automationRuns: [], errors: [] };

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} took longer than ${ms / 1000}s — check your internet connection.`)), ms)),
    ]);
  }

  global.TGP.dataReady = withTimeout((async () => {
    try {
      const [currentPrices, documents, connectorErrors, reviewErrors, aipPrices] = await Promise.all([
        loadCurrentPrices(), loadDocuments(), loadErrors(), loadReviewQueue(), loadAip(),
      ]);

      // An error only means something right now if no LATER successful
      // fetch has happened for that supplier since. Errors never expire on
      // their own — a 403 from three fixes ago would otherwise sit in this
      // list forever looking exactly as urgent as one from five minutes ago.
      const latestSuccessBySupplier = {};
      documents.forEach((d) => {
        const cur = latestSuccessBySupplier[d.supplierId];
        if (!cur || d.retrievedAt > cur) latestSuccessBySupplier[d.supplierId] = d.retrievedAt;
      });
      const currentConnectorErrors = connectorErrors.filter((e) => {
        const latestSuccess = latestSuccessBySupplier[e.supplierId];
        return !latestSuccess || !e.timestamp || e.timestamp > latestSuccess;
      });

      global.TGP.data.currentPrices = currentPrices;
      global.TGP.data.documents = documents;
      global.TGP.data.errors = [...currentConnectorErrors, ...reviewErrors];
      global.TGP.data.aipPrices = aipPrices;
      global.TGP.data.priceHistory = []; // history charting against live history is a follow-up piece, not wired yet
      global.TGP.data.automationRuns = SUPPLIERS.map((s) => {
        const latestDoc = documents.find((d) => d.supplierId === s.id);
        const hasError = global.TGP.data.errors.some((e) => e.supplierId === s.id);
        return {
          supplierId: s.id, supplierName: s.name, connector: s.sourceType,
          lastCheck: latestDoc ? latestDoc.retrievedAt : null,
          lastSuccess: latestDoc ? latestDoc.retrievedAt : null,
          status: hasError ? 'WARNING' : (latestDoc ? 'OK' : 'UNKNOWN'),
          productsFound: currentPrices.filter((p) => p.supplierId === s.id).length,
          terminalsFound: new Set(currentPrices.filter((p) => p.supplierId === s.id).map((p) => p.terminalName)).size,
          lastError: null, nextCheck: null,
        };
      });
      return true;
    } catch (err) {
      console.error('TGP: failed to load live data from Firestore', err);
      throw err;
    }
  })(), 15000, 'Loading live data');
}(window));

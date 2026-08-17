'use strict';

/**
 * Test-only connector wrappers. Each exposes the same .run() shape the
 * orchestrator expects from a real connector — { status, sourceUrl,
 * documentUrl, documentContent, extractionMethod, records } — but reads its
 * "network" content from disk fixtures instead of fetch(). Swapping these
 * for real fetch()-backed versions in production changes nothing about
 * orchestrator.js, pipeline.js, or the validation/repository layers below
 * them — that's the point of the interface.
 */

const fs = require('fs');
const path = require('path');

const { GullConnector } = require('../../src/connectors/gull');
const { ZConnector } = require('../../src/connectors/z');
const { extractBp } = require('../../src/connectors/bp-header-driven');
const { extractTable, findEffectiveDate, detectGst: mobilGst } = require('../../src/connectors/mobil');
const { findGullDocument, findZDocument } = require('../../src/connectors/discovery');
const { normalizeGull, normalizeZ, normalizeBp, normalizeMobil } = require('../../src/pipeline');

const FX = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

function gullFixtureConnector() {
  return {
    id: 'GULL',
    async run() {
      const landing = FX('gull-landing-2026-08-17.html');
      const discovery = findGullDocument(landing);
      if (discovery.status !== 'OK') return { status: 'SOURCE_UNAVAILABLE', reason: discovery.reason };

      const documentText = FX('gull-2026-08-14.txt'); // stands in for the downloaded PDF's extracted text
      const c = new GullConnector();
      const { blocks } = c.extract(documentText);
      const records = normalizeGull(blocks, documentText, 'GULL');

      return {
        status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
        documentContent: documentText, extractionMethod: 'TEXT_EXACT_ARITY', records,
      };
    },
  };
}

function zFixtureConnector() {
  return {
    id: 'Z',
    async run() {
      const landing = FX('z-landing-2026-08-17.html');
      const discovery = findZDocument(landing);
      if (discovery.status !== 'OK') return { status: 'SOURCE_UNAVAILABLE', reason: discovery.reason };

      const documentText = FX('z-2026-08-12.txt');
      const c = new ZConnector();
      const { blocks } = c.extract(documentText);
      const records = normalizeZ(blocks, documentText, 'Z');

      return {
        status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
        documentContent: documentText, extractionMethod: 'TEXT_EXACT_ARITY', records,
      };
    },
  };
}

function bpFixtureConnector() {
  return {
    id: 'BP',
    async run() {
      const documentUrl = 'https://www.bp.com/content/dam/bp/country-sites/en_nz/new-zealand/home/documents/tgp-pricing-uploads/terminal-gate-prices-nz.pdf';
      const documentText = FX('bp-2026-08-14.txt');
      const result = extractBp(documentText);
      if (result.status !== 'OK') return result;
      const records = normalizeBp(result.blocks, documentText, 'BP');

      return {
        status: 'OK', sourceUrl: documentUrl, documentUrl,
        documentContent: documentText, extractionMethod: 'TEXT_HEADER_DRIVEN', records,
      };
    },
  };
}

function mobilFixtureConnector(fixtureName) {
  return {
    id: 'MOBIL',
    async run() {
      const documentUrl = 'https://www.mobil.co.nz/en-nz/commercial-fuels/terminal-gate';
      const html = FX(fixtureName || 'mobil-2026-08-15.html');
      const table = extractTable(html);
      if (table.status !== 'OK') return table;
      const eff = findEffectiveDate(html);
      if (eff.status !== 'OK') return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Effective date not found: ' + eff.reason };
      const gst = mobilGst(html);
      const records = normalizeMobil(table.rows, eff.effectiveDate, gst.gstStatus === 'GST_INCLUDED' ? 'included' : 'not_stated', 'MOBIL');

      return {
        status: 'OK', sourceUrl: documentUrl, documentUrl,
        documentContent: html, extractionMethod: 'HTML_TABLE_HEADER_DRIVEN', records,
      };
    },
  };
}

/** A connector that always throws — used to prove error isolation. */
function alwaysThrowsConnector(id) {
  return { id, async run() { throw new Error(`Simulated hard failure in ${id} connector (e.g. network timeout).`); } };
}

module.exports = { gullFixtureConnector, zFixtureConnector, bpFixtureConnector, mobilFixtureConnector, alwaysThrowsConnector };

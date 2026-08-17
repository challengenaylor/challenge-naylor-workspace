'use strict';

const { ZConnector } = require('../z');
const { findZDocument } = require('../discovery');
const { normalizeZ } = require('../../pipeline');
const { extractPdfAsLineText } = require('../../core/pdf-coordinates');

async function run() {
  const c = new ZConnector();

  const landingRes = await fetch(c.sourceUrl);
  if (!landingRes.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `Z landing page returned HTTP ${landingRes.status}` };
  const landingHtml = await landingRes.text();

  const discovery = findZDocument(landingHtml);
  if (discovery.status !== 'OK') return discovery;

  const docRes = await fetch(discovery.documentUrl);
  if (!docRes.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `Z PDF returned HTTP ${docRes.status}` };
  const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

  const documentText = await extractPdfAsLineText(pdfBuffer);
  const { blocks } = c.extract(documentText);
  const records = normalizeZ(blocks, documentText, 'Z');

  return {
    status: 'OK', sourceUrl: c.sourceUrl, documentUrl: discovery.documentUrl,
    documentContent: pdfBuffer, extractionMethod: 'TEXT_EXACT_ARITY', records,
  };
}

module.exports = { id: 'Z', run };

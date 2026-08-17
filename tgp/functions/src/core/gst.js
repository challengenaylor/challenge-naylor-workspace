'use strict';

/**
 * GST and tax-component detection.
 *
 * Rule: GST status comes from words actually printed in the source document.
 * If the document does not say, status is NOT_STATED and the price is never
 * silently adjusted. The original sentence is stored so a human can audit the
 * call later.
 *
 * All four NZ importers checked publish GST-INCLUSIVE prices, but they say so
 * with different wording and each lists a different set of levies, so the
 * wording is captured verbatim rather than assumed.
 */

const INCLUDED_PATTERNS = [
  /inclusive of gst/i,
  /includ\w*[^.]{0,80}\bgst\b/i,
  /\bgst\b[^.]{0,40}\bincluded\b/i,
];

const EXCLUDED_PATTERNS = [
  /exclusive of gst/i,
  /\bexclud\w*[^.]{0,80}\bgst\b/i,
  /\bgst\b[^.]{0,40}\bexcluded\b/i,
  /\bplus gst\b/i,
  /\bex\.? gst\b/i,
];

/** Levies that may or may not be inside the published figure. */
const LEVY_TOKENS = [
  { re: /\bets\b|emissions trading/i, tag: 'ETS' },
  { re: /\bnltf\b|national land transport/i, tag: 'NLTF' },
  { re: /\bpefml\b|engine fuel monitoring/i, tag: 'PEFML' },
  { re: /\bacc\b/i, tag: 'ACC' },
  { re: /\blaft\b|\blapt\b|local authorit\w+ (?:fuel|petroleum) tax/i, tag: 'LAFT' },
  { re: /\brft\b|regional fuel tax/i, tag: 'RFT' },
  { re: /\bexcise\b/i, tag: 'EXCISE' },
];

function detectGst(documentText) {
  const text = String(documentText || '');

  // Excluded is checked first: "exclude charges ... GST" style sentences are
  // rarer but far more damaging to miss than a false NOT_STATED.
  for (const re of EXCLUDED_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return {
        gstStatus: 'excluded',
        gstSourceWording: extractSentence(text, m.index),
        levies: detectLevies(text),
      };
    }
  }

  for (const re of INCLUDED_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return {
        gstStatus: 'included',
        gstSourceWording: extractSentence(text, m.index),
        levies: detectLevies(text),
      };
    }
  }

  return {
    gstStatus: 'not_stated',
    gstSourceWording: null,
    levies: detectLevies(text),
    note: 'Document does not state GST treatment. Price stored as published; no adjustment applied.',
  };
}

function detectLevies(text) {
  return LEVY_TOKENS.filter((l) => l.re.test(text)).map((l) => l.tag);
}

function extractSentence(text, index) {
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1);
  let end = text.indexOf('\n', index);
  if (end === -1) end = Math.min(text.length, index + 240);
  return text.slice(start, end).trim().slice(0, 300);
}

/**
 * Comparison guard. Two prices are only directly comparable when their GST
 * status matches and both are known.
 */
function comparable(a, b) {
  if (a.gstStatus !== b.gstStatus) {
    return { ok: false, reason: `GST mismatch: ${a.gstStatus} vs ${b.gstStatus}` };
  }
  if (a.gstStatus === 'not_stated' || a.gstStatus === 'unknown') {
    return { ok: false, reason: 'GST treatment not established for both prices' };
  }
  return { ok: true };
}

module.exports = { detectGst, comparable, LEVY_TOKENS };

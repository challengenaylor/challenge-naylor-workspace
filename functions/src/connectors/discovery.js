'use strict';

/**
 * Shared dynamic-source-discovery helpers for Z and Gull: find the current
 * TGP document link on a landing page rather than assuming a filename.
 *
 * Regexes are written against real <a href="..."> markup, matched loosely
 * enough to survive attribute-order/whitespace/quote-style variation, since
 * the exact byte-for-byte raw HTML of either live page could not be
 * captured in this sandbox (see fixtures/*-landing-*.html for why).
 */

function findLinkByPattern(html, hrefPattern) {
  // Match href="..." or href='...' in either attribute order relative to other attrs.
  const re = new RegExp(`href=["']([^"']*${hrefPattern.source}[^"']*)["']`, 'i');
  const m = html.match(re);
  if (!m) return { status: 'NOT_FOUND' };
  return { status: 'OK', href: m[1] };
}

function resolveUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch (e) {
    return null;
  }
}

/** Gull: find the TGP PDF link on the fuelcategorylatest/tgp page. */
function findGullDocument(html) {
  const found = findLinkByPattern(html, /TGP[^"']*\.pdf/i);
  if (found.status !== 'OK') {
    return { status: 'SOURCE_UNAVAILABLE', reason: 'No TGP PDF link found on the Gull TGP landing page.' };
  }
  const url = resolveUrl(found.href, 'https://gull.nz/fuelcategorylatest/tgp/');
  if (!url) return { status: 'SOURCE_UNAVAILABLE', reason: `Found a link but could not resolve it to an absolute URL: "${found.href}"` };
  return { status: 'OK', documentUrl: url };
}

/** Z: find the TGP price-list PDF link on the terminal-gate-pricing page. */
function findZDocument(html) {
  const found = findLinkByPattern(html, /TGP-Price-\d{8}\.pdf/i);
  if (found.status !== 'OK') {
    return { status: 'SOURCE_UNAVAILABLE', reason: 'No "TGP-Price-<date>.pdf" link found on the Z terminal-gate-pricing page.' };
  }
  const url = resolveUrl(found.href, 'https://www.z.co.nz/for-businesses/fuels-and-services/terminal-gate-pricing');
  if (!url) return { status: 'SOURCE_UNAVAILABLE', reason: `Found a link but could not resolve it to an absolute URL: "${found.href}"` };
  return { status: 'OK', documentUrl: url };
}

module.exports = { findLinkByPattern, resolveUrl, findGullDocument, findZDocument };

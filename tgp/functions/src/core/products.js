'use strict';

/**
 * Product normalisation.
 *
 * The TGP regime under the Fuel Industry Act 2020 currently covers three grades:
 * Regular 91, Premium 95 and diesel. Every live document checked publishes
 * exactly those three and nothing else. The system is nevertheless open-ended:
 * an unrecognised column is recorded as a discovered product needing review,
 * never dropped and never force-fitted into an existing grade.
 */

const PRODUCTS = {
  REGULAR_91: {
    id: 'REGULAR_91',
    label: 'Regular 91',
    patterns: [
      /\bregular\s*91\b/i,
      /\bm91\b/i,
      /\b91\s*unl/i,
      /unleaded\s*91/i,
      /regular unleaded/i,
      /\b91\b/,
    ],
  },
  PREMIUM_95: {
    id: 'PREMIUM_95',
    label: 'Premium 95',
    patterns: [
      /\bpremium\s*95\b/i,
      /\bm95\b/i,
      /unleaded\s*95/i,
      /premium unleaded/i,
      /\b95\b/,
    ],
  },
  DIESEL: {
    id: 'DIESEL',
    label: 'Diesel',
    patterns: [
      /\bdiesel\b/i,
      /\badf\b/i,
      /\bulsd\b/i,
      /automotive diesel/i,
      /\buls\s*diesel\b/i,
    ],
  },
};

function normaliseProduct(originalName) {
  const name = String(originalName || '').trim();

  // Order matters: 95 before 91 so "Premium 95" cannot be caught by a loose /91/.
  for (const id of ['PREMIUM_95', 'REGULAR_91', 'DIESEL']) {
    const p = PRODUCTS[id];
    if (p.patterns.some((re) => re.test(name))) {
      return {
        productId: p.id,
        productLabel: p.label,
        originalProductName: name,
        status: 'OK',
      };
    }
  }

  return {
    productId: null,
    productLabel: null,
    originalProductName: name,
    status: 'UNKNOWN_PRODUCT',
    note: 'Column heading not recognised. Recorded for admin review; not published.',
  };
}

module.exports = { PRODUCTS, normaliseProduct };

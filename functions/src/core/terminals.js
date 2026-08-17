'use strict';

/**
 * Terminal normalisation.
 *
 * IMPORTANT MODELLING DECISION
 * ----------------------------
 * "Mount Maunganui" is not one terminal. Live documents show at least four
 * physically distinct terminals at that location, each with its own price:
 *
 *   Z    -> "Z Mount Maunganui North", "Z Mount Maunganui South"
 *   BP   -> "NZOSL Mt Maunganui BP"  and  "TNZ Mt Maunganui TNZ"
 *   Gull -> "TNZ Mt Maunganui"
 *   Mobil-> "Mount Maunganui / Mobil"
 *
 * Flattening these to a single MOUNT_MAUNGANUI key would merge different prices
 * into one bucket and make history meaningless. So the model is two-level:
 *
 *   region   MOUNT_MAUNGANUI      <- what the dashboard filters on
 *     terminal  Z_MT_MAUNGANUI_NORTH, BP_MT_MAUNGANUI_NZOSL, ...
 *
 * Regions are activated/deactivated by the admin. Terminals are discovered.
 * Original supplier wording is always retained on the price record.
 */

const REGIONS = {
  AUCKLAND_WIRI: {
    id: 'AUCKLAND_WIRI',
    label: 'Auckland — Wiri',
    patterns: [/\bwiri\b/i, /wiri oil service/i, /\bwosl\b.*wiri/i],
  },
  MOUNT_MAUNGANUI: {
    id: 'MOUNT_MAUNGANUI',
    label: 'Mount Maunganui',
    patterns: [/\bmount maunganui\b/i, /\bmt\.? maunganui\b/i, /\bmaunganui\b/i],
  },
  MARSDEN_POINT: {
    id: 'MARSDEN_POINT',
    label: 'Marsden Point',
    patterns: [/marsden point/i],
  },
  WELLINGTON: {
    id: 'WELLINGTON',
    label: 'Wellington',
    patterns: [/\bseaview\b/i, /\bhutt city\b/i, /\bwellington\b/i],
  },
  NAPIER: { id: 'NAPIER', label: 'Napier', patterns: [/\bnapier\b/i] },
  NELSON: { id: 'NELSON', label: 'Nelson', patterns: [/\bnelson\b/i] },
  NEW_PLYMOUTH: { id: 'NEW_PLYMOUTH', label: 'New Plymouth', patterns: [/new plymouth/i] },
  CHRISTCHURCH: {
    id: 'CHRISTCHURCH',
    label: 'Christchurch',
    patterns: [/\blyttelton\b/i, /\bwoolston\b/i, /\bchristchurch\b/i],
  },
  TIMARU: { id: 'TIMARU', label: 'Timaru', patterns: [/\btimaru\b/i] },
  DUNEDIN: { id: 'DUNEDIN', label: 'Dunedin', patterns: [/\bdunedin\b/i] },
  BLUFF: { id: 'BLUFF', label: 'Bluff', patterns: [/\bbluff\b/i] },
};

/** Sub-site qualifiers that distinguish terminals inside one region. */
const QUALIFIERS = [
  { re: /\bnorth\b/i, tag: 'NORTH' },
  { re: /\bsouth\b/i, tag: 'SOUTH' },
  { re: /\blyttelton\b/i, tag: 'LYTTELTON' },
  { re: /\bwoolston\b/i, tag: 'WOOLSTON' },
  { re: /\bseaview\b/i, tag: 'SEAVIEW' },
  { re: /\bhutt city\b/i, tag: 'HUTT_CITY' },
];

/** Terminal operators seen in the wild. */
const OPERATORS = [
  { re: /\bnzosl\b/i, tag: 'NZOSL' },
  { re: /\bwosl?\b/i, tag: 'WOSL' },
  { re: /\btnz\b|terminals new zealand/i, tag: 'TNZ' },
  { re: /\bmobil\b/i, tag: 'MOBIL' },
  { re: /\bbp\b/i, tag: 'BP' },
  { re: /\bz\b/i, tag: 'Z' },
];

function slug(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * @param {string} original  supplier's own wording, e.g. "Z Mount Maunganui North"
 * @param {string} [locationColumn]  the supplier's location column if separate
 * @param {string} [operatorColumn]  the supplier's operator column if separate
 * @param {string} supplierId
 */
function normaliseTerminal(original, { locationColumn, operatorColumn, supplierId } = {}) {
  const haystack = [original, locationColumn, operatorColumn].filter(Boolean).join(' ');
  // Qualifier detection is deliberately scoped to the terminal name and
  // operator only, NOT the location column. A location's own descriptive
  // text can legitimately mention a sibling sub-terminal for context (e.g.
  // Mobil's "Christchurch (incl. Lyttelton & Woolston)" location label
  // appears on BOTH the Woolston row and the Lyttelton row) — including it
  // here would make every terminal at that location collide onto whichever
  // qualifier the location happens to mention.
  const qualifierHaystack = [original, operatorColumn].filter(Boolean).join(' ');

  let region = null;
  for (const r of Object.values(REGIONS)) {
    if (r.patterns.some((p) => p.test(haystack))) {
      region = r.id;
      break;
    }
  }

  if (!region) {
    return {
      regionId: null,
      terminalId: null,
      originalTerminalName: original,
      status: 'UNKNOWN_TERMINAL',
      note:
        'Terminal wording did not match any known region. Surfaced for admin review ' +
        'rather than discarded or guessed.',
    };
  }

  const qualifier = QUALIFIERS.find((q) => q.re.test(qualifierHaystack));
  const operatorMatch = operatorColumn
    ? OPERATORS.find((o) => o.re.test(operatorColumn))
    : OPERATORS.find((o) => o.re.test(original));

  const parts = [
    supplierId ? slug(supplierId) : null,
    region,
    operatorMatch ? operatorMatch.tag : null,
    qualifier ? qualifier.tag : null,
  ].filter(Boolean);

  // Drop a qualifier that merely restates the region (Lyttelton inside CHRISTCHURCH
  // is meaningful; Seaview inside WELLINGTON is meaningful; keep both).
  const terminalId = parts.join('__');

  return {
    regionId: region,
    regionLabel: REGIONS[region].label,
    terminalId,
    operator: operatorMatch ? operatorMatch.tag : null,
    qualifier: qualifier ? qualifier.tag : null,
    originalTerminalName: original,
    originalLocationName: locationColumn || null,
    status: 'OK',
  };
}

module.exports = { REGIONS, normaliseTerminal, slug };

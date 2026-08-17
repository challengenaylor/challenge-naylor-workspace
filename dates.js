'use strict';

/**
 * Date parsing for NZ TGP documents.
 *
 * NZ documents are day-first. "7/08/2026" is 7 August, never 8 July. Getting
 * this backwards silently shifts an entire price history, so day-first is
 * enforced and any date that could only be month-first is rejected rather than
 * coerced.
 *
 * Effective dates are stored as an ISO date plus an explicit Pacific/Auckland
 * wall-clock effective instant (TGP takes effect 00:01 local).
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Matches 12/08/2026, 7/08/2026, 14-08-2026 */
const NUMERIC_RE = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/;
/** Matches "Saturday 15 August 2026", "15 August 2026" */
const LONG_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/;
/** Matches Gull filename style "14AUG26" */
const COMPACT_RE = /\b(\d{1,2})([A-Za-z]{3})(\d{2})\b/;

function parseEffectiveDate(text) {
  const s = String(text || '');

  let m = s.match(NUMERIC_RE);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month > 12) {
      return fail(`Ambiguous or invalid date "${m[0]}": month component is ${month}.`);
    }
    if (day > 31 || day < 1) return fail(`Invalid day in "${m[0]}".`);
    return build(year, month, day, m[0], 'NUMERIC_DAY_FIRST');
  }

  m = s.match(LONG_RE);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!month) return fail(`Unrecognised month name "${m[2]}".`);
    return build(Number(m[3]), month, Number(m[1]), m[0], 'LONG_FORM');
  }

  m = s.match(COMPACT_RE);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return fail(`Unrecognised month token "${m[2]}".`);
    return build(2000 + Number(m[3]), month, Number(m[1]), m[0], 'COMPACT');
  }

  return fail('No effective date found in source text.');
}

function build(year, month, day, raw, method) {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== day) {
    return fail(`Date "${raw}" is not a real calendar date.`);
  }
  return {
    status: 'OK',
    effectiveDate: iso,
    effectiveFromLocal: `${iso}T00:01:00`,
    timezone: 'Pacific/Auckland',
    rawDateText: raw,
    parseMethod: method,
  };
}

function fail(reason) {
  return { status: 'DATE_PARSE_FAILED', effectiveDate: null, reason };
}

/** Find every effective-date block in a multi-week document. */
function findAllEffectiveDates(text) {
  const lines = String(text || '').split(/\r?\n/);
  const hits = [];
  lines.forEach((line, i) => {
    if (/effective/i.test(line)) {
      const parsed = parseEffectiveDate(line);
      if (parsed.status === 'OK') hits.push({ ...parsed, lineIndex: i, line: line.trim() });
    }
  });
  return hits;
}

module.exports = { parseEffectiveDate, findAllEffectiveDates };

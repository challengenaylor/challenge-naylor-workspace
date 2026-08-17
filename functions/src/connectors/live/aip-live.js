'use strict';

const cheerio = require('cheerio');

/**
 * AIP — daily terminal gate price connector.
 *
 * SUPERSEDES the earlier assumption in this project that AIP's usable data
 * only exists as a historical spreadsheet. Confirmed 18 Aug 2026 (real
 * screenshot of the live page): that spreadsheet is yearly/financial-year
 * AVERAGES only, going back to 2004 — useless for a short-term directional
 * indicator. The actual daily pricing page (aip.com.au/pricing/terminal-
 * gate-prices) is the real source: a clean HTML table, no JS rendering
 * needed, showing the last 5 weekdays across 7 cities for both grades.
 *
 * One successful run backfills up to 5 real days of history at once —
 * AipRepository dedupes by date, so re-running never creates duplicates.
 */

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** "Tuesday, 11th August 2026" -> "2026-08-11". Weekday name and ordinal
 * suffix (11th/12th/13th) are both ignored for parsing — only the day
 * number, month name, and year matter. */
function parseAipHeaderDate(text) {
  const m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/**
 * Parses one fuel-grade table into { date: [{city, value}] }.
 * @param {CheerioStatic} $
 * @param {Cheerio} table
 */
function parseGradeTable($, table) {
  const headerCells = $(table).find('thead th');
  const dateColumns = []; // {index, date}
  headerCells.each((i, el) => {
    if (i === 0) return; // first column is "Location"
    const date = parseAipHeaderDate($(el).text().trim());
    if (date) dateColumns.push({ index: i, date });
  });

  const byDate = {};
  dateColumns.forEach((c) => { byDate[c.date] = []; });

  $(table).find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    const city = $(cells[0]).text().trim();
    if (!city) return;
    dateColumns.forEach((c) => {
      const raw = $(cells[c.index]).text().trim();
      const value = Number(raw);
      if (Number.isFinite(value)) byDate[c.date].push({ city, value });
    });
  });

  return byDate;
}

/** Simple mean across the cities reported for that date. */
function nationalAverage(cityValues) {
  if (!cityValues.length) return null;
  const sum = cityValues.reduce((a, b) => a + b.value, 0);
  return +(sum / cityValues.length).toFixed(2);
}

/**
 * @param {string} html
 * @returns {{status:'OK', observations: Array<{date,ulp,diesel,cityDetail}>} | {status:'TABLE_STRUCTURE_CHANGED', reason}}
 */
function extractDailyPrices(html) {
  const $ = cheerio.load(html);
  const tables = $('table');
  if (tables.length < 2) {
    return { status: 'TABLE_STRUCTURE_CHANGED', reason: `Expected 2 tables (Petrol, Diesel), found ${tables.length}.` };
  }

  // Identify which table is which by the heading text immediately before it,
  // rather than assuming table order — more robust if the page ever
  // reorders the two sections.
  let ulpTable = null, dieselTable = null;
  tables.each((i, t) => {
    const heading = $(t).prevAll('h1,h2,h3,h4').first().text().toLowerCase();
    if (/petrol|ulp/.test(heading)) ulpTable = t;
    if (/diesel/.test(heading)) dieselTable = t;
  });
  if (!ulpTable || !dieselTable) {
    return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'Could not identify which table is Petrol/ULP and which is Diesel from nearby headings.' };
  }

  const ulpByDate = parseGradeTable($, ulpTable);
  const dieselByDate = parseGradeTable($, dieselTable);

  const allDates = [...new Set([...Object.keys(ulpByDate), ...Object.keys(dieselByDate)])].sort();
  if (!allDates.length) {
    return { status: 'TABLE_STRUCTURE_CHANGED', reason: 'No parseable date columns found in either table header.' };
  }

  const observations = allDates.map((date) => ({
    date,
    ulp: nationalAverage(ulpByDate[date] || []),
    diesel: nationalAverage(dieselByDate[date] || []),
    cityDetail: { ulp: ulpByDate[date] || [], diesel: dieselByDate[date] || [] },
  })).filter((o) => o.ulp !== null || o.diesel !== null);

  return { status: 'OK', observations };
}

const SOURCE_URL = 'https://aip.com.au/pricing/terminal-gate-prices';

async function run() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  if (!res.ok) return { status: 'SOURCE_UNAVAILABLE', reason: `AIP page returned HTTP ${res.status}` };
  const html = await res.text();
  return extractDailyPrices(html);
}

module.exports = { extractDailyPrices, parseAipHeaderDate, nationalAverage, run, SOURCE_URL };

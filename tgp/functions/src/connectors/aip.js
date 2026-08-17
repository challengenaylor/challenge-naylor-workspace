'use strict';

/**
 * AIP — Australian market indicator connector.
 *
 * STATUS: discovery is real and live-verified (17 Aug 2026). Extraction is
 * explicitly NOT IMPLEMENTED — stated here rather than glossed over.
 *
 * What was actually found live, today:
 *   - The current-day pricing page (aip.com.au/pricing/terminal-gate-prices)
 *     renders its price TABLE client-side; a plain fetch of the page HTML
 *     does not contain the numeric values, only the table's caption/heading
 *     text. Scraping this page reliably would need a real browser render
 *     step (e.g. Playwright with page.evaluate()) that this sandbox cannot
 *     run against aip.com.au (network egress restricted to package
 *     registries only).
 *   - AIP separately publishes real historical data as a downloadable
 *     Excel file, discoverable from a stable page:
 *     https://www.aip.com.au/historical-ulp-and-diesel-tgp-data
 *     On 17 Aug 2026 this linked to:
 *     https://www.aip.com.au/sites/default/files/download-files/2026-08/AIP_TGP_Data_14-Aug-2026.xlsx
 *     (filename carries the last-updated date — genuinely dynamic, not a
 *     fixed URL, exactly like Z and Gull's document links).
 *
 * findLatestSource() below reproduces that real, working discovery step.
 * extractWorkbook() is deliberately a stub that throws: this project has
 * never seen the actual bytes or sheet layout of that spreadsheet (the
 * fetch tool available in this session reports non-PDF binaries only as
 * "[binary data]", with no byte access), so writing a parser against a
 * guessed schema would risk silently misreading real data — exactly the
 * failure this whole system exists to prevent. NEEDS_REVIEW / NOT_IMPLEMENTED
 * is the correct output here, not an invented column layout.
 */

const HISTORICAL_PAGE_URL = 'https://www.aip.com.au/historical-ulp-and-diesel-tgp-data';
const XLSX_LINK_RE = /href=["']([^"']*AIP_TGP_Data[^"']*\.xlsx)["']/i;

/** @param {string} html  the historical-data page HTML */
function findAipWorkbookUrl(html) {
  const m = html.match(XLSX_LINK_RE);
  if (!m) return { status: 'SOURCE_UNAVAILABLE', reason: 'No AIP_TGP_Data_*.xlsx link found on the historical-data page.' };
  try {
    const url = new URL(m[1], HISTORICAL_PAGE_URL).toString();
    return { status: 'OK', documentUrl: url };
  } catch (e) {
    return { status: 'SOURCE_UNAVAILABLE', reason: `Found a link but could not resolve it: "${m[1]}"` };
  }
}

/**
 * @param {Buffer} _workbookBuffer
 * @throws always — see module doc comment for why this is intentional
 */
function extractWorkbook(_workbookBuffer) {
  throw new Error(
    'NOT_IMPLEMENTED: AIP workbook parsing has never been tested against real bytes '
    + 'or a confirmed sheet layout. Implement this only after downloading '
    + 'AIP_TGP_Data_*.xlsx from a network-unrestricted environment and inspecting '
    + 'its actual columns — do not guess the schema.'
  );
}

module.exports = { HISTORICAL_PAGE_URL, findAipWorkbookUrl, extractWorkbook };

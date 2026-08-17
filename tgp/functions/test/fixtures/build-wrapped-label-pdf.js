'use strict';

/**
 * Builds a REAL PDF (via pdf-lib, actual bytes, actual PDF structure) that
 * reproduces two specific hazards found in the live BP document:
 *
 *   1. "Mount Maunganui" wrapped across two lines as separate text draws
 *      ("Mount" on one line, "Maunganui" on the next) — this happens in
 *      real BP PDFs when the Terminal column is narrow.
 *   2. Sparse rows — a terminal that only prices one grade, leaving other
 *      cells blank, exactly like the live NZOSL/TNZ Mount Maunganui rows.
 *
 * This exists because the sandbox this was built in cannot download the
 * real BP PDF bytes (network egress is restricted to package registries).
 * It is a stand-in for a real document, built to the real document's known
 * layout quirks — not a substitute for testing against the live file, which
 * remains LIVE VERIFICATION REQUIRED and is stated as such in the final report.
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function buildWrappedLabelFixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 9;
  const draw = (text, x, y) => page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });

  // Header row — column anchors the extractor must discover from these x positions.
  draw('Operator', 20, 260);
  draw('Terminal', 90, 260);
  draw('M95', 220, 260);
  draw('M91', 270, 260);
  draw('ADF', 320, 260);

  // Row 1: normal, non-wrapped, fully populated (control case).
  draw('WOSL', 20, 240);
  draw('Wiri', 90, 240);
  draw('296.38', 215, 240);
  draw('282.58', 265, 240);
  draw('250.25', 315, 240);

  // Row 2: WRAPPED LABEL, sparse (ADF only) — "Mount" then "Maunganui" as
  // two separate text draws at slightly different y, same x as each other,
  // exactly reproducing the real document's line-wrap behaviour.
  draw('NZOSL', 20, 222);
  draw('Mount', 90, 222);
  draw('Maunganui', 90, 213);   // wrapped continuation, 9pt line below
  draw('250.66', 315, 213);      // ADF value sits on the SAME visual line as the wrap continuation

  // Row 3: WRAPPED LABEL, sparse (M91 only) — second Mount Maunganui terminal,
  // different operator, proving two wrapped rows in the same document don't
  // get merged into each other.
  draw('TNZ', 20, 195);
  draw('Mount', 90, 195);
  draw('Maunganui', 90, 186);
  draw('282.85', 265, 186);

  // Row 4: normal control row again, to prove merging doesn't over-fire on
  // ordinary single-line rows that happen to sit near a wrapped block.
  draw('NZOSL', 20, 168);
  draw('Dunedin', 90, 168);
  draw('300.45', 215, 168);
  draw('286.19', 265, 168);
  draw('250.66', 315, 168);

  return doc.save();
}

module.exports = { buildWrappedLabelFixture };

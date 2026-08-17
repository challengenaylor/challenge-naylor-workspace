# Challenge TGP — standalone frontend (Phase 2)

No Firebase, no Netlify, no build step. Open `index.html` directly — every
script is a plain `<script>` tag (not `type="module"`), specifically so it
works when double-clicked from disk. ES module imports are blocked by CORS
in most browsers under `file://` with no server, which would have silently
broken the whole page.

## Files created

```
index.html            page shell, all 6 tabs, no inline logic
css/styles.css         full styling — see design notes at the top of the file
js/data.js              config + mock data (the file the backend replaces)
js/calculations.js      pure functions: change calc, market direction, comparisons
js/storage.js           localStorage CRUD for Challenge pricing
js/charts.js             canvas line chart + gauge, no external library
js/app.js                DOM wiring — the only file that touches the page
```

Nothing modified — this is a new, separate folder from the earlier
Firebase-oriented `functions/` work. That work still stands for Phase 3.

## How to run

Double-click `index.html`, or:
```
open index.html                 # macOS
xdg-open index.html             # Linux
```
No server, no npm install, no internet required except for the Google Fonts
import in `styles.css` (cosmetic only — full system-font fallbacks are
defined, so it looks fine offline too, just slightly different type).

## What's real vs synthetic

**Real** (read from live supplier documents on 16 Aug 2026): Gull, Z and BP's
current AND previous-week figures, and Mobil's current figures. Every number
in the "Current terminal gate prices" table for those weeks is what the
supplier actually published.

**Synthetic** (generated, seeded/reproducible): everything further back —
the History tab's extended series and the entire AIP tab — is a random walk
anchored to the real current value. It exists to prove the History and
Market tabs work end to end, not to represent actual past prices. Mobil's
previous-week value is deliberately left blank rather than invented — you'll
see it render as "first capture," which is itself a real UI state worth
having (a supplier connector's first run always looks like this).

Two structural facts are preserved honestly rather than padded out:
- **Gull has no Wiri terminal at all** — filter to Gull and only Mount
  Maunganui rows appear. That's real; Gull only sells at Mount Maunganui.
- **BP doesn't sell Premium 95 at Mount Maunganui** — there's no row for it,
  not an error. BP's two Mount Maunganui rows (Diesel via NZOSL, Regular 91
  via TNZ) are tagged `extraction: coordinate` because they're the sparse-row
  case flagged in the research phase — resolved correctly, not glossed over.

## What each tab does

- **Overview** — filterable/searchable current-price table, all live logic
  (no placeholder columns).
- **History & charts** — canvas line chart, range/terminal/product/supplier
  controls all redraw it live.
- **Market direction** — the gauge is a real calculation (documented
  on-screen), not a hard-coded state. It currently reads DOWNWARD because
  the generated AIP series and the real NZ price drops both point the same
  way — change the range or supplier data and it will move.
- **Challenge pricing** — add/edit/delete against localStorage, live
  comparison against current competitor prices.
- **Automation & errors** — demo connector-status cards and a filterable
  error table, explicitly labeled as demo until Phase 3 connects it to real
  Cloud Function runs.
- **Sources & documents** — audit trail table linking to the real source
  documents.

## What remains for the backend phase

- Wiring `js/data.js`'s shape to live Firestore reads (the shape was
  designed to match Phase 1's `tgpApp` schema exactly, so this should be a
  swap, not a rewrite).
- Real Mobil HTML-table and AIP connectors (not built yet, anywhere).
- Coordinate-based PDF extraction for BP's Mount Maunganui rows — the
  frontend already displays the result correctly; the backend still needs to
  produce it.
- Firestore-backed Challenge pricing (create-only/immutable, per the rules
  drafted in Phase 1) — this demo's localStorage version allows editing an
  entry in place, which is a deliberate difference for testing convenience,
  not the intended production behaviour.

## Assumptions made

- Only Gull, Z, BP and Mobil are treated as suppliers (per the Phase 1
  research finding — no other NZ company publishes TGP).
- Only Regular 91, Premium 95 and Diesel are treated as products (same
  finding — this is a legal definition, not a current gap).
- GST is shown as "included" for all four suppliers because all four say so
  explicitly in their source documents; the UI still renders "excluded" /
  "not stated" states in code, they're just not needed by any current row.

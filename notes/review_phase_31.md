# Independent Post-Phase-31 Review — Entity-First Incident Dashboard

Date: 2026-07-21

Verdict: Phase 31 is ready to commit. No actionable implementation finding remains.
Phase 32's evidence gate is satisfied; proceeding is recommended in a separately
authorized phase, but no Phase 32 behavior was implemented in this goal.

## Review method

This was a separate post-implementation pass against the Phase 31 prompt,
`markdown/REVIEW_CHECKLIST.md`, the accepted Phase 30 response, the existing Phase
20–29 review evidence, final source, live data, and saved browser output. It reviewed
the final combined state rather than treating passing implementation tests as the
review verdict.

Evidence consulted:

- 165/165 unit tests and browser/inline compilation.
- `notes/phase-30-live-validation.js` and `notes/phase-30-api-validation.js`.
- `notes/phase-31-browser-validation.js` final pass over 11 route families, two race
  directions, raw-list/Jobs regression checks, and six viewport/scheme combinations.
- Visual inspection of `/tmp/ops-dashboard-phase31-evidence/phase31-mobile-light.png`
  and `phase31-desktop-dark.png` (all six captures are retained in that directory).

## Phase 31 finding review

No critical, high, medium, or low defect was found.

- Information hierarchy: closed. Bare hash and `#incidents` are unmistakably
  incident-by-SME; Incident list and Jobs are explicit one-hop destinations.
- Count truth: closed. Summary values come from the complete Phase 30 response;
  matched/rendered entity counts are separate; 24→48→72 disclosure never changes
  global totals; occurrences are explicitly named.
- Card usefulness/density: closed. Cards expose priority, active/total incidents,
  exact+relative recency, oldest active age, occurrences, bounded categories/apps,
  and narrow severity edges without becoming mini-tables or color walls.
- Provenance: closed. Live mixed classifier/oracle metadata says “includes oracle”;
  oracle-only rendering retains the dashed hint treatment in pure tests. No live
  entity-level oracle-only category existed at review time, so the browser gate records
  that absence rather than fabricating a representative.
- Non-SME truth: closed. `__global__` and `RTT00001` remain named, reconciled, separate
  from SME cards, and linked to the complete raw list.
- Accessibility/responsiveness: closed. Semantic list/article/dl cards, native links,
  labeled controls, persistent polite status, visible focus, keyboard filter/reset/
  show-more/detail journeys, one/two/four-column layouts, and zero body/card overflow
  passed at 390/768/1440 in light and dark.
- Preserved views: closed. Job grid/error feed and raw incident filters/keyset paging
  remain on explicit routes. Sticky headers measured 0 px displacement after 300 px
  wrapper scroll; raw category focus/load-more and native DA disclosure remained safe.
- Route/race compatibility: closed. Canonical/alias/legacy routes and old
  `from=dashboard`/`from=incidents` intent work. Slow Entities→Jobs and Jobs→Entities
  completions cannot repaint the current body/chrome or strand refresh.
- Safety/scope: closed. Phase 31 is frontend-only over GET endpoints. No write,
  cross-source endpoint, schema, grant, dependency, cache, environment, deployment,
  or producer change was added.

## Concrete cross-view investigation friction

The review followed the representative SME16380 journey:

1. The card correctly summarizes eight incidents, seven active, two apps, multiple
   categories, and mixed oracle/classifier evidence.
2. Its canonical `#entity=SME16380&from=entities` link intentionally reuses the existing
   System signals controller for Phase 31.
3. That destination shows current connectivity and recent `(app,type,func)` run-log
   signals, but none of the incident inventory/categories that motivated the click.
4. To inspect those incidents, the operator must return to Entities, open Incident
   list, and scan/filter the global paged table. The raw list has severity/state/category
   filters but no entity scope, so it cannot directly reconstruct “incidents for this
   SME.” The same limitation makes a non-SME notice link discoverable but not scoped.

This is repeated navigation, lost SME context, and inability to compare the three
explicitly scoped sources—the exact valid entry evidence in the Phase 32 prompt. A
unified, read-only entity workspace with paged entity-scoped incidents would materially
reduce investigation friction without changing the Phase 31 card system.

Recommendation: proceed with Phase 32 only as a new, separately authorized phase,
using its existing bounded/paged/read-only scope. Do not fold it into this Phase 31
delta. Phase 32 was not implemented here.

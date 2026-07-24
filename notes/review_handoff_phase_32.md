# Code Review Handoff — Phase 32 Entity Workspace & Incident Drill-Down

A briefing for an independent reviewer. Review the Phase 32 delta only; Phases
20–31 were independently reviewed and are committed on `main`. Do not change
code. Return findings and a commit/merge-readiness verdict.

## Scope and baseline

- Repository: `/opt/apps/ops-dashboard`, branch `phase-32-entity-workspace`.
- Baseline: `main` (Phase 31, commit `15807c3`). Review `git diff main` on this
  branch plus the new notes files.
- The authoritative requirements are
  `prompts/prompt_32_entity_workspace_and_incident_drilldown.txt` (as amended
  2026-07-24: entry gate pre-satisfied, Phase 31 route plumbing already done).
  Outcomes and measured evidence: the Phase 32 entry in `markdown/PHASE_LOG.md`.
- Port 8080 (production, running Phase 31) was not restarted or modified. Use a
  disposable copy on 18080 for anything live (recipe in
  `notes/review_handoff_ux_implementation_phases_20_28_2026-07-21.md` §8).

Files changed:

```
db/queries.js            entity predicates (list $9, summaries $1), scoped count
lib/incidents.js         lean row firstSeen (additive)
lib/entities.js          mergeSummaryRows refactor, shapeEntityContext, 404 rule
server.js                /api/incidents entity scope, GET /api/entities/:id
public/routes.js         system-as-alias semantics (label/nav/fallback/source)
public/index.html        workspace view, entityHref canonicalization, non-SME links
test/incidents.test.js   scoped SQL guards, firstSeen
test/entities.test.js    context shaping, partial/empty/404, server handler guards
test/routes.test.js      alias + return-token round trips
notes/phase-32-api-validation.js      reproducible live gate (33 checks)
notes/phase-32-browser-validation.js  reproducible browser gate
markdown/PHASE_LOG.md, markdown/PROMPTS.md
```

## Hard constraints to verify

1. **Read-only, least privilege, no new data source.** Both new SQL params are
   bound; no write/DDL path; `ops_dashboard_ro` unchanged.
2. **Phase 24 cursor contract untouched.** The entity predicate narrows the
   ranked set; ORDER BY and cursor tuple are identical. Verify no page can skip
   or duplicate rows when entity, facet filters, and cursor compose.
3. **Fail-closed inputs.** Provided-but-invalid `entity` → generic 400 before
   SQL (never coerced to 'all' — scope-widening would misrepresent data);
   cursor validation unchanged (re-run the Phase 29 probes WITH entity).
4. **API compatibility.** Global `/api/incidents` byte-shape identical except
   additive lean-row `firstSeen`; `/api/entities` unchanged; `/api/systems`,
   `/api/systems/:id`, incident detail, run drill-down all preserved.
5. **Correlation, not conflation.** The workspace never merges incident
   lifecycle, connectivity freshness, and run-log signals into one health
   truth, never asserts causality, and never fabricates connectivity for
   non-SME ids. Stale connectivity must not read as current.
6. **Route safety.** `entity:<id>`/`system:<id>` return tokens, legacy
   `#system=` alias, invalid-id handling — no route or DOM injection, no lost
   `from=` context, no forced redirect.
7. **Race/partial-state safety.** SME A → SME B → other route with delayed
   responses must never mix entities or repaint the wrong chrome; a context
   failure must not erase incident records (and vice versa); scoped load-more
   cannot duplicate; refresh cannot strand.

## Highest-risk review areas

- The `$9`/`$1` NULL-sentinel predicates and the `incidentsScopedCount` filter
  mirror (db/queries.js) — confirm the count query's WHERE matches the list's
  exactly.
- `showEntity`/`loadMoreEntityIncidents`/`renderEntityWorkspace` in
  public/index.html — the one new stateful controller. `showEntity` paints the
  shell then fires the two reads as independent `fetch(...).then()` chains that
  each update their own sections on settle (guarded by `runReq` + per-state
  identity, superseded requests aborted via `AbortController`); each section
  owns its loading/empty/error text.
- 404 semantics: `entityContextIsEmpty` (all three sources empty). A valid id
  with only historical connectivity must still 200.
- Live max is 12 incidents/entity, below the minimum page size, so scoped
  paging cannot occur naturally — the gate exercises entity+cursor composition
  with a global-walk cursor instead. Judge whether that plus the SQL-mirror
  argument is sufficient evidence for scoped-boundary correctness.

## Validation already completed (evidence, not a substitute for review)

- `node --test`: 171/171 in `node:lts`; all public JS + inline script compile;
  `git diff --check` clean.
- `notes/phase-32-api-validation.js` on 18080: 33/33 (details in PHASE_LOG).
- `notes/phase-32-browser-validation.js`: full journey/race/responsive gate,
  zero unexpected console errors; captures in
  `/tmp/ops-dashboard-phase32-evidence/`.
- Decision-gate live sampling 2026-07-24: 540 incidents / 235 entities / max 12
  per entity; plans 0.13–0.26 ms (entity list) and 119 ms (48h signals).

## Out of scope / intentional

- No entity write-back, alerting, auth, framework, cache, schema/index/grant
  change, or producer-repo work.
- `#systems` ("System signals") and its API remain by design.
- Scoped page omits the global rollup total deliberately.
- `showSystem`/`renderSystem` were removed (the alias renders the workspace);
  `/api/systems/:id` stays.

## Fix-round delta (2026-07-24, after the first Codex review)

The first independent review returned needs-fixes (0 blocker/high, 3 medium,
1 low, gate gaps). All were applied in commit(s) after `3563ccd`; re-review
the delta (`git diff 3563ccd`) plus this checklist:

1. Finding 1 (sections gated on both requests; hung request pinned refresh):
   `showEntity` now paints the shell immediately, each request updates its own
   sections on settle, superseded requests abort via `AbortController`, and
   refresh re-enables at reload start (re-click aborts + restarts). Verify no
   regression in stale-completion handling (`runReq` + state identity +
   AbortError filtering) and that 400/404 remain whole-page terminal states.
2. Finding 2 (raw result hidden on CURRENT rows): every connectivity record
   now renders raw last result, record freshness, derived state, exact
   checked-at `<time>` (title carries the ISO instant), and data age.
3. Finding 3 (signals lacked UUID/copy): signal rows reuse `appendCompactRun`
   with the timestamp-hinted `runHref` and entity return token. A latent
   containment quirk surfaced here: the `.sr-only` copy-status span (absolute)
   inflated the html scroll area from inside scrolled tables; fixed with
   `position: relative` on `.run-id-wrap` (also covers the Phase 28 app-runs
   table). Confirm no visual regression there.
4. Finding 4 (silent load-more failure): failed scoped pages now render a
   visible retryable message and announce in the polite live region; the button
   stays enabled.
5. Gate gaps: the API gate adds an exact after-cursor SQL comparison and a
   full entity-filtered walk at limit=25 (now 33 checks); the browser gate
   adds the acquisition + raw-list entry legs, deterministic route-intercepted
   failure/delay/hang scenarios (9a–9e), asserted wrapper containment, and all
   three widths in both schemes. PHASE_LOG's section-error and race-evidence
   sentences were rewritten to match (they previously overclaimed).

## Second fix-round delta (2026-07-24, after the Codex re-review)

The re-review returned needs-fixes (0 blocker/high/medium; 1 low + gate gaps +
stale doc claims). Applied:

1. (low) The failed-load-more announce ran BEFORE `renderEntityWorkspace`, whose
   `resetView` cleared and re-hid the live region before the rAF text write
   landed — so it never actually announced. Fixed by moving the announce inside
   `renderEntityWorkspace` guarded by `st.pageError`, which also handles a case
   a simple render-then-announce swap would miss: a late context-request settle
   re-renders and would otherwise wipe the message. Step 9f asserts both the
   announcement and its persistence across a later re-render.
2. (gate) The scoped load-more failure path was untested because live entities
   have <25 incidents (no natural page boundary). New step 9f injects a
   `nextCursor` into the first scoped page, fails the load-more, and asserts
   both the body message AND the visible, populated live region — this now
   catches the bug in (1).
3. (gate) Step 9d now performs a delayed A→B→Jobs where each navigation is
   issued in its own browser task and the test `waitForRequest`s each entity's
   request before the next, then waits for the late completions to land and
   asserts Jobs was never repainted.
4. (gate) New step 9b covers the reciprocal partial failure: context request
   fails while incident records succeed (records render; the three context
   sections each show honest failure text).
5. (docs) This handoff's stale `Promise.allSettled` description and `32/32`
   figure corrected; the "announces politely" claim is now backed by step 9f.

## Third re-review delta (2026-07-24)

Third review returned needs-fixes: no product-code findings (the load-more fix
confirmed correct), but the 9d race gate was a false positive and two evidence
claims outran their tests. Fixed:

1. (gate, blocking) Step 9d assigned all three hashes synchronously in one
   browser task, so the `hashchange` handlers could only ever observe the final
   `#jobs` and A/B might never fire — a false positive. Rewritten to navigate
   each hash in a separate task and `waitForRequest` A's and B's requests before
   moving on (plus route counters asserted at the end), proving both started
   before the Jobs navigation.
2. (gate) Step 9f's persistence assertion previously only slept. It now delays
   the context request so it settles AFTER the load-more failure, waits on that
   response deterministically, and only then asserts the announcement survived
   the re-render.
3. (docs) The "genuine … all three navigations in flight" phrasing for 9d and
   the `32 checks` file-list figure corrected here and in PHASE_LOG.

Post-fix validation: 171/171 unit tests; 33/33 API checks; browser gate fully
green including the injected-failure legs (expected-noise tolerance is scoped
to exactly the deliberate 404 and the injected `net::ERR_FAILED` aborts).

## Requested output

1. Findings first, ordered blocker/high/medium/low, each with severity,
   `path:line`, concrete trigger/impact, smallest house-style fix.
2. Per-constraint verdicts for the seven hard constraints above.
3. Prompt-requirement gaps or PHASE_LOG overclaims, if any.
4. Test gaps tied to credible failure modes (unit vs browser).
5. Verdict: `ready to merge` or `needs fixes`, with the minimum blocking set.

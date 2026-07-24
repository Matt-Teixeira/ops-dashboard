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
notes/phase-32-api-validation.js      reproducible live gate (32 checks)
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
  public/index.html — the one new stateful controller. Race guards are
  `runReq` + `st.req`; the two initial reads use `Promise.allSettled` with
  per-section error text.
- 404 semantics: `entityContextIsEmpty` (all three sources empty). A valid id
  with only historical connectivity must still 200.
- Live max is 12 incidents/entity, below the minimum page size, so scoped
  paging cannot occur naturally — the gate exercises entity+cursor composition
  with a global-walk cursor instead. Judge whether that plus the SQL-mirror
  argument is sufficient evidence for scoped-boundary correctness.

## Validation already completed (evidence, not a substitute for review)

- `node --test`: 171/171 in `node:lts`; all public JS + inline script compile;
  `git diff --check` clean.
- `notes/phase-32-api-validation.js` on 18080: 32/32 (details in PHASE_LOG).
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

## Requested output

1. Findings first, ordered blocker/high/medium/low, each with severity,
   `path:line`, concrete trigger/impact, smallest house-style fix.
2. Per-constraint verdicts for the seven hard constraints above.
3. Prompt-requirement gaps or PHASE_LOG overclaims, if any.
4. Test gaps tied to credible failure modes (unit vs browser).
5. Verdict: `ready to merge` or `needs fixes`, with the minimum blocking set.

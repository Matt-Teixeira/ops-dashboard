# Phase Log

Durable memory of decisions, validation, and outcomes. Newest entry on top. Use
`markdown/PHASE_TEMPLATE.md` for new entries.

Phases 1–3 predate this prompt system and are reconstructed here from the commit
history so the log is complete; they have no `prompts/` file.

---

# Phase 32 — Entity Workspace & Incident Drill-Down Integration

Date: 2026-07-24

Status: Completed (pending independent review before merge)

Prompt: `prompts/prompt_32_entity_workspace_and_incident_drilldown.txt`

Git Commit: Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_32.md`
- Reproducible live gate: `notes/phase-32-api-validation.js` (32/32 checks)
- Reproducible browser gate: `notes/phase-32-browser-validation.js`
- Responsive captures: `/tmp/ops-dashboard-phase32-evidence/*.png`

## Entry decision gate

Satisfied before implementation, per the prompt's 2026-07-24 amendment: the
independent post-Phase-31 review (`notes/review_phase_31.md`) recorded the
SME16380 journey — repeated cross-view navigation, lost SME context on
`#entity=` (which reused the System signals controller), and a raw incident
list that cannot scope by entity.

## Goals / Built

- **Entity-scoped incident list.** `GET /api/incidents` accepts optional
  `entity=<safe-id>`, bound as a NULL-sentinel SQL param (`$9`) inside the
  Phase 24 ranked CTE — 'all' would be ambiguous because it is itself a valid
  producer entity string. The activity/severity/time/id ORDER BY and cursor
  tuple are unchanged; severity, state, category, entity, limit, and cursor all
  compose. A provided-but-invalid entity fails closed with the generic 400 and
  never reaches SQL (unlike severity/state/category, a provided entity is
  caller intent and is never coerced to 'all'). Scoped responses carry additive
  `entity` + `scopedTotal` (exact matching-row count under the same filters);
  global responses are byte-shape identical except the additive lean-row
  `firstSeen` field. The global rollup stays global by contract.
- **Entity context endpoint.** `GET /api/entities/:id?windowHours=<1..48>`
  (default 24; the 48h ceiling is the Phase 19 evidence) composes three
  existing bounded reads in parallel: the Phase 30 grouped summary read with a
  new optional bound entity predicate, decorated Phase 20 connectivity picked
  for the id, and the partition-pruned `systemDetail` signals breakdown
  (`warn_error_logs` only). Returns `{asOf, entity, entityKind,
  incidentSummary, connectivity, signalWindowHours, signals}`; 404 only when
  all three sources are empty; incident RECORDS stay on the paged list contract.
- **Entity workspace page.** `#entity=<id>` is now a dedicated semantic page
  (incidents first — summary + category provenance + active-first paged rows;
  current connectivity second, every record showing raw last result, record
  freshness, derived current state, and the exact checked-at `<time>` with its
  age as distinct facts; recent run-log signals third, labeled as recent
  activity, not status or causality, with exact run UUID + copy control). Each
  section owns its loading/empty/error text; a combined-context failure renders
  honestly without erasing incident records, and vice versa. `#system=<id>` is
  a permanent legacy alias rendering the same workspace (same label, Entities
  nav, Entities default return). Non-SME ids are honest about kind
  (`__global__` → "cross-fleet incident group…", never fabricated connectivity).
- **Canonical links.** The shared `systemHref` helper became `entityHref`
  (`#entity=`), converting Entities cards, connectivity, acquisition, system
  signals, and raw incident list/detail in one place; `entityCell` now links
  every safe producer id (non-SME included); the non-SME notice links each
  group to its scoped workspace. `entity:<id>` return tokens flow through
  incident and run detail; all inbound `#system=` bookmarks and `system:<id>`
  tokens keep working. `/api/systems/:id` and `#systems` remain unchanged.
- **Race safety.** `showEntity` paints the section shell immediately and lets
  each request update its own sections as it settles (guarded by the monotonic
  `runReq` token + per-state identity); superseded requests are aborted via
  `AbortController`; refresh re-enables as soon as a reload has started, so a
  hung source can never strand the button — re-clicking aborts and restarts
  both reads. Scoped load-more dedupes by id, drops stale completions, and
  announces a visible, retryable error on a failed page.

## Schema Facts Confirmed (live DB, 2026-07-24, as `ops_dashboard_ro`)

- 540 incidents across 235 entities; max 12 incidents per entity (re-sampled at
  the gate as the prompt requires). 231 entities exist in both incidents and
  alert.*; 4 SMEs are incidents-only (e.g. SME08284); 239 connectivity ids have
  no incidents (e.g. SME10262); non-SME groups are `__global__` (11) and
  `RTT00001` (1). No signals-only SME existed in the last 24h (case covered by
  unit tests instead).
- Entity-filtered ranked list plan: 0.26 ms; bare entity predicate scan
  0.13 ms. `systemDetail` at the 48h ceiling: 119 ms (partition-pruned, request
  path OK, matching Phase 19 expectations).
- Role check: SELECT true / INSERT false on `incidents.incidents`.

## Validation

- `node --test` in `node:lts`: **171/171 pass** (165 prior + 6 new: scoped SQL
  guards, lean-row `firstSeen`, context shaping incl. partial/empty/404 rule
  and non-SME kinds, route alias semantics, server handler guards).
- Live gate (`notes/phase-32-api-validation.js`, disposable app on 18080):
  **33/33 checks** — scopedTotal equals direct SQL; scoped page order equals
  the Phase 24 SQL order exactly; entity+cursor rows compared EXACTLY against
  SQL evaluating the same boundary tuple, plus a full entity-filtered cursor
  walk at limit=25 identical to the scoped SQL id list; entity+facet-filter
  composition; global response has no new keys and its full cursor walk stayed
  540/540 duplicate-free; six malformed entity inputs → 400; Phase 29 tampered
  cursor probes re-run WITH the entity filter → 400; context reconciles
  byte-for-byte with `/api/entities`, `/api/connectivity`, and the preserved
  `/api/systems/:id`; window clamp 1..48/default 24; partial-source and
  non-SME workspaces 200; absent id 404; invalid id 400.
- Browser gate (`notes/phase-32-browser-validation.js`, Playwright): card →
  workspace → incident detail → exact return; signal run rows expose the exact
  UUID + copy control and return to the workspace; legacy `#system=` renders
  the identical workspace; connectivity, system-signals, acquisition, and
  raw-incident-list entries all carry accurate return tokens; `__global__`
  honest; deliberate-404 empty state; DETERMINISTIC injected failures/delays
  via route interception — a failed records request leaves summary/
  connectivity/signals rendered, a delayed context leaves records rendered
  with per-section loading shells that later fill in, SME A → SME B with A's
  responses delayed 2s repaints nothing after the late completions land, and a
  HUNG context request leaves refresh re-enabled and recoverable; 390/768/1440
  in BOTH schemes with zero body overflow and every table wrapper contained in
  the viewport; zero unexpected console/page errors. Representative check
  landed on SME16380 — the exact Phase 31 friction journey — now one page.

## Decisions

- NULL sentinel (not `'all'`) for the optional entity SQL params, documented in
  both queries.
- Provided-but-invalid `entity` → 400 rather than normalize-to-all: silently
  widening an explicit scope to the global list would misrepresent the data.
- The workspace page reuses the `system-view` section and replaces the old
  `showSystem`/`renderSystem` controller outright (the alias renders the same
  page, so keeping the dead view invited drift). `/api/systems/:id` is
  preserved per the prompt's non-goals and doubles as reconciliation evidence.
- The scoped page intentionally omits the global rollup total; it shows
  "N of M matching incident records loaded" only.

## Codex review fix round (2026-07-24)

Independent review verdict: needs fixes — no blocker/high, 3 medium, 1 low,
plus validation-gate gaps. All applied in the same phase:

1. (medium) Sections were gated on `Promise.allSettled` of both requests and a
   hung request pinned the disabled refresh button → shell-first rendering,
   per-settle section updates, `AbortController` on supersede, refresh
   re-enables at reload start (see Race safety above).
2. (medium) CURRENT connectivity rows hid the raw last result → every record
   now shows raw result, freshness, derived state, and exact checked instant.
3. (medium) Signal drill-down rendered only "view ›" → `appendCompactRun`
   (exact UUID in link/title/aria + copy control), timestamp-hinted href kept.
4. (low) Silent scoped load-more failure → visible retryable message + polite
   announcement.
5. (gates) Exact after-cursor SQL comparison + full entity-filtered walk in the
   API gate; deterministic delayed/failed-response injection, the full entry
   matrix (acquisition + raw list), asserted table containment, and both color
   schemes at all three widths in the browser gate; this log's section-error
   and race-evidence sentences rewritten to match the now-true behavior.

## Review Checklist Outcome

Scope within prompt (non-goals respected: no writes/DDL/grants, no new data
source, no verbose_log, no health-merging or causality claims); read-only role
confirmed live; time-windowed query reuses the existing partition-pruned
`systemDetail`; request-path timings well under a second; inputs validated
before SQL (safe-id gate, fail-closed cursor unchanged); API shapes preserved
(additive only); `.env` untouched; docs updated (this entry + PROMPTS.md).
Ready for the independent post-implementation review before merge to main.

---

# Phase 31 — Entity-First Incident Dashboard & Card Experience

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_31_entity_first_incident_dashboard.txt`

Git Commit: Pending

Review Artifacts:

- Independent final-state review: `notes/review_phase_31.md`
- Reproducible browser gate: `notes/phase-31-browser-validation.js`
- Responsive captures: `/tmp/ops-dashboard-phase31-evidence/phase31-*.png`

## Goals / Built

- Made complete Phase 30 incident-by-SME summaries the principal dashboard. Bare hash
  and legacy `#incidents` now show semantic, responsive entity cards; Jobs moved to
  `#jobs`; the complete raw incident table moved to `#incident-list`.
- Added `public/entity-view.js`: pure active/all filtering, active-scope severity/
  category semantics, priority/latest/entity sorting, versioned preference
  normalization, entity facets, 24-card slicing, compact metadata/provenance helpers,
  and lossless decimal occurrence text. Eight focused tests cover it.
- Added a persistent entity control/status shell and 24-card progressive grid. Cards
  expose SME id, active/total incidents, worst active severity, relative `<time>` with
  exact timestamp, oldest active age, explicit occurrences, three ordered categories
  plus remainder, category provenance, and two app names plus remainder. Resolved-only
  cards are quieter; severity uses a narrow edge and text badge, never a color wall.
- Added reconciled summary tiles and a visible non-SME notice naming `__global__` and
  `RTT00001`, with a deterministic link to the complete raw list.
- Expanded route/return ownership for Entities, Jobs, Incident list, canonical
  `#entity=`, and legacy `#system=`. The canonical entity route deliberately reuses the
  existing bounded System signals controller in this phase; no incident workspace or
  cross-source API was added.
- Entities refresh atomically replaces the cached complete response only for the
  current request generation. Late Entities/Jobs successes, failures, or warm-up paths
  cannot repaint another route; the global refresh control always recovers.

## Route Mapping

| Before | Phase 31 canonical destination | Compatibility |
| --- | --- | --- |
| bare `#` (job dashboard) | bare `#` = Entities | Jobs preserved at `#jobs` |
| `#incidents` (raw list) | `#incident-list` = raw list | `#incidents` remains a supported Entities alias |
| `#system=<id>` | `#entity=<id>` for card entry | `#system=` remains a permanent working alias |
| `from=dashboard` | `#jobs` | old intent preserved |
| `from=incidents` | `#incident-list` | old intent preserved |

New links use `from=entities`, `from=jobs`, and `from=incident-list`; scoped
`entity:`, `system:`, `appruns:`, and `incident:` return tokens remain shape-validated.

## Card / Filter Semantics

- One card equals one `entityKind: "sme"` summary from the complete API. Default
  activity is Active; All includes resolved-only history.
- In Active mode, severity/category filters inspect `activeBySeverity` and category
  `activeCount`. In All mode they inspect total metadata. Search is exact/partial,
  case-insensitive SME id. Selected zero-count persisted values remain operable.
- Priority is active first, worst active severity, active count, latest seen, entity id;
  Latest and Entity sorts keep entity id as the final tie-break.
- Summary tiles always mean complete SME/non-SME API totals. The polite status says
  shown versus matching versus complete-response entity counts. Occurrences are never
  labeled incidents.
- Category provenance is compact but explicit: oracle-only is a dashed “oracle hint”;
  mixed says “includes oracle”; classifier-only stays plain. Current live aggregate had
  mixed but no oracle-only entity-category, so browser evidence uses the real mixed row
  and pure tests cover the oracle-only branch.

## Validation

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
docker run --rm ... node -e '<compile public JS and inline controller>'
docker run --rm --network host ... node notes/phase-31-browser-validation.js
git diff --check
```

- Full suite: 165/165 passed. All public helper files and the inline controller compile;
  `git diff --check` passes.
- Browser/live reconciliation: the first 24 of 174 active matches came from 229 complete
  SME summaries; tiles reconciled to 229 SMEs / 174 active SMEs / 357 active incidents /
  517 SME incidents / 12 non-SME incidents. Showing 48 then 72 cards kept those totals
  unchanged and retained focus.
- Keyboard: search, Active/All, severity, category, sorting, reset, show-more, entity
  entry/return, raw category traversal/load-more, and native DA disclosure passed.
  A selected persisted zero-count entity category remained clearable.
- Routes/races: all 11 families (Entities, Jobs, run, Connectivity, acquisition, System
  signals, legacy system, canonical entity, Incident list, incident, app run log) had
  correct title/source/nav/body ownership and zero unexpected console/page errors.
  Both slow Entities→Jobs and Jobs→Entities refresh races passed; loading, 503 warm-up,
  healthy/filtered empty, and failure states stayed distinct.
- Responsive: 390x844, 768x900, and 1440x900 in light/dark produced one/two/four card
  columns with visible focus, wrapped navigation/controls, and no body/card overflow.
  Jobs and Incident list also remained locally contained in all six combinations.
  Mobile-light and desktop-dark captures were visually inspected.
- Preserved Phase 29 guarantees: Jobs and Incident list sticky headers had 0 px movement
  after 300 px local scroll; raw incident focus/load-more and native DA disclosure
  passed. Port 8080 was untouched; the disposable app used port 18080.

## Independent Review / Phase 32 Decision

- `notes/review_phase_31.md` found no actionable Phase 31 implementation defect. The
  hierarchy is genuinely entity-first, cards are operational summaries rather than
  restyled table rows, non-SME groups remain discoverable, and the final state is ready
  to commit (not committed per developer instruction).
- Concrete remaining friction does satisfy Phase 32's entry gate: card→entity currently
  replaces incident context with the reused System signals/connectivity view; reaching
  the actual incident inventory requires backtracking to the global raw list, which has
  no entity filter. This loses SME context and prevents direct comparison of the three
  explicitly scoped sources.
- Recommendation: **proceed with Phase 32 in a separately authorized phase** using its
  bounded, paged, read-only design. Phase 32 was not implemented during this goal.

## Commit Readiness

- Phase 31 scope/non-goals, preserved views, deep links, accessibility, response truth,
  browser/race/reconciliation gates, independent review, and documentation are complete.
- No write, schema, grant, cache, environment, dependency, deployment, or producer
  change was made in Phase 31. Ready to commit; no commit or push performed.

---

# Phase 30 — Incident Entity Summary Contract

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_30_incident_entity_summary_contract.txt`

Git Commit: Pending

Review Artifacts:

- Review result: `notes/review_phase_30.md`
- Live SQL/plan probe: `notes/phase-30-live-validation.js`
- HTTP reconciliation: `notes/phase-30-api-validation.js`

## Goals / Built

- Added the smallest complete server-side SME card contract: one atomic, unbounded
  grouped read of `incidents.incidents`, never a regrouped incident cursor page.
- Added `lib/entities.js` with shared safe-id/entity classification, Phase 21 lifecycle
  semantics, known-plus-other state/severity axes, bigint-safe occurrence strings,
  category/source merging, app deduplication, deterministic ordering, and full
  SME/non-SME reconciliation.
- Added `GET /api/entities` with one handler-owned `asOf` and the shared sanitized error
  path. The response contains 229 SME summaries under `entities` and complete `global`/
  `other` producer summaries under `nonSmeEntities` at the recorded observation.
- Added nine focused tests and reproducible live/API validation scripts. No frontend,
  existing API, cache, schema, grant, environment, dependency, or deployment changed.
- Re-evaluated future prompts before implementation. Phase 31 remains aligned; Phase
  32's stale 1..168-hour System signals claim was corrected to the existing reviewed
  1..48-hour cap. Phase 32 behavior remains unimplemented and conditional.

## Schema Facts Confirmed (live DB)

Observation: 2026-07-21 20:00:30 UTC as `ops_dashboard_ro`.

- `incidents.incidents.entity` is non-null `varchar`; `apps` is nullable `text[]`;
  occurrence count is nullable `bigint`; first/last times are nullable `timestamptz`;
  assessment is `jsonb`; category/state/severity are nullable `varchar`; and
  `category_source` is non-null `varchar`.
- 529 incidents span 231 producer entities: 517 incidents across 229 SMEs, 11
  `__global__` incidents, and one `RTT00001` incident. Every live SME is exactly eight
  characters (`SME` plus digits) and satisfies the shared 1..64 safe-id contract.
- Current vocabularies are states `open`/`recurring`/`resolved`, severities
  `high`/`medium`/`info`, and sources `classifier`/`oracle`; reserved known values and
  future `other` values remain explicit in the contract.
- The API reconciled 529 total / 368 active incidents and 368805 occurrences. SME-only
  summary: 229 entities, 174 with active work, 517 total / 357 active incidents, and
  246206 occurrences. Non-SME: 12 total / 11 active and 122599 occurrences;
  `__global__` remained visible (11/11, 122416) and `RTT00001` remained visible
  (1/0, 183).
- Mixed provenance is live and preserved: SME16380 has two apps and a `credentials`
  category whose sources are both classifier and oracle.

## Architecture / Performance / Safety

- Read-only and least privilege hold: SELECT was true while INSERT/UPDATE/DELETE were
  false on `incidents.incidents`; `incidents.pipeline_state` remained unreadable.
- The SQL reads only `incidents.incidents`, contains no limit, interpolation, write,
  cross-schema join, raw events, pipeline state, or verbose log. One query gives one
  observation point and avoids N+1 behavior.
- Exact `EXPLAIN (ANALYZE, BUFFERS)`: 327 grouped result rows from a 529-row tiny-table
  scan, 6.425 ms execution, 198 shared hits, zero shared reads. Application query was
  27 ms warm; live `/api/entities` requests were 68–84 ms, safely request-path sized.
- `sum(bigint)` is cast to text in SQL and accumulated with `BigInt` only inside the
  pure shaper, so the JSON contract always exposes decimal strings without precision
  loss.

## Validation / Review

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
docker run --rm ... node notes/phase-30-live-validation.js
docker run --rm --network host ... node notes/phase-30-api-validation.js
git diff --check
```

- Full suite: 155/155 passed (146 baseline plus nine Phase 30 tests). Focused helpers,
  SQL text guards, server-route guard, and changed JS compilation passed.
- Disposable port-18080 HTTP validation passed: stable complete entity ordering;
  state/severity/incident reconciliation with `/api/incidents`; mixed provenance;
  non-SME discovery; and 200 compatibility responses for health, Jobs, errors,
  connectivity, systems, incident list, and incident detail. Port 8080 was untouched.
- Structured review against `markdown/REVIEW_CHECKLIST.md` found no actionable issue.
  Details are in `notes/review_phase_30.md`.
- Problems encountered were validation-only: Docker access required the approved
  runtime permission; a first inline probe had a quoting error before execution; and a
  loopback-bound HTTP probe needed host-network mode. None changed application behavior.

## Commit Readiness / Follow-Up

- Phase 30 requirements, non-goals, schema proof, read-only boundary, reconciliation,
  performance, validation, and review are complete. Ready to commit, but not committed
  per developer instruction.
- Phase 31 may now consume `/api/entities`. It must not add Phase 32 cross-source/entity
  workspace scope.

---

# Phase 29 — UX Review Fix Round & Commit-Readiness Closure

Date: 2026-07-21

Status: Completed (independent final-state review closed with Phase 31)

Prompt: `prompts/prompt_29_ux_review_fix_round.txt`

Git Commit: Pending

Review Artifacts:

- Source findings: `notes/review_ux_implementation_phases_20_28_claude_findings_2026-07-21.md`
- Reproducible browser gate: `notes/phase-29-browser-validation.js`
- Fix-delta handoff: `notes/review_handoff_phase_29.md`

## Built / Finding Closure

- **H1:** global refresh always resets after its captured handler settles; a delayed
  incident refresh followed by Systems navigation leaves the new route's control live.
- **M1–M3:** bounded table scrollports restore measured sticky headers while retaining
  narrow horizontal containment; the selected-chip ring is high-contrast; an active
  zero-count persisted filter remains enabled and clearable.
- **M4/L7:** note rendering preserves arrays, nested/unknown data, falsy and distinct
  promoted identifiers, BigInt/circular direct-call values, and never emits accidental
  `[object Object]` or interpreted HTML.
- **M5–M6:** dashboard 503/error writes are route-owned, one warm-up retry chain is
  allowed, hidden dashboard links retain dashboard return context, and cached summary
  chrome restores immediately on return.
- **M7/M9:** incident category focus survives repeated refetches; data_acquisition's
  inline-run disclosure is a native Space/Enter button with accurate aria-expanded.
- **M8:** cursor timestamps require canonical four-digit UTC ISO with year 0001–9999;
  ids are BigInt-bounded to PostgreSQL signed bigint. Invalid values fail before SQL
  with the existing generic 400.
- **L1–L5/L8/L10/L11:** scroll regions have valid region semantics; routed polite
  status nodes persist and update after insertion; progressive controls restore focus
  and preserve open disclosures; removed Age sort state migrates; incident totals say
  “overall”; helper code is readable; compact UUIDs have explicit copy plus manual
  fallback.
- **Deferred consciously:** L6 API truncation metadata needs a separate additive
  contract; L9 time rounding remains the tested product policy. F7 continues to keep
  latest status and 24h health separate and explicitly labeled.

## Architecture / Safety

- No query, schema, index, grant, dependency, write path, route family, or API response
  shape changed. `ops_dashboard_ro`, bound SQL, partition filters, and the existing
  bounded data_acquisition exception remain intact.
- M8 is server-side input validation only. It narrows accepted opaque cursors to the
  exact safe domain already emitted by the server.

## Validation

- Full suite: **146/146 pass**; all browser helpers and the inline controller compile;
  `git diff --check` passes.
- Live isolated API: the reproduced signed-year, RFC-1123, bigint-overflow, and year-0
  cursors return generic 400. A full valid walk returns 529/529 unique incidents over
  six pages.
- Reproducible Playwright gate passes: sticky geometry (`scrollTop=300`, header delta
  0), refresh race, two-request-only 503 retry, immediate dashboard summary, three
  sequential category selections with focus, native DA Space disclosure, selected and
  active-zero chips, disclosure focus/state, UUID copy/manual fallback, all nine route
  families, and 390/768/1440 light/dark containment.
- Mobile and desktop-dark captures were visually inspected. Port 8080 was untouched;
  validation used the disposable port-18080 service.

## Commit Readiness

- Implementation and validation complete. The original fix-delta handoff and evidence
  remain preserved. The independent final-state Phase 31 review subsequently inspected
  the combined Phase 20–31 state and found no actionable regression; its strengthened
  browser pass re-proved the highest-risk Phase 29 route/race/sticky/focus/disclosure
  guarantees on the new route hierarchy. The pending current-state commit gate is
  therefore closed by `notes/review_phase_31.md`.

---

# Phase 28 — Responsive Containment & Final UX Polish

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_28_responsive_polish.txt`

Git Commit: Pending

## Built / Decisions

- Every static and generated table now sits in a keyboard-focusable, touch-friendly
  local overflow container; page chrome no longer scrolls horizontally on narrow
  viewports. Control rows wrap with mobile-sized inputs while desktop density remains.
- Grid, acquisition-subrun, and app-run UUIDs display a consistent compact prefix,
  while their href, title, and accessible name retain the exact full identifier.
- Run-note formatting promotes system/job fields once, removes only those promoted
  keys from a shallow copy, and preserves unknown fields as safe text/JSON.
- Added a dependency-free adaptive SVG favicon. No API, query, schema, grant, route,
  ordering, status, or filter semantics changed.

## Validation

- Full suite: 138/138 tests; `git diff --check` passes.
- Playwright at 390x844, 768x900, and 1440x900 light/dark confirmed body/table
  containment, keyboard focus, captions, and exact compact-UUID link fidelity.
  Post-review correction: that run did not measure sticky geometry; Phase 29 restored
  a real vertical scroll context and asserted the header position during scrolling.
- Mobile and desktop-dark captures were visually inspected; controls remain usable,
  the operator-dense desktop layout is unchanged, and the favicon returns HTTP 200.
- Requirements/read-only/review/validation complete; ready to commit.

---

# Phase 27 — Native Table & Control Accessibility

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_27_table_accessibility.txt`

Git Commit: Pending

## Built / Validation

- Sort headers remain scoped column headers with child buttons and aria-sort; group
  rows remain rows with native disclosure buttons. No role=button/link rows remain.
- All nine data tables have captions and scoped headers. Selected filters stay enabled
  and toggleable with aria-pressed; focus/selection styling works in both schemes.
- Visible cadence explanation replaces title-only help; loading messages are concise
  polite status regions. All navigation remains native anchors.
- Keyboard/browser smoke passed sorting, Space disclosure, selected-filter clear,
  captions/scopes across routes, visible cadence help, and live status semantics.
  Frontend-only; ready to commit.
- Post-review correction: the DA inline-runs anchor and grid chip's white active ring
  were missed in this validation; Phase 29 converted/fixed and browser-tested both.

---

# Phase 26 — Status Scope, Time Formatting & Visual Signal

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_26_status_time_semantics.txt`

Git Commit: Pending

## Built / Decisions

- `public/time-view.js` provides tested seconds→minutes→hours→days→years formatting,
  null/invalid handling, future-skew clamp, and exact ISO/local titles for `<time>`.
- Grid uses one relative-first Last run column (redundant Age removed), labels latest
  status explicitly, and labels historical badges `24h health`.
- Fixed visual policy: narrow exception edge markers replace full-row tint; Systems
  has no row tint and uses textual colored counts; connectivity marks current failures
  only; event/status badges remain textual. Zero-count status chips/tiles are disabled.

## Validation

- Focused 34 tests pass. Light/dark browser smoke verifies seven aligned grid columns,
  relative+exact time, explicit scope labels, disabled zero controls, transparent
  Systems rows, and current-failure edge markers. Presentation-only; ready to commit.

---

# Phase 25 — Route-Aware Navigation, Context & Refresh

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_25_route_aware_chrome.txt`

Git Commit: Pending

## Built

- Pure `public/routes.js` parses all nine hash families, validates return context,
  and owns title/source/nav/parent metadata.
- Global chrome now has Dashboard nav, accurate per-route schema source,
  document.title, aria-current parent nav, and one route-aware refresh button.
- Generated run/system/incident links carry safe `from` tokens; deterministic
  breadcrumbs replace generic/blind back links while legacy deep links retain safe
  fallbacks and run timestamp hints.
- Request-generation guards keep delayed routes from repainting current view bodies.
  Post-review correction: dashboard warm-up/error meta paths and cached-summary return
  timing were not covered here; Phase 29 added route ownership and race validation.

## Validation

- Route helper tests pass; browser direct-loaded all nine families and verified
  title/source/nav, per-route refresh request, system/incident/app-run return paths,
  compound hint preservation, and delayed-systems→incidents chrome stability.
- No API/query/grant change. Ready to commit.

---

# Phase 24 — Lean, Keyset-Paginated Incident List

Date: 2026-07-21

Status: Completed

Prompt: `prompts/prompt_24_incident_list_scaling.txt`

Git Commit: Pending

## Built

- Split the incident list into an eight-field lean projection while leaving detail
  shaping/query complete. Oracle provenance remains mandatory.
- Added opaque base64url cursor encode/decode with strict rank/timestamp/bigint
  validation. Invalid cursors return 400.
- Added exact keyset order/predicate: activity ASC, severity ASC, last_seen DESC NULLS
  LAST, id DESC; default page 100, clamp 25..200, limit+1 next-cursor detection.
- UI loads/deduplicates guarded pages explicitly; every filter starts page one and
  stale in-flight pages cannot contaminate a new filter generation.

## Schema Facts Confirmed (live)

- 529 unique ids; 0 NULL last_seen currently; 0 invalid category_source values.
  Schema-null timestamps are still handled by SQL/cursor design.

## Performance / Compatibility

- Unpaginated baseline: 745,259 bytes / 529 rows / 128 ms measured. First lean page:
  19,769 bytes / 100 rows (97.3% smaller) and 178 ms cold; filtered page 14,546 bytes /
  75 rows / 11 ms. API additions: pageSize/nextCursor; count is page count.
- EXPLAIN: first page 2.0 ms, next page 1.2 ms; small-table seq scan + top-N sort, no
  new index justified. Read-only grants unchanged.

## Validation

- 131/131 tests. Two live 100-row pages exactly equal the first 200-row baseline with
  zero duplicates; an equal-last_seen boundary returned the expected lower id.
- Browser: 100→200 unique rows, active ordering preserved, filters reset to page one,
  delayed stale page ignored, 79-row category end state honest.
- Detail endpoint remains complete; invalid cursor returns sanitized 400.

## Commit Readiness

- Requirements/read-only/schema/review/validation: complete; ready to commit.

---

# Phase 23 — Shared Large-List Controls

Date:
2026-07-21

Status:
Completed

Prompt:
`prompts/prompt_23_large_list_controls.txt`

Git Commit:
Pending

## Goals

- Bound initial DOM work and add honest, view-specific navigation for the large
  connectivity, systems, acquisition, and loaded run-log lists.

## Built

- `public/list-view.js`: pure order-preserving text/enum/flag filters plus 50-row
  slicing; focused Node tests.
- Global sticky table headers use the system Canvas color in light/dark schemes.
- Connectivity filters system/detail/category/phase, source, and Phase 20 current
  state; Systems filters system/app, has-errors vs warn-only, and cross-app;
  Acquisition filters system/modality/manufacturer, source, and failures-only.
- Those three complete-response views initially render 50 matching rows, reveal 50
  more at a time, reset the slice on filter changes, expose counts/reset/empty states,
  and never reorder the server response.
- Run logs add explicitly loaded-only run-id/job-type search and a visible Job type
  column while preserving server status filtering and keyset load-more.

## Schema Facts Confirmed (live API)

- Connectivity: 539 snapshot rows; Systems: 209 rows (server cap 500, no truncation
  flag); Acquisition: 202 grouped rows; data_acquisition runs: 50 loaded with a
  non-null keyset cursor. Payload fields matched all planned controls.

## Important Decisions

### Fifty-row client slices

Decision: Fully fetched lists start and advance by 50; run logs remain server-paged.

Reason: Fifty compact rows cover multiple desktop viewports while bounding current
initial DOM volume by roughly 4x–11x. Run-log completeness has different semantics.

Tradeoff: This is progressive rendering, not virtualization; operators can still
render the full response deliberately.

## Architecture Notes

- Read-only/query/API impact: none; frontend-only and dependency-free.
- Ordering: `Array.filter` then `slice`, so server worst/newest-first order survives.
- Completeness: counts say response rows/snapshot rows; loaded-run search says loaded.
  Systems only warns about possible truncation if its 500-row cap is actually reached.
- Deployment: static refresh only; no grant/restart-specific data contract.

## Validation

- Passed: 129/129 tests; inline script syntax check.
- Passed live browser: connectivity 50→100 and 339 stale/68 MMB-stale filters;
  systems and acquisition 50→100 plus combined filters; runs 50→100 via exactly one
  keyset request and loaded-only search via zero requests.
- Confirmed client filters/reset/show-more add zero API requests, sticky positioning
  computes in dark mode, and server order is unit-pinned.
- Failed: none. Initial hash-navigation smoke awaited network idle rather than the
  async route render and then used an unscoped duplicate Source label; the harness was
  corrected with DOM waits and view-scoped labels.

## Follow-Up Tasks

- Phase 24: server-side incident projection and keyset pagination.

## Commit Readiness

- Requirements implemented: yes.
- Read-only / least-privilege rules hold: yes.
- Schema assumptions confirmed live: yes.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 22 — Progressive Disclosure for Dense Feeds

Date:
2026-07-21

Status:
Completed

Prompt:
`prompts/prompt_22_dense_feed_disclosure.txt`

Git Commit:
Pending

Review Artifacts:

- UX-review source and tall-page captures: `notes/review_handoff_ux_review_2026-07-21.md`
  and `notes/ux-review-2026-07-21/`

## Goals

- Make the dashboard error feed and incident event detail scannable at first paint.
- Preserve complete source text and honest fetched/total counts behind accessible,
  explicit disclosure controls.

## Built

- Added `public/feed-view.js`, a DOM-free browser/Node helper for first-meaningful-line
  previews, 180-character single-line bounds, 25-row increments, and honest count text.
- Dashboard error feed now renders 25 of the fetched 100 events initially, exposes
  bounded “show more” steps, and gives every truncated message an aria-expanded
  show-full/show-less button. Row-wide synthetic links were removed; each row has a
  native run link with the existing partition hint.
- Error-feed success-empty and load-failure paths now render distinct explicit table
  messages and summary labels.
- Incident sample messages use the same disclosure control. Incident events render 25
  initially and reveal 25 at a time without refetching; the heading separately states
  shown, fetched, and lifetime occurrence counts.
- All log/incident strings remain `textContent`-only; no HTML interpretation was added.

## Schema Facts Confirmed (live API/data)

- Fresh error feed: 100 rows, all with run ids; 41 multiline err_msg values and 59
  note-only fallbacks. Median rendered source length 260 characters, max 688, proving
  that one-line JSON also needs a character bound.
- Incident 17100: occurrenceCount 740, sample message 590 characters, 100 newest-first
  returned events at eventLimit 100.
- `/api/errors` still returns lookbackDays and raw event fields; incident detail still
  returns eventLimit and occurrenceCount. No API/query change was needed.

## Important Decisions

### Bound both source lines and visual volume

Decision: previews use the first non-empty source line and cap it at 180 characters;
feeds initially show 25 rows and advance by 25.

Reason: Multiline stacks caused the original tall pages, but note-fallback JSON is often
one long line. Solving only one dimension leaves the other unbounded.

Tradeoff: Wrapped 180-character previews can still occupy more than one visual line in
narrow message columns, while the exact full string remains one button away.

### Explicit links replace interactive rows

Decision: message disclosure and run navigation are separate native controls.

Reason: Expanding text must not navigate, and real anchors support keyboard, open-in-new-
tab, copy-link, and standard semantics.

Tradeoff: The run target is a smaller click area, but its behavior is predictable.

## Architecture Notes

- Read-only / least-privilege impact: none; frontend-only consumption.
- Query / partition-pruning impact: none; existing endpoints and caps retained.
- Performance impact: first DOM paint drops from 100 dense rows to 25 in each feed;
  later increments reuse already-fetched arrays.
- Security impact: source strings only reach `textContent`; aria controls use generated
  local ids.
- Deployment impact: static file change only, served after app/static refresh; no grant.
- API compatibility: unchanged.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
# inline browser script node --check
# isolated app + Playwright live and mocked-response smoke
```

Results:

- Passed: 124/124 tests, including preview, truncation, increments, and count truth.
- Passed: browser dashboard 25→50 rows, 25 native run links, no synthetic row roles;
  mouse and Enter expansion/collapse leave the route unchanged.
- Passed: incident 17100 25→50 rows with “newest 100 of 740 occurrences” preserved.
- Passed: mocked empty response reports no WARN/ERROR in 2 days; mocked 500 reports
  load failure; no console errors.
- Failed: none. One initial Playwright assertion used a dynamic text-filtered locator
  that resolved the next “show full” button after its label changed; the test locator
  was stabilized by aria-controls and rerun cleanly. Product code was correct.

## Review Notes

Source: self-review against the prompt, UX evidence, and review checklist.

Critical issues: none.

Deferred findings:

- Shared sticky headers/list filters/progressive rows remain Phase 23.
- Full table semantics and captions remain Phase 27.

## Follow-Up Tasks

- Phase 23: shared controls for the remaining large list views.

## Commit Readiness

- Requirements implemented: yes.
- Read-only / least-privilege rules hold: yes.
- Time-windowed queries partition-pruned: unchanged.
- Schema assumptions confirmed live: yes.
- Review findings addressed or deferred: yes.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 21 — Incident Triage Ordering & Category Controls

Date:
2026-07-21

Status:
Completed

Prompt:
`prompts/prompt_21_incident_triage_controls.txt`

Git Commit:
Pending

Review Artifacts:

- UX-review source: `notes/review_handoff_ux_review_2026-07-21.md`
- Indexed evidence: `notes/ux-review-2026-07-21/`

## Goals

- Put active operational work ahead of resolved history without hiding history.
- Make the existing incident category filter discoverable, counted, composable, and
  honest about empty results.

## Built

- `INCIDENTS_LIST_SQL` now orders by the producer-confirmed activity class, then
  severity, `last_seen DESC`, and `id DESC` for a stable tie-break. Unknown future
  states sink after all known states.
- The existing incident rollup now groups by severity, state, and category once.
  `shapeRollup` preserves the two existing axes and adds deterministic
  `byCategory: [{category,count}]`, sorted by count then name; all axes reconcile.
- The Incidents UI adds a labeled count-backed category selector, visible active
  filter summary, and clear-all action. Category, severity, and state refetch together;
  normalized API filters are echoed back into UI state; zero-result combinations show
  an explicit message.
- Oracle category provenance continues through every incident row/detail rendering;
  the category selector is only a taxonomy facet and makes no per-incident claim.

## Schema Facts Confirmed (live DB and producer)

- Producer vocabulary: `open`, `recurring`, `acknowledged`, `resolved`, `suppressed`.
  `open`/`recurring`/future `acknowledged` are active and closeable;
  `resolved`/future `suppressed` are inactive or terminal. The engine currently writes
  only open, recurring, and resolved.
- Live distribution at implementation: 529 total = 360 open / 8 recurring / 161
  resolved; 18 categories, led by `rsync_io_timeout` 186 and `unknown` 79.
- Indexes remain state+last_seen, severity+last_seen, BRIN(last_seen), PK(id), and the
  fingerprint/entity unique index. No category index exists; the table is currently
  small enough that sequential scan plus CASE-ranked sort is appropriate.

## Important Decisions

### Activity is a class, not an order among active states

Decision: open, recurring, and acknowledged share rank 0; resolved and suppressed
share rank 1; unknown states rank 2. Severity and recency decide within each class.

Reason: A resolved high incident is history, while an open medium incident needs
attention now. `acknowledged` still represents a live, auto-closeable problem;
`suppressed` is producer-terminal.

Tradeoff: The CASE expression requires a small in-memory sort instead of directly
matching one existing index. Live cost is about 3.7 ms for all 529 projected rows.

### Category counts are global facets

Decision: Category counts, like existing severity/state tiles, describe the complete
table while `count`/“showing” describes the current combination.

Reason: Stable global counts keep controls navigable when a combination has zero rows
and preserve the established rollup contract.

Tradeoff: A category option's count is not the count remaining after another filter;
the explicit “showing N” result count carries that contextual truth.

## Architecture Notes

- Read-only / least-privilege impact: none; existing SELECT-only surface.
- Query impact: one extra GROUP BY key and an activity CASE sort over 529 rows; no
  partitioned table or JSON detoast involved.
- Performance impact: live EXPLAIN ANALYZE — rollup 1.2 ms; unfiltered list 3.7 ms;
  combined list 0.8 ms. Disposable HTTP API measured 4–95 ms.
- Security impact: category remains shape-normalized and bound as `$3`; no SQL
  interpolation. UI strings use `textContent`/option text.
- Deployment impact: restart required to load server/static changes; validation used
  an isolated disposable instance and left the deployed service untouched.
- API compatibility: additive `rollup.byCategory`; existing rollup keys, filter echo,
  incident rows, and detail routes remain compatible.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
# read-only live GROUP BY/list comparison and EXPLAIN ANALYZE through the app role
# disposable app + Playwright interaction smoke on :18080
```

Results:

- Passed: 120/120 tests, including activity vocabulary, category rollup ordering and
  reconciliation, bound SQL filters, explicit activity ranks, and stable id order.
- Passed: all 368 active live rows precede the first inactive row; default first row
  is open/high and final row resolved/info.
- Passed: all rollup axes sum to 529; 18 categories; medium+open+unknown returns 75
  matching rows; a valid zero-result combination returns count 0 without error.
- Passed: browser category/tiles composition, clear-all, zero state, 17 rendered oracle
  hints, 19 selector options including “all,” and no console errors.
- Failed: none. Two initial browser assertions used response completion instead of DOM
  render completion and one stale expected count; the smoke harness was corrected and
  rerun cleanly. Product code was not implicated.

## Review Notes

Source: independent implementation self-review against `markdown/REVIEW_CHECKLIST.md`
and the UX evidence.

Critical issues: none.

Accepted fixes: none beyond the implemented scope.

Deferred findings:

- Incident projection/pagination remains Phase 24 scope.
- Shared table accessibility remains Phase 27 scope.

## Problems Encountered

- Problem: the deployed service was intentionally not restarted.
  Resolution: validated the exact working tree in an isolated full app container
  connected with the production read-only role.

## Follow-Up Tasks

- Phase 22: progressive disclosure for the two dense event feeds.

## Commit Readiness

- Requirements implemented: yes.
- Read-only / least-privilege rules hold: yes.
- Time-windowed queries partition-pruned: not applicable; incidents table is not
  partitioned and no time window was added.
- Schema assumptions confirmed live: yes.
- Review findings addressed or deferred: yes.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 20 — Connectivity Freshness Truth

Date:
2026-07-21

Status:
Completed

Prompt:
`prompts/prompt_20_connectivity_freshness_truth.txt`

Git Commit:
Pending

Review Artifacts:

- UX-review source: `notes/review_handoff_ux_review_2026-07-21.md`
- Indexed screenshots and reproduction script: `notes/ux-review-2026-07-21/`

## Goals

- Stop presenting a retained connectivity probe result as current operational truth.
- Preserve the raw last result while making source-specific freshness, current state,
  data age, and record age independently inspectable.

## Built

- `lib/connectivity.js`: source-specific 45-minute freshness budgets; additive
  `lastResult`, `freshness`, `operationalState`, and `freshnessBudgetMs`; stable
  current-offline-first ordering followed by stale history; future-clock skew clamps
  to zero age.
- Connectivity rollups now reconcile `online + offline + unknown + stale = total`
  independently for HHM and MMB. Raw `status` remains compatibility-preserving last
  result; only `operationalState` claims current truth.
- `public/index.html`: explicit Current state / Last result / Data age / Record age
  columns, stale badges and counts, current-only red failure treatment, and grid/system
  summaries that do not count stale failures as live outages.
- Contract documentation and architecture principles now describe the retained
  snapshot and its two clocks.

## Schema Facts Confirmed (live DB and producer)

- `alert.offline_hhm_conn` and `alert.offline_mmb_conn` are retained latest-per-system
  snapshots, not an inventory of currently scheduled systems.
- Both acquisition groups run every 30 minutes. The producer refreshes `inserted_at`
  on successful and failed probes, but refreshes `capture_datetime` only on success.
  Therefore `inserted_at` is the currentness clock and `capture_datetime` is data age.
- The producer's existing offline report applies a 45-minute stale threshold. The
  dashboard adopts that contract for both current HHM and MMB schedules (30-minute
  cadence plus 15-minute grace).
- At verification time the snapshot contained 539 rows; the 1-hour acquisition set
  contained 200 matching source/system pairs. The remaining 339 retained rows were
  historical/retired and must remain visible as stale rather than current offline.

## Important Decisions

### Current operational state is derived, not copied

Decision: A row whose `inserted_at` age is at most 45 minutes has its raw last result
as its current operational state. Older, missing, or invalid check times produce
`STALE`, regardless of whether the last result was ONLINE or OFFLINE.

Reason: Probe failures update the checked clock without updating the capture clock;
using capture age would falsely mark current failures stale. Conversely, retained
rows can keep an old OFFLINE result indefinitely and must not inflate live outage
counts.

Tradeoff: Retired equipment remains visible in a large stale tail until an inventory
contract exists. This is honest and auditable, but Phase 23's list controls become
important for navigation.

## Architecture Notes

- Read-only / least-privilege impact: none; existing `SELECT` grants only.
- Query / partition-pruning impact: none; existing connectivity queries unchanged.
- Performance impact: request-path shaping/sorting remains linear over 539 small rows;
  disposable live route smoke returned in about 53 ms.
- Security impact: none; no new input or write path.
- Deployment impact: application restart required to load the new server/static code;
  validation used an isolated disposable instance because the deployed service was
  deliberately not disrupted.
- API compatibility: additive per-row fields; `status` remains the raw last result.
  Rollup adds `unknown` and `stale`, while `online`/`offline` now mean current records.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
# live classifier and /api/connectivity checks through the existing app image/network
# disposable full-app smoke on :18080 plus Playwright browser assertions/screenshot
```

Results:

- Passed: 118/118 tests, including exact freshness boundary, missing/invalid/future
  timestamps, stale historical success/failure, ordering, and rollup reconciliation.
- Passed: live API returned 539 rows and reconciling rollups; all additive fields were
  present; current failures sorted before current successes and stale history.
- Passed: browser rendered 539 rows with Current state and Last result columns, 200
  current (162 online / 38 offline) and 339 stale, with no console errors.
- Failed: none.

Manual / smoke tests:

- Visually inspected the connectivity view at desktop width. Current failures are
  prominent; stale history is neutral; the summary and paired clocks are legible.
- Confirmed the data-acquisition grid badge reports current HHM/MMB failures separately
  from stale records.

## Review Notes

Source: independent implementation self-review against the UX evidence and the repo's
review checklist.

Critical issues: none.

Accepted fixes: none beyond the implemented scope.

Deferred findings:

- Historical/retired-row filtering and progressive rendering remain Phase 23 scope.
- Broader status/time visual consistency remains Phase 26 scope.

## Problems Encountered

- Problem: restarting the deployed service would disrupt the current instance and was
  not approved during validation.
  Resolution: ran the exact built app in an isolated disposable container against the
  live read-only database, including Playwright browser validation; left deployment
  state untouched.

## Follow-Up Tasks

- Phase 21: incident activity ordering and category controls.
- Phase 23: make the retained stale connectivity tail easy to navigate without hiding
  it.

## Commit Readiness

- Requirements implemented: yes.
- Read-only / least-privilege rules hold: yes.
- Time-windowed queries partition-pruned: not applicable; no query change.
- Schema assumptions confirmed live: yes.
- Review findings addressed or deferred: yes.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 19 — Incidents View

Date:
2026-07-21

Status:
Completed

Prompt:
`prompts/prompt_19_incidents_view.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_19.md` — the Codex briefing, scoped to
  the whole unreviewed branch (Phases 17–19). **Codex result: 5 findings (1 high /
  3 medium / 1 low), all accepted and fixed same-phase — see Review Notes.**
- Fix-round handoff: `notes/review_handoff_phase_19_fixes.md` — delta review of the
  fix commit `e1e676c`. **Re-review result: ALL FIVE FINDINGS CLOSED** (Codex verdicts:
  1 — CTE structurally bounds the LATERAL, adversarial loops=50 @ 42.6ms; 2 — DA
  clamps to 50 w/ cursor, lean apps keep 500; 3 — both routes cap 48h, env defaults
  resolve sanely incl. NaN/zero→24, negative→1, oversized→48; 4 — category text
  provenance-styled in list + heading, textContent-safe, valid inline span; 5 —
  non-finite confidence → null, the `""`→0 edge unreachable from pg NUMERIC).
  One new **nit** (stale config docs: `APP_RUNS_LIMIT` missing the DA 50-row
  exception; `.env.example` still said systems 1..168) — fixed same round in
  `ENVIRONMENT.md` + `.env.example`. **Review cycle complete.**
- Producer contract: `/opt/apps/incident-engine/notes/ops_dashboard_integration_brief.md`
- Schema-owner review: accepted/closed out (see Review Notes below)

## Goals

- Surface incident-engine's `incidents` schema (the classified, severity-assessed,
  self-resolving rollup of the suite's error firehose) as a read-only operator view:
  severity/state tiles, filterable list, per-incident detail (assessment reasons +
  recommended action) and raw-event drill-down. Zero incident-engine changes.

## Built

- `db/setup-readonly-role.sql`: fourth read surface — `USAGE ON SCHEMA incidents` +
  `SELECT` on exactly `incidents.incidents` / `incidents.error_events`, fail-closed
  (REVOKE → GRANT → DO-verify); `pipeline_state` deliberately not granted. Applied live.
- `db/queries.js`: `INCIDENTS_ROLLUP_SQL` (severity×state GROUP BY — also the UI
  self-check), `INCIDENTS_LIST_SQL` (bound 'all'-or-value filters, explicit severity
  rank, `last_seen DESC`), `INCIDENT_DETAIL_SQL` (bigint id), `INCIDENT_EVENTS_SQL`
  (by the incident's `(fingerprint, entity)`, `dt DESC`, LIMIT-bounded). Request-path,
  uncached (house precedent: small, indexed, no json-blob detoast).
- `lib/incidents.js` + `test/incidents.test.js` (10 tests): pure shaping (defensive
  `assessment` jsonb parse, rollup with all keys, camelCase rows), shape-gated filter
  normalizers, and a SQL text-contract test (bound params, read-only, no verbose_log).
- `server.js`: `GET /api/incidents` (rollup + filtered list in one response),
  `GET /api/incidents/:id` (integer-validated → detail + events).
- `public/index.html`: `#incidents` (tile row = rollup AND filter UI; list with
  severity/state badges, category+provenance, entity→`#system=` links) and
  `#incident=<id>` (badges, meta grid, assessment reasons, recommended-action callout,
  sample message, raw-event table with run drill-down links); nav link, hideAllViews,
  route branches. **Provenance rule enforced everywhere a category renders:**
  `category_source='oracle'` gets a dashed muted "oracle" badge + tooltip — a hint about
  the equipment's recent past, never a diagnosis.

## Schema Facts Confirmed (live DB)

- `incidents.incidents` (29 cols incl. `category_source`, `type`, `assessor_version`,
  internal `resolved_last_seen`) and `incidents.error_events` (20 cols incl. stamped
  `entity`) — column lists pulled live; match the producer's brief.
- Indexes: `uq_incidents_fingerprint_entity`, `(severity, last_seen DESC)`,
  `(state, last_seen DESC)`, BRIN(last_seen); `error_events` `(fingerprint, dt DESC)`,
  PK `(run_id, event_ord)`.
- Live at build time: 528 incidents (high 209 / medium 269 / info 50; open 361 /
  recurring 30 / resolved 137), 360,195 error_events — matches the brief's snapshot
  modulo documented drift.

## Important Decisions

### Grant lives in this repo (single allowlist)

Decision: The incidents grant is a block in `db/setup-readonly-role.sql`, not a script in
incident-engine.

Reason: Per the producer's brief — ops-dashboard owns its role's read surface; one script
stays the complete, fail-closed, provable allowlist (two scripts could fight).

Tradeoff: Cross-repo coupling documented in both repos' docs.

### Oracle provenance is a first-class UI rule

Decision: `category_source` travels DB→API→DOM untouched, and every category rendering
branches on it (dashed muted badge + tooltip when `oracle`).

Reason: The producer flagged this as the one place a naive view actively misleads: an
oracle category is the equipment's latest *unrelated* classified error, stamped onto an
`unknown` incident (live-verified: incident 17190 says `rsync_io_timeout`/oracle while
its own 667 events are 666 `unknown` + 1 `no_new_data` — zero rsync events; confirmed
by the schema owner in review).

Tradeoff: One extra field everywhere; worth it — trust in the view depends on it.

## Architecture Notes

- Read-only / least-privilege impact: fourth read surface, fail-closed-verified; INSERT
  and `pipeline_state` SELECT proven denied as `ops_dashboard_ro`.
- Query / partition-pruning impact: `incidents.*` is not partitioned (engine's DDL);
  list is a 528-row indexed sort (~1.4ms), drill-down is index-driven + LIMIT.
- Performance impact: request-path; list ~1.4ms. Drill-down: my warm-cache measure was
  ~95ms on a 25k-event incident; the schema owner's cold-cache re-run found the true
  worst case is a 45,509-event incident at **1,748ms cold** — the `(fingerprint, dt
  DESC)` bitmap path fetches all rows and sorts, ignoring the LIMIT. See Review Notes:
  the owner validated a `(fingerprint, entity, dt DESC)` composite → ordered Index Scan
  honoring the LIMIT, **3.4ms** (~500×), to be ADDed on their side.
- Security impact: filters shape-normalized ('all' fallback), `:id` regex-gated before
  the `::bigint` cast; params always bound; sanitized 500s.
- Deployment impact: two-step — apply the incidents grant (superuser) + restart, else
  the endpoints 500 (permission denied). Done live this phase.
- API compatibility: additive endpoints only; existing responses unchanged.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test    # 112/112 pass
# boundary: SET ROLE ops_dashboard_ro -> SELECT ok / INSERT denied / pipeline_state denied
# live: /api/incidents (+filters, bad input), /api/incidents/17190, EXPLAIN both queries
```

Results:

- Passed: 112/112 unit tests; tile rollup exactly equals a hand-run severity×state
  GROUP BY at the same moment (209/269/50 · 361/30/137); `?state=recurring` → 30 rows,
  all recurring; `severity=DROP TABLE` normalizes to `all`; `/api/incidents/abc` → 400;
  oracle incident 17190 carries `categorySource:"oracle"` with 5 assessment reasons +
  recommended action + the newest 100 (of 667) events with working run links; existing
  views unchanged.
- Failed: none.

## Review Notes

Source: incident-engine (the schema owner) reviewed the integration end-to-end
(2026-07-21). Result: **accepted, closed out.**

- Boundary: confirmed from the owner's side — `ops_dashboard_ro` reads exactly the two
  granted tables; INSERT and `pipeline_state` SELECT both raise `insufficient_privilege`.
- 17190: confirmed as the proof case, with a precision correction folded in above (667
  events = 666 `unknown` + 1 `no_new_data`; my "100 events" was the endpoint's
  `eventLimit` cap, not the total — the detail header now says "newest N of TOTAL").
- Index follow-up: **accepted with evidence.** Cold-cache truth: worst case 45,509-event
  incident, 1,748ms via the existing bitmap path; a `(fingerprint, entity, dt DESC)`
  composite (tested in a rolled-back txn) turns it into an ordered Index Scan that
  stops at the LIMIT → 3.4ms. Owner's decision: ADD the composite alongside the
  existing `(fingerprint, dt DESC)` (which shows 37k scans from a not-yet-identified
  consumer) rather than replace — held until that consumer is identified.

Critical issues: none. One test regex fixed during development (`inserted_at` matched
`/INSERT/` — now word-bounded).

### Codex review (branch-wide, Phases 17–19) — 5 findings, all accepted + fixed

Codex confirmed no read-only / SQL-injection / partition-pruning / XSS violations, and
found (all fixed in the same review commit):

1. **High — the P18 job-type LATERAL was not guaranteed to run after LIMIT**
   (`db/queries.js`). Codex produced a plan (incremental sort disabled) where every
   qualifying `verbose_log` detoasted before the page limit — my handoff weak-spot #3,
   proven. Fix: the page (filter + keyset + ORDER BY + LIMIT) is now selected in a
   **MATERIALIZED CTE** and the LATERAL consumes `page.verbose_log`, so the bound is
   enforced by query shape, not planner cooperation. New SQL-shape assertions (CTE
   materialized under withJobType; `LIMIT $5` precedes the LATERAL; LATERAL reads the
   CTE). Adversarial re-EXPLAIN (sort off, 14-day window, 15,778 candidates): detoast
   runs exactly 50 times, 38ms.
2. **Medium — the 50-row detoast ceiling wasn't enforced** (`server.js`): DA callers
   could request `limit=500`. Fix: for `data_acquisition` both default and max clamp
   to 50 (lean apps keep 200/500). Live: `limit=500` → 50 rows + cursor.
3. **Medium — the systems window (1..168h) blew the request-path budget**: 168h
   measured 2.28s warm / 4.25s cold. Fix: max clamp 48h (24h ≈ 0.4s, 48h ≈ 0.8s) on
   both `/api/systems` routes AND on the env default (a misconfigured
   `SYSTEMS_WINDOW_HOURS` can't reopen it). `ENVIRONMENT.md` updated. A 7-day
   aggregate would need a cached/precomputed path — deferred.
4. **Medium — oracle categories still read as diagnoses**: only a side label was
   muted; the category text itself was plain in the list cell and detail heading.
   Fix: one `categoryNode()` renderer used everywhere — under `oracle` provenance the
   category text ITSELF sits inside the dashed muted tooltip element
   ("`rsync_io_timeout · oracle`"); the redundant side badge removed.
5. **Low — malformed `confidence` rendered "NaN (rules)"**: `Number(r.confidence)`
   could yield NaN. Fix: finite-or-null in `lib/incidents.js` + a malformed-confidence
   test matrix.

Post-fix validation: 113/113 tests; restart + live re-smoke green (DA clamp, lean-app
500 intact, systems 48h echo, incidents unaffected, clean boot).

### Post-review: engine index landed; ORDER BY aligned (2026-07-21)

incident-engine shipped the drill-down index (decision upgraded from ADD to **REPLACE**:
`idx_error_events_fingerprint_entity_dt` now exists, the old `(fingerprint, dt DESC)` is
gone; engine `main` @ `e3acf72`). Verifying our query against it exposed a mismatch on
OUR side: `ORDER BY dt DESC NULLS LAST` didn't match the index's `DESC` (= NULLS FIRST)
ordering, so the planner fetched-all+sorted — worst-case chatty incident **214ms**
instead of the index walk. Fixed to plain `ORDER BY dt DESC` → **2.4ms** (~90×);
justified live: `dt` is never NULL (0 of 361,847 events; the engine's null-dt fallback
happens at aggregation, not in this table's ordering). SQL-contract test now asserts the
exact index-matching order and forbids `NULLS LAST`.

## Follow-Up Tasks

- Onboarding suite-health overview + legend (old Phase 19 idea) remains open roadmap.

## Commit Readiness

- Requirements implemented: yes. Read-only / least-privilege rules hold: yes
  (fail-closed-proven). Time-windowed queries partition-pruned: N/A (incidents is not
  partitioned; bounded + indexed instead). Schema assumptions confirmed live: yes.
- Validation recorded: yes. Ready to commit: yes.

---

# Phase 18 — data_acquisition Run-Log Job Type

Date:
2026-07-07 (implemented; committed 2026-07-21)

Status:
Completed

Prompt:
— (built ad-hoc from a direct user request; no prompt file, like phases 1–3)

Git Commit:
Pending

Review Artifacts:

- Self-review against `markdown/REVIEW_CHECKLIST.md`. No external handoff this phase.

## Goals

- Show data_acquisition's real per-run job type (the analog of `hhm_rpp_ge`/`GE_CT`) in
  the 12h-runs dropdown, instead of the generic "run" label — derived from the run's
  `runJob` event (`note.run_group` + `modality`/`schedule`), which is 1:1 per run.

## Built

- `db/queries.js`: `APP_RUNS_SQL` refactored into `buildAppRunsSql(withJobType)`; the
  job-type variant adds a LATERAL that extracts `run_group`/`modality`/`schedule` from the
  first `runJob` event of `verbose_log`, evaluated AFTER `ORDER BY … LIMIT` so the detoast
  is bounded to one page. The lean path is byte-for-byte unchanged.
- `server.js`: enables `withJobType` ONLY for `app === "data_acquisition"`.
- `lib/app-runs.js`: `formatJobType(runGroup, modality, schedule)` → `hhm/CT`, `mmb #3`,
  `ip_reset`…; treats the producer's JSON-string sentinels `"null"`/`"undefined"` as
  absent. `shapePage` adds `jobType` only when derivable — other apps' payloads unchanged.
- `public/index.html`: the dropdown sub-row job cell shows `↳ <jobType>` (falls back to
  `↳ run`).
- `test/app-runs.test.js`: 6 new cases (formatting, sentinel handling, jobType-only-when-
  derivable) + the SQL-contract test now proves the lean path never mentions
  `verbose_log` and the detoast exists only under the `withJobType` fragment.

## Schema Facts Confirmed (live DB)

- `verbose_log->'runJob'` events carry `note.run_group` (1:1 per run: 219/219),
  `note.modality`, `note.schedule`; inapplicable fields are stored as the JSON **string**
  `"null"`, not JSON null.
- data_acquisition `verbose_log` in staging: avg ~7.5 KB, max 22 KB.
- EXPLAIN (newest 50 in 12h): single monthly-partition Index Scan; LATERAL Function Scan
  loops = LIMIT (50); ~10 ms total.

## Important Decisions

### A deliberate, bounded exception to the Performance Rule

Decision: Read `verbose_log` on the request path — but only for data_acquisition's runs
endpoint, only via a LATERAL evaluated after ORDER BY + LIMIT (≤50 rows/page), on-demand.

Reason: The job type only exists inside `verbose_log` (the run has no argv). The
alternative source (`stats.acquisition_history` manufacturer/modality) is sparse and
multi-valued per run — it cannot yield the clean 1:1 label `run_group` does.

Tradeoff: ~10 ms per expanded page in staging; the Performance Rule's target (unbounded
detoast of large blobs) is avoided by the page cap. Re-measure if prod blobs are much
larger.

## Architecture Notes

- Read-only / least-privilege impact: none (same tables, same role).
- Query / partition-pruning impact: unchanged (`inserted_at > $2` prunes; EXPLAIN-confirmed).
- Performance impact: bounded LATERAL detoast, data_acquisition endpoint only (~10 ms/page).
- Security impact: none; params stay bound.
- Deployment impact: restart to load the new backend (done 2026-07-07).
- API compatibility: additive `jobType` field, present only when derivable.

## Validation

Commands run:

```bash
docker exec -w /workspace ops-dashboard-app-1 node --test   # 102/102 pass
# live: /api/apps/data_acquisition/runs?windowHours=12&limit=50
```

Results:

- Passed: 102/102 unit tests; live distribution over 50 runs: hhm/CT, hhm/CV, hhm/MRI,
  mmb #0–#7, ip_reset, offline_alert, philips, althea_env — every run labeled, no
  `#null` artifacts.
- Failed: none.

## Review Notes

Critical issues: none. First live pass showed `hhm/CT #null` — the producer stores
`"null"` as a JSON string; fixed in `formatJobType` with sentinel handling + tests.

## Follow-Up Tasks

- The full run-log view (`#appruns=data_acquisition`) does not yet show the job-type
  column the dropdown shows; the endpoint already returns it (~10-line frontend add).

## Commit Readiness

- Requirements implemented: yes. Read-only rules hold: yes. Partition-pruned: yes.
- Schema assumptions confirmed live: yes. Validation recorded: yes. Ready to commit: yes.

---

# Phase 17 — Per-System (Equipment) Correlation View

Date:
2026-07-01

Status:
Completed

Prompt:
`prompts/prompt_17_per_system_view.txt`

Git Commit:
Pending

Review Artifacts:

- Self-review against `markdown/REVIEW_CHECKLIST.md` (below). No external handoff this phase.

## Goals

- Pivot the dashboard from per-app to per-equipment-system: the same `note.sme` raises
  issues across multiple apps (the pull in `data_acquisition`, the parse in `hhm_rpp_*`),
  and only a cross-app view shows a system's whole story / root cause vs. downstream noise.
- Do it read-only, as insight for a human — no write-back to the monitored apps.
- Land the correlation backbone that Phases 18 (trends) and 20 (insights) will reuse.

## Built

- `db/queries.js`: `SYSTEMS_LATEST_SQL` + `systemsLatest(since, limit)` (per-`sme`
  cross-app warn/error rollup, worst-first, LIMIT-capped) and `SYSTEM_DETAIL_SQL` +
  `systemDetail(id, since)` (one system by `(app, type, func)` with the latest `run_id`
  per group for drill-down). Both `warn_error_logs`-only, partition-pruned; the detail
  `sme` is a bound `$1` param.
- `lib/systems.js` (pure) + `test/systems.test.js`: `shapeSystems`, `summarize`
  (incl. `crossApp` count), `shapeDetail`, `pickSystem` (reuses decorated connectivity
  for the classified `error_category`), plus SQL-text guards.
- `server.js`: `GET /api/systems` (clamp `SYSTEMS_WINDOW_HOURS`, 1..168) and
  `GET /api/systems/:id` (id validated via `SYSTEM_ID_RE`; joins `alert.*` connectivity).
- `public/index.html`: `#systems` list + `#system=<id>` detail routed views, a top-nav
  "systems" link, and the connectivity/acquisition tables now link each system id into
  the detail view. Introduced `hideAllViews()` to replace the per-function hide blocks
  (7 views now) — a behavior-preserving cleanup that removes the stale-sibling risk.
- Config: `SYSTEMS_WINDOW_HOURS` in `.env.example` + `markdown/ENVIRONMENT.md`.

## Schema Facts Confirmed (live DB)

- `util.app_run_logs.warn_error_logs` and `verbose_log` are `json` (NOT `jsonb`) → use
  `json_array_elements` / `->`/`->>`, no jsonb operators.
- System key is `note.sme` ONLY; `note.system.id` is never populated (0/166k in 7d) — no
  fallback added.
- `error_category` is NOT reliably in the run-log note (625/166k events; only value in 7d
  was `hanging_exec`); the real enum lives in `alert.*` → detail joins connectivity for it,
  and uses `func` as the in-log axis.
- Cross-app correlation is real: 18 systems raised issues in >1 app in the 24h window.
- Partition pruning confirmed via `EXPLAIN` on the final `SYSTEMS_LATEST_SQL` (Index Scan
  on `app_run_logs_2026_06_inserted_at_idx`; no `verbose_log`).

## Important Decisions

### Correlate by `note.sme`, classify from `alert.*` (not the run-log note)

Decision: pivot on `note.sme`; take `func` as the in-log grouping axis and the classified
`error_category` from the `alert.*` connectivity rows.

Reason: live verification showed `error_category` is essentially absent from the run-log
note but present/curated in `alert.*` (already read by `/api/connectivity`).

Tradeoff: the in-log breakdown groups by `func` (coarser than the ~40-category enum), but
the detail view still surfaces the true category via the joined connectivity state.

### Request-path direct, window clamped 1..168h

Decision: serve both endpoints directly (no cache), default 24h, clamp max 168h.

Reason: `warn_error_logs`-only (no `verbose_log` detoast); 24h ≈ 150ms (like acq/
connectivity). 7d ≈ 2.2s is the slow ceiling, so the clamp keeps the worst case bounded.

Tradeoff: very long windows are slower than the cached grid, but they are opt-in and
bounded; no new write/summary surface introduced.

## Architecture Notes

- Read-only / least-privilege impact: none new — reads `util` (granted) + `alert`
  (granted Phase 10). No new grant, no `setup-readonly-role.sql` change, no deploy grant
  step. No code path can write.
- Query / partition-pruning impact: both queries filter `inserted_at > $`; EXPLAIN
  confirms the monthly-partition index scan; no `verbose_log`.
- Performance impact: request-path ~150ms at the 24h default; clamp bounds the worst case.
- Security impact: `:id` validated (`/^[A-Za-z0-9_-]{1,64}$/`, 400 otherwise); `sme` bound
  as a query param, never interpolated; DB errors surface as the shared sanitized 500.
- Deployment impact: restart to pick up the new routes; no grant/schema/index change.
- API / response-shape compatibility impact: additive only (two new endpoints + a new env
  var); existing endpoints unchanged.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test        # 98 pass (7 new)
docker exec -i ops-dashboard-app-1 node - < smoke.js           # ephemeral :18099 HTTP smoke
docker exec -i ops-dashboard-app-1 node - < explain.js         # EXPLAIN partition prune
```

Results:

- Passed: unit suite 98/98; live smoke; EXPLAIN partition-pruned; no `verbose_log`.
- Failed: none.
- Not run: multi-instance/durability (out of scope).

Manual / smoke tests:

- `GET /api/systems?windowHours=24` → 226 systems worst-first; summary `crossApp=18`.
- `GET /api/systems/SME02524` (cross-app) → connectivity `OFFLINE / host_unreachable`
  (HHM+MMB) alongside `data_acquisition` ERROR `execRsync` ×84 and downstream
  `hhm_rpp_ge` WARN — a network root cause, not a parser bug (the intended payoff).
- Invalid id → 400; `windowHours=99999` clamps to 168.

## Review Notes

Source: self-review against `markdown/REVIEW_CHECKLIST.md` + external Codex review against
`notes/review_handoff_phase_17.md`.

Critical issues:

- None. Codex: **no findings**. It confirmed the SQL is window-bounded on `inserted_at`,
  unnests only `warn_error_logs` (no `verbose_log`), keeps the system id bound as `$1`; the
  `/api/systems/:id` path validates before querying; DB errors flow through the sanitized
  shared handler; and `hideAllViews()` covers all routed views with the `runReq` guards
  preserved.
- Codex could not run the test suite (its environment lacked `node`/`npm`). Not a
  finding — the suite was validated here via the container node runner (98/98).

Accepted fixes:

- None.

Deferred findings:

- The in-log breakdown axis is `func`, not the classified `error_category` (which is
  sparse in the run log). Consistent classification in the run log would require changes
  in the monitored apps — deliberately out of scope (read-only); Phase 18 surfaces the gap.

## Problems Encountered

- Problem: the approved plan assumed `error_category` (~40 categories) was richly present
  in `warn_error_logs` and `note.system.id` was a valid key.
  Resolution: live verification disproved both; redesigned to `note.sme` + `func` + an
  `alert.*` join, and recorded the corrected facts in the prompt and this log.

## Follow-Up Tasks

- Phase 18 — error-category analytics & trends (sources classified categories from
  `alert.*`, surfaces an "unclassified" bucket for the run-log/parser side).
- Phase 20 — actionable insights (error → owner/action mapping over this correlation).

## Commit Readiness

- Requirements implemented: yes.
- Read-only / least-privilege rules hold: yes (no new grant; no write path).
- Time-windowed queries partition-pruned: yes (EXPLAIN-confirmed).
- Schema assumptions confirmed live: yes.
- Review findings addressed or deferred: yes.
- Validation recorded: yes.
- Ready to commit: yes (awaiting the developer's go — not committed).

---

# Phase 16 — data_acquisition Inline Run Expansion

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_16_da_inline_runs.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_16.md`

## Goals

- Let the single data_acquisition grid row expand inline to its distinct run_ids from
  the last 12h (lazy, capped newest 50, "see all" → run-log) — surfacing the per-run
  dimension the "(default)" row hides, without a separate page.

## Built

- `public/index.html` only: a "▸ 12h runs" toggle on the data_acquisition `(default)`
  row (grouped by app); on expand it fetches
  `/api/apps/data_acquisition/runs?windowHours=12&limit=50` (the Phase 11 endpoint) and
  injects the runs as indented sub-rows (Status / Last run / Age / Issues / Run id →
  drill-down with the `at=` hint; Duration "—"); a "see all in run log ›" sub-row when
  capped (`nextBefore`). State `daRuns`; refetches on each expand; resilient inline note
  on failure; text via `textContent`. CSS `.subrun`/`.lead`.

## Schema Facts Confirmed (live DB)

- None new. `/api/apps/data_acquisition/runs?windowHours=12&limit=50` returns 50 newest
  + `nextBefore` (so the "see all" link shows); ~550 runs exist in 12h.

## Important Decisions

### Reuse the Phase 11 endpoint; frontend-only

Decision: surface a capped inline slice via the existing run-log endpoint rather than
special-casing the grid cache/query to key data_acquisition by run_id.

Reason: keeps the grid's latest-per-(app,job) model + in-process cache intact and adds
no backend/query/grant; the run-log already serves exactly this data.

Tradeoff: the inline peek is capped (50) and links out to the full run-log for the
rest, rather than rendering all ~550 rows in the grid.

## Architecture Notes

- Read-only / least-privilege impact: none (reuses an existing read-only endpoint).
- Query / partition-pruning impact: none (no new query).
- Performance impact: lazy (fetch only on expand); the grid request/cache untouched.
- Security impact: run text via `textContent`; sub-rows drill down with the `at=` hint.
- Deployment impact: none — frontend bind-mounted; no restart, env, grant, or schema.
- API / response-shape compatibility impact: none (no API change).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 91/91 (no logic files changed)
node --check (inline index.html script)                   # ok
curl /api/apps/data_acquisition/runs?windowHours=12&limit=50  # 50 + nextBefore
```

Results:

- Passed: 91/91; inline script parses; served page exposes the toggle.
- Failed: none.
- Not run: none.

Manual / smoke tests:

- Endpoint returns the 12h/50 slice with `nextBefore` set (newest runs mostly ERROR).
- Browser-interactive expand/collapse rests on the syntax check + the (already
  reviewed) Phase 11 endpoint; recommend an eyeball pass.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_16.md`. `node --test` 91/91 +
  inline script syntax check.

Critical issues:

- None. Codex confirmed: the toggle is scoped to data_acquisition/(default) while
  grouped by app; the lazy fetch reuses the Phase 11 endpoint; failures render an
  inline note without breaking the grid; sub-run links preserve the `at=` hint via
  `runHref(r.runId, r.insertedAt)`; rendering uses DOM/text APIs (no new innerHTML).

Accepted fixes:

- None.

Deferred findings:

- None.

## Problems Encountered

- Problem (user feedback, post-merge): the expanded dropdown repeated the run_id
  already shown on the `(default)` row — the parent's latest run is also the newest
  entry in the list, so it appeared twice. (The list itself is distinct; util has one
  row per run_id.)
  Resolution (final design): the `(default)` summary row no longer claims a single
  run_id — its Run id cell IS the "▸ 12h runs" toggle — so the dropdown is the sole,
  authoritative list of distinct runs (one of each), with no parent/child overlap.
  (An interim fix that merely excluded the parent's id from the list was superseded by
  this.) Frontend only; 91/91 still green.

## Follow-Up Tasks

- Optional: a per-run drill-down link from the per-system view (Phase 15) — still
  deferred.

## Commit Readiness

- Requirements implemented: yes (lazy capped inline expansion + see-all).
- Read-only / least-privilege rules hold: yes (reuses an existing endpoint).
- Time-windowed queries partition-pruned: n/a (no new query).
- Schema assumptions confirmed live: yes (endpoint slice shape).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (91/91 + endpoint smoke).
- Ready to commit: yes.

---

# Phase 15 — Per-System Acquisition History

Date:
2026-06-29

Status:
Completed (grant applied; live smoke passed 2026-06-29)

Prompt:
`prompts/prompt_15_acquisition_systems.txt`

Git Commit:
9bc7029

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_15.md`

## Goals

- Give data_acquisition the per-system / per-source breakdown its single orchestrator
  grid row can't show (one run spans ~20 systems): a routed view with per-`system_id`
  runs/failed over a window + a per-source (hhm/mmb) rollup, from the purpose-built
  history table. Read-only.

## Built

- `db/setup-readonly-role.sql`: `USAGE ON SCHEMA stats` + `SELECT ON
  stats.acquisition_history` — the third read outside `util` — applied fail-closed
  (REVOKE + GRANT + verify `DO` block) like the Phase 10 alert grant.
- `db/queries.js`: `ACQ_SYSTEMS_SQL` + `acquisitionSystems()`. Per
  `(system_id, data_source)` over `inserted_at > $1`: runs, failed (NOT
  successful_acquisition), max(modality/manufacturer), max(inserted_at) ISO last_seen;
  ORDER BY failed DESC. No verbose_log, no join.
- `lib/acq.js` (pure): `shapeSystems` + `summarizeBySource`. `test/acq.test.js` +5
  (91 total) incl. a SQL guard.
- `server.js`: `GET /api/acquisition/systems` (clamped window, default
  `ACQ_WINDOW_HOURS`=24) → `{windowHours, asOf, count, bySource, systems}`.
- `public/index.html`: routed `#acq-systems` view via the data_acquisition group
  header "systems ›"; per-source rollup + worst-first per-system table.
- Docs: ARCHITECTURE_PRINCIPLES (3rd grant + fail-closed), DEPLOYMENT, `.env.example`,
  ENVIRONMENT (`ACQ_WINDOW_HOURS`).

## Schema Facts Confirmed (live DB)

- `stats.acquisition_history`: ~447k rows, NOT partitioned, BRIN on `inserted_at` +
  `(system_id, inserted_at DESC)` btree. `EXPLAIN` of the windowed aggregate uses the
  BRIN (`Bitmap Index Scan on idx_acq_hist_inserted_brin`), not a full scan; no
  verbose_log.
- 24h: ~18k rows, 333 systems, ~7k failed (~39%); `system_id`/`data_source` always
  present, `modality`/`manufacturer` ~82% blank (so per-system axis + source rollup).

## Important Decisions

### Per-(system, data_source) axis; modality is a column

Decision: group by `(system_id, data_source)`; show modality/manufacturer as (sparse)
columns; roll up by source (hhm/mmb).

Reason: system_id and data_source are always populated; modality is blank ~82% of the
time, so it can't be the axis.

Tradeoff: a system that does both hhm and mmb appears as two rows — informative, not a
bug.

### Bounded by BRIN, not partitioning; not cached

Decision: a direct request-path query bounded by `inserted_at` via the BRIN index, not
cached.

Reason: the table isn't partitioned, but the BRIN makes a windowed scan cheap; result
is bounded by system count (~333). Same direct-query posture as connectivity/run-log.

## Architecture Notes

- Read-only / least-privilege impact: EXPANDS the RO role to a third schema (`stats`),
  SELECT on exactly `stats.acquisition_history`, fail-closed/verified. No writes.
- Query / partition-pruning impact: table unpartitioned; windowed scan BRIN-bounded
  (EXPLAIN-confirmed); no verbose_log, no join.
- Performance impact: bounded request-path aggregate (~18k rows scanned in 24h ->
  ~333 groups); not cached.
- Security impact: missing grant -> sanitized 500; window clamped; text via textContent.
- Deployment impact: **two-step** — apply the `stats` grant (superuser) + restart, else
  `/api/acquisition/systems` 500s.
- API / response-shape compatibility impact: additive (`/api/acquisition/systems` new).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 91/91
EXPLAIN ACQ_SYSTEMS_SQL                                    # BRIN bitmap scan, no full scan, no verbose_log
```

Results:

- Passed: 91/91 (86 prior + 5 new `acq`); all changed files parse.
- Failed: none.
- Not run: none.

Live deploy + smoke (2026-06-29, after the operator applied the `stats` grant as the
`postgres` superuser and `docker compose restart`):

- Grant landed: `ops_dashboard_ro` now reads `stats.acquisition_history` (490,290 rows).
- `GET /api/acquisition/systems` → 377 system/source rows, worst-first (top entries
  fully-failed hhm systems, 48/48). Rollup: hhm 5589/8940 failed across 187 systems,
  mmb 1420/9167 across 190. windowHours 24.
- No regression: `/healthz`, `/api/jobs/latest` (warmed to 200), `/api/connectivity`,
  `/api/apps/:app/runs` all 200.

Manual / smoke tests:

- EXPLAIN confirmed BRIN-bounded windowed aggregate (no 447k full scan, no verbose_log).
- Inline `index.html` passes `node --check`.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_15.md` (source-level + unit suite;
  live EXPLAIN not re-run — the live smoke is already recorded above). `node --test` 91/91.

Critical issues:

- None. Codex confirmed: the `stats` grant is fail-closed and verifies effective
  privileges; `ACQ_SYSTEMS_SQL` is `inserted_at`-bounded, reads only
  `stats.acquisition_history`, no join, no `verbose_log`; the endpoint uses the shared
  sanitized error handler; the UI renders via text nodes with `runReq` guarding.

Accepted fixes:

- None.

Deferred findings:

- None.

## Problems Encountered

- None.

## Follow-Up Tasks

- Done: `stats` grant applied + restart + live `/api/acquisition/systems` smoke
  (recorded above, 2026-06-29).
- Optional (deferred): a per-run drill-down link from a system's row into the specific
  `util.app_run_logs` run (`run_id` is available in the table).

## Commit Readiness

- Requirements implemented: yes (grant, query, lib, endpoint, view, docs).
- Read-only / least-privilege rules hold: yes (SELECT-only third grant, fail-closed).
- Time-windowed queries partition-pruned: BRIN-bounded (table unpartitioned); confirmed.
- Schema assumptions confirmed live: yes (plan, volume, field coverage).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (91/91 + EXPLAIN + live smoke passed post-grant).
- Ready to commit: yes (shipped; grant applied and smoke green 2026-06-29).

---

# Phase 14 — Connectivity Polish

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_14_connectivity_polish.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_14.md`

## Goals

- Tie the connectivity panel into the grid (a rollup badge on the data_acquisition
  row, linking to #connectivity) and add a refresh control to the connectivity view.
  Additive, read-only, no new query.

## Built

- `lib/connectivity.js`: pure `rollup(systems)` -> `{hhm:{offline,total},
  mmb:{offline,total}}`. `test/connectivity.test.js` +2 (86 total).
- `server.js`: `/api/connectivity` now also returns `rollup` (from the same decorated
  systems; no new query).
- `public/index.html`: dashboard `refresh()` also calls a resilient `loadConnRollup()`
  (failure keeps last-good, repaints the grid when counts arrive); the data_acquisition
  app group header shows a "conn: HHM x / MMB y off" badge (ERROR-red if any offline)
  linking to `#connectivity`; the connectivity view gets a refresh button.

## Schema Facts Confirmed (live DB)

- `/api/connectivity` rollup live: HHM 106/284 offline, MMB 33/255 offline (139 total).
  Reuses the Phase 10 decorate/sort; no new DB work.

## Important Decisions

### Rollup is client-fed from the existing connectivity payload

Decision: compute the rollup server-side as an additive field on `/api/connectivity`
and render the grid badge from it client-side — no backend join, no grid/cache change.

Reason: matches the Phase 9 "summary from the existing payload" precedent; keeps the
grid path and cache untouched and the change small/revertible.

Tradeoff: the dashboard makes one extra (cheap, ~70ms) connectivity fetch per refresh.

## Architecture Notes

- Read-only / least-privilege impact: read-only; no new grant/query.
- Query / partition-pruning impact: none (reuses `/api/connectivity`).
- Performance impact: one extra cheap fetch per dashboard refresh; resilient to failure.
- Security impact: badge is an `<a>` with `stopPropagation`; text via DOM APIs.
- Deployment impact: `docker compose restart` to load the server field (done); no
  env/grant/schema change.
- API / response-shape compatibility impact: additive (`rollup` on `/api/connectivity`).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 86/86
curl /api/connectivity                                    # rollup present
```

Results:

- Passed: 86/86 (84 prior + 2 new `rollup`).
- Failed: none.
- Not run: none.

Manual / smoke tests:

- `/api/connectivity` carries `rollup` (HHM 106/284, MMB 33/255 offline); grid warms
  to 200 with `appHealth` intact; regression on healthz/errors/run-log all 200.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_14.md` (source-level + unit suite;
  live EXPLAIN not re-run). `node --test` 86/86.

Critical issues:

- None. Codex confirmed: the rollup is derived from the existing `/api/connectivity`
  payload (no backend join); `loadConnRollup()` failures are swallowed with last-good
  preserved; the badge link uses `stopPropagation()`.

Accepted fixes:

- None.

Deferred findings:

- None.

## Problems Encountered

- None.

## Follow-Up Tasks

- Remaining deferred (PROMPTS "Not decided yet"): auth (if exposure changes), durable
  DB summary table (at scale), `stats.acquisition_history` per-run correlation,
  per-(app, job) recent health.

## Commit Readiness

- Requirements implemented: yes (rollup badge + connectivity refresh).
- Read-only / least-privilege rules hold: yes (no new grant/query).
- Time-windowed queries partition-pruned: n/a (no new query).
- Schema assumptions confirmed live: yes (rollup counts).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (86/86 + live).
- Ready to commit: yes.

---

# Phase 13 — Run-Log Status Filter

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_13_runlog_errors_filter.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_13.md`

## Goals

- Let the per-app run-log show only the runs that matter (errors / issues), so a noisy
  app like data_acquisition (~87% error) is filterable. Server-side, composing with
  the keyset pagination.

## Built

- `lib/app-runs.js`: `normalizeStatusFilter(raw)` -> `all|error|issues` (+ exported
  `STATUS_FILTERS`).
- `db/queries.js`: `APP_RUNS_SQL` gains a narrowing predicate on a bound enum `$6`
  (`all` no-op; `error` = EXISTS ERROR; `issues` = EXISTS ERROR|WARN) over
  `warn_error_logs`. `appRuns()` takes `statusFilter` (default "all").
- `server.js`: `?status=` normalized + passed + echoed in the response.
- `public/index.html`: All / Issues / Errors buttons in `#appruns`; change resets to
  page 1; `appRunsState.status` threads through `appRunsUrl` so "load more" stays in
  the filter.
- `test/app-runs.test.js`: +1 (`normalizeStatusFilter`) + SQL guard now asserts the
  `$6` enum predicate. 84 total.

## Schema Facts Confirmed (live DB)

- Filter discriminates correctly: `hhm_rpp_ge` (24h: 0 errored, 144 warned) -> all &
  issues = 144 (all WARN), error = 0. `data_acquisition?status=error` paginates with
  page 2 still all-ERROR and strictly older. EXISTS over warn_error_logs only.

## Important Decisions

### Bound enum predicate, not interpolation

Decision: the filter is a single bound parameter (`$6`) normalized server-side to one
of three literals; the SQL switches on it with `OR`.

Reason: no string interpolation (injection-safe), and it stays one query/template so
keyset pagination is provably unchanged (the predicate only narrows `WHERE`).

Tradeoff: the planner sees all three branches; negligible at this scale, and the
EXISTS is warn_error_logs-only.

## Architecture Notes

- Read-only / least-privilege impact: read-only; no new grant.
- Query / partition-pruning impact: unchanged (still `inserted_at > $2`); predicate is
  warn_error_logs-only (no `verbose_log`).
- Performance impact: a narrowing EXISTS; keyset/LIMIT unchanged.
- Security impact: bound enum param; normalized; no interpolation.
- Deployment impact: needs `docker compose restart` (done); no env/grant/schema change.
- API / response-shape compatibility impact: additive (`status` echoed; new optional
  `?status` param).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test    # 84/84
curl /api/apps/hhm_rpp_ge/runs?status=all|issues|error     # 144 / 144 / 0
curl /api/apps/data_acquisition/runs?status=error (+cursor) # page 2 all-ERROR, older
```

Results:

- Passed: 84/84 (83 prior + 1 new).
- Failed: none.
- Not run: none.

Manual / smoke tests:

- Filter discriminates (ge: error=0, issues/all=144 WARN); error filter paginates
  gap/dup-free and stays all-ERROR; default unchanged.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_13.md` (source-level + unit suite).
  `node --test` 86/86.

Critical issues:

- None. Codex confirmed: the status filter is normalized server-side and passed as a
  bound `$6`; all/error/issues semantics are correct; the keyset pagination/cursor
  order is unchanged.

Accepted fixes:

- None.

Deferred findings:

- None.

## Problems Encountered

- None.

## Follow-Up Tasks

- Phase 14 (connectivity rollup + refresh) — prompt authored.

## Commit Readiness

- Requirements implemented: yes (server-side enum filter + UI).
- Read-only / least-privilege rules hold: yes.
- Time-windowed queries partition-pruned: yes (unchanged).
- Schema assumptions confirmed live: yes (discrimination + pagination).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (84/84 + live).
- Ready to commit: yes.

---

# Phase 12 — Grid Recent-Run Health

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_12_grid_recent_health.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_12.md`

## Goals

- Stop the grid misrepresenting high-frequency single-bucket apps: show a per-APP
  recent-run health summary (runs/errored/warned over ~24h) on the app group header,
  so data_acquisition's one-latest-run status isn't mistaken for the app's health.

## Built

- `db/queries.js`: `APP_HEALTH_SQL` + `appHealth(sinceIso)` — per-app counts (runs,
  errored, warned) from `warn_error_logs` only, `WHERE inserted_at > $1` (partition
  prune), `GROUP BY app_name`. No `verbose_log`.
- `server.js`: computes it in `refreshOnce()` on the grid timer (window
  `APP_HEALTH_WINDOW_HOURS`, default 24) in its own try/catch (failure keeps last-good,
  never blanks the grid); adds `appHealth` + `appHealthWindowHours` to
  `/api/jobs/latest` additively.
- `public/grid-view.js`: pure `healthLabel(h, windowHours)`; `test/grid-view.test.js`
  +3 (83 total).
- `public/index.html`: app group header renders the label as an ERROR/SUCCESS badge,
  degrading to nothing when an app has no entry.
- Config: `APP_HEALTH_WINDOW_HOURS` in `.env.example` + `markdown/ENVIRONMENT.md`.

## Schema Facts Confirmed (live DB)

- `EXPLAIN`: HashAggregate over a single-partition Index Scan
  (`app_run_logs_2026_06_inserted_at_idx`, `inserted_at >` cond); no `verbose_log`.
- Live 24h health: data_acquisition runs=1104 errored=959 warned=674 (~87% error);
  hhm_rpp_philips 528/816 errored; hhm_rpp_ge 144 runs, 0 err / 144 warn;
  ops-dashboard clean. Matches the grid's warn_error_logs status rule.

## Important Decisions

### Per-APP aggregate (not per-(app, job))

Decision: aggregate health by `app_name` only and show it on the app group header.

Reason: a per-(app, job) aggregate needs the job, which comes from
`verbose_log->argv` — reading `verbose_log` detoasts it (data_acquisition's is large).
Per-app from `warn_error_logs` is detoast-free and cheap; the group header is the
natural app-level home.

Tradeoff: multi-job apps (hhm_rpp_*) show one app-level number across their jobs
rather than per job. Accepted; per-(app, job) is recorded as deferred.

## Architecture Notes

- Read-only / least-privilege impact: read-only; no new grant (SELECT on
  util.app_run_logs already held); no writes.
- Query / partition-pruning impact: `inserted_at > $1` prunes; never reads
  `verbose_log`; computed on the refresh timer, off the request path.
- Performance (request-path latency) impact: grid still served from cache; the
  aggregate is a cheap background query; a failure keeps last-good and doesn't blank
  the grid.
- Security impact: additive read-only field; no new input.
- Deployment impact: needs a `docker compose restart` to load the server change
  (done); one new optional env var with a safe default.
- API / response-shape compatibility impact: additive (`appHealth`,
  `appHealthWindowHours`).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 83/83
EXPLAIN APP_HEALTH_SQL                                     # single-partition index scan, no verbose_log
curl /api/jobs/latest                                     # appHealth present, grid intact
```

Results:

- Passed: 83/83 (80 prior + 3 new `healthLabel`).
- Failed: none.
- Not run: none.

Manual / smoke tests:

- `/api/jobs/latest` → `appHealth` populated (data_acquisition 959/1104 errored),
  `appHealthWindowHours: 24`, 24 jobs still served from cache.
- EXPLAIN confirmed partition prune + no verbose_log.
- Regression: `/healthz`, `/api/errors`, `/api/connectivity`, `/api/apps/:app/runs`
  all 200.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_12.md` (source-level + unit suite).
  `node --test` 86/86.

Critical issues:

- None. Codex confirmed: `APP_HEALTH_SQL` is warn_error_logs-only and partition-pruned
  (`inserted_at > $1`), and the health refresh is isolated in its own try/catch so a
  failure keeps last-good and never blanks the grid.

Accepted fixes:

- None.

Deferred findings:

- None.

## Problems Encountered

- None.

## Follow-Up Tasks

- Phase 13 (run-log status filter) and Phase 14 (connectivity rollup + refresh) —
  prompts authored.

## Commit Readiness

- Requirements implemented: yes (per-app aggregate + group-header health).
- Read-only / least-privilege rules hold: yes (no new grant).
- Time-windowed queries partition-pruned: yes (EXPLAIN-confirmed).
- Schema assumptions confirmed live: yes (plan + counts + status parity).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (83/83 + EXPLAIN + live).
- Ready to commit: yes.

---

# Phase 11 — Per-App Run History

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_11_app_run_history.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_11.md`

## Goals

- Make high-frequency, single-bucket apps inspectable: an on-demand, paginated
  per-app run-log (every run_id in a window, default 24h) so `data_acquisition` —
  which the grid collapses to one arbitrary `(default)` run — can be seen in full.

## Built

- `db/queries.js`: `APP_RUNS_SQL` + `appRuns()`. Lean — status/issue_count from
  `warn_error_logs` only (no `verbose_log` detoast); `inserted_at` emitted as a
  full-microsecond ISO string (`to_char(... 'US' ...)`). Filters `app_name=$1` and
  `inserted_at>$2` (partition prune); keyset `(inserted_at, run_id) < ($3,$4)`;
  `ORDER BY inserted_at DESC, run_id DESC LIMIT $5`.
- `lib/app-runs.js` (server-only, pure): `clampInt` (blank/absent -> default; note
  `Number("")===0`) and `shapePage` (row mapping + next keyset cursor).
- `server.js`: `GET /api/apps/:app/runs?windowHours&limit&before&beforeId` ->
  `{app, windowHours, count, runs[], nextBefore, nextBeforeId}`. Window clamped
  1..720h, limit 1..500; cursor validated; errors via the shared sanitized handler.
- `public/index.html`: routed `#appruns=<app>` view reached from the Phase 8 app
  group-head ("run log ›"); "load more" via the keyset cursor; each run links to the
  drill-down with the `inserted_at` hint; text via `textContent`; `runReq` guard.
- `test/app-runs.test.js`: +8 (clamp, shapePage, DB-free `APP_RUNS_SQL` shape guard).
  80 total. Config: `APP_RUNS_LOOKBACK_HOURS` (24), `APP_RUNS_LIMIT` (200) in
  `.env.example` + `markdown/ENVIRONMENT.md`.

## Schema Facts Confirmed (live DB)

- `EXPLAIN` (as ops_dashboard_ro): single-partition **Index Scan** on
  `app_run_logs_2026_06_inserted_at_idx` with `Index Cond: inserted_at > …` and an
  `app_name` filter — partition pruned, no full scan, no `verbose_log` touched.
- Per-app 24h volume (sizes the default cap): data_acquisition 1104, hhm_rpp_philips
  816, ops-dashboard 288, hhm_rpp_ge 144.
- `warn_error_logs` ERROR>WARN>SUCCESS status matches `JOBS_LATEST_SQL`.

## Important Decisions

### Full-microsecond cursor, keyset (not OFFSET)

Decision: `inserted_at` is emitted as a 6-digit-fractional ISO string and the cursor
is `(inserted_at, run_id)`; "load more" passes the last row's pair back as
`before`/`beforeId`.

Reason: data_acquisition fires sub-second, so multiple runs share a millisecond. A JS
`Date` cursor truncates to ms and would silently DROP rows between the truncated and
true value; OFFSET would shift as new runs arrive at the top. Keyset on the exact
(µs, run_id) is gap/dup-free and stable. Verified live across a page boundary.

### Direct query, not cached

Decision: served by a direct partition-pruned query, not the in-process cache.

Reason: the cache holds one row per (app, job) by design; run history is unbounded.
The query is cheap (single-partition index scan, warn_error_logs only), so a bounded
(window + limit) request-path query is the right tool.

## Architecture Notes

- Read-only / least-privilege impact: new read-only query; **no new grant** (role
  already has SELECT on util.app_run_logs); no writes/DDL.
- Query / partition-pruning impact: `inserted_at > $2` prunes to the month
  partition(s) (EXPLAIN-confirmed); never reads `verbose_log`.
- Performance (request-path latency) impact: single-partition index scan, sub-second;
  off the grid-cache path; bounded by window + limit.
- Security impact: `:app` parameterized ($1); window/limit clamped; cursor validated
  (bad uuid -> 400); shared sanitized 500; view renders via `textContent`.
- Deployment impact: needs a `docker compose restart` to load the new route (done);
  two new optional env vars with safe defaults; no grant/schema change.
- API / response-shape compatibility impact: additive (`/api/apps/:app/runs` is new).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test           # 80/80
# live (running container, after docker compose restart):
EXPLAIN APP_RUNS_SQL                                              # single-partition index scan
curl /api/apps/data_acquisition/runs?limit=5                     # page 1
curl /api/apps/data_acquisition/runs?...&before=…&beforeId=…     # page 2 (keyset)
```

Results:

- Passed: 80/80 unit tests (72 prior + 8 new).
- Failed: none.
- Not run: none.

Manual / smoke tests:

- Page 1 newest-first with full-µs cursor; page 2 via cursor continued strictly older
  (14:48:06.9 < 14:48:10.4) with no dupes/gaps across sub-second runs.
- EXPLAIN: pruned to `app_run_logs_2026_06`, index scan on inserted_at, no verbose_log.
- A run-log row drilled down (data_acquisition/(default), 261 events) via the hint.
- Bad `beforeId` -> 400; grid / errors / connectivity / `/healthz` all still 200.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_11.md` (source-level + unit suite;
  live EXPLAIN not re-run by the reviewer). `node --test` 80/80.

Critical issues:

- None. Codex confirmed: APP_RUNS_SQL is parameterized, partition-pruned on
  `inserted_at > $2`, avoids `verbose_log`, returns a full-microsecond cursor, and
  keysets on `(inserted_at, run_id) < (...)` with matching DESC order; the endpoint
  clamps window/limit, validates cursor halves and ignores partial cursors; the UI
  preserves the cursor string, renders via text nodes, and drills down with the
  `inserted_at` hint.

Accepted fixes:

- None (one self-caught during dev: `clampInt("")` must be the default since
  `Number("")===0`; handled + tested).

Deferred findings:

- None.

## Problems Encountered

- Problem: a JS `Date` cursor truncates `inserted_at` to ms and would drop sub-second
  runs at the page boundary.
  Resolution: emit `inserted_at` as a full-microsecond ISO string from SQL and keyset
  on `(inserted_at, run_id)`; verified gap/dup-free across a boundary.

## Follow-Up Tasks

- Optional (deferred, called out in the prompt): per-run duration/job (would detoast
  verbose_log); a server-side "errors only" filter (high value for data_acquisition,
  ~87% of runs error); per-(app, job) history.

## Commit Readiness

- Requirements implemented: yes (lean query, keyset pagination, endpoint, view, tests).
- Read-only / least-privilege rules hold: yes (no new grant; read-only).
- Time-windowed queries partition-pruned: yes (EXPLAIN-confirmed).
- Schema assumptions confirmed live: yes (plan, volume, status parity).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (80/80 + EXPLAIN + live pagination/drill-down/regression).
- Ready to commit: yes.

---

# Phase 10 — Connectivity Panel

Date:
2026-06-29

Status:
Completed (grant applied; live smoke passed 2026-06-29)

Prompt:
`prompts/prompt_10_connectivity_panel.txt`

Git Commit:
469184b (impl) · cdbe51f (review fix)

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_10.md`

## Goals

- Surface each equipment system's latest connectivity state (offline-first) across
  the HHM (SSH) and MMB (rsync) sources — the per-system detail the
  `data_acquisition/(default)` grid bucket hides — read-only, in a dedicated view.

## Built

- `db/setup-readonly-role.sql`: grants `USAGE ON SCHEMA alert` + `SELECT` on exactly
  `alert.offline_hhm_conn` and `alert.offline_mmb_conn` to `ops_dashboard_ro` (the
  first read outside `util`). Idempotent; header revised; sanity-check comments added.
- `db/queries.js`: `CONNECTIVITY_SQL` (`UNION ALL` of the two tables, labeled by
  `source`) + `connectivity()`. No `inserted_at` filter and no cache (justified below).
- `lib/connectivity.js` (server-only, pure; mirrors `lib/runs.js`): `connStatus`
  (false→OFFLINE / true→ONLINE / null→UNKNOWN), `captureAgeMs`/`checkedAgeMs`,
  `sortConnectivity` (worst-first → oldest-capture → system_id), `decorate`.
- `test/connectivity.test.js`: +11 tests (72 total).
- `server.js`: `GET /api/connectivity` → `{asOf, count, systems}`; thin handler,
  errors via the shared sanitizing handler.
- `public/index.html`: routed `#connectivity` view + header nav link; OFFLINE rows on
  top with the `.row-ERROR` tint; columns Source / System / Status / Error / Phase /
  Detail / Data age / Last checked / Host int. Reuses `fmtAge`/`fmtTime`/`cell`, the
  badge CSS, and the `runReq` stale-fetch guard.
- Docs: `ARCHITECTURE_PRINCIPLES.md` (grants, product identity, second contract),
  `docs/connectivity-schema.md` (new), `docs/apps-suite.md`, `DEPLOYMENT.md`.

## Schema Facts Confirmed (live DB)

- As `ops_dashboard_ro` today, `SELECT` on both `alert.*` tables raises
  `permission denied for schema alert` — confirming the grant is required.
- Table shape (live inspection, DB `staging`, 2026-06): PK `system_id varchar(8)`,
  columns `capture_datetime`/`inserted_at` (timestamptz), `successful_acquisition`
  (bool), `host_intervention` (bool), `connection_error` (text), `error_category`
  (varchar), `phase` (varchar); HHM also has `rpp_host_datetime`/`daily_total_history`.
  Upsert => one row per `system_id`; PK index only; not partitioned; no json columns.

## Important Decisions

### Request-path query, no cache, no inserted_at filter

Decision: `CONNECTIVITY_SQL` runs directly on each request with no cache and no time
filter.

Reason: the alert tables are tiny (hundreds of rows), PK-indexed, json-free, and
**not partitioned** — a full scan is sub-millisecond. The Performance Rule's caching
and partition-pruning mandates target the large, partitioned, json `app_run_logs`;
neither cost exists here.

Tradeoff: a sequential scan per request, accepted as negligible at this size.

### Server-only lib module (no browser script)

Decision: `lib/connectivity.js` is a normal server-side module (like `lib/runs.js`),
not a browser-served file like `public/grid-view.js`.

Reason: the connectivity view has no client-side controls this phase, so the API
returns the final sorted/decorated shape and the browser just renders it — no need to
ship the sort/derive logic to the client.

Tradeoff: ages are computed at fetch time (the view is not auto-refreshing), which is
fine for an on-demand panel.

## Architecture Notes

- Read-only / least-privilege impact: **expands** the RO role to schema `alert`
  (SELECT on exactly two tables) — the first read outside `util` — enforced in
  `db/setup-readonly-role.sql`. Still no writes/DDL anywhere.
- Query / partition-pruning impact: new query is on unpartitioned tables, so
  partition pruning is n/a; documented. `util` queries unchanged.
- Performance (request-path latency) impact: sub-ms full scan of ~540 rows; no
  detoast; grid/errors paths untouched.
- Security impact: missing grant surfaces as a sanitized 500; all `alert.*`-derived
  text rendered via `textContent` (no innerHTML); the query takes no client input.
- Deployment impact: **two-step** — run `db/setup-readonly-role.sql` (superuser) to
  apply the grant, then restart; before the grant, `/api/connectivity` 500s.
- API / response-shape compatibility impact: additive (`/api/connectivity` is new).

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test          # 72/72
docker run --rm -v "$PWD":/w -w /w node:lts node --check server.js lib/connectivity.js db/queries.js
docker exec ops-dashboard-app-1 node -e 'require("./db/queries"); require("./lib/connectivity")'  # load OK in real env
```

Results:

- Passed: 72/72 unit tests (61 prior + 11 connectivity); all changed server files
  parse; modules load in the running container.
- Failed: none.
- Not run: none.

Live deploy + smoke (2026-06-29, after the operator applied the grant as the
`postgres` superuser and `docker compose restart`):

- Grant landed: `ops_dashboard_ro` now reads `alert.offline_hhm_conn` (284 rows) and
  `alert.offline_mmb_conn` (255 rows) — previously `permission denied for schema alert`.
- `GET /api/connectivity` → 200 in ~70ms; `count: 539` (284 + 255), `systems` sorted
  worst-first (verified: all OFFLINE before UNKNOWN before ONLINE) and most-stale
  first within OFFLINE (top capture from 2024-04). Status tally: 142 OFFLINE / 123
  UNKNOWN / 274 ONLINE.
- No regression: `/healthz`, `/api/jobs/latest`, `/api/errors` all still 200.

Manual / smoke tests:

- Confirmed `ops_dashboard_ro` was denied on both `alert.*` tables BEFORE the grant.
- Inline `index.html` script passes `node --check`.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_10.md`. `node --test` 72/72.

Critical issues:

- None.

Accepted fixes:

- (medium) `db/setup-readonly-role.sql` — the `alert` grant was additive, so
  re-running it could not *prove* the "only these two tables" claim if the role had
  drifted or held inherited/PUBLIC privileges. Made it fail closed: `REVOKE ALL` on
  schema `alert` and its tables from `ops_dashboard_ro` first, then grant only
  `USAGE` + the two `SELECT`s, then a `DO` block that `RAISE`s (aborting under
  `ON_ERROR_STOP`) if any other effective table privilege — or `CREATE` on the
  schema — is present. `has_*_privilege` is used so PUBLIC and role-membership
  privileges are caught, not just direct grants.

Deferred findings:

- None. (Codex otherwise confirmed: narrow query, shared sanitized 500, pure/covered
  `lib/connectivity.js`, UI renders alert-derived values via text nodes.)

## Problems Encountered

- None (the bare `node:lts` container can't load `db/pg-pool` without `.env`/SSL;
  verified the load in the running container instead).

## Follow-Up Tasks

- Done: `alert` grant applied (superuser) + restart + live `/api/connectivity` smoke
  (recorded above, 2026-06-29).
- Deferred: grid connectivity rollup badge on the `data_acquisition` row; per-run
  correlation via `stats.acquisition_history`.

## Commit Readiness

- Requirements implemented: yes (query, lib, endpoint, view, grant SQL, docs).
- Read-only / least-privilege rules hold: yes (SELECT-only grant on two tables).
- Time-windowed queries partition-pruned: n/a (alert tables unpartitioned; justified).
- Schema assumptions confirmed live: yes (shape + the RO-denied precondition).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (72/72 + parse/load + live smoke passed post-grant).
- Ready to commit: yes (shipped; grant applied and smoke green 2026-06-29).

---

# Phase 9 — Grid Filters, Summary & Refresh

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_9_grid_filters.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_9.md`

## Goals

- On top of Phase 8's render pipeline, let an operator narrow and monitor the grid:
  free-text filter, status chips (incl. STALE), a summary-counts header, and a
  last-updated / auto-refresh indicator — all still client-side.

## Built

- `public/grid-view.js`: `filterJobs(jobs,{search,statuses})` (case-insensitive
  app/job/runId match; status-set membership where STALE matches `j.stale===true`,
  not a status; empty filter = all; accepts a Set or array; never mutates) and
  `summarize(jobs)` → `{total,ERROR,WARN,SUCCESS,stale,unknown}`.
- `test/grid-view.test.js`: +11 tests (61 total).
- `public/index.html`: debounced `#grid-search`; status chips (ERROR/WARN/SUCCESS/
  STALE) with counts + `aria-pressed`/`.active`, doubling as the summary; a summary
  line that appends `· showing K` while filtering; a live "updated Ns ago" label off
  `gridData.asOf` ticking every 5s; an auto-refresh checkbox (default on) polling
  `refresh()` every `AUTO_REFRESH_MS` (120s) only while the dashboard is visible.
  `renderGrid()` is now filter → sort → group; `gridView` gains `search` + `statuses`
  (persisted with the Phase 8 keys).

## Schema Facts Confirmed (live DB)

- None new. No queries touched. Confirmed the live `/api/jobs/latest` payload still
  exposes `status`, `stale`, `count`, `coverage.unknown`, and `asOf` (24 jobs from
  the running service; summarize → 14 ERROR / 9 WARN / 1 SUCCESS / 2 stale, which
  reconciles: 14+9+1 = 24).

## Important Decisions

### Summary counts cover the whole grid, not the filtered set

Decision: the chip/summary counts derive from `gridData.jobs` (all jobs); the
filtered count is shown separately as `· showing K`.

Reason: the chips double as filter toggles, so their counts must be a stable
overview ("ERROR 14") that doesn't collapse to 0 as you filter; `ERROR+WARN+SUCCESS`
always equals the total.

Tradeoff: the summary total and the visible row count differ while a filter is
active — surfaced explicitly via `showing K` so it isn't mistaken for a miscount.

### Auto-refresh polls no faster than the cache changes

Decision: `AUTO_REFRESH_MS = 120000`, paused while a drill-down is open.

Reason: the grid is served from an in-process cache that only refreshes every server
`GRID_REFRESH_MS` (≈120s); polling faster just re-fetches identical data.

Tradeoff: a manual `refresh` button remains for an immediate pull.

## Architecture Notes

- Read-only / least-privilege impact: none — frontend only, no DB code path.
- Query / partition-pruning impact: none — no query changed; drill-down `at=` hint intact.
- Performance (request-path latency) impact: none — `/api/jobs/latest` untouched;
  filtering/summarizing re-render from memory. Auto-refresh polls ≤ once / 120s and
  only when the dashboard is visible.
- Security impact: chips/labels built via `textContent`; the search term is only a
  `String.includes` needle, never injected; `localStorage` holds only view prefs,
  validated against allowlists with a try/catch fallback.
- Deployment impact: none — same static-served page + module; no env/port/command change.
- API / response-shape compatibility impact: none.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
```

Results:

- Passed: 61/61 (50 prior + 11 new filter/summarize tests).
- Failed: none.
- Not run: none.

Manual / smoke tests:

- Inline `index.html` script passes `node --check`.
- Running container serves the new controls (`#grid-search`, `#status-chips`,
  `#autorefresh`) and `grid-view.js` exposing `filterJobs`/`summarize`.
- Live 24-job payload: `summarize` → 14/9/1, stale 2, unknown 0 (reconciles to 24);
  search "ge_" → 3 rows; ERROR chip → 14; STALE chip → 2; empty filter → 24.
- Browser-interactive checks (debounced search, chip toggles, "updated Ns ago" tick,
  auto-refresh preserving view state) rest on the syntax check + unit-tested logic;
  recommend an eyeball pass.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_9.md`.

Critical issues:

- None. Codex confirmed: `filterJobs` is pure; STALE matches only `j.stale === true`;
  status tokens are OR'd; search combines with status as an AND; `renderGrid()` does
  filter → sort → group so group counts/roll-ups reflect visible rows; summary chips
  build from the full grid with `showing K` separate; localStorage hydration is
  guarded/allowlisted; auto-refresh uses one 120s interval gated on dashboard
  visibility. `node --test` passed.

Accepted fixes:

- None.

Deferred findings:

- None.

## Problems Encountered

- None.

## Follow-Up Tasks

- Phase 10 (Pending): dedicated read-only Connectivity view over the `alert.*` tables.

## Commit Readiness

- Requirements implemented: yes (filter/search, status chips incl. STALE, summary
  header, last-updated + auto-refresh; filter precedes grouping).
- Read-only / least-privilege rules hold: yes (frontend only).
- Time-windowed queries partition-pruned: n/a (no query changed).
- Schema assumptions confirmed live: yes (payload fields verified).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (61/61 tests + smoke).
- Ready to commit: yes.

---

# Phase 8 — Grid Grouping & Sorting

Date:
2026-06-29

Status:
Completed

Prompt:
`prompts/prompt_8_grid_grouping_sort.txt`

Git Commit:
Pending

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_8.md`

## Goals

- Let an operator organize the job grid client-side: group by app / job / none with
  collapsible groups, and sort any column — headline being sort by last-run datetime.
- Do it with zero backend change, re-rendering from the payload already in memory.

## Built

- `public/grid-view.js` (new): pure, DOM-free transforms — `sortJobs(jobs,key,dir)`,
  `groupJobs(jobs,by)`, `groupRollupStatus(rows)`, shared `STATUS_RANK`
  {ERROR:0,WARN:1,SUCCESS:2,INFO:3}. Nulls sort last in both directions; status sort
  is worst-first, tie-broken by most-stale-first (`ageMs`) then an app/job fallback;
  never mutates input. Dual export
  (browser `window.GridView` + Node `require`).
- `test/grid-view.test.js` (new): +17 tests (50 total).
- `public/index.html`: `loadGrid()` split into fetch → store `gridData` →
  `renderGrid()`, so group/sort/collapse changes re-render from memory with no
  refetch. Added a group-by selector, clickable sortable headers (▲/▼ + `aria-sort`,
  keyboard-operable), collapsible group-head rows with a worst-status roll-up badge,
  and a `gridView` state object persisted to `localStorage` (`ops-grid-view`). CSS in
  the existing `<style>`. Server-side sort (`server.js:119`) left untouched.

## Schema Facts Confirmed (live DB)

- None new. This phase touched no queries. Confirmed the live `/api/jobs/latest`
  payload still carries the fields the client sorts/groups on (`app, job, runId,
  lastRun, startedAt, endedAt, durationMs, status, issueCount, ageMs, stale`) — 24
  jobs returned from the running service.

## Important Decisions

### Browser module lives in public/, not lib/

Decision: the pure transforms ship as `public/grid-view.js`, not `lib/grid-view.js`
as the prompt suggested.

Reason: `server.js` serves static files only from `public/`. Placing the module there
loads it via a plain `<script src>` with no build step; mounting `lib/` statically
would expose server-only modules (run-cache, self-log, pg-*) to the browser.

Tradeoff: the file sits beside the page it serves rather than next to the other pure
libs; mitigated by keeping it dependency-free and unit-tested from `test/`.

### Full re-render on control change (no partial DOM toggle)

Decision: group/sort/collapse rebuild the grid `<tbody>` from `gridData`.

Reason: simpler and demonstrably correct; the grid is tens of rows, so a rebuild is
instant. Crucially it is still **render-from-memory** — no refetch.

Tradeoff: marginally more DOM churn than toggling `hidden`; negligible at this scale.

## Architecture Notes

- Read-only / least-privilege impact: none — frontend only, no DB code path added.
- Query / partition-pruning impact: none — no query changed; drill-down links still
  carry the `at=` (inserted_at) hint so the run query still prunes.
- Performance (request-path latency) impact: none — `/api/jobs/latest` untouched
  (~3ms); control changes re-render client-side with no network call.
- Security impact: all payload-derived text rendered via `textContent`/`createTextNode`
  (no innerHTML); `localStorage` holds only view prefs; inputs validated against
  allowlists with try/catch fallback.
- Deployment impact: none — same static-served single page plus one new static asset
  (`grid-view.js`); no env, port, or command change.
- API / response-shape compatibility impact: none — no endpoint or response changed.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
```

Results:

- Passed: 50/50 (33 prior + 17 new `grid-view` tests).
- Failed: none.
- Not run: none.

Manual / smoke tests:

- `/grid-view.js` served (200) and exposes `STATUS_RANK,sortJobs,groupJobs,groupRollupStatus`.
- `/api/jobs/latest` returns 24 jobs with the expected keys (unchanged shape).
- Inline `index.html` script passes `node --check` (no syntax error).
- The real 24-job payload run through `sortJobs`/`groupJobs`/`groupRollupStatus`:
  groups by app with correct counts + roll-ups (data_acquisition→ERROR, ge→WARN),
  status-asc surfaces ERRORs first, duration-desc keeps nulls last, group=none → one
  group of 24.
- Browser-interactive checks (click-to-sort, collapse/expand, localStorage persist)
  rest on the syntax check + the unit-tested pure logic; recommend an eyeball pass.

## Review Notes

Source:

- External (Codex) on `notes/review_handoff_phase_8.md`.

Critical issues:

- None. Codex confirmed: fetch/render split intact, controls re-render from cached
  `gridData`, grouped rows preserve `runHref(j.runId, j.lastRun)`, payload text via
  text nodes (no innerHTML), localStorage guarded/allowlisted, server-side sort
  (`server.js:119`) unchanged; `node --test` 50/50.

Accepted fixes:

- (nit, docs only) Documentation drift: this entry said the status sort had an
  "app/job tiebreak"; the code/tests actually tie-break by most-stale-first (`ageMs`)
  then fall back to app/job. Corrected in this entry and the handoff. No code change.

Deferred findings:

- None.

## Problems Encountered

- Problem: static serving is `public/`-only, but the prompt put the shared module in
  `lib/`.
  Resolution: hosted it at `public/grid-view.js` (dual-export) — browser-served and
  Node-testable — rather than statically exposing all of `lib/`.

## Follow-Up Tasks

- Phase 9 (Pending): filter/search box, status chips, summary-counts header,
  last-updated/auto-refresh — builds on this render pipeline.

## Commit Readiness

- Requirements implemented: yes (grouping, collapse, sortable columns incl. last-run
  datetime, extracted pure module + tests).
- Read-only / least-privilege rules hold: yes (frontend only).
- Time-windowed queries partition-pruned: n/a (no query changed; drill-down hint kept).
- Schema assumptions confirmed live: yes (payload shape verified against the service).
- Review findings addressed or deferred: handoff written; external review pending.
- Validation recorded: yes (50/50 tests + smoke).
- Ready to commit: yes.

---

# Phase 7 — Self-Monitoring

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_7_self_monitoring.txt`

Git Commit:
baf398d (impl); review fixes follow in a subsequent commit

## Goals

- Let ops-dashboard log its own health into util.app_run_logs under
  app_name="ops-dashboard" so it appears in its own grid and self-failures are visible.
- Do it without weakening the read-only posture: the write is DB-enforced, scoped,
  and opt-in.

## Built

- `db/setup-writer-role.sql`: the write path, enforced by the DB.
  - `ops` schema (we own it); `util` stays pipeline-owned.
  - `ops.log_ops_dashboard_run(run_id, verbose_log, warn_error_logs)` SECURITY DEFINER,
    hard-codes app_name='ops-dashboard', fixed search_path, parameterized.
  - `ops_writer_owner` (NOLOGIN) owns the function and is the ONLY role with INSERT on
    util.app_run_logs — unreachable by any client.
  - `ops_dashboard_rw` (the app's writer login) has EXECUTE on the function and nothing
    else. No trigger/RLS on the shared partitioned table.
- `utils/logger/{log.js,enums.js}`: minimal run-log builder (event shape matches the
  suite); the first event carries note.argv[2]=job so the grid buckets it.
- `lib/self-log.js`: pure `buildHeartbeat(health)` + `writeHeartbeat(writerDb, health)`.
- `db/pg-writer.js` + `db/pgp.js` + `db/ssl.js`: a separate writer connection; the
  pg-promise root and SSL builder are now shared so the writer reuses them. pg-pool.js
  read behavior is unchanged (same role, config, exported object).
- `server.js`: opt-in heartbeat (`SELF_LOG_ENABLED`, every `SELF_LOG_INTERVAL_MS`,
  default 5 min) capturing asOf / cacheSize / coverage.unknown / lastRefreshMs /
  lastError; a failed refresh becomes an ERROR event. Write failures are caught (never
  crash serve).
- `config/schedules.js`: `ops-dashboard/heartbeat` { everyMin:5, graceMin:10 }.
- Env: `SELF_LOG_ENABLED`, `SELF_LOG_INTERVAL_MS`, `PG_WRITER_USER`,
  `PG_WRITER_PASSWORD`. `test/self-log.test.js`: +6 tests (32 total).

## Schema Facts Confirmed (live DB)

- Insert shape ['app_name','run_id','verbose_log','warn_error_logs'] into
  util.app_run_logs; inserted_at defaults to now(); verbose_log/warn_error_logs json.
- The SECURITY DEFINER + NOLOGIN-owner design works: as ops_dashboard_rw the function
  writes an 'ops-dashboard' row (POSITIVE); a direct INSERT is denied
  (`permission denied for schema util`); ops_dashboard_ro cannot EXECUTE the function
  (`permission denied for schema ops`).
- Partition for now() exists (app_run_logs_2026_06); there is NO 2026_07 partition yet
  and no DEFAULT partition (see Follow-Up).

## Important Decisions

### DB-enforced write scope (SECURITY DEFINER function, not code/trigger/RLS)

Decision: the only write is a SECURITY DEFINER function that hard-codes the app_name;
the writer login has EXECUTE-only; the INSERT-capable owner is NOLOGIN.
Reason: makes "writes only app_name=ops-dashboard, nothing else" provable at the role
level, not dependent on app code. Avoids triggers/RLS on the shared partitioned
util.app_run_logs, which could break the pipeline apps' inserts.
Tradeoff: a superuser/admin setup step (db/setup-writer-role.sql) + a second credential.

### Opt-in, heartbeat (not a batch job)

Decision: SELF_LOG_ENABLED gates self-logging (off by default); the unit is a periodic
heartbeat from the long-running serve process.
Reason: Phase 4 chose the in-process cache, so there is no batch job to hang logging
off. Opt-in keeps the app read-only until the writer is provisioned.

## Architecture Notes

- Read-only / least-privilege impact: read path + role unchanged; the new write is a
  separate, EXECUTE-only credential, DB-scoped to one app_name.
- A dead process / DB outage writes no heartbeat -> the ops-dashboard row ages to STALE
  (correct "down" signal; can't self-log an unreachable DB).
- API compatibility: no endpoint/response changes; ops-dashboard just appears as a new
  grid row.

## Validation

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 32 pass (6 new + 26)
psql ... -f db/setup-writer-role.sql                       # provision (+ pos/neg tests)
docker compose up -d                                       # recreate (.env changed)
```

- 32/32 unit tests. Positive + both negative DB tests pass.
- Live: boot logs "self-logging on"; heartbeat writes cleanly (0 failures post-fix);
  grid shows 24 jobs incl. ops-dashboard/heartbeat = SUCCESS, not stale, coverage 24/24.

## Review Notes

Source: external (Codex) on `notes/review_handoff_phase_7.md`. Boundary checks passed
independently (rw write ok; direct INSERT/SELECT denied; ro cannot execute; owner
NOLOGIN; no elevated attributes/memberships). Accepted fixes (follow-up commit):

- (medium) db/setup-writer-role.sql was additive and didn't enforce least privilege on
  rerun/drift. Now forces role attributes (ALTER ROLE ... NOLOGIN/NOSUPERUSER/
  NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS) and revokes-before-grants the
  minimal set, plus a verification block in comments. Re-ran live: idempotent; owner
  canlogin=f, rw login-only, util grant = only ops_writer_owner/INSERT.
- (low) lastError was persisted verbatim into warn_error_logs / the error feed. Added
  summarizeError() (single-line, capped 300 chars); full detail stays in container
  logs. New test.
- (nit) Recorded the Phase 7 commit SHA (baf398d) instead of "Pending".

Tests 33/33.

## Problems Encountered

- Problem: `SELECT void_function()` returns one (void) row, so pg-promise `db.none`
  rejected with "No return data was expected" — even though the INSERT had run.
  Resolution: use `db.one` and discard the row.

## Follow-Up Tasks

- Partition dependency: a now()-stamped insert needs the current month's partition.
  Only through 2026_06 exist and there is no DEFAULT partition, so on 2026-07-01 both
  the pipeline's inserts and our heartbeat fail until the July partition is created
  (a pipeline-owned concern). Our write is non-fatal; watch for the ops-dashboard row
  (and others) going STALE around month boundaries as the signal.
- Optional: also write the JSON file to /opt/run-logs/ops-dashboard (mount exists);
  deferred — the grid reads the DB row, the file is redundant for now.

## Commit Readiness

- Read-only read path + role unchanged: yes. Write is DB-scoped + opt-in: yes.
- Schema assumptions confirmed live (incl. neg tests): yes.
- Validation recorded: yes. Ready to commit: yes.

---

# Phase 6 — Real Schedule Cadences

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_6_real_schedules.txt`

Git Commit:
234574d (impl); SHA recorded in a follow-up commit

## Goals

- Make the STALE badge trustworthy: confirm/complete `config/schedules.js` against
  the real cron, fill the jobs the grid shows but config omitted, add provenance to
  every entry, and stop asserting a cadence for a job that isn't scheduled.
- Surface coverage — which grid (app, job) pairs have no configured cadence
  (stale=null) — so silent drift is visible as new apps start logging. Unknown must
  stay null, never falsely green.

## Built

- `config/schedules.js`: rewritten from placeholders to confirmed cadences, each with
  a provenance comment (cron file line + observed median gap, app_run_logs 2026-06-26).
  - Added the 15 Philips variants the grid shows but config omitted:
    `PHILIPS_MRI_MONITOR_1..5`, `_RMMU_1..5`, `_LOG_1..5` (all every 30 min).
  - `SIEMENS_CV`: removed its false 30-min entry — it is in neither cron file and has
    no runs in 30 days (absent from the grid). Left intentionally unknown (stale=null),
    documented inline.
  - `data_acquisition/(default)`: a stall budget (not a literal schedule), set to
    `everyMin: 20, graceMin: 10` (30 min) above the MAX normal inter-run gap so it
    flags a full-pipeline stall without flapping. (Initially shipped at 10 min sized
    on p90; corrected in the budget-fix follow-up — see Review Notes.)
  - Recorded the known wall-clock schedules (`monday/EQUIPMENT_RTT 25 7 * * *`,
    `acumatica 20 7 * * *`, `part-source/INV_FEED_SYNC 0 6 * * *`) as commented future
    entries — deferred until a cron evaluator and those apps' logs exist.
- `lib/staleness.js`: added pure, exported `isConfigured(app, job)` and
  `coverage(pairs)` → `{ total, configured, unknown, unknownJobs }`. `evaluate`
  unchanged.
- `server.js`: `/api/jobs/latest` now returns an additive `coverage` object (existing
  fields untouched); the grid-refresh log line reports `cadence unknown: N/total`.
- `public/index.html`: header `meta` appends `· N cadence unknown` when > 0; a
  `stale === null` row now renders a muted `? CADENCE` badge (new `.unknown` class) so
  an unknown-cadence job is never visually mistaken for a healthy one.
- `test/staleness.test.js`: +7 tests (configured Philips variant, SIEMENS_CV stays
  null, the (default) stall budget within/over, `isConfigured`, `coverage`).

## Schema Facts Confirmed (live DB)

- Re-ran `notes/schedule-cadence-probe.sql` as `ops_dashboard_ro`: every active
  ge/philips grid job (incl. all 15 Philips variants) = 30.0 min median gap;
  `data_acquisition/(default)` = 0.4 min median / 2.8 p90 / 10.1 p99 / 12.3 max
  (7-day window) — the basis for the 30-min stall budget.
- 30-day grid set = 23 (app, job) pairs (matches the cache). `hhm_rpp_siemens` has
  only `SIEMENS_CT` and `SIEMENS_MRI` (both ~407 h / ~17 d idle, dormant); there is
  **no** `SIEMENS_CV` in the grid or cron — confirming it must be unknown, not 30 min.
- After this phase all 23 grid jobs resolve to a real boolean (no stale=null); the
  15 previously-unconfigured Philips variants are now covered.

## Important Decisions

### data_acquisition/(default) stall budget = 30 min

Decision: `everyMin: 20, graceMin: 10` (30-min budget). It is the aggregate of many
staggered sub-jobs, so a meaningful signal is "the whole pipeline went silent."
Reason: the budget must clear the MAX normal inter-run gap or it flaps. The 7-day gap
distribution is median 0.4 / p90 2.8 / p99 10.1 / max 12.3 min, so 30 min (~2.4× max)
flags a real stop without false positives. (Shipped initially at 10 min sized on p90,
which sat below the max gap; corrected in the budget-fix follow-up — see Review Notes.)
Tradeoff: `everyMin` is being used as a silence budget, not a literal interval;
documented inline. Per-system_id staleness stays out of scope (one (default) bucket).

### Defer cron-string parsing; record wall-clock crons as comments

Decision: keep `everyMin` only; record `monday`/`acumatica`/`part-source` wall-clock
crons as commented future entries.
Reason: every current grid job is interval-scheduled and timezone-independent, so a
cron evaluator is unnecessary now; those apps don't log to the DB yet.
Tradeoff: activating them later needs a cron parser in `lib/staleness.js` and a
job-name (argv[2]) casing check — noted in the config comment.

## Architecture Notes

- Read-only / least-privilege impact: none — config + pure logic only; coverage reads
  the in-memory cache. Verification ran as `ops_dashboard_ro`. No write path added.
- Query / partition-pruning impact: none — no new query; the probe is bounded by
  `inserted_at` and run out-of-band.
- Performance (request-path latency) impact: negligible — `coverage()` is O(23) over
  the in-memory grid per request; live grid still ~ms.
- Security impact: none — `.env` uncommitted; no secrets in code/docs; error shapes
  unchanged.
- Deployment impact: none beyond a restart to load the new config (source bind-mounted;
  no env or compose change).
- API / response-shape compatibility impact: additive `coverage` field only;
  `/api/errors` and `/api/runs/:run_id` untouched.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test       # 26 pass
docker run --rm -v "$PWD":/w -w /w node:lts node --check server.js
psql ... -U ops_dashboard_ro -f notes/schedule-cadence-probe.sql   # cadences re-confirmed
docker compose restart app                                    # load new config
```

Results:

- Passed: `node --test` 26/26 (7 new); `server.js` syntax OK.
- Failed: none.
- Not run: none.

Manual / smoke tests (service live on :8080 after restart):

- Boot log: `grid bootstrap: 23 rows -> 23 jobs ...; cadence unknown: 0/23`.
- `/api/jobs/latest`: `coverage = {total:23, configured:23, unknown:0, unknownJobs:[]}`;
  stale tally 2 true / 21 false / 0 null — every grid job resolves to a real boolean.
- Dormant siemens read correctly: `SIEMENS_CT=true`, `SIEMENS_MRI=true` (~17 d idle).
- Unknown-cadence count (0) matches the jobs left unconfigured in the grid (none).
- Served `/` carries the new markup (`cadence unknown`, `? CADENCE`, `.badge unknown`,
  `r.coverage`).

## Review Notes

Source:

- Self-review against `markdown/REVIEW_CHECKLIST.md` (walked: scope/non-goals held;
  read-only + RO role intact; no new query; additive response shape; secrets clean;
  validation recorded).
- Pre-handoff diff review (this session) caught one issue, fixed before the external
  pass; handoff is `notes/review_handoff_phase_6.md`.

Critical issues:

- None.

Accepted fixes (follow-up commit):

- (medium) `data_acquisition/(default)` stall budget was `{everyMin:5, graceMin:5}`
  = 10 min, sized on p90 (2.8 min). Re-measuring the gap distribution showed p99
  10.1 / MAX 12.3 min over 7 days, so the aggregate bucket would intermittently flap
  a false STALE. Raised to `{everyMin:20, graceMin:10}` = 30 min (~2.4x max), comment
  corrected to justify against the max gap, tests updated. 26/26.

Deferred findings:

- None. (Wall-clock cron activation is intentionally deferred to a future phase with a
  cron evaluator, recorded as commented config entries.)

## Problems Encountered

- Problem: the running container caches `config/schedules.js` at require-time, so new
  cadences don't take effect until restart.
  Resolution: `docker compose restart app` (source is bind-mounted; no rebuild needed),
  then confirmed the boot log + grid coverage reflected the new config.

## Follow-Up Tasks

- When `monday` / `acumatica` / `part-source` (and other apps) start logging to the DB,
  activate their commented wall-clock entries — which needs a cron evaluator in
  `lib/staleness.js` and confirming each job's argv[2] casing. The coverage count will
  flag them as unknown until then.

## Commit Readiness

- Requirements implemented: yes (confirmed cadences + provenance, 15 variants added,
  SIEMENS_CV unknown, (default) stall budget, coverage surface + UI).
- Read-only / least-privilege rules hold: yes (config/logic only; RO role).
- Time-windowed queries partition-pruned: yes (no new query; probe `inserted_at`-bound).
- Schema assumptions confirmed live: yes (probe + 30-day grid set re-run as RO).
- Review findings addressed or deferred: none outstanding.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 5 — Run Drill-Down UI

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_5_run_drilldown_ui.txt`

Git Commit:
11ce769

## Goals

- Give users a readable per-run event timeline over the existing
  `GET /api/runs/:run_id`, reached from the job grid and the error feed.
- Keep the phase frontend-only: no new endpoints, no query/DB/credential changes,
  no framework or build step; don't change `/api/jobs/latest` or `/api/errors`
  response shapes.

## Built

- `public/index.html` (only file changed): a hash-based router in the existing
  static page. No hash → the dashboard (grid + error feed); `#run=<id>&at=<hint>`
  → a drill-down view rendered into a new `#run-view` section.
  - Grid run-id cell repointed from the raw `/api/runs` JSON URL to the in-page
    drill-down, still passing the row's `inserted_at` as the hint.
  - Error-feed rows are now clickable (cursor/hover affordance) and link to the
    run using the event `dt` as the hint.
  - Drill-down render: run header (app/job, derived status badge, run id,
    inserted/started/ended, duration, event count) + an event timeline table
    (When, Type, Func, Tag, Detail, Message). WARN/ERROR rows tinted; added a
    neutral `.INFO` badge style.
  - All log-derived text set via `textContent` (no `innerHTML`); `note` rendered
    as text (surfaced `system_id`/`sme` + `job_id`, then full JSON).
  - Large-payload guard: render at most `RENDER_CAP` (500) events initially with a
    "show all N events" button to reveal the rest; rows built in a
    `DocumentFragment`.
  - Clean 400 ("Invalid run id.") / 404 ("Run not found — it may have aged out of
    the 30-day window.") / generic-failure copy in the run view; no stack traces.
- No changes to `server.js`, `db/queries.js`, or any API response shape.

## Schema Facts Confirmed (live DB)

- Event objects across all writing apps carry `dt`, `type` (INFO/WARN/ERROR),
  `func`, `tag`, `run_id`, `note` (an object: `job_id`, `system_id`/`sme`,
  `message`, `skip_reason`, …); `err_msg` is present only on ERROR / some WARN.
  No doc corrections needed — matches `docs/logging-schema.md`.
- Worst-case run is `data_acquisition` at ~1,625 events / ~680 KB text (drives the
  RENDER_CAP). `/api/errors` events already include `run_id` and `dt`, so the
  error-feed link needs no API change.
- `EXPLAIN` on the hinted run query with both an `inserted_at` hint and a `dt`
  hint shows `Subplans Removed: 6` — only `app_run_logs_2026_06` is scanned via
  the inserted_at index. Both entry points prune to one monthly partition.

## Important Decisions

### Single-file hash router (no second HTML page)

Decision: add an in-page hash router rather than a second `run.html`.
Reason: reuses the existing `fmtTime`/`fmtDur`/`cell` helpers and styles, avoids a
second markup fetch, and keeps the no-build static approach.
Tradeoff: one slightly larger file; deep-linking to a run loads the dashboard
lazily on first back-navigation (handled via a `dashboardLoaded` guard).

### Cap the initial timeline render

Decision: render up to 500 events, with a "show all" button for the remainder.
Reason: the worst-case ~1,625-event `data_acquisition` run keeps the DOM and the
first paint responsive without dropping data.
Tradeoff: a one-click reveal for the few large runs; small runs are unaffected.

## Architecture Notes

- Read-only / least-privilege impact: none — no new code path touches the DB; the
  app still reads as `ops_dashboard_ro` over the unchanged endpoints.
- Query / partition-pruning impact: none added; both drill-down entry points pass
  a hint so the existing hinted query prunes to one partition (EXPLAIN-confirmed).
- Performance (request-path latency) impact: none server-side; hinted run fetch
  ~30–60 ms incl. the 680 KB worst-case payload. Client caps initial render.
- Security impact: all log-derived content rendered via `textContent` — no
  injection from log payloads; 400/404 surfaced as plain copy, not raw errors.
- Deployment impact: none — static file served from the bind mount; no restart
  or env change. Same `:8080` service.
- API / response-shape compatibility impact: none; `/api/jobs/latest`,
  `/api/errors`, `/api/runs/:run_id` all unchanged.

## Validation

Commands run:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 20 pass
docker run --rm -v "$SP":/s -w /s node:lts node --check inline.js   # inline script parses
```

Results:

- Passed: `node --test` 20/20; inline-script syntax check OK.
- Failed: none.
- Not run: none.

Manual / smoke tests (service live on :8080, static file served from bind mount):

- Grid-style request `/api/runs/<id>?inserted_at=<lastRun>` → 200 in ~54 ms.
- Error-feed-style request `/api/runs/<id>?inserted_at=<event dt>` → 200 in ~58 ms.
- Both hints: `EXPLAIN` shows `Subplans Removed: 6`, single `app_run_logs_2026_06`
  index scan (one-partition prune).
- Large run (1,625 events) → 200 in ~30 ms, 680 KB; cap + "show all" path exercised.
- Bad id (`not-a-uuid`) → 400 `{"error":"invalid run_id ..."}`; missing well-formed
  id → 404 `{"error":"run not found"}`. Both render as clean copy, no stack trace.
- Served `/` carries the new markup (`run-view`, `runHref`, `RENDER_CAP`).

## Review Notes

Source:

- Self-review against `markdown/REVIEW_CHECKLIST.md` (walked below), then an
  external (Codex) review against `notes/review_handoff_phase_5.md`.

Critical issues:

- None.

Accepted fixes (subsequent commit):

- (low) `showRun` had no stale-response guard — opening run A then B (or
  navigating back) could render the slower fetch into a stale/hidden view. Added a
  monotonic `runReq` token bumped on every navigation; responses that no longer
  match the active route are ignored.
- (low) 404 copy wrongly blamed the "30-day window" (that's the grid cache, not
  the DB, which the drill-down reads directly). Changed to "Run not found, or the
  timestamp hint no longer matches this run."
- (low) Error-feed rows were mouse-only `<tr>`s. Added `tabindex=0`, `role=link`,
  and Enter/Space activation so they match the grid's `<a>` entry points.

Deferred findings:

- None. No XSS found (log-derived values go through textContent); the error-feed
  `className = "badge " + e.type` is cosmetic class assignment, not HTML.

## Problems Encountered

- Problem: `node` is not on the host PATH (apps run in Docker); a probe script in
  the scratchpad isn't under the compose bind mount.
  Resolution: ran probes/EXPLAIN in a `node:lts` container on `pg_net` with the
  probe bind-mounted as a single file into `/workspace`; removed the stray mount
  artifact before committing.

## Follow-Up Tasks

- None. (Phase 6 — real cron cadences — is next per the roadmap.)

## Commit Readiness

- Requirements implemented: yes (timeline, both entry points + hints, textContent,
  400/404, large-payload cap).
- Read-only / least-privilege rules hold: yes (no new DB surface).
- Time-windowed queries partition-pruned: yes (EXPLAIN-confirmed, both hints).
- Schema assumptions confirmed live: yes (event fields, worst-case size, pruning).
- Review findings addressed or deferred: none outstanding.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 4 — Incremental Run Cache (in-process)

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_4_summary_table.txt`

Git Commit:
8643f3d (impl); review fixes follow in a subsequent commit

## Goals

- Retire the heavy background grid query by parsing each app_run_logs row at most
  once per process lifetime (Option B: in-process incremental cache, no DB writes).
- Show last-run-per-(app,job) so dormant jobs stay visible (stale) instead of
  vanishing under a lookback window.

## Built

- `lib/run-cache.js`: DB-free cache (Map keyed by app+job). merge (idempotent,
  keep max inserted_at per key), evict (retention), sinceBound (watermark-overlap,
  floor-clamped), watermark advance. Unit-testable with injected rows.
- `db/queries.js`: `JOBS_LATEST_SQL` now bounded by `inserted_at >= $1::timestamptz`;
  `jobsLatestSince(sinceIso)` replaces `jobsLatest(lookbackDays)`.
- `server.js`: removed the Phase 2 full-rescan snapshot. One `refreshOnce` driver:
  bootstrap when cache not ready (sinceBound = retention floor), else a tick
  (sinceBound = watermark - overlap). Serves from the cache; 503 until ready.
- `test/run-cache.test.js`: 8 tests (bootstrap, idempotent re-merge, newer/older,
  eviction, watermark monotonicity, empty merge, sinceBound, ready).
- Env: added `SUMMARY_RETENTION_DAYS` (30) + `SUMMARY_OVERLAP_MS` (300000); removed
  `GRID_LOOKBACK_DAYS`. Updated `.env.example` / `markdown/ENVIRONMENT.md`.

## Schema Facts Confirmed (live DB)

- 30-day bootstrap = 23 jobs in ~15s (raw SQL) / ~31s live incl. connect, behind
  the warming 503; tick window (since watermark-overlap) = 9–43ms, prunes to one
  partition. Both windows' newest inserted_at is identical, so the watermark stays
  correct after every merge.
- `hhm_rpp_siemens` (SIEMENS_CT, SIEMENS_MRI), idle ~16.9 days, is invisible at 7d
  but present and STALE at 30d — the blind spot the lookback created.
- Insert-lag (inserted_at vs run-end dt): p95 ~0.29s, max ~3.6s -> the 5-min
  overlap is ~80x margin. No doc corrections needed; schema matches the contract.

## Important Decisions

### Two review adjustments over the plan

Decision: (1) listen first; one interval drives bootstrap-if-not-ready (retry on
failure) else tick — never block listen on bootstrap. (2) Removed
`GRID_LOOKBACK_DAYS` rather than leaving it inert.
Reason: keep `/healthz` and the 503-warming path live during the ~31s bootstrap,
and make a boot-time DB failure self-heal; avoid a misleading dead env knob.
Tradeoff: a cold start re-bootstraps the retention window (~31s) on every restart
(single instance, behind warming — acceptable).

### Keep the `lookbackDays` response field

Decision: keep the key, populate with the retention value (30).
Reason: eviction means a job shows iff its last run is within retention, so
"last 30d" is accurate; preserves the grid response shape (no UI change).

## Architecture Notes

- Read-only / least-privilege impact: none added — still `ops_dashboard_ro`,
  SELECT only, no write surface (Option A deferred).
- Query / partition-pruning impact: grid query now `inserted_at >= $1`; ticks prune
  to one partition.
- Performance impact: request path 2.7ms (was ~17–28s on the old snapshot's cold
  path); heavy work is one bootstrap + cheap ticks, off the request path.
- API compatibility impact: `/api/jobs/latest` response shape unchanged; `/api/errors`
  and `/api/runs/:run_id` untouched.

## Validation

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test   # 19 pass (8 new + 11)
docker compose up -d                                       # recreate (.env changed)
```

- node --test: 19 pass.
- Live smoke: healthz 200 in 33ms during bootstrap (listen-first); grid 503 while
  warming, then 200 in 2.7ms; count 23, lookbackDays 30, asOf set; siemens shows
  STALE at 16.9d; observed `grid bootstrap: 23 rows ... 31137ms` then
  `grid tick: 1 rows -> 23 jobs ... 43ms`.

## Review Notes

Pre-implementation: plan review raised the two adjustments above; both applied.

Post-implementation: external (Codex) review, run from the phase log + commits.
Accepted fixes (subsequent commit):

- (medium) The overlap ticks absorb commit-lag skew but not a true backfill — a
  row committed now with inserted_at older than (watermark - overlap) would be
  missed until restart. Added a periodic full-retention reconciliation
  (`SUMMARY_RECONCILE_MS`, default 6 h): every interval a tick instead does a full
  retention re-scan; merge is idempotent so it never duplicates. Covered by a new
  cache test.
- (low) `KEY_SEP` was a literal NUL byte -> git treated `lib/run-cache.js` as
  binary. Rewrote as the `"\x00"` escape (same NUL at runtime, ASCII source).
- (nit) Recorded this entry's commit SHA instead of "Pending".

No issues found in the bootstrap-retry guard or eviction; 19/19 tests passed at
review time (20/20 after the reconciliation test).

## Commit Readiness

- Read-only / least-privilege rules hold: yes.
- Time-windowed queries partition-pruned: yes.
- Schema assumptions confirmed live: yes.
- Validation recorded: yes.
- Ready to commit: yes.

---

# Phase 0 — Workflow Scaffold

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_0_workflow_scaffold.txt`

Git Commit:
8e4d7fb (scaffold); review fixes follow in a subsequent commit

Review Artifacts:
- Review handoff: `notes/review_handoff_phase_0.md`
- Review results: external (Codex) — 4 findings (2 medium, 1 low, 1 nit), all addressed

## Goals

- Adapt the phase-based, prompt-driven workflow paradigm to ops-dashboard.
- Encode hard-won facts (read-only, json-not-jsonb, partitioning, RO role,
  snapshot perf, Docker-only deploy) into durable docs.
- Seed the roadmap and phase log so future work is repeatable.

## Built

- `markdown/`: FLOW, ARCHITECTURE_PRINCIPLES, PROMPTS, PHASE_TEMPLATE, PHASE_LOG,
  REVIEW_CHECKLIST, ENVIRONMENT, DEPLOYMENT.
- `prompts/`: prompt_0 (this) plus planned prompts 4–7.
- `notes/`: directory for review handoffs and results.

## Schema Facts Confirmed (live DB)

- None (docs-only phase; no runtime/query changes).

## Architecture Notes

- Read-only / least-privilege impact: none (documentation).
- Deployment impact: none.

## Validation

- Workflow files exist; `git status` reviewed. No app build required.
- Post-review: corrected `db/setup-readonly-role.sql` tested live (idempotent
  re-run succeeds; the previous DO-body form fails with `syntax error at or near ":"`,
  confirming the bug).

## Review Notes

Source: external (Codex) on `notes/review_handoff_phase_0.md`.

Accepted fixes:

- `db/setup-readonly-role.sql`: `:'ro_pw'` was interpolated inside a `DO $$..$$`
  body where psql does not expand it -> invalid PL/pgSQL. Rewrote with `\gexec` +
  `ALTER ROLE` outside any dollar-quoted body. (medium)
- `markdown/DEPLOYMENT.md`: bind-mount dirs now created with
  `sudo install -d -o 105 -g 987 ...` to match the stated ownership. (medium)
- `prompts/prompt_4_summary_table.txt`: made the role split firm (DDL by an
  admin/migration role, reads on `ops_dashboard_ro`, a separate minimal writer) so
  a future phase can't "solve" it by expanding the read role. (low)
- This entry's commit SHA recorded instead of "Pending". (nit)

Deferred findings:

- None. No secret values were found in the docs (the `PGPASSWORD=<...>` text is a
  placeholder).

## Commit Readiness

- Ready to commit: yes (no runtime change).

---

# Phase 3 — Code-Review Hardening

Date:
2026-06-26

Status:
Completed

Prompt:
— (predates prompt system)

Git Commit:
f53a256

Review Artifacts:

- Review handoff: `docs/code-review-handoff.md`
- Review results: external (Codex) — 5 findings, all addressed

## Built

- Created least-privilege role `ops_dashboard_ro` (CONNECT + USAGE + SELECT only)
  and migrated the deployment off the `postgres` superuser; `db/setup-readonly-role.sql`.
- `/api/runs/:run_id`: uuid validation (400 instead of a cast-error 500) + optional
  `inserted_at` hint that prunes the drill-down to one partition (~8ms).
- Defensive duration parsing in SQL (ISO regex guard so one bad row can't fail the
  whole grid refresh; negative spans clamp to null) mirrored in `lib/runs.js`.
- SSL fail-closed for `PG_SSLMODE=verify-*`; generic 500 messages.
- `node:test` coverage for `lib/runs.js` and `lib/staleness.js` (11 tests).

## Schema Facts Confirmed (live DB)

- Read via the partitioned parent is covered by a single `SELECT` grant on the
  parent; the RO role cannot write (verified: `permission denied`).
- Hinted drill-down prunes to one monthly partition (verified via `EXPLAIN`).

## Important Decisions

### Migrate to a read-only role immediately

Decision: create `ops_dashboard_ro` and repoint the live deployment now.
Reason: the app was running as superuser — the riskier state to leave up.
Tradeoff: introduced a second credential to manage; old superuser still valid in DB.

## Validation

- `node --test` → 11 pass. Live smoke: healthz ok under RO role; invalid uuid → 400;
  drill-down with hint → 200 in ~8ms.

## Commit Readiness

- Ready to commit: yes.

---

# Phase 2 — Background-Refreshed Grid Snapshot

Date:
2026-06-26

Status:
Completed

Prompt:
— (predates prompt system)

Git Commit:
4d19352

## Built

- Moved the heavy `/api/jobs/latest` query off the request path: refresh a
  snapshot on a background interval (`GRID_REFRESH_MS`, default 120s) and serve it
  instantly (~4ms). Age/staleness recomputed per-request so they stay live.
- 503 "warming" until the first refresh lands; UI shows snapshot `asOf` time.

## Schema Facts Confirmed (live DB)

- The grid query detoasts ~150 MB of `verbose_log` JSON over 7 days
  (`data_acquisition` alone ≈ 99 MB / 7.7k rows) → ~17s; far too slow for a request.

## Important Decisions

### Snapshot now, summary table later

Decision: cache a background snapshot rather than build the summary table yet.
Reason: fastest path to a usable dashboard; data only changes every ~15 min.
Tradeoff: stopgap — the heavy query still runs every 2 min. Tracked as Phase 4.

## Commit Readiness

- Ready to commit: yes.

---

# Phase 1 — v1 Dashboard Slice

Date:
2026-06-25

Status:
Completed

Prompt:
— (predates prompt system)

Git Commit:
f34b90f

## Goals

- Confirm the live `util.app_run_logs` schema, then scaffold a thin vertical slice.

## Built

- `db/pg-pool.js`, `db/queries.js`, `lib/runs.js`, `lib/staleness.js`,
  `config/schedules.js`, `server.js`, `index.js`, `public/index.html`,
  `docker-compose.yaml`, `.env.example`.
- Endpoints: `/api/jobs/latest`, `/api/errors`, `/api/runs/:run_id`, `/healthz`.

## Schema Facts Confirmed (live DB)

- `verbose_log`/`warn_error_logs` are `json` (not jsonb/text).
- `inserted_at timestamptz default now()` exists with a DESC index; table is
  range-partitioned by month (filter `inserted_at` to prune).
- Only 4 apps currently write to the DB.
- Job = `verbose_log->0->'note'->'argv'->>2`; `data_acquisition` has none → `(default)`.

## Important Decisions

### Stack: Node + Express + pg-promise + static vanilla JS

Decision: Option A from `docs/proposed-architecture.md`.
Reason: matches the suite, smallest footprint, fastest to ship.
Tradeoff: manual UI; a richer frontend can come later behind the same API.

## Commit Readiness

- Ready to commit: yes.

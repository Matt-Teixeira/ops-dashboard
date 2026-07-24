# Code Review Handoff — UX Implementation, Phases 20–28 (2026-07-21)

A self-contained briefing for Claude Code or another automated reviewer. This is a
**post-implementation review** of the changes produced from the 2026-07-21 UX audit.
Review the implementation for correctness, security, query behavior, accessibility,
and whether it actually closes the original findings. **Do not change code in this
round.** Return findings and a commit-readiness verdict.

---

## 1. Repository and review baseline

- Repository: `/opt/apps/ops-dashboard`
- Branch: `main`
- Baseline commit: `547999bf3f74c617dec94c9411222502dd60bcbb`
- Review target: the **uncommitted working-tree delta** from that commit, including
  the new untracked implementation/test files listed below.
- No implementation commit has been created yet. Use both `git diff` and
  `git status --short`; `git diff` alone will omit the new files.
- The production-like service on port 8080 was deliberately not restarted or
  modified. Validation used an isolated app on port 18080; that disposable app and
  browser were removed after testing. Therefore, port 8080 is not visual evidence of
  this working-tree implementation.

The original independent UX audit is:

- `notes/review_handoff_ux_review_2026-07-21.md`
- `notes/ux-review-2026-07-21/README.md`
- `notes/ux-review-2026-07-21/` (18 before-change screenshots and `tour.js`)

Those artifacts are evidence/input, not implementation changes. The screenshots show
the pre-Phase-20 UI and must not be treated as screenshots of the current worktree.

## 2. What was implemented

Nine prompts were implemented sequentially. Before each phase, the next prompt was
re-evaluated against the current code and live data, then narrowed or clarified as
needed. The authoritative requirements are `prompts/prompt_20_*.txt` through
`prompts/prompt_28_*.txt`; outcomes and measured evidence are in
`markdown/PHASE_LOG.md`.

| Phase | Implementation outcome |
|---|---|
| 20 | **Connectivity freshness truth.** Preserve the raw latest result, but derive current ONLINE/OFFLINE/UNKNOWN only while the producer record is within a source-backed 45-minute checked-at budget (30-minute cadence + 15-minute grace). Older records become STALE history and rollups reconcile current states separately. |
| 21 | **Incident triage controls.** Producer-confirmed active states (`open`, `recurring`, `acknowledged`) sort ahead of `resolved`/`suppressed`; severity, state, and count-backed category filters compose, reset cleanly, and preserve oracle provenance. |
| 22 | **Dense-feed disclosure.** Dashboard errors and incident events paint 25 bounded first-line previews, disclose full text per row, and reveal 25 more rows at a time. Shown/fetched/occurrence totals remain distinct; healthy-empty and request-failure states differ. |
| 23 | **Large-list controls.** Connectivity, Systems, and Acquisition use scoped filters, sticky headers, and 50-row client-side slices over complete responses. App runs retain server keyset paging; their search is explicitly limited to already-loaded run id/job type rows. |
| 24 | **Incident list scaling.** The list endpoint now returns an eight-field lean projection in 100-row pages with an opaque validated keyset cursor over activity rank, severity rank, `last_seen DESC NULLS LAST`, and id. Detail remains complete. UI paging deduplicates and rejects stale responses after filter changes. |
| 25 | **Route-aware chrome.** A pure nine-route registry owns title, source label, active parent navigation, refresh target, breadcrumbs, validated return context, and legacy deep-link fallback. Request generations prevent old routes from repainting current chrome. |
| 26 | **Status/time semantics.** Latest status and 24-hour health are labeled as different scopes; relative `<time>` values scale through years while retaining exact timestamps. Broad row tinting became narrow exception markers/textual badges, and zero-count controls are disabled. |
| 27 | **Native accessibility.** Sort and disclosure interactions are native buttons inside semantically intact tables; all nine tables have captions and scoped headers; selected filters remain operable; keyboard focus, cadence help, and polite loading status are visible/reachable. |
| 28 | **Responsive/final polish.** Every table has a focusable local overflow container; narrow controls wrap without whole-page overflow; three UUID displays use compact text while retaining the full href/title/accessible name; promoted note keys are not repeated; an adaptive SVG favicon was added. |

Important nuance: Phase 26 did **not** change an app group’s latest status to equal its
24-hour health. It made the two scopes explicit. Judge whether that is sufficient to
close original finding F7 or merely reduces its ambiguity.

## 3. Files in scope

Tracked files modified from the baseline:

```
db/queries.js
docs/connectivity-schema.md
lib/connectivity.js
lib/incidents.js
markdown/ARCHITECTURE_PRINCIPLES.md
markdown/PHASE_LOG.md
markdown/PROMPTS.md
public/grid-view.js
public/index.html
server.js
test/connectivity.test.js
test/grid-view.test.js
test/incidents.test.js
```

New implementation and test files (untracked until committed):

```
public/favicon.svg
public/feed-view.js
public/list-view.js
public/routes.js
public/time-view.js
test/feed-view.test.js
test/list-view.test.js
test/routes.test.js
test/time-view.test.js
prompts/prompt_20_connectivity_freshness_truth.txt
prompts/prompt_21_incident_triage_controls.txt
prompts/prompt_22_dense_feed_disclosure.txt
prompts/prompt_23_large_list_controls.txt
prompts/prompt_24_incident_list_scaling.txt
prompts/prompt_25_route_aware_chrome.txt
prompts/prompt_26_status_time_semantics.txt
prompts/prompt_27_table_accessibility.txt
prompts/prompt_28_responsive_polish.txt
```

Skim the prompts/logs for requirement accuracy, but concentrate review effort on the
DB/query, shaping, API, frontend, and test files.

## 4. Hard constraints to verify

1. **Read-only and least privilege.** These phases must introduce no write or DDL
   path. Normal service access remains `ops_dashboard_ro`; no grant or credential
   change was intended.
2. **Partition pruning and detoast discipline.** Time-windowed
   `util.app_run_logs` queries must filter `inserted_at`. Heavy `verbose_log` work
   must remain off request paths except the already accepted, bounded 50-row
   data-acquisition job-type extraction.
3. **Input validation.** Severity/state/category/cursor/return-context inputs must
   fail closed and stay parameterized. Client-provided cursor data must never become
   interpolated SQL.
4. **API compatibility.** Additive metadata is acceptable. Existing detail payloads,
   deep links, app-run keyset paging, oracle provenance, and raw connectivity status
   must remain available.
5. **Dependency-free frontend.** Vanilla JS, native elements, safe `textContent`, and
   light/dark `color-scheme` are deliberate. No framework or external asset was added.
6. **Honest completeness.** Client-only filtering is allowed only where the response
   is understood to be complete. App-run search must continue to say “loaded” and
   must not imply it searches server history.
7. **No hidden operational truth.** Responsive containment may scroll wide tables,
   but must not remove critical columns. Compact identifiers must retain exact values
   in navigation/state and an operator-accessible full representation.

## 5. Highest-risk review areas

### A. Incident keyset pagination (highest technical risk)

Review `db/queries.js`, `lib/incidents.js`, `server.js`, and the incident UI together.
Verify that:

- SQL `ORDER BY` and cursor predicate are exact mirrors, including active/inactive
  rank, severity rank, descending `last_seen`, descending id, and NULL handling.
- A page boundary containing equal timestamps cannot skip or duplicate ids.
- Cursor decode validates shape, ranks, ISO timestamp, and bigint-compatible id;
  malformed or tampered values return a generic 400 and never reach SQL unsafely.
- `limit + 1`, `nextCursor`, default/clamped sizes, lean list shaping, and full detail
  shaping agree.
- Category/severity/state filter changes reset paging and invalidate delayed page
  responses; concurrent load-more requests cannot duplicate rows.
- Rollup totals are global/filter facets as labeled, while page counts are loaded-page
  counts. Look for any UI claim that confuses the two.

Measured before/after evidence recorded during implementation: the old 529-row list
was 745,259 bytes; a 100-row lean page was 19,769 bytes (97.3% smaller). EXPLAIN was
~2.0 ms for page one and ~1.2 ms for the next page on the staging data. Do not accept
those measurements as proof of cursor correctness—review the predicate directly.

### B. Connectivity truth model

Review whether `inserted_at` is truly the right “checked at” clock versus
`capture_datetime`, whether the 45-minute HHM/MMB budget matches the documented
producer behavior, and whether unknown/missing sources correctly become STALE rather
than accidentally ONLINE/OFFLINE. Confirm:

- raw producer result remains exposed separately from derived operational state;
- rollup totals reconcile exactly;
- sort order is current OFFLINE, UNKNOWN, ONLINE, then stale history;
- future skew, invalid dates, nulls, and Date objects are handled defensively; and
- UI labels/tooltips do not imply stale success is current connectivity.

### C. Frontend state and race safety

`public/index.html` remains a large vanilla-JS controller. Exercise rapid route
changes, refresh during loading, filter changes during incident load-more, auto-refresh
while in a detail route, and back/return links. Look for stale request completions that
can repaint hidden views, global title/source/meta, or the wrong route.

The pure helper tests do not execute the DOM controller. Treat browser race coverage
as important, especially `runReq`, incident page generations, and global
`currentRefresh` ownership.

### D. Accessibility and disclosure semantics

Check with keyboard and DOM inspection, not screenshots alone:

- Sort buttons remain children of `th scope="col"`; group disclosure remains a real
  button in a normal row/cell. No clickable row with `role=button`/`role=link` should
  remain.
- Every rendered table has a useful caption and scoped headers.
- `aria-sort`, `aria-expanded`, `aria-pressed`, disabled zero filters, focus-visible
  styles, polite loading status, and show-more count text update correctly.
- Collapsing/expanding groups and full-message disclosures preserve focus and do not
  create duplicate ids or inaccessible content.
- A horizontally scrollable table wrapper is keyboard-focusable and has an adequate
  accessible name without producing noisy duplicate announcements.

### E. Content safety and identifier fidelity

All producer-controlled messages, note objects, ids, categories, and labels should be
inserted with `textContent` or validated URL construction. Scrutinize the new note
formatter for arrays, nested objects, circular/unserializable values, unusual scalar
values, and prototype-related keys. Unknown fields must not be silently discarded.

Compact UUID text appears in the grid, data-acquisition subruns, and app-run table.
The implementation preserves the full value in href, title, and accessible name, but
adds no dedicated “copy UUID” button. Decide whether link-copy/title/accessibility is
enough to satisfy the prompt’s “copy behavior” requirement; report partial closure if
an operator cannot conveniently copy the bare UUID.

### F. Responsive and visual regression

At 390px, verify the document itself does not scroll horizontally, while every wide
table still scrolls locally and exposes every column. Check sticky headers inside the
overflow container, visible wrapper focus, label/control association, chip wrapping,
and page zoom. Recheck 1440px light/dark density so mobile CSS did not make desktop
controls or tables excessively tall.

`body { overflow-x: hidden; }` is present as a containment backstop. Do not let it mask
an actually unreachable overflowing control or focus outline—inspect scroll widths and
keyboard access inside each view.

## 6. Original finding closure questions

Return a closure verdict for every original finding from
`notes/review_handoff_ux_review_2026-07-21.md`:

| Finding | Expected disposition to verify |
|---|---|
| F1 — error-feed wall | Expected closed by Phase 22 bounded preview + 25-row disclosure. |
| F2 — large tables/incident controls | Expected closed across Phases 21, 23, and 24; verify completeness labels and pagination semantics. |
| F3 — indiscriminate row tint | Expected closed by Phase 26 edge-marker/text policy. |
| F4 — stale global header/refresh | Expected closed by Phase 25 route registry and request guards. |
| F5 — navigation/title/back | Expected closed by Phase 25; verify direct/legacy/unsafe deep links. |
| F6 — age formatting | Expected closed by Phase 26 seconds-through-years `<time>` formatting. |
| F7 — contradictory latest vs 24h status | Intentionally addressed through explicit scope labels, not status merging. Judge closed vs partial. |
| F8 — polish bundle | Split across Phases 22, 26, 27, and 28. Review each sub-item; especially UUID copy access and mobile containment. |

Also report any regression to the qualities the original audit praised: instant cached
grid loads, persisted grid view state, cadence honesty, oracle provenance, dark mode,
native keyboard behavior, and zero console errors.

## 7. Validation already completed

- `node --test`: **138/138 pass** in `node:lts`.
- All `public/*.js` files and the inline app script compile successfully.
- `git diff --check`: pass.
- Browser smoke visited all nine route families with no page/console errors. Every
  visible table was named, used scoped headers, and lived in a local overflow wrapper;
  active parent navigation matched the route.
- Responsive browser assertions passed at 390×844, 768×900, and 1440×900 in light
  and dark mode: no body overflow, local table overflow, visible wrapper focus, exact
  full UUID link fidelity, and favicon HTTP 200.
- Live/API checks during phases included connectivity schema/timestamp sampling,
  incident state/category diversity, two exact 100-row cursor pages with zero
  duplicates, an equal-`last_seen` boundary, and query EXPLAINs. Details and measured
  values are in the Phase 20–28 entries in `markdown/PHASE_LOG.md`.

These checks are evidence, not a substitute for independent review.

## 8. How to reproduce safely

The host does not have Node installed; use disposable containers. Do not restart the
service on port 8080.

Run the complete test suite:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
```

Start an isolated copy of the current worktree on host port 18080, using the existing
read-only environment and shared dependency cache:

```bash
docker run -d --rm --name ops-dashboard-review \
  --user 105:987 --network pg_net --env-file .env \
  -e HOME=/tmp -e PORT=8080 -p 18080:8080 \
  -v "$PWD":/workspace -w /workspace \
  -v /opt/resources/node_mod_cache/ops-dashboard:/workspace/node_modules \
  -v /opt/run-logs/ops-dashboard:/opt/run-logs/ops-dashboard \
  -v /opt/resources/ssl:/opt/resources/ssl:ro \
  node:lts node index.js serve

curl -fsS http://127.0.0.1:18080/healthz
# The cached grid can briefly return 503 while its initial snapshot warms.

docker stop ops-dashboard-review
```

Useful routes:

```
http://127.0.0.1:18080/
http://127.0.0.1:18080/#connectivity
http://127.0.0.1:18080/#acq-systems
http://127.0.0.1:18080/#systems
http://127.0.0.1:18080/#incidents
http://127.0.0.1:18080/#appruns=data_acquisition
```

Follow native links from those views to exercise run, system, and incident detail
routes with real identifiers. Use only GET/read-only checks. If reproducing browser
captures, write them to a new temporary directory; do not overwrite the original
before-change evidence.

## 9. Out of scope / intentional choices

- Do not implement fixes during this review.
- Do not relitigate Node/Express/pg-promise/vanilla JS or propose a framework rewrite
  merely because `public/index.html` is large.
- No authentication redesign, mobile card conversion, incident-engine write-back,
  alerting/paging workflow, pipeline schema change, or hidden critical columns.
- Client-side 50-row progressive rendering for complete-response views is deliberate;
  virtualization is not required at the current measured volumes.
- Fetching 100 error/event records while initially rendering 25 is deliberate and
  bounded; disclosure is a presentation concern, not server pagination in this phase.
- The incident table is small enough that its measured plan uses a sequential scan +
  top-N sort; do not demand an index without evidence of a present performance issue.
- Oracle-derived incident categories remain hints/provenance, never diagnoses.
- Existing original-review artifacts are untracked and must be preserved.

## 10. Requested review output

1. **Findings first**, ordered blocker/high/medium/low. For each: severity,
   `path:line`, concrete trigger and impact, and the smallest house-style fix.
2. **F1–F8 closure matrix:** `CLOSED`, `PARTIAL`, `NOT CLOSED`, or `REGRESSED`, with
   one evidence-backed sentence each.
3. **Phase verdicts:** identify any Phase 20–28 prompt requirement that is not fully
   implemented or whose recorded validation overclaims the behavior.
4. **Test gaps:** only gaps tied to a credible failure mode; distinguish unit-test
   gaps from browser/integration gaps.
5. **Commit decision:** `ready to commit` or `needs fixes`, with the minimum blocking
   set. Bias toward a few high-confidence findings rather than speculative nits.


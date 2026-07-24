# Code Review Findings — UX Implementation, Phases 20–28 (Claude, 2026-07-21)

Independent post-implementation review of the uncommitted working-tree delta from
baseline `547999bf`, per `notes/review_handoff_ux_implementation_phases_20_28_2026-07-21.md`.
No code was changed. Method: full read of the backend delta (queries/incidents/
connectivity/server), three parallel deep-reads of the frontend (controller, helper
modules, prompt-vs-code phase verification), `node --test` in `node:lts`
(**138/138 pass, reproduced**), and live API exercise against an isolated copy of this
worktree on port 18080 (container removed afterward; port 8080 untouched).

Independently verified positives before the findings: the incident keyset predicate is
an exact mirror of its ORDER BY (null-timestamp branch and equal-timestamp `id DESC`
tiebreak included) — a full cursor walk returned 529/529 unique rows over 6 pages with
zero ordering violations and rollup total reconciling; the connectivity API reconciles
exactly (200 CURRENT / 339 STALE, sort OFFLINE→UNKNOWN→ONLINE→STALE, no
current-but-over-budget rows); the 45-minute budget is genuinely source-backed
(producer cron at :15/:45 and :22/:52; producer's own 45-minute stale report); no
write/DDL/grant path anywhere in the delta; no injection path (all inputs
parameterized); the only `innerHTML` use is a constant `""`; all producer strings flow
through `textContent`.

## 1. Findings (ordered)

### HIGH

**H1 — Refresh button permanently disables itself if the user navigates during an
in-flight refresh.** `public/index.html:2044-2049`. The click handler captures
`handler = currentRefresh`, disables the button, and re-enables only
`if (handler === currentRefresh)` in `finally`. `route()` (2028-2042) reassigns
`currentRefresh` on every hashchange, so navigating to any other view while a refresh
is in flight fails the guard, and nothing else ever re-enables the button — a disabled
button can't be clicked, so the primary refresh control is dead ("refreshing…") until a
full page reload. Trigger: click refresh on any view, click a nav link before the fetch
settles. Smallest fix: re-enable unconditionally in `finally` (the disabled state
already prevents concurrent button-initiated refreshes, so the guard protects nothing).

### MEDIUM

**M1 — Phase 28's overflow wrappers likely defeat Phase 23's sticky headers.**
`public/index.html:18` (`thead th { position: sticky; top: 0 }`) vs `:65`
(`.table-scroll { overflow-x: auto }`). With `overflow-x: auto`, `overflow-y` computes
to `auto` as well, making the wrapper the header's nearest scrollport; the wrapper has
no bounded height and never scrolls vertically, so headers no longer stick during
normal page scroll. This silently reverts a Phase 23 deliverable; the Phase 28 log's
"intact sticky/caption semantics" claim is an overclaim for the sticky half. Confirm in
a browser; standard fix is a `max-height` on `.table-scroll` (making it the real
vertical scroller) for the tall tables.

**M2 — Active grid status chips still carry the light-mode-invisible white ring the
Phase 27 prompt explicitly ordered fixed.** `public/index.html:62`
(`.chip.active { box-shadow: 0 0 0 2px #fff6 }`, specificity 0,2,0) overrides the new
`button[aria-pressed="true"] { box-shadow: 0 0 0 2px #1565c0 }` (`:31`, 0,1,1). Tiles
were fixed (`:92`); chips were not — only the opacity change distinguishes them in
light mode. The Phase 27 log's "focus/selection styling works in both schemes" is an
overclaim. Fix: use the `#1565c0` ring in `.chip.active` (or drop its box-shadow so
line 31 applies).

**M3 — Disabling zero-count chips can trap an active, persisted grid filter.**
`public/index.html:519` sets `btn.disabled = count === 0` even when the chip is active.
If an operator filters on ERROR and a later auto-refresh drops the error count to 0,
the chip is disabled while still `aria-pressed="true"` and still filtering; the grid
shows "showing 0", chips have no clear-filters control, and `gridView.statuses`
persists in localStorage across reloads. Fix: `btn.disabled = count === 0 && !active`.

**M4 — Array-valued producer notes now render as `[object Object]` — a regression
from baseline.** `public/feed-view.js:60`:
`if (typeof note !== "object" || Array.isArray(note)) return String(note)`. Baseline
(`547999bf` `index.html` noteText) fell through to `JSON.stringify(note)` for arrays,
showing full content. Verified: `noteText([{code:1}])` → `"[object Object]"`. Violates
the handoff's "unknown fields must not be silently discarded" constraint. Fix:
`JSON.stringify` arrays.

**M5 — The 503 warm-up retry loop and the dashboard error path repaint other routes'
chrome, contradicting the Phase 25 route-ownership claim.** `public/index.html:232-235`
writes `#meta` = "· warming up, retrying…" and reschedules itself every 3s with no
route/visibility guard (each refresh during warm-up also spawns a parallel retry
chain); `:730` writes `#meta` = "· error: …" unguarded. Trigger: open during cache
warm-up (or a failing dashboard refresh), navigate to `#incidents`; the current route's
meta label is repeatedly clobbered. Fix: guard both writes (and the retry) on the
dashboard being the active route, mirroring `renderSummary`'s gate at `:497`.

**M6 — The return-to-dashboard summary restore is dead code; meta stays "· Dashboard"
after navigating back.** `public/index.html:2025` calls `renderSummary` from
`applyChrome` to restore "· N jobs · last Xd · …", but `route()` runs `applyChrome`
(2031) before `showDashboard()` unhides the section (2040), and `renderSummary`'s meta
write is gated on `!dashboard.hidden` (`:497`). The restore is a no-op in exactly the
case it targets; meta stays generic until the next grid fetch (up to 120s, or forever
with auto-refresh off). Fix: unhide before applying chrome for the dashboard route (or
gate on the active route instead of DOM hidden state).

**M7 — The incidents category `<select>` is keyboard-hostile: each change wipes and
refetches the whole view, destroying the focused control.** `public/index.html:1714-1717`
→ `showIncidents()` → `connMessage(view, …)` (1821) replaces the view contents
including the select. On Windows/Linux browsers `change` fires on every arrow-key step,
so a keyboard user gets one refetch + focus dropped to `<body>` per step and cannot
traverse the option list. (Tiles and filter buttons share the destroy-on-activate
pattern with less impact.) Fix: keep the filter controls in a persistent container
outside the re-rendered region, or restore focus after render.

**M8 — Tampered incident cursors can return 500 instead of the contract's generic
400.** `lib/incidents.js:116-127`. Decode validates the timestamp with `Date.parse`
and the id with `/^\d{1,20}$/`, then passes the raw values to `$7::timestamptz` /
`$8::bigint`. Verified live on 18080: a crafted cursor with `t: "-000001-01-01T00:00:00Z"`
(JS-parseable, PG-unparseable) → **500**; `i: "99999999999999999999"` (20 digits >
bigint max) → **500**; a non-ISO RFC-1123 date is accepted (200), violating the
"validates ISO timestamp" spec. Parameterized throughout, so no injection — this is a
fail-closed contract violation only. Fix: normalize `t` on decode via
`new Date(Date.parse(t)).toISOString()` and bound `i` with `BigInt(i) <=
9223372036854775807n` (or cap at 19 digits), rejecting otherwise.

**M9 — The data_acquisition inline-runs disclosure is still an `<a href="#">` acting
as a button.** `public/index.html:271-275`. Announced as a link, no `aria-expanded`,
Space doesn't activate, and middle-click navigates to `#`. Pre-existing pattern, but
the Phase 27 prompt/log claim "disclosure interactions are native buttons" is
overstated — the group-head disclosure was converted (`:297-306`); this one was missed.
Fix: same `<button>` conversion as the group-head toggle.

### LOW

**L1 — `.table-scroll` accessible name sits on a role-less div.**
`public/index.html:121,131,175`. `aria-label` on `role=generic` is prohibited by ARIA
and unreliably exposed; focusable tab stops may be unnamed. Fix: `role="region"` (or
`group`) on the wrapper.

**L2 — "Polite loading status" regions are created pre-populated, so many screen
readers won't announce them.** `renderRunMessage` (:856-864), `connMessage`
(:1252-1259) insert a fresh `role="status"` node with text already set. Fix: one
persistent status element per view, updated in place.

**L3 — Show-more/load-more re-renders drop keyboard focus to `<body>`, and the error
feed's show-more collapses any open full-message disclosures.** e.g.
`public/index.html:656-663, 824-832, 1085-1091, 1796-1802, 1985-1990` (full
tbody/list re-render destroys the activated button). Per-row disclosures themselves
preserve focus correctly. Fix: append rows instead of re-rendering, or refocus.

**L4 — `SORT_KEYS` still contains the removed `"age"` column.**
`public/index.html:186`. A persisted `sortKey: "age"` still validates, silently sorts
by an invisible column, and `aria-sort` appears on no header. Fix: drop `"age"` (and
migrate persisted values to the default).

**L5 — Incidents sub-line juxtaposes the global total with filtered paging text.**
`public/index.html:1681-1683`: "N loaded · M total incidents · end of matching rows",
where M comes from the unfiltered rollup — with a filter active this invites reading M
as the match total, which is shown nowhere. Fix: label as "M incidents overall" or add
the matching count.

**L6 — Truncation warning coupled to a hardcoded sentinel.** `public/index.html:1421`
detects the systems cap via `length === 500`, silently tied to the server default
(`db/queries.js:315`). Fix: return a `truncated`/`limit` field from the API.

**L7 — `noteText` edge losses beyond M4.** `public/feed-view.js:61-65`: when
`system_id` is promoted, a distinct `sme` value is deleted without being displayed
(baseline showed both); falsy promoted keys (`""`/`0`) are dropped entirely;
non-scalar promoted values mangle to `[object Object]` in the head;
`JSON.stringify(rest)` throws on circular/BigInt input (unreachable from JSON APIs
today, but the helper is exported unguarded). Fix: keep promoted keys in the JSON
tail (Phase 28's "not repeated" ask only covers the values actually shown), and wrap
the stringify.

**L8 — Late background repaints bake the wrong `from=` context into grid/feed
links.** `public/index.html:699-704` read `activeRoute` at render time; a refresh
completing after navigation re-renders the hidden grid with the new route's `from`
token, shown on return (until the next repaint). Fail-closed via `Routes.safeFrom`;
cosmetic-stale back links only.

**L9 — Time formatting rounding is aggressive at unit switches and the years
boundary.** `public/time-view.js:2`: 90s → "2m", 90m → "2h" (a 33% overstatement —
"1m/1h/1d" are never rendered); `d=3632..3649` renders "10.0y" then "10y". Tests pin
this, so it reads as intentional — flagging for a conscious sign-off since "2h since
last run" vs "1.5h" can shade triage urgency. Also `instant()` rejects numeric epoch
input (all current callers pass strings/Dates).

**L10 — routes.js/time-view.js and their tests are written in a dense single-line
style alien to this repo.** `public/routes.js:7` packs four route families' parsing
into one ~1,000-char line; `feed-view.js`/`list-view.js` in the same delta follow the
house commented style. Maintainability/diff-review cost; the CLAUDE.md working
agreement says match existing style.

**L11 — UUID "copy behavior" is only indirectly satisfied.** `public/index.html:176`
(`compactRunLink`): full UUID lives in `href`/`title`/`aria-label`, but selecting the
visible text copies the 8-char form and no copy affordance exists; the bare UUID is
copyable only via copy-link-address or the run-detail page. Partial closure of the
Phase 28 requirement — acceptable if consciously accepted; a small copy button (or
`user-select` trick) would close it fully.

## 2. F1–F8 closure matrix

| Finding | Verdict | Evidence |
|---|---|---|
| F1 error-feed wall | **CLOSED** | 25 bounded first-line previews + per-row disclosure + 25-row show-more, honest shown/fetched/occurrence counts (`feed-view.js`, `index.html:619-663`); note-rendering regression M4 is adjacent but doesn't reopen the wall. |
| F2 large tables / incident controls | **PARTIAL** | Filters, caps, category facets, and verified duplicate-free keyset paging land across Phases 21/23/24, but the sticky-header sub-item is likely reverted by the Phase 28 wrappers (M1). |
| F3 row tinting | **CLOSED** | Full-row backgrounds replaced by 3px left-edge markers (`index.html:34-35`) with narrower predicates (connectivity marks only current OFFLINE). |
| F4 stale header/refresh | **PARTIAL** | Route-owned chrome and per-route refresh work on the main paths, but the 503-warmup/error paths still clobber meta (M5), the dashboard-return restore is dead (M6), and the refresh control can now permanently disable itself (H1) — a new regression on this exact surface. |
| F5 navigation/title/back | **CLOSED** | Nine-route registry with `aria-current`, per-route `document.title`, validated `from` return context failing closed to the parent (verified incl. `javascript:`/URL payloads); only cosmetic stale-`from` caveat L8. |
| F6 age formatting | **CLOSED** | Seconds-through-years `<time>` with exact ISO+local title (`time-view.js`, boundary-pinned tests); rounding nit L9. |
| F7 latest vs 24h contradiction | **PARTIAL** | Scopes are now explicit ("Latest status" vs "24h health: N/M err") exactly as Phase 26's prompt ordered ("do not overwrite one with the other"), so it's prompt-compliant — but the original ask (group rollup reflecting 24h health) was deliberately not done; the juxtaposition remains, now honestly labeled. |
| F8 polish bundle | **PARTIAL** | Favicon ✔, UUID compaction ✔ (copy access partial, L11), appruns active filter now operable ✔, note key dedup ✔ (with M4/L7 losses), incident-detail event paging ✔, mobile containment ✔ — but the light-mode active-chip indicator was not fixed (M2) and the zero-chip handling introduced a new trap (M3). |

Praised qualities: no regression found to instant cached grid loads, persisted grid
view state, cadence honesty (now visible text, better than title-only), oracle
provenance (carried through both projections and both renderers), dark mode, or
native keyboard behavior on tables — except the new H1/M7 interaction issues noted
above. Browser console cleanliness was not re-verified this round (code-level review
plus API exercise only).

## 3. Phase verdicts

- **20 Connectivity freshness — FULLY IMPLEMENTED.** Budget evidence verified against
  the producer repo (cron :15/:45 and :22/:52; 45-min report); boundary tests exact
  (44:59 vs 45:00); live reconciliation exact. `inserted_at` over `capture_datetime`
  is correct (failed upserts refresh only `inserted_at`). Rollup key meaning change
  (`offline` now current-only) is additive-in-shape but semantic — disclosed in the log.
- **21 Incident triage — FULLY IMPLEMENTED.** Activity-first ordering mirrors the
  engine's lifecycle; category facet count-backed and reconciling; filters compose and
  reset; provenance preserved.
- **22 Dense-feed disclosure — FULLY IMPLEMENTED**, with M4/L7 as quality defects in
  the new note formatter rather than missing requirements.
- **23 Large-list controls — FULLY IMPLEMENTED**, but its sticky-header deliverable is
  likely regressed by Phase 28 (M1).
- **24 Incident list scaling — FULLY IMPLEMENTED.** Cursor walk verified live
  (529/529, zero dupes/violations, equal-timestamp boundary present); M8 is a
  fail-closed edge, not a pagination defect.
- **25 Route-aware chrome — PARTIAL.** Registry, titles, `aria-current`, validated
  return context, and the `runReq` generation guards for view bodies are correct, but
  the chrome-ownership claim doesn't hold on the 503/error paths (M5), the
  dashboard-return restore is dead (M6), and the new refresh dispatcher introduced H1.
- **26 Status/time semantics — FULLY IMPLEMENTED.** Not merging latest status with 24h
  health is what the prompt ordered — judge F7 PARTIAL by design, not by omission.
  Leftover: `SORT_KEYS` "age" (L4).
- **27 Table accessibility — PARTIAL.** Tables/captions/scoped headers/sort buttons/
  operable filters all land, but the prompt's high-contrast selected-state requirement
  is missed for grid chips (M2, log overclaims), the DA disclosure anchor remains (M9),
  and the select/live-region patterns undercut keyboard/SR claims (M7, L2).
- **28 Responsive polish — PARTIAL.** Containment, wrapping, favicon, and UUID
  compaction land, but "copy behavior" is only indirect (L11) and the wrappers likely
  regress sticky headers (M1, log overclaims "intact sticky semantics").

Recorded-validation overclaims found: Phase 25 "request generations prevent old routes
from repainting current chrome" (view bodies yes, `#meta` no); Phase 27 "focus/selection
styling works in both schemes" and "disclosure interactions are native buttons";
Phase 28 "intact sticky/caption semantics" (captions yes, sticky doubtful). All other
code-checkable log claims held up, including the 97.3% payload reduction being
plausible (100-row lean page ≈19.8KB) and 138/138 tests.

## 4. Test gaps (credible failure modes only)

Unit gaps:
- `noteText` is tested only with flat scalar objects — an array-note test would have
  caught the M4 regression; add array, nested, falsy-promoted, and `system_id`+`sme`
  cases (`test/feed-view.test.js:35-42`).
- Cursor decode lacks non-ISO-but-`Date.parse`-valid timestamps and >bigint ids —
  would have caught M8 (`test/incidents.test.js`).
- `fromHref` slice arithmetic is tested only for the `incident:` prefix; `appruns:`/
  `system:` round-trips untested — an off-by-one would pass the suite
  (`test/routes.test.js`).

Browser/integration gaps (the pure-helper suite cannot see these by design):
- Refresh-button + navigation race (H1) and the 503-warmup chrome clobber (M5) — both
  live purely in the DOM controller.
- Sticky-header behavior inside the new overflow wrappers (M1) — needs a real
  scroll-context check; the recorded Playwright pass did not actually assert stickiness
  during page scroll.
- Keyboard traversal of the incidents category select (M7) and live-region
  announcement behavior (L2) — need AT/keyboard verification.

## 5. Commit decision

**Needs fixes.** Minimum blocking set: **H1** (a primary control can permanently
disable itself on a routine interaction), **M1** (silent revert of a shipped phase
deliverable — or a browser check proving it still works), **M2** (explicit Phase 27
prompt requirement, missed, with an overclaiming log), **M4** (behavioral regression
against a hard handoff constraint on producer-data fidelity), and **M8** (reproducible
500s from tampered cursors violate the handoff's hard fail-closed contract — §4.3/§5.A
require a generic 400; the fix is two lines in `lib/incidents.js` decodeCursor). M3
and M5-M7/M9 are strongly recommended in the same fix round but are judgment calls,
not blockers; L-items can trail. M8 is the one backend defect in the blocking set —
the rest of the backend work (Phases 20, 21, 24 query/shaping layers) is
commit-quality as-is, and all other blocking items are frontend-local, so the fix
round should be small.

*Amended 2026-07-21 after Codex cross-review: M8 promoted into the blocking set, and
the earlier "every blocking item is frontend-local / backend commit-quality as-is"
wording corrected — M8 is server-side validation in `lib/incidents.js`.*

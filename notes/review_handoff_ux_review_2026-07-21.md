# Review Handoff — UX/UI Critique of the Deployed Dashboard (2026-07-21)

A briefing for an automated reviewer. Unlike the phase handoffs, the artifact under
review is **not code** — it is a set of UX/UI findings produced by walking through
the deployed app as a user. Your job is to independently verify, dispute, deepen,
and extend these findings. Nothing has been changed in the app; there is no diff.

---

## 1. How the findings were produced

The deployed app (`ops-dashboard-app-1`, `http://localhost:8080`, live staging data)
was driven with headless Chromium (Playwright in a `node:22` container on the host
network). All 9 hash-routed views were visited in light and dark mode at 1440×900
and one mobile width (390×844), with interactions exercised (search, group-by,
status chips, group collapse, data_acquisition run expansion, chip active state).
Zero console errors were observed on any view.

Data volume at capture time: 26 jobs, 528 incidents, 539 connectivity rows
(109 OFFLINE), 210 systems with recent issues, 100-event error feed.

Evidence: `notes/ux-review-2026-07-21/` — 18 screenshots indexed by its README,
plus `tour.js`, the exact Playwright script that produced them. To reproduce:

```
docker run -d --name ux-browser --network host \
  -v $(pwd)/notes/ux-review-2026-07-21:/work -w /work node:22 sleep 3600
docker exec ux-browser bash -c 'npm i playwright && npx playwright install --with-deps chromium'
docker exec ux-browser node /work/tour.js   # writes shots to /work/shots
docker rm -f ux-browser
```

## 2. The findings under review

Overall thesis: **the UI was designed for tens of rows and the production data is
now hundreds** — the information design hasn't kept up with the data volume. The
fundamentals (speed, a11y roles, persisted view state, zero console errors) are good.

### F1 — Error feed makes the front page ~15,500px tall (high)

`public/index.html` `loadErrors()` renders 100 WARN/ERROR events with full
multi-line stack traces inline (`err-msg` cell, `white-space: pre-wrap`). With real
data the dashboard's second section is a wall of red monospace dozens of screens
tall. Evidence: `01b-dashboard-full.png`.
Proposed: first line of `err_msg` only + click-to-expand; cap feed at ~25 with
"show more".

### F2 — Big tables lack cap, sticky header, filter, and pagination (high)

- Connectivity: all 539 rows, no search/filter/sort; ONLINE rows unreachable below
  109 OFFLINE rows; `Error` and `Phase` columns were "—" on every visible row
  while the real signal sits in `Detail`. Evidence: `05-connectivity.png`.
- Incidents: all 528 rows rendered; visible page is dozens of identical
  `high · open · rsync_io_timeout` rows differing only by SME id. The API supports
  `category` filtering (`filters.category` in the response) but the UI never
  exposes it. No grouping by category despite the incident detail's own assessment
  ("66 entities share this fingerprint — fleet-wide") proving the data supports it.
  Evidence: `08-incidents.png`.
- Systems (210 rows) and per-app run logs: no search, no sticky header.
Proposed: sticky `thead`, per-view text filter, render caps like the drill-down's
`RENDER_CAP`, category rollup/filter for incidents.

### F3 — Red row-tinting has lost its meaning (medium)

`row-ERROR`/`row-WARN` tinting is applied per-row, but on connectivity, systems,
incidents, and hhm run logs **every row qualifies**, so whole tables render pink
and nothing stands out. Evidence: `05-connectivity.png`, `06-systems.png`,
`10-appruns.png`. Proposed: drop tinting where >half of rows would tint (badge
column already carries status).

### F4 — Global header shows stale, view-specific state on subpages (medium)

The `h1` meta ("26 jobs · last 30d · as of … · showing 12") is job-grid state but
persists on every other view; "showing 12" is a leftover grid-filter count and is
actively misleading on the incidents page. The header `refresh` button on subpages
refreshes the hidden dashboard, not the current view. Evidence:
`14-dark-incidents.png` (header says "showing 12" above the incidents list).

### F5 — Navigation: no active state, ambiguous "back", static title (medium)

Nav is three muted links (connectivity/systems/incidents) with no
current-view indication and no explicit dashboard link. `← back` always goes to
`#` even when arriving at a system detail from connectivity (incident detail's
"← incidents" is the one correct example). `document.title` never changes, so
history entries are indistinguishable.

### F6 — Age formatting tops out at hours (medium)

`fmtAge` caps at hours: connectivity shows "20179h" (≈2.3 years) data age; grid
shows "331h". Proposed: day/year units past 48h. Also: "Last run" shows full
timestamps and an Age column; relative-first ("14m ago", title=full) reads faster.

### F7 — Contradictory status signals on the grid (medium)

`data_acquisition` summary row shows SUCCESS (latest run only) directly beside a
red "24h: 940/1152 err" health badge, and its expansion is nearly all-ERROR
sub-runs. Evidence: `03-da-expanded.png`. Proposed: group rollup should reflect
the 24h health it already displays, not just the single latest run.

### F8 — Polish items (low)

- Full UUID run-id link text dominates table width; truncate to 8 chars + title.
- `.chip.active` indicator is a white glow (`#fff6`) — invisible in light mode.
  Evidence: compare `13-dark-chip-active.png` (visible) with light-mode shots.
- Chips read as badges, not clickable filters; "STALE 0" chip renders at zero and
  clicking yields an empty grid.
- Run-log filter (All/Issues/Errors) marks the active button by disabling it —
  reads as unavailable, not selected. Evidence: `10-appruns.png`.
- Drill-down `Detail` cell prints `system:`/`job:` header then the same values
  again as raw JSON. Evidence: `04-run-drilldown.png`.
- Incident detail renders 100 near-identical event rows (~24,000px page).
  Evidence: `09b-incident-detail-full.png`.
- Mobile (390px): tables force horizontal page scroll, controls wrap awkwardly.
  Evidence: `12-mobile-dashboard.png`. (Low priority for an internal tool.)
- No favicon; tab is anonymous.

### Explicitly praised (do not "fix")

Instant loads; zero console errors; view state persisting through refresh
(localStorage); keyboard/ARIA on interactive rows; incidents tile-row
(counts-as-filters); "? CADENCE" honesty marker; oracle-provenance dashed badge;
near-free dark mode via `color-scheme`.

## 3. Scope of this review

The findings above, against the current `main` (clean tree, HEAD `547999b`).
Read `public/index.html` + `public/grid-view.js` (the whole frontend) and
`server.js` for API capabilities the UI under-uses. The app is running; you may
drive it (see §1) or curl the API. **Do not change code** — this is an assessment
review, not a fix round.

## 4. What I most want scrutinized

1. **Are the findings real at today's data volume, or artifacts of a staging
   anomaly?** E.g. if the rsync_io_timeout storm is a transient fleet incident,
   does F2's "group by category" still hold on typical data? Check incident
   category diversity via `/api/incidents`.
2. **Priority order.** Is F1 really the top item for an *operator* (who may live
   in the grid and incidents views, not the error feed)? Argue from operator
   workflow, not aesthetics.
3. **Proposed fixes vs. house style.** The app is deliberately dependency-free,
   single-file, server-rendered-none. Do any proposed fixes (pagination, grouping,
   sticky headers) threaten that? Flag any that warrant a server-side change
   instead (e.g. incidents category rollup exists server-side already?).
4. **What was missed.** The tour did not exercise: `#appruns` keyset "load more"
   deep paging, error-feed behavior at 0 errors, `?CADENCE` tooltip discoverability,
   `503 warming up` path, concurrent auto-refresh + drill-down races (code claims
   `runReq` guards; verify by reading), screen-reader table semantics beyond roles.
5. **Severity of F4.** Is a misleading "showing N" in the header worth `medium`,
   or is it cosmetic? Check whether any operator decision could plausibly be
   mis-made from it.

## 5. Findings format

Per finding: `CONFIRMED` / `DISPUTED (why)` / `CONFIRMED-BUT-REPRIORITIZED (why)`,
plus any **new** findings with the same evidence discipline (screenshot or
file:line). End with a proposed phase slicing: which findings bundle into which
small, reviewable phases (this repo works in phases — see `markdown/FLOW.md`).

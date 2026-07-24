# Prompt Roadmap

Prompt files live in `prompts/`. Each is a structured, self-contained prompt for
one phase. Before running any phase prompt, read the Primary Reference Documents
listed in `markdown/FLOW.md`.

---

# Current Direction

`ops-dashboard` has a deployed v1 slice (job grid, error feed, run drill-down)
running as a read-only Docker service over `util.app_run_logs`. The near-term
direction is to **harden and future-proof** it:

- replace the heavy background grid query with an incremental summary table
- finish the user-facing surface (run drill-down UI)
- make staleness detection real (true cron cadences, not placeholders)
- optionally self-monitor (`app_name = "ops-dashboard"`)
- add operator-facing grid QoL — grouping, sorting, filtering, and a refresh
  indicator — all client-side and additive over the existing payload (Phases 8–9)
- surface per-equipment connectivity (which systems are offline) that the
  `data_acquisition/(default)` bucket hides — read-only over the `alert.*` tables
  (Phase 10)
- give each app an on-demand, paginated run-log (every run_id in a window) so
  high-frequency single-bucket apps like `data_acquisition` are inspectable beyond
  the grid's single latest run — read-only, not cached (Phase 11)
- make the grid itself stop misrepresenting single-bucket apps: per-APP recent-run
  health on the group header + a run-log status filter + a connectivity rollup badge
  (Phases 12–14, all read-only/additive)
- deepen the relationship between the monitoring data and the apps it watches, as
  read-only insight for a human (never write-back): pivot from per-app to
  per-equipment-system correlation (Phase 17), then surface **incident-engine**'s
  classified, severity-assessed incidents (Phase 19). The originally planned
  "error-category trends" and "error→owner/action insights feed" phases are
  **superseded**: a dedicated writer app (`/opt/apps/incident-engine`) now does that
  classification/assessment upstream and publishes the `incidents` schema; this
  dashboard displays it (read-only, fail-closed grant). An onboarding suite-health
  overview + legend remains open roadmap.
- execute the post-Phase-19 UX hardening sequence established by the independent
  2026-07-21 review: truthful connectivity freshness, active-first incident triage,
  progressive disclosure for dense feeds, bounded large-list rendering/pagination,
  route-aware chrome, explicit status/time semantics, native table accessibility,
  and responsive containment/polish (Phases 20-28). These stay dependency-free and
  preserve the read-only architecture.
- make incidents-by-entity the primary information architecture (Phases 30-31): add the
  smallest complete server-side SME incident aggregate, then make responsive SME cards
  the default route while preserving Jobs and the raw incident list. Global and other
  non-SME incidents remain explicitly reconciled and discoverable. A combined entity
  workspace across incidents, connectivity, and recent signals is Phase 32, but it is
  conditional on post-card UX evidence rather than an automatic implementation step.
- the independent post-Phase-31 review found concrete card→detail investigation
  friction: the temporary entity destination loses the card's incident context, while
  the global raw list cannot filter by entity. Phase 32's entry gate is therefore
  satisfied and proceeding is recommended in a separately authorized phase; Phase 32
  was not implemented as part of Phases 30-31.

Current decisions:

- the app connects as the least-privilege role `ops_dashboard_ro`, never a superuser
- the grid is served from an in-process incremental cache (Phase 4, done): a
  bootstrap scan on boot then cheap ticks; the heavy detoast is off the request
  path (request ~3ms). Option A (a durable DB summary table) stays deferred unless
  durability/multi-instance is ever needed — it would add the project's first write
  surface, so the in-process cache is preferred while a single instance suffices.
- the grid shows last-run-per-(app,job) within `SUMMARY_RETENTION_DAYS` (30), so
  dormant jobs stay visible (stale) instead of being hidden by a lookback window.
- the dashboard is deployed host-internal with no auth, by decision
- only 4 apps currently write to the DB (`data_acquisition`, `hhm_rpp_philips`,
  `hhm_rpp_ge`, `hhm_rpp_siemens`); others appear automatically when they start logging

Not decided yet:

- whether to add auth (only if exposure changes from host-internal)
- whether to ever promote the in-process cache to a durable DB summary table (Option A)
- retention/rotation strategy for `/opt/run-logs` (a stretch view, not core)
- whether to add a per-run drill-down link from the acquisition-systems view into the
  specific `util.app_run_logs` run (`stats.acquisition_history.run_id` is available;
  Phase 15 reads the table but does not build the join/link)
- per-(app, job) recent-run health on every grid row — deferred: deriving the job
  per run detoasts `verbose_log` (data_acquisition's is large); Phase 12 does the
  cheap per-APP aggregate instead
- retired-equipment inventory membership remains unavailable; Phase 20 therefore
  keeps old connectivity rows visible as stale rather than treating them as current

These are decided in future phases, not hidden inside unrelated edits.

---

# Phase Index

| Phase | Prompt file | Status | Notes |
| ----- | ----------- | ------ | ----- |
| 0 | `prompt_0_workflow_scaffold.txt` | Completed | This workflow system: markdown/ docs, prompt roadmap, phase log. |
| 1 | — (predates prompt system) | Completed | v1 slice: confirmed live schema, scaffolded grid/errors/drill-down. See PHASE_LOG. |
| 2 | — (predates prompt system) | Completed | Background-refreshed grid snapshot (perf). See PHASE_LOG. |
| 3 | — (predates prompt system) | Completed | Code-review hardening: RO role, uuid validation, SSL fail-closed, tests. See PHASE_LOG. |
| 4 | `prompt_4_summary_table.txt` | Completed | In-process incremental cache (Option B); grid served from cache (~3ms), dormant jobs visible/stale. See PHASE_LOG. |
| 5 | `prompt_5_run_drilldown_ui.txt` | Completed | Frontend-only run drill-down: in-page hash router + event timeline over `/api/runs/:run_id`, reached from the grid and error feed. See PHASE_LOG. |
| 6 | `prompt_6_real_schedules.txt` | Completed | Confirmed cron cadences + provenance; added 15 Philips variants; SIEMENS_CV left unknown; (default) stall budget; coverage surface (API + UI). See PHASE_LOG. |
| 7 | `prompt_7_self_monitoring.txt` | Completed | Opt-in heartbeat under `app_name = "ops-dashboard"` via a DB-enforced writer; appears in its own grid. See PHASE_LOG. |
| 8 | `prompt_8_grid_grouping_sort.txt` | Completed | Client-side grid grouping (app/job/none, collapsible) + sortable columns incl. last-run datetime; pure transforms in `public/grid-view.js` (browser-served, not `lib/`). Frontend-only, additive. See PHASE_LOG. |
| 9 | `prompt_9_grid_filters.txt` | Completed | Filter/search box + status chips (incl. STALE) + summary-counts header + last-updated/auto-refresh; `filterJobs`/`summarize` in `public/grid-view.js`. Frontend-only. See PHASE_LOG. |
| 10 | `prompt_10_connectivity_panel.txt` | Completed | Dedicated read-only Connectivity view over `alert.offline_hhm_conn`/`offline_mmb_conn` (latest per-system state, offline-first); expands `ops_dashboard_ro` with SELECT on schema `alert` — the first read outside `util`. Deploy needs the grant applied (superuser) + restart. See PHASE_LOG. |
| 11 | `prompt_11_app_run_history.txt` | Completed | On-demand, paginated per-app run-log view (`GET /api/apps/:app/runs`, default 24h) so high-frequency single-bucket apps like `data_acquisition` are inspectable; lean warn_error_logs-only query (no `verbose_log` detoast, EXPLAIN-confirmed partition prune), full-µs keyset pagination, not cached. Reached from the grid's app group-head. See PHASE_LOG. |
| 12 | `prompt_12_grid_recent_health.txt` | Completed | Per-APP recent-run health (runs/errored/warned over ~24h) on the app group header, so the grid stops misrepresenting single-bucket apps like `data_acquisition`; cheap warn_error_logs-only aggregate (EXPLAIN-confirmed, no detoast) on the refresh timer, additive. See PHASE_LOG. |
| 13 | `prompt_13_runlog_errors_filter.txt` | Completed | Server-side status filter (all/issues/errors) on the per-app run-log via a bound enum `$6` predicate, composing with keyset pagination; warn_error_logs-only. See PHASE_LOG. |
| 14 | `prompt_14_connectivity_polish.txt` | Completed | Connectivity rollup badge on the `data_acquisition` grid header (offline HHM/MMB counts, links to `#connectivity`) from an additive `rollup` field on `/api/connectivity`; + a refresh button on the connectivity view. No new query/grant. See PHASE_LOG. |
| 15 | `prompt_15_acquisition_systems.txt` | Completed | Per-system acquisition-history view for `data_acquisition` (per-`system_id` runs/failed over a window + per-source hhm/mmb rollup) from `stats.acquisition_history` (BRIN-bounded, EXPLAIN-confirmed); routed `#acq-systems` view off the data_acquisition header. Expands `ops_dashboard_ro` with SELECT on schema `stats` — the third read outside `util` (fail-closed). Deploy needs the grant applied (superuser) + restart. See PHASE_LOG. |
| 16 | `prompt_16_da_inline_runs.txt` | Completed | Inline expand the `data_acquisition` grid row to its last-12h distinct run_ids (lazy, capped newest 50, "see all" → run-log), reusing the Phase 11 endpoint. Frontend-only; no backend/grant/restart. See PHASE_LOG. |
| 17 | `prompt_17_per_system_view.txt` | Completed | Per-equipment-system correlation view: `GET /api/systems` (cross-app per-`note.sme` warn/error rollup, worst-first) + `GET /api/systems/:id` (breakdown by `(app,type,func)` with latest run drill-down, joined to `alert.*` for the classified `error_category`). `#systems`/`#system=<id>` routed views + top-nav link; connectivity/acq system ids now link in. `warn_error_logs`-only (EXPLAIN-pruned), request-path (clamp 1..168h). No new grant (reads `util`+`alert`). Read-only insight, no write-back. See PHASE_LOG. |

| 18 | — (ad-hoc user request; no prompt file) | Completed | data_acquisition run-log **job type**: the 12h-runs dropdown labels each run with its real job (`hhm/CT`, `mmb #3`, `ip_reset`…) from the `runJob` event's `run_group`/`modality`/`schedule` — a deliberate, bounded Performance-Rule exception (LATERAL after ORDER BY+LIMIT, ≤50 rows, data_acquisition endpoint only, ~10ms). Additive `jobType` API field. See PHASE_LOG. |
| 19 | `prompt_19_incidents_view.txt` | Completed | **Incidents view** over incident-engine's `incidents` schema (the fourth read surface, fail-closed): `GET /api/incidents` (severity×state tile rollup + filterable list) + `GET /api/incidents/:id` (assessment reasons/action + raw-event drill-down via `(fingerprint, entity)`). `#incidents`/`#incident=<id>` views + nav; entity links to `#system=`. `category_source='oracle'` renders as a hint-badge, never a diagnosis. Request-path (no detoast); supersedes old roadmap 18/20. See PHASE_LOG. |
| 20 | `prompt_20_connectivity_freshness_truth.txt` | Completed | Raw last result is preserved while a producer-backed 45-minute checked-at budget derives current ONLINE/OFFLINE/UNKNOWN versus STALE. Rollups count current failures separately from 339 retained historical rows. See PHASE_LOG. |
| 21 | `prompt_21_incident_triage_controls.txt` | Completed | Producer-confirmed active states now sort before resolved/suppressed history; one reconciled rollup adds 18 count-backed category facets, and category/severity/state filters compose with clear-all and honest zero states. See PHASE_LOG. |
| 22 | `prompt_22_dense_feed_disclosure.txt` | Completed | Both dense feeds now paint 25 bounded previews first, disclose full text and 25-row increments accessibly, keep shown/fetched/occurrence counts distinct, use native run links, and distinguish healthy empty from failure. See PHASE_LOG. |
| 23 | `prompt_23_large_list_controls.txt` | Completed | Sticky headers, order-preserving scoped filters, 50-row progressive rendering, honest response/loaded counts, and explicit reset paths now cover connectivity, systems, acquisition, and loaded run pages. See PHASE_LOG. |
| 24 | `prompt_24_incident_list_scaling.txt` | Completed | The incident list is an eight-field 100-row lean page with a validated opaque activity/severity/time/id cursor; load-more is deduplicated, filter-safe, and explicit about loaded versus global total. See PHASE_LOG. |
| 25 | `prompt_25_route_aware_chrome.txt` | Completed | A nine-route registry now owns accurate title/source/meta/active nav/refresh, and validated return tokens provide deterministic breadcrumbs without breaking legacy deep links or run hints. See PHASE_LOG. |
| 26 | `prompt_26_status_time_semantics.txt` | Completed | Latest status and 24h health are explicitly scoped, relative `<time>` cells retain exact timestamps through year-scale ages, and fixed badge/edge-marker policies replace warning-color walls. See PHASE_LOG. |
| 27 | `prompt_27_table_accessibility.txt` | Completed | Native scoped headers/rows now contain real sort/disclosure controls, all nine tables are named, selected filters remain operable, focus is visible, and cadence/loading help is reachable. See PHASE_LOG. |
| 28 | `prompt_28_responsive_polish.txt` | Completed | All nine tables now contain overflow locally with visible focus, narrow controls wrap without page overflow, compact UUID labels preserve exact link/accessibility values, promoted note fields are deduplicated safely, and an adaptive repo-native favicon identifies the app. See PHASE_LOG. |
| 29 | `prompt_29_ux_review_fix_round.txt` | Completed | Closed the reviewed refresh/chrome races, sticky containment, selected/zero filters, note fidelity, cursor-400 validation, keyboard disclosure/focus, and UUID-copy gaps. 146 tests plus reproducible nine-route/browser/API gates pass; independent fix-delta review remains the commit gate. See PHASE_LOG. |
| 30 | `prompt_30_incident_entity_summary_contract.txt` | Completed | Complete `GET /api/entities`: 229 SME summaries plus explicit global/other reconciliation from one small read-only incident aggregate; exact counts, occurrence strings, state/severity axes, apps, categories, and provenance. See PHASE_LOG. |
| 31 | `prompt_31_entity_first_incident_dashboard.txt` | Completed | Entities is the default/`#incidents` alias with complete progressive SME cards; Jobs, raw Incident list, detail views, accessibility, races, and legacy routes are preserved. See PHASE_LOG. |
| 32 | `prompt_32_entity_workspace_and_incident_drilldown.txt` | Completed (2026-07-24; independently reviewed, merged to main) | `#entity=` is a dedicated read-only workspace correlating the entity's paged incident records (`/api/incidents?entity=` + additive scopedTotal/firstSeen), current connectivity truth, and 24h run-log signals via `GET /api/entities/:id`; `#system=` is a permanent alias; every equipment link is canonical. 171 tests + 33-check live gate + browser gate pass; three independent review rounds closed. See PHASE_LOG. |

Phases 1–3 were completed before this prompt system existed; they are
reconstructed in `PHASE_LOG.md` as durable memory and have no prompt file.
Phase 18 was likewise built ad-hoc from a direct user request (no prompt file);
it shares the `phase-17-per-system-view` branch.

---

# Branching

One branch per phase unless the developer explicitly chooses otherwise.

| Phase | Branch |
| ----- | ------ |
| 4 | `phase-4-incremental-cache` |
| 5 | `phase-5-run-drilldown-ui` |
| 6 | `phase-6-real-schedules` |
| 7 | `phase-7-self-monitoring` |
| 8 | `phase-8-grid-grouping-sort` |
| 9 | `phase-9-grid-filters` |
| 10 | `phase-10-connectivity-panel` |
| 11 | `phase-11-app-run-history` |
| 12 | `phase-12-grid-recent-health` |
| 13 | `phase-13-runlog-errors-filter` |
| 14 | `phase-14-connectivity-polish` |
| 15 | `phase-15-acquisition-systems` |
| 16 | `phase-16-da-inline-runs` |
| 17 | `phase-17-per-system-view` |
| 18 | `phase-17-per-system-view` (ad-hoc; shares the branch) |
| 19 | `phase-19-incidents-view` |
| 20 | `phase-20-connectivity-freshness` |
| 21 | `phase-21-incident-triage` |
| 22 | `phase-22-dense-feed-disclosure` |
| 23 | `phase-23-large-list-controls` |
| 24 | `phase-24-incident-list-scaling` |
| 25 | `phase-25-route-aware-chrome` |
| 26 | `phase-26-status-time-semantics` |
| 27 | `phase-27-table-accessibility` |
| 28 | `phase-28-responsive-polish` |
| 29 | `phase-29-ux-review-fixes` |
| 30 | `phase-30-incident-entity-summary` |
| 31 | `phase-31-entity-first-dashboard` |
| 32 | `phase-32-entity-workspace` |

Check `git status --short` before creating or switching branches.

---

# Prompt Quality Rules

Each phase prompt should define:

- **phase goal** — one clear outcome
- **implementation scope** — what to build/change
- **explicit non-goals** — what NOT to touch
- **expected files / layers** — where the work lands
- **validation commands** — how to prove it works (tests + live smoke)
- **read-only / least-privilege constraints** — what must stay safe
- **schema assumptions to confirm live** — what to verify against the DB first
- **review questions** — what a reviewer should interrogate

Avoid ambiguous language. Preferred terms: *job grid, error feed, run
drill-down, run log, app/job, partition pruning, snapshot, summary table,
read-only role, staleness, lookback window*.

Avoid unless a phase explicitly approves them: *production auth redesign,
multi-tenant roles, alerting/paging system, writing to pipeline tables, schema
changes to `util.app_run_logs`, replacing the stack*.

If a prompt conflicts with `ARCHITECTURE_PRINCIPLES.md`, update the prompt or get
developer approval before implementation.

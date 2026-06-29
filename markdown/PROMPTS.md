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
- whether to add a grid connectivity rollup badge on the `data_acquisition` row
  (deferred from Phase 10)
- whether to correlate connectivity to specific runs via `stats.acquisition_history`
  (has `run_id`) — needs a third schema grant + a time-windowed join (deferred)

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
| 9 | `prompt_9_grid_filters.txt` | Pending | Filter/search box + status chips (incl. STALE) + summary-counts header + last-updated/auto-refresh; builds on the Phase 8 render pipeline. Frontend-only. |
| 10 | `prompt_10_connectivity_panel.txt` | Pending | Dedicated read-only Connectivity view over `alert.offline_hhm_conn`/`offline_mmb_conn` (latest per-system state, offline-first); expands `ops_dashboard_ro` with SELECT on schema `alert` — the first read outside `util`. |

Phases 1–3 were completed before this prompt system existed; they are
reconstructed in `PHASE_LOG.md` as durable memory and have no prompt file.

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

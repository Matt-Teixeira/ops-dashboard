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

Current decisions:

- the app connects as the least-privilege role `ops_dashboard_ro`, never a superuser
- the grid is served from a background-refreshed in-memory snapshot (2-min default)
- the dashboard is deployed host-internal with no auth, by decision
- only 4 apps currently write to the DB (`data_acquisition`, `hhm_rpp_philips`,
  `hhm_rpp_ge`, `hhm_rpp_siemens`); others appear automatically when they start logging

Not decided yet:

- whether to add auth (only if exposure changes from host-internal)
- whether the summary table lives in a new schema we own vs. computed in-process
- retention/rotation strategy for `/opt/run-logs` (a stretch view, not core)

These are decided in future phases, not hidden inside unrelated edits.

---

# Phase Index

| Phase | Prompt file | Status | Notes |
| ----- | ----------- | ------ | ----- |
| 0 | `prompt_0_workflow_scaffold.txt` | Completed | This workflow system: markdown/ docs, prompt roadmap, phase log. |
| 1 | — (predates prompt system) | Completed | v1 slice: confirmed live schema, scaffolded grid/errors/drill-down. See PHASE_LOG. |
| 2 | — (predates prompt system) | Completed | Background-refreshed grid snapshot (perf). See PHASE_LOG. |
| 3 | — (predates prompt system) | Completed | Code-review hardening: RO role, uuid validation, SSL fail-closed, tests. See PHASE_LOG. |
| 4 | `prompt_4_summary_table.txt` | Planned | Incremental summary table; retire the ~28s background grid query. |
| 5 | `prompt_5_run_drilldown_ui.txt` | Planned | Run drill-down UI over the existing `/api/runs/:run_id`. |
| 6 | `prompt_6_real_schedules.txt` | Planned | Replace placeholder cadences with real cron values; trustworthy staleness. |
| 7 | `prompt_7_self_monitoring.txt` | Planned | Optional self-logging under `app_name = "ops-dashboard"`. |

Phases 1–3 were completed before this prompt system existed; they are
reconstructed in `PHASE_LOG.md` as durable memory and have no prompt file.

---

# Branching

One branch per phase unless the developer explicitly chooses otherwise.

| Phase | Branch |
| ----- | ------ |
| 4 | `phase-4-summary-table` |
| 5 | `phase-5-run-drilldown-ui` |
| 6 | `phase-6-real-schedules` |
| 7 | `phase-7-self-monitoring` |

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

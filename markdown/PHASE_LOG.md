# Phase Log

Durable memory of decisions, validation, and outcomes. Newest entry on top. Use
`markdown/PHASE_TEMPLATE.md` for new entries.

Phases 1–3 predate this prompt system and are reconstructed here from the commit
history so the log is complete; they have no `prompts/` file.

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

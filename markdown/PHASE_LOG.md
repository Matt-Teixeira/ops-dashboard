# Phase Log

Durable memory of decisions, validation, and outcomes. Newest entry on top. Use
`markdown/PHASE_TEMPLATE.md` for new entries.

Phases 1–3 predate this prompt system and are reconstructed here from the commit
history so the log is complete; they have no `prompts/` file.

---

# Phase 4 — Incremental Run Cache (in-process)

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_4_summary_table.txt`

Git Commit:
Pending

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

- Pre-implementation plan review (this session) raised the two adjustments above;
  both applied. A post-implementation handoff for an external reviewer is the next
  step (`notes/review_handoff_phase_4.md`).

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

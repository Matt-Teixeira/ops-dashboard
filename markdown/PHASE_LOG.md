# Phase Log

Durable memory of decisions, validation, and outcomes. Newest entry on top. Use
`markdown/PHASE_TEMPLATE.md` for new entries.

Phases 1–3 predate this prompt system and are reconstructed here from the commit
history so the log is complete; they have no `prompts/` file.

---

# Phase 5 — Run Drill-Down UI

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_5_run_drilldown_ui.txt`

Git Commit:
Pending

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

- Self-review against `markdown/REVIEW_CHECKLIST.md` (walked below). No external
  handoff generated for this frontend-only phase.

Critical issues:

- None.

Accepted fixes:

- None.

Deferred findings:

- None.

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

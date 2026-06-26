# Phase Log

Durable memory of decisions, validation, and outcomes. Newest entry on top. Use
`markdown/PHASE_TEMPLATE.md` for new entries.

Phases 1–3 predate this prompt system and are reconstructed here from the commit
history so the log is complete; they have no `prompts/` file.

---

# Phase 7 — Self-Monitoring

Date:
2026-06-26

Status:
Completed

Prompt:
`prompts/prompt_7_self_monitoring.txt`

Git Commit:
Pending

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

# Code Review Handoff — Phase 12: Grid Recent-Run Health

A briefing for an automated reviewer. Additive, read-only: a cheap per-APP recent-run
health aggregate surfaced on the grid's app group header, so a high-frequency
single-bucket app (data_acquisition) isn't judged by its one latest run.

---

## 1. What this phase added

- `db/queries.js`: `APP_HEALTH_SQL` + `appHealth(sinceIso)`. Per app over a window:
  `runs`, `errored` (a run with an ERROR), `warned` (a run with a WARN) — all from
  `warn_error_logs` only (no `verbose_log`); `WHERE inserted_at > $1` (partition prune);
  `GROUP BY app_name`.
- `server.js`: computes it in `refreshOnce()` on the existing grid timer (window
  `APP_HEALTH_WINDOW_HOURS`, default 24) in its **own** try/catch, and adds it
  additively to `/api/jobs/latest` as `appHealth: { <app>: {runs,errored,warned} }`
  plus `appHealthWindowHours`.
- `public/grid-view.js`: pure `healthLabel(h, windowHours)` (e.g. "24h: 959/1104 err
  · 674 warn"; "" when nothing to show). `test/grid-view.test.js`: +3 (83 total).
- `public/index.html`: the app group header (when grouped by app) renders the label
  as a badge — ERROR-red if any errored, else SUCCESS — degrading to nothing if the
  app has no `appHealth` entry.
- Config: `APP_HEALTH_WINDOW_HOURS` in `.env.example` + `markdown/ENVIRONMENT.md`.

## 2. Scope of this review

Branch `phase-12-grid-recent-health`. Logic: `APP_HEALTH_SQL` + the `refreshOnce`
integration + `healthLabel`.

## 3. How to verify

- `node --test` → 83 pass.
- `EXPLAIN` (live): HashAggregate over a single-partition Index Scan on
  `app_run_logs_2026_06_inserted_at_idx` (`inserted_at >` cond), no `verbose_log`.
- Live: `/api/jobs/latest` includes `appHealth` (data_acquisition ~959/1104 errored)
  and `appHealthWindowHours: 24`; the grid still serves all jobs from cache; the app
  group header shows the red health badge on data_acquisition.

## 4. What I most want scrutinized

1. **No detoast / partition prune.** `APP_HEALTH_SQL` must read `warn_error_logs`
   only (never `verbose_log`) and prune on `inserted_at` — confirm via `EXPLAIN`. This
   is why it's per-APP, not per-(app, job) (the job lives in `verbose_log->argv`).
2. **Failure isolation.** The app-health refresh is in its own try/catch inside
   `refreshOnce`; a failure there must keep the last-good map and **never blank the
   grid** (the grid's own try/catch and `lastError` are unchanged). Confirm the
   nesting does that.
3. **Additive + graceful.** `appHealth`/`appHealthWindowHours` are additive response
   fields; the group header renders nothing when an app has no entry; existing
   rows/status/STALE badges are untouched.
4. **Error/warn parity.** The ERROR/WARN detection matches `JOBS_LATEST_SQL`'s
   `warn_error_logs` rule (a run is "errored" if any event is ERROR; "warned" if any
   WARN — these can overlap; the label leads with errored/runs).
5. **`healthLabel` purity.** DOM-free, no throw on missing/zero/NaN input ("" then),
   window prefix only when positive.

## 5. Out of scope (don't file as findings)

- Per-(app, job) recent health — deliberately deferred (deriving the job per run
  detoasts `verbose_log`; data_acquisition's is large). App-level only here.
- That "errored" and "warned" can both count the same run — intentional (independent
  signals); the label leads with errored.
- The run-log status filter (Phase 13) and connectivity rollup (Phase 14).

## 6. Output format

Per finding: **Severity** (blocker/high/medium/low/nit) · **`file:line`** · **What &
why** · **Suggested fix**. Priority: (1) a `verbose_log` read or missed partition
prune in the aggregate; (2) app-health failure blanking or stalling the grid; (3)
status-rule divergence from the grid; (4) impurity in `healthLabel`.

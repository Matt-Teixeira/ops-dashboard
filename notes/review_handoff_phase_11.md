# Code Review Handoff — Phase 11: Per-App Run History

A briefing for an automated reviewer. Frontend + one new **read-only** query; no new
grant (the role already has `SELECT` on `util.app_run_logs`), no cache change, no
writes. The interesting parts are **partition-pruning / no-detoast** and **keyset
pagination correctness**.

---

## 1. What this phase added

An on-demand, paginated per-app run-log: every run for one app within a window
(default 24h), newest first — so high-frequency single-bucket apps like
`data_acquisition` (which the grid collapses to one `(default)` row) are inspectable.

- `db/queries.js`: `APP_RUNS_SQL` + `appRuns()`. Status/issue_count from
  `warn_error_logs` only (no `verbose_log`); `inserted_at` returned as a
  full-microsecond ISO string (`inserted_at_iso`). Filters `app_name = $1` and
  `inserted_at > $2` (partition prune); keyset `(inserted_at, run_id) < ($3,$4)`;
  `ORDER BY inserted_at DESC, run_id DESC LIMIT $5`.
- `lib/app-runs.js` (server-only, pure; mirrors `lib/runs.js`): `clampInt` and
  `shapePage` (maps rows + computes the next cursor).
- `server.js`: `GET /api/apps/:app/runs?windowHours&limit&before&beforeId` →
  `{ app, windowHours, count, runs[], nextBefore, nextBeforeId }`. Clamps window
  (1..720h) and limit (1..500); validates the cursor; errors via the shared
  sanitized 500.
- `public/index.html`: a routed `#appruns=<app>` view, reached from the Phase 8 app
  group-head ("run log ›"), with a "load more" button using the keyset cursor. Each
  run links to the drill-down with the `inserted_at` hint.
- `test/app-runs.test.js`: +8 (`clampInt`, `shapePage`, and a DB-free `APP_RUNS_SQL`
  shape guard). 80 total. Config: `APP_RUNS_LOOKBACK_HOURS`/`APP_RUNS_LIMIT`.

## 2. Scope of this review

Branch `phase-11-app-run-history`. Logic: `db/queries.js` (`APP_RUNS_SQL`) +
`lib/app-runs.js`. The rest is the route and the view.

## 3. How to verify

- `node --test` → 80 pass.
- `EXPLAIN` confirmed (live): single-partition **Index Scan** on
  `app_run_logs_2026_06_inserted_at_idx` with `inserted_at > …`, app_name filter,
  no full scan, no `verbose_log`.
- Live: `GET /api/apps/data_acquisition/runs?limit=5` → newest 5; page 2 via the
  returned `before`/`beforeId` continues strictly older with no dupes/gaps (verified
  across sub-second-apart runs); each run drills down via the `inserted_at` hint; bad
  `beforeId` → 400; grid/errors/connectivity/healthz still 200.

## 4. What I most want scrutinized

1. **Keyset pagination correctness.** `data_acquisition` fires multiple times per
   second. Confirm `(inserted_at, run_id) < ($3,$4)` with a **full-microsecond**
   `inserted_at_iso` cursor neither skips nor duplicates rows that share an
   `inserted_at` — and specifically that the cursor isn't truncated to milliseconds
   (a JS `Date` would; that's why the SQL emits `to_char(... 'US' ...)` and the
   client echoes that exact string back as `before`).
2. **Partition prune + no detoast.** `inserted_at > $2` must prune to the relevant
   monthly partition(s), and the query must never read `verbose_log` (status/issues
   from `warn_error_logs` only). Confirm via `EXPLAIN`.
3. **Status parity with the grid.** The `warn_error_logs` ERROR>WARN>SUCCESS
   expression matches `JOBS_LATEST_SQL`, so a run reads the same in both places.
4. **Input handling.** `:app` is parameterized (`$1`, no injection); window/limit are
   clamped; a partial/!uuid cursor is rejected (400) or ignored (only one half
   present). `clampInt` treats blank/absent as default (note `Number("")===0`).
5. **No cache / grid impact.** `lib/run-cache.js` and the grid's latest-run model are
   untouched; this query is served directly.
6. **View safety + navigation.** Run-log rows are built via `textContent`; the
   `runReq` token prevents a slow first-page or "load more" fetch from rendering after
   the user navigates away.

## 5. Out of scope (don't file as findings)

- Per-run **duration/job** (deferred — would detoast `verbose_log` per row;
  data_acquisition's job is `(default)` anyway).
- A server-side **"errors only"** filter and per-(app,job) history — deferred.
- The per-app view being reached only when the grid is grouped by app (the group key
  is the app name) — intentional.

## 6. Output format

Per finding: **Severity** (blocker/high/medium/low/nit) · **`file:line`** · **What &
why** · **Suggested fix**. Priority: (1) a pagination case that skips/duplicates rows
(esp. shared timestamps / cursor precision); (2) a missed partition prune or any
`verbose_log` read; (3) injection or unvalidated input; (4) cache/grid regression.

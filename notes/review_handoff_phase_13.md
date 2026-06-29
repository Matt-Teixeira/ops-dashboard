# Code Review Handoff — Phase 13: Run-Log Status Filter

A briefing for an automated reviewer. Small, additive: an optional status filter on
the Phase 11 per-app run-log. Read-only; warn_error_logs-only; composes with the
existing keyset pagination.

---

## 1. What this phase added

- `lib/app-runs.js`: `normalizeStatusFilter(raw)` -> `"all" | "error" | "issues"`
  (anything else -> `"all"`; case/space-insensitive). Exported `STATUS_FILTERS`.
- `db/queries.js`: `APP_RUNS_SQL` gains a narrowing predicate keyed off a bound enum
  param `$6` — `all` (no filter), `error` (run has an ERROR), `issues` (run has a WARN
  or ERROR), via `EXISTS` over `warn_error_logs`. `appRuns()` takes `statusFilter`.
- `server.js`: `/api/apps/:app/runs?status=` normalized via the helper, passed through,
  and echoed back in the response (`status`).
- `public/index.html`: All / Issues / Errors buttons in the `#appruns` view; changing
  one calls `showAppRuns(app, status)` (resets to page 1); `appRunsState.status`
  threads through `appRunsUrl` so "load more" stays within the filter.
- `test/app-runs.test.js`: +1 (`normalizeStatusFilter`) and the SQL guard now also
  asserts the `$6` enum predicate. 84 total.

## 2. Scope of this review

Branch `phase-13-runlog-errors-filter`. Logic: the `$6` predicate in `APP_RUNS_SQL`
and `normalizeStatusFilter`.

## 3. How to verify

- `node --test` → 84 pass.
- Live: `/api/apps/hhm_rpp_ge/runs?status=...` (an app with 144 WARN, 0 ERROR in 24h):
  `all` and `issues` → 144 (all WARN), `error` → 0. `data_acquisition?status=error`
  paginates (page 2 still all-ERROR, strictly older via the cursor).

## 4. What I most want scrutinized

1. **No interpolation.** The filter is a **bound enum param** (`$6`), normalized
   server-side to one of three literals — never string-built into SQL.
2. **Pagination still holds.** The predicate only narrows the `WHERE`; the keyset
   `(inserted_at, run_id)` order/cursor and `LIMIT` are unchanged, so filtered paging
   has no gaps/dupes and stays within the selected filter. Confirm `error` page 2 is
   still all-ERROR and strictly older.
3. **Still lean.** The `EXISTS` is over `warn_error_logs` only — no `verbose_log`.
4. **Semantics.** `issues` = WARN *or* ERROR; `error` = ERROR only; `all` = no filter.
   The UI resets to page 1 on change and keeps the filter across "load more".

## 5. Out of scope (don't file as findings)

- Per-(app, job) filtering and free-text search on the run-log — deferred.
- The filter not being encoded in the `#appruns` hash (view state only) — intentional.

## 6. Output format

Per finding: **Severity** · **`file:line`** · **What & why** · **Suggested fix**.
Priority: (1) any interpolation / injection in the predicate; (2) a pagination
gap/dup or filter-leak across pages; (3) a `verbose_log` read.

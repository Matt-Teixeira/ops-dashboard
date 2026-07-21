# Code Review Handoff — Phase 17: Per-System (Equipment) Correlation View

A briefing for an automated reviewer. Adds a cross-app, per-equipment-system view over
`util.app_run_logs.warn_error_logs` (+ an `alert.*` join for the classified category).
**No new grant** (reads `util` + `alert`, both already granted). Focus: the two new
windowed JSON-unnest queries (partition pruning, no `verbose_log`, bound `sme`), input
validation on `:id`, and a frontend router refactor (`hideAllViews`) touching every view.

---

## 1. What this phase added

The same physical system (`note.sme`) raises warn/error events across MULTIPLE apps —
`data_acquisition` (the pull) and the `hhm_rpp_*` parsers (the downstream parse) — but the
dashboard only ever showed those per-app. This adds a read-only pivot on the system, as
insight for a human (no write-back to the monitored apps).

- `db/queries.js`:
  - `SYSTEMS_LATEST_SQL` + `systemsLatest(sinceIso, limit=500)`. Per `note.sme` across ALL
    apps over `inserted_at > $1`: `issues`/`errors`/`warns` counts, `apps` =
    `count(DISTINCT app_name)`, `which` = `string_agg(DISTINCT app_name)`, `last_seen`.
    `LATERAL json_array_elements(COALESCE(warn_error_logs,'[]'::json))`; `WHERE sme IS NOT
    NULL`; `GROUP BY sme`; `ORDER BY errors DESC, issues DESC, sme`; `LIMIT $2`.
  - `SYSTEM_DETAIL_SQL` + `systemDetail(systemId, sinceIso)`. One system over `inserted_at
    > $2 AND NULLIF(e->'note'->>'sme','') = $1` (**`sme` bound as `$1`, never
    interpolated**), grouped by `(app_name, type, func)`: `n`, `last_run_id` =
    `(array_agg(run_id ORDER BY inserted_at DESC))[1]`, `last_inserted_at`. No
    `verbose_log`, no join.
- `lib/systems.js` (pure, DOM/DB-free): `shapeSystems` (camelCase; `which` → `apps[]`),
  `summarize` (`{systems,errors,warns,crossApp}`, `crossApp` = # systems in >1 app),
  `shapeDetail`, `pickSystem(decoratedConnectivity, id)`. `test/systems.test.js` +7
  (98 total) incl. SQL-text guards on both templates.
- `server.js`:
  - `GET /api/systems?windowHours=` (clamp `SYSTEMS_WINDOW_HOURS`=24, **1..168**) →
    `{ windowHours, asOf, count, summary, systems }`.
  - `GET /api/systems/:id?windowHours=` — id validated by `SYSTEM_ID_RE`
    (`/^[A-Za-z0-9_-]{1,64}$/`, else 400); joins `queries.connectivity()` decorated via
    `lib/connectivity` and filtered by `pickSystem` for the classified `error_category`
    (which lives in `alert.*`, not the run-log note) →
    `{ systemId, windowHours, asOf, connectivity, breakdown }`.
- `public/index.html`: `#systems` (worst-first list) + `#system=<id>` (detail: connectivity
  status/category + `(app,type,func)` breakdown, each line → run drill-down via
  `runHref(lastRunId, lastInsertedAt)`) routed views; top-nav "systems" link; the
  connectivity and acquisition tables now render the system id via `systemCell` linking to
  `#system=<id>`. Introduced `hideAllViews()` and replaced the per-`show*` hide blocks with
  it (7 views now) — behavior-preserving.
- Config/docs: `SYSTEMS_WINDOW_HOURS` in `.env.example` + `ENVIRONMENT.md`; PROMPTS +
  PHASE_LOG updated.

## 2. Scope of this review

Branch `phase-17-per-system-view`. Logic: `SYSTEMS_LATEST_SQL` / `SYSTEM_DETAIL_SQL` +
`lib/systems.js`. Request-path safety: the two handlers (`:id` validation, window clamp,
sanitized 500). Frontend: the `hideAllViews` refactor across all `show*` functions and the
two new views/router branches.

## 3. How to verify

- `node --test` → 98 pass (7 new).
- `EXPLAIN` (live) on `SYSTEMS_LATEST_SQL` (24h): `Index Scan using
  app_run_logs_2026_06_inserted_at_idx` (Index Cond `inserted_at > …`) → Nested Loop over
  `json_array_elements` → GroupAggregate → Sort. Partition-pruned; **no `verbose_log`**.
- Live HTTP smoke (ephemeral instance, frontend/queries bind-mounted; restart the running
  container to pick up the new routes): `GET /api/systems?windowHours=24` → ~226 systems
  worst-first with `summary.crossApp` (~18). `GET /api/systems/<cross-app sme, e.g.
  SME02524>` → connectivity `OFFLINE / host_unreachable` (HHM+MMB) + a per-`(app,type,func)`
  breakdown whose "Latest run" links drill down. `GET /api/systems/bad%20id!!` → 400.
  `?windowHours=99999` → clamps to 168.

## 4. What I most want scrutinized

1. **Partition pruning + no detoast.** Both queries filter `inserted_at > $` and unnest
   ONLY `warn_error_logs` (small, pre-filtered) — never `verbose_log`. Confirm via
   `EXPLAIN` that neither degrades to a cross-partition seq scan and that the LATERAL
   unnest cost is bounded (24h ≈ 150ms; 7d ≈ 2.2s is why the clamp max is 168h, not 720h).
2. **Injection / input safety.** In `SYSTEM_DETAIL_SQL` the `sme` is a bound `$1`
   (`db.any(sql, [systemId, sinceIso])`), not string-interpolated. `:id` is validated by
   `SYSTEM_ID_RE` before the query. Window via `appRunsLib.clampInt`. Confirm no path lets
   raw client input reach the SQL text.
3. **Correct data axes (verified live).** System key is `note.sme` ONLY (no dead
   `note.system.id` fallback); the classified `error_category` comes from the `alert.*`
   join (the run-log `note` value is sparse/unreliable), and `func` is the in-log axis.
   Confirm the detail's connectivity is sourced from `pickSystem(connectivity.decorate(...))`.
4. **`hideAllViews` refactor is behavior-preserving.** It hides all 7 view sections; every
   `show*` (existing + new) now calls it then shows its own section. Confirm no view can
   strand a stale sibling and that `showDashboard`'s `runReq++` invalidation and the other
   `show*` `++runReq` navigation tokens are unchanged.
5. **Read-only + additive.** No write/DDL, no new grant, no cache/grid/connectivity/acq
   changes beyond the additive system-id link. Response shapes of existing endpoints
   unchanged. DB errors → shared sanitized 500. Frontend text via `textContent`.
6. **`lib/systems.js` purity.** DOM/DB-free, no mutation, tolerant of non-array/empty and
   a missing `which`.

## 5. Out of scope (don't file as findings)

- The in-log breakdown axis is `func`, not the classified `error_category` — the latter is
  sparse in the run log by design; the detail surfaces the true category via the `alert.*`
  join. Consistent run-log classification would require changes in the OTHER apps
  (out of scope — read-only; Phase 18 surfaces the gap).
- No pagination on the list (LIMIT 500, worst-first, bounded window — like connectivity/acq).
- Max window clamped to 168h (not 720h like acq): intentional, to bound the request-path
  unnest cost.
- No cache (served direct, like connectivity/acq).

## 6. Output format

Per finding: **Severity** · **`file:line`** · **What & why** · **Suggested fix**.
Priority: (1) a partition-prune / `verbose_log` / seq-scan regression in either query;
(2) unvalidated/interpolated client input reaching Postgres; (3) `hideAllViews` leaving a
view able to strand a stale sibling, or breaking a `runReq` guard; (4) a DB error leaking
to the client; (5) impurity in `lib/systems.js`.

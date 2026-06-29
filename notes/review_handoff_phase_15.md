# Code Review Handoff — Phase 15: Per-System Acquisition History

A briefing for an automated reviewer. Adds the dashboard's **third read outside
`util`** (`stats.acquisition_history`), so the grant blast-radius and the unpartitioned
windowed scan are the focus; the UI is an additive routed view.

---

## 1. What this phase added

A per-system view for `data_acquisition` (whose one orchestrator run covers ~20
systems and so collapses to a single grid row): per-`system_id` runs/failed over a
window + a per-source (hhm/mmb) rollup, from `stats.acquisition_history`.

- `db/setup-readonly-role.sql`: `USAGE ON SCHEMA stats` + `SELECT ON
  stats.acquisition_history`, applied **fail-closed** (REVOKE schema+tables, GRANT only
  those, then a `DO` block that RAISEs on any other effective privilege / schema
  CREATE) — same template as the Phase 10 alert grant.
- `db/queries.js`: `ACQ_SYSTEMS_SQL` + `acquisitionSystems(sinceIso)`. Per
  `(system_id, data_source)` over `inserted_at > $1`: `runs`, `failed` (= NOT
  successful_acquisition), `max(modality)`/`max(manufacturer)`, `max(inserted_at)` as
  a full ISO `last_seen`; `ORDER BY failed DESC, runs DESC, system_id`. No
  `verbose_log`, no join.
- `lib/acq.js` (pure): `shapeSystems` (camelCase; blank/null → null) + `summarizeBySource`
  (per-source systems/runs/failed). `test/acq.test.js` +5 (91 total) incl. a SQL guard.
- `server.js`: `GET /api/acquisition/systems?windowHours=` (clamped 1..720, default
  `ACQ_WINDOW_HOURS`=24) → `{ windowHours, asOf, count, bySource, systems }`; sanitized
  500 on a missing grant.
- `public/index.html`: routed `#acq-systems` view reached from the data_acquisition
  group header ("systems ›"); rollup line + per-system table (worst-first; failed>0
  rows tinted). Text via `textContent`; `runReq`-guarded.
- Docs: ARCHITECTURE_PRINCIPLES (3rd grant + fail-closed note), DEPLOYMENT (grant step
  + smoke), `.env.example`, ENVIRONMENT.

## 2. Scope of this review

Branch `phase-15-acquisition-systems`. Security-critical: the `stats` grant block.
Logic: `ACQ_SYSTEMS_SQL` + `lib/acq.js`.

## 3. How to verify

- `node --test` → 91 pass.
- `EXPLAIN` (live): `Bitmap Index Scan on idx_acq_hist_inserted_brin` (inserted_at >
  cond) → GroupAggregate → Sort. No 447k full scan; no `verbose_log`.
- After the grant: `SET ROLE ops_dashboard_ro; SELECT count(*) FROM
  stats.acquisition_history` works, a write is denied, the verify block passes;
  `GET /api/acquisition/systems` → ~333 systems worst-first with a hhm/mmb rollup.

## 4. What I most want scrutinized

1. **Grant blast radius.** `ops_dashboard_ro` must gain ONLY `USAGE ON SCHEMA stats` +
   `SELECT` on `stats.acquisition_history` — nothing else in `stats`, no write/DDL, no
   `CREATE`. The fail-closed `DO` block must catch PUBLIC/inherited privileges (it uses
   `has_table_privilege`). Confirm it mirrors the alert block correctly for `stats`.
2. **Unpartitioned but bounded.** `stats.acquisition_history` (~447k rows) is **not**
   partitioned; the windowed aggregate relies on the BRIN on `inserted_at`. Confirm via
   `EXPLAIN` it doesn't degrade to a full scan, and that there's no `verbose_log` and no
   join.
3. **Sanitized failure.** Missing grant → generic 500 from the shared handler (no DB
   internals).
4. **Axis correctness.** Grouped by `(system_id, data_source)` (both always present);
   `modality`/`manufacturer` are sparse → `max()` columns, not the axis. `failed` =
   `count(*) FILTER (WHERE NOT successful_acquisition)`.
5. **`lib/acq.js` purity.** DOM-free, no mutation, tolerant of empty/unknown-source.

## 5. Out of scope (don't file as findings)

- No per-run drill-down link into `util.app_run_logs` (the `run_id` is in the table but
  the join/link is deferred).
- No pagination (bounded by ~333 systems, like the connectivity view's 539).
- modality not being the primary axis (it's ~82% blank) — intentional.

## 6. Output format

Per finding: **Severity** · **`file:line`** · **What & why** · **Suggested fix**.
Priority: (1) the role gaining any privilege beyond SELECT-on-`acquisition_history`;
(2) a full-scan / `verbose_log` / join regression in the query; (3) a DB error leaking
to the client; (4) impurity in `lib/acq.js`.

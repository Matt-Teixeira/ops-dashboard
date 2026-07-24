# Connectivity Schema — `alert.offline_hhm_conn` / `alert.offline_mmb_conn`

The connectivity panel's data contract (Phase 10). These two tables are written by
the `data_acquisition` app (`util/tools/offline_alert.js`); **ops-dashboard only
reads them.** Verify column types against the live DB before relying on them — this
doc is reconstructed from a live inspection (DB `staging`, 2026-06), not a DDL file.

## What they are

`data_acquisition` pulls equipment data from many systems. After each heartbeat it
**upserts one row per `system_id`** into one of two tables, by data source:

- **`alert.offline_hhm_conn`** — HHM: equipment telemetry pulled over SSH.
- **`alert.offline_mmb_conn`** — MMB: Philips MRI magnet-monitor pulled over rsync.

Because the write is an `UPSERT` keyed on `system_id` (the primary key), each table
holds exactly **one retained snapshot row per system = its last recorded result**.
Rows are not removed when equipment leaves the active acquisition set, so the tables
also retain historical/retired snapshots; a successful boolean alone is not proof that
equipment is online now. Per-run history lives in `stats.acquisition_history`. The
tables are small (hundreds of rows), **not partitioned**, and have **no json/large
columns** — so the dashboard reads them with a full scan on the request path, no cache
(cf. the Performance Rule, which targets `verbose_log` detoast).

## Columns (both tables)

| Column | Type | Meaning |
|---|---|---|
| `system_id` | `varchar(8)` PK | equipment system id, e.g. `SME01068` |
| `capture_datetime` | `timestamptz` | when the equipment data was last captured (may be hours/days stale) |
| `inserted_at` | `timestamptz` default `now()` | when this alert row was last written (the "last checked" clock) |
| `successful_acquisition` | `boolean` | raw last result: `true` ok / `false` failed / `null` unknown; only current when `inserted_at` is fresh |
| `host_intervention` | `boolean` | manual/host intervention was required |
| `connection_error` | `text` | error detail, e.g. `"curl timeout"`, `"rsync I/O timeout"` |
| `error_category` | `varchar(40)` | classified error, e.g. `connection_timeout`, `max_retries`, `rsync_io_timeout` |
| `phase` | `varchar(20)` | acquisition phase: HHM `grab`/`list`/`transfer`, MMB `remote_rsync` |
| `daily_total` / `lifetime_total` | `int` | attempt counters (not read by the dashboard) |

`alert.offline_hhm_conn` additionally has `rpp_host_datetime timestamptz` and
`daily_total_history int[]` (HHM-only; not read by the dashboard).

Only a primary-key index (on `system_id`) exists on each table.

## How the dashboard reads them

- `db/queries.js` → `CONNECTIVITY_SQL`: `UNION ALL` of the two tables with a literal
  `source` label (`'HHM'`/`'MMB'`), selecting only the columns above that both share.
- `lib/connectivity.js` preserves `lastResult` (`OFFLINE` if
  `successful_acquisition = false`, `ONLINE` if `true`, else `UNKNOWN`) and derives
  **freshness** from `inserted_at`. Both HHM and MMB acquisition groups run every 30
  minutes (`data_acquisition/docs/cron-jobs.txt`); the established 15-minute suite
  grace and the producer's existing MMB stale-data report give a **45-minute record
  freshness budget**. A last result becomes the current `operationalState` only while
  its record age is ≤45 minutes; older/missing/invalid records are `STALE` regardless
  of their historical boolean.
- `capture_datetime` is deliberately NOT the currentness clock: failed upserts update
  `inserted_at` and the failure fields but leave capture time at the last successful
  data pull. The API therefore keeps **capture age** (age of equipment data) and
  **record age** (age of the last attempted-result upsert) distinct.
- Sorting is current OFFLINE → current UNKNOWN → current ONLINE → STALE historical
  rows. Rollups count online/offline/unknown/stale per source and reconcile to total.
- `GET /api/connectivity` → `{ asOf, count, systems: [...] }`; rendered by the
  `#connectivity` view in `public/index.html`.

## Freshness evidence (Phase 20, 2026-07-21)

- Producer cron: HHM and MMB acquisition groups repeat every 30 minutes; the
  `offline_alert` upsert runs after them each cycle.
- Producer write path: successful and failed alert upserts both refresh `inserted_at`;
  only successful upserts replace `capture_datetime`.
- Existing producer report `utils/db/sql/reports/get-offline-mmb-conn.sql` treats a
  45-minute gap as stale data, matching the suite's 30-minute cadence + 15-minute
  grace convention.
- Live snapshot at the Phase 20 decision gate: 539 retained rows, but only 200 had a
  stats.acquisition_history fact in the last hour; exactly those 200 had recent alert
  records. The remaining 339 were historical snapshots, including formerly-successful
  rows that the old UI labeled ONLINE.

## Access

The role `ops_dashboard_ro` needs `USAGE ON SCHEMA alert` + `SELECT` on these two
tables (added to `db/setup-readonly-role.sql` in Phase 10) — the first read outside
schema `util`. SELECT-only; the dashboard never writes here.

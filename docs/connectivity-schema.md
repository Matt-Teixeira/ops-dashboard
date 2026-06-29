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
holds exactly **one row per system = its latest connectivity state**. There is no
history here (per-run history lives in `stats.acquisition_history`, not read by this
app). The tables are small (hundreds of rows), **not partitioned**, and have **no
json/large columns** — so the dashboard reads them with a full scan on the request
path, no cache (cf. the Performance Rule, which targets `verbose_log` detoast).

## Columns (both tables)

| Column | Type | Meaning |
|---|---|---|
| `system_id` | `varchar(8)` PK | equipment system id, e.g. `SME01068` |
| `capture_datetime` | `timestamptz` | when the equipment data was last captured (may be hours/days stale) |
| `inserted_at` | `timestamptz` default `now()` | when this alert row was last written (the "last checked" clock) |
| `successful_acquisition` | `boolean` | `true` ok / `false` failed / `null` unknown |
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
- `lib/connectivity.js` derives, per row: `status` (`OFFLINE` if
  `successful_acquisition = false`, `ONLINE` if `true`, else `UNKNOWN`), the
  **capture age** (`now − capture_datetime`, "how stale") and the **checked age**
  (`now − inserted_at`, "last checked"), then sorts worst-first (OFFLINE → UNKNOWN →
  ONLINE, then most-stale first).
- `GET /api/connectivity` → `{ asOf, count, systems: [...] }`; rendered by the
  `#connectivity` view in `public/index.html`.

## Access

The role `ops_dashboard_ro` needs `USAGE ON SCHEMA alert` + `SELECT` on these two
tables (added to `db/setup-readonly-role.sql` in Phase 10) — the first read outside
schema `util`. SELECT-only; the dashboard never writes here.

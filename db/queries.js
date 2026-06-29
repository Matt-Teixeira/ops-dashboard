// db/queries.js
// Read-only queries over util.app_run_logs. All time-windowed queries filter on
// `inserted_at` so Postgres can prune the monthly range partitions.
//
// The job-grid and error-feed queries push parsing into SQL (status from
// warn_error_logs, job from verbose_log->0 argv, duration from first/last dt) so
// the (large) verbose_log blob is never shipped to Node for these views. The SQL
// mirrors the JS rules in lib/runs.js -- keep the two in sync.
"use strict";

const db = require("./pg-pool");

// Guard a json `dt` text value before casting: only cast strings that look like
// an ISO-8601 UTC timestamp, otherwise NULL. A single malformed `dt` must not
// raise a cast error that fails the whole grid refresh. (Note the doubled
// backslashes -- this is a JS template literal, so \\d reaches SQL as \d.)
const SAFE_TS = (expr) =>
  `CASE WHEN (${expr}) ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$' ` +
  `THEN (${expr})::timestamptz END`;

// One row per (app_name, job): the most recent run with inserted_at >= $1.
// The cache (lib/run-cache.js) calls this for both the bootstrap scan (since =
// now - retention) and each incremental tick (since = watermark - overlap). The
// DISTINCT ON survivors always include the row with the global max inserted_at in
// the window, so the cache's watermark stays correct after every merge.
const JOBS_LATEST_SQL = `
WITH recent AS (
  SELECT
    app_name,
    run_id,
    inserted_at,
    COALESCE(NULLIF(verbose_log->0->'note'->'argv'->>2, ''), '(default)') AS job,
    ${SAFE_TS("verbose_log->0->>'dt'")}                                   AS started_at,
    ${SAFE_TS("verbose_log->-1->>'dt'")}                                  AS ended_at,
    COALESCE(warn_error_logs, '[]'::json)                                 AS warn_error_logs
  FROM util.app_run_logs
  WHERE inserted_at >= $1::timestamptz
),
latest AS (
  SELECT DISTINCT ON (app_name, job) *
  FROM recent
  ORDER BY app_name, job, inserted_at DESC
)
SELECT
  app_name,
  job,
  run_id,
  inserted_at,
  started_at,
  ended_at,
  -- Clamp out-of-order spans to NULL instead of a misleading negative duration.
  CASE WHEN started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at
       THEN round(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::bigint
  END AS duration_ms,
  CASE
    WHEN EXISTS (SELECT 1 FROM json_array_elements(warn_error_logs) e WHERE e->>'type' = 'ERROR') THEN 'ERROR'
    WHEN EXISTS (SELECT 1 FROM json_array_elements(warn_error_logs) e WHERE e->>'type' = 'WARN')  THEN 'WARN'
    ELSE 'SUCCESS'
  END AS status,
  json_array_length(warn_error_logs) AS issue_count
FROM latest
ORDER BY app_name, job;
`;

// Most recent WARN/ERROR events across the suite, newest first.
const ERRORS_SQL = `
SELECT
  l.app_name,
  l.run_id,
  e->>'dt'      AS dt,
  e->>'type'    AS type,
  e->>'func'    AS func,
  e->>'tag'     AS tag,
  e->>'err_msg' AS err_msg,
  e->'note'     AS note
FROM util.app_run_logs l,
     LATERAL json_array_elements(COALESCE(l.warn_error_logs, '[]'::json)) e
WHERE l.inserted_at > now() - ($1::int * interval '1 day')
ORDER BY (e->>'dt')::timestamptz DESC
LIMIT $2;
`;

// Full event timeline for one run (drill-down). run_id is not indexed and the
// table is partitioned. Without a hint this scans every partition, so callers
// should pass the run's inserted_at (the grid row carries it) to prune to one
// monthly partition via the hinted variant below.
const RUN_BY_ID_SQL = `
SELECT app_name, run_id, inserted_at, verbose_log
FROM util.app_run_logs
WHERE run_id = $1
ORDER BY inserted_at DESC
LIMIT 1;
`;

const RUN_BY_ID_HINTED_SQL = `
SELECT app_name, run_id, inserted_at, verbose_log
FROM util.app_run_logs
WHERE run_id = $1
  AND inserted_at >= $2::timestamptz - interval '1 hour'
  AND inserted_at <  $2::timestamptz + interval '1 hour'
ORDER BY inserted_at DESC
LIMIT 1;
`;

// Connectivity panel (Phase 10): the latest connectivity state per equipment,
// unioned across the HHM (SSH telemetry) and MMB (Philips rsync) alert tables and
// labeled by source. Unlike the queries above there is NO inserted_at filter and
// NO cache: these alert tables are upserted to ONE row per system_id (PK), are
// tiny (hundreds of rows total), carry no json blob to detoast, and are not
// partitioned -- so a full scan is sub-millisecond and safe on the request path.
// (The Performance Rule targets the verbose_log detoast cost, which is absent
// here.) Sorting/derivation live in lib/connectivity.js, not SQL.
const CONNECTIVITY_SQL = `
SELECT 'HHM' AS source, system_id, capture_datetime, inserted_at,
       successful_acquisition, host_intervention, connection_error, error_category, phase
FROM alert.offline_hhm_conn
UNION ALL
SELECT 'MMB' AS source, system_id, capture_datetime, inserted_at,
       successful_acquisition, host_intervention, connection_error, error_category, phase
FROM alert.offline_mmb_conn;
`;

// Per-app run history (Phase 11): every run for one app within a recent window,
// newest first, for the on-demand run-log view. Lean by design -- status and
// issue_count come ONLY from warn_error_logs (small, pre-filtered); verbose_log is
// never touched, so no detoast even for high-frequency apps (data_acquisition runs
// ~1100x/24h). Partition-pruned via `inserted_at > $2`. NOT cached: the in-process
// cache holds one row per (app, job); run history is served directly.
//
// Pagination is KEYSET on (inserted_at, run_id) DESC, not OFFSET, so a new run
// arriving at the top can't shift pages and runs sharing an inserted_at (sub-second
// fan-out) are neither skipped nor duplicated. The cursor ($3 ts, $4 run_id) is the
// previous page's last row; the first page passes NULLs. inserted_at is returned as
// a full-microsecond ISO string (inserted_at_iso) so the cursor round-trips exactly
// (a JS Date would truncate to ms and drop rows at the boundary).
const APP_RUNS_SQL = `
SELECT
  run_id,
  to_char(inserted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS inserted_at_iso,
  CASE
    WHEN EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'ERROR') THEN 'ERROR'
    WHEN EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'WARN')  THEN 'WARN'
    ELSE 'SUCCESS'
  END AS status,
  json_array_length(COALESCE(warn_error_logs, '[]'::json)) AS issue_count
FROM util.app_run_logs
WHERE app_name = $1
  AND inserted_at > $2::timestamptz
  AND ($3::timestamptz IS NULL OR (inserted_at, run_id) < ($3::timestamptz, $4::uuid))
  -- Status filter (Phase 13): a narrowing predicate, so keyset pagination is
  -- unaffected. $6 is a normalized enum ('all'|'error'|'issues'), never interpolated.
  AND (
    $6 = 'all'
    OR ($6 = 'error'  AND EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'ERROR'))
    OR ($6 = 'issues' AND EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' IN ('ERROR', 'WARN')))
  )
ORDER BY inserted_at DESC, run_id DESC
LIMIT $5;
`;

function jobsLatestSince(sinceIso) {
  return db.any(JOBS_LATEST_SQL, [sinceIso]);
}

function connectivity() {
  return db.any(CONNECTIVITY_SQL);
}

// Per-APP recent-run health (Phase 12): how many runs each app had in a recent
// window and how many errored/warned. Deliberately per APP, not per (app, job):
// the job comes from verbose_log->argv, and reading verbose_log detoasts it
// (data_acquisition's is large), so this stays warn_error_logs-only (small,
// pre-filtered) -- no detoast. Partition-pruned via `inserted_at > $1`. Computed on
// the grid refresh timer (off the request path) and served additively so the grid
// stops misrepresenting high-frequency single-bucket apps by their one latest run.
const APP_HEALTH_SQL = `
SELECT
  app_name,
  count(*)::int AS runs,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'ERROR'))::int AS errored,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'WARN'))::int  AS warned
FROM util.app_run_logs
WHERE inserted_at > $1::timestamptz
GROUP BY app_name;
`;

function appHealth(sinceIso) {
  return db.any(APP_HEALTH_SQL, [sinceIso]);
}

// Per-system acquisition history (Phase 15): data_acquisition's recent acquisitions
// broken down by (system_id, data_source) over a window. Source is
// stats.acquisition_history (one row per run-per-system; the alert.* tables are this
// data's current-state snapshot). system_id and data_source are always present;
// modality/manufacturer are sparse (a column, not the axis). Bounded by `inserted_at
// > $1` -- the table isn't partitioned but has a BRIN on inserted_at, so a windowed
// scan does not read all ~447k rows. No verbose_log, no join. inserted_at is emitted
// as a full ISO string for last_seen. Ordered worst-first (most failures).
const ACQ_SYSTEMS_SQL = `
SELECT
  system_id,
  data_source,
  max(manufacturer) AS manufacturer,
  max(modality)     AS modality,
  count(*)::int                                                       AS runs,
  count(*) FILTER (WHERE NOT successful_acquisition)::int             AS failed,
  to_char(max(inserted_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen
FROM stats.acquisition_history
WHERE inserted_at > $1::timestamptz
GROUP BY system_id, data_source
ORDER BY failed DESC, runs DESC, system_id;
`;

function acquisitionSystems(sinceIso) {
  return db.any(ACQ_SYSTEMS_SQL, [sinceIso]);
}

function appRuns(appName, sinceIso, limit, beforeIso = null, beforeId = null, statusFilter = "all") {
  return db.any(APP_RUNS_SQL, [appName, sinceIso, beforeIso, beforeId, limit, statusFilter]);
}

function recentErrors(lookbackDays = 2, limit = 100) {
  return db.any(ERRORS_SQL, [lookbackDays, limit]);
}

function runById(runId, insertedAtHint) {
  if (insertedAtHint) {
    return db.oneOrNone(RUN_BY_ID_HINTED_SQL, [runId, insertedAtHint]);
  }
  return db.oneOrNone(RUN_BY_ID_SQL, [runId]);
}

function ping() {
  return db.one("SELECT 1 AS ok");
}

module.exports = { jobsLatestSince, recentErrors, runById, connectivity, appRuns, appHealth, acquisitionSystems, ping };

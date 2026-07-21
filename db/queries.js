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
//
// Phase 18: data_acquisition's per-run "job type" (its run_group, e.g. hhm/CT,
// mmb #3, ip_reset) does NOT live in warn_error_logs -- it is on the `runJob`
// event inside verbose_log, so surfacing it costs a verbose_log detoast. That is
// normally forbidden on this lean path (Performance Rule), so the job-type columns
// are added ONLY in the withJobType variant, wired up ONLY for the data_acquisition
// runs endpoint (server.js). The extraction is a LATERAL the planner evaluates
// AFTER ORDER BY + LIMIT (EXPLAIN: `Function Scan` loops = LIMIT, single monthly
// partition Index Scan, ~10ms for 50 rows), so the detoast is bounded to ONE page,
// on demand. run_group is 1:1 per run; the label is formatted in lib/app-runs.js.
const buildAppRunsSql = (withJobType) => `
SELECT
  run_id,
  to_char(inserted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS inserted_at_iso,
  CASE
    WHEN EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'ERROR') THEN 'ERROR'
    WHEN EXISTS (SELECT 1 FROM json_array_elements(COALESCE(warn_error_logs, '[]'::json)) e WHERE e->>'type' = 'WARN')  THEN 'WARN'
    ELSE 'SUCCESS'
  END AS status,
  json_array_length(COALESCE(warn_error_logs, '[]'::json)) AS issue_count${withJobType ? `,
  rj.run_group AS da_run_group,
  rj.modality  AS da_modality,
  rj.schedule  AS da_schedule` : ``}
FROM util.app_run_logs${withJobType ? `
LEFT JOIN LATERAL (
  SELECT e->'note'->>'run_group' AS run_group,
         e->'note'->>'modality'  AS modality,
         e->'note'->>'schedule'  AS schedule
  FROM json_array_elements(COALESCE(verbose_log, '[]'::json)) e
  WHERE e->>'func' = 'runJob'
  LIMIT 1
) rj ON true` : ``}
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
const APP_RUNS_SQL = buildAppRunsSql(false);
const APP_RUNS_JOBTYPE_SQL = buildAppRunsSql(true);

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

// Per-system (equipment) correlation LIST (Phase 17): the same physical system
// (note.sme) raises warn/error events across MULTIPLE apps -- data_acquisition (the
// pull) and the hhm_rpp_* parsers (the downstream parse). This rolls those up per sme
// across ALL apps in the window so an operator sees which equipment is unhealthy and
// whether it spans apps (a root-cause signal). warn_error_logs-only (small, pre-filtered)
// -- verbose_log is NEVER touched, so no detoast even though data_acquisition logs
// ~1100x/24h. Partition-pruned via `inserted_at > $1` (EXPLAIN: Index Scan on the
// monthly partition's inserted_at index). The system key is note.sme ONLY --
// note.system.id is never populated. LIMIT $2 caps the payload; ordered worst-first.
const SYSTEMS_LATEST_SQL = `
WITH ev AS (
  SELECT
    l.app_name,
    l.inserted_at,
    NULLIF(e->'note'->>'sme', '') AS sme,
    e->>'type'                    AS type
  FROM util.app_run_logs l,
       LATERAL json_array_elements(COALESCE(l.warn_error_logs, '[]'::json)) e
  WHERE l.inserted_at > $1::timestamptz
)
SELECT
  sme,
  count(*)::int                                        AS issues,
  count(*) FILTER (WHERE type = 'ERROR')::int          AS errors,
  count(*) FILTER (WHERE type = 'WARN')::int           AS warns,
  count(DISTINCT app_name)::int                        AS apps,
  string_agg(DISTINCT app_name, ',' ORDER BY app_name) AS which,
  to_char(max(inserted_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen
FROM ev
WHERE sme IS NOT NULL
GROUP BY sme
ORDER BY errors DESC, issues DESC, sme
LIMIT $2;
`;

// Per-system correlation DETAIL (Phase 17): for ONE system, break its warn/error events
// down by (app, type, func) over the window, with the latest run_id per group so each
// line links to the existing drill-down. `func` is the in-log categorization axis (the
// classified error_category lives in alert.*, joined in the handler, not here). The sme
// is a BOUND param ($1) -- never interpolated. warn_error_logs-only, partition-pruned via
// `inserted_at > $2`. Worst-first (errors, then frequency).
const SYSTEM_DETAIL_SQL = `
WITH ev AS (
  SELECT
    l.app_name,
    l.run_id,
    l.inserted_at,
    e->>'type'                            AS type,
    COALESCE(NULLIF(e->>'func', ''), '(none)') AS func
  FROM util.app_run_logs l,
       LATERAL json_array_elements(COALESCE(l.warn_error_logs, '[]'::json)) e
  WHERE l.inserted_at > $2::timestamptz
    AND NULLIF(e->'note'->>'sme', '') = $1
)
SELECT
  app_name,
  type,
  func,
  count(*)::int                                     AS n,
  (array_agg(run_id ORDER BY inserted_at DESC))[1]  AS last_run_id,
  to_char(max(inserted_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_inserted_at
FROM ev
GROUP BY app_name, type, func
ORDER BY (type = 'ERROR') DESC, n DESC, app_name, func;
`;

function systemsLatest(sinceIso, limit = 500) {
  return db.any(SYSTEMS_LATEST_SQL, [sinceIso, limit]);
}

function systemDetail(systemId, sinceIso) {
  return db.any(SYSTEM_DETAIL_SQL, [systemId, sinceIso]);
}

// withJobType adds the data_acquisition run_group columns (one bounded verbose_log
// detoast per page); see buildAppRunsSql. Callers enable it only for that app.
function appRuns(appName, sinceIso, limit, beforeIso = null, beforeId = null, statusFilter = "all", withJobType = false) {
  const sql = withJobType ? APP_RUNS_JOBTYPE_SQL : APP_RUNS_SQL;
  return db.any(sql, [appName, sinceIso, beforeIso, beforeId, limit, statusFilter]);
}

// ---------------------------------------------------------------------------
// Incidents view (Phase 19): read-only over the `incidents` schema, which is
// OWNED and written by incident-engine (a separate app). The read contract is
// /opt/apps/incident-engine/notes/ops_dashboard_integration_brief.md +
// /opt/apps/incident-engine/docs/incidents-schema.md. This dashboard only ever
// SELECTs here (grant: setup-readonly-role.sql, fail-closed).
//
// All served on the REQUEST PATH (house precedent, cf. connectivity): the rollup
// table is small (~530 rows), indexed (severity/state + last_seen DESC), and has
// no json blob to detoast (`assessment` is small jsonb; verbose_log is nowhere
// near this schema). The drill-down over error_events (~360k rows) is bounded by
// the (fingerprint, dt DESC) index + LIMIT.

// Severity/state tile rollup. Doubles as the UI's self-check: the tile numbers
// must equal this GROUP BY at the same moment.
const INCIDENTS_ROLLUP_SQL = `
SELECT severity, state, count(*)::int AS n
FROM incidents.incidents
GROUP BY severity, state;
`;

// Filterable list, worst-first. $1..$3 are normalized filters ('all' or a bound
// value -- never interpolated; the route validates shape first). Severity has no
// natural sort order as text, so rank it explicitly; 'critical' is reserved by
// the engine (unused today) but ranked so it would surface first if it appears.
const INCIDENTS_LIST_SQL = `
SELECT
  id, fingerprint, entity, occurrence_count, first_seen, last_seen,
  apps, systems, sample_run_id, sample_message,
  category, category_source, error_type, phase, func, type,
  severity, confidence, assessor_kind, assessment,
  state, resolved_at, resolved_reason
FROM incidents.incidents
WHERE ($1 = 'all' OR severity = $1)
  AND ($2 = 'all' OR state = $2)
  AND ($3 = 'all' OR category = $3)
ORDER BY
  CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                WHEN 'low' THEN 3 WHEN 'info' THEN 4 ELSE 5 END,
  last_seen DESC
LIMIT $4;
`;

// One incident by id (route validates the integer shape before it gets here).
const INCIDENT_DETAIL_SQL = `
SELECT
  id, fingerprint, entity, occurrence_count, first_seen, last_seen,
  apps, systems, sample_run_id, sample_message,
  category, category_source, error_type, phase, func, type,
  severity, confidence, assessor_kind, assessor_version, assessment,
  state, resolved_at, resolved_reason
FROM incidents.incidents
WHERE id = $1::bigint;
`;

// Drill-down: the raw L0 events behind one incident, newest first. Keyed by the
// incident's (fingerprint, entity) -- the engine stamps `entity` on every event
// row precisely so consumers never re-derive it. Uses idx_error_events_fingerprint_dt;
// LIMIT bounds the payload. raw_event/err_msg stay small; no verbose_log anywhere.
const INCIDENT_EVENTS_SQL = `
SELECT
  run_id, event_ord, src_app_name, type, func, tag,
  err_msg, note_message, sme, system_id,
  error_category, error_type, dt, inserted_at
FROM incidents.error_events
WHERE fingerprint = $1 AND entity = $2
ORDER BY dt DESC NULLS LAST
LIMIT $3;
`;

function incidentsRollup() {
  return db.any(INCIDENTS_ROLLUP_SQL);
}

function incidentsList(severity = "all", state = "all", category = "all", limit = 1000) {
  return db.any(INCIDENTS_LIST_SQL, [severity, state, category, limit]);
}

function incidentById(id) {
  return db.oneOrNone(INCIDENT_DETAIL_SQL, [id]);
}

function incidentEvents(fingerprint, entity, limit = 100) {
  return db.any(INCIDENT_EVENTS_SQL, [fingerprint, entity, limit]);
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

module.exports = { jobsLatestSince, recentErrors, runById, connectivity, appRuns, appHealth, acquisitionSystems, systemsLatest, systemDetail, incidentsRollup, incidentsList, incidentById, incidentEvents, ping };

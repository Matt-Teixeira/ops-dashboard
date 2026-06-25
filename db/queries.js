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

// One row per (app_name, job): the most recent run within the lookback window.
const JOBS_LATEST_SQL = `
WITH recent AS (
  SELECT
    app_name,
    run_id,
    inserted_at,
    COALESCE(NULLIF(verbose_log->0->'note'->'argv'->>2, ''), '(default)') AS job,
    (verbose_log->0->>'dt')::timestamptz                                  AS started_at,
    (verbose_log->-1->>'dt')::timestamptz                                 AS ended_at,
    COALESCE(warn_error_logs, '[]'::json)                                 AS warn_error_logs
  FROM util.app_run_logs
  WHERE inserted_at > now() - ($1::int * interval '1 day')
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
  round(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::bigint AS duration_ms,
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
// table is partitioned, so we narrow by inserted_at when a hint is supplied.
const RUN_BY_ID_SQL = `
SELECT app_name, run_id, inserted_at, verbose_log
FROM util.app_run_logs
WHERE run_id = $1
ORDER BY inserted_at DESC
LIMIT 1;
`;

function jobsLatest(lookbackDays = 7) {
  return db.any(JOBS_LATEST_SQL, [lookbackDays]);
}

function recentErrors(lookbackDays = 2, limit = 100) {
  return db.any(ERRORS_SQL, [lookbackDays, limit]);
}

function runById(runId) {
  return db.oneOrNone(RUN_BY_ID_SQL, [runId]);
}

function ping() {
  return db.one("SELECT 1 AS ok");
}

module.exports = { jobsLatest, recentErrors, runById, ping };

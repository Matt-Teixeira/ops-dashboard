-- notes/schedule-cadence-probe.sql
-- Observed cadence per (app, job): the median gap between consecutive runs in
-- util.app_run_logs. This is the reality-check for config/schedules.js (Phase 6) --
-- the actual inter-run gap IS the cadence for the interval-scheduled jobs.
--
-- Run read-only as ops_dashboard_ro, e.g.:
--   psql -h localhost -p 5432 -U ops_dashboard_ro -d staging -f notes/schedule-cadence-probe.sql
--
-- Confirmed 2026-06-26: every hhm_rpp_ge / hhm_rpp_philips grid job = 30.0 min;
-- data_acquisition/(default) ~0.4 min (aggregate of many staggered sub-jobs).

WITH r AS (
  SELECT
    app_name,
    COALESCE(NULLIF(verbose_log->0->'note'->'argv'->>2, ''), '(default)') AS job,
    inserted_at,
    lag(inserted_at) OVER (
      PARTITION BY app_name,
                   COALESCE(NULLIF(verbose_log->0->'note'->'argv'->>2, ''), '(default)')
      ORDER BY inserted_at
    ) AS prev
  FROM util.app_run_logs
  WHERE inserted_at > now() - interval '3 days'   -- bounds the partition scan
)
SELECT
  app_name,
  job,
  count(*) AS runs,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM inserted_at - prev)) / 60.0)::numeric, 1) AS median_gap_min,
  round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM inserted_at - prev)) / 60.0)::numeric, 1) AS p90_gap_min
FROM r
WHERE prev IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

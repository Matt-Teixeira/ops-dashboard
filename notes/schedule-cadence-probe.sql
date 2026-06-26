-- notes/schedule-cadence-probe.sql
-- Observed cadence per (app, job): the median gap between consecutive runs in
-- util.app_run_logs. This is the reality-check for config/schedules.js (Phase 6) --
-- the actual inter-run gap IS the cadence for the interval-scheduled jobs.
--
-- Run read-only as ops_dashboard_ro, e.g.:
--   psql -h localhost -p 5432 -U ops_dashboard_ro -d staging -f notes/schedule-cadence-probe.sql
--
-- Confirmed 2026-06-26 (7-day window): every hhm_rpp_ge / hhm_rpp_philips grid job
-- = 30.0 min median. data_acquisition/(default) is the aggregate of many staggered
-- sub-jobs: median 0.4 / p90 2.8 / p99 10.1 / max 12.3 min -- the max gap is what the
-- (default) stall budget in config/schedules.js must clear (it's set to 30 min).
--
-- p99 and max are reported so the stall-budget rationale is reproducible: a stall
-- threshold must sit above the MAX normal inter-run gap, not p90.

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
  WHERE inserted_at > now() - interval '7 days'   -- bounds the partition scan
)
SELECT
  app_name,
  job,
  count(*) AS runs,
  round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM inserted_at - prev)) / 60.0)::numeric, 1) AS median_gap_min,
  round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY extract(epoch FROM inserted_at - prev)) / 60.0)::numeric, 1) AS p90_gap_min,
  round((percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM inserted_at - prev)) / 60.0)::numeric, 1) AS p99_gap_min,
  round((max(extract(epoch FROM inserted_at - prev)) / 60.0)::numeric, 1) AS max_gap_min
FROM r
WHERE prev IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

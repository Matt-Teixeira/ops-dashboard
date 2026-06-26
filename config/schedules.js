// config/schedules.js
// Expected cadence per (app/job). The DB carries no schedule info, so staleness
// detection needs this map. A job is stale if now - lastRun > everyMin + graceMin.
// Jobs absent from this map report stale = null (unknown) -- never a false "green".
//
// Phase 6: these are CONFIRMED cadences, not placeholders. Every entry is traceable
// to a cron line and cross-checked against the observed median inter-run gap in
// util.app_run_logs (notes/schedule-cadence-probe.sql). Provenance is on each entry.
//
// Cron sources (the host crontab is not readable from the dashboard env, so the
// apps' checked-in cron docs are the source of truth):
//   - data_acquisition/docs/cron-jobs.txt  (master; HHM RPP block runs ge_*/siemens_*)
//   - hhm_rpp_philips/docs/cron.txt         (the /opt/apps Philips schedule)
// Grid job name = verbose_log->0->'note'->'argv'->>2 (uppercase, e.g. GE_CT); the
// cron lines invoke the lowercase npm script of the same name (npm run ge_ct).
"use strict";

module.exports = {
  // app_name/job  ->  { everyMin OR cron, graceMin }

  // ops-dashboard self-monitoring (Phase 7): the serve process writes a heartbeat
  // every SELF_LOG_INTERVAL_MS (default 5 min). 15-min budget tolerates a couple of
  // missed beats; a dead process / DB outage stops the beats and the row ages to
  // STALE -- the intended "dashboard is down" signal. Only present when SELF_LOG_ENABLED.
  "ops-dashboard/heartbeat": { everyMin: 5, graceMin: 10 },

  // Aggregate of many staggered data_acquisition sub-jobs (ge_*, philips_*,
  // siemens_*, ip, offline_alert, schedule_0..7 at 00,30 / 10,40 / 15,45 / 16,46 /
  // 17,47 / 19,49 / 20,50 / 22,52 ... -- cron-jobs.txt "HHM DATA ACQUISITION" +
  // "MMB DATA ACQUISITION"). It runs almost constantly, but the staggered schedule
  // has real idle gaps: observed median 0.4 / p90 2.8 / p99 10.1 / MAX 12.3 min
  // (app_run_logs, 7d, 2026-06-26; notes/schedule-cadence-probe.sql).
  // everyMin here is NOT a literal schedule; it's the silence budget that flags a
  // full-pipeline STALL. The budget must clear the MAX normal gap (12.3 min), not
  // p90, or it flaps STALE during ordinary operation. 30 min total (~2.4x max)
  // flags a genuine stop without false positives. Per-system_id staleness is out of
  // scope -- this is one (default) bucket.
  "data_acquisition/(default)": { everyMin: 20, graceMin: 10 },

  // hhm_rpp_ge: cron-jobs.txt "HHM RPP" block, 18,48 * * * * (cd hhm_rpp_ge &&
  // npm run ge_ct|ge_cv|ge_mri) -> every 30 min. Observed median 30.0 min
  // (app_run_logs, 2026-06-26).
  "hhm_rpp_ge/GE_CT":  { everyMin: 30, graceMin: 15 },
  "hhm_rpp_ge/GE_CV":  { everyMin: 30, graceMin: 15 },
  "hhm_rpp_ge/GE_MRI": { everyMin: 30, graceMin: 15 },

  // hhm_rpp_philips: hhm_rpp_philips/docs/cron.txt, 15,45 * * * * (npm run
  // philips_ct|philips_cv|philips_mri_monitor_N|_rmmu_N|_log_N) -> every 30 min.
  // Observed median 30.0 min for all variants (app_run_logs, 2026-06-26).
  "hhm_rpp_philips/PHILIPS_CT": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_CV": { everyMin: 30, graceMin: 15 },

  "hhm_rpp_philips/PHILIPS_MRI_MONITOR_1": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_MONITOR_2": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_MONITOR_3": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_MONITOR_4": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_MONITOR_5": { everyMin: 30, graceMin: 15 },

  "hhm_rpp_philips/PHILIPS_MRI_RMMU_1": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_RMMU_2": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_RMMU_3": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_RMMU_4": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_RMMU_5": { everyMin: 30, graceMin: 15 },

  "hhm_rpp_philips/PHILIPS_MRI_LOG_1": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_LOG_2": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_LOG_3": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_LOG_4": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_MRI_LOG_5": { everyMin: 30, graceMin: 15 },

  // hhm_rpp_siemens: cron-jobs.txt "HHM RPP" block, 18,48 * * * * (cd hhm_rpp_siemens
  // && npm run siemens_ct|siemens_mri) -> every 30 min. Currently dormant (~17 days
  // idle as of 2026-06-26), so they show STALE -- which is correct: the cadence is
  // 30 min and they are overdue, not unknown.
  "hhm_rpp_siemens/SIEMENS_CT":  { everyMin: 30, graceMin: 15 },
  "hhm_rpp_siemens/SIEMENS_MRI": { everyMin: 30, graceMin: 15 },
  // SIEMENS_CV: intentionally NOT configured. It is not in either cron file and has
  // no runs in app_run_logs over the 30-day window (2026-06-26), so it is not in the
  // grid. Asserting 30 min would be inventing a cadence; leave it unknown (stale=null)
  // until it is actually scheduled and logging.

  // --- Deferred wall-clock schedules (NOT yet active) -------------------------------
  // These apps do not yet log to util.app_run_logs and so are absent from the grid.
  // They are cron (wall-clock) rather than interval, so they need a cron evaluator,
  // which Phase 6 deliberately did not build (everyMin suffices for every current
  // grid job and is timezone-independent). Recorded here so the schedules are not
  // lost; activate -- with a cron parser in lib/staleness.js -- once these apps start
  // logging and appear in the grid. Job-name casing (argv[2]) to be confirmed then.
  //   "monday/EQUIPMENT_RTT":        { cron: "25 7 * * *", graceMin: 30 },  // cron-jobs.txt "Monday JOBS"
  //   "acumatica/(default)":         { cron: "20 7 * * *", graceMin: 30 },  // cron-jobs.txt "ACUMATICA SYNC"
  //   "part-source/INV_FEED_SYNC":   { cron: "0 6 * * *",  graceMin: 30 },  // cron-jobs.txt part-source-pipeline
};

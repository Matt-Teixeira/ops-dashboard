// config/schedules.js
// Expected cadence per (app/job) -- the DB has no schedule info, so staleness
// detection needs this map. A job is stale if now - lastRun > expected + grace.
//
// These are PLACEHOLDER estimates inferred from observed run frequency in the
// live data (e.g. hhm_rpp_* runs landed ~every 30 min over the sampled window).
// Replace with the real cron cadences from each app's crontab / compose before
// trusting the staleness column. Jobs absent from this map report stale = null
// (unknown) rather than a false "green".
"use strict";

module.exports = {
  // app_name/job  ->  { everyMin OR cron, graceMin }
  "data_acquisition/(default)": { everyMin: 15, graceMin: 15 },

  "hhm_rpp_ge/GE_CT":  { everyMin: 30, graceMin: 15 },
  "hhm_rpp_ge/GE_CV":  { everyMin: 30, graceMin: 15 },
  "hhm_rpp_ge/GE_MRI": { everyMin: 30, graceMin: 15 },

  "hhm_rpp_philips/PHILIPS_CT": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_philips/PHILIPS_CV": { everyMin: 30, graceMin: 15 },
  // PHILIPS_MRI_MONITOR_1..5, _RMMU_1..5, _LOG_1..5 also run ~every 30 min;
  // add explicit entries once the real cron is confirmed.

  "hhm_rpp_siemens/SIEMENS_CT":  { everyMin: 30, graceMin: 15 },
  "hhm_rpp_siemens/SIEMENS_MRI": { everyMin: 30, graceMin: 15 },
  "hhm_rpp_siemens/SIEMENS_CV":  { everyMin: 30, graceMin: 15 },
};

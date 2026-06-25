// lib/runs.js
// Canonical rules for turning a raw util.app_run_logs row into something the
// dashboard can show. The SQL in db/queries.js mirrors these rules so the grid
// can be computed server-side without shipping multi-MB verbose_log blobs to
// Node; the JS helpers here are used for the run drill-down and as the single
// source of truth for the parsing contract.
//
// Verified against the live DB (DB `staging`, 2026-06):
//   - verbose_log / warn_error_logs are `json` arrays of event objects.
//   - The first event carries note.argv; argv[2] is the job name for the
//     hhm_rpp_* apps (e.g. "GE_CT", "PHILIPS_MRI_MONITOR_3"). data_acquisition
//     has no argv[2] (it fans out per system_id internally) -> "(default)".
//   - Per-event `dt` is ISO-8601 UTC; min/max span ~= run duration.
"use strict";

const DEFAULT_JOB = "(default)";

/** Derive the job name for a run from its verbose_log array. */
function jobName(verboseLog) {
  const argv = verboseLog && verboseLog[0] && verboseLog[0].note && verboseLog[0].note.argv;
  const job = Array.isArray(argv) ? argv[2] : null;
  return job && String(job).trim() ? String(job).trim() : DEFAULT_JOB;
}

/**
 * Derive a run status from its warn_error_logs array (the pre-filtered
 * WARN/ERROR events). ERROR wins over WARN wins over SUCCESS.
 */
function deriveStatus(warnErrorLogs) {
  const events = Array.isArray(warnErrorLogs) ? warnErrorLogs : [];
  if (events.some((e) => e && e.type === "ERROR")) return "ERROR";
  if (events.some((e) => e && e.type === "WARN")) return "WARN";
  return "SUCCESS";
}

/** Run start/end/duration from the first/last event `dt` in verbose_log. */
function timing(verboseLog) {
  const events = Array.isArray(verboseLog) ? verboseLog : [];
  if (events.length === 0) return { startedAt: null, endedAt: null, durationMs: null };
  const startedAt = events[0] && events[0].dt ? events[0].dt : null;
  const endedAt = events[events.length - 1] && events[events.length - 1].dt
    ? events[events.length - 1].dt
    : null;
  const durationMs =
    startedAt && endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
  return { startedAt, endedAt, durationMs };
}

module.exports = { DEFAULT_JOB, jobName, deriveStatus, timing };

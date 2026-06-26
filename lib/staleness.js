// lib/staleness.js
// Compute whether a job's latest run is overdue, using config/schedules.js.
// Returns null when no cadence is configured (unknown, not "green").
"use strict";

const schedules = require("../config/schedules");

/** Expected interval in ms for a schedule entry, or null if unparseable. */
function expectedMs(entry) {
  if (!entry) return null;
  if (typeof entry.everyMin === "number") return entry.everyMin * 60 * 1000;
  // cron-based cadences would be parsed here (deferred for v1).
  return null;
}

/**
 * @returns {{stale: boolean|null, ageMs: number, budgetMs: number|null}}
 */
function evaluate(appName, job, lastRunIso, now = new Date()) {
  const entry = schedules[`${appName}/${job}`];
  const ageMs = now.getTime() - new Date(lastRunIso).getTime();
  const interval = expectedMs(entry);
  if (interval == null) return { stale: null, ageMs, budgetMs: null };
  const graceMs = (entry.graceMin || 0) * 60 * 1000;
  const budgetMs = interval + graceMs;
  return { stale: ageMs > budgetMs, ageMs, budgetMs };
}

/** True if (app, job) has a usable cadence; false means staleness is unknown (null). */
function isConfigured(appName, job) {
  return expectedMs(schedules[`${appName}/${job}`]) != null;
}

/**
 * Coverage of a set of grid pairs against config/schedules.js: how many jobs have
 * a configured cadence vs. report stale=null (unknown). Surfaces silent drift as
 * new apps start logging without a cadence -- they must never read as "green".
 * @param {Array<{app: string, job: string}>} pairs
 * @returns {{total: number, configured: number, unknown: number, unknownJobs: string[]}}
 */
function coverage(pairs) {
  const unknownJobs = pairs
    .filter((p) => !isConfigured(p.app, p.job))
    .map((p) => `${p.app}/${p.job}`);
  return {
    total: pairs.length,
    configured: pairs.length - unknownJobs.length,
    unknown: unknownJobs.length,
    unknownJobs,
  };
}

module.exports = { evaluate, isConfigured, coverage };

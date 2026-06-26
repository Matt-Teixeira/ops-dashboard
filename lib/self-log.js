// lib/self-log.js
// Phase 7 self-monitoring: assemble the dashboard's periodic heartbeat run from its
// own health, and (optionally) write it via the writer connection. buildHeartbeat is
// pure and injectable so it's unit-tested without a DB.
//
// A healthy beat is INFO-only -> derived status SUCCESS. If the last grid refresh
// failed, an ERROR event is added so the run reads ERROR and shows in the error feed.
// A dead process / DB outage writes no beats at all, so the ops-dashboard row simply
// ages out to STALE -- the correct "dashboard is down" signal (you cannot self-log an
// unreachable DB).
"use strict";

const { makeRunLog, toRow } = require("../utils/logger/log");

const JOB = "heartbeat";

/**
 * @param {{asOf: string|null, cacheSize: number, coverageUnknown: number,
 *          lastRefreshMs: number|null, lastError: string|null}} health
 * @returns {{run_id: string, verbose_log: object[], warn_error_logs: object[]}}
 */
function buildHeartbeat(health = {}) {
  const log = makeRunLog(JOB);
  log.add("INFO", "heartbeat", "DETAILS", {
    asOf: health.asOf ?? null,
    cacheSize: health.cacheSize ?? null,
    coverageUnknown: health.coverageUnknown ?? null,
    lastRefreshMs: health.lastRefreshMs ?? null,
  });
  if (health.lastError) {
    // Surface a degraded read path as an ERROR event on this run.
    log.add("ERROR", "refreshOnce", "CATCH", { phase: "grid refresh" }, health.lastError);
  }
  return toRow(log);
}

/** Build a heartbeat from `health` and write it via `writerDb.logRun`. Returns run_id. */
async function writeHeartbeat(writerDb, health) {
  const row = buildHeartbeat(health);
  await writerDb.logRun(row);
  return row.run_id;
}

module.exports = { buildHeartbeat, writeHeartbeat, JOB };

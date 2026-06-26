// utils/logger/log.js
// Minimal run-log builder for ops-dashboard self-logging, modeled on the suite's
// utils/logger/log.js but trimmed to what we need: assemble a verbose_log array of
// event objects in the shared shape, derive warn_error_logs (the WARN/ERROR subset),
// and hand back the row the writer inserts. No DB and no filesystem here, so it stays
// unit-testable; db/pg-writer.js does the actual insert.
//
// Event shape matches util.app_run_logs: { run_id, dt, type, func, tag, note, err_msg }.
"use strict";

const { randomUUID } = require("crypto");

/**
 * Start a run log for one self-monitoring "run". The first event mirrors the suite's
 * on_boot CALL and crucially carries note.argv whose [2] is the job name -- the grid
 * derives (app, job) from verbose_log->0->note->argv->>2, so without it the run would
 * bucket as "(default)".
 */
function makeRunLog(job) {
  const run_id = randomUUID();
  const events = [];
  const api = {
    run_id,
    job,
    events,
    add(type, func, tag, note, err) {
      const ev = { run_id, dt: new Date().toISOString(), type, func, tag, note: note == null ? null : note };
      if (err != null) ev.err_msg = err instanceof Error ? (err.stack || err.message) : String(err);
      events.push(ev);
      return api;
    },
  };
  // argv[0]/[1] kept real; argv[2] = job so the grid buckets this run correctly.
  api.add("INFO", "on_boot", "CALL", { argv: [process.argv[0], process.argv[1], job] });
  return api;
}

/** Convert a run log into the writer's row shape. */
function toRow(runLog) {
  const verbose_log = runLog.events;
  const warn_error_logs = verbose_log.filter((e) => e.type === "WARN" || e.type === "ERROR");
  return { run_id: runLog.run_id, verbose_log, warn_error_logs };
}

module.exports = { makeRunLog, toRow };

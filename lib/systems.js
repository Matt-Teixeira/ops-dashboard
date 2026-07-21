// lib/systems.js
// Pure helpers for the per-system (equipment) correlation view (Phase 17): shape the
// cross-app warn/error rollup rows for the API and summarize them, shape a single
// system's (app,type,func) breakdown, and pick a system's connectivity rows out of the
// decorated /api/connectivity set. DB-free and DOM-free (mirrors lib/acq.js /
// lib/connectivity.js). server.js calls these on the rows from db/queries.
"use strict";

/**
 * Map the SYSTEMS_LATEST rows to the camelCase API shape. `which` (a comma-joined
 * DISTINCT app list from SQL) becomes an `apps` array; `appCount` is the numeric span.
 * Pure; never mutates. Non-array input -> [].
 */
function shapeSystems(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    systemId: r.sme,
    issues: Number(r.issues) || 0,
    errors: Number(r.errors) || 0,
    warns: Number(r.warns) || 0,
    appCount: Number(r.apps) || 0,
    apps: r.which ? String(r.which).split(",") : [],
    lastSeen: r.last_seen || null,
  }));
}

/**
 * List-header rollup over the raw SYSTEMS_LATEST rows: total systems, summed
 * error/warn events, and `crossApp` = how many systems raised issues in more than one
 * app (the correlation signal). Pure.
 */
function summarize(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const out = { systems: 0, errors: 0, warns: 0, crossApp: 0 };
  for (const r of arr) {
    out.systems += 1;
    out.errors += Number(r.errors) || 0;
    out.warns += Number(r.warns) || 0;
    if ((Number(r.apps) || 0) > 1) out.crossApp += 1;
  }
  return out;
}

/**
 * Map the SYSTEM_DETAIL rows (per app/type/func) to the camelCase API shape, carrying
 * the latest run_id + inserted_at so the UI can link each line to the run drill-down.
 * Pure; non-array input -> [].
 */
function shapeDetail(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    app: r.app_name,
    type: r.type,
    func: r.func,
    count: Number(r.n) || 0,
    lastRunId: r.last_run_id || null,
    lastInsertedAt: r.last_inserted_at || null,
  }));
}

/**
 * Pick the connectivity rows for one system out of the decorated /api/connectivity set
 * (lib/connectivity.decorate output, keyed by systemId). Returns a NEW array (may hold
 * an HHM and/or MMB row); pure. This is where the classified error_category (which lives
 * in alert.*, not the run-log note) is surfaced for the detail view.
 */
function pickSystem(decorated, systemId) {
  const arr = Array.isArray(decorated) ? decorated : [];
  return arr.filter((s) => s && s.systemId === systemId);
}

module.exports = { shapeSystems, summarize, shapeDetail, pickSystem };

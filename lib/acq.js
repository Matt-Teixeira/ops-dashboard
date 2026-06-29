// lib/acq.js
// Pure helpers for the per-system acquisition view (Phase 15): shape the
// stats.acquisition_history aggregate rows for the API, and roll them up per source
// (hhm/mmb). DB-free and DOM-free (mirrors lib/connectivity.js).
"use strict";

/** Map snake_case aggregate rows to the camelCase API shape. Pure; never mutates. */
function shapeSystems(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    systemId: r.system_id,
    source: r.data_source,
    manufacturer: r.manufacturer || null,
    modality: r.modality || null,
    runs: r.runs,
    failed: r.failed,
    lastSeen: r.last_seen || null,
  }));
}

/**
 * Per-source rollup for the header: { hhm: {systems,runs,failed}, mmb: {…} }.
 * Counts each (system,source) group as one "system" for that source and sums the
 * run/failed counts. Operates on raw aggregate rows (data_source + runs + failed).
 */
function summarizeBySource(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const out = { hhm: { systems: 0, runs: 0, failed: 0 }, mmb: { systems: 0, runs: 0, failed: 0 } };
  for (const r of arr) {
    const k = r.data_source === "hhm" ? "hhm" : r.data_source === "mmb" ? "mmb" : null;
    if (!k) continue;
    out[k].systems += 1;
    out[k].runs += Number(r.runs) || 0;
    out[k].failed += Number(r.failed) || 0;
  }
  return out;
}

module.exports = { shapeSystems, summarizeBySource };

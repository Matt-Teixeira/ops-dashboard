// lib/connectivity.js
// Canonical rules for the connectivity panel (Phase 10), turning raw rows from the
// alert.offline_hhm_conn / alert.offline_mmb_conn tables into the shape the
// /api/connectivity endpoint serves. Pure and DB-free (mirrors lib/runs.js); server.js
// calls decorate() on the rows from db/queries.connectivity().
//
// Each alert row is the LATEST state for one equipment system_id (upserted by the
// data_acquisition app). Two distinct ages matter and are kept separate:
//   - capture age  (now - capture_datetime): how stale the equipment data is.
//   - checked age  (now - inserted_at):      when the alert row was last written.
"use strict";

// Worst-first ranking for the offline-first panel. OFFLINE (a failed acquisition)
// is the operator's concern, UNKNOWN (no result yet) next, ONLINE last.
const STATUS_RANK = { OFFLINE: 0, UNKNOWN: 1, ONLINE: 2 };

/** Connectivity status from successful_acquisition: false->OFFLINE, true->ONLINE, null->UNKNOWN. */
function connStatus(row) {
  const ok = row && row.successful_acquisition;
  if (ok === true) return "ONLINE";
  if (ok === false) return "OFFLINE";
  return "UNKNOWN";
}

/** ms between `now` and a timestamp (Date or ISO string); null if absent/unparseable. */
function ageMs(value, now) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : now.getTime() - t;
}

/** How stale the equipment data is (now - capture_datetime). */
function captureAgeMs(row, now) { return ageMs(row && row.capture_datetime, now); }

/** When the alert row was last written (now - inserted_at). */
function checkedAgeMs(row, now) { return ageMs(row && row.inserted_at, now); }

/**
 * Sort worst-first: by status rank (OFFLINE -> UNKNOWN -> ONLINE), then most-stale
 * first (largest capture age, with unknown capture age last), then system_id for a
 * stable order. Returns a NEW array; never mutates the input.
 */
function sortConnectivity(rows, now) {
  const arr = Array.isArray(rows) ? rows.slice() : [];
  arr.sort((a, b) => {
    const ra = STATUS_RANK[connStatus(a)];
    const rb = STATUS_RANK[connStatus(b)];
    if (ra !== rb) return ra - rb;
    const ca = captureAgeMs(a, now);
    const cb = captureAgeMs(b, now);
    const an = ca == null, bn = cb == null;
    if (an !== bn) return an ? 1 : -1; // unknown capture age sorts last within a status
    if (!an && ca !== cb) return cb - ca; // larger age (more stale) first
    return String(a.system_id || "").localeCompare(String(b.system_id || ""));
  });
  return arr;
}

/** ISO string for a Date or passthrough for a string/null. */
function toIso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Sort + shape rows for the API: worst-first, with status and the two ages
 * attached and columns mapped to camelCase. Pure; `now` is injected.
 */
function decorate(rows, now) {
  return sortConnectivity(rows, now).map((r) => ({
    source: r.source,
    systemId: r.system_id,
    status: connStatus(r),
    captureDatetime: toIso(r.capture_datetime),
    insertedAt: toIso(r.inserted_at),
    captureAgeMs: captureAgeMs(r, now),
    checkedAgeMs: checkedAgeMs(r, now),
    errorCategory: r.error_category == null ? null : r.error_category,
    phase: r.phase == null ? null : r.phase,
    connectionError: r.connection_error == null ? null : r.connection_error,
    hostIntervention: r.host_intervention == null ? null : r.host_intervention,
  }));
}

/**
 * Per-source offline rollup (Phase 14) for the grid badge: { hhm: {offline,total},
 * mmb: {offline,total} }. Operates on decorated systems (source + status). Pure.
 */
function rollup(systems) {
  const arr = Array.isArray(systems) ? systems : [];
  const out = { hhm: { offline: 0, total: 0 }, mmb: { offline: 0, total: 0 } };
  for (const s of arr) {
    const k = s && s.source === "MMB" ? "mmb" : s && s.source === "HHM" ? "hhm" : null;
    if (!k) continue;
    out[k].total++;
    if (s.status === "OFFLINE") out[k].offline++;
  }
  return out;
}

module.exports = { STATUS_RANK, connStatus, captureAgeMs, checkedAgeMs, sortConnectivity, decorate, rollup };

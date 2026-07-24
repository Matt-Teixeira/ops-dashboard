// lib/connectivity.js
// Canonical rules for the connectivity panel (Phase 10), turning raw rows from the
// alert.offline_hhm_conn / alert.offline_mmb_conn tables into the shape the
// /api/connectivity endpoint serves. Pure and DB-free (mirrors lib/runs.js); server.js
// calls decorate() on the rows from db/queries.connectivity().
//
// Each alert row is the LAST RECORDED state for one equipment system_id (upserted by
// the data_acquisition app). Rows are never pruned when equipment leaves the active
// acquisition set, so a historical success must not read as "currently online".
// Three distinct facts are therefore kept separate:
//   - last result  (successful_acquisition): what the last attempt reported.
//   - capture age  (now - capture_datetime): how stale the equipment data is.
//   - checked age  (now - inserted_at):      when the alert row was last written.
"use strict";

// Both HHM and MMB acquisition groups run every 30 minutes. The suite's established
// schedule grace is 15 minutes (config/schedules.js), and data_acquisition's own MMB
// stale-data report uses the same 45-minute boundary. `inserted_at` is refreshed on
// every successful OR failed alert upsert, while capture_datetime deliberately stays
// old on a failed pull. Record freshness must therefore use inserted_at, not capture.
const FRESHNESS_BUDGET_MS = Object.freeze({
  HHM: 45 * 60 * 1000,
  MMB: 45 * 60 * 1000,
});

// Current operational results first; historical snapshot rows last. Within a state,
// sortConnectivity applies an age tie-breaker.
const OPERATIONAL_RANK = { OFFLINE: 0, UNKNOWN: 1, ONLINE: 2, STALE: 3 };
// Backward-compatible export name used by existing tests/consumers. This now ranks
// the operator-facing state, not the unqualified raw boolean.
const STATUS_RANK = OPERATIONAL_RANK;

/** Connectivity status from successful_acquisition: false->OFFLINE, true->ONLINE, null->UNKNOWN. */
function connStatus(row) {
  const ok = row && row.successful_acquisition;
  if (ok === true) return "ONLINE";
  if (ok === false) return "OFFLINE";
  return "UNKNOWN";
}

/** Confirmed source-specific freshness budget, or null for an unexpected source. */
function freshnessBudgetMs(source) {
  return FRESHNESS_BUDGET_MS[String(source || "").toUpperCase()] ?? null;
}

/** ms between `now` and a timestamp (Date or ISO string); null if absent/unparseable. */
function ageMs(value, now) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(t)) return null;
  // Small DB/app clock skew must not surface as a negative age or make a fresh row
  // look exceptional. A future timestamp is age zero until wall time catches up.
  return Math.max(0, now.getTime() - t);
}

/** How stale the equipment data is (now - capture_datetime). */
function captureAgeMs(row, now) { return ageMs(row && row.capture_datetime, now); }

/** When the alert row was last written (now - inserted_at). */
function checkedAgeMs(row, now) { return ageMs(row && row.inserted_at, now); }

/** CURRENT when the alert row was written within its confirmed source budget. */
function connFreshness(row, now) {
  const budget = freshnessBudgetMs(row && row.source);
  const age = checkedAgeMs(row, now);
  return budget != null && age != null && age <= budget ? "CURRENT" : "STALE";
}

/**
 * Operator-facing state. Raw ONLINE/OFFLINE/UNKNOWN is trustworthy as current only
 * while the snapshot record is fresh; otherwise the only honest state is STALE.
 */
function operationalState(row, now) {
  return connFreshness(row, now) === "CURRENT" ? connStatus(row) : "STALE";
}

/**
 * Sort current operational states first (OFFLINE -> UNKNOWN -> ONLINE), then stale
 * historical snapshots. Current rows retain the old capture-age tie-breaker (oldest
 * data first); stale rows put the most recently stale first. system_id is stable.
 */
function sortConnectivity(rows, now) {
  const arr = Array.isArray(rows) ? rows.slice() : [];
  arr.sort((a, b) => {
    const aState = operationalState(a, now);
    const bState = operationalState(b, now);
    const ra = OPERATIONAL_RANK[aState];
    const rb = OPERATIONAL_RANK[bState];
    if (ra !== rb) return ra - rb;
    if (aState === "STALE") {
      const aa = checkedAgeMs(a, now);
      const ba = checkedAgeMs(b, now);
      const an = aa == null, bn = ba == null;
      if (an !== bn) return an ? 1 : -1;
      if (!an && aa !== ba) return aa - ba; // nearest the freshness boundary first
    }
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
    // `status` is retained as the raw last result for response compatibility.
    status: connStatus(r),
    lastResult: connStatus(r),
    freshness: connFreshness(r, now),
    operationalState: operationalState(r, now),
    freshnessBudgetMs: freshnessBudgetMs(r.source),
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
 * Per-source CURRENT operational rollup for the grid badge. Every row lands in
 * exactly one of online/offline/unknown/stale, so the counts reconcile to total.
 */
function rollup(systems) {
  const arr = Array.isArray(systems) ? systems : [];
  const bucket = () => ({ online: 0, offline: 0, unknown: 0, stale: 0, total: 0 });
  const out = { hhm: bucket(), mmb: bucket() };
  for (const s of arr) {
    const k = s && s.source === "MMB" ? "mmb" : s && s.source === "HHM" ? "hhm" : null;
    if (!k) continue;
    out[k].total++;
    const state = String(s.operationalState || "STALE").toLowerCase();
    if (state in out[k] && state !== "total") out[k][state]++;
    else out[k].stale++;
  }
  return out;
}

module.exports = {
  FRESHNESS_BUDGET_MS,
  OPERATIONAL_RANK,
  STATUS_RANK,
  connStatus,
  freshnessBudgetMs,
  captureAgeMs,
  checkedAgeMs,
  connFreshness,
  operationalState,
  sortConnectivity,
  decorate,
  rollup,
};

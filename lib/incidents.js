// lib/incidents.js
// Pure helpers for the incidents view (Phase 19): shape the incidents.incidents rows
// (produced by incident-engine -- see that repo's integration brief) for the API, roll
// them up into the severity/state tiles, and normalize the incoming filter params.
// DB-free and DOM-free (mirrors lib/systems.js). server.js calls these on the rows
// from db/queries.
//
// The one semantic rule of this view lives here as data, not prose: `categorySource`
// is ALWAYS carried next to `category`. When it is 'oracle', the category is a
// corroborated hint about the equipment's recent past -- NOT a diagnosis of this
// incident -- and the UI must render it visibly differently. This lib never drops or
// rewrites that field.
"use strict";

// Rank tables for stable ordering ('critical' is reserved by the engine, unused today,
// but ranked so it would surface first if it ever appears). Unknown values sink last.
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATES = ["open", "recurring", "acknowledged", "resolved", "suppressed"];
const CATEGORY_RE = /^[a-z0-9_]{1,64}$/; // engine slugs, e.g. rsync_io_timeout

/** Normalize a ?severity= param to a known value or 'all'. */
function normalizeSeverity(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  return SEVERITIES.includes(v) ? v : "all";
}

/** Normalize a ?state= param to a known value or 'all'. */
function normalizeState(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  return STATES.includes(v) ? v : "all";
}

/** Normalize a ?category= param: a well-formed engine slug passes through (the list of
 *  slugs grows with the engine's taxonomy, so shape -- not membership -- is the gate);
 *  anything else -> 'all'. Always bound as a query param, never interpolated. */
function normalizeCategory(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  return CATEGORY_RE.test(v) ? v : "all";
}

/** Defensively parse the `assessment` jsonb: reasons is always a string array,
 *  recommendedAction a string or null. pg-promise hands jsonb over pre-parsed, but
 *  guard shapes anyway -- a malformed row must not blank the view. */
function shapeAssessment(a) {
  const obj = a && typeof a === "object" && !Array.isArray(a) ? a : {};
  const reasons = Array.isArray(obj.reasons) ? obj.reasons.filter((r) => typeof r === "string") : [];
  const action = typeof obj.recommendedAction === "string" && obj.recommendedAction ? obj.recommendedAction : null;
  return { reasons, recommendedAction: action };
}

/**
 * Map incidents.incidents rows to the camelCase API shape. Pure; non-array -> [].
 * `categorySource` rides along untouched ('classifier' | 'oracle'); text[] columns
 * arrive as JS arrays from pg-promise but are guarded anyway.
 */
function shapeIncidents(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    id: Number(r.id),
    entity: r.entity,
    severity: r.severity || "info",
    state: r.state || "open",
    category: r.category || "unknown",
    categorySource: r.category_source || "classifier",
    errorType: r.error_type || "",
    func: r.func || null,
    type: r.type || null,
    occurrenceCount: Number(r.occurrence_count) || 0,
    firstSeen: r.first_seen || null,
    lastSeen: r.last_seen || null,
    apps: Array.isArray(r.apps) ? r.apps : [],
    systems: Array.isArray(r.systems) ? r.systems : [],
    sampleRunId: r.sample_run_id || null,
    sampleMessage: r.sample_message || null,
    // NUMERIC arrives as a string; a malformed value must become null, not NaN --
    // NaN.toFixed(2) renders "NaN" in the detail view (Codex Phase 19 review, low).
    confidence: Number.isFinite(Number(r.confidence)) && r.confidence !== null ? Number(r.confidence) : null,
    assessorKind: r.assessor_kind || null,
    assessment: shapeAssessment(r.assessment),
    resolvedAt: r.resolved_at || null,
    resolvedReason: r.resolved_reason || null,
  }));
}

/**
 * Tile rollup from the INCIDENTS_ROLLUP rows (severity, state, n). Returns
 * { total, bySeverity: {high: n, ...}, byState: {open: n, ...} } with every known
 * key present (0 default) so the UI never branches on undefined. The totals are
 * arithmetically forced to equal the GROUP BY -- the UI's self-check.
 */
function shapeRollup(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const bySeverity = {};
  for (const s of SEVERITIES) bySeverity[s] = 0;
  const byState = {};
  for (const s of STATES) byState[s] = 0;
  let total = 0;
  for (const r of arr) {
    const n = Number(r.n) || 0;
    total += n;
    if (r.severity in bySeverity) bySeverity[r.severity] += n;
    if (r.state in byState) byState[r.state] += n;
  }
  return { total, bySeverity, byState };
}

/** Map incidents.error_events drill-down rows to the API shape. Pure; non-array -> []. */
function shapeEvents(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    runId: r.run_id,
    eventOrd: Number(r.event_ord),
    app: r.src_app_name,
    type: r.type,
    func: r.func || null,
    tag: r.tag || null,
    // The human-readable text, in the engine's own fallback order.
    message: r.err_msg || r.note_message || null,
    sme: r.sme || null,
    systemId: r.system_id || null,
    category: r.error_category || "unknown",
    dt: r.dt || null,
    insertedAt: r.inserted_at || null,
  }));
}

module.exports = {
  SEVERITIES,
  STATES,
  normalizeSeverity,
  normalizeState,
  normalizeCategory,
  shapeIncidents,
  shapeRollup,
  shapeEvents,
  shapeAssessment,
};

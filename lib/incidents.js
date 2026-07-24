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
// but ranked so it would surface first if it ever appears). Activity classes mirror
// incident-engine/domain/state.js: acknowledged is closeable/active; suppressed is
// terminal/inactive. Unknown values sink after both known classes in SQL.
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATES = ["open", "recurring", "acknowledged", "resolved", "suppressed"];
const ACTIVE_STATES = ["open", "recurring", "acknowledged"];
const INACTIVE_STATES = ["resolved", "suppressed"];
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

/** Lean list projection: intentionally excludes detail-only assessment/sample/apps. */
function shapeIncidentList(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r) => ({
    id: Number(r.id),
    entity: r.entity,
    severity: r.severity || "info",
    state: r.state || "open",
    category: r.category || "unknown",
    categorySource: r.category_source || "classifier",
    occurrenceCount: Number(r.occurrence_count) || 0,
    lastSeen: r.last_seen || null,
  }));
}

function encodeCursor(row) {
  if (!row) return null;
  const payload = {
    a: Number(row.activity_rank),
    s: Number(row.severity_rank),
    t: row.last_seen == null ? null : new Date(row.last_seen).toISOString(),
    i: String(row.id),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("invalid cursor");
  let value;
  try { value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); }
  catch { throw new Error("invalid cursor"); }

  let id;
  let lastSeen = null;
  try {
    if (!/^\d{1,20}$/.test(String(value && value.i))) throw new Error();
    id = BigInt(String(value.i));
    if (id < 0n || id > 9223372036854775807n) throw new Error();
    if (value.t !== null) {
      if (typeof value.t !== "string" || value.t.startsWith("0000-") ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.t)) throw new Error();
      const parsed = new Date(value.t);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value.t) throw new Error();
      lastSeen = value.t;
    }
  } catch {
    throw new Error("invalid cursor");
  }
  if (!value || !Number.isInteger(value.a) || value.a < 0 || value.a > 2 ||
      !Number.isInteger(value.s) || value.s < 0 || value.s > 5) {
    throw new Error("invalid cursor");
  }
  return { activityRank: value.a, severityRank: value.s, lastSeen, id: String(id) };
}

/**
 * Tile/facet rollup from the INCIDENTS_ROLLUP rows (severity, state, category, n).
 * Returns known severity/state keys with zero defaults plus a deterministic
 * byCategory array ({category, count}, count DESC then name). The total is
 * arithmetically forced to equal the GROUP BY -- the UI's self-check.
 */
function shapeRollup(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const bySeverity = {};
  for (const s of SEVERITIES) bySeverity[s] = 0;
  const byState = {};
  for (const s of STATES) byState[s] = 0;
  const categoryCounts = new Map();
  let total = 0;
  for (const r of arr) {
    const n = Number(r.n) || 0;
    total += n;
    if (r.severity in bySeverity) bySeverity[r.severity] += n;
    if (r.state in byState) byState[r.state] += n;
    const category = typeof r.category === "string" && r.category ? r.category : "unknown";
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + n);
  }
  const byCategory = Array.from(categoryCounts, ([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { total, bySeverity, byState, byCategory };
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
  ACTIVE_STATES,
  INACTIVE_STATES,
  normalizeSeverity,
  normalizeState,
  normalizeCategory,
  shapeIncidents,
  shapeIncidentList,
  encodeCursor,
  decodeCursor,
  shapeRollup,
  shapeEvents,
  shapeAssessment,
};

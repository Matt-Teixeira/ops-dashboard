"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeSeverity,
  normalizeState,
  normalizeCategory,
  shapeIncidents,
  shapeRollup,
  shapeEvents,
  shapeAssessment,
  ACTIVE_STATES,
  INACTIVE_STATES,
  shapeIncidentList,
  encodeCursor,
  decodeCursor,
} = require("../lib/incidents");

test("activity classes mirror incident-engine lifecycle semantics", () => {
  assert.deepEqual(ACTIVE_STATES, ["open", "recurring", "acknowledged"]);
  assert.deepEqual(INACTIVE_STATES, ["resolved", "suppressed"]);
});

test("normalizeSeverity: known values pass (case/space-insensitive), else 'all'", () => {
  assert.equal(normalizeSeverity("high"), "high");
  assert.equal(normalizeSeverity(" HIGH "), "high");
  assert.equal(normalizeSeverity("critical"), "critical"); // reserved but rankable
  assert.equal(normalizeSeverity("bogus"), "all");
  assert.equal(normalizeSeverity(undefined), "all");
  assert.equal(normalizeSeverity(null), "all");
});

test("normalizeState: known values pass, else 'all'", () => {
  assert.equal(normalizeState("open"), "open");
  assert.equal(normalizeState("recurring"), "recurring");
  assert.equal(normalizeState("Resolved"), "resolved");
  assert.equal(normalizeState("nope"), "all");
});

test("normalizeCategory: shape-gated slug, else 'all' (grows with the engine taxonomy)", () => {
  assert.equal(normalizeCategory("rsync_io_timeout"), "rsync_io_timeout");
  assert.equal(normalizeCategory("no_new_data"), "no_new_data");
  assert.equal(normalizeCategory("Robert'); DROP TABLE--"), "all"); // shape-rejected
  assert.equal(normalizeCategory("has space"), "all");
  assert.equal(normalizeCategory(""), "all");
});

test("shapeAssessment: defensive on malformed jsonb", () => {
  assert.deepEqual(shapeAssessment({ reasons: ["a", "b"], recommendedAction: "fix it" }), {
    reasons: ["a", "b"],
    recommendedAction: "fix it",
  });
  assert.deepEqual(shapeAssessment(null), { reasons: [], recommendedAction: null });
  assert.deepEqual(shapeAssessment("junk"), { reasons: [], recommendedAction: null });
  assert.deepEqual(shapeAssessment({ reasons: "not-array", recommendedAction: 7 }), { reasons: [], recommendedAction: null });
  assert.deepEqual(shapeAssessment({ reasons: ["ok", 42, "also ok"] }), { reasons: ["ok", "also ok"], recommendedAction: null });
});

test("shapeIncidents: camelCase mapping; categorySource always carried next to category", () => {
  const rows = [{
    id: "7", entity: "SME01234", severity: "high", state: "open",
    category: "rsync_io_timeout", category_source: "oracle", error_type: "",
    func: "execRsync", type: "ERROR", occurrence_count: "42",
    first_seen: "2026-07-08T00:00:00Z", last_seen: "2026-07-21T00:00:00Z",
    apps: ["data_acquisition"], systems: ["SME01234"],
    sample_run_id: "6f3a...", sample_message: "No new monitoring data found.",
    confidence: "0.30", assessor_kind: "rules",
    assessment: { reasons: ["unclassified"], recommendedAction: null },
    resolved_at: null, resolved_reason: null,
  }];
  const out = shapeIncidents(rows);
  assert.equal(out.length, 1);
  const i = out[0];
  assert.equal(i.id, 7);
  assert.equal(i.category, "rsync_io_timeout");
  // The load-bearing field: an oracle-provenance category must survive shaping
  // untouched so the UI can render it as a hint, not a diagnosis.
  assert.equal(i.categorySource, "oracle");
  assert.equal(i.occurrenceCount, 42);
  assert.equal(i.confidence, 0.3);
  assert.deepEqual(i.assessment, { reasons: ["unclassified"], recommendedAction: null });
});

test("shapeIncidents: defensive defaults; non-array -> []", () => {
  assert.deepEqual(shapeIncidents(null), []);
  const [i] = shapeIncidents([{ id: 1 }]);
  assert.equal(i.severity, "info");
  assert.equal(i.state, "open");
  assert.equal(i.category, "unknown");
  assert.equal(i.categorySource, "classifier");
  assert.deepEqual(i.apps, []);
  assert.deepEqual(i.assessment, { reasons: [], recommendedAction: null });
});

test("shapeIncidents: malformed confidence -> null, never NaN (Codex low finding)", () => {
  const shape = (confidence) => shapeIncidents([{ id: 1, confidence }])[0].confidence;
  assert.equal(shape("0.30"), 0.3);      // NUMERIC arrives as a string
  assert.equal(shape(1), 1);
  assert.equal(shape(null), null);
  assert.equal(shape(undefined), null);
  assert.equal(shape("garbage"), null);  // was NaN -> rendered "NaN (rules)"
  assert.equal(shape(NaN), null);
  assert.equal(shape(Infinity), null);
});

test("shapeIncidentList: lean projection preserves provenance and omits detail payload", () => {
  const [i] = shapeIncidentList([{ id: "9", entity: "SME1", severity: "high", state: "open", category: "unknown", category_source: "oracle", occurrence_count: "7", first_seen: "2026-07-19T00:00:00Z", last_seen: "2026-07-21T00:00:00Z", assessment: { reasons: ["large"] }, sample_message: "large" }]);
  assert.deepEqual(i, { id: 9, entity: "SME1", severity: "high", state: "open", category: "unknown", categorySource: "oracle", occurrenceCount: 7, firstSeen: "2026-07-19T00:00:00Z", lastSeen: "2026-07-21T00:00:00Z" });
  assert.equal("assessment" in i, false);
  assert.equal("sampleMessage" in i, false);
  // firstSeen is additive (Phase 32) and defensive like lastSeen
  assert.equal(shapeIncidentList([{ id: 1 }])[0].firstSeen, null);
});

test("incident cursor: opaque round trip and malformed inputs fail closed", () => {
  const encoded = encodeCursor({ activity_rank: 0, severity_rank: 2, last_seen: "2026-07-21T12:00:00Z", id: "17338" });
  assert.deepEqual(decodeCursor(encoded), { activityRank: 0, severityRank: 2, lastSeen: "2026-07-21T12:00:00.000Z", id: "17338" });
  const nullTime = encodeCursor({ activity_rank: 1, severity_rank: 4, last_seen: null, id: "1" });
  assert.equal(decodeCursor(nullTime).lastSeen, null);
  for (const bad of ["", "not+base64", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ a: 9, s: 0, t: null, i: "1" })).toString("base64url")]) {
    assert.throws(() => decodeCursor(bad), /invalid cursor/);
  }
});

test("incident cursor: only canonical PostgreSQL-compatible timestamps pass", () => {
  const cursor = (t) => Buffer.from(JSON.stringify({ a: 0, s: 1, t, i: "7" })).toString("base64url");
  assert.equal(decodeCursor(cursor("2026-07-21T12:00:00.000Z")).lastSeen, "2026-07-21T12:00:00.000Z");
  for (const bad of [
    "Tue, 21 Jul 2026 12:00:00 GMT",
    "2026-07-21T12:00:00Z",
    "-000001-01-01T00:00:00.000Z",
    "+010000-01-01T00:00:00.000Z",
    "0000-01-01T00:00:00.000Z",
    "2026-02-30T00:00:00.000Z",
  ]) {
    assert.throws(() => decodeCursor(cursor(bad)), /invalid cursor/, bad);
  }
});

test("incident cursor: id is bounded to PostgreSQL signed bigint", () => {
  const cursor = (i) => Buffer.from(JSON.stringify({ a: 0, s: 1, t: null, i })).toString("base64url");
  assert.equal(decodeCursor(cursor("9223372036854775807")).id, "9223372036854775807");
  for (const bad of ["9223372036854775808", "99999999999999999999", "-1", "1.0", "abc"])
    assert.throws(() => decodeCursor(cursor(bad)), /invalid cursor/, bad);
});

test("shapeRollup: totals equal the GROUP BY (the tile self-check), all keys present", () => {
  const rows = [
    { severity: "high", state: "open", category: "connection_reset", n: 100 },
    { severity: "high", state: "resolved", category: "connection_reset", n: 9 },
    { severity: "medium", state: "open", category: "unknown", n: 200 },
    { severity: "info", state: "recurring", category: "no_new_data", n: 31 },
  ];
  const r = shapeRollup(rows);
  assert.equal(r.total, 340);
  assert.equal(r.bySeverity.high, 109);
  assert.equal(r.bySeverity.medium, 200);
  assert.equal(r.bySeverity.info, 31);
  assert.equal(r.bySeverity.critical, 0); // present even when absent from rows
  assert.equal(r.byState.open, 300);
  assert.equal(r.byState.recurring, 31);
  assert.equal(r.byState.resolved, 9);
  assert.equal(r.byState.suppressed, 0);
  assert.deepEqual(r.byCategory, [
    { category: "unknown", count: 200 },
    { category: "connection_reset", count: 109 },
    { category: "no_new_data", count: 31 },
  ]);
  // total must equal both axis sums -- the arithmetic identity the tiles rely on
  const sevSum = Object.values(r.bySeverity).reduce((a, b) => a + b, 0);
  const stSum = Object.values(r.byState).reduce((a, b) => a + b, 0);
  const catSum = r.byCategory.reduce((a, item) => a + item.count, 0);
  assert.equal(sevSum, r.total);
  assert.equal(stSum, r.total);
  assert.equal(catSum, r.total);
});

test("shapeRollup: categories sort by count then name and malformed names fall back", () => {
  const r = shapeRollup([
    { severity: "high", state: "open", category: "zeta", n: "2" },
    { severity: "medium", state: "open", category: "alpha", n: 2 },
    { severity: "info", state: "resolved", category: null, n: 1 },
  ]);
  assert.deepEqual(r.byCategory, [
    { category: "alpha", count: 2 },
    { category: "zeta", count: 2 },
    { category: "unknown", count: 1 },
  ]);
});

test("shapeRollup: empty/non-array -> zeroed shape", () => {
  const r = shapeRollup(undefined);
  assert.equal(r.total, 0);
  assert.equal(r.bySeverity.high, 0);
  assert.equal(r.byState.open, 0);
  assert.deepEqual(r.byCategory, []);
});

test("shapeEvents: message falls back err_msg -> note_message (the engine's order)", () => {
  const out = shapeEvents([
    { run_id: "a", event_ord: 0, src_app_name: "hhm_rpp_ge", type: "WARN", err_msg: null, note_message: "delta unchanged", error_category: "no_new_data", dt: "2026-07-21T00:00:00Z" },
    { run_id: "b", event_ord: 3, src_app_name: "data_acquisition", type: "ERROR", err_msg: "rsync error: timeout", note_message: "ignored", error_category: "rsync_io_timeout" },
  ]);
  assert.equal(out[0].message, "delta unchanged");
  assert.equal(out[1].message, "rsync error: timeout");
  assert.equal(out[0].category, "no_new_data");
  assert.deepEqual(shapeEvents("junk"), []);
});

// DB-free guard on the SQL text contract (queries.js can't be required without DB env).
// Protects the Phase 19 invariants: read-only surface, bound params, index-friendly
// ordering, and that this view never goes near verbose_log.
test("incidents SQL: bound params, no interpolation, no verbose_log, index-friendly order", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const sqls = ["INCIDENTS_ROLLUP_SQL", "INCIDENTS_LIST_SQL", "INCIDENT_DETAIL_SQL", "INCIDENT_EVENTS_SQL"].map((name) => {
    const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
    assert.ok(m, `${name} template found`);
    return m[1];
  });
  const [rollup, list, detail, events] = sqls;
  for (const sql of sqls) {
    assert.doesNotMatch(sql, /verbose_log/, "incidents view never touches verbose_log");
    assert.doesNotMatch(sql, /\$\{/, "no template interpolation inside SQL");
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i, "read-only"); // \b: inserted_at is fine
  }
  assert.match(rollup, /SELECT severity, state, category, count/);
  assert.match(rollup, /GROUP BY severity, state, category/);
  assert.match(list, /\$1 = 'all' OR severity = \$1/, "severity filter bound");
  assert.match(list, /\$3 = 'all' OR category = \$3/, "category filter bound");
  assert.match(list, /CASE severity WHEN 'critical' THEN 0/, "explicit severity rank");
  assert.match(list, /state IN \('open', 'recurring', 'acknowledged'\) THEN 0/, "active states rank first");
  assert.match(list, /state IN \('resolved', 'suppressed'\) THEN 1 ELSE 2/, "inactive then unknown states");
  assert.match(list, /activity_rank ASC, severity_rank ASC, last_seen DESC NULLS LAST/, "exact mixed-direction order");
  assert.match(list, /last_seen IS NOT DISTINCT FROM \$7::timestamptz AND id < \$8::bigint/, "equal-time id boundary is bound");
  assert.match(list, /id DESC/, "stable id tie-breaker");
  assert.match(list, /category_source/, "provenance always selected with category");
  assert.doesNotMatch(list, /assessment|sample_message|sample_run_id|\bapps\b|\bsystems\b/, "list projection stays lean");
  assert.match(detail, /id = \$1::bigint/, "detail keyed by bound bigint id");
  assert.match(events, /fingerprint = \$1 AND entity = \$2/, "drill-down keyed to hit the engine's (fingerprint, entity, dt DESC) index");
  assert.match(events, /ORDER BY dt DESC\n/, "plain dt DESC -- must match the index ordering exactly");
  assert.doesNotMatch(events, /NULLS LAST/, "NULLS LAST breaks the index match and forces fetch-all+sort");
  assert.match(events, /LIMIT \$3/, "drill-down bounded");
});

test("Phase 32: entity scope is bound (NULL sentinel) and the scoped count mirrors the list filters", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const list = src.match(/const INCIDENTS_LIST_SQL = `([\s\S]*?)`;/)[1];
  // NULL means "no scope" -- 'all' would be ambiguous because it is itself a
  // valid producer entity under the safe-id contract.
  assert.match(list, /\$9::text IS NULL OR entity = \$9/, "entity scope bound as $9");
  assert.match(list, /first_seen/, "lean rows carry first_seen for the workspace");
  const count = src.match(/const INCIDENTS_SCOPED_COUNT_SQL = `([\s\S]*?)`;/)[1];
  assert.doesNotMatch(count, /\$\{/, "no interpolation");
  assert.doesNotMatch(count, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i, "read-only");
  assert.match(count, /\$1 = 'all' OR severity = \$1/, "same severity semantics as the list");
  assert.match(count, /\$2 = 'all' OR state = \$2/, "same state semantics as the list");
  assert.match(count, /\$3 = 'all' OR category = \$3/, "same category semantics as the list");
  assert.match(count, /AND entity = \$4/, "scoped count is always entity-bound");
  // The cursor tuple did NOT grow: entity narrows the ranked set, order unchanged.
  assert.match(list, /activity_rank ASC, severity_rank ASC, last_seen DESC NULLS LAST/);
});

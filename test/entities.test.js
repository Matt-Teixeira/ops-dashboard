"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  classifyEntity,
  isSafeEntity,
  shapeEntityResponse,
  ACTIVE_STATES,
  INACTIVE_STATES,
} = require("../lib/entities");

function row(overrides = {}) {
  return {
    entity: "SME00001",
    incident_count: 3,
    active_incident_count: 2,
    terminal_incident_count: 1,
    other_state_count: 0,
    state_open: 1,
    state_recurring: 1,
    state_acknowledged: 0,
    state_resolved: 1,
    state_suppressed: 0,
    severity_critical: 0,
    severity_high: 1,
    severity_medium: 1,
    severity_low: 0,
    severity_info: 1,
    severity_other: 0,
    active_severity_critical: 0,
    active_severity_high: 1,
    active_severity_medium: 1,
    active_severity_low: 0,
    active_severity_info: 0,
    active_severity_other: 0,
    occurrence_count: "9007199254740993",
    first_seen: "2026-07-01T00:00:00Z",
    oldest_active_first_seen: "2026-07-02T00:00:00Z",
    last_seen: "2026-07-21T00:00:00Z",
    apps: ["z_app", "a_app"],
    category: "connection_reset",
    category_source: "classifier",
    source_count: 3,
    source_active_count: 2,
    category_count: 3,
    category_active_count: 2,
    ...overrides,
  };
}

test("entity classification shares the safe id contract and preserves non-SME groups", () => {
  assert.equal(isSafeEntity("SME01139"), true);
  assert.equal(isSafeEntity("SME_bad-1"), true);
  assert.equal(isSafeEntity("bad value"), false);
  assert.equal(isSafeEntity("x".repeat(65)), false);
  assert.equal(classifyEntity("SME01139"), "sme");
  assert.equal(classifyEntity("__global__"), "global");
  assert.equal(classifyEntity("RTT00001"), "other");
  assert.equal(classifyEntity("sme01139"), "other", "SME prefix is canonical and case-sensitive");
  assert.equal(classifyEntity(""), "other", "a malformed future producer value is reconciled, not dropped");
  assert.deepEqual(ACTIVE_STATES, ["open", "recurring", "acknowledged"]);
  assert.deepEqual(INACTIVE_STATES, ["resolved", "suppressed"]);
});

test("shapeEntityResponse supplies complete state/severity defaults and worst active severity", () => {
  const out = shapeEntityResponse([row()], "2026-07-21T12:00:00Z");
  assert.equal(out.asOf, "2026-07-21T12:00:00.000Z");
  assert.equal(out.count, 1);
  const entity = out.entities[0];
  assert.equal(entity.entityKind, "sme");
  assert.equal(entity.incidentCount, 3);
  assert.equal(entity.activeIncidentCount, 2);
  assert.equal(entity.terminalIncidentCount, 1);
  assert.equal(entity.otherStateCount, 0);
  assert.deepEqual(entity.byState, {
    open: 1, recurring: 1, acknowledged: 0, resolved: 1, suppressed: 0, other: 0,
  });
  assert.deepEqual(entity.bySeverity, {
    critical: 0, high: 1, medium: 1, low: 0, info: 1, other: 0,
  });
  assert.deepEqual(entity.activeBySeverity, {
    critical: 0, high: 1, medium: 1, low: 0, info: 0, other: 0,
  });
  assert.equal(entity.worstActiveSeverity, "high");
  assert.equal(entity.occurrenceCount, "9007199254740993");
});

test("category/source merge is deterministic, provenance-complete, and duplicate-safe", () => {
  const base = row({
    category: "mixed_category", category_source: "classifier",
    source_count: 4, source_active_count: 2, category_count: 5, category_active_count: 2,
  });
  const oracle = row({
    category: "mixed_category", category_source: "oracle",
    source_count: 1, source_active_count: 0, category_count: 5, category_active_count: 2,
  });
  const moreActive = row({
    category: "active_first", category_source: "oracle",
    source_count: 3, source_active_count: 3, category_count: 3, category_active_count: 3,
  });
  const [entity] = shapeEntityResponse([base, oracle, oracle, moreActive]).entities;
  assert.deepEqual(entity.categories, [
    { category: "active_first", count: 3, activeCount: 3, sources: ["oracle"] },
    { category: "mixed_category", count: 5, activeCount: 2, sources: ["classifier", "oracle"] },
  ]);
});

test("apps are deduplicated/sorted; missing arrays and unusual category provenance are defensive", () => {
  const [entity] = shapeEntityResponse([
    row({ apps: ["z_app", "a_app", "a_app"] }),
    row({
      apps: null, category: null, category_source: null,
      source_count: 1, source_active_count: 0,
      category_count: 1, category_active_count: 0,
    }),
  ]).entities;
  assert.equal(entity.appCount, 2);
  assert.deepEqual(entity.apps, ["a_app", "z_app"]);
  assert.deepEqual(entity.categories[1], {
    category: "unknown", count: 1, activeCount: 0, sources: ["unknown"],
  });
  assert.deepEqual(shapeEntityResponse(null).entities, []);
  assert.deepEqual(shapeEntityResponse([null, 1]).nonSmeEntities, []);
});

test("entity order is active, worst severity, active count, latest seen, then id", () => {
  const make = (entity, active, severity, lastSeen) => row({
    entity,
    active_incident_count: active,
    terminal_incident_count: active ? 0 : 3,
    state_open: active,
    state_recurring: 0,
    state_resolved: active ? 0 : 3,
    active_severity_high: severity === "high" ? active : 0,
    active_severity_medium: severity === "medium" ? active : 0,
    last_seen: lastSeen,
  });
  const out = shapeEntityResponse([
    make("SME00005", 0, null, "2026-07-21T05:00:00Z"),
    make("SME00004", 0, null, "2026-07-21T06:00:00Z"),
    make("SME00003", 2, "medium", "2026-07-21T09:00:00Z"),
    make("SME00002", 1, "medium", "2026-07-21T10:00:00Z"),
    make("SME00001", 1, "high", "2026-07-20T00:00:00Z"),
  ]);
  assert.deepEqual(out.entities.map((item) => item.entity), [
    "SME00001", "SME00003", "SME00002", "SME00004", "SME00005",
  ]);
});

test("SME and non-SME summaries reconcile every count axis without losing bigint occurrences", () => {
  const global = row({
    entity: "__global__",
    incident_count: 2,
    active_incident_count: 1,
    terminal_incident_count: 1,
    state_open: 1,
    state_recurring: 0,
    state_resolved: 1,
    severity_high: 0,
    severity_medium: 1,
    severity_info: 1,
    active_severity_high: 0,
    active_severity_medium: 1,
    occurrence_count: "11",
    apps: ["data_acquisition"],
    source_count: 2,
    source_active_count: 1,
    category_count: 2,
    category_active_count: 1,
  });
  const other = row({
    entity: "RTT00001",
    incident_count: 1,
    active_incident_count: 1,
    terminal_incident_count: 0,
    state_open: 1,
    state_recurring: 0,
    state_resolved: 0,
    severity_high: 0,
    severity_medium: 0,
    severity_info: 1,
    active_severity_high: 0,
    active_severity_medium: 0,
    active_severity_info: 1,
    occurrence_count: "7",
    source_count: 1,
    source_active_count: 1,
    category_count: 1,
    category_active_count: 1,
  });
  const out = shapeEntityResponse([row(), global, other]);
  assert.equal(out.summary.incidentCount, 3);
  assert.equal(out.summary.nonSme.entityCount, 2);
  assert.equal(out.summary.nonSme.incidentCount, 3);
  assert.equal(out.summary.nonSme.activeIncidentCount, 2);
  assert.equal(out.summary.nonSme.occurrenceCount, "18");
  assert.equal(
    (BigInt(out.summary.occurrenceCount) + BigInt(out.summary.nonSme.occurrenceCount)).toString(),
    "9007199254741011",
  );

  const all = [...out.entities, ...out.nonSmeEntities];
  assert.equal(all.reduce((sum, item) => sum + item.incidentCount, 0), 6);
  for (const key of Object.keys(out.summary.byState)) {
    const nonSmeCount = out.nonSmeEntities.reduce((sum, item) => sum + item.byState[key], 0);
    const fullCount = all.reduce((sum, item) => sum + item.byState[key], 0);
    assert.equal(out.summary.byState[key] + nonSmeCount, fullCount, `state ${key}`);
  }
  for (const key of Object.keys(out.summary.bySeverity)) {
    const nonSmeCount = out.nonSmeEntities.reduce((sum, item) => sum + item.bySeverity[key], 0);
    const fullCount = all.reduce((sum, item) => sum + item.bySeverity[key], 0);
    assert.equal(out.summary.bySeverity[key] + nonSmeCount, fullCount, `severity ${key}`);
  }
});

test("inactive and unknown active severities have explicit worst-value semantics", () => {
  const inactive = row({
    entity: "SME00001", active_incident_count: 0,
    active_severity_high: 0, active_severity_medium: 0,
  });
  const unusual = row({
    entity: "SME00002", severity_other: 2, active_severity_high: 0,
    active_severity_medium: 0, active_severity_other: 2,
  });
  const out = shapeEntityResponse([inactive, unusual]);
  assert.equal(out.entities.find((item) => item.entity === "SME00001").worstActiveSeverity, null);
  assert.equal(out.entities.find((item) => item.entity === "SME00002").worstActiveSeverity, "other");
});

test("entity summary SQL is complete, read-only, schema-local, unbounded, and deterministically ordered", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const match = src.match(/const INCIDENT_ENTITY_SUMMARIES_SQL = `([\s\S]*?)`;/);
  assert.ok(match, "entity summary SQL template found");
  const sql = match[1];
  assert.match(sql, /FROM incidents\.incidents/);
  assert.match(sql, /GROUP BY entity/);
  assert.match(sql, /category_source/);
  assert.match(sql, /occurrence_count, 0\)\), 0\)::text/);
  assert.match(sql, /state IN \('open', 'recurring', 'acknowledged'\)/);
  assert.match(sql, /e\.active_incident_count DESC/);
  assert.match(sql, /e\.last_seen DESC NULLS LAST/);
  assert.match(sql, /e\.entity ASC NULLS LAST/);
  assert.doesNotMatch(sql, /\bLIMIT\b/i, "complete table aggregation has no silent cap");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i, "read-only");
  assert.doesNotMatch(sql, /\b(alert|stats|util)\./, "no cross-source composition");
  assert.doesNotMatch(sql, /error_events|pipeline_state|verbose_log/);
  assert.doesNotMatch(sql, /\$\{/);
});

test("server exposes the thin sanitized GET /api/entities handler", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const match = src.match(/app\.get\("\/api\/entities",([\s\S]*?)\n  \}\);/);
  assert.ok(match, "GET /api/entities route found");
  assert.match(match[1], /queries\.incidentEntitySummaries\(\)/);
  assert.match(match[1], /entitiesLib\.shapeEntityResponse\(rows, asOf\)/);
  assert.match(match[1], /next\(err\)/, "shared sanitized error handler owns failures");
});

// --- Phase 32: entity workspace context ------------------------------------

const { shapeEntityContext, entityContextIsEmpty } = require("../lib/entities");

test("shapeEntityContext: one entity's summary, connectivity, and signals stay separate", () => {
  const summaryRows = [
    row({ entity: "SME01139", category: "rsync_io_timeout", category_source: "classifier" }),
    row({ entity: "SME01139", category: "rsync_io_timeout", category_source: "oracle" }),
  ];
  const context = shapeEntityContext({
    entity: "SME01139",
    summaryRows,
    connectivity: [{ source: "MMB", operationalState: "OFFLINE" }],
    signals: [{ app: "data_acquisition", type: "ERROR", func: "execRsync", count: 4 }],
    windowHours: 24,
    asOf: "2026-07-24T12:00:00Z",
  });
  assert.equal(context.entity, "SME01139");
  assert.equal(context.entityKind, "sme");
  assert.equal(context.asOf, "2026-07-24T12:00:00.000Z");
  assert.equal(context.signalWindowHours, 24);
  assert.equal(context.incidentSummary.entity, "SME01139");
  // provenance survives the merge: both sources listed on the one category
  assert.deepEqual(context.incidentSummary.categories[0].sources, ["classifier", "oracle"]);
  assert.equal(context.connectivity.length, 1);
  assert.equal(context.signals.length, 1);
  assert.equal(entityContextIsEmpty(context), false);
});

test("shapeEntityContext: non-SME kinds are honest; unscoped rows resolve the requested id only", () => {
  const globalContext = shapeEntityContext({
    entity: "__global__",
    summaryRows: [row({ entity: "__global__" }), row({ entity: "SME99999" })],
    connectivity: [],
    signals: [],
    windowHours: 48,
  });
  assert.equal(globalContext.entityKind, "global");
  assert.equal(globalContext.incidentSummary.entity, "__global__");
  assert.equal(shapeEntityContext({ entity: "RTT00001", summaryRows: [row({ entity: "RTT00001" })] }).entityKind, "other");
});

test("shapeEntityContext: partial sources are valid workspaces; all-empty is the 404 rule", () => {
  const incidentsOnly = shapeEntityContext({ entity: "SME08284", summaryRows: [row({ entity: "SME08284" })], connectivity: [], signals: [], windowHours: 24 });
  assert.equal(entityContextIsEmpty(incidentsOnly), false);
  const connectivityOnly = shapeEntityContext({ entity: "SME10262", summaryRows: [], connectivity: [{ source: "MMB" }], signals: [], windowHours: 24 });
  assert.equal(connectivityOnly.incidentSummary, null);
  assert.equal(entityContextIsEmpty(connectivityOnly), false);
  const signalsOnly = shapeEntityContext({ entity: "SME00042", summaryRows: [], connectivity: [], signals: [{ app: "a", type: "WARN" }], windowHours: 24 });
  assert.equal(entityContextIsEmpty(signalsOnly), false);
  const empty = shapeEntityContext({ entity: "SME00000", summaryRows: [], connectivity: [], signals: [], windowHours: 24 });
  assert.equal(entityContextIsEmpty(empty), true);
  assert.equal(entityContextIsEmpty(null), true);
  // defensive: malformed source payloads shape to empty arrays, never throw
  const malformed = shapeEntityContext({ entity: "SME1", summaryRows: null, connectivity: "junk", signals: undefined, windowHours: "x" });
  assert.deepEqual(malformed.connectivity, []);
  assert.deepEqual(malformed.signals, []);
  assert.equal(malformed.signalWindowHours, 0);
  assert.equal(entityContextIsEmpty(malformed), true);
});

test("Phase 32 SQL: summaries take an optional bound entity; scoped reads stay read-only", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const sql = src.match(/const INCIDENT_ENTITY_SUMMARIES_SQL = `([\s\S]*?)`;/)[1];
  // NULL sentinel, not 'all': 'all' is itself a valid producer entity id.
  assert.match(sql, /\$1::text IS NULL OR entity = \$1/, "optional entity scope is bound");
  assert.doesNotMatch(sql, /\$\{/);
});

test("server: GET /api/entities/:id validates the id, composes the three bounded reads, 404s only when all are empty", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const match = src.match(/app\.get\("\/api\/entities\/:id",([\s\S]*?)\n  \}\);/);
  assert.ok(match, "GET /api/entities/:id route found");
  const handler = match[1];
  assert.match(handler, /entitiesLib\.isSafeEntity\(entity\)/, "safe-id gate before any query");
  assert.match(handler, /status\(400\)/, "invalid ids fail closed");
  assert.match(handler, /queries\.incidentEntitySummaries\(entity\)/, "bound single-entity summary");
  assert.match(handler, /queries\.systemDetail\(entity, since\)/, "existing partition-pruned signals read");
  assert.match(handler, /SYSTEMS_WINDOW_MAX_HOURS/, "48h ceiling reused");
  assert.match(handler, /entityContextIsEmpty/, "404 only when every source is empty");
  assert.match(handler, /next\(err\)/, "shared sanitized error handler");
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const EntityView = require("../public/entity-view");

function entity(overrides = {}) {
  return {
    entity: "SME00001",
    incidentCount: 4,
    activeIncidentCount: 2,
    worstActiveSeverity: "medium",
    lastSeen: "2026-07-21T10:00:00.000Z",
    bySeverity: { critical: 0, high: 1, medium: 2, low: 0, info: 1, other: 0 },
    activeBySeverity: { critical: 0, high: 0, medium: 2, low: 0, info: 0, other: 0 },
    categories: [
      { category: "active_category", count: 2, activeCount: 2, sources: ["classifier"] },
      { category: "history_only", count: 2, activeCount: 0, sources: ["oracle"] },
    ],
    ...overrides,
  };
}

test("persisted preferences normalize safely and default to active priority", () => {
  assert.deepEqual(EntityView.normalizePreferences(null), {
    search: "", activity: "active", severity: "all", category: "all", sort: "priority",
  });
  assert.deepEqual(EntityView.normalizePreferences({
    search: "SME01", activity: "all", severity: "high",
    category: "rsync_io_timeout", sort: "latest",
  }), {
    search: "SME01", activity: "all", severity: "high",
    category: "rsync_io_timeout", sort: "latest",
  });
  assert.deepEqual(EntityView.normalizePreferences({
    activity: "inactive", severity: "bogus", category: "bad value", sort: "age",
  }), {
    search: "", activity: "active", severity: "all", category: "all", sort: "priority",
  });
});

test("Active mode severity/category filters inspect active metadata only", () => {
  const row = entity();
  assert.equal(EntityView.matches(row, { activity: "active", severity: "medium", category: "active_category" }), true);
  assert.equal(EntityView.matches(row, { activity: "active", severity: "high" }), false);
  assert.equal(EntityView.matches(row, { activity: "active", category: "history_only" }), false);
  assert.equal(EntityView.matches(row, { activity: "all", severity: "high", category: "history_only" }), true);
});

test("search is partial/case-insensitive and Active excludes resolved-only entities", () => {
  const resolved = entity({ entity: "SME00002", activeIncidentCount: 0, worstActiveSeverity: null });
  assert.deepEqual(EntityView.filterEntities([entity(), resolved], { search: "me000", activity: "active" })
    .map((item) => item.entity), ["SME00001"]);
  assert.deepEqual(EntityView.filterEntities([entity(), resolved], { search: "00002", activity: "all" })
    .map((item) => item.entity), ["SME00002"]);
});

test("priority/latest/entity sorts are stable with entity id as final tie-break", () => {
  const rows = [
    entity({ entity: "SME00004", activeIncidentCount: 0, worstActiveSeverity: null, lastSeen: "2026-07-21T11:00:00Z" }),
    entity({ entity: "SME00003", activeIncidentCount: 3, worstActiveSeverity: "medium", lastSeen: "2026-07-21T12:00:00Z" }),
    entity({ entity: "SME00002", activeIncidentCount: 1, worstActiveSeverity: "medium", lastSeen: "2026-07-21T13:00:00Z" }),
    entity({ entity: "SME00001", activeIncidentCount: 1, worstActiveSeverity: "high", lastSeen: "2026-07-20T00:00:00Z" }),
  ];
  assert.deepEqual(EntityView.sortEntities(rows, "priority").map((item) => item.entity),
    ["SME00001", "SME00003", "SME00002", "SME00004"]);
  assert.deepEqual(EntityView.sortEntities(rows, "latest").map((item) => item.entity),
    ["SME00002", "SME00003", "SME00004", "SME00001"]);
  assert.deepEqual(EntityView.sortEntities(rows, "entity").map((item) => item.entity),
    ["SME00001", "SME00002", "SME00003", "SME00004"]);
  assert.equal(rows[0].entity, "SME00004", "input is not mutated");
});

test("facets count matching entities in the selected activity scope", () => {
  const rows = [entity(), entity({ entity: "SME00002", activeIncidentCount: 0, activeBySeverity: {}, categories: [
    { category: "history_only", count: 1, activeCount: 0, sources: ["classifier"] },
  ] })];
  assert.deepEqual(EntityView.categoryFacets(rows, "active"), [
    { category: "active_category", count: 1 },
  ]);
  assert.deepEqual(EntityView.categoryFacets(rows, "all"), [
    { category: "history_only", count: 2 },
    { category: "active_category", count: 1 },
  ]);
  assert.equal(EntityView.severityFacets(rows, "active").find((item) => item.severity === "medium").count, 1);
});

test("24-card slicing advances predictably and clamps boundaries", () => {
  const rows = Array.from({ length: 55 }, (_, index) => entity({ entity: `SME${index}` }));
  assert.equal(EntityView.PAGE_SIZE, 24);
  assert.equal(EntityView.initialCount(rows.length), 24);
  assert.equal(EntityView.nextCount(24, rows.length), 48);
  assert.equal(EntityView.nextCount(48, rows.length), 55);
  assert.equal(EntityView.visible(rows, 24).length, 24);
  assert.equal(EntityView.initialCount(-1), 0);
});

test("compact metadata and provenance preserve oracle/mixed distinctions", () => {
  assert.deepEqual(EntityView.compact(["b", "a", "b", null], 2), { values: ["b", "a"], remaining: 0 });
  assert.deepEqual(EntityView.compact(["a", "b", "c"], 2), { values: ["a", "b"], remaining: 1 });
  assert.equal(EntityView.categoryProvenance({ sources: ["oracle"] }), "oracle");
  assert.equal(EntityView.categoryProvenance({ sources: ["classifier", "oracle"] }), "mixed");
  assert.equal(EntityView.categoryProvenance({ sources: ["classifier"] }), "classifier");
  assert.equal(EntityView.categoryProvenance({ sources: null }), "unknown");
  assert.equal(EntityView.occurrenceText("900719925474099312345"), "900719925474099312345");
  assert.equal(EntityView.occurrenceText(null), "0");
  assert.equal(EntityView.occurrenceText("not-a-count"), "0");
});

test("response summary uses API truth, not the current card slice", () => {
  const summary = EntityView.responseSummary({ summary: {
    entityCount: 229, entitiesWithActive: 174, activeIncidentCount: 357,
    incidentCount: 517, nonSme: { incidentCount: 12 },
  } }, 40, 24);
  assert.deepEqual(summary, {
    entityCount: 229, entitiesWithActive: 174, activeIncidentCount: 357,
    incidentCount: 517, nonSmeIncidentCount: 12, matching: 40, shown: 24,
  });
});

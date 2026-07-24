"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../public/list-view");

test("connectivity filters compose and preserve server order", () => {
  const rows = [
    { systemId: "SME2", source: "MMB", operationalState: "STALE", errorCategory: "timeout" },
    { systemId: "SME1", source: "HHM", operationalState: "OFFLINE", phase: "grab" },
    { systemId: "SME3", source: "MMB", operationalState: "OFFLINE", connectionError: "timeout" },
  ];
  assert.deepEqual(L.filterConnectivity(rows, { search: "timeout", source: "MMB", state: "all" }), [rows[0], rows[2]]);
  assert.deepEqual(L.filterConnectivity(rows, { state: "OFFLINE" }), [rows[1], rows[2]]);
});

test("systems filters errors/warn-only, cross-app, and text", () => {
  const rows = [
    { systemId: "A", errors: 2, warns: 1, appCount: 2, apps: ["alpha", "beta"] },
    { systemId: "B", errors: 0, warns: 3, appCount: 1, apps: ["gamma"] },
  ];
  assert.deepEqual(L.filterSystems(rows, { health: "warns" }), [rows[1]]);
  assert.deepEqual(L.filterSystems(rows, { crossApp: true, search: "beta" }), [rows[0]]);
});

test("acquisition filters source/failures/text and handles null fields", () => {
  const rows = [
    { systemId: "A", source: "mmb", failed: 0, modality: null, manufacturer: null },
    { systemId: "B", source: "hhm", failed: 2, modality: "CT", manufacturer: "Philips" },
  ];
  assert.deepEqual(L.filterAcquisition(rows, { source: "hhm", failuresOnly: true, search: "phil" }), [rows[1]]);
  assert.deepEqual(L.filterAcquisition(rows, { search: "missing" }), []);
});

test("loaded run search is run-id/job-type only and order-preserving", () => {
  const rows = [{ runId: "bbb", jobType: "mmb #3" }, { runId: "aaa", jobType: "hhm/CT" }];
  assert.deepEqual(L.filterAppRuns(rows, "ct"), [rows[1]]);
  assert.deepEqual(L.filterAppRuns(rows, ""), rows);
});

test("slicing starts and advances by 50 without exceeding matches", () => {
  const rows = Array.from({ length: 123 }, (_, i) => i);
  assert.equal(L.initialCount(rows.length), 50);
  assert.equal(L.nextCount(50, rows.length), 100);
  assert.equal(L.nextCount(100, rows.length), 123);
  assert.deepEqual(L.visible(rows, 2), [0, 1]);
});

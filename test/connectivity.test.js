"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { connStatus, captureAgeMs, checkedAgeMs, sortConnectivity, decorate, STATUS_RANK } = require("../lib/connectivity");

const NOW = new Date("2026-06-29T12:00:00Z");

test("connStatus: false->OFFLINE, true->ONLINE, null/missing->UNKNOWN", () => {
  assert.equal(connStatus({ successful_acquisition: false }), "OFFLINE");
  assert.equal(connStatus({ successful_acquisition: true }), "ONLINE");
  assert.equal(connStatus({ successful_acquisition: null }), "UNKNOWN");
  assert.equal(connStatus({}), "UNKNOWN");
  assert.equal(connStatus(null), "UNKNOWN");
});

test("captureAgeMs / checkedAgeMs: distinct ages, null when absent or unparseable", () => {
  const row = { capture_datetime: "2026-06-29T11:00:00Z", inserted_at: "2026-06-29T11:59:00Z" };
  assert.equal(captureAgeMs(row, NOW), 60 * 60 * 1000); // 1h stale data
  assert.equal(checkedAgeMs(row, NOW), 60 * 1000); // checked 1 min ago
  assert.equal(captureAgeMs({ capture_datetime: null }, NOW), null);
  assert.equal(captureAgeMs({ capture_datetime: "nope" }, NOW), null);
  assert.equal(checkedAgeMs({}, NOW), null);
});

test("captureAgeMs: accepts Date values (as pg-promise returns timestamptz)", () => {
  assert.equal(captureAgeMs({ capture_datetime: new Date("2026-06-29T10:00:00Z") }, NOW), 2 * 60 * 60 * 1000);
});

test("sortConnectivity: worst-first OFFLINE -> UNKNOWN -> ONLINE", () => {
  const rows = [
    { system_id: "ON1", successful_acquisition: true },
    { system_id: "UN1", successful_acquisition: null },
    { system_id: "OFF1", successful_acquisition: false },
  ];
  assert.deepEqual(sortConnectivity(rows, NOW).map((r) => r.system_id), ["OFF1", "UN1", "ON1"]);
});

test("sortConnectivity: within a status, most-stale (oldest capture) first", () => {
  const rows = [
    { system_id: "fresh", successful_acquisition: false, capture_datetime: "2026-06-29T11:00:00Z" },
    { system_id: "stale", successful_acquisition: false, capture_datetime: "2026-06-01T00:00:00Z" },
  ];
  assert.deepEqual(sortConnectivity(rows, NOW).map((r) => r.system_id), ["stale", "fresh"]);
});

test("sortConnectivity: unknown capture age sorts last within a status, then by system_id", () => {
  const rows = [
    { system_id: "B", successful_acquisition: false, capture_datetime: null },
    { system_id: "A", successful_acquisition: false, capture_datetime: null },
    { system_id: "dated", successful_acquisition: false, capture_datetime: "2026-06-20T00:00:00Z" },
  ];
  assert.deepEqual(sortConnectivity(rows, NOW).map((r) => r.system_id), ["dated", "A", "B"]);
});

test("sortConnectivity: does not mutate the input", () => {
  const rows = [
    { system_id: "ON1", successful_acquisition: true },
    { system_id: "OFF1", successful_acquisition: false },
  ];
  const before = rows.map((r) => r.system_id);
  sortConnectivity(rows, NOW);
  assert.deepEqual(rows.map((r) => r.system_id), before);
});

test("decorate: shapes rows to camelCase, attaches status + both ages, sorted worst-first", () => {
  const rows = [
    { source: "HHM", system_id: "ON1", successful_acquisition: true, capture_datetime: "2026-06-29T11:30:00Z", inserted_at: "2026-06-29T11:59:00Z", connection_error: null, error_category: null, phase: "grab", host_intervention: false },
    { source: "MMB", system_id: "OFF1", successful_acquisition: false, capture_datetime: "2026-06-29T09:00:00Z", inserted_at: "2026-06-29T11:45:00Z", connection_error: "rsync I/O timeout", error_category: "rsync_io_timeout", phase: "remote_rsync", host_intervention: true },
  ];
  const out = decorate(rows, NOW);
  assert.deepEqual(out.map((r) => r.systemId), ["OFF1", "ON1"]); // offline first
  const off = out[0];
  assert.equal(off.source, "MMB");
  assert.equal(off.status, "OFFLINE");
  assert.equal(off.captureAgeMs, 3 * 60 * 60 * 1000);
  assert.equal(off.checkedAgeMs, 15 * 60 * 1000);
  assert.equal(off.errorCategory, "rsync_io_timeout");
  assert.equal(off.connectionError, "rsync I/O timeout");
  assert.equal(off.hostIntervention, true);
  assert.equal(off.captureDatetime, "2026-06-29T09:00:00Z"); // string passthrough (Dates get .toISOString())
});

test("decorate: normalizes Date timestamps to ISO strings", () => {
  const out = decorate([{ source: "HHM", system_id: "X", successful_acquisition: false, capture_datetime: new Date("2026-06-29T09:00:00Z"), inserted_at: new Date("2026-06-29T11:00:00Z") }], NOW);
  assert.equal(out[0].captureDatetime, "2026-06-29T09:00:00.000Z");
  assert.equal(out[0].insertedAt, "2026-06-29T11:00:00.000Z");
});

test("decorate: tolerates empty input", () => {
  assert.deepEqual(decorate([], NOW), []);
  assert.deepEqual(decorate(null, NOW), []);
});

test("STATUS_RANK orders OFFLINE worst to ONLINE best", () => {
  assert.ok(STATUS_RANK.OFFLINE < STATUS_RANK.UNKNOWN);
  assert.ok(STATUS_RANK.UNKNOWN < STATUS_RANK.ONLINE);
});

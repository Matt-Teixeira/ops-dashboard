"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  FRESHNESS_BUDGET_MS,
  connStatus,
  freshnessBudgetMs,
  captureAgeMs,
  checkedAgeMs,
  connFreshness,
  operationalState,
  sortConnectivity,
  decorate,
  rollup,
  STATUS_RANK,
} = require("../lib/connectivity");

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

test("ages clamp future clock skew to zero", () => {
  assert.equal(captureAgeMs({ capture_datetime: "2026-06-29T12:00:05Z" }, NOW), 0);
  assert.equal(checkedAgeMs({ inserted_at: "2026-06-29T12:01:00Z" }, NOW), 0);
});

test("freshness budget: HHM/MMB use the evidenced 30m + 15m grace", () => {
  assert.equal(FRESHNESS_BUDGET_MS.HHM, 45 * 60 * 1000);
  assert.equal(FRESHNESS_BUDGET_MS.MMB, 45 * 60 * 1000);
  assert.equal(freshnessBudgetMs("hhm"), 45 * 60 * 1000);
  assert.equal(freshnessBudgetMs("MMB"), 45 * 60 * 1000);
  assert.equal(freshnessBudgetMs("other"), null);
});

test("connFreshness: boundary is current; old/missing/invalid/unknown-source is stale", () => {
  assert.equal(connFreshness({ source: "HHM", inserted_at: "2026-06-29T11:15:00Z" }, NOW), "CURRENT");
  assert.equal(connFreshness({ source: "MMB", inserted_at: "2026-06-29T11:14:59Z" }, NOW), "STALE");
  assert.equal(connFreshness({ source: "HHM", inserted_at: null }, NOW), "STALE");
  assert.equal(connFreshness({ source: "HHM", inserted_at: "nope" }, NOW), "STALE");
  assert.equal(connFreshness({ source: "OTHER", inserted_at: "2026-06-29T11:59:00Z" }, NOW), "STALE");
});

test("operationalState: raw result is current only while its record is fresh", () => {
  assert.equal(operationalState({ source: "HHM", successful_acquisition: true, inserted_at: "2026-06-29T11:59:00Z" }, NOW), "ONLINE");
  assert.equal(operationalState({ source: "MMB", successful_acquisition: false, inserted_at: "2026-06-29T11:59:00Z" }, NOW), "OFFLINE");
  assert.equal(operationalState({ source: "HHM", successful_acquisition: null, inserted_at: "2026-06-29T11:59:00Z" }, NOW), "UNKNOWN");
  assert.equal(operationalState({ source: "HHM", successful_acquisition: true, inserted_at: "2026-06-01T00:00:00Z" }, NOW), "STALE");
});

test("sortConnectivity: current OFFLINE -> UNKNOWN -> ONLINE -> stale history", () => {
  const rows = [
    { source: "HHM", system_id: "STALE", successful_acquisition: false, inserted_at: "2026-06-01T00:00:00Z" },
    { source: "HHM", system_id: "ON1", successful_acquisition: true, inserted_at: "2026-06-29T11:59:00Z" },
    { source: "HHM", system_id: "UN1", successful_acquisition: null, inserted_at: "2026-06-29T11:59:00Z" },
    { source: "HHM", system_id: "OFF1", successful_acquisition: false, inserted_at: "2026-06-29T11:59:00Z" },
  ];
  assert.deepEqual(sortConnectivity(rows, NOW).map((r) => r.system_id), ["OFF1", "UN1", "ON1", "STALE"]);
});

test("sortConnectivity: within a status, most-stale (oldest capture) first", () => {
  const rows = [
    { source: "HHM", system_id: "fresh", successful_acquisition: false, capture_datetime: "2026-06-29T11:00:00Z", inserted_at: "2026-06-29T11:59:00Z" },
    { source: "HHM", system_id: "stale", successful_acquisition: false, capture_datetime: "2026-06-01T00:00:00Z", inserted_at: "2026-06-29T11:59:00Z" },
  ];
  assert.deepEqual(sortConnectivity(rows, NOW).map((r) => r.system_id), ["stale", "fresh"]);
});

test("sortConnectivity: unknown capture age sorts last within a status, then by system_id", () => {
  const rows = [
    { source: "HHM", system_id: "B", successful_acquisition: false, capture_datetime: null, inserted_at: "2026-06-29T11:59:00Z" },
    { source: "HHM", system_id: "A", successful_acquisition: false, capture_datetime: null, inserted_at: "2026-06-29T11:59:00Z" },
    { source: "HHM", system_id: "dated", successful_acquisition: false, capture_datetime: "2026-06-20T00:00:00Z", inserted_at: "2026-06-29T11:59:00Z" },
  ];
  assert.deepEqual(sortConnectivity(rows, NOW).map((r) => r.system_id), ["dated", "A", "B"]);
});

test("sortConnectivity: does not mutate the input", () => {
  const rows = [
    { source: "HHM", system_id: "ON1", successful_acquisition: true, inserted_at: "2026-06-29T11:59:00Z" },
    { source: "HHM", system_id: "OFF1", successful_acquisition: false, inserted_at: "2026-06-29T11:59:00Z" },
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
  assert.equal(off.lastResult, "OFFLINE");
  assert.equal(off.freshness, "CURRENT");
  assert.equal(off.operationalState, "OFFLINE");
  assert.equal(off.freshnessBudgetMs, 45 * 60 * 1000);
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

test("decorate: an old successful result is explicitly stale, never operationally online", () => {
  const [row] = decorate([{
    source: "HHM",
    system_id: "OLD",
    successful_acquisition: true,
    capture_datetime: "2026-05-01T00:00:00Z",
    inserted_at: "2026-05-01T00:01:00Z",
  }], NOW);
  assert.equal(row.status, "ONLINE"); // compatibility/raw evidence
  assert.equal(row.lastResult, "ONLINE");
  assert.equal(row.freshness, "STALE");
  assert.equal(row.operationalState, "STALE");
});

test("decorate: tolerates empty input", () => {
  assert.deepEqual(decorate([], NOW), []);
  assert.deepEqual(decorate(null, NOW), []);
});

test("STATUS_RANK orders current failures first and stale history last", () => {
  assert.ok(STATUS_RANK.OFFLINE < STATUS_RANK.UNKNOWN);
  assert.ok(STATUS_RANK.UNKNOWN < STATUS_RANK.ONLINE);
  assert.ok(STATUS_RANK.ONLINE < STATUS_RANK.STALE);
});

// --- Phase 14: rollup --------------------------------------------------------

test("rollup: per-source operational states reconcile exactly to total", () => {
  const systems = [
    { source: "HHM", operationalState: "OFFLINE" },
    { source: "HHM", operationalState: "ONLINE" },
    { source: "HHM", operationalState: "UNKNOWN" },
    { source: "HHM", operationalState: "STALE" },
    { source: "MMB", operationalState: "OFFLINE" },
    { source: "MMB", operationalState: "STALE" },
  ];
  const out = rollup(systems);
  assert.deepEqual(out, {
    hhm: { online: 1, offline: 1, unknown: 1, stale: 1, total: 4 },
    mmb: { online: 0, offline: 1, unknown: 0, stale: 1, total: 2 },
  });
  for (const source of Object.values(out)) {
    assert.equal(source.online + source.offline + source.unknown + source.stale, source.total);
  }
});

test("rollup: empty / unknown sources -> zeros, no throw", () => {
  const empty = {
    hhm: { online: 0, offline: 0, unknown: 0, stale: 0, total: 0 },
    mmb: { online: 0, offline: 0, unknown: 0, stale: 0, total: 0 },
  };
  assert.deepEqual(rollup([]), empty);
  assert.deepEqual(rollup(null), empty);
  assert.deepEqual(rollup([{ source: "XXX", operationalState: "OFFLINE" }]), empty);
});

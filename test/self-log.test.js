"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildHeartbeat, JOB } = require("../lib/self-log");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const healthyHealth = { asOf: "2026-06-26T12:00:00.000Z", cacheSize: 23, coverageUnknown: 0, lastRefreshMs: 42, lastError: null };

test("heartbeat row has the writer shape with a real uuid", () => {
  const row = buildHeartbeat(healthyHealth);
  assert.deepEqual(Object.keys(row).sort(), ["run_id", "verbose_log", "warn_error_logs"]);
  assert.match(row.run_id, UUID_RE);
  assert.ok(Array.isArray(row.verbose_log) && Array.isArray(row.warn_error_logs));
});

test("the grid can derive job: first event note.argv[2] === the heartbeat job", () => {
  const row = buildHeartbeat(healthyHealth);
  assert.equal(row.verbose_log[0].note.argv[2], JOB);
});

test("a healthy beat has no WARN/ERROR events -> derived status SUCCESS", () => {
  const row = buildHeartbeat(healthyHealth);
  assert.equal(row.warn_error_logs.length, 0);
  assert.ok(row.verbose_log.every((e) => e.type === "INFO"));
});

test("a failed last refresh adds an ERROR event surfaced in warn_error_logs", () => {
  const row = buildHeartbeat({ ...healthyHealth, lastError: "connection refused" });
  assert.equal(row.warn_error_logs.length, 1);
  assert.equal(row.warn_error_logs[0].type, "ERROR");
  assert.equal(row.warn_error_logs[0].err_msg, "connection refused");
  // warn_error_logs is a strict subset of verbose_log (same event object).
  assert.ok(row.verbose_log.includes(row.warn_error_logs[0]));
});

test("lastError is collapsed to one line and capped in length", () => {
  const huge = "line one\nline two   with   spaces\n" + "x".repeat(500);
  const row = buildHeartbeat({ ...healthyHealth, lastError: huge });
  const msg = row.warn_error_logs[0].err_msg;
  assert.ok(!msg.includes("\n"), "should be single-line");
  assert.ok(msg.length <= 320, `should be capped, got ${msg.length}`);
  assert.ok(msg.endsWith("…(truncated)"));
});

test("health metrics land in a DETAILS event; missing fields default to null", () => {
  const row = buildHeartbeat({});
  const details = row.verbose_log.find((e) => e.tag === "DETAILS");
  assert.ok(details);
  assert.equal(details.note.cacheSize, null);
  assert.equal(details.note.coverageUnknown, null);
});

test("every event carries the run's id and an ISO dt", () => {
  const row = buildHeartbeat(healthyHealth);
  for (const e of row.verbose_log) {
    assert.equal(e.run_id, row.run_id);
    assert.ok(!Number.isNaN(Date.parse(e.dt)));
  }
});

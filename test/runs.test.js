"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { jobName, deriveStatus, timing, DEFAULT_JOB } = require("../lib/runs");

test("jobName: argv[2] is the job for hhm_rpp_* runs", () => {
  const vl = [{ note: { argv: ["/node", "/index.js", "GE_CT"] } }];
  assert.equal(jobName(vl), "GE_CT");
});

test("jobName: missing/empty argv job falls back to (default)", () => {
  assert.equal(jobName([{ note: { argv: ["/node", "/index.js"] } }]), DEFAULT_JOB); // data_acquisition shape
  assert.equal(jobName([{ note: { argv: ["/node", "/index.js", ""] } }]), DEFAULT_JOB);
  assert.equal(jobName([{ note: {} }]), DEFAULT_JOB);
  assert.equal(jobName([{}]), DEFAULT_JOB);
  assert.equal(jobName([]), DEFAULT_JOB);
  assert.equal(jobName(null), DEFAULT_JOB);
});

test("deriveStatus: ERROR > WARN > SUCCESS", () => {
  assert.equal(deriveStatus([{ type: "WARN" }, { type: "ERROR" }]), "ERROR");
  assert.equal(deriveStatus([{ type: "WARN" }]), "WARN");
  assert.equal(deriveStatus([]), "SUCCESS");
  assert.equal(deriveStatus(null), "SUCCESS");
  assert.equal(deriveStatus("not-an-array"), "SUCCESS");
});

test("timing: normal run yields a positive duration", () => {
  const vl = [{ dt: "2026-06-25T18:15:08.385Z" }, { dt: "2026-06-25T18:15:18.268Z" }];
  const t = timing(vl);
  assert.equal(t.startedAt, "2026-06-25T18:15:08.385Z");
  assert.equal(t.endedAt, "2026-06-25T18:15:18.268Z");
  assert.equal(t.durationMs, 9883);
});

test("timing: empty / single-event arrays", () => {
  assert.deepEqual(timing([]), { startedAt: null, endedAt: null, durationMs: null });
  const one = timing([{ dt: "2026-06-25T18:15:08.385Z" }]);
  assert.equal(one.durationMs, 0); // first === last
});

test("timing: invalid dt -> null, never NaN", () => {
  const t = timing([{ dt: "not-a-date" }, { dt: "also-bad" }]);
  assert.equal(t.startedAt, null);
  assert.equal(t.endedAt, null);
  assert.equal(t.durationMs, null);
});

test("timing: out-of-order events clamp to null, not a negative duration", () => {
  const vl = [{ dt: "2026-06-25T18:15:18.268Z" }, { dt: "2026-06-25T18:15:08.385Z" }];
  assert.equal(timing(vl).durationMs, null);
});

test("timing: missing dt fields -> null", () => {
  assert.equal(timing([{}, {}]).durationMs, null);
  assert.equal(timing(null).durationMs, null);
});

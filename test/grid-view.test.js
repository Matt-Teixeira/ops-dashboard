"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { sortJobs, groupJobs, groupRollupStatus, filterJobs, summarize, healthLabel, STATUS_RANK } = require("../public/grid-view");

// A small grid fixture. for clarity each field is set only where a test reads it.
const JOBS = [
  { app: "hhm_rpp_ge", job: "GE_CT", status: "SUCCESS", lastRun: "2026-06-25T10:00:00Z", ageMs: 3000, durationMs: 1200, issueCount: 0 },
  { app: "hhm_rpp_ge", job: "GE_MRI", status: "ERROR", lastRun: "2026-06-25T12:00:00Z", ageMs: 1000, durationMs: null, issueCount: 5 },
  { app: "data_acquisition", job: "(default)", status: "WARN", lastRun: "2026-06-25T11:00:00Z", ageMs: 2000, durationMs: 800, issueCount: 2 },
];

test("sortJobs: lastRun desc puts the newest run first", () => {
  const out = sortJobs(JOBS, "lastRun", "desc");
  assert.deepEqual(out.map((j) => j.job), ["GE_MRI", "(default)", "GE_CT"]);
});

test("sortJobs: lastRun asc puts the oldest run first", () => {
  const out = sortJobs(JOBS, "lastRun", "asc");
  assert.deepEqual(out.map((j) => j.job), ["GE_CT", "(default)", "GE_MRI"]);
});

test("sortJobs: status asc is worst-first (ERROR > WARN > SUCCESS)", () => {
  const out = sortJobs(JOBS, "status", "asc");
  assert.deepEqual(out.map((j) => j.status), ["ERROR", "WARN", "SUCCESS"]);
});

test("sortJobs: status desc is best-first", () => {
  const out = sortJobs(JOBS, "status", "desc");
  assert.deepEqual(out.map((j) => j.status), ["SUCCESS", "WARN", "ERROR"]);
});

test("sortJobs: status tie breaks by most-stale (largest ageMs) first", () => {
  const tied = [
    { app: "a", job: "fresh", status: "ERROR", ageMs: 1000 },
    { app: "b", job: "stale", status: "ERROR", ageMs: 9000 },
  ];
  assert.deepEqual(sortJobs(tied, "status", "asc").map((j) => j.job), ["stale", "fresh"]);
});

test("sortJobs: numeric nulls sort last in BOTH directions", () => {
  // GE_MRI has durationMs null; it must trail in asc and desc alike.
  assert.equal(sortJobs(JOBS, "duration", "asc").at(-1).job, "GE_MRI");
  assert.equal(sortJobs(JOBS, "duration", "desc").at(-1).job, "GE_MRI");
});

test("sortJobs: duration desc orders by value, nulls last", () => {
  const out = sortJobs(JOBS, "duration", "desc");
  assert.deepEqual(out.map((j) => j.job), ["GE_CT", "(default)", "GE_MRI"]);
});

test("sortJobs: app sort is alphabetical with job as the tiebreak", () => {
  const out = sortJobs(JOBS, "app", "asc");
  assert.deepEqual(out.map((j) => `${j.app}/${j.job}`), [
    "data_acquisition/(default)",
    "hhm_rpp_ge/GE_CT",
    "hhm_rpp_ge/GE_MRI",
  ]);
});

test("sortJobs: does not mutate the input array", () => {
  const before = JOBS.map((j) => j.job);
  sortJobs(JOBS, "lastRun", "asc");
  assert.deepEqual(JOBS.map((j) => j.job), before);
});

test("sortJobs: unknown key falls back to app/job order, no throw", () => {
  const out = sortJobs(JOBS, "nope", "asc");
  assert.deepEqual(out.map((j) => j.app), ["data_acquisition", "hhm_rpp_ge", "hhm_rpp_ge"]);
});

test("sortJobs: tolerates empty / non-array input", () => {
  assert.deepEqual(sortJobs([], "lastRun", "desc"), []);
  assert.deepEqual(sortJobs(null, "lastRun", "desc"), []);
});

test("groupJobs: by app buckets rows, preserving arrival order", () => {
  // Feed it already sorted (app asc) so group order is deterministic.
  const groups = groupJobs(sortJobs(JOBS, "app", "asc"), "app");
  assert.deepEqual(groups.map((g) => g.key), ["data_acquisition", "hhm_rpp_ge"]);
  assert.deepEqual(groups.map((g) => g.rows.length), [1, 2]);
});

test("groupJobs: by job groups on the job field", () => {
  const groups = groupJobs(JOBS, "job");
  assert.deepEqual(groups.map((g) => g.key).sort(), ["(default)", "GE_CT", "GE_MRI"]);
});

test("groupJobs: none yields a single null-keyed group with all rows", () => {
  const groups = groupJobs(JOBS, "none");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, null);
  assert.equal(groups[0].rows.length, 3);
});

test("groupRollupStatus: returns the worst status in the group", () => {
  assert.equal(groupRollupStatus(JOBS), "ERROR");
  assert.equal(groupRollupStatus([{ status: "SUCCESS" }, { status: "WARN" }]), "WARN");
  assert.equal(groupRollupStatus([{ status: "SUCCESS" }]), "SUCCESS");
});

test("groupRollupStatus: empty group is SUCCESS, junk statuses ignored", () => {
  assert.equal(groupRollupStatus([]), "SUCCESS");
  assert.equal(groupRollupStatus([{ status: "??" }, { status: "SUCCESS" }]), "SUCCESS");
});

test("STATUS_RANK orders ERROR worst to INFO best", () => {
  assert.ok(STATUS_RANK.ERROR < STATUS_RANK.WARN);
  assert.ok(STATUS_RANK.WARN < STATUS_RANK.SUCCESS);
  assert.ok(STATUS_RANK.SUCCESS < STATUS_RANK.INFO);
});

// --- Phase 9: filterJobs + summarize ----------------------------------------

const FJOBS = [
  { app: "hhm_rpp_ge", job: "GE_CT", runId: "aaa-111", status: "SUCCESS", stale: false },
  { app: "hhm_rpp_ge", job: "GE_MRI", runId: "bbb-222", status: "ERROR", stale: false },
  { app: "data_acquisition", job: "(default)", runId: "ccc-333", status: "WARN", stale: true },
  { app: "hhm_rpp_siemens", job: "SIEMENS_CV", runId: "ddd-444", status: "SUCCESS", stale: null },
  { app: "hhm_rpp_ge", job: "GE_CV", runId: "eee-555", status: "SUCCESS", stale: true },
];
const noFilter = { search: "", statuses: new Set() };

test("filterJobs: empty filter returns ALL jobs as a new array", () => {
  const out = filterJobs(FJOBS, noFilter);
  assert.equal(out.length, FJOBS.length);
  assert.notEqual(out, FJOBS); // new array, not the same reference
});

test("filterJobs: search matches job name, case-insensitively", () => {
  assert.deepEqual(filterJobs(FJOBS, { search: "ge_", statuses: new Set() }).map((j) => j.job), ["GE_CT", "GE_MRI", "GE_CV"]);
  assert.deepEqual(filterJobs(FJOBS, { search: "GE_CT", statuses: new Set() }).map((j) => j.job), ["GE_CT"]);
});

test("filterJobs: search matches app and runId too", () => {
  assert.equal(filterJobs(FJOBS, { search: "data_acquisition", statuses: new Set() }).length, 1);
  assert.deepEqual(filterJobs(FJOBS, { search: "ccc", statuses: new Set() }).map((j) => j.runId), ["ccc-333"]);
});

test("filterJobs: no match yields an empty array", () => {
  assert.deepEqual(filterJobs(FJOBS, { search: "nope", statuses: new Set() }), []);
});

test("filterJobs: status set filters by j.status", () => {
  assert.deepEqual(filterJobs(FJOBS, { search: "", statuses: new Set(["ERROR"]) }).map((j) => j.job), ["GE_MRI"]);
});

test("filterJobs: STALE matches j.stale === true, NOT a status, regardless of status", () => {
  const out = filterJobs(FJOBS, { search: "", statuses: new Set(["STALE"]) });
  assert.deepEqual(out.map((j) => j.job).sort(), ["(default)", "GE_CV"]); // WARN+stale and SUCCESS+stale
  // the stale === null (unknown cadence) siemens row is NOT stale
  assert.ok(!out.some((j) => j.job === "SIEMENS_CV"));
});

test("filterJobs: multiple tokens are OR'd (ERROR or STALE)", () => {
  const out = filterJobs(FJOBS, { search: "", statuses: new Set(["ERROR", "STALE"]) });
  assert.deepEqual(out.map((j) => j.job).sort(), ["(default)", "GE_CV", "GE_MRI"]);
});

test("filterJobs: search AND status combine (both must hold)", () => {
  const out = filterJobs(FJOBS, { search: "ge_", statuses: new Set(["SUCCESS"]) });
  assert.deepEqual(out.map((j) => j.job).sort(), ["GE_CT", "GE_CV"]);
});

test("filterJobs: accepts an array for statuses, and does not mutate input", () => {
  const before = FJOBS.map((j) => j.job);
  assert.equal(filterJobs(FJOBS, { statuses: ["ERROR"] }).length, 1);
  assert.deepEqual(FJOBS.map((j) => j.job), before);
});

test("summarize: totals, per-status, stale, and unknown-cadence counts", () => {
  assert.deepEqual(summarize(FJOBS), { total: 5, ERROR: 1, WARN: 1, SUCCESS: 3, stale: 2, unknown: 1 });
});

test("summarize: empty input is all zeros", () => {
  assert.deepEqual(summarize([]), { total: 0, ERROR: 0, WARN: 0, SUCCESS: 0, stale: 0, unknown: 0 });
});

// --- Phase 12: healthLabel ---------------------------------------------------

test("healthLabel: errored/runs with the window prefix", () => {
  assert.equal(healthLabel({ runs: 2207, errored: 1914, warned: 1345 }, 24), "24h: 1914/2207 err · 1345 warn");
  assert.equal(healthLabel({ runs: 10, errored: 0, warned: 0 }, 24), "24h: 0/10 err");
});

test("healthLabel: nothing to show -> empty string", () => {
  assert.equal(healthLabel(undefined, 24), "");
  assert.equal(healthLabel(null, 24), "");
  assert.equal(healthLabel({ runs: 0, errored: 0 }, 24), "");
  assert.equal(healthLabel({ errored: 3 }, 24), ""); // runs missing/NaN
});

test("healthLabel: omits the window prefix when not a positive number", () => {
  assert.equal(healthLabel({ runs: 5, errored: 1 }, undefined), "1/5 err");
  assert.equal(healthLabel({ runs: 5, errored: 1 }, 0), "1/5 err");
});

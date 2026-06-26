"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { evaluate, isConfigured, coverage } = require("../lib/staleness");

// config/schedules.js: "hhm_rpp_ge/GE_CT" -> { everyMin: 30, graceMin: 15 }
// => budget = 45 min.
const NOW = new Date("2026-06-25T12:00:00.000Z");

test("known job within budget -> not stale", () => {
  const lastRun = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(); // 20m ago
  const r = evaluate("hhm_rpp_ge", "GE_CT", lastRun, NOW);
  assert.equal(r.stale, false);
  assert.equal(r.budgetMs, 45 * 60 * 1000);
  assert.equal(r.ageMs, 20 * 60 * 1000);
});

test("known job past budget -> stale", () => {
  const lastRun = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(); // 60m ago > 45m
  const r = evaluate("hhm_rpp_ge", "GE_CT", lastRun, NOW);
  assert.equal(r.stale, true);
});

test("unknown job -> stale is null (unknown, not green), no budget", () => {
  const lastRun = new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString();
  const r = evaluate("some_app", "UNCONFIGURED_JOB", lastRun, NOW);
  assert.equal(r.stale, null);
  assert.equal(r.budgetMs, null);
  assert.equal(r.ageMs, 5 * 60 * 60 * 1000);
});

// Phase 6: the Philips variants the grid shows are now configured (every 30 min).
test("Phase 6 Philips variant is configured -> real boolean, not null", () => {
  const lastRun = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(); // 20m < 45m
  const r = evaluate("hhm_rpp_philips", "PHILIPS_MRI_LOG_3", lastRun, NOW);
  assert.equal(r.stale, false);
  assert.equal(r.budgetMs, 45 * 60 * 1000);
});

// Phase 6: SIEMENS_CV is intentionally NOT scheduled -> must stay unknown (null).
test("SIEMENS_CV stays unknown (null), never asserted fresh", () => {
  const lastRun = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString();
  const r = evaluate("hhm_rpp_siemens", "SIEMENS_CV", lastRun, NOW);
  assert.equal(r.stale, null);
  assert.equal(r.budgetMs, null);
});

// Phase 6: data_acquisition/(default) is a STALL budget (everyMin 20 + grace 10 =
// 30m), set above the max normal inter-run gap (12.3m observed) so it never flaps.
test("data_acquisition (default) within the 30-min stall budget -> not stale", () => {
  const lastRun = new Date(NOW.getTime() - 13 * 60 * 1000).toISOString(); // 13m (> max normal gap) < 30m
  const r = evaluate("data_acquisition", "(default)", lastRun, NOW);
  assert.equal(r.stale, false);
  assert.equal(r.budgetMs, 30 * 60 * 1000);
});

test("data_acquisition (default) past the 30-min stall budget -> stale", () => {
  const lastRun = new Date(NOW.getTime() - 35 * 60 * 1000).toISOString(); // 35m > 30m
  const r = evaluate("data_acquisition", "(default)", lastRun, NOW);
  assert.equal(r.stale, true);
});

test("isConfigured: true for a configured pair, false for an unknown one", () => {
  assert.equal(isConfigured("hhm_rpp_ge", "GE_CT"), true);
  assert.equal(isConfigured("hhm_rpp_siemens", "SIEMENS_CV"), false);
});

test("coverage: counts configured vs unknown and lists the unknown pairs", () => {
  const pairs = [
    { app: "hhm_rpp_ge", job: "GE_CT" },                 // configured
    { app: "hhm_rpp_philips", job: "PHILIPS_MRI_RMMU_5" }, // configured (Phase 6)
    { app: "monday", job: "EQUIPMENT_RTT" },             // unknown (deferred/commented)
    { app: "hhm_rpp_siemens", job: "SIEMENS_CV" },        // unknown (not scheduled)
  ];
  const c = coverage(pairs);
  assert.equal(c.total, 4);
  assert.equal(c.configured, 2);
  assert.equal(c.unknown, 2);
  assert.deepEqual(c.unknownJobs, ["monday/EQUIPMENT_RTT", "hhm_rpp_siemens/SIEMENS_CV"]);
});

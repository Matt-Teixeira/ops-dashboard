"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { evaluate } = require("../lib/staleness");

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

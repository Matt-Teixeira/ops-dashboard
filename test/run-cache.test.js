"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createRunCache } = require("../lib/run-cache");

const NOW = new Date("2026-06-25T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const row = (app, job, insertedAt, extra = {}) => ({
  app_name: app, job, run_id: `${app}-${job}-${insertedAt}`, inserted_at: insertedAt,
  started_at: insertedAt, ended_at: insertedAt, duration_ms: 100, status: "SUCCESS", issue_count: 0, ...extra,
});

test("bootstrap merge populates one entry per (app, job)", () => {
  const c = createRunCache({ retentionDays: 30 });
  c.merge([row("ge", "GE_CT", daysAgo(0)), row("ge", "GE_CV", daysAgo(0)), row("ph", "PH_CT", daysAgo(1))], NOW);
  assert.equal(c.size, 3);
});

test("re-merging identical rows is idempotent (no change to map or watermark)", () => {
  const c = createRunCache({ retentionDays: 30 });
  const rows = [row("ge", "GE_CT", daysAgo(0)), row("ph", "PH_CT", daysAgo(1))];
  c.merge(rows, NOW);
  const wm1 = c.watermark.getTime();
  const size1 = c.size;
  c.merge(rows, NOW); // overlap re-scan would re-feed the same rows
  assert.equal(c.size, size1);
  assert.equal(c.watermark.getTime(), wm1);
});

test("a newer run replaces the entry; an older run does not", () => {
  const c = createRunCache({ retentionDays: 30 });
  c.merge([row("ge", "GE_CT", "2026-06-25T10:00:00.000Z")], NOW);
  c.merge([row("ge", "GE_CT", "2026-06-25T11:00:00.000Z")], NOW); // newer
  assert.equal(c.values()[0].inserted_at, "2026-06-25T11:00:00.000Z");
  c.merge([row("ge", "GE_CT", "2026-06-25T09:00:00.000Z")], NOW); // older
  assert.equal(c.values()[0].inserted_at, "2026-06-25T11:00:00.000Z");
});

test("eviction drops entries older than retention but keeps dormant-but-in-window", () => {
  const c = createRunCache({ retentionDays: 30 });
  c.merge([row("si", "SIEMENS_CT", daysAgo(16)), row("ge", "GE_CT", daysAgo(0))], NOW);
  assert.equal(c.size, 2); // siemens at 16d is within the 30d window
  c.merge([row("old", "GONE", daysAgo(31))], NOW); // beyond retention
  const keys = c.values().map((r) => `${r.app_name}/${r.job}`);
  assert.ok(!keys.includes("old/GONE"));
  assert.ok(keys.includes("si/SIEMENS_CT"));
});

test("watermark advances to the max inserted_at and never backward", () => {
  const c = createRunCache({ retentionDays: 30 });
  c.merge([row("ge", "GE_CT", "2026-06-25T11:00:00.000Z")], NOW);
  assert.equal(c.watermark.toISOString(), "2026-06-25T11:00:00.000Z");
  c.merge([row("ge", "GE_CV", "2026-06-25T10:00:00.000Z")], NOW); // older row
  assert.equal(c.watermark.toISOString(), "2026-06-25T11:00:00.000Z"); // unchanged
});

test("empty merge leaves watermark and cache intact", () => {
  const c = createRunCache({ retentionDays: 30 });
  c.merge([row("ge", "GE_CT", daysAgo(0))], NOW);
  const wm = c.watermark.getTime();
  c.merge([], NOW);
  assert.equal(c.size, 1);
  assert.equal(c.watermark.getTime(), wm);
});

test("sinceBound: retention floor before first merge, watermark-overlap after, floor-clamped", () => {
  const c = createRunCache({ retentionDays: 30, overlapMs: 300000 });
  // before any merge -> retention floor
  assert.equal(c.sinceBound(NOW).toISOString(), daysAgo(30));
  // after a merge -> watermark - overlap
  c.merge([row("ge", "GE_CT", "2026-06-25T11:00:00.000Z")], NOW);
  assert.equal(c.sinceBound(NOW).toISOString(), "2026-06-25T10:55:00.000Z");
  // a stale watermark (e.g. after a long pause) is clamped to the retention floor
  const c2 = createRunCache({ retentionDays: 1, overlapMs: 300000 });
  c2.merge([row("ge", "GE_CT", daysAgo(5))], NOW); // watermark 5d ago, retention 1d
  assert.equal(c2.sinceBound(NOW).toISOString(), daysAgo(1));
});

test("ready flips only when markReady is called", () => {
  const c = createRunCache({ retentionDays: 30 });
  assert.equal(c.ready, false);
  c.merge([row("ge", "GE_CT", daysAgo(0))], NOW);
  assert.equal(c.ready, false);
  c.markReady();
  assert.equal(c.ready, true);
});

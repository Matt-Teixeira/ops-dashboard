"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const TimeView = require("../public/time-view");

test("age uses human-scale boundaries", () => {
  assert.equal(TimeView.age(89e3), "89s");
  assert.equal(TimeView.age(90e3), "2m");
  assert.equal(TimeView.age(89 * 60e3), "89m");
  assert.equal(TimeView.age(90 * 60e3), "2h");
  assert.equal(TimeView.age(47 * 3600e3), "47h");
  assert.equal(TimeView.age(48 * 3600e3), "2d");
  assert.equal(TimeView.age(800 * 86400e3), "2.2y");
});

test("age clamps future skew and rejects invalid", () => {
  assert.equal(TimeView.age(-5000), "0s");
  assert.equal(TimeView.age(null), "—");
  assert.equal(TimeView.age("bad"), "—");
});

test("instant preserves exact ISO/title with relative text", () => {
  const value = TimeView.instant("2026-01-01T00:00:00Z", Date.parse("2026-01-03T00:00:00Z"));
  assert.equal(value.relative, "2d ago");
  assert.equal(value.iso, "2026-01-01T00:00:00.000Z");
  assert.match(value.title, /2026-01-01T00:00:00.000Z/);
  assert.equal(TimeView.instant("bad").iso, null);
});

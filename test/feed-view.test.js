"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const FeedView = require("../public/feed-view");

test("messagePreview: first meaningful line, whitespace trimmed", () => {
  assert.equal(FeedView.messagePreview("\n  connection failed  \nstack line"), "connection failed");
  assert.equal(FeedView.messagePreview("single line"), "single line");
  assert.equal(FeedView.messagePreview(null), "—");
});

test("messagePreview: long single-line JSON is bounded with an ellipsis", () => {
  assert.equal(FeedView.messagePreview("123456789", 6), "12345…");
  assert.equal(FeedView.hasMoreText("123456789", 6), true);
  assert.equal(FeedView.hasMoreText("short", 6), false);
  assert.equal(FeedView.hasMoreText("first\nsecond", 80), true);
});

test("progressive counts clamp and advance in bounded steps", () => {
  assert.equal(FeedView.initialCount(100), 25);
  assert.equal(FeedView.initialCount(8), 8);
  assert.equal(FeedView.nextCount(25, 100), 50);
  assert.equal(FeedView.nextCount(90, 100), 100);
  assert.equal(FeedView.nextCount(100, 100), 100);
  assert.equal(FeedView.nextCount(-4, 10), 10); // invalid 0 + caller-supplied default step
});

test("countText distinguishes shown, fetched, and incident occurrence totals", () => {
  assert.equal(FeedView.countText(25, 100), "showing 25 of 100 fetched");
  assert.equal(FeedView.countText(25, 100, 740), "showing 25 of 100 fetched · newest 100 of 740 occurrences");
  assert.equal(FeedView.countText(200, 100, 100), "showing 100 of 100 fetched");
});

test("noteText promotes system/job once and preserves remaining unknown fields", () => {
  assert.equal(FeedView.noteText(null), "");
  assert.equal(FeedView.noteText("plain"), "plain");
  assert.equal(FeedView.noteText({ system_id: "SME1", job_id: "j1" }), "system: SME1  job: j1");
  const mixed = FeedView.noteText({ sme: "SME2", job_id: "j2", message: "safe", extra: 7 });
  assert.equal(mixed, 'system: SME2  job: j2\n{"message":"safe","extra":7}');
  assert.equal((mixed.match(/SME2/g) || []).length, 1);
});

test("noteText preserves arrays, nested fields, and falsy promoted values", () => {
  assert.equal(FeedView.noteText([{ code: 1 }, { nested: { ok: true } }]), '[{"code":1},{"nested":{"ok":true}}]');
  assert.equal(
    FeedView.noteText({ system_id: 0, job_id: false, message: { code: 2 } }),
    'system: 0  job: false\n{"message":{"code":2}}',
  );
  assert.equal(FeedView.noteText({ system_id: "", extra: 1 }), 'system: \n{"extra":1}');
});

test("noteText preserves distinct system identifiers and deduplicates equal ones", () => {
  assert.equal(FeedView.noteText({ system_id: "SYS1", sme: "SME1" }), "system: SYS1  sme: SME1");
  assert.equal(FeedView.noteText({ system_id: "SYS1", sme: "SYS1" }), "system: SYS1");
  assert.equal(FeedView.noteText({ sme: "SME1" }), "system: SME1");
});

test("noteText safely represents unusual direct-call values without throwing", () => {
  assert.equal(FeedView.noteText({ system_id: { id: 7 } }), 'system: {"id":7}');
  assert.equal(FeedView.noteText([1n]), '["1"]');
  const circular = { label: "root" };
  circular.self = circular;
  const rendered = FeedView.noteText(circular);
  assert.match(rendered, /"label":"root"/);
  assert.match(rendered, /"\[Circular\]"/);
});

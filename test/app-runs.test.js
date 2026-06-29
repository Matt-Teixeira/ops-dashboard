"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { clampInt, shapePage } = require("../lib/app-runs");

test("clampInt: non-numeric falls back to the default", () => {
  assert.equal(clampInt(undefined, 24, 1, 720), 24);
  assert.equal(clampInt("abc", 200, 1, 500), 200);
  assert.equal(clampInt("", 24, 1, 720), 24);
});

test("clampInt: bounds to [min,max] and truncates", () => {
  assert.equal(clampInt("0", 24, 1, 720), 1); // below min
  assert.equal(clampInt("9999", 200, 1, 500), 500); // above max
  assert.equal(clampInt("48", 24, 1, 720), 48); // within
  assert.equal(clampInt("48.9", 24, 1, 720), 48); // truncated
});

const ROWS = (n) =>
  Array.from({ length: n }, (_, i) => ({
    run_id: "id-" + i,
    inserted_at_iso: "2026-06-29T14:30:" + String(i).padStart(2, "0") + ".000000Z",
    status: i % 2 ? "ERROR" : "SUCCESS",
    issue_count: i,
  }));

test("shapePage: full page (count === limit) yields a keyset cursor = last row", () => {
  const page = shapePage(ROWS(3), 3);
  assert.equal(page.runs.length, 3);
  assert.equal(page.nextBefore, "2026-06-29T14:30:02.000000Z");
  assert.equal(page.nextBeforeId, "id-2");
});

test("shapePage: partial page (count < limit) is the last page (no cursor)", () => {
  const page = shapePage(ROWS(2), 3);
  assert.equal(page.runs.length, 2);
  assert.equal(page.nextBefore, null);
  assert.equal(page.nextBeforeId, null);
});

test("shapePage: empty page has no cursor and no rows", () => {
  const page = shapePage([], 200);
  assert.deepEqual(page.runs, []);
  assert.equal(page.nextBefore, null);
  assert.equal(page.nextBeforeId, null);
});

test("shapePage: maps db columns to the API shape", () => {
  const page = shapePage([{ run_id: "abc", inserted_at_iso: "2026-06-29T00:00:00.000000Z", status: "WARN", issue_count: 4 }], 200);
  assert.deepEqual(page.runs[0], { runId: "abc", insertedAt: "2026-06-29T00:00:00.000000Z", status: "WARN", issueCount: 4 });
});

test("shapePage: tolerates non-array input", () => {
  assert.deepEqual(shapePage(null, 10), { runs: [], nextBefore: null, nextBeforeId: null });
});

// DB-free guard on the SQL shape (db/queries.js can't be required without DB env,
// so assert the text contract instead). Protects the Phase 11 review invariants.
test("APP_RUNS_SQL: partition-pruned, keyset, lean (no verbose_log)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const m = src.match(/const APP_RUNS_SQL = `([\s\S]*?)`;/);
  assert.ok(m, "APP_RUNS_SQL template found");
  const sql = m[1];
  assert.match(sql, /app_name = \$1/, "filters app_name");
  assert.match(sql, /inserted_at > \$2::timestamptz/, "partition-prunes on inserted_at");
  assert.match(sql, /\(inserted_at, run_id\) < \(\$3::timestamptz, \$4::uuid\)/, "keyset cursor on (inserted_at, run_id)");
  assert.match(sql, /ORDER BY inserted_at DESC, run_id DESC/, "stable worst-... newest-first order");
  assert.match(sql, /LIMIT \$5/, "bounded by limit");
  assert.match(sql, /warn_error_logs/, "status/issues from warn_error_logs");
  assert.doesNotMatch(sql, /verbose_log/, "never touches verbose_log (no detoast)");
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { clampInt, shapePage, normalizeStatusFilter, formatJobType } = require("../lib/app-runs");

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

// Phase 18: data_acquisition job type.
test("formatJobType: run_group refined by modality and schedule", () => {
  assert.equal(formatJobType("hhm", "CT", null), "hhm/CT");
  assert.equal(formatJobType("hhm", "MRI", null), "hhm/MRI");
  assert.equal(formatJobType("mmb", null, "3"), "mmb #3");
  assert.equal(formatJobType("mmb", null, 0), "mmb #0"); // schedule 0 is meaningful, not blank
  assert.equal(formatJobType("ip_reset", null, null), "ip_reset");
  assert.equal(formatJobType("hhm", "CT", "2"), "hhm/CT #2");
});

test("formatJobType: no run_group -> null (caller falls back)", () => {
  assert.equal(formatJobType(null, "CT", "3"), null); // modality/schedule alone are not a job type
  assert.equal(formatJobType("", "CT", null), null);
  assert.equal(formatJobType("  ", null, null), null);
  assert.equal(formatJobType(undefined, undefined, undefined), null);
});

test("formatJobType: the JSON-string sentinels 'null'/'undefined' count as absent", () => {
  // data_acquisition writes inapplicable fields as the string "null", e.g. hhm has
  // no schedule -> {run_group:'hhm', modality:'CV', schedule:'null'}.
  assert.equal(formatJobType("hhm", "CV", "null"), "hhm/CV");
  assert.equal(formatJobType("hhm", "CT", "NULL"), "hhm/CT");
  assert.equal(formatJobType("mmb", "null", "3"), "mmb #3");
  assert.equal(formatJobType("mmb", "undefined", "undefined"), "mmb");
  assert.equal(formatJobType("null", "CT", "3"), null); // run_group itself absent
});

test("shapePage: includes jobType only when derivable; other apps' rows are unchanged", () => {
  const rows = [
    { run_id: "a", inserted_at_iso: "2026-07-07T00:00:00.000000Z", status: "SUCCESS", issue_count: 0, da_run_group: "hhm", da_modality: "CT", da_schedule: null },
    { run_id: "b", inserted_at_iso: "2026-07-07T00:00:01.000000Z", status: "ERROR", issue_count: 2, da_run_group: null, da_modality: null, da_schedule: null },
    { run_id: "c", inserted_at_iso: "2026-07-07T00:00:02.000000Z", status: "WARN", issue_count: 1 }, // non-DA app: no da_* columns
  ];
  const page = shapePage(rows, 200);
  assert.equal(page.runs[0].jobType, "hhm/CT");
  assert.equal("jobType" in page.runs[1], false, "no run_group -> key omitted");
  assert.deepEqual(page.runs[2], { runId: "c", insertedAt: "2026-07-07T00:00:02.000000Z", status: "WARN", issueCount: 1 });
});

test("normalizeStatusFilter: valid values pass (case/space-insensitive), else 'all'", () => {
  assert.equal(normalizeStatusFilter("all"), "all");
  assert.equal(normalizeStatusFilter("error"), "error");
  assert.equal(normalizeStatusFilter("issues"), "issues");
  assert.equal(normalizeStatusFilter("ERROR"), "error");
  assert.equal(normalizeStatusFilter(" Issues "), "issues");
  assert.equal(normalizeStatusFilter("bogus"), "all");
  assert.equal(normalizeStatusFilter(undefined), "all");
  assert.equal(normalizeStatusFilter(null), "all");
});

// DB-free guard on the SQL shape (db/queries.js can't be required without DB env,
// so assert the text contract instead). Protects the Phase 11/13 review invariants
// and the Phase 18 rule that the verbose_log detoast is gated behind withJobType.
test("buildAppRunsSql: partition-pruned, keyset, parameterized filter; lean path never detoasts verbose_log", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const m = src.match(/const buildAppRunsSql = \(withJobType\) => `([\s\S]*?)`;/);
  assert.ok(m, "buildAppRunsSql template found");
  const sql = m[1];
  // Invariants that hold for BOTH variants.
  assert.match(sql, /app_name = \$1/, "filters app_name");
  assert.match(sql, /inserted_at > \$2::timestamptz/, "partition-prunes on inserted_at");
  assert.match(sql, /\(inserted_at, run_id\) < \(\$3::timestamptz, \$4::uuid\)/, "keyset cursor on (inserted_at, run_id)");
  assert.match(sql, /ORDER BY inserted_at DESC, run_id DESC/, "stable worst-... newest-first order");
  assert.match(sql, /LIMIT \$5/, "bounded by limit");
  assert.match(sql, /warn_error_logs/, "status/issues from warn_error_logs");
  // Phase 13 status filter: a bound enum param ($6), never string-interpolated.
  assert.match(sql, /\$6 = 'all'/, "status filter keyed off the $6 enum param");
  assert.match(sql, /\$6 = 'error'/, "error filter");
  assert.match(sql, /\$6 = 'issues'/, "issues filter");
  // Phase 18: verbose_log (the runJob job type) is touched ONLY inside the
  // withJobType-guarded fragment. Strip those fragments -> the default lean SQL,
  // which must NOT mention verbose_log (no detoast for the non-data_acquisition path).
  const lean = sql.replace(/\$\{withJobType \? `[\s\S]*?` : ``\}/g, "");
  assert.doesNotMatch(lean, /verbose_log/, "lean path never touches verbose_log (no detoast)");
  assert.match(sql, /withJobType \?[\s\S]*?run_group[\s\S]*?verbose_log/, "job type is extracted from verbose_log only under withJobType");
  // Codex high finding (Phase 19 review): the detoast bound must come from the QUERY
  // SHAPE, not planner cooperation. The page CTE is MATERIALIZED under withJobType,
  // it is LIMITed BEFORE the LATERAL exists in the plan, and the LATERAL consumes the
  // CTE's rows (page.verbose_log) -- never the base table.
  assert.match(sql, /WITH page AS \$\{withJobType \? `MATERIALIZED ` : ``\}/, "page CTE materialized under withJobType");
  assert.ok(sql.indexOf("LIMIT $5") < sql.indexOf("LEFT JOIN LATERAL"), "page is LIMITed before the LATERAL");
  // The SAFE_JSON NUL-sanitizer (BACKLOG item 5) wraps the argument, so match on
  // page.verbose_log appearing inside the json_array_elements call rather than as
  // its immediate first argument -- the invariant is the SOURCE (page, not base).
  assert.match(sql, /json_array_elements\([^)]*page\.verbose_log/, "LATERAL consumes the materialized page, not the base table");
  assert.ok(!/json_array_elements\([^)]*\bl\.verbose_log/.test(sql), "LATERAL never reads verbose_log from the base table");
  assert.match(sql, /FROM page/, "outer select reads the page CTE");
});

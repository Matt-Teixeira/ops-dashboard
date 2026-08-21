"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { shapeSystems, summarize, shapeDetail, pickSystem } = require("../lib/systems");

// Raw SYSTEMS_LATEST rows (snake_case, as returned by db/queries.systemsLatest).
const LIST_ROWS = [
  { sme: "SME20487", issues: 1907, errors: 1200, warns: 707, apps: 2, which: "data_acquisition,hhm_rpp_philips", last_seen: "2026-06-30T23:45:57Z" },
  { sme: "SME01139", issues: 210, errors: 126, warns: 84, apps: 1, which: "hhm_rpp_philips", last_seen: "2026-06-30T23:45:57Z" },
];

test("shapeSystems: camelCase + apps split, appCount, non-array -> []", () => {
  const out = shapeSystems(LIST_ROWS);
  assert.deepEqual(out[0], {
    systemId: "SME20487", issues: 1907, errors: 1200, warns: 707,
    appCount: 2, apps: ["data_acquisition", "hhm_rpp_philips"], lastSeen: "2026-06-30T23:45:57Z",
  });
  assert.deepEqual(out[1].apps, ["hhm_rpp_philips"]);
  assert.deepEqual(shapeSystems(null), []);
});

test("shapeSystems: missing `which` -> empty apps array (no throw)", () => {
  const out = shapeSystems([{ sme: "SME00001", issues: 1, errors: 0, warns: 1, apps: 0, which: null }]);
  assert.deepEqual(out[0].apps, []);
  assert.equal(out[0].appCount, 0);
});

test("summarize: totals + crossApp counts systems spanning >1 app", () => {
  assert.deepEqual(summarize(LIST_ROWS), { systems: 2, errors: 1326, warns: 791, crossApp: 1 });
  assert.deepEqual(summarize([]), { systems: 0, errors: 0, warns: 0, crossApp: 0 });
});

test("shapeDetail: camelCase breakdown incl. latest run for drill-down", () => {
  const rows = [
    { app_name: "data_acquisition", type: "ERROR", func: "execRsync", n: 47, last_run_id: "11111111-1111-1111-1111-111111111111", last_inserted_at: "2026-06-30T23:00:00Z" },
    { app_name: "hhm_rpp_philips", type: "WARN", func: "(none)", n: 3, last_run_id: null, last_inserted_at: null },
  ];
  const out = shapeDetail(rows);
  assert.deepEqual(out[0], { app: "data_acquisition", type: "ERROR", func: "execRsync", count: 47, lastRunId: "11111111-1111-1111-1111-111111111111", lastInsertedAt: "2026-06-30T23:00:00Z" });
  assert.equal(out[1].lastRunId, null);
  assert.deepEqual(shapeDetail(undefined), []);
});

test("pickSystem: filters decorated connectivity by systemId (HHM+MMB), non-array -> []", () => {
  const decorated = [
    { systemId: "SME20487", source: "HHM", status: "OFFLINE", errorCategory: "connection_timeout" },
    { systemId: "SME20487", source: "MMB", status: "ONLINE", errorCategory: null },
    { systemId: "SME00002", source: "HHM", status: "ONLINE", errorCategory: null },
  ];
  const out = pickSystem(decorated, "SME20487");
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.source), ["HHM", "MMB"]);
  assert.deepEqual(pickSystem(null, "SME20487"), []);
  assert.deepEqual(pickSystem(decorated, "NOPE"), []);
});

// DB-free guards on the SQL shape.
test("SYSTEMS_LATEST_SQL: window-bounded, unnests warn_error_logs, grouped, no verbose_log", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const m = src.match(/const SYSTEMS_LATEST_SQL = `([\s\S]*?)`;/);
  assert.ok(m, "SYSTEMS_LATEST_SQL template found");
  const sql = m[1];
  assert.match(sql, /inserted_at > \$1::timestamptz/, "window-bounded on inserted_at");
  // SAFE_JSON NUL-sanitizer (BACKLOG item 5) wraps the argument; the invariant is
  // that the unnest source is l.warn_error_logs, wherever it sits in the call.
  assert.match(sql, /json_array_elements\([^)]*l\.warn_error_logs/, "unnests warn_error_logs (json)");
  assert.match(sql, /NULLIF\(e->'note'->>'sme', ''\)/, "system key is note.sme");
  assert.match(sql, /GROUP BY sme/, "per system");
  assert.match(sql, /LIMIT \$2/, "payload-capped");
  assert.doesNotMatch(sql, /verbose_log/, "no verbose_log");
  assert.doesNotMatch(sql, /system'->>'id'/, "no dead note.system.id fallback");
});

test("SYSTEM_DETAIL_SQL: sme bound as $1, window-bounded, grouped by app/type/func, no verbose_log", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const m = src.match(/const SYSTEM_DETAIL_SQL = `([\s\S]*?)`;/);
  assert.ok(m, "SYSTEM_DETAIL_SQL template found");
  const sql = m[1];
  assert.match(sql, /NULLIF\(e->'note'->>'sme', ''\) = \$1/, "sme is a bound param, not interpolated");
  assert.match(sql, /inserted_at > \$2::timestamptz/, "window-bounded on inserted_at");
  assert.match(sql, /GROUP BY app_name, type, func/, "per (app, type, func)");
  assert.match(sql, /array_agg\(run_id ORDER BY inserted_at DESC\)/, "carries latest run_id for drill-down");
  assert.doesNotMatch(sql, /verbose_log/, "no verbose_log");
});

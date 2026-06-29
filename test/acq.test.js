"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { shapeSystems, summarizeBySource } = require("../lib/acq");

const ROWS = [
  { system_id: "SME01", data_source: "hhm", manufacturer: "GE", modality: "CT", runs: 46, failed: 40, last_seen: "2026-06-29T15:00:00Z" },
  { system_id: "SME02", data_source: "hhm", manufacturer: "", modality: "", runs: 46, failed: 0, last_seen: "2026-06-29T15:01:00Z" },
  { system_id: "SME03", data_source: "mmb", manufacturer: null, modality: null, runs: 20, failed: 5, last_seen: "2026-06-29T15:02:00Z" },
];

test("shapeSystems: maps to camelCase, blanks/nulls -> null", () => {
  const out = shapeSystems(ROWS);
  assert.deepEqual(out[0], { systemId: "SME01", source: "hhm", manufacturer: "GE", modality: "CT", runs: 46, failed: 40, lastSeen: "2026-06-29T15:00:00Z" });
  assert.equal(out[1].manufacturer, null); // "" -> null
  assert.equal(out[1].modality, null);
  assert.equal(out[2].manufacturer, null); // null -> null
});

test("shapeSystems: tolerates non-array input", () => {
  assert.deepEqual(shapeSystems(null), []);
});

test("summarizeBySource: per-source systems/runs/failed", () => {
  assert.deepEqual(summarizeBySource(ROWS), {
    hhm: { systems: 2, runs: 92, failed: 40 },
    mmb: { systems: 1, runs: 20, failed: 5 },
  });
});

test("summarizeBySource: empty / unknown sources -> zeros, no throw", () => {
  assert.deepEqual(summarizeBySource([]), { hhm: { systems: 0, runs: 0, failed: 0 }, mmb: { systems: 0, runs: 0, failed: 0 } });
  assert.deepEqual(summarizeBySource([{ data_source: "xxx", runs: 9, failed: 1 }]), { hhm: { systems: 0, runs: 0, failed: 0 }, mmb: { systems: 0, runs: 0, failed: 0 } });
});

// DB-free guard on the SQL shape.
test("ACQ_SYSTEMS_SQL: window-bounded, grouped, no verbose_log/join", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "db", "queries.js"), "utf8");
  const m = src.match(/const ACQ_SYSTEMS_SQL = `([\s\S]*?)`;/);
  assert.ok(m, "ACQ_SYSTEMS_SQL template found");
  const sql = m[1];
  assert.match(sql, /FROM stats\.acquisition_history/, "reads stats.acquisition_history");
  assert.match(sql, /inserted_at > \$1::timestamptz/, "window-bounded on inserted_at");
  assert.match(sql, /GROUP BY system_id, data_source/, "per (system, source)");
  assert.match(sql, /FILTER \(WHERE NOT successful_acquisition\)/, "failed = not successful");
  assert.match(sql, /ORDER BY failed DESC/, "worst-first");
  assert.doesNotMatch(sql, /verbose_log/, "no verbose_log");
  assert.doesNotMatch(sql, /\bJOIN\b/, "no join");
});

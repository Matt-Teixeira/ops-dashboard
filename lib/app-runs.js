// lib/app-runs.js
// Pure helpers for the per-app run-log endpoint (Phase 11): input clamping and
// keyset-page shaping. DB-free and DOM-free (mirrors lib/runs.js) so server.js
// stays thin and the pagination contract is unit-tested.
"use strict";

// Allowed run-log status filters (Phase 13). "all" = no filter; "error" = runs with
// an ERROR event; "issues" = runs with a WARN or ERROR. The SQL applies these as a
// narrowing predicate, so keyset pagination is unaffected.
const STATUS_FILTERS = ["all", "error", "issues"];

/** Normalize the ?status filter to one of STATUS_FILTERS; anything else -> "all". */
function normalizeStatusFilter(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  return STATUS_FILTERS.includes(v) ? v : "all";
}

/** Coerce/clamp an integer query param; absent/blank/non-numeric -> default, else
 *  bounded to [min,max]. (Note: Number("") is 0, so blank is handled explicitly.) */
function clampInt(raw, def, min, max) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Shape raw APP_RUNS_SQL rows into the API payload and compute the next keyset
 * cursor. A page is "full" iff it returned `limit` rows, in which case more may
 * exist and the cursor is the last row's (insertedAt, runId); otherwise this is
 * the last page and the cursor is null. `inserted_at_iso` is a full-microsecond
 * ISO string, so it round-trips exactly as the next `before` cursor.
 */
function shapePage(rows, limit) {
  const list = Array.isArray(rows) ? rows : [];
  const runs = list.map((r) => ({
    runId: r.run_id,
    insertedAt: r.inserted_at_iso,
    status: r.status,
    issueCount: r.issue_count,
  }));
  const more = runs.length > 0 && runs.length >= limit;
  const last = more ? runs[runs.length - 1] : null;
  return {
    runs,
    nextBefore: last ? last.insertedAt : null,
    nextBeforeId: last ? last.runId : null,
  };
}

module.exports = { STATUS_FILTERS, normalizeStatusFilter, clampInt, shapePage };

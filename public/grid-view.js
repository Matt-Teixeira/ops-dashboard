// public/grid-view.js
// Pure, DOM-free transforms for the job grid: sort, group, and group status
// roll-up. Kept separate from index.html so the logic can be unit-tested with
// node --test (test/grid-view.test.js), mirroring lib/runs.js. (Phase 8)
//
// Lives in public/ (not lib/) because it is the one module that must ship to the
// browser: public/ is already statically served, so it loads via a plain
// <script src> with no build step and without exposing server-only lib/ files.
//
// Dual export: attaches `GridView` to the global in the browser, and supports
// require() in Node for the tests. No dependencies, no DOM, no fetch.
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GridView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Worst-first ranking, shared by status sort and the group roll-up badge.
  // Lower rank = worse (surfaced first). Matches the suite rule ERROR > WARN >
  // SUCCESS; INFO is included for completeness (grid status is only the first three).
  const STATUS_RANK = { ERROR: 0, WARN: 1, SUCCESS: 2, INFO: 3 };
  const UNKNOWN_RANK = 99; // any unexpected status sorts last

  /** Number, or null for nullish/non-numeric (so it can be ordered nulls-last). */
  function num(x) {
    if (x == null) return null;
    const n = Number(x);
    return Number.isNaN(n) ? null : n;
  }

  /** Ascending compare with nulls ALWAYS last, then flipped for "desc". */
  function directional(av, bv, dir) {
    const an = av == null, bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1; // a is null -> after b, regardless of direction
    if (bn) return -1;
    const base = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "desc" ? -base : base;
  }

  /** Numeric sort value for a job by column key (null when absent/unparseable). */
  function keyNum(j, key) {
    if (key === "lastRun") {
      const t = Date.parse(j.lastRun);
      return Number.isNaN(t) ? null : t;
    }
    if (key === "age") return num(j.ageMs);
    if (key === "duration") return num(j.durationMs);
    if (key === "issues") return num(j.issueCount);
    return null;
  }

  function compareBy(key, dir, a, b) {
    if (key === "app" || key === "job") {
      const base = String(a[key] || "").localeCompare(String(b[key] || ""));
      return dir === "desc" ? -base : base;
    }
    if (key === "status") {
      const ra = STATUS_RANK[a.status] != null ? STATUS_RANK[a.status] : UNKNOWN_RANK;
      const rb = STATUS_RANK[b.status] != null ? STATUS_RANK[b.status] : UNKNOWN_RANK;
      if (ra !== rb) return dir === "desc" ? rb - ra : ra - rb;
      // Tie within a status: most stale first (largest ageMs), nulls last,
      // independent of the chosen direction.
      return directional(num(a.ageMs), num(b.ageMs), "desc");
    }
    return directional(keyNum(a, key), keyNum(b, key), dir);
  }

  /**
   * Return a NEW array of jobs sorted by `key` ("app"|"job"|"status"|"lastRun"|
   * "age"|"duration"|"issues") in `dir` ("asc"|"desc"). Stable: ties fall back to
   * app then job. Never mutates the input; an unknown key just yields the
   * app/job ordering.
   */
  function sortJobs(jobs, key, dir) {
    const arr = Array.isArray(jobs) ? jobs.slice() : [];
    const d = dir === "desc" ? "desc" : "asc";
    arr.sort((a, b) =>
      compareBy(key, d, a, b) ||
      String(a.app || "").localeCompare(String(b.app || "")) ||
      String(a.job || "").localeCompare(String(b.job || "")));
    return arr;
  }

  /**
   * Bucket jobs into groups by "app" or "job", preserving the order they arrive
   * in (so sort first, then group). "none" (or anything else) yields a single
   * group keyed null. Returns [{ key, rows }]; rows are references into the input.
   */
  function groupJobs(jobs, by) {
    const arr = Array.isArray(jobs) ? jobs : [];
    if (by !== "app" && by !== "job") return [{ key: null, rows: arr.slice() }];
    const m = new Map();
    for (const j of arr) {
      const k = j[by];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(j);
    }
    return Array.from(m, function (pair) { return { key: pair[0], rows: pair[1] }; });
  }

  /** Worst status across a group's rows (for the group-head roll-up badge). */
  function groupRollupStatus(rows) {
    let worst = "SUCCESS";
    let worstRank = STATUS_RANK.SUCCESS;
    for (const r of Array.isArray(rows) ? rows : []) {
      const rank = STATUS_RANK[r && r.status];
      if (rank != null && rank < worstRank) { worstRank = rank; worst = r.status; }
    }
    return worst;
  }

  return { STATUS_RANK, sortJobs, groupJobs, groupRollupStatus };
});

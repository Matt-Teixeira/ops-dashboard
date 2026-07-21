# Code Review Handoff — Phase 19 fix round (delta)

A briefing for an automated reviewer (Codex). **This is a FIX-ROUND delta review**, not a
fresh review: round 1 (`notes/review_handoff_phase_19.md`) returned 5 findings
(1 high / 3 medium / 1 low), all were accepted and fixed in **one commit — `e1e676c`**.
Review that commit's diff only. Round 1 verified the rest of the branch clean (no
read-only / SQL-injection / partition-pruning / XSS violations) — do **not** re-review
what round 1 already cleared; look only at (a) whether each fix closes its finding and
(b) any NEW issue the fixes introduced.

---

## 1. Scope

Commit `e1e676c` on branch `phase-19-incidents-view`. Files in the diff:

```
db/queries.js            buildAppRunsSql restructured (page CTE + LATERAL-over-CTE)
server.js                DA 50-row clamp; SYSTEMS_WINDOW_MAX_HOURS=48 (+ env-default clamp)
public/index.html        categoryNode() provenance renderer (list cell + detail heading)
lib/incidents.js         confidence finite-or-null
test/app-runs.test.js    SQL-shape assertions (CTE/LIMIT-before-LATERAL/page-consumption)
test/incidents.test.js   malformed-confidence matrix
markdown/ENVIRONMENT.md  markdown/PHASE_LOG.md   (doc updates — skim only)
```

## 2. Finding → fix table (request a per-finding verdict: closed / partially / not closed)

| # | Round-1 finding | Fix applied |
|---|---|---|
| 1 (high) | Job-type LATERAL not guaranteed after LIMIT; adversarial plan detoasted every qualifying `verbose_log` | Page (filter + keyset + ORDER BY + `LIMIT $5`) selected in a `MATERIALIZED` CTE; LATERAL consumes `page.verbose_log`. Shape-asserted in tests. Re-EXPLAIN with `enable_incremental_sort=off`, 14-day window, 15,778 candidates: Function Scan loops = 50, 38ms |
| 2 (med) | 50-row detoast ceiling not enforced (default 200, max 500) | `server.js`: for `data_acquisition`, `clampInt(limit, 50, 1, 50)`; lean apps keep 200/500. Live: `limit=500` → 50 rows + `nextBefore` cursor |
| 3 (med) | Systems 168h window: 2.28s warm / 4.25s cold | `SYSTEMS_WINDOW_MAX_HOURS = 48` on both routes AND the env default is clamped at startup (misconfig can't reopen). Live: `?windowHours=168` → response echoes 48 |
| 4 (med) | Oracle category text itself rendered as a plain diagnosis | Single `categoryNode(category, categorySource)` renderer: under `oracle` the category TEXT ITSELF is the dashed muted tooltip badge (`rsync_io_timeout · oracle`); used by the list cell AND the detail heading; the old side-badge (incl. the heading's separate "oracle category" badge) removed |
| 5 (low) | Malformed `confidence` rendered `NaN (rules)` | `Number.isFinite(Number(v)) && v !== null ? Number(v) : null` + test matrix (string / null / undefined / "garbage" / NaN / Infinity) |

## 3. How to verify

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test          # 113/113 expected
# finding 1 (adversarial plan): as ops_dashboard_ro, SET enable_incremental_sort=off,
#   EXPLAIN ANALYZE the APP_RUNS_JOBTYPE_SQL shape with a 14-day window -> the
#   json_array_elements Function Scan must show loops <= 50.
docker exec ops-dashboard-app-1 wget -qO- "localhost:8080/api/apps/data_acquisition/runs?limit=500"   # 50 rows
docker exec ops-dashboard-app-1 wget -qO- "localhost:8080/api/apps/hhm_rpp_philips/runs?limit=500"    # 500 rows
docker exec ops-dashboard-app-1 wget -qO- "localhost:8080/api/systems?windowHours=168"                # windowHours:48
```

## 4. Fix-specific weak spots — the NEW risks these fixes could have introduced

1. **The CTE rewrite touched the LEAN variant too** (it's now a non-`MATERIALIZED` CTE,
   which PG should inline). Verify the lean path's plan did NOT regress: still
   partition-pruned, still index-driven keyset, no materialization for non-DA apps, and
   the byte-level "lean never mentions verbose_log" test still actually proves that.
2. **Keyset correctness across the restructure.** The outer SELECT re-ORDERs the ≤50
   CTE rows after the lateral join. Confirm the page order and the
   `inserted_at_iso`/`nextBefore` cursor round-trip are unchanged (microsecond
   precision preserved; no row skipped/duplicated at a page boundary).
3. **Does materializing the CTE itself copy/detoast the 50 `verbose_log` blobs?** The
   round-1 concern was unbounded detoast; confirm the materialized tuplestore holding
   50 rows (avg ~7.5KB, max 22KB in staging) is the accepted bounded cost and nothing
   forces a detoast of NON-page rows inside the CTE's sort.
4. **DA full run-log UX**: the run-log view for data_acquisition now pages by 50
   instead of 200 — confirm "load more" keyset chaining still works there (same
   endpoint, smaller pages) and nothing client-side assumed the old default.
5. **Env-default clamp expression** (`server.js`): `Number(x || 24) || 24` fallback
   chain — check NaN/0/negative env values land on a sane value, not 0 or NaN.
6. **`categoryNode` in the detail heading**: a badge element inside `<h2>` — confirm
   text is still `textContent`-safe, the tooltip survives, and long category slugs
   don't break the layout. Note: the drill-down EVENTS table still renders plain
   category text — intentional (L0 event categories are classifier-only; corroboration
   exists only at the incident level). Don't file that as a miss unless you find an
   oracle-provenance path into the events table.
7. **`Number("") === 0`**: an empty-string `confidence` would pass the finite check and
   render `0.00`. pg NUMERIC can't produce `""` — confirm that's acceptable or worth a
   guard.

## 5. Out of scope

Everything round 1 cleared; the deferred list from round 1 (engine-side composite
index, run-log job-type column, auth, onboarding overview); the markdown docs beyond
accuracy of the recorded numbers.

## 6. Output format

Per round-1 finding: **verdict** (closed / partially closed / not closed) with a
one-line justification. Then any **new** findings introduced by the fix commit only, in
the round-1 format (Severity · `path:line` · What & why · Suggested fix). Bias toward
few, high-confidence findings.

# Code Review Handoff — Phase 10: Connectivity Panel

A briefing for an automated reviewer. This phase adds the dashboard's **first read
outside schema `util`**, so the review is primarily about the **least-privilege
grant** (its blast radius) and the new read path; the UI is additive and static.

---

## 1. What this phase added

A dedicated, read-only **Connectivity view** showing each equipment system's latest
connectivity state (offline-first) across the HHM (SSH) and MMB (rsync) sources —
per-system detail the `data_acquisition/(default)` grid bucket hides.

- `db/setup-readonly-role.sql`: grants `USAGE ON SCHEMA alert` + `SELECT` on exactly
  `alert.offline_hhm_conn` and `alert.offline_mmb_conn` to `ops_dashboard_ro`.
  Idempotent; operator-run by a superuser **before** the code deploys.
- `db/queries.js`: `CONNECTIVITY_SQL` (`UNION ALL` of the two tables, labeled by
  `source`) + `connectivity()`. No `inserted_at` filter and no cache — justified:
  the alert tables are PK-on-`system_id` only, tiny (hundreds of rows), carry no
  json blob, and are not partitioned, so a full scan is sub-ms on the request path.
- `lib/connectivity.js` (server-only, pure; mirrors `lib/runs.js`): `connStatus`,
  `captureAgeMs`/`checkedAgeMs`, `sortConnectivity`, `decorate`.
- `test/connectivity.test.js`: 11 `node --test` cases (72 total).
- `server.js`: `GET /api/connectivity` → `{asOf, count, systems}` (thin; delegates
  to `connectivity.decorate`). Missing grant → the shared handler's sanitized 500.
- `public/index.html`: a routed `#connectivity` view + a header nav link.
- Docs: `markdown/ARCHITECTURE_PRINCIPLES.md` (grants, product identity, second data
  contract), `docs/connectivity-schema.md` (new), `docs/apps-suite.md`,
  `markdown/DEPLOYMENT.md` (two-step grant-then-restart deploy).

## 2. Scope of this review

Branch `phase-10-connectivity-panel`. Security-critical artifact:
`db/setup-readonly-role.sql`. Logic: `lib/connectivity.js` + `db/queries.js`.

## 3. How to verify (read-only)

- `node --test` → 72 pass (61 prior + 11 new).
- Apply the grant as a superuser (`db/setup-readonly-role.sql`, idempotent), then as
  `ops_dashboard_ro`:
  ```sql
  SET ROLE ops_dashboard_ro;
  SELECT count(*) FROM alert.offline_hhm_conn;   -- ok (was: permission denied for schema alert)
  SELECT count(*) FROM alert.offline_mmb_conn;   -- ok
  INSERT INTO alert.offline_hhm_conn(system_id) VALUES ('x');  -- expect denied (read-only)
  ```
- `curl -s localhost:8080/api/connectivity` → `{asOf,count,systems:[...]}`, OFFLINE
  first; before the grant it returns a generic 500 (confirm no internals leak).
- Open `#connectivity`: OFFLINE rows on top (red), error category / phase / detail
  visible, two distinct ages ("Data age" = capture, "Last checked" = inserted_at).

## 4. What I most want scrutinized

1. **Grant blast radius.** Confirm `ops_dashboard_ro` gains ONLY `USAGE ON SCHEMA
   alert` + `SELECT` on the two named tables — no other object in schema `alert`, no
   write/DDL anywhere, and it inherits nothing extra from `PUBLIC`. It must remain a
   pure reader.
2. **No-cache / no-`inserted_at`-filter justification.** Unlike `app_run_logs`, these
   tables are tiny, unpartitioned, and json-free, so the request-path full scan is
   deliberate (the Performance Rule targets `verbose_log` detoast). Confirm this
   holds (e.g. these are not secretly large/partitioned) and that the query ships no
   large column.
3. **Sanitized failure.** With the grant absent, `permission denied for schema alert`
   must surface as the generic 500 from the shared error handler — no DB internals to
   the client.
4. **`lib/connectivity.js` purity & correctness.** DOM-free, dependency-free, no
   mutation; `connStatus` maps false/true/null → OFFLINE/ONLINE/UNKNOWN; sort is
   worst-first then most-stale (oldest `capture_datetime`) first, unknown capture age
   last, stable by `system_id`; the two ages are distinct (capture vs inserted_at).
5. **DOM safety.** All `alert.*`-derived text (`connection_error`, `error_category`,
   `phase`, `system_id`) is rendered via `cell()`/`textContent`; no innerHTML.
6. **Read path unchanged.** The grid/errors/drill-down and the RO connection are
   untouched; this only adds a new endpoint + view.

## 5. Out of scope (don't file as findings)

- A grid connectivity rollup badge on the `data_acquisition` row — deferred.
- Per-run correlation via `stats.acquisition_history` (would need a third schema
  grant + a time-windowed join) — deferred.
- The choice to read the shared `alert.*` tables (sanctioned this phase) vs. an owned
  copy; and the decision to host `lib/connectivity.js` server-side (no browser module
  needed — the API returns the final sorted shape).

## 6. Output format

Per finding: **Severity** (blocker / high / medium / low / nit) · **`file:line`** ·
**What & why** · **Suggested fix**. Priority: (1) the role gaining any privilege
beyond SELECT-on-the-two-tables; (2) a large/partitioned-table assumption that makes
the uncached request-path scan unsafe; (3) a DB error leaking to the client; (4)
impurity/sort bugs in `lib/connectivity.js`. For a DB-privilege finding, include the
exact query that demonstrates it.

# Code Review Handoff — Phase 7: Self-Monitoring

A briefing for an automated reviewer (e.g. Codex). This is the **first phase that
writes to the database**, so the review is primarily a **security review of the
write path** (the role/function design and its blast radius), plus secret hygiene
and confirming the read path is unchanged. Everything else is read-only as before.

---

## 1. What this phase added

The dashboard logs its own health into `util.app_run_logs` under
`app_name = "ops-dashboard"`, so it appears in its own job grid and self-failures
are visible. The write is **DB-enforced, scoped, and opt-in**.

- `db/setup-writer-role.sql` (admin-run): an `ops` schema; a SECURITY DEFINER
  function `ops.log_ops_dashboard_run(run_id, verbose_log, warn_error_logs)` that
  hard-codes `app_name='ops-dashboard'`; `ops_writer_owner` (NOLOGIN) owns it and is
  the only role with INSERT on `util.app_run_logs`; `ops_dashboard_rw` (the app's
  writer login) has EXECUTE on the function and nothing else.
- `utils/logger/{log.js,enums.js}` (minimal run-log builder), `lib/self-log.js`
  (pure `buildHeartbeat` + `writeHeartbeat`), `db/pg-writer.js` + shared `db/pgp.js`
  + `db/ssl.js`.
- `server.js`: opt-in heartbeat (`SELF_LOG_ENABLED`, default off; every
  `SELF_LOG_INTERVAL_MS`, default 5 min) capturing asOf / cacheSize /
  coverage.unknown / lastRefreshMs / lastError; write failures caught.
- `config/schedules.js`: `ops-dashboard/heartbeat` cadence. +6 tests (32 total).

## 2. Scope of this review

Commit `baf398d` on `main`. The security-critical artifact is
`db/setup-writer-role.sql`; the rest is app code that calls into it.

## 3. How to verify (read-only + as the writer role)

Connection: DB `staging` on `pg_db` (`localhost` from the host). A superuser cred
for inspection is in a sibling app's `.env`; the writer is `ops_dashboard_rw`.

Re-run the boundary tests independently:
```sql
-- as ops_dashboard_rw: the sanctioned write works
SELECT ops.log_ops_dashboard_run(gen_random_uuid(), '[]'::json, '[]'::json);   -- ok
-- as ops_dashboard_rw: everything else must be denied
INSERT INTO util.app_run_logs(app_name, run_id) VALUES ('x', gen_random_uuid());  -- expect denied
SELECT count(*) FROM util.app_run_logs;                                           -- expect denied (no SELECT)
-- as ops_dashboard_ro: cannot reach the write path
SELECT ops.log_ops_dashboard_run(gen_random_uuid(), '[]'::json, '[]'::json);      -- expect denied
```

## 4. What I most want scrutinized

1. **The write boundary — does ops_dashboard_rw have ANY privilege it shouldn't?**
   The claim is EXECUTE-on-the-function-and-nothing-else. Independently confirm: no
   INSERT/SELECT/UPDATE/DELETE on `util.app_run_logs` (or any table), no rights on the
   `util` schema, and that it cannot write any `app_name` other than `ops-dashboard`
   (the value is hard-coded in the function, not a parameter — confirm there's no way
   to override it). Check what the rw role inherits from `PUBLIC` too.

2. **SECURITY DEFINER hardening.** The function runs as `ops_writer_owner`. Review:
   `SET search_path = pg_catalog, pg_temp` (is it sufficient given all refs are
   schema-qualified — would `SET search_path = ''` be stricter?); the function is
   `LANGUAGE sql` + parameterized (no dynamic SQL / injection); EXECUTE was revoked
   from `PUBLIC` before granting to rw (functions are EXECUTE-to-PUBLIC by default).
   Is `ops_writer_owner`'s INSERT-on-the-parent the minimal privilege, and is NOLOGIN
   actually unreachable (no password, no membership path)?

3. **Secret leakage into the log.** The heartbeat payload includes `lastError`
   (`lib/self-log.js` / `server.js`), which is a DB/refresh `err.message` and gets
   stored in `verbose_log`/`warn_error_logs` and shown in the error feed UI. Confirm
   no path lets a credential, connection string, or `.env` value land there (e.g. a
   connection-failure message). Should `lastError` be truncated/sanitized?

4. **Read path unchanged after the refactor.** `db/pg-pool.js` was refactored to share
   `db/pgp.js` + `db/ssl.js`. Confirm read behavior is byte-for-byte equivalent: same
   role, same config, and `db/ssl.js` matches the previous inline `buildSsl` exactly
   (disable→false, require→rejectUnauthorized:false, verify-*→fail-closed). Confirm
   sharing one pg-promise root doesn't cause pooling/connection issues.

5. **Opt-in really means read-only when off.** With `SELF_LOG_ENABLED` unset/false,
   confirm `db/pg-writer.js` is never required and no writer connection is opened — the
   app must be exactly as read-only as before this phase.

6. **Write robustness.** Exactly one row per heartbeat (the `db.none`→`db.one` fix —
   confirm no double-write and no silent miss). A writer/DB failure must be caught and
   never crash `serve` (`startSelfLog`'s `beat`). The partition edge: a `now()` insert
   needs the current month's partition; only `…_2026_06` exists and there's no DEFAULT
   partition, so month boundaries will fail the write — confirm it degrades to STALE,
   not a crash, and weigh whether documenting (current choice) is enough.

## 5. Out of scope (don't file as findings)

- The read views/cache/staleness (Phases 1–6, reviewed).
- The decision to write to the shared `util.app_run_logs` (sanctioned by
  ARCHITECTURE_PRINCIPLES so the dashboard appears in the same grid) vs. an owned table.
- The choice of a heartbeat (not a batch job) and the SECURITY DEFINER approach over
  triggers/RLS (deliberate — triggers/RLS on the shared partitioned table were
  explicitly rejected as too invasive).

## 6. Output format

Per finding: **Severity** (blocker / high / medium / low / nit) · **`file:line`** ·
**What & why** (how to trigger/observe) · **Suggested fix**. Priority:
(1) anything that lets the writer exceed "INSERT one ops-dashboard row" — privilege
escape, other app_name, other table; (2) secret leakage into the log; (3) read-path
regression from the refactor; (4) write robustness / partition edge. Prefer fewer,
high-confidence findings — and for a DB-security finding, include the exact query
that demonstrates it.

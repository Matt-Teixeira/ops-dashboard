# Code Review Handoff — ops-dashboard v1 slice

A briefing for an automated reviewer (e.g. Codex) picking up this codebase to do a
focused code review. Read this first, then review the code under the scope below.
The goal is a **correctness + security + design** review of the first vertical slice
that was just built and deployed.

---

## 1. What this app is (30-second version)

`ops-dashboard` is a **read-only** Node web service that gives centralized visibility
into ~10 cron-driven data-pipeline apps under `/opt/apps` (medical-imaging telemetry).
It reads one shared Postgres table, `util.app_run_logs`, and renders a job grid +
error feed + per-run drill-down. It does **not** write to any pipeline table.

Full context lives in `CLAUDE.md` and `docs/` (read `docs/logging-schema.md` for the
data contract, `docs/proposed-architecture.md` for the plan). This document is
self-contained enough to review without them, but they explain the "why".

---

## 2. Scope of this review

Review the application code introduced on `main` in these two commits:

| Commit | What |
|---|---|
| `f34b90f` | Scaffold v1 slice: server, DB layer, parsing, UI, compose, env |
| `4d19352` | Serve job grid from a background-refreshed snapshot (perf fix) |

Concretely, review everything except `docs/` and `*.md`:

```
index.js                 entrypoint, argv dispatch
server.js                Express app, endpoints, background grid snapshot
db/pg-pool.js            pg-promise connection + SSL handling
db/queries.js            all SQL (parameterized)
lib/runs.js              canonical JS parsing rules (status/job/duration)
lib/staleness.js         overdue detection vs config/schedules.js
config/schedules.js      expected cadences (PLACEHOLDER values)
public/index.html        static vanilla-JS UI
package.json / package-lock.json
docker-compose.yaml      deploy config
.env.example             env contract (.env itself is gitignored)
```

**Out of scope:** the `docs/` files, the suite's other apps (we only read their data),
and the choice of stack (Node + Express + pg-promise + vanilla JS was deliberate to
match the suite — don't relitigate it).

---

## 3. How to run / verify it

`node` is **not** installed on the host — this runs in Docker only.

```bash
cp .env.example .env          # then set PGPASSWORD
docker compose run --rm app npm install     # into the bind-mounted node_modules cache
docker compose up -d
curl localhost:8080/healthz                 # {"ok":true}
curl localhost:8080/api/jobs/latest         # 503 "warming" for first ~17s, then 200
curl "localhost:8080/api/errors?limit=20"
```

It is currently **deployed and running** on this host on port 8080.

API surface:
- `GET /healthz` — liveness + DB reachability
- `GET /api/jobs/latest` — latest run per `(app, job)`: status, duration, age, stale
- `GET /api/errors?limit=N` — recent WARN/ERROR events, newest first
- `GET /api/runs/:run_id` — full event timeline for one run

---

## 4. Hard constraints the code must respect (verify these hold)

1. **Read-only over pipeline data.** No `INSERT`/`UPDATE`/`DELETE`/DDL against any
   table the pipeline owns. (If self-logging is ever added, only rows with
   `app_name = "ops-dashboard"` are allowed — not implemented yet.)
2. **`util.app_run_logs` is range-partitioned by month.** Every time-windowed query
   **must** filter on `inserted_at` so Postgres prunes partitions. A query that omits
   it scans every partition. (`runById` is the known exception — see §5.)
3. **`verbose_log` / `warn_error_logs` are `json`, not `jsonb`.** Operators `->`/`->>`
   work; there is no GIN index and accessing one element detoasts the whole blob.
4. **House style:** env-var fallback chains, pg-promise, `node:lts`, run as `105:987`
   on the `pg_net` network. Don't introduce new conventions without reason.

---

## 5. Known weak spots — please scrutinize these specifically

These are things the author already knows are imperfect. Confirm severity, find cases
the author missed, and propose concrete fixes. Do **not** just restate them — verify
and deepen.

1. **`/api/runs/:run_id` does a full unindexed, unpartitioned scan.**
   `db/queries.js` → `RUN_BY_ID_SQL` filters only on `run_id`, which is **not indexed**
   and the table is partitioned → it touches every partition. Also: a malformed
   `:run_id` (not a valid uuid) will hit a Postgres cast error and surface as a 500,
   not a 400/404. Should it validate the uuid and/or accept an `inserted_at` hint to
   prune partitions?

2. **DB connects as the `postgres` superuser.** The app is logically read-only but the
   credential is not. Is a least-privilege read-only role warranted? Anything that
   would let a bug (or injection) write?

3. **SQL injection surface.** All queries claim to be parameterized (`$1`/`$2`) and the
   errors `limit` is clamped. Verify there is **no** string-built SQL anywhere and that
   every external input (`:run_id`, `?limit=`) is safe.

4. **The grid is served from an in-memory snapshot refreshed every 2 min**
   (`server.js` → `refreshGrid` / `gridSnapshot`). Review: the refresh-in-progress
   guard, the "keep last good rows on failure" behavior, the 503-until-warm path, the
   `setInterval` lifecycle (no clear on shutdown), and whether age/staleness being
   recomputed per-request (while status/duration are snapshot-aged) is coherent.

5. **Duration is `last_event.dt − first_event.dt`** (`verbose_log->-1` minus `->0`).
   What if events are out of order, the array is empty/1-element, or `dt` is missing?
   Can `duration_ms` go negative or `NaN`, and how does that render? (See both
   `db/queries.js` and `lib/runs.js` — the SQL and JS are supposed to agree; confirm
   they actually do.)

6. **SSL `rejectUnauthorized: false` for `PG_SSLMODE=require`** (`db/pg-pool.js`).
   Encrypts but doesn't verify the cert. This matches the suite, but flag the MITM
   implication and whether `verify-full` should be the deployed default.

7. **Error handler returns `err.message` to the client** (`server.js`). Minor info
   disclosure on an internal tool — note it, weigh it.

8. **No graceful shutdown** — no SIGTERM handler to drain the server / close the pg
   pool. Does this matter for a `docker compose restart`?

9. **Staleness config is placeholder** (`config/schedules.js`) — cadences are guesses,
   cron strings are unsupported (`lib/staleness.js` returns `null` for them), and
   `data_acquisition` is modeled as one job though it fans out per `system_id`. Review
   the *logic* (is `null` vs `false` vs `true` handled correctly downstream?), not the
   accuracy of the numbers.

10. **No tests at all.** Identify the highest-value units to test first
    (`lib/runs.js` parsing and `lib/staleness.js` are pure and obvious candidates).

---

## 6. What is intentionally deferred (don't file these as bugs)

These are tracked follow-ups, not oversights — mention them only if you see a concrete
correctness/security issue, not as "missing feature":

- **Incremental summary table** — the real fix for the slow grid (parse each row once,
  keyed on an `inserted_at` watermark, into a compact table). The 2-min snapshot is a
  deliberate stopgap. The grid query detoasts ~150 MB of JSON (~17s); that's why it's
  off the request path.
- **Run drill-down UI** — the `/api/runs/:run_id` endpoint exists; nothing links to it.
- **Auth** — none. Deployed host-internal only, by decision.
- **`data_acquisition` per-`system_id` granularity** — bucketed as one `(default)` job.
- **`data_acquisition`'s `addRunSummary.wall_clock_ms`** — a precise per-run duration
  exists for that app but isn't used; we diff `dt` uniformly instead.

---

## 7. Output format requested

For each finding, please give:

- **Severity** (blocker / high / medium / low / nit)
- **File + line** (`path:line`)
- **What & why** — the concrete problem and how to trigger/observe it
- **Suggested fix** — minimal, matching house style

Prioritize: (1) anything that violates the read-only or partition-pruning constraints,
(2) security (injection, credential scope, SSL, info leak), (3) correctness of the
parsing/duration/status logic, (4) the snapshot concurrency/lifecycle, then everything
else. Bias toward fewer, high-confidence findings over a long speculative list.

# Architecture Principles

Durable rules for `ops-dashboard`. A phase prompt that conflicts with these must
be revised, or the rule must be changed deliberately (with a `PHASE_LOG.md`
entry) before implementation. These are not incidental preferences.

## Product Identity

`ops-dashboard` is a **read-only** web service that gives centralized visibility
into the cron-driven data-pipeline apps under `/opt/apps`. It reads the shared
log table `util.app_run_logs` and renders:

- a **job grid** — latest run per `(app, job)`: status, duration, age, staleness
- an **error feed** — recent WARN/ERROR events across the suite
- a **run drill-down** — the full event timeline for one run
- a **connectivity panel** — latest per-equipment connectivity state (which
  systems are offline) from the `alert.*` tables, surfacing per-system detail the
  `data_acquisition/(default)` job bucket hides

It does not orchestrate, ingest, or mutate anything in the pipeline.

## Read-Only Rule

The dashboard is read-only over pipeline data.

- No `INSERT`/`UPDATE`/`DELETE`/DDL against any table the pipeline owns.
- If self-monitoring is ever added, write **only** rows with
  `app_name = "ops-dashboard"` — never another app's rows.
- Enforce this at the credential layer too (see Least-Privilege Rule), so a bug
  cannot write even if the code tries.

## Data-Contract Rule

`util.app_run_logs` is the single data contract. Confirmed facts (re-verify if
the table changes):

- `verbose_log` and `warn_error_logs` are **`json`**, not `jsonb` and not
  `text`. Operators `->`/`->>` work; accessing one element detoasts the whole
  blob.
- The table is **range-partitioned by month**. Every time-windowed query **must**
  filter on `inserted_at` so Postgres prunes partitions. A query without it
  scans every partition.
- `inserted_at timestamptz default now()` (indexed, DESC) is the run clock.
- Job name = `verbose_log->0->'note'->'argv'->>2`, **except** `data_acquisition`,
  which has no argv job and is bucketed as `(default)`.
- Run status = ERROR if any `warn_error_logs[].type='ERROR'`, else WARN if any
  `='WARN'`, else SUCCESS.

Verify assumptions against the live DB before building query logic. If reality
differs from `docs/logging-schema.md`, fix the doc in the same phase.

A **second, read-only contract** (added Phase 10) backs the connectivity panel:
`alert.offline_hhm_conn` and `alert.offline_mmb_conn`. Each is **upserted to one
row per `system_id`** (PK) holding that equipment's latest connectivity state — so,
unlike `app_run_logs`, they are tiny, **not partitioned**, and carry **no json blob
to detoast**. A full scan is sub-millisecond, so the connectivity query runs on the
request path with no cache. They are written by `data_acquisition`; the dashboard
only reads them. See `docs/connectivity-schema.md`.

## Performance Rule

The biggest cost is detoasting large `verbose_log` JSON. Keep it off the request
path.

- Heavy aggregate queries are served from a background-refreshed snapshot, not
  computed per request.
- Push parsing (status, job, duration) into SQL so multi-MB blobs aren't shipped
  to Node.
- The long-term direction is an **incremental summary table** keyed on an
  `inserted_at` watermark so each row is parsed once, never re-detoasted.
- A request-path handler should return in well under a second.

## Least-Privilege Rule

The dashboard connects as a dedicated read-only role (`ops_dashboard_ro`). Its
grants are `CONNECT`, `USAGE ON SCHEMA util`, `SELECT ON util.app_run_logs`; — added
in Phase 10, the first read outside `util` — `USAGE ON SCHEMA alert` + `SELECT` on
exactly `alert.offline_hhm_conn` / `alert.offline_mmb_conn`; and — added in Phase 15,
the third read surface — `USAGE ON SCHEMA stats` + `SELECT` on exactly
`stats.acquisition_history`. Nothing else: no other object in any schema, no writes,
no DDL. Each non-`util` grant is applied **fail-closed** (the setup script REVOKEs the
role's schema/table privileges, re-grants only the intended SELECTs, then a `DO` block
RAISEs if any other effective privilege — incl. via PUBLIC/membership — or schema
CREATE remains), so re-running the script *proves* the surface rather than just adding
to it. Never ship the app pointed at a superuser. Role setup lives in
`db/setup-readonly-role.sql` (idempotent; re-run as a superuser to apply new grants
before deploying code that needs them).

## House-Style Rule

Match the `/opt/apps` suite rather than introducing new conventions:

- Node.js; `pg-promise` for DB access with env-var fallback chains
- runs in Docker on the external `pg_net` network, DB at `pg_db:5432`
- `user: "105:987"`, `node_modules` bind-mounted from
  `/opt/resources/node_mod_cache/ops-dashboard`
- `node index.js <job>` dispatch via a registry map; `serve` is the long-running job

Deviate only with a clear, logged reason.

## Secrets Rule

No phase exposes `.env` values, passwords, connection strings, or the SSL cert
contents in docs, prompts, screenshots, or commits. Docs may name environment
variables; they must not contain secret values. `.env` stays gitignored.

## Deployment Rule

Unlike the suite's one-shot batch apps, this is a **long-running service**:
`docker compose up -d`, a published port, `command: node index.js serve`. It
keeps using `process.env.PORT`. Deployment changes happen only when a phase calls
for them. See `markdown/DEPLOYMENT.md`.

## Decision Rule

When choices conflict, prefer the option that:

1. keeps the app read-only and least-privilege
2. keeps queries partition-pruned and fast (heavy work off the request path)
3. confirms schema assumptions against the live DB rather than trusting docs
4. matches the existing suite's house style
5. avoids secret exposure
6. can be reviewed and reverted in a small phase

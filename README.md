# ops-dashboard

A centralized, read-only **operations dashboard** for the suite of data-pipeline
apps under `/opt/apps`. Today there is no single place to see whether the dozens
of cron-driven jobs across ~10 apps ran, succeeded, failed, or how long they took.
Every app already writes structured run logs to PostgreSQL (`util.app_run_logs`)
**and** to JSON files under `/opt/run-logs/<app>/` — this app surfaces that data.

## Goal

Answer, at a glance:

- For every job in every app: **last run, status (success / warn / error), duration, age**.
- **Recent errors** across the whole suite (the `warn_error_logs` already separate these out).
- **Stale / missing** jobs — something that should have run on its cron cadence but didn't.
- Drill-down into a single run's full event log.

It is **read-only** over the existing logging data. No writes back to the pipeline DBs.

## Status

🛠️ **v1 vertical slice scaffolded.** The job grid, error feed, and run drill-down
are implemented against the live `util.app_run_logs` table (schema confirmed — see
below). Stack: Node + Express + `pg-promise`, with a static vanilla-JS UI.

### What works

- `GET /api/jobs/latest` — latest run per `(app, job)`: status, duration, age, staleness.
- `GET /api/errors?limit=N` — recent WARN/ERROR events across the suite, newest first.
- `GET /api/runs/:run_id` — full event timeline for one run (drill-down).
- `GET /healthz` — liveness + DB reachability.
- `public/index.html` — single-page grid + error feed.

### Confirmed against the live DB (`staging` on `pg_db`, 2026-06)

- `verbose_log` / `warn_error_logs` are **`json`** (not `jsonb`, not `text`).
- There **is** an `inserted_at timestamptz default now()` column with a DESC index —
  used as the run clock. The table is **range-partitioned by month**, so every query
  filters `inserted_at` for partition pruning (verified: subplans pruned to one partition).
- Only **4 apps currently write to the DB**: `data_acquisition`, `hhm_rpp_philips`,
  `hhm_rpp_ge`, `hhm_rpp_siemens` (siemens is near-dormant). `monday` / `reports` /
  `acumatica_sync` / `part-source-pipeline` don't log to the DB yet — they'll appear
  automatically once they do.
- Job name = `verbose_log->0->'note'->'argv'->>2` for the `hhm_rpp_*` apps;
  `data_acquisition` has no argv job (it fans out per `system_id`) → bucketed as `(default)`.

## Running

`node` is **not** installed on the host — this app runs in Docker, like the rest of
the suite.

```bash
cp .env.example .env          # then set PGPASSWORD (see a sibling app's .env)
# one-time host dirs (bind-mount targets):
sudo install -d -o 105 -g 987 /opt/resources/node_mod_cache/ops-dashboard /opt/run-logs/ops-dashboard
docker compose run --rm app npm install     # installs into the bind-mounted cache
docker compose up -d                         # starts the server on :8080
curl localhost:8080/healthz
```

Inside the container, PG is at `pg_db:5432` (`.env` default). From the host directly,
use `PGHOST=localhost`.

## Where to start

1. Read [`CLAUDE.md`](./CLAUDE.md) — orientation for an AI assistant / new contributor.
2. Read [`docs/apps-suite.md`](./docs/apps-suite.md) — what the dashboard is monitoring.
3. Read [`docs/logging-schema.md`](./docs/logging-schema.md) — **the data contract** the dashboard reads.
4. Read [`docs/infra-conventions.md`](./docs/infra-conventions.md) — docker / DB / env patterns to match.
5. Read [`docs/proposed-architecture.md`](./docs/proposed-architecture.md) — the build plan & open questions.

## Conventions to match (summary)

- Node.js, deployed via `docker compose` on an external `pg_net` network.
- PostgreSQL reachable in-network at host `pg_db:5432`; connect via env vars (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
- `node_modules` cached at `/opt/resources/node_mod_cache/ops-dashboard`.
- Logs mounted at `/opt/run-logs/ops-dashboard`.
- Run as `user: "105:987"` (svc UID / docker GID).

See `docs/infra-conventions.md` for copy-pasteable config.

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

🌱 **Seed stage.** This repo currently contains only context/handoff docs (this file
plus `docs/`). No code yet. Start from `docs/proposed-architecture.md`.

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

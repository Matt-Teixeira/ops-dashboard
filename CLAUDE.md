# CLAUDE.md — ops-dashboard

Orientation for an AI assistant (or new contributor) picking this project up cold.

## What this project is

`ops-dashboard` is a **new, not-yet-built** read-only web dashboard that gives
centralized visibility into the cron-driven data-pipeline apps living under
`/opt/apps`. Those apps ingest medical-imaging equipment telemetry (GE / Philips /
Siemens modalities), sync with Acumatica ERP and Monday.com, and email reports.
There is currently **no centralized monitoring** — that gap is the entire reason
this app exists.

This repo was seeded with context docs only. There is **no application code yet**.
Your job is to help design and build it. Start by reading the `docs/` folder.

## The single most important fact

Every existing app already logs in a **uniform, shared format**, in two places:

1. **PostgreSQL** → table **`util.app_run_logs`**, columns:
   `app_name`, `run_id` (uuid), `verbose_log` (JSON array of all events),
   `warn_error_logs` (JSON array of only WARN/ERROR events).
2. **JSON files** → `/opt/run-logs/<app>/<app>-log.<logger>.<run_id>.json`
   (an array of event objects).

So the dashboard does **not** need any changes to the other apps — it just reads
this existing data. The full contract is in [`docs/logging-schema.md`](./docs/logging-schema.md).
**Verify column types against the live DB before relying on them** — the schema doc
is reconstructed from the apps' insert code, not from a DDL file.

## Key docs (read in this order)

| Doc | What's in it |
|---|---|
| `docs/apps-suite.md` | Inventory of the ~10 apps being monitored + their jobs |
| `docs/logging-schema.md` | **The data contract.** DB table + file format + enums |
| `docs/infra-conventions.md` | docker-compose / PG connection / .env / package.json patterns to copy |
| `docs/proposed-architecture.md` | Build plan, stack options, open questions |

## Conventions this app must follow (house style of the suite)

- **Runtime:** Node.js. Apps connect to PG via either `pg` (raw `Pool`) or `pg-promise`.
- **Job dispatch:** `node index.js <job_name>`; argv[2] is the job name, dispatched via a registry map. (For a long-running web server this app may instead have a `start` script — decide in architecture.)
- **DB connection:** env vars with fallback chains, e.g. `process.env.PGHOST || process.env.PG_HOST`. SSL via `PG_SSLMODE` / `PG_SSL_PATH` (cert at `/opt/resources/ssl/pg_ssl.crt`).
- **Deploy:** `docker compose`, external network `pg_net`, DB at `pg_db:5432`, run as `user: "105:987"`, `node_modules` bind-mounted from `/opt/resources/node_mod_cache/ops-dashboard`.
- **Logging:** reuse the suite's logger pattern (`utils/logger/`) — `addLogEvent` / `writeLogEvents` / `dbInsertLogEvents` / `makeAppRunLog`. The dashboard can log its own runs into `util.app_run_logs` under `app_name = "ops-dashboard"` for self-monitoring (nice touch, optional).

## Working agreement

- This is **read-only** over pipeline data. Never write to other apps' tables. If self-logging, write only rows with `app_name = "ops-dashboard"`.
- `/opt/apps` is **not** a git repo at the top level; this `ops-dashboard` dir **is** its own repo. Only commit within this dir.
- Match the existing apps' style rather than introducing new conventions, unless there's a clear reason.
- Before building querying logic, confirm the live `util.app_run_logs` schema (column types, whether `verbose_log` is `jsonb` or `text`, indexes, row volume/retention).

## Good first steps for the next session

1. Confirm the live DB schema for `util.app_run_logs` (and check for any companion tables) — see open questions in `docs/proposed-architecture.md`.
2. Decide the stack (see options in the architecture doc) and get sign-off.
3. Scaffold: `package.json`, `db/pg-pool.js`, `docker-compose.yaml`, `.env.example`, minimal server + one endpoint (`GET /api/jobs/latest`).

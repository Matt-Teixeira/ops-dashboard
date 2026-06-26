# CLAUDE.md — ops-dashboard

Orientation for an AI assistant (or new contributor) picking this project up cold.

## What this project is

`ops-dashboard` is a read-only web dashboard that gives centralized visibility
into the cron-driven data-pipeline apps living under `/opt/apps`. Those apps
ingest medical-imaging equipment telemetry (GE / Philips / Siemens modalities),
sync with Acumatica ERP and Monday.com, and email reports. There was previously
**no centralized monitoring** — that gap is the reason this app exists.

A **v1 slice is built and deployed** (read-only Node/Express + pg-promise service
over `util.app_run_logs`, running in Docker on `pg_net`): job grid, error feed,
and run drill-down. Work now proceeds in small phases — see the development
workflow below. Start by reading the `docs/` folder (domain context) and
`markdown/FLOW.md` (how work gets done here).

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
- **Deploy:** runs in a Docker container like every other app here (required), on the external `pg_net` network, DB at `pg_db:5432`, run as `user: "105:987"`, `node_modules` bind-mounted from `/opt/resources/node_mod_cache/ops-dashboard`. **Unlike** the batch apps (one-shot `docker compose run` cron jobs), this is a **long-running service**: `docker compose up -d`, published port, `command: node index.js serve`. See `docs/infra-conventions.md`.
- **Logging:** reuse the suite's logger pattern (`utils/logger/`) — `addLogEvent` / `writeLogEvents` / `dbInsertLogEvents` / `makeAppRunLog`. The dashboard can log its own runs into `util.app_run_logs` under `app_name = "ops-dashboard"` for self-monitoring (nice touch, optional).

## Working agreement

- This is **read-only** over pipeline data. Never write to other apps' tables. If self-logging, write only rows with `app_name = "ops-dashboard"`.
- `/opt/apps` is **not** a git repo at the top level; this `ops-dashboard` dir **is** its own repo. Only commit within this dir.
- Match the existing apps' style rather than introducing new conventions, unless there's a clear reason.
- Before building querying logic, confirm the live `util.app_run_logs` schema (column types, whether `verbose_log` is `jsonb` or `text`, indexes, row volume/retention).

## Development workflow (read before starting work)

This project runs on a **measured, phase-based, prompt-driven workflow**. The v1
slice is built and deployed; new work happens one small, reviewable phase at a
time. The system lives at the repo root:

- `markdown/FLOW.md` — the workflow loop and phase execution steps (**start here**)
- `markdown/ARCHITECTURE_PRINCIPLES.md` — durable, non-negotiable rules
- `markdown/PROMPTS.md` — the phase roadmap and status
- `markdown/PHASE_LOG.md` — durable memory of what's been done and why
- `markdown/REVIEW_CHECKLIST.md` — the quality gate before any commit
- `markdown/ENVIRONMENT.md`, `markdown/DEPLOYMENT.md` — env rules + deploy runbook
- `prompts/prompt_X_*.txt` — the structured prompt for each phase
- `notes/` — review handoffs and findings

Before any change: read `markdown/FLOW.md`, the relevant `docs/`, the current
phase prompt, and recent `PHASE_LOG.md` entries. Confirm schema assumptions
against the live DB before writing query logic. Next planned work is **Phase 4 —
incremental summary table** (`prompts/prompt_4_summary_table.txt`).

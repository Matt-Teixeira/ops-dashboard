# ops-dashboard

A centralized, **read-only operations dashboard** for the cron-driven data-pipeline
apps under `/opt/apps` (medical-imaging equipment telemetry: GE / Philips / Siemens
→ PostgreSQL → Monday.com / Acumatica / email reports).

Every app in the suite already writes structured run logs to PostgreSQL
(`util.app_run_logs`). There was no single place to see whether all those jobs ran,
succeeded, failed, or stalled — this app surfaces that data in one screen. It reads
the shared log table; it does **not** write back to pipeline data (the one exception
is its own opt-in self-monitoring — see below).

## What it shows

- **Job grid** — one row per `(app, job)`: latest run, status (SUCCESS / WARN / ERROR),
  duration, age, and a **STALE** badge when a job overran its expected cadence. Jobs
  with no configured cadence show **? CADENCE** so they're never mistaken for healthy.
- **Error feed** — recent WARN/ERROR events across the whole suite, newest first.
  Click a row to open that run.
- **Run drill-down** — the full event timeline for one run.
- **Self-monitoring** — the dashboard logs its own heartbeat, so it appears in its own
  grid and a self-failure shows up like any other job (opt-in; off by default).

Stack: Node + Express + `pg-promise`, with a static vanilla-JS UI (no build step).

## How it runs with Docker

`node` is **not** installed on the host — everything runs in containers, like the rest
of the suite. But the run *model* is different from the other apps, and that's the key
thing to understand:

> **The batch apps are one-shot.** Cron invokes them as
> `docker compose run --rm app_tools bash -lc "npm run <job>"` — a fresh container
> starts, runs **one job** to completion, exits, and `--rm` deletes it. Nothing stays
> running between cron ticks.
>
> **ops-dashboard is a long-running service.** It starts with `docker compose up -d`,
> the container **stays up** serving HTTP on `:8080` (`command: node index.js serve`,
> `restart: unless-stopped`), and you manage it with `up` / `down` / `restart` / `logs`
> — **not** `run --rm`. The one place the batch pattern still applies is the dependency
> install (a one-shot `run --rm`, below).

### Everyday operations

| Command | When to use it |
| --- | --- |
| `docker compose up -d` | Start the service (also the way to **apply an `.env` change** — it recreates the container) |
| `docker compose ps` | Check it's up and which ports are published |
| `docker compose logs -f` | Tail logs (boot line, grid refreshes, heartbeat) |
| `docker compose restart` | Reload after a **code** change — source is bind-mounted (`./:/workspace`), so no rebuild is needed |
| `docker compose run --rm app npm install` | Reinstall deps after a `package.json` change (one-shot, like the batch apps; writes into the cached `node_modules`) |
| `docker compose down` | Stop and remove the container |

What's bind-mounted (see `docker-compose.yaml`):

- `./ → /workspace` — the source, so code edits take effect on `restart` with no image build.
- `/opt/resources/node_mod_cache/ops-dashboard → /workspace/node_modules` — deps live in
  the host cache (install once into it, rather than baking an image).
- `/opt/run-logs/ops-dashboard` and `/opt/resources/ssl` (read-only, the PG cert).

It attaches to the external **`pg_net`** network (DB reachable at `pg_db:5432`), runs as
`user: "105:987"` (svc UID / docker GID), and publishes host port `8080`.

## First-time setup

```bash
# 1. Env file — copy and fill in the secrets (see a sibling app's .env for the PG password).
cp .env.example .env

# 2. One-time host dirs (bind-mount targets), owned by the service user/group.
sudo install -d -o 105 -g 987 \
  /opt/resources/node_mod_cache/ops-dashboard /opt/run-logs/ops-dashboard

# 3. Install deps into the cache (one-shot container; the only `run --rm` here).
docker compose run --rm app npm install

# 4. Start the long-running service.
docker compose up -d

# 5. Smoke test.
curl localhost:8080/healthz                 # {"ok":true}
curl -s localhost:8080/api/jobs/latest | head -c 200
```

## Accessing the dashboard

It listens on `:8080`, **host-internal, no auth** (by design). On the host, open
`http://localhost:8080/`. This is a remote server, so from your machine forward the
port over your existing connection:

- **VS Code:** Ports panel → *Forward a Port* → `8080` → open the `localhost:8080` link.
- **SSH:** `ssh -L 8080:localhost:8080 <you>@<host>` then open `http://localhost:8080`.

Do not expose `:8080` publicly without adding auth first.

## Configuration

All config is via environment variables in `.env` (gitignored; `.env.example` is the
committed template). Full reference with defaults: [`markdown/ENVIRONMENT.md`](./markdown/ENVIRONMENT.md).
Highlights:

- **DB (read):** connects as the least-privilege role `ops_dashboard_ro`
  (`PGHOST=pg_db` in-network, or `localhost` from the host). SSL via `PG_SSLMODE` /
  `PG_SSL_PATH`. Set up the role once with [`db/setup-readonly-role.sql`](./db/setup-readonly-role.sql).
- **Grid:** served from an in-process cache; `SUMMARY_RETENTION_DAYS` (30) bounds which
  jobs appear, `GRID_REFRESH_MS` the refresh tick.
- **Self-monitoring:** `SELF_LOG_ENABLED` (default `false`). When on, the service writes
  a heartbeat run via a separate, locked-down writer role (`ops_dashboard_rw`,
  EXECUTE-only on a `SECURITY DEFINER` function — never a direct table write). Provision
  it with [`db/setup-writer-role.sql`](./db/setup-writer-role.sql).

## API

- `GET /healthz` — liveness + DB reachability.
- `GET /api/jobs/latest` — latest run per `(app, job)` with status, duration, age, staleness, coverage.
- `GET /api/errors?limit=N` — recent WARN/ERROR events, newest first.
- `GET /api/runs/:run_id?inserted_at=<iso>` — full event timeline for one run (the hint prunes the partition scan).

## Project layout & docs

- `index.js` (dispatch) · `server.js` (HTTP + grid cache + heartbeat) · `db/` (pools,
  queries, role setup) · `lib/` (parsing, staleness, cache, self-log) · `utils/logger/`
  · `config/schedules.js` (expected cadences) · `public/index.html` (UI).
- [`docs/`](./docs/) — domain context: the apps suite, the `util.app_run_logs` data
  contract, infra conventions, architecture.
- [`markdown/`](./markdown/) — the **development workflow** (this project is built in
  small, reviewed phases): `FLOW.md`, `ARCHITECTURE_PRINCIPLES.md`, `PROMPTS.md` (roadmap),
  `PHASE_LOG.md` (what's been done and why), `REVIEW_CHECKLIST.md`, `DEPLOYMENT.md`.
- [`CLAUDE.md`](./CLAUDE.md) — orientation for an AI assistant / new contributor.

## Conventions (house style of the suite)

Node.js; `docker compose` on the external `pg_net` network; DB at `pg_db:5432` via env
vars with fallback chains; `node_modules` from the host cache; logs at
`/opt/run-logs/<app>`; run as `user: "105:987"`. Read-only over pipeline data — the only
sanctioned write is the dashboard's own `app_name = "ops-dashboard"` heartbeat, enforced
at the database. See [`docs/infra-conventions.md`](./docs/infra-conventions.md).

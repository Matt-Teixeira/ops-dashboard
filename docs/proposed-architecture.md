# Proposed Architecture & Build Plan

A starting point, not a final decision. Confirm the open questions first, then pick a
stack and scaffold.

## Shape

```
  PostgreSQL (util.app_run_logs)            /opt/run-logs/<app>/*.json   (fallback/secondary)
            │                                          │
            ▼                                          ▼
      ┌─────────────────────────────────────────────────────┐
      │  ops-dashboard (Node service)                        │
      │   • db/pg-pool.js   — read-only queries              │
      │   • lib/runs.js     — parse verbose_log → run status │
      │   • lib/schedule.js — expected cadence per (app,job) │
      │   • server.js       — HTTP API + static UI           │
      └─────────────────────────────────────────────────────┘
            │
            ▼
      Browser dashboard (job grid, error feed, drill-down)
```

Primary data source is the **DB** (`util.app_run_logs`) — one query serves all apps.
The `/opt/run-logs` files are a secondary/fallback source and useful for the
drill-down view; reading the DB blob (`verbose_log`) avoids filesystem coupling.

## Core views

1. **Job grid** — one card/row per `(app, job)`: last run time, status badge
   (SUCCESS / WARN / ERROR), duration, "age" since last run, and a staleness flag if
   it overran its expected cadence.
2. **Error feed** — most recent WARN/ERROR events across the suite (straight from
   `warn_error_logs`), newest first, linking to the run.
3. **Run drill-down** — full `verbose_log` event timeline for one `run_id`.
4. *(stretch)* **Log-volume / disk** — surface the unbounded `/opt/run-logs` growth
   (`data_acquisition`, `hhm_rpp_philips` are GB-scale) so rotation can be prioritized.

## Deriving run status & timing

For each row in `util.app_run_logs`:

- **status** = ERROR if any `warn_error_logs[].type == "ERROR"`, else WARN if any
  `== "WARN"`, else SUCCESS.
- **job name** = `verbose_log[0].note.argv[2]` (the `on_boot` CALL event), normalized.
- **start/end/duration** = min/max of `verbose_log[].dt` — *unless* a created-at column
  exists (preferred) or `data_acquisition`'s `addRunSummary` `wall_clock_ms` is present.

Keep this logic in one module (`lib/runs.js`) so the parsing rules live in one place.

## Staleness detection

The DB has no schedule info. Maintain a small config in this repo:

```js
// config/schedules.js  — expected cadence per (app, job)
module.exports = {
  "monday/equipment_rtt":        { cron: "25 7 * * *",  graceMin: 30 },
  "data_acquisition/ge_ct":      { everyMin: 30,        graceMin: 15 },
  // ...
};
```

A job is **stale** if `now - lastRun > expected + grace`. Source the real cadences from
each app's cron file / docs (e.g. `monday/PROCESS-FLOW.md`). Log what's *not* covered so
gaps are visible rather than silently "green".

## Stack options (pick one — get sign-off)

| Option | Pros | Cons |
|---|---|---|
| **A. Node + Express/Fastify API + a few static HTML pages w/ vanilla JS** (recommended start) | Matches suite (plain Node), tiny footprint, fast to ship, easy to host on `pg_net` | Manual UI; less polish |
| **B. Node API + a small React/Vite SPA** | Nicer UX, easy charts | Build step, more deps, more to maintain |
| **C. Off-the-shelf (Grafana over Postgres)** | No code; mature alerting | `verbose_log` is a JSON blob, not metric rows — needs SQL views/parsing first; less tailored to "(app,job) last run" framing |

Recommendation: **A** for v1 (ship the grid + error feed fast), keep the API clean so a
nicer frontend (B) can come later. Revisit C only if alerting/retention becomes the main
need.

## Suggested API surface (v1)

- `GET /api/jobs/latest` → array of `{ app, job, lastRun, status, durationMs, stale }`.
- `GET /api/errors?limit=100` → recent WARN/ERROR events with `run_id`, `app`, `dt`, `type`, `func`, `err_msg`.
- `GET /api/runs/:run_id` → full event array for drill-down.
- `GET /healthz` → liveness.

## Open questions (resolve before/while scaffolding)

1. **Live schema of `util.app_run_logs`** — timestamp column? `jsonb` vs `text`?
   indexes? row volume / retention? (See `logging-schema.md` §1.)
2. **Which DB / database name** holds `util.app_run_logs` on `pg_db` — `staging`? prod?
   Are pipeline logs centralized in one DB or per-environment?
3. **Do all in-scope apps actually write to the DB**, or do some only write files?
4. **Auth** — is this internal-only on the host network, or does it need login? Pick a
   host port and decide exposure.
5. **Expected schedules** — gather cron cadences per `(app, job)` to power staleness.
6. **Self-monitoring** — should ops-dashboard log its own runs into `app_run_logs`
   (`app_name = "ops-dashboard"`)? Cheap and on-brand.

## First milestone (thin vertical slice)

1. Confirm Q1–Q2 against the live DB (a single `psql` / quick script).
2. Scaffold: `package.json`, `db/pg-pool.js`, `.env.example`, `docker-compose.yaml`.
3. Implement `lib/runs.js` + `GET /api/jobs/latest` and render one HTML grid.
4. Add the error feed, then drill-down.
5. Layer in staleness once schedules are gathered.

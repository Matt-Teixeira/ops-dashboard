# Infra Conventions — patterns to copy

Copy-pasteable conventions drawn from the other `/opt/apps` apps so `ops-dashboard`
matches the house style and deploys cleanly on the same host.

## docker-compose

- External network: **`pg_net`** (`external: true`). All apps attach to it; the DB is
  reachable in-network.
- `node_modules` bind-mounted from host cache: `/opt/resources/node_mod_cache/<app>`.
- Run logs bind-mounted: `/opt/run-logs/<app>`.
- Run as svc user: **`user: "105:987"`** (UID 105 svc / GID 987 docker).
- Base image: `node:lts` for simple apps. (Some apps use prebuilt staging images like
  `aux:staging` / `psp:staging` — not needed here unless you add system tooling.)
- A web dashboard additionally needs a **published port** (the pipeline apps don't,
  since they're batch jobs).

Starter template:

```yaml
services:
  app:
    image: node:lts
    user: "105:987"
    working_dir: /workspace
    env_file:
      - .env
    environment:
      HOME: /tmp
      NPM_CONFIG_CACHE: /tmp/.npm
    volumes:
      - ./:/workspace
      - /opt/resources/node_mod_cache/ops-dashboard:/workspace/node_modules
      - /opt/run-logs/ops-dashboard:/opt/run-logs/ops-dashboard
    ports:
      - "8080:8080"        # dashboard UI/API — pick a free host port
    command: ["node", "index.js", "serve"]
    networks:
      - pg_net

networks:
  pg_net:
    external: true
```

> Note: with `node_modules` bind-mounted from the host cache, run `npm install` into
> that cache (the other apps do this on first deploy) rather than relying on a Docker
> build step.

## PostgreSQL connection

In-network host is **`pg_db:5432`**. Env vars (with legacy fallbacks) used across apps:

```env
# .env  (this file is gitignored — commit .env.example instead)
APP_NAME=ops-dashboard
PGHOST=pg_db
PGPORT=5432
PGUSER=postgres
PGPASSWORD=__set_me__
PGDATABASE=staging
PG_SSLMODE=require                       # disable | require | verify-full
PG_SSL_PATH=/opt/resources/ssl/pg_ssl.crt
```

The suite uses two connection styles; pick one. `pg-promise` is the better fit here
since `util.app_run_logs` is queried with helpers and the suite's logger expects it.

**pg-promise** (mirrors `reports/utils/db/pg-pool.js`):

```js
"use strict";
const fs = require("fs");
const path = require("path");
const pgp = require("pg-promise")();

function buildSsl() {
  const mode = (process.env.PG_SSLMODE || "disable").toLowerCase();
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  const caPath = process.env.PG_SSL_PATH;
  if (caPath && fs.existsSync(path.resolve(process.cwd(), caPath))) {
    return { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

module.exports = pgp({
  host: process.env.PGHOST || process.env.PG_HOST,
  port: Number(process.env.PGPORT || process.env.PG_PORT),
  database: process.env.PGDATABASE || process.env.PG_DB,
  user: process.env.PGUSER || process.env.PG_USER,
  password: process.env.PGPASSWORD || process.env.PG_PW,
  ssl: buildSsl(),
  application_name: process.env.APP_NAME || "ops-dashboard",
});
```

**raw pg** alternative (mirrors `acumatica_sync/db/pg_pool.js`) — same env vars, returns
a `Pool`.

## package.json

Common deps in the suite: `dotenv`, `pg` / `pg-promise`, `luxon`, `short-uuid`,
`node-fetch@2`. For a web app add a server framework (e.g. `express` or `fastify`).

Scripts style — batch apps use `"<job>": "node index.js <job>"`. For this app a
long-running server is the primary entrypoint:

```json
{
  "name": "ops-dashboard",
  "scripts": {
    "serve": "node index.js serve",
    "dev": "node --watch index.js serve"
  }
}
```

## index.js dispatch

The suite dispatches on `argv[2]` via a registry map (cleanest example is
`monday/index.js`). Reuse it so a future batch job (e.g. a nightly "stale jobs" digest
email) slots in alongside `serve`:

```js
const jobs = {
  serve: () => require("./server").start(),
  // digest: () => require("./jobs/stale_digest").run(),
};

const on_boot = async () => {
  const job = process.argv[2] || "serve";
  const handler = jobs[job];
  if (!handler) throw new Error(`Unknown job "${job}". Known: ${Object.keys(jobs).join(", ")}`);
  await handler();
};
on_boot();
```

## SSL cert

Already on the host at `/opt/resources/ssl/pg_ssl.crt` (used by all apps). Reference via
`PG_SSL_PATH`; no need to add a cert to this repo.

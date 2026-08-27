// db/pg-pool.js
// Read-only PG connection for ops-dashboard (role: ops_dashboard_ro). Behavior is
// unchanged from before; the SSL builder and the pg-promise root are now shared
// (db/ssl.js, db/pgp.js) so the writer can reuse them without re-initializing the
// library. See docs/infra-conventions.md.
"use strict";

const pgp = require("./pgp");
const { buildSsl } = require("./ssl");

const config = {
  host: process.env.PGHOST || process.env.PG_HOST,
  port: Number(process.env.PGPORT || process.env.PG_PORT),
  database: process.env.PGDATABASE || process.env.PG_DB,
  user: process.env.PGUSER || process.env.PG_USER,
  password: process.env.PGPASSWORD || process.env.PG_PW,
  ssl: buildSsl(),
  // Fleet pool standard (decided 2026-08-27): a hung connect must ERROR by
  // 10s -- with no timeout, an unreachable DB hangs the run forever and the
  // empty cron .out reads as "never ran". Idle sockets close after 60s;
  // at most 15 connections per process.
  max: 15,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  application_name: process.env.APP_NAME || "ops-dashboard",
};

module.exports = pgp(config);

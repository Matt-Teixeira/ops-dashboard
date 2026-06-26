// db/pg-writer.js
// Writer connection for self-logging ONLY (Phase 7). Connects as the least-privilege
// writer role (PG_WRITER_USER), which can EXECUTE ops.log_ops_dashboard_run and
// nothing else -- no direct INSERT, no other table, no other app_name. Kept entirely
// separate from the read-only pool; only required when SELF_LOG_ENABLED is on.
"use strict";

const pgp = require("./pgp");
const { buildSsl } = require("./ssl");

const config = {
  host: process.env.PGHOST || process.env.PG_HOST,
  port: Number(process.env.PGPORT || process.env.PG_PORT),
  database: process.env.PGDATABASE || process.env.PG_DB,
  user: process.env.PG_WRITER_USER,
  password: process.env.PG_WRITER_PASSWORD,
  ssl: buildSsl(),
  application_name: (process.env.APP_NAME || "ops-dashboard") + "-writer",
};

// The only statement this connection ever runs: the locked-down log function.
// `SELECT a_void_function()` returns a single (void) row, so use db.one and discard.
const LOG_SQL = "SELECT ops.log_ops_dashboard_run($1::uuid, $2::json, $3::json)";

const db = pgp(config);

// Write one ops-dashboard run row via the SECURITY DEFINER function.
db.logRun = ({ run_id, verbose_log, warn_error_logs }) =>
  db.one(LOG_SQL, [run_id, JSON.stringify(verbose_log), JSON.stringify(warn_error_logs)]);

module.exports = db;

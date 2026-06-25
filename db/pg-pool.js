// db/pg-pool.js
// Read-only PG connection for ops-dashboard. Mirrors reports/utils/db/pg-pool.js
// so it matches the suite's env + SSL conventions (see docs/infra-conventions.md).
"use strict";

const fs = require("fs");
const path = require("path");
const pgp = require("pg-promise")();

function buildSsl() {
  const mode = (process.env.PG_SSLMODE || "disable").toLowerCase();

  if (mode === "disable") return false; // local Docker

  if (mode === "require") {
    // Encrypted, no CA verification.
    return { rejectUnauthorized: false };
  }

  // verify-ca / verify-full
  const caPath = process.env.PG_SSL_PATH;
  if (caPath) {
    const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(process.cwd(), caPath);
    if (fs.existsSync(resolved)) {
      return { ca: fs.readFileSync(resolved, "utf8"), rejectUnauthorized: true };
    }
    console.warn(`[pg] PG_SSL_PATH not found at ${resolved}; falling back to 'require'.`);
    return { rejectUnauthorized: false };
  }
  console.warn("[pg] PG_SSLMODE=verify-* but PG_SSL_PATH not set; falling back to 'require'.");
  return { rejectUnauthorized: false };
}

const config = {
  host: process.env.PGHOST || process.env.PG_HOST,
  port: Number(process.env.PGPORT || process.env.PG_PORT),
  database: process.env.PGDATABASE || process.env.PG_DB,
  user: process.env.PGUSER || process.env.PG_USER,
  password: process.env.PGPASSWORD || process.env.PG_PW,
  ssl: buildSsl(),
  application_name: process.env.APP_NAME || "ops-dashboard",
};

module.exports = pgp(config);

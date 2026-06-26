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

  // verify-ca / verify-full: fail closed. If the operator asked for CA
  // verification, never silently downgrade to encrypted-but-unverified TLS --
  // a missing/unreadable CA is a hard configuration error.
  const caPath = process.env.PG_SSL_PATH;
  if (!caPath) {
    throw new Error(`[pg] PG_SSLMODE=${mode} requires PG_SSL_PATH to be set.`);
  }
  const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(process.cwd(), caPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[pg] PG_SSLMODE=${mode} but CA not found at ${resolved}.`);
  }
  return { ca: fs.readFileSync(resolved, "utf8"), rejectUnauthorized: true };
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

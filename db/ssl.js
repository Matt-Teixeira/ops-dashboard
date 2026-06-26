// db/ssl.js
// Shared SSL config builder for the PG connections. Extracted so the read-only
// pool (db/pg-pool.js) and the writer (db/pg-writer.js) apply identical rules.
// verify-* fails closed (a missing CA is an error, never a silent downgrade).
"use strict";

const fs = require("fs");
const path = require("path");

function buildSsl() {
  const mode = (process.env.PG_SSLMODE || "disable").toLowerCase();

  if (mode === "disable") return false; // local Docker
  if (mode === "require") return { rejectUnauthorized: false }; // encrypted, no CA check

  // verify-ca / verify-full: fail closed.
  const caPath = process.env.PG_SSL_PATH;
  if (!caPath) throw new Error(`[pg] PG_SSLMODE=${mode} requires PG_SSL_PATH to be set.`);
  const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(process.cwd(), caPath);
  if (!fs.existsSync(resolved)) throw new Error(`[pg] PG_SSLMODE=${mode} but CA not found at ${resolved}.`);
  return { ca: fs.readFileSync(resolved, "utf8"), rejectUnauthorized: true };
}

module.exports = { buildSsl };

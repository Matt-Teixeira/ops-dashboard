// server.js
// HTTP API + static UI for ops-dashboard. Read-only over util.app_run_logs.
"use strict";

const path = require("path");
const express = require("express");

const queries = require("./db/queries");
const runs = require("./lib/runs");
const staleness = require("./lib/staleness");
const { createRunCache } = require("./lib/run-cache");

const ERRORS_LOOKBACK_DAYS = Number(process.env.ERRORS_LOOKBACK_DAYS || 2);
const GRID_REFRESH_MS = Number(process.env.GRID_REFRESH_MS || 120000);
const SUMMARY_RETENTION_DAYS = Number(process.env.SUMMARY_RETENTION_DAYS || 30);
const SUMMARY_OVERLAP_MS = Number(process.env.SUMMARY_OVERLAP_MS || 300000);
const SUMMARY_RECONCILE_MS = Number(process.env.SUMMARY_RECONCILE_MS || 6 * 60 * 60 * 1000);
const RETENTION_MS = SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Version-agnostic RFC-4122 uuid shape; rejects anything that would make the
// run_id cast fail in Postgres.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The job grid is served from an in-process incremental cache (lib/run-cache.js).
// The underlying query detoasts large verbose_log JSON, so we keep it off the
// request path: a one-time bootstrap scan over the retention window on boot, then
// cheap ticks over `inserted_at >= watermark - overlap`. Each row is parsed at
// most once per process lifetime. Age/staleness are recomputed per request from
// each entry's inserted_at so they stay live between refreshes.
const cache = createRunCache({ retentionDays: SUMMARY_RETENTION_DAYS, overlapMs: SUMMARY_OVERLAP_MS });
let asOf = null;
let lastError = null;
let refreshing = false;
let lastReconcileAt = 0; // epoch ms of the last full-retention scan

// One driver for three phases:
//   - bootstrap: cache not ready yet -> scan the full retention window.
//   - reconcile: ready, but >= SUMMARY_RECONCILE_MS since the last full scan ->
//     scan the full retention window again. The overlap ticks only catch rows
//     near the watermark, so a late/backfilled insert older than
//     (watermark - overlap) would be missed until a full scan. This periodic
//     reconciliation closes that gap; merge is idempotent, so it never duplicates.
//   - tick: ready and recently reconciled -> cheap scan since watermark - overlap.
// The watermark only advances inside a successful merge, so a failed refresh
// leaves no gap and the next interval simply retries.
async function refreshOnce(now = new Date()) {
  if (refreshing) return;
  refreshing = true;
  const started = Date.now();
  const full = !cache.ready || now.getTime() - lastReconcileAt >= SUMMARY_RECONCILE_MS;
  const phase = !cache.ready ? "bootstrap" : full ? "reconcile" : "tick";
  try {
    const since = full ? new Date(now.getTime() - RETENTION_MS) : cache.sinceBound(now);
    const rows = await queries.jobsLatestSince(since.toISOString());
    cache.merge(rows, now);
    cache.markReady();
    if (full) lastReconcileAt = now.getTime();
    asOf = new Date().toISOString();
    lastError = null;
    const cov = staleness.coverage(cache.values().map((r) => ({ app: r.app_name, job: r.job })));
    console.log(`[ops-dashboard] grid ${phase}: ${rows.length} rows -> ${cache.size} jobs (since ${since.toISOString()}) in ${Date.now() - started}ms; cadence unknown: ${cov.unknown}/${cov.total}${cov.unknown ? ` (${cov.unknownJobs.join(", ")})` : ""}`);
  } catch (err) {
    lastError = err.message; // keep last-good cache; watermark not advanced on failure
    console.error(`[ops-dashboard] grid ${phase} failed:`, err.message);
  } finally {
    refreshing = false;
  }
}

function buildApp() {
  const app = express();
  app.use(express.static(path.join(__dirname, "public")));

  // Liveness + DB reachability.
  app.get("/healthz", async (_req, res) => {
    try {
      await queries.ping();
      res.json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // Job grid: latest run per (app, job), served from the in-process cache.
  // Returns 503 until the first (bootstrap) load lands. Age/staleness computed
  // live per request. `lookbackDays` carries the retention window: a job is shown
  // iff its last run is within it, so "last Nd" stays accurate.
  app.get("/api/jobs/latest", (_req, res) => {
    if (!cache.ready) {
      return res.status(503).json({ error: lastError || "grid warming up", asOf: null });
    }
    const now = new Date();
    const jobs = cache.values().map((r) => {
      const lastRun = r.inserted_at;
      const s = staleness.evaluate(r.app_name, r.job, lastRun, now);
      return {
        app: r.app_name,
        job: r.job,
        runId: r.run_id,
        lastRun,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
        status: r.status,
        issueCount: r.issue_count,
        ageMs: s.ageMs,
        stale: s.stale,
      };
    });
    // cache.values() is Map order; sort for a stable grid (SQL no longer orders it).
    jobs.sort((a, b) => a.app.localeCompare(b.app) || a.job.localeCompare(b.job));
    // Coverage is additive: which grid jobs have no configured cadence (stale=null).
    // Grows as new apps start logging without a schedule entry -- a drift signal.
    const coverage = staleness.coverage(jobs.map((j) => ({ app: j.app, job: j.job })));
    res.json({
      lookbackDays: SUMMARY_RETENTION_DAYS,
      asOf,
      stale: lastError ? `last refresh failed: ${lastError}` : null,
      count: jobs.length,
      coverage,
      jobs,
    });
  });

  // Error feed: recent WARN/ERROR events across the suite, newest first.
  app.get("/api/errors", async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const events = await queries.recentErrors(ERRORS_LOOKBACK_DAYS, limit);
      res.json({ lookbackDays: ERRORS_LOOKBACK_DAYS, count: events.length, events });
    } catch (err) {
      next(err);
    }
  });

  // Drill-down: full event timeline for one run. Validate the id before it
  // reaches Postgres (a non-uuid would raise a cast error -> 500) and accept an
  // optional `inserted_at` hint to prune the partition scan -- the grid row
  // carries it, so drill-down links pass it through.
  app.get("/api/runs/:run_id", async (req, res, next) => {
    const runId = req.params.run_id;
    if (!UUID_RE.test(runId)) {
      return res.status(400).json({ error: "invalid run_id (expected a uuid)" });
    }
    const hint = req.query.inserted_at;
    if (hint != null && Number.isNaN(Date.parse(hint))) {
      return res.status(400).json({ error: "invalid inserted_at (expected an ISO timestamp)" });
    }
    try {
      const row = await queries.runById(runId, hint || null);
      if (!row) return res.status(404).json({ error: "run not found" });
      const { startedAt, endedAt, durationMs } = runs.timing(row.verbose_log);
      res.json({
        app: row.app_name,
        job: runs.jobName(row.verbose_log),
        runId: row.run_id,
        insertedAt: row.inserted_at,
        startedAt,
        endedAt,
        durationMs,
        events: row.verbose_log,
      });
    } catch (err) {
      next(err);
    }
  });

  // Log details server-side; return a generic message so DB syntax/cast/
  // connectivity internals aren't disclosed to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[ops-dashboard] request error:", err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

function start() {
  const port = Number(process.env.PORT || 8080);
  const app = buildApp();
  // Listen first so /healthz is up immediately and the grid serves 503-warming
  // during the bootstrap. The single interval drives bootstrap-then-ticks (and
  // retries the bootstrap if the first attempt fails) -- never block listen on it.
  app.listen(port, () => {
    console.log(`[ops-dashboard] listening on :${port}`);
  });
  refreshOnce();
  const timer = setInterval(refreshOnce, GRID_REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { buildApp, start, refreshOnce };

// server.js
// HTTP API + static UI for ops-dashboard. Read-only over util.app_run_logs.
"use strict";

const path = require("path");
const express = require("express");

const queries = require("./db/queries");
const runs = require("./lib/runs");
const staleness = require("./lib/staleness");

const GRID_LOOKBACK_DAYS = Number(process.env.GRID_LOOKBACK_DAYS || 7);
const ERRORS_LOOKBACK_DAYS = Number(process.env.ERRORS_LOOKBACK_DAYS || 2);
const GRID_REFRESH_MS = Number(process.env.GRID_REFRESH_MS || 120000);

// Version-agnostic RFC-4122 uuid shape; rejects anything that would make the
// run_id cast fail in Postgres.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The job-grid query detoasts ~150 MB of verbose_log JSON over the lookback
// window (~17s) -- far too slow for the request path. Since the underlying data
// only changes every ~15 min, we run it on a background interval and serve the
// last good snapshot instantly. Age/staleness are recomputed per-request from
// the snapshot's lastRun timestamps so they stay live between refreshes.
const gridSnapshot = { asOf: null, rows: null, error: null, refreshing: false };

async function refreshGrid() {
  if (gridSnapshot.refreshing) return;
  gridSnapshot.refreshing = true;
  const started = Date.now();
  try {
    gridSnapshot.rows = await queries.jobsLatest(GRID_LOOKBACK_DAYS);
    gridSnapshot.asOf = new Date().toISOString();
    gridSnapshot.error = null;
    console.log(`[ops-dashboard] grid refreshed: ${gridSnapshot.rows.length} jobs in ${Date.now() - started}ms`);
  } catch (err) {
    gridSnapshot.error = err.message; // keep last good rows, if any
    console.error("[ops-dashboard] grid refresh failed:", err.message);
  } finally {
    gridSnapshot.refreshing = false;
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

  // Job grid: latest run per (app, job). Served from the background snapshot;
  // age/staleness computed live from each run's lastRun.
  app.get("/api/jobs/latest", (_req, res) => {
    if (!gridSnapshot.rows) {
      return res.status(503).json({ error: gridSnapshot.error || "grid not warmed yet", asOf: null });
    }
    const now = new Date();
    const jobs = gridSnapshot.rows.map((r) => {
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
    res.json({
      lookbackDays: GRID_LOOKBACK_DAYS,
      asOf: gridSnapshot.asOf,
      stale: gridSnapshot.error ? `last refresh failed: ${gridSnapshot.error}` : null,
      count: jobs.length,
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
  app.listen(port, () => {
    console.log(`[ops-dashboard] listening on :${port}`);
  });
  // Warm the grid snapshot now, then keep it fresh in the background.
  refreshGrid();
  const timer = setInterval(refreshGrid, GRID_REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { buildApp, start, refreshGrid };

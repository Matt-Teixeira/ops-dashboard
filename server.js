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

  // Job grid: latest run per (app, job) with status, duration, staleness.
  app.get("/api/jobs/latest", async (_req, res, next) => {
    try {
      const rows = await queries.jobsLatest(GRID_LOOKBACK_DAYS);
      const now = new Date();
      const jobs = rows.map((r) => {
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
      res.json({ lookbackDays: GRID_LOOKBACK_DAYS, count: jobs.length, jobs });
    } catch (err) {
      next(err);
    }
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

  // Drill-down: full event timeline for one run.
  app.get("/api/runs/:run_id", async (req, res, next) => {
    try {
      const row = await queries.runById(req.params.run_id);
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

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[ops-dashboard] request error:", err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

function start() {
  const port = Number(process.env.PORT || 8080);
  const app = buildApp();
  app.listen(port, () => {
    console.log(`[ops-dashboard] listening on :${port}`);
  });
}

module.exports = { buildApp, start };

// Reproducible Phase 30 HTTP smoke/reconciliation against the disposable app.
// APP_BASE defaults to http://host.docker.internal:18080 for a Docker runner.
"use strict";

const assert = require("node:assert/strict");

const base = process.env.APP_BASE || "http://host.docker.internal:18080";

async function get(path, allowed = [200]) {
  const started = Date.now();
  const response = await fetch(base + path);
  const body = await response.json();
  assert.ok(allowed.includes(response.status), `${path}: unexpected ${response.status}`);
  return { status: response.status, ms: Date.now() - started, body };
}

function sum(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

async function main() {
  const health = await get("/healthz");
  const first = await get("/api/entities");
  const second = await get("/api/entities");
  const incidents = await get("/api/incidents?limit=25");
  const errors = await get("/api/errors?limit=2");
  const connectivity = await get("/api/connectivity");
  const systems = await get("/api/systems?windowHours=1");
  const jobs = await get("/api/jobs/latest", [200, 503]);

  const value = first.body;
  assert.equal(value.count, value.entities.length);
  assert.equal(value.summary.entityCount, value.entities.length);
  assert.equal(new Set(value.entities.map((item) => item.entity)).size, value.entities.length);
  assert.ok(value.entities.every((item) => item.entityKind === "sme"));
  assert.deepEqual(
    first.body.entities.map((item) => item.entity),
    second.body.entities.map((item) => item.entity),
    "triage ordering is stable across consecutive reads",
  );

  const all = [...value.entities, ...value.nonSmeEntities];
  assert.equal(sum(all, "incidentCount"), incidents.body.rollup.total);
  assert.equal(
    value.summary.incidentCount + value.summary.nonSme.incidentCount,
    incidents.body.rollup.total,
  );
  for (const [state, n] of Object.entries(incidents.body.rollup.byState)) {
    assert.equal(all.reduce((total, item) => total + item.byState[state], 0), n, state);
  }
  for (const [severity, n] of Object.entries(incidents.body.rollup.bySeverity)) {
    assert.equal(all.reduce((total, item) => total + item.bySeverity[severity], 0), n, severity);
  }

  assert.deepEqual(
    value.nonSmeEntities.map((item) => [item.entity, item.entityKind]),
    [["__global__", "global"], ["RTT00001", "other"]],
  );
  const mixed = value.entities.find((item) => item.categories.some((category) =>
    category.sources.includes("classifier") && category.sources.includes("oracle")));
  assert.ok(mixed, "mixed classifier/oracle category remains visible");
  const detail = await get(`/api/incidents/${incidents.body.incidents[0].id}?eventLimit=1`);

  console.log(JSON.stringify({
    ok: true,
    timingsMs: {
      health: health.ms,
      entitiesFirst: first.ms,
      entitiesSecond: second.ms,
      incidents: incidents.ms,
      errors: errors.ms,
      connectivity: connectivity.ms,
      systems: systems.ms,
      jobs: jobs.ms,
      incidentDetail: detail.ms,
    },
    entities: value.entities.length,
    incidents: incidents.body.rollup.total,
    nonSme: value.nonSmeEntities.map((item) => item.entity),
    mixedProvenanceEntity: mixed.entity,
    compatibility: {
      health: health.status,
      jobs: jobs.status,
      errors: errors.status,
      connectivity: connectivity.status,
      systems: systems.status,
      incidents: incidents.status,
      incidentDetail: detail.status,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

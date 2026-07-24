// Reproducible live validation for Phase 30. Run inside the app's Node container
// with the normal ops_dashboard_ro environment. Prints no credentials.
"use strict";

const fs = require("node:fs");
const db = require("../db/pg-pool");
const queries = require("../db/queries");
const entities = require("../lib/entities");

function planNodes(node, out = []) {
  if (!node || typeof node !== "object") return out;
  out.push({
    node: node["Node Type"],
    relation: node["Relation Name"] || null,
    rows: node["Actual Rows"],
    loops: node["Actual Loops"],
    sharedHits: node["Shared Hit Blocks"] || 0,
    sharedReads: node["Shared Read Blocks"] || 0,
  });
  for (const child of node.Plans || []) planNodes(child, out);
  return out;
}

async function main() {
  const privileges = await db.one(`
    SELECT
      current_user AS role,
      has_table_privilege(current_user, 'incidents.incidents', 'SELECT') AS can_select,
      has_table_privilege(current_user, 'incidents.incidents', 'INSERT') AS can_insert,
      has_table_privilege(current_user, 'incidents.incidents', 'UPDATE') AS can_update,
      has_table_privilege(current_user, 'incidents.incidents', 'DELETE') AS can_delete,
      has_table_privilege(current_user, 'incidents.pipeline_state', 'SELECT') AS can_read_pipeline_state
  `);
  const started = Date.now();
  const rows = await queries.incidentEntitySummaries();
  const queryMs = Date.now() - started;
  const response = entities.shapeEntityResponse(rows, new Date().toISOString());

  const direct = await db.one(`
    SELECT
      count(*)::int AS incidents,
      count(DISTINCT entity)::int AS entities,
      count(*) FILTER (WHERE entity LIKE 'SME%')::int AS sme_incidents,
      count(DISTINCT entity) FILTER (WHERE entity LIKE 'SME%')::int AS sme_entities,
      count(*) FILTER (WHERE state IN ('open', 'recurring', 'acknowledged'))::int AS active,
      sum(occurrence_count)::text AS occurrences
    FROM incidents.incidents
  `);
  const stateRows = await db.any(`
    SELECT state, count(*)::int AS n
    FROM incidents.incidents GROUP BY state ORDER BY state
  `);
  const severityRows = await db.any(`
    SELECT severity, count(*)::int AS n
    FROM incidents.incidents GROUP BY severity ORDER BY severity
  `);
  const profile = await db.one(`
    SELECT
      count(DISTINCT entity) FILTER (
        WHERE entity LIKE 'SME%' AND entity !~ '^SME[0-9]+$'
      )::int AS non_numeric_sme,
      count(DISTINCT entity) FILTER (
        WHERE entity LIKE 'SME%' AND entity !~ '^[A-Za-z0-9_-]{1,64}$'
      )::int AS unsafe_sme,
      min(length(entity)) FILTER (WHERE entity LIKE 'SME%')::int AS min_len,
      max(length(entity)) FILTER (WHERE entity LIKE 'SME%')::int AS max_len
    FROM incidents.incidents
  `);

  const source = fs.readFileSync(require.resolve("../db/queries"), "utf8");
  const marker = "const INCIDENT_ENTITY_SUMMARIES_SQL = `";
  const begin = source.indexOf(marker) + marker.length;
  const end = source.indexOf("`;", begin);
  if (begin < marker.length || end < begin) throw new Error("summary SQL not found");
  const sql = source.slice(begin, end);
  const explainRows = await db.any(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const explain = explainRows[0]["QUERY PLAN"][0];

  const all = [...response.entities, ...response.nonSmeEntities];
  const sum = (key) => all.reduce((total, entity) => total + entity[key], 0);
  const occurrences = all.reduce(
    (total, entity) => total + BigInt(entity.occurrenceCount), 0n,
  ).toString();
  const representative = response.entities.find((entity) =>
    entity.appCount > 1 && entity.categories.some((category) =>
      category.sources.includes("oracle")));

  console.log(JSON.stringify({
    privileges,
    queryRows: rows.length,
    queryMs,
    api: {
      asOf: response.asOf,
      count: response.count,
      summary: response.summary,
      nonSme: response.nonSmeEntities.map((entity) => ({
        entity: entity.entity,
        kind: entity.entityKind,
        incidents: entity.incidentCount,
        active: entity.activeIncidentCount,
        occurrences: entity.occurrenceCount,
      })),
    },
    direct,
    reconciled: {
      incidents: sum("incidentCount"),
      active: sum("activeIncidentCount"),
      occurrences,
      byState: Object.fromEntries(stateRows.map((row) => [row.state, row.n])),
      bySeverity: Object.fromEntries(severityRows.map((row) => [row.severity, row.n])),
    },
    exactSmeShape: profile,
    representative: representative && {
      entity: representative.entity,
      apps: representative.apps,
      categories: representative.categories,
    },
    explain: {
      planningMs: explain["Planning Time"],
      executionMs: explain["Execution Time"],
      nodes: planNodes(explain.Plan),
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$pool.end());

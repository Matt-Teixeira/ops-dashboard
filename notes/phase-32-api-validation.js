// Reproducible live validation for Phase 32 (entity workspace + entity-scoped
// incident list). Run inside a Node container on pg_net with the normal
// ops_dashboard_ro environment and APP_BASE pointing at a DISPOSABLE app
// serving the same worktree (never the production port 8080). Prints no
// credentials. Read-only throughout.
//
//   docker run --rm -i --user 105:987 --network pg_net --env-file .env \
//     -e HOME=/tmp -e APP_BASE=http://ops-dashboard-p32:8080 \
//     -v "$PWD":/workspace -w /workspace \
//     -v /opt/resources/node_mod_cache/ops-dashboard:/workspace/node_modules \
//     -v /opt/resources/ssl:/opt/resources/ssl:ro \
//     node:lts node notes/phase-32-api-validation.js
"use strict";

const db = require("../db/pg-pool");

const APP = process.env.APP_BASE || "http://127.0.0.1:8080";
const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? undefined : detail });
  if (!ok) failed += 1;
}

async function api(path) {
  const res = await fetch(APP + path);
  let body = null;
  try { body = await res.json(); } catch { /* status-only probes */ }
  return { status: res.status, body };
}

async function main() {
  // -- 0. role safety -------------------------------------------------------
  const role = await db.one(`
    SELECT current_user AS role,
           has_table_privilege(current_user, 'incidents.incidents', 'SELECT') AS can_select,
           has_table_privilege(current_user, 'incidents.incidents', 'INSERT') AS can_insert`);
  check("role is ops_dashboard_ro, SELECT-only", role.role === "ops_dashboard_ro" && role.can_select && !role.can_insert, role);

  // -- 1. pick live representatives straight from the data ------------------
  const top = await db.one(`
    SELECT entity, count(*)::int AS n FROM incidents.incidents
    WHERE entity LIKE 'SME%' GROUP BY entity ORDER BY n DESC, entity LIMIT 1`);
  const incidentsOnly = await db.oneOrNone(`
    SELECT entity FROM incidents.incidents
    WHERE entity LIKE 'SME%' AND entity NOT IN (
      SELECT system_id FROM alert.offline_hhm_conn UNION SELECT system_id FROM alert.offline_mmb_conn)
    LIMIT 1`);
  const connectivityOnly = await db.oneOrNone(`
    SELECT system_id FROM alert.offline_mmb_conn
    WHERE system_id NOT IN (SELECT entity FROM incidents.incidents WHERE entity IS NOT NULL)
    LIMIT 1`);

  // -- 2. entity-scoped list: totals and rows match direct SQL --------------
  const scoped = await api(`/api/incidents?entity=${top.entity}`);
  check("scoped list 200 with additive entity/scopedTotal", scoped.status === 200 &&
    scoped.body.entity === top.entity && Number.isInteger(scoped.body.scopedTotal));
  check("scopedTotal equals direct SQL count", scoped.body.scopedTotal === top.n,
    { scopedTotal: scoped.body.scopedTotal, sql: top.n });
  check("every scoped row belongs to the entity",
    scoped.body.incidents.every((i) => i.entity === top.entity));
  check("scoped rows carry additive firstSeen",
    scoped.body.incidents.every((i) => "firstSeen" in i));
  const sqlIds = (await db.any(`
    WITH ranked AS (
      SELECT id,
             CASE WHEN state IN ('open','recurring','acknowledged') THEN 0
                  WHEN state IN ('resolved','suppressed') THEN 1 ELSE 2 END AS activity_rank,
             CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                           WHEN 'low' THEN 3 WHEN 'info' THEN 4 ELSE 5 END AS severity_rank,
             last_seen
      FROM incidents.incidents WHERE entity = $1)
    SELECT id FROM ranked
    ORDER BY activity_rank ASC, severity_rank ASC, last_seen DESC NULLS LAST, id DESC`,
    [top.entity])).map((r) => Number(r.id));
  check("scoped page order is exactly the Phase 24 order",
    JSON.stringify(scoped.body.incidents.map((i) => i.id)) === JSON.stringify(sqlIds.slice(0, 100)));

  // -- 3. entity + cursor + facet filters compose ---------------------------
  // Live per-entity cardinality (max 12 on 2026-07-24) is below the minimum
  // page size, so a scoped page boundary cannot occur naturally; composition is
  // exercised by handing the scoped call a mid-list cursor from the GLOBAL walk
  // and checking the result is exactly "this entity's rows after that cursor".
  const globalFirst = await api("/api/incidents?limit=25");
  const cursor = globalFirst.body.nextCursor;
  if (cursor) {
    const scopedAfter = await api(`/api/incidents?entity=${top.entity}&cursor=${encodeURIComponent(cursor)}`);
    check("entity+cursor compose without error", scopedAfter.status === 200);
    check("entity+cursor rows stay scoped and deduped",
      scopedAfter.body.incidents.every((i) => i.entity === top.entity) &&
      new Set(scopedAfter.body.incidents.map((i) => i.id)).size === scopedAfter.body.incidents.length);
  } else check("entity+cursor compose without error", false, "no global cursor available");
  const filtered = await api(`/api/incidents?entity=${top.entity}&state=resolved&severity=high`);
  const filteredSql = await db.one(`
    SELECT count(*)::int AS n FROM incidents.incidents
    WHERE entity = $1 AND state = 'resolved' AND severity = 'high'`, [top.entity]);
  check("entity+severity+state filters compose; scopedTotal matches SQL",
    filtered.status === 200 && filtered.body.scopedTotal === filteredSql.n,
    { scopedTotal: filtered.body.scopedTotal, sql: filteredSql.n });

  // -- 4. the global contract did not regress -------------------------------
  const globalPage = await api("/api/incidents");
  check("global response has no entity/scopedTotal keys",
    !("entity" in globalPage.body) && !("scopedTotal" in globalPage.body));
  const ids = new Set();
  let cur = null, pages = 0;
  do {
    const page = await api("/api/incidents" + (cur ? `?cursor=${encodeURIComponent(cur)}` : ""));
    for (const i of page.body.incidents) ids.add(i.id);
    cur = page.body.nextCursor; pages += 1;
  } while (cur && pages < 20);
  const total = (await db.one("SELECT count(*)::int AS n FROM incidents.incidents")).n;
  check("global cursor walk is complete and duplicate-free", ids.size === total,
    { walked: ids.size, pages, sql: total });

  // -- 5. malformed entity inputs fail closed (generic 400, before SQL) -----
  for (const bad of ["", "a".repeat(65), "SME'1", "SME 1", "..%2F..", "%00"]) {
    const probe = await api(`/api/incidents?entity=${bad}`);
    check(`invalid list entity ${JSON.stringify(bad)} -> 400`, probe.status === 400, probe.body);
  }
  // Phase 29 malformed-cursor probes, re-run WITH the entity filter present.
  for (const t of ["-000001-01-01T00:00:00.000Z", "Tue, 21 Jul 2026 12:00:00 GMT"]) {
    const raw = Buffer.from(JSON.stringify({ a: 0, s: 0, t, i: "1" })).toString("base64url");
    const probe = await api(`/api/incidents?entity=${top.entity}&cursor=${raw}`);
    check(`tampered cursor (${t.slice(0, 12)}…) with entity -> 400`, probe.status === 400);
  }
  const overflowId = Buffer.from(JSON.stringify({ a: 0, s: 0, t: null, i: "99999999999999999999" })).toString("base64url");
  check("overflow-id cursor with entity -> 400",
    (await api(`/api/incidents?entity=${top.entity}&cursor=${overflowId}`)).status === 400);

  // -- 6. context endpoint reconciles with its three sources ----------------
  const context = await api(`/api/entities/${top.entity}`);
  check("context 200 with expected keys", context.status === 200 &&
    ["asOf", "entity", "entityKind", "incidentSummary", "connectivity", "signalWindowHours", "signals"]
      .every((k) => k in context.body));
  check("context incident summary equals the scoped list truth",
    context.body.incidentSummary.incidentCount === top.n &&
    context.body.incidentSummary.entity === top.entity);
  const cardList = await api("/api/entities");
  const card = cardList.body.entities.find((e) => e.entity === top.entity);
  check("context summary equals the Phase 30 card for the same entity",
    JSON.stringify(card) === JSON.stringify(context.body.incidentSummary));
  const conn = await api("/api/connectivity");
  const connRows = conn.body.systems.filter((s) => s.systemId === top.entity);
  check("context connectivity equals the decorated /api/connectivity rows",
    JSON.stringify(connRows.map((r) => [r.source, r.operationalState, r.insertedAt])) ===
    JSON.stringify(context.body.connectivity.map((r) => [r.source, r.operationalState, r.insertedAt])));
  const legacy = await api(`/api/systems/${top.entity}`);
  check("context signals equal the preserved /api/systems/:id breakdown",
    JSON.stringify(legacy.body.breakdown) === JSON.stringify(context.body.signals));

  // -- 7. window clamp, partial sources, kinds, 404, invalid ----------------
  check("windowHours clamps to 1..48 with default 24",
    (await api(`/api/entities/${top.entity}?windowHours=100`)).body.signalWindowHours === 48 &&
    (await api(`/api/entities/${top.entity}?windowHours=0`)).body.signalWindowHours === 1 &&
    (await api(`/api/entities/${top.entity}?windowHours=abc`)).body.signalWindowHours === 24);
  if (incidentsOnly) {
    const partial = await api(`/api/entities/${incidentsOnly.entity}`);
    check("incidents-only entity is a valid workspace (empty connectivity honest)",
      partial.status === 200 && partial.body.incidentSummary !== null && partial.body.connectivity.length === 0);
  }
  if (connectivityOnly) {
    const partial = await api(`/api/entities/${connectivityOnly.system_id}`);
    check("connectivity-only entity is a valid workspace (null incident summary honest)",
      partial.status === 200 && partial.body.incidentSummary === null && partial.body.connectivity.length > 0);
  }
  const globalGroup = await api("/api/entities/__global__");
  check("__global__ workspace is honest about its kind",
    globalGroup.status === 200 && globalGroup.body.entityKind === "global" &&
    globalGroup.body.connectivity.length === 0);
  check("absent-everywhere id -> 404", (await api("/api/entities/SME00000")).status === 404);
  check("invalid context id -> 400", (await api(`/api/entities/${"a".repeat(65)}`)).status === 400);

  // -- 8. plans: scoped list + single-entity summaries stay trivial ---------
  const listPlan = await db.any(`
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT id FROM incidents.incidents
    WHERE ($1 = 'all' OR severity = $1) AND ($2::text IS NULL OR entity = $2)`,
    ["all", top.entity]);
  const summaryMs = listPlan[0]["QUERY PLAN"][0]["Execution Time"];
  check("entity predicate scan stays sub-10ms at current volume", summaryMs < 10, { ms: summaryMs });

  console.log(JSON.stringify({ app: APP, entity: top.entity, results }, null, 2));
  console.log(failed === 0 ? `ALL ${results.length} CHECKS PASS` : `${failed}/${results.length} CHECKS FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });

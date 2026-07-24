// lib/entities.js
// Pure Phase 30 shaping for the complete incident-by-entity read model.
//
// The database returns one entity-summary row per category/source combination.
// This module merges those rows without a DB handle, preserves category
// provenance, and reconciles SME plus non-SME producer groups. It deliberately
// does not read connectivity, acquisition history, or run logs.
"use strict";

const {
  SEVERITIES,
  STATES,
  ACTIVE_STATES,
  INACTIVE_STATES,
} = require("./incidents");

// Shared safe identifier contract used by the existing system route. SME is a
// case-sensitive producer prefix; the value itself is never rewritten.
const SAFE_ENTITY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeEntity(value) {
  return typeof value === "string" && SAFE_ENTITY_RE.test(value);
}

function classifyEntity(value) {
  if (value === "__global__") return "global";
  if (isSafeEntity(value) && value.startsWith("SME")) return "sme";
  // Preserve all other producer values in reconciliation, including a future
  // malformed/blank value rather than silently dropping an incident.
  return "other";
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function decimal(value) {
  const raw = String(value == null ? "0" : value);
  if (!/^\d+$/.test(raw)) return "0";
  try { return BigInt(raw).toString(); }
  catch { return "0"; }
}

function instant(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function entityKey(value) {
  return `${typeof value}:${String(value)}`;
}

function categoryValue(value) {
  return typeof value === "string" && value ? value : "unknown";
}

function sourceValue(value) {
  return typeof value === "string" && value ? value : "unknown";
}

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function shapeBase(row) {
  const byState = zeroCounts([...STATES, "other"]);
  for (const state of STATES) byState[state] = count(row[`state_${state}`]);
  byState.other = count(row.other_state_count);

  const bySeverity = zeroCounts([...SEVERITIES, "other"]);
  const activeBySeverity = zeroCounts([...SEVERITIES, "other"]);
  for (const severity of SEVERITIES) {
    bySeverity[severity] = count(row[`severity_${severity}`]);
    activeBySeverity[severity] = count(row[`active_severity_${severity}`]);
  }
  bySeverity.other = count(row.severity_other);
  activeBySeverity.other = count(row.active_severity_other);

  return {
    entity: row.entity,
    entityKind: classifyEntity(row.entity),
    incidentCount: count(row.incident_count),
    activeIncidentCount: count(row.active_incident_count),
    terminalIncidentCount: count(row.terminal_incident_count),
    otherStateCount: count(row.other_state_count),
    byState,
    bySeverity,
    activeBySeverity,
    worstActiveSeverity: null,
    occurrenceCount: decimal(row.occurrence_count),
    firstSeen: instant(row.first_seen),
    oldestActiveFirstSeen: instant(row.oldest_active_first_seen),
    lastSeen: instant(row.last_seen),
    appCount: 0,
    apps: [],
    categories: [],
    _apps: new Set(),
    _categories: new Map(),
  };
}

function addApps(entity, values) {
  if (!Array.isArray(values)) return;
  for (const app of values) {
    if (typeof app === "string" && app) entity._apps.add(app);
  }
}

function addCategory(entity, row) {
  // A left join could produce no category only for a source row that vanished;
  // the current schema always has at least one incident/category row per entity.
  // Still shape null defensively as an explicit unknown category.
  const category = categoryValue(row.category);
  let item = entity._categories.get(category);
  if (!item) {
    item = { category, count: 0, activeCount: 0, sources: new Map() };
    entity._categories.set(category, item);
  }

  const source = sourceValue(row.category_source);
  const sourceCount = count(row.source_count);
  const sourceActiveCount = count(row.source_active_count);
  const old = item.sources.get(source) || { count: 0, activeCount: 0 };
  // Query rows are unique by entity/category/source. max() makes the pure merge
  // idempotent if a caller accidentally supplies a duplicate grouped row.
  item.sources.set(source, {
    count: Math.max(old.count, sourceCount),
    activeCount: Math.max(old.activeCount, sourceActiveCount),
  });
  item.count = Math.max(item.count, count(row.category_count));
  item.activeCount = Math.max(item.activeCount, count(row.category_active_count));
}

function finalize(entity) {
  entity.apps = Array.from(entity._apps).sort((a, b) => a.localeCompare(b));
  entity.appCount = entity.apps.length;

  entity.categories = Array.from(entity._categories.values(), (item) => {
    let sourceTotal = 0;
    let sourceActiveTotal = 0;
    for (const value of item.sources.values()) {
      sourceTotal += value.count;
      sourceActiveTotal += value.activeCount;
    }
    return {
      category: item.category,
      count: Math.max(item.count, sourceTotal),
      activeCount: Math.max(item.activeCount, sourceActiveTotal),
      sources: Array.from(item.sources.keys()).sort((a, b) => a.localeCompare(b)),
    };
  }).sort((a, b) =>
    b.activeCount - a.activeCount ||
    b.count - a.count ||
    a.category.localeCompare(b.category));

  if (entity.activeIncidentCount > 0) {
    entity.worstActiveSeverity = [...SEVERITIES, "other"]
      .find((severity) => entity.activeBySeverity[severity] > 0) || "other";
  }

  delete entity._apps;
  delete entity._categories;
  return entity;
}

function severityRank(value) {
  const rank = [...SEVERITIES, "other"].indexOf(value);
  return rank < 0 ? SEVERITIES.length + 1 : rank;
}

function entityOrder(a, b) {
  const active = Number(b.activeIncidentCount > 0) - Number(a.activeIncidentCount > 0);
  if (active) return active;
  const severity = severityRank(a.worstActiveSeverity) - severityRank(b.worstActiveSeverity);
  if (severity) return severity;
  if (a.activeIncidentCount !== b.activeIncidentCount) return b.activeIncidentCount - a.activeIncidentCount;
  const aTime = a.lastSeen == null ? -Infinity : Date.parse(a.lastSeen);
  const bTime = b.lastSeen == null ? -Infinity : Date.parse(b.lastSeen);
  if (aTime !== bTime) return bTime - aTime;
  return String(a.entity == null ? "" : a.entity).localeCompare(String(b.entity == null ? "" : b.entity));
}

function aggregate(items) {
  const byState = zeroCounts([...STATES, "other"]);
  const bySeverity = zeroCounts([...SEVERITIES, "other"]);
  let incidentCount = 0;
  let activeIncidentCount = 0;
  let occurrenceCount = 0n;

  for (const entity of items) {
    incidentCount += entity.incidentCount;
    activeIncidentCount += entity.activeIncidentCount;
    occurrenceCount += BigInt(entity.occurrenceCount);
    for (const state of Object.keys(byState)) byState[state] += entity.byState[state];
    for (const severity of Object.keys(bySeverity)) bySeverity[severity] += entity.bySeverity[severity];
  }

  return {
    entityCount: items.length,
    incidentCount,
    activeIncidentCount,
    occurrenceCount: occurrenceCount.toString(),
    bySeverity,
    byState,
  };
}

function shapeEntityResponse(rows, asOf = new Date().toISOString()) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const key = entityKey(row.entity);
    let entity = grouped.get(key);
    if (!entity) {
      entity = shapeBase(row);
      grouped.set(key, entity);
    }
    addApps(entity, row.apps);
    addCategory(entity, row);
  }

  const all = Array.from(grouped.values(), finalize).sort(entityOrder);
  const entities = all.filter((entity) => entity.entityKind === "sme");
  const nonSmeEntities = all.filter((entity) => entity.entityKind !== "sme");
  const sme = aggregate(entities);
  const nonSme = aggregate(nonSmeEntities);

  return {
    asOf: instant(asOf),
    count: entities.length,
    summary: {
      entityCount: entities.length,
      entitiesWithActive: entities.filter((entity) => entity.activeIncidentCount > 0).length,
      incidentCount: sme.incidentCount,
      activeIncidentCount: sme.activeIncidentCount,
      occurrenceCount: sme.occurrenceCount,
      bySeverity: sme.bySeverity,
      byState: sme.byState,
      nonSme: {
        entityCount: nonSme.entityCount,
        incidentCount: nonSme.incidentCount,
        activeIncidentCount: nonSme.activeIncidentCount,
        occurrenceCount: nonSme.occurrenceCount,
      },
    },
    entities,
    nonSmeEntities,
  };
}

module.exports = {
  SAFE_ENTITY_RE,
  isSafeEntity,
  classifyEntity,
  entityOrder,
  shapeEntityResponse,
  ACTIVE_STATES,
  INACTIVE_STATES,
};

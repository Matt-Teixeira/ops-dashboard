// Pure entity-card filters, sorts, facets, and compact-display helpers.
// Browser/Node compatible; DOM/network ownership stays in public/index.html.
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EntityView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PAGE_SIZE = 24;
  const ACTIVITIES = ["active", "all"];
  const SORTS = ["priority", "latest", "entity"];
  const SEVERITIES = ["critical", "high", "medium", "low", "info", "other"];
  const CATEGORY_RE = /^[a-z0-9_]{1,64}$/;

  function normalizePreferences(value) {
    const input = value && typeof value === "object" ? value : {};
    const search = typeof input.search === "string" ? input.search.slice(0, 64) : "";
    const activity = ACTIVITIES.includes(input.activity) ? input.activity : "active";
    const severity = input.severity === "all" || SEVERITIES.includes(input.severity)
      ? input.severity : "all";
    const category = input.category === "all" || CATEGORY_RE.test(input.category || "")
      ? input.category : "all";
    const sort = SORTS.includes(input.sort) ? input.sort : "priority";
    return { search, activity, severity, category, sort };
  }

  function numeric(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function categoryMatches(entity, category, activity) {
    if (category === "all") return true;
    return (Array.isArray(entity.categories) ? entity.categories : []).some((item) =>
      item && item.category === category &&
      numeric(activity === "active" ? item.activeCount : item.count) > 0);
  }

  function severityMatches(entity, severity, activity) {
    if (severity === "all") return true;
    const counts = activity === "active" ? entity.activeBySeverity : entity.bySeverity;
    return numeric(counts && counts[severity]) > 0;
  }

  function matches(entity, preferences) {
    const p = normalizePreferences(preferences);
    const search = p.search.trim().toLowerCase();
    if (search && !String(entity && entity.entity || "").toLowerCase().includes(search)) return false;
    if (p.activity === "active" && numeric(entity && entity.activeIncidentCount) <= 0) return false;
    return severityMatches(entity || {}, p.severity, p.activity) &&
      categoryMatches(entity || {}, p.category, p.activity);
  }

  function severityRank(value) {
    const rank = SEVERITIES.indexOf(value);
    return rank < 0 ? SEVERITIES.length + 1 : rank;
  }

  function instant(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : -Infinity;
  }

  function entityId(value) {
    return String(value && value.entity || "");
  }

  function priorityOrder(a, b) {
    const active = Number(numeric(b.activeIncidentCount) > 0) - Number(numeric(a.activeIncidentCount) > 0);
    if (active) return active;
    const severity = severityRank(a.worstActiveSeverity) - severityRank(b.worstActiveSeverity);
    if (severity) return severity;
    const count = numeric(b.activeIncidentCount) - numeric(a.activeIncidentCount);
    if (count) return count;
    const latest = instant(b.lastSeen) - instant(a.lastSeen);
    if (latest) return latest;
    return entityId(a).localeCompare(entityId(b));
  }

  function latestOrder(a, b) {
    return instant(b.lastSeen) - instant(a.lastSeen) || entityId(a).localeCompare(entityId(b));
  }

  function sortEntities(rows, sort) {
    const key = SORTS.includes(sort) ? sort : "priority";
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      if (key === "entity") return entityId(a).localeCompare(entityId(b));
      if (key === "latest") return latestOrder(a, b);
      return priorityOrder(a, b);
    });
  }

  function filterEntities(rows, preferences) {
    const p = normalizePreferences(preferences);
    return sortEntities((Array.isArray(rows) ? rows : []).filter((entity) => matches(entity, p)), p.sort);
  }

  function categoryFacets(rows, activity) {
    const mode = activity === "all" ? "all" : "active";
    const counts = new Map();
    for (const entity of Array.isArray(rows) ? rows : []) {
      for (const item of Array.isArray(entity && entity.categories) ? entity.categories : []) {
        if (!item || typeof item.category !== "string" || !item.category) continue;
        if (numeric(mode === "active" ? item.activeCount : item.count) <= 0) continue;
        counts.set(item.category, (counts.get(item.category) || 0) + 1);
      }
    }
    return Array.from(counts, ([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }

  function severityFacets(rows, activity) {
    const mode = activity === "all" ? "all" : "active";
    return SEVERITIES.map((severity) => ({
      severity,
      count: (Array.isArray(rows) ? rows : []).filter((entity) =>
        numeric((mode === "active" ? entity.activeBySeverity : entity.bySeverity)?.[severity]) > 0).length,
    }));
  }

  function initialCount(total) {
    return Math.min(Math.max(0, numeric(total)), PAGE_SIZE);
  }

  function nextCount(shown, total) {
    return Math.min(Math.max(0, numeric(total)), Math.max(0, numeric(shown)) + PAGE_SIZE);
  }

  function visible(rows, shown) {
    return (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, numeric(shown)));
  }

  function compact(values, limit) {
    const unique = Array.from(new Set((Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string" && value)));
    const n = Math.max(0, Math.trunc(numeric(limit)));
    return { values: unique.slice(0, n), remaining: Math.max(0, unique.length - n) };
  }

  function occurrenceText(value) {
    const raw = String(value == null ? "0" : value);
    return /^\d+$/.test(raw) ? raw : "0";
  }

  function categoryProvenance(item) {
    const sources = new Set((Array.isArray(item && item.sources) ? item.sources : [])
      .filter((source) => typeof source === "string" && source));
    const oracle = sources.has("oracle");
    const classifier = sources.has("classifier");
    if (oracle && !classifier) return "oracle";
    if (oracle) return "mixed";
    return classifier ? "classifier" : "unknown";
  }

  function responseSummary(response, matching, shown) {
    const summary = response && response.summary || {};
    const nonSme = summary.nonSme || {};
    return {
      entityCount: numeric(summary.entityCount),
      entitiesWithActive: numeric(summary.entitiesWithActive),
      activeIncidentCount: numeric(summary.activeIncidentCount),
      incidentCount: numeric(summary.incidentCount),
      nonSmeIncidentCount: numeric(nonSme.incidentCount),
      matching: numeric(matching),
      shown: numeric(shown),
    };
  }

  return {
    PAGE_SIZE,
    SEVERITIES,
    normalizePreferences,
    matches,
    filterEntities,
    sortEntities,
    categoryFacets,
    severityFacets,
    initialCount,
    nextCount,
    visible,
    compact,
    occurrenceText,
    categoryProvenance,
    responseSummary,
  };
});

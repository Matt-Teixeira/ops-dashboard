// public/list-view.js
// Pure, order-preserving filters and slicing for the large operational lists
// (Phase 23). Dual-exported for browser and node -- no DOM or fetch dependency.
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ListView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PAGE_SIZE = 50;
  const text = (v) => Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v);
  const matches = (query, values) => {
    const q = text(query).trim().toLowerCase();
    return !q || values.some((v) => text(v).toLowerCase().includes(q));
  };

  function filterConnectivity(rows, f = {}) {
    return (Array.isArray(rows) ? rows : []).filter((r) =>
      matches(f.search, [r.systemId, r.connectionError, r.errorCategory, r.phase]) &&
      (!f.source || f.source === "all" || r.source === f.source) &&
      (!f.state || f.state === "all" || r.operationalState === f.state));
  }

  function filterSystems(rows, f = {}) {
    return (Array.isArray(rows) ? rows : []).filter((r) =>
      matches(f.search, [r.systemId, r.apps]) &&
      (!f.health || f.health === "all" || (f.health === "errors" ? r.errors > 0 : r.errors === 0 && r.warns > 0)) &&
      (!f.crossApp || r.appCount > 1));
  }

  function filterAcquisition(rows, f = {}) {
    return (Array.isArray(rows) ? rows : []).filter((r) =>
      matches(f.search, [r.systemId, r.modality, r.manufacturer]) &&
      (!f.source || f.source === "all" || r.source === f.source) &&
      (!f.failuresOnly || r.failed > 0));
  }

  function filterAppRuns(rows, search) {
    return (Array.isArray(rows) ? rows : []).filter((r) => matches(search, [r.runId, r.jobType]));
  }

  const initialCount = (total) => Math.min(Math.max(0, Number(total) || 0), PAGE_SIZE);
  const nextCount = (shown, total) => Math.min(Math.max(0, Number(total) || 0), Math.max(0, Number(shown) || 0) + PAGE_SIZE);
  const visible = (rows, shown) => (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(shown) || 0));

  return { PAGE_SIZE, matches, filterConnectivity, filterSystems, filterAcquisition, filterAppRuns, initialCount, nextCount, visible };
});

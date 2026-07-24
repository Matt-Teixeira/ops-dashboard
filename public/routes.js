// Pure hash parsing + metadata for Phase 25 route-aware chrome.
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Routes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const SOURCES = {
    entities: "incident-engine · incidents.incidents",
    jobs: "util.app_run_logs",
    run: "util.app_run_logs",
    connectivity: "alert.*",
    appruns: "util.app_run_logs",
    acq: "stats.acquisition_history",
    systems: "util.app_run_logs + alert.*",
    system: "util.app_run_logs + alert.*",
    entity: "util.app_run_logs + alert.*",
    "incident-list": "incident-engine · incidents.incidents",
    incident: "incident-engine · incidents.*",
  };
  const PARENTS = {
    entities: "entities", jobs: "entities", run: "jobs", connectivity: "entities",
    appruns: "jobs", acq: "jobs", systems: "entities", system: "systems",
    entity: "entities", "incident-list": "entities", incident: "incident-list",
  };

  const safeId = (value) => typeof value === "string" && SAFE_ID_RE.test(value) ? value : null;

  function safeFrom(value) {
    return typeof value === "string" &&
      /^(entities|jobs|incident-list|dashboard|connectivity|systems|incidents|acq-systems|appruns:[A-Za-z0-9_.-]{1,64}|entity:[A-Za-z0-9_-]{1,64}|system:[A-Za-z0-9_-]{1,64}|incident:\d{1,12})$/.test(value)
      ? value : null;
  }

  function fromHref(value) {
    if (value === "entities") return "#";
    if (value === "jobs" || value === "dashboard") return "#jobs";
    if (value === "incident-list" || value === "incidents") return "#incident-list";
    if (value === "acq-systems") return "#acq-systems";
    if (value && value.startsWith("appruns:")) return "#appruns=" + encodeURIComponent(value.slice(8));
    if (value && value.startsWith("entity:")) return "#entity=" + encodeURIComponent(value.slice(7));
    if (value && value.startsWith("system:")) return "#system=" + encodeURIComponent(value.slice(7));
    if (value && value.startsWith("incident:")) return "#incident=" + encodeURIComponent(value.slice(9));
    return "#" + (value || "");
  }

  function fromLabel(value) {
    if (value === "dashboard" || value === "jobs") return "jobs";
    if (value === "incidents" || value === "incident-list") return "incident list";
    if (value === "entities") return "entities";
    return String(value || "entities").replace(/[:].*/, "");
  }

  function parse(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    let id = "entities";
    let params = {};
    if (raw.startsWith("run=")) {
      id = "run";
      const query = new URLSearchParams(raw);
      params = { run: query.get("run"), at: query.get("at"), from: safeFrom(query.get("from")) };
    } else if (raw === "" || raw === "incidents") id = "entities";
    else if (raw === "jobs") id = "jobs";
    else if (raw === "connectivity") id = "connectivity";
    else if (raw === "acq-systems") id = "acq";
    else if (raw === "systems") id = "systems";
    else if (raw.startsWith("entity=")) {
      const query = new URLSearchParams(raw);
      const entity = safeId(query.get("entity"));
      if (entity) { id = "entity"; params = { entity, from: safeFrom(query.get("from")) }; }
    }
    else if (raw.startsWith("system=")) {
      const query = new URLSearchParams(raw);
      const system = safeId(query.get("system"));
      if (system) { id = "system"; params = { system, from: safeFrom(query.get("from")) }; }
      else id = "systems";
    } else if (raw === "incident-list") id = "incident-list";
    else if (raw.startsWith("incident=")) {
      id = "incident";
      const query = new URLSearchParams(raw);
      params = { incident: query.get("incident"), from: safeFrom(query.get("from")) };
    } else if (raw.startsWith("appruns=")) {
      id = "appruns";
      const query = new URLSearchParams(raw);
      params = { app: query.get("appruns"), from: safeFrom(query.get("from")) };
    }

    const label = id === "entities" ? "Entities"
      : id === "jobs" ? "Jobs"
      : id === "incident-list" ? "Incident list"
      : id === "run" ? `Run ${params.run || "?"}`
      : id === "entity" ? `Entity ${params.entity || "?"}`
      : id === "system" ? `System ${params.system || "?"}`
      : id === "incident" ? `Incident #${params.incident || "?"}`
      : id === "appruns" ? `Run log — ${params.app || "?"}`
      : id === "acq" ? "Acquisition by system"
      : id[0].toUpperCase() + id.slice(1);
    const nav = ["run", "appruns", "acq"].includes(id) ? "jobs"
      : id === "entity" ? "entities"
      : id === "system" ? "systems"
      : id === "incident" ? "incident-list" : id;
    const fallback = PARENTS[id];
    const from = params.from || fallback;
    return {
      id, params, label, nav, source: SOURCES[id],
      documentTitle: `${label} · ops-dashboard`,
      returnHref: fromHref(from),
      returnLabel: fromLabel(from),
    };
  }

  return { parse, safeId, safeFrom, fromHref };
});
